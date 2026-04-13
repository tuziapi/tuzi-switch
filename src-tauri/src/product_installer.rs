use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

const CLAUDE_MODIFIED_INSTALL_URL: &str = "https://gaccode.com/claudecode/install";
const CLAUDE_ORIGINAL_PACKAGE: &str = "@anthropic-ai/claude-code";
const CODEX_OPENAI_PACKAGE: &str = "@openai/codex";
const CODEX_GAC_INSTALL_URL: &str = "https://gaccode.com/codex/install";
const GEMINI_OFFICIAL_PACKAGE: &str = "@google/gemini-cli";
const GEMINI_GAC_INSTALL_URL: &str = "https://gaccode.com/gemini/install";
const DEFAULT_MODEL: &str = "gpt-5.4";
const DEFAULT_REASONING: &str = "medium";
const DEFAULT_GEMINI_MODEL: &str = "gemini-2.5-pro";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeRoute {
    pub name: String,
    pub base_url: Option<String>,
    pub has_key: bool,
    pub is_current: bool,
    pub api_key_masked: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeEnvSummary {
    pub anthropic_api_key_masked: Option<String>,
    pub anthropic_base_url: Option<String>,
    pub anthropic_api_token_set: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub current_route: Option<String>,
    pub route_file_exists: bool,
    pub routes: Vec<ClaudeRoute>,
    pub env_summary: ClaudeEnvSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeActionResult {
    pub success: bool,
    pub message: String,
    pub error: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub restart_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexModelSettings {
    pub model: String,
    pub model_reasoning_effort: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexRoute {
    pub name: String,
    pub base_url: Option<String>,
    pub has_key: bool,
    pub is_current: bool,
    pub api_key_masked: Option<String>,
    pub model_settings: CodexModelSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexEnvSummary {
    pub codex_api_key_masked: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub install_type: Option<String>,
    pub current_route: Option<String>,
    pub state_file_exists: bool,
    pub config_file_exists: bool,
    pub routes: Vec<CodexRoute>,
    pub env_summary: CodexEnvSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexActionResult {
    pub success: bool,
    pub message: String,
    pub error: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub restart_required: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiRoute {
    pub name: String,
    pub base_url: Option<String>,
    pub has_key: bool,
    pub is_current: bool,
    pub api_key_masked: Option<String>,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiEnvSummary {
    pub gemini_api_key_masked: Option<String>,
    pub google_gemini_base_url: Option<String>,
    pub gemini_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub install_type: Option<String>,
    pub current_route: Option<String>,
    pub env_file_exists: bool,
    pub settings_file_exists: bool,
    pub routes: Vec<GeminiRoute>,
    pub env_summary: GeminiEnvSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeminiActionResult {
    pub success: bool,
    pub message: String,
    pub error: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub restart_required: bool,
}

#[derive(Debug, Clone)]
struct RouteEntry {
    api_key: Option<String>,
    base_url: Option<String>,
    api_token: Option<String>,
}

#[derive(Debug, Clone)]
struct RouteFileData {
    current_route: Option<String>,
    routes: BTreeMap<String, RouteEntry>,
}

#[derive(Debug, Clone)]
struct InstallState {
    install_type: Option<String>,
    route: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct ConfigRouteEntry {
    base_url: Option<String>,
    model: Option<String>,
    model_reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct ParsedCodexConfig {
    model_provider: Option<String>,
    profile: Option<String>,
    routes: BTreeMap<String, ConfigRouteEntry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConfigSection {
    None,
    ModelProvider,
    Profile,
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法定位用户目录".to_string())
}

fn extended_path() -> String {
    let mut paths = Vec::new();
    #[cfg(not(windows))]
    {
        paths.push("/opt/homebrew/bin".to_string());
        paths.push("/usr/local/bin".to_string());
        paths.push("/usr/bin".to_string());
        paths.push("/bin".to_string());
        if let Some(home) = dirs::home_dir() {
            let home = home.display().to_string();
            paths.push(format!("{home}/.npm-global/bin"));
            paths.push(format!("{home}/Library/pnpm"));
            paths.push(format!("{home}/.pnpm/bin"));
            paths.push(format!("{home}/.yarn/bin"));
            paths.push(format!("{home}/.volta/bin"));
            paths.push(format!("{home}/.asdf/shims"));
        }
    }
    let current = std::env::var("PATH").unwrap_or_default();
    if !current.is_empty() {
        paths.push(current);
    }
    #[cfg(windows)]
    let sep = ";";
    #[cfg(not(windows))]
    let sep = ":";
    paths.join(sep)
}

fn command_exists(command: &str) -> bool {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("where");
        c.arg(command);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.args(["-lc", &format!("command -v {command}")]);
        c
    };
    cmd.env("PATH", extended_path());
    cmd.output().map(|o| o.status.success()).unwrap_or(false)
}

fn command_output(program: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(program);
    cmd.args(args).env("PATH", extended_path());
    let output = cmd.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn run_shell_script(script: &str) -> Result<String, String> {
    #[cfg(windows)]
    let mut command = {
        let mut c = Command::new("cmd");
        c.args(["/C", script]);
        c
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut c = Command::new("bash");
        c.args(["-lc", script]);
        c
    };
    command.env("PATH", extended_path());
    let output: Output = command.output().map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!("命令执行失败: {script}"))
        } else {
            Err(stderr)
        }
    }
}

fn read_file(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

fn write_file(path: &str, content: &str) -> Result<(), String> {
    let file_path = Path::new(path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(file_path, content).map_err(|e| e.to_string())
}

fn mask_key(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    if value.len() <= 8 {
        return "****".to_string();
    }
    format!("{}****{}", &value[0..4], &value[value.len() - 4..])
}

fn get_shell_rc_candidates() -> Vec<String> {
    #[cfg(windows)]
    {
        Vec::new()
    }
    #[cfg(not(windows))]
    {
        match dirs::home_dir() {
            Some(home) => vec![
                format!("{}/.zshrc", home.display()),
                format!("{}/.bashrc", home.display()),
            ],
            None => Vec::new(),
        }
    }
}

fn get_claude_route_file_path() -> Result<String, String> {
    let home = home_dir()?;
    #[cfg(windows)]
    {
        Ok(format!("{}\\.config\\tuzi\\claude_route_status.txt", home.display()))
    }
    #[cfg(not(windows))]
    {
        Ok(format!("{}/.config/tuzi/claude_route_status.txt", home.display()))
    }
}

fn parse_route_file(content: &str) -> RouteFileData {
    let mut current_route = None;
    let mut routes = BTreeMap::new();
    let mut active = None;
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(value) = line.strip_prefix("current_route=") {
            let value = value.trim().to_string();
            if !value.is_empty() {
                current_route = Some(value);
            }
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            let section = line.trim_start_matches('[').trim_end_matches(']').trim();
            if section.is_empty() {
                active = None;
            } else {
                active = Some(section.to_string());
                routes.entry(section.to_string()).or_insert(RouteEntry {
                    api_key: None,
                    base_url: None,
                    api_token: None,
                });
            }
            continue;
        }
        let Some(section) = &active else {
            continue;
        };
        if let Some((key, value)) = line.split_once('=') {
            let entry = routes.entry(section.clone()).or_insert(RouteEntry {
                api_key: None,
                base_url: None,
                api_token: None,
            });
            let parsed = value.trim().to_string();
            match key.trim() {
                "ANTHROPIC_API_KEY" => entry.api_key = if parsed.is_empty() { None } else { Some(parsed) },
                "ANTHROPIC_BASE_URL" => entry.base_url = if parsed.is_empty() { None } else { Some(parsed) },
                "ANTHROPIC_API_TOKEN" => entry.api_token = if parsed.is_empty() { None } else { Some(parsed) },
                _ => {}
            }
        }
    }
    RouteFileData { current_route, routes }
}

fn route_file_to_string(data: &RouteFileData) -> String {
    let mut lines = Vec::new();
    if let Some(current) = &data.current_route {
        lines.push(format!("current_route={current}"));
        lines.push(String::new());
    }
    for (name, route) in &data.routes {
        lines.push(format!("[{name}]"));
        lines.push(format!(
            "ANTHROPIC_API_TOKEN={}",
            route.api_token.clone().unwrap_or_default()
        ));
        lines.push(format!(
            "ANTHROPIC_API_KEY={}",
            route.api_key.clone().unwrap_or_default()
        ));
        lines.push(format!(
            "ANTHROPIC_BASE_URL={}",
            route.base_url.clone().unwrap_or_default()
        ));
        lines.push(String::new());
    }
    lines.join("\n").trim().to_string() + "\n"
}

fn read_route_file() -> RouteFileData {
    let path = get_claude_route_file_path().unwrap_or_default();
    parse_route_file(&read_file(&path).unwrap_or_default())
}

fn write_route_file(data: &RouteFileData) -> Result<(), String> {
    let path = get_claude_route_file_path()?;
    write_file(&path, &route_file_to_string(data))
}

fn apply_claude_env_to_rc(api_key: &str, base_url: &str, api_token: &str) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        let _ = (api_key, base_url, api_token);
        Ok(Vec::new())
    }
    #[cfg(not(windows))]
    {
        let rc_paths = get_shell_rc_candidates();
        if rc_paths.is_empty() {
            return Err("无法定位 shell 配置文件".to_string());
        }
        let mut updated = Vec::new();
        for rc_path in rc_paths {
            let content = read_file(&rc_path).unwrap_or_default();
            let filtered: Vec<String> = content
                .lines()
                .filter(|line| {
                    let trimmed = line.trim_start();
                    !(trimmed.starts_with("export ANTHROPIC_API_TOKEN=")
                        || trimmed.starts_with("export ANTHROPIC_API_KEY=")
                        || trimmed.starts_with("export ANTHROPIC_BASE_URL="))
                })
                .map(|line| line.to_string())
                .collect();
            let mut lines = filtered;
            lines.push(format!("export ANTHROPIC_API_TOKEN=\"{api_token}\""));
            lines.push(format!("export ANTHROPIC_API_KEY=\"{api_key}\""));
            lines.push(format!("export ANTHROPIC_BASE_URL=\"{base_url}\""));
            write_file(&rc_path, &lines.join("\n"))?;
            updated.push(rc_path);
        }
        Ok(updated)
    }
}

fn clear_claude_env_in_rc() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        Ok(Vec::new())
    }
    #[cfg(not(windows))]
    {
        let rc_paths = get_shell_rc_candidates();
        if rc_paths.is_empty() {
            return Err("无法定位 shell 配置文件".to_string());
        }
        let mut updated = Vec::new();
        for rc_path in rc_paths {
            let content = read_file(&rc_path).unwrap_or_default();
            let filtered: Vec<String> = content
                .lines()
                .filter(|line| {
                    let trimmed = line.trim_start();
                    !(trimmed.starts_with("export ANTHROPIC_API_TOKEN=")
                        || trimmed.starts_with("export ANTHROPIC_API_KEY=")
                        || trimmed.starts_with("export ANTHROPIC_BASE_URL="))
                })
                .map(|line| line.to_string())
                .collect();
            write_file(&rc_path, &filtered.join("\n"))?;
            updated.push(rc_path);
        }
        Ok(updated)
    }
}

fn ensure_claude_json_onboarding() -> Result<(), String> {
    let home = home_dir()?;
    #[cfg(windows)]
    let path = format!("{}\\.claude.json", home.display());
    #[cfg(not(windows))]
    let path = format!("{}/.claude.json", home.display());
    let existing = read_file(&path).unwrap_or_else(|_| "{}".to_string());
    let mut parsed: Value = serde_json::from_str(&existing).unwrap_or_else(|_| json!({}));
    if !parsed.is_object() {
        parsed = json!({});
    }
    parsed["hasCompletedOnboarding"] = Value::Bool(true);
    let serialized = serde_json::to_string_pretty(&parsed).map_err(|e| e.to_string())?;
    write_file(&path, &serialized)
}

fn resolve_install_api_key(route_data: &RouteFileData, route_name: &str, provided: Option<String>) -> Option<String> {
    if let Some(value) = provided {
        let trimmed = value.trim().to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    route_data
        .routes
        .get(route_name)
        .and_then(|route| route.api_key.clone())
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok().filter(|v| !v.trim().is_empty()))
}

fn claude_ok(message: &str, stdout: String, restart_required: bool) -> ClaudeActionResult {
    ClaudeActionResult {
        success: true,
        message: message.to_string(),
        error: None,
        stdout,
        stderr: String::new(),
        restart_required,
    }
}

fn claude_err(message: &str, error: String, stdout: String) -> ClaudeActionResult {
    ClaudeActionResult {
        success: false,
        message: message.to_string(),
        error: Some(error.clone()),
        stdout,
        stderr: error,
        restart_required: false,
    }
}

#[tauri::command]
pub async fn get_claudecode_status() -> Result<ClaudeCodeStatus, String> {
    let installed = command_exists("claude");
    let version = if installed {
        command_output("claude", &["--version"]).ok()
    } else {
        None
    };
    let route_path = get_claude_route_file_path()?;
    let route_data = read_route_file();
    let routes = route_data
        .routes
        .iter()
        .map(|(name, route)| {
            let api_key = route.api_key.clone().unwrap_or_default();
            ClaudeRoute {
                name: name.clone(),
                base_url: route.base_url.clone(),
                has_key: !api_key.trim().is_empty(),
                is_current: route_data.current_route.as_deref() == Some(name.as_str()),
                api_key_masked: if api_key.trim().is_empty() {
                    None
                } else {
                    Some(mask_key(api_key.trim()))
                },
            }
        })
        .collect::<Vec<_>>();
    let env_api_key = std::env::var("ANTHROPIC_API_KEY").ok().unwrap_or_default();
    let env_base_url = std::env::var("ANTHROPIC_BASE_URL").ok().unwrap_or_default();
    let env_api_token = std::env::var("ANTHROPIC_API_TOKEN").ok().unwrap_or_default();
    Ok(ClaudeCodeStatus {
        installed,
        version,
        current_route: route_data.current_route,
        route_file_exists: Path::new(&route_path).exists(),
        routes,
        env_summary: ClaudeEnvSummary {
            anthropic_api_key_masked: if env_api_key.trim().is_empty() {
                None
            } else {
                Some(mask_key(env_api_key.trim()))
            },
            anthropic_base_url: if env_base_url.trim().is_empty() {
                None
            } else {
                Some(env_base_url)
            },
            anthropic_api_token_set: !env_api_token.trim().is_empty(),
        },
    })
}

#[tauri::command]
pub async fn install_claudecode(scheme: String, api_key: Option<String>) -> Result<ClaudeActionResult, String> {
    let normalized = scheme.trim().to_uppercase();
    let mut data = read_route_file();
    if normalized == "A" {
        let command = format!("npm install -g {CLAUDE_MODIFIED_INSTALL_URL}");
        let output = match run_shell_script(&command) {
            Ok(v) => v,
            Err(e) => return Ok(claude_err("ClaudeCode 安装失败", e, String::new())),
        };
        data.routes.entry("改版".to_string()).or_insert(RouteEntry {
            api_key: None,
            base_url: None,
            api_token: None,
        });
        data.current_route = Some("改版".to_string());
        write_route_file(&data)?;
        let _ = clear_claude_env_in_rc();
        return Ok(claude_ok(
            "改版 ClaudeCode 安装成功，请重新打开终端后再运行 claude",
            format!("$ {command}\n{output}"),
            true,
        ));
    }
    if normalized != "B" && normalized != "C" {
        return Ok(claude_err(
            "ClaudeCode 安装失败",
            format!("当前仅支持前三种安装方案，收到: {scheme}"),
            String::new(),
        ));
    }
    let (route_name, base_url, success_message) = if normalized == "B" {
        (
            "gaccode",
            "https://gaccode.com/claudecode",
            "原版 ClaudeCode + gaccode Key 安装成功，请重开终端后运行 claude",
        )
    } else {
        (
            "tu-zi",
            "https://api.tu-zi.com",
            "原版 ClaudeCode + 兔子 API Key 安装成功，请重开终端后运行 claude",
        )
    };
    let final_key = match resolve_install_api_key(&data, route_name, api_key) {
        Some(v) => v,
        None => {
            return Ok(claude_err(
                "ClaudeCode 安装失败",
                "安装该线路需要先填写 API Key".to_string(),
                String::new(),
            ))
        }
    };
    let command = format!("npm install -g {CLAUDE_ORIGINAL_PACKAGE}");
    let output = match run_shell_script(&command) {
        Ok(v) => v,
        Err(e) => return Ok(claude_err("ClaudeCode 安装失败", e, String::new())),
    };
    data.routes.insert(
        route_name.to_string(),
        RouteEntry {
            api_key: Some(final_key.clone()),
            base_url: Some(base_url.to_string()),
            api_token: Some(String::new()),
        },
    );
    data.current_route = Some(route_name.to_string());
    write_route_file(&data)?;
    let rc_paths = apply_claude_env_to_rc(&final_key, base_url, "")?;
    ensure_claude_json_onboarding()?;
    let mut logs = vec![format!("$ {command}"), output];
    for path in rc_paths {
        logs.push(format!("已更新环境变量: {path}"));
    }
    Ok(claude_ok(
        success_message,
        logs.join("\n"),
        true,
    ))
}

#[tauri::command]
pub async fn upgrade_claudecode(target_variant: Option<String>) -> Result<ClaudeActionResult, String> {
    let variant = target_variant
        .map(|v| v.trim().to_lowercase())
        .or_else(|| {
            let route_data = read_route_file();
            match route_data.current_route.as_deref() {
                Some("改版") => Some("modified".to_string()),
                Some(_) => Some("original".to_string()),
                None => None,
            }
        })
        .unwrap_or_else(|| "modified".to_string());
    let is_modified = matches!(variant.as_str(), "modified" | "a" | "改版");
    let command = if is_modified {
        format!("npm install -g {CLAUDE_MODIFIED_INSTALL_URL}")
    } else {
        format!("npm install -g {CLAUDE_ORIGINAL_PACKAGE}@latest")
    };
    match run_shell_script(&command) {
        Ok(output) => {
            if is_modified {
                let mut data = read_route_file();
                data.routes.entry("改版".to_string()).or_insert(RouteEntry {
                    api_key: None,
                    base_url: None,
                    api_token: None,
                });
                data.current_route = Some("改版".to_string());
                let _ = write_route_file(&data);
                let _ = clear_claude_env_in_rc();
            }
            Ok(claude_ok(
                if is_modified { "ClaudeCode 改版升级成功" } else { "ClaudeCode 原版升级成功" },
                format!("$ {command}\n{output}"),
                is_modified,
            ))
        }
        Err(e) => Ok(claude_err("ClaudeCode 升级失败", e, String::new())),
    }
}

fn get_codex_dir() -> Result<String, String> {
    let home = home_dir()?;
    #[cfg(windows)]
    {
        Ok(format!("{}\\.codex", home.display()))
    }
    #[cfg(not(windows))]
    {
        Ok(format!("{}/.codex", home.display()))
    }
}

fn get_codex_config_file_path() -> Result<String, String> {
    Ok(format!("{}/config.toml", get_codex_dir()?))
}

fn get_codex_auth_file_path() -> Result<String, String> {
    Ok(format!("{}/auth.json", get_codex_dir()?))
}

fn get_codex_state_file_path() -> Result<String, String> {
    Ok(format!("{}/install_state", get_codex_dir()?))
}

fn get_gemini_dir() -> Result<PathBuf, String> {
    Ok(crate::gemini_config::get_gemini_dir())
}

fn get_gemini_env_file_path() -> Result<String, String> {
    Ok(crate::gemini_config::get_gemini_env_path()
        .to_string_lossy()
        .to_string())
}

fn get_gemini_settings_file_path() -> Result<String, String> {
    Ok(crate::gemini_config::get_gemini_settings_path()
        .to_string_lossy()
        .to_string())
}

fn get_gemini_state_file_path() -> Result<String, String> {
    Ok(format!("{}/install_state", get_gemini_dir()?.display()))
}

fn normalize_install_type(value: &str) -> Option<String> {
    match value.trim().to_lowercase().as_str() {
        "openai" | "gac" => Some(value.trim().to_lowercase()),
        _ => None,
    }
}

fn normalize_gemini_install_type(value: &str) -> Option<String> {
    match value.trim().to_lowercase().as_str() {
        "official" | "gac" => Some(value.trim().to_lowercase()),
        _ => None,
    }
}

fn normalize_gemini_route(value: &str) -> Option<String> {
    match value.trim().to_lowercase().as_str() {
        "tuzi" => Some(value.trim().to_lowercase()),
        "none" | "" => None,
        _ => None,
    }
}

fn gemini_route_base_url(route: &str) -> Option<&'static str> {
    match route {
        "tuzi" => Some("https://api.tu-zi.com"),
        _ => None,
    }
}

fn normalize_route_input(value: &str) -> Option<String> {
    let s = value.trim().to_lowercase();
    if s.is_empty() {
        return None;
    }
    match s.as_str() {
        "gac" | "tuzi" | "codex" => Some(s),
        "tuzi-codex-sub" => Some("codex".to_string()),
        "none" => None,
        _ if !s.is_empty()
            && s.len() <= 48
            && s.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
            && s != "gac"
            && s != "tuzi"
            && s != "codex"
            && s != "tuzi-codex-sub"
            && s != "none" =>
        {
            Some(s)
        }
        _ => None,
    }
}

fn route_base_url(route: &str) -> Option<&'static str> {
    match route {
        "gac" => Some("https://gaccode.com/codex/v1"),
        "tuzi" => Some("https://api.tu-zi.com/v1"),
        "codex" => Some("https://coding.tu-zi.com"),
        _ => None,
    }
}

fn parse_install_state(content: &str) -> InstallState {
    let mut install_type = None;
    let mut route = None;
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(value) = line.strip_prefix("INSTALL_TYPE=") {
            install_type = normalize_install_type(value);
        } else if let Some(value) = line.strip_prefix("ROUTE=") {
            route = normalize_route_input(value);
        }
    }
    InstallState { install_type, route }
}

fn load_install_state() -> InstallState {
    let path = get_codex_state_file_path().unwrap_or_default();
    parse_install_state(&read_file(&path).unwrap_or_default())
}

fn save_install_state(install_type: &str, route: Option<&str>) -> Result<(), String> {
    let install_type = normalize_install_type(install_type)
        .ok_or_else(|| format!("非法安装类型: {install_type}"))?;
    let route_value = match route {
        None | Some("") => "none".to_string(),
        Some(r) => normalize_route_input(r).ok_or_else(|| format!("非法路线: {r}"))?,
    };
    let path = get_codex_state_file_path()?;
    write_file(
        &path,
        &format!("INSTALL_TYPE={install_type}\nROUTE={route_value}\nMANAGED_BY=cc-switch\n"),
    )
}

fn load_gemini_install_state() -> InstallState {
    let path = get_gemini_state_file_path().unwrap_or_default();
    let mut install_type = None;
    let mut route = None;
    for raw in read_file(&path).unwrap_or_default().lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(value) = line.strip_prefix("INSTALL_TYPE=") {
            install_type = normalize_gemini_install_type(value);
        } else if let Some(value) = line.strip_prefix("ROUTE=") {
            route = normalize_gemini_route(value);
        }
    }
    InstallState { install_type, route }
}

fn save_gemini_install_state(install_type: &str, route: Option<&str>) -> Result<(), String> {
    let install_type = normalize_gemini_install_type(install_type)
        .ok_or_else(|| format!("非法安装类型: {install_type}"))?;
    let route_value = match route {
        None | Some("") => "none".to_string(),
        Some(route) => normalize_gemini_route(route).ok_or_else(|| format!("非法路线: {route}"))?,
    };
    let path = get_gemini_state_file_path()?;
    write_file(
        &path,
        &format!("INSTALL_TYPE={install_type}\nROUTE={route_value}\nMANAGED_BY=cc-switch\n"),
    )
}

fn parse_codex_config(content: &str) -> ParsedCodexConfig {
    let mut parsed = ParsedCodexConfig::default();
    let mut section = ConfigSection::None;
    let mut section_route: Option<String> = None;
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = ConfigSection::None;
            section_route = None;
            let section_name = line.trim_start_matches('[').trim_end_matches(']');
            if let Some(route) = section_name.strip_prefix("model_providers.") {
                if let Some(valid_route) = normalize_route_input(route.trim()) {
                    section = ConfigSection::ModelProvider;
                    section_route = Some(valid_route.clone());
                    parsed.routes.entry(valid_route).or_default();
                }
            } else if let Some(route) = section_name.strip_prefix("profiles.") {
                if let Some(valid_route) = normalize_route_input(route.trim()) {
                    section = ConfigSection::Profile;
                    section_route = Some(valid_route.clone());
                    parsed.routes.entry(valid_route).or_default();
                }
            }
            continue;
        }
        if let Some((key, value_raw)) = line.split_once('=') {
            let key = key.trim();
            let value = value_raw.trim().trim_matches('"').to_string();
            if key == "model_provider" {
                parsed.model_provider = normalize_route_input(&value);
                continue;
            }
            if key == "profile" {
                parsed.profile = normalize_route_input(&value);
                continue;
            }
            let Some(route) = &section_route else {
                continue;
            };
            let entry = parsed.routes.entry(route.clone()).or_default();
            match section {
                ConfigSection::ModelProvider => {
                    if key == "base_url" && !value.is_empty() {
                        entry.base_url = Some(value);
                    }
                }
                ConfigSection::Profile => {
                    if key == "model" && !value.is_empty() {
                        entry.model = Some(value);
                    } else if key == "model_reasoning_effort" && !value.is_empty() {
                        entry.model_reasoning_effort = Some(value);
                    }
                }
                ConfigSection::None => {}
            }
        }
    }
    parsed
}

fn read_codex_auth_api_key() -> Option<String> {
    let auth_path = get_codex_auth_file_path().ok()?;
    let content = read_file(&auth_path).ok()?;
    let parsed: Value = serde_json::from_str(&content).ok()?;
    parsed
        .get("OPENAI_API_KEY")
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn write_codex_auth_file(api_key: &str) -> Result<(), String> {
    let auth_path = get_codex_auth_file_path()?;
    let serialized = serde_json::to_string_pretty(&json!({
        "OPENAI_API_KEY": api_key.trim(),
    }))
    .map_err(|e| e.to_string())?;
    write_file(&auth_path, &serialized)
}

fn collect_strip_route_names(merged: &ParsedCodexConfig, existing: &str) -> BTreeSet<String> {
    let mut strip = BTreeSet::new();
    for key in parse_codex_config(existing).routes.keys() {
        strip.insert(key.clone());
    }
    for key in merged.routes.keys() {
        strip.insert(key.clone());
    }
    strip.insert("gac".to_string());
    strip.insert("tuzi".to_string());
    strip.insert("codex".to_string());
    strip.insert("tuzi-codex-sub".to_string());
    strip
}

fn filter_codex_config(existing_content: &str, strip: &BTreeSet<String>) -> String {
    let mut lines = Vec::new();
    let mut skipping = false;
    for raw in existing_content.lines() {
        let trimmed = raw.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            let section = trimmed.trim_start_matches('[').trim_end_matches(']');
            let should_skip = if let Some(name) = section.strip_prefix("model_providers.") {
                strip.contains(name)
            } else if let Some(name) = section.strip_prefix("profiles.") {
                strip.contains(name)
            } else {
                false
            };
            skipping = should_skip;
            if should_skip {
                continue;
            }
        }
        if skipping {
            continue;
        }
        if (trimmed.starts_with("profile") && trimmed.contains('='))
            || (trimmed.starts_with("model_provider") && trimmed.contains('='))
            || (trimmed.starts_with("model_reasoning_effort") && trimmed.contains('='))
            || (trimmed.starts_with("model") && trimmed.contains('='))
            || (trimmed.starts_with("disable_response_storage") && trimmed.contains('='))
        {
            continue;
        }
        lines.push(raw.to_string());
    }
    lines.join("\n").trim().to_string()
}

fn effective_base_url(route: &str, entry: &ConfigRouteEntry) -> Result<String, String> {
    if let Some(url) = &entry.base_url {
        let trimmed = url.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }
    route_base_url(route)
        .map(|s| s.to_string())
        .ok_or_else(|| format!("路线「{route}」缺少 base_url"))
}

fn write_codex_config_merged(merged: &ParsedCodexConfig, profile_route: &str) -> Result<(), String> {
    let normalized_profile = normalize_route_input(profile_route)
        .ok_or_else(|| format!("非法当前路线: {profile_route}"))?;
    if !merged.routes.contains_key(&normalized_profile) {
        return Err(format!("路线「{normalized_profile}」尚未配置"));
    }
    let current_entry = merged
        .routes
        .get(&normalized_profile)
        .ok_or_else(|| format!("路线「{normalized_profile}」尚未配置"))?;
    let current_model = current_entry
        .model
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(DEFAULT_MODEL);
    let current_reasoning = current_entry
        .model_reasoning_effort
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(DEFAULT_REASONING);
    let config_path = get_codex_config_file_path()?;
    let existing = read_file(&config_path).unwrap_or_default();
    let filtered = filter_codex_config(&existing, &collect_strip_route_names(merged, &existing));
    let mut output = format!(
        "profile = \"{normalized_profile}\"\n\nmodel_provider = \"{normalized_profile}\"\nmodel = \"{current_model}\"\nmodel_reasoning_effort = \"{current_reasoning}\"\ndisable_response_storage = true\n\n"
    );
    if !filtered.is_empty() {
        output.push_str(filtered.as_str());
        output.push_str("\n\n");
    }
    for (route, entry) in &merged.routes {
        let base_url = effective_base_url(route, entry)?;
        let model = entry.model.as_deref().filter(|s| !s.trim().is_empty()).unwrap_or(DEFAULT_MODEL);
        let reasoning = entry
            .model_reasoning_effort
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(DEFAULT_REASONING);
        output.push_str(&format!(
            "[model_providers.{route}]\nname = \"{route}\"\nbase_url = \"{base_url}\"\nwire_api = \"responses\"\nrequires_openai_auth = true\n\n[profiles.{route}]\nmodel_provider = \"{route}\"\nmodel = \"{model}\"\nmodel_reasoning_effort = \"{reasoning}\"\napproval_policy = \"on-request\"\n\n"
        ));
    }
    write_file(&config_path, &output)
}

fn apply_codex_env_to_rc(api_key: &str) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        let _ = api_key;
        Ok(Vec::new())
    }
    #[cfg(not(windows))]
    {
        let rc_paths = get_shell_rc_candidates();
        if rc_paths.is_empty() {
            return Err("无法定位 shell 配置文件".to_string());
        }
        let mut updated = Vec::new();
        for rc_path in rc_paths {
            let content = read_file(&rc_path).unwrap_or_default();
            let filtered: Vec<String> = content
                .lines()
                .filter(|line| {
                    let trimmed = line.trim_start();
                    !trimmed.starts_with("export CODEX_API_KEY=")
                        && !trimmed.starts_with("export CODEX_KEY=")
                })
                .map(|line| line.to_string())
                .collect();
            let mut lines = filtered;
            lines.push(format!("export CODEX_API_KEY=\"{api_key}\""));
            lines.push(format!("export CODEX_KEY=\"{api_key}\""));
            write_file(&rc_path, &lines.join("\n"))?;
            updated.push(rc_path);
        }
        Ok(updated)
    }
}

fn resolve_model_settings(
    model: Option<String>,
    reasoning: Option<String>,
    fallback_model: Option<&str>,
    fallback_reasoning: Option<&str>,
) -> CodexModelSettings {
    CodexModelSettings {
        model: model
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .or_else(|| fallback_model.map(|v| v.to_string()))
            .unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        model_reasoning_effort: reasoning
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .or_else(|| fallback_reasoning.map(|v| v.to_string()))
            .unwrap_or_else(|| DEFAULT_REASONING.to_string()),
    }
}

fn configure_openai_route(
    route: &str,
    api_key: &str,
    model: Option<String>,
    reasoning: Option<String>,
) -> Result<Vec<String>, String> {
    let normalized_route = normalize_route_input(route).ok_or_else(|| format!("非法路线: {route}"))?;
    if api_key.trim().is_empty() {
        return Err("原版 Codex 安装需要填写 API Key".to_string());
    }
    let config_path = get_codex_config_file_path()?;
    let mut merged = parse_codex_config(&read_file(&config_path).unwrap_or_default());
    merged.routes.entry(normalized_route.clone()).or_default();
    let existing = merged.routes.get(&normalized_route).cloned().unwrap_or_default();
    let settings = resolve_model_settings(
        model,
        reasoning,
        existing.model.as_deref(),
        existing.model_reasoning_effort.as_deref(),
    );
    let entry = merged.routes.get_mut(&normalized_route).unwrap();
    if entry.base_url.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
        entry.base_url = route_base_url(&normalized_route).map(|v| v.to_string());
    }
    if entry.base_url.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
        return Err("当前仅支持内置 gac / tuzi / codex 线路".to_string());
    }
    entry.model = Some(settings.model.clone());
    entry.model_reasoning_effort = Some(settings.model_reasoning_effort.clone());
    merged.profile = Some(normalized_route.clone());
    write_codex_config_merged(&merged, &normalized_route)?;
    write_codex_auth_file(api_key.trim())?;
    let rc_paths = apply_codex_env_to_rc(api_key.trim())?;
    save_install_state("openai", Some(&normalized_route))?;
    let mut logs = vec![
        format!("已写入配置: {}", get_codex_config_file_path()?),
        format!("已写入鉴权: {}", get_codex_auth_file_path()?),
        format!("路线={normalized_route} model={} reasoning={}", settings.model, settings.model_reasoning_effort),
    ];
    for path in rc_paths {
        logs.push(format!("已更新环境变量: {path}"));
    }
    Ok(logs)
}

fn codex_ok(message: &str, stdout: String, restart_required: bool) -> CodexActionResult {
    CodexActionResult {
        success: true,
        message: message.to_string(),
        error: None,
        stdout,
        stderr: String::new(),
        restart_required,
    }
}

fn codex_err(message: &str, error: String, stdout: String) -> CodexActionResult {
    CodexActionResult {
        success: false,
        message: message.to_string(),
        error: Some(error.clone()),
        stdout,
        stderr: error,
        restart_required: false,
    }
}

fn build_codex_routes(current_route: Option<&str>, config: &ParsedCodexConfig, env_api_key: &str) -> Vec<CodexRoute> {
    let mut names = BTreeSet::new();
    names.insert("gac".to_string());
    names.insert("tuzi".to_string());
    names.insert("codex".to_string());
    for key in config.routes.keys() {
        names.insert(key.clone());
    }
    names
        .into_iter()
        .map(|route_name| {
            let config_entry = config.routes.get(&route_name);
            let settings = resolve_model_settings(
                None,
                None,
                config_entry.and_then(|v| v.model.as_deref()),
                config_entry.and_then(|v| v.model_reasoning_effort.as_deref()),
            );
            let is_current = current_route == Some(route_name.as_str());
            let base_url = config_entry
                .and_then(|v| v.base_url.clone())
                .filter(|u| !u.trim().is_empty())
                .or_else(|| route_base_url(&route_name).map(|v| v.to_string()));
            CodexRoute {
                name: route_name.clone(),
                base_url,
                has_key: is_current && !env_api_key.trim().is_empty(),
                is_current,
                api_key_masked: if is_current && !env_api_key.trim().is_empty() {
                    Some(mask_key(env_api_key.trim()))
                } else {
                    None
                },
                model_settings: settings,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn get_codex_status() -> Result<CodexStatus, String> {
    let installed = command_exists("codex");
    let version = if installed {
        command_output("codex", &["--version"]).ok()
    } else {
        None
    };
    let state_path = get_codex_state_file_path()?;
    let config_path = get_codex_config_file_path()?;
    let state = load_install_state();
    let config = parse_codex_config(&read_file(&config_path).unwrap_or_default());
    let current_route = state
        .route
        .clone()
        .or(config.model_provider.clone())
        .or(config.profile.clone());
    let env_api_key = std::env::var("CODEX_API_KEY").ok().unwrap_or_default();
    let env_codex_key = std::env::var("CODEX_KEY").ok().unwrap_or_default();
    let auth_api_key = read_codex_auth_api_key().unwrap_or_default();
    let env_key_effective = if !auth_api_key.trim().is_empty() {
        auth_api_key
    } else if env_api_key.trim().is_empty() {
        env_codex_key
    } else {
        env_api_key
    };
    Ok(CodexStatus {
        installed,
        version,
        install_type: state.install_type.or_else(|| if installed { Some("unknown".to_string()) } else { None }),
        current_route: current_route.clone(),
        state_file_exists: Path::new(&state_path).exists(),
        config_file_exists: Path::new(&config_path).exists(),
        routes: build_codex_routes(current_route.as_deref(), &config, &env_key_effective),
        env_summary: CodexEnvSummary {
            codex_api_key_masked: if env_key_effective.trim().is_empty() {
                None
            } else {
                Some(mask_key(env_key_effective.trim()))
            },
        },
    })
}

#[tauri::command]
pub async fn install_codex(
    variant: String,
    route: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    model_reasoning_effort: Option<String>,
) -> Result<CodexActionResult, String> {
    let normalized_variant = variant.trim().to_lowercase();
    if normalized_variant != "openai" && normalized_variant != "gac" {
        return Ok(codex_err("Codex 安装失败", format!("未知安装类型: {variant}"), String::new()));
    }
    if normalized_variant == "gac" {
        let command = format!("npm install -g {CODEX_GAC_INSTALL_URL}");
        return match run_shell_script(&command) {
            Ok(output) => {
                save_install_state("gac", None)?;
                Ok(codex_ok(
                    "gac 改版 Codex 安装成功",
                    format!("$ {command}\n{output}"),
                    true,
                ))
            }
            Err(e) => Ok(codex_err("Codex 安装失败", e, String::new())),
        };
    }
    let install_command = format!("npm install -g {CODEX_OPENAI_PACKAGE}");
    let install_output = match run_shell_script(&install_command) {
        Ok(v) => v,
        Err(e) => return Ok(codex_err("Codex 安装失败", e, String::new())),
    };
    let selected_route = route.unwrap_or_else(|| "gac".to_string());
    let selected_api_key = api_key.unwrap_or_default();
    let mut logs = vec![format!("$ {install_command}"), install_output];
    match configure_openai_route(&selected_route, &selected_api_key, model, model_reasoning_effort) {
        Ok(route_logs) => {
            logs.extend(route_logs);
            Ok(codex_ok(
                "原版 Codex 安装并配置成功，请重开终端后执行 codex",
                logs.join("\n"),
                true,
            ))
        }
        Err(e) => Ok(codex_err("Codex 安装成功，但路线配置失败", e, logs.join("\n"))),
    }
}

#[tauri::command]
pub async fn upgrade_codex(target_variant: Option<String>) -> Result<CodexActionResult, String> {
    let variant = target_variant
        .map(|v| v.trim().to_lowercase())
        .filter(|v| !v.is_empty())
        .or_else(|| load_install_state().install_type)
        .unwrap_or_else(|| "openai".to_string());
    let command = if variant == "gac" {
        format!("npm install -g {CODEX_GAC_INSTALL_URL}")
    } else {
        format!("npm install -g {CODEX_OPENAI_PACKAGE}@latest")
    };
    match run_shell_script(&command) {
        Ok(output) => Ok(codex_ok(
            "Codex 升级成功",
            format!("$ {command}\n{output}"),
            variant == "gac",
        )),
        Err(e) => Ok(codex_err("Codex 升级失败", e, String::new())),
    }
}

fn gemini_ok(message: &str, stdout: String, restart_required: bool) -> GeminiActionResult {
    GeminiActionResult {
        success: true,
        message: message.to_string(),
        error: None,
        stdout,
        stderr: String::new(),
        restart_required,
    }
}

fn gemini_err(message: &str, error: String, stdout: String) -> GeminiActionResult {
    GeminiActionResult {
        success: false,
        message: message.to_string(),
        error: Some(error.clone()),
        stdout,
        stderr: error,
        restart_required: false,
    }
}

fn infer_gemini_route(base_url: &str) -> Option<String> {
    if base_url.contains("gaccode.com") {
        Some("gac".to_string())
    } else if base_url.contains("api.tu-zi.com") {
        Some("tuzi".to_string())
    } else if !base_url.trim().is_empty() {
        Some("custom".to_string())
    } else {
        None
    }
}

fn build_gemini_routes(
    current_route: Option<&str>,
    env_map: &BTreeMap<String, String>,
) -> Vec<GeminiRoute> {
    ["tuzi"]
        .iter()
        .map(|route_name| {
            let is_current = current_route == Some(*route_name);
            let api_key = env_map.get("GEMINI_API_KEY").cloned().unwrap_or_default();
            let model = env_map
                .get("GEMINI_MODEL")
                .cloned()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_GEMINI_MODEL.to_string());
            GeminiRoute {
                name: route_name.to_string(),
                base_url: gemini_route_base_url(route_name).map(|v| v.to_string()),
                has_key: is_current && !api_key.trim().is_empty(),
                is_current,
                api_key_masked: if is_current && !api_key.trim().is_empty() {
                    Some(mask_key(api_key.trim()))
                } else {
                    None
                },
                model,
            }
        })
        .collect()
}

#[tauri::command]
pub async fn get_gemini_status() -> Result<GeminiStatus, String> {
    let installed = command_exists("gemini");
    // Gemini CLI may touch ~/.gemini runtime files even for `--version`.
    // Avoid blocking the whole quick-access panel on that side effect.
    let version = None;
    let env_path = get_gemini_env_file_path()?;
    let settings_path = get_gemini_settings_file_path()?;
    let state = load_gemini_install_state();
    let env_map = crate::gemini_config::read_gemini_env().map_err(|e| e.to_string())?;
    let env_sorted = env_map.into_iter().collect::<BTreeMap<String, String>>();
    let base_url = env_sorted
        .get("GOOGLE_GEMINI_BASE_URL")
        .cloned()
        .unwrap_or_default();
    let current_route = if state.install_type.as_deref() == Some("gac") {
        None
    } else {
        state
            .route
            .clone()
            .or_else(|| infer_gemini_route(&base_url))
    };
    let api_key = env_sorted.get("GEMINI_API_KEY").cloned().unwrap_or_default();
    let model = env_sorted.get("GEMINI_MODEL").cloned();

    Ok(GeminiStatus {
        installed,
        version,
        install_type: state
            .install_type
            .or_else(|| {
                if installed && Path::new(&env_path).exists() {
                    Some("official".to_string())
                } else {
                    None
                }
            }),
        current_route: current_route.clone(),
        env_file_exists: Path::new(&env_path).exists(),
        settings_file_exists: Path::new(&settings_path).exists(),
        routes: build_gemini_routes(current_route.as_deref(), &env_sorted),
        env_summary: GeminiEnvSummary {
            gemini_api_key_masked: if api_key.trim().is_empty() {
                None
            } else {
                Some(mask_key(api_key.trim()))
            },
            google_gemini_base_url: if base_url.trim().is_empty() {
                None
            } else {
                Some(base_url)
            },
            gemini_model: model.filter(|v| !v.trim().is_empty()),
        },
    })
}

fn configure_gemini_route(
    route: &str,
    api_key: &str,
    model: Option<String>,
) -> Result<Vec<String>, String> {
    let normalized_route =
        normalize_gemini_route(route).ok_or_else(|| format!("非法路线: {route}"))?;
    if api_key.trim().is_empty() {
        return Err("Gemini 路线配置需要填写 API Key".to_string());
    }
    let mut env_map = crate::gemini_config::read_gemini_env().map_err(|e| e.to_string())?;
    env_map.insert(
        "GOOGLE_GEMINI_BASE_URL".to_string(),
        gemini_route_base_url(&normalized_route)
            .ok_or_else(|| format!("路线缺少 base_url: {normalized_route}"))?
            .to_string(),
    );
    env_map.insert("GEMINI_API_KEY".to_string(), api_key.trim().to_string());
    env_map.insert(
        "GEMINI_MODEL".to_string(),
        model
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .unwrap_or_else(|| DEFAULT_GEMINI_MODEL.to_string()),
    );
    crate::gemini_config::write_gemini_env_atomic(&env_map).map_err(|e| e.to_string())?;
    crate::gemini_config::write_packycode_settings().map_err(|e| e.to_string())?;
    save_gemini_install_state("official", Some(&normalized_route))?;

    Ok(vec![
        format!("已写入配置: {}", get_gemini_env_file_path()?),
        format!("已写入设置: {}", get_gemini_settings_file_path()?),
        format!(
            "路线={normalized_route} model={}",
            env_map
                .get("GEMINI_MODEL")
                .cloned()
                .unwrap_or_else(|| DEFAULT_GEMINI_MODEL.to_string())
        ),
    ])
}

#[tauri::command]
pub async fn install_gemini(
    variant: String,
    route: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<GeminiActionResult, String> {
    let normalized_variant = variant.trim().to_lowercase();
    if normalized_variant != "official" && normalized_variant != "gac" {
        return Ok(gemini_err(
            "Gemini 安装失败",
            format!("未知安装类型: {variant}"),
            String::new(),
        ));
    }
    if normalized_variant == "gac" {
        let command = format!("npm install -g {GEMINI_GAC_INSTALL_URL}");
        return match run_shell_script(&command) {
            Ok(output) => {
                save_gemini_install_state("gac", None)?;
                Ok(gemini_ok(
                    "gac 改版 Gemini 安装成功",
                    format!("$ {command}\n{output}"),
                    true,
                ))
            }
            Err(e) => Ok(gemini_err("Gemini 安装失败", e, String::new())),
        };
    }

    let install_command = format!("npm install -g {GEMINI_OFFICIAL_PACKAGE}");
    let install_output = match run_shell_script(&install_command) {
        Ok(v) => v,
        Err(e) => return Ok(gemini_err("Gemini 安装失败", e, String::new())),
    };
    let selected_route = route.unwrap_or_else(|| "tuzi".to_string());
    let selected_api_key = api_key.unwrap_or_default();
    let mut logs = vec![format!("$ {install_command}"), install_output];
    match configure_gemini_route(&selected_route, &selected_api_key, model) {
        Ok(route_logs) => {
            logs.extend(route_logs);
            Ok(gemini_ok(
                "Gemini 安装并配置成功，请重开终端后执行 gemini",
                logs.join("\n"),
                true,
            ))
        }
        Err(e) => Ok(gemini_err("Gemini 安装成功，但路线配置失败", e, logs.join("\n"))),
    }
}

#[tauri::command]
pub async fn upgrade_gemini(target_variant: Option<String>) -> Result<GeminiActionResult, String> {
    let variant = target_variant
        .map(|v| v.trim().to_lowercase())
        .filter(|v| !v.is_empty())
        .or_else(|| load_gemini_install_state().install_type)
        .unwrap_or_else(|| "official".to_string());
    let command = if variant == "gac" {
        format!("npm install -g {GEMINI_GAC_INSTALL_URL}")
    } else {
        format!("npm install -g {GEMINI_OFFICIAL_PACKAGE}@latest")
    };
    match run_shell_script(&command) {
        Ok(output) => Ok(gemini_ok(
            "Gemini 升级成功",
            format!("$ {command}\n{output}"),
            variant == "gac",
        )),
        Err(e) => Ok(gemini_err("Gemini 升级失败", e, String::new())),
    }
}
