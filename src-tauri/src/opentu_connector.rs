//! One-click Codex setup. This stores only the local MCP capability, never an account/model key.
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

static LAST_CALL: AtomicU64 = AtomicU64::new(0);

fn runtime_path() -> Result<PathBuf, String> {
    let root = if let Ok(home) = std::env::var("CC_SWITCH_TEST_HOME") {
        PathBuf::from(home).join(".local/share")
    } else {
        dirs::data_local_dir().ok_or("无法确定当前用户的应用数据目录。")?
    };
    #[cfg(feature = "isolated-profile")]
    let application = crate::config::ISOLATED_PROFILE_ID;
    #[cfg(not(feature = "isolated-profile"))]
    let application = "com.tuziswitch.desktop";
    Ok(root
        .join(application)
        .join("opentu-connector")
        .join("runtime.json"))
}
fn config_path() -> Result<PathBuf, String> {
    // Test and preview profiles must never write the user's live Codex settings.
    if cfg!(feature = "isolated-profile") || std::env::var_os("CC_SWITCH_TEST_HOME").is_some() {
        return Ok(crate::config::get_home_dir().join(".codex/config.toml"));
    }
    if let Some(custom) = crate::settings::get_codex_override_dir() {
        return Ok(custom.join("config.toml"));
    }
    if let Some(home) = std::env::var_os("CODEX_HOME") {
        let path = PathBuf::from(home);
        if !path.is_absolute() {
            return Err("CODEX_HOME 必须是绝对路径。".into());
        }
        return Ok(path.join("config.toml"));
    }
    Ok(crate::codex_config::get_codex_config_path())
}
fn executable_path() -> Result<PathBuf, String> {
    // AppImage extraction directories disappear on restart; use the installed image.
    #[cfg(target_os = "linux")]
    if let Some(path) = std::env::var_os("APPIMAGE") {
        return Ok(PathBuf::from(path));
    }
    std::env::current_exe().map_err(|_| "无法定位兔子助手程序。".into())
}

pub(crate) fn record_call() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    LAST_CALL.store(now, Ordering::Release);
}

pub(crate) fn publish_if_enabled(endpoint: &str, token: &str) {
    let result = (|| -> Result<(), String> {
        let path = runtime_path()?;
        if path.with_file_name("enabled").is_file() {
            opentu_connector::publish(
                &path,
                &opentu_connector::Discovery {
                    endpoint: endpoint.into(),
                    token: token.into(),
                },
            )?;
        }
        Ok(())
    })();
    if result.is_err() {
        log::warn!("OpenTu connector discovery could not be refreshed; reinstall connection from settings.");
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorStatus {
    configured: bool,
    last_tool_call_at: Option<u64>,
}
#[tauri::command]
pub fn opentu_connector_status() -> Result<ConnectorStatus, String> {
    let configured = opentu_connector::installed(&config_path()?, &runtime_path()?)?;
    let last = LAST_CALL.load(Ordering::Acquire);
    Ok(ConnectorStatus {
        configured,
        last_tool_call_at: (configured && last > 0).then_some(last),
    })
}

#[tauri::command]
pub fn opentu_connector_install() -> Result<ConnectorStatus, String> {
    let (endpoint, token) = crate::opentu_mcp::connector_pairing()?;
    let runtime = runtime_path()?;
    opentu_connector::publish(&runtime, &opentu_connector::Discovery { endpoint, token })?;
    let marker = runtime.with_file_name("enabled");
    std::fs::write(&marker, b"1").map_err(|_| "无法保存连接器启用状态。")?;
    // Atomic config updates preserve unrelated MCPs, models and auth settings.
    opentu_connector::configure(&config_path()?, &runtime, &executable_path()?, false)?;
    opentu_connector_status()
}
#[tauri::command]
pub fn opentu_connector_remove() -> Result<ConnectorStatus, String> {
    let runtime = runtime_path()?;
    opentu_connector::configure(&config_path()?, &runtime, &executable_path()?, true)?;
    for path in [runtime.with_file_name("enabled"), runtime] {
        match std::fs::remove_file(path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("配置已解除，但连接器运行记录未清除，请重试。".into()),
        }
    }
    LAST_CALL.store(0, Ordering::Release);
    opentu_connector_status()
}
