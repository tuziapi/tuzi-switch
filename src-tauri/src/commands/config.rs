#![allow(non_snake_case)]

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::app_config::AppType;
use crate::codex_config;
use crate::config::{self, get_claude_settings_path, ConfigStatus};
use crate::settings;
use crate::store::AppState;
use toml_edit::{DocumentMut, Item};

#[tauri::command]
pub async fn get_claude_config_status() -> Result<ConfigStatus, String> {
    Ok(config::get_claude_config_status())
}

use std::str::FromStr;

fn invalid_json_format_error(error: serde_json::Error) -> String {
    let lang = settings::get_settings()
        .language
        .unwrap_or_else(|| "zh".to_string());

    match lang.as_str() {
        "en" => format!("Invalid JSON format: {error}"),
        "ja" => format!("JSON形式が無効です: {error}"),
        _ => format!("无效的 JSON 格式: {error}"),
    }
}

fn invalid_toml_format_error(error: toml_edit::TomlError) -> String {
    let lang = settings::get_settings()
        .language
        .unwrap_or_else(|| "zh".to_string());

    match lang.as_str() {
        "en" => format!("Invalid TOML format: {error}"),
        "ja" => format!("TOML形式が無効です: {error}"),
        _ => format!("无效的 TOML 格式: {error}"),
    }
}

fn validate_common_config_snippet(app_type: &str, snippet: &str) -> Result<(), String> {
    if snippet.trim().is_empty() {
        return Ok(());
    }

    match app_type {
        "claude" | "gemini" | "omo" | "omo-slim" => {
            serde_json::from_str::<serde_json::Value>(snippet)
                .map_err(invalid_json_format_error)?;
        }
        "codex" => {
            snippet
                .parse::<toml_edit::DocumentMut>()
                .map_err(invalid_toml_format_error)?;
        }
        _ => {}
    }

    Ok(())
}

#[tauri::command]
pub async fn get_config_status(
    state: State<'_, AppState>,
    app: String,
) -> Result<ConfigStatus, String> {
    match AppType::from_str(&app).map_err(|e| e.to_string())? {
        AppType::Claude => Ok(config::get_claude_config_status()),
        AppType::ClaudeDesktop => {
            let status = crate::claude_desktop_config::get_status(
                state.db.as_ref(),
                state.proxy_service.is_running().await,
            )
            .map_err(|e| e.to_string())?;
            Ok(ConfigStatus {
                exists: status.configured,
                path: status.config_library_path.unwrap_or_default(),
            })
        }
        AppType::Codex => {
            let auth_path = codex_config::get_codex_auth_path();
            let config_path = codex_config::get_codex_config_path();
            let exists = auth_path.exists()
                || std::fs::read_to_string(&config_path)
                    .map(|content| !content.trim().is_empty())
                    .unwrap_or(false);
            let path = codex_config::get_codex_config_dir()
                .to_string_lossy()
                .to_string();

            Ok(ConfigStatus { exists, path })
        }
        AppType::Gemini => {
            let env_path = crate::gemini_config::get_gemini_env_path();
            let exists = env_path.exists();
            let path = crate::gemini_config::get_gemini_dir()
                .to_string_lossy()
                .to_string();

            Ok(ConfigStatus { exists, path })
        }
        AppType::OpenCode => {
            let config_path = crate::opencode_config::get_opencode_config_path();
            let exists = config_path.exists();
            let path = crate::opencode_config::get_opencode_dir()
                .to_string_lossy()
                .to_string();

            Ok(ConfigStatus { exists, path })
        }
        AppType::OpenClaw => {
            let config_path = crate::openclaw_config::get_openclaw_config_path();
            let exists = config_path.exists();
            let path = crate::openclaw_config::get_openclaw_dir()
                .to_string_lossy()
                .to_string();

            Ok(ConfigStatus { exists, path })
        }
        AppType::Hermes => {
            let config_path = crate::hermes_config::get_hermes_config_path();
            let exists = config_path.exists();
            let path = crate::hermes_config::get_hermes_dir()
                .to_string_lossy()
                .to_string();

            Ok(ConfigStatus { exists, path })
        }
    }
}

#[tauri::command]
pub async fn get_claude_code_config_path() -> Result<String, String> {
    Ok(get_claude_settings_path().to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_config_dir(app: String) -> Result<String, String> {
    let dir = match AppType::from_str(&app).map_err(|e| e.to_string())? {
        AppType::Claude => config::get_claude_config_dir(),
        AppType::ClaudeDesktop => {
            crate::claude_desktop_config::get_config_library_path().map_err(|e| e.to_string())?
        }
        AppType::Codex => codex_config::get_codex_config_dir(),
        AppType::Gemini => crate::gemini_config::get_gemini_dir(),
        AppType::OpenCode => crate::opencode_config::get_opencode_dir(),
        AppType::OpenClaw => crate::openclaw_config::get_openclaw_dir(),
        AppType::Hermes => crate::hermes_config::get_hermes_dir(),
    };

    Ok(dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_config_folder(handle: AppHandle, app: String) -> Result<bool, String> {
    let config_dir = match AppType::from_str(&app).map_err(|e| e.to_string())? {
        AppType::Claude => config::get_claude_config_dir(),
        AppType::ClaudeDesktop => {
            crate::claude_desktop_config::get_config_library_path().map_err(|e| e.to_string())?
        }
        AppType::Codex => codex_config::get_codex_config_dir(),
        AppType::Gemini => crate::gemini_config::get_gemini_dir(),
        AppType::OpenCode => crate::opencode_config::get_opencode_dir(),
        AppType::OpenClaw => crate::openclaw_config::get_openclaw_dir(),
        AppType::Hermes => crate::hermes_config::get_hermes_dir(),
    };

    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }

    handle
        .opener()
        .open_path(config_dir.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| format!("打开文件夹失败: {e}"))?;

    Ok(true)
}

#[tauri::command]
pub async fn pick_directory(
    app: AppHandle,
    #[allow(non_snake_case)] defaultPath: Option<String>,
) -> Result<Option<String>, String> {
    let initial = defaultPath
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty());

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app.dialog().file();
        if let Some(path) = initial {
            builder = builder.set_directory(path);
        }
        builder.blocking_pick_folder()
    })
    .await
    .map_err(|e| format!("弹出目录选择器失败: {e}"))?;

    match result {
        Some(file_path) => {
            let resolved = file_path
                .simplified()
                .into_path()
                .map_err(|e| format!("解析选择的目录失败: {e}"))?;
            Ok(Some(resolved.to_string_lossy().to_string()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn get_app_config_path() -> Result<String, String> {
    let config_path = config::get_app_config_path();
    Ok(config_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_app_config_folder(handle: AppHandle) -> Result<bool, String> {
    let config_dir = config::get_app_config_dir();

    if !config_dir.exists() {
        std::fs::create_dir_all(&config_dir).map_err(|e| format!("创建目录失败: {e}"))?;
    }

    handle
        .opener()
        .open_path(config_dir.to_string_lossy().to_string(), None::<String>)
        .map_err(|e| format!("打开文件夹失败: {e}"))?;

    Ok(true)
}

#[tauri::command]
pub async fn get_claude_common_config_snippet(
    state: tauri::State<'_, crate::store::AppState>,
) -> Result<Option<String>, String> {
    state
        .db
        .get_config_snippet("claude")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_claude_common_config_snippet(
    snippet: String,
    state: tauri::State<'_, crate::store::AppState>,
) -> Result<(), String> {
    let is_cleared = snippet.trim().is_empty();

    if !snippet.trim().is_empty() {
        serde_json::from_str::<serde_json::Value>(&snippet).map_err(invalid_json_format_error)?;
    }

    let value = if is_cleared { None } else { Some(snippet) };

    state
        .db
        .set_config_snippet("claude", value)
        .map_err(|e| e.to_string())?;
    state
        .db
        .set_config_snippet_cleared("claude", is_cleared)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_common_config_snippet(
    app_type: String,
    state: tauri::State<'_, crate::store::AppState>,
) -> Result<Option<String>, String> {
    state
        .db
        .get_config_snippet(&app_type)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn set_common_config_snippet(
    app_type: String,
    snippet: String,
    state: tauri::State<'_, crate::store::AppState>,
) -> Result<(), String> {
    let is_cleared = snippet.trim().is_empty();
    let old_snippet = state
        .db
        .get_config_snippet(&app_type)
        .map_err(|e| e.to_string())?;

    validate_common_config_snippet(&app_type, &snippet)?;

    let value = if is_cleared { None } else { Some(snippet) };

    if matches!(app_type.as_str(), "claude" | "codex" | "gemini") {
        if let Some(legacy_snippet) = old_snippet
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            let app = AppType::from_str(&app_type).map_err(|e| e.to_string())?;
            crate::services::provider::ProviderService::migrate_legacy_common_config_usage(
                state.inner(),
                app,
                legacy_snippet,
            )
            .map_err(|e| e.to_string())?;
        }
    }

    state
        .db
        .set_config_snippet(&app_type, value)
        .map_err(|e| e.to_string())?;
    state
        .db
        .set_config_snippet_cleared(&app_type, is_cleared)
        .map_err(|e| e.to_string())?;

    if matches!(app_type.as_str(), "claude" | "codex" | "gemini") {
        let app = AppType::from_str(&app_type).map_err(|e| e.to_string())?;
        crate::services::provider::ProviderService::sync_current_provider_for_app(
            state.inner(),
            app,
        )
        .map_err(|e| e.to_string())?;
    }

    if app_type == "omo"
        && state
            .db
            .get_current_omo_provider("opencode", "omo")
            .map_err(|e| e.to_string())?
            .is_some()
    {
        crate::services::OmoService::write_config_to_file(
            state.inner(),
            &crate::services::omo::STANDARD,
        )
        .map_err(|e| e.to_string())?;
    }
    if app_type == "omo-slim"
        && state
            .db
            .get_current_omo_provider("opencode", "omo-slim")
            .map_err(|e| e.to_string())?
            .is_some()
    {
        crate::services::OmoService::write_config_to_file(
            state.inner(),
            &crate::services::omo::SLIM,
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_common_config_snippet;

    #[test]
    fn validate_common_config_snippet_accepts_comment_only_codex_snippet() {
        validate_common_config_snippet("codex", "# comment only\n")
            .expect("comment-only codex snippet should be valid");
    }

    #[test]
    fn validate_common_config_snippet_rejects_invalid_codex_snippet() {
        let err = validate_common_config_snippet("codex", "[broken")
            .expect_err("invalid codex snippet should be rejected");
        assert!(
            err.contains("TOML") || err.contains("toml") || err.contains("格式"),
            "expected TOML validation error, got {err}"
        );
    }
}

#[tauri::command]
pub async fn extract_common_config_snippet(
    appType: String,
    settingsConfig: Option<String>,
    state: tauri::State<'_, crate::store::AppState>,
) -> Result<String, String> {
    let app = AppType::from_str(&appType).map_err(|e| e.to_string())?;

    if let Some(settings_config) = settingsConfig.filter(|s| !s.trim().is_empty()) {
        let settings: serde_json::Value =
            serde_json::from_str(&settings_config).map_err(invalid_json_format_error)?;

        return crate::services::provider::ProviderService::extract_common_config_snippet_from_settings(
            app,
            &settings,
        )
        .map_err(|e| e.to_string());
    }

    crate::services::provider::ProviderService::extract_common_config_snippet(&state, app)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_codex_env_key(envKey: String) -> Result<Option<String>, String> {
    let result = codex_config::read_managed_env_key(&envKey);
    log::info!(
        "[CODEX-ENV] read_codex_env_key({}) => has_value={}",
        envKey,
        result.is_some()
    );
    Ok(result)
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn read_codex_provider_credential(
    state: State<'_, AppState>,
    providerId: String,
    envKey: String,
) -> Result<crate::services::provider::CodexProviderCredential, String> {
    crate::services::provider::read_codex_provider_credential(
        state.inner(),
        providerId.trim(),
        envKey.trim(),
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn write_codex_env_key(envKey: String, value: String) -> Result<(), String> {
    codex_config::write_managed_env_key(&envKey, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_all_codex_env_keys() -> Result<std::collections::HashMap<String, String>, String> {
    Ok(codex_config::read_managed_env_block())
}

fn codex_route_id_from_config(config_text: &str) -> Option<String> {
    config_text
        .parse::<toml_edit::DocumentMut>()
        .ok()?
        .get("model_provider")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn codex_active_provider_field(config_text: &str, field: &str) -> Option<String> {
    let doc = config_text.parse::<toml_edit::DocumentMut>().ok()?;
    let route_id = doc
        .get("model_provider")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())?;

    doc.get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|table| table.get(route_id))
        .and_then(|item| item.as_table())
        .and_then(|table| table.get(field))
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn merge_codex_config_edits(existing: &str, edited: &str) -> Result<String, String> {
    fn merge_item(target: &mut Item, source: &Item) {
        if let (Some(target_table), Some(source_table)) =
            (target.as_table_like_mut(), source.as_table_like())
        {
            for (key, source_item) in source_table.iter() {
                match target_table.get_mut(key) {
                    Some(target_item) => merge_item(target_item, source_item),
                    None => {
                        target_table.insert(key, source_item.clone());
                    }
                }
            }
        } else {
            *target = source.clone();
        }
    }

    let mut target = if existing.trim().is_empty() {
        DocumentMut::new()
    } else {
        existing
            .parse::<DocumentMut>()
            .map_err(|e| format!("Invalid existing Codex config.toml: {e}"))?
    };
    let source = edited
        .parse::<DocumentMut>()
        .map_err(|e| format!("Invalid edited Codex config.toml: {e}"))?;
    merge_item(target.as_item_mut(), source.as_item());
    Ok(target.to_string())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveCodexRouteResult {
    pub route_id: String,
    pub env_key: String,
    pub config: String,
}

#[allow(non_snake_case)]
fn save_codex_route_inner(
    state: &AppState,
    routeId: String,
    baseUrl: String,
    envKey: String,
    apiKey: String,
    model: String,
    modelReasoningEffort: String,
    profileName: Option<String>,
    providerId: Option<String>,
    configText: Option<String>,
) -> Result<SaveCodexRouteResult, String> {
    let source_config = configText
        .as_deref()
        .map(str::trim)
        .filter(|config| !config.is_empty());

    let route_draft = if let Some(config) = source_config {
        codex_config::save_route_to_config_with_provider_config(
            config,
            &routeId,
            &baseUrl,
            &envKey,
            &model,
            &modelReasoningEffort,
            Some(config),
        )
    } else {
        codex_config::save_route_to_config(
            "",
            &routeId,
            &baseUrl,
            &envKey,
            &model,
            &modelReasoningEffort,
        )
    }
    .map_err(|e| e.to_string())?;
    let route_draft = codex_config::switch_codex_profile(
        &route_draft,
        &routeId,
        Some(&model),
        Some(&modelReasoningEffort),
    )
    .map_err(|e| e.to_string())?;
    let mut provider = crate::provider::Provider::with_id(
        providerId
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .unwrap_or("__codex_route_draft")
            .to_string(),
        profileName
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(&routeId)
            .to_string(),
        serde_json::json!({ "auth": {}, "config": route_draft }),
        None,
    );
    let submitted_provider = provider.clone();
    crate::services::provider::normalize_codex_managed_provider_for_storage(
        state.db.as_ref(),
        &mut provider,
        providerId.as_deref(),
    )
    .map_err(|e| e.to_string())?;
    crate::services::provider::migrate_codex_provider_credential(
        Some(&submitted_provider),
        &provider,
    )
    .map_err(|e| e.to_string())?;

    let normalized_config = provider
        .settings_config
        .get("config")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    let normalized_route_id =
        codex_route_id_from_config(normalized_config).unwrap_or_else(|| routeId.clone());
    let normalized_env_key =
        codex_active_provider_field(normalized_config, "env_key").unwrap_or_else(|| envKey.clone());
    let normalized_base_url = codex_active_provider_field(normalized_config, "base_url")
        .unwrap_or_else(|| baseUrl.clone());

    // Write API key to shell rc
    if !apiKey.is_empty() {
        codex_config::write_managed_env_key(&normalized_env_key, &apiKey)
            .map_err(|e| e.to_string())?;
    }

    codex_config::ensure_codex_provider_env_ready(normalized_config).map_err(|e| e.to_string())?;

    // Write route section to config.toml
    let existing = codex_config::read_codex_config_text().map_err(|e| e.to_string())?;
    let existing_with_edits = if source_config.is_some() {
        merge_codex_config_edits(&existing, normalized_config)?
    } else {
        existing
    };
    let updated = codex_config::save_route_to_config_with_provider_config(
        &existing_with_edits,
        &normalized_route_id,
        &normalized_base_url,
        &normalized_env_key,
        &model,
        &modelReasoningEffort,
        Some(normalized_config),
    )
    .map_err(|e| e.to_string())?;

    let profile_config = codex_config::switch_codex_profile(
        &updated,
        &normalized_route_id,
        Some(&model),
        Some(&modelReasoningEffort),
    )
    .map_err(|e| e.to_string())?;

    let profile_name = profileName
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(&normalized_route_id);
    codex_config::write_codex_profile_config(profile_name, &profile_config)
        .map_err(|e| e.to_string())?;
    codex_config::write_codex_live_config_atomic(Some(&updated)).map_err(|e| e.to_string())?;

    Ok(SaveCodexRouteResult {
        route_id: normalized_route_id,
        env_key: normalized_env_key,
        config: normalized_config.to_string(),
    })
}

#[tauri::command]
#[allow(non_snake_case)]
pub fn save_codex_route(
    state: State<'_, AppState>,
    routeId: String,
    baseUrl: String,
    envKey: String,
    apiKey: String,
    model: String,
    modelReasoningEffort: String,
    profileName: Option<String>,
    providerId: Option<String>,
    configText: Option<String>,
) -> Result<SaveCodexRouteResult, String> {
    save_codex_route_inner(
        state.inner(),
        routeId,
        baseUrl,
        envKey,
        apiKey,
        model,
        modelReasoningEffort,
        profileName,
        providerId,
        configText,
    )
}

#[cfg(any(test, debug_assertions))]
#[allow(non_snake_case)]
pub fn save_codex_route_test_hook(
    state: &AppState,
    routeId: String,
    baseUrl: String,
    envKey: String,
    apiKey: String,
    model: String,
    modelReasoningEffort: String,
    profileName: Option<String>,
    providerId: Option<String>,
    configText: Option<String>,
) -> Result<SaveCodexRouteResult, String> {
    save_codex_route_inner(
        state,
        routeId,
        baseUrl,
        envKey,
        apiKey,
        model,
        modelReasoningEffort,
        profileName,
        providerId,
        configText,
    )
}
