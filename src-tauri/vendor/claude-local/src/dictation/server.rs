//! 独立的本机听写服务：只开 `/dictation/claude-stream` 一条路由，给本地兼容服务转发 Claude 的麦克风音频。
//!
//! 启动后在 `<state>/dictation-helper.json` 写下 `{port, token}`（仅本人可读写），本地兼容服务按它连过来，
//! 与 Codex++ 的 helper 用同一份凭据格式。宿主是 Codex++ 时不用这个，它的 helper 自带同名路由。

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use anyhow::{Context, Result};
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;

use super::engine::EngineError;
use super::stream::{self, TOKEN_HEADER};

pub const RECEIPT_FILE: &str = "dictation-helper.json";
const MAX_HEADER_BYTES: usize = 16 * 1024;

/// 听写服务是否可用的判断：宿主传进来（例如「设置里关着」「模型没下载」）。
pub type Availability = Arc<dyn Fn() -> Result<(), EngineError> + Send + Sync>;

struct Running {
    port: u16,
    receipt: PathBuf,
}

static RUNNING: OnceLock<Mutex<Option<Running>>> = OnceLock::new();

fn running() -> &'static Mutex<Option<Running>> {
    RUNNING.get_or_init(|| Mutex::new(None))
}

/// 确保听写服务在跑（幂等），返回端口。需要在 tokio 运行时之外调用也行：内部自起一个线程跑运行时。
pub fn ensure_running(state_dir: &Path, availability: Availability) -> Result<u16> {
    let receipt = state_dir.join(RECEIPT_FILE);
    let mut slot = running().lock().unwrap_or_else(|error| error.into_inner());
    if let Some(current) = slot.as_ref()
        && current.receipt == receipt
        && receipt.is_file()
    {
        return Ok(current.port);
    }
    let token = uuid::Uuid::new_v4().to_string();
    let std_listener = std::net::TcpListener::bind(("127.0.0.1", 0)).context("听写服务无法监听本机端口")?;
    std_listener.set_nonblocking(true)?;
    let port = std_listener.local_addr()?.port();
    write_receipt(&receipt, port, &token)?;
    let accept_token = token.clone();
    std::thread::Builder::new()
        .name("claude-local-dictation-server".into())
        .spawn(move || {
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(_) => return,
            };
            runtime.block_on(async move {
                let Ok(listener) = TcpListener::from_std(std_listener) else {
                    return;
                };
                loop {
                    let Ok((socket, _)) = listener.accept().await else {
                        continue;
                    };
                    let token = accept_token.clone();
                    let availability = availability.clone();
                    tokio::spawn(async move {
                        let _ = handle(socket, &token, availability).await;
                    });
                }
            });
        })
        .context("无法启动听写服务线程")?;
    *slot = Some(Running { port, receipt });
    Ok(port)
}

/// 程序退出时删掉凭据，免得本地兼容服务连到一个已经不在的端口。
pub fn remove_receipt() {
    if let Some(current) = running().lock().unwrap_or_else(|error| error.into_inner()).take() {
        let _ = std::fs::remove_file(current.receipt);
    }
}

fn write_receipt(path: &Path, port: u16, token: &str) -> Result<()> {
    let body = serde_json::to_vec(&serde_json::json!({ "port": port, "token": token }))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    crate::fsutil::atomic_write(path, &body)?;
    // 本地兼容服务只认仅本人可读写的凭据。
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

async fn handle(mut socket: tokio::net::TcpStream, token: &str, availability: Availability) -> Result<()> {
    let mut buffer = Vec::with_capacity(4096);
    let header_end = loop {
        let mut chunk = [0u8; 4096];
        let read = socket.read(&mut chunk).await?;
        if read == 0 {
            return Ok(());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
        if buffer.len() > MAX_HEADER_BYTES {
            return Ok(());
        }
    };
    let headers = String::from_utf8_lossy(&buffer[..header_end]).to_string();
    let read_ahead = buffer[header_end + 4..].to_vec();
    let mut first = headers.lines().next().unwrap_or_default().split_whitespace();
    let method = first.next().unwrap_or_default().to_string();
    let raw_path = first.next().unwrap_or_default().to_string();
    let path = raw_path.split('?').next().unwrap_or_default();
    if path != "/dictation/claude-stream" {
        return Ok(());
    }
    let authorized = stream::header_value(&headers, TOKEN_HEADER).is_some_and(|value| value == token);
    stream::serve(socket, &method, &raw_path, &headers, read_ahead, authorized, availability()).await
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receipt_is_private_and_matches_the_proxy_contract() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(RECEIPT_FILE);
        write_receipt(&path, 4321, "4d1b7a52-1d2c-4c3e-9a8b-0f1e2d3c4b5a").unwrap();
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["port"], 4321);
        assert_eq!(value["token"], "4d1b7a52-1d2c-4c3e-9a8b-0f1e2d3c4b5a");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }

    #[test]
    fn header_end_is_found_after_the_blank_line() {
        assert_eq!(find_header_end(b"GET / HTTP/1.1\r\nA: b\r\n\r\nrest"), Some(20));
        assert_eq!(find_header_end(b"GET / HTTP/1.1\r\n"), None);
    }
}
