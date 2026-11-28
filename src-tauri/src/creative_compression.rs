//! Offline, bounded media processing through the packaged engine. Never searches PATH.
use std::{path::Path, process::Stdio, sync::Mutex, time::Duration};
use tauri::{Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::watch,
};

const MAX_BYTES: usize = 128 * 1024 * 1024;
static ACTIVE: Mutex<Option<(String, watch::Sender<bool>)>> = Mutex::new(None);

pub fn cancel_all() {
    if let Ok(active) = ACTIVE.lock() {
        if let Some((_, tx)) = active.as_ref() {
            let _ = tx.send(true);
        }
    }
}

pub async fn shutdown() {
    cancel_all();
    for _ in 0..40 {
        if ACTIVE.lock().map(|active| active.is_none()).unwrap_or(true) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

struct ActiveGuard(String);
impl Drop for ActiveGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = ACTIVE.lock() {
            if active.as_ref().map(|v| &v.0) == Some(&self.0) {
                *active = None;
            }
        }
    }
}

fn validate_input(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 12 || bytes.len() > MAX_BYTES {
        return Err("视频为空或超过 128 MB".into());
    }
    if &bytes[4..8] != b"ftyp" && !bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]) {
        return Err("请选择完整的 MP4、MOV 或 WebM 视频".into());
    }
    Ok(())
}

fn compression_args(quality: &str, resolution: &str, audio: &str) -> Result<Vec<String>, String> {
    let crf = match quality {
        "high" => "22",
        "balanced" => "26",
        "small" => "30",
        _ => return Err("压缩质量无效".into()),
    };
    // Keep source size by default, with a 4K ceiling. The proportional scale never enlarges.
    let (long, short) = match resolution {
        "original" => (3840, 2160),
        "1080p" => (1920, 1080),
        "720p" => (1280, 720),
        _ => return Err("压缩尺寸无效".into()),
    };
    let mut args: Vec<String> = [
        "-map", "0:v:0", "-c:v", "libx264", "-preset", "medium", "-crf", crf, "-pix_fmt",
        "yuv420p", "-threads", "2", "-vf",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    args.push(format!("scale=w='max(2,trunc(min(iw*sar,if(gte(dar,1),min({long},{short}*dar),min({short},{long}*dar)))/2)*2)':h='max(2,trunc(ow/dar/2)*2)',setsar=1"));
    match audio {
        "keep" => args.extend(
            ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k"]
                .into_iter()
                .map(str::to_string),
        ),
        "remove" => args.push("-an".into()),
        _ => return Err("音频选项无效".into()),
    }
    args.extend(
        [
            "-map_metadata",
            "-1",
            "-map_chapters",
            "-1",
            "-movflags",
            "+faststart",
            "-fs",
            "134217728",
            "-f",
            "mp4",
        ]
        .into_iter()
        .map(str::to_string),
    );
    Ok(args)
}

#[derive(Clone, serde::Serialize)]
struct Progress {
    id: String,
    seconds: f64,
}

async fn compress(
    engine: &Path,
    bytes: &[u8],
    args: Vec<String>,
    mut cancel: watch::Receiver<bool>,
    mut progress: impl FnMut(f64),
) -> Result<Vec<u8>, String> {
    validate_input(bytes)?;
    let temp = tempfile::tempdir().map_err(|_| "无法创建压缩临时目录，请检查磁盘空间")?;
    let input = temp.path().join("input.media");
    let output = temp.path().join("output.mp4");
    tokio::fs::write(&input, bytes)
        .await
        .map_err(|_| "无法暂存视频，请检查磁盘空间")?;
    if *cancel.borrow() {
        return Err("已取消压缩，原视频未改动".into());
    }
    let mut command = Command::new(engine);
    command
        .args([
            "-hide_banner",
            "-nostdin",
            "-v",
            "error",
            "-progress",
            "pipe:1",
            "-nostats",
            "-protocol_whitelist",
            "file,pipe",
            "-threads",
            "2",
            "-i",
        ])
        .arg(&input)
        .args(args)
        .arg(&output)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(target_os = "windows")]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|_| "无法启动内置压缩引擎，请重新安装完整测试包")?;
    let mut lines = BufReader::new(child.stdout.take().ok_or("压缩进度不可用")?).lines();
    // Drain stderr continuously, retain no input filenames or media content in logs.
    let stderr = child.stderr.take().ok_or("压缩引擎不可用")?;
    let drain = tokio::spawn(async move {
        let mut stderr = stderr;
        let mut buffer = [0; 4096];
        loop {
            match stderr.read(&mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
        }
    });
    let deadline = tokio::time::sleep(Duration::from_secs(7200));
    tokio::pin!(deadline);
    let result = loop {
        tokio::select! {
            _ = cancel.changed() => { let _ = child.kill().await; break Err("已取消压缩，原视频未改动".into()); }
            _ = &mut deadline => { let _ = child.kill().await; break Err("压缩超时，请使用较短的视频".into()); }
            line = lines.next_line() => match line {
                Ok(Some(line)) => if let Some(value) = line.strip_prefix("out_time_us=").and_then(|v| v.parse::<f64>().ok()).filter(|v| v.is_finite() && *v >= 0.0) { progress(value / 1_000_000.0); },
                Ok(None) => break child.wait().await.map_err(|_| "压缩引擎意外退出".to_string()).and_then(|status| if status.success() { Ok(()) } else { Err("压缩失败：视频可能损坏或编码不受支持".into()) }),
                Err(_) => { let _ = child.kill().await; break Err("读取压缩进度失败".into()); }
            }
        }
    };
    let _ = drain.await;
    result?;
    let size = tokio::fs::metadata(&output)
        .await
        .map_err(|_| "压缩未输出视频")?
        .len();
    if size < 12 || size >= MAX_BYTES as u64 {
        return Err("输出达到 128 MB 上限，已丢弃不完整结果；请选择更小体积档位".into());
    }
    let result = tokio::fs::read(output)
        .await
        .map_err(|_| "无法读取压缩结果")?;
    validate_input(&result)?;
    Ok(result)
}

#[tauri::command]
pub async fn creative_compress_video(
    app: tauri::AppHandle,
    window: tauri::Webview,
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    if window.label() != "main" {
        return Err("仅主窗口可压缩视频".into());
    }
    let header = |key| {
        request
            .headers()
            .get(key)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
    };
    let id = header("x-compression-id").to_string();
    if uuid::Uuid::parse_str(&id).is_err() {
        return Err("压缩任务编号无效".into());
    }
    let args = compression_args(
        header("x-compression-quality"),
        header("x-compression-resolution"),
        header("x-compression-audio"),
    )?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => {
            validate_input(bytes)?;
            bytes.clone()
        }
        _ => return Err("视频数据无效".into()),
    };
    let engine = app
        .path()
        .resource_dir()
        .map_err(|_| "找不到压缩引擎")?
        .join("media-runtime")
        .join(if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
    if !engine.is_file() {
        return Err("此安装包缺少视频压缩引擎，请安装完整测试版".into());
    }
    let (tx, rx) = watch::channel(false);
    {
        let mut active = ACTIVE.lock().map_err(|_| "压缩状态不可用")?;
        if active.is_some() {
            return Err("已有视频正在压缩，请完成或取消后再试".into());
        }
        *active = Some((id.clone(), tx));
    }
    let _guard = ActiveGuard(id.clone());
    let _ = window.emit(
        "creative-compression-progress",
        Progress {
            id: id.clone(),
            seconds: 0.0,
        },
    );
    let result = compress(&engine, &bytes, args, rx, |seconds| {
        let _ = window.emit(
            "creative-compression-progress",
            Progress {
                id: id.clone(),
                seconds,
            },
        );
    })
    .await?;
    Ok(tauri::ipc::Response::new(result))
}

#[tauri::command]
pub fn creative_cancel_compression(window: tauri::Webview, id: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("仅主窗口可取消压缩".into());
    }
    let active = ACTIVE.lock().map_err(|_| "压缩状态不可用")?;
    if let Some((active_id, tx)) = active.as_ref() {
        if active_id == &id {
            let _ = tx.send(true);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_bounded_media_and_fixed_options() {
        assert!(validate_input(b"not-a-media-file").is_err());
        assert!(validate_input(include_bytes!(
            "../../tests/visual/fixtures/synthetic-video.mp4"
        ))
        .is_ok());
        assert!(compression_args("-i remote", "720p", "keep").is_err());
        assert!(compression_args("balanced", "file:///tmp", "keep").is_err());
        assert!(compression_args("balanced", "720p", "unknown").is_err());
        let args = compression_args("small", "720p", "remove").unwrap();
        assert!(args.contains(&"-an".into()));
        assert!(!args.contains(&"0:a:0?".into()));
    }
    #[tokio::test]
    #[ignore = "requires the prepared packaged compression engine"]
    async fn packaged_engine_compresses_and_cancels() {
        let engine = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/media-runtime")
            .join(if cfg!(windows) {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            });
        let bytes = include_bytes!("../../tests/visual/fixtures/synthetic-video.mp4");
        let (_tx, rx) = watch::channel(false);
        let result = compress(
            &engine,
            bytes,
            compression_args("balanced", "720p", "keep").unwrap(),
            rx,
            |_| {},
        )
        .await
        .unwrap();
        assert!(result.len() > 12);
        let (tx, rx) = watch::channel(true);
        let result = compress(
            &engine,
            bytes,
            compression_args("balanced", "720p", "keep").unwrap(),
            rx,
            |_| {},
        )
        .await;
        assert!(result.unwrap_err().contains("取消"));
        drop(tx);
    }
}
