use crate::store::AppState;

/// 返回图片兼容模式的只读就绪状态，不触发配置收敛或代理启停。
#[tauri::command]
pub async fn get_codex_image_compat_status(
    state: tauri::State<'_, AppState>,
) -> Result<crate::services::codex_image_compat::CodexImageCompatReadiness, String> {
    crate::services::codex_image_compat::readiness(state.inner())
        .await
        .map_err(|error| {
            log::warn!("读取 Codex 图片兼容状态失败: {error}");
            "无法读取 Codex 图片兼容状态".to_string()
        })
}
