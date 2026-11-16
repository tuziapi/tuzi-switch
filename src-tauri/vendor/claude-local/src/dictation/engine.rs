//! 本地 SenseVoice 转写引擎：模型下载 / 校验、常驻识别线程、16 kHz PCM 转写。
//! 与 Codex++ 的本地听写共用这一份（模型目录也共用：`$CODEX_HOME` 或 `~/.codex` 下的
//! `speech-to-text/sensevoice-onnx`，两个程序下载一次即可）。

use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// 单次转写的音频上限（与 Codex++ 的听写接口一致）。
pub const MAX_AUDIO_BODY_BYTES: usize = 25 * 1024 * 1024;
const PCM_WAV_HEADER_BYTES: usize = 44;
static LOCAL_RECOGNIZER_SLOTS: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(1)));
static LOCAL_DOWNLOAD_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static LOCAL_DOWNLOAD_STATE: LazyLock<Mutex<Value>> =
    LazyLock::new(|| Mutex::new(json!({ "phase": "idle" })));


const SENSEVOICE_MODEL_URL: &str = "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx";
const SENSEVOICE_MODEL_BYTES: u64 = 239_233_841;
const SENSEVOICE_MODEL_SHA256: &str =
    "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51";
const SENSEVOICE_TOKENS_URL: &str = "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt";
const SENSEVOICE_TOKENS_BYTES: u64 = 315_894;
const SENSEVOICE_TOKENS_SHA256: &str =
    "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc";

/// 转写失败：`status` 用 HTTP 状态码表达类别（400 输入、403 未启用、429 忙、503 模型未就绪等）。
#[derive(Debug, Clone)]
pub struct EngineError {
    pub status: u16,
    pub message: String,
}

impl EngineError {
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for EngineError {}

/// 模型目录：`$CODEX_HOME`（绝对路径时）或 `~/.codex` 下的 `speech-to-text/sensevoice-onnx`。
pub fn model_dir() -> PathBuf {
    let home = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.is_dir())
        .or_else(|| directories::BaseDirs::new().map(|dirs| dirs.home_dir().join(".codex")))
        .unwrap_or_else(|| PathBuf::from(".codex"));
    home.join("speech-to-text").join("sensevoice-onnx")
}

/// 只看文件大小（不算 SHA-256）：状态展示用，真正加载前还会全量校验。
pub fn model_ready() -> bool {
    let root = model_dir();
    SENSEVOICE_ASSETS.iter().all(|asset| {
        std::fs::metadata(root.join(asset.name))
            .is_ok_and(|meta| meta.is_file() && meta.len() == asset.bytes)
    })
}
#[derive(Clone, Copy)]
struct LocalAsset {
    name: &'static str,
    url: &'static str,
    bytes: u64,
    sha256: &'static str,
}

const SENSEVOICE_ASSETS: [LocalAsset; 2] = [
    LocalAsset {
        name: "model.int8.onnx",
        url: SENSEVOICE_MODEL_URL,
        bytes: SENSEVOICE_MODEL_BYTES,
        sha256: SENSEVOICE_MODEL_SHA256,
    },
    LocalAsset {
        name: "tokens.txt",
        url: SENSEVOICE_TOKENS_URL,
        bytes: SENSEVOICE_TOKENS_BYTES,
        sha256: SENSEVOICE_TOKENS_SHA256,
    },
];

fn local_asset_verified(path: &std::path::Path, asset: &LocalAsset) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() || meta.len() != asset.bytes {
        return false;
    }
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 1024 * 1024];
    loop {
        match std::io::Read::read(&mut file, &mut buffer) {
            Ok(0) => break,
            Ok(length) => digest.update(&buffer[..length]),
            Err(_) => return false,
        }
    }
    format!("{:x}", digest.finalize()) == asset.sha256
}

/// 配置页只读取缓存与任务状态，不触发下载。
pub fn model_status() -> Value {
    let mut state = LOCAL_DOWNLOAD_STATE
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    state["modelReady"] = json!(model_ready());
    state["totalBytes"] = json!(SENSEVOICE_MODEL_BYTES + SENSEVOICE_TOKENS_BYTES);
    state
}

fn publish_local_download(state: Value) {
    *LOCAL_DOWNLOAD_STATE
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = state;
}

/// 仅管理器的手动下载按钮调用；转写入口绝不调用此函数。
pub async fn prepare_model() -> Result<Value, EngineError> {
    let _guard = LOCAL_DOWNLOAD_LOCK
        .try_lock()
        .map_err(|_| EngineError::new(409, "本地语音模型正在下载，请等待"))?;
    publish_local_download(json!({ "phase": "downloading", "completedBytes": 0 }));
    let result = async {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(3_600))
            .user_agent("ClaudeLocal SenseVoice/1.0")
            .build()
            .map_err(|_| EngineError::new(502, "无法创建本地语音模型连接"))?;
        let mut completed = 0;
        for asset in &SENSEVOICE_ASSETS {
            download_local_asset(&client, asset, completed, &model_dir()).await?;
            completed += asset.bytes;
        }
        Ok::<(), EngineError>(())
    }
    .await;
    match result {
        Ok(()) => {
            publish_local_download(
                json!({ "phase": "ready", "completedBytes": SENSEVOICE_MODEL_BYTES + SENSEVOICE_TOKENS_BYTES }),
            );
            Ok(model_status())
        }
        Err(error) => {
            publish_local_download(json!({ "phase": "failed", "message": error.message }));
            Err(error)
        }
    }
}

/// 检查本地缓存的固定大小与 SHA-256；缺失或损坏时只报错，不创建目录、不联网。
fn verified_local_assets(root: &std::path::Path) -> Result<Vec<PathBuf>, EngineError> {
    SENSEVOICE_ASSETS
        .iter()
        .map(|asset| {
            let path = root.join(asset.name);
            if local_asset_verified(&path, asset) {
                Ok(path)
            } else {
                Err(EngineError::new(
                    400,
                    "SenseVoice 模型缺失或校验失败，请在语音输入配置页手动下载",
                ))
            }
        })
        .collect()
}

async fn download_local_asset(
    client: &reqwest::Client,
    asset: &LocalAsset,
    completed: u64,
    root: &std::path::Path,
) -> Result<PathBuf, EngineError> {
    publish_local_download(
        json!({ "phase": "downloading", "resource": asset.name, "completedBytes": completed }),
    );
    tokio::fs::create_dir_all(root)
        .await
        .map_err(|_| EngineError::new(500, "无法创建本地语音模型目录"))?;
    let destination = root.join(asset.name);
    let verified = tokio::task::spawn_blocking({
        let destination = destination.clone();
        let asset = *asset;
        move || local_asset_verified(&destination, &asset)
    })
    .await
    .unwrap_or(false);
    if verified {
        return Ok(destination);
    }
    let partial = root.join(format!("{}.{}.part", asset.name, uuid::Uuid::new_v4()));
    let mirror_url = asset
        .url
        .replacen("https://huggingface.co", "https://hf-mirror.com", 1);
    let mut last_error = None;
    for url in [asset.url.to_string(), mirror_url] {
        let response = match client.get(&url).send().await {
            Ok(response)
                if response.status().is_success()
                    && response
                        .content_length()
                        .is_none_or(|length| length == asset.bytes) =>
            {
                response
            }
            Ok(response) => {
                last_error = Some(format!("HTTP {}", response.status().as_u16()));
                continue;
            }
            Err(_) => {
                last_error = Some("无法连接模型下载源".to_string());
                continue;
            }
        };
        let mut file = match tokio::fs::File::create(&partial).await {
            Ok(file) => file,
            Err(_) => return Err(EngineError::new(500, "无法写入本地语音模型缓存")),
        };
        let mut digest = Sha256::new();
        let mut bytes = 0u64;
        let mut stream = response.bytes_stream();
        let mut failed = None;
        while let Some(chunk) = stream.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(_) => {
                    failed = Some("模型下载中断，请重试".to_string());
                    break;
                }
            };
            bytes = bytes.saturating_add(chunk.len() as u64);
            if bytes > asset.bytes {
                failed = Some("模型文件大小超过预期".to_string());
                break;
            }
            if tokio::io::AsyncWriteExt::write_all(&mut file, &chunk)
                .await
                .is_err()
            {
                failed = Some("写入模型文件失败".to_string());
                break;
            }
            digest.update(&chunk);
            publish_local_download(
                json!({ "phase": "downloading", "resource": asset.name, "completedBytes": completed + bytes }),
            );
        }
        if failed.is_none()
            && (bytes != asset.bytes || format!("{:x}", digest.finalize()) != asset.sha256)
        {
            failed = Some("模型文件完整性校验失败".to_string());
        }
        // tokio 的 write_all 只把数据交给后台线程，不 flush 就 drop/rename，文件可能还没写完：
        // 发布出去的是半截模型，随后的校验在 Windows 上会失败（CI 偶发红过）。
        if failed.is_none() && tokio::io::AsyncWriteExt::flush(&mut file).await.is_err() {
            failed = Some("写入模型文件失败".to_string());
        }
        drop(file);
        if failed.is_none() {
            if tokio::fs::rename(&partial, &destination).await.is_ok() {
                return Ok(destination);
            }
            failed = Some("无法发布模型缓存文件".to_string());
        }
        let _ = tokio::fs::remove_file(&partial).await;
        last_error = failed;
    }
    Err(EngineError::new(
        502,
        format!(
            "本地 SenseVoice 模型下载失败{}",
            last_error.map(|e| format!("：{e}")).unwrap_or_default()
        ),
    ))
}

fn validate_local_wav(audio: &[u8]) -> Result<(), EngineError> {
    if audio.len() < 44 || &audio[..4] != b"RIFF" || &audio[8..12] != b"WAVE" {
        return Err(EngineError::new(400, "本地 SenseVoice 需要 WAV 音频"));
    }
    if u16::from_le_bytes([audio[20], audio[21]]) != 1
        || u16::from_le_bytes([audio[22], audio[23]]) != 1
        || u32::from_le_bytes([audio[24], audio[25], audio[26], audio[27]]) != 16_000
        || u16::from_le_bytes([audio[34], audio[35]]) != 16
    {
        return Err(EngineError::new(
            400,
            "本地 SenseVoice 需要 16 kHz 单声道 PCM WAV",
        ));
    }
    Ok(())
}

/// 进程级缓存的本地 SenseVoice recognizer。
///
/// 之前每次转写都重新 `OfflineRecognizer::create`，实测 1 秒音频也要 9~18 秒，而且耗时
/// 几乎与音频长度无关——瓶颈是 239 MB 模型的加载与特征提取器初始化，不是解码。模型和
/// 语言不变时复用同一个 recognizer，单次转写只剩解码与传输；代价是常驻一份模型内存。
struct CachedLocalRecognizer {
    model: PathBuf,
    tokens: PathBuf,
    language: String,
    /// 两个资产文件各自的 (大小, 修改时间)；任一变化都要重建 recognizer。
    signature: ((u64, u64), (u64, u64)),
    recognizer: sherpa_onnx::OfflineRecognizer,
}

/// 本地识别的专用线程。
///
/// sherpa 的 `OfflineRecognizer` 由 crate 手动标了 `Send`/`Sync`，但它内部是 C++ 句柄
/// 加自建线程池。实测在高频复用下出现过 helper 进程静默退出的情况（无崩溃报告），
/// 而单线程复用时各类场景都稳定。所以把加载与解码都固定在同一个线程里：既不跨线程
/// 碰 FFI 句柄，也天然把并发请求排成一条队，串行语义不再依赖 tokio 阻塞池的调度。
enum LocalRecognizerRequest {
    Transcribe {
        samples: Vec<f32>,
        language: String,
        reply: std::sync::mpsc::Sender<Result<String, EngineError>>,
    },
}

static LOCAL_RECOGNIZER_TX: LazyLock<Option<std::sync::mpsc::Sender<LocalRecognizerRequest>>> =
    LazyLock::new(|| {
        let (sender, receiver) = std::sync::mpsc::channel::<LocalRecognizerRequest>();
        std::thread::Builder::new()
            .name("claude-local-dictation".to_string())
            .spawn(move || local_recognizer_loop(receiver))
            .map(|_| sender)
            .ok()
    });

fn local_recognizer_loop(receiver: std::sync::mpsc::Receiver<LocalRecognizerRequest>) {
    let mut cached: Option<CachedLocalRecognizer> = None;
    while let Ok(LocalRecognizerRequest::Transcribe {
        samples,
        language,
        reply,
    }) = receiver.recv()
    {
        let result = recognize_local(&mut cached, &samples, &language);
        // 调用方已经走远时忽略发送失败：这条线程只负责把结果交回去。
        let _ = reply.send(result);
    }
}

/// SenseVoice 只吃 16 kHz 单声道，这个值同时是 `validate_local_wav` 校验过的采样率。
const LOCAL_SAMPLE_RATE: i32 = 16_000;

/// 轻量文件指纹：加载过的模型只要大小与修改时间没变就直接复用。
fn local_asset_signature(path: &Path) -> Option<(u64, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let modified = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_secs();
    Some((meta.len(), modified))
}

/// 16 kHz 单声道 PCM 转 f32 样本；调用前 `validate_local_wav` 已确认头部格式。
fn local_wav_samples(audio: &[u8]) -> Vec<f32> {
    audio[44..]
        .chunks_exact(2)
        .map(|pair| i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32_768.0)
        .collect()
}

fn spawn_local_recognizer_waiter<T: Send + 'static>(
    answer: std::sync::mpsc::Receiver<T>,
    guards: Vec<Arc<OwnedSemaphorePermit>>,
) -> tokio::task::JoinHandle<Result<T, std::sync::mpsc::RecvError>> {
    tokio::task::spawn_blocking(move || {
        let result = answer.recv();
        drop(guards);
        result
    })
}

/// 在识别线程里跑一次本地识别；模型没变时复用缓存，既不重新加载也不重算 SHA256。
fn recognize_local(
    cached: &mut Option<CachedLocalRecognizer>,
    samples: &[f32],
    language: &str,
) -> Result<String, EngineError> {
    let root = model_dir();
    let model = root.join(SENSEVOICE_ASSETS[0].name);
    let tokens = root.join(SENSEVOICE_ASSETS[1].name);
    let signature = local_asset_signature(&model).zip(local_asset_signature(&tokens));
    let reusable = match (&*cached, signature) {
        (Some(entry), Some(signature)) => {
            entry.model == model
                && entry.tokens == tokens
                && entry.language == language
                && entry.signature == signature
        }
        _ => false,
    };
    if !reusable {
        // 只有真要加载时才做全量校验：239 MB 的 SHA256 不该出现在每次转写的路径上。
        verified_local_assets(&root)?;
        let mut config = sherpa_onnx::OfflineRecognizerConfig::default();
        config.model_config.sense_voice = sherpa_onnx::OfflineSenseVoiceModelConfig {
            model: Some(model.to_string_lossy().into_owned()),
            language: Some(language.to_string()),
            use_itn: true,
        };
        config.model_config.tokens = Some(tokens.to_string_lossy().into_owned());
        config.model_config.provider = Some("cpu".to_string());
        config.model_config.num_threads = 2;
        let recognizer = sherpa_onnx::OfflineRecognizer::create(&config)
            .ok_or_else(|| EngineError::new(502, "SenseVoice 模型加载失败"))?;
        *cached = Some(CachedLocalRecognizer {
            model,
            tokens,
            language: language.to_string(),
            signature: signature.unwrap_or_default(),
            recognizer,
        });
    }
    let entry = cached
        .as_ref()
        .ok_or_else(|| EngineError::new(500, "本地语音模型未就绪"))?;
    let stream = entry.recognizer.create_stream();
    // 直接送样本，不再为每次转写落一个临时 WAV 再读回来。
    stream.accept_waveform(LOCAL_SAMPLE_RATE, samples);
    entry.recognizer.decode(&stream);
    Ok(stream
        .get_result()
        .map(|result| result.text)
        .unwrap_or_default()
        .trim()
        .to_string())
}

/// 在识别线程里转写一段 16 kHz 单声道 WAV。`language` 已经是 SenseVoice 支持的值。
async fn transcribe_wav(
    audio: &[u8],
    language: &str,
    stream_guard: Option<Arc<OwnedSemaphorePermit>>,
) -> Result<String, EngineError> {
    validate_local_wav(audio)?;
    let recognizer_guard = LOCAL_RECOGNIZER_SLOTS
        .clone()
        .try_acquire_owned()
        .map_err(|_| EngineError::new(429, "本地语音识别正在处理中，请稍后重试"))?;
    let sender = LOCAL_RECOGNIZER_TX
        .as_ref()
        .ok_or_else(|| EngineError::new(500, "本地语音推理线程不可用"))?;
    let (reply, answer) = std::sync::mpsc::channel();
    sender
        .send(LocalRecognizerRequest::Transcribe {
            samples: local_wav_samples(audio),
            language: language.to_string(),
            reply,
        })
        .map_err(|_| EngineError::new(500, "本地语音推理线程已停止"))?;
    // 分段解码共享会话许可；断开 socket 也必须等不可取消的推理真正完成才释放容量。
    let mut guards = vec![Arc::new(recognizer_guard)];
    if let Some(stream_guard) = stream_guard {
        guards.push(stream_guard);
    }
    spawn_local_recognizer_waiter(answer, guards)
        .await
        .map_err(|_| EngineError::new(500, "本地 SenseVoice 推理失败"))?
        .map_err(|_| EngineError::new(500, "本地语音推理线程已停止"))?
}

/// 校验并转写 WAV（`language` 为空按 auto）。
pub async fn transcribe_wav_audio(audio: &[u8], language: &str) -> Result<String, EngineError> {
    let language = normalize_language(language)?;
    transcribe_wav(audio, &language, None).await
}

fn normalize_language(language: &str) -> Result<String, EngineError> {
    match language.trim() {
        "" => Ok("auto".to_string()),
        value @ ("auto" | "zh" | "en" | "yue" | "ja" | "ko") => Ok(value.to_string()),
        _ => Err(EngineError::new(400, "SenseVoice 不支持该语音语言")),
    }
}

fn pcm16_mono_16khz_wav(pcm: &[u8]) -> Vec<u8> {
    let mut wav = Vec::with_capacity(PCM_WAV_HEADER_BYTES + pcm.len());
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&(36u32 + pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(b"WAVEfmt ");
    wav.extend_from_slice(&16u32.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&1u16.to_le_bytes());
    wav.extend_from_slice(&16_000u32.to_le_bytes());
    wav.extend_from_slice(&32_000u32.to_le_bytes());
    wav.extend_from_slice(&2u16.to_le_bytes());
    wav.extend_from_slice(&16u16.to_le_bytes());
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&(pcm.len() as u32).to_le_bytes());
    wav.extend_from_slice(pcm);
    wav
}

fn validate_local_pcm16(pcm: &[u8]) -> Result<(), EngineError> {
    if pcm.is_empty() || pcm.len() % 2 != 0 {
        return Err(EngineError::new(400, "PCM 音频为空或长度无效"));
    }
    if pcm.len() > MAX_AUDIO_BODY_BYTES - PCM_WAV_HEADER_BYTES {
        return Err(EngineError::new(413, "PCM 音频超过 25 MiB 限制"));
    }
    Ok(())
}

/// 转写一段 16 kHz 单声道 16 位 PCM；`stream_guard` 是流式会话的许可，推理完成才释放。
pub async fn transcribe_pcm16(
    pcm: &[u8],
    language: Option<&str>,
    stream_guard: Option<Arc<OwnedSemaphorePermit>>,
) -> Result<String, EngineError> {
    if !model_ready() {
        return Err(EngineError::new(503, "本地 SenseVoice 模型未就绪"));
    }
    validate_local_pcm16(pcm)?;
    let language = normalize_language(language.unwrap_or_default())?;
    let wav = pcm16_mono_16khz_wav(pcm);
    transcribe_wav(&wav, &language, stream_guard).await
}
