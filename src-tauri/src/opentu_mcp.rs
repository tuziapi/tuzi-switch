//! Local MCP bridge for ChatGPT Desktop.
//!
//! The bridge deliberately keeps provider credentials in the renderer/native
//! application. ChatGPT receives only a short-lived, per-launch bearer token
//! and calls a small allow-listed tool surface.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

const PROTOCOL_VERSION: &str = "2025-06-18";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone)]
struct BridgeState {
    token: Arc<String>,
    endpoint: Arc<String>,
    app: AppHandle,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingInfo {
    pub endpoint: String,
    pub token: String,
    pub authorization: String,
    pub protocol_version: &'static str,
}

#[derive(Clone, Debug, Deserialize)]
struct RpcRequest {
    jsonrpc: String,
    method: String,
    #[serde(default)]
    params: Value,
    id: Option<Value>,
}

static STATE: OnceLock<BridgeState> = OnceLock::new();

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn error(id: Option<Value>, code: i32, message: impl Into<String>) -> Json<Value> {
    Json(json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message.into() }
    }))
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "opentu_list_models",
            "description": "列出 OpenTu 当前可用于创作的模型来源和已注册创作工具，不返回任何密钥。",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "opentu_get_canvas",
            "description": "读取当前 OpenTu 画布的元素、位置、文字和可编辑状态。",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "opentu_get_task",
            "description": "查询 OpenTu 创作任务状态和结果。",
            "inputSchema": {
                "type": "object",
                "properties": { "taskId": { "type": "string", "description": "OpenTu 任务 ID" } },
                "required": ["taskId"]
            }
        },
        {
            "name": "opentu_create_image",
            "description": "使用 OpenTu 当前配置创建图片。任务会在兔子助手内部执行。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "图片描述" },
                    "model": { "type": "string", "description": "可选模型 ID" },
                    "size": { "type": "string", "description": "可选尺寸" },
                    "insertToCanvas": { "type": "boolean", "description": "完成后插入当前画布" }
                },
                "required": ["prompt"]
            }
        },
        {
            "name": "opentu_create_video",
            "description": "使用 OpenTu 当前配置创建视频。任务会在兔子助手内部执行。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "视频描述" },
                    "model": { "type": "string", "description": "可选模型 ID" },
                    "insertToCanvas": { "type": "boolean", "description": "完成后插入当前画布" }
                },
                "required": ["prompt"]
            }
        },
        {
            "name": "opentu_create_audio",
            "description": "使用 OpenTu 当前配置创建音频。任务会在兔子助手内部执行。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "音频描述" },
                    "model": { "type": "string", "description": "可选模型 ID" },
                    "insertToCanvas": { "type": "boolean", "description": "完成后插入当前画布" }
                },
                "required": ["prompt"]
            }
        },
        {
            "name": "opentu_create_text",
            "description": "使用 OpenTu 当前配置生成文本内容。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string", "description": "文本任务" },
                    "model": { "type": "string", "description": "可选模型 ID" }
                },
                "required": ["prompt"]
            }
        },
        {
            "name": "opentu_insert_to_canvas",
            "description": "把已经生成的文本或媒体结果插入当前 OpenTu 画布。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "items": { "type": "array", "description": "要插入的内容" },
                    "verticalGap": { "type": "number" },
                    "horizontalGap": { "type": "number" }
                },
                "required": ["items"]
            }
        },
        {
            "name": "opentu_apply_canvas_edit",
            "description": "执行当前画布的可撤销编辑。删除和替换必须显式传 confirmed=true。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "plan": { "type": "object", "description": "OpenTu 画布编辑计划" },
                    "confirmed": { "type": "boolean", "description": "删除或替换时的明确确认" }
                },
                "required": ["plan"]
            }
        }
    ])
}

fn check_auth(headers: &HeaderMap, state: &BridgeState) -> bool {
    let Some(value) = headers.get("authorization").and_then(|v| v.to_str().ok()) else {
        return false;
    };
    value.strip_prefix("Bearer ") == Some(state.token.as_str())
}

async fn rpc(
    State(state): State<BridgeState>,
    headers: HeaderMap,
    Json(request): Json<RpcRequest>,
) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return (
            StatusCode::UNAUTHORIZED,
            error(request.id, -32001, "配对令牌无效"),
        );
    }
    if request.jsonrpc != "2.0" {
        return (
            StatusCode::BAD_REQUEST,
            error(request.id, -32600, "只支持 JSON-RPC 2.0"),
        );
    }
    if request.id.is_none() {
        return (StatusCode::ACCEPTED, Json(json!({})));
    }
    let id = request.id.clone();
    match request.method.as_str() {
        "initialize" => (
            StatusCode::OK,
            Json(json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": PROTOCOL_VERSION,
                    "capabilities": {"tools": {"listChanged": false}},
                    "serverInfo": {"name": "OpenTu Desktop", "version": env!("CARGO_PKG_VERSION")}
                }
            })),
        ),
        "tools/list" => (
            StatusCode::OK,
            Json(json!({"jsonrpc":"2.0", "id":id, "result":{"tools":tool_definitions()}})),
        ),
        "tools/call" => {
            let name = request
                .params
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let arguments = request
                .params
                .get("arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            if !tool_definitions().as_array().is_some_and(|tools| {
                tools
                    .iter()
                    .any(|t| t.get("name").and_then(Value::as_str) == Some(name))
            }) {
                return (StatusCode::OK, error(id, -32602, "未允许的 OpenTu 工具"));
            }
            if name == "opentu_apply_canvas_edit"
                && !arguments
                    .get("confirmed")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            {
                let plan = arguments.get("plan").cloned().unwrap_or_else(|| json!({}));
                let destructive =
                    plan.get("actions")
                        .and_then(Value::as_array)
                        .is_some_and(|actions| {
                            actions.iter().any(|a| {
                                matches!(
                                    a.get("op").and_then(Value::as_str),
                                    Some("delete" | "replace")
                                )
                            })
                        });
                if destructive {
                    return (
                        StatusCode::OK,
                        Json(
                            json!({"jsonrpc":"2.0", "id":id, "result":{"isError":true,"content":[{"type":"text","text":"此操作包含删除或替换，必须先获得用户明确确认（confirmed=true）。"}]}}),
                        ),
                    );
                }
            }
            let request_id = uuid::Uuid::new_v4().to_string();
            let (sender, receiver) = oneshot::channel();
            state
                .pending
                .lock()
                .await
                .insert(request_id.clone(), sender);
            if let Err(err) = state.app.emit(
                "opentu-mcp-call",
                json!({"requestId":request_id,"name":name,"arguments":arguments}),
            ) {
                state.pending.lock().await.remove(&request_id);
                return (
                    StatusCode::OK,
                    error(id, -32000, format!("无法连接 OpenTu 画布: {err}")),
                );
            }
            let result = match tokio::time::timeout(REQUEST_TIMEOUT, receiver).await {
                Ok(Ok(value)) => value,
                Ok(Err(_)) => {
                    json!({"isError":true,"content":[{"type":"text","text":"OpenTu 处理请求时连接已断开"}]})
                }
                Err(_) => {
                    json!({"isError":true,"content":[{"type":"text","text":"OpenTu 处理请求超时"}]})
                }
            };
            state.pending.lock().await.remove(&request_id);
            (
                StatusCode::OK,
                Json(json!({"jsonrpc":"2.0","id":id,"result":result})),
            )
        }
        _ => (StatusCode::OK, error(id, -32601, "方法未实现")),
    }
}

async fn health(State(state): State<BridgeState>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&headers, &state) {
        return StatusCode::UNAUTHORIZED;
    }
    StatusCode::OK
}

pub fn start(app: &AppHandle) {
    if STATE.get().is_some() {
        return;
    }
    let token = random_token();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
            Ok(listener) => listener,
            Err(error) => {
                log::error!("OpenTu MCP bridge failed to bind: {error}");
                return;
            }
        };
        let addr = match listener.local_addr() {
            Ok(addr) => addr,
            Err(error) => {
                log::error!("OpenTu MCP bridge address unavailable: {error}");
                return;
            }
        };
        let endpoint = format!("http://{addr}/mcp");
        let state = BridgeState {
            token: Arc::new(token),
            endpoint: Arc::new(endpoint),
            app: app_handle,
            pending: Arc::new(Mutex::new(HashMap::new())),
        };
        let _ = STATE.set(state.clone());
        log::info!("OpenTu MCP bridge listening at {}", state.endpoint);
        let router = Router::new()
            .route("/health", get(health))
            .route("/mcp", post(rpc))
            .with_state(state);
        if let Err(error) = axum::serve(listener, router).await {
            log::error!("OpenTu MCP bridge stopped: {error}");
        }
    });
}

#[tauri::command]
pub fn opentu_mcp_pairing() -> Result<PairingInfo, String> {
    let state = STATE
        .get()
        .ok_or_else(|| "OpenTu MCP 服务尚未启动".to_string())?;
    Ok(PairingInfo {
        endpoint: (*state.endpoint).clone(),
        token: (*state.token).clone(),
        authorization: format!("Bearer {}", state.token),
        protocol_version: PROTOCOL_VERSION,
    })
}

#[tauri::command]
pub async fn opentu_mcp_respond(request_id: String, result: Value) -> Result<(), String> {
    let state = STATE
        .get()
        .ok_or_else(|| "OpenTu MCP 服务尚未启动".to_string())?;
    let sender = state
        .pending
        .lock()
        .await
        .remove(&request_id)
        .ok_or_else(|| "MCP 请求已过期或不存在".to_string())?;
    sender
        .send(result)
        .map_err(|_| "MCP 请求接收方已断开".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_surface_contains_canvas_and_generation() {
        let definitions = tool_definitions();
        let names: Vec<_> = definitions
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.get("name").and_then(Value::as_str))
            .collect();
        assert!(names.contains(&"opentu_get_canvas"));
        assert!(names.contains(&"opentu_create_image"));
        assert!(names.contains(&"opentu_apply_canvas_edit"));
    }

    #[test]
    fn token_is_high_entropy_hex() {
        let token = random_token();
        assert_eq!(token.len(), 64);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
