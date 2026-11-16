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
pub(super) fn prepare(root: &Path) -> Result<(), String> {
    if !cfg!(target_os = "macos") {
        return Err("独立 Claude 副本暂仅支持 macOS".into());
    }
    let target = app_path(root);
    let parent = target.parent().unwrap();
    for path in [root, &root.join("desktop-app"), parent, &target] {
        reject_link(path)?;
    }
    // A prepared copy stays pinned even when /Applications receives a later update.
    if target.exists() {
        return validate(&target);
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
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
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
            assert!(prepare(root.path()).is_err());
            assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
        }
    }
}
