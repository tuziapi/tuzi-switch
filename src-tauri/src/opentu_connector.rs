//! One-click Codex setup. This stores only the local MCP capability, never an account/model key.
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

static LAST_CALL: AtomicU64 = AtomicU64::new(0);
static CONFIG_MUTATION: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn runtime_path(local_client: bool) -> Result<PathBuf, String> {
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
        .join(if local_client && cfg!(feature = "isolated-profile") {
            "opentu-local-connector"
        } else {
            "opentu-connector"
        })
        .join("runtime.json"))
}
#[cfg(test)]
use crate::codex_mcp_target::select_config_path;

struct ConnectorPaths {
    config: PathBuf,
    runtime: PathBuf,
    scope: &'static str,
}

fn connector_paths(connect_local: bool) -> Result<ConnectorPaths, String> {
    let (config, scope) = crate::codex_mcp_target::resolve(connect_local)?;
    Ok(ConnectorPaths {
        config,
        runtime: runtime_path(connect_local && scope == "local")?,
        scope,
    })
}

fn check_target(paths: &ConnectorPaths, expected: Option<&str>) -> Result<(), String> {
    if let Some(expected) = expected {
        if paths.config.to_str() != Some(expected) {
            return Err("连接目标已变化，请重新打开连接面板后重试。".into());
        }
    } else if cfg!(feature = "isolated-profile") && paths.scope == "local" {
        return Err("请先查看本机配置位置，再点击连接。".into());
    }
    Ok(())
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
        let mut paths = vec![runtime_path(false)?];
        if cfg!(feature = "isolated-profile") {
            paths.push(runtime_path(true)?);
        }
        for path in paths {
            if path.with_file_name("enabled").is_file() {
                opentu_connector::publish(
                    &path,
                    &opentu_connector::Discovery {
                        endpoint: endpoint.into(),
                        token: token.into(),
                    },
                )?;
            }
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
    config_path: String,
    scope: &'static str,
}
fn status(paths: &ConnectorPaths) -> Result<ConnectorStatus, String> {
    let configured = opentu_connector::installed(&paths.config, &paths.runtime)?;
    let last = LAST_CALL.load(Ordering::Acquire);
    Ok(ConnectorStatus {
        configured,
        last_tool_call_at: (configured && last > 0).then_some(last),
        config_path: paths.config.to_string_lossy().into_owned(),
        scope: paths.scope,
    })
}

#[tauri::command]
pub fn opentu_connector_status(
    window: tauri::Webview,
    connect_local: Option<bool>,
) -> Result<ConnectorStatus, String> {
    if window.label() != "main" {
        return Err("仅主窗口可管理连接器。".into());
    }
    status(&connector_paths(connect_local.unwrap_or(false))?)
}

fn install_at(
    paths: &ConnectorPaths,
    executable: &std::path::Path,
    discovery: &opentu_connector::Discovery,
) -> Result<(), String> {
    let marker = paths.runtime.with_file_name("enabled");
    let already_enabled = marker.is_file();
    opentu_connector::publish(&paths.runtime, discovery)?;
    std::fs::write(&marker, b"1").map_err(|_| "无法保存连接器启用状态。")?;
    if let Err(error) =
        opentu_connector::configure(&paths.config, &paths.runtime, executable, false)
    {
        if !already_enabled {
            let _ = std::fs::remove_file(&marker);
            let _ = std::fs::remove_file(&paths.runtime);
        }
        return Err(error.into());
    }
    Ok(())
}

#[tauri::command]
pub fn opentu_connector_install(
    window: tauri::Webview,
    connect_local: Option<bool>,
    expected_config_path: Option<String>,
) -> Result<ConnectorStatus, String> {
    if window.label() != "main" {
        return Err("仅主窗口可管理连接器。".into());
    }
    let _guard = CONFIG_MUTATION.lock().map_err(|_| "连接器配置暂不可用。")?;
    let paths = connector_paths(connect_local.unwrap_or(false))?;
    check_target(&paths, expected_config_path.as_deref())?;
    let (endpoint, token) = crate::opentu_mcp::connector_pairing()?;
    install_at(
        &paths,
        &executable_path()?,
        &opentu_connector::Discovery { endpoint, token },
    )?;
    status(&paths)
}
fn remove_at(paths: &ConnectorPaths, executable: &std::path::Path) -> Result<(), String> {
    opentu_connector::configure(&paths.config, &paths.runtime, executable, true)?;
    for path in [
        paths.runtime.with_file_name("enabled"),
        paths.runtime.clone(),
    ] {
        match std::fs::remove_file(path) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err("配置已解除，但连接器运行记录未清除，请重试。".into()),
        }
    }
    Ok(())
}

#[tauri::command]
pub fn opentu_connector_remove(
    window: tauri::Webview,
    connect_local: Option<bool>,
    expected_config_path: Option<String>,
) -> Result<ConnectorStatus, String> {
    if window.label() != "main" {
        return Err("仅主窗口可管理连接器。".into());
    }
    let _guard = CONFIG_MUTATION.lock().map_err(|_| "连接器配置暂不可用。")?;
    let paths = connector_paths(connect_local.unwrap_or(false))?;
    check_target(&paths, expected_config_path.as_deref())?;
    remove_at(&paths, &executable_path()?)?;
    status(&paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_connection_is_explicit_and_synthetic_launches_stay_isolated() {
        let dir = tempfile::tempdir().unwrap();
        let profile = dir.path().join("preview");
        let live = dir.path().join("user");
        let custom = dir.path().join("custom");
        let resolve = |explicit, test_home| {
            select_config_path(
                true,
                explicit,
                test_home,
                profile.clone(),
                Some(live.clone()),
                None,
                None,
            )
            .unwrap()
        };
        assert_eq!(
            resolve(false, None),
            (profile.join(".codex/config.toml"), "isolated")
        );
        assert_eq!(
            resolve(true, None),
            (live.join(".codex/config.toml"), "local")
        );
        assert_eq!(
            resolve(true, Some(custom.clone())),
            (custom.join(".codex/config.toml"), "isolated")
        );
        assert_eq!(
            select_config_path(
                true,
                true,
                None,
                profile.clone(),
                Some(live.clone()),
                Some(custom.clone()),
                Some(dir.path().join("env"))
            )
            .unwrap()
            .0,
            custom.join("config.toml")
        );
        assert!(select_config_path(
            true,
            true,
            None,
            profile,
            Some(live),
            None,
            Some(PathBuf::from("relative"))
        )
        .is_err());
    }

    #[test]
    fn changed_target_is_rejected_before_writing() {
        let dir = tempfile::tempdir().unwrap();
        let paths = ConnectorPaths {
            config: dir.path().join("config.toml"),
            runtime: dir.path().join("runtime.json"),
            scope: "local",
        };
        assert!(check_target(&paths, Some("/synthetic/stale/config.toml")).is_err());
        assert!(check_target(&paths, paths.config.to_str()).is_ok());
        assert!(!paths.config.exists());
    }

    #[test]
    fn install_remove_preserves_other_settings_and_isolated_connection() {
        let dir = tempfile::tempdir().unwrap();
        let live = ConnectorPaths {
            config: dir.path().join("live/config.toml"),
            runtime: dir.path().join("local/runtime.json"),
            scope: "local",
        };
        let isolated = ConnectorPaths {
            config: dir.path().join("preview/config.toml"),
            runtime: dir.path().join("preview-runtime/runtime.json"),
            scope: "isolated",
        };
        let exe = std::env::current_exe().unwrap();
        let discovery = opentu_connector::Discovery {
            endpoint: "http://127.0.0.1:12345/mcp".into(),
            token: "a".repeat(64),
        };
        std::fs::create_dir_all(live.config.parent().unwrap()).unwrap();
        let original =
            "# SYNTHETIC settings\nmodel = 'existing'\n[mcp_servers.other]\ncommand = 'keep-me'\n";
        std::fs::write(&live.config, original).unwrap();
        install_at(&isolated, &exe, &discovery).unwrap();
        install_at(&live, &exe, &discovery).unwrap();
        assert!(status(&live).unwrap().configured);
        let first = std::fs::read(&live.config).unwrap();
        install_at(&live, &exe, &discovery).unwrap();
        assert_eq!(std::fs::read(&live.config).unwrap(), first);
        remove_at(&live, &exe).unwrap();
        assert_eq!(std::fs::read_to_string(&live.config).unwrap(), original);
        assert!(!live.runtime.exists());
        assert!(!live.runtime.with_file_name("enabled").exists());
        assert!(isolated.runtime.exists());
        assert!(status(&isolated).unwrap().configured);
    }

    #[test]
    fn collision_preserves_user_config_and_does_not_enable_new_runtime() {
        let dir = tempfile::tempdir().unwrap();
        let paths = ConnectorPaths {
            config: dir.path().join("config.toml"),
            runtime: dir.path().join("runtime/runtime.json"),
            scope: "local",
        };
        let original = "[mcp_servers.tuzi-opentu]\ncommand = 'user-owned'\n";
        std::fs::write(&paths.config, original).unwrap();
        let discovery = opentu_connector::Discovery {
            endpoint: "http://127.0.0.1:12345/mcp".into(),
            token: "a".repeat(64),
        };
        assert!(install_at(&paths, &std::env::current_exe().unwrap(), &discovery).is_err());
        assert_eq!(std::fs::read_to_string(&paths.config).unwrap(), original);
        assert!(!paths.runtime.exists());
        assert!(!paths.runtime.with_file_name("enabled").exists());
        assert!(remove_at(&paths, &std::env::current_exe().unwrap()).is_err());
        assert_eq!(std::fs::read_to_string(&paths.config).unwrap(), original);
    }
}
