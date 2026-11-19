//! 给 Claude Desktop 原生听写用的流式转写协议（`/dictation/claude-stream` WebSocket）：
//! 收 16 kHz PCM，按静音切段、边说边出临时结果，段落结束时给最终文字。
//! 与 Codex++ helper 上的同名路由是同一份实现；宿主负责鉴权，这里只管协议与转写。

use std::pin::Pin;
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio_tungstenite::tungstenite::{
    Message,
    handshake::server::{Request as WebSocketRequest, create_response, write_response},
    protocol::{CloseFrame, Role, WebSocketConfig},
};

use super::engine::{self, EngineError};

/// 本地兼容服务连听写服务时带的令牌头（与 Codex++ 一致）。
pub const TOKEN_HEADER: &str = "X-Codex-Plus-Dictation-Token";

const DICTATION_WS_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const DICTATION_WS_SESSION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(16 * 60);
const DICTATION_WS_MAX_FRAME_BYTES: usize = 1024 * 1024;
const DICTATION_WS_MAX_CONTROL_BYTES: usize = 16 * 1024;
const DICTATION_WS_MAX_INPUT_BYTES: usize = engine::MAX_AUDIO_BODY_BYTES;
const DICTATION_WS_MAX_OUTPUT_BYTES: usize = 64 * 1024;
const DICTATION_WS_MAX_FRAMES: usize = 65_536;
const DICTATION_PCM_FRAME_BYTES: usize = 640;
const DICTATION_PCM_INTERIM_BYTES: usize = 4 * 32_000;
const DICTATION_PCM_MAX_SEGMENT_BYTES: usize = 12 * 32_000;
const DICTATION_PCM_SILENCE_BYTES: usize = 600 * 32;
const DICTATION_PCM_PREROLL_BYTES: usize = 200 * 32;
const DICTATION_PCM_VOICE_RMS: i64 = 160;
static DICTATION_WS_SESSION_SLOTS: std::sync::LazyLock<Arc<tokio::sync::Semaphore>> =
    std::sync::LazyLock::new(|| Arc::new(tokio::sync::Semaphore::new(1)));

fn try_acquire_dictation_ws_slot(
    slots: Arc<tokio::sync::Semaphore>,
) -> Result<tokio::sync::OwnedSemaphorePermit, ()> {
    slots.try_acquire_owned().map_err(|_| ())
}

fn dictation_stream_language(raw_path: &str) -> Result<Option<String>, &'static str> {
    let Some((path, query)) = raw_path.split_once('?') else {
        return Ok(None);
    };
    if path != "/dictation/claude-stream" {
        return Err("invalid path");
    }
    let Some(language) = query.strip_prefix("language=") else {
        return Err("unsupported query");
    };
    if language.contains('&') || !matches!(language, "auto" | "zh" | "en" | "yue" | "ja" | "ko") {
        return Err("unsupported language");
    }
    Ok(Some(language.to_string()))
}

fn websocket_request_for_helper(
    raw_path: &str,
    raw_headers: &str,
) -> anyhow::Result<WebSocketRequest> {
    let mut request = WebSocketRequest::builder()
        .method("GET")
        .uri(raw_path)
        .version(http::Version::HTTP_11);
    for line in raw_headers.lines().skip(1) {
        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        request = request.header(name.trim(), value.trim());
    }
    Ok(request.body(())?)
}

async fn reject_dictation_websocket(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    message: &str,
) -> anyhow::Result<()> {
    let body = serde_json::to_vec(&serde_json::json!({ "message": message }))?;
    write_json_response(stream, status, &body).await?;
    stream.shutdown().await?;
    Ok(())
}

/// 处理一条 `/dictation/claude-stream` 连接（请求头已经读完，`read_ahead` 是读多了的字节）。
///
/// - `authorized`：宿主校验过 [`TOKEN_HEADER`] 的结果；
/// - `availability`：宿主判断的听写可用性（开关关着、模型没下载等），不可用时握手前就拒绝。
pub async fn serve(
    mut stream: tokio::net::TcpStream,
    method: &str,
    raw_path: &str,
    headers: &str,
    read_ahead: Vec<u8>,
    authorized: bool,
    availability: Result<(), EngineError>,
) -> anyhow::Result<()> {
    if method != "GET" || !is_websocket_upgrade(headers) {
        return reject_dictation_websocket(
            &mut stream,
            "426 Upgrade Required",
            "语音接口需要 WebSocket 连接",
        )
        .await;
    }
    if header_value(headers, "content-length").is_some_and(|value| value != "0")
        || header_value(headers, "transfer-encoding").is_some()
    {
        return reject_dictation_websocket(
            &mut stream,
            "400 Bad Request",
            "WebSocket 握手不能包含 HTTP 请求体",
        )
        .await;
    }
    if !authorized {
        return reject_dictation_websocket(&mut stream, "403 Forbidden", "语音请求未授权").await;
    }
    let language = match dictation_stream_language(raw_path) {
        Ok(language) => language,
        Err(_) => {
            return reject_dictation_websocket(&mut stream, "400 Bad Request", "语音语言参数无效")
                .await;
        }
    };
    if let Err(error) = availability {
        let status = match error.status {
            403 => "403 Forbidden",
            503 => "503 Service Unavailable",
            _ => "400 Bad Request",
        };
        return reject_dictation_websocket(&mut stream, status, &error.message).await;
    }
    let stream_guard = match try_acquire_dictation_ws_slot(DICTATION_WS_SESSION_SLOTS.clone()) {
        Ok(guard) => guard,
        Err(_) => {
            return reject_dictation_websocket(
                &mut stream,
                "429 Too Many Requests",
                "本地语音识别正在忙，请稍后重试",
            )
            .await;
        }
    };

    let request = match websocket_request_for_helper(raw_path, headers) {
        Ok(request) => request,
        Err(_) => {
            return reject_dictation_websocket(
                &mut stream,
                "400 Bad Request",
                "WebSocket 握手无效",
            )
            .await;
        }
    };
    let response = match create_response(&request) {
        Ok(response) => response,
        Err(_) => {
            return reject_dictation_websocket(
                &mut stream,
                "400 Bad Request",
                "WebSocket 握手无效",
            )
            .await;
        }
    };
    let mut response_bytes = Vec::new();
    write_response(&mut response_bytes, &response)?;
    stream.write_all(&response_bytes).await?;

    let mut config = WebSocketConfig::default();
    config.max_message_size = Some(DICTATION_WS_MAX_FRAME_BYTES);
    config.max_frame_size = Some(DICTATION_WS_MAX_FRAME_BYTES);
    let socket = tokio_tungstenite::WebSocketStream::from_partially_read(
        stream,
        read_ahead,
        Role::Server,
        Some(config),
    )
    .await;
    let stream_guard = Arc::new(stream_guard);
    run_local_dictation_stream(socket, language, move |pcm, language| {
        let stream_guard = stream_guard.clone();
        async move {
            engine::transcribe_pcm16(&pcm, language.as_deref(), Some(stream_guard))
                .await
                .map_err(|error| error.status)
        }
    })
    .await
}

#[derive(Debug)]
struct DictationWebSocketFailure {
    code: u16,
    reason: &'static str,
}

#[derive(Default)]
struct DictationWebSocketBudget {
    input_bytes: usize,
    output_bytes: usize,
    frames: usize,
}

impl DictationWebSocketBudget {
    fn record_input(&mut self, bytes: usize) -> Result<(), DictationWebSocketFailure> {
        self.frames = self.frames.saturating_add(1);
        self.input_bytes = self.input_bytes.saturating_add(bytes);
        if self.input_bytes > DICTATION_WS_MAX_INPUT_BYTES || self.frames > DICTATION_WS_MAX_FRAMES
        {
            return Err(DictationWebSocketFailure {
                code: 1009,
                reason: "WebSocket input budget exceeded",
            });
        }
        Ok(())
    }

    fn record_output(&mut self, bytes: usize) -> Result<(), DictationWebSocketFailure> {
        self.output_bytes = self.output_bytes.saturating_add(bytes);
        if self.output_bytes > DICTATION_WS_MAX_OUTPUT_BYTES {
            return Err(DictationWebSocketFailure {
                code: 1009,
                reason: "WebSocket output budget exceeded",
            });
        }
        Ok(())
    }
}

fn append_local_dictation_pcm(
    pcm: &mut Vec<u8>,
    chunk: &[u8],
    max_pcm_bytes: usize,
) -> Result<(), DictationWebSocketFailure> {
    if chunk.is_empty() {
        return Err(DictationWebSocketFailure {
            code: 1007,
            reason: "empty PCM chunk",
        });
    }
    if pcm.len().saturating_add(chunk.len()) > max_pcm_bytes {
        return Err(DictationWebSocketFailure {
            code: 1009,
            reason: "PCM stream is too large",
        });
    }
    pcm.extend_from_slice(chunk);
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LocalDictationDecodeKind {
    Interim,
    Final,
}

struct LocalDictationDecode {
    kind: LocalDictationDecodeKind,
    pcm: Vec<u8>,
}

#[derive(Default)]
struct LocalDictationAudio {
    pending: Vec<u8>,
    pending_start: usize,
    input_bytes: usize,
    segment: Vec<u8>,
    has_voice: bool,
    silent_bytes: usize,
    interim_at: usize,
    ready: Option<Vec<u8>>,
    finished: bool,
}

impl LocalDictationAudio {
    fn append(&mut self, chunk: &[u8]) -> Result<(), DictationWebSocketFailure> {
        if self.finished {
            return Err(DictationWebSocketFailure {
                code: 1008,
                reason: "audio received after CloseStream",
            });
        }
        if self.input_bytes.saturating_add(chunk.len())
            > engine::MAX_AUDIO_BODY_BYTES - 44
        {
            return Err(DictationWebSocketFailure {
                code: 1009,
                reason: "PCM stream is too large",
            });
        }
        if self.pending_start > 0 {
            self.pending.drain(..self.pending_start);
            self.pending_start = 0;
        }
        append_local_dictation_pcm(
            &mut self.pending,
            chunk,
            engine::MAX_AUDIO_BODY_BYTES - 44,
        )?;
        self.input_bytes += chunk.len();
        Ok(())
    }

    fn finish(&mut self) -> Result<(), DictationWebSocketFailure> {
        if self.input_bytes == 0 || self.input_bytes % 2 != 0 {
            return Err(DictationWebSocketFailure {
                code: 1007,
                reason: "PCM stream is empty or misaligned",
            });
        }
        self.finished = true;
        Ok(())
    }

    fn finish_segment(&mut self) {
        if self.has_voice {
            self.ready = Some(std::mem::take(&mut self.segment));
        } else {
            self.segment.clear();
        }
        self.has_voice = false;
        self.silent_bytes = 0;
        self.interim_at = DICTATION_PCM_INTERIM_BYTES;
    }

    fn advance(&mut self) {
        // 至多保留一个待解码段；解码较慢时其余 PCM 留在受总输入预算约束的队列中。
        while self.ready.is_none() {
            let remaining = self.pending.len() - self.pending_start;
            if remaining < DICTATION_PCM_FRAME_BYTES && !(self.finished && remaining > 0) {
                break;
            }
            let frame_bytes = remaining.min(DICTATION_PCM_FRAME_BYTES);
            let frame = &self.pending[self.pending_start..self.pending_start + frame_bytes];
            let energy: i64 = frame
                .chunks_exact(2)
                .map(|pair| {
                    let sample = i64::from(i16::from_le_bytes([pair[0], pair[1]]));
                    sample * sample
                })
                .sum();
            let voiced = energy
                > (frame_bytes / 2) as i64 * DICTATION_PCM_VOICE_RMS * DICTATION_PCM_VOICE_RMS;
            self.segment.extend_from_slice(frame);
            self.pending_start += frame_bytes;
            self.has_voice |= voiced;
            if voiced {
                self.silent_bytes = 0;
            } else {
                self.silent_bytes += frame_bytes;
            }
            if !self.has_voice {
                // 只丢弃未检出语音的静音，保留短预卷以免削掉第一个字。
                if self.segment.len() > DICTATION_PCM_PREROLL_BYTES {
                    self.segment
                        .drain(..self.segment.len() - DICTATION_PCM_PREROLL_BYTES);
                }
            } else if self.silent_bytes >= DICTATION_PCM_SILENCE_BYTES
                || self.segment.len() >= DICTATION_PCM_MAX_SEGMENT_BYTES
            {
                self.finish_segment();
            }
        }
        if self.finished && self.pending_start == self.pending.len() && self.ready.is_none() {
            self.finish_segment();
        }
    }

    fn take_decode(&mut self, allow_interim: bool) -> Option<LocalDictationDecode> {
        self.advance();
        if let Some(pcm) = self.ready.take() {
            return Some(LocalDictationDecode {
                kind: LocalDictationDecodeKind::Final,
                pcm,
            });
        }
        let interim_at = self.interim_at.max(DICTATION_PCM_INTERIM_BYTES);
        if allow_interim && !self.finished && self.has_voice && self.segment.len() >= interim_at {
            self.interim_at = self.segment.len() + DICTATION_PCM_INTERIM_BYTES;
            return Some(LocalDictationDecode {
                kind: LocalDictationDecodeKind::Interim,
                pcm: self.segment.clone(),
            });
        }
        None
    }

    fn drained(&self) -> bool {
        self.finished
            && self.ready.is_none()
            && self.pending_start == self.pending.len()
            && self.segment.is_empty()
    }
}

fn dictation_websocket_control(text: &str) -> Result<&str, DictationWebSocketFailure> {
    if text.len() > DICTATION_WS_MAX_CONTROL_BYTES {
        return Err(DictationWebSocketFailure {
            code: 1009,
            reason: "control message is too large",
        });
    }
    let command: Value = serde_json::from_str(text).map_err(|_| DictationWebSocketFailure {
        code: 1007,
        reason: "invalid control message",
    })?;
    if !command
        .as_object()
        .is_some_and(|object| object.len() == 1 && object.contains_key("type"))
    {
        return Err(DictationWebSocketFailure {
            code: 1008,
            reason: "unsupported control message",
        });
    }
    match command.get("type").and_then(Value::as_str) {
        Some("KeepAlive") => Ok("KeepAlive"),
        Some("CloseStream") => Ok("CloseStream"),
        _ => Err(DictationWebSocketFailure {
            code: 1008,
            reason: "unsupported control message",
        }),
    }
}

async fn send_dictation_websocket_message<S>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
    message: Message,
    deadline: tokio::time::Instant,
    budget: &mut DictationWebSocketBudget,
) -> Result<(), DictationWebSocketFailure>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    budget.record_output(message.len())?;
    match tokio::time::timeout_at(deadline, socket.send(message)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err(DictationWebSocketFailure {
            code: 1002,
            reason: "WebSocket send failed",
        }),
        Err(_) => Err(DictationWebSocketFailure {
            code: 1008,
            reason: "stream timed out",
        }),
    }
}

async fn close_dictation_websocket<S>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
    code: u16,
    reason: &'static str,
) -> anyhow::Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    socket
        .send(Message::Close(Some(CloseFrame {
            code: code.into(),
            reason: reason.into(),
        })))
        .await?;
    socket.flush().await?;
    Ok(())
}

async fn run_local_dictation_stream<S, F, Fut>(
    mut socket: tokio_tungstenite::WebSocketStream<S>,
    language: Option<String>,
    mut transcribe: F,
) -> anyhow::Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    F: FnMut(Vec<u8>, Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<String, u16>>,
{
    run_local_dictation_stream_with_timeouts(
        &mut socket,
        language,
        &mut transcribe,
        DICTATION_WS_SESSION_TIMEOUT,
        DICTATION_WS_IDLE_TIMEOUT,
    )
    .await
}

async fn run_local_dictation_stream_with_timeouts<S, F, Fut>(
    socket: &mut tokio_tungstenite::WebSocketStream<S>,
    language: Option<String>,
    transcribe: &mut F,
    session_timeout: std::time::Duration,
    idle_timeout: std::time::Duration,
) -> anyhow::Result<()>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    F: FnMut(Vec<u8>, Option<String>) -> Fut,
    Fut: std::future::Future<Output = Result<String, u16>>,
{
    let deadline = tokio::time::Instant::now() + session_timeout;
    let mut idle_deadline = tokio::time::Instant::now() + idle_timeout;
    let mut budget = DictationWebSocketBudget::default();
    let mut audio = LocalDictationAudio::default();
    let mut decoding: Option<(LocalDictationDecodeKind, Pin<Box<Fut>>)> = None;
    loop {
        audio.advance();
        if decoding.is_none() {
            if let Some(decode) = audio.take_decode(true) {
                decoding = Some((
                    decode.kind,
                    Box::pin(transcribe(decode.pcm, language.clone())),
                ));
            } else if audio.drained() {
                return close_dictation_websocket(socket, 1000, "").await;
            }
        }
        let receive_deadline = if audio.finished {
            deadline
        } else {
            idle_deadline.min(deadline)
        };
        let has_decode = decoding.is_some();
        let result: Result<(), DictationWebSocketFailure> = tokio::select! {
            _ = tokio::time::sleep_until(receive_deadline) => {
                Err(DictationWebSocketFailure {
                    code: if audio.finished { 1011 } else { 1008 },
                    reason: "stream timed out",
                })
            }
            result = async { decoding.as_mut().unwrap().1.as_mut().await }, if has_decode => {
                let (kind, _) = decoding.take().unwrap();
                match result {
                    Err(status) => Err(DictationWebSocketFailure {
                        code: if status == 429 { 1013 } else { 1011 },
                        reason: if status == 429 {
                            "local transcription busy"
                        } else {
                            "local transcription failed"
                        },
                    }),
                    Ok(text) => {
                        let transcript = serde_json::to_string(&serde_json::json!({
                            "type": if kind == LocalDictationDecodeKind::Interim {
                                "TranscriptInterim"
                            } else {
                                "TranscriptText"
                            },
                            "data": text,
                        }))?;
                        let sent = if kind == LocalDictationDecodeKind::Interim && text.is_empty() {
                            Ok(())
                        } else {
                            send_dictation_websocket_message(
                                socket, Message::Text(transcript.into()), deadline, &mut budget,
                            ).await
                        };
                        if sent.is_ok() && kind == LocalDictationDecodeKind::Final {
                            send_dictation_websocket_message(
                                socket,
                                Message::Text(r#"{"type":"TranscriptEndpoint"}"#.into()),
                                deadline,
                                &mut budget,
                            ).await
                        } else {
                            sent
                        }
                    }
                }
            }
            message = socket.next() => {
                idle_deadline = tokio::time::Instant::now() + idle_timeout;
                match message {
                    None => return Ok(()),
                    Some(Err(error)) => Err(DictationWebSocketFailure {
                        code: if matches!(error, tokio_tungstenite::tungstenite::Error::Capacity(_)) {
                            1009
                        } else {
                            1002
                        },
                        reason: "invalid WebSocket message",
                    }),
                    Some(Ok(message)) => {
                        let recorded = budget.record_input(message.len());
                        if let Err(failure) = recorded {
                            Err(failure)
                        } else {
                            match message {
                                Message::Binary(chunk) => audio.append(&chunk),
                                Message::Text(text) => match dictation_websocket_control(&text) {
                                    Ok("KeepAlive") => send_dictation_websocket_message(
                                        socket,
                                        Message::Text(r#"{"type":"KeepAliveAck"}"#.into()),
                                        deadline,
                                        &mut budget,
                                    ).await,
                                    Ok("CloseStream") => audio.finish(),
                                    Ok(_) => unreachable!(),
                                    Err(failure) => Err(failure),
                                },
                                Message::Ping(payload) => send_dictation_websocket_message(
                                    socket, Message::Pong(payload), deadline, &mut budget,
                                ).await,
                                Message::Pong(_) => Ok(()),
                                Message::Close(_) => {
                                    socket.flush().await?;
                                    return Ok(());
                                }
                                Message::Frame(_) => Err(DictationWebSocketFailure {
                                    code: 1003,
                                    reason: "unsupported WebSocket frame",
                                }),
                            }
                        }
                    }
                }
            }
        };
        if let Err(failure) = result {
            return close_dictation_websocket(socket, failure.code, failure.reason).await;
        }
    }
}


/// 请求头里取一个值（大小写不敏感，空值当没有）。
pub fn header_value(headers: &str, header_name: &str) -> Option<String> {
    headers
        .lines()
        .skip(1)
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case(header_name)
                .then(|| value.trim().to_string())
        })
        .filter(|value| !value.is_empty())
}

pub fn is_websocket_upgrade(raw_headers: &str) -> bool {
    let header = |name: &str| {
        raw_headers
            .lines()
            .skip(1)
            .filter_map(|line| line.split_once(':'))
            .find(|(key, _)| key.trim().eq_ignore_ascii_case(name))
            .map(|(_, value)| value.trim().to_ascii_lowercase())
    };
    header("upgrade").is_some_and(|value| value == "websocket")
        && header("connection").is_some_and(|value| value.split(',').any(|item| item.trim() == "upgrade"))
}

async fn write_json_response(
    stream: &mut tokio::net::TcpStream,
    status: &str,
    body: &[u8],
) -> anyhow::Result<()> {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).await?;
    stream.write_all(body).await?;
    stream.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_tungstenite::{accept_async, connect_async};

    fn pcm(sample: i16, milliseconds: usize) -> Vec<u8> {
        sample
            .to_le_bytes()
            .into_iter()
            .cycle()
            .take(milliseconds * 32)
            .collect()
    }

    async fn next_json<S>(socket: &mut tokio_tungstenite::WebSocketStream<S>) -> Value
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    {
        let message = tokio::time::timeout(std::time::Duration::from_secs(2), socket.next())
            .await
            .expect("the stream must respond while capture is still open")
            .unwrap()
            .unwrap();
        let Message::Text(text) = message else {
            panic!("expected JSON message");
        };
        serde_json::from_str(&text).unwrap()
    }

    fn mask_client_frame(opcode: u8, payload: &[u8]) -> Vec<u8> {
        assert!(payload.len() < 126);
        let mask = [0x13, 0x37, 0x42, 0x91];
        let mut frame = vec![0x80 | opcode, 0x80 | payload.len() as u8];
        frame.extend_from_slice(&mask);
        frame.extend(
            payload
                .iter()
                .enumerate()
                .map(|(index, byte)| byte ^ mask[index % mask.len()]),
        );
        frame
    }

    #[test]
    fn dictation_stream_language_accepts_only_the_local_allowlist() {
        assert_eq!(
            dictation_stream_language("/dictation/claude-stream?language=zh").unwrap(),
            Some("zh".to_string())
        );
        assert_eq!(
            dictation_stream_language("/dictation/claude-stream").unwrap(),
            None
        );
        for path in [
            "/dictation/claude-stream?language=zh%2Fen",
            "/dictation/claude-stream?language=zh&language=en",
            "/dictation/claude-stream?token=secret",
        ] {
            assert!(dictation_stream_language(path).is_err());
        }
    }

    #[test]
    fn dictation_stream_slot_rejects_an_excess_session() {
        let slots = Arc::new(tokio::sync::Semaphore::new(1));
        let guard = try_acquire_dictation_ws_slot(slots.clone()).unwrap();
        assert!(try_acquire_dictation_ws_slot(slots.clone()).is_err());
        drop(guard);
        assert!(try_acquire_dictation_ws_slot(slots).is_ok());
    }

    #[test]
    fn dictation_pcm_buffer_enforces_empty_and_total_byte_limits() {
        let mut pcm = Vec::new();
        assert_eq!(
            append_local_dictation_pcm(&mut pcm, &[], 4)
                .unwrap_err()
                .code,
            1007
        );
        append_local_dictation_pcm(&mut pcm, &[1, 2], 4).unwrap();
        append_local_dictation_pcm(&mut pcm, &[3, 4], 4).unwrap();
        assert_eq!(pcm, vec![1, 2, 3, 4]);
        assert_eq!(
            append_local_dictation_pcm(&mut pcm, &[5, 6], 4)
                .unwrap_err()
                .code,
            1009
        );
    }

    #[test]
    fn dictation_audio_interims_replace_the_current_segment_and_silence_commits_it() {
        let mut audio = LocalDictationAudio::default();
        let first = pcm(1000, 4000);
        audio.append(&first).unwrap();
        let interim = audio.take_decode(true).unwrap();
        assert_eq!(interim.kind, LocalDictationDecodeKind::Interim);
        assert_eq!(interim.pcm, first);
        assert!(audio.take_decode(true).is_none());

        let rest = pcm(2000, 4000);
        audio.append(&rest).unwrap();
        let interim = audio.take_decode(true).unwrap();
        assert_eq!(interim.kind, LocalDictationDecodeKind::Interim);
        assert_eq!(interim.pcm, [first.clone(), rest.clone()].concat());
        let silence = pcm(0, 600);
        audio.append(&silence).unwrap();
        let final_segment = audio.take_decode(true).unwrap();
        assert_eq!(final_segment.kind, LocalDictationDecodeKind::Final);
        assert_eq!(final_segment.pcm, [first, rest, silence].concat());
        audio.finish().unwrap();
        assert!(audio.take_decode(true).is_none());
        assert!(audio.drained());
    }

    #[test]
    fn dictation_audio_preserves_samples_across_odd_chunks_and_maximum_segments() {
        let input = pcm(1000, 13_000);
        let mut audio = LocalDictationAudio::default();
        for chunk in input.chunks(511) {
            audio.append(chunk).unwrap();
            audio.advance();
        }
        audio.finish().unwrap();
        let first = audio.take_decode(true).unwrap();
        assert_eq!(first.kind, LocalDictationDecodeKind::Final);
        assert_eq!(first.pcm.len(), DICTATION_PCM_MAX_SEGMENT_BYTES);
        let last = audio.take_decode(true).unwrap();
        assert_eq!(last.kind, LocalDictationDecodeKind::Final);
        assert_eq!([first.pcm, last.pcm].concat(), input);
        assert!(audio.take_decode(true).is_none());
        assert!(audio.drained());
    }

    #[test]
    fn dictation_audio_silence_never_schedules_recognition() {
        let mut audio = LocalDictationAudio::default();
        audio.append(&pcm(0, 13_000)).unwrap();
        assert!(audio.take_decode(true).is_none());
        assert!(audio.segment.len() <= DICTATION_PCM_PREROLL_BYTES);
        audio.finish().unwrap();
        assert!(audio.take_decode(true).is_none());
        assert!(audio.drained());
        assert_eq!(audio.append(&[0, 0]).unwrap_err().code, 1008);

        let mut empty = LocalDictationAudio::default();
        assert_eq!(empty.finish().unwrap_err().code, 1007);
        empty.append(&[1]).unwrap();
        assert_eq!(empty.finish().unwrap_err().code, 1007);
    }

    #[test]
    fn dictation_websocket_budget_caps_both_directions_and_frame_count() {
        let mut budget = DictationWebSocketBudget::default();
        budget.record_input(DICTATION_WS_MAX_INPUT_BYTES).unwrap();
        assert_eq!(budget.record_input(1).unwrap_err().code, 1009);

        let mut budget = DictationWebSocketBudget::default();
        budget.record_output(DICTATION_WS_MAX_OUTPUT_BYTES).unwrap();
        assert_eq!(budget.record_output(1).unwrap_err().code, 1009);

        let mut budget = DictationWebSocketBudget::default();
        for _ in 0..DICTATION_WS_MAX_FRAMES {
            budget.record_input(0).unwrap();
        }
        assert_eq!(budget.record_input(0).unwrap_err().code, 1009);
    }

    #[tokio::test]
    async fn dictation_upgrade_preserves_pipelined_pcm_and_control_frames() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let (headers, read_ahead) = read_request_head(&mut stream).await;
            let request =
                websocket_request_for_helper("/dictation/claude-stream", &headers).unwrap();
            let response = create_response(&request).unwrap();
            let mut response_bytes = Vec::new();
            write_response(&mut response_bytes, &response).unwrap();
            stream.write_all(&response_bytes).await.unwrap();
            let mut socket = tokio_tungstenite::WebSocketStream::from_partially_read(
                stream,
                read_ahead,
                Role::Server,
                None,
            )
            .await;
            let mut captured = Vec::new();
            run_local_dictation_stream_with_timeouts(
                &mut socket,
                None,
                &mut |pcm, _| {
                    captured.push(pcm);
                    async { Ok("本地识别".to_string()) }
                },
                std::time::Duration::from_secs(5),
                std::time::Duration::from_secs(5),
            )
            .await
            .unwrap();
            captured
        });

        let key = "dGhlIHNhbXBsZSBub25jZQ==";
        let mut request = format!(
            "GET /dictation/claude-stream HTTP/1.1\r\nHost: {address}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: {key}\r\n\r\n"
        )
        .into_bytes();
        request.extend(mask_client_frame(0x2, &[0xe8, 0x03]));
        request.extend(mask_client_frame(0x1, br#"{"type":"KeepAlive"}"#));
        request.extend(mask_client_frame(0x2, &[0xd0, 0x07]));
        request.extend(mask_client_frame(0x1, br#"{"type":"CloseStream"}"#));

        let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
        client.write_all(&request).await.unwrap();
        let mut status = [0; 12];
        client.read_exact(&mut status).await.unwrap();
        assert_eq!(&status, b"HTTP/1.1 101");
        assert_eq!(server.await.unwrap(), vec![vec![0xe8, 0x03, 0xd0, 0x07]]);
    }

    #[tokio::test]
    async fn dictation_stream_idle_and_absolute_deadlines_stop_open_connections() {
        for (absolute_timeout, idle_timeout) in [
            (
                std::time::Duration::from_millis(20),
                std::time::Duration::from_millis(100),
            ),
            (
                std::time::Duration::from_secs(1),
                std::time::Duration::from_millis(20),
            ),
        ] {
            let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
                .await
                .unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut socket = accept_async(stream).await.unwrap();
                run_local_dictation_stream_with_timeouts(
                    &mut socket,
                    None,
                    &mut |_, _| async { panic!("an idle connection must not invoke recognition") },
                    absolute_timeout,
                    idle_timeout,
                )
                .await
                .unwrap();
            });
            let (mut client, _) = connect_async(format!("ws://{address}/dictation/claude-stream"))
                .await
                .unwrap();
            let Message::Close(Some(close)) = client.next().await.unwrap().unwrap() else {
                panic!("expected timed out close");
            };
            assert_eq!(u16::from(close.code), 1008);
            server.await.unwrap();
        }
    }

    #[tokio::test]
    async fn dictation_stream_emits_text_endpoint_and_normal_close() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let socket = accept_async(stream).await.unwrap();
            run_local_dictation_stream(
                socket,
                Some("zh".to_string()),
                |pcm, language| async move {
                    assert_eq!(pcm, vec![0xe8, 0x03, 0xd0, 0x07]);
                    assert_eq!(language.as_deref(), Some("zh"));
                    Ok("本地识别".to_string())
                },
            )
            .await
            .unwrap();
        });
        let (mut client, _) = connect_async(format!("ws://{address}/dictation/claude-stream"))
            .await
            .unwrap();
        client
            .send(Message::Binary(vec![0xe8, 0x03, 0xd0, 0x07].into()))
            .await
            .unwrap();
        client
            .send(Message::Text(r#"{"type":"CloseStream"}"#.into()))
            .await
            .unwrap();
        let transcript = client.next().await.unwrap().unwrap();
        let Message::Text(transcript) = transcript else {
            panic!("expected TranscriptText");
        };
        let transcript: Value = serde_json::from_str(&transcript).unwrap();
        assert_eq!(transcript["type"], "TranscriptText");
        assert_eq!(transcript["data"], "本地识别");
        let endpoint = client.next().await.unwrap().unwrap();
        let Message::Text(endpoint) = endpoint else {
            panic!("expected TranscriptEndpoint");
        };
        let endpoint: Value = serde_json::from_str(&endpoint).unwrap();
        assert_eq!(
            endpoint,
            serde_json::json!({ "type": "TranscriptEndpoint" })
        );
        let close = client.next().await.unwrap().unwrap();
        let Message::Close(Some(close)) = close else {
            panic!("expected normal close");
        };
        assert_eq!(u16::from(close.code), 1000);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn dictation_stream_emits_interim_and_endpoint_before_close_stream() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let socket = accept_async(stream).await.unwrap();
            let mut calls = 0;
            run_local_dictation_stream(socket, None, |_, _| {
                calls += 1;
                async { Ok("测试语音".to_string()) }
            })
            .await
            .unwrap();
            calls
        });
        let (mut client, _) = connect_async(format!("ws://{address}/dictation/claude-stream"))
            .await
            .unwrap();
        client
            .send(Message::Binary(pcm(1000, 4000).into()))
            .await
            .unwrap();
        assert_eq!(next_json(&mut client).await["type"], "TranscriptInterim");
        client
            .send(Message::Binary(pcm(0, 600).into()))
            .await
            .unwrap();
        assert_eq!(next_json(&mut client).await["type"], "TranscriptText");
        assert_eq!(next_json(&mut client).await["type"], "TranscriptEndpoint");
        client
            .send(Message::Text(r#"{"type":"KeepAlive"}"#.into()))
            .await
            .unwrap();
        assert_eq!(next_json(&mut client).await["type"], "KeepAliveAck");
        client
            .send(Message::Text(r#"{"type":"CloseStream"}"#.into()))
            .await
            .unwrap();
        let Message::Close(Some(close)) = client.next().await.unwrap().unwrap() else {
            panic!("expected normal close without replayed transcripts");
        };
        assert_eq!(u16::from(close.code), 1000);
        assert_eq!(server.await.unwrap(), 2);
    }

    #[tokio::test]
    async fn dictation_stream_reads_and_preserves_later_pcm_while_recognition_is_running() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let (started, started_rx) = tokio::sync::oneshot::channel();
        let (release, release_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let socket = accept_async(stream).await.unwrap();
            let mut gate = Some((started, release_rx));
            let mut captured = Vec::new();
            run_local_dictation_stream(socket, None, |pcm, _| {
                captured.push(pcm);
                let gate = gate.take();
                async move {
                    if let Some((started, release)) = gate {
                        started.send(()).unwrap();
                        release.await.unwrap();
                    }
                    Ok("测试语音".to_string())
                }
            })
            .await
            .unwrap();
            captured
        });
        let (mut client, _) = connect_async(format!("ws://{address}/dictation/claude-stream"))
            .await
            .unwrap();
        let first = pcm(1000, 4000);
        client
            .send(Message::Binary(first.clone().into()))
            .await
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), started_rx)
            .await
            .unwrap()
            .unwrap();
        let rest = [pcm(2000, 1000), pcm(0, 600)].concat();
        let second = [pcm(3000, 1000), pcm(0, 600)].concat();
        client
            .send(Message::Binary(
                [rest.clone(), second.clone()].concat().into(),
            ))
            .await
            .unwrap();
        client
            .send(Message::Text(r#"{"type":"KeepAlive"}"#.into()))
            .await
            .unwrap();
        assert_eq!(next_json(&mut client).await["type"], "KeepAliveAck");
        client
            .send(Message::Text(r#"{"type":"CloseStream"}"#.into()))
            .await
            .unwrap();
        release.send(()).unwrap();
        for expected in [
            "TranscriptInterim",
            "TranscriptText",
            "TranscriptEndpoint",
            "TranscriptText",
            "TranscriptEndpoint",
        ] {
            assert_eq!(next_json(&mut client).await["type"], expected);
        }
        let Message::Close(Some(close)) = client.next().await.unwrap().unwrap() else {
            panic!("expected normal close after all queued segments");
        };
        assert_eq!(u16::from(close.code), 1000);
        assert_eq!(
            server.await.unwrap(),
            vec![first.clone(), [first, rest].concat(), second],
        );
    }

    #[tokio::test]
    async fn dictation_stream_does_not_create_transcripts_from_silence() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let socket = accept_async(stream).await.unwrap();
            run_local_dictation_stream(socket, None, |_, _| async {
                panic!("silence must not invoke recognition")
            })
            .await
            .unwrap();
        });
        let (mut client, _) = connect_async(format!("ws://{address}/dictation/claude-stream"))
            .await
            .unwrap();
        client
            .send(Message::Binary(pcm(0, 5000).into()))
            .await
            .unwrap();
        client
            .send(Message::Text(r#"{"type":"KeepAlive"}"#.into()))
            .await
            .unwrap();
        assert_eq!(next_json(&mut client).await["type"], "KeepAliveAck");
        client
            .send(Message::Text(r#"{"type":"CloseStream"}"#.into()))
            .await
            .unwrap();
        let Message::Close(Some(close)) = client.next().await.unwrap().unwrap() else {
            panic!("silence must close without invented transcripts");
        };
        assert_eq!(u16::from(close.code), 1000);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn dictation_disconnect_cancels_the_pending_recognition_future() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let (started, started_rx) = tokio::sync::oneshot::channel();
        let (dropped, dropped_rx) = tokio::sync::oneshot::channel::<()>();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let socket = accept_async(stream).await.unwrap();
            let mut guard = Some((started, dropped));
            run_local_dictation_stream(socket, None, |_, _| {
                let guard = guard.take();
                async move {
                    let (started, _drop_guard) = guard.unwrap();
                    started.send(()).unwrap();
                    std::future::pending::<Result<String, u16>>().await
                }
            })
            .await
            .unwrap();
        });
        let (mut client, _) = connect_async(format!("ws://{address}/dictation/claude-stream"))
            .await
            .unwrap();
        client
            .send(Message::Binary(pcm(1000, 4000).into()))
            .await
            .unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), started_rx)
            .await
            .unwrap()
            .unwrap();
        client.close(None).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
        assert!(dropped_rx.await.is_err());
    }

    #[tokio::test]
    async fn dictation_stream_rejects_unsupported_controls() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let socket = accept_async(stream).await.unwrap();
            run_local_dictation_stream(socket, None, |_, _| async {
                panic!("unsupported control must not reach transcription")
            })
            .await
            .unwrap();
        });
        let (mut client, _) = connect_async(format!("ws://{address}/dictation/claude-stream"))
            .await
            .unwrap();
        client
            .send(Message::Text(
                r#"{"type":"CloseStream","extra":true}"#.into(),
            ))
            .await
            .unwrap();
        let close = client.next().await.unwrap().unwrap();
        let Message::Close(Some(close)) = close else {
            panic!("expected policy close");
        };
        assert_eq!(u16::from(close.code), 1008);
        server.await.unwrap();
    }



    async fn read_request_head(stream: &mut tokio::net::TcpStream) -> (String, Vec<u8>) {
        let mut buffer = Vec::new();
        loop {
            let mut chunk = [0u8; 1024];
            let read = stream.read(&mut chunk).await.unwrap();
            assert!(read > 0, "request head ended early");
            buffer.extend_from_slice(&chunk[..read]);
            if let Some(index) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
                return (
                    String::from_utf8(buffer[..index].to_vec()).unwrap(),
                    buffer[index + 4..].to_vec(),
                );
            }
        }
    }

    async fn rejected_before_upgrade(authorized: bool, availability: Result<(), EngineError>) -> String {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let headers = format!(
                "GET /dictation/claude-stream HTTP/1.1\r\nHost: {address}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n"
            );
            serve(stream, "GET", "/dictation/claude-stream", &headers, Vec::new(), authorized, availability)
                .await
                .unwrap();
        });
        let mut client = tokio::net::TcpStream::connect(address).await.unwrap();
        let mut response = Vec::new();
        client.read_to_end(&mut response).await.unwrap();
        server.await.unwrap();
        String::from_utf8_lossy(&response).to_string()
    }

    #[tokio::test]
    async fn stream_rejects_unauthorized_requests_before_upgrade() {
        let response = rejected_before_upgrade(false, Ok(())).await;
        assert!(response.starts_with("HTTP/1.1 403 Forbidden"), "{response}");
    }

    #[tokio::test]
    async fn stream_rejects_unavailable_dictation_before_upgrade() {
        let disabled = rejected_before_upgrade(true, Err(EngineError::new(403, "语音输入未启用"))).await;
        assert!(disabled.starts_with("HTTP/1.1 403 Forbidden"), "{disabled}");
        let missing = rejected_before_upgrade(true, Err(EngineError::new(503, "本地 SenseVoice 模型未就绪"))).await;
        assert!(missing.starts_with("HTTP/1.1 503 Service Unavailable"), "{missing}");
    }
}
