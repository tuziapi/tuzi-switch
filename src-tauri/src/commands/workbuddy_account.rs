use crate::error::AppError;

/// models.json 里已有的模型 id 及归属：WorkBuddy 里一个模型 id 只能属于一张卡，
/// 添加 / 编辑表单据此跳过或标出被别人占用的 id。
#[tauri::command]
pub async fn workbuddy_model_owners(
) -> Result<Vec<crate::workbuddy_config::WorkBuddyModelOwner>, String> {
    tokio::task::spawn_blocking(crate::workbuddy_config::model_owners)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

/// 打开 WorkBuddy 桌面端（让用户在里面登录）。
#[tauri::command]
pub async fn workbuddy_account_open_app() -> Result<(), String> {
    tokio::task::spawn_blocking(open_workbuddy)
        .await
        .map_err(|error| error.to_string())?
}

fn open_workbuddy() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let opened = |args: &[&str]| {
            std::process::Command::new("open")
                .args(args)
                .stdin(std::process::Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
        };
        if opened(&["-b", "com.tencent.workbuddy.mac"]) || opened(&["-a", "WorkBuddy"]) {
            return Ok(());
        }
    }
    // 推断的安装位置（未实测）：%LOCALAPPDATA%\Programs\WorkBuddy\WorkBuddy.exe
    #[cfg(windows)]
    {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            let exe = std::path::PathBuf::from(local)
                .join("Programs")
                .join("WorkBuddy")
                .join("WorkBuddy.exe");
            if exe.exists() && std::process::Command::new(&exe).spawn().is_ok() {
                return Ok(());
            }
        }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        if std::process::Command::new("workbuddy")
            .stdin(std::process::Stdio::null())
            .spawn()
            .is_ok()
        {
            return Ok(());
        }
    }
    Err(AppError::localized(
        "workbuddy.account.open_failed",
        "没能打开 WorkBuddy，请手动打开。",
        "Couldn't open WorkBuddy. Open it manually.",
    )
    .to_string())
}
