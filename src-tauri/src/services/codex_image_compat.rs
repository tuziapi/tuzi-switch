use crate::{
    app_config::AppType, database::Database, error::AppError, services::codex_image_config,
    services::ProxyService, store::AppState,
};
use std::{fs, path::Path, sync::Mutex};

const SKILL_NAME: &str = "codex-image-render-fallback";
const SKILL_OWNER_FILE: &str = ".tuzi-switch-managed";
const SKILL_OWNER: &[u8] = b"tuzi-switch:codex-image-render-fallback:v1\n";
const TAKEOVER_OWNER_FILE: &str = "codex-image-compat-takeover-owner";
const TAKEOVER_OWNED: &str = "owned";
const TAKEOVER_ACTIVATING: &str = "activating";
const TAKEOVER_MANUAL_DISABLED: &str = "manual_disabled";
static FILES_RECONCILE_LOCK: Mutex<()> = Mutex::new(());
static RECONCILE_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct EmbeddedSkillFile {
    path: &'static str,
    content: &'static [u8],
}

const EMBEDDED_SKILL_FILES: &[EmbeddedSkillFile] = &[
    EmbeddedSkillFile {
        path: SKILL_OWNER_FILE,
        content: include_bytes!(
            "../../resources/builtin-skills/codex-image-render-fallback/.tuzi-switch-managed"
        ),
    },
    EmbeddedSkillFile {
        path: "SKILL.md",
        content: include_bytes!(
            "../../resources/builtin-skills/codex-image-render-fallback/SKILL.md"
        ),
    },
    EmbeddedSkillFile {
        path: "agents/openai.yaml",
        content: include_bytes!(
            "../../resources/builtin-skills/codex-image-render-fallback/agents/openai.yaml"
        ),
    },
    EmbeddedSkillFile {
        path: "scripts/extract_images.py",
        content: include_bytes!(
            "../../resources/builtin-skills/codex-image-render-fallback/scripts/extract_images.py"
        ),
    },
];

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct CodexImageCompatState {
    pub ready: bool,
    pub takeover_owned: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CodexImageCompatReadinessReason {
    Disabled,
    NoProvider,
    NativeRoute,
    UnsupportedProvider,
    ProviderConfigInvalid,
    MissingCredential,
    ManagedCredentialUnreadable,
    ManagedFilesMissing,
    LocalRouteInactive,
    Ready,
}

#[derive(Clone, Debug, Eq, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexImageCompatReadiness {
    pub requested: bool,
    pub ready: bool,
    pub reason: CodexImageCompatReadinessReason,
    pub provider_base_url: Option<String>,
    pub provider_env_key: Option<String>,
    pub live_base_url: Option<String>,
    pub image_key_env: &'static str,
    pub image_upstream: &'static str,
    pub image_model: &'static str,
    pub personalization_instruction: &'static str,
}

impl CodexImageCompatReadiness {
    fn new(requested: bool, reason: CodexImageCompatReadinessReason) -> Self {
        Self {
            requested,
            ready: false,
            reason,
            provider_base_url: None,
            provider_env_key: None,
            live_base_url: None,
            image_key_env: codex_image_config::IMAGE_API_KEY_ENV,
            image_upstream: crate::proxy::codex_images::IMAGE_UPSTREAM_BASE_URL,
            image_model: crate::proxy::codex_images::IMAGE_MODEL,
            personalization_instruction: codex_image_config::MANAGED_INSTRUCTION,
        }
    }
}

fn local_codex_base_url(address: &str, port: u16) -> Option<String> {
    if port == 0 {
        return None;
    }
    let address = address.trim();
    let unbracketed = address.trim_start_matches('[').trim_end_matches(']');
    let host = if unbracketed == "0.0.0.0" {
        "127.0.0.1".to_string()
    } else if unbracketed == "::" {
        "::1".to_string()
    } else if unbracketed.eq_ignore_ascii_case("localhost") {
        "localhost".to_string()
    } else {
        let parsed = unbracketed.parse::<std::net::IpAddr>().ok()?;
        if !parsed.is_loopback() {
            return None;
        }
        parsed.to_string()
    };
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host
    };
    Some(format!("http://{host}:{port}/v1"))
}

fn image_listener_supports_local_route(address: &str) -> bool {
    local_codex_base_url(address, 1).is_some()
}

/// Inspect readiness without reconciling files, credentials, or proxy state.
pub(crate) async fn readiness(state: &AppState) -> Result<CodexImageCompatReadiness, AppError> {
    let requested = crate::settings::codex_image_render_compat();
    if !requested {
        return Ok(CodexImageCompatReadiness::new(
            false,
            CodexImageCompatReadinessReason::Disabled,
        ));
    }

    let mut readiness =
        CodexImageCompatReadiness::new(true, CodexImageCompatReadinessReason::NoProvider);

    let Some(provider) = current_codex_provider_settings(state.db.as_ref())? else {
        return Ok(readiness);
    };
    match codex_image_config::tuzi_image_source_from_settings(&provider) {
        Ok(Some(source)) => {
            readiness.provider_base_url = Some(source.base_url);
            readiness.provider_env_key = Some(source.env_key);
            if source.route_kind == codex_image_config::TuziImageRouteKind::NativeV1 {
                readiness.reason = CodexImageCompatReadinessReason::NativeRoute;
                return Ok(readiness);
            }
        }
        Ok(None) => {
            readiness.reason = CodexImageCompatReadinessReason::UnsupportedProvider;
            return Ok(readiness);
        }
        Err(_) => {
            readiness.reason = CodexImageCompatReadinessReason::ProviderConfigInvalid;
            return Ok(readiness);
        }
    }

    let route_enabled = state
        .db
        .get_proxy_config_for_app(AppType::Codex.as_str())
        .await?
        .enabled;
    let proxy_status = state
        .proxy_service
        .get_status()
        .await
        .map_err(AppError::Message)?;
    let local_base_url = if route_enabled && proxy_status.running {
        local_codex_base_url(&proxy_status.address, proxy_status.port)
    } else {
        None
    };
    if let Some(base_url) = local_base_url {
        let live_matches = state
            .proxy_service
            .codex_live_takeover_matches_current_proxy()
            .await
            .unwrap_or(false);
        if live_matches {
            readiness.live_base_url = Some(base_url);
        }
    }

    match codex_image_config::read_managed_image_api_key() {
        Ok(Some(_)) => {}
        Ok(None) => {
            readiness.reason = CodexImageCompatReadinessReason::MissingCredential;
            return Ok(readiness);
        }
        Err(_) => {
            readiness.reason = CodexImageCompatReadinessReason::ManagedCredentialUnreadable;
            return Ok(readiness);
        }
    }

    let codex_home = codex_image_config::effective_codex_home();
    if !managed_skill_is_installed_at(&codex_home)?
        || !codex_image_config::image_personalization_is_active_at(&codex_home)?
    {
        readiness.reason = CodexImageCompatReadinessReason::ManagedFilesMissing;
        return Ok(readiness);
    }

    if readiness.live_base_url.is_none() {
        readiness.reason = CodexImageCompatReadinessReason::LocalRouteInactive;
        return Ok(readiness);
    }

    readiness.ready = true;
    readiness.reason = CodexImageCompatReadinessReason::Ready;
    Ok(readiness)
}

pub(crate) fn reconcile_files_and_key(state: &AppState) -> Result<bool, AppError> {
    reconcile_files_and_key_for_db(state.db.as_ref())
}

pub(crate) fn reconcile_files_and_key_for_db(db: &Database) -> Result<bool, AppError> {
    let _guard = FILES_RECONCILE_LOCK.lock()?;
    let requested = crate::settings::codex_image_render_compat();
    let provider = if requested {
        current_codex_provider_settings(db)?
    } else {
        None
    };
    let key_ready = codex_image_config::reconcile_managed_image_api_key(provider.as_ref())?;
    let ready = requested && key_ready;
    let codex_home = codex_image_config::effective_codex_home();

    let files_result = if ready {
        install_managed_skill_at(&codex_home).and_then(|_| {
            codex_image_config::reconcile_image_personalization_at(&codex_home, true).map(|_| ())
        })
    } else {
        uninstall_managed_skill_at(&codex_home).and_then(|_| {
            codex_image_config::reconcile_image_personalization_at(&codex_home, false).map(|_| ())
        })
    };
    if let Err(error) = files_result {
        // A partially installed fallback must never keep a usable image key.
        let key_cleanup =
            crate::codex_config::remove_managed_env_key_file(codex_image_config::IMAGE_API_KEY_ENV);
        if ready {
            let _ = uninstall_managed_skill_at(&codex_home);
            let _ = codex_image_config::reconcile_image_personalization_at(&codex_home, false);
        }
        if let Err(cleanup_error) = key_cleanup {
            return Err(AppError::Message(format!(
                "Codex 图片兼容文件收敛失败: {error}; 清理派生 Key 失败: {cleanup_error}"
            )));
        }
        return Err(error);
    }
    Ok(ready)
}

/// Remove only Tuzi-owned image compatibility artifacts from one explicit old
/// Codex home. This does not touch the managed image credential or proxy state.
pub(crate) fn cleanup_managed_artifacts_at(codex_home: &Path) -> Result<bool, AppError> {
    let _guard = FILES_RECONCILE_LOCK.lock()?;
    let personalization_changed =
        codex_image_config::reconcile_image_personalization_at(codex_home, false)?;
    let skill_changed = uninstall_managed_skill_at(codex_home)?;
    Ok(personalization_changed || skill_changed)
}

pub(crate) async fn reconcile(state: &AppState) -> Result<CodexImageCompatState, AppError> {
    reconcile_parts(state.db.as_ref(), &state.proxy_service).await
}

async fn reconcile_parts(
    db: &Database,
    proxy_service: &ProxyService,
) -> Result<CodexImageCompatState, AppError> {
    let _guard = RECONCILE_LOCK.lock().await;
    let requested = crate::settings::codex_image_render_compat();
    let artifacts_ready = reconcile_files_and_key_for_db(db)?;
    let proxy_config = db.get_proxy_config().await?;
    let ready =
        artifacts_ready && image_listener_supports_local_route(&proxy_config.listen_address);
    let mut owner = read_takeover_owner()?;
    if should_clear_manual_suppression(requested, owner.as_deref()) {
        // Turning the compatibility switch off is an explicit reset. Keep the
        // suppression while a requested setup is only temporarily unready
        // (for example, during a provider change), otherwise the next
        // reconcile would silently undo the user's manual takeover choice.
        remove_takeover_owner()?;
        owner = None;
    }
    let takeover_owned = is_takeover_owned(owner.as_deref());
    if !proxy_service.has_app_handle() {
        return Ok(CodexImageCompatState {
            ready,
            takeover_owned,
        });
    }
    let takeover_enabled = db
        .get_proxy_config_for_app(AppType::Codex.as_str())
        .await?
        .enabled;

    if ready {
        if should_auto_enable_takeover(takeover_enabled, owner.as_deref()) {
            write_takeover_owner(TAKEOVER_ACTIVATING)?;
            if let Err(error) = proxy_service
                .set_takeover_for_app(AppType::Codex.as_str(), true)
                .await
            {
                remove_takeover_owner()?;
                return Err(AppError::Message(format!(
                    "启用 Codex 图片兼容本地路由失败: {error}"
                )));
            }
            write_takeover_owner(TAKEOVER_OWNED)?;
            return Ok(CodexImageCompatState {
                ready,
                takeover_owned: true,
            });
        }

        if owner.as_deref() == Some(TAKEOVER_ACTIVATING) {
            write_takeover_owner(TAKEOVER_OWNED)?;
        }
        return Ok(CodexImageCompatState {
            ready,
            takeover_owned,
        });
    }

    if takeover_owned {
        if takeover_enabled {
            proxy_service
                .set_takeover_for_app(AppType::Codex.as_str(), false)
                .await
                .map_err(|error| {
                    AppError::Message(format!("关闭 Codex 图片兼容本地路由失败: {error}"))
                })?;
        }
        remove_takeover_owner()?;
    }

    Ok(CodexImageCompatState {
        ready,
        takeover_owned: false,
    })
}

/// Apply an explicit user Codex takeover change without racing the automatic
/// image-compat reconciler.
///
/// Manual enable transfers ownership to the user. Manual disable suppresses
/// automatic image-compat takeover until the compatibility switch is turned
/// off and on again. Internal temporary disables (for example profile
/// switching) do not call this function and therefore remain recoverable.
pub(crate) async fn set_manual_takeover(
    state: &AppState,
    takeover_enabled: bool,
) -> Result<(), String> {
    let _guard = RECONCILE_LOCK.lock().await;
    let previous_owner = read_takeover_owner().map_err(|error| error.to_string())?;
    let next_owner = owner_after_manual_takeover_change(
        takeover_enabled,
        crate::settings::codex_image_render_compat(),
    );
    write_optional_takeover_owner(next_owner).map_err(|error| error.to_string())?;

    if let Err(error) = state
        .proxy_service
        .set_takeover_for_app(AppType::Codex.as_str(), takeover_enabled)
        .await
    {
        return match write_optional_takeover_owner(previous_owner.as_deref()) {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "{error}; 回滚 Codex 图片兼容接管状态失败: {rollback_error}"
            )),
        };
    }
    Ok(())
}

pub(crate) async fn stop_proxy_with_manual_suppression(state: &AppState) -> Result<(), String> {
    let _guard = RECONCILE_LOCK.lock().await;
    let previous_owner = read_takeover_owner().map_err(|error| error.to_string())?;
    let next_owner =
        owner_after_manual_takeover_change(false, crate::settings::codex_image_render_compat());
    write_optional_takeover_owner(next_owner).map_err(|error| error.to_string())?;

    if let Err(error) = state.proxy_service.stop_with_restore().await {
        return match write_optional_takeover_owner(previous_owner.as_deref()) {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "{error}; 回滚 Codex 图片兼容接管状态失败: {rollback_error}"
            )),
        };
    }
    Ok(())
}

pub(crate) fn schedule_reconcile(state: &AppState) -> Result<(), AppError> {
    if !state.proxy_service.has_app_handle() {
        reconcile_files_and_key(state)?;
        return Ok(());
    }
    let db = state.db.clone();
    let proxy_service = state.proxy_service.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = reconcile_parts(db.as_ref(), &proxy_service).await {
            log::warn!("Codex 图片兼容运行态收敛失败: {error}");
        }
    });
    Ok(())
}

fn takeover_owner_path() -> std::path::PathBuf {
    crate::config::get_app_config_dir().join(TAKEOVER_OWNER_FILE)
}

fn read_takeover_owner() -> Result<Option<String>, AppError> {
    let path = takeover_owner_path();
    match fs::read_to_string(&path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(AppError::io(&path, error)),
    }
}

fn write_takeover_owner(owner: &str) -> Result<(), AppError> {
    crate::codex_config::secure_atomic_write(&takeover_owner_path(), owner.as_bytes())
}

fn remove_takeover_owner() -> Result<(), AppError> {
    let path = takeover_owner_path();
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::io(&path, error)),
    }
}

fn write_optional_takeover_owner(owner: Option<&str>) -> Result<(), AppError> {
    match owner {
        Some(owner) => write_takeover_owner(owner),
        None => remove_takeover_owner(),
    }
}

fn is_takeover_owned(owner: Option<&str>) -> bool {
    matches!(owner, Some(TAKEOVER_OWNED | TAKEOVER_ACTIVATING))
}

fn should_auto_enable_takeover(takeover_enabled: bool, owner: Option<&str>) -> bool {
    !takeover_enabled && owner != Some(TAKEOVER_MANUAL_DISABLED)
}

fn should_clear_manual_suppression(requested: bool, owner: Option<&str>) -> bool {
    !requested && owner == Some(TAKEOVER_MANUAL_DISABLED)
}

fn owner_after_manual_takeover_change(
    takeover_enabled: bool,
    compat_requested: bool,
) -> Option<&'static str> {
    (!takeover_enabled && compat_requested).then_some(TAKEOVER_MANUAL_DISABLED)
}

fn current_codex_provider_settings(db: &Database) -> Result<Option<serde_json::Value>, AppError> {
    let Some(provider_id) = crate::settings::get_effective_current_provider(db, &AppType::Codex)?
    else {
        return Ok(None);
    };
    Ok(db
        .get_provider_by_id(&provider_id, AppType::Codex.as_str())?
        .map(|provider| provider.settings_config))
}

fn managed_skill_is_installed_at(codex_home: &Path) -> Result<bool, AppError> {
    let skill_dir = codex_home.join("skills").join(SKILL_NAME);
    let metadata = match fs::symlink_metadata(&skill_dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(AppError::io(&skill_dir, error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Ok(false);
    }

    for embedded in EMBEDDED_SKILL_FILES {
        let target = skill_dir.join(embedded.path);
        let metadata = match fs::symlink_metadata(&target) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(error) => return Err(AppError::io(&target, error)),
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Ok(false);
        }
        if fs::read(&target).map_err(|error| AppError::io(&target, error))? != embedded.content {
            return Ok(false);
        }
    }
    Ok(true)
}

fn install_managed_skill_at(codex_home: &Path) -> Result<bool, AppError> {
    let legacy_skill_dirs = legacy_skill_dirs();
    install_managed_skill_at_with_legacy_targets(codex_home, &legacy_skill_dirs)
}

fn legacy_skill_dirs() -> Vec<std::path::PathBuf> {
    legacy_skill_dirs_for(
        &crate::config::get_home_dir(),
        &crate::config::get_app_config_dir(),
    )
}

fn legacy_skill_dirs_for(home: &Path, app_config_dir: &Path) -> Vec<std::path::PathBuf> {
    let mut targets = Vec::with_capacity(3);
    for target in [
        app_config_dir.join("skills").join(SKILL_NAME),
        home.join(".tuzi-switch").join("skills").join(SKILL_NAME),
        home.join(".agents").join("skills").join(SKILL_NAME),
    ] {
        if target.is_absolute() && !targets.contains(&target) {
            targets.push(target);
        }
    }
    targets
}

fn install_managed_skill_at_with_legacy_targets(
    codex_home: &Path,
    legacy_skill_dirs: &[std::path::PathBuf],
) -> Result<bool, AppError> {
    let skill_dir = codex_home.join("skills").join(SKILL_NAME);
    remove_stale_legacy_skill_symlink(&skill_dir, legacy_skill_dirs)?;
    let owner_path = skill_dir.join(SKILL_OWNER_FILE);
    let existed = match fs::symlink_metadata(&skill_dir) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(skill_conflict());
            }
            let owner = fs::read(&owner_path).map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    skill_conflict()
                } else {
                    AppError::io(&owner_path, error)
                }
            })?;
            if owner != SKILL_OWNER {
                return Err(skill_conflict());
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(AppError::io(&skill_dir, error)),
    };

    let mut changed = !existed;
    let install_order = EMBEDDED_SKILL_FILES
        .iter()
        .filter(|embedded| embedded.path != SKILL_OWNER_FILE)
        .chain(
            EMBEDDED_SKILL_FILES
                .iter()
                .filter(|embedded| embedded.path == SKILL_OWNER_FILE),
        );
    let mut installed = Vec::new();
    for embedded in install_order {
        let target = skill_dir.join(embedded.path);
        match install_managed_skill_file(&skill_dir, embedded, existed) {
            Ok(false) => continue,
            Ok(true) => {
                installed.push((target, embedded.content));
                changed = true;
            }
            Err(error) => {
                if !existed {
                    cleanup_new_skill_install(&skill_dir, &installed);
                }
                return Err(error);
            }
        }
    }
    Ok(changed)
}

fn remove_stale_legacy_skill_symlink(
    skill_dir: &Path,
    legacy_skill_dirs: &[std::path::PathBuf],
) -> Result<bool, AppError> {
    let metadata = match fs::symlink_metadata(skill_dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(AppError::io(skill_dir, error)),
    };
    if !metadata.file_type().is_symlink() {
        return Ok(false);
    }

    let target = fs::read_link(skill_dir).map_err(|error| AppError::io(skill_dir, error))?;
    let Some(legacy_skill_dir) = legacy_skill_dirs.iter().find(|known| **known == target) else {
        return Ok(false);
    };
    match fs::metadata(legacy_skill_dir) {
        Ok(_) => return Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(AppError::io(legacy_skill_dir, error)),
    }

    // Re-check ownership immediately before unlinking. Only the top-level link
    // is removed; the legacy target is never followed or modified.
    let metadata =
        fs::symlink_metadata(skill_dir).map_err(|error| AppError::io(skill_dir, error))?;
    if !metadata.file_type().is_symlink()
        || fs::read_link(skill_dir).map_err(|error| AppError::io(skill_dir, error))?
            != *legacy_skill_dir
    {
        return Err(skill_conflict());
    }
    match fs::metadata(legacy_skill_dir) {
        Ok(_) => return Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(AppError::io(legacy_skill_dir, error)),
    }

    #[cfg(unix)]
    fs::remove_file(skill_dir).map_err(|error| AppError::io(skill_dir, error))?;
    #[cfg(windows)]
    fs::remove_dir(skill_dir).map_err(|error| AppError::io(skill_dir, error))?;
    Ok(true)
}

fn install_managed_skill_file(
    skill_dir: &Path,
    embedded: &EmbeddedSkillFile,
    existed: bool,
) -> Result<bool, AppError> {
    let target = skill_dir.join(embedded.path);
    ensure_managed_parent_dirs(skill_dir, Path::new(embedded.path))?;
    reject_symlink_if_present(&target)?;
    match fs::read(&target) {
        Ok(existing) if existing.as_slice() == embedded.content => return Ok(false),
        Ok(_) if existed => {}
        Ok(_) => return Err(skill_conflict()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(AppError::io(&target, error)),
    }
    crate::codex_config::secure_atomic_write(&target, embedded.content)?;
    Ok(true)
}

fn cleanup_new_skill_install(skill_dir: &Path, installed: &[(std::path::PathBuf, &[u8])]) {
    for (target, expected) in installed.iter().rev() {
        if fs::read(target).ok().as_deref() == Some(*expected) {
            let _ = fs::remove_file(target);
        }
    }
    for relative in ["agents", "scripts"] {
        let _ = fs::remove_dir(skill_dir.join(relative));
    }
    let _ = fs::remove_dir(skill_dir);
}

fn ensure_managed_parent_dirs(skill_dir: &Path, relative: &Path) -> Result<(), AppError> {
    let Some(parent) = relative.parent() else {
        return Ok(());
    };
    let mut current = skill_dir.to_path_buf();
    for component in parent.components() {
        let std::path::Component::Normal(component) = component else {
            return Err(skill_conflict());
        };
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(skill_conflict());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current).map_err(|error| AppError::io(&current, error))?;
            }
            Err(error) => return Err(AppError::io(&current, error)),
        }
    }
    Ok(())
}

fn uninstall_managed_skill_at(codex_home: &Path) -> Result<bool, AppError> {
    let skill_dir = codex_home.join("skills").join(SKILL_NAME);
    let removed_legacy = remove_stale_legacy_skill_symlink(&skill_dir, &legacy_skill_dirs())?;
    let metadata = match fs::symlink_metadata(&skill_dir) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(removed_legacy),
        Err(error) => return Err(AppError::io(&skill_dir, error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Ok(false);
    }
    let owner_path = skill_dir.join(SKILL_OWNER_FILE);
    if fs::read(&owner_path).ok().as_deref() != Some(SKILL_OWNER) {
        return Ok(false);
    }

    for embedded in EMBEDDED_SKILL_FILES
        .iter()
        .filter(|embedded| embedded.path != SKILL_OWNER_FILE)
    {
        let target = skill_dir.join(embedded.path);
        let metadata = match fs::symlink_metadata(&target) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(AppError::io(&target, error)),
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            continue;
        }
        if fs::read(&target).ok().as_deref() == Some(embedded.content) {
            fs::remove_file(&target).map_err(|error| AppError::io(&target, error))?;
        }
    }

    // Relinquish ownership even when user-modified or extra files remain. A
    // later enable will then report a conflict instead of overwriting them.
    fs::remove_file(&owner_path).map_err(|error| AppError::io(&owner_path, error))?;

    for relative in ["agents", "scripts"] {
        let directory = skill_dir.join(relative);
        match fs::remove_dir(&directory) {
            Ok(()) => {}
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
                ) => {}
            Err(error) => return Err(AppError::io(&directory, error)),
        }
    }
    match fs::remove_dir(&skill_dir) {
        Ok(()) => {}
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
            ) => {}
        Err(error) => return Err(AppError::io(&skill_dir, error)),
    }
    Ok(true)
}

fn reject_symlink_if_present(path: &Path) -> Result<(), AppError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(skill_conflict()),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::io(path, error)),
    }
}

fn skill_conflict() -> AppError {
    AppError::Config(format!(
        "Codex Skill {SKILL_NAME} 已存在且不属于 Tuzi Switch，已拒绝覆盖"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_disable_blocks_auto_reconcile_across_provider_changes() {
        let owner = owner_after_manual_takeover_change(false, true);

        assert_eq!(owner, Some(TAKEOVER_MANUAL_DISABLED));
        assert!(!is_takeover_owned(owner));
        assert!(!should_auto_enable_takeover(false, owner));
        assert!(!should_clear_manual_suppression(true, owner));
    }

    #[test]
    fn local_image_route_accepts_only_loopback_or_wildcard_listeners() {
        assert_eq!(
            local_codex_base_url("0.0.0.0", 15721).as_deref(),
            Some("http://127.0.0.1:15721/v1")
        );
        assert_eq!(
            local_codex_base_url("::", 15721).as_deref(),
            Some("http://[::1]:15721/v1")
        );
        assert_eq!(
            local_codex_base_url("127.0.0.1", 15721).as_deref(),
            Some("http://127.0.0.1:15721/v1")
        );
        assert_eq!(
            local_codex_base_url("::1", 15721).as_deref(),
            Some("http://[::1]:15721/v1")
        );
        assert!(local_codex_base_url("192.168.1.10", 15721).is_none());
        assert!(local_codex_base_url("127.0.0.1", 0).is_none());
    }

    #[test]
    fn manual_enable_releases_image_compat_takeover_ownership() {
        assert_eq!(owner_after_manual_takeover_change(true, true), None);
    }

    #[test]
    fn compat_off_then_on_restores_automatic_takeover() {
        let suppressed = owner_after_manual_takeover_change(false, true);
        assert!(!should_auto_enable_takeover(false, suppressed));

        assert!(should_clear_manual_suppression(false, suppressed));
        let reset_owner = None;

        assert!(should_auto_enable_takeover(false, reset_owner));
    }

    #[test]
    fn managed_skill_install_updates_and_owned_uninstall_is_safe() {
        let temp = tempfile::tempdir().expect("tempdir");
        assert!(install_managed_skill_at(temp.path()).expect("install"));
        assert!(!install_managed_skill_at(temp.path()).expect("idempotent"));
        let skill_dir = temp.path().join("skills").join(SKILL_NAME);
        assert_eq!(
            fs::read(skill_dir.join(SKILL_OWNER_FILE)).unwrap(),
            SKILL_OWNER
        );
        assert!(fs::read_to_string(skill_dir.join("agents/openai.yaml"))
            .expect("read skill policy")
            .contains("allow_implicit_invocation: true"));
        assert!(uninstall_managed_skill_at(temp.path()).expect("uninstall"));
        assert!(!skill_dir.exists());
    }

    #[test]
    fn unmanaged_skill_is_never_overwritten_or_removed() {
        let temp = tempfile::tempdir().expect("tempdir");
        let skill_dir = temp.path().join("skills").join(SKILL_NAME);
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "user skill").unwrap();
        assert!(install_managed_skill_at(temp.path()).is_err());
        assert!(!uninstall_managed_skill_at(temp.path()).expect("leave user skill"));
        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).unwrap(),
            "user skill"
        );
    }

    #[cfg(unix)]
    #[test]
    fn install_replaces_only_dangling_legacy_tuzi_skill_symlink() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let codex_home = temp.path().join("codex");
        let skill_dir = codex_home.join("skills").join(SKILL_NAME);
        let legacy_skill_dir = temp
            .path()
            .join(".tuzi-switch")
            .join("skills")
            .join(SKILL_NAME);
        fs::create_dir_all(skill_dir.parent().expect("skills parent")).expect("skills dir");
        symlink(&legacy_skill_dir, &skill_dir).expect("legacy symlink");

        assert!(install_managed_skill_at_with_legacy_targets(
            &codex_home,
            std::slice::from_ref(&legacy_skill_dir),
        )
        .expect("install"));
        assert!(!fs::symlink_metadata(&skill_dir)
            .expect("installed skill")
            .file_type()
            .is_symlink());
        assert_eq!(
            fs::read(skill_dir.join(SKILL_OWNER_FILE)).expect("owner marker"),
            SKILL_OWNER
        );
    }

    #[cfg(unix)]
    #[test]
    fn install_preserves_unknown_dangling_skill_symlink() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let codex_home = temp.path().join("codex");
        let skill_dir = codex_home.join("skills").join(SKILL_NAME);
        let legacy_skill_dir = temp.path().join("legacy").join(SKILL_NAME);
        let unknown_target = temp.path().join("user-skill");
        fs::create_dir_all(skill_dir.parent().expect("skills parent")).expect("skills dir");
        symlink(&unknown_target, &skill_dir).expect("user symlink");

        assert!(install_managed_skill_at_with_legacy_targets(
            &codex_home,
            std::slice::from_ref(&legacy_skill_dir),
        )
        .is_err());
        assert_eq!(
            fs::read_link(&skill_dir).expect("preserved link"),
            unknown_target
        );
    }

    #[cfg(unix)]
    #[test]
    fn install_preserves_live_legacy_skill_symlink() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let codex_home = temp.path().join("codex");
        let skill_dir = codex_home.join("skills").join(SKILL_NAME);
        let legacy_skill_dir = temp.path().join("legacy").join(SKILL_NAME);
        fs::create_dir_all(&legacy_skill_dir).expect("legacy skill");
        fs::write(legacy_skill_dir.join("SKILL.md"), "legacy user content").expect("legacy file");
        fs::create_dir_all(skill_dir.parent().expect("skills parent")).expect("skills dir");
        symlink(&legacy_skill_dir, &skill_dir).expect("legacy symlink");

        assert!(install_managed_skill_at_with_legacy_targets(
            &codex_home,
            std::slice::from_ref(&legacy_skill_dir),
        )
        .is_err());
        assert_eq!(
            fs::read_link(&skill_dir).expect("preserved link"),
            legacy_skill_dir
        );
        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).expect("legacy content"),
            "legacy user content"
        );
    }

    #[test]
    fn legacy_targets_cover_custom_default_and_unified_skill_storage() {
        let home = Path::new("/home/test-user");
        let custom_app_dir = Path::new("/data/custom-tuzi");
        assert_eq!(
            legacy_skill_dirs_for(home, custom_app_dir),
            vec![
                custom_app_dir.join("skills").join(SKILL_NAME),
                home.join(".tuzi-switch").join("skills").join(SKILL_NAME),
                home.join(".agents").join("skills").join(SKILL_NAME),
            ]
        );

        assert_eq!(
            legacy_skill_dirs_for(home, &home.join(".tuzi-switch")),
            vec![
                home.join(".tuzi-switch").join("skills").join(SKILL_NAME),
                home.join(".agents").join("skills").join(SKILL_NAME),
            ]
        );
        assert!(
            legacy_skill_dirs_for(Path::new("relative-home"), Path::new("relative-app")).is_empty()
        );
    }

    #[test]
    fn owned_uninstall_preserves_user_changes_and_extra_files() {
        let temp = tempfile::tempdir().expect("tempdir");
        install_managed_skill_at(temp.path()).expect("install");
        let skill_dir = temp.path().join("skills").join(SKILL_NAME);
        fs::write(skill_dir.join("SKILL.md"), "user modified skill").expect("modify");
        fs::write(skill_dir.join("notes.txt"), "keep me").expect("extra");

        assert!(uninstall_managed_skill_at(temp.path()).expect("uninstall"));
        assert_eq!(
            fs::read_to_string(skill_dir.join("SKILL.md")).expect("modified skill"),
            "user modified skill"
        );
        assert_eq!(
            fs::read_to_string(skill_dir.join("notes.txt")).expect("extra file"),
            "keep me"
        );
        assert!(!skill_dir.join(SKILL_OWNER_FILE).exists());
        assert!(install_managed_skill_at(temp.path()).is_err());
    }

    #[test]
    fn explicit_old_home_cleanup_removes_only_managed_artifacts() {
        let temp = tempfile::tempdir().expect("tempdir");
        fs::write(temp.path().join("AGENTS.md"), "user instructions\n").expect("agents");
        codex_image_config::reconcile_image_personalization_at(temp.path(), true)
            .expect("personalize");
        install_managed_skill_at(temp.path()).expect("install");

        assert!(cleanup_managed_artifacts_at(temp.path()).expect("cleanup"));
        assert_eq!(
            fs::read_to_string(temp.path().join("AGENTS.md")).expect("agents"),
            "user instructions\n"
        );
        assert!(!temp.path().join("skills").join(SKILL_NAME).exists());
    }

    #[cfg(unix)]
    #[test]
    fn managed_skill_rejects_symlinked_subdirectory() {
        use std::os::unix::fs::symlink;

        let temp = tempfile::tempdir().expect("tempdir");
        let outside = tempfile::tempdir().expect("outside tempdir");
        let skill_dir = temp.path().join("skills").join(SKILL_NAME);
        fs::create_dir_all(&skill_dir).expect("skill dir");
        fs::write(skill_dir.join(SKILL_OWNER_FILE), SKILL_OWNER).expect("owner marker");
        symlink(outside.path(), skill_dir.join("scripts")).expect("scripts symlink");

        assert!(install_managed_skill_at(temp.path()).is_err());
        assert!(!outside.path().join("extract_images.py").exists());
    }
}
