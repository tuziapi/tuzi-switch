//! Private, per-request discovery and newline-delimited MCP stdio transport.
//! No GUI, model credentials, package manager, shell, or persistent bearer in Codex.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

pub const SERVER_ID: &str = "tuzi-opentu";
pub const STDIO_FLAG: &str = "--opentu-mcp-stdio";
const MAX_BYTES: u64 = 4 * 1024 * 1024;
const UNAVAILABLE: &str = "兔子助手连接不可用。请启动兔子助手并打开 OpenTu 画布，再重试。";

#[derive(Serialize, Deserialize)]
pub struct Discovery {
    pub endpoint: String,
    pub token: String,
}
impl Discovery {
    fn validate(&self) -> Result<(), &'static str> {
        let url = reqwest::Url::parse(&self.endpoint).map_err(|_| UNAVAILABLE)?;
        if url.scheme() != "http"
            || url.host_str() != Some("127.0.0.1")
            || url.port().is_none()
            || url.path() != "/mcp"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || self.token.len() != 64
            || !self.token.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(UNAVAILABLE);
        }
        Ok(())
    }
}

fn regular_file(path: &Path) -> Result<Option<fs::Metadata>, &'static str> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_file() && !m.file_type().is_symlink() => Ok(Some(m)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => Err("配置路径不是普通文件，已保留原文件。"),
    }
}
fn private_directory(path: &Path) -> Result<(), &'static str> {
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|_| "无法创建连接器目录。")?;
    let m = fs::symlink_metadata(path).map_err(|_| UNAVAILABLE)?;
    if !m.is_dir() || m.file_type().is_symlink() {
        return Err(UNAVAILABLE);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| UNAVAILABLE)?;
    }
    Ok(())
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), &'static str> {
    regular_file(path)?;
    let parent = path.parent().ok_or(UNAVAILABLE)?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| "无法创建配置临时文件。")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| UNAVAILABLE)?;
    }
    temp.write_all(bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| "无法写入连接器配置。")?;
    temp.persist(path)
        .map_err(|_| "无法原子保存配置，原文件已保留。")?;
    Ok(())
}

pub fn publish(path: &Path, discovery: &Discovery) -> Result<(), &'static str> {
    discovery.validate()?;
    private_directory(path.parent().ok_or(UNAVAILABLE)?)?;
    atomic_write(
        path,
        &serde_json::to_vec(discovery).map_err(|_| UNAVAILABLE)?,
    )
}
pub fn read_discovery(path: &Path) -> Result<Discovery, &'static str> {
    let metadata = regular_file(path)?.ok_or(UNAVAILABLE)?;
    let parent =
        fs::symlink_metadata(path.parent().ok_or(UNAVAILABLE)?).map_err(|_| UNAVAILABLE)?;
    if !parent.is_dir() || parent.file_type().is_symlink() || metadata.len() > 4096 {
        return Err(UNAVAILABLE);
    }
    let file = fs::File::open(path).map_err(|_| UNAVAILABLE)?;
    let opened = file.metadata().map_err(|_| UNAVAILABLE)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if opened.dev() != metadata.dev()
            || opened.ino() != metadata.ino()
            || opened.permissions().mode() & 0o077 != 0
            || parent.permissions().mode() & 0o077 != 0
        {
            return Err(UNAVAILABLE);
        }
    }
    if !opened.is_file() {
        return Err(UNAVAILABLE);
    }
    let mut bytes = Vec::new();
    file.take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| UNAVAILABLE)?;
    if bytes.len() > 4096 {
        return Err(UNAVAILABLE);
    }
    let d: Discovery = serde_json::from_slice(&bytes).map_err(|_| UNAVAILABLE)?;
    d.validate()?;
    Ok(d)
}

/// Never follows redirects, proxies, or retries a potentially billable tool call.
async fn forward(
    client: &reqwest::Client,
    path: &Path,
    request: &Value,
) -> Result<Option<Value>, &'static str> {
    let d = read_discovery(path)?; // Re-read even in a long-lived Codex process.
    let mut response = client
        .post(&d.endpoint)
        .bearer_auth(&d.token)
        .header("Accept", "application/json, text/event-stream")
        .header("X-OpenTu-Connector", "stdio-v1")
        .json(request)
        .send()
        .await
        .map_err(|_| UNAVAILABLE)?;
    if response.status() == reqwest::StatusCode::ACCEPTED && request.get("id").is_none() {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(UNAVAILABLE);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| UNAVAILABLE)? {
        if bytes.len() + chunk.len() > MAX_BYTES as usize {
            return Err("OpenTu 响应过大。");
        }
        bytes.extend_from_slice(&chunk);
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "OpenTu 返回了无效响应。")?;
    if value.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
        || value.get("id") != request.get("id")
    {
        return Err("OpenTu 返回了不匹配的响应。");
    }
    Ok(Some(value))
}
fn rpc_error(id: Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":code,"message":message}})
}

pub fn run_stdio(
    path: &Path,
    mut input: impl BufRead,
    mut output: impl Write,
) -> Result<(), &'static str> {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| UNAVAILABLE)?;
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(125))
        .build()
        .map_err(|_| UNAVAILABLE)?;
    loop {
        let mut line = Vec::new();
        let count = (&mut input)
            .take(MAX_BYTES + 1)
            .read_until(b'\n', &mut line)
            .map_err(|_| "无法读取 MCP 输入。")?;
        if count == 0 {
            return Ok(());
        }
        if count as u64 > MAX_BYTES {
            return Err("MCP 输入过大。");
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let result = match serde_json::from_slice::<Value>(&line) {
            Err(_) => Some(rpc_error(Value::Null, -32700, "无效 JSON。")),
            Ok(request) => {
                if request.get("jsonrpc").and_then(Value::as_str) != Some("2.0")
                    || request.get("method").and_then(Value::as_str).is_none()
                {
                    Some(rpc_error(
                        request.get("id").cloned().unwrap_or(Value::Null),
                        -32600,
                        "无效 MCP 请求。",
                    ))
                } else if request.get("id").is_none() {
                    // This stateless bridge has no notification state or server requests.
                    None
                } else {
                    match runtime.block_on(forward(&client, path, &request)) {
                        Ok(value) => value,
                        Err(message) => Some(rpc_error(request["id"].clone(), -32000, message)),
                    }
                }
            }
        };
        if let Some(value) = result {
            serde_json::to_writer(&mut output, &value).map_err(|_| "无法写入 MCP 输出。")?;
            output
                .write_all(b"\n")
                .and_then(|_| output.flush())
                .map_err(|_| "无法写入 MCP 输出。")?;
        }
    }
}

fn is_owned(item: &toml_edit::Item, runtime: &Path) -> bool {
    item.get("env")
        .and_then(|v| v.get("TUZI_OPENTU_CONNECTOR"))
        .and_then(|v| v.as_str())
        == Some("1")
        && item
            .get("args")
            .and_then(|v| v.as_array())
            .is_some_and(|args| {
                args.len() == 2
                    && args.get(0).and_then(|v| v.as_str()) == Some(STDIO_FLAG)
                    && args.get(1).and_then(|v| v.as_str()) == runtime.to_str()
            })
}
fn read_config(path: &Path) -> Result<String, &'static str> {
    if regular_file(path)?.is_none() {
        return Ok(String::new());
    }
    fs::read_to_string(path).map_err(|_| "无法读取 Codex 配置。")
}
pub fn installed(config: &Path, runtime: &Path) -> Result<bool, &'static str> {
    let doc = read_config(config)?
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| "Codex 配置格式有误，已保留原文件。")?;
    Ok(doc
        .get("mcp_servers")
        .and_then(|v| v.get(SERVER_ID))
        .is_some_and(|v| {
            is_owned(v, runtime) && v.get("enabled").and_then(|v| v.as_bool()) != Some(false)
        }))
}

/// Touch only our own entry, with atomic replacement and conflict detection.
pub fn configure(
    config: &Path,
    runtime: &Path,
    executable: &Path,
    remove: bool,
) -> Result<(), &'static str> {
    use fs2::FileExt;
    use toml_edit::{value, Array, DocumentMut, Item, Table};
    if !runtime.is_absolute() || !executable.is_absolute() {
        return Err("连接器必须使用绝对路径。");
    }
    let parent = config.parent().ok_or("Codex 配置目录无效。")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建 Codex 配置目录。")?;
    let lock_path = parent.join(".tuzi-opentu.lock");
    regular_file(&lock_path)?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(lock_path)
        .map_err(|_| "无法锁定 Codex 配置。")?;
    lock.try_lock_exclusive()
        .map_err(|_| "连接器配置正在更新，请稍后重试。")?;
    let original = read_config(config)?;
    let mut doc = original
        .parse::<DocumentMut>()
        .map_err(|_| "Codex 配置格式有误，已保留原文件。")?;
    if let Some(existing) = doc.get("mcp_servers").and_then(|v| v.get(SERVER_ID)) {
        if !is_owned(existing, runtime) {
            return Err("已有同名 MCP 配置，未覆盖。请先更名后重试。");
        }
    }
    if remove {
        if let Some(table) = doc.get_mut("mcp_servers").and_then(Item::as_table_like_mut) {
            table.remove(SERVER_ID);
        }
    } else {
        if !executable.is_file() {
            return Err("找不到兔子助手程序，请重新安装应用。");
        }
        if doc.get("mcp_servers").is_none() {
            doc["mcp_servers"] = Item::Table(Table::new());
        }
        let servers = doc
            .get_mut("mcp_servers")
            .and_then(Item::as_table_like_mut)
            .ok_or("mcp_servers 格式有误，已保留原文件。")?;
        let mut table = Table::new();
        table["command"] = value(executable.to_str().ok_or("程序路径无法编码。")?);
        let mut args = Array::new();
        args.push(STDIO_FLAG);
        args.push(runtime.to_str().ok_or("连接器路径无法编码。")?);
        table["args"] = value(args);
        table["enabled"] = value(true);
        table["startup_timeout_sec"] = value(15);
        table["tool_timeout_sec"] = value(130);
        let mut env = Table::new();
        env["TUZI_OPENTU_CONNECTOR"] = value("1");
        table["env"] = Item::Table(env);
        servers.insert(SERVER_ID, Item::Table(table));
    }
    if read_config(config)? != original {
        return Err("Codex 配置已被其他程序修改，请重试。");
    }
    if doc.to_string() != original {
        atomic_write(config, doc.to_string().as_bytes())?;
    }
    Ok(())
}

/// Called before Tauri initialization, so the connector never starts a second GUI.
pub fn entry() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new(STDIO_FLAG)) {
        return None;
    }
    let path = args.next().map(PathBuf::from);
    let Some(path) = path.filter(|p| p.is_absolute() && args.next().is_none()) else {
        eprintln!("OpenTu connector: expected an absolute runtime path.");
        return Some(2);
    };
    match run_stdio(&path, std::io::stdin().lock(), std::io::stdout().lock()) {
        Ok(()) => Some(0),
        Err(message) => {
            eprintln!("{message}");
            Some(1)
        }
    }
}
