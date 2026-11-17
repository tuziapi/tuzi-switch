//! Local MCP bridge for ChatGPT Desktop.
//!
//! The bridge deliberately keeps provider credentials in the renderer/native
//! application. ChatGPT receives only a short-lived, per-launch bearer token
//! and calls a small allow-listed tool surface.

use axum::{
    extract::{Request, State},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};

const PROTOCOL_VERSION: &str = "2025-06-18";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Clone)]
struct BridgeState {
    token: Arc<String>,
    endpoint: Arc<String>,
    dispatch: Arc<dyn Fn(Value) -> Result<(), String> + Send + Sync>,
    ready: Arc<AtomicBool>,
    pending: Arc<Mutex<HashMap<String, oneshot::Sender<Value>>>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingInfo {
    pub endpoint: String,
    pub canvas_ready: bool,
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
    let mut definitions = json!([
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
    ]);
    for tool in definitions.as_array_mut().expect("tool definitions") {
        let name = tool["name"].as_str().unwrap().to_string();
        let read_only = matches!(
            name.as_str(),
            "opentu_list_models" | "opentu_get_canvas" | "opentu_get_task"
        );
        tool["annotations"] = json!({
            "readOnlyHint": read_only,
            "destructiveHint": name == "opentu_apply_canvas_edit",
            "idempotentHint": read_only,
            "openWorldHint": name.starts_with("opentu_create_") || name == "opentu_insert_to_canvas"
        });
        let schema = &mut tool["inputSchema"];
        schema["additionalProperties"] = json!(false);
        if name.starts_with("opentu_create_") {
            schema["properties"]["prompt"]["minLength"] = json!(1);
            schema["properties"]["prompt"]["maxLength"] = json!(20000);
            schema["properties"]["modelRef"] = json!({
                "type": "object", "additionalProperties": false,
                "properties": {"modelId": {"type": "string"}, "profileId": {"type": ["string", "null"]}},
                "required": ["modelId", "profileId"],
                "description": "复制 opentu_list_models 返回的 modelRef，避免同名模型使用错误来源"
            });
            schema["properties"]["insertToCanvas"] = json!({
                "type": "boolean", "default": false,
                "description": "显式为 true 时完成后插入画布；默认只创建任务"
            });
        }
        if name == "opentu_insert_to_canvas" {
            schema["properties"]["items"] = json!({
                "type": "array", "minItems": 1, "maxItems": 100,
                "items": {"type": "object", "additionalProperties": false,
                    "properties": {
                        "type": {"type": "string", "enum": ["text", "image", "video", "audio", "svg"]},
                        "content": {"type": "string", "description": "文本、SVG 或媒体 URL"},
                        "label": {"type": "string"}, "groupId": {"type": "string"}
                    }, "required": ["type", "content"]}
            });
        }
        if name == "opentu_apply_canvas_edit" {
            tool["description"] = json!("执行可撤销画布编辑。先读取画布取得 boardId 和 revision；删除/替换在 confirmed=true 后仍需用户在兔子助手确认。");
            tool["inputSchema"]["properties"]["plan"] = json!({
                "type": "object", "additionalProperties": false,
                "properties": {
                    "version": {"type": "integer", "const": 1},
                    "boardId": {"type": "string"},
                    "revision": {"type": "string", "pattern": "^[a-f0-9]{64}$"},
                    "status": {"type": "string", "const": "ready"},
                    "actions": {"type": "array", "minItems": 1, "maxItems": 20,
                        "items": {"type": "object", "additionalProperties": false,
                            "properties": {
                                "op": {"type": "string", "enum": ["locate", "move", "arrange", "scale", "copy", "set_text", "delete", "replace"]},
                                "ids": {"type": "array", "minItems": 1, "maxItems": 100, "items": {"type": "string"}},
                                "dx": {"type": "number"}, "dy": {"type": "number"},
                                "scale": {"type": "number", "minimum": 0.1, "maximum": 10},
                                "columns": {"type": "integer", "minimum": 1, "maximum": 20},
                                "gap": {"type": "number", "minimum": 0, "maximum": 2000},
                                "text": {"type": "string", "maxLength": 10000},
                                "sourceId": {"type": "string"}
                            }, "required": ["op", "ids"]}
                    }
                }, "required": ["version", "boardId", "revision", "status", "actions"]
            });
        }
    }
    definitions
}

fn check_auth(headers: &HeaderMap, state: &BridgeState) -> bool {
    if headers.get_all("authorization").iter().count() != 1 {
        return false;
    }
    let Some(value) = headers.get("authorization").and_then(|v| v.to_str().ok()) else {
        return false;
    };
    value.strip_prefix("Bearer ") == Some(state.token.as_str())
}

async fn rpc(state: State<BridgeState>, headers: HeaderMap, request: Json<RpcRequest>) -> Response {
    let (status, body) = rpc_inner(state, headers, request).await;
    // Streamable HTTP notifications are acknowledged with an empty 202.
    if status == StatusCode::ACCEPTED {
        status.into_response()
    } else {
        (status, body).into_response()
    }
}

async fn rpc_inner(
    State(state): State<BridgeState>,
    headers: HeaderMap,
    Json(request): Json<RpcRequest>,
) -> (StatusCode, Json<Value>) {
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
        "ping" => (
            StatusCode::OK,
            Json(json!({"jsonrpc":"2.0", "id":id, "result":{}})),
        ),
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
            if !state.ready.load(Ordering::Acquire) {
                return (
                    StatusCode::OK,
                    error(id, -32000, "请先在兔子助手中打开 OpenTu 创作画布"),
                );
            }
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
            if !arguments.is_object() {
                return (StatusCode::OK, error(id, -32602, "工具参数必须是对象"));
            }
            let expires_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                + REQUEST_TIMEOUT.as_millis();
            let request_id = uuid::Uuid::new_v4().to_string();
            let (sender, receiver) = oneshot::channel();
            state
                .pending
                .lock()
                .await
                .insert(request_id.clone(), sender);
            if let Err(err) = (state.dispatch)(
                json!({"requestId":request_id,"name":name,"arguments":arguments,"expiresAt":expires_at as u64}),
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

async fn guard(State(state): State<BridgeState>, request: Request, next: Next) -> Response {
    let headers = request.headers();
    let authority = state
        .endpoint
        .trim_start_matches("http://")
        .trim_end_matches("/mcp");
    let origin = format!("http://{authority}");
    // Reject DNS rebinding and browser cross-origin requests, even with a token.
    if headers.get("host").and_then(|v| v.to_str().ok()) != Some(authority)
        || headers
            .get("origin")
            .is_some_and(|v| v.to_str().ok() != Some(origin.as_str()))
    {
        return StatusCode::FORBIDDEN.into_response();
    }
    if !check_auth(headers, &state) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    if headers
        .get("mcp-protocol-version")
        .is_some_and(|v| !matches!(v.to_str().ok(), Some("2025-03-26" | "2025-06-18")))
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    next.run(request).await
}

fn router(state: BridgeState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/mcp", post(rpc))
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .with_state(state)
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
            dispatch: Arc::new(move |payload| {
                app_handle
                    .emit("opentu-mcp-call", payload)
                    .map_err(|e| e.to_string())
            }),
            ready: Arc::new(AtomicBool::new(false)),
            pending: Arc::new(Mutex::new(HashMap::new())),
        };
        let _ = STATE.set(state.clone());
        log::info!("OpenTu MCP bridge listening at {}", state.endpoint);
        if let Err(error) = axum::serve(listener, router(state)).await {
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
        canvas_ready: state.ready.load(Ordering::Acquire),
        protocol_version: PROTOCOL_VERSION,
    })
}

#[tauri::command]
pub fn opentu_mcp_set_ready(ready: bool) -> Result<(), String> {
    let state = STATE.get().ok_or("OpenTu MCP 服务尚未启动")?;
    state.ready.store(ready, Ordering::Release);
    Ok(())
}

/// Secrets never cross IPC into the renderer or become visible in screenshots.
#[tauri::command]
pub async fn opentu_mcp_copy(field: String) -> Result<(), String> {
    let state = STATE.get().ok_or("OpenTu MCP 服务尚未启动")?;
    let text = match field.as_str() {
        "endpoint" => (*state.endpoint).clone(),
        "token" => (*state.token).clone(),
        "authorization" => format!("Bearer {}", state.token),
        _ => return Err("不支持的配对字段".into()),
    };
    crate::commands::copy_text_to_clipboard(text).await?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionCheck {
    protocol_version: String,
    tool_count: usize,
    canvas_ready: bool,
}

async fn check_connection(state: &BridgeState) -> Result<ConnectionCheck, String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|_| "无法创建本地检查连接")?;
    let init = json!({"jsonrpc":"2.0", "id":1, "method":"initialize", "params":{"protocolVersion":PROTOCOL_VERSION,"capabilities":{},"clientInfo":{"name":"OpenTu local check","version":"1"}}});
    let unauthorized = client
        .post(state.endpoint.as_str())
        .json(&init)
        .send()
        .await
        .map_err(|_| "无法连接本地 MCP 服务")?;
    if unauthorized.status() != reqwest::StatusCode::UNAUTHORIZED {
        return Err("本地服务认证检查失败".into());
    }
    let initialized: Value = client
        .post(state.endpoint.as_str())
        .bearer_auth(state.token.as_str())
        .json(&init)
        .send()
        .await
        .map_err(|_| "初始化连接失败")?
        .error_for_status()
        .map_err(|_| "初始化被拒绝")?
        .json()
        .await
        .map_err(|_| "初始化响应无效")?;
    if initialized["result"]["protocolVersion"] != PROTOCOL_VERSION {
        return Err("MCP 协议版本检查失败".into());
    }
    let listed: Value = client
        .post(state.endpoint.as_str())
        .bearer_auth(state.token.as_str())
        .header("MCP-Protocol-Version", PROTOCOL_VERSION)
        .json(&json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}))
        .send()
        .await
        .map_err(|_| "工具列表连接失败")?
        .error_for_status()
        .map_err(|_| "工具列表被拒绝")?
        .json()
        .await
        .map_err(|_| "工具列表响应无效")?;
    let count = listed["result"]["tools"]
        .as_array()
        .ok_or("缺少工具列表")?
        .len();
    if count != tool_definitions().as_array().unwrap().len() {
        return Err("工具列表不完整".into());
    }
    Ok(ConnectionCheck {
        protocol_version: PROTOCOL_VERSION.into(),
        tool_count: count,
        canvas_ready: state.ready.load(Ordering::Acquire),
    })
}

#[tauri::command]
pub async fn opentu_mcp_check() -> Result<ConnectionCheck, String> {
    check_connection(STATE.get().ok_or("OpenTu MCP 服务尚未启动")?).await
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

    async fn serve_test() -> (BridgeState, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let state = BridgeState {
            endpoint: Arc::new(format!("http://{}/mcp", listener.local_addr().unwrap())),
            token: Arc::new("SYNTHETIC-local-test-token".into()),
            ready: Arc::new(AtomicBool::new(false)),
            dispatch: Arc::new(|_| Err("SYNTHETIC-no-renderer".into())),
            pending: Arc::new(Mutex::new(HashMap::new())),
        };
        let app = router(state.clone());
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (state, task)
    }

    #[tokio::test]
    async fn live_http_pairing_check_and_secret_free_metadata() {
        let (state, server) = serve_test().await;
        let result = check_connection(&state).await.unwrap();
        assert_eq!(result.tool_count, 9);
        assert!(!result.canvas_ready);
        let pairing = PairingInfo {
            endpoint: (*state.endpoint).clone(),
            canvas_ready: false,
            protocol_version: PROTOCOL_VERSION,
        };
        let serialized = serde_json::to_value(pairing).unwrap();
        assert!(serialized.get("token").is_none());
        assert!(serialized.get("authorization").is_none());
        server.abort();
    }

    #[tokio::test]
    async fn live_http_rejects_wrong_auth_origin_host_and_protocol() {
        let (state, server) = serve_test().await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        for (header, value, status) in [
            ("Authorization", "Bearer wrong", 401),
            ("Origin", "https://untrusted.example", 403),
            ("Host", "untrusted.example", 403),
            ("MCP-Protocol-Version", "invalid", 400),
        ] {
            let response = client
                .post(state.endpoint.as_str())
                .bearer_auth(state.token.as_str())
                .header(header, value)
                .json(&json!({"jsonrpc":"2.0","id":1,"method":"ping"}))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status().as_u16(), status, "{header}");
        }
        server.abort();
    }

    #[tokio::test]
    async fn live_http_notifications_ping_and_missing_canvas() {
        let (state, server) = serve_test().await;
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let response = client
            .post(state.endpoint.as_str())
            .bearer_auth(state.token.as_str())
            .json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status().as_u16(), 202);
        assert!(response.bytes().await.unwrap().is_empty());
        let response: Value = client
            .post(state.endpoint.as_str())
            .bearer_auth(state.token.as_str())
            .json(&json!({"jsonrpc":"2.0","id":2,"method":"ping"}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(response["result"], json!({}));
        let response: Value = client.post(state.endpoint.as_str()).bearer_auth(state.token.as_str())
            .json(&json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"opentu_get_canvas"}})).send().await.unwrap().json().await.unwrap();
        assert_eq!(response["error"]["code"], -32000);
        assert!(state.pending.lock().await.is_empty());
        server.abort();
    }

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

    #[test]
    fn generation_schema_exposes_provider_selection_and_opt_in_insertion() {
        for tool in tool_definitions().as_array().unwrap() {
            if tool["name"].as_str().unwrap().starts_with("opentu_create_") {
                let schema = &tool["inputSchema"];
                assert_eq!(schema["additionalProperties"], false);
                assert_eq!(
                    schema["properties"]["modelRef"]["required"],
                    json!(["modelId", "profileId"])
                );
                assert_eq!(schema["properties"]["insertToCanvas"]["default"], false);
                assert_eq!(tool["annotations"]["readOnlyHint"], false);
            }
        }
    }

    #[test]
    fn canvas_schema_describes_revision_and_element_actions() {
        let definitions = tool_definitions();
        let edit = definitions
            .as_array()
            .unwrap()
            .iter()
            .find(|tool| tool["name"] == "opentu_apply_canvas_edit")
            .unwrap();
        let schema = &edit["inputSchema"]["properties"]["plan"];
        assert_eq!(
            schema["required"],
            json!(["version", "boardId", "revision", "status", "actions"])
        );
        assert_eq!(
            schema["properties"]["actions"]["items"]["required"],
            json!(["op", "ids"])
        );
    }
}
