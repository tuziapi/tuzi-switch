#[cfg(feature = "claude-desktop-local")]
pub use crate::claude_local_integration::*;

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
