//! Isolated ClaudeMom core, existing Tuzi gateway, fixed in-memory binding.
//! No automatic launch, certificate trust, import, resume, or supplier mutation.
use crate::store::AppState;
use claude_local::{ClaudeLocalSettings, Host, Upstream};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use std::{
    fs::{self, File, OpenOptions},
    path::PathBuf,
    sync::{Arc, OnceLock, RwLock},
};

static SHUTTING_DOWN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static UPDATE_RESERVED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static OPERATION: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static HOST: OnceLock<Arc<TuziHost>> = OnceLock::new();
#[path = "claude_local_copy.rs"]
mod desktop_copy;
const TESTED_VERSION: &str = desktop_copy::COPY_VERSION;
const LOCAL_DIR: &str = if cfg!(feature = "claude-local-poc") {
    "claude-local-p0"
} else {
    "claude-desktop-local"
};

// Missing fields in existing files retain the legacy disabled state.
#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct LocalOptions {
    voice_input: bool,
    computer_use: bool,
    cowork: bool,
}
impl LocalOptions {
    fn first_use(platform: &'static str) -> Self {
        let capabilities = capabilities_for(platform);
        Self {
            voice_input: capabilities.voice_input,
            computer_use: capabilities.computer_use,
            cowork: capabilities.cowork,
        }
    }

    fn runtime_config(&self, platform: &'static str, voice_model_ready: bool) -> ClaudeLocalSettings {
        let capabilities = capabilities_for(platform);
        ClaudeLocalSettings {
            // A selected preference is not proof that its local assets are ready.
            voice_input: self.voice_input && capabilities.voice_input && voice_model_ready,
            computer_use: self.computer_use && capabilities.computer_use,
            cowork: self.cowork && capabilities.cowork,
            ..safe_config()
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalCapabilities {
    platform: &'static str,
    voice_input: bool,
    computer_use: bool,
    cowork: bool,
}
fn capabilities_for(platform: &'static str) -> LocalCapabilities {
    LocalCapabilities {
        platform,
        voice_input: matches!(platform, "macos" | "windows"),
        computer_use: matches!(platform, "macos" | "windows"),
        cowork: matches!(platform, "macos" | "windows" | "linux"),
    }
}
fn read_options(root: &std::path::Path) -> anyhow::Result<LocalOptions> {
    let path = root.join("options.json");
    anyhow::ensure!(
        !fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()),
        "实验选项不能是符号链接"
    );
    match fs::read(path) {
        Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LocalOptions::first_use(std::env::consts::OS)),
        Err(e) => Err(e.into()),
    }
}

struct TuziHost {
    root: PathBuf,
    upstream: RwLock<Option<Upstream>>,
    desktop_app: RwLock<Option<PathBuf>>,
    _lock: File,
}
fn root_dir() -> PathBuf {
    // A settings-directory edit must not hide the running session's recovery marker.
    HOST.get()
        .map(|host| host.root.clone())
        .unwrap_or_else(|| crate::config::get_app_config_dir().join(LOCAL_DIR))
}
fn manifest() -> PathBuf {
    root_dir().join("session.json")
}

fn bundled_node_path(executable: &std::path::Path) -> Option<PathBuf> {
    bundled_node_path_for(executable, std::env::consts::OS, cfg!(debug_assertions))
}

fn bundled_node_path_for(executable: &std::path::Path, platform: &str, development: bool) -> Option<PathBuf> {
    let parent = executable.parent()?;
    if platform == "macos" {
        return parent.ends_with("Contents/MacOS").then(|| parent.join("tuzi-claude-node"));
    }
    // Windows installers and Linux deb/AppImage place sidecars beside the host.
    // A Cargo debug executable can use development Node; installed debug bundles
    // still require the sidecar, even if it is missing or damaged.
    if development && parent.ends_with("target/debug") {
        return None;
    }
    match platform {
        "windows" => Some(parent.join("tuzi-claude-node.exe")),
        "linux" => Some(parent.join(if cfg!(feature = "opentu-preview") {
            "tuzi-opentu-preview-node"
        } else {
            "tuzi-claude-node"
        })),
        _ => None,
    }
}

// This persisted marker is also checked before Host initialization after a crash.
pub(crate) fn ensure_idle() -> Result<(), String> {
    if OPERATION.try_lock().is_err() || manifest().exists() {
        return Err("Claude 兼容会话正在运行或等待恢复；请正常退出 Claude，并在 Claude 配置中停止兼容会话后再退出或更新兔子助手。".into());
    }
    Ok(())
}

// Reserve under the same lock as launch. A read-only idle check alone permits
// a new Claude session to start between that check and updater installation.
pub(crate) fn begin_update() -> Result<(), String> {
    let _guard = OPERATION.try_lock().map_err(|_| "兼容服务操作正在进行")?;
    reserve_update(&manifest(), &SHUTTING_DOWN, &UPDATE_RESERVED)
}

fn reserve_update(
    marker: &std::path::Path,
    shutting_down: &std::sync::atomic::AtomicBool,
    reserved: &std::sync::atomic::AtomicBool,
) -> Result<(), String> {
    if marker.exists() || shutting_down.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("请先退出 Claude 并停止兼容会话，再安装更新".into());
    }
    reserved.compare_exchange(
        false, true,
        std::sync::atomic::Ordering::SeqCst,
        std::sync::atomic::Ordering::SeqCst,
    ).map_err(|_| "更新安装正在进行")?;
    Ok(())
}

pub(crate) fn release_update() {
    UPDATE_RESERVED.store(false, std::sync::atomic::Ordering::SeqCst);
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
        desktop_app: RwLock::new(if cfg!(target_os = "macos") { Some(desktop_copy::app_path(&root)) } else { None }),
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
        if cfg!(feature = "claude-local-poc") {
            "Tuzi Claude Local P0 CA"
        } else {
            "Tuzi Claude Local CA"
        }
    }
    fn isolated_profile_dir(&self) -> Option<PathBuf> {
        Some(self.root.join("desktop-profile"))
    }
    fn isolated_app_path(&self) -> Option<PathBuf> {
        self.desktop_app.read().ok().and_then(|path| path.clone())
    }
    fn node_runtime(&self) -> Option<PathBuf> {
        if let Some(path) = std::env::current_exe().ok().and_then(|path| bundled_node_path(&path)) {
            // A packaged app must use its own pinned runtime. If missing, the
            // core's readiness probe fails instead of borrowing a user's Node.
            return Some(path);
        }
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
        Ok(options.runtime_config(std::env::consts::OS, claude_local::dictation::model_ready()))
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
    let selected = provider.settings_config.pointer("/env/ANTHROPIC_MODEL").and_then(|value| value.as_str());
    let normalize = |model: &str| {
        let model = model.trim();
        if model.to_ascii_lowercase().ends_with("[1m]") { model[..model.len()-4].trim_end().to_owned() } else { model.to_owned() }
    };
    let default_model = routes.iter()
        .find(|route| selected.is_some_and(|model| normalize(model) == normalize(&route.upstream_model) || normalize(model) == normalize(&route.route_id)))
        .map(|route| route.route_id.clone())
        .or_else(|| models.iter().find(|model| model.as_str() == "claude-local-default").cloned())
        .unwrap_or_else(|| models[0].clone());
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
    desktop_running: Option<bool>,
    recovery_required: bool,
    bound_provider: Option<String>,
    profile_dir: Option<String>,
    core: Option<claude_local::ClaudeLocalStatus>,
    options: LocalOptions,
    capabilities: LocalCapabilities,
    voice_model_ready: bool,
    voice_download: serde_json::Value,
}

fn gateway_status() -> LocalStatus {
    LocalStatus {
        enabled: true,
        desktop_running: None,
        recovery_required: manifest().exists(),
        bound_provider: None,
        profile_dir: None,
        core: None,
        options: LocalOptions::default(),
        capabilities: LocalCapabilities {
            platform: std::env::consts::OS,
            voice_input: false,
            computer_use: false,
            cowork: false,
        },
        voice_model_ready: false,
        voice_download: serde_json::Value::Null,
    }
}

#[derive(Debug, PartialEq)]
enum GatewayAction {
    CheckInstallation,
    PrepareConnection,
    Launch,
    Cleanup,
}

fn gateway_action(action: &str, recovery_required: bool) -> Result<GatewayAction, String> {
    match action {
        "prepare" => Ok(GatewayAction::CheckInstallation),
        "prepare_connection" if !recovery_required => Ok(GatewayAction::PrepareConnection),
        "launch" if !recovery_required => Ok(GatewayAction::Launch),
        "stop" if recovery_required => Ok(GatewayAction::Cleanup),
        "untrust" if !recovery_required => Ok(GatewayAction::Cleanup),
        "untrust" => Err("请先停止旧版兼容会话".into()),
        _ => Err("请启用 Claude Desktop 网关线路，然后重新打开 Claude。".into()),
    }
}

#[tauri::command]
pub async fn get_claude_local_status() -> Result<LocalStatus, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut status = gateway_status();
        status.desktop_running = claude_local::desktop_running().ok();
        status
    }).await.map_err(|error| error.to_string())
}

fn gateway_provider(state: &AppState, provider_id: &str) -> Result<crate::provider::Provider, String> {
    let current = crate::services::ProviderService::current(state, crate::app_config::AppType::ClaudeDesktop)
        .map_err(|error| error.to_string())?;
    if current != provider_id {
        return Err("所选线路已变化，请重新选择后再继续".into());
    }
    let provider = state.db.get_provider_by_id(provider_id, "claude-desktop")
        .map_err(|error| error.to_string())?.ok_or("所选线路不存在")?;
    crate::claude_desktop_config::validate_provider(&provider).map_err(|error| error.to_string())?;
    Ok(provider)
}

fn needs_gateway_route(provider: &crate::provider::Provider) -> bool {
    !crate::claude_desktop_config::is_official_provider(provider)
        && matches!(crate::claude_desktop_config::provider_mode(provider), crate::provider::ClaudeDesktopMode::Proxy)
}

fn configure_gateway_process(command: &mut std::process::Command, profile_dir: Option<&std::path::Path>) {
    for name in ["NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"] {
        command.env_remove(name);
    }
    if let Some(profile_dir) = profile_dir {
        configure_gateway_profile(command, profile_dir, std::env::consts::OS);
    }
}

fn configure_gateway_profile(command: &mut std::process::Command, profile_dir: &std::path::Path, platform: &str) {
    let mut argument = std::ffi::OsString::from("--user-data-dir=");
    argument.push(profile_dir);
    command.arg(argument);
    if let Some(config_root) = profile_dir.parent() {
        if platform == "windows" {
            command.env("LOCALAPPDATA", config_root);
            if let Some(app_data) = config_root.parent() {
                command.env("APPDATA", app_data.join("Roaming"));
            }
        } else if platform == "linux" {
            command.env("XDG_CONFIG_HOME", config_root);
        }
    }
}

async fn prepare_gateway_connection(app: tauri::AppHandle, provider_id: String, launch: bool) -> Result<(), String> {
    let preflight_app = app.clone();
    let selected = provider_id.clone();
    let needs_route = tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let state = preflight_app.state::<AppState>();
        let _guard = crate::services::provider::OperationGuard::acquire().map_err(|error| error.to_string())?;
        let provider = gateway_provider(&state, &selected)?;
        if claude_local::desktop_running().map_err(|error| error.to_string())? {
            return Err("请先完全退出 Claude，再继续配置或启动".into());
        }
        if claude_local::desktop::official_installation_present().map_err(|error| error.to_string())? != Some(true) {
            return Err("请先安装 Claude Desktop，再重新检测".into());
        }
        Ok(needs_gateway_route(&provider))
    }).await.map_err(|error| error.to_string())??;
    let state = app.state::<AppState>();
    if needs_route {
        state.proxy_service.start().await?;
    }
    let route_running = state.proxy_service.is_running().await;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let state = app.state::<AppState>();
        let _guard = crate::services::provider::OperationGuard::acquire().map_err(|error| error.to_string())?;
        let provider = gateway_provider(&state, &provider_id)?;
        if needs_gateway_route(&provider) && !route_running {
            return Err("本地路由尚未就绪，请重新检查线路".into());
        }
        if claude_local::desktop_running().map_err(|error| error.to_string())? {
            return Err("请先完全退出 Claude，再继续配置或启动".into());
        }
        let source = claude_local::desktop::source_app(std::time::Instant::now() + std::time::Duration::from_secs(15))
            .map_err(|error| error.to_string())?;
        crate::claude_desktop_config::apply_provider(state.db.as_ref(), &provider).map_err(|error| error.to_string())?;
        if launch {
            let profile_dir = crate::claude_desktop_config::gateway_launch_profile_dir().map_err(|error| error.to_string())?;
            claude_local::launch_claude(&source, |command| configure_gateway_process(command, profile_dir.as_deref())).map_err(|error| error.to_string())?;
        }
        Ok(())
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn claude_local_action(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    action: String,
    provider_id: Option<String>,
) -> Result<LocalStatus, String> {
    let _guard = OPERATION.try_lock().map_err(|_| "兼容服务操作正在进行")?;
    if SHUTTING_DOWN.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("兔子助手正在退出或重启".into());
    }
    if UPDATE_RESERVED.load(std::sync::atomic::Ordering::SeqCst) {
        return Err("兔子助手正在安装更新，请完成后再操作 Claude 配置".into());
    }
    match gateway_action(&action, manifest().exists())? {
        GatewayAction::CheckInstallation => {
            return match crate::commands::detect_official_claude_installation().await? {
                Some(true) => Ok(gateway_status()),
                Some(false) => Err("请先安装 Claude Desktop，再重新检测".into()),
                None => Err("无法确认 Claude Desktop 安装状态".into()),
            };
        }
        GatewayAction::Cleanup => {}
        GatewayAction::PrepareConnection | GatewayAction::Launch => {
            prepare_gateway_connection(app_handle, provider_id.ok_or("请先选择线路")?, action == "launch").await?;
            return get_claude_local_status().await;
        }
    }
    let host = host()?;
    let stop = action == "stop";
    tauri::async_runtime::spawn_blocking(move || claude_local::perform(&action))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    if stop {
        claude_local::dictation::server::stop();
        state.proxy_service.release_local().await;
        *host.upstream.write().map_err(|_| "host lock failed")? = None;
        match fs::remove_file(manifest()) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(gateway_status())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_gateway_launch_drops_legacy_credentials_and_certificate_overrides() {
        let mut command = std::process::Command::new("synthetic-claude");
        for name in ["NODE_EXTRA_CA_CERTS", "NODE_TLS_REJECT_UNAUTHORIZED", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"] {
            command.env(name, "synthetic-legacy-value");
        }
        configure_gateway_process(&mut command, None);
        assert!(command.get_args().next().is_none());
        assert!(command.get_envs().all(|(_, value)| value.is_none()));
        assert_eq!(command.get_envs().count(), 5);
    }

    #[test]
    fn local_gateway_launch_passes_isolated_profile_as_one_argument() {
        let temp = tempfile::tempdir().unwrap();
        let profile = temp.path().join("Synthetic 验收/Claude");
        let mut command = std::process::Command::new("synthetic-claude");
        configure_gateway_process(&mut command, Some(&profile));
        let mut expected = std::ffi::OsString::from("--user-data-dir=");
        expected.push(&profile);
        assert_eq!(command.get_args().collect::<Vec<_>>(), vec![expected.as_os_str()]);
        assert!(command.get_envs().filter(|(name, _)| name.to_string_lossy().starts_with("NODE_") || name.to_string_lossy().starts_with("ANTHROPIC_")).all(|(_, value)| value.is_none()));
    }

    #[test]
    fn local_gateway_windows_and_linux_configuration_roots_are_isolated() {
        let temp = tempfile::tempdir().unwrap();
        let profile = temp.path().join("AppData/Local/Claude");
        let mut command = std::process::Command::new("synthetic-claude");
        configure_gateway_profile(&mut command, &profile, "windows");
        let environment = command.get_envs().map(|(name, value)| (name.to_string_lossy().into_owned(), value.map(std::path::PathBuf::from))).collect::<std::collections::HashMap<_, _>>();
        assert_eq!(environment["LOCALAPPDATA"], Some(temp.path().join("AppData/Local")));
        assert_eq!(environment["APPDATA"], Some(temp.path().join("AppData/Roaming")));
        let mut command = std::process::Command::new("synthetic-claude");
        let profile = temp.path().join(".config/Claude");
        configure_gateway_profile(&mut command, &profile, "linux");
        assert_eq!(command.get_envs().next(), Some((std::ffi::OsStr::new("XDG_CONFIG_HOME"), profile.parent().map(|path| path.as_os_str()))));
    }

    #[test]
    fn local_gateway_only_mapping_providers_require_a_router() {
        let mut provider = crate::provider::Provider::with_id("synthetic".into(), "Synthetic".into(), serde_json::json!({}), None);
        assert!(!needs_gateway_route(&provider));
        provider.meta = Some(serde_json::from_value(serde_json::json!({"claudeDesktopMode":"proxy"})).unwrap());
        assert!(needs_gateway_route(&provider));
        provider.id = crate::database::CLAUDE_DESKTOP_OFFICIAL_PROVIDER_ID.into();
        assert!(!needs_gateway_route(&provider));
    }

    #[test]
    fn local_gateway_actions_never_restore_certificate_setup() {
        use GatewayAction::{CheckInstallation, Cleanup, PrepareConnection, Launch};
        for recovering in [false, true] {
            assert_eq!(gateway_action("prepare", recovering), Ok(CheckInstallation));
            for action in ["trust", "prepare_voice", "enable_computer", "sync_sessions", "unknown"] {
                assert!(gateway_action(action, recovering).is_err());
            }
        }
        assert_eq!(gateway_action("stop", true), Ok(Cleanup));
        assert!(gateway_action("stop", false).is_err());
        assert_eq!(gateway_action("untrust", false), Ok(Cleanup));
        assert!(gateway_action("untrust", true).is_err());
        assert_eq!(gateway_action("prepare_connection", false), Ok(PrepareConnection));
        assert_eq!(gateway_action("launch", false), Ok(Launch));
        assert!(gateway_action("prepare_connection", true).is_err());
        assert!(gateway_action("launch", true).is_err());
    }
    #[test]
    fn local_catalog_default_model_is_used_in_runtime_including_context_suffix() {
        let mut provider = crate::provider::Provider::with_id("synthetic".into(), "Synthetic".into(), serde_json::json!({"env":{"ANTHROPIC_MODEL":"claude-z"}}), None);
        provider.meta = Some(serde_json::from_value(serde_json::json!({"claudeDesktopModelRoutes":{
            "claude-a":{"model":"claude-a"}, "claude-z":{"model":"claude-z","supports1m":true}
        }})).unwrap());
        let mapped = upstream(&provider, 1234, "synthetic-token".into()).unwrap();
        assert_eq!(mapped.default_model, "claude-z [1M]");
        let reloaded: crate::provider::Provider = serde_json::from_slice(&serde_json::to_vec(&provider).unwrap()).unwrap();
        assert_eq!(upstream(&reloaded, 1234, "synthetic-token".into()).unwrap().default_model, "claude-z [1M]");
    }

    #[test]
    fn local_update_reservation_rejects_active_recovery_and_duplicate_install() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("session.json");
        let shutdown = AtomicBool::new(false);
        let reserved = AtomicBool::new(false);
        // An incomplete/corrupt marker still means recovery is required.
        fs::write(&marker, b"incomplete").unwrap();
        assert!(reserve_update(&marker, &shutdown, &reserved).is_err());
        assert!(!reserved.load(Ordering::SeqCst));
        fs::remove_file(&marker).unwrap();
        assert!(reserve_update(&marker, &shutdown, &reserved).is_ok());
        assert!(reserve_update(&marker, &shutdown, &reserved).is_err());
        reserved.store(false, Ordering::SeqCst);
        assert!(reserve_update(&marker, &shutdown, &reserved).is_ok());
        reserved.store(false, Ordering::SeqCst);
        shutdown.store(true, Ordering::SeqCst);
        assert!(reserve_update(&marker, &shutdown, &reserved).is_err());
        assert!(!reserved.load(Ordering::SeqCst));
    }

    #[test]
    fn local_feature_keeps_experiment_and_normal_profile_paths_distinct() {
        if cfg!(feature = "claude-local-poc") {
            assert!(cfg!(feature = "isolated-profile"));
            assert_eq!(LOCAL_DIR, "claude-local-p0");
        } else {
            assert_eq!(LOCAL_DIR, "claude-desktop-local");
        }
    }

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
    fn local_options_first_use_selects_supported_features_and_preserves_saved_choices() {
        let dir = tempfile::tempdir().unwrap();
        let options = read_options(dir.path()).unwrap();
        let capabilities = capabilities_for(std::env::consts::OS);
        assert_eq!(options.voice_input, capabilities.voice_input);
        assert_eq!(options.computer_use, capabilities.computer_use);
        assert_eq!(options.cowork, capabilities.cowork);
        assert!(!dir.path().join("options.json").exists());
        fs::write(dir.path().join("options.json"), br#"{"voiceInput":false,"computerUse":false,"cowork":false}"#).unwrap();
        let options = read_options(dir.path()).unwrap();
        assert!(!options.voice_input && !options.computer_use && !options.cowork);
        fs::write(dir.path().join("options.json"), br#"{"cowork":true}"#).unwrap();
        let options = read_options(dir.path()).unwrap();
        assert!(options.cowork && !options.voice_input && !options.computer_use);
        let round_trip: LocalOptions =
            serde_json::from_slice(&serde_json::to_vec(&options).unwrap()).unwrap();
        assert!(round_trip.cowork && !round_trip.voice_input && !round_trip.computer_use);
        fs::write(dir.path().join("options.json"), b"broken").unwrap();
        assert!(read_options(dir.path()).is_err());
    }

    #[test]
    fn local_options_runtime_requires_assets_and_platform_support() {
        for platform in ["macos", "windows", "linux"] {
            let options = LocalOptions::first_use(platform);
            assert!(options.cowork);
            let waiting = options.runtime_config(platform, false);
            assert!(!waiting.voice_input);
            assert_eq!(waiting.computer_use, platform != "linux");
            assert!(waiting.cowork);
            let ready = options.runtime_config(platform, true);
            assert_eq!(ready.voice_input, platform != "linux");
            let disabled = LocalOptions::default().runtime_config(platform, true);
            assert!(!disabled.voice_input && !disabled.computer_use && !disabled.cowork);
        }
        // Legacy flags must not bypass the Linux capability gate.
        let legacy = LocalOptions::first_use("macos").runtime_config("linux", true);
        assert!(!legacy.voice_input && !legacy.computer_use && legacy.cowork);
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
    #[test]
    fn local_packaged_runtime_is_required_even_when_missing() {
        let dir = tempfile::tempdir().unwrap();
        for (platform, layout, sidecar) in [
            ("macos", "Tuzi.app/Contents/MacOS/tu-zi-switch", "tuzi-claude-node"),
            ("windows", "Tuzi/tu-zi-switch.exe", "tuzi-claude-node.exe"),
            ("linux", "AppDir/usr/bin/tu-zi-switch", if cfg!(feature = "opentu-preview") { "tuzi-opentu-preview-node" } else { "tuzi-claude-node" }),
        ] {
            let exe = dir.path().join(layout);
            for development in [false, true] {
                let node = bundled_node_path_for(&exe, platform, development).unwrap();
                assert_eq!(node, exe.parent().unwrap().join(sidecar));
                assert!(!node.exists());
            }
            assert!(bundled_node_path_for(&dir.path().join("target/debug/tu-zi-switch"), platform, true).is_none());
            if platform != "macos" {
                assert!(bundled_node_path_for(&dir.path().join("Installed/debug/tu-zi-switch"), platform, true).is_some());
            }
        }
    }
