//! Linux trust is an explicit user action: system roots for the VM and NSS for
//! Electron. Never disable TLS verification or change global proxy settings.
use super::{ca_thumbprint, checked, home_dir, probe, PROBE_TIMEOUT};
use anyhow::{Context, Result, ensure};
use std::{fs, path::{Path, PathBuf}, process::Command, time::Duration};

fn stores() -> [PathBuf; 2] {
    // Chromium M146 moved the default; existing installations can retain the
    // legacy database. Register the same scoped nickname in both user stores.
    [home_dir().join(".pki/nssdb"), home_dir().join(".local/share/pki/nssdb")]
}

fn identity(root: &Path) -> Result<(String, PathBuf)> {
    let bytes = fs::read(root.join("ca/ca.pem"))?;
    let digest = ca_thumbprint(&bytes).context("无法读取本地证书指纹")?.to_lowercase();
    Ok((format!("Tuzi Claude Local {digest}"), PathBuf::from(format!("/usr/local/share/ca-certificates/tuzi-claude-{digest}.crt"))))
}

fn secure_store_directory(dir: &Path) -> Result<()> {
    let home = home_dir();
    let relative = dir.strip_prefix(&home)?;
    let mut current = home;
    for component in relative.components() {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) => ensure!(metadata.is_dir() && !metadata.file_type().is_symlink(), "NSS 证书目录不能是链接或普通文件"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => super::private_dir(&current)?,
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

pub(super) fn trusted(root: &Path) -> bool {
    let Ok((nickname, installed)) = identity(root) else { return false };
    if fs::read(installed).ok() != fs::read(root.join("ca/ca.pem")).ok() { return false; }
    if !probe(Command::new("/usr/bin/openssl").args(["verify", "-verify_hostname", "claude.ai", "-CAfile", "/etc/ssl/certs/ca-certificates.crt"])
        .arg(root.join("ca/server.crt")), PROBE_TIMEOUT).is_ok_and(|(ok, _)| ok) { return false; }
    stores().iter().all(|dir| {
        probe(Command::new("/usr/bin/certutil").arg("-L").arg("-d").arg(format!("sql:{}", dir.display())), PROBE_TIMEOUT)
            .is_ok_and(|(ok, bytes)| ok && String::from_utf8_lossy(&bytes).lines().any(|line| {
                line.strip_prefix(&nickname).is_some_and(|suffix| suffix.trim() == "C,,")
            }))
    })
}

pub(super) fn trust(root: &Path) -> Result<()> {
    ensure!(Path::new("/usr/bin/certutil").is_file() && Path::new("/usr/bin/pkexec").is_file()
        && Path::new("/usr/sbin/update-ca-certificates").is_file(),
        "请先通过系统包管理器安装 libnss3-tools、policykit-1 和 ca-certificates");
    let (nickname, installed) = identity(root)?;
    for dir in stores() {
        secure_store_directory(&dir)?;
        let database = format!("sql:{}", dir.display());
        if !dir.join("cert9.db").exists() {
            checked(Command::new("/usr/bin/certutil").args(["-N", "--empty-password", "-d", &database]),
                Duration::from_secs(15), "无法初始化用户 NSS 证书库")?;
        }
        checked(Command::new("/usr/bin/certutil").args(["-A", "-d", &database, "-n", &nickname, "-t", "C,,", "-i"])
            .arg(root.join("ca/ca.pem")), Duration::from_secs(15), "无法导入用户 NSS 证书库")?;
    }
    // Static program, positional data arguments. pkexec presents the system's
    // authorization UI; no password is collected by Tuzi or written to logs.
    checked(Command::new("/usr/bin/pkexec").args(["/bin/sh", "-c",
        "set -eu; /usr/bin/install -m 0644 -- \"$1\" \"$2\"; /usr/sbin/update-ca-certificates", "tuzi-claude-trust"])
        .arg(root.join("ca/ca.pem")).arg(installed), Duration::from_secs(120),
        "系统证书信任未完成；如取消了授权，可重试或点击移除证书信任清理已导入的 NSS 条目")?;
    ensure!(trusted(root), "证书导入后校验未通过，请查看系统证书和 NSS 配置");
    Ok(())
}

pub(super) fn untrust(root: &Path) -> Result<()> {
    let (nickname, installed) = identity(root)?;
    for dir in stores() {
        if !dir.join("cert9.db").exists() { continue; }
        secure_store_directory(&dir)?;
        let database = format!("sql:{}", dir.display());
        if probe(Command::new("/usr/bin/certutil").args(["-L", "-d", &database, "-n", &nickname]), PROBE_TIMEOUT)?.0 {
            checked(Command::new("/usr/bin/certutil").args(["-D", "-d", &database, "-n", &nickname]),
                Duration::from_secs(15), "无法移除 NSS 本地证书")?;
        }
    }
    if installed.exists() {
        ensure!(fs::read(&installed)? == fs::read(root.join("ca/ca.pem"))?, "系统证书内容已改变，拒绝删除不匹配证书");
        checked(Command::new("/usr/bin/pkexec").args(["/bin/sh", "-c",
            "set -eu; /usr/bin/rm -- \"$1\"; /usr/sbin/update-ca-certificates", "tuzi-claude-untrust"])
            .arg(installed), Duration::from_secs(120), "系统证书移除未完成，请在系统授权窗口确认")?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn certificate_identity_does_not_share_a_system_filename_between_profiles() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        for root in [a.path(), b.path()] {
            let ca = root.join("ca");
            fs::create_dir(&ca).unwrap();
            super::super::generate_ca(&ca, "Tuzi Synthetic Test Only").unwrap();
        }
        let first = identity(a.path()).unwrap();
        let second = identity(b.path()).unwrap();
        assert_ne!(first.0, second.0);
        assert_ne!(first.1, second.1);
        assert_eq!(first.1.parent().unwrap(), Path::new("/usr/local/share/ca-certificates"));
        assert!(first.1.file_name().unwrap().to_string_lossy().starts_with("tuzi-claude-"));
        assert!(!first.1.exists());
    }
}
