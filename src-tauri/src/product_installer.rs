use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::Duration;
use tauri::State;

use crate::{app_config::AppType, provider::Provider, store::AppState};

const CLAUDE_MODIFIED_INSTALL_URL: &str = "https://gaccode.com/claudecode/install";
const CLAUDE_ORIGINAL_PACKAGE: &str = "@anthropic-ai/claude-code";
const CLAUDE_GAC_BASE_URL: &str = "https://gaccode.com/claudecode";
const CLAUDE_TUZI_BASE_URL: &str = "https://api.tu-zi.com";
const CODEX_OPENAI_PACKAGE: &str = "@openai/codex";
const CODEX_GAC_INSTALL_URL: &str = "https://gaccode.com/codex/install";
const GEMINI_OFFICIAL_PACKAGE: &str = "@google/gemini-cli";
const GEMINI_GAC_INSTALL_URL: &str = "https://gaccode.com/gemini/install";
const DEFAULT_MODEL: &str = "gpt-5.4";
const DEFAULT_REASONING: &str = "medium";
const DEFAULT_GEMINI_MODEL: &str = "gemini-2.5-pro";
const CODEX_GAC_RUNTIME_HINT: &str =
    "gac 改版 CLI 已切换完成；首次交互若出现 account/read 或 bootstrap 错误，通常仍需先完成 gac 侧登录或授权。";
const CLAUDE_TUZI_PROVIDER_ID: &str = "tuzi-claude-route";
const CLAUDE_GAC_PROVIDER_ID: &str = "gac-claude-route";
const CLAUDE_CUSTOM_API_KEY_FINGERPRINT_LEN: usize = 20;
const CLAUDE_ORIGINAL_RUNTIME_HINT: &str =
    "若当前 app 或已打开的终端仍继承旧 Claude 环境，请重新打开终端或重启应用后再运行 claude。";

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
pub struct ClaudeSettingsSummary {
    pub anthropic_api_key_masked: Option<String>,
    pub anthropic_base_url: Option<String>,
    pub anthropic_auth_token_set: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeProcessEnvSummary {
    pub anthropic_api_key_masked: Option<String>,
    pub anthropic_base_url: Option<String>,
    pub anthropic_auth_token_set: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeCodeStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub latest_version: Option<String>,
    pub resolved_version: Option<String>,
    pub current_route: Option<String>,
    pub route_file_current_route: Option<String>,
    pub effective_base_url: Option<String>,
    pub resolved_executable_path: Option<String>,
    pub resolved_package_name: Option<String>,
    pub resolved_variant: Option<String>,
    pub variant_conflict: bool,
    pub route_file_exists: bool,
    pub settings_file_exists: bool,
    pub sources_conflict: bool,
    pub process_env_route: Option<String>,
    pub runtime_env_conflict: bool,
    pub routes: Vec<ClaudeRoute>,
    pub env_summary: ClaudeEnvSummary,
    pub settings_summary: ClaudeSettingsSummary,
    pub process_env_summary: ClaudeProcessEnvSummary,
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
    pub latest_version: Option<String>,
    pub resolved_version: Option<String>,
    pub install_type: Option<String>,
    pub current_route: Option<String>,
    pub resolved_executable_path: Option<String>,
    pub resolved_package_name: Option<String>,
    pub resolved_variant: Option<String>,
    pub variant_conflict: bool,
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
    pub latest_version: Option<String>,
    pub resolved_version: Option<String>,
    pub install_type: Option<String>,
    pub current_route: Option<String>,
    pub resolved_executable_path: Option<String>,
    pub resolved_package_name: Option<String>,
    pub resolved_variant: Option<String>,
    pub variant_conflict: bool,
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
    last_original_route: Option<String>,
    last_original_provider_id: Option<String>,
    routes: BTreeMap<String, RouteEntry>,
}

#[derive(Debug, Clone)]
struct InstallState {
    install_type: Option<String>,
    route: Option<String>,
    last_original_route: Option<String>,
    last_original_provider_id: Option<String>,
    install_version: Option<String>,
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

#[derive(Debug, Clone, Default)]
struct ResolvedCliInfo {
    command_path: Option<String>,
    executable_path: Option<String>,
    package_root_path: Option<String>,
    package_name: Option<String>,
    package_version: Option<String>,
}

#[derive(Debug)]
struct VerifiedCliInstall {
    logs: Vec<String>,
}

#[derive(Debug)]
struct CliInstallFailure {
    error: String,
    logs: Vec<String>,
}

#[derive(Debug, Clone)]
enum ClaudeProviderRouteTarget {
    Original {
        route_name: String,
        base_url: Option<String>,
        api_key: String,
    },
    Modified {
        base_url: Option<String>,
        auth_token: String,
    },
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

fn executable_candidates(program: &str, dir: &Path) -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        vec![
            dir.join(format!("{program}.cmd")),
            dir.join(format!("{program}.exe")),
            dir.join(program),
        ]
    }

    #[cfg(not(windows))]
    {
        vec![dir.join(program)]
    }
}

fn find_executable_in_path(program: &str) -> Option<PathBuf> {
    let path = extended_path();
    for dir in std::env::split_paths(&path) {
        for candidate in executable_candidates(program, &dir) {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn resolve_npm_cmd_shim_target(command_path: &Path) -> Option<PathBuf> {
    if !command_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("cmd"))
        .unwrap_or(false)
    {
        return None;
    }

    let command_dir = command_path.parent()?;
    let content = fs::read_to_string(command_path).ok()?;
    let mut quoted = content.split('"').skip(1);
    while let Some(segment) = quoted.next() {
        let normalized = segment.replace('\\', "/");
        let Some(index) = normalized.to_lowercase().find("node_modules/") else {
            let _ = quoted.next();
            continue;
        };
        let suffix = normalized[index + "node_modules/".len()..].trim_matches('/');
        if suffix.is_empty() || !suffix.ends_with(".js") {
            let _ = quoted.next();
            continue;
        }

        let mut target = command_dir.join("node_modules");
        for part in suffix.split('/').filter(|part| !part.is_empty()) {
            target.push(part);
        }
        return Some(target);
    }

    None
}

fn read_package_metadata(executable_path: &Path) -> ResolvedCliInfo {
    let command_path = Some(executable_path.display().to_string());
    let launcher_target = resolve_npm_cmd_shim_target(executable_path)
        .unwrap_or_else(|| executable_path.to_path_buf());
    let resolved =
        fs::canonicalize(&launcher_target).unwrap_or_else(|_| launcher_target.to_path_buf());

    for ancestor in resolved.ancestors().take(8) {
        let package_json_path = ancestor.join("package.json");
        if !package_json_path.is_file() {
            continue;
        }

        let Ok(content) = fs::read_to_string(&package_json_path) else {
            continue;
        };
        let Ok(parsed) = serde_json::from_str::<Value>(&content) else {
            continue;
        };
        let package_name = parsed
            .get("name")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
        let package_version = parsed
            .get("version")
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.to_string());
        if package_name.is_some() || package_version.is_some() {
            return ResolvedCliInfo {
                command_path,
                executable_path: Some(resolved.display().to_string()),
                package_root_path: Some(ancestor.display().to_string()),
                package_name,
                package_version,
            };
        }
    }

    ResolvedCliInfo {
        command_path,
        executable_path: Some(resolved.display().to_string()),
        package_root_path: None,
        package_name: None,
        package_version: None,
    }
}

fn resolve_cli_info(program: &str) -> ResolvedCliInfo {
    find_executable_in_path(program)
        .as_deref()
        .map(read_package_metadata)
        .unwrap_or_default()
}

fn resolve_variant_from_package(
    package_name: Option<&str>,
    official_package: &str,
    original_variant: &str,
    modified_variant: &str,
) -> Option<String> {
    let package_name = package_name
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if package_name == official_package {
        Some(original_variant.to_string())
    } else {
        Some(modified_variant.to_string())
    }
}

fn package_has_files(resolved_cli: &ResolvedCliInfo, files: &[&str]) -> bool {
    let Some(root) = resolved_cli.package_root_path.as_deref() else {
        return false;
    };
    let root = Path::new(root);
    files.iter().all(|file| root.join(file).is_file())
}

fn claude_cli_looks_modified(resolved_cli: &ResolvedCliInfo) -> bool {
    package_has_files(
        resolved_cli,
        &[
            "relay-selector.js",
            "stream-relay-manager.js",
            "stream-relay.cjs",
        ],
    )
}

fn resolve_claude_cli_variant(resolved_cli: &ResolvedCliInfo) -> Option<String> {
    if claude_cli_looks_modified(resolved_cli) {
        return Some("modified".to_string());
    }

    if resolved_cli.package_name.as_deref() == Some(CLAUDE_ORIGINAL_PACKAGE) {
        return Some("original".to_string());
    }

    if resolved_cli.executable_path.is_some() {
        Some("unknown".to_string())
    } else {
        None
    }
}

fn resolve_codex_cli_variant(resolved_cli: &ResolvedCliInfo) -> Option<String> {
    resolve_variant_from_package(
        resolved_cli.package_name.as_deref(),
        CODEX_OPENAI_PACKAGE,
        "openai",
        "gac",
    )
    .or_else(|| {
        if resolved_cli.executable_path.is_some() {
            Some("unknown".to_string())
        } else {
            None
        }
    })
}

fn resolve_gemini_cli_variant(resolved_cli: &ResolvedCliInfo) -> Option<String> {
    resolve_variant_from_package(
        resolved_cli.package_name.as_deref(),
        GEMINI_OFFICIAL_PACKAGE,
        "official",
        "gac",
    )
    .or_else(|| {
        if resolved_cli.executable_path.is_some() {
            Some("unknown".to_string())
        } else {
            None
        }
    })
}

fn gemini_cli_looks_official(resolved_cli: &ResolvedCliInfo) -> bool {
    if resolved_cli.package_name.as_deref() == Some(GEMINI_OFFICIAL_PACKAGE) {
        return true;
    }

    resolved_cli
        .executable_path
        .as_deref()
        .map(|path| path.contains("/@google/gemini-cli/"))
        .unwrap_or(false)
        || resolved_cli
            .command_path
            .as_deref()
            .map(|path| path.contains("/@google/gemini-cli/"))
            .unwrap_or(false)
}

fn resolved_cli_entry_path(resolved_cli: &ResolvedCliInfo) -> String {
    resolved_cli
        .command_path
        .clone()
        .or_else(|| resolved_cli.executable_path.clone())
        .unwrap_or_else(|| "unknown".to_string())
}

fn remove_conflicting_cli_launcher(
    resolved_cli: &ResolvedCliInfo,
    product_name: &str,
) -> Result<Vec<String>, String> {
    let command_path = resolved_cli
        .command_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| format!("无法定位当前 {product_name} launcher 入口"))?;

    let metadata = match fs::symlink_metadata(&command_path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(&command_path).map_err(|e| {
            format!(
                "移除旧 {product_name} launcher 失败 ({}): {e}",
                command_path.display()
            )
        })?;
        Ok(vec![format!(
            "已移除冲突的 {product_name} launcher: {}",
            command_path.display()
        )])
    } else {
        Err(format!(
            "检测到冲突的 {product_name} launcher 入口，但它不是普通文件/符号链接: {}",
            command_path.display()
        ))
    }
}

fn remove_conflicting_claude_original_launcher(
    resolved_cli: &ResolvedCliInfo,
) -> Result<Vec<String>, String> {
    if resolve_claude_cli_variant(resolved_cli).as_deref() == Some("original") {
        return Ok(Vec::new());
    }

    remove_conflicting_cli_launcher(resolved_cli, "ClaudeCode")
}

fn remove_conflicting_codex_launcher(
    resolved_cli: &ResolvedCliInfo,
) -> Result<Vec<String>, String> {
    if resolve_codex_cli_variant(resolved_cli).as_deref() == Some("gac") {
        return Ok(Vec::new());
    }

    remove_conflicting_cli_launcher(resolved_cli, "Codex")
}

fn remove_conflicting_codex_original_launcher(
    resolved_cli: &ResolvedCliInfo,
) -> Result<Vec<String>, String> {
    if resolve_codex_cli_variant(resolved_cli).as_deref() == Some("openai") {
        return Ok(Vec::new());
    }

    remove_conflicting_cli_launcher(resolved_cli, "Codex")
}

fn remove_conflicting_gemini_launcher(
    resolved_cli: &ResolvedCliInfo,
) -> Result<Vec<String>, String> {
    if gemini_cli_looks_official(resolved_cli) {
        return Ok(Vec::new());
    }

    remove_conflicting_cli_launcher(resolved_cli, "Gemini")
}

fn remove_conflicting_gemini_modified_launcher(
    resolved_cli: &ResolvedCliInfo,
) -> Result<Vec<String>, String> {
    if resolve_gemini_cli_variant(resolved_cli).as_deref() == Some("gac") {
        return Ok(Vec::new());
    }

    remove_conflicting_cli_launcher(resolved_cli, "Gemini")
}

fn normalize_saved_provider_id(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("none") {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn app_display_name(app_type: &AppType) -> &'static str {
    match app_type {
        AppType::Claude => "Claude",
        AppType::Codex => "Codex",
        AppType::Gemini => "Gemini",
        AppType::OpenCode => "OpenCode",
        AppType::OpenClaw => "OpenClaw",
    }
}

fn remember_last_original_provider_id(
    existing: Option<String>,
    current: Option<String>,
) -> Option<String> {
    current.or(existing)
}

fn capture_last_original_provider_id(
    state: &AppState,
    app_type: &AppType,
    existing: Option<&str>,
) -> Result<Option<String>, String> {
    let current = crate::settings::get_effective_current_provider(&state.db, app_type)
        .map_err(|e| e.to_string())?;
    Ok(remember_last_original_provider_id(
        existing.map(|value| value.to_string()),
        current,
    ))
}

fn clear_exclusive_current_provider(
    state: &AppState,
    app_type: &AppType,
) -> Result<Vec<String>, String> {
    crate::settings::set_current_provider(app_type, None).map_err(|e| e.to_string())?;
    state
        .db
        .clear_current_provider(app_type.as_str())
        .map_err(|e| e.to_string())?;
    Ok(vec![format!(
        "已清空 {} 当前 provider 状态",
        app_display_name(app_type)
    )])
}

fn restore_exclusive_current_provider(
    state: &AppState,
    app_type: &AppType,
    provider_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut logs = clear_exclusive_current_provider(state, app_type)?;
    let Some(provider_id) = provider_id.filter(|value| !value.trim().is_empty()) else {
        logs.push(format!(
            "{} 当前 provider 保持为空",
            app_display_name(app_type)
        ));
        return Ok(logs);
    };

    let provider_exists = state
        .db
        .get_provider_by_id(provider_id, app_type.as_str())
        .map_err(|e| e.to_string())?
        .is_some();
    if !provider_exists {
        logs.push(format!(
            "未找到上一次使用的 {} provider ({provider_id})，当前 provider 保持为空",
            app_display_name(app_type)
        ));
        return Ok(logs);
    }

    crate::settings::set_current_provider(app_type, Some(provider_id))
        .map_err(|e| e.to_string())?;
    state
        .db
        .set_current_provider(app_type.as_str(), provider_id)
        .map_err(|e| e.to_string())?;
    logs.push(format!(
        "已恢复 {} 当前 provider: {provider_id}",
        app_display_name(app_type)
    ));
    Ok(logs)
}

fn looks_like_launcher_conflict(error: &str) -> bool {
    let normalized = error.trim().to_lowercase();
    normalized.contains("eexist")
        || normalized.contains("already exists")
        || normalized.contains("file exists")
}

fn install_and_verify_cli_variant(
    program: &str,
    install_command: &str,
    expected_variant: &str,
    resolve_variant: fn(&ResolvedCliInfo) -> Option<String>,
    product_name: &str,
    variant_label: &str,
    cleanup_launcher: Option<fn(&ResolvedCliInfo) -> Result<Vec<String>, String>>,
) -> Result<VerifiedCliInstall, CliInstallFailure> {
    let mut logs = Vec::new();
    let mut retried_after_cleanup = false;

    loop {
        logs.push(format!("$ {install_command}"));
        match run_shell_script(install_command) {
            Ok(output) => {
                if !output.trim().is_empty() {
                    logs.push(output);
                }

                let resolved_cli = resolve_cli_info(program);
                if is_variant_compatible(
                    resolve_variant(&resolved_cli).as_deref(),
                    expected_variant,
                ) {
                    return Ok(VerifiedCliInstall { logs });
                }

                if retried_after_cleanup || cleanup_launcher.is_none() {
                    return Err(CliInstallFailure {
                        error: format!(
                            "{product_name} 安装命令已执行，但当前命中的 CLI 仍不是{variant_label}。当前入口: {}",
                            resolved_cli_entry_path(&resolved_cli)
                        ),
                        logs,
                    });
                }

                logs.push(format!(
                    "安装完成，但当前命中的 CLI 仍不是{variant_label}，准备清理冲突 launcher 后重试"
                ));
                let cleanup_fn = cleanup_launcher.expect("cleanup fn checked above");
                match cleanup_fn(&resolved_cli) {
                    Ok(cleanup_logs) => {
                        logs.extend(cleanup_logs);
                        retried_after_cleanup = true;
                    }
                    Err(error) => {
                        return Err(CliInstallFailure { error, logs });
                    }
                }
            }
            Err(error) => {
                if retried_after_cleanup
                    || cleanup_launcher.is_none()
                    || !looks_like_launcher_conflict(&error)
                {
                    return Err(CliInstallFailure { error, logs });
                }

                logs.push(format!(
                    "检测到 {product_name} launcher 冲突，准备清理后重试: {error}"
                ));
                let cleanup_fn = cleanup_launcher.expect("cleanup fn checked above");
                let resolved_cli = resolve_cli_info(program);
                match cleanup_fn(&resolved_cli) {
                    Ok(cleanup_logs) => {
                        logs.extend(cleanup_logs);
                        retried_after_cleanup = true;
                    }
                    Err(cleanup_error) => {
                        return Err(CliInstallFailure {
                            error: cleanup_error,
                            logs,
                        });
                    }
                }
            }
        }
    }
}

fn ensure_gemini_official_command_target() -> Result<Vec<String>, String> {
    let mut logs = Vec::new();
    let resolved_cli = resolve_cli_info("gemini");
    if resolve_gemini_cli_variant(&resolved_cli).as_deref() == Some("official") {
        return Ok(logs);
    }

    logs.extend(remove_conflicting_gemini_launcher(&resolved_cli)?);

    let refreshed = resolve_cli_info("gemini");
    if resolve_gemini_cli_variant(&refreshed).as_deref() == Some("official") {
        if let Some(path) = refreshed.command_path.as_deref() {
            logs.push(format!("Gemini 当前入口已切换为官方版: {path}"));
        }
        return Ok(logs);
    }

    Err(format!(
        "官方 Gemini 已安装，但当前命中的 CLI 仍不是官方版。当前入口: {}",
        resolved_cli_entry_path(&refreshed)
    ))
}

fn extract_version_number(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut current = String::new();
    let mut seen_digit = false;
    let mut dot_count = 0usize;

    for ch in trimmed.chars() {
        if ch.is_ascii_digit() {
            current.push(ch);
            seen_digit = true;
            continue;
        }

        if ch == '.' && seen_digit {
            current.push(ch);
            dot_count += 1;
            continue;
        }

        if seen_digit {
            if dot_count >= 2 {
                break;
            }
            current.clear();
            seen_digit = false;
            dot_count = 0;
        }
    }

    let candidate = current.trim_end_matches('.');
    if candidate.is_empty() || candidate.matches('.').count() < 2 {
        None
    } else {
        Some(candidate.to_string())
    }
}

fn normalized_command_version(program: &str) -> Option<String> {
    command_output(program, &["--version"])
        .ok()
        .and_then(|value| extract_version_number(&value).or(Some(value)))
}

fn get_installed_cli_version_from_resolved(
    resolved_cli: &ResolvedCliInfo,
    program: &str,
    allow_command_fallback: bool,
) -> Option<String> {
    resolved_cli.package_version.clone().or_else(|| {
        if allow_command_fallback {
            normalized_command_version(program)
        } else {
            None
        }
    })
}

fn claude_expected_variant(current_route: Option<&str>) -> Option<&'static str> {
    match current_route {
        Some("改版") => Some("modified"),
        Some(_) => Some("original"),
        None => None,
    }
}

fn codex_expected_variant(
    install_type: Option<&str>,
    current_route: Option<&str>,
) -> Option<&'static str> {
    match install_type {
        Some("gac") => Some("gac"),
        Some("openai") => Some("openai"),
        _ if current_route.is_some() => Some("openai"),
        _ => None,
    }
}

fn gemini_expected_variant(
    install_type: Option<&str>,
    current_route: Option<&str>,
) -> Option<&'static str> {
    match install_type {
        Some("gac") => Some("gac"),
        Some("official") => Some("official"),
        _ if current_route.is_some() => Some("official"),
        _ => None,
    }
}

fn is_variant_compatible(resolved_variant: Option<&str>, target_variant: &str) -> bool {
    matches!(resolved_variant, Some(value) if value == target_variant)
}

fn has_variant_conflict(expected_variant: Option<&str>, resolved_variant: Option<&str>) -> bool {
    match (expected_variant, resolved_variant) {
        (Some(expected), Some(resolved)) => expected != resolved,
        _ => false,
    }
}

async fn fetch_npm_latest_version(package: &str) -> Option<String> {
    let encoded = encode_npm_package_name(package);
    tokio::time::timeout(Duration::from_secs(6), async move {
        if let Some(version) = fetch_npm_latest_version_direct(&encoded).await {
            Some(version)
        } else {
            fetch_npm_latest_version_from_metadata(&encoded).await
        }
    })
    .await
    .ok()
    .flatten()
}

fn encode_npm_package_name(package: &str) -> String {
    package.replace('/', "%2F")
}

fn json_string_field(json: &Value, key: &str) -> Option<String> {
    json.get(key)
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

async fn fetch_npm_latest_version_direct(encoded_package: &str) -> Option<String> {
    let url = format!("https://registry.npmjs.org/{encoded_package}/latest");
    let resp = crate::proxy::http_client::get()
        .get(&url)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let json = resp.json::<Value>().await.ok()?;
    json_string_field(&json, "version")
}

async fn fetch_npm_latest_version_from_metadata(encoded_package: &str) -> Option<String> {
    let url = format!("https://registry.npmjs.org/{encoded_package}");
    let resp = crate::proxy::http_client::get()
        .get(&url)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?;
    let json = resp.json::<Value>().await.ok()?;
    json.get("dist-tags")
        .and_then(|tags| tags.get("latest"))
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

async fn fetch_gac_latest_version(install_url: &str) -> Option<String> {
    tokio::time::timeout(Duration::from_secs(6), async move {
        if let Some(version) =
            fetch_gac_latest_version_with_method(install_url, reqwest::Method::HEAD).await
        {
            Some(version)
        } else {
            fetch_gac_latest_version_with_method(install_url, reqwest::Method::GET).await
        }
    })
    .await
    .ok()
    .flatten()
}

async fn fetch_gac_latest_version_with_method(
    install_url: &str,
    method: reqwest::Method,
) -> Option<String> {
    let resp = crate::proxy::http_client::get()
        .request(method, install_url)
        .send()
        .await
        .ok()?;

    let final_url = resp.url().to_string();
    extract_gac_latest_marker_from_url(&final_url).or_else(|| {
        resp.headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .and_then(extract_gac_latest_marker_from_url)
    })
}

fn extract_gac_latest_marker_from_url(url: &str) -> Option<String> {
    let without_query = url.split('?').next().unwrap_or(url);
    let filename = without_query.rsplit('/').next()?.trim();
    let stem = filename.strip_suffix(".tgz")?;
    let start = stem.find(|ch: char| ch.is_ascii_digit())?;
    let marker = stem[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '.' || *ch == '-')
        .collect::<String>()
        .trim_matches(['.', '-'])
        .to_string();
    if marker.is_empty() {
        None
    } else {
        Some(marker)
    }
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

#[derive(Debug, Clone, Default)]
struct ClaudeShellEnv {
    api_key: Option<String>,
    base_url: Option<String>,
    api_token: Option<String>,
    conflicting: bool,
}

#[derive(Debug, Clone, Default)]
struct ClaudeSettingsSnapshot {
    api_key: Option<String>,
    base_url: Option<String>,
    auth_token: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct ClaudeProcessEnv {
    api_key: Option<String>,
    base_url: Option<String>,
    auth_token: Option<String>,
}

fn parse_export_value(line: &str, prefix: &str) -> Option<String> {
    let value = line.trim_start().strip_prefix(prefix)?.trim();
    let unquoted = value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))
        .unwrap_or(value)
        .trim();
    Some(unquoted.to_string())
}

fn normalize_non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn parse_claude_rc_content(content: &str) -> Option<ClaudeShellEnv> {
    let mut parsed = ClaudeShellEnv::default();
    for raw in content.lines() {
        if let Some(value) = parse_export_value(raw, "export ANTHROPIC_API_KEY=") {
            parsed.api_key = normalize_non_empty(Some(value));
        }
        if let Some(value) = parse_export_value(raw, "export ANTHROPIC_BASE_URL=") {
            parsed.base_url = normalize_non_empty(Some(value));
        }
        if let Some(value) = parse_export_value(raw, "export ANTHROPIC_API_TOKEN=")
            .or_else(|| parse_export_value(raw, "export ANTHROPIC_AUTH_TOKEN="))
        {
            parsed.api_token = normalize_non_empty(Some(value));
        }
    }

    if parsed.api_key.is_none() && parsed.base_url.is_none() && parsed.api_token.is_none() {
        None
    } else {
        Some(parsed)
    }
}

fn read_claude_shell_env() -> ClaudeShellEnv {
    let mut selected: Option<ClaudeShellEnv> = None;
    for rc_path in get_shell_rc_candidates() {
        let Ok(content) = read_file(&rc_path) else {
            continue;
        };
        let Some(current) = parse_claude_rc_content(&content) else {
            continue;
        };
        if let Some(existing) = selected.as_mut() {
            let differs = existing.api_key != current.api_key
                || existing.base_url != current.base_url
                || existing.api_token != current.api_token;
            if differs {
                existing.conflicting = true;
            }
        } else {
            selected = Some(current);
        }
    }
    selected.unwrap_or_default()
}

fn read_claude_settings_snapshot(allow_invalid: bool) -> Result<ClaudeSettingsSnapshot, String> {
    let path = crate::config::get_claude_settings_path();
    if !path.exists() {
        return Ok(ClaudeSettingsSnapshot::default());
    }

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let parsed = match serde_json::from_str::<Value>(&content) {
        Ok(value) => value,
        Err(error) if allow_invalid => {
            log::warn!(
                "无法解析 Claude settings.json，状态读取将忽略该文件: {}",
                error
            );
            return Ok(ClaudeSettingsSnapshot::default());
        }
        Err(error) => return Err(format!("Claude settings.json 解析失败: {error}")),
    };

    let env = parsed.get("env").and_then(Value::as_object);
    Ok(ClaudeSettingsSnapshot {
        api_key: normalize_non_empty(
            env.and_then(|map| map.get("ANTHROPIC_API_KEY"))
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
        ),
        base_url: normalize_non_empty(
            env.and_then(|map| map.get("ANTHROPIC_BASE_URL"))
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
        ),
        auth_token: normalize_non_empty(
            env.and_then(|map| map.get("ANTHROPIC_AUTH_TOKEN"))
                .and_then(Value::as_str)
                .map(|value| value.to_string()),
        ),
    })
}

fn read_claude_process_env() -> ClaudeProcessEnv {
    ClaudeProcessEnv {
        api_key: normalize_non_empty(std::env::var("ANTHROPIC_API_KEY").ok()),
        base_url: normalize_non_empty(std::env::var("ANTHROPIC_BASE_URL").ok()),
        auth_token: normalize_non_empty(
            std::env::var("ANTHROPIC_AUTH_TOKEN")
                .ok()
                .or_else(|| std::env::var("ANTHROPIC_API_TOKEN").ok()),
        ),
    }
}

fn infer_claude_route_from_runtime(
    base_url: Option<&str>,
    has_api_key: bool,
    has_auth_token: bool,
) -> Option<String> {
    let normalized_base_url = base_url.unwrap_or_default().trim().to_lowercase();
    if has_auth_token {
        return Some("改版".to_string());
    }
    if normalized_base_url.contains("gaccode.com/claudecode") {
        return Some("gaccode".to_string());
    }
    if normalized_base_url.contains("api.tu-zi.com") {
        return Some("tu-zi".to_string());
    }
    if !normalized_base_url.is_empty() || has_api_key {
        return Some("custom".to_string());
    }
    None
}

fn normalize_claude_route_for_comparison(route: Option<&str>) -> Option<String> {
    let route = route.map(str::trim).filter(|value| !value.is_empty())?;
    match route {
        "tu-zi" | "gaccode" | "改版" | "custom" => Some(route.to_string()),
        _ => Some("custom".to_string()),
    }
}

fn claude_has_modified_status_context(
    route_file_current_route: Option<&str>,
    resolved_variant: Option<&str>,
    process_env_route: Option<&str>,
) -> bool {
    normalize_claude_route_for_comparison(route_file_current_route).as_deref() == Some("改版")
        && (resolved_variant == Some("modified") || process_env_route == Some("改版"))
}

fn normalize_claude_status_source_route(
    route: Option<&str>,
    treat_gaccode_as_modified: bool,
) -> Option<String> {
    let normalized = normalize_claude_route_for_comparison(route)?;
    if treat_gaccode_as_modified && normalized == "gaccode" {
        return Some("改版".to_string());
    }
    Some(normalized)
}

fn merge_claude_current_route(
    settings_route: Option<&str>,
    shell_route: Option<&str>,
    route_file_current_route: Option<&str>,
    treat_settings_gaccode_as_modified: bool,
) -> Option<String> {
    if normalize_claude_route_for_comparison(route_file_current_route).as_deref() == Some("改版")
        && treat_settings_gaccode_as_modified
    {
        return Some("改版".to_string());
    }

    normalize_claude_status_source_route(settings_route, treat_settings_gaccode_as_modified)
        .or_else(|| shell_route.map(|value| value.to_string()))
        .or_else(|| normalize_claude_route_for_comparison(route_file_current_route))
}

fn claude_sources_are_conflicting(
    route_file_current_route: Option<&str>,
    shell_route: Option<&str>,
    settings_route: Option<&str>,
    shell_conflicting: bool,
    treat_settings_gaccode_as_modified: bool,
) -> bool {
    let mut observed = BTreeSet::new();
    if let Some(route) = normalize_claude_route_for_comparison(route_file_current_route) {
        observed.insert(route);
    }
    if let Some(route) = shell_route {
        observed.insert(route.to_string());
    }
    if let Some(route) =
        normalize_claude_status_source_route(settings_route, treat_settings_gaccode_as_modified)
    {
        observed.insert(route);
    }
    observed.len() > 1 || shell_conflicting
}

fn claude_runtime_env_conflicts(
    current_route: Option<&str>,
    process_env_route: Option<&str>,
    shell_route: Option<&str>,
) -> bool {
    if normalize_claude_route_for_comparison(current_route)
        == normalize_claude_route_for_comparison(shell_route)
    {
        return false;
    }

    match (
        normalize_claude_route_for_comparison(current_route),
        normalize_claude_route_for_comparison(process_env_route),
    ) {
        (Some(current), Some(process)) => current != process,
        (None, Some(_)) => true,
        _ => false,
    }
}

fn is_claude_business_route_provider_id(provider_id: &str, base_provider_id: &str) -> bool {
    provider_id == base_provider_id
        || provider_id
            .strip_prefix(&format!("{base_provider_id}-alt-"))
            .map(|suffix| !suffix.is_empty() && suffix.chars().all(|ch| ch.is_ascii_digit()))
            .unwrap_or(false)
}

fn normalize_provider_env_value(provider: &Provider, key: &str) -> Option<String> {
    normalize_non_empty(
        provider
            .settings_config
            .get("env")
            .and_then(Value::as_object)
            .and_then(|env| env.get(key))
            .and_then(Value::as_str)
            .map(|value| value.to_string()),
    )
}

fn classify_claude_provider_route_target(
    provider_id: &str,
    provider: &Provider,
) -> Result<ClaudeProviderRouteTarget, String> {
    let api_key = normalize_provider_env_value(provider, "ANTHROPIC_API_KEY");
    let auth_token = normalize_provider_env_value(provider, "ANTHROPIC_AUTH_TOKEN")
        .or_else(|| normalize_provider_env_value(provider, "ANTHROPIC_API_TOKEN"));
    let base_url = normalize_provider_env_value(provider, "ANTHROPIC_BASE_URL");

    if let Some(api_key) = api_key {
        let (route_name, route_base_url) =
            if is_claude_business_route_provider_id(provider_id, CLAUDE_GAC_PROVIDER_ID) {
                (
                    "gaccode".to_string(),
                    base_url.or_else(|| Some(CLAUDE_GAC_BASE_URL.to_string())),
                )
            } else if is_claude_business_route_provider_id(provider_id, CLAUDE_TUZI_PROVIDER_ID) {
                (
                    "tu-zi".to_string(),
                    base_url.or_else(|| Some(CLAUDE_TUZI_BASE_URL.to_string())),
                )
            } else {
                (provider_id.to_string(), base_url)
            };

        return Ok(ClaudeProviderRouteTarget::Original {
            route_name,
            base_url: route_base_url,
            api_key,
        });
    }

    if let Some(auth_token) = auth_token {
        return Ok(ClaudeProviderRouteTarget::Modified {
            base_url,
            auth_token,
        });
    }

    Err(format!(
        "Claude provider {provider_id} 缺少 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN，无法收口线路状态"
    ))
}

fn claude_route_name_to_base_url(route_name: &str, data: &RouteFileData) -> Option<String> {
    match route_name {
        "改版" => Some(CLAUDE_GAC_BASE_URL.to_string()),
        "gaccode" => Some(CLAUDE_GAC_BASE_URL.to_string()),
        "tu-zi" => Some(CLAUDE_TUZI_BASE_URL.to_string()),
        other => data
            .routes
            .get(other)
            .and_then(|route| route.base_url.clone())
            .filter(|value| !value.trim().is_empty()),
    }
}

fn get_claude_route_file_path() -> Result<String, String> {
    let home = home_dir()?;
    #[cfg(windows)]
    {
        Ok(format!(
            "{}\\.config\\tuzi\\claude_route_status.txt",
            home.display()
        ))
    }
    #[cfg(not(windows))]
    {
        Ok(format!(
            "{}/.config/tuzi/claude_route_status.txt",
            home.display()
        ))
    }
}

fn parse_route_file(content: &str) -> RouteFileData {
    let mut current_route = None;
    let mut last_original_route = None;
    let mut last_original_provider_id = None;
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
        if let Some(value) = line.strip_prefix("last_original_route=") {
            let value = value.trim().to_string();
            if !value.is_empty() {
                last_original_route = Some(value);
            }
            continue;
        }
        if let Some(value) = line.strip_prefix("last_original_provider_id=") {
            last_original_provider_id = normalize_saved_provider_id(value);
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
                "ANTHROPIC_API_KEY" => {
                    entry.api_key = if parsed.is_empty() {
                        None
                    } else {
                        Some(parsed)
                    }
                }
                "ANTHROPIC_BASE_URL" => {
                    entry.base_url = if parsed.is_empty() {
                        None
                    } else {
                        Some(parsed)
                    }
                }
                "ANTHROPIC_API_TOKEN" => {
                    entry.api_token = if parsed.is_empty() {
                        None
                    } else {
                        Some(parsed)
                    }
                }
                _ => {}
            }
        }
    }
    RouteFileData {
        current_route,
        last_original_route,
        last_original_provider_id,
        routes,
    }
}

fn route_file_to_string(data: &RouteFileData) -> String {
    let mut lines = Vec::new();
    if let Some(current) = &data.current_route {
        lines.push(format!("current_route={current}"));
    }
    if let Some(last_original_route) = &data.last_original_route {
        lines.push(format!("last_original_route={last_original_route}"));
    }
    if let Some(last_original_provider_id) = &data.last_original_provider_id {
        lines.push(format!(
            "last_original_provider_id={last_original_provider_id}"
        ));
    }
    if !lines.is_empty() {
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

fn sync_claude_settings_env(
    base_url: Option<&str>,
    api_key: Option<&str>,
    auth_token: Option<&str>,
    preserve_existing_auth_token: bool,
) -> Result<Vec<String>, String> {
    let path = crate::config::get_claude_settings_path();
    let mut parsed = if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str::<Value>(&content)
            .map_err(|e| format!("Claude settings.json 解析失败: {e}"))?
    } else {
        json!({})
    };
    if !parsed.is_object() {
        parsed = json!({});
    }
    let obj = parsed
        .as_object_mut()
        .ok_or_else(|| "Claude settings.json 不是合法对象".to_string())?;
    if !obj.get("env").map(Value::is_object).unwrap_or(false) {
        obj.insert("env".to_string(), json!({}));
    }
    let env = obj
        .get_mut("env")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "Claude settings.json env 字段不可写".to_string())?;
    if let Some(base_url) = base_url.map(str::trim).filter(|value| !value.is_empty()) {
        env.insert(
            "ANTHROPIC_BASE_URL".to_string(),
            Value::String(base_url.to_string()),
        );
    } else {
        env.remove("ANTHROPIC_BASE_URL");
    }
    if let Some(api_key) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
        env.insert(
            "ANTHROPIC_API_KEY".to_string(),
            Value::String(api_key.to_string()),
        );
    } else {
        env.remove("ANTHROPIC_API_KEY");
    }
    if let Some(auth_token) = auth_token.map(str::trim).filter(|value| !value.is_empty()) {
        env.insert(
            "ANTHROPIC_AUTH_TOKEN".to_string(),
            Value::String(auth_token.to_string()),
        );
    } else if !preserve_existing_auth_token {
        env.remove("ANTHROPIC_AUTH_TOKEN");
    }
    env.remove("ANTHROPIC_API_TOKEN");
    let has_auth_token = env
        .get("ANTHROPIC_AUTH_TOKEN")
        .and_then(Value::as_str)
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    let serialized = serde_json::to_string_pretty(&parsed).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serialized).map_err(|e| e.to_string())?;
    let mut logs = vec![format!("已同步 Claude settings: {}", path.display())];
    if preserve_existing_auth_token && !has_auth_token {
        logs.push("检测到 settings.json 中未保存 ANTHROPIC_AUTH_TOKEN，首次启动改版后可能仍需登录或授权。".to_string());
    }
    Ok(logs)
}

fn sync_claude_settings_for_original(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    sync_claude_settings_env(Some(base_url), Some(api_key), None, false)
}

fn sync_claude_settings_for_modified() -> Result<Vec<String>, String> {
    sync_claude_settings_env(Some(CLAUDE_GAC_BASE_URL), None, None, true)
}

fn resolve_claude_original_restore_target(
    data: &RouteFileData,
) -> Result<(String, String, String), String> {
    let route_name = data
        .last_original_route
        .clone()
        .or_else(|| data.current_route.clone().filter(|route| route != "改版"))
        .unwrap_or_else(|| "tu-zi".to_string());
    let base_url = claude_route_name_to_base_url(&route_name, data)
        .ok_or_else(|| format!("无法解析 Claude 原版回退线路: {route_name}"))?;
    let api_key = resolve_install_api_key(data, &route_name, None)
        .ok_or_else(|| format!("未找到 Claude 原版线路 {route_name} 的 API Key"))?;
    Ok((route_name, base_url, api_key))
}

fn apply_claude_env_to_rc(
    api_key: &str,
    base_url: &str,
    api_token: &str,
) -> Result<Vec<String>, String> {
    sync_claude_env_to_rc(
        Some(api_key),
        Some(base_url),
        (!api_token.trim().is_empty()).then_some(api_token),
    )
}

fn sync_claude_env_to_rc(
    api_key: Option<&str>,
    base_url: Option<&str>,
    api_token: Option<&str>,
) -> Result<Vec<String>, String> {
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
                        || trimmed.starts_with("export ANTHROPIC_AUTH_TOKEN=")
                        || trimmed.starts_with("export ANTHROPIC_API_KEY=")
                        || trimmed.starts_with("export ANTHROPIC_BASE_URL=")
                        || trimmed.starts_with("unset ANTHROPIC_API_TOKEN")
                        || trimmed.starts_with("unset ANTHROPIC_AUTH_TOKEN")
                        || trimmed.starts_with("unset ANTHROPIC_API_KEY")
                        || trimmed.starts_with("unset ANTHROPIC_BASE_URL"))
                })
                .map(|line| line.to_string())
                .collect();
            let mut lines = filtered;
            if api_token.is_none() {
                lines.push("unset ANTHROPIC_API_TOKEN".to_string());
                lines.push("unset ANTHROPIC_AUTH_TOKEN".to_string());
            }
            if api_key.is_none() {
                lines.push("unset ANTHROPIC_API_KEY".to_string());
            }
            if base_url.is_none() {
                lines.push("unset ANTHROPIC_BASE_URL".to_string());
            }
            if let Some(api_token) = api_token.map(str::trim).filter(|value| !value.is_empty()) {
                lines.push(format!("export ANTHROPIC_API_TOKEN=\"{api_token}\""));
                lines.push(format!("export ANTHROPIC_AUTH_TOKEN=\"{api_token}\""));
            }
            if let Some(api_key) = api_key.map(str::trim).filter(|value| !value.is_empty()) {
                lines.push(format!("export ANTHROPIC_API_KEY=\"{api_key}\""));
            }
            if let Some(base_url) = base_url.map(str::trim).filter(|value| !value.is_empty()) {
                lines.push(format!("export ANTHROPIC_BASE_URL=\"{base_url}\""));
            }
            write_file(&rc_path, &lines.join("\n"))?;
            updated.push(rc_path);
        }
        Ok(updated)
    }
}

fn clear_claude_env_in_rc() -> Result<Vec<String>, String> {
    sync_claude_env_to_rc(None, None, None)
}

fn get_claude_json_path() -> Result<PathBuf, String> {
    let home = home_dir()?;
    #[cfg(windows)]
    let path = home.join(".claude.json");
    #[cfg(not(windows))]
    let path = home.join(".claude.json");
    Ok(path)
}

fn claude_custom_api_key_fingerprint(api_key: &str) -> Option<String> {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return None;
    }

    let chars = trimmed.chars().collect::<Vec<_>>();
    let start = chars
        .len()
        .saturating_sub(CLAUDE_CUSTOM_API_KEY_FINGERPRINT_LEN);
    Some(chars[start..].iter().collect())
}

fn json_string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn sync_claude_json_state(api_key: Option<&str>) -> Result<Vec<String>, String> {
    let path = get_claude_json_path()?;
    let existing = read_file(&path.display().to_string()).unwrap_or_else(|_| "{}".to_string());
    let mut parsed: Value = serde_json::from_str(&existing).unwrap_or_else(|_| json!({}));
    if !parsed.is_object() {
        parsed = json!({});
    }
    parsed["hasCompletedOnboarding"] = Value::Bool(true);
    if let Some(fingerprint) = api_key.and_then(claude_custom_api_key_fingerprint) {
        if !parsed
            .get("customApiKeyResponses")
            .map(Value::is_object)
            .unwrap_or(false)
        {
            parsed["customApiKeyResponses"] = json!({});
        }

        let responses = parsed
            .get_mut("customApiKeyResponses")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| "Claude 本地 customApiKeyResponses 字段不可写".to_string())?;

        let mut approved = json_string_array(responses.get("approved"));
        if !approved.iter().any(|value| value == &fingerprint) {
            approved.push(fingerprint.clone());
        }

        let rejected = json_string_array(responses.get("rejected"))
            .into_iter()
            .filter(|value| value != &fingerprint)
            .collect::<Vec<_>>();

        responses.insert(
            "approved".to_string(),
            Value::Array(approved.into_iter().map(Value::String).collect()),
        );
        responses.insert(
            "rejected".to_string(),
            Value::Array(rejected.into_iter().map(Value::String).collect()),
        );
    }

    let serialized = serde_json::to_string_pretty(&parsed).map_err(|e| e.to_string())?;
    write_file(&path.display().to_string(), &serialized)?;

    let mut logs = vec![format!("已同步 Claude 本地状态: {}", path.display())];
    if api_key
        .and_then(claude_custom_api_key_fingerprint)
        .is_some()
    {
        logs.push("已将当前 Claude API Key 标记为本地已批准。".to_string());
    }
    Ok(logs)
}

pub(crate) fn reconcile_claude_provider_switch(
    provider_id: &str,
    provider: &Provider,
    previous_current_provider_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let target = classify_claude_provider_route_target(provider_id, provider)?;
    let mut data = read_route_file();
    let mut logs = Vec::new();

    match target {
        ClaudeProviderRouteTarget::Original {
            route_name,
            base_url,
            api_key,
        } => {
            data.routes.insert(
                route_name.clone(),
                RouteEntry {
                    api_key: Some(api_key.clone()),
                    base_url: base_url.clone(),
                    api_token: None,
                },
            );
            data.current_route = Some(route_name.clone());
            data.last_original_route = Some(route_name.clone());
            data.last_original_provider_id = Some(provider_id.to_string());
            write_route_file(&data)?;
            logs.push(format!("已写入路线文件: {}", get_claude_route_file_path()?));
            logs.push(format!("当前线路={route_name}"));

            let rc_paths = sync_claude_env_to_rc(Some(&api_key), base_url.as_deref(), None)?;
            for path in rc_paths {
                logs.push(format!("已更新环境变量: {path}"));
            }

            logs.extend(sync_claude_settings_env(
                base_url.as_deref(),
                Some(&api_key),
                None,
                false,
            )?);
            logs.extend(sync_claude_json_state(Some(&api_key))?);
        }
        ClaudeProviderRouteTarget::Modified {
            base_url,
            auth_token,
        } => {
            if let Some(current_route) = data.current_route.clone() {
                if current_route != "改版" {
                    data.last_original_route = Some(current_route);
                }
            }
            if let Some(previous_provider_id) = previous_current_provider_id
                .map(str::trim)
                .filter(|value| !value.is_empty() && *value != provider_id)
            {
                data.last_original_provider_id = Some(previous_provider_id.to_string());
            }
            data.routes.insert(
                "改版".to_string(),
                RouteEntry {
                    api_key: None,
                    base_url: base_url.clone(),
                    api_token: Some(auth_token.clone()),
                },
            );
            data.current_route = Some("改版".to_string());
            write_route_file(&data)?;
            logs.push(format!("已写入路线文件: {}", get_claude_route_file_path()?));
            logs.push("当前线路=改版".to_string());

            let rc_paths = sync_claude_env_to_rc(None, base_url.as_deref(), Some(&auth_token))?;
            for path in rc_paths {
                logs.push(format!("已更新环境变量: {path}"));
            }

            logs.extend(sync_claude_settings_env(
                base_url.as_deref(),
                None,
                Some(&auth_token),
                false,
            )?);
        }
    }

    Ok(logs)
}

fn resolve_install_api_key(
    route_data: &RouteFileData,
    route_name: &str,
    provided: Option<String>,
) -> Option<String> {
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
        .or_else(|| {
            std::env::var("ANTHROPIC_API_KEY")
                .ok()
                .filter(|v| !v.trim().is_empty())
        })
}

fn configure_claude_modified_route(data: &mut RouteFileData) -> Result<Vec<String>, String> {
    if let Some(current_route) = data.current_route.clone() {
        if current_route != "改版" {
            data.last_original_route = Some(current_route);
        }
    }
    data.routes.entry("改版".to_string()).or_insert(RouteEntry {
        api_key: None,
        base_url: None,
        api_token: None,
    });
    data.current_route = Some("改版".to_string());
    write_route_file(data)?;
    let cleared_paths = clear_claude_env_in_rc()?;
    let settings_logs = sync_claude_settings_for_modified()?;
    let mut logs = vec![
        format!("已写入路线文件: {}", get_claude_route_file_path()?),
        "当前线路=改版".to_string(),
    ];
    for path in cleared_paths {
        logs.push(format!("已清理环境变量: {path}"));
    }
    logs.extend(settings_logs);
    Ok(logs)
}

fn configure_claude_original_route(
    data: &mut RouteFileData,
    route_name: &str,
    base_url: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    if api_key.trim().is_empty() {
        return Err("该线路需要先填写 API Key".to_string());
    }

    data.routes.insert(
        route_name.to_string(),
        RouteEntry {
            api_key: Some(api_key.trim().to_string()),
            base_url: Some(base_url.to_string()),
            api_token: Some(String::new()),
        },
    );
    data.current_route = Some(route_name.to_string());
    data.last_original_route = Some(route_name.to_string());
    write_route_file(data)?;
    let rc_paths = apply_claude_env_to_rc(api_key.trim(), base_url, "")?;
    let settings_logs = sync_claude_settings_for_original(base_url, api_key.trim())?;
    let claude_json_logs = sync_claude_json_state(Some(api_key.trim()))?;

    let mut logs = vec![
        format!("已写入路线文件: {}", get_claude_route_file_path()?),
        format!("当前线路={route_name} base_url={base_url}"),
    ];
    for path in rc_paths {
        logs.push(format!("已更新环境变量: {path}"));
    }
    logs.extend(settings_logs);
    logs.extend(claude_json_logs);
    Ok(logs)
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
    let resolved_cli = if installed {
        resolve_cli_info("claude")
    } else {
        ResolvedCliInfo::default()
    };
    let version = if installed {
        // Some Claude variants attach side effects to CLI startup.
        // Prefer package metadata to avoid accidentally opening external pages
        // while the quick-access panel is only trying to read status.
        get_installed_cli_version_from_resolved(&resolved_cli, "claude", false)
    } else {
        None
    };
    let route_path = get_claude_route_file_path()?;
    let route_data = read_route_file();
    let shell_env = read_claude_shell_env();
    let process_env = read_claude_process_env();
    let settings_path = crate::config::get_claude_settings_path();
    let settings = read_claude_settings_snapshot(true)?;
    let route_file_current_route = route_data.current_route.clone();
    let shell_route = infer_claude_route_from_runtime(
        shell_env.base_url.as_deref(),
        shell_env.api_key.is_some(),
        shell_env.api_token.is_some(),
    );
    let settings_route = infer_claude_route_from_runtime(
        settings.base_url.as_deref(),
        settings.api_key.is_some(),
        settings.auth_token.is_some(),
    );
    let process_env_route = infer_claude_route_from_runtime(
        process_env.base_url.as_deref(),
        process_env.api_key.is_some(),
        process_env.auth_token.is_some(),
    );
    let resolved_variant = resolve_claude_cli_variant(&resolved_cli);
    let treat_settings_gaccode_as_modified = claude_has_modified_status_context(
        route_file_current_route.as_deref(),
        resolved_variant.as_deref(),
        process_env_route.as_deref(),
    );
    let current_route = merge_claude_current_route(
        settings_route.as_deref(),
        shell_route.as_deref(),
        route_file_current_route.as_deref(),
        treat_settings_gaccode_as_modified,
    );
    let sources_conflict = claude_sources_are_conflicting(
        route_file_current_route.as_deref(),
        shell_route.as_deref(),
        settings_route.as_deref(),
        shell_env.conflicting,
        treat_settings_gaccode_as_modified,
    );
    let effective_base_url = if settings.base_url.is_some() {
        settings.base_url.clone()
    } else if shell_env.base_url.is_some() {
        shell_env.base_url.clone()
    } else {
        current_route
            .as_deref()
            .and_then(|route| claude_route_name_to_base_url(route, &route_data))
            .or_else(|| {
                route_file_current_route
                    .as_deref()
                    .and_then(|route| claude_route_name_to_base_url(route, &route_data))
            })
    };
    let latest_version = match (installed, resolved_variant.as_deref()) {
        (true, Some("original")) => fetch_npm_latest_version(CLAUDE_ORIGINAL_PACKAGE).await,
        (true, Some("modified")) => fetch_gac_latest_version(CLAUDE_MODIFIED_INSTALL_URL).await,
        _ => None,
    };
    let variant_conflict = has_variant_conflict(
        claude_expected_variant(current_route.as_deref()),
        resolved_variant.as_deref(),
    );
    let runtime_env_conflict = claude_runtime_env_conflicts(
        current_route.as_deref(),
        process_env_route.as_deref(),
        shell_route.as_deref(),
    );
    let routes = route_data
        .routes
        .iter()
        .map(|(name, route)| {
            let api_key = route.api_key.clone().unwrap_or_default();
            ClaudeRoute {
                name: name.clone(),
                base_url: route.base_url.clone(),
                has_key: !api_key.trim().is_empty(),
                is_current: route_file_current_route.as_deref() == Some(name.as_str()),
                api_key_masked: if api_key.trim().is_empty() {
                    None
                } else {
                    Some(mask_key(api_key.trim()))
                },
            }
        })
        .collect::<Vec<_>>();
    Ok(ClaudeCodeStatus {
        installed,
        version,
        latest_version,
        resolved_version: resolved_cli.package_version.clone(),
        current_route,
        route_file_current_route,
        effective_base_url,
        resolved_executable_path: resolved_cli.executable_path.clone(),
        resolved_package_name: resolved_cli.package_name.clone(),
        resolved_variant,
        variant_conflict,
        route_file_exists: Path::new(&route_path).exists(),
        settings_file_exists: settings_path.exists(),
        sources_conflict,
        process_env_route,
        runtime_env_conflict,
        routes,
        env_summary: ClaudeEnvSummary {
            anthropic_api_key_masked: shell_env.api_key.as_deref().map(mask_key),
            anthropic_base_url: shell_env.base_url,
            anthropic_api_token_set: shell_env.api_token.is_some(),
        },
        settings_summary: ClaudeSettingsSummary {
            anthropic_api_key_masked: settings.api_key.as_deref().map(mask_key),
            anthropic_base_url: settings.base_url,
            anthropic_auth_token_set: settings.auth_token.is_some(),
        },
        process_env_summary: ClaudeProcessEnvSummary {
            anthropic_api_key_masked: process_env.api_key.as_deref().map(mask_key),
            anthropic_base_url: process_env.base_url,
            anthropic_auth_token_set: process_env.auth_token.is_some(),
        },
    })
}

#[tauri::command]
pub async fn install_claudecode(
    state: State<'_, AppState>,
    scheme: String,
    api_key: Option<String>,
) -> Result<ClaudeActionResult, String> {
    let normalized = scheme.trim().to_uppercase();
    let mut data = read_route_file();
    let installed = command_exists("claude");
    let resolved_cli = if installed {
        resolve_cli_info("claude")
    } else {
        ResolvedCliInfo::default()
    };
    let resolved_variant = resolve_claude_cli_variant(&resolved_cli);
    if normalized == "A" {
        let remembered_provider_id = capture_last_original_provider_id(
            state.inner(),
            &AppType::Claude,
            data.last_original_provider_id.as_deref(),
        )?;
        data.last_original_provider_id = remembered_provider_id;
        if installed && is_variant_compatible(resolved_variant.as_deref(), "modified") {
            return match configure_claude_modified_route(&mut data) {
                Ok(mut logs) => {
                    match clear_exclusive_current_provider(state.inner(), &AppType::Claude) {
                        Ok(provider_logs) => {
                            logs.extend(provider_logs);
                            Ok(claude_ok(
                            "检测到已安装 ClaudeCode 改版，仅更新当前配置。如需在已打开的终端中使用，请重新打开终端后再运行 claude",
                            logs.join("\n"),
                            false,
                        ))
                        }
                        Err(error) => Ok(claude_err("ClaudeCode 配置失败", error, logs.join("\n"))),
                    }
                }
                Err(e) => Ok(claude_err("ClaudeCode 配置失败", e, String::new())),
            };
        }
        let command = format!("npm install -g {CLAUDE_MODIFIED_INSTALL_URL}");
        let mut logs = match install_and_verify_cli_variant(
            "claude",
            &command,
            "modified",
            resolve_claude_cli_variant,
            "ClaudeCode",
            "gac 改版",
            None,
        ) {
            Ok(result) => result.logs,
            Err(failure) => {
                return Ok(claude_err(
                    "ClaudeCode 安装失败",
                    failure.error,
                    failure.logs.join("\n"),
                ))
            }
        };
        match configure_claude_modified_route(&mut data) {
            Ok(config_logs) => {
                logs.extend(config_logs);
                match clear_exclusive_current_provider(state.inner(), &AppType::Claude) {
                    Ok(provider_logs) => {
                        logs.extend(provider_logs);
                        return Ok(claude_ok(
                            "改版 ClaudeCode 安装成功，请重新打开终端后再运行 claude",
                            logs.join("\n"),
                            true,
                        ));
                    }
                    Err(error) => {
                        return Ok(claude_err(
                            "ClaudeCode 安装成功，但 provider 状态清理失败",
                            error,
                            logs.join("\n"),
                        ));
                    }
                }
            }
            Err(e) => {
                return Ok(claude_err(
                    "ClaudeCode 安装成功，但配置失败",
                    e,
                    logs.join("\n"),
                ))
            }
        }
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
            CLAUDE_GAC_BASE_URL,
            "原版 ClaudeCode + gaccode Key 安装成功。若当前 app 或已打开的终端仍继承旧 Claude 环境，请重新打开终端或重启应用后再运行 claude。",
        )
    } else {
        (
            "tu-zi",
            CLAUDE_TUZI_BASE_URL,
            "原版 ClaudeCode + 兔子 API Key 安装成功。若当前 app 或已打开的终端仍继承旧 Claude 环境，请重新打开终端或重启应用后再运行 claude。",
        )
    };
    let final_key = match resolve_install_api_key(&data, route_name, api_key) {
        Some(v) => v,
        None => {
            return Ok(claude_err(
                "ClaudeCode 配置失败",
                "该线路需要先填写 API Key".to_string(),
                String::new(),
            ))
        }
    };
    if installed && is_variant_compatible(resolved_variant.as_deref(), "original") {
        return match configure_claude_original_route(&mut data, route_name, base_url, &final_key) {
            Ok(logs) => Ok(claude_ok(
                &format!(
                    "检测到已安装原版 ClaudeCode，仅更新配置。{}",
                    CLAUDE_ORIGINAL_RUNTIME_HINT
                ),
                logs.join("\n"),
                false,
            )),
            Err(e) => Ok(claude_err("ClaudeCode 配置失败", e, String::new())),
        };
    }
    let command = format!("npm install -g {CLAUDE_ORIGINAL_PACKAGE}");
    let mut logs = match install_and_verify_cli_variant(
        "claude",
        &command,
        "original",
        resolve_claude_cli_variant,
        "ClaudeCode",
        "原版",
        None,
    ) {
        Ok(result) => result.logs,
        Err(failure) => {
            return Ok(claude_err(
                "ClaudeCode 安装失败",
                failure.error,
                failure.logs.join("\n"),
            ))
        }
    };
    match configure_claude_original_route(&mut data, route_name, base_url, &final_key) {
        Ok(config_logs) => {
            logs.extend(config_logs);
            Ok(claude_ok(success_message, logs.join("\n"), true))
        }
        Err(e) => Ok(claude_err(
            "ClaudeCode 安装成功，但配置失败",
            e,
            logs.join("\n"),
        )),
    }
}

#[tauri::command]
pub async fn upgrade_claudecode(
    target_variant: Option<String>,
) -> Result<ClaudeActionResult, String> {
    let resolved_cli = resolve_cli_info("claude");
    let resolved_variant = resolve_claude_cli_variant(&resolved_cli);
    let requested = target_variant
        .map(|v| v.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if resolved_variant.as_deref() == Some("modified") {
                "modified".to_string()
            } else {
                "original".to_string()
            }
        });
    if matches!(requested.as_str(), "modified" | "a" | "改版") {
        let command = format!("npm install -g {CLAUDE_MODIFIED_INSTALL_URL}");
        return match run_shell_script(&command) {
            Ok(output) => Ok(claude_ok(
                "ClaudeCode 改版升级成功",
                format!("$ {command}\n{output}"),
                true,
            )),
            Err(e) => Ok(claude_err("ClaudeCode 升级失败", e, String::new())),
        };
    }
    if resolved_variant.as_deref() == Some("modified") {
        return Ok(claude_err(
            "ClaudeCode 升级失败",
            "当前正在使用 gac 改版，无法执行原版升级".to_string(),
            String::new(),
        ));
    }
    let command = format!("npm install -g {CLAUDE_ORIGINAL_PACKAGE}@latest");
    match run_shell_script(&command) {
        Ok(output) => Ok(claude_ok(
            "ClaudeCode 原版升级成功",
            format!("$ {command}\n{output}"),
            true,
        )),
        Err(e) => Ok(claude_err("ClaudeCode 升级失败", e, String::new())),
    }
}

#[tauri::command]
pub async fn switch_claudecode_variant(
    state: State<'_, AppState>,
    target_variant: Option<String>,
) -> Result<ClaudeActionResult, String> {
    let target = target_variant
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "modified".to_string());
    let mut data = read_route_file();
    let installed = command_exists("claude");
    let resolved_cli = if installed {
        resolve_cli_info("claude")
    } else {
        ResolvedCliInfo::default()
    };
    let resolved_variant = resolve_claude_cli_variant(&resolved_cli);

    if matches!(target.as_str(), "modified" | "a" | "改版") {
        let remembered_provider_id = capture_last_original_provider_id(
            state.inner(),
            &AppType::Claude,
            data.last_original_provider_id.as_deref(),
        )?;
        data.last_original_provider_id = remembered_provider_id;
        if installed && is_variant_compatible(resolved_variant.as_deref(), "modified") {
            return match configure_claude_modified_route(&mut data) {
                Ok(mut logs) => {
                    match clear_exclusive_current_provider(state.inner(), &AppType::Claude) {
                        Ok(provider_logs) => {
                            logs.extend(provider_logs);
                            Ok(claude_ok(
                            "当前已在使用 gac 改版 Claude，仅刷新当前配置。如需在已打开的终端中使用，请重新打开终端后再运行 claude",
                            logs.join("\n"),
                            false,
                        ))
                        }
                        Err(error) => Ok(claude_err("ClaudeCode 配置失败", error, logs.join("\n"))),
                    }
                }
                Err(e) => Ok(claude_err("ClaudeCode 配置失败", e, String::new())),
            };
        }

        let command = format!("npm install -g {CLAUDE_MODIFIED_INSTALL_URL}");
        let mut logs = match install_and_verify_cli_variant(
            "claude",
            &command,
            "modified",
            resolve_claude_cli_variant,
            "ClaudeCode",
            "gac 改版",
            None,
        ) {
            Ok(result) => result.logs,
            Err(failure) => {
                return Ok(claude_err(
                    "ClaudeCode 切换失败",
                    failure.error,
                    failure.logs.join("\n"),
                ))
            }
        };
        match configure_claude_modified_route(&mut data) {
            Ok(config_logs) => {
                logs.extend(config_logs);
                match clear_exclusive_current_provider(state.inner(), &AppType::Claude) {
                    Ok(provider_logs) => {
                        logs.extend(provider_logs);
                        Ok(claude_ok(
                            "已切换到 gac 改版 Claude，请重新打开终端后再运行 claude",
                            logs.join("\n"),
                            true,
                        ))
                    }
                    Err(error) => Ok(claude_err(
                        "ClaudeCode 已切换到改版，但 provider 状态清理失败",
                        error,
                        logs.join("\n"),
                    )),
                }
            }
            Err(error) => Ok(claude_err(
                "ClaudeCode 已切换到改版，但配置同步失败",
                error,
                logs.join("\n"),
            )),
        }
    } else {
        let restore_provider_id = data.last_original_provider_id.clone();
        let (route_name, base_url, api_key) = match resolve_claude_original_restore_target(&data) {
            Ok(value) => value,
            Err(error) => return Ok(claude_err("ClaudeCode 切回原版失败", error, String::new())),
        };

        if installed && is_variant_compatible(resolved_variant.as_deref(), "original") {
            return match configure_claude_original_route(
                &mut data,
                &route_name,
                &base_url,
                &api_key,
            ) {
                Ok(mut logs) => match restore_exclusive_current_provider(
                    state.inner(),
                    &AppType::Claude,
                    restore_provider_id.as_deref(),
                ) {
                    Ok(provider_logs) => {
                        logs.extend(provider_logs);
                        Ok(claude_ok(
                            "已退出使用 gac 改版，原版 Claude 线路已恢复。若当前 app 或已打开的终端仍继承旧 Claude 环境，请重新打开终端或重启应用后再运行 claude。",
                            logs.join("\n"),
                            false,
                        ))
                    }
                    Err(error) => Ok(claude_err(
                        "ClaudeCode 原版配置恢复失败",
                        error,
                        logs.join("\n"),
                    )),
                },
                Err(e) => Ok(claude_err("ClaudeCode 原版配置恢复失败", e, String::new())),
            };
        }

        let command = format!("npm install -g {CLAUDE_ORIGINAL_PACKAGE}");
        let mut logs = match install_and_verify_cli_variant(
            "claude",
            &command,
            "original",
            resolve_claude_cli_variant,
            "ClaudeCode",
            "原版",
            Some(remove_conflicting_claude_original_launcher),
        ) {
            Ok(result) => result.logs,
            Err(failure) => {
                return Ok(claude_err(
                    "ClaudeCode 切回原版失败",
                    failure.error,
                    failure.logs.join("\n"),
                ))
            }
        };
        match configure_claude_original_route(&mut data, &route_name, &base_url, &api_key) {
            Ok(config_logs) => {
                logs.extend(config_logs);
                match restore_exclusive_current_provider(
                    state.inner(),
                    &AppType::Claude,
                    restore_provider_id.as_deref(),
                ) {
                    Ok(provider_logs) => {
                        logs.extend(provider_logs);
                        Ok(claude_ok(
                            "已退出使用 gac 改版，原版 Claude 线路已恢复。若当前 app 或已打开的终端仍继承旧 Claude 环境，请重新打开终端或重启应用后再运行 claude。",
                            logs.join("\n"),
                            true,
                        ))
                    }
                    Err(error) => Ok(claude_err(
                        "ClaudeCode 已切回原版，但 provider 恢复失败",
                        error,
                        logs.join("\n"),
                    )),
                }
            }
            Err(error) => Ok(claude_err(
                "ClaudeCode 已切回原版，但原版配置恢复失败",
                error,
                logs.join("\n"),
            )),
        }
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

fn normalize_install_version(value: &str) -> Option<String> {
    let value = value.trim();
    if value.is_empty() || value.eq_ignore_ascii_case("none") {
        None
    } else {
        Some(value.to_string())
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
            && s.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
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
        "codex" => Some("https://api.tu-zi.com/coding"),
        _ => None,
    }
}

fn parse_install_state(content: &str) -> InstallState {
    let mut install_type = None;
    let mut route = None;
    let mut last_original_route = None;
    let mut last_original_provider_id = None;
    let mut install_version = None;
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(value) = line.strip_prefix("INSTALL_TYPE=") {
            install_type = normalize_install_type(value);
        } else if let Some(value) = line.strip_prefix("ROUTE=") {
            route = normalize_route_input(value);
        } else if let Some(value) = line.strip_prefix("LAST_ORIGINAL_ROUTE=") {
            last_original_route = normalize_route_input(value);
        } else if let Some(value) = line.strip_prefix("LAST_ORIGINAL_PROVIDER_ID=") {
            last_original_provider_id = normalize_saved_provider_id(value);
        } else if let Some(value) = line.strip_prefix("INSTALL_VERSION=") {
            install_version = normalize_install_version(value);
        }
    }
    InstallState {
        install_type,
        route,
        last_original_route,
        last_original_provider_id,
        install_version,
    }
}

fn load_install_state() -> InstallState {
    let path = get_codex_state_file_path().unwrap_or_default();
    parse_install_state(&read_file(&path).unwrap_or_default())
}

fn save_install_state(
    install_type: &str,
    route: Option<&str>,
    last_original_provider_id: Option<&str>,
) -> Result<(), String> {
    save_install_state_with_version(install_type, route, last_original_provider_id, None)
}

fn save_install_state_with_version(
    install_type: &str,
    route: Option<&str>,
    last_original_provider_id: Option<&str>,
    install_version: Option<&str>,
) -> Result<(), String> {
    let install_type = normalize_install_type(install_type)
        .ok_or_else(|| format!("非法安装类型: {install_type}"))?;
    let route_value = match route {
        None | Some("") => "none".to_string(),
        Some(r) => normalize_route_input(r).ok_or_else(|| format!("非法路线: {r}"))?,
    };
    let existing = load_install_state();
    let last_original_route = if install_type == "openai" {
        normalize_route_input(&route_value)
    } else {
        existing
            .route
            .clone()
            .or(existing.last_original_route.clone())
    };
    let last_original_provider_id = remember_last_original_provider_id(
        existing.last_original_provider_id.clone(),
        last_original_provider_id.and_then(normalize_saved_provider_id),
    );
    let install_version = if install_type == "gac" {
        install_version
            .and_then(normalize_install_version)
            .or(existing.install_version)
    } else {
        None
    };
    let path = get_codex_state_file_path()?;
    let install_version_line = install_version
        .map(|value| format!("INSTALL_VERSION={value}\n"))
        .unwrap_or_default();
    write_file(
        &path,
        &format!(
            "INSTALL_TYPE={install_type}\nROUTE={route_value}\nLAST_ORIGINAL_ROUTE={}\nLAST_ORIGINAL_PROVIDER_ID={}\n{install_version_line}MANAGED_BY=cc-switch\n",
            last_original_route.unwrap_or_else(|| "none".to_string()),
            last_original_provider_id.unwrap_or_else(|| "none".to_string())
        ),
    )
}

fn load_gemini_install_state() -> InstallState {
    let path = get_gemini_state_file_path().unwrap_or_default();
    let mut install_type = None;
    let mut route = None;
    let mut last_original_route = None;
    let mut last_original_provider_id = None;
    let mut install_version = None;
    for raw in read_file(&path).unwrap_or_default().lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(value) = line.strip_prefix("INSTALL_TYPE=") {
            install_type = normalize_gemini_install_type(value);
        } else if let Some(value) = line.strip_prefix("ROUTE=") {
            route = normalize_gemini_route(value);
        } else if let Some(value) = line.strip_prefix("LAST_ORIGINAL_ROUTE=") {
            last_original_route = normalize_gemini_route(value);
        } else if let Some(value) = line.strip_prefix("LAST_ORIGINAL_PROVIDER_ID=") {
            last_original_provider_id = normalize_saved_provider_id(value);
        } else if let Some(value) = line.strip_prefix("INSTALL_VERSION=") {
            install_version = normalize_install_version(value);
        }
    }
    InstallState {
        install_type,
        route,
        last_original_route,
        last_original_provider_id,
        install_version,
    }
}

fn save_gemini_install_state(
    install_type: &str,
    route: Option<&str>,
    last_original_provider_id: Option<&str>,
) -> Result<(), String> {
    save_gemini_install_state_with_version(install_type, route, last_original_provider_id, None)
}

fn save_gemini_install_state_with_version(
    install_type: &str,
    route: Option<&str>,
    last_original_provider_id: Option<&str>,
    install_version: Option<&str>,
) -> Result<(), String> {
    let install_type = normalize_gemini_install_type(install_type)
        .ok_or_else(|| format!("非法安装类型: {install_type}"))?;
    let route_value = match route {
        None | Some("") => "none".to_string(),
        Some(route) => normalize_gemini_route(route).ok_or_else(|| format!("非法路线: {route}"))?,
    };
    let existing = load_gemini_install_state();
    let last_original_route = if install_type == "official" {
        normalize_gemini_route(&route_value)
    } else {
        existing
            .route
            .clone()
            .or(existing.last_original_route.clone())
    };
    let last_original_provider_id = remember_last_original_provider_id(
        existing.last_original_provider_id.clone(),
        last_original_provider_id.and_then(normalize_saved_provider_id),
    );
    let install_version = if install_type == "gac" {
        install_version
            .and_then(normalize_install_version)
            .or(existing.install_version)
    } else {
        None
    };
    let path = get_gemini_state_file_path()?;
    let install_version_line = install_version
        .map(|value| format!("INSTALL_VERSION={value}\n"))
        .unwrap_or_default();
    write_file(
        &path,
        &format!(
            "INSTALL_TYPE={install_type}\nROUTE={route_value}\nLAST_ORIGINAL_ROUTE={}\nLAST_ORIGINAL_PROVIDER_ID={}\n{install_version_line}MANAGED_BY=cc-switch\n",
            last_original_route.unwrap_or_else(|| "none".to_string()),
            last_original_provider_id.unwrap_or_else(|| "none".to_string())
        ),
    )
}

fn resolve_codex_original_restore_route() -> String {
    let state = load_install_state();
    state
        .last_original_route
        .or(state.route)
        .unwrap_or_else(|| "tuzi".to_string())
}

fn resolve_gemini_original_restore_route() -> String {
    let state = load_gemini_install_state();
    state
        .last_original_route
        .or(state.route)
        .unwrap_or_else(|| "tuzi".to_string())
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

fn write_codex_config_merged(
    merged: &ParsedCodexConfig,
    profile_route: &str,
) -> Result<(), String> {
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
        let model = entry
            .model
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or(DEFAULT_MODEL);
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
    let normalized_route =
        normalize_route_input(route).ok_or_else(|| format!("非法路线: {route}"))?;
    if api_key.trim().is_empty() {
        return Err("原版 Codex 安装需要填写 API Key".to_string());
    }
    let config_path = get_codex_config_file_path()?;
    let mut merged = parse_codex_config(&read_file(&config_path).unwrap_or_default());
    merged.routes.entry(normalized_route.clone()).or_default();
    let existing = merged
        .routes
        .get(&normalized_route)
        .cloned()
        .unwrap_or_default();
    let settings = resolve_model_settings(
        model,
        reasoning,
        existing.model.as_deref(),
        existing.model_reasoning_effort.as_deref(),
    );
    let entry = merged.routes.get_mut(&normalized_route).unwrap();
    if entry
        .base_url
        .as_ref()
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        entry.base_url = route_base_url(&normalized_route).map(|v| v.to_string());
    }
    if entry
        .base_url
        .as_ref()
        .map(|s| s.trim().is_empty())
        .unwrap_or(true)
    {
        return Err("当前仅支持内置 gac / tuzi / codex 线路".to_string());
    }
    entry.model = Some(settings.model.clone());
    entry.model_reasoning_effort = Some(settings.model_reasoning_effort.clone());
    merged.profile = Some(normalized_route.clone());
    write_codex_config_merged(&merged, &normalized_route)?;
    write_codex_auth_file(api_key.trim())?;
    let rc_paths = apply_codex_env_to_rc(api_key.trim())?;
    save_install_state("openai", Some(&normalized_route), None)?;
    let mut logs = vec![
        format!("已写入配置: {}", get_codex_config_file_path()?),
        format!("已写入鉴权: {}", get_codex_auth_file_path()?),
        format!(
            "路线={normalized_route} model={} reasoning={}",
            settings.model, settings.model_reasoning_effort
        ),
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

fn build_codex_routes(
    current_route: Option<&str>,
    config: &ParsedCodexConfig,
    env_api_key: &str,
) -> Vec<CodexRoute> {
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
    let resolved_cli = if installed {
        resolve_cli_info("codex")
    } else {
        ResolvedCliInfo::default()
    };
    let version = if installed {
        get_installed_cli_version_from_resolved(&resolved_cli, "codex", true)
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
    let resolved_variant = resolve_codex_cli_variant(&resolved_cli);
    let latest_version = match (installed, resolved_variant.as_deref()) {
        (true, Some("openai")) => fetch_npm_latest_version(CODEX_OPENAI_PACKAGE).await,
        (true, Some("gac")) => fetch_gac_latest_version(CODEX_GAC_INSTALL_URL).await,
        _ => None,
    };
    let status_version = if resolved_variant.as_deref() == Some("gac") {
        state.install_version.clone().or_else(|| version.clone())
    } else {
        version.clone()
    };
    let variant_conflict = has_variant_conflict(
        codex_expected_variant(state.install_type.as_deref(), current_route.as_deref()),
        resolved_variant.as_deref(),
    );
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
        version: status_version,
        latest_version,
        resolved_version: resolved_cli.package_version.clone(),
        install_type: state
            .install_type
            .or_else(|| resolved_variant.clone())
            .or_else(|| {
                if installed {
                    Some("unknown".to_string())
                } else {
                    None
                }
            }),
        current_route: current_route.clone(),
        resolved_executable_path: resolved_cli.executable_path.clone(),
        resolved_package_name: resolved_cli.package_name.clone(),
        resolved_variant,
        variant_conflict,
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
    state: State<'_, AppState>,
    variant: String,
    route: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    model_reasoning_effort: Option<String>,
) -> Result<CodexActionResult, String> {
    let normalized_variant = variant.trim().to_lowercase();
    let installed = command_exists("codex");
    let resolved_cli = if installed {
        resolve_cli_info("codex")
    } else {
        ResolvedCliInfo::default()
    };
    let resolved_variant = resolve_codex_cli_variant(&resolved_cli);
    let current_state = load_install_state();
    if normalized_variant != "openai" && normalized_variant != "gac" {
        return Ok(codex_err(
            "Codex 安装失败",
            format!("未知安装类型: {variant}"),
            String::new(),
        ));
    }
    if normalized_variant == "gac" {
        let remembered_provider_id = capture_last_original_provider_id(
            state.inner(),
            &AppType::Codex,
            current_state.last_original_provider_id.as_deref(),
        )?;
        if installed && is_variant_compatible(resolved_variant.as_deref(), "gac") {
            let install_version = fetch_gac_latest_version(CODEX_GAC_INSTALL_URL).await;
            save_install_state_with_version(
                "gac",
                None,
                remembered_provider_id.as_deref(),
                install_version.as_deref(),
            )?;
            return match clear_exclusive_current_provider(state.inner(), &AppType::Codex) {
                Ok(provider_logs) => {
                    let mut logs = vec!["已确认安装类型=gac".to_string()];
                    logs.extend(provider_logs);
                    logs.push(CODEX_GAC_RUNTIME_HINT.to_string());
                    Ok(codex_ok(
                        "已确认当前命中的是 gac 改版 Codex CLI。若已打开终端仍使用旧入口，请重新打开终端；首次交互仍可能需要 gac 侧登录或授权。",
                        logs.join("\n"),
                        false,
                    ))
                }
                Err(error) => Ok(codex_err("Codex 安装失败", error, String::new())),
            };
        }
        let command = format!("npm install -g {CODEX_GAC_INSTALL_URL}");
        return match install_and_verify_cli_variant(
            "codex",
            &command,
            "gac",
            resolve_codex_cli_variant,
            "Codex",
            "gac 改版",
            Some(remove_conflicting_codex_launcher),
        ) {
            Ok(mut result) => {
                let install_version = fetch_gac_latest_version(CODEX_GAC_INSTALL_URL).await;
                save_install_state_with_version(
                    "gac",
                    None,
                    remembered_provider_id.as_deref(),
                    install_version.as_deref(),
                )?;
                match clear_exclusive_current_provider(state.inner(), &AppType::Codex) {
                    Ok(provider_logs) => {
                        result.logs.extend(provider_logs);
                        result.logs.push(CODEX_GAC_RUNTIME_HINT.to_string());
                        Ok(codex_ok(
                            "已切换到 gac 改版 Codex CLI。首次交互仍可能需要 gac 侧登录或授权。",
                            result.logs.join("\n"),
                            true,
                        ))
                    }
                    Err(error) => Ok(codex_err(
                        "Codex 安装成功，但 provider 状态清理失败",
                        error,
                        result.logs.join("\n"),
                    )),
                }
            }
            Err(failure) => Ok(codex_err(
                "Codex 安装失败",
                failure.error,
                failure.logs.join("\n"),
            )),
        };
    }
    let selected_route = route.unwrap_or_else(|| "gac".to_string());
    let selected_api_key = api_key.unwrap_or_default();
    if installed && is_variant_compatible(resolved_variant.as_deref(), "openai") {
        return match configure_openai_route(
            &selected_route,
            &selected_api_key,
            model,
            model_reasoning_effort,
        ) {
            Ok(route_logs) => Ok(codex_ok(
                "检测到已安装原版 Codex，仅更新路线配置。如需在已打开的终端中使用，请重新打开终端后再运行 codex",
                route_logs.join("\n"),
                false,
            )),
            Err(e) => Ok(codex_err("Codex 配置失败", e, String::new())),
        };
    }
    let install_command = format!("npm install -g {CODEX_OPENAI_PACKAGE}");
    let mut logs = match install_and_verify_cli_variant(
        "codex",
        &install_command,
        "openai",
        resolve_codex_cli_variant,
        "Codex",
        "原版",
        None,
    ) {
        Ok(result) => result.logs,
        Err(failure) => {
            return Ok(codex_err(
                "Codex 安装失败",
                failure.error,
                failure.logs.join("\n"),
            ))
        }
    };
    match configure_openai_route(
        &selected_route,
        &selected_api_key,
        model,
        model_reasoning_effort,
    ) {
        Ok(route_logs) => {
            logs.extend(route_logs);
            Ok(codex_ok(
                "原版 Codex 安装并配置成功，请重开终端后执行 codex",
                logs.join("\n"),
                true,
            ))
        }
        Err(e) => Ok(codex_err(
            "Codex 安装成功，但路线配置失败",
            e,
            logs.join("\n"),
        )),
    }
}

#[tauri::command]
pub async fn upgrade_codex(target_variant: Option<String>) -> Result<CodexActionResult, String> {
    let variant = target_variant
        .map(|v| v.trim().to_lowercase())
        .filter(|v| !v.is_empty())
        .or_else(|| resolve_codex_cli_variant(&resolve_cli_info("codex")))
        .unwrap_or_else(|| "openai".to_string());
    if variant == "gac" {
        let command = format!("npm install -g {CODEX_GAC_INSTALL_URL}");
        return match run_shell_script(&command) {
            Ok(output) => {
                let current_state = load_install_state();
                let install_version = fetch_gac_latest_version(CODEX_GAC_INSTALL_URL).await;
                save_install_state_with_version(
                    "gac",
                    None,
                    current_state.last_original_provider_id.as_deref(),
                    install_version.as_deref(),
                )?;
                Ok(codex_ok(
                    "Codex 改版升级成功",
                    format!("$ {command}\n{output}\n{CODEX_GAC_RUNTIME_HINT}"),
                    true,
                ))
            }
            Err(e) => Ok(codex_err("Codex 升级失败", e, String::new())),
        };
    }
    let command = format!("npm install -g {CODEX_OPENAI_PACKAGE}@latest");
    match run_shell_script(&command) {
        Ok(output) => Ok(codex_ok(
            "Codex 原版升级成功",
            format!("$ {command}\n{output}"),
            true,
        )),
        Err(e) => Ok(codex_err("Codex 升级失败", e, String::new())),
    }
}

#[tauri::command]
pub async fn switch_codex_variant(
    state: State<'_, AppState>,
    target_variant: Option<String>,
) -> Result<CodexActionResult, String> {
    let target = target_variant
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "gac".to_string());
    let installed = command_exists("codex");
    let resolved_cli = if installed {
        resolve_cli_info("codex")
    } else {
        ResolvedCliInfo::default()
    };
    let resolved_variant = resolve_codex_cli_variant(&resolved_cli);
    let current_state = load_install_state();

    if target == "gac" {
        let remembered_provider_id = capture_last_original_provider_id(
            state.inner(),
            &AppType::Codex,
            current_state.last_original_provider_id.as_deref(),
        )?;
        if installed && is_variant_compatible(resolved_variant.as_deref(), "gac") {
            let install_version = fetch_gac_latest_version(CODEX_GAC_INSTALL_URL).await;
            save_install_state_with_version(
                "gac",
                None,
                remembered_provider_id.as_deref(),
                install_version.as_deref(),
            )?;
            return match clear_exclusive_current_provider(state.inner(), &AppType::Codex) {
                Ok(provider_logs) => {
                    let mut logs = vec!["已确认安装类型=gac".to_string()];
                    logs.extend(provider_logs);
                    logs.push(CODEX_GAC_RUNTIME_HINT.to_string());
                    Ok(codex_ok(
                        "当前已在使用 gac 改版 Codex CLI。若已打开终端仍使用旧入口，请重新打开终端；首次交互仍可能需要 gac 侧登录或授权。",
                        logs.join("\n"),
                        false,
                    ))
                }
                Err(error) => Ok(codex_err("Codex 切换失败", error, String::new())),
            };
        }

        let command = format!("npm install -g {CODEX_GAC_INSTALL_URL}");
        match install_and_verify_cli_variant(
            "codex",
            &command,
            "gac",
            resolve_codex_cli_variant,
            "Codex",
            "gac 改版",
            Some(remove_conflicting_codex_launcher),
        ) {
            Ok(mut result) => {
                let install_version = fetch_gac_latest_version(CODEX_GAC_INSTALL_URL).await;
                save_install_state_with_version(
                    "gac",
                    None,
                    remembered_provider_id.as_deref(),
                    install_version.as_deref(),
                )?;
                match clear_exclusive_current_provider(state.inner(), &AppType::Codex) {
                    Ok(provider_logs) => {
                        result.logs.extend(provider_logs);
                        result.logs.push(CODEX_GAC_RUNTIME_HINT.to_string());
                        Ok(codex_ok(
                            "已切换到 gac 改版 Codex CLI，请重新打开终端后再运行 codex。首次交互仍可能需要 gac 侧登录或授权。",
                            result.logs.join("\n"),
                            true,
                        ))
                    }
                    Err(error) => Ok(codex_err(
                        "Codex 已切换到改版，但 provider 状态清理失败",
                        error,
                        result.logs.join("\n"),
                    )),
                }
            }
            Err(failure) => Ok(codex_err(
                "Codex 切换失败",
                failure.error,
                failure.logs.join("\n"),
            )),
        }
    } else {
        let restore_route = resolve_codex_original_restore_route();
        let restore_provider_id = current_state.last_original_provider_id.clone();
        let restore_api_key = read_codex_auth_api_key().unwrap_or_default();
        if installed && is_variant_compatible(resolved_variant.as_deref(), "openai") {
            return match configure_openai_route(&restore_route, &restore_api_key, None, None) {
                Ok(mut logs) => match restore_exclusive_current_provider(
                    state.inner(),
                    &AppType::Codex,
                    restore_provider_id.as_deref(),
                ) {
                    Ok(provider_logs) => {
                        logs.extend(provider_logs);
                        Ok(codex_ok(
                            "已退出使用 gac 改版，原版 Codex 线路已恢复。如需在已打开的终端中使用，请重新打开终端后再运行 codex",
                            logs.join("\n"),
                            false,
                        ))
                    }
                    Err(error) => Ok(codex_err("Codex 原版配置恢复失败", error, logs.join("\n"))),
                },
                Err(error) => Ok(codex_err("Codex 原版配置恢复失败", error, String::new())),
            };
        }

        let command = format!("npm install -g {CODEX_OPENAI_PACKAGE}");
        let mut logs = match install_and_verify_cli_variant(
            "codex",
            &command,
            "openai",
            resolve_codex_cli_variant,
            "Codex",
            "原版",
            Some(remove_conflicting_codex_original_launcher),
        ) {
            Ok(result) => result.logs,
            Err(failure) => {
                return Ok(codex_err(
                    "Codex 切回原版失败",
                    failure.error,
                    failure.logs.join("\n"),
                ))
            }
        };
        match configure_openai_route(&restore_route, &restore_api_key, None, None) {
            Ok(route_logs) => {
                logs.extend(route_logs);
                match restore_exclusive_current_provider(
                    state.inner(),
                    &AppType::Codex,
                    restore_provider_id.as_deref(),
                ) {
                    Ok(provider_logs) => {
                        logs.extend(provider_logs);
                        Ok(codex_ok(
                            "已退出使用 gac 改版，原版 Codex 线路已恢复，请重新打开终端后再运行 codex",
                            logs.join("\n"),
                            true,
                        ))
                    }
                    Err(error) => Ok(codex_err(
                        "Codex 已切回原版，但 provider 恢复失败",
                        error,
                        logs.join("\n"),
                    )),
                }
            }
            Err(error) => Ok(codex_err(
                "Codex 已切回原版，但原版配置恢复失败",
                error,
                logs.join("\n"),
            )),
        }
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
    let mut route_names = BTreeSet::new();
    route_names.insert("tuzi".to_string());
    if let Some(route_name) = current_route {
        if !route_name.trim().is_empty() {
            route_names.insert(route_name.to_string());
        }
    }

    route_names
        .into_iter()
        .map(|route_name| {
            let is_current = current_route == Some(route_name.as_str());
            let api_key = env_map.get("GEMINI_API_KEY").cloned().unwrap_or_default();
            let model = env_map
                .get("GEMINI_MODEL")
                .cloned()
                .filter(|v| !v.trim().is_empty())
                .unwrap_or_else(|| DEFAULT_GEMINI_MODEL.to_string());
            GeminiRoute {
                name: route_name.clone(),
                base_url: if route_name == "tuzi" {
                    gemini_route_base_url("tuzi").map(|v| v.to_string())
                } else {
                    env_map
                        .get("GOOGLE_GEMINI_BASE_URL")
                        .cloned()
                        .filter(|v| !v.trim().is_empty())
                },
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
    let resolved_cli = if installed {
        resolve_cli_info("gemini")
    } else {
        ResolvedCliInfo::default()
    };
    // Gemini CLI may touch ~/.gemini runtime files even for `--version`.
    // Prefer package metadata to avoid CLI startup side effects while still
    // exposing a real version when the npm package layout is available.
    let version = if installed {
        get_installed_cli_version_from_resolved(&resolved_cli, "gemini", false)
    } else {
        None
    };
    let env_path = get_gemini_env_file_path()?;
    let settings_path = get_gemini_settings_file_path()?;
    let state = load_gemini_install_state();
    let env_map = crate::gemini_config::read_gemini_env().map_err(|e| e.to_string())?;
    let env_sorted = env_map.into_iter().collect::<BTreeMap<String, String>>();
    let base_url = env_sorted
        .get("GOOGLE_GEMINI_BASE_URL")
        .cloned()
        .unwrap_or_default();
    let current_route = state
        .route
        .clone()
        .or_else(|| infer_gemini_route(&base_url));
    let resolved_variant = resolve_gemini_cli_variant(&resolved_cli);
    let latest_version = match (installed, resolved_variant.as_deref()) {
        (true, Some("official")) => fetch_npm_latest_version(GEMINI_OFFICIAL_PACKAGE).await,
        (true, Some("gac")) => fetch_gac_latest_version(GEMINI_GAC_INSTALL_URL).await,
        _ => None,
    };
    let status_version = if resolved_variant.as_deref() == Some("gac") {
        state.install_version.clone().or_else(|| version.clone())
    } else {
        version.clone()
    };
    let variant_conflict = has_variant_conflict(
        gemini_expected_variant(state.install_type.as_deref(), current_route.as_deref()),
        resolved_variant.as_deref(),
    );
    let api_key = env_sorted
        .get("GEMINI_API_KEY")
        .cloned()
        .unwrap_or_default();
    let model = env_sorted.get("GEMINI_MODEL").cloned();

    Ok(GeminiStatus {
        installed,
        version: status_version,
        latest_version,
        resolved_version: resolved_cli.package_version.clone(),
        install_type: state
            .install_type
            .or_else(|| resolved_variant.clone())
            .or_else(|| {
                if installed && Path::new(&env_path).exists() {
                    Some("official".to_string())
                } else {
                    None
                }
            }),
        current_route: current_route.clone(),
        resolved_executable_path: resolved_cli.executable_path.clone(),
        resolved_package_name: resolved_cli.package_name.clone(),
        resolved_variant,
        variant_conflict,
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
            .or_else(|| {
                env_map
                    .get("GEMINI_MODEL")
                    .cloned()
                    .filter(|v| !v.trim().is_empty())
            })
            .unwrap_or_else(|| DEFAULT_GEMINI_MODEL.to_string()),
    );
    crate::gemini_config::write_gemini_env_atomic(&env_map).map_err(|e| e.to_string())?;
    crate::gemini_config::write_packycode_settings().map_err(|e| e.to_string())?;
    save_gemini_install_state("official", Some(&normalized_route), None)?;

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
    state: State<'_, AppState>,
    variant: String,
    route: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<GeminiActionResult, String> {
    let normalized_variant = variant.trim().to_lowercase();
    let installed = command_exists("gemini");
    let resolved_cli = if installed {
        resolve_cli_info("gemini")
    } else {
        ResolvedCliInfo::default()
    };
    let resolved_variant = resolve_gemini_cli_variant(&resolved_cli);
    let current_state = load_gemini_install_state();
    if normalized_variant != "official" && normalized_variant != "gac" {
        return Ok(gemini_err(
            "Gemini 安装失败",
            format!("未知安装类型: {variant}"),
            String::new(),
        ));
    }
    if normalized_variant == "gac" {
        let remembered_provider_id = capture_last_original_provider_id(
            state.inner(),
            &AppType::Gemini,
            current_state.last_original_provider_id.as_deref(),
        )?;
        if installed && is_variant_compatible(resolved_variant.as_deref(), "gac") {
            let install_version = fetch_gac_latest_version(GEMINI_GAC_INSTALL_URL).await;
            save_gemini_install_state_with_version(
                "gac",
                None,
                remembered_provider_id.as_deref(),
                install_version.as_deref(),
            )?;
            return match clear_exclusive_current_provider(state.inner(), &AppType::Gemini) {
                Ok(provider_logs) => {
                    let mut logs = vec!["已确认安装类型=gac".to_string()];
                    logs.extend(provider_logs);
                    Ok(gemini_ok(
                        "检测到已安装 gac 改版 Gemini，当前仅刷新安装状态。如需在已打开的终端中使用，请重新打开终端后再运行 gemini",
                        logs.join("\n"),
                        false,
                    ))
                }
                Err(error) => Ok(gemini_err("Gemini 安装失败", error, String::new())),
            };
        }
        let command = format!("npm install -g {GEMINI_GAC_INSTALL_URL}");
        return match install_and_verify_cli_variant(
            "gemini",
            &command,
            "gac",
            resolve_gemini_cli_variant,
            "Gemini",
            "gac 改版",
            Some(remove_conflicting_gemini_modified_launcher),
        ) {
            Ok(mut result) => {
                let install_version = fetch_gac_latest_version(GEMINI_GAC_INSTALL_URL).await;
                save_gemini_install_state_with_version(
                    "gac",
                    None,
                    remembered_provider_id.as_deref(),
                    install_version.as_deref(),
                )?;
                match clear_exclusive_current_provider(state.inner(), &AppType::Gemini) {
                    Ok(provider_logs) => {
                        result.logs.extend(provider_logs);
                        Ok(gemini_ok(
                            "gac 改版 Gemini 安装成功",
                            result.logs.join("\n"),
                            true,
                        ))
                    }
                    Err(error) => Ok(gemini_err(
                        "Gemini 安装成功，但 provider 状态清理失败",
                        error,
                        result.logs.join("\n"),
                    )),
                }
            }
            Err(failure) => Ok(gemini_err(
                "Gemini 安装失败",
                failure.error,
                failure.logs.join("\n"),
            )),
        };
    }

    let selected_route = route.unwrap_or_else(|| "tuzi".to_string());
    let selected_api_key = api_key.unwrap_or_default();
    if installed && is_variant_compatible(resolved_variant.as_deref(), "official") {
        return match configure_gemini_route(&selected_route, &selected_api_key, model) {
            Ok(route_logs) => Ok(gemini_ok(
                "检测到已安装官方版 Gemini，仅更新路线配置。如需在已打开的终端中使用，请重新打开终端后再运行 gemini",
                route_logs.join("\n"),
                false,
            )),
            Err(e) => Ok(gemini_err("Gemini 配置失败", e, String::new())),
        };
    }

    let install_command = format!("npm install -g {GEMINI_OFFICIAL_PACKAGE}");
    let install_output = match run_shell_script(&install_command) {
        Ok(v) => v,
        Err(e) => return Ok(gemini_err("Gemini 安装失败", e, String::new())),
    };
    let mut logs = vec![format!("$ {install_command}"), install_output];
    match ensure_gemini_official_command_target() {
        Ok(cleanup_logs) => logs.extend(cleanup_logs),
        Err(e) => {
            return Ok(gemini_err(
                "Gemini 官方版安装成功，但当前命中的 CLI 仍未切回官方版",
                e,
                logs.join("\n"),
            ))
        }
    }
    match configure_gemini_route(&selected_route, &selected_api_key, model) {
        Ok(route_logs) => {
            logs.extend(route_logs);
            Ok(gemini_ok(
                "Gemini 安装并配置成功，请重开终端后执行 gemini",
                logs.join("\n"),
                true,
            ))
        }
        Err(e) => Ok(gemini_err(
            "Gemini 安装成功，但路线配置失败",
            e,
            logs.join("\n"),
        )),
    }
}

#[tauri::command]
pub async fn upgrade_gemini(target_variant: Option<String>) -> Result<GeminiActionResult, String> {
    let variant = target_variant
        .map(|v| v.trim().to_lowercase())
        .filter(|v| !v.is_empty())
        .or_else(|| resolve_gemini_cli_variant(&resolve_cli_info("gemini")))
        .unwrap_or_else(|| "official".to_string());
    if variant == "gac" {
        let command = format!("npm install -g {GEMINI_GAC_INSTALL_URL}");
        return match run_shell_script(&command) {
            Ok(output) => {
                let current_state = load_gemini_install_state();
                let install_version = fetch_gac_latest_version(GEMINI_GAC_INSTALL_URL).await;
                save_gemini_install_state_with_version(
                    "gac",
                    None,
                    current_state.last_original_provider_id.as_deref(),
                    install_version.as_deref(),
                )?;
                Ok(gemini_ok(
                    "Gemini 改版升级成功",
                    format!("$ {command}\n{output}"),
                    true,
                ))
            }
            Err(e) => Ok(gemini_err("Gemini 升级失败", e, String::new())),
        };
    }
    let command = format!("npm install -g {GEMINI_OFFICIAL_PACKAGE}@latest");
    match run_shell_script(&command) {
        Ok(output) => Ok(gemini_ok(
            "Gemini 原版升级成功",
            format!("$ {command}\n{output}"),
            true,
        )),
        Err(e) => Ok(gemini_err("Gemini 升级失败", e, String::new())),
    }
}

#[tauri::command]
pub async fn switch_gemini_variant(
    state: State<'_, AppState>,
    target_variant: Option<String>,
) -> Result<GeminiActionResult, String> {
    let target = target_variant
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "gac".to_string());
    let installed = command_exists("gemini");
    let resolved_cli = if installed {
        resolve_cli_info("gemini")
    } else {
        ResolvedCliInfo::default()
    };
    let resolved_variant = resolve_gemini_cli_variant(&resolved_cli);
    let current_state = load_gemini_install_state();

    if target == "gac" {
        let remembered_provider_id = capture_last_original_provider_id(
            state.inner(),
            &AppType::Gemini,
            current_state.last_original_provider_id.as_deref(),
        )?;
        if installed && is_variant_compatible(resolved_variant.as_deref(), "gac") {
            let install_version = fetch_gac_latest_version(GEMINI_GAC_INSTALL_URL).await;
            save_gemini_install_state_with_version(
                "gac",
                None,
                remembered_provider_id.as_deref(),
                install_version.as_deref(),
            )?;
            return match clear_exclusive_current_provider(state.inner(), &AppType::Gemini) {
                Ok(provider_logs) => {
                    let mut logs = vec!["已确认安装类型=gac".to_string()];
                    logs.extend(provider_logs);
                    Ok(gemini_ok(
                        "当前已在使用 gac 改版 Gemini，仅刷新安装状态。如需在已打开的终端中使用，请重新打开终端后再运行 gemini",
                        logs.join("\n"),
                        false,
                    ))
                }
                Err(error) => Ok(gemini_err("Gemini 切换失败", error, String::new())),
            };
        }

        let command = format!("npm install -g {GEMINI_GAC_INSTALL_URL}");
        match install_and_verify_cli_variant(
            "gemini",
            &command,
            "gac",
            resolve_gemini_cli_variant,
            "Gemini",
            "gac 改版",
            Some(remove_conflicting_gemini_modified_launcher),
        ) {
            Ok(mut result) => {
                let install_version = fetch_gac_latest_version(GEMINI_GAC_INSTALL_URL).await;
                save_gemini_install_state_with_version(
                    "gac",
                    None,
                    remembered_provider_id.as_deref(),
                    install_version.as_deref(),
                )?;
                match clear_exclusive_current_provider(state.inner(), &AppType::Gemini) {
                    Ok(provider_logs) => {
                        result.logs.extend(provider_logs);
                        Ok(gemini_ok(
                            "已切换到 gac 改版 Gemini，请重新打开终端后再运行 gemini",
                            result.logs.join("\n"),
                            true,
                        ))
                    }
                    Err(error) => Ok(gemini_err(
                        "Gemini 已切换到改版，但 provider 状态清理失败",
                        error,
                        result.logs.join("\n"),
                    )),
                }
            }
            Err(failure) => Ok(gemini_err(
                "Gemini 切换失败",
                failure.error,
                failure.logs.join("\n"),
            )),
        }
    } else {
        let restore_route = resolve_gemini_original_restore_route();
        let restore_provider_id = current_state.last_original_provider_id.clone();
        let env_map = crate::gemini_config::read_gemini_env().map_err(|e| e.to_string())?;
        let restore_api_key = env_map.get("GEMINI_API_KEY").cloned().unwrap_or_default();
        let restore_model = env_map.get("GEMINI_MODEL").cloned();
        if installed && is_variant_compatible(resolved_variant.as_deref(), "official") {
            return match configure_gemini_route(&restore_route, &restore_api_key, restore_model) {
                Ok(mut logs) => match restore_exclusive_current_provider(
                    state.inner(),
                    &AppType::Gemini,
                    restore_provider_id.as_deref(),
                ) {
                    Ok(provider_logs) => {
                        logs.extend(provider_logs);
                        Ok(gemini_ok(
                            "已退出使用 gac 改版，原版 Gemini 线路已恢复。如需在已打开的终端中使用，请重新打开终端后再运行 gemini",
                            logs.join("\n"),
                            false,
                        ))
                    }
                    Err(error) => Ok(gemini_err(
                        "Gemini 原版配置恢复失败",
                        error,
                        logs.join("\n"),
                    )),
                },
                Err(error) => Ok(gemini_err("Gemini 原版配置恢复失败", error, String::new())),
            };
        }

        let command = format!("npm install -g {GEMINI_OFFICIAL_PACKAGE}");
        let mut logs = match install_and_verify_cli_variant(
            "gemini",
            &command,
            "official",
            resolve_gemini_cli_variant,
            "Gemini",
            "官方版",
            Some(remove_conflicting_gemini_launcher),
        ) {
            Ok(result) => result.logs,
            Err(failure) => {
                return Ok(gemini_err(
                    "Gemini 切回官方版失败",
                    failure.error,
                    failure.logs.join("\n"),
                ))
            }
        };
        match configure_gemini_route(&restore_route, &restore_api_key, restore_model) {
            Ok(route_logs) => {
                logs.extend(route_logs);
                match restore_exclusive_current_provider(
                    state.inner(),
                    &AppType::Gemini,
                    restore_provider_id.as_deref(),
                ) {
                    Ok(provider_logs) => {
                        logs.extend(provider_logs);
                        Ok(gemini_ok(
                            "已退出使用 gac 改版，原版 Gemini 线路已恢复，请重新打开终端后再运行 gemini",
                            logs.join("\n"),
                            true,
                        ))
                    }
                    Err(error) => Ok(gemini_err(
                        "Gemini 已切回原版，但 provider 恢复失败",
                        error,
                        logs.join("\n"),
                    )),
                }
            }
            Err(error) => Ok(gemini_err(
                "Gemini 已切回原版，但原版配置恢复失败",
                error,
                logs.join("\n"),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        claude_custom_api_key_fingerprint, claude_has_modified_status_context,
        claude_runtime_env_conflicts, claude_sources_are_conflicting,
        extract_gac_latest_marker_from_url, merge_claude_current_route,
        normalize_claude_route_for_comparison, parse_install_state,
        remove_conflicting_claude_original_launcher, remove_conflicting_codex_launcher,
        remove_conflicting_codex_original_launcher, remove_conflicting_gemini_launcher,
        remove_conflicting_gemini_modified_launcher, resolve_claude_cli_variant,
        sync_claude_json_state, ResolvedCliInfo, CLAUDE_ORIGINAL_PACKAGE, CODEX_OPENAI_PACKAGE,
        GEMINI_OFFICIAL_PACKAGE,
    };
    use serde_json::{json, Value};
    use std::ffi::OsString;
    use std::fs;
    use tempfile::tempdir;

    struct EnvVarGuard {
        key: &'static str,
        original: Option<OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &std::path::Path) -> Self {
            let original = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, original }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(value) = self.original.as_ref() {
                std::env::set_var(self.key, value);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    #[test]
    fn extract_gac_latest_marker_from_tgz_urls() {
        assert_eq!(
            extract_gac_latest_marker_from_url(
                "https://example.com/links/anthropic-ai-claude-code-2.1.111.tgz"
            )
            .as_deref(),
            Some("2.1.111")
        );
        assert_eq!(
            extract_gac_latest_marker_from_url(
                "https://example.com/links/codex-0.125.0.gac.1.tgz?download=1"
            )
            .as_deref(),
            Some("0.125.0.gac.1")
        );
        assert_eq!(
            extract_gac_latest_marker_from_url("https://example.com/links/gemini-0.38.1.gac.1.tgz")
                .as_deref(),
            Some("0.38.1.gac.1")
        );
        assert!(extract_gac_latest_marker_from_url("https://example.com/install").is_none());
    }

    #[test]
    fn parse_install_state_keeps_optional_install_version() {
        let state = parse_install_state(
            "INSTALL_TYPE=gac\nROUTE=none\nLAST_ORIGINAL_ROUTE=tuzi\nLAST_ORIGINAL_PROVIDER_ID=provider-1\nINSTALL_VERSION=0.125.0.gac.1\nMANAGED_BY=cc-switch\n",
        );

        assert_eq!(state.install_type.as_deref(), Some("gac"));
        assert_eq!(state.route.as_deref(), None);
        assert_eq!(state.last_original_route.as_deref(), Some("tuzi"));
        assert_eq!(
            state.last_original_provider_id.as_deref(),
            Some("provider-1")
        );
        assert_eq!(state.install_version.as_deref(), Some("0.125.0.gac.1"));
    }

    #[test]
    fn resolve_claude_cli_variant_detects_modified_markers() {
        let temp = tempdir().unwrap();
        fs::write(temp.path().join("relay-selector.js"), "relay").unwrap();
        fs::write(temp.path().join("stream-relay-manager.js"), "manager").unwrap();
        fs::write(temp.path().join("stream-relay.cjs"), "stream").unwrap();

        let variant = resolve_claude_cli_variant(&ResolvedCliInfo {
            command_path: Some(temp.path().join("claude").display().to_string()),
            executable_path: Some(temp.path().join("start.js").display().to_string()),
            package_root_path: Some(temp.path().display().to_string()),
            package_name: Some("@anthropic-ai/claude-code".to_string()),
            package_version: Some("2.1.111".to_string()),
        });

        assert_eq!(variant.as_deref(), Some("modified"));
    }

    #[test]
    fn read_package_metadata_resolves_windows_npm_cmd_shim() {
        let temp = tempdir().unwrap();
        let package_root = temp
            .path()
            .join("node_modules")
            .join("@openai")
            .join("codex");
        let bin_dir = package_root.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        fs::write(bin_dir.join("codex.js"), "console.log('codex')").unwrap();
        fs::write(
            package_root.join("package.json"),
            serde_json::to_string(&json!({
                "name": "@openai/codex",
                "version": "0.125.0"
            }))
            .unwrap(),
        )
        .unwrap();

        let command_path = temp.path().join("codex.cmd");
        fs::write(
            &command_path,
            r#"@ECHO off
"node" "%dp0%\node_modules\@openai\codex\bin\codex.js" %*
"#,
        )
        .unwrap();

        let info = super::read_package_metadata(&command_path);

        assert_eq!(
            info.command_path.as_deref(),
            Some(command_path.to_str().unwrap())
        );
        assert_eq!(info.package_name.as_deref(), Some("@openai/codex"));
        assert_eq!(info.package_version.as_deref(), Some("0.125.0"));
        let expected_package_root = fs::canonicalize(&package_root).unwrap();
        assert_eq!(
            info.package_root_path.as_deref(),
            Some(expected_package_root.to_str().unwrap())
        );
    }

    #[test]
    fn claude_custom_api_key_fingerprint_uses_last_twenty_characters() {
        assert_eq!(
            claude_custom_api_key_fingerprint(
                "sk-na7MP0qBCU27KOqJyfleZAp5xdROEojUGLCbzufuKD3MgpRu"
            )
            .as_deref(),
            Some("EojUGLCbzufuKD3MgpRu")
        );
        assert_eq!(
            claude_custom_api_key_fingerprint("short-key").as_deref(),
            Some("short-key")
        );
    }

    #[test]
    fn sync_claude_json_state_approves_current_original_key() {
        let temp = tempdir().unwrap();
        let _home_guard = EnvVarGuard::set("HOME", temp.path());
        let _test_home_guard = EnvVarGuard::set("CC_SWITCH_TEST_HOME", temp.path());

        let claude_json_path = temp.path().join(".claude.json");
        fs::write(
            &claude_json_path,
            serde_json::to_string_pretty(&json!({
                "customApiKeyResponses": {
                    "approved": ["old-approved"],
                    "rejected": ["EojUGLCbzufuKD3MgpRu", "keep-rejected"]
                }
            }))
            .unwrap(),
        )
        .unwrap();

        let logs =
            sync_claude_json_state(Some("sk-na7MP0qBCU27KOqJyfleZAp5xdROEojUGLCbzufuKD3MgpRu"))
                .unwrap();

        let parsed: Value =
            serde_json::from_str(&fs::read_to_string(&claude_json_path).unwrap()).unwrap();
        assert_eq!(
            parsed.get("hasCompletedOnboarding"),
            Some(&Value::Bool(true))
        );

        let approved = parsed
            .get("customApiKeyResponses")
            .and_then(|value| value.get("approved"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        assert!(approved.contains(&Value::String("old-approved".to_string())));
        assert!(approved.contains(&Value::String("EojUGLCbzufuKD3MgpRu".to_string())));

        let rejected = parsed
            .get("customApiKeyResponses")
            .and_then(|value| value.get("rejected"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        assert!(!rejected.contains(&Value::String("EojUGLCbzufuKD3MgpRu".to_string())));
        assert!(rejected.contains(&Value::String("keep-rejected".to_string())));

        assert!(logs
            .iter()
            .any(|line| line.contains("已将当前 Claude API Key 标记为本地已批准")));
    }

    #[test]
    fn remove_conflicting_codex_launcher_deletes_existing_command_file() {
        let temp = tempdir().unwrap();
        let command_path = temp.path().join("codex");
        fs::write(&command_path, "#!/bin/sh\n").unwrap();

        let logs = remove_conflicting_codex_launcher(&ResolvedCliInfo {
            command_path: Some(command_path.display().to_string()),
            executable_path: Some(command_path.display().to_string()),
            package_root_path: None,
            package_name: Some("@openai/codex".to_string()),
            package_version: Some("0.121.0".to_string()),
        })
        .unwrap();

        assert!(!command_path.exists());
        assert!(logs
            .iter()
            .any(|line| line.contains("已移除冲突的 Codex launcher")));
    }

    #[test]
    fn remove_conflicting_codex_original_launcher_deletes_non_openai_command_file() {
        let temp = tempdir().unwrap();
        let command_path = temp.path().join("codex");
        fs::write(&command_path, "#!/bin/sh\n").unwrap();

        let logs = remove_conflicting_codex_original_launcher(&ResolvedCliInfo {
            command_path: Some(command_path.display().to_string()),
            executable_path: Some(command_path.display().to_string()),
            package_root_path: None,
            package_name: Some("gac-codex".to_string()),
            package_version: Some("0.125.0".to_string()),
        })
        .unwrap();

        assert!(!command_path.exists());
        assert!(logs
            .iter()
            .any(|line| line.contains("已移除冲突的 Codex launcher")));
    }

    #[test]
    fn remove_conflicting_codex_original_launcher_preserves_openai_command() {
        let temp = tempdir().unwrap();
        let command_path = temp.path().join("codex");
        fs::write(&command_path, "#!/bin/sh\n").unwrap();

        let logs = remove_conflicting_codex_original_launcher(&ResolvedCliInfo {
            command_path: Some(command_path.display().to_string()),
            executable_path: Some(command_path.display().to_string()),
            package_root_path: None,
            package_name: Some(CODEX_OPENAI_PACKAGE.to_string()),
            package_version: Some("0.59.0".to_string()),
        })
        .unwrap();

        assert!(command_path.exists());
        assert!(logs.is_empty());
    }

    #[test]
    fn remove_conflicting_codex_original_launcher_rejects_directory_target() {
        let temp = tempdir().unwrap();
        let command_dir = temp.path().join("codex");
        fs::create_dir_all(&command_dir).unwrap();

        let error = remove_conflicting_codex_original_launcher(&ResolvedCliInfo {
            command_path: Some(command_dir.display().to_string()),
            executable_path: Some(command_dir.display().to_string()),
            package_root_path: None,
            package_name: Some("gac-codex".to_string()),
            package_version: Some("0.125.0".to_string()),
        })
        .unwrap_err();

        assert!(error.contains("不是普通文件/符号链接"));
    }

    #[test]
    fn remove_conflicting_claude_original_launcher_deletes_non_original_command_file() {
        let temp = tempdir().unwrap();
        let command_path = temp.path().join("claude");
        fs::write(&command_path, "#!/bin/sh\n").unwrap();

        let logs = remove_conflicting_claude_original_launcher(&ResolvedCliInfo {
            command_path: Some(command_path.display().to_string()),
            executable_path: Some(command_path.display().to_string()),
            package_root_path: None,
            package_name: Some("gac-claude-code".to_string()),
            package_version: Some("2.1.112".to_string()),
        })
        .unwrap();

        assert!(!command_path.exists());
        assert!(logs
            .iter()
            .any(|line| line.contains("已移除冲突的 ClaudeCode launcher")));
    }

    #[test]
    fn remove_conflicting_claude_original_launcher_preserves_original_command() {
        let temp = tempdir().unwrap();
        let command_path = temp.path().join("claude");
        fs::write(&command_path, "#!/bin/sh\n").unwrap();

        let logs = remove_conflicting_claude_original_launcher(&ResolvedCliInfo {
            command_path: Some(command_path.display().to_string()),
            executable_path: Some(command_path.display().to_string()),
            package_root_path: None,
            package_name: Some(CLAUDE_ORIGINAL_PACKAGE.to_string()),
            package_version: Some("2.1.112".to_string()),
        })
        .unwrap();

        assert!(command_path.exists());
        assert!(logs.is_empty());
    }

    #[test]
    fn remove_conflicting_claude_original_launcher_rejects_directory_target() {
        let temp = tempdir().unwrap();
        let command_dir = temp.path().join("claude");
        fs::create_dir_all(&command_dir).unwrap();

        let error = remove_conflicting_claude_original_launcher(&ResolvedCliInfo {
            command_path: Some(command_dir.display().to_string()),
            executable_path: Some(command_dir.display().to_string()),
            package_root_path: None,
            package_name: Some("gac-claude-code".to_string()),
            package_version: Some("2.1.112".to_string()),
        })
        .unwrap_err();

        assert!(error.contains("不是普通文件/符号链接"));
    }

    #[test]
    fn remove_conflicting_gemini_launcher_deletes_non_official_command_file() {
        let temp = tempdir().unwrap();
        let command_path = temp.path().join("gemini");
        fs::write(&command_path, "#!/bin/sh\n").unwrap();

        let logs = remove_conflicting_gemini_launcher(&ResolvedCliInfo {
            command_path: Some(command_path.display().to_string()),
            executable_path: Some(command_path.display().to_string()),
            package_root_path: None,
            package_name: Some("gemini".to_string()),
            package_version: Some("0.32.1".to_string()),
        })
        .unwrap();

        assert!(!command_path.exists());
        assert!(logs
            .iter()
            .any(|line| line.contains("已移除冲突的 Gemini launcher")));
    }

    #[test]
    fn remove_conflicting_gemini_launcher_preserves_official_command() {
        let temp = tempdir().unwrap();
        let command_path = temp.path().join("gemini");
        fs::write(&command_path, "#!/bin/sh\n").unwrap();

        let logs = remove_conflicting_gemini_launcher(&ResolvedCliInfo {
            command_path: Some(command_path.display().to_string()),
            executable_path: Some(command_path.display().to_string()),
            package_root_path: None,
            package_name: Some(GEMINI_OFFICIAL_PACKAGE.to_string()),
            package_version: Some("0.38.2".to_string()),
        })
        .unwrap();

        assert!(command_path.exists());
        assert!(logs.is_empty());
    }

    #[test]
    fn remove_conflicting_gemini_modified_launcher_deletes_official_command() {
        let temp = tempdir().unwrap();
        let command_path = temp.path().join("gemini");
        fs::write(&command_path, "#!/bin/sh\n").unwrap();

        let logs = remove_conflicting_gemini_modified_launcher(&ResolvedCliInfo {
            command_path: Some(command_path.display().to_string()),
            executable_path: Some(command_path.display().to_string()),
            package_root_path: None,
            package_name: Some(GEMINI_OFFICIAL_PACKAGE.to_string()),
            package_version: Some("0.38.2".to_string()),
        })
        .unwrap();

        assert!(!command_path.exists());
        assert!(logs
            .iter()
            .any(|line| line.contains("已移除冲突的 Gemini launcher")));
    }

    #[test]
    fn remove_conflicting_gemini_launcher_rejects_directory_target() {
        let temp = tempdir().unwrap();
        let command_dir = temp.path().join("gemini");
        fs::create_dir_all(&command_dir).unwrap();

        let error = remove_conflicting_gemini_launcher(&ResolvedCliInfo {
            command_path: Some(command_dir.display().to_string()),
            executable_path: Some(command_dir.display().to_string()),
            package_root_path: None,
            package_name: Some("gemini".to_string()),
            package_version: Some("0.32.1".to_string()),
        })
        .unwrap_err();

        assert!(error.contains("不是普通文件/符号链接"));
    }

    #[test]
    fn normalize_claude_custom_route_name_for_comparison() {
        assert_eq!(
            normalize_claude_route_for_comparison(Some("custom-provider-id")).as_deref(),
            Some("custom")
        );
        assert_eq!(
            normalize_claude_route_for_comparison(Some("tu-zi")).as_deref(),
            Some("tu-zi")
        );
    }

    #[test]
    fn claude_source_comparison_treats_custom_route_file_as_custom() {
        assert!(!claude_sources_are_conflicting(
            Some("custom-provider-id"),
            Some("custom"),
            Some("custom"),
            false,
            false,
        ));
        assert_eq!(
            merge_claude_current_route(None, None, Some("custom-provider-id"), false).as_deref(),
            Some("custom")
        );
    }

    #[test]
    fn claude_modified_context_prefers_modified_over_settings_gaccode() {
        let treat_settings_gaccode_as_modified =
            claude_has_modified_status_context(Some("改版"), Some("modified"), Some("改版"));
        assert!(treat_settings_gaccode_as_modified);
        assert_eq!(
            merge_claude_current_route(
                Some("gaccode"),
                None,
                Some("改版"),
                treat_settings_gaccode_as_modified,
            )
            .as_deref(),
            Some("改版")
        );
        assert!(!claude_sources_are_conflicting(
            Some("改版"),
            None,
            Some("gaccode"),
            false,
            treat_settings_gaccode_as_modified,
        ));
    }

    #[test]
    fn claude_runtime_env_conflict_detects_modified_process_env() {
        assert!(claude_runtime_env_conflicts(
            Some("tu-zi"),
            Some("改版"),
            None
        ));
        assert!(claude_runtime_env_conflicts(
            Some("gaccode"),
            Some("custom"),
            Some("改版")
        ));
        assert!(!claude_runtime_env_conflicts(
            Some("tu-zi"),
            Some("tu-zi"),
            None
        ));
        assert!(!claude_runtime_env_conflicts(
            Some("custom-provider-id"),
            Some("custom"),
            None
        ));
        assert!(!claude_runtime_env_conflicts(
            Some("tu-zi"),
            Some("改版"),
            Some("tu-zi")
        ));
    }
}
