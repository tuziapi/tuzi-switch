//! Explicit media export. Accepts bounded binary content, never a URL or path.
use base64::{engine::general_purpose::STANDARD, Engine};
use tauri_plugin_dialog::DialogExt;

const MAX_BYTES: usize = 128 * 1024 * 1024;

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
