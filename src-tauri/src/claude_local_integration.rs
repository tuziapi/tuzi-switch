//! P0 only: isolated ClaudeMom core, existing Tuzi gateway, fixed in-memory binding.
//! No automatic launch, certificate trust, import, resume, or supplier mutation.
use crate::store::AppState;
use claude_local::{ClaudeLocalSettings, Host, Upstream};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    path::PathBuf,
    sync::{Arc, OnceLock, RwLock},
};

static SHUTTING_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static HOST: OnceLock<Arc<TuziHost>> = OnceLock::new();
#[path = "claude_local_copy.rs"]
mod desktop_copy;
const TESTED_VERSION: &str = desktop_copy::COPY_VERSION;

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct LocalOptions {
    voice_input: bool,
    computer_use: bool,
    cowork: bool,
}
fn read_options(root: &std::path::Path) -> anyhow::Result<LocalOptions> {
    let path = root.join("options.json");
    anyhow::ensure!(
        !fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()),
        "实验选项不能是符号链接"
    );
    match fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LocalOptions::default()),
        Err(e) => Err(e.into()),
    }
}

struct TuziHost {
    root: PathBuf,
    upstream: RwLock<Option<Upstream>>,
    _lock: File,
}
fn root_dir() -> PathBuf {
    // A settings-directory edit must not hide the running session's recovery marker.
    HOST.get()
        .map(|host| host.root.clone())
        .unwrap_or_else(|| crate::config::get_app_config_dir().join("claude-local-p0"))
}
fn manifest() -> PathBuf {
    root_dir().join("session.json")
}

// This persisted marker is also checked before Host initialization after a crash.
pub(crate) fn ensure_idle() -> Result<(), String> {
    if OPERATION.try_lock().is_err() || manifest().exists() {
        return Err("Claude 兼容会话正在运行或等待恢复；请正常退出 Claude，并在 Claude 配置中停止兼容会话后再退出或更新兔子助手。".into());
    }
    Ok(())
}

pub(crate) fn begin_shutdown() -> Result<(), String> {
    let _guard = OPERATION
        .try_lock()
        .map_err(|_| "兼容服务操作正在进行，请稍后退出")?;
    if manifest().exists() {
        return Err("请先正常退出 Claude，并停止兼容会话后再退出或重启兔子助手".into());
    }
    SHUTTING_DOWN.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

fn host() -> Result<Arc<TuziHost>, String> {
    if let Some(host) = HOST.get() {
        return Ok(host.clone());
    }
    let root = root_dir();
    for path in [
        &root,
        &root.join("claude-local"),
        &root.join("desktop-profile"),
        &root.join("desktop-profile-3p"),
    ] {
        if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("隔离目录不能是符号链接".into());
        }
    }
    claude_local::private_dir(&root).map_err(|e| e.to_string())?;
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("owner.lock"))
        .map_err(|e| e.to_string())?;
    fs2::FileExt::try_lock_exclusive(&lock).map_err(|_| "另一个兔子实例已占用兼容目录")?;
    let host = Arc::new(TuziHost {
        root,
        upstream: RwLock::new(None),
        _lock: lock,
    });
    if !claude_local::install_host(host.clone()) {
        return Err("兼容核心宿主已被占用".into());
    }
    HOST.set(host.clone()).map_err(|_| "兼容宿主初始化冲突")?;
    Ok(host)
}

fn safe_config() -> ClaudeLocalSettings {
    ClaudeLocalSettings {
        enabled: true,
        localization: true,
        voice_input: false,
        computer_use: false,
        background_mode: false,
        force_background_mode: false,
        cowork: false,
        session_sync: false,
        import_cli_sessions: false,
        code_share_home: Some(false),
        plan: "free".into(),
        display_name: "Tuzi Local".into(),
        ..Default::default()
    }
}
impl Host for TuziHost {
    fn state_dir(&self) -> PathBuf {
        self.root.clone()
    }
    fn ca_name(&self) -> &str {
        "Tuzi Claude Local P0 CA"
    }
    fn isolated_profile_dir(&self) -> Option<PathBuf> {
        Some(self.root.join("desktop-profile"))
    }
    fn isolated_app_path(&self) -> Option<PathBuf> {
        Some(desktop_copy::app_path(&self.root))
    }
    fn node_runtime(&self) -> Option<PathBuf> {
        // Always Some: do not fall back to borrowing Node from Codex/ChatGPT.
        Some(
            ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
                .iter()
                .map(PathBuf::from)
                .find(|p| p.is_file())
                .unwrap_or_else(|| PathBuf::from("node")),
        )
    }
    fn load_config(&self) -> anyhow::Result<ClaudeLocalSettings> {
        let options = read_options(&self.root)?;
        Ok(ClaudeLocalSettings {
            voice_input: options.voice_input,
            computer_use: options.computer_use,
            cowork: options.cowork,
            ..safe_config()
        })
    }
    fn save_config(&self, _: &ClaudeLocalSettings) -> anyhow::Result<()> {
        anyhow::bail!("请通过兔子助手的兼容选项修改配置")
    }
    fn preview_upstream(&self, _: &ClaudeLocalSettings) -> anyhow::Result<Upstream> {
        self.upstream
            .read()
            .map_err(|_| anyhow::anyhow!("host lock failed"))?
            .clone()
            .ok_or_else(|| anyhow::anyhow!("启动后绑定所选供应商"))
    }
    fn prepare_upstream(&self, c: &ClaudeLocalSettings) -> anyhow::Result<Upstream> {
        self.preview_upstream(c)
    }
    fn dictation_ready(&self, config: &ClaudeLocalSettings) -> bool {
        config.voice_input && claude_local::dictation::model_ready()
    }
    fn prepare_dictation_service(&self) -> anyhow::Result<()> {
        let root = self.root.clone();
        claude_local::dictation::server::ensure_running(
            &self.root,
            Arc::new(move || {
                use claude_local::dictation::EngineError;
                let options =
                    read_options(&root).map_err(|_| EngineError::new(500, "无法读取语音选项"))?;
                if !options.voice_input || !root.join("session.json").is_file() {
                    return Err(EngineError::new(403, "语音会话未启用"));
                }
                if !claude_local::dictation::model_ready() {
                    return Err(EngineError::new(503, "语音模型未就绪"));
                }
                Ok(())
            }),
        )
        .map(|_| ())
    }
}

pub(crate) fn upstream(
    provider: &crate::provider::Provider,
    port: u16,
    token: String,
) -> Result<Upstream, String> {
    let routes =
        crate::claude_desktop_config::proxy_model_routes(provider).map_err(|e| e.to_string())?;
    let models: Vec<_> = routes.iter().map(|r| r.route_id.clone()).collect();
    let default_model = models
        .iter()
        .find(|m| m.as_str() == "claude-local-default")
        .unwrap_or(&models[0])
        .clone();
    let small_model = models
        .iter()
        .find(|m| m.contains("haiku"))
        .unwrap_or(&default_model)
        .clone();
    let model_windows = routes
        .iter()
        .filter(|r| r.supports_1m)
        .map(|r| (r.route_id.clone(), 1_000_000))
        .collect();
    let model_names = routes
        .iter()
        .map(|r| {
            (
                r.route_id.clone(),
                serde_json::json!({"name": r.display_name.as_deref().unwrap_or(&r.route_id)}),
            )
        })
        .collect();
    Ok(Upstream {
        root: format!("http://127.0.0.1:{port}/claude-desktop-local"),
        token,
        default_model,
        small_model,
        models,
        model_windows,
        model_names,
        // Unknown upstream limits are not declared. The core retains its 200k protocol
        // fallback, so long-context compatibility is a separate acceptance requirement.
        default_window: None,
        ..Default::default()
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStatus {
    enabled: bool,
    recovery_required: bool,
    bound_provider: Option<String>,
    profile_dir: Option<String>,
    core: Option<claude_local::ClaudeLocalStatus>,
    options: LocalOptions,
    voice_model_ready: bool,
    voice_download: serde_json::Value,
}

#[tauri::command]
pub async fn get_claude_local_status() -> Result<LocalStatus, String> {
    // Read-only polling must not occupy the mutation lock or fail a user click.
    // Serialize first-time initialization, then poll the thread-safe core directly.
    let host = match HOST.get() {
        Some(host) => host.clone(),
        None => {
            let _guard = OPERATION.lock().await;
            host()?
        }
    };
    tauri::async_runtime::spawn_blocking(move || read_status(&host))
        .await
        .map_err(|e| e.to_string())?
}
fn read_status(host: &TuziHost) -> Result<LocalStatus, String> {
    let marker: Option<serde_json::Value> = fs::read(manifest())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok());
    let core = claude_local::status().map_err(|e| e.to_string())?;
    Ok(LocalStatus {
        enabled: true,
        recovery_required: manifest().exists() && !core.running,
        bound_provider: marker
            .as_ref()
            .and_then(|m| m["providerName"].as_str())
            .map(str::to_string),
        profile_dir: Some(
            host.root
                .join("desktop-profile")
                .to_string_lossy()
                .into_owned(),
        ),
        core: Some(core),
        options: read_options(&host.root).map_err(|e| e.to_string())?,
        voice_model_ready: claude_local::dictation::model_ready(),
        voice_download: claude_local::dictation::model_status(),
    })
}

#[tauri::command]
pub async fn claude_local_action(
    state: tauri::State<'_, AppState>,
    action: String,
    provider_id: Option<String>,
) -> Result<LocalStatus, String> {
    let _guard = OPERATION.try_lock().map_err(|_| "兼容服务操作正在进行")?;
    if SHUTTING_DOWN.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("兔子助手正在退出或重启".into());
    }
    if ![
        "prepare",
        "trust",
        "untrust",
        "launch",
        "stop",
        "prepare_voice",
        "enable_voice",
        "disable_voice",
        "enable_computer",
        "disable_computer",
        "enable_cowork",
        "disable_cowork",
    ]
    .contains(&action.as_str())
    {
        return Err("未知操作".into());
    }
    let host = host()?;
    if action != "stop" && manifest().exists() {
        return Err("请先正常退出 Claude 并停止现有兼容会话".into());
    }
    if action == "prepare_voice" {
        claude_local::dictation::prepare_model()
            .await
            .map_err(|e| e.to_string())?;
        return read_status(&host);
    }
    if action.starts_with("enable_") || action.starts_with("disable_") {
        let enabled = action.starts_with("enable_");
        let mut options = read_options(&host.root).map_err(|e| e.to_string())?;
        match action.split_once('_').map(|(_, feature)| feature) {
            Some("voice") => {
                if enabled && !claude_local::dictation::model_ready() {
                    return Err("请先下载本地语音模型".into());
                }
                options.voice_input = enabled;
            }
            Some("computer") => options.computer_use = enabled,
            Some("cowork") => options.cowork = enabled,
            _ => return Err("未知实验功能".into()),
        }
        claude_local::fsutil::atomic_write(
            &host.root.join("options.json"),
            &serde_json::to_vec_pretty(&options).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        return read_status(&host);
    }
    if matches!(action.as_str(), "prepare" | "launch") {
        let root = host.root.clone();
        tauri::async_runtime::spawn_blocking(move || desktop_copy::prepare(&root))
            .await
            .map_err(|e| e.to_string())??;
    }
    if action == "launch" {
        if !cfg!(target_os = "macos") {
            return Err("P0 暂仅验证 macOS".into());
        }
        let status = tauri::async_runtime::spawn_blocking(claude_local::status)
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        if status.version != TESTED_VERSION {
            return Err(format!(
                "P0 仅允许 Claude {TESTED_VERSION}；当前 {} 需重新验证",
                status.version
            ));
        }
        if status.claude_running || !status.ca_trusted || !status.node_available {
            return Err("请先退出 Claude，准备并信任证书，且安装支持 WebSocket 的 Node.js".into());
        }
        let id = provider_id.ok_or("请选择 Claude Desktop 供应商")?;
        let provider = state
            .db
            .get_provider_by_id(&id, "claude-desktop")
            .map_err(|e| e.to_string())?
            .ok_or("供应商不存在")?;
        let provider = crate::proxy::local_session::snapshot(provider)?;
        // Persist intent before opening a session; credentials are deliberately absent.
        let marker = serde_json::json!({"schemaVersion":1,"phase":"starting","providerId":provider.id,"providerName":provider.name,"claudeVersion":status.version});
        crate::config::write_json_file(&manifest(), &marker).map_err(|e| e.to_string())?;
        let result = async {
            let (info, token) = state.proxy_service.bind_local(provider.clone()).await?;
            *host.upstream.write().map_err(|_| "host lock failed")? =
                Some(upstream(&provider, info.port, token)?);
            tauri::async_runtime::spawn_blocking(|| claude_local::perform("launch"))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
            Ok::<_, String>(())
        }
        .await;
        if let Err(error) = result {
            // Keep the marker: even an uncertain launch must go through explicit recovery.
            claude_local::stop_backend();
            claude_local::dictation::server::stop();
            state.proxy_service.release_local().await;
            *host.upstream.write().map_err(|_| "host lock failed")? = None;
            return Err(error);
        }
        let mut marker = marker;
        marker["phase"] = "running".into();
        crate::config::write_json_file(&manifest(), &marker).map_err(|e| e.to_string())?;
    } else {
        let op = action.clone();
        tauri::async_runtime::spawn_blocking(move || claude_local::perform(&op))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?;
        if action == "stop" {
            claude_local::dictation::server::stop();
            state.proxy_service.release_local().await;
            *host.upstream.write().map_err(|_| "host lock failed")? = None;
            match fs::remove_file(manifest()) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    tauri::async_runtime::spawn_blocking(move || read_status(&host))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_p0_config_has_no_shared_profile_or_advanced_capabilities() {
        let config = safe_config();
        assert!(config.enabled && config.localization);
        assert_eq!(config.code_share_home, Some(false));
        assert!(!config.voice_input && !config.computer_use && !config.cowork);
        assert!(!config.background_mode && !config.force_background_mode);
        assert!(!config.session_sync && !config.import_cli_sessions);
        assert_eq!(config.normalized_plan(), "free");
    }

    #[test]
    fn local_options_default_and_legacy_fields_stay_disabled() {
        let dir = tempfile::tempdir().unwrap();
        let options = read_options(dir.path()).unwrap();
        assert!(!options.voice_input && !options.computer_use && !options.cowork);
        fs::write(dir.path().join("options.json"), br#"{"cowork":true}"#).unwrap();
        let options = read_options(dir.path()).unwrap();
        assert!(options.cowork && !options.voice_input && !options.computer_use);
        let round_trip: LocalOptions =
            serde_json::from_slice(&serde_json::to_vec(&options).unwrap()).unwrap();
        assert!(round_trip.cowork);
        fs::write(dir.path().join("options.json"), b"broken").unwrap();
        assert!(read_options(dir.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn local_options_reject_symlink() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("other.json"), b"{}").unwrap();
        std::os::unix::fs::symlink(
            dir.path().join("other.json"),
            dir.path().join("options.json"),
        )
        .unwrap();
        assert!(read_options(dir.path()).is_err());
    }
}
