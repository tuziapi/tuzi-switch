//! Explicit, user-triggered image clipboard/export. Never accepts a URL or path.
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat, ImageReader, Limits};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    io::{Cursor, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_PIXELS: u64 = 32 * 1024 * 1024;
static IMAGE_OPERATIONS: Mutex<()> = Mutex::new(());
// Keep ownership alive on Linux after returning from the command.
static CLIPBOARD: Mutex<Option<arboard::Clipboard>> = Mutex::new(None);

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageAction {
    Copy,
    Save,
    Reveal,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImageRequest {
    action: ImageAction,
    data: String,
    name: Option<String>,
}

fn decode(data: &str) -> Result<(Vec<u8>, DynamicImage, &'static str), String> {
    if data.len() > MAX_BYTES.div_ceil(3) * 4 {
        return Err("图片超过 64 MB".into());
    }
    let bytes = STANDARD.decode(data).map_err(|_| "图片数据无效")?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("图片为空或超过 64 MB".into());
    }
    let format = image::guess_format(&bytes).map_err(|_| "无法识别图片格式")?;
    let extension = match format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
        ImageFormat::WebP => "webp",
        ImageFormat::Gif => "gif",
        _ => return Err("暂支持 PNG、JPEG、WebP 和 GIF 图片".into()),
    };
    let (width, height) = ImageReader::with_format(Cursor::new(&bytes), format)
        .into_dimensions()
        .map_err(|_| "图片尺寸无效")?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("图片尺寸过大，暂支持不超过 3200 万像素的图片".into());
    }
    let mut reader = ImageReader::with_format(Cursor::new(&bytes), format);
    let mut limits = Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let decoded = reader
        .decode()
        .map_err(|_| "图片无法解码，请检查原文件是否完整")?;
    Ok((bytes, decoded, extension))
}

fn export_name(name: Option<&str>, extension: &str) -> String {
    let name = name.unwrap_or("opentu-image");
    let cleaned: String = name
        .chars()
        .take(80)
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let cleaned = cleaned.trim().trim_matches('.');
    let stem = Path::new(cleaned)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("opentu-image");
    // Prefix prevents Windows reserved names (CON, AUX, etc.).
    format!(
        "opentu-{}.{}",
        if stem.is_empty() { "image" } else { stem },
        extension
    )
}

fn picture_root() -> Result<PathBuf, String> {
    #[cfg(feature = "isolated-profile")]
    let directory = crate::config::get_home_dir().join("Pictures");
    #[cfg(not(feature = "isolated-profile"))]
    let directory =
        dirs::picture_dir().unwrap_or_else(|| crate::config::get_home_dir().join("Pictures"));
    Ok(directory.join("兔子助手"))
}

// Keep the saved extension truthful. A dialog-approved overwrite applies only to
// the exact selected path; adding an omitted suffix must never overwrite silently.
fn save_destination(mut path: PathBuf, extension: &str) -> Result<(PathBuf, bool), String> {
    match path.extension().and_then(|s| s.to_str()) {
        None => {
            path.set_extension(extension);
            Ok((path, false))
        }
        Some(ext)
            if ext.eq_ignore_ascii_case(extension)
                || (extension == "jpg" && ext.eq_ignore_ascii_case("jpeg")) =>
        {
            Ok((path, true))
        }
        _ => Err(format!("原图格式是 {extension}，请使用对应的文件后缀")),
    }
}

fn write_atomic(path: &Path, bytes: &[u8], replace: bool) -> Result<(), String> {
    let parent = path.parent().ok_or("保存位置无效")?;
    if std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("目标是链接文件，请选择普通文件位置".into());
    }
    let mut file =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建图片文件，请检查目录权限")?;
    file.write_all(bytes)
        .and_then(|_| file.as_file().sync_all())
        .map_err(|_| "图片写入失败，请检查磁盘空间")?;
    if replace {
        file.persist(path)
    } else {
        file.persist_noclobber(path)
    }
    .map_err(|_| "保存图片失败，请检查文件是否被占用")?;
    Ok(())
}

fn ensure_picture(root: &Path, bytes: &[u8], extension: &str) -> Result<PathBuf, String> {
    if std::fs::symlink_metadata(root).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err("图片导出目录是符号链接，请使用另存为".into());
    }
    std::fs::create_dir_all(root).map_err(|_| "无法创建图片目录，请使用另存为选择位置")?;
    let hash = format!("{:x}", Sha256::digest(bytes));
    for n in 0..1000 {
        let suffix = if n == 0 {
            String::new()
        } else {
            format!("-{n}")
        };
        let path = root.join(format!("opentu-{}{suffix}.{extension}", &hash[..24]));
        match std::fs::symlink_metadata(&path) {
            Ok(meta) if meta.is_file() && !meta.file_type().is_symlink() => {
                if meta.len() == bytes.len() as u64
                    && std::fs::read(&path).map_err(|_| "无法读取已有图片副本")? == bytes
                {
                    return Ok(path);
                }
                // A user edited this copy: leave it intact and create another.
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                write_atomic(&path, bytes, false)?;
                return Ok(path);
            }
            Err(_) => return Err("无法访问图片目录".into()),
        }
    }
    Err("同名图片过多，请使用另存为".into())
}

#[tauri::command]
pub async fn creative_image_action(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    request: ImageRequest,
) -> Result<String, String> {
    if window.label() != "main" {
        return Err("仅主窗口可操作创作图片".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, decoded, extension) = decode(&request.data)?;
        match request.action {
            ImageAction::Copy => {
                let rgba = decoded.into_rgba8();
                let mut clipboard = CLIPBOARD.lock().map_err(|_| "剪贴板正忙，请重试")?;
                if clipboard.is_none() {
                    *clipboard = Some(arboard::Clipboard::new().map_err(|_| "无法访问系统剪贴板")?);
                }
                clipboard
                    .as_mut()
                    .unwrap()
                    .set_image(arboard::ImageData {
                        width: rgba.width() as usize,
                        height: rgba.height() as usize,
                        bytes: Cow::Owned(rgba.into_raw()),
                    })
                    .map_err(|_| "复制图片失败，请检查剪贴板权限")?;
                Ok("copied".into())
            }
            ImageAction::Save => {
                let name = export_name(request.name.as_deref(), extension);
                let Some(path) = app
                    .dialog()
                    .file()
                    .add_filter("图片", &[extension])
                    .set_file_name(&name)
                    .blocking_save_file()
                else {
                    return Ok("cancelled".into());
                };
                let path = path.into_path().map_err(|_| "保存位置无效")?;
                let (path, replace) = save_destination(path, extension)?;
                write_atomic(&path, &bytes, replace)?;
                Ok("saved".into())
            }
            ImageAction::Reveal => {
                let _lock = IMAGE_OPERATIONS
                    .lock()
                    .map_err(|_| "图片保存正忙，请重试")?;
                let path = ensure_picture(&picture_root()?, &bytes, extension)?;
                app.opener().reveal_item_in_dir(&path).map_err(|_| {
                    "图片已保存，但无法打开文件管理器，请到系统图片目录的“兔子助手”文件夹查看"
                })?;
                Ok("revealed".into())
            }
        }
    })
    .await
    .map_err(|_| "图片操作未完成，请重试".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png() -> Vec<u8> {
        let mut data = Cursor::new(Vec::new());
        DynamicImage::new_rgba8(2, 3)
            .write_to(&mut data, ImageFormat::Png)
            .unwrap();
        data.into_inner()
    }

    #[test]
    fn decodes_supported_formats_and_preserves_original_bytes() {
        for format in [
            ImageFormat::Png,
            ImageFormat::Jpeg,
            ImageFormat::WebP,
            ImageFormat::Gif,
        ] {
            let mut bytes = Cursor::new(Vec::new());
            DynamicImage::new_rgb8(2, 3)
                .write_to(&mut bytes, format)
                .unwrap();
            let bytes = bytes.into_inner();
            let (original, image, extension) = decode(&STANDARD.encode(&bytes)).unwrap();
            assert_eq!(original, bytes);
            assert_eq!((image.width(), image.height()), (2, 3));
            assert_eq!(
                extension,
                match format {
                    ImageFormat::Png => "png",
                    ImageFormat::Jpeg => "jpg",
                    ImageFormat::WebP => "webp",
                    _ => "gif",
                }
            );
        }
    }

    #[test]
    fn rejects_empty_corrupt_or_unsupported_content() {
        for value in [
            "".to_owned(),
            "!invalid".into(),
            STANDARD.encode(b"<html>error</html>"),
            STANDARD.encode(&png()[..30]),
        ] {
            assert!(decode(&value).is_err());
        }
        assert!(serde_json::from_str::<ImageRequest>(
            r#"{"action":"reveal","data":"","path":"/tmp/arbitrary"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<ImageRequest>(r#"{"action":"delete","data":""}"#).is_err());
    }

    #[test]
    fn rejects_oversized_encoded_data_before_decoding() {
        assert!(decode(&"A".repeat(MAX_BYTES.div_ceil(3) * 4 + 1))
            .unwrap_err()
            .contains("64 MB"));
    }

    #[test]
    fn reuses_identical_copy_and_recreates_deleted_copy() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("兔子助手");
        let bytes = png();
        let first = ensure_picture(&root, &bytes, "png").unwrap();
        assert_eq!(std::fs::read(&first).unwrap(), bytes);
        assert_eq!(ensure_picture(&root, &bytes, "png").unwrap(), first);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_file(&first).unwrap();
        assert_eq!(ensure_picture(&root, &bytes, "png").unwrap(), first);
        assert_eq!(std::fs::read(&first).unwrap(), bytes);
    }

    #[test]
    fn preserves_user_modified_copy_and_reuses_new_copy() {
        let temp = tempfile::tempdir().unwrap();
        let bytes = png();
        let first = ensure_picture(temp.path(), &bytes, "png").unwrap();
        // Same length but different bytes must also be preserved.
        let modified = vec![42; bytes.len()];
        std::fs::write(&first, &modified).unwrap();
        let second = ensure_picture(temp.path(), &bytes, "png").unwrap();
        assert_ne!(first, second);
        assert_eq!(std::fs::read(&first).unwrap(), modified);
        assert_eq!(std::fs::read(&second).unwrap(), bytes);
        assert_eq!(ensure_picture(temp.path(), &bytes, "png").unwrap(), second);
    }

    #[test]
    fn save_suffix_matches_original_and_never_overwrites_unconfirmed_path() {
        assert_eq!(
            save_destination("image".into(), "png").unwrap(),
            ("image.png".into(), false)
        );
        assert_eq!(
            save_destination("image.JPEG".into(), "jpg").unwrap(),
            ("image.JPEG".into(), true)
        );
        assert!(save_destination("image.exe".into(), "png").is_err());
    }

    #[test]
    fn atomic_no_clobber_preserves_existing_files() {
        let temp = tempfile::tempdir().unwrap();
        let target = temp.path().join("original.png");
        std::fs::write(&target, b"original").unwrap();
        assert!(write_atomic(&target, b"new", false).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        write_atomic(&target, b"new", true).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new");
        assert_eq!(std::fs::read_dir(temp.path()).unwrap().count(), 1);
    }

    #[test]
    fn safe_filename_cannot_traverse_and_uses_content_extension() {
        assert_eq!(export_name(Some("CON.exe"), "png"), "opentu-CON.png");
        let name = export_name(Some("../../folder\\image\n.webp"), "jpg");
        assert!(!name.contains(['/', '\\', '\n']));
        assert!(name.ends_with(".jpg"));
        assert_eq!(export_name(Some("..."), "gif"), "opentu-opentu-image.gif");
    }

    #[cfg(unix)]
    #[test]
    fn does_not_follow_export_directory_or_file_symlinks() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let outside = temp.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        let root = temp.path().join("pictures");
        symlink(&outside, &root).unwrap();
        assert!(ensure_picture(&root, &png(), "png").is_err());
        std::fs::remove_file(&root).unwrap();
        let first = ensure_picture(&root, &png(), "png").unwrap();
        let outside_file = outside.join("user.png");
        std::fs::write(&outside_file, b"keep").unwrap();
        std::fs::remove_file(&first).unwrap();
        symlink(&outside_file, &first).unwrap();
        assert!(write_atomic(&first, &png(), true).is_err());
        let next = ensure_picture(&root, &png(), "png").unwrap();
        assert_ne!(next, first);
        assert_eq!(std::fs::read(outside_file).unwrap(), b"keep");
    }
}
