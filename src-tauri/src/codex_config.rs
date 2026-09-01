use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{mpsc, Mutex};
use std::time::{Duration, Instant};

use crate::config::{
    atomic_write, delete_file, get_app_config_dir, get_home_dir, read_json_file,
    sanitize_provider_name, write_json_file, write_text_file,
};
use crate::error::AppError;
use crate::gemini_config::{parse_env_file, serialize_env_file};
use serde_json::{json, Value};
use std::fs;
use std::process::Command;
use toml_edit::DocumentMut;

pub const CC_SWITCH_CODEX_MODEL_PROVIDER_ID: &str = "tuziswitch";
pub const DEFAULT_CODEX_MODEL_PROVIDER_ID: &str = "custom";
pub const TUZI_SWITCH_CODEX_MODEL_CATALOG_FILENAME: &str = "tuzi-switch-model-catalog.json";
const CODEX_MODEL_CATALOG_TEMPLATE_SLUG: &str = "gpt-5.5";

/// Reserved built-in provider IDs from OpenAI Codex's config/model-provider
/// catalog. Keep in sync with Codex `RESERVED_MODEL_PROVIDER_IDS` and legacy
/// removed provider aliases.
const CODEX_RESERVED_MODEL_PROVIDER_IDS: &[&str] = &[
    "amazon-bedrock",
    "openai",
    "ollama",
    "lmstudio",
    "oss",
    "ollama-chat",
];

const MANAGED_ENV_BEGIN: &str = "# >>> tuzi-switch codex env >>>";
const MANAGED_ENV_END: &str = "# <<< tuzi-switch codex env <<<";
const CODEX_ENV_MANAGED_MARKER_PREFIX: &str = "# tuzi-switch managed env:";
const MAX_MANAGED_ENV_FILE_BYTES: u64 = 256 * 1024;
static MANAGED_ENV_FILE_LOCK: Mutex<()> = Mutex::new(());
static CODEX_CONFIG_WRITE_LOCK: Mutex<()> = Mutex::new(());

const CODEX_SUBAGENT_THREADS_KEY: &str = "max_concurrent_threads_per_session";
const CODEX_LEGACY_SUBAGENT_THREADS_KEY: &str = "max_threads";

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexSubagentSettings {
    pub max_concurrent_threads_per_session: Option<u64>,
    pub config_path: String,
    pub used_legacy_alias: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CodexEffectiveModelProvider {
    pub provider_id: String,
    pub source: String,
    pub cwd: Option<String>,
}

fn is_valid_env_key_name(env_key: &str) -> bool {
    let mut chars = env_key.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn validate_env_key_name(env_key: &str) -> Result<(), AppError> {
    if is_valid_env_key_name(env_key) {
        return Ok(());
    }
    Err(AppError::Message(format!(
        "Invalid Codex env_key name: {env_key}"
    )))
}

fn managed_env_file_path() -> PathBuf {
    get_app_config_dir().join("codex-env")
}

fn read_managed_env_file_entries() -> Result<BTreeMap<String, String>, AppError> {
    let path = managed_env_file_path();
    let mut entries = BTreeMap::new();
    let file = match fs::File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(entries),
        Err(error) => return Err(AppError::io(&path, error)),
    };
    let size = file
        .metadata()
        .map_err(|error| AppError::io(&path, error))?
        .len();
    if size > MAX_MANAGED_ENV_FILE_BYTES {
        return Err(AppError::Config(
            "Codex 受管环境文件超过大小限制".to_string(),
        ));
    }

    let mut content = String::with_capacity(size as usize);
    file.take(MAX_MANAGED_ENV_FILE_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|error| AppError::io(&path, error))?;
    if content.len() as u64 > MAX_MANAGED_ENV_FILE_BYTES {
        return Err(AppError::Config(
            "Codex 受管环境文件超过大小限制".to_string(),
        ));
    }
    for line in content.lines() {
        if let Some((key, value)) = line.split_once('=') {
            if is_valid_env_key_name(key) {
                entries.insert(key.to_string(), value.to_string());
            }
        }
    }
    Ok(entries)
}

pub(crate) fn read_managed_env_key_file(env_key: &str) -> Result<Option<String>, AppError> {
    if !is_valid_env_key_name(env_key) {
        return Ok(None);
    }
    Ok(read_managed_env_file_entries()?.remove(env_key))
}

pub(crate) fn write_managed_env_key_file(env_key: &str, value: &str) -> Result<bool, AppError> {
    validate_env_key_name(env_key)?;
    if value.is_empty() || value.contains(['\r', '\n']) {
        return Err(AppError::InvalidInput(
            "Codex API Key 为空或包含换行符".to_string(),
        ));
    }
    let _guard = MANAGED_ENV_FILE_LOCK.lock()?;
    let mut entries = read_managed_env_file_entries()?;
    if entries
        .get(env_key)
        .is_some_and(|existing| existing == value)
    {
        ensure_managed_env_file_private()?;
        return Ok(false);
    }
    entries.insert(env_key.to_string(), value.to_string());
    write_managed_env_file_entries(&entries)?;
    Ok(true)
}

pub(crate) fn remove_managed_env_key_file(env_key: &str) -> Result<bool, AppError> {
    validate_env_key_name(env_key)?;
    let _guard = MANAGED_ENV_FILE_LOCK.lock()?;
    let mut entries = read_managed_env_file_entries()?;
    if entries.remove(env_key).is_none() {
        return Ok(false);
    }
    write_managed_env_file_entries(&entries)?;
    Ok(true)
}

fn ensure_managed_env_file_private() -> Result<(), AppError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let path = managed_env_file_path();
        if path.exists() {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
                .map_err(|error| AppError::io(&path, error))?;
        }
    }
    Ok(())
}

fn write_managed_env_file_entries(entries: &BTreeMap<String, String>) -> Result<(), AppError> {
    let path = managed_env_file_path();
    let mut output = String::new();
    output.push_str(MANAGED_ENV_BEGIN);
    output.push('\n');
    for (key, value) in entries {
        output.push_str(key);
        output.push('=');
        output.push_str(value);
        output.push('\n');
    }
    output.push_str(MANAGED_ENV_END);
    output.push('\n');
    if output.len() as u64 > MAX_MANAGED_ENV_FILE_BYTES {
        return Err(AppError::Config(
            "Codex 受管环境文件超过大小限制".to_string(),
        ));
    }
    secure_atomic_write(&path, output.as_bytes())
}

pub(crate) fn secure_atomic_write(path: &Path, data: &[u8]) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config("无效的路径".to_string()))?;
    fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|error| AppError::io(parent, error))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(temporary.path(), fs::Permissions::from_mode(0o600))
            .map_err(|error| AppError::io(temporary.path(), error))?;
    }
    temporary
        .write_all(data)
        .map_err(|error| AppError::io(temporary.path(), error))?;
    temporary
        .flush()
        .map_err(|error| AppError::io(temporary.path(), error))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| AppError::io(temporary.path(), error))?;
    #[cfg(windows)]
    if path.exists() {
        fs::remove_file(path).map_err(|error| AppError::io(path, error))?;
    }
    temporary
        .persist(path)
        .map_err(|error| AppError::io(path, error.error))?;
    Ok(())
}

fn shell_single_quote(value: &str) -> Result<String, AppError> {
    if value.contains('\0') || value.contains('\n') || value.contains('\r') {
        return Err(AppError::InvalidInput(
            "Codex env value must not contain newline or NUL".to_string(),
        ));
    }
    Ok(format!("'{}'", value.replace('\'', "'\\''")))
}

fn shell_unquote_value(raw: &str) -> Option<String> {
    let value = raw.trim();
    if !value.starts_with('\'') {
        return Some(value.trim_matches('"').to_string());
    }

    let mut result = String::new();
    let mut rest = value;
    loop {
        let after_open = rest.strip_prefix('\'')?;
        let close_index = after_open.find('\'')?;
        result.push_str(&after_open[..close_index]);
        rest = &after_open[close_index + 1..];
        if rest.is_empty() {
            return Some(result);
        }
        if let Some(after_escape) = rest.strip_prefix("\\'") {
            result.push('\'');
            rest = after_escape;
            continue;
        }
        return None;
    }
}

// ---------------------------------------------------------------------------
// Codex CLI version detection
// ---------------------------------------------------------------------------

/// Detect Codex CLI version. Returns (major, minor, patch) or None if not found.
#[allow(dead_code)]
pub fn get_codex_version() -> Option<(u32, u32, u32)> {
    use std::process::Command;

    // Check both codex and opencode commands
    let output = Command::new("codex")
        .arg("--version")
        .output()
        .or_else(|_| Command::new("opencode").arg("--version").output())
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Format: "codex-cli 0.133.0" or "opencode 0.135.0"
    let version_str = stdout.trim().split_whitespace().last()?;
    let parts: Vec<&str> = version_str.split('.').collect();
    if parts.len() >= 3 {
        let major = parts[0].parse().ok()?;
        let minor = parts[1].parse().ok()?;
        let patch = parts[2].parse().ok()?;
        Some((major, minor, patch))
    } else {
        None
    }
}

fn codex_app_server_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    // The desktop bundle is the closest match for the Codex process whose
    // effective configuration the user sees. Prefer it over a possibly older
    // CLI on PATH.
    #[cfg(target_os = "macos")]
    candidates.push(PathBuf::from(
        "/Applications/ChatGPT.app/Contents/Resources/codex",
    ));

    candidates.push(PathBuf::from("codex"));
    let home = get_home_dir();
    for path in [
        home.join(".local/bin/codex"),
        home.join(".npm-global/bin/codex"),
        home.join(".volta/bin/codex"),
    ] {
        if !candidates.contains(&path) {
            candidates.push(path);
        }
    }

    #[cfg(target_os = "macos")]
    for path in [
        PathBuf::from("/opt/homebrew/bin/codex"),
        PathBuf::from("/usr/local/bin/codex"),
    ] {
        if !candidates.contains(&path) {
            candidates.push(path);
        }
    }

    candidates
}

fn parse_codex_effective_model_provider_response(
    response: &Value,
    cwd: Option<&Path>,
) -> Option<CodexEffectiveModelProvider> {
    let result = response.get("result")?;
    let provider_id = result.pointer("/config/model_provider")?.as_str()?.trim();
    if provider_id.is_empty() || !is_custom_codex_model_provider_id(provider_id) {
        return None;
    }
    let provider_exists = result
        .pointer("/config/model_providers")
        .and_then(Value::as_object)
        .is_some_and(|providers| providers.contains_key(provider_id));
    if !provider_exists {
        return None;
    }

    let origin = result.pointer("/origins/model_provider/name");
    let source_type = origin
        .and_then(|value| value.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("effective");
    let source_detail = origin
        .and_then(|value| value.get("file"))
        .and_then(Value::as_str)
        .or_else(|| {
            origin
                .and_then(|value| value.get("profile"))
                .and_then(Value::as_str)
        });
    let source = source_detail
        .map(|detail| format!("config/read:{source_type}:{detail}"))
        .unwrap_or_else(|| format!("config/read:{source_type}"));

    Some(CodexEffectiveModelProvider {
        provider_id: provider_id.to_string(),
        source,
        cwd: cwd.map(|path| path.to_string_lossy().to_string()),
    })
}

fn read_codex_effective_model_provider_with_executable(
    executable: &Path,
    cwd: Option<&Path>,
) -> Result<Option<CodexEffectiveModelProvider>, AppError> {
    let mut command = Command::new(executable);
    command
        .args(["app-server", "--listen", "stdio://"])
        .env("CODEX_HOME", get_codex_config_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut child = command.spawn().map_err(|error| {
        AppError::Message(format!(
            "无法启动 Codex config/read（{}）: {error}",
            executable.display()
        ))
    })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Message("Codex config/read 缺少 stdout".to_string()))?;
    let (sender, receiver) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if sender.send(line).is_err() {
                break;
            }
        }
    });

    let result = (|| -> Result<Option<CodexEffectiveModelProvider>, AppError> {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| AppError::Message("Codex config/read 缺少 stdin".to_string()))?;
        let cwd_value = cwd
            .map(|path| Value::String(path.to_string_lossy().to_string()))
            .unwrap_or(Value::Null);
        for request in [
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "clientInfo": { "name": "tuzi-switch", "version": env!("CARGO_PKG_VERSION") },
                    "capabilities": { "experimentalApi": true }
                }
            }),
            json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }),
            json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "config/read",
                "params": { "cwd": cwd_value, "includeLayers": true }
            }),
        ] {
            serde_json::to_writer(&mut *stdin, &request)
                .map_err(|error| AppError::JsonSerialize { source: error })?;
            stdin
                .write_all(b"\n")
                .map_err(|error| AppError::io(executable, error))?;
        }
        stdin
            .flush()
            .map_err(|error| AppError::io(executable, error))?;

        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(AppError::Message("Codex config/read 超时".to_string()));
            }
            let line = receiver.recv_timeout(remaining).map_err(|error| {
                AppError::Message(format!("Codex config/read 未返回有效结果: {error}"))
            })?;
            let line = line.map_err(|error| AppError::io(executable, error))?;
            let Ok(response) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if response.get("id").and_then(Value::as_i64) != Some(2) {
                continue;
            }
            if let Some(error) = response.get("error") {
                return Err(AppError::Message(format!(
                    "Codex config/read 返回错误: {error}"
                )));
            }
            return Ok(parse_codex_effective_model_provider_response(
                &response, cwd,
            ));
        }
    })();

    let _ = child.kill();
    let _ = child.wait();
    result
}

/// Ask Codex itself for the effective provider after all config layers for `cwd`
/// are merged. This deliberately does not claim to inspect an already-running
/// process, whose startup-only CLI overrides and cached config are private to it.
pub fn read_codex_effective_model_provider(
    cwd: Option<&Path>,
) -> Result<Option<CodexEffectiveModelProvider>, AppError> {
    let mut errors = Vec::new();
    for executable in codex_app_server_candidates() {
        if executable.is_absolute() && !executable.is_file() {
            continue;
        }
        match read_codex_effective_model_provider_with_executable(&executable, cwd) {
            Ok(provider) => return Ok(provider),
            Err(error) => errors.push(format!("{}: {error}", executable.display())),
        }
    }
    Err(AppError::Message(format!(
        "无法通过 Codex config/read 解析有效配置: {}",
        errors.join("；")
    )))
}

/// Check if Codex CLI version is >= 0.134.0 (new profile format)
pub fn is_new_profile_format() -> bool {
    true // Always use new format, fix issue: legacy `profile = "codex"` config is no longer supported
}
// Shell RC managed block
// ---------------------------------------------------------------------------

fn get_shell_rc_path() -> PathBuf {
    get_default_shell_rc_path()
}

fn get_default_shell_rc_path() -> PathBuf {
    let home = get_home_dir();
    if cfg!(target_os = "macos") {
        return home.join(".zshrc");
    }

    let shell = std::env::var("SHELL").unwrap_or_default();
    if shell.contains("zsh") {
        home.join(".zshrc")
    } else if shell.contains("bash") {
        home.join(".bashrc")
    } else {
        home.join(".profile")
    }
}

fn dedup_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();
    for path in paths {
        if seen.insert(path.clone()) {
            result.push(path);
        }
    }
    result
}

fn shell_rc_candidates() -> Vec<PathBuf> {
    if cfg!(target_os = "windows") {
        return Vec::new();
    }

    let home = get_home_dir();
    let primary = get_default_shell_rc_path();
    dedup_paths(vec![
        primary,
        home.join(".zshrc"),
        home.join(".bashrc"),
        home.join(".bash_profile"),
        home.join(".profile"),
    ])
}

fn existing_shell_rc_candidates() -> Vec<PathBuf> {
    dedup_paths(
        shell_rc_candidates()
            .into_iter()
            .filter(|path| path.exists())
            .collect(),
    )
}

fn get_codex_env_file_path() -> PathBuf {
    get_codex_config_dir().join(".env")
}

fn read_codex_env_file() -> HashMap<String, String> {
    let path = get_codex_env_file_path();
    let Ok(content) = fs::read_to_string(&path) else {
        return HashMap::new();
    };
    parse_env_file(&content)
        .into_iter()
        .filter(|(key, _)| is_valid_env_key_name(key))
        .collect()
}

/// Read one key from Codex's `.env` using the same bounded input size as the
/// Tuzi-managed environment file. Proxy and image compatibility callers must
/// not fall back to arbitrary shell exports while resolving provider keys.
pub(crate) fn read_codex_env_key_file(env_key: &str) -> Result<Option<String>, AppError> {
    if !is_valid_env_key_name(env_key) {
        return Ok(None);
    }
    let path = get_codex_env_file_path();
    let file = match fs::File::open(&path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::io(&path, error)),
    };
    let size = file
        .metadata()
        .map_err(|error| AppError::io(&path, error))?
        .len();
    if size > MAX_MANAGED_ENV_FILE_BYTES {
        return Err(AppError::Config("Codex .env 文件超过大小限制".to_string()));
    }

    let mut content = String::with_capacity(size as usize);
    file.take(MAX_MANAGED_ENV_FILE_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|error| AppError::io(&path, error))?;
    if content.len() as u64 > MAX_MANAGED_ENV_FILE_BYTES {
        return Err(AppError::Config("Codex .env 文件超过大小限制".to_string()));
    }

    Ok(parse_env_file(&content)
        .into_iter()
        .find_map(|(key, value)| (key == env_key && is_valid_env_key_name(&key)).then_some(value))
        .and_then(|value| {
            let value = value.trim();
            (!value.is_empty()).then(|| value.to_string())
        }))
}

fn write_codex_env_key_file(env_key: &str, value: &str) -> Result<(), AppError> {
    validate_env_key_name(env_key)?;
    if value.trim().is_empty() || value.contains(['\r', '\n']) {
        return Err(AppError::InvalidInput(
            "Codex API Key 为空或包含换行符".to_string(),
        ));
    }
    let mut codex_env = read_codex_env_file();
    codex_env.insert(env_key.to_string(), value.to_string());
    write_codex_env_file(&codex_env)
}

fn write_codex_env_file(env_map: &HashMap<String, String>) -> Result<(), AppError> {
    let path = get_codex_env_file_path();
    if env_map.is_empty() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| AppError::io(&path, e))?;
        }
        return Ok(());
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let mut content = serialize_env_file(env_map);
    if !content.is_empty() {
        content.push('\n');
    }
    atomic_write(&path, content.as_bytes())?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&path)
            .map_err(|e| AppError::io(&path, e))?
            .permissions();
        perms.set_mode(0o600);
        fs::set_permissions(&path, perms).map_err(|e| AppError::io(&path, e))?;
    }

    Ok(())
}

pub fn read_managed_env_block() -> HashMap<String, String> {
    if cfg!(target_os = "windows") {
        return read_windows_env_keys();
    }
    let mut managed = HashMap::new();
    let mut codex = HashMap::new();
    for rc_path in shell_rc_candidates() {
        let Ok(content) = fs::read_to_string(&rc_path) else {
            continue;
        };
        managed.extend(parse_managed_block(&content));
        codex.extend(parse_codex_env_section(&content));
    }
    let mut result = managed;
    result.extend(codex);
    // Codex desktop/IDE may not inherit shell startup files, so mirror keys into
    // `~/.codex/.env` and prefer that copy when present.
    result.extend(read_codex_env_file());
    result
}

pub fn read_managed_env_key(env_key: &str) -> Option<String> {
    if !is_valid_env_key_name(env_key) {
        return None;
    }
    if let Some(value) = read_codex_env_file()
        .remove(env_key)
        .filter(|value| !value.trim().is_empty())
    {
        return Some(value);
    }
    if cfg!(target_os = "windows") {
        return std::env::var(env_key).ok().filter(|v| !v.is_empty());
    }
    for rc_path in shell_rc_candidates() {
        if let Some(value) = fs::read_to_string(&rc_path)
            .ok()
            .and_then(|content| parse_codex_env_section(&content).remove(env_key))
            .filter(|value| !value.is_empty())
        {
            return Some(value);
        }
    }

    for rc_path in shell_rc_candidates() {
        if let Some(value) = fs::read_to_string(&rc_path)
            .ok()
            .and_then(|content| parse_managed_block(&content).remove(env_key))
            .filter(|value| !value.is_empty())
        {
            return Some(value);
        }
    }

    for rc_path in shell_rc_candidates() {
        if let Some(value) = fs::read_to_string(&rc_path)
            .ok()
            .and_then(|content| read_env_key_from_shell_rc(&content, env_key))
        {
            return Some(value);
        }
    }
    None
}

/// Copy a credential only when the destination is still empty. The source is
/// deliberately preserved so older provider records remain recoverable.
pub fn copy_managed_env_key_if_missing(
    source_env_key: &str,
    target_env_key: &str,
) -> Result<bool, AppError> {
    validate_env_key_name(source_env_key)?;
    validate_env_key_name(target_env_key)?;
    if source_env_key == target_env_key || read_managed_env_key(target_env_key).is_some() {
        return Ok(false);
    }
    let Some(value) = read_managed_env_key(source_env_key) else {
        return Ok(false);
    };
    write_managed_env_key(target_env_key, &value)?;
    Ok(true)
}

fn missing_codex_env_key_error(env_key: &str) -> AppError {
    AppError::localized(
        "codex.provider_env_key_missing",
        format!(
            "Codex 供应商需要环境变量 {env_key}，但未找到对应 API Key。请重新填写并保存该供应商；当前可用配置未被覆盖。"
        ),
        format!(
            "The Codex provider requires environment variable {env_key}, but its API key is missing. Re-enter and save the provider; the current working configuration was not overwritten."
        ),
    )
}

/// Ensure an env-backed provider credential is available to GUI-launched
/// Codex. Shell startup files are a migration source; ~/.codex/.env is the
/// persistent source used after a reboot.
pub fn ensure_codex_provider_env_ready(config_text: &str) -> Result<(), AppError> {
    let Some(env_key) = extract_codex_env_key(config_text) else {
        return Ok(());
    };
    validate_env_key_name(&env_key)?;
    if read_codex_env_key_file(&env_key)?.is_some() {
        return Ok(());
    }
    let Some(value) = read_managed_env_key(&env_key) else {
        return Err(missing_codex_env_key_error(&env_key));
    };
    write_codex_env_key_file(&env_key, &value)?;
    if read_codex_env_key_file(&env_key)?.is_some() {
        Ok(())
    } else {
        Err(missing_codex_env_key_error(&env_key))
    }
}

pub fn write_managed_env_key(env_key: &str, value: &str) -> Result<(), AppError> {
    validate_env_key_name(env_key)?;
    let mut codex_env = read_codex_env_file();
    codex_env.insert(env_key.to_string(), value.to_string());
    write_codex_env_file(&codex_env)?;
    if cfg!(target_os = "windows") {
        return write_windows_env_key(env_key, value);
    }
    let rc_path = get_shell_rc_path();
    for path in existing_shell_rc_candidates()
        .into_iter()
        .filter(|path| path != &rc_path)
    {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let migrated = migrate_managed_env_block_to_codex_section(&content);
        if migrated != content {
            atomic_write(&path, migrated.as_bytes())?;
        }
    }
    let content = fs::read_to_string(&rc_path).unwrap_or_default();
    let content = migrate_managed_env_block_to_codex_section(&content);
    let new_content = upsert_codex_env_section_key(&content, env_key, value)?;
    atomic_write(&rc_path, new_content.as_bytes())
}

#[allow(dead_code)]
pub fn remove_managed_env_key(env_key: &str) -> Result<(), AppError> {
    validate_env_key_name(env_key)?;
    let mut codex_env = read_codex_env_file();
    if codex_env.remove(env_key).is_some() || get_codex_env_file_path().exists() {
        write_codex_env_file(&codex_env)?;
    }
    if cfg!(target_os = "windows") {
        return remove_windows_env_key(env_key);
    }
    for path in existing_shell_rc_candidates() {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let migrated = migrate_managed_env_block_to_codex_section(&content);
        let new_content = if has_codex_env_section(&migrated) {
            remove_codex_env_section_key(&migrated, env_key)
        } else {
            migrated
        };
        if new_content != content {
            atomic_write(&path, new_content.as_bytes())?;
        }
    }
    Ok(())
}

fn parse_managed_block(content: &str) -> HashMap<String, String> {
    let mut result = HashMap::new();
    let mut in_block = false;
    for line in content.lines() {
        if line.trim() == MANAGED_ENV_BEGIN {
            in_block = true;
            continue;
        }
        if line.trim() == MANAGED_ENV_END {
            break;
        }
        if in_block {
            if let Some((k, v)) = parse_export_line(line) {
                result.insert(k, v);
            }
        }
    }
    result
}

fn remove_managed_env_block_from_content(content: &str) -> String {
    let mut lines = Vec::new();
    let mut in_block = false;

    for line in content.lines() {
        if line.trim() == MANAGED_ENV_BEGIN {
            in_block = true;
            continue;
        }
        if in_block {
            if line.trim() == MANAGED_ENV_END {
                in_block = false;
            }
            continue;
        }
        lines.push(line.to_string());
    }

    finish_shell_rc_lines(lines, content.ends_with('\n'))
}

fn migrate_managed_env_block_to_codex_section(content: &str) -> String {
    let env_map = parse_managed_block(content);
    if env_map.is_empty() {
        return remove_managed_env_block_from_content(content);
    }

    let mut result = remove_managed_env_block_from_content(content);
    let existing_codex_env = parse_codex_env_section(&result);
    let mut keys: Vec<String> = env_map.keys().cloned().collect();
    keys.sort();
    for key in keys {
        if existing_codex_env.contains_key(&key) {
            continue;
        }
        if let Some(value) = env_map.get(&key) {
            let Ok(new_result) = upsert_codex_env_section_key(&result, &key, value) else {
                return content.to_string();
            };
            result = new_result;
        }
    }
    result
}

fn parse_export_line(line: &str) -> Option<(String, String)> {
    let rest = line.trim().strip_prefix("export ")?;
    let (key, val_raw) = rest.split_once('=')?;
    let key = key.trim();
    if !is_valid_env_key_name(key) {
        return None;
    }
    let val = shell_unquote_value(val_raw)?;
    Some((key.to_string(), val))
}

fn codex_env_managed_marker(env_key: &str) -> String {
    format!("{CODEX_ENV_MANAGED_MARKER_PREFIX} {env_key}")
}

fn managed_marker_key(line: &str) -> Option<&str> {
    let key = line
        .trim()
        .strip_prefix(CODEX_ENV_MANAGED_MARKER_PREFIX)?
        .trim();
    is_valid_env_key_name(key).then_some(key)
}

fn is_managed_marker_line(line: &str) -> bool {
    managed_marker_key(line).is_some()
}

fn is_managed_marker_for_key(line: &str, env_key: &str) -> bool {
    managed_marker_key(line).is_some_and(|key| key == env_key)
}

fn is_codex_env_section_header(line: &str) -> bool {
    line.trim()
        .strip_prefix('#')
        .map(str::trim)
        .is_some_and(|title| title.eq_ignore_ascii_case("codex"))
}

fn is_commented_export_line(line: &str) -> bool {
    let Some(comment) = line.trim().strip_prefix('#') else {
        return false;
    };
    comment.trim_start().starts_with("export ")
}

fn find_codex_env_section_range(lines: &[&str]) -> Option<(usize, usize)> {
    let start = lines
        .iter()
        .position(|line| is_codex_env_section_header(line))?;
    let mut end = lines.len();

    for (index, line) in lines.iter().enumerate().skip(start + 1) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            end = index;
            break;
        }
        if trimmed.starts_with('#')
            && !is_commented_export_line(line)
            && !is_codex_env_section_header(line)
            && !is_managed_marker_line(line)
        {
            end = index;
            break;
        }
    }

    Some((start, end))
}

fn has_codex_env_section(content: &str) -> bool {
    content.lines().any(is_codex_env_section_header)
}

fn parse_codex_env_section(content: &str) -> HashMap<String, String> {
    let lines: Vec<&str> = content.lines().collect();
    let Some((start, end)) = find_codex_env_section_range(&lines) else {
        return HashMap::new();
    };

    let mut result = HashMap::new();
    for line in &lines[start + 1..end] {
        if let Some((key, value)) = parse_export_line(line) {
            result.insert(key, value);
        }
    }
    result
}

fn upsert_codex_env_section_key(
    content: &str,
    env_key: &str,
    value: &str,
) -> Result<String, AppError> {
    validate_env_key_name(env_key)?;
    let quoted_value = shell_single_quote(value)?;
    let replacement = format!("export {env_key}={quoted_value}");
    let marker = codex_env_managed_marker(env_key);
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let borrowed: Vec<&str> = lines.iter().map(String::as_str).collect();
    let Some((start, end)) = find_codex_env_section_range(&borrowed) else {
        let mut result = content.to_string();
        if !result.is_empty() && !result.ends_with('\n') {
            result.push('\n');
        }
        result.push_str("# Codex\n");
        result.push_str(&replacement);
        result.push('\n');
        result.push_str(&marker);
        result.push('\n');
        return Ok(result);
    };

    for index in start + 1..end {
        if parse_export_line(&lines[index]).is_some_and(|(key, _)| key == env_key) {
            lines[index] = replacement;
            if index + 1 >= lines.len() || !is_managed_marker_for_key(&lines[index + 1], env_key) {
                lines.insert(index + 1, marker);
            }
            return Ok(finish_shell_rc_lines(lines, content.ends_with('\n')));
        }
    }

    lines.insert(end, replacement);
    lines.insert(end + 1, marker);
    Ok(finish_shell_rc_lines(lines, content.ends_with('\n')))
}

fn remove_codex_env_section_key(content: &str, env_key: &str) -> String {
    let mut lines: Vec<String> = content.lines().map(str::to_string).collect();
    let borrowed: Vec<&str> = lines.iter().map(String::as_str).collect();
    let Some((start, end)) = find_codex_env_section_range(&borrowed) else {
        return content.to_string();
    };

    if let Some(index) =
        lines
            .iter()
            .enumerate()
            .take(end)
            .skip(start + 1)
            .find_map(|(index, line)| {
                parse_export_line(line)
                    .is_some_and(|(key, _)| key == env_key)
                    .then_some(index)
            })
    {
        if index + 1 < lines.len() && is_managed_marker_for_key(&lines[index + 1], env_key) {
            lines.remove(index + 1);
            lines.remove(index);
        }
    }

    finish_shell_rc_lines(lines, content.ends_with('\n'))
}

fn finish_shell_rc_lines(lines: Vec<String>, had_trailing_newline: bool) -> String {
    let mut result = lines.join("\n");
    if had_trailing_newline || !result.is_empty() {
        result.push('\n');
    }
    result
}

fn read_env_key_from_shell_rc(content: &str, env_key: &str) -> Option<String> {
    content
        .lines()
        .filter_map(parse_export_line)
        .filter(|(key, _)| key == env_key)
        .map(|(_, value)| value)
        .last()
        .filter(|value| !value.is_empty())
}

// ---------------------------------------------------------------------------
// Windows environment variable management (via registry/setx)
// ---------------------------------------------------------------------------

/// Read all CODEX-related env keys from Windows user environment variables
fn read_windows_env_keys() -> HashMap<String, String> {
    let mut result = HashMap::new();
    // Read from current process environment (which inherits user env vars)
    for (key, value) in std::env::vars() {
        if key.ends_with("_CODEX_API_KEY") || key == "CODEX_API_KEY" {
            result.insert(key, value);
        }
    }
    result
}

/// Write a user environment variable on Windows using setx
fn write_windows_env_key(env_key: &str, value: &str) -> Result<(), AppError> {
    use std::process::Command;
    let output = Command::new("setx")
        .arg(env_key)
        .arg(value)
        .output()
        .map_err(|e| AppError::Message(format!("Failed to run setx: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Message(format!("setx failed: {stderr}")));
    }

    // Also set in current process so it's immediately available
    std::env::set_var(env_key, value);
    Ok(())
}

/// Remove a user environment variable on Windows
#[allow(dead_code)]
fn remove_windows_env_key(env_key: &str) -> Result<(), AppError> {
    use std::process::Command;
    // setx with empty string effectively removes the variable
    let output = Command::new("reg")
        .args(["delete", "HKCU\\Environment", "/v", env_key, "/f"])
        .output()
        .map_err(|e| AppError::Message(format!("Failed to run reg delete: {e}")))?;

    if !output.status.success() {
        // Ignore error if key doesn't exist
    }

    std::env::remove_var(env_key);
    Ok(())
}

// ---------------------------------------------------------------------------
// Profile-based route management
// ---------------------------------------------------------------------------

/// Switch active profile: only changes top-level `profile` and `model_provider`.
pub fn switch_codex_profile(
    config_text: &str,
    route_id: &str,
    model: Option<&str>,
    model_reasoning_effort: Option<&str>,
) -> Result<String, AppError> {
    let new_format = is_new_profile_format();

    if config_text.trim().is_empty() {
        let m = model.unwrap_or("gpt-5.5");
        let e = model_reasoning_effort.unwrap_or("high");
        let mut s = format!("model_provider = \"{route_id}\"\nmodel = \"{m}\"\nmodel_reasoning_effort = \"{e}\"\ndisable_response_storage = true\n");
        if !new_format {
            s = format!("profile = \"{route_id}\"\n{s}");
        }
        return Ok(s);
    }
    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    if !new_format {
        doc["profile"] = toml_edit::value(route_id);
    } else {
        // Remove profile field if it exists (not needed in new format)
        doc.as_table_mut().remove("profile");
    }
    doc["model_provider"] = toml_edit::value(route_id);

    if let Some(m) = model {
        doc["model"] = toml_edit::value(m);
    }
    if let Some(e) = model_reasoning_effort {
        doc["model_reasoning_effort"] = toml_edit::value(e);
    }

    Ok(doc.to_string())
}

/// Save a route's [profiles.xxx] and [model_providers.xxx] into existing config.toml.
/// Uses text-based insertion to avoid toml_edit formatting issues.
/// Preserves all other content (mcp_servers, projects, notify, etc).
pub fn save_route_to_config(
    existing_config: &str,
    route_id: &str,
    base_url: &str,
    env_key: &str,
    model: &str,
    model_reasoning_effort: &str,
) -> Result<String, AppError> {
    save_route_to_config_with_provider_config(
        existing_config,
        route_id,
        base_url,
        env_key,
        model,
        model_reasoning_effort,
        None,
    )
}

/// Save a route while preserving any future/optional fields already present
/// under the provider's own `[model_providers.<route>]` table.
pub fn save_route_to_config_with_provider_config(
    existing_config: &str,
    route_id: &str,
    base_url: &str,
    env_key: &str,
    model: &str,
    model_reasoning_effort: &str,
    provider_config: Option<&str>,
) -> Result<String, AppError> {
    let new_format = is_new_profile_format();

    let provider_section =
        build_model_provider_section(route_id, base_url, env_key, provider_config)?;

    let mut lines: Vec<String> = existing_config.lines().map(|l| l.to_string()).collect();

    // Remove existing sections for this route
    let profile_header = format!("[profiles.{}]", route_id);
    let provider_header = format!("[model_providers.{}]", route_id);
    lines = remove_section(&lines, &profile_header);
    lines = remove_section(&lines, &provider_header);

    // Remove empty parent headers
    lines.retain(|l| l.trim() != "[profiles]" && l.trim() != "[model_providers]");

    // For new format (0.134.0+), remove top-level profile = "xxx" field
    // This fixes: "不再支持旧版 `profile = "codex"` 配置"
    if new_format {
        lines.retain(|l| !l.trim().starts_with("profile = \""));
    }

    // Ensure top-level fields exist
    if !lines
        .iter()
        .any(|l| l.trim().starts_with("disable_response_storage"))
    {
        lines.insert(0, "disable_response_storage = true".to_string());
    }

    // Find insertion point: before the first non-route section (mcp_servers, projects, etc)
    let insert_idx = find_other_section_start(&lines);

    // Build route block
    let mut route_block = Vec::new();
    route_block.push(String::new());

    // For old versions (< 0.134.0), also write [profiles.xxx]
    if !new_format {
        route_block.push(format!("[profiles.{}]", route_id));
        route_block.push(format!("model_provider = \"{}\"", route_id));
        route_block.push(format!("model = \"{}\"", model));
        route_block.push(format!(
            "model_reasoning_effort = \"{}\"",
            model_reasoning_effort
        ));
        route_block.push("approval_policy = \"on-request\"".to_string());
        route_block.push(String::new());
    }

    for line in provider_section.lines() {
        route_block.push(line.to_string());
    }

    for (i, line) in route_block.into_iter().enumerate() {
        lines.insert(insert_idx + i, line);
    }

    let mut result = lines.join("\n");
    if !result.ends_with('\n') {
        result.push('\n');
    }
    while result.contains("\n\n\n") {
        result = result.replace("\n\n\n", "\n\n");
    }
    Ok(result)
}

fn build_model_provider_section(
    route_id: &str,
    base_url: &str,
    env_key: &str,
    provider_config: Option<&str>,
) -> Result<String, AppError> {
    if CODEX_RESERVED_MODEL_PROVIDER_IDS
        .iter()
        .any(|reserved| reserved.eq_ignore_ascii_case(route_id))
    {
        return Err(AppError::Message(format!(
            "model_providers contains reserved built-in provider IDs: `{route_id}`. Built-in providers cannot be overridden. Rename your custom provider (for example, `{route_id}-custom`)."
        )));
    }

    let mut doc = provider_config
        .filter(|config| !config.trim().is_empty())
        .map(|config| {
            config
                .parse::<DocumentMut>()
                .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))
        })
        .transpose()?
        .unwrap_or_default();

    if !doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .is_some()
    {
        doc["model_providers"] = toml_edit::Item::Table(toml_edit::Table::new());
    }

    if let Some(providers) = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
    {
        if !providers.contains_key(route_id) {
            providers.insert(route_id, toml_edit::Item::Table(toml_edit::Table::new()));
        }
    }

    {
        let Some(table) = doc
            .get_mut("model_providers")
            .and_then(|item| item.as_table_mut())
            .and_then(|providers| providers.get_mut(route_id))
            .and_then(|item| item.as_table_mut())
        else {
            return Err(AppError::Message(format!(
                "Failed to prepare Codex provider section for '{route_id}'"
            )));
        };

        table["name"] = toml_edit::value(route_id);
        table["base_url"] = toml_edit::value(base_url);
        if !table.contains_key("wire_api") {
            table["wire_api"] = toml_edit::value("responses");
        }
        if !env_key.trim().is_empty() {
            table["requires_openai_auth"] = toml_edit::value(false);
        } else if !table.contains_key("requires_openai_auth") {
            table["requires_openai_auth"] = toml_edit::value(false);
        }
        if env_key.trim().is_empty() {
            table.remove("env_key");
        } else {
            table["env_key"] = toml_edit::value(env_key);
        }
        table.remove("experimental_bearer_token");
    }
    doc.as_table_mut().remove("experimental_bearer_token");

    extract_model_provider_section_text(&doc.to_string(), route_id).ok_or_else(|| {
        AppError::Message(format!(
            "Failed to render Codex provider section for '{route_id}'"
        ))
    })
}

fn extract_model_provider_section_text(config_text: &str, route_id: &str) -> Option<String> {
    let header = format!("[model_providers.{route_id}]");
    let nested_prefix = format!("[model_providers.{route_id}.");
    let mut result = Vec::new();
    let mut in_section = false;

    for line in config_text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') {
            if trimmed == header || trimmed.starts_with(&nested_prefix) {
                in_section = true;
            } else if in_section {
                break;
            }
        }

        if in_section {
            result.push(line);
        }
    }

    if result.is_empty() {
        None
    } else {
        let mut text = result.join("\n");
        text.push('\n');
        Some(text)
    }
}

/// Remove a route's [profiles.xxx] and [model_providers.xxx] sections from config.toml.
#[allow(dead_code)]
pub fn remove_route_from_config(config_text: &str, route_id: &str) -> String {
    let lines: Vec<String> = config_text.lines().map(|l| l.to_string()).collect();
    let profile_header = format!("[profiles.{}]", route_id);
    let provider_header = format!("[model_providers.{}]", route_id);
    let after_profile = remove_section(&lines, &profile_header);
    let after_both = remove_section(&after_profile, &provider_header);
    let mut result = after_both.join("\n");
    // Clean up multiple blank lines
    while result.contains("\n\n\n") {
        result = result.replace("\n\n\n", "\n\n");
    }
    if !result.ends_with('\n') {
        result.push('\n');
    }
    result
}

/// Remove a tuzi-switch managed Codex provider route from `config.toml`.
///
/// The official Codex config keeps the active provider in the top-level
/// `model_provider` key. When it points at the removed route, leave the key in
/// place but clear it, matching the UI's "no active provider" state.
pub fn clear_codex_route_from_config(
    config_text: &str,
    route_id: &str,
) -> Result<String, AppError> {
    let mut cleaned = remove_route_from_config(config_text, route_id);
    if cleaned.trim().is_empty() {
        return Ok(cleaned);
    }

    let mut doc = cleaned
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("TOML parse error: {e}")))?;

    let active_route = doc
        .get("model_provider")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if active_route == route_id {
        doc["model_provider"] = toml_edit::value("");
        cleaned = doc.to_string();
    }

    if !cleaned.ends_with('\n') {
        cleaned.push('\n');
    }
    Ok(cleaned)
}

fn remove_section(lines: &[String], header: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut skipping = false;
    let nested_header_prefix = header.strip_suffix(']').map(|prefix| format!("{prefix}."));
    for line in lines {
        let trimmed = line.trim();
        let is_target_header = trimmed == header
            || nested_header_prefix
                .as_deref()
                .is_some_and(|prefix| trimmed.starts_with(prefix));
        if is_target_header {
            skipping = true;
            continue;
        }
        if skipping && trimmed.starts_with('[') {
            skipping = false;
        }
        if !skipping {
            result.push(line.clone());
        }
    }
    result
}

fn find_other_section_start(lines: &[String]) -> usize {
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.starts_with('[')
            && !trimmed.starts_with("[profiles.")
            && !trimmed.starts_with("[model_providers.")
            && !trimmed.starts_with("[profiles]")
            && !trimmed.starts_with("[model_providers]")
        {
            return i;
        }
    }
    lines.len()
}

/// Legacy merge function kept for compatibility
#[allow(dead_code)]
pub fn merge_codex_route(existing_config: &str, new_config: &str) -> Result<String, AppError> {
    if new_config.trim().is_empty() {
        return Ok(existing_config.to_string());
    }
    // Just return existing - switch no longer merges
    Ok(existing_config.to_string())
}

/// 获取 Codex 配置目录路径
pub fn get_codex_config_dir() -> PathBuf {
    if let Some(custom) = crate::settings::get_codex_override_dir() {
        return custom;
    }

    get_home_dir().join(".codex")
}

/// 获取 Codex auth.json 路径
pub fn get_codex_auth_path() -> PathBuf {
    get_codex_config_dir().join("auth.json")
}

/// 获取 Codex config.toml 路径
pub fn get_codex_config_path() -> PathBuf {
    get_codex_config_dir().join("config.toml")
}

pub fn get_codex_model_catalog_path() -> PathBuf {
    get_codex_config_dir().join(TUZI_SWITCH_CODEX_MODEL_CATALOG_FILENAME)
}

fn table_looks_like_custom_reserved_provider(table: &toml_edit::Table) -> bool {
    table.iter().any(|(key, item)| {
        matches!(
            key,
            "name"
                | "base_url"
                | "env_key"
                | "wire_api"
                | "requires_openai_auth"
                | "experimental_bearer_token"
        ) || item.as_value().is_some()
    })
}

fn unique_custom_provider_id(
    model_providers: &toml_edit::Table,
    reserved_id: &str,
    pending_ids: &HashSet<String>,
) -> String {
    let base = sanitize_provider_name(&format!("{reserved_id}-custom"));
    let base = if base.trim().is_empty() {
        format!("{reserved_id}-custom")
    } else {
        base
    };
    if !model_providers.contains_key(base.as_str()) && !pending_ids.contains(&base) {
        return base;
    }

    let mut counter = 2usize;
    loop {
        let candidate = format!("{base}_{counter}");
        if !model_providers.contains_key(candidate.as_str()) && !pending_ids.contains(&candidate) {
            return candidate;
        }
        counter += 1;
    }
}

fn migrate_reserved_custom_model_provider_ids(config_text: &str) -> Result<String, AppError> {
    if config_text.trim().is_empty() || !config_text.contains("[model_providers.") {
        return Ok(config_text.to_string());
    }

    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    let Some(model_providers) = doc.get("model_providers").and_then(|item| item.as_table()) else {
        return Ok(config_text.to_string());
    };

    let mut planned = Vec::new();
    let mut pending_ids = HashSet::new();
    for reserved_id in CODEX_RESERVED_MODEL_PROVIDER_IDS {
        let Some(item) = model_providers.get(*reserved_id) else {
            continue;
        };
        let Some(table) = item.as_table() else {
            continue;
        };
        if !table_looks_like_custom_reserved_provider(table) {
            continue;
        }

        let replacement = unique_custom_provider_id(model_providers, reserved_id, &pending_ids);
        pending_ids.insert(replacement.clone());
        planned.push(((*reserved_id).to_string(), replacement));
    }

    if planned.is_empty() {
        return Ok(config_text.to_string());
    }

    let replacements: HashMap<String, String> = planned.into_iter().collect();
    if let Some(model_providers) = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
    {
        for (source_id, target_id) in &replacements {
            let Some(provider_item) = model_providers.remove(source_id.as_str()) else {
                continue;
            };
            model_providers[target_id.as_str()] = provider_item;
            if let Some(table) = model_providers
                .get_mut(target_id.as_str())
                .and_then(|item| item.as_table_mut())
            {
                if table
                    .get("name")
                    .and_then(|item| item.as_str())
                    .is_some_and(|name| name.eq_ignore_ascii_case(source_id))
                {
                    table["name"] = toml_edit::value(target_id.as_str());
                }
            }
        }
    }

    if let Some(active_provider) = doc.get("model_provider").and_then(|item| item.as_str()) {
        if let Some(target_id) = replacements.get(active_provider) {
            doc["model_provider"] = toml_edit::value(target_id.as_str());
        }
    }

    if let Some(profiles) = doc
        .get_mut("profiles")
        .and_then(|item| item.as_table_like_mut())
    {
        let profile_keys: Vec<String> = profiles.iter().map(|(key, _)| key.to_string()).collect();
        for profile_key in profile_keys {
            let Some(profile_table) = profiles
                .get_mut(&profile_key)
                .and_then(|item| item.as_table_like_mut())
            else {
                continue;
            };
            let Some(model_provider) = profile_table
                .get("model_provider")
                .and_then(|item| item.as_str())
            else {
                continue;
            };
            if let Some(target_id) = replacements.get(model_provider) {
                profile_table.insert("model_provider", toml_edit::value(target_id.as_str()));
            }
        }
    }

    Ok(doc.to_string())
}

fn migrate_env_backed_provider_auth_mode(config_text: &str) -> Result<String, AppError> {
    if config_text.trim().is_empty() || !config_text.contains("[model_providers.") {
        return Ok(config_text.to_string());
    }

    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    let Some(model_providers) = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
    else {
        return Ok(config_text.to_string());
    };

    for (_, provider_item) in model_providers.iter_mut() {
        let Some(provider_table) = provider_item.as_table_mut() else {
            continue;
        };
        let env_key = provider_table
            .get("env_key")
            .and_then(|item| item.as_str())
            .map(str::trim)
            .unwrap_or("");
        if env_key.is_empty() {
            continue;
        }

        let base_url = provider_table
            .get("base_url")
            .and_then(|item| item.as_str())
            .map(str::trim)
            .unwrap_or("");
        if base_url.eq_ignore_ascii_case("https://chatgpt.com/backend-api/codex") {
            continue;
        }

        provider_table["requires_openai_auth"] = toml_edit::value(false);
    }

    Ok(doc.to_string())
}

/// Codex 0.134+ 的 profile 文件：`~/.codex/<profile>.config.toml`。
pub fn get_codex_profile_config_path(profile_name: &str) -> PathBuf {
    let base_name = sanitize_provider_name(profile_name);
    let base_name = if base_name.trim().is_empty() {
        sanitize_provider_name(CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
    } else {
        base_name
    };
    get_codex_config_dir().join(format!("{base_name}.config.toml"))
}

/// 获取 Codex 供应商配置文件路径
#[allow(dead_code)]
pub fn get_codex_provider_paths(
    provider_id: &str,
    provider_name: Option<&str>,
) -> (PathBuf, PathBuf) {
    let base_name = provider_name
        .map(sanitize_provider_name)
        .unwrap_or_else(|| sanitize_provider_name(provider_id));

    let auth_path = get_codex_config_dir().join(format!("auth-{base_name}.json"));
    let config_path = get_codex_config_dir().join(format!("config-{base_name}.toml"));

    (auth_path, config_path)
}

pub fn write_codex_profile_config(profile_name: &str, config_text: &str) -> Result<(), AppError> {
    let config_text = migrate_reserved_custom_model_provider_ids(config_text)?;
    let config_text = migrate_env_backed_provider_auth_mode(&config_text)?;
    validate_config_toml(&config_text)?;
    write_text_file(&get_codex_profile_config_path(profile_name), &config_text)
}

pub fn delete_codex_profile_config(profile_name: &str) -> Result<(), AppError> {
    let path = get_codex_profile_config_path(profile_name);
    if path.exists() {
        delete_file(&path)?;
    }
    Ok(())
}

/// 删除 Codex 供应商配置文件
#[allow(dead_code)]
pub fn delete_codex_provider_config(
    provider_id: &str,
    provider_name: &str,
) -> Result<(), AppError> {
    let (auth_path, config_path) = get_codex_provider_paths(provider_id, Some(provider_name));

    delete_file(&auth_path).ok();
    delete_file(&config_path).ok();

    Ok(())
}

/// 原子写 Codex 的 `auth.json` 与 `config.toml`，在第二步失败时回滚第一步
pub fn write_codex_live_atomic(
    auth: &Value,
    config_text_opt: Option<&str>,
) -> Result<(), AppError> {
    let _config_lock = CODEX_CONFIG_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let auth_path = get_codex_auth_path();
    let config_path = get_codex_config_path();

    if let Some(parent) = auth_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    // 读取旧内容用于回滚
    let old_auth = if auth_path.exists() {
        Some(fs::read(&auth_path).map_err(|e| AppError::io(&auth_path, e))?)
    } else {
        None
    };
    let _old_config = if config_path.exists() {
        Some(fs::read(&config_path).map_err(|e| AppError::io(&config_path, e))?)
    } else {
        None
    };

    // 准备写入内容
    let cfg_text = match config_text_opt {
        Some(s) => {
            let migrated = migrate_reserved_custom_model_provider_ids(s)?;
            migrate_env_backed_provider_auth_mode(&migrated)?
        }
        None => String::new(),
    };
    if !cfg_text.trim().is_empty() {
        toml::from_str::<toml::Table>(&cfg_text).map_err(|e| AppError::toml(&config_path, e))?;
    }

    // 第一步：写 auth.json
    write_json_file(&auth_path, auth)?;

    // 第二步：写 config.toml（失败则回滚 auth.json）
    if let Err(e) = write_text_file(&config_path, &cfg_text) {
        // 回滚 auth.json
        if let Some(bytes) = old_auth {
            let _ = atomic_write(&auth_path, &bytes);
        } else {
            let _ = delete_file(&auth_path);
        }
        return Err(e);
    }

    Ok(())
}

/// 原子写 Codex 的 `config.toml`，不触碰 `auth.json`。
pub fn write_codex_live_config_atomic(config_text_opt: Option<&str>) -> Result<(), AppError> {
    let _config_lock = CODEX_CONFIG_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let config_path = get_codex_config_path();
    let cfg_text = match config_text_opt {
        Some(text) => {
            let migrated = migrate_reserved_custom_model_provider_ids(text)?;
            migrate_env_backed_provider_auth_mode(&migrated)?
        }
        None => String::new(),
    };

    if !cfg_text.trim().is_empty() {
        toml::from_str::<toml::Table>(&cfg_text).map_err(|e| AppError::toml(&config_path, e))?;
    }

    write_text_file(&config_path, &cfg_text)
}

/// Read the global subagent concurrency setting from the effective Codex config.
/// The legacy `agents.max_threads` key is accepted for compatibility, but the
/// canonical key is always preferred when both are present.
pub fn read_codex_subagent_settings() -> Result<CodexSubagentSettings, AppError> {
    let config_path = get_codex_config_path();
    let config_text = read_codex_config_text()?;
    codex_subagent_settings_from_text(&config_path, &config_text)
}

/// Read the device-level default, migrating the pre-provider implementation
/// from the live config exactly once.
pub fn read_codex_subagent_default_settings() -> Result<CodexSubagentSettings, AppError> {
    let live = read_codex_subagent_settings()?;
    let value = crate::settings::initialize_codex_subagent_default_threads(
        live.max_concurrent_threads_per_session,
    )?;
    Ok(CodexSubagentSettings {
        max_concurrent_threads_per_session: value,
        config_path: live.config_path,
        used_legacy_alias: live.used_legacy_alias,
    })
}

pub fn resolved_codex_subagent_threads(
    provider_override: Option<u64>,
) -> Result<Option<u64>, AppError> {
    if let Some(value) = provider_override {
        validate_codex_subagent_threads(Some(value))?;
    }
    let settings = crate::settings::get_settings();
    if settings.codex_subagent_default_initialized {
        return Ok(provider_override.or(settings.codex_subagent_default_threads));
    }
    let live = read_codex_subagent_settings()?;
    let default = crate::settings::initialize_codex_subagent_default_threads(
        live.max_concurrent_threads_per_session,
    )?;
    Ok(provider_override.or(default))
}

fn codex_subagent_settings_from_text(
    config_path: &Path,
    config_text: &str,
) -> Result<CodexSubagentSettings, AppError> {
    let doc = if config_text.trim().is_empty() {
        DocumentMut::new()
    } else {
        config_text.parse::<DocumentMut>().map_err(|e| {
            AppError::Message(format!(
                "Invalid Codex config.toml ({}): {e}",
                config_path.display()
            ))
        })?
    };

    let agents = doc.get("agents").and_then(|item| item.as_table_like());
    let read_value = |key: &str| -> Result<Option<u64>, AppError> {
        let Some(item) = agents.and_then(|table| table.get(key)) else {
            return Ok(None);
        };
        let value = item
            .as_integer()
            .ok_or_else(|| AppError::Config(format!("Codex agents.{key} 必须是大于 0 的整数")))?;
        let value = u64::try_from(value)
            .ok()
            .filter(|value| *value > 0)
            .ok_or_else(|| AppError::Config(format!("Codex agents.{key} 必须是大于 0 的整数")))?;
        Ok(Some(value))
    };
    let canonical = read_value(CODEX_SUBAGENT_THREADS_KEY)?;
    let legacy = read_value(CODEX_LEGACY_SUBAGENT_THREADS_KEY)?;

    Ok(CodexSubagentSettings {
        max_concurrent_threads_per_session: canonical.or(legacy),
        config_path: config_path.to_string_lossy().to_string(),
        used_legacy_alias: canonical.is_none() && legacy.is_some(),
    })
}

/// Set or clear the global subagent concurrency setting while preserving all
/// unrelated Codex TOML content. Setting a value also removes the legacy alias.
pub fn set_codex_subagent_max_concurrent_threads(
    value: Option<u64>,
) -> Result<CodexSubagentSettings, AppError> {
    validate_codex_subagent_threads(value)?;

    let _config_lock = CODEX_CONFIG_WRITE_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let config_path = get_codex_config_path();
    let config_text = read_codex_config_text()?;
    let updated = apply_codex_subagent_threads_to_config_text(&config_text, value)?;

    write_text_file(&config_path, &updated)?;
    drop(_config_lock);
    read_codex_subagent_settings()
}

pub fn validate_codex_subagent_threads(value: Option<u64>) -> Result<(), AppError> {
    if value.is_some_and(|threads| threads == 0 || threads > i64::MAX as u64) {
        return Err(AppError::Config(
            "Codex 子代理并发线程数必须是大于 0 且不超过 64 位整数上限的整数".to_string(),
        ));
    }
    Ok(())
}

pub fn apply_codex_subagent_threads_to_config_text(
    config_text: &str,
    value: Option<u64>,
) -> Result<String, AppError> {
    validate_codex_subagent_threads(value)?;
    let mut doc = if config_text.trim().is_empty() {
        DocumentMut::new()
    } else {
        config_text
            .parse::<DocumentMut>()
            .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?
    };

    match value {
        Some(threads) => {
            if doc.get("agents").is_none() {
                doc["agents"] = toml_edit::table();
            }
            let agents = doc
                .get_mut("agents")
                .and_then(|item| item.as_table_like_mut())
                .ok_or_else(|| AppError::Config("Codex [agents] 必须是表".to_string()))?;
            agents.insert(CODEX_SUBAGENT_THREADS_KEY, toml_edit::value(threads as i64));
            agents.remove(CODEX_LEGACY_SUBAGENT_THREADS_KEY);
        }
        None => {
            if let Some(agents) = doc
                .get_mut("agents")
                .and_then(|item| item.as_table_like_mut())
            {
                agents.remove(CODEX_SUBAGENT_THREADS_KEY);
                agents.remove(CODEX_LEGACY_SUBAGENT_THREADS_KEY);
                if agents.is_empty() {
                    doc.as_table_mut().remove("agents");
                }
            }
        }
    }

    Ok(doc.to_string())
}

pub fn apply_codex_subagent_threads_to_settings(
    settings: &mut Value,
    value: Option<u64>,
) -> Result<(), AppError> {
    let Some(object) = settings.as_object_mut() else {
        return Err(AppError::Config(
            "Codex 供应商配置必须是 JSON 对象".to_string(),
        ));
    };
    let config_text = object.get("config").and_then(Value::as_str).unwrap_or("");
    object.insert(
        "config".to_string(),
        Value::String(apply_codex_subagent_threads_to_config_text(
            config_text,
            value,
        )?),
    );
    Ok(())
}

pub fn strip_codex_subagent_threads_from_settings(settings: &mut Value) -> Result<(), AppError> {
    let Some(object) = settings.as_object_mut() else {
        return Ok(());
    };
    let Some(config_text) = object.get("config").and_then(Value::as_str) else {
        return Ok(());
    };
    object.insert(
        "config".to_string(),
        Value::String(apply_codex_subagent_threads_to_config_text(
            config_text,
            None,
        )?),
    );
    Ok(())
}

/// Preserve global Codex tables when a provider-specific write supplies a
/// config fragment without them. Provider switching should not erase settings
/// such as `[agents]` that are owned by the user-level config.
pub fn preserve_codex_global_tables_from_live(config_text: &str) -> Result<String, AppError> {
    if config_text.trim().is_empty() {
        return Ok(config_text.to_string());
    }
    let current = read_codex_config_text().unwrap_or_default();
    if current.trim().is_empty() {
        return Ok(config_text.to_string());
    }

    preserve_codex_global_tables_from_text(config_text, &current)
}

fn preserve_codex_global_tables_from_text(
    config_text: &str,
    current: &str,
) -> Result<String, AppError> {
    if config_text.trim().is_empty() || current.trim().is_empty() {
        return Ok(config_text.to_string());
    }

    let mut candidate = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    let live = current
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid live Codex config.toml: {e}")))?;

    let Some(live_agents) = live.get("agents") else {
        return Ok(config_text.to_string());
    };
    if candidate.get("agents").is_none() {
        candidate["agents"] = live_agents.clone();
        return Ok(candidate.to_string());
    }

    let Some(live_table) = live_agents.as_table() else {
        return Ok(candidate.to_string());
    };
    let Some(candidate_table) = candidate
        .get_mut("agents")
        .and_then(|item| item.as_table_mut())
    else {
        return Ok(candidate.to_string());
    };
    for (key, item) in live_table.iter() {
        // `[agents]` is user-level configuration. Keep the live value when a
        // provider snapshot happens to include the same key.
        candidate_table.insert(key, item.clone());
    }
    Ok(candidate.to_string())
}

/// 读取 `~/.codex/config.toml`，若不存在返回空字符串
pub fn read_codex_config_text() -> Result<String, AppError> {
    let path = get_codex_config_path();
    if path.exists() {
        std::fs::read_to_string(&path).map_err(|e| AppError::io(&path, e))
    } else {
        Ok(String::new())
    }
}

/// 对非空的 TOML 文本进行语法校验
pub fn validate_config_toml(text: &str) -> Result<(), AppError> {
    if text.trim().is_empty() {
        return Ok(());
    }
    toml::from_str::<toml::Table>(text)
        .map(|_| ())
        .map_err(|e| AppError::toml(Path::new("config.toml"), e))
}

/// 读取并校验 `~/.codex/config.toml`，返回文本（可能为空）
pub fn read_and_validate_codex_config_text() -> Result<String, AppError> {
    let s = read_codex_config_text()?;
    validate_config_toml(&s)?;
    Ok(s)
}

pub fn read_codex_live_settings() -> Result<Value, AppError> {
    let auth_path = get_codex_auth_path();
    let auth_present = auth_path.exists();
    let auth: Value = if auth_present {
        read_json_file(&auth_path)?
    } else {
        json!({})
    };
    let cfg_text = read_and_validate_codex_config_text()?;
    if !auth_present && cfg_text.trim().is_empty() {
        return Err(AppError::localized(
            "codex.live.missing",
            "Codex 配置文件不存在",
            "Codex configuration is missing",
        ));
    }
    Ok(json!({ "auth": auth, "config": cfg_text }))
}

pub fn extract_codex_auth_api_key(auth: &Value) -> Option<String> {
    auth.get("OPENAI_API_KEY")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(str::to_string)
}

pub fn codex_auth_has_login_material(auth: &Value) -> bool {
    let Some(obj) = auth.as_object() else {
        return false;
    };

    obj.iter().any(|(key, value)| {
        if key == "auth_mode" {
            return false;
        }

        if key == "OPENAI_API_KEY" {
            return value
                .as_str()
                .map(str::trim)
                .is_some_and(|token| !token.is_empty());
        }

        match value {
            Value::Null => false,
            Value::String(text) => !text.trim().is_empty(),
            Value::Array(items) => !items.is_empty(),
            Value::Object(map) => !map.is_empty(),
            _ => true,
        }
    })
}

pub fn codex_auth_has_oauth_login_material(auth: &Value) -> bool {
    let Some(obj) = auth.as_object() else {
        return false;
    };

    obj.iter().any(|(key, value)| {
        if key == "auth_mode" || key == "OPENAI_API_KEY" {
            return false;
        }

        match value {
            Value::Null => false,
            Value::String(text) => !text.trim().is_empty(),
            Value::Array(items) => !items.is_empty(),
            Value::Object(map) => !map.is_empty(),
            _ => true,
        }
    })
}

/// Only count material that Codex can authenticate with. Metadata such as
/// `last_refresh` and `tokens.account_id` must not protect stale API-key auth.
pub fn codex_auth_has_credential_login_material(auth: &Value) -> bool {
    let Some(obj) = auth.as_object() else {
        return false;
    };

    let value_present = |value: &Value| match value {
        Value::Null => false,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
        _ => true,
    };

    if ["personal_access_token", "agent_identity", "bedrock_api_key"]
        .iter()
        .any(|key| obj.get(*key).is_some_and(value_present))
    {
        return true;
    }

    obj.get("tokens")
        .and_then(Value::as_object)
        .is_some_and(|tokens| {
            ["id_token", "access_token", "refresh_token"]
                .iter()
                .any(|key| tokens.get(*key).is_some_and(value_present))
        })
}

#[allow(dead_code)]
pub fn extract_codex_api_key(auth: Option<&Value>, config_text: Option<&str>) -> Option<String> {
    auth.and_then(extract_codex_auth_api_key)
        .or_else(|| config_text.and_then(extract_codex_experimental_bearer_token))
}

pub fn should_restore_codex_provider_token_for_backfill(
    category: Option<&str>,
    template_settings: &Value,
) -> bool {
    if category == Some("official") {
        return false;
    }

    let Some(auth) = template_settings.get("auth") else {
        return true;
    };

    let has_provider_api_key = extract_codex_auth_api_key(auth).is_some();
    let has_oauth_login = codex_auth_has_oauth_login_material(auth);
    !has_oauth_login || has_provider_api_key
}

fn active_codex_model_provider_id(doc: &DocumentMut) -> Option<String> {
    doc.get("model_provider")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

pub fn codex_config_uses_custom_provider(config_text: &str) -> bool {
    codex_custom_provider_anchor_id(config_text).is_some()
}

/// Return the custom provider id that currently owns Codex session history.
/// Reserved built-in ids are deliberately excluded because they cannot be
/// reused as third-party routing anchors.
pub(crate) fn codex_custom_provider_anchor_id(config_text: &str) -> Option<String> {
    let doc = config_text.parse::<DocumentMut>().ok()?;
    let provider_id = active_codex_model_provider_id(&doc)?;
    if !is_custom_codex_model_provider_id(&provider_id) {
        return None;
    }

    doc.get("model_providers")
        .and_then(|item| item.as_table())
        .is_some_and(|providers| providers.contains_key(provider_id.as_str()))
        .then_some(provider_id)
}

fn is_custom_codex_model_provider_id(id: &str) -> bool {
    let id = id.trim();
    !id.is_empty()
        && !CODEX_RESERVED_MODEL_PROVIDER_IDS
            .iter()
            .any(|reserved| reserved.eq_ignore_ascii_case(id))
}

fn codex_active_provider_table<'a>(
    doc: &'a DocumentMut,
    provider_id: &str,
) -> Option<&'a toml_edit::Table> {
    doc.get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|table| table.get(provider_id))
        .and_then(|item| item.as_table())
}

pub(crate) fn extract_codex_env_key(config_text: &str) -> Option<String> {
    let doc = config_text.parse::<DocumentMut>().ok()?;
    let provider_id = active_codex_model_provider_id(&doc)?;
    codex_active_provider_table(&doc, &provider_id)
        .and_then(|table| table.get("env_key"))
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|env_key| !env_key.is_empty())
        .map(str::to_string)
}

pub fn extract_codex_experimental_bearer_token(config_text: &str) -> Option<String> {
    if !config_text.contains("experimental_bearer_token") {
        return None;
    }

    let doc = config_text.parse::<DocumentMut>().ok()?;
    let provider_id = active_codex_model_provider_id(&doc);

    let top_level_token = || {
        doc.get("experimental_bearer_token")
            .and_then(|item| item.as_str())
    };
    let token = match provider_id.as_deref() {
        Some(id) if is_custom_codex_model_provider_id(id) => codex_active_provider_table(&doc, id)
            .and_then(|table| table.get("experimental_bearer_token"))
            .and_then(|item| item.as_str())
            .or_else(top_level_token),
        Some(_) => top_level_token(),
        None => top_level_token(),
    };

    token
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
}

pub fn set_codex_experimental_bearer_token(
    config_text: &str,
    token: &str,
) -> Result<String, AppError> {
    if config_text.trim().is_empty() {
        return Err(AppError::localized(
            "provider.codex.config.missing",
            "Codex 第三方供应商缺少 config.toml 配置，无法写入 bearer token",
            "Codex third-party provider is missing config.toml, cannot write bearer token",
        ));
    }

    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    let Some(provider_id) = active_codex_model_provider_id(&doc) else {
        doc["experimental_bearer_token"] = toml_edit::value(token);
        return Ok(doc.to_string());
    };

    if !is_custom_codex_model_provider_id(&provider_id) {
        doc["experimental_bearer_token"] = toml_edit::value(token);
        return Ok(doc.to_string());
    }

    if let Some(provider_table) = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
        .and_then(|table| table.get_mut(provider_id.as_str()))
        .and_then(|item| item.as_table_mut())
    {
        provider_table["experimental_bearer_token"] = toml_edit::value(token);
        return Ok(doc.to_string());
    }

    doc["experimental_bearer_token"] = toml_edit::value(token);
    Ok(doc.to_string())
}

pub fn remove_codex_live_only_provider_fields(config_text: &str) -> Result<String, AppError> {
    if config_text.trim().is_empty() || !config_text.contains("experimental_bearer_token") {
        return Ok(config_text.to_string());
    }

    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    if let Some(providers) = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
    {
        for (_, item) in providers.iter_mut() {
            if let Some(provider_table) = item.as_table_mut() {
                provider_table.remove("experimental_bearer_token");
            }
        }
    }

    doc.as_table_mut().remove("experimental_bearer_token");
    Ok(doc.to_string())
}

pub fn prepare_codex_provider_live_config(
    auth: &Value,
    config_text: &str,
) -> Result<String, AppError> {
    ensure_codex_provider_env_ready(config_text)?;
    prepare_codex_provider_live_config_with_env_reader(auth, config_text, read_managed_env_key)
}

fn codex_unified_official_provider_table() -> toml_edit::Table {
    let mut table = toml_edit::Table::new();
    table["name"] = toml_edit::value("OpenAI");
    table["requires_openai_auth"] = toml_edit::value(true);
    table["supports_websockets"] = toml_edit::value(true);
    table["wire_api"] = toml_edit::value("responses");
    table
}

fn table_matches_codex_unified_official_provider(table: &toml_edit::Table) -> bool {
    table.len() == 4
        && table.get("name").and_then(|item| item.as_str()) == Some("OpenAI")
        && table
            .get("requires_openai_auth")
            .and_then(|item| item.as_bool())
            == Some(true)
        && table
            .get("supports_websockets")
            .and_then(|item| item.as_bool())
            == Some(true)
        && table.get("wire_api").and_then(|item| item.as_str()) == Some("responses")
}

pub fn configured_codex_history_anchor_id() -> String {
    crate::settings::get_codex_history_anchor_id_for_path(&get_codex_config_dir())
        .or_else(|| {
            read_codex_config_text()
                .ok()
                .and_then(|config| codex_custom_provider_anchor_id(&config))
        })
        .unwrap_or_else(|| DEFAULT_CODEX_MODEL_PROVIDER_ID.to_string())
}

fn validate_codex_config_routes_history_anchor(config_text: &str) -> Result<(), AppError> {
    if !crate::settings::unify_codex_session_history() || config_text.trim().is_empty() {
        return Ok(());
    }
    let anchor_id = configured_codex_history_anchor_id();
    let doc = config_text
        .parse::<DocumentMut>()
        .map_err(|error| AppError::Message(format!("Invalid Codex config.toml: {error}")))?;
    let active_id = active_codex_model_provider_id(&doc);
    let has_anchor_table = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .is_some_and(|providers| providers.contains_key(anchor_id.as_str()));
    if active_id.as_deref() != Some(anchor_id.as_str()) || !has_anchor_table {
        return Err(AppError::Config(format!(
            "Codex 统一会话桶校验失败：期望 model_provider='{anchor_id}'，实际为 {:?}",
            active_id
        )));
    }
    Ok(())
}

fn inject_codex_unified_session_bucket_with_id(
    config_text: &str,
    anchor_id: &str,
) -> Result<String, AppError> {
    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    if active_codex_model_provider_id(&doc).as_deref() == Some(anchor_id) {
        return Ok(config_text.to_string());
    }

    if let Some(active_provider_id) = active_codex_model_provider_id(&doc) {
        if !is_custom_codex_model_provider_id(&active_provider_id) {
            return Ok(config_text.to_string());
        }

        let Some(model_providers) = doc
            .get_mut("model_providers")
            .and_then(|item| item.as_table_mut())
        else {
            return Ok(config_text.to_string());
        };
        let Some(provider_table) = model_providers.remove(active_provider_id.as_str()) else {
            return Ok(config_text.to_string());
        };
        model_providers[anchor_id] = provider_table;
        rewrite_codex_profile_model_provider_refs(&mut doc, &active_provider_id, anchor_id);
        doc["model_provider"] = toml_edit::value(anchor_id);
        return Ok(doc.to_string());
    }

    let existing_unified_conflicts = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|providers| providers.get(anchor_id))
        .and_then(|item| item.as_table())
        .is_some_and(|table| !table_matches_codex_unified_official_provider(table));
    if existing_unified_conflicts {
        log::warn!(
            "官方 Codex 配置已存在自定义 [model_providers.{}]，跳过统一会话路由注入以避免激活未知路由",
            anchor_id
        );
        return Ok(config_text.to_string());
    }

    doc["model_provider"] = toml_edit::value(anchor_id);

    if doc.get("model_providers").is_none() {
        let mut parent = toml_edit::Table::new();
        parent.set_implicit(true);
        doc["model_providers"] = toml_edit::Item::Table(parent);
    }
    if let Some(providers) = doc["model_providers"].as_table_mut() {
        if !providers.contains_key(anchor_id) {
            providers.insert(
                anchor_id,
                toml_edit::Item::Table(codex_unified_official_provider_table()),
            );
        }
    }
    Ok(doc.to_string())
}

pub fn inject_codex_unified_session_bucket(config_text: &str) -> Result<String, AppError> {
    inject_codex_unified_session_bucket_with_id(config_text, &configured_codex_history_anchor_id())
}

#[allow(dead_code)]
pub fn strip_codex_unified_session_bucket(config_text: &str) -> Result<String, AppError> {
    if !config_text.contains("model_provider") {
        return Ok(config_text.to_string());
    }
    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    let anchor_id = configured_codex_history_anchor_id();
    if doc.get("model_provider").and_then(|item| item.as_str()) != Some(anchor_id.as_str()) {
        return Ok(config_text.to_string());
    }
    let matches_injected = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|providers| providers.get(anchor_id.as_str()))
        .and_then(|item| item.as_table())
        .is_some_and(table_matches_codex_unified_official_provider);
    if !matches_injected {
        return Ok(config_text.to_string());
    }

    doc.as_table_mut().remove("model_provider");
    let providers_empty = doc["model_providers"]
        .as_table_mut()
        .map(|providers| {
            providers.remove(anchor_id.as_str());
            providers.is_empty()
        })
        .unwrap_or(false);
    if providers_empty {
        doc.as_table_mut().remove("model_providers");
    }
    Ok(doc.to_string())
}

#[allow(dead_code)]
pub fn apply_codex_unified_session_bucket_to_settings(
    category: Option<&str>,
    settings: &mut Value,
) -> Result<(), AppError> {
    if category != Some("official") || !crate::settings::unify_codex_session_history() {
        return Ok(());
    }
    let config_text = settings
        .get("config")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string();
    let injected = inject_codex_unified_session_bucket(&config_text)?;
    if injected != config_text {
        if let Some(obj) = settings.as_object_mut() {
            obj.insert("config".to_string(), Value::String(injected));
        }
    }
    Ok(())
}

#[allow(dead_code)]
pub fn strip_codex_unified_session_bucket_from_settings(
    settings: &mut Value,
) -> Result<(), AppError> {
    let Some(config_text) = settings
        .get("config")
        .and_then(|value| value.as_str())
        .map(str::to_string)
    else {
        return Ok(());
    };
    let stripped = strip_codex_unified_session_bucket(&config_text)?;
    if stripped != config_text {
        if let Some(obj) = settings.as_object_mut() {
            obj.insert("config".to_string(), Value::String(stripped));
        }
    }
    Ok(())
}

fn prepare_codex_provider_live_config_with_env_reader(
    auth: &Value,
    config_text: &str,
    read_env_key: impl Fn(&str) -> Option<String>,
) -> Result<String, AppError> {
    if let Some(env_key) = extract_codex_env_key(config_text) {
        if read_env_key(&env_key)
            .filter(|value| !value.trim().is_empty())
            .is_none()
        {
            return Err(missing_codex_env_key_error(&env_key));
        }
    } else {
        let _ = extract_codex_auth_api_key(auth)
            .or_else(|| extract_codex_experimental_bearer_token(config_text));
    }

    remove_codex_live_only_provider_fields(config_text)
}

#[derive(Clone, Debug)]
struct CodexProviderAnchor {
    id: String,
    name: Option<String>,
}

fn codex_provider_anchor_from_config(config_text: &str) -> Option<CodexProviderAnchor> {
    let doc = config_text.parse::<DocumentMut>().ok()?;
    let provider_id = active_codex_model_provider_id(&doc)?;

    if !is_custom_codex_model_provider_id(&provider_id) {
        return None;
    }
    let provider_table = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|providers| providers.get(provider_id.as_str()))
        .and_then(|item| item.as_table())?;

    Some(CodexProviderAnchor {
        id: provider_id,
        name: provider_table
            .get("name")
            .and_then(|item| item.as_str())
            .map(str::to_string),
    })
}

fn apply_codex_provider_anchor_fields(
    provider_table: &mut toml_edit::Table,
    anchor: &CodexProviderAnchor,
) {
    if let Some(name) = anchor.name.as_deref() {
        provider_table["name"] = toml_edit::value(name);
    }
}

fn codex_model_provider_id_with_table_from_config(
    config_text: &str,
) -> Result<Option<String>, AppError> {
    if config_text.trim().is_empty() {
        return Ok(None);
    }

    let doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    let Some(provider_id) = active_codex_model_provider_id(&doc) else {
        return Ok(None);
    };

    let has_provider_table = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|table| table.get(provider_id.as_str()))
        .is_some();

    Ok(has_provider_table.then_some(provider_id))
}

#[cfg_attr(not(test), allow(dead_code))]
fn normalize_codex_live_config_model_provider_with_anchors<'a>(
    config_text: &str,
    anchor_config_texts: impl IntoIterator<Item = &'a str>,
) -> Result<String, AppError> {
    normalize_codex_live_config_model_provider_with_preferred_anchor(
        config_text,
        anchor_config_texts,
        None,
    )
}

fn normalize_codex_live_config_model_provider_with_preferred_anchor<'a>(
    config_text: &str,
    anchor_config_texts: impl IntoIterator<Item = &'a str>,
    preferred_anchor_id: Option<&str>,
) -> Result<String, AppError> {
    if config_text.trim().is_empty() {
        return Ok(config_text.to_string());
    }

    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    let Some(source_provider_id) = active_codex_model_provider_id(&doc) else {
        let Some(anchor_id) = preferred_anchor_id else {
            return Ok(config_text.to_string());
        };
        if !is_custom_codex_model_provider_id(anchor_id) {
            return Ok(config_text.to_string());
        }

        let mut provider_table = toml_edit::Table::new();
        provider_table["name"] = toml_edit::value(anchor_id);
        for field in [
            "base_url",
            "env_key",
            "wire_api",
            "requires_openai_auth",
            "supports_websockets",
            "experimental_bearer_token",
            "request_max_retries",
            "stream_max_retries",
            "stream_idle_timeout_ms",
            "query_params",
            "http_headers",
            "env_http_headers",
        ] {
            if let Some(value) = doc.as_table_mut().remove(field) {
                provider_table.insert(field, value);
            }
        }
        if !provider_table.contains_key("wire_api") {
            provider_table["wire_api"] = toml_edit::value("responses");
        }
        if !provider_table.contains_key("requires_openai_auth") {
            provider_table["requires_openai_auth"] = toml_edit::value(true);
        }

        if doc.get("model_providers").is_none() {
            let mut providers = toml_edit::Table::new();
            providers.set_implicit(true);
            doc["model_providers"] = toml_edit::Item::Table(providers);
        }
        let providers = doc
            .get_mut("model_providers")
            .and_then(|item| item.as_table_mut())
            .ok_or_else(|| AppError::Config("Codex model_providers 必须是表".to_string()))?;
        if let Some(existing) = providers
            .get_mut(anchor_id)
            .and_then(|item| item.as_table_mut())
        {
            for (field, value) in provider_table.iter() {
                existing.insert(field, value.clone());
            }
        } else {
            providers.insert(anchor_id, toml_edit::Item::Table(provider_table));
        }
        doc["model_provider"] = toml_edit::value(anchor_id);
        return Ok(doc.to_string());
    };

    let has_source_provider_table = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|table| table.get(source_provider_id.as_str()))
        .is_some();
    if !has_source_provider_table {
        return Ok(config_text.to_string());
    }

    let anchor_configs: Vec<&str> = anchor_config_texts.into_iter().collect();
    let preferred_anchor = preferred_anchor_id.map(|preferred_id| {
        anchor_configs
            .iter()
            .find_map(|config| {
                codex_provider_anchor_from_config(config).filter(|anchor| anchor.id == preferred_id)
            })
            .unwrap_or_else(|| CodexProviderAnchor {
                id: preferred_id.to_string(),
                name: Some(preferred_id.to_string()),
            })
    });
    let stable_anchor = preferred_anchor
        .or_else(|| {
            anchor_configs
                .iter()
                .find_map(|config| codex_provider_anchor_from_config(config))
        })
        .or_else(|| {
            is_custom_codex_model_provider_id(&source_provider_id)
                .then(|| codex_provider_anchor_from_config(config_text))
                .flatten()
        })
        .unwrap_or_else(|| CodexProviderAnchor {
            id: DEFAULT_CODEX_MODEL_PROVIDER_ID.to_string(),
            name: Some(DEFAULT_CODEX_MODEL_PROVIDER_ID.to_string()),
        });
    let stable_provider_id = stable_anchor.id.as_str();

    if stable_provider_id == source_provider_id {
        if let Some(provider_table) = doc
            .get_mut("model_providers")
            .and_then(|item| item.as_table_mut())
            .and_then(|providers| providers.get_mut(source_provider_id.as_str()))
            .and_then(|item| item.as_table_mut())
        {
            apply_codex_provider_anchor_fields(provider_table, &stable_anchor);
        }
        return Ok(doc.to_string());
    }

    if let Some(model_providers) = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
    {
        let Some(mut provider_table) = model_providers.remove(source_provider_id.as_str()) else {
            return Ok(config_text.to_string());
        };
        if let Some(table) = provider_table.as_table_mut() {
            apply_codex_provider_anchor_fields(table, &stable_anchor);
        }
        model_providers[stable_provider_id] = provider_table;
    }

    rewrite_codex_profile_model_provider_refs(&mut doc, &source_provider_id, stable_provider_id);
    doc["model_provider"] = toml_edit::value(stable_provider_id);

    Ok(doc.to_string())
}

fn rewrite_codex_profile_model_provider_refs(
    doc: &mut DocumentMut,
    source_provider_id: &str,
    stable_provider_id: &str,
) {
    let Some(profiles) = doc
        .get_mut("profiles")
        .and_then(|item| item.as_table_like_mut())
    else {
        return;
    };

    let profile_keys: Vec<String> = profiles.iter().map(|(key, _)| key.to_string()).collect();
    for profile_key in profile_keys {
        let Some(profile_table) = profiles
            .get_mut(&profile_key)
            .and_then(|item| item.as_table_like_mut())
        else {
            continue;
        };

        let references_source = profile_table
            .get("model_provider")
            .and_then(|item| item.as_str())
            == Some(source_provider_id);
        if references_source {
            profile_table.insert("model_provider", toml_edit::value(stable_provider_id));
        }
    }
}

fn merge_missing_codex_profiles_from_template(
    doc: &mut DocumentMut,
    template_doc: &DocumentMut,
) -> Result<(), AppError> {
    let Some(template_profiles) = template_doc
        .get("profiles")
        .and_then(|item| item.as_table())
    else {
        return Ok(());
    };

    if doc.get("profiles").is_none() {
        doc["profiles"] = toml_edit::table();
    }

    let profiles = doc
        .get_mut("profiles")
        .and_then(|item| item.as_table_mut())
        .ok_or_else(|| AppError::Message("Invalid Codex profiles table".to_string()))?;

    for (profile_name, profile_item) in template_profiles.iter() {
        if !profiles.contains_key(profile_name) {
            profiles[profile_name] = profile_item.clone();
        }
    }

    Ok(())
}

/// Keep Codex's active `model_provider` stable across tuzi switch provider changes.
///
/// Codex stores and filters resume history by `model_provider`, so switching between
/// provider-specific ids like `rightcode` and `aihubmix` makes history appear to move.
/// We preserve an existing custom provider id when possible and only rewrite the
/// live config text that Codex sees at provider-driven write boundaries.
pub fn normalize_codex_settings_config_model_provider(
    settings: &mut Value,
    anchor_config_text: Option<&str>,
) -> Result<(), AppError> {
    let Some(config_text) = settings
        .get("config")
        .and_then(|value| value.as_str())
        .map(str::to_string)
    else {
        return Ok(());
    };

    let current_config_text = read_codex_config_text().ok();
    let anchors = anchor_config_text
        .into_iter()
        .chain(current_config_text.as_deref());
    let preferred_anchor_id = crate::settings::get_codex_history_anchor_id_for_path(
        &get_codex_config_dir(),
    )
    .or_else(|| {
        crate::settings::unify_codex_session_history()
            .then(|| DEFAULT_CODEX_MODEL_PROVIDER_ID.to_string())
    });
    let normalized = normalize_codex_live_config_model_provider_with_preferred_anchor(
        &config_text,
        anchors,
        preferred_anchor_id.as_deref(),
    )?;

    if let Some(obj) = settings.as_object_mut() {
        obj.insert("config".to_string(), Value::String(normalized));
    }

    Ok(())
}

fn restore_codex_backfill_model_provider_id(
    config_text: &str,
    template_config_text: &str,
) -> Result<String, AppError> {
    let Some(template_provider_id) =
        codex_model_provider_id_with_table_from_config(template_config_text)?
    else {
        return Ok(config_text.to_string());
    };

    if config_text.trim().is_empty() {
        return Ok(config_text.to_string());
    }

    let template_doc = template_config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    let Some(live_provider_id) = active_codex_model_provider_id(&doc) else {
        return Ok(config_text.to_string());
    };

    if live_provider_id == template_provider_id {
        merge_missing_codex_profiles_from_template(&mut doc, &template_doc)?;
        return Ok(doc.to_string());
    }

    if let Some(model_providers) = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
    {
        let Some(provider_table) = model_providers.remove(live_provider_id.as_str()) else {
            merge_missing_codex_profiles_from_template(&mut doc, &template_doc)?;
            return Ok(doc.to_string());
        };
        model_providers[template_provider_id.as_str()] = provider_table;
    } else {
        merge_missing_codex_profiles_from_template(&mut doc, &template_doc)?;
        return Ok(doc.to_string());
    }

    rewrite_codex_profile_model_provider_refs(&mut doc, &live_provider_id, &template_provider_id);
    merge_missing_codex_profiles_from_template(&mut doc, &template_doc)?;
    doc["model_provider"] = toml_edit::value(template_provider_id.as_str());

    Ok(doc.to_string())
}

fn codex_active_provider_env_key_state(
    config_text: &str,
) -> Result<Option<Option<String>>, AppError> {
    if config_text.trim().is_empty() {
        return Ok(None);
    }
    let doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    let Some(provider_id) = active_codex_model_provider_id(&doc) else {
        return Ok(None);
    };
    let Some(provider_table) = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|providers| providers.get(provider_id.as_str()))
        .and_then(|item| item.as_table())
    else {
        return Ok(None);
    };

    Ok(Some(
        provider_table
            .get("env_key")
            .and_then(|item| item.as_str())
            .map(str::to_string),
    ))
}

fn set_codex_active_provider_env_key(
    config_text: &str,
    env_key: Option<&str>,
) -> Result<String, AppError> {
    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    let Some(provider_id) = active_codex_model_provider_id(&doc) else {
        return Ok(config_text.to_string());
    };
    let Some(provider_table) = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
        .and_then(|providers| providers.get_mut(provider_id.as_str()))
        .and_then(|item| item.as_table_mut())
    else {
        return Ok(config_text.to_string());
    };

    match env_key.map(str::trim).filter(|value| !value.is_empty()) {
        Some(env_key) => {
            validate_env_key_name(env_key)?;
            provider_table["env_key"] = toml_edit::value(env_key);
        }
        None => {
            provider_table.remove("env_key");
        }
    }

    Ok(doc.to_string())
}

fn restore_codex_active_provider_route_fields(
    config_text: &str,
    template_config_text: &str,
) -> Result<String, AppError> {
    let template_doc = template_config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    let Some(template_provider_id) = active_codex_model_provider_id(&template_doc) else {
        return Ok(config_text.to_string());
    };
    let Some(template_provider_table) = template_doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|providers| providers.get(template_provider_id.as_str()))
        .and_then(|item| item.as_table())
    else {
        return Ok(config_text.to_string());
    };

    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    let Some(provider_id) = active_codex_model_provider_id(&doc) else {
        return Ok(config_text.to_string());
    };
    let Some(provider_table) = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
        .and_then(|providers| providers.get_mut(provider_id.as_str()))
        .and_then(|item| item.as_table_mut())
    else {
        return Ok(config_text.to_string());
    };

    for field in [
        "name",
        "base_url",
        "wire_api",
        "requires_openai_auth",
        "supports_websockets",
    ] {
        match template_provider_table.get(field) {
            Some(value) => {
                provider_table[field] = value.clone();
            }
            None => {
                provider_table.remove(field);
            }
        }
    }

    Ok(doc.to_string())
}

/// Convert a Codex live config that was normalized for history stability back
/// to the provider-specific id used by the stored provider template.
pub fn restore_codex_settings_config_model_provider_for_backfill(
    settings: &mut Value,
    template_settings: &Value,
) -> Result<(), AppError> {
    let Some(config_text) = settings
        .get("config")
        .and_then(|value| value.as_str())
        .map(str::to_string)
    else {
        return Ok(());
    };
    let Some(template_config_text) = template_settings
        .get("config")
        .and_then(|value| value.as_str())
    else {
        return Ok(());
    };

    let live_env_key = extract_codex_env_key(&config_text);
    let template_env_key_state = codex_active_provider_env_key_state(template_config_text)?;
    let mut restored =
        restore_codex_backfill_model_provider_id(&config_text, template_config_text)?;

    if let Some(template_env_key) = template_env_key_state {
        if live_env_key != template_env_key {
            restored = restore_codex_active_provider_route_fields(&restored, template_config_text)?;
        }
        restored = set_codex_active_provider_env_key(&restored, template_env_key.as_deref())?;
        if live_env_key != template_env_key {
            restored = remove_codex_live_only_provider_fields(&restored)?;
        }
    }
    if let Some(obj) = settings.as_object_mut() {
        obj.insert("config".to_string(), Value::String(restored));
    }

    Ok(())
}

pub fn restore_codex_provider_token_for_backfill(
    settings: &mut Value,
    template_settings: &Value,
) -> Result<(), AppError> {
    restore_codex_provider_token_for_backfill_with_env_writer(
        settings,
        template_settings,
        write_managed_env_key,
    )
}

fn restore_codex_stored_credentials_for_backfill(settings: &mut Value, template_settings: &Value) {
    let Some(obj) = settings.as_object_mut() else {
        return;
    };

    match template_settings
        .get("env")
        .filter(|value| value.is_object())
    {
        Some(env) => {
            obj.insert("env".to_string(), env.clone());
        }
        None => {
            obj.remove("env");
        }
    }

    match template_settings
        .get("auth")
        .filter(|value| value.is_object())
    {
        Some(auth) => {
            obj.insert("auth".to_string(), auth.clone());
        }
        None => {
            obj.remove("auth");
        }
    }
}

fn restore_codex_provider_token_for_backfill_with_env_writer(
    settings: &mut Value,
    template_settings: &Value,
    mut write_env_key: impl FnMut(&str, &str) -> Result<(), AppError>,
) -> Result<(), AppError> {
    let Some(config_text) = settings
        .get("config")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        return Ok(());
    };

    let Some(token) = extract_codex_experimental_bearer_token(&config_text) else {
        return Ok(());
    };

    if let Some(obj) = settings.as_object_mut() {
        let env_key = template_settings
            .get("config")
            .and_then(Value::as_str)
            .and_then(extract_codex_env_key)
            .or_else(|| {
                template_settings
                    .get("env")
                    .and_then(|env| env.get("envKey"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            });
        if let Some(env_key) = env_key.as_deref() {
            validate_env_key_name(env_key)?;
            write_env_key(env_key, &token)?;
            let cleaned_config = remove_codex_live_only_provider_fields(&config_text)?;
            obj.insert("config".to_string(), Value::String(cleaned_config));
            obj.insert("env".to_string(), json!({ "envKey": env_key }));
            obj.insert("auth".to_string(), json!({}));
            return Ok(());
        }

        let cleaned_config = remove_codex_live_only_provider_fields(&config_text)?;
        obj.insert("config".to_string(), Value::String(cleaned_config));
        let mut auth = template_settings
            .get("auth")
            .filter(|value| value.is_object())
            .cloned()
            .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
        if let Some(auth_obj) = auth.as_object_mut() {
            auth_obj.insert("OPENAI_API_KEY".to_string(), Value::String(token));
        }
        obj.insert("auth".to_string(), auth);
    }

    Ok(())
}

pub fn restore_codex_settings_for_backfill(
    settings: &mut Value,
    template_settings: &Value,
    restore_provider_token: bool,
) -> Result<(), AppError> {
    restore_codex_settings_config_model_provider_for_backfill(settings, template_settings)?;
    restore_codex_stored_credentials_for_backfill(settings, template_settings);
    if restore_provider_token {
        restore_codex_provider_token_for_backfill(settings, template_settings)?;
    }
    Ok(())
}

/// Atomically write Codex live config after normalizing provider-specific ids.
///
/// Use this for provider-driven live writes. Keep `write_codex_live_atomic` available
/// for exact restore/backup paths that must preserve the config text byte-for-byte.
pub fn write_codex_live_atomic_with_stable_provider(
    auth: &Value,
    config_text_opt: Option<&str>,
) -> Result<(), AppError> {
    if config_text_opt.is_some() && crate::settings::unify_codex_session_history() {
        crate::codex_history_migration::ensure_codex_history_anchor()?;
    }
    match config_text_opt {
        Some(config_text) => {
            let mut settings = serde_json::Map::new();
            settings.insert("config".to_string(), Value::String(config_text.to_string()));
            let mut settings = Value::Object(settings);
            normalize_codex_settings_config_model_provider(&mut settings, None)?;
            let config_text = settings
                .get("config")
                .and_then(|value| value.as_str())
                .unwrap_or(config_text);
            let config_text = preserve_codex_global_tables_from_live(config_text)?;
            validate_codex_config_routes_history_anchor(&config_text)?;
            write_codex_live_atomic(auth, Some(&config_text))
        }
        None => write_codex_live_atomic(auth, None),
    }
}

fn write_codex_live_for_provider_inner(
    category: Option<&str>,
    auth: &Value,
    config_text_opt: Option<&str>,
) -> Result<(), AppError> {
    let unify_official_history =
        category == Some("official") && crate::settings::unify_codex_session_history();
    let unified_official_config = if unify_official_history {
        Some(inject_codex_unified_session_bucket(
            config_text_opt.unwrap_or(""),
        )?)
    } else {
        None
    };
    let config_text_opt = unified_official_config.as_deref().or(config_text_opt);

    let should_write_auth = (category == Some("official") && codex_auth_has_login_material(auth))
        || (category != Some("official")
            && !crate::settings::preserve_codex_official_auth_on_switch());

    if should_write_auth {
        if category == Some("official") {
            if let Some(config_text) = config_text_opt {
                validate_codex_config_routes_history_anchor(config_text)?;
            }
            return write_codex_live_atomic(auth, config_text_opt);
        }
        return write_codex_live_atomic_with_stable_provider(auth, config_text_opt);
    }

    let Some(config_text) = config_text_opt else {
        return write_codex_live_config_atomic(None);
    };
    let provider_env_key = extract_codex_env_key(config_text);
    let provider_env_token = provider_env_key.as_deref().and_then(read_managed_env_key);

    let mut settings = serde_json::Map::new();
    settings.insert("config".to_string(), Value::String(config_text.to_string()));
    let mut settings = Value::Object(settings);
    if category != Some("official") {
        normalize_codex_settings_config_model_provider(&mut settings, None)?;
    }
    let normalized_config = settings
        .get("config")
        .and_then(Value::as_str)
        .unwrap_or(config_text);
    if let Some(token) = provider_env_token {
        if let Some(active_env_key) = extract_codex_env_key(normalized_config) {
            if provider_env_key.as_deref() == Some(active_env_key.as_str()) {
                write_managed_env_key(&active_env_key, &token)?;
            } else {
                log::warn!(
                    "Skipped Codex API key copy from {:?} to '{}' while normalizing model_provider",
                    provider_env_key,
                    active_env_key
                );
            }
        }
    }
    let live_config = prepare_codex_provider_live_config(auth, normalized_config)?;
    let live_config = preserve_codex_global_tables_from_live(&live_config)?;
    validate_codex_config_routes_history_anchor(&live_config)?;
    write_codex_live_config_atomic(Some(&live_config))
}

fn parse_codex_positive_u64(value: Option<&Value>) -> Option<u64> {
    match value {
        Some(Value::Number(n)) => n.as_u64().filter(|v| *v > 0),
        Some(Value::String(s)) => s.trim().parse::<u64>().ok().filter(|v| *v > 0),
        _ => None,
    }
}

fn extract_codex_top_level_u64(config_text: &str, field: &str) -> Option<u64> {
    let doc = config_text.parse::<toml::Value>().ok()?;
    doc.get(field)
        .and_then(|value| value.as_integer())
        .and_then(|value| u64::try_from(value).ok())
        .filter(|value| *value > 0)
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CodexCatalogModelSpec {
    model: String,
    display_name: String,
    context_window: u64,
}

fn codex_catalog_model_specs(settings: &Value, config_text: &str) -> Vec<CodexCatalogModelSpec> {
    let Some(models) = settings
        .get("modelCatalog")
        .and_then(|catalog| catalog.get("models"))
        .and_then(|models| models.as_array())
    else {
        return Vec::new();
    };

    let default_context_window =
        extract_codex_top_level_u64(config_text, "model_context_window").unwrap_or(128_000);
    let mut seen = HashSet::new();
    let mut specs = Vec::new();

    for model_config in models {
        let Some(model) = model_config
            .get("model")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|model| !model.is_empty())
        else {
            continue;
        };

        if !seen.insert(model.to_string()) {
            continue;
        }

        let display_name = model_config
            .get("displayName")
            .or_else(|| model_config.get("display_name"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or(model);
        let context_window = parse_codex_positive_u64(
            model_config
                .get("contextWindow")
                .or_else(|| model_config.get("context_window")),
        )
        .unwrap_or(default_context_window);

        specs.push(CodexCatalogModelSpec {
            model: model.to_string(),
            display_name: display_name.to_string(),
            context_window,
        });
    }

    specs
}

fn codex_catalog_model_entry(
    template: &Value,
    model: &str,
    display_name: &str,
    context_window: u64,
    priority: usize,
) -> Value {
    let mut entry = template.clone();
    let Some(entry_obj) = entry.as_object_mut() else {
        return json!({});
    };

    entry_obj.insert("slug".to_string(), json!(model));
    entry_obj.insert("display_name".to_string(), json!(display_name));
    entry_obj.insert("description".to_string(), json!(display_name));
    entry_obj.insert("context_window".to_string(), json!(context_window));
    entry_obj.insert("max_context_window".to_string(), json!(context_window));
    entry_obj.insert("priority".to_string(), json!(1000 + priority));
    entry_obj.insert("additional_speed_tiers".to_string(), json!([]));
    entry_obj.insert("service_tiers".to_string(), json!([]));
    entry_obj.insert("availability_nux".to_string(), Value::Null);
    entry_obj.insert("upgrade".to_string(), Value::Null);

    entry
}

fn find_codex_model_template(catalog: &Value) -> Option<Value> {
    catalog
        .get("models")
        .and_then(Value::as_array)
        .and_then(|models| {
            models.iter().find(|model| {
                model.get("slug").and_then(Value::as_str) == Some(CODEX_MODEL_CATALOG_TEMPLATE_SLUG)
            })
        })
        .cloned()
}

fn load_codex_model_template_from_cache() -> Result<Option<Value>, AppError> {
    let path = get_codex_config_dir().join("models_cache.json");
    if !path.exists() {
        return Ok(None);
    }

    let text = fs::read_to_string(&path).map_err(|e| AppError::io(&path, e))?;
    let catalog: Value = serde_json::from_str(&text).map_err(|e| AppError::json(&path, e))?;
    Ok(find_codex_model_template(&catalog))
}

fn load_codex_model_template_from_bundled() -> Result<Option<Value>, AppError> {
    let output = match Command::new("codex")
        .args(["debug", "models", "--bundled"])
        .output()
    {
        Ok(output) => output,
        Err(err) => {
            log::debug!("failed to run `codex debug models --bundled`: {err}");
            return Ok(None);
        }
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        log::debug!("`codex debug models --bundled` failed: {stderr}");
        return Ok(None);
    }

    let catalog: Value = serde_json::from_slice(&output.stdout).map_err(|e| {
        AppError::Message(format!(
            "Failed to parse `codex debug models --bundled` output: {e}"
        ))
    })?;
    Ok(find_codex_model_template(&catalog))
}

fn load_codex_model_catalog_template() -> Result<Value, AppError> {
    if let Some(template) = load_codex_model_template_from_cache()? {
        return Ok(template);
    }
    if let Some(template) = load_codex_model_template_from_bundled()? {
        return Ok(template);
    }

    Err(AppError::Message(format!(
        "Codex model catalog template `{CODEX_MODEL_CATALOG_TEMPLATE_SLUG}` not found. Please start Codex once so models_cache.json is available, or ensure the `codex` CLI is on PATH."
    )))
}

fn codex_model_catalog_from_specs(specs: &[CodexCatalogModelSpec], template: &Value) -> Value {
    let entries: Vec<Value> = specs
        .iter()
        .enumerate()
        .map(|(index, spec)| {
            codex_catalog_model_entry(
                template,
                &spec.model,
                &spec.display_name,
                spec.context_window,
                index,
            )
        })
        .collect();

    json!({ "models": entries })
}

fn codex_model_catalog_from_settings(
    settings: &Value,
    config_text: &str,
) -> Result<Option<Value>, AppError> {
    let specs = codex_catalog_model_specs(settings, config_text);
    if specs.is_empty() {
        return Ok(None);
    }

    let template = load_codex_model_catalog_template()?;
    Ok(Some(codex_model_catalog_from_specs(&specs, &template)))
}

fn set_codex_model_catalog_json_field(
    config_text: &str,
    catalog_path: Option<&Path>,
) -> Result<String, AppError> {
    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    let generated_path = get_codex_model_catalog_path();

    match catalog_path {
        Some(path) => {
            let is_tuzi_switch_owned = doc
                .get("model_catalog_json")
                .and_then(|item| item.as_str())
                .map(|configured_path| {
                    configured_path == generated_path.to_string_lossy().as_ref()
                        || Path::new(configured_path)
                            .file_name()
                            .and_then(|name| name.to_str())
                            == Some(TUZI_SWITCH_CODEX_MODEL_CATALOG_FILENAME)
                })
                .unwrap_or(true);
            if is_tuzi_switch_owned {
                doc["model_catalog_json"] = toml_edit::value(path.to_string_lossy().as_ref());
            }
        }
        None => {
            let should_remove = doc
                .get("model_catalog_json")
                .and_then(|item| item.as_str())
                .map(|path| {
                    path == generated_path.to_string_lossy().as_ref()
                        || Path::new(path).file_name().and_then(|name| name.to_str())
                            == Some(TUZI_SWITCH_CODEX_MODEL_CATALOG_FILENAME)
                })
                .unwrap_or(false);
            if should_remove {
                doc.as_table_mut().remove("model_catalog_json");
            }
        }
    }

    Ok(doc.to_string())
}

pub fn prepare_codex_config_text_with_model_catalog(
    settings: &Value,
    config_text: &str,
) -> Result<String, AppError> {
    let catalog_path = get_codex_model_catalog_path();

    if let Some(catalog) = codex_model_catalog_from_settings(settings, config_text)? {
        let config_text = set_codex_model_catalog_json_field(config_text, Some(&catalog_path))?;
        write_json_file(&catalog_path, &catalog)?;
        Ok(config_text)
    } else {
        set_codex_model_catalog_json_field(config_text, None)
    }
}

fn resolve_tuzi_switch_catalog_path(config_text: &str, generated_path: &Path) -> Option<PathBuf> {
    if config_text.trim().is_empty() {
        return None;
    }
    let doc = config_text.parse::<DocumentMut>().ok()?;
    let catalog_path_str = doc
        .get("model_catalog_json")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?;

    let referenced_path = Path::new(catalog_path_str);
    let is_tuzi_switch_owned = catalog_path_str == generated_path.to_string_lossy().as_ref()
        || referenced_path.file_name().and_then(|name| name.to_str())
            == Some(TUZI_SWITCH_CODEX_MODEL_CATALOG_FILENAME);
    if !is_tuzi_switch_owned {
        return None;
    }

    if referenced_path.is_absolute() {
        Some(referenced_path.to_path_buf())
    } else {
        Some(generated_path.to_path_buf())
    }
}

fn build_simplified_catalog_from_texts(config_text: &str, catalog_text: &str) -> Option<Value> {
    let catalog: Value = serde_json::from_str(catalog_text).ok()?;
    let models = catalog.get("models").and_then(Value::as_array)?;

    let default_context_window =
        extract_codex_top_level_u64(config_text, "model_context_window").unwrap_or(128_000);

    let mut entries = Vec::with_capacity(models.len());
    for entry in models {
        let Some(model) = entry
            .get("slug")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };

        let mut obj = serde_json::Map::new();
        obj.insert("model".to_string(), json!(model));

        if let Some(display_name) = entry
            .get("display_name")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty() && *s != model)
        {
            obj.insert("displayName".to_string(), json!(display_name));
        }

        if let Some(context_window) = entry
            .get("context_window")
            .and_then(Value::as_u64)
            .filter(|v| *v > 0 && *v != default_context_window)
        {
            obj.insert("contextWindow".to_string(), json!(context_window));
        }

        entries.push(Value::Object(obj));
    }

    if entries.is_empty() {
        return None;
    }

    Some(json!({ "models": entries }))
}

pub fn read_codex_model_catalog_simplified_from_live() -> Result<Option<Value>, AppError> {
    let config_text = read_codex_config_text()?;
    let generated_path = get_codex_model_catalog_path();
    let Some(catalog_path) = resolve_tuzi_switch_catalog_path(&config_text, &generated_path) else {
        return Ok(None);
    };
    if !catalog_path.exists() {
        return Ok(None);
    }
    let Ok(catalog_text) = fs::read_to_string(&catalog_path) else {
        return Ok(None);
    };
    Ok(build_simplified_catalog_from_texts(
        &config_text,
        &catalog_text,
    ))
}

pub fn write_codex_provider_live_with_catalog_for_provider(
    settings: &Value,
    category: Option<&str>,
    auth: &Value,
    config_text: Option<&str>,
    subagent_threads: Option<u64>,
) -> Result<(), AppError> {
    let prepared_config = config_text
        .map(|text| prepare_codex_config_text_with_model_catalog(settings, text))
        .transpose()?;
    write_codex_live_for_provider_inner(category, auth, prepared_config.as_deref())?;
    set_codex_subagent_max_concurrent_threads(subagent_threads)?;
    Ok(())
}

/// Write Codex live config from the provider template while applying its
/// resolved subagent concurrency policy.
pub fn write_codex_provider_live_exact_with_catalog_for_provider(
    settings: &Value,
    auth: &Value,
    config_text: Option<&str>,
    subagent_threads: Option<u64>,
) -> Result<(), AppError> {
    let prepared_config = config_text
        .map(|text| prepare_codex_config_text_with_model_catalog(settings, text))
        .transpose()?;
    match prepared_config.as_deref() {
        Some(config_text) => {
            let live_config = prepare_codex_provider_live_config(auth, config_text)?;
            let live_config = preserve_codex_global_tables_from_live(&live_config)?;
            write_codex_live_atomic(auth, Some(&live_config))?;
        }
        None => write_codex_live_atomic(auth, None)?,
    }
    set_codex_subagent_max_concurrent_threads(subagent_threads)?;
    Ok(())
}

/// Update a field in Codex config.toml using toml_edit (syntax-preserving).
///
/// Supported fields:
/// - `"base_url"`: writes to `[model_providers.<current>].base_url` if `model_provider` exists,
///   otherwise falls back to top-level `base_url`.
/// - `"wire_api"`: writes to `[model_providers.<current>].wire_api` if `model_provider` exists,
///   otherwise falls back to top-level `wire_api`.
/// - `"model"` / `"model_catalog_json"`: writes to top-level field.
///
/// Empty value removes the field.
pub fn update_codex_toml_field(toml_str: &str, field: &str, value: &str) -> Result<String, String> {
    let mut doc = toml_str
        .parse::<DocumentMut>()
        .map_err(|e| format!("TOML parse error: {e}"))?;

    let trimmed = value.trim();

    match field {
        "base_url" | "wire_api" => {
            let model_provider = doc
                .get("model_provider")
                .and_then(|item| item.as_str())
                .map(str::to_string);

            if let Some(provider_key) = model_provider {
                // Ensure [model_providers] table exists
                if doc.get("model_providers").is_none() {
                    doc["model_providers"] = toml_edit::table();
                }

                if let Some(model_providers) = doc["model_providers"].as_table_mut() {
                    // Ensure [model_providers.<provider_key>] table exists
                    if !model_providers.contains_key(&provider_key) {
                        model_providers[&provider_key] = toml_edit::table();
                    }

                    if let Some(provider_table) = model_providers[&provider_key].as_table_mut() {
                        if trimmed.is_empty() {
                            provider_table.remove(field);
                        } else {
                            provider_table[field] = toml_edit::value(trimmed);
                        }
                        return Ok(doc.to_string());
                    }
                }
            }

            // Fallback: no model_provider or structure mismatch → top-level field
            if trimmed.is_empty() {
                doc.as_table_mut().remove(field);
            } else {
                doc[field] = toml_edit::value(trimmed);
            }
        }
        "model" | "model_catalog_json" => {
            if trimmed.is_empty() {
                doc.as_table_mut().remove(field);
            } else {
                doc[field] = toml_edit::value(trimmed);
            }
        }
        _ => return Err(format!("unsupported field: {field}")),
    }

    Ok(doc.to_string())
}

pub(crate) fn set_active_codex_http_header(
    config_text: &str,
    header_name: &str,
    header_value: &str,
) -> Result<String, AppError> {
    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    let provider_id = active_codex_model_provider_id(&doc).ok_or_else(|| {
        AppError::Message("Codex config.toml has no active model_provider".into())
    })?;
    let provider_table = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
        .and_then(|table| table.get_mut(provider_id.as_str()))
        .and_then(|item| item.as_table_mut())
        .ok_or_else(|| AppError::Message("Codex active model provider table is missing".into()))?;

    let headers = provider_table.entry("http_headers").or_insert_with(|| {
        toml_edit::Item::Value(toml_edit::Value::InlineTable(Default::default()))
    });
    match headers {
        toml_edit::Item::Value(toml_edit::Value::InlineTable(table)) => {
            let stale_names: Vec<String> = table
                .iter()
                .map(|(name, _)| name.to_string())
                .filter(|name| {
                    name.eq_ignore_ascii_case(header_name) && name.as_str() != header_name
                })
                .collect();
            for name in stale_names {
                table.remove(&name);
            }
            table.insert(header_name, toml_edit::Value::from(header_value));
        }
        toml_edit::Item::Table(table) => {
            let stale_names: Vec<String> = table
                .iter()
                .map(|(name, _)| name.to_string())
                .filter(|name| {
                    name.eq_ignore_ascii_case(header_name) && name.as_str() != header_name
                })
                .collect();
            for name in stale_names {
                table.remove(&name);
            }
            table[header_name] = toml_edit::value(header_value);
        }
        _ => {
            let mut table = toml_edit::InlineTable::new();
            table.insert(header_name, toml_edit::Value::from(header_value));
            *headers = toml_edit::Item::Value(toml_edit::Value::InlineTable(table));
        }
    }
    Ok(doc.to_string())
}

pub(crate) fn remove_active_codex_http_header(
    config_text: &str,
    header_name: &str,
) -> Result<String, AppError> {
    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;
    let Some(provider_id) = active_codex_model_provider_id(&doc) else {
        return Ok(doc.to_string());
    };
    let Some(provider_table) = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
        .and_then(|table| table.get_mut(provider_id.as_str()))
        .and_then(|item| item.as_table_mut())
    else {
        return Ok(doc.to_string());
    };

    let remove_empty_headers = match provider_table.get_mut("http_headers") {
        Some(toml_edit::Item::Value(toml_edit::Value::InlineTable(table))) => {
            let names: Vec<String> = table
                .iter()
                .map(|(name, _)| name.to_string())
                .filter(|name| name.eq_ignore_ascii_case(header_name))
                .collect();
            for name in names {
                table.remove(&name);
            }
            table.is_empty()
        }
        Some(toml_edit::Item::Table(table)) => {
            let names: Vec<String> = table
                .iter()
                .map(|(name, _)| name.to_string())
                .filter(|name| name.eq_ignore_ascii_case(header_name))
                .collect();
            for name in names {
                table.remove(&name);
            }
            table.is_empty()
        }
        _ => false,
    };
    if remove_empty_headers {
        provider_table.remove("http_headers");
    }
    Ok(doc.to_string())
}

/// Remove `base_url` from the active model_provider section only if it matches `predicate`.
/// Also removes top-level `base_url` if it matches.
/// Used by proxy cleanup to strip local proxy URLs without touching user-configured URLs.
pub fn remove_codex_toml_base_url_if(toml_str: &str, predicate: impl Fn(&str) -> bool) -> String {
    let mut doc = match toml_str.parse::<DocumentMut>() {
        Ok(doc) => doc,
        Err(_) => return toml_str.to_string(),
    };

    let model_provider = doc
        .get("model_provider")
        .and_then(|item| item.as_str())
        .map(str::to_string);

    if let Some(provider_key) = model_provider {
        if let Some(model_providers) = doc
            .get_mut("model_providers")
            .and_then(|v| v.as_table_mut())
        {
            if let Some(provider_table) = model_providers
                .get_mut(provider_key.as_str())
                .and_then(|v| v.as_table_mut())
            {
                let should_remove = provider_table
                    .get("base_url")
                    .and_then(|item| item.as_str())
                    .map(&predicate)
                    .unwrap_or(false);
                if should_remove {
                    provider_table.remove("base_url");
                }
            }
        }
    }

    // Fallback: also clean up top-level base_url if it matches
    let should_remove_root = doc
        .get("base_url")
        .and_then(|item| item.as_str())
        .map(&predicate)
        .unwrap_or(false);
    if should_remove_root {
        doc.as_table_mut().remove("base_url");
    }

    doc.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::sync::Mutex;

    static TEST_ENV_LOCK: Mutex<()> = Mutex::new(());

    #[test]
    fn subagent_settings_prefer_canonical_key_and_preserve_path() {
        let path = Path::new("/tmp/test-codex/config.toml");
        let config = r#"model = "gpt-5.5"

[agents]
max_threads = 2
max_concurrent_threads_per_session = 6
"#;

        let result = codex_subagent_settings_from_text(path, config).unwrap();
        assert_eq!(result.max_concurrent_threads_per_session, Some(6));
        assert!(!result.used_legacy_alias);
        assert_eq!(result.config_path, "/tmp/test-codex/config.toml");
    }

    #[test]
    fn subagent_settings_accept_legacy_alias() {
        let result = codex_subagent_settings_from_text(
            Path::new("/tmp/test-codex/config.toml"),
            "[agents]\nmax_threads = 3\n",
        )
        .unwrap();
        assert_eq!(result.max_concurrent_threads_per_session, Some(3));
        assert!(result.used_legacy_alias);
    }

    #[test]
    fn subagent_settings_reject_invalid_values() {
        let result = codex_subagent_settings_from_text(
            Path::new("/tmp/test-codex/config.toml"),
            "[agents]\nmax_concurrent_threads_per_session = 0\n",
        );
        assert!(result.is_err());
    }

    #[test]
    fn preserve_global_agents_table_from_live_config() {
        let original = r#"model = "gpt-5.5"

[agents]
max_concurrent_threads_per_session = 8
interrupt_message = true
        "#;
        let candidate = "model = \"gpt-5.5\"\n";
        let merged = preserve_codex_global_tables_from_text(candidate, original).unwrap();
        assert!(merged.contains("max_concurrent_threads_per_session = 8"));
        assert!(merged.contains("interrupt_message = true"));
    }

    #[test]
    fn preserve_global_agents_values_overrides_provider_snapshot() {
        let live = "[agents]\nmax_concurrent_threads_per_session = 8\n";
        let candidate = "[agents]\nmax_concurrent_threads_per_session = 2\n";
        let merged = preserve_codex_global_tables_from_text(candidate, live).unwrap();
        assert!(merged.contains("max_concurrent_threads_per_session = 8"));
        assert!(!merged.contains("max_concurrent_threads_per_session = 2"));
    }

    #[test]
    #[serial]
    fn set_subagent_threads_persists_and_reset_removes_only_managed_table() {
        let _guard = TEST_ENV_LOCK.lock().expect("lock test env");
        let temp = tempfile::tempdir().expect("temp home");
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        let config_dir = temp.path().join(".codex");
        fs::create_dir_all(&config_dir).expect("create codex dir");
        fs::write(
            config_dir.join("config.toml"),
            "model = \"gpt-5.5\"\n[agents]\nmax_threads = 2\n",
        )
        .expect("seed config");

        let updated = set_codex_subagent_max_concurrent_threads(Some(12)).unwrap();
        assert_eq!(updated.max_concurrent_threads_per_session, Some(12));
        let written = fs::read_to_string(config_dir.join("config.toml")).unwrap();
        assert!(written.contains("max_concurrent_threads_per_session = 12"));
        assert!(!written.contains("max_threads = 2"));

        let reset = set_codex_subagent_max_concurrent_threads(None).unwrap();
        assert_eq!(reset.max_concurrent_threads_per_session, None);
        let written = fs::read_to_string(config_dir.join("config.toml")).unwrap();
        assert!(written.contains("model = \"gpt-5.5\""));
        assert!(!written.contains("[agents]"));

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }

    #[test]
    fn provider_subagent_override_is_applied_without_touching_other_agents_values() {
        let input = r#"model = "gpt-5.5"

[agents]
interrupt_message = true
max_threads = 2
"#;
        let updated = apply_codex_subagent_threads_to_config_text(input, Some(12)).unwrap();
        let doc = updated.parse::<toml::Table>().unwrap();
        let agents = doc.get("agents").and_then(toml::Value::as_table).unwrap();
        assert_eq!(
            agents
                .get("max_concurrent_threads_per_session")
                .and_then(|value| value.as_integer()),
            Some(12)
        );
        assert_eq!(
            agents
                .get("interrupt_message")
                .and_then(|value| value.as_bool()),
            Some(true)
        );
        assert!(agents.get("max_threads").is_none());

        let reset = apply_codex_subagent_threads_to_config_text(&updated, None).unwrap();
        let reset_doc = reset.parse::<toml::Table>().unwrap();
        let reset_agents = reset_doc
            .get("agents")
            .and_then(toml::Value::as_table)
            .unwrap();
        assert_eq!(
            reset_agents
                .get("interrupt_message")
                .and_then(|value| value.as_bool()),
            Some(true)
        );
        assert!(reset_agents
            .get("max_concurrent_threads_per_session")
            .is_none());
    }

    #[test]
    fn effective_provider_parser_uses_codex_resolved_top_level_value() {
        let response = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "result": {
                "config": {
                    "model_provider": "custom",
                    "model_providers": {
                        "tuziswitch": { "base_url": "https://old.example/v1" },
                        "custom": { "base_url": "https://active.example/v1" }
                    }
                },
                "origins": {
                    "model_provider": {
                        "name": {
                            "type": "user",
                            "file": "/Users/test/.codex/config.toml"
                        }
                    }
                }
            }
        });
        let cwd = Path::new("/Users/test/project");

        let parsed = parse_codex_effective_model_provider_response(&response, Some(cwd))
            .expect("effective custom provider");

        assert_eq!(parsed.provider_id, "custom");
        assert_eq!(
            parsed.source,
            "config/read:user:/Users/test/.codex/config.toml"
        );
        assert_eq!(parsed.cwd.as_deref(), Some("/Users/test/project"));
    }

    #[test]
    fn effective_provider_parser_rejects_reserved_or_incomplete_routes() {
        let reserved = json!({
            "result": {
                "config": {
                    "model_provider": "openai",
                    "model_providers": { "openai": {} }
                }
            }
        });
        let missing_table = json!({
            "result": {
                "config": {
                    "model_provider": "custom",
                    "model_providers": { "other": {} }
                }
            }
        });

        assert!(parse_codex_effective_model_provider_response(&reserved, None).is_none());
        assert!(parse_codex_effective_model_provider_response(&missing_table, None).is_none());
    }

    #[test]
    fn persisted_history_anchor_overrides_other_available_provider_tables() {
        let target = r#"model_provider = "vendor_beta"

[model_providers.vendor_beta]
name = "Vendor Beta"
base_url = "https://beta.example/v1"
env_key = "BETA_API_KEY"

[model_providers.custom]
name = "Stale Custom"
base_url = "https://stale.example/v1"
"#;

        let normalized = normalize_codex_live_config_model_provider_with_preferred_anchor(
            target,
            std::iter::empty::<&str>(),
            Some("session_anchor"),
        )
        .expect("normalize to persisted anchor");
        let parsed: toml::Value = toml::from_str(&normalized).expect("parse normalized config");

        assert_eq!(
            parsed
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("session_anchor")
        );
        let anchor = parsed
            .get("model_providers")
            .and_then(|value| value.get("session_anchor"))
            .expect("persisted anchor table");
        assert_eq!(
            anchor.get("base_url").and_then(|value| value.as_str()),
            Some("https://beta.example/v1")
        );
        assert_eq!(
            anchor.get("env_key").and_then(|value| value.as_str()),
            Some("BETA_API_KEY")
        );
    }

    #[test]
    fn legacy_top_level_route_is_upgraded_to_the_persisted_anchor() {
        let legacy = r#"model = "gpt-5.5"
base_url = "https://legacy.example/v1"
wire_api = "responses"
"#;

        let normalized = normalize_codex_live_config_model_provider_with_preferred_anchor(
            legacy,
            std::iter::empty::<&str>(),
            Some("custom"),
        )
        .expect("upgrade legacy route");
        let parsed: toml::Value = toml::from_str(&normalized).expect("parse upgraded config");

        assert_eq!(
            parsed
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("custom")
        );
        assert_eq!(
            parsed.get("model").and_then(|value| value.as_str()),
            Some("gpt-5.5")
        );
        assert!(parsed.get("base_url").is_none());
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("custom"))
                .and_then(|value| value.get("base_url"))
                .and_then(|value| value.as_str()),
            Some("https://legacy.example/v1")
        );
    }

    #[test]
    fn codex_env_section_reads_and_upserts_custom_env_keys() {
        let input = "# Codex\nexport CUSTOM_API_KEY=old\n#export OPENAI_BASE_URL=https://api.example\n\n# Other\nexport OTHER_KEY=value\n";

        let parsed = parse_codex_env_section(input);
        assert_eq!(
            parsed.get("CUSTOM_API_KEY").map(String::as_str),
            Some("old")
        );

        let updated = upsert_codex_env_section_key(input, "TUZI_CODEX_API_KEY", "sk-test").unwrap();
        assert!(updated.contains("# Codex\nexport CUSTOM_API_KEY=old\n#export OPENAI_BASE_URL=https://api.example\nexport TUZI_CODEX_API_KEY='sk-test'\n# tuzi-switch managed env: TUZI_CODEX_API_KEY\n\n# Other"));

        let replaced = upsert_codex_env_section_key(&updated, "CUSTOM_API_KEY", "new").unwrap();
        assert!(replaced.contains(
            "# Codex\nexport CUSTOM_API_KEY='new'\n# tuzi-switch managed env: CUSTOM_API_KEY\n"
        ));
        assert_eq!(replaced.matches("export CUSTOM_API_KEY=").count(), 1);
    }

    #[test]
    fn codex_env_section_supports_compact_header() {
        let input = "#Codex\nexport CUSTOM_API_KEY=old\n";

        let updated = upsert_codex_env_section_key(input, "NEW_CODEX_API_KEY", "sk-new").unwrap();

        assert!(updated.contains(
            "#Codex\nexport CUSTOM_API_KEY=old\nexport NEW_CODEX_API_KEY='sk-new'\n# tuzi-switch managed env: NEW_CODEX_API_KEY\n"
        ));
        assert_eq!(
            read_env_key_from_shell_rc(&updated, "NEW_CODEX_API_KEY").as_deref(),
            Some("sk-new")
        );
    }

    #[test]
    fn codex_env_section_shell_quotes_token_and_rejects_control_bytes() {
        let input = "# Codex\n";
        let token = "sk has 'single' and $(touch /tmp/pwn)";

        let updated = upsert_codex_env_section_key(input, "TUZI_CODEX_API_KEY", token).unwrap();

        assert!(updated
            .contains("export TUZI_CODEX_API_KEY='sk has '\\''single'\\'' and $(touch /tmp/pwn)'"));
        assert!(!updated.contains("export TUZI_CODEX_API_KEY=sk has"));
        assert_eq!(
            parse_codex_env_section(&updated)
                .get("TUZI_CODEX_API_KEY")
                .map(String::as_str),
            Some(token)
        );
        assert!(upsert_codex_env_section_key(input, "TUZI_CODEX_API_KEY", "line\nbreak").is_err());
        assert!(upsert_codex_env_section_key(input, "TUZI_CODEX_API_KEY", "nul\0byte").is_err());
    }

    #[test]
    fn codex_env_section_updates_user_section_without_bottom_managed_block() {
        let input = "# Codex\nexport CUSTOM_API_KEY=old\nexport TUZI_CODEX_API_KEY=old-token\n#export OPENAI_BASE_URL=https://api.example/v1\n\n# Other\nexport OTHER_KEY=value\n\n# >>> tuzi-switch codex env >>>\nexport TUZI_CODEX_API_KEY=stale-token\nexport EXTRA_CODEX_API_KEY=extra-token\n# <<< tuzi-switch codex env <<<\n";

        let cleaned = migrate_managed_env_block_to_codex_section(input);
        let updated =
            upsert_codex_env_section_key(&cleaned, "TUZI_CODEX_API_KEY", "new-token").unwrap();

        assert!(updated.contains("# Codex"));
        assert!(updated.contains("export CUSTOM_API_KEY=old"));
        assert!(updated.contains("export TUZI_CODEX_API_KEY='new-token'"));
        assert!(updated.contains("#export OPENAI_BASE_URL=https://api.example/v1"));
        assert!(updated.contains("# Other"));
        assert!(!updated.contains(MANAGED_ENV_BEGIN));
        assert!(!updated.contains("stale-token"));
        assert!(updated.contains("export EXTRA_CODEX_API_KEY='extra-token'"));
        assert!(updated.contains("# tuzi-switch managed env: EXTRA_CODEX_API_KEY"));
        assert_eq!(updated.matches("export TUZI_CODEX_API_KEY=").count(), 1);
    }

    #[test]
    fn remove_codex_env_section_key_only_removes_tuzi_managed_env() {
        let input = "# Codex\nexport CUSTOM_API_KEY=sk-user\nexport TUZI_CODEX_API_KEY='sk-managed'\n# tuzi-switch managed env: TUZI_CODEX_API_KEY\n\n# Other\nexport OTHER_KEY=keep\n";

        let preserved_user = remove_codex_env_section_key(input, "CUSTOM_API_KEY");
        assert!(preserved_user.contains("export CUSTOM_API_KEY=sk-user"));

        let removed_managed = remove_codex_env_section_key(input, "TUZI_CODEX_API_KEY");
        assert!(!removed_managed.contains("TUZI_CODEX_API_KEY"));
        assert!(removed_managed.contains("export CUSTOM_API_KEY=sk-user"));
        assert!(removed_managed.contains("export OTHER_KEY=keep"));
    }

    #[test]
    fn codex_env_read_key_prefers_codex_section_over_legacy_managed_block() {
        let input = "# Codex\nexport TUZI_CODEX_API_KEY=correct-token\n\n# >>> tuzi-switch codex env >>>\nexport TUZI_CODEX_API_KEY=stale-token\n# <<< tuzi-switch codex env <<<\n";

        let mut merged = parse_managed_block(input);
        merged.extend(parse_codex_env_section(input));

        assert_eq!(
            merged.get("TUZI_CODEX_API_KEY").map(String::as_str),
            Some("correct-token")
        );
    }

    #[test]
    #[serial]
    fn codex_dotenv_exact_reader_ignores_blank_values() {
        let _guard = TEST_ENV_LOCK.lock().expect("lock test env");
        let temp = tempfile::tempdir().expect("temp home");
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        fs::create_dir_all(temp.path().join(".codex")).expect("create Codex dir");
        fs::write(
            temp.path().join(".codex").join(".env"),
            "BLANK_CODEX_API_KEY=   \nVALID_CODEX_API_KEY=  valid-key  \n",
        )
        .expect("write Codex dotenv");

        assert_eq!(
            read_codex_env_key_file("BLANK_CODEX_API_KEY").expect("read blank key"),
            None
        );
        assert_eq!(
            read_codex_env_key_file("VALID_CODEX_API_KEY").expect("read valid key"),
            Some("valid-key".to_string())
        );

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }

    #[test]
    #[serial]
    #[cfg(target_os = "linux")]
    fn linux_write_managed_env_key_uses_current_shell_rc_file() {
        let _guard = TEST_ENV_LOCK.lock().expect("lock test env");
        let temp = tempfile::tempdir().expect("temp home");
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        let old_shell = std::env::var_os("SHELL");

        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        std::env::set_var("SHELL", "/bin/bash");
        fs::write(
            temp.path().join(".zshrc"),
            "# Codex\nexport CUSTOM_API_KEY=old\n",
        )
        .expect("seed zshrc");

        write_managed_env_key("NEW_CODEX_API_KEY", "sk-new").expect("write env key");

        let zshrc = fs::read_to_string(temp.path().join(".zshrc")).expect("read zshrc");
        assert!(!zshrc.contains("export NEW_CODEX_API_KEY=sk-new"));
        let bashrc = fs::read_to_string(temp.path().join(".bashrc")).expect("read bashrc");
        assert!(bashrc.contains("export NEW_CODEX_API_KEY='sk-new'"));

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
        match old_shell {
            Some(value) => std::env::set_var("SHELL", value),
            None => std::env::remove_var("SHELL"),
        }
    }

    #[test]
    #[serial]
    #[cfg(target_os = "macos")]
    fn macos_write_managed_env_key_uses_zshrc() {
        let _guard = TEST_ENV_LOCK.lock().expect("lock test env");
        let temp = tempfile::tempdir().expect("temp home");
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        let old_shell = std::env::var_os("SHELL");

        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        std::env::set_var("SHELL", "/bin/bash");
        fs::write(temp.path().join(".zshrc"), "").expect("seed zshrc");

        write_managed_env_key("NEW_CODEX_API_KEY", "sk-new").expect("write env key");

        let zshrc = fs::read_to_string(temp.path().join(".zshrc")).expect("read zshrc");
        assert!(zshrc.contains("export NEW_CODEX_API_KEY='sk-new'"));
        assert!(!temp.path().join(".bashrc").exists());
        assert_eq!(
            get_codex_env_file_path(),
            temp.path().join(".codex").join(".env")
        );
        assert_eq!(
            read_codex_env_file()
                .get("NEW_CODEX_API_KEY")
                .map(String::as_str),
            Some("sk-new")
        );

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
        match old_shell {
            Some(value) => std::env::set_var("SHELL", value),
            None => std::env::remove_var("SHELL"),
        }
    }

    #[test]
    #[serial]
    fn read_managed_env_key_prefers_codex_dotenv_copy() {
        let _guard = TEST_ENV_LOCK.lock().expect("lock test env");
        let temp = tempfile::tempdir().expect("temp home");
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");

        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        fs::create_dir_all(temp.path().join(".codex")).expect("create codex dir");
        fs::write(
            temp.path().join(".codex").join(".env"),
            "TUZI_TEST_CODEX_API_KEY=sk-dotenv\n",
        )
        .expect("seed codex .env");
        fs::write(
            temp.path().join(".zshrc"),
            "# Codex\nexport TUZI_TEST_CODEX_API_KEY=sk-shell\n",
        )
        .expect("seed zshrc");

        assert_eq!(
            read_managed_env_key("TUZI_TEST_CODEX_API_KEY").as_deref(),
            Some("sk-dotenv")
        );

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }

    #[test]
    #[serial]
    fn copy_managed_env_key_only_fills_an_empty_destination() {
        let _guard = TEST_ENV_LOCK.lock().expect("lock test env");
        let temp = tempfile::tempdir().expect("temp home");
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        fs::write(
            temp.path().join(".zshrc"),
            "# Codex\nexport CODING_CODEX_API_KEY='legacy-key'\n",
        )
        .expect("seed legacy key");

        assert!(
            copy_managed_env_key_if_missing("CODING_CODEX_API_KEY", "CODING01_CODEX_API_KEY")
                .expect("copy legacy key")
        );
        assert_eq!(
            read_managed_env_key("CODING01_CODEX_API_KEY").as_deref(),
            Some("legacy-key")
        );

        write_managed_env_key("CODING01_CODEX_API_KEY", "provider-key")
            .expect("replace destination");
        assert!(
            !copy_managed_env_key_if_missing("CODING_CODEX_API_KEY", "CODING01_CODEX_API_KEY")
                .expect("keep destination")
        );
        assert_eq!(
            read_managed_env_key("CODING01_CODEX_API_KEY").as_deref(),
            Some("provider-key")
        );

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }

    #[test]
    #[serial]
    fn ensure_provider_env_ready_mirrors_shell_key_and_rejects_missing_key() {
        let _guard = TEST_ENV_LOCK.lock().expect("lock test env");
        let temp = tempfile::tempdir().expect("temp home");
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        fs::write(
            temp.path().join(".zshrc"),
            "# Codex\nexport READY_CODEX_API_KEY='ready-key'\n",
        )
        .expect("seed shell key");
        let ready_config = r#"model_provider = "custom"
[model_providers.custom]
env_key = "READY_CODEX_API_KEY"
"#;
        ensure_codex_provider_env_ready(ready_config).expect("mirror ready key");
        assert_eq!(
            read_codex_env_key_file("READY_CODEX_API_KEY")
                .expect("read mirrored key")
                .as_deref(),
            Some("ready-key")
        );

        let missing_config = r#"model_provider = "missing"
[model_providers.missing]
env_key = "MISSING_CODEX_API_KEY"
"#;
        let error = ensure_codex_provider_env_ready(missing_config)
            .expect_err("missing key should block live write");
        assert!(error.to_string().contains("MISSING_CODEX_API_KEY"));

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }

    #[test]
    #[serial]
    fn remove_managed_env_key_clears_codex_dotenv_copy() {
        let _guard = TEST_ENV_LOCK.lock().expect("lock test env");
        let temp = tempfile::tempdir().expect("temp home");
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");

        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        fs::create_dir_all(temp.path().join(".codex")).expect("create codex dir");
        fs::write(
            temp.path().join(".codex").join(".env"),
            "TUZI_TEST_CODEX_API_KEY=sk-dotenv\nKEEP_CODEX_API_KEY=sk-keep\n",
        )
        .expect("seed codex .env");

        remove_managed_env_key("TUZI_TEST_CODEX_API_KEY").expect("remove env key");

        assert_eq!(
            get_codex_env_file_path(),
            temp.path().join(".codex").join(".env")
        );
        let codex_env = read_codex_env_file();
        assert!(!codex_env.contains_key("TUZI_TEST_CODEX_API_KEY"));
        assert_eq!(
            codex_env.get("KEEP_CODEX_API_KEY").map(String::as_str),
            Some("sk-keep")
        );

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }

    #[test]
    fn unified_bucket_refreshes_existing_managed_route_table() {
        let input = r#"model_provider = "rightcode"

[model_providers.rightcode]
name = "RightCode"
base_url = "https://rightcode.example/v1"

[model_providers.tuziswitch]
name = "Existing Route"
base_url = "https://existing.example/v1"
"#;

        let result = inject_codex_unified_session_bucket_with_id(input, "custom")
            .expect("inject unified bucket");

        let parsed: toml::Value = toml::from_str(&result).expect("parse result");
        assert_eq!(
            parsed
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("custom")
        );
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("custom"))
                .and_then(|value| value.get("base_url"))
                .and_then(|value| value.as_str()),
            Some("https://rightcode.example/v1")
        );
        assert!(result.find("[model_providers.rightcode]").is_none());
    }

    #[test]
    fn normalize_live_config_preserves_current_custom_model_provider_id() {
        let current = r#"model_provider = "rightcode"

[model_providers.rightcode]
name = "RightCode"
base_url = "https://rightcode.example/v1"
wire_api = "responses"
"#;
        let target = r#"model_provider = "aihubmix"
model = "gpt-5.4"

[model_providers.aihubmix]
name = "AiHubMix"
base_url = "https://aihubmix.example/v1"
wire_api = "responses"
requires_openai_auth = true

[mcp_servers.context7]
command = "npx"
"#;

        let result =
            normalize_codex_live_config_model_provider_with_anchors(target, Some(current)).unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        assert_eq!(
            parsed.get("model_provider").and_then(|v| v.as_str()),
            Some("rightcode")
        );

        let model_providers = parsed
            .get("model_providers")
            .and_then(|v| v.as_table())
            .expect("model_providers should exist");
        assert!(
            model_providers.get("aihubmix").is_none(),
            "source provider id should not remain in live config"
        );

        let stable_provider = model_providers
            .get("rightcode")
            .expect("stable provider table should exist");
        assert_eq!(
            stable_provider.get("base_url").and_then(|v| v.as_str()),
            Some("https://aihubmix.example/v1")
        );
        assert!(
            parsed.get("mcp_servers").is_some(),
            "unrelated config should be preserved"
        );
    }

    #[test]
    fn normalize_live_config_uses_target_custom_provider_when_current_is_reserved() {
        let current = r#"model_provider = "openai""#;
        let target = r#"model_provider = "aihubmix"

[model_providers.aihubmix]
name = "AiHubMix"
base_url = "https://aihubmix.example/v1"
wire_api = "responses"
"#;

        let result =
            normalize_codex_live_config_model_provider_with_anchors(target, Some(current)).unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        assert_eq!(
            parsed.get("model_provider").and_then(|v| v.as_str()),
            Some("aihubmix")
        );
        assert!(
            parsed
                .get("model_providers")
                .and_then(|v| v.get("aihubmix"))
                .is_some(),
            "target provider id should be kept when there is no reusable live custom id"
        );
    }

    #[test]
    fn migrate_reserved_custom_provider_tables_renames_openai_override() {
        let input = r#"model_provider = "openai"

[model_providers.openai]
name = "openai"
base_url = "https://api.example/v1"
env_key = "OPENAI_API_KEY"
wire_api = "responses"
requires_openai_auth = false
"#;

        let migrated = migrate_reserved_custom_model_provider_ids(input).expect("migrate");
        let parsed: toml::Value = toml::from_str(&migrated).expect("parse migrated");

        assert_eq!(
            parsed
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("openai-custom")
        );
        assert!(parsed
            .get("model_providers")
            .and_then(|value| value.get("openai"))
            .is_none());
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("openai-custom"))
                .and_then(|value| value.get("base_url"))
                .and_then(|value| value.as_str()),
            Some("https://api.example/v1")
        );
    }

    #[test]
    fn migrate_reserved_custom_provider_tables_keeps_builtin_nested_tables() {
        let input = r#"model_provider = "amazon-bedrock"

[model_providers.amazon-bedrock.aws]
region = "us-west-2"
"#;

        let migrated = migrate_reserved_custom_model_provider_ids(input).expect("migrate");
        assert_eq!(migrated, input);
    }

    #[test]
    fn migrate_env_backed_provider_auth_mode_disables_oauth_for_custom_base_url() {
        let input = r#"model_provider = "coding"

[model_providers.coding]
name = "coding"
base_url = "https://api.tu-zi.com/coding"
env_key = "CODING_CODEX_API_KEY"
requires_openai_auth = true
"#;

        let migrated = migrate_env_backed_provider_auth_mode(input).expect("migrate");
        let parsed: toml::Value = toml::from_str(&migrated).expect("parse migrated");

        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("coding"))
                .and_then(|value| value.get("requires_openai_auth"))
                .and_then(|value| value.as_bool()),
            Some(false)
        );
    }

    #[test]
    fn build_model_provider_section_forces_env_backed_provider_off_oauth() {
        let section = build_model_provider_section(
            "coding",
            "https://api.tu-zi.com/coding",
            "CODING_CODEX_API_KEY",
            Some(
                r#"model_provider = "coding"

[model_providers.coding]
name = "coding"
base_url = "https://api.tu-zi.com/coding"
env_key = "OPENAI_API_KEY"
requires_openai_auth = true
"#,
            ),
        )
        .expect("build section");

        assert!(section.contains(r#"env_key = "CODING_CODEX_API_KEY""#));
        assert!(section.contains("requires_openai_auth = false"));
    }

    #[test]
    fn normalize_live_config_leaves_official_empty_config_unchanged() {
        let current = r#"model_provider = "rightcode"

[model_providers.rightcode]
base_url = "https://rightcode.example/v1"
"#;

        let result =
            normalize_codex_live_config_model_provider_with_anchors("", Some(current)).unwrap();

        assert_eq!(result, "");
    }

    #[test]
    fn normalize_live_config_rewrites_matching_profile_model_provider_refs() {
        let current = r#"model_provider = "session_anchor"

[model_providers.session_anchor]
name = "Session Anchor"
base_url = "https://anchor.example/v1"
wire_api = "responses"
"#;
        let target = r#"model_provider = "vendor_alpha"
model = "gpt-5.4"
profile = "work"

[model_providers.vendor_alpha]
name = "Vendor Alpha"
base_url = "https://alpha.example/v1"
wire_api = "responses"

[profiles.work]
model_provider = "vendor_alpha"
model = "gpt-5.4"
"#;

        let result =
            normalize_codex_live_config_model_provider_with_anchors(target, Some(current)).unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        assert_eq!(
            parsed.get("model_provider").and_then(|v| v.as_str()),
            Some("session_anchor")
        );
        assert_eq!(
            parsed
                .get("profiles")
                .and_then(|v| v.get("work"))
                .and_then(|v| v.get("model_provider"))
                .and_then(|v| v.as_str()),
            Some("session_anchor"),
            "profile override matching the rewritten provider should stay valid"
        );
    }

    #[test]
    fn normalize_live_config_keeps_unrelated_profile_model_provider_refs() {
        let current = r#"model_provider = "session_anchor"

[model_providers.session_anchor]
name = "Session Anchor"
base_url = "https://anchor.example/v1"
wire_api = "responses"
"#;
        let target = r#"model_provider = "vendor_alpha"
model = "gpt-5.4"

[model_providers.vendor_alpha]
name = "Vendor Alpha"
base_url = "https://alpha.example/v1"
wire_api = "responses"

[model_providers.local_profile]
name = "Local Profile"
base_url = "http://localhost:11434/v1"
wire_api = "responses"

[profiles.local]
model_provider = "local_profile"
model = "local-model"
"#;

        let result =
            normalize_codex_live_config_model_provider_with_anchors(target, Some(current)).unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        assert_eq!(
            parsed
                .get("profiles")
                .and_then(|v| v.get("local"))
                .and_then(|v| v.get("model_provider"))
                .and_then(|v| v.as_str()),
            Some("local_profile"),
            "unrelated profile provider references should be preserved"
        );
        assert!(
            parsed
                .get("model_providers")
                .and_then(|v| v.get("local_profile"))
                .is_some(),
            "unrelated provider tables should also remain available"
        );
    }

    #[test]
    fn normalize_live_config_keeps_stable_provider_across_repeated_switches() {
        let anchor = r#"model_provider = "session_anchor"

[model_providers.session_anchor]
name = "Session Anchor"
base_url = "https://anchor.example/v1"
wire_api = "responses"
"#;
        let first_target = r#"model_provider = "vendor_alpha"

[model_providers.vendor_alpha]
name = "Vendor Alpha"
base_url = "https://alpha.example/v1"
wire_api = "responses"
"#;
        let second_target = r#"model_provider = "vendor_beta"

[model_providers.vendor_beta]
name = "Vendor Beta"
base_url = "https://beta.example/v1"
wire_api = "responses"
"#;

        let first =
            normalize_codex_live_config_model_provider_with_anchors(first_target, Some(anchor))
                .unwrap();
        let second = normalize_codex_live_config_model_provider_with_anchors(
            second_target,
            Some(first.as_str()),
        )
        .unwrap();
        let parsed: toml::Value = toml::from_str(&second).unwrap();

        assert_eq!(
            parsed.get("model_provider").and_then(|v| v.as_str()),
            Some("session_anchor"),
            "stable provider id should not drift across repeated switches"
        );
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|v| v.get("session_anchor"))
                .and_then(|v| v.get("base_url"))
                .and_then(|v| v.as_str()),
            Some("https://beta.example/v1")
        );
    }

    #[test]
    fn normalize_live_config_preserves_anchor_name_and_target_env_key() {
        let anchor = r#"model_provider = "existing_route"

[model_providers.existing_route]
name = "Existing Route"
base_url = "https://old.example/v1"
env_key = "EXISTING_CODEX_API_KEY"
wire_api = "responses"
"#;
        let target = r#"model_provider = "custom"

[model_providers.custom]
name = "Other Provider"
base_url = "https://new.example/v1"
env_key = "OTHER_CODEX_API_KEY"
wire_api = "responses"
"#;

        let result =
            normalize_codex_live_config_model_provider_with_anchors(target, Some(anchor)).unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();
        let provider = parsed
            .get("model_providers")
            .and_then(|value| value.get("existing_route"))
            .expect("existing anchor provider");

        assert_eq!(
            parsed
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("existing_route")
        );
        assert_eq!(
            provider.get("name").and_then(|value| value.as_str()),
            Some("Existing Route")
        );
        assert_eq!(
            provider.get("env_key").and_then(|value| value.as_str()),
            Some("OTHER_CODEX_API_KEY")
        );
        assert_eq!(
            provider.get("base_url").and_then(|value| value.as_str()),
            Some("https://new.example/v1")
        );
    }

    #[test]
    fn base_url_writes_into_correct_model_provider_section() {
        let input = r#"model_provider = "any"
model = "gpt-5.1-codex"

[model_providers.any]
name = "any"
wire_api = "responses"
"#;

        let result = update_codex_toml_field(input, "base_url", "https://example.com/v1").unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        let base_url = parsed
            .get("model_providers")
            .and_then(|v| v.get("any"))
            .and_then(|v| v.get("base_url"))
            .and_then(|v| v.as_str())
            .expect("base_url should be in model_providers.any");
        assert_eq!(base_url, "https://example.com/v1");

        // Should NOT have top-level base_url
        assert!(parsed.get("base_url").is_none());

        // wire_api preserved
        let wire_api = parsed
            .get("model_providers")
            .and_then(|v| v.get("any"))
            .and_then(|v| v.get("wire_api"))
            .and_then(|v| v.as_str());
        assert_eq!(wire_api, Some("responses"));
    }

    #[test]
    fn base_url_creates_section_when_missing() {
        let input = r#"model_provider = "custom"
model = "gpt-4"
"#;

        let result = update_codex_toml_field(input, "base_url", "https://custom.api/v1").unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        let base_url = parsed
            .get("model_providers")
            .and_then(|v| v.get("custom"))
            .and_then(|v| v.get("base_url"))
            .and_then(|v| v.as_str())
            .expect("should create section and set base_url");
        assert_eq!(base_url, "https://custom.api/v1");
    }

    #[test]
    fn base_url_falls_back_to_top_level_without_model_provider() {
        let input = r#"model = "gpt-4"
"#;

        let result = update_codex_toml_field(input, "base_url", "https://fallback.api/v1").unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        let base_url = parsed
            .get("base_url")
            .and_then(|v| v.as_str())
            .expect("should set top-level base_url");
        assert_eq!(base_url, "https://fallback.api/v1");
    }

    #[test]
    fn wire_api_writes_into_active_provider_section() {
        let input = r#"model_provider = "any"

[model_providers.any]
name = "any"
base_url = "https://api.example/v1"
"#;

        let result = update_codex_toml_field(input, "wire_api", "responses").unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|v| v.get("any"))
                .and_then(|v| v.get("wire_api"))
                .and_then(|v| v.as_str()),
            Some("responses")
        );
        assert!(parsed.get("wire_api").is_none());
    }

    #[test]
    fn model_catalog_json_field_operates_on_top_level() {
        let input = r#"model_provider = "any"

[model_providers.any]
name = "any"
"#;
        let catalog_path = Path::new("/tmp/tuzi-switch-model-catalog.json");

        let result = set_codex_model_catalog_json_field(input, Some(catalog_path)).unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        assert_eq!(
            parsed
                .get("model_catalog_json")
                .and_then(|value| value.as_str()),
            Some("/tmp/tuzi-switch-model-catalog.json")
        );
        assert!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("any"))
                .and_then(|value| value.get("model_catalog_json"))
                .is_none(),
            "model_catalog_json should stay top-level"
        );
    }

    #[test]
    fn generated_catalog_preserves_user_owned_catalog_path() {
        let input = r#"model_provider = "any"
model_catalog_json = "/Users/me/.codex/my-custom-catalog.json"

[model_providers.any]
name = "any"
"#;
        let catalog_path = Path::new("/tmp/tuzi-switch-model-catalog.json");

        let result = set_codex_model_catalog_json_field(input, Some(catalog_path)).unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        assert_eq!(
            parsed
                .get("model_catalog_json")
                .and_then(|value| value.as_str()),
            Some("/Users/me/.codex/my-custom-catalog.json")
        );
    }

    #[test]
    fn credential_login_material_ignores_metadata_residue() {
        assert!(codex_auth_has_credential_login_material(&json!({
            "tokens": { "refresh_token": "rt" }
        })));
        assert!(!codex_auth_has_credential_login_material(&json!({
            "last_refresh": "2026-08-01T00:00:00Z",
            "tokens": { "account_id": "acc" }
        })));
    }

    #[test]
    fn prepare_provider_live_config_keeps_env_key_without_exposing_provider_token() {
        let input = r#"model_provider = "vendor_alpha"
model = "gpt-5.5"

[model_providers.vendor_alpha]
name = "Vendor Alpha"
base_url = "https://alpha.example/v1"
env_key = "TUZI_TEST_CODEX_API_KEY"
wire_api = "responses"
"#;

        let result = prepare_codex_provider_live_config_with_env_reader(&json!({}), input, |key| {
            (key == "TUZI_TEST_CODEX_API_KEY").then(|| "sk-env-test".to_string())
        })
        .unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        assert!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("vendor_alpha"))
                .and_then(|value| value.get("experimental_bearer_token"))
                .is_none(),
            "live config must not expose API key values"
        );
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("vendor_alpha"))
                .and_then(|value| value.get("env_key"))
                .and_then(|value| value.as_str()),
            Some("TUZI_TEST_CODEX_API_KEY")
        );
    }

    #[test]
    fn prepare_provider_live_config_uses_top_level_token_for_reserved_provider() {
        let input = r#"model_provider = "openai"
model = "gpt-5"
"#;

        let result =
            prepare_codex_provider_live_config(&json!({"OPENAI_API_KEY": "sk-test"}), input)
                .unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        assert!(
            parsed.get("experimental_bearer_token").is_none(),
            "live config must not expose API key values"
        );
        assert!(parsed.get("model_providers").is_none());
    }

    #[test]
    #[serial]
    fn third_party_live_write_keeps_existing_auth_cache() {
        let _guard = TEST_ENV_LOCK.lock().expect("lock test env");
        let temp = tempfile::tempdir().expect("temp home");
        let old_test_home = std::env::var_os("CC_SWITCH_TEST_HOME");

        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        fs::create_dir_all(temp.path().join(".codex")).expect("create codex dir");
        fs::write(
            temp.path().join(".codex").join("auth.json"),
            r#"{"refresh_token":"keep-me"}"#,
        )
        .expect("seed auth.json");

        write_codex_live_for_provider_inner(
            Some("aggregator"),
            &json!({}),
            Some(
                r#"model_provider = "vendor_alpha"

[model_providers.vendor_alpha]
name = "Vendor Alpha"
base_url = "https://alpha.example/v1"
wire_api = "responses"
"#,
            ),
        )
        .expect("write third-party live config");

        let auth_text =
            fs::read_to_string(temp.path().join(".codex").join("auth.json")).expect("read auth");
        assert!(auth_text.contains(r#""refresh_token":"keep-me""#));

        match old_test_home {
            Some(value) => std::env::set_var("CC_SWITCH_TEST_HOME", value),
            None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
        }
    }

    #[test]
    fn extract_bearer_uses_provider_token_for_custom_provider() {
        let input = r#"model_provider = "vendor_alpha"
experimental_bearer_token = "top-level-key"

[model_providers.vendor_alpha]
experimental_bearer_token = "provider-key"
"#;

        assert_eq!(
            extract_codex_experimental_bearer_token(input).as_deref(),
            Some("provider-key")
        );
    }

    #[test]
    fn restore_backfill_moves_bearer_token_out_of_stored_config() {
        let mut live_settings = json!({
            "auth": {},
            "config": r#"model_provider = "vendor_alpha"

[model_providers.vendor_alpha]
env_key = "TUZI_BACKFILL_CODEX_API_KEY"
experimental_bearer_token = "sk-backfill"
"#
        });
        let template_settings = json!({
            "auth": {},
            "env": { "envKey": "STALE_CODEX_API_KEY" },
            "config": r#"model_provider = "vendor_alpha"

[model_providers.vendor_alpha]
env_key = "TUZI_BACKFILL_CODEX_API_KEY"
"#
        });

        let mut writes = Vec::new();
        restore_codex_provider_token_for_backfill_with_env_writer(
            &mut live_settings,
            &template_settings,
            |key, value| {
                writes.push((key.to_string(), value.to_string()));
                Ok(())
            },
        )
        .unwrap();
        let config = live_settings.get("config").and_then(Value::as_str).unwrap();

        assert!(!config.contains("experimental_bearer_token"));
        assert_eq!(
            live_settings.pointer("/env/envKey").and_then(Value::as_str),
            Some("TUZI_BACKFILL_CODEX_API_KEY")
        );
        assert_eq!(
            writes,
            vec![(
                "TUZI_BACKFILL_CODEX_API_KEY".to_string(),
                "sk-backfill".to_string()
            )]
        );
    }

    #[test]
    fn restore_backfill_keeps_stored_provider_credentials_when_live_auth_is_login_key() {
        let mut live_settings = json!({
            "auth": {
                "auth_mode": "apikey",
                "OPENAI_API_KEY": "expired-login-key"
            },
            "config": r#"model_provider = "existing_route"

[model_providers.existing_route]
name = "Existing Route"
base_url = "https://new.example/v1"
env_key = "EXISTING_CODEX_API_KEY"
"#,
        });
        let template_settings = json!({
            "auth": {},
            "env": { "envKey": "EXISTING_CODEX_API_KEY" },
            "config": r#"model_provider = "existing_route"

[model_providers.existing_route]
name = "Existing Route"
base_url = "https://old.example/v1"
env_key = "EXISTING_CODEX_API_KEY"
"#,
        });

        restore_codex_settings_for_backfill(&mut live_settings, &template_settings, true).unwrap();

        assert!(live_settings
            .get("auth")
            .and_then(Value::as_object)
            .is_some_and(|auth| auth.is_empty()));
        assert_eq!(
            live_settings.pointer("/env/envKey").and_then(Value::as_str),
            Some("EXISTING_CODEX_API_KEY")
        );
        assert_ne!(
            live_settings
                .pointer("/auth/OPENAI_API_KEY")
                .and_then(Value::as_str),
            Some("expired-login-key")
        );
    }

    #[test]
    fn restore_backfill_rejects_route_fields_from_a_different_env_key() {
        let mut live_settings = json!({
            "auth": {},
            "env": { "envKey": "TUZI_CODEX_API_KEY" },
            "config": r#"model_provider = "session_anchor"

[model_providers.session_anchor]
name = "Rabbit Route"
base_url = "https://api.tu-zi.com/v1"
env_key = "TUZI_CODEX_API_KEY"
wire_api = "chat"
requires_openai_auth = true
"#,
        });
        let template_settings = json!({
            "auth": {},
            "env": { "envKey": "CODING01_CODEX_API_KEY" },
            "config": r#"model_provider = "coding"

[model_providers.coding]
name = "Codex Subscription"
base_url = "https://api.tu-zi.com/coding"
env_key = "CODING01_CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = false
"#,
        });

        restore_codex_settings_for_backfill(&mut live_settings, &template_settings, true).unwrap();

        let config = live_settings.get("config").and_then(Value::as_str).unwrap();
        let parsed: toml::Value = toml::from_str(config).unwrap();
        let provider = parsed
            .get("model_providers")
            .and_then(|providers| providers.get("coding"))
            .expect("restored coding provider");
        assert_eq!(
            provider.get("base_url").and_then(|value| value.as_str()),
            Some("https://api.tu-zi.com/coding")
        );
        assert_eq!(
            provider.get("env_key").and_then(|value| value.as_str()),
            Some("CODING01_CODEX_API_KEY")
        );
        assert_eq!(
            provider.get("wire_api").and_then(|value| value.as_str()),
            Some("responses")
        );
        assert_eq!(
            provider
                .get("requires_openai_auth")
                .and_then(|value| value.as_bool()),
            Some(false)
        );
    }

    #[test]
    fn restore_backfill_keeps_manual_route_edits_for_the_same_env_key() {
        let mut live_settings = json!({
            "auth": {},
            "env": { "envKey": "CODING01_CODEX_API_KEY" },
            "config": r#"model_provider = "session_anchor"

[model_providers.session_anchor]
name = "Codex Subscription"
base_url = "https://api.tu-zi.com/coding-fast"
env_key = "CODING01_CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = false
"#,
        });
        let template_settings = json!({
            "auth": {},
            "env": { "envKey": "CODING01_CODEX_API_KEY" },
            "config": r#"model_provider = "coding"

[model_providers.coding]
name = "Codex Subscription"
base_url = "https://api.tu-zi.com/coding"
env_key = "CODING01_CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = false
"#,
        });

        restore_codex_settings_for_backfill(&mut live_settings, &template_settings, true).unwrap();

        let config = live_settings.get("config").and_then(Value::as_str).unwrap();
        let parsed: toml::Value = toml::from_str(config).unwrap();
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|providers| providers.get("coding"))
                .and_then(|provider| provider.get("base_url"))
                .and_then(|value| value.as_str()),
            Some("https://api.tu-zi.com/coding-fast")
        );
    }

    #[test]
    fn restore_backfill_restores_provider_env_key_instead_of_live_anchor_env_key() {
        let mut live_settings = json!({
            "auth": { "OPENAI_API_KEY": "login-key" },
            "env": { "envKey": "SESSION_ANCHOR_API_KEY" },
            "config": r#"model_provider = "session_anchor"

[model_providers.session_anchor]
name = "Session Anchor"
base_url = "https://provider.example/v1"
env_key = "SESSION_ANCHOR_API_KEY"
experimental_bearer_token = "foreign-live-key"
"#,
        });
        let template_settings = json!({
            "auth": {},
            "env": { "envKey": "PROVIDER_B_API_KEY" },
            "config": r#"model_provider = "provider_b"

[model_providers.provider_b]
name = "Provider B"
base_url = "https://provider.example/v1"
env_key = "PROVIDER_B_API_KEY"
"#,
        });

        restore_codex_settings_for_backfill(&mut live_settings, &template_settings, true).unwrap();

        let config = live_settings.get("config").and_then(Value::as_str).unwrap();
        let parsed: toml::Value = toml::from_str(config).unwrap();
        let provider = parsed
            .get("model_providers")
            .and_then(|value| value.get("provider_b"))
            .expect("restored provider table");
        assert_eq!(
            provider.get("env_key").and_then(|value| value.as_str()),
            Some("PROVIDER_B_API_KEY")
        );
        assert!(provider.get("experimental_bearer_token").is_none());
        assert_eq!(
            live_settings.pointer("/env/envKey").and_then(Value::as_str),
            Some("PROVIDER_B_API_KEY")
        );
        assert!(live_settings
            .get("auth")
            .and_then(Value::as_object)
            .is_some_and(|auth| auth.is_empty()));
    }

    #[test]
    fn restore_backfill_rejects_invalid_env_key_without_cleaning_token() {
        let mut live_settings = json!({
            "auth": {},
            "config": r#"model_provider = "vendor_alpha"

[model_providers.vendor_alpha]
env_key = "SAFE_CODEX_API_KEY"
experimental_bearer_token = "sk-backfill"
"#
        });
        let template_settings = json!({
            "auth": {},
            "config": r#"model_provider = "vendor_alpha"

[model_providers.vendor_alpha]
env_key = "BAD; echo injected"
"#
        });

        let err = restore_codex_provider_token_for_backfill_with_env_writer(
            &mut live_settings,
            &template_settings,
            |key, value| panic!("unexpected write for {key}={value}"),
        )
        .unwrap_err();
        let config = live_settings.get("config").and_then(Value::as_str).unwrap();

        assert!(err.to_string().contains("Invalid Codex env_key name"));
        assert!(
            config.contains("experimental_bearer_token"),
            "token must stay in config when env_key is rejected"
        );
    }

    #[test]
    fn restore_backfill_keeps_bearer_token_when_env_write_fails() {
        let mut live_settings = json!({
            "auth": {},
            "config": r#"model_provider = "vendor_alpha"

[model_providers.vendor_alpha]
env_key = "TUZI_BACKFILL_CODEX_API_KEY"
experimental_bearer_token = "sk-backfill"
"#
        });
        let template_settings = json!({
            "auth": {},
            "env": { "envKey": "TUZI_BACKFILL_CODEX_API_KEY" },
            "config": r#"model_provider = "vendor_alpha"

[model_providers.vendor_alpha]
env_key = "TUZI_BACKFILL_CODEX_API_KEY"
"#
        });

        let err = restore_codex_provider_token_for_backfill_with_env_writer(
            &mut live_settings,
            &template_settings,
            |_key, _value| Err(AppError::Message("env write failed".to_string())),
        )
        .unwrap_err();
        let config = live_settings.get("config").and_then(Value::as_str).unwrap();

        assert!(err.to_string().contains("env write failed"));
        assert!(
            config.contains("experimental_bearer_token"),
            "token must stay in config when env backfill fails"
        );
        assert!(
            live_settings.get("auth").is_none()
                || live_settings
                    .get("auth")
                    .and_then(Value::as_object)
                    .is_some_and(|auth| auth.is_empty()),
            "auth should not be cleared into a misleading migrated state"
        );
    }

    #[test]
    fn codex_model_catalog_uses_provider_models_and_context() {
        let template = json!({
            "slug": "gpt-5.5",
            "display_name": "GPT-5.5",
            "description": "Frontier model",
            "base_instructions": "gpt-5.5 base instructions",
            "model_messages": {
                "instructions_template": "gpt-5.5 instructions template"
            },
            "additional_speed_tiers": ["fast"],
            "service_tiers": [{"id": "priority"}],
            "availability_nux": {"message": "GPT-5.5 is now available."},
            "upgrade": {"target": "gpt-5.5"},
            "context_window": 272000,
            "max_context_window": 272000
        });
        let settings = json!({
            "modelCatalog": {
                "models": [
                    {
                        "model": "deepseek-v4-flash",
                        "displayName": "DeepSeek V4 Flash",
                        "contextWindow": "64000"
                    },
                    {
                        "model": "deepseek-v4-flash",
                        "displayName": "Duplicate"
                    },
                    {
                        "model": "kimi-k2",
                        "display_name": "Kimi K2"
                    }
                ]
            }
        });

        let specs = codex_catalog_model_specs(&settings, r#"model_context_window = 128000"#);
        let catalog = codex_model_catalog_from_specs(&specs, &template);
        let models = catalog
            .get("models")
            .and_then(Value::as_array)
            .expect("models should be an array");

        assert_eq!(models.len(), 2);
        assert_eq!(
            models[0].get("slug").and_then(Value::as_str),
            Some("deepseek-v4-flash")
        );
        assert_eq!(
            models[0].get("context_window").and_then(Value::as_u64),
            Some(64_000)
        );
        assert_eq!(
            models[1].get("context_window").and_then(Value::as_u64),
            Some(128_000)
        );
        assert_eq!(models[0].get("additional_speed_tiers"), Some(&json!([])));
        assert!(models[0]
            .get("availability_nux")
            .is_some_and(Value::is_null));
    }

    #[test]
    fn build_simplified_catalog_round_trips_user_input() {
        let catalog = r#"{
            "models": [
                { "slug": "deepseek-v4-pro", "display_name": "deepseek-v4-pro", "context_window": 1000000 },
                { "slug": "deepseek-v4-flash", "display_name": "DeepSeek Flash", "context_window": 1000000 }
            ]
        }"#;

        let result = build_simplified_catalog_from_texts("", catalog).expect("entries found");
        let models = result
            .get("models")
            .and_then(Value::as_array)
            .expect("models array");

        assert_eq!(models.len(), 2);
        assert_eq!(
            models[0].get("model").and_then(Value::as_str),
            Some("deepseek-v4-pro")
        );
        assert!(models[0].get("displayName").is_none());
        assert_eq!(
            models[1].get("displayName").and_then(Value::as_str),
            Some("DeepSeek Flash")
        );
    }

    #[test]
    fn clearing_base_url_removes_only_from_correct_section() {
        let input = r#"model_provider = "any"

[model_providers.any]
name = "any"
base_url = "https://old.api/v1"
wire_api = "responses"

[mcp_servers.context7]
command = "npx"
"#;

        let result = update_codex_toml_field(input, "base_url", "").unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        // base_url removed from model_providers.any
        let any_section = parsed
            .get("model_providers")
            .and_then(|v| v.get("any"))
            .expect("model_providers.any should exist");
        assert!(any_section.get("base_url").is_none());

        // wire_api preserved
        assert_eq!(
            any_section.get("wire_api").and_then(|v| v.as_str()),
            Some("responses")
        );

        // mcp_servers untouched
        assert!(parsed.get("mcp_servers").is_some());
    }

    #[test]
    fn model_field_operates_on_top_level() {
        let input = r#"model_provider = "any"
model = "gpt-4"

[model_providers.any]
name = "any"
"#;

        let result = update_codex_toml_field(input, "model", "gpt-5").unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();
        assert_eq!(parsed.get("model").and_then(|v| v.as_str()), Some("gpt-5"));

        // Clear model
        let result2 = update_codex_toml_field(&result, "model", "").unwrap();
        let parsed2: toml::Value = toml::from_str(&result2).unwrap();
        assert!(parsed2.get("model").is_none());
    }

    #[test]
    fn preserves_comments_and_whitespace() {
        let input = r#"# My Codex config
model_provider = "any"
model = "gpt-4"

# Provider section
[model_providers.any]
name = "any"
base_url = "https://old.api/v1"
"#;

        let result = update_codex_toml_field(input, "base_url", "https://new.api/v1").unwrap();

        // Comments should be preserved
        assert!(result.contains("# My Codex config"));
        assert!(result.contains("# Provider section"));
    }

    #[test]
    fn does_not_misplace_when_profiles_section_follows() {
        let input = r#"model_provider = "any"

[model_providers.any]
name = "any"
base_url = "https://old.api/v1"

[profiles.default]
model = "gpt-4"
"#;

        let result = update_codex_toml_field(input, "base_url", "https://new.api/v1").unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        // base_url in correct section
        let base_url = parsed
            .get("model_providers")
            .and_then(|v| v.get("any"))
            .and_then(|v| v.get("base_url"))
            .and_then(|v| v.as_str());
        assert_eq!(base_url, Some("https://new.api/v1"));

        // profiles section untouched
        let profile_model = parsed
            .get("profiles")
            .and_then(|v| v.get("default"))
            .and_then(|v| v.get("model"))
            .and_then(|v| v.as_str());
        assert_eq!(profile_model, Some("gpt-4"));
    }

    #[test]
    fn remove_base_url_if_predicate() {
        let input = r#"model_provider = "any"

[model_providers.any]
name = "any"
base_url = "http://127.0.0.1:5000/v1"
wire_api = "responses"
"#;

        let result =
            remove_codex_toml_base_url_if(input, |url| url.starts_with("http://127.0.0.1"));
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        let any_section = parsed
            .get("model_providers")
            .and_then(|v| v.get("any"))
            .unwrap();
        assert!(any_section.get("base_url").is_none());
        assert_eq!(
            any_section.get("wire_api").and_then(|v| v.as_str()),
            Some("responses")
        );
    }

    #[test]
    fn remove_base_url_if_keeps_non_matching() {
        let input = r#"model_provider = "any"

[model_providers.any]
base_url = "https://production.api/v1"
"#;

        let result =
            remove_codex_toml_base_url_if(input, |url| url.starts_with("http://127.0.0.1"));
        let parsed: toml::Value = toml::from_str(&result).unwrap();

        let base_url = parsed
            .get("model_providers")
            .and_then(|v| v.get("any"))
            .and_then(|v| v.get("base_url"))
            .and_then(|v| v.as_str());
        assert_eq!(base_url, Some("https://production.api/v1"));
    }

    #[test]
    fn remove_active_http_header_handles_inline_table_case_insensitively() {
        let input = r#"model_provider = "any"

[model_providers.any]
http_headers = { X-Tuzi-Image-Token = "stale", X-User-Header = "keep" }
"#;

        let result = remove_active_codex_http_header(input, "x-tuzi-image-token").unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();
        let headers = parsed
            .get("model_providers")
            .and_then(|value| value.get("any"))
            .and_then(|value| value.get("http_headers"))
            .and_then(toml::Value::as_table)
            .unwrap();
        assert!(headers.get("X-Tuzi-Image-Token").is_none());
        assert_eq!(
            headers.get("X-User-Header").and_then(toml::Value::as_str),
            Some("keep")
        );
    }

    #[test]
    fn remove_active_http_header_handles_table_and_removes_empty_section() {
        let input = r#"model_provider = "any"

[model_providers.any]
base_url = "https://production.api/v1"

[model_providers.any.http_headers]
X-TUZI-IMAGE-TOKEN = "stale"
"#;

        let result = remove_active_codex_http_header(input, "x-tuzi-image-token").unwrap();
        let parsed: toml::Value = toml::from_str(&result).unwrap();
        let provider = parsed
            .get("model_providers")
            .and_then(|value| value.get("any"))
            .unwrap();
        assert!(provider.get("http_headers").is_none());
        assert_eq!(
            provider.get("base_url").and_then(toml::Value::as_str),
            Some("https://production.api/v1")
        );
    }

    #[test]
    fn save_route_to_config_preserves_provider_extension_fields() {
        let provider_config = r#"model_provider = "vendor"
model = "gpt-5.5"

[model_providers.vendor]
name = "Vendor"
base_url = "https://old.example/v1"
env_key = "OLD_KEY"
wire_api = "chat"
requires_openai_auth = false
request_max_retries = 4
stream_idle_timeout_ms = 300000

[model_providers.vendor.headers]
X-Custom-Trace = "keep-me"
"#;

        let result = save_route_to_config_with_provider_config(
            "",
            "vendor",
            "https://new.example/v1",
            "NEW_KEY",
            "gpt-5.5",
            "high",
            Some(provider_config),
        )
        .expect("save route");
        let parsed: toml::Value = toml::from_str(&result).expect("parse result");
        let provider = parsed
            .get("model_providers")
            .and_then(|v| v.get("vendor"))
            .expect("provider table");

        assert_eq!(
            provider.get("base_url").and_then(|v| v.as_str()),
            Some("https://new.example/v1")
        );
        assert_eq!(
            provider.get("env_key").and_then(|v| v.as_str()),
            Some("NEW_KEY")
        );
        assert_eq!(
            provider
                .get("request_max_retries")
                .and_then(|v| v.as_integer()),
            Some(4)
        );
        assert_eq!(
            provider
                .get("stream_idle_timeout_ms")
                .and_then(|v| v.as_integer()),
            Some(300000)
        );
        assert_eq!(
            provider
                .get("headers")
                .and_then(|v| v.get("X-Custom-Trace"))
                .and_then(|v| v.as_str()),
            Some("keep-me")
        );
    }

    #[test]
    fn save_route_to_config_creates_missing_provider_table_from_template() {
        let provider_config = r#"model_provider = "template"
model = "gpt-5.5"

[model_providers.template]
request_max_retries = 2
stream_idle_timeout_ms = 180000
"#;

        let result = save_route_to_config_with_provider_config(
            "",
            "new_vendor",
            "https://new.example/v1",
            "NEW_VENDOR_CODEX_API_KEY",
            "gpt-5.5",
            "high",
            Some(provider_config),
        )
        .expect("save route");
        let parsed: toml::Value = toml::from_str(&result).expect("parse result");
        let provider = parsed
            .get("model_providers")
            .and_then(|v| v.get("new_vendor"))
            .expect("new provider table");

        assert_eq!(
            provider.get("base_url").and_then(|v| v.as_str()),
            Some("https://new.example/v1")
        );
        assert_eq!(
            provider.get("env_key").and_then(|v| v.as_str()),
            Some("NEW_VENDOR_CODEX_API_KEY")
        );
    }
}
