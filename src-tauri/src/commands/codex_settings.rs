#![allow(non_snake_case)]

use tauri::State;

use crate::store::AppState;

/// Read the device-level default, migrating the legacy live-only value once.
#[tauri::command]
pub async fn get_codex_subagent_settings(
) -> Result<crate::codex_config::CodexSubagentSettings, String> {
    crate::codex_config::read_codex_subagent_default_settings().map_err(|error| error.to_string())
}

/// Set or clear the global Codex subagent concurrency setting.
///
/// The Codex switch lock serializes this update with provider and proxy writes
/// that also replace the live `config.toml`.
#[tauri::command]
pub async fn set_codex_subagent_max_concurrent_threads(
    state: State<'_, AppState>,
    value: Option<u64>,
) -> Result<crate::codex_config::CodexSubagentSettings, String> {
    let _guard = state
        .proxy_service
        .lock_switch_for_app(crate::app_config::AppType::Codex.as_str())
        .await;

    crate::codex_config::validate_codex_subagent_threads(value)
        .map_err(|error| error.to_string())?;
    let previous = crate::settings::get_settings();
    crate::settings::set_codex_subagent_default_threads(value)
        .map_err(|error| error.to_string())?;

    let apply_result = match crate::services::provider::reapply_current_codex_live(state.inner()) {
        Ok(true) => Ok(()),
        Ok(false) => {
            crate::codex_config::set_codex_subagent_max_concurrent_threads(value).map(|_| ())
        }
        Err(error) => Err(error),
    };
    if let Err(error) = apply_result {
        if let Err(rollback_error) = crate::settings::set_codex_subagent_default_state(
            previous.codex_subagent_default_threads,
            previous.codex_subagent_default_initialized,
        ) {
            return Err(format!("{error}; 回滚默认值失败: {rollback_error}"));
        }
        return Err(error.to_string());
    }

    crate::codex_config::read_codex_subagent_default_settings().map_err(|error| error.to_string())
}
