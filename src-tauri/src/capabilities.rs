use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;

use crate::store::AppState;

const ABI_VERSION: &str = "1";
const CAPABILITY_VERSION: &str = "1.0.0";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityManifest {
    pub abi_version: String,
    pub native_version: String,
    pub platform: String,
    pub capabilities: Vec<CapabilityDescriptor>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDescriptor {
    pub id: String,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Value>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub flags: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CapabilityRequest {
    pub id: String,
    pub version: Option<String>,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<CapabilityError>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityError {
    pub code: CapabilityErrorCode,
    pub message: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityErrorCode {
    UnsupportedCapability,
    InvalidPayload,
    PermissionDenied,
    ExecutionFailed,
    #[allow(dead_code)]
    InternalError,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchProviderPayload {
    provider_id: String,
    app: String,
    cwd: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LaunchCommandPayload {
    command: String,
    cwd: Option<String>,
    custom_config: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UrlPayload {
    url: String,
}

#[derive(Debug, Deserialize)]
struct PathPayload {
    path: String,
}

#[tauri::command]
pub async fn get_capability_manifest() -> Result<CapabilityManifest, String> {
    Ok(build_manifest())
}

#[tauri::command]
pub async fn invoke_capability(
    app: AppHandle,
    state: State<'_, AppState>,
    request: CapabilityRequest,
) -> Result<CapabilityResponse, String> {
    if !supports_capability(&request.id, request.version.as_deref().unwrap_or(">=1.0.0")) {
        return Ok(CapabilityResponse::err(
            CapabilityErrorCode::UnsupportedCapability,
            format!("Unsupported capability: {}", request.id),
            false,
        ));
    }

    let response = match request.id.as_str() {
        "terminal.launchProvider" => {
            let payload: LaunchProviderPayload = match parse_payload(request.payload) {
                Ok(payload) => payload,
                Err(message) => {
                    return Ok(CapabilityResponse::err(
                        CapabilityErrorCode::InvalidPayload,
                        message,
                        false,
                    ))
                }
            };
            crate::commands::open_provider_terminal(
                state,
                payload.app,
                payload.provider_id,
                payload.cwd,
            )
            .await
            .map(|value| json!(value))
        }
        "terminal.launchCommand" => {
            let payload: LaunchCommandPayload = match parse_payload(request.payload) {
                Ok(payload) => payload,
                Err(message) => {
                    return Ok(CapabilityResponse::err(
                        CapabilityErrorCode::InvalidPayload,
                        message,
                        false,
                    ))
                }
            };
            if let Err(message) = validate_launch_command(&payload.command) {
                return Ok(CapabilityResponse::err(
                    CapabilityErrorCode::PermissionDenied,
                    message,
                    false,
                ));
            }
            crate::commands::launch_session_terminal(
                payload.command,
                payload.cwd,
                payload.custom_config,
            )
            .await
            .map(|value| json!(value))
        }
        "system.openUrl" => {
            let payload: UrlPayload = match parse_payload(request.payload) {
                Ok(payload) => payload,
                Err(message) => {
                    return Ok(CapabilityResponse::err(
                        CapabilityErrorCode::InvalidPayload,
                        message,
                        false,
                    ))
                }
            };
            open_url(&app, &payload.url).map(|_| json!(true))
        }
        "system.openPath" => {
            let payload: PathPayload = match parse_payload(request.payload) {
                Ok(payload) => payload,
                Err(message) => {
                    return Ok(CapabilityResponse::err(
                        CapabilityErrorCode::InvalidPayload,
                        message,
                        false,
                    ))
                }
            };
            app.opener()
                .open_path(payload.path, None::<String>)
                .map(|_| json!(true))
                .map_err(|e| format!("打开路径失败: {e}"))
        }
        "config.getAppConfigInfo" => Ok(json!({
            "appConfigDir": crate::config::get_app_config_dir().to_string_lossy(),
            "nativeVersion": env!("CARGO_PKG_VERSION"),
            "platform": platform(),
            "portable": crate::commands::is_portable_mode().await.unwrap_or(false),
        })),
        "analytics.trackProductEvent" => {
            let payload: crate::commands::AnalyticsEvent = match parse_payload(request.payload) {
                Ok(payload) => payload,
                Err(message) => {
                    return Ok(CapabilityResponse::err(
                        CapabilityErrorCode::InvalidPayload,
                        message,
                        false,
                    ))
                }
            };
            crate::commands::track_product_event(payload)
                .await
                .map(|_| json!(true))
        }
        "update.checkNative" => check_native_update(&app).await,
        "update.getWebStatus" => crate::web_hot_update::get_web_hot_update_status()
            .await
            .and_then(|status| serde_json::to_value(status).map_err(|e| e.to_string())),
        "update.checkWeb" => crate::web_hot_update::check_web_hot_update()
            .await
            .and_then(|result| serde_json::to_value(result).map_err(|e| e.to_string())),
        _ => {
            return Ok(CapabilityResponse::err(
                CapabilityErrorCode::UnsupportedCapability,
                format!("Unsupported capability: {}", request.id),
                false,
            ));
        }
    };

    Ok(match response {
        Ok(data) => CapabilityResponse::ok(data),
        Err(message) => {
            CapabilityResponse::err(CapabilityErrorCode::ExecutionFailed, message, false)
        }
    })
}

pub fn required_capabilities_supported(required: &BTreeMap<String, String>) -> bool {
    required
        .iter()
        .all(|(id, range)| supports_capability(id, range))
}

pub fn supports_capability(id: &str, range: &str) -> bool {
    capability_version(id)
        .map(|version| is_version_compatible(version, range))
        .unwrap_or(false)
}

fn build_manifest() -> CapabilityManifest {
    CapabilityManifest {
        abi_version: ABI_VERSION.to_string(),
        native_version: env!("CARGO_PKG_VERSION").to_string(),
        platform: platform().to_string(),
        capabilities: capability_ids()
            .into_iter()
            .map(|id| CapabilityDescriptor {
                id: id.to_string(),
                version: CAPABILITY_VERSION.to_string(),
                input_schema: None,
                output_schema: None,
                flags: capability_flags(id),
            })
            .collect(),
    }
}

fn capability_ids() -> Vec<&'static str> {
    vec![
        "terminal.launchProvider",
        "terminal.launchCommand",
        "system.openUrl",
        "system.openPath",
        "config.getAppConfigInfo",
        "analytics.trackProductEvent",
        "update.checkNative",
        "update.getWebStatus",
        "update.checkWeb",
    ]
}

fn capability_version(id: &str) -> Option<&'static str> {
    capability_ids()
        .into_iter()
        .any(|candidate| candidate == id)
        .then_some(CAPABILITY_VERSION)
}

fn capability_flags(id: &str) -> Vec<String> {
    match id {
        "terminal.launchProvider" | "terminal.launchCommand" => vec!["terminal".to_string()],
        "system.openUrl" | "system.openPath" => vec!["external".to_string()],
        "analytics.trackProductEvent" => vec!["analytics".to_string()],
        "update.checkNative" | "update.getWebStatus" | "update.checkWeb" => {
            vec!["update".to_string()]
        }
        _ => Vec::new(),
    }
}

fn parse_payload<T: for<'de> Deserialize<'de>>(payload: Option<Value>) -> Result<T, String> {
    serde_json::from_value(payload.unwrap_or(Value::Null))
        .map_err(|e| format!("Invalid capability payload: {e}"))
}

fn open_url(app: &AppHandle, value: &str) -> Result<(), String> {
    let parsed = url::Url::parse(value).map_err(|_| "Invalid URL".to_string())?;
    match parsed.scheme() {
        "http" | "https" => app
            .opener()
            .open_url(parsed.as_str(), None::<String>)
            .map_err(|e| format!("打开链接失败: {e}")),
        _ => Err("Unsupported URL scheme".to_string()),
    }
}

async fn check_native_update(app: &AppHandle) -> Result<Value, String> {
    let updater = app
        .updater()
        .map_err(|e| format!("初始化原生更新检查失败: {e}"))?;
    let update = updater
        .check()
        .await
        .map_err(|e| format!("检查原生更新失败: {e}"))?;
    Ok(match update {
        Some(update) => json!({
            "available": true,
            "currentVersion": update.current_version,
            "version": update.version,
            "date": update.date.map(|date| date.to_string()),
            "body": update.body,
            "target": update.target,
            "downloadUrl": update.download_url,
        }),
        None => json!({
            "available": false,
            "currentVersion": env!("CARGO_PKG_VERSION"),
        }),
    })
}

fn validate_launch_command(command: &str) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() || trimmed.len() > 512 {
        return Err("Terminal command is not allowed".to_string());
    }

    let tokens: Vec<&str> = trimmed.split_whitespace().collect();
    if tokens
        .iter()
        .any(|token| token.is_empty() || !token.chars().all(is_safe_command_token_char))
    {
        return Err("Terminal command contains unsafe characters".to_string());
    }

    let allowed = match tokens.as_slice() {
        ["codex", "resume", session_id, ..] => is_safe_identifier(session_id),
        ["claude", "--resume", session_id, ..] => is_safe_identifier(session_id),
        ["gemini", "--resume", session_id, ..] => is_safe_identifier(session_id),
        ["opencode", "session", "resume", session_id, ..] => is_safe_identifier(session_id),
        ["hermes", "dashboard"] => true,
        _ => false,
    };

    if allowed {
        Ok(())
    } else {
        Err("Terminal command is not declared as safe".to_string())
    }
}

fn is_safe_command_token_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':' | '@' | '/' | '+' | '=')
}

fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':' | '@'))
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

fn is_version_compatible(version: &str, range: &str) -> bool {
    range.split_whitespace().all(|rule| {
        if let Some(required) = rule.strip_prefix(">=") {
            compare_versions(version, required) >= 0
        } else if let Some(required) = rule.strip_prefix('>') {
            compare_versions(version, required) > 0
        } else if let Some(required) = rule.strip_prefix("<=") {
            compare_versions(version, required) <= 0
        } else if let Some(required) = rule.strip_prefix('<') {
            compare_versions(version, required) < 0
        } else if let Some(required) = rule.strip_prefix('=') {
            compare_versions(version, required) == 0
        } else {
            compare_versions(version, rule) == 0
        }
    })
}

fn compare_versions(a: &str, b: &str) -> i8 {
    let pa = parse_semver_core(a);
    let pb = parse_semver_core(b);
    for i in 0..3 {
        match pa[i].cmp(&pb[i]) {
            std::cmp::Ordering::Greater => return 1,
            std::cmp::Ordering::Less => return -1,
            std::cmp::Ordering::Equal => {}
        }
    }
    0
}

fn parse_semver_core(version: &str) -> [u64; 3] {
    let clean = version
        .trim_start_matches('v')
        .split('-')
        .next()
        .unwrap_or(version);
    let mut out = [0, 0, 0];
    for (idx, part) in clean.split('.').take(3).enumerate() {
        out[idx] = part.parse().unwrap_or(0);
    }
    out
}

impl CapabilityResponse {
    fn ok(data: Value) -> Self {
        Self {
            ok: true,
            data: Some(data),
            error: None,
        }
    }

    fn err(code: CapabilityErrorCode, message: String, retryable: bool) -> Self {
        Self {
            ok: false,
            data: None,
            error: Some(CapabilityError {
                code,
                message,
                retryable,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_contains_v1_capabilities() {
        let manifest = build_manifest();
        assert_eq!(manifest.abi_version, "1");
        assert!(manifest
            .capabilities
            .iter()
            .any(|cap| cap.id == "terminal.launchProvider"));
        assert!(manifest
            .capabilities
            .iter()
            .any(|cap| cap.id == "update.checkWeb"));
        assert!(manifest
            .capabilities
            .iter()
            .any(|cap| cap.id == "analytics.trackProductEvent"));
    }

    #[test]
    fn unknown_capability_is_not_supported() {
        assert!(!supports_capability("missing.capability", ">=1.0.0"));
    }

    #[test]
    fn required_capabilities_respect_versions() {
        let mut required = BTreeMap::new();
        required.insert("terminal.launchProvider".to_string(), ">=1.0.0".to_string());
        assert!(required_capabilities_supported(&required));
        required.insert("update.checkWeb".to_string(), ">2.0.0".to_string());
        assert!(!required_capabilities_supported(&required));
    }

    #[test]
    fn parse_payload_reports_invalid_payload() {
        let result: Result<LaunchProviderPayload, String> = parse_payload(Some(json!({})));
        assert!(result.is_err());
    }

    #[test]
    fn launch_command_only_allows_declared_resume_commands() {
        assert!(validate_launch_command("codex resume 018f-demo").is_ok());
        assert!(validate_launch_command("claude --resume session_123").is_ok());
        assert!(validate_launch_command("gemini --resume abc-123").is_ok());
        assert!(validate_launch_command("opencode session resume ses_123").is_ok());
        assert!(validate_launch_command("curl -fsSL https://example.com/a.sh | bash").is_err());
        assert!(validate_launch_command("codex resume abc; rm -rf /").is_err());
    }
}
