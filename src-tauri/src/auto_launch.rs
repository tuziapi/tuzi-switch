use crate::error::AppError;
use auto_launch::{AutoLaunch, AutoLaunchBuilder};

/// 获取 macOS 上的 .app bundle 路径
/// 将 `/path/to/兔子switch.app/Contents/MacOS/兔子switch` 转换为 `/path/to/兔子switch.app`
#[cfg(target_os = "macos")]
fn get_macos_app_bundle_path(exe_path: &std::path::Path) -> Option<std::path::PathBuf> {
    let path_str = exe_path.to_string_lossy();
    // 查找 .app/Contents/MacOS/ 模式
    if let Some(app_pos) = path_str.find(".app/Contents/MacOS/") {
        let app_bundle_end = app_pos + 4; // ".app" 的结束位置
        Some(std::path::PathBuf::from(&path_str[..app_bundle_end]))
    } else {
        None
    }
}

const APP_NAME: &str = "兔子助手";
const LEGACY_APP_NAME: &str = "兔子switch";

fn get_auto_launch(app_name: &str) -> Result<AutoLaunch, AppError> {
    let exe_path =
        std::env::current_exe().map_err(|e| AppError::Message(format!("无法获取应用路径: {e}")))?;
    build_auto_launch(app_name, exe_path)
}

fn build_auto_launch(app_name: &str, exe_path: std::path::PathBuf) -> Result<AutoLaunch, AppError> {
    // macOS 需要使用 .app bundle 路径，否则 AppleScript login item 会打开终端
    #[cfg(target_os = "macos")]
    let app_path = get_macos_app_bundle_path(&exe_path).unwrap_or(exe_path);

    #[cfg(not(target_os = "macos"))]
    let app_path = exe_path;

    // AppleScript derives the login-item name from the .app basename. A legacy
    // handle is used only to query/remove the old item, never to launch it.
    #[cfg(target_os = "macos")]
    let app_path = if app_name == LEGACY_APP_NAME {
        app_path.with_file_name(format!("{LEGACY_APP_NAME}.app"))
    } else {
        app_path
    };

    // 使用 AutoLaunchBuilder 消除平台差异
    // macOS: 使用 AppleScript 方式（默认），需要 .app bundle 路径
    // Windows/Linux: 使用注册表/XDG autostart
    let auto_launch = AutoLaunchBuilder::new()
        .set_app_name(app_name)
        .set_app_path(&app_path.to_string_lossy())
        .build()
        .map_err(|e| AppError::Message(format!("创建 AutoLaunch 失败: {e}")))?;

    Ok(auto_launch)
}

/// 启用开机自启
pub fn enable_auto_launch() -> Result<(), AppError> {
    let auto_launch = get_auto_launch(APP_NAME)?;
    auto_launch
        .enable()
        .map_err(|e| AppError::Message(format!("启用开机自启失败: {e}")))?;
    // Create the new entry successfully before removing an enabled legacy entry.
    // Reading status never migrates or enables anything on the user's machine.
    let legacy = get_auto_launch(LEGACY_APP_NAME)?;
    // A user may keep the old .app filename; macOS then uses that name for both.
    if auto_launch != legacy {
        disable_if_enabled(&legacy)?;
    }
    log::info!("已启用开机自启");
    Ok(())
}

/// 禁用开机自启
pub fn disable_auto_launch() -> Result<(), AppError> {
    let auto_launch = get_auto_launch(APP_NAME)?;
    disable_if_enabled(&auto_launch)?;
    disable_if_enabled(&get_auto_launch(LEGACY_APP_NAME)?)?;
    log::info!("已禁用开机自启");
    Ok(())
}

/// 检查是否已启用开机自启
pub fn is_auto_launch_enabled() -> Result<bool, AppError> {
    let auto_launch = get_auto_launch(APP_NAME)?;
    if auto_launch
        .is_enabled()
        .map_err(|e| AppError::Message(format!("检查开机自启状态失败: {e}")))?
    {
        return Ok(true);
    }
    get_auto_launch(LEGACY_APP_NAME)?
        .is_enabled()
        .map_err(|e| AppError::Message(format!("检查旧版开机自启状态失败: {e}")))
}

fn disable_if_enabled(entry: &AutoLaunch) -> Result<(), AppError> {
    if entry
        .is_enabled()
        .map_err(|e| AppError::Message(format!("检查开机自启状态失败: {e}")))?
    {
        entry
            .disable()
            .map_err(|e| AppError::Message(format!("禁用开机自启失败: {e}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn renamed_bundle_uses_new_name_and_can_find_legacy_login_item() {
        let path =
            std::path::PathBuf::from("/Users/test/My Apps/兔子助手.app/Contents/MacOS/tuzi-switch");
        let current = build_auto_launch(APP_NAME, path.clone()).unwrap();
        let legacy = build_auto_launch(LEGACY_APP_NAME, path).unwrap();
        assert_ne!(current, legacy);
        assert_eq!(
            current,
            AutoLaunch::new(
                APP_NAME,
                "/Users/test/My Apps/兔子助手.app",
                false,
                &[] as &[&str]
            )
        );
        assert_eq!(
            legacy,
            AutoLaunch::new(
                LEGACY_APP_NAME,
                "/Users/test/My Apps/兔子switch.app",
                false,
                &[] as &[&str]
            )
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn retaining_old_bundle_filename_does_not_disable_newly_enabled_item() {
        let path =
            std::path::PathBuf::from("/Applications/兔子switch.app/Contents/MacOS/tuzi-switch");
        assert_eq!(
            build_auto_launch(APP_NAME, path.clone()).unwrap(),
            build_auto_launch(LEGACY_APP_NAME, path).unwrap()
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_macos_app_bundle_path_valid() {
        let exe_path =
            std::path::Path::new("/Applications/兔子switch.app/Contents/MacOS/兔子switch");
        let result = get_macos_app_bundle_path(exe_path);
        assert_eq!(
            result,
            Some(std::path::PathBuf::from("/Applications/兔子switch.app"))
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_macos_app_bundle_path_with_spaces() {
        let exe_path =
            std::path::Path::new("/Users/test/My Apps/兔子switch.app/Contents/MacOS/兔子switch");
        let result = get_macos_app_bundle_path(exe_path);
        assert_eq!(
            result,
            Some(std::path::PathBuf::from(
                "/Users/test/My Apps/兔子switch.app"
            ))
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_macos_app_bundle_path_not_in_bundle() {
        let exe_path = std::path::Path::new("/usr/local/bin/tuzi-switch");
        let result = get_macos_app_bundle_path(exe_path);
        assert_eq!(result, None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_get_macos_app_bundle_path_dev_build() {
        // 开发环境下的路径通常不在 .app bundle 内
        let exe_path = std::path::Path::new("/Users/dev/project/target/debug/tuzi-switch");
        let result = get_macos_app_bundle_path(exe_path);
        assert_eq!(result, None);
    }
}
