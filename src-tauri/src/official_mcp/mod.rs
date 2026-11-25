//! Official cloud MCP setup. Account system tokens never enter this module.
mod rpc;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

pub(crate) const SERVER_ID: &str = "tuzi-official";
pub(crate) const ENDPOINT: &str = "https://api.tu-zi.com/mcp";
const CONNECTIONS: &str = "https://api.tu-zi.com/mcp/connections";

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    config_path: Option<String>,
    scope: String,
    configured: bool,
    busy: bool,
    phase: String,
    error: Option<String>,
    account_id: Option<String>,
    account_name: Option<String>,
    assistant_account_name: Option<String>,
    account_mismatch: bool,
    checked_at: Option<i64>,
}

#[derive(Default)]
struct Runtime {
    status: Status,
    cancel: Arc<AtomicBool>,
    home: Option<PathBuf>,
}
static RUNTIME: Lazy<Mutex<Runtime>> = Lazy::new(|| Mutex::new(Runtime::default()));

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Connect,
    Check,
}

pub(crate) fn server() -> crate::app_config::McpServer {
    crate::app_config::McpServer {
        id: SERVER_ID.into(),
        name: "兔子官方 MCP".into(),
        server: json!({"type":"http","url":ENDPOINT}),
        apps: crate::app_config::McpApps {
            codex: true,
            ..Default::default()
        },
        description: Some("兔子 API 文档、账户查询与经审批的业务操作".into()),
        homepage: Some("https://api.tu-zi.com".into()),
        docs: Some("https://api.tu-zi.com/pricing/mcp".into()),
        tags: vec!["official".into()],
    }
}

// Do not silently write one profile and authorize a different CODEX_HOME.
fn config_home() -> Result<PathBuf, &'static str> {
    let home = crate::codex_config::get_codex_config_dir();
    if !home.is_absolute() {
        return Err("config_conflict");
    }
    if !cfg!(feature = "isolated-profile") && std::env::var_os("CC_SWITCH_TEST_HOME").is_none() {
        if let Some(env) = std::env::var_os("CODEX_HOME") {
            if PathBuf::from(env) != home {
                return Err("config_home_mismatch");
            }
        }
    }
    Ok(home)
}

fn target_home(connect_local: bool) -> Result<(PathBuf, &'static str), &'static str> {
    if connect_local {
        let (path, scope) =
            crate::codex_mcp_target::resolve(true).map_err(|_| "config_home_mismatch")?;
        return Ok((path.parent().ok_or("config_conflict")?.to_owned(), scope));
    }
    Ok((
        config_home()?,
        if cfg!(feature = "isolated-profile") {
            "isolated"
        } else {
            "local"
        },
    ))
}

fn check_target(
    home: &Path,
    connect_local: bool,
    expected: Option<&str>,
) -> Result<(), &'static str> {
    let path = home.join("config.toml");
    if expected.is_some_and(|value| path.to_str() != Some(value))
        || (connect_local && expected.is_none())
    {
        return Err("target_changed");
    }
    Ok(())
}

pub(crate) fn validate_config(home: &Path) -> Result<bool, &'static str> {
    let path = home.join("config.toml");
    let file = match std::fs::File::open(&path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err("config_conflict"),
    };
    let mut source = String::new();
    file.take(2 * 1024 * 1024 + 1)
        .read_to_string(&mut source)
        .map_err(|_| "config_conflict")?;
    if source.len() > 2 * 1024 * 1024 {
        return Err("config_conflict");
    }
    let doc: toml::Value = toml::from_str(&source).map_err(|_| "config_conflict")?;
    let Some(entry) = doc.get("mcp_servers").and_then(|v| v.get(SERVER_ID)) else {
        return Ok(false);
    };
    let entry = entry.as_table().ok_or("config_conflict")?;
    if entry.get("url").and_then(|v| v.as_str()) != Some(ENDPOINT)
        || entry.get("enabled").and_then(|v| v.as_bool()) == Some(false)
        || entry
            .keys()
            .any(|k| !matches!(k.as_str(), "url" | "enabled" | "type"))
        || entry
            .get("type")
            .is_some_and(|v| v.as_str() != Some("http"))
    {
        return Err("config_conflict");
    }
    Ok(true)
}

fn phase(value: &str) {
    if let Ok(mut r) = RUNTIME.lock() {
        r.status.phase = value.into();
    }
}

async fn registration_ready() -> Result<(), &'static str> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|_| "local_error")?;
    let mut response = client
        .get("https://api.tu-zi.com/.well-known/oauth-authorization-server")
        .send()
        .await
        .map_err(|_| "service_unavailable")?;
    if !response.status().is_success() {
        return Err("service_unavailable");
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "service_unavailable")? {
        if body.len() + chunk.len() > 65536 {
            return Err("service_unavailable");
        }
        body.extend_from_slice(&chunk);
    }
    let data: Value = serde_json::from_slice(&body).map_err(|_| "service_unavailable")?;
    validate_registration_metadata(&data)
}

fn validate_registration_metadata(data: &Value) -> Result<(), &'static str> {
    if data["issuer"] != "https://api.tu-zi.com"
        || data["registration_endpoint"] != "https://api.tu-zi.com/mcp/oauth/register"
        || !data["token_endpoint_auth_methods_supported"]
            .as_array()
            .is_some_and(|a| a.contains(&json!("none")))
    {
        return Err("server_upgrade_required");
    }
    Ok(())
}

pub(super) fn valid_authorization_url(raw: &str, endpoint: &str) -> bool {
    let (Ok(url), Ok(resource)) = (url::Url::parse(raw), url::Url::parse(endpoint)) else {
        return false;
    };
    raw.len() <= 8192
        && url.origin() == resource.origin()
        && url.path() == "/mcp/authorize"
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url
            .query_pairs()
            .any(|(k, v)| k == "resource" && v == endpoint)
}

pub(super) fn tool_data(result: Value) -> Result<Value, &'static str> {
    if result
        .get("isError")
        .is_some_and(|v| v != false && !v.is_null())
    {
        return Err("verification_failed");
    }
    if let Some(data) = result.get("structuredContent").filter(|v| v.is_object()) {
        return Ok(data.clone());
    }
    let content = result["content"].as_array().ok_or("verification_failed")?;
    for item in content {
        if item["type"] == "text" {
            if let Some(raw) = item["text"].as_str() {
                if let Ok(data) = serde_json::from_str::<Value>(raw) {
                    if data.is_object() {
                        return Ok(data);
                    }
                }
            }
        }
    }
    Err("verification_failed")
}

// No model turn is created. This ephemeral session invokes exactly two
// hard-coded read-only MCP tools through Codex's own authenticated transport.
pub(super) fn verify(
    rpc: &mut rpc::Rpc,
    cwd: &Path,
    cancelled: &AtomicBool,
) -> Result<(String, String), &'static str> {
    // Codex merges config tables: replacing mcp_servers alone does not erase
    // other entries. Read effective settings, then explicitly disable every
    // unrelated server in this ephemeral thread only.
    let effective = rpc.call(
        "config/read",
        json!({"includeLayers":false,"cwd":cwd}),
        15,
        cancelled,
    )?;
    let servers = effective["config"]["mcp_servers"]
        .as_object()
        .ok_or("codex_protocol_error")?;
    let mut overrides = serde_json::Map::new();
    for name in servers.keys() {
        if name != SERVER_ID {
            overrides.insert(name.clone(), json!({"enabled":false}));
        }
    }
    overrides.insert(
        SERVER_ID.into(),
        // config/read includes null defaults; forwarding those into TOML
        // overrides would make valid configurations fail to load.
        json!({"url":servers.get(SERVER_ID).and_then(|v| v["url"].as_str()).ok_or("not_configured")?,"enabled":true}),
    );
    let thread = rpc.call(
        "thread/start",
        json!({"ephemeral":true,"cwd":cwd,"approvalPolicy":"never","sandbox":"read-only","config":{"mcp_servers":overrides}}),
        30,
        cancelled,
    )?;
    let thread = thread["thread"]["id"]
        .as_str()
        .ok_or("codex_protocol_error")?;
    // Discovery waits for MCP startup before tool/call; no unrelated inventory.
    rpc.call(
        "mcpServerStatus/list",
        json!({"threadId":thread,"serverName":SERVER_ID,"detail":"toolsAndAuthOnly"}),
        45,
        cancelled,
    )?;
    let account = tool_data(rpc.call(
        "mcpServer/tool/call",
        json!({"threadId":thread,"server":SERVER_ID,"tool":"get_account","arguments":{}}),
        30,
        cancelled,
    )?)?;
    let id = account["id"]
        .as_u64()
        .filter(|v| *v > 0)
        .ok_or("verification_failed")?
        .to_string();
    let name = account["username"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
        .ok_or("verification_failed")?
        .to_owned();
    let overview = tool_data(rpc.call("mcpServer/tool/call", json!({"threadId":thread,"server":SERVER_ID,"tool":"get_overview","arguments":{"locale":"zh-CN"}}), 30, cancelled)?)?;
    if overview.as_object().is_none_or(|v| v.is_empty()) {
        return Err("verification_failed");
    }
    Ok((id, name))
}

fn run(
    app: &tauri::AppHandle,
    action: Action,
    cancelled: &AtomicBool,
    home: PathBuf,
    connect_local: bool,
) -> Result<(PathBuf, String, String), &'static str> {
    if target_home(connect_local)?.0 != home {
        return Err("target_changed");
    }
    if !home.is_dir() {
        return Err("codex_not_initialized");
    }
    if cancelled.load(Ordering::Acquire) {
        return Err("cancelled");
    }
    match action {
        Action::Connect => {
            // Fail before writing settings or starting OAuth if production
            // cannot support this client. Existing authorized clients may
            // still use Check without requiring dynamic registration again.
            phase("checking_service");
            tauri::async_runtime::block_on(registration_ready())?;
        }
        Action::Check => {
            if !validate_config(&home)? {
                return Err("not_configured");
            }
        }
    }
    let cwd = tempfile::tempdir().map_err(|_| "local_error")?;
    // Reuse installed Codex discovery, preferring the desktop bundle. No shell.
    let mut rpc = None;
    for executable in crate::codex_config::codex_app_server_candidates() {
        if let Ok(mut candidate) = rpc::Rpc::spawn(&executable, &home, cwd.path(), ENDPOINT) {
            candidate.initialize(cancelled)?;
            rpc = Some(candidate);
            break;
        }
    }
    let mut rpc = rpc.ok_or("codex_missing")?;
    if cancelled.load(Ordering::Acquire) {
        return Err("cancelled");
    }
    match action {
        Action::Connect => {
            if target_home(connect_local)?.0 != home {
                return Err("target_changed");
            }
            phase("configuring");
            crate::services::McpService::install_official_tuzi(&app.state(), &home)
                .map_err(|_| "config_conflict")?;
            if cancelled.load(Ordering::Acquire) {
                return Err("cancelled");
            }
            phase("authorizing");
            let response = rpc.call(
                "mcpServer/oauth/login",
                json!({"name":SERVER_ID,"timeoutSecs":300}),
                30,
                cancelled,
            )?;
            let url = response["authorizationUrl"]
                .as_str()
                .ok_or("codex_protocol_error")?;
            if !valid_authorization_url(url, ENDPOINT) {
                return Err("authorization_url_rejected");
            }
            app.opener()
                .open_url(url, None::<&str>)
                .map_err(|_| "browser_failed")?;
            rpc.wait_login(cancelled)?;
            // A fresh app-server reads the newly saved credential, matching a
            // subsequent Codex launch rather than trusting a login callback.
            drop(rpc);
            let mut fresh = None;
            for executable in crate::codex_config::codex_app_server_candidates() {
                if let Ok(mut candidate) = rpc::Rpc::spawn(&executable, &home, cwd.path(), ENDPOINT)
                {
                    candidate.initialize(cancelled)?;
                    fresh = Some(candidate);
                    break;
                }
            }
            rpc = fresh.ok_or("codex_missing")?;
        }
        Action::Check => {}
    }
    phase("checking");
    let (id, name) = verify(&mut rpc, cwd.path(), cancelled)?;
    // If another configuration edit happened while authorizing, don't display
    // success for a transport which is no longer installed.
    if target_home(connect_local)?.0 != home || !validate_config(&home)? {
        return Err("config_conflict");
    }
    Ok((home, id, name))
}

#[tauri::command]
pub fn tuzi_mcp_status(
    account: State<'_, Arc<crate::tuzi_account::AccountService>>,
    connect_local: Option<bool>,
) -> Status {
    let mut r = RUNTIME.lock().unwrap_or_else(|e| e.into_inner());
    let target = target_home(connect_local.unwrap_or(false));
    let home = target
        .as_ref()
        .map(|(home, _)| home.clone())
        .map_err(|e| *e);
    let valid = home
        .as_ref()
        .map_err(|e| *e)
        .and_then(|h| validate_config(h));
    let mut status = r.status.clone();
    status.config_path = home
        .as_ref()
        .ok()
        .map(|h| h.join("config.toml").to_string_lossy().into_owned());
    status.scope = target
        .as_ref()
        .map(|(_, scope)| *scope)
        .unwrap_or("unknown")
        .into();
    status.configured = valid == Ok(true);
    if !status.busy && (!status.configured || home.as_ref().ok() != r.home.as_ref()) {
        if home.as_ref().ok() != r.home.as_ref() {
            status.error = None;
            r.status.error = None;
        }
        status.phase = if status.configured {
            "configured"
        } else {
            "not_configured"
        }
        .into();
        status.account_id = None;
        status.account_name = None;
        status.checked_at = None;
        r.status.account_id = None;
        r.status.account_name = None;
        r.status.checked_at = None;
        r.status.phase = status.phase.clone();
    }
    if status.phase.is_empty() {
        status.phase = if status.configured {
            "configured"
        } else {
            "not_configured"
        }
        .into();
    }
    if let Err(e) = valid {
        status.error = Some(e.into());
    }
    let account = account.state();
    if let Some(identity) = account.identity.filter(|_| account.status == "connected") {
        status.assistant_account_name = Some(identity.username);
        status.account_mismatch = status
            .account_id
            .as_ref()
            .is_some_and(|id| id != &identity.user_id);
    }
    status
}

#[tauri::command]
pub fn tuzi_mcp_start(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    action: Action,
    connect_local: Option<bool>,
    expected_config_path: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("local_error".into());
    }
    let connect_local = connect_local.unwrap_or(false);
    let (home, _) = target_home(connect_local)?;
    check_target(&home, connect_local, expected_config_path.as_deref())?;
    let cancel = {
        let mut r = RUNTIME.lock().map_err(|_| "local_error")?;
        if r.status.busy {
            return Err("busy".into());
        }
        r.cancel = Arc::new(AtomicBool::new(false));
        r.home = Some(home.clone());
        r.status = Status {
            busy: true,
            phase: "preparing".into(),
            ..Default::default()
        };
        r.cancel.clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let result = run(&app, action, &cancel, home, connect_local);
        if let Ok(mut r) = RUNTIME.lock() {
            r.status.busy = false;
            match result {
                Ok((home, id, name)) if !cancel.load(Ordering::Acquire) => {
                    r.home = Some(home);
                    r.status.phase = "connected".into();
                    r.status.account_id = Some(id);
                    r.status.account_name = Some(name);
                    r.status.checked_at = Some(chrono::Utc::now().timestamp());
                }
                Ok(_) => {
                    r.status.phase = "configured".into();
                    r.status.error = Some("cancelled".into());
                }
                Err(e) => {
                    r.status.phase = "configured".into();
                    r.status.error = Some(e.into());
                }
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn tuzi_mcp_cancel() {
    if let Ok(r) = RUNTIME.lock() {
        r.cancel.store(true, Ordering::Release);
    }
}

#[tauri::command]
pub fn tuzi_mcp_manage(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(CONNECTIONS, None::<&str>)
        .map_err(|_| "browser_failed".into())
}

#[cfg(test)]
mod tests;
