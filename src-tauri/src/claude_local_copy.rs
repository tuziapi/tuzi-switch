//! Private, version-pinned, signed Desktop bundle. Never updates the user's installation.
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub(super) const COPY_VERSION: &str = "5.11492.5";
pub(super) fn app_path(root: &Path) -> PathBuf {
    root.join("desktop-app")
        .join(COPY_VERSION)
        .join("Claude.app")
}
fn reject_link(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("Claude 独立副本路径不能是符号链接".into());
    }
    Ok(())
}
fn validate(app: &Path) -> Result<(), String> {
    reject_link(app)?;
    let output = Command::new("/usr/libexec/PlistBuddy")
        .args(["-c", "Print :CFBundleShortVersionString"])
        .arg(app.join("Contents/Info.plist"))
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() || String::from_utf8_lossy(&output.stdout).trim() != COPY_VERSION {
        return Err(format!(
            "独立副本仅接受 Claude {COPY_VERSION}；请保留当前安装并单独验证其他版本"
        ));
    }
    let output = Command::new("/usr/bin/codesign").args([
        "--verify", "--deep", "--strict", "-R",
        "=anchor apple generic and identifier \"com.anthropic.claudefordesktop\" and certificate leaf[subject.OU] = \"Q6L2SF6YDW\"",
    ]).arg(app).output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("Claude 官方签名或资源完整性校验失败".into());
    }
    Ok(())
}
pub(super) fn version_allowed(platform: &str, version: &str) -> bool {
    version == COPY_VERSION || (platform == "windows" && version == format!("{COPY_VERSION}.0"))
}

pub(super) fn prepare(root: &Path) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = root;
        return claude_local::desktop::verified_windows_app(
            COPY_VERSION, std::time::Instant::now() + std::time::Duration::from_secs(20)
        ).map_err(|e| e.to_string());
    }
    #[cfg(target_os = "linux")]
    {
        let _ = root;
        return claude_local::desktop::verified_linux_app(
            COPY_VERSION, std::time::Instant::now() + std::time::Duration::from_secs(10)
        ).map_err(|e| e.to_string());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return Err("此平台的官方客户端隔离启动仍在适配".into());
    #[cfg(target_os = "macos")]
    prepare_macos(root)
}

#[cfg(target_os = "macos")]
fn prepare_macos(root: &Path) -> Result<PathBuf, String> {
    let target = app_path(root);
    let parent = target.parent().unwrap();
    for path in [root, &root.join("desktop-app"), parent, &target] {
        reject_link(path)?;
    }
    // A prepared copy stays pinned even when /Applications receives a later update.
    if target.exists() {
        validate(&target)?;
        return Ok(target);
    }
    let source = [
        PathBuf::from("/Applications/Claude.app"),
        dirs::home_dir()
            .unwrap_or_default()
            .join("Applications/Claude.app"),
    ]
    .into_iter()
    .find(|p| p.is_dir())
    .ok_or("未找到 Claude 安装包")?;
    validate(&source)?;
    claude_local::private_dir(parent).map_err(|e| e.to_string())?;
    let stage = tempfile::Builder::new()
        .prefix(".copy-")
        .tempdir_in(parent)
        .map_err(|e| e.to_string())?;
    let staged_app = stage.path().join("Claude.app");
    let output = Command::new("/usr/bin/ditto")
        .arg(&source)
        .arg(&staged_app)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err("复制 Claude 独立应用失败".into());
    }
    validate(&staged_app)?;
    // The host operation and cross-process owner locks serialize this promotion.
    fs::rename(staged_app, &target).map_err(|e| e.to_string())?;
    Ok(target)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_version_allowlist_does_not_expand_other_versions() {
        for platform in ["macos", "windows", "linux"] {
            assert!(version_allowed(platform, "5.11492.5"));
            assert!(!version_allowed(platform, "5.11492.6"));
            assert!(!version_allowed(platform, "5.11492.5-beta"));
            assert_eq!(version_allowed(platform, "5.11492.5.0"), platform == "windows");
        }
    }
    #[test]
    fn local_copy_path_is_pinned_and_does_not_follow_symlinks() {
        let root = tempfile::tempdir().unwrap();
        assert_eq!(
            app_path(root.path()),
            root.path().join("desktop-app/5.11492.5/Claude.app")
        );
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().unwrap();
            std::os::unix::fs::symlink(outside.path(), root.path().join("desktop-app")).unwrap();
            assert!(reject_link(&root.path().join("desktop-app")).is_err());
            assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
        }
    }
}
