#[cfg(feature = "claude-desktop-local")]
pub use crate::claude_local_integration::*;

#[tauri::command]
pub async fn detect_official_claude_installation() -> Result<Option<bool>, String> {
    #[cfg(feature = "claude-desktop-local")]
    return tauri::async_runtime::spawn_blocking(claude_local::desktop::official_installation_present)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string());
    #[cfg(not(feature = "claude-desktop-local"))]
    Ok(None)
}

#[cfg(not(feature = "claude-desktop-local"))]
#[tauri::command]
pub fn get_claude_local_status() -> serde_json::Value {
    serde_json::json!({"enabled": false})
}

#[cfg(not(feature = "claude-desktop-local"))]
#[tauri::command]
pub fn claude_local_action() -> Result<(), String> {
    Err("Claude 本地兼容未在此构建启用".into())
}
