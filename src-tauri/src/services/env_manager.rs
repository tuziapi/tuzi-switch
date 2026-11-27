use super::env_checker::EnvConflict;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[cfg(target_os = "windows")]
use winreg::enums::*;
#[cfg(target_os = "windows")]
use winreg::RegKey;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub backup_path: String,
    pub timestamp: String,
    pub conflicts: Vec<EnvConflict>,
    /// Process snapshots cannot be safely mutated in a multithreaded Unix app.
    #[serde(default)]
    pub restart_required: bool,
    #[serde(default)]
    pub unresolved_vars: Vec<String>,
}

/// Delete environment variables with automatic backup
pub fn delete_env_vars(conflicts: Vec<EnvConflict>) -> Result<BackupInfo, String> {
    if conflicts.is_empty() {
        return Err("请选择要删除的环境变量".into());
    }
    let mut targets = conflicts.clone();
    let mut unresolved = Vec::new();
    let mut restart = false;
    #[cfg(not(target_os = "windows"))]
    {
        targets.retain(|c| c.source_type != "system");
        let files = super::env_checker::check_env_conflicts("claude")?
            .into_iter()
            .chain(super::env_checker::check_env_conflicts("codex")?)
            .chain(super::env_checker::check_env_conflicts("gemini")?)
            .filter(|c| c.source_type == "file")
            .collect::<Vec<_>>();
        for conflict in &conflicts {
            if conflict.source_type == "system" {
                restart = true;
                let matching = files
                    .iter()
                    .filter(|c| {
                        c.var_name == conflict.var_name && c.var_value == conflict.var_value
                    })
                    .collect::<Vec<_>>();
                if matching.is_empty() {
                    unresolved.push(conflict.var_name.clone());
                }
                for source in matching {
                    if !targets.iter().any(|c| {
                        c.var_name == source.var_name && c.source_path == source.source_path
                    }) {
                        targets.push(source.clone());
                    }
                }
            } else if std::env::var_os(&conflict.var_name).is_some() {
                restart = true;
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    targets.retain(|c| {
        seen.insert((
            c.var_name.clone(),
            c.var_value.clone(),
            c.source_path
                .rsplit_once(':')
                .map(|(p, _)| p)
                .unwrap_or(&c.source_path)
                .to_string(),
        ))
    });
    if targets.is_empty() {
        return Err("这些变量来自启动助手的父进程，未找到可删除的配置来源。请在启动终端或启动器中移除变量，再完全退出并重开助手；本次未删除任何变量。".into());
    }
    let mut backup_info = create_backup(&targets)?;
    for conflict in &targets {
        if let Err(e) = delete_single_env(conflict) {
            return Err(format!(
                "删除环境变量失败: {}. 已完成的部分不会自动回滚，备份保存在: {}",
                e, backup_info.backup_path
            ));
        }
    }
    backup_info.restart_required = restart;
    backup_info.unresolved_vars = unresolved;
    Ok(backup_info)
}

/// Create backup file before deletion
fn create_backup(conflicts: &[EnvConflict]) -> Result<BackupInfo, String> {
    // Get backup directory
    let backup_dir = get_backup_dir()?;
    fs::create_dir_all(&backup_dir).map_err(|e| format!("创建备份目录失败: {e}"))?;

    // Generate backup file name with timestamp
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S_%f").to_string();
    let backup_file = backup_dir.join(format!("env-backup-{timestamp}.json"));

    // Create backup data
    let backup_info = BackupInfo {
        backup_path: backup_file.to_string_lossy().to_string(),
        timestamp: timestamp.clone(),
        conflicts: conflicts.to_vec(),
        restart_required: false,
        unresolved_vars: Vec::new(),
    };

    // Write backup file
    let json = serde_json::to_string_pretty(&backup_info)
        .map_err(|e| format!("序列化备份数据失败: {e}"))?;

    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        options.mode(0o600);
        fs::set_permissions(&backup_dir, fs::Permissions::from_mode(0o700))
            .map_err(|e| format!("设置备份权限失败: {e}"))?;
    }
    let mut file = options
        .open(&backup_file)
        .map_err(|e| format!("创建备份文件失败: {e}"))?;
    file.write_all(json.as_bytes())
        .map_err(|e| format!("写入备份文件失败: {e}"))?;

    Ok(backup_info)
}

/// Get backup directory path
fn get_backup_dir() -> Result<PathBuf, String> {
    let home = crate::config::get_home_dir();
    Ok(home.join(".tuzi-switch").join("backups"))
}

/// Delete a single environment variable
#[cfg(target_os = "windows")]
fn delete_single_env(conflict: &EnvConflict) -> Result<(), String> {
    match conflict.source_type.as_str() {
        "system" => {
            if conflict.source_path.contains("HKEY_CURRENT_USER") {
                let hkcu = RegKey::predef(HKEY_CURRENT_USER)
                    .open_subkey_with_flags("Environment", KEY_ALL_ACCESS)
                    .map_err(|e| format!("打开注册表失败: {}", e))?;

                hkcu.delete_value(&conflict.var_name)
                    .map_err(|e| format!("删除注册表项失败: {}", e))?;
            } else if conflict.source_path.contains("HKEY_LOCAL_MACHINE") {
                let hklm = RegKey::predef(HKEY_LOCAL_MACHINE)
                    .open_subkey_with_flags(
                        "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
                        KEY_ALL_ACCESS,
                    )
                    .map_err(|e| format!("打开系统注册表失败 (需要管理员权限): {}", e))?;

                hklm.delete_value(&conflict.var_name)
                    .map_err(|e| format!("删除系统注册表项失败: {}", e))?;
            }
            Ok(())
        }
        "file" => Err("Windows 系统不应该有文件类型的环境变量".to_string()),
        _ => Err(format!("未知的环境变量来源类型: {}", conflict.source_type)),
    }
}

#[cfg(not(target_os = "windows"))]
fn delete_single_env(conflict: &EnvConflict) -> Result<(), String> {
    match conflict.source_type.as_str() {
        "file" => {
            let (file_path, _) = conflict
                .source_path
                .rsplit_once(':')
                .ok_or("无效的文件路径格式")?;
            let content = fs::read_to_string(file_path)
                .map_err(|e| format!("读取文件失败 {file_path}: {e}"))?;
            let new_content = remove_assignment(&content, conflict)?;
            // Persist atomically, retaining the source permissions and trailing newlines.
            use std::io::Write;
            let path = fs::canonicalize(file_path).map_err(|e| e.to_string())?;
            let mut temp = tempfile::NamedTempFile::new_in(path.parent().ok_or("无效路径")?)
                .map_err(|e| e.to_string())?;
            temp.as_file()
                .set_permissions(
                    fs::metadata(&path)
                        .map_err(|e| e.to_string())?
                        .permissions(),
                )
                .map_err(|e| e.to_string())?;
            temp.write_all(new_content.as_bytes())
                .map_err(|e| e.to_string())?;
            temp.as_file().sync_all().map_err(|e| e.to_string())?;
            temp.persist(&path)
                .map_err(|e| format!("写入文件失败: {}", e.error))?;
            if fs::read_to_string(&path).map_err(|e| e.to_string())? != new_content {
                return Err("删除后校验失败".into());
            }
            Ok(())
        }
        "system" => Err("进程继承变量无法直接删除，请清理启动来源并重启助手".into()),
        _ => Err(format!("未知的环境变量来源类型: {}", conflict.source_type)),
    }
}

#[cfg(not(target_os = "windows"))]
fn remove_assignment(content: &str, conflict: &EnvConflict) -> Result<String, String> {
    let mut removed = false;
    let mut result = String::new();
    for line in content.split_inclusive('\n') {
        if let Some((name, value)) = super::env_checker::parse_assignment(line) {
            if name == conflict.var_name {
                if value == conflict.var_value {
                    removed = true;
                    continue;
                }
            }
        }
        result.push_str(line);
    }
    if !removed {
        return Err("未找到可安全删除的独立赋值，请刷新检查或手动修改配置".into());
    }
    Ok(result)
}

/// Restore environment variables from backup
pub fn restore_from_backup(backup_path: String) -> Result<(), String> {
    // Read backup file
    let content = fs::read_to_string(&backup_path).map_err(|e| format!("读取备份文件失败: {e}"))?;

    let backup_info: BackupInfo =
        serde_json::from_str(&content).map_err(|e| format!("解析备份文件失败: {e}"))?;

    // Restore each variable
    for conflict in &backup_info.conflicts {
        restore_single_env(conflict)?;
    }

    Ok(())
}

/// Restore a single environment variable
#[cfg(target_os = "windows")]
fn restore_single_env(conflict: &EnvConflict) -> Result<(), String> {
    match conflict.source_type.as_str() {
        "system" => {
            if conflict.source_path.contains("HKEY_CURRENT_USER") {
                let (hkcu, _) = RegKey::predef(HKEY_CURRENT_USER)
                    .create_subkey("Environment")
                    .map_err(|e| format!("打开注册表失败: {}", e))?;

                hkcu.set_value(&conflict.var_name, &conflict.var_value)
                    .map_err(|e| format!("恢复注册表项失败: {}", e))?;
            } else if conflict.source_path.contains("HKEY_LOCAL_MACHINE") {
                let (hklm, _) = RegKey::predef(HKEY_LOCAL_MACHINE)
                    .create_subkey(
                        "SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
                    )
                    .map_err(|e| format!("打开系统注册表失败 (需要管理员权限): {}", e))?;

                hklm.set_value(&conflict.var_name, &conflict.var_value)
                    .map_err(|e| format!("恢复系统注册表项失败: {}", e))?;
            }
            Ok(())
        }
        _ => Err(format!(
            "无法恢复类型为 {} 的环境变量",
            conflict.source_type
        )),
    }
}

#[cfg(not(target_os = "windows"))]
fn restore_single_env(conflict: &EnvConflict) -> Result<(), String> {
    match conflict.source_type.as_str() {
        "file" => {
            // Parse file path from source_path
            let (file_path, _) = conflict
                .source_path
                .rsplit_once(':')
                .ok_or("无效的文件路径格式")?;

            // Read file content
            let mut content = fs::read_to_string(file_path)
                .map_err(|e| format!("读取文件失败 {file_path}: {e}"))?;

            // Append the environment variable line
            let export_line = format!(
                "\nexport {}='{}'\n",
                conflict.var_name,
                conflict.var_value.replace('\'', "'\"'\"'")
            );
            content.push_str(&export_line);

            // Write back to file
            fs::write(file_path, content).map_err(|e| format!("写入文件失败 {file_path}: {e}"))?;

            Ok(())
        }
        _ => Err(format!(
            "无法恢复类型为 {} 的环境变量",
            conflict.source_type
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn deletion_preserves_other_commands_and_checks_stale_values() {
        let conflict = EnvConflict {
            var_name: "ANTHROPIC_API_KEY".into(),
            var_value: "synthetic-only".into(),
            source_type: "file".into(),
            source_path: String::new(),
        };
        let original = "# keep\nexport ANTHROPIC_API_KEY='synthetic-only'\nexport OTHER=keep\n";
        assert_eq!(
            remove_assignment(original, &conflict).unwrap(),
            "# keep\nexport OTHER=keep\n"
        );
        assert!(remove_assignment("export ANTHROPIC_API_KEY=new-value\n", &conflict).is_err());
        assert!(remove_assignment(
            "export ANTHROPIC_API_KEY=synthetic-only; echo keep\n",
            &conflict
        )
        .is_err());
        assert!(remove_assignment("# no assignment\n", &conflict).is_err());
    }
    #[cfg(not(target_os = "windows"))]
    #[test]
    fn deletion_rechecks_real_fixture_file_and_process_is_not_fake_success() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("shell:profile");
        fs::write(
            &file,
            "export ANTHROPIC_API_KEY='synthetic-only'\nexport OTHER=keep\n",
        )
        .unwrap();
        let mut conflict = EnvConflict {
            var_name: "ANTHROPIC_API_KEY".into(),
            var_value: "synthetic-only".into(),
            source_type: "file".into(),
            source_path: format!("{}:1", file.display()),
        };
        delete_single_env(&conflict).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "export OTHER=keep\n");
        conflict.source_type = "system".into();
        conflict.source_path = "Process Environment".into();
        assert!(delete_single_env(&conflict).is_err());
    }
    #[test]
    fn old_backups_keep_default_result_fields() {
        let backup: BackupInfo =
            serde_json::from_str(r#"{"backupPath":"synthetic","timestamp":"0","conflicts":[]}"#)
                .unwrap();
        assert!(!backup.restart_required);
        assert!(backup.unresolved_vars.is_empty());
    }
    #[test]
    fn test_backup_dir_creation() {
        let backup_dir = get_backup_dir();
        assert!(backup_dir.is_ok());
    }
}
