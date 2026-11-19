//! 文件小工具：原子写入（与 Codex++ 的 settings::atomic_write 同一实现）。

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::Context;

pub fn atomic_write(path: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    atomic_write_with(path, |file| file.write_all(bytes))
}

/// 流式原子写入：内容由 `write_contents` 直接写进临时文件，调用方不必先把
/// 完整字节拼在内存里。大文件（如历史会话的 rollout JSONL）走这条路径。
pub fn atomic_write_with(
    path: &Path,
    write_contents: impl FnOnce(&mut File) -> std::io::Result<()>,
) -> anyhow::Result<()> {
    // 目标是软链接时（常见于把 ~/.codex/config.toml 链到 dotfiles 仓库），
    // 原子替换要落在链接指向的真实文件上；直接 rename 会把链接本身换成普通文件，
    // 链接被悄悄断开，dotfiles 里的原文件不再更新。
    let resolved = resolve_symlink_target(path);
    let path = resolved.as_deref().unwrap_or(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("failed to create directory {}", parent.display()))?;
    }

    // 保留原文件权限：临时文件默认权限不一定和它一致。
    let existing_permissions = match fs::metadata(path) {
        Ok(metadata) => Some(metadata.permissions()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(error)
                .with_context(|| format!("failed to read permissions for {}", path.display()));
        }
    };
    let temp_path = temp_path_for(path);
    let write_result = (|| -> std::io::Result<()> {
        let mut temp_file = File::create(&temp_path)?;
        write_contents(&mut temp_file)?;
        temp_file.flush()?;
        if let Some(permissions) = existing_permissions {
            temp_file.set_permissions(permissions)?;
        }
        // rename 前必须落盘：只 flush 时内容可能还在页缓存里，断电或蓝屏后会留下
        // 已经替换成功、内容却全是 NUL 的 config.toml（#2450）。
        temp_file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error)
            .with_context(|| format!("failed to write temp file {}", temp_path.display()));
    }
    if let Err(error) = replace_file(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error).with_context(|| {
            format!(
                "failed to replace {} with {}",
                path.display(),
                temp_path.display()
            )
        });
    }
    Ok(())
}

/// 逐级解析软链接（最多 16 层，防环），返回最终目标路径；不是软链接时返回 None。
fn resolve_symlink_target(path: &Path) -> Option<PathBuf> {
    let mut current = path.to_path_buf();
    let mut resolved = false;
    for _ in 0..16 {
        let Ok(metadata) = fs::symlink_metadata(&current) else { break };
        if !metadata.file_type().is_symlink() {
            break;
        }
        let Ok(target) = fs::read_link(&current) else { break };
        current = if target.is_absolute() {
            target
        } else {
            current.parent().map(|parent| parent.join(&target)).unwrap_or(target)
        };
        resolved = true;
    }
    resolved.then_some(current)
}

fn temp_path_for(path: &Path) -> PathBuf {
    let mut temp_path = path.to_path_buf();
    let extension = path.extension().and_then(|value| value.to_str());
    temp_path.set_extension(match extension {
        Some(extension) => format!("{extension}.tmp"),
        None => "tmp".to_string(),
    });
    temp_path
}

#[cfg(not(windows))]
fn replace_file(source: &Path, target: &Path) -> anyhow::Result<()> {
    fs::rename(source, target)?;
    Ok(())
}

#[cfg(windows)]
fn replace_file(source: &Path, target: &Path) -> anyhow::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Storage::FileSystem::{
        MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH, MoveFileExW,
    };
    use windows::core::PCWSTR;

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let target = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    // Codex 客户端 / 杀毒软件可能短暂持有目标文件的读句柄，MoveFileExW 会以
    // ERROR_ACCESS_DENIED / ERROR_SHARING_VIOLATION 失败。一次失败就让整次
    // 供应商切换报错对用户表现为「无法切换和保存供应商」（#2601 / #2500 /
    // #2612）。短退避重试几次，仍失败再把错误上抛。
    let mut last_error = None;
    for attempt in 0..6 {
        match unsafe {
            MoveFileExW(
                PCWSTR(source.as_ptr()),
                PCWSTR(target.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } {
            Ok(()) => return Ok(()),
            Err(error) => last_error = Some(error),
        }
        std::thread::sleep(std::time::Duration::from_millis(50 * (attempt + 1)));
    }
    Err(last_error
        .map(anyhow::Error::from)
        .unwrap_or_else(|| anyhow::anyhow!("替换文件失败")))
}
