use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

use crate::config::{
    atomic_write, delete_file, get_home_dir, read_json_file, sanitize_provider_name,
    write_json_file, write_text_file,
};
use crate::error::AppError;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;
use std::process::Command;
use toml_edit::DocumentMut;

pub const CC_SWITCH_CODEX_MODEL_PROVIDER_ID: &str = "tuziswitch";
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

// ---------------------------------------------------------------------------
// Codex CLI version detection
// ---------------------------------------------------------------------------

/// Detect Codex CLI version. Returns (major, minor, patch) or None if not found.
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

/// Check if Codex CLI version is >= 0.134.0 (new profile format)
pub fn is_new_profile_format() -> bool {
    true // Always use new format, fix issue: legacy `profile = "codex"` config is no longer supported
}
// Shell RC managed block
// ---------------------------------------------------------------------------

fn get_shell_rc_path() -> PathBuf {
    let shell = std::env::var("SHELL").unwrap_or_default();
    let home = get_home_dir();
    if shell.contains("zsh") {
        home.join(".zshrc")
    } else {
        home.join(".bashrc")
    }
}

pub fn read_managed_env_block() -> HashMap<String, String> {
    if cfg!(target_os = "windows") {
        return read_windows_env_keys();
    }
    let rc_path = get_shell_rc_path();
    let content = match fs::read_to_string(&rc_path) {
        Ok(c) => c,
        Err(_) => return HashMap::new(),
    };
    parse_managed_block(&content)
}

pub fn read_managed_env_key(env_key: &str) -> Option<String> {
    if !is_valid_env_key_name(env_key) {
        return None;
    }
    if cfg!(target_os = "windows") {
        return std::env::var(env_key).ok().filter(|v| !v.is_empty());
    }
    read_managed_env_block().remove(env_key)
}

pub fn write_managed_env_key(env_key: &str, value: &str) -> Result<(), AppError> {
    validate_env_key_name(env_key)?;
    if cfg!(target_os = "windows") {
        return write_windows_env_key(env_key, value);
    }
    let rc_path = get_shell_rc_path();
    let content = fs::read_to_string(&rc_path).unwrap_or_default();
    let mut env_map = parse_managed_block(&content);
    env_map.insert(env_key.to_string(), value.to_string());
    let new_content = rebuild_rc_with_managed_block(&content, &env_map);
    atomic_write(&rc_path, new_content.as_bytes())
}

#[allow(dead_code)]
pub fn remove_managed_env_key(env_key: &str) -> Result<(), AppError> {
    validate_env_key_name(env_key)?;
    if cfg!(target_os = "windows") {
        return remove_windows_env_key(env_key);
    }
    let rc_path = get_shell_rc_path();
    let content = match fs::read_to_string(&rc_path) {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };
    let mut env_map = parse_managed_block(&content);
    if env_map.remove(env_key).is_none() {
        return Ok(());
    }
    let new_content = rebuild_rc_with_managed_block(&content, &env_map);
    atomic_write(&rc_path, new_content.as_bytes())
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

fn parse_export_line(line: &str) -> Option<(String, String)> {
    let rest = line.trim().strip_prefix("export ")?;
    let (key, val_raw) = rest.split_once('=')?;
    let key = key.trim();
    if !is_valid_env_key_name(key) {
        return None;
    }
    let val = val_raw
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string();
    Some((key.to_string(), val))
}

fn rebuild_rc_with_managed_block(content: &str, env_map: &HashMap<String, String>) -> String {
    let mut before = Vec::new();
    let mut after = Vec::new();
    let mut state = 0u8; // 0=before, 1=in block, 2=after

    for line in content.lines() {
        match state {
            0 => {
                if line.trim() == MANAGED_ENV_BEGIN {
                    state = 1;
                } else {
                    before.push(line);
                }
            }
            1 => {
                if line.trim() == MANAGED_ENV_END {
                    state = 2;
                }
            }
            _ => {
                after.push(line);
            }
        }
    }

    let mut result = before.join("\n");
    if !env_map.is_empty() {
        if !result.is_empty() && !result.ends_with('\n') {
            result.push('\n');
        }
        result.push_str(MANAGED_ENV_BEGIN);
        result.push('\n');
        let mut keys: Vec<&String> = env_map.keys().collect();
        keys.sort();
        for key in keys {
            result.push_str(&format!("export {}=\"{}\"\n", key, env_map[key]));
        }
        result.push_str(MANAGED_ENV_END);
        result.push('\n');
    }
    if !after.is_empty() {
        result.push_str(&after.join("\n"));
        if !result.ends_with('\n') {
            result.push('\n');
        }
    } else if !result.ends_with('\n') {
        result.push('\n');
    }
    result
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
        let m = model.unwrap_or("gpt-5.6-sol");
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
    let new_format = is_new_profile_format();

    let mut provider_section = format!(
        "[model_providers.{route_id}]\nname = \"{route_id}\"\nbase_url = \"{base_url}\"\nwire_api = \"responses\"\nrequires_openai_auth = false\nhttp_headers = {{ \"x-openai-actor-authorization\" = \"http://coding.tu-zi.com\" }}\n"
    );
    if !env_key.trim().is_empty() {
        provider_section.push_str(&format!("env_key = \"{env_key}\"\n"));
    }

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

fn remove_section(lines: &[String], header: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut skipping = false;
    for line in lines {
        if line.trim() == header {
            skipping = true;
            continue;
        }
        if skipping && line.trim().starts_with('[') {
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
        Some(s) => s.to_string(),
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
    let config_path = get_codex_config_path();
    let cfg_text = config_text_opt.unwrap_or("").to_string();

    if !cfg_text.trim().is_empty() {
        toml::from_str::<toml::Table>(&cfg_text).map_err(|e| AppError::toml(&config_path, e))?;
    }

    write_text_file(&config_path, &cfg_text)
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

fn extract_codex_env_key(config_text: &str) -> Option<String> {
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

fn remove_codex_experimental_bearer_token(config_text: &str) -> Result<String, AppError> {
    if config_text.trim().is_empty() || !config_text.contains("experimental_bearer_token") {
        return Ok(config_text.to_string());
    }

    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    if let Some(provider_id) = active_codex_model_provider_id(&doc) {
        if let Some(provider_table) = doc
            .get_mut("model_providers")
            .and_then(|item| item.as_table_mut())
            .and_then(|table| table.get_mut(provider_id.as_str()))
            .and_then(|item| item.as_table_mut())
        {
            provider_table.remove("experimental_bearer_token");
        }
    }

    doc.as_table_mut().remove("experimental_bearer_token");
    Ok(doc.to_string())
}

pub fn prepare_codex_provider_live_config(
    auth: &Value,
    config_text: &str,
) -> Result<String, AppError> {
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

pub fn inject_codex_unified_session_bucket(config_text: &str) -> Result<String, AppError> {
    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    if active_codex_model_provider_id(&doc).as_deref() == Some(CC_SWITCH_CODEX_MODEL_PROVIDER_ID) {
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
        // tuziswitch 是本应用管理的共享历史桶。旧版本可能已留下同名路由，
        // 切换供应商时必须用当前激活路由刷新它，否则开关虽开启，live 仍停在旧桶。
        model_providers[CC_SWITCH_CODEX_MODEL_PROVIDER_ID] = provider_table;
        rewrite_codex_profile_model_provider_refs(
            &mut doc,
            &active_provider_id,
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
        );
        doc["model_provider"] = toml_edit::value(CC_SWITCH_CODEX_MODEL_PROVIDER_ID);
        return Ok(doc.to_string());
    }

    let existing_unified_conflicts = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|providers| providers.get(CC_SWITCH_CODEX_MODEL_PROVIDER_ID))
        .and_then(|item| item.as_table())
        .is_some_and(|table| !table_matches_codex_unified_official_provider(table));
    if existing_unified_conflicts {
        log::warn!(
            "官方 Codex 配置已存在自定义 [model_providers.{}]，跳过统一会话路由注入以避免激活未知路由",
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID
        );
        return Ok(config_text.to_string());
    }

    doc["model_provider"] = toml_edit::value(CC_SWITCH_CODEX_MODEL_PROVIDER_ID);

    if doc.get("model_providers").is_none() {
        let mut parent = toml_edit::Table::new();
        parent.set_implicit(true);
        doc["model_providers"] = toml_edit::Item::Table(parent);
    }
    if let Some(providers) = doc["model_providers"].as_table_mut() {
        if !providers.contains_key(CC_SWITCH_CODEX_MODEL_PROVIDER_ID) {
            providers.insert(
                CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
                toml_edit::Item::Table(codex_unified_official_provider_table()),
            );
        }
    }
    Ok(doc.to_string())
}

#[allow(dead_code)]
pub fn strip_codex_unified_session_bucket(config_text: &str) -> Result<String, AppError> {
    if !config_text.contains("model_provider") {
        return Ok(config_text.to_string());
    }
    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    if doc.get("model_provider").and_then(|item| item.as_str())
        != Some(CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
    {
        return Ok(config_text.to_string());
    }
    let matches_injected = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|providers| providers.get(CC_SWITCH_CODEX_MODEL_PROVIDER_ID))
        .and_then(|item| item.as_table())
        .is_some_and(table_matches_codex_unified_official_provider);
    if !matches_injected {
        return Ok(config_text.to_string());
    }

    doc.as_table_mut().remove("model_provider");
    let providers_empty = doc["model_providers"]
        .as_table_mut()
        .map(|providers| {
            providers.remove(CC_SWITCH_CODEX_MODEL_PROVIDER_ID);
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
    _category: Option<&str>,
    settings: &mut Value,
) -> Result<(), AppError> {
    if !crate::settings::unify_codex_session_history() {
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
    let token = extract_codex_auth_api_key(auth)
        .or_else(|| extract_codex_env_key(config_text).and_then(|env_key| read_env_key(&env_key)))
        .or_else(|| extract_codex_experimental_bearer_token(config_text));

    match token {
        Some(token) => set_codex_experimental_bearer_token(config_text, &token),
        None => Ok(config_text.to_string()),
    }
}

fn stable_codex_model_provider_id_from_config(config_text: &str) -> Option<String> {
    let doc = config_text.parse::<DocumentMut>().ok()?;
    let provider_id = active_codex_model_provider_id(&doc)?;

    if is_custom_codex_model_provider_id(&provider_id) {
        Some(provider_id)
    } else {
        None
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

fn normalize_codex_live_config_model_provider_with_anchors<'a>(
    config_text: &str,
    anchor_config_texts: impl IntoIterator<Item = &'a str>,
) -> Result<String, AppError> {
    if config_text.trim().is_empty() {
        return Ok(config_text.to_string());
    }

    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    let Some(source_provider_id) = active_codex_model_provider_id(&doc) else {
        return Ok(config_text.to_string());
    };

    let has_source_provider_table = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|table| table.get(source_provider_id.as_str()))
        .is_some();
    if !has_source_provider_table {
        return Ok(config_text.to_string());
    }

    let stable_provider_id = anchor_config_texts
        .into_iter()
        .find_map(stable_codex_model_provider_id_from_config)
        .or_else(|| {
            is_custom_codex_model_provider_id(&source_provider_id)
                .then(|| source_provider_id.clone())
        })
        .unwrap_or_else(|| CC_SWITCH_CODEX_MODEL_PROVIDER_ID.to_string());

    if stable_provider_id == source_provider_id {
        return Ok(config_text.to_string());
    }

    if let Some(model_providers) = doc
        .get_mut("model_providers")
        .and_then(|item| item.as_table_mut())
    {
        let Some(provider_table) = model_providers.remove(source_provider_id.as_str()) else {
            return Ok(config_text.to_string());
        };
        model_providers[stable_provider_id.as_str()] = provider_table;
    }

    rewrite_codex_profile_model_provider_refs(&mut doc, &source_provider_id, &stable_provider_id);
    doc["model_provider"] = toml_edit::value(stable_provider_id.as_str());

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
    let normalized =
        normalize_codex_live_config_model_provider_with_anchors(&config_text, anchors)?;

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

    let restored = restore_codex_backfill_model_provider_id(&config_text, template_config_text)?;
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
            let cleaned_config = remove_codex_experimental_bearer_token(&config_text)?;
            obj.insert("config".to_string(), Value::String(cleaned_config));
            obj.insert("env".to_string(), json!({ "envKey": env_key }));
            obj.insert("auth".to_string(), json!({}));
            return Ok(());
        }

        let cleaned_config = remove_codex_experimental_bearer_token(&config_text)?;
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
            write_codex_live_atomic(auth, Some(config_text))
        }
        None => write_codex_live_atomic(auth, None),
    }
}

pub fn write_codex_live_for_provider(
    category: Option<&str>,
    auth: &Value,
    config_text_opt: Option<&str>,
) -> Result<(), AppError> {
    let unify_codex_session_history = crate::settings::unify_codex_session_history();
    let unified_official_config = if unify_codex_session_history {
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
        if unify_codex_session_history {
            return write_codex_live_atomic(auth, config_text_opt);
        }
        return write_codex_live_atomic_with_stable_provider(auth, config_text_opt);
    }

    let Some(config_text) = config_text_opt else {
        return write_codex_live_config_atomic(None);
    };

    let mut settings = serde_json::Map::new();
    settings.insert("config".to_string(), Value::String(config_text.to_string()));
    let mut settings = Value::Object(settings);
    if !unify_codex_session_history {
        normalize_codex_settings_config_model_provider(&mut settings, None)?;
    }
    let normalized_config = settings
        .get("config")
        .and_then(Value::as_str)
        .unwrap_or(config_text);
    let live_config = prepare_codex_provider_live_config(auth, normalized_config)?;
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
            doc["model_catalog_json"] = toml_edit::value(path.to_string_lossy().as_ref());
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

pub fn write_codex_provider_live_with_catalog(
    settings: &Value,
    category: Option<&str>,
    auth: &Value,
    config_text: Option<&str>,
) -> Result<(), AppError> {
    let prepared_config = config_text
        .map(|text| prepare_codex_config_text_with_model_catalog(settings, text))
        .transpose()?;

    write_codex_live_for_provider(category, auth, prepared_config.as_deref())
}

/// Write Codex live config exactly from the provider template.
///
/// This is used when turning off unified session history: the live config must
/// return to the provider's own `model_provider` instead of reusing the current
/// live history anchor.
pub fn write_codex_provider_live_exact_with_catalog(
    settings: &Value,
    auth: &Value,
    config_text: Option<&str>,
) -> Result<(), AppError> {
    let prepared_config = config_text
        .map(|text| prepare_codex_config_text_with_model_catalog(settings, text))
        .transpose()?;

    match prepared_config.as_deref() {
        Some(config_text) => {
            let live_config = prepare_codex_provider_live_config(auth, config_text)?;
            write_codex_live_atomic(auth, Some(&live_config))
        }
        None => write_codex_live_atomic(auth, None),
    }
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

        let result = inject_codex_unified_session_bucket(input).expect("inject unified bucket");

        let parsed: toml::Value = toml::from_str(&result).expect("parse result");
        assert_eq!(
            parsed
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("tuziswitch")
        );
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("tuziswitch"))
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
    fn prepare_provider_live_config_reads_env_key_and_sets_provider_token() {
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

        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("vendor_alpha"))
                .and_then(|value| value.get("experimental_bearer_token"))
                .and_then(|value| value.as_str()),
            Some("sk-env-test")
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

        assert_eq!(
            parsed
                .get("experimental_bearer_token")
                .and_then(|value| value.as_str()),
            Some("sk-test")
        );
        assert!(parsed.get("model_providers").is_none());
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
}
