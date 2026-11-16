//! Explicit media export. Accepts bounded binary content, never a URL or path.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{path::PathBuf, sync::Mutex};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const MAX_BYTES: usize = 128 * 1024 * 1024;
static VIDEO_OPERATIONS: Mutex<()> = Mutex::new(());
// Retain clipboard ownership on Linux after the IPC call returns.
static CLIPBOARD: Mutex<Option<arboard::Clipboard>> = Mutex::new(None);

#[derive(Clone, Copy, Debug, PartialEq)]
enum VideoAction {
    Copy,
    CopyPath,
    Reveal,
}

fn video_action(value: &str) -> Result<VideoAction, String> {
    match value {
        "copy" => Ok(VideoAction::Copy),
        "copy-path" => Ok(VideoAction::CopyPath),
        "reveal" => Ok(VideoAction::Reveal),
        _ => Err("不支持的视频操作".into()),
    }
}

fn video_root() -> PathBuf {
    #[cfg(feature = "isolated-profile")]
    let directory = crate::config::get_home_dir().join("Videos");
    #[cfg(not(feature = "isolated-profile"))]
    let directory =
        dirs::video_dir().unwrap_or_else(|| crate::config::get_home_dir().join("Videos"));
    directory.join("兔子助手")
}

fn copy_video_path(path: &std::path::Path, action: VideoAction) -> Result<(), String> {
    let mut clipboard = CLIPBOARD.lock().map_err(|_| "剪贴板正忙，请重试")?;
    if clipboard.is_none() {
        *clipboard = Some(arboard::Clipboard::new().map_err(|_| "无法访问系统剪贴板")?);
    }
    let clipboard = clipboard.as_mut().unwrap();
    match action {
        VideoAction::Copy => clipboard.set().file_list(&[path]),
        VideoAction::CopyPath => clipboard.set_text(path.to_string_lossy().into_owned()),
        VideoAction::Reveal => return Err("不支持的剪贴板操作".into()),
    }
    .map_err(|_| "复制视频失败，请检查剪贴板权限或使用另存为".into())
}

#[tauri::command]
pub async fn creative_video_action(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("仅主窗口可操作创作视频".into());
    }
    let action = video_action(
        request
            .headers()
            .get("x-media-action")
            .and_then(|v| v.to_str().ok())
            .unwrap_or(""),
    )?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if bytes.len() <= MAX_BYTES => bytes.clone(),
        _ => return Err("视频数据无效或超过 128 MB".into()),
    };
    let extension = media_extension(&bytes, "video")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _lock = VIDEO_OPERATIONS
            .lock()
            .map_err(|_| "视频操作正忙，请重试")?;
        let path = crate::creative_images::ensure_export_copy(&video_root(), &bytes, extension)?;
        if action == VideoAction::Reveal {
            app.opener().reveal_item_in_dir(&path).map_err(|_| {
                "视频已保存，但无法打开文件管理器，请到系统视频目录的“兔子助手”文件夹查看"
            })?;
            Ok("revealed".into())
        } else {
            copy_video_path(&path, action)?;
            Ok(if action == VideoAction::Copy {
                "copied"
            } else {
                "path-copied"
            }
            .into())
        }
    })
    .await
    .map_err(|_| "视频操作未完成，请重试".to_string())?
}

fn media_extension(bytes: &[u8], kind: &str) -> Result<&'static str, String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("媒体为空或超过 128 MB".into());
    }
    let extension = match kind {
        "video" | "audio" if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" => {
            if kind == "audio" {
                "m4a"
            } else {
                "mp4"
            }
        }
        "video" | "audio" if bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) => "webm",
        "video" | "audio" if bytes.starts_with(b"OggS") => "ogg",
        "audio" if bytes.len() >= 12 && bytes.starts_with(b"RIFF") && &bytes[8..12] == b"WAVE" => {
            "wav"
        }
        "audio" if bytes.starts_with(b"fLaC") => "flac",
        "audio" if bytes.starts_with(b"ID3") => "mp3",
        "audio" if bytes.len() >= 4 && bytes[0] == 0xff && bytes[1] & 0xf6 == 0xf0 => "aac",
        "audio" if bytes.len() >= 4 && bytes[0] == 0xff && bytes[1] & 0xe0 == 0xe0 => "mp3",
        "archive"
            if bytes.len() >= 22
                && (bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06")) =>
        {
            "zip"
        }
        _ => return Err("无法识别媒体格式，请确认生成结果完整后重试".into()),
    };
    Ok(extension)
}

#[tauri::command]
pub async fn creative_save_media(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("仅主窗口可导出创作媒体".into());
    }
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) if bytes.len() <= MAX_BYTES => bytes.clone(),
        _ => return Err("媒体数据无效或超过 128 MB".into()),
    };
    let kind = request
        .headers()
        .get("x-media-kind")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let extension = media_extension(&bytes, kind)?;
    let name = request
        .headers()
        .get("x-media-name")
        .filter(|v| v.len() <= 1024)
        .and_then(|v| STANDARD.decode(v.as_bytes()).ok())
        .and_then(|v| String::from_utf8(v).ok());
    let name = crate::creative_images::export_name(name.as_deref(), extension);
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("媒体文件", &[extension])
            .set_file_name(&name)
            .blocking_save_file()
        else {
            return Ok("cancelled".into());
        };
        let path = path.into_path().map_err(|_| "保存位置无效")?;
        let (path, replace) = crate::creative_images::save_destination(path, extension)?;
        crate::creative_images::write_atomic(&path, &bytes, replace)?;
        Ok("saved".into())
    })
    .await
    .map_err(|_| "媒体保存未完成，请重试".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_explicit_video_actions() {
        assert_eq!(video_action("copy").unwrap(), VideoAction::Copy);
        assert_eq!(video_action("copy-path").unwrap(), VideoAction::CopyPath);
        assert_eq!(video_action("reveal").unwrap(), VideoAction::Reveal);
        for value in ["", "delete", "/tmp/other", "save"] {
            assert!(video_action(value).is_err());
        }
    }

    #[test]
    fn video_copy_is_reused_recreated_and_protects_user_edits() {
        let bytes = include_bytes!("../../tests/visual/fixtures/synthetic-video.mp4");
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("兔子助手");
        let ensure = || crate::creative_images::ensure_export_copy(&root, bytes, "mp4").unwrap();
        let first = ensure();
        assert_eq!(std::fs::read(&first).unwrap(), bytes);
        assert_eq!(ensure(), first);
        std::fs::remove_file(&first).unwrap();
        assert_eq!(ensure(), first);
        let edited = vec![42; bytes.len()];
        std::fs::write(&first, &edited).unwrap();
        let second = ensure();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).unwrap(), edited);
        assert_eq!(std::fs::read(&second).unwrap(), bytes);
        assert_eq!(ensure(), second);
    }

    /// Explicit opt-in: touches the real OS clipboard, never runs in normal CI.
    #[test]
    #[ignore = "requires an interactive desktop and changes the system clipboard"]
    fn real_video_file_and_path_clipboard_roundtrip() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("视频 空格-test.mp4");
        let bytes = include_bytes!("../../tests/visual/fixtures/synthetic-video.mp4");
        std::fs::write(&path, bytes).unwrap();
        copy_video_path(&path, VideoAction::Copy).unwrap();
        let mut reader = arboard::Clipboard::new().unwrap();
        let files = reader.get().file_list().unwrap();
        assert_eq!(files, vec![path.canonicalize().unwrap()]);
        assert_eq!(std::fs::read(&files[0]).unwrap(), bytes);
        copy_video_path(&path, VideoAction::CopyPath).unwrap();
        assert_eq!(reader.get_text().unwrap(), path.to_string_lossy());
        reader.clear().unwrap();
    }

    #[test]
    fn exports_original_mp4_and_wav_with_truthful_extensions() {
        for (bytes, kind, expected) in [
            (
                include_bytes!("../../tests/visual/fixtures/synthetic-video.mp4").as_slice(),
                "video",
                "mp4",
            ),
            (
                include_bytes!("../../tests/visual/fixtures/synthetic-audio.wav").as_slice(),
                "audio",
                "wav",
            ),
        ] {
            assert_eq!(media_extension(bytes, kind).unwrap(), expected);
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join(format!("result.{expected}"));
            crate::creative_images::write_atomic(&path, bytes, false).unwrap();
            assert_eq!(std::fs::read(path).unwrap(), bytes);
        }
    }

    #[test]
    fn rejects_error_pages_invalid_kinds_and_wrong_media_types() {
        for (data, kind) in [
            (b"<html>failure</html>".as_slice(), "video"),
            (b"{\"error\":\"failed\"}".as_slice(), "audio"),
            (b"ID3synthetic".as_slice(), "video"),
            (b"ID3synthetic".as_slice(), "arbitrary"),
            (b"".as_slice(), "audio"),
        ] {
            assert!(media_extension(data, kind).is_err());
        }
        assert_eq!(media_extension(b"ID3synthetic", "audio").unwrap(), "mp3");
    }
}
