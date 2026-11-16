#[cfg(feature = "claude-local-poc")]
pub use crate::claude_local_integration::*;

#[cfg(not(feature = "claude-local-poc"))]
#[tauri::command]
pub fn get_claude_local_status() -> serde_json::Value {
    serde_json::json!({"enabled": false})
}

#[cfg(not(feature = "claude-local-poc"))]
#[tauri::command]
pub fn claude_local_action() -> Result<(), String> {
    Err("Claude Local P0 未在此构建启用".into())
}
