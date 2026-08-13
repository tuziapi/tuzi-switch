use crate::{codex_config, error::AppError};
use serde_json::Value;
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub(crate) const IMAGE_API_KEY_ENV: &str = "TUZI_CODEX_IMAGE_API_KEY";
const TUZI_IMAGE_HOST: &str = "api.tu-zi.com";
const PROCESS_ENV_KEY_ALLOWLIST: &[&str] = &[
    "OPENAI_API_KEY",
    "TUZI_CODEX_API_KEY",
    "CODING_CODEX_API_KEY",
    "TUZI01_CODEX_API_KEY",
];
const MAX_API_KEY_BYTES: usize = 64 * 1024;
const MAX_AGENTS_BYTES: u64 = 2 * 1024 * 1024;
const AGENTS_FILE: &str = "AGENTS.md";
const AGENTS_OVERRIDE_FILE: &str = "AGENTS.override.md";
const MANAGED_START: &str = "<!-- TUZI_SWITCH_CODEX_IMAGE_COMPAT_START -->";
const MANAGED_END: &str = "<!-- TUZI_SWITCH_CODEX_IMAGE_COMPAT_END -->";
pub(crate) const MANAGED_INSTRUCTION: &str = "只要是生成图片相关的需求，都使用 API Key 中内置的 gpt-image-2 生成，接口地址使用 https://api.tu-zi.com/v1。";
static PERSONALIZATION_LOCK: Mutex<()> = Mutex::new(());

/// Derive the dedicated image credential from one effective Codex provider.
/// `None` or an ineligible provider clears only Tuzi Switch's managed image key.
pub(crate) fn reconcile_managed_image_api_key(
    settings_config: Option<&Value>,
) -> Result<bool, AppError> {
    let candidate = match derive_image_api_key(settings_config) {
        Ok(candidate) => candidate,
        Err(error) => {
            return match codex_config::remove_managed_env_key_file(IMAGE_API_KEY_ENV) {
                Ok(_) => Err(error),
                Err(cleanup_error) => Err(AppError::Message(format!(
                    "派生 Codex 图片 Key 失败: {error}; 清理旧 Key 失败: {cleanup_error}"
                ))),
            };
        }
    };
    let Some(token) = candidate else {
        codex_config::remove_managed_env_key_file(IMAGE_API_KEY_ENV)?;
        return Ok(false);
    };
    if let Err(error) = codex_config::write_managed_env_key_file(IMAGE_API_KEY_ENV, &token) {
        return match codex_config::remove_managed_env_key_file(IMAGE_API_KEY_ENV) {
            Ok(_) => Err(error),
            Err(cleanup_error) => Err(AppError::Message(format!(
                "写入 Codex 图片 Key 失败: {error}; 清理旧 Key 失败: {cleanup_error}"
            ))),
        };
    }
    Ok(true)
}

fn derive_image_api_key(settings_config: Option<&Value>) -> Result<Option<String>, AppError> {
    let Some(settings_config) = settings_config else {
        return Ok(None);
    };
    let Some(env_key) = eligible_tuzi_env_key_from_settings(settings_config)? else {
        return Ok(None);
    };

    let auth_token = settings_config
        .get("auth")
        .and_then(codex_config::extract_codex_auth_api_key);
    let managed_token = if auth_token.is_none() && env_key != IMAGE_API_KEY_ENV {
        codex_config::read_managed_env_key_file(&env_key)?
    } else {
        None
    };
    let process_token = if auth_token.is_none()
        && managed_token.is_none()
        && env_key != IMAGE_API_KEY_ENV
        && process_env_key_allowed(&env_key)
    {
        std::env::var(&env_key).ok()
    } else {
        None
    };
    let token = auth_token.or(managed_token).or(process_token);
    let Some(token) = token else {
        return Ok(None);
    };
    Ok(Some(validate_api_key(&token)?.to_string()))
}

pub(crate) fn eligible_tuzi_env_key_from_settings(
    settings_config: &Value,
) -> Result<Option<String>, AppError> {
    Ok(eligible_tuzi_image_source_from_settings(settings_config)?.map(|(_, env_key)| env_key))
}

pub(crate) fn eligible_tuzi_image_source_from_settings(
    settings_config: &Value,
) -> Result<Option<(String, String)>, AppError> {
    let Some(config_text) = settings_config.get("config").and_then(Value::as_str) else {
        return Ok(None);
    };
    eligible_tuzi_image_source(config_text)
}

pub(crate) fn read_managed_image_api_key() -> Result<Option<String>, AppError> {
    let token = codex_config::read_managed_env_key_file(IMAGE_API_KEY_ENV)?;
    token
        .map(|value| validate_api_key(&value).map(str::to_string))
        .transpose()
}

fn eligible_tuzi_image_source(config_text: &str) -> Result<Option<(String, String)>, AppError> {
    if config_text.trim().is_empty() {
        return Ok(None);
    }
    let document = config_text
        .parse::<toml::Value>()
        .map_err(|error| AppError::Message(format!("Invalid Codex config.toml: {error}")))?;
    let Some(provider_id) = document
        .get("model_provider")
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    let Some(provider) = document
        .get("model_providers")
        .and_then(|value| value.get(provider_id))
        .and_then(toml::Value::as_table)
    else {
        return Ok(None);
    };
    let Some(base_url) = provider.get("base_url").and_then(toml::Value::as_str) else {
        return Ok(None);
    };
    if !is_supported_tuzi_image_source(base_url) {
        return Ok(None);
    }
    let Some(env_key) = provider
        .get("env_key")
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    validate_env_key(env_key)?;
    Ok(Some((base_url.to_string(), env_key.to_string())))
}

fn is_supported_tuzi_image_source(raw: &str) -> bool {
    let Ok(url) = url::Url::parse(raw.trim()) else {
        return false;
    };
    if url.scheme() != "https"
        || url.host_str() != Some(TUZI_IMAGE_HOST)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|port| port != 443)
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return false;
    }
    matches!(url.path(), "/v1" | "/v1/" | "/coding" | "/coding/")
}

fn validate_env_key(env_key: &str) -> Result<(), AppError> {
    let mut chars = env_key.chars();
    let valid = chars
        .next()
        .is_some_and(|first| first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric());
    if valid {
        Ok(())
    } else {
        Err(AppError::InvalidInput("Codex env_key 格式无效".to_string()))
    }
}

fn process_env_key_allowed(env_key: &str) -> bool {
    PROCESS_ENV_KEY_ALLOWLIST
        .iter()
        .any(|allowed| env_key.eq_ignore_ascii_case(allowed))
}

fn validate_api_key(value: &str) -> Result<&str, AppError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_API_KEY_BYTES
        || value.bytes().any(|byte| byte.is_ascii_control())
        || http::HeaderValue::from_str(value).is_err()
    {
        return Err(AppError::InvalidInput(
            "Codex 图片 API Key 无效".to_string(),
        ));
    }
    Ok(value)
}

pub(crate) fn effective_codex_home() -> PathBuf {
    codex_config::get_codex_config_dir()
}

/// Reconcile both global instruction files. A non-empty override is the active
/// target; stale managed blocks are removed from the inactive file.
pub(crate) fn reconcile_image_personalization_at(
    codex_dir: &Path,
    enabled: bool,
) -> Result<bool, AppError> {
    let _guard = PERSONALIZATION_LOCK.lock()?;
    reconcile_image_personalization_at_locked(codex_dir, enabled)
}

/// Read-only check for the effective global instruction file. This deliberately
/// does not reconcile either AGENTS file, so status inspection cannot mutate
/// the user's Codex home.
pub(crate) fn image_personalization_is_active_at(codex_dir: &Path) -> Result<bool, AppError> {
    let agents = read_optional_text(&codex_dir.join(AGENTS_FILE))?;
    let override_content = read_optional_text(&codex_dir.join(AGENTS_OVERRIDE_FILE))?;
    let effective = override_content
        .as_deref()
        .filter(|content| {
            !content
                .trim_matches(['\u{feff}', ' ', '\t', '\r', '\n'])
                .is_empty()
        })
        .or(agents.as_deref());

    effective
        .map(managed_personalization_block_matches)
        .unwrap_or(Ok(false))
}

fn managed_personalization_block_matches(content: &str) -> Result<bool, AppError> {
    let body = content.strip_prefix('\u{feff}').unwrap_or(content);
    let Some((start, end)) = managed_block_range(body)? else {
        return Ok(false);
    };
    let newline = if body.contains("\r\n") { "\r\n" } else { "\n" };
    let expected =
        format!("{MANAGED_START}{newline}{MANAGED_INSTRUCTION}{newline}{MANAGED_END}{newline}");
    Ok(&body[start..end] == expected)
}

fn reconcile_image_personalization_at_locked(
    codex_dir: &Path,
    enabled: bool,
) -> Result<bool, AppError> {
    let agents_path = codex_dir.join(AGENTS_FILE);
    let override_path = codex_dir.join(AGENTS_OVERRIDE_FILE);
    let agents = read_optional_text(&agents_path)?;
    let override_content = read_optional_text(&override_path)?;
    let target_override = override_content.as_deref().is_some_and(|content| {
        !content
            .trim_matches(['\u{feff}', ' ', '\t', '\r', '\n'])
            .is_empty()
    });

    let next_agents = match agents.as_deref() {
        Some(content) => Some(merge_personalization(content, enabled && !target_override)?),
        None if enabled && !target_override => Some(merge_personalization("", true)?),
        None => None,
    };
    let next_override = override_content
        .as_deref()
        .map(|content| merge_personalization(content, enabled && target_override))
        .transpose()?;

    commit_personalization_changes(
        (&agents_path, agents.as_deref(), next_agents.as_deref()),
        (
            &override_path,
            override_content.as_deref(),
            next_override.as_deref(),
        ),
    )
}

/// Prompt writes keep the user's prompt in AGENTS.md, then reconcile Tuzi's
/// managed block into the effective global instruction file.
pub(crate) fn write_codex_prompt_preserving_personalization(
    content: &str,
    enabled: bool,
) -> Result<(), AppError> {
    let _guard = PERSONALIZATION_LOCK.lock()?;
    let clean = merge_personalization(content, false)?;
    let codex_dir = effective_codex_home();
    let agents_path = codex_dir.join(AGENTS_FILE);
    let override_path = codex_dir.join(AGENTS_OVERRIDE_FILE);
    let agents = read_optional_text(&agents_path)?;
    let override_content = read_optional_text(&override_path)?;
    let target_override = override_content.as_deref().is_some_and(|value| {
        !value
            .trim_matches(['\u{feff}', ' ', '\t', '\r', '\n'])
            .is_empty()
    });
    let next_agents = merge_personalization(&clean, enabled && !target_override)?;
    let next_override = override_content
        .as_deref()
        .map(|value| merge_personalization(value, enabled && target_override))
        .transpose()?;
    commit_personalization_changes(
        (&agents_path, agents.as_deref(), Some(next_agents.as_str())),
        (
            &override_path,
            override_content.as_deref(),
            next_override.as_deref(),
        ),
    )?;
    Ok(())
}

fn commit_personalization_changes(
    first: (&Path, Option<&str>, Option<&str>),
    second: (&Path, Option<&str>, Option<&str>),
) -> Result<bool, AppError> {
    let mut first_changed = false;
    if first.1 != first.2 {
        if let Some(next) = first.2 {
            codex_config::secure_atomic_write(first.0, next.as_bytes())?;
            first_changed = true;
        }
    }

    if second.1 != second.2 {
        if let Some(next) = second.2 {
            if let Err(error) = codex_config::secure_atomic_write(second.0, next.as_bytes()) {
                if first_changed {
                    if let Err(rollback_error) = restore_optional_text(first.0, first.1) {
                        return Err(AppError::Message(format!(
                            "更新 Codex 个性化失败: {error}; 回滚 AGENTS.md 失败: {rollback_error}"
                        )));
                    }
                }
                return Err(error);
            }
            return Ok(true);
        }
    }
    Ok(first_changed)
}

fn restore_optional_text(path: &Path, content: Option<&str>) -> Result<(), AppError> {
    if let Some(content) = content {
        return codex_config::secure_atomic_write(path, content.as_bytes());
    }
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(AppError::io(path, error)),
    }
}

/// Strip a complete Tuzi-managed block before persisting live AGENTS content
/// as a user prompt. Malformed marker text is preserved verbatim.
pub(crate) fn strip_valid_image_personalization(content: &str) -> String {
    merge_personalization(content, false).unwrap_or_else(|_| content.to_string())
}

fn read_optional_text(path: &Path) -> Result<Option<String>, AppError> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(AppError::io(path, error)),
    };
    let size = file
        .metadata()
        .map_err(|error| AppError::io(path, error))?
        .len();
    if size > MAX_AGENTS_BYTES {
        return Err(AppError::Config("Codex 个性化文件超过大小限制".to_string()));
    }
    let mut content = String::with_capacity(size as usize);
    file.take(MAX_AGENTS_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|error| AppError::io(path, error))?;
    if content.len() as u64 > MAX_AGENTS_BYTES {
        return Err(AppError::Config("Codex 个性化文件超过大小限制".to_string()));
    }
    Ok(Some(content))
}

fn merge_personalization(content: &str, enabled: bool) -> Result<String, AppError> {
    let (bom, body) = content
        .strip_prefix('\u{feff}')
        .map_or(("", content), |body| ("\u{feff}", body));
    let newline = if body.contains("\r\n") { "\r\n" } else { "\n" };
    let managed_range = managed_block_range(body)?;
    let clean = match managed_range {
        Some((start, end)) => {
            let mut value = String::with_capacity(body.len());
            value.push_str(&body[..start]);
            value.push_str(&body[end..]);
            value
        }
        None => body.to_string(),
    };
    if !enabled {
        return Ok(format!("{bom}{clean}"));
    }

    let mut managed = String::with_capacity(
        clean.len() + MANAGED_START.len() + MANAGED_INSTRUCTION.len() + MANAGED_END.len() + 6,
    );
    managed.push_str(bom);
    managed.push_str(MANAGED_START);
    managed.push_str(newline);
    managed.push_str(MANAGED_INSTRUCTION);
    managed.push_str(newline);
    managed.push_str(MANAGED_END);
    managed.push_str(newline);
    managed.push_str(&clean);
    Ok(managed)
}

fn managed_block_range(content: &str) -> Result<Option<(usize, usize)>, AppError> {
    let mut start = None;
    let mut end = None;
    let mut offset = 0usize;
    for line in content.split_inclusive('\n') {
        let text = line.strip_suffix('\n').unwrap_or(line);
        let text = text.strip_suffix('\r').unwrap_or(text);
        let line_end = offset + line.len();
        for (marker, slot) in [(MANAGED_START, &mut start), (MANAGED_END, &mut end)] {
            if text.contains(marker) {
                if text != marker || slot.is_some() {
                    return Err(malformed_markers());
                }
                *slot = Some((offset, line_end));
            }
        }
        offset = line_end;
    }
    match (start, end) {
        (None, None) => Ok(None),
        (Some((start, _)), Some((end_start, end))) if start < end_start => Ok(Some((start, end))),
        _ => Err(malformed_markers()),
    }
}

fn malformed_markers() -> AppError {
    AppError::Config("Codex 图片兼容个性化受管标记不完整或已损坏".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    fn config(base_url: &str, env_key: &str) -> String {
        format!(
            "model_provider = \"tuzi\"\n[model_providers.tuzi]\nbase_url = \"{base_url}\"\nenv_key = \"{env_key}\"\n"
        )
    }

    #[test]
    fn tuzi_source_accepts_only_exact_v1_and_coding_routes() {
        for accepted in [
            "https://api.tu-zi.com/v1",
            "https://api.tu-zi.com/v1/",
            "https://api.tu-zi.com/coding",
            "https://api.tu-zi.com/coding/",
        ] {
            assert!(is_supported_tuzi_image_source(accepted), "{accepted}");
        }
        for rejected in [
            "http://api.tu-zi.com/v1",
            "https://api.tu-zi.com.evil/v1",
            "https://evil@api.tu-zi.com/v1",
            "https://api.tu-zi.com/v1/images",
            "https://api.tu-zi.com/v1?x=1",
            "https://api.tu-zi.com/coding#x",
            "https://api.tu-zi.com:8443/v1",
        ] {
            assert!(!is_supported_tuzi_image_source(rejected), "{rejected}");
        }
    }

    #[test]
    fn personalization_preserves_bom_crlf_and_user_content() {
        let input = "\u{feff}用户内容\r\n第二行\r\n";
        let enabled = merge_personalization(input, true).expect("enable");
        assert!(enabled.starts_with(&format!("\u{feff}{MANAGED_START}\r\n")));
        assert!(enabled.ends_with("用户内容\r\n第二行\r\n"));
        assert!(enabled.contains(&format!("{MANAGED_START}\r\n{MANAGED_INSTRUCTION}\r\n")));
        assert!(!enabled.replace("\r\n", "").contains('\n'));
        let disabled = merge_personalization(&enabled, false).expect("disable");
        assert_eq!(disabled, input);
    }

    #[test]
    fn personalization_is_idempotent_and_replaces_owned_content() {
        let first = merge_personalization("用户内容", true).expect("first");
        let second = merge_personalization(&first, true).expect("second");
        assert_eq!(first, second);
        assert_eq!(second.matches(MANAGED_START).count(), 1);
        assert_eq!(
            merge_personalization(&second, false).expect("disable"),
            "用户内容"
        );
    }

    #[test]
    fn prompt_cleaning_strips_only_a_valid_managed_block() {
        let managed = merge_personalization("用户提示词\n", true).expect("managed");
        assert_eq!(strip_valid_image_personalization(&managed), "用户提示词\n");
        let malformed = format!("{MANAGED_START}\n用户提示词\n");
        assert_eq!(strip_valid_image_personalization(&malformed), malformed);
    }

    #[test]
    fn personalization_rejects_partial_duplicate_and_inline_markers() {
        for malformed in [
            MANAGED_START.to_string(),
            format!("{MANAGED_END}\n{MANAGED_START}\n"),
            format!("{MANAGED_START}\n{MANAGED_START}\n{MANAGED_END}\n"),
            format!("prefix {MANAGED_START}\n{MANAGED_END}\n"),
        ] {
            assert!(merge_personalization(&malformed, false).is_err());
        }
    }

    #[test]
    fn override_file_takes_personalization_priority() {
        let temp = tempfile::tempdir().expect("tempdir");
        let agents = temp.path().join(AGENTS_FILE);
        let override_path = temp.path().join(AGENTS_OVERRIDE_FILE);
        fs::write(&agents, "agents\n").expect("agents");
        fs::write(&override_path, "override\n").expect("override");

        assert!(reconcile_image_personalization_at(temp.path(), true).expect("enable"));
        assert!(!fs::read_to_string(&agents)
            .expect("read agents")
            .contains(MANAGED_START));
        assert!(fs::read_to_string(&override_path)
            .expect("read override")
            .contains(MANAGED_START));
        assert!(reconcile_image_personalization_at(temp.path(), false).expect("disable"));
        assert!(!fs::read_to_string(&override_path)
            .expect("read override")
            .contains(MANAGED_START));
    }

    #[test]
    #[serial]
    fn image_key_uses_auth_then_managed_env_then_process_env_without_mutating_target_env() {
        let temp = tempfile::tempdir().expect("tempdir");
        let old_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        let old_source = std::env::var_os("TUZI01_CODEX_API_KEY");
        let old_target = std::env::var_os(IMAGE_API_KEY_ENV);
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        std::env::set_var("TUZI01_CODEX_API_KEY", "process-key");
        std::env::set_var(IMAGE_API_KEY_ENV, "must-stay");

        let auth = serde_json::json!({
            "auth": {"OPENAI_API_KEY": "auth-key"},
            "config": config("https://api.tu-zi.com/v1", "TUZI01_CODEX_API_KEY")
        });
        assert!(reconcile_managed_image_api_key(Some(&auth)).expect("auth"));
        assert_eq!(
            read_managed_image_api_key().expect("read").as_deref(),
            Some("auth-key")
        );
        assert_eq!(std::env::var(IMAGE_API_KEY_ENV).as_deref(), Ok("must-stay"));

        codex_config::write_managed_env_key_file("TUZI01_CODEX_API_KEY", "managed-key")
            .expect("source managed");
        let managed = serde_json::json!({
            "auth": {},
            "config": config("https://api.tu-zi.com/coding", "TUZI01_CODEX_API_KEY")
        });
        assert!(reconcile_managed_image_api_key(Some(&managed)).expect("managed"));
        assert_eq!(
            read_managed_image_api_key().expect("read").as_deref(),
            Some("managed-key")
        );
        codex_config::remove_managed_env_key_file("TUZI01_CODEX_API_KEY").expect("remove source");
        assert!(reconcile_managed_image_api_key(Some(&managed)).expect("process"));
        assert_eq!(
            read_managed_image_api_key().expect("read").as_deref(),
            Some("process-key")
        );

        restore_env("CC_SWITCH_TEST_HOME", old_home);
        restore_env("TUZI01_CODEX_API_KEY", old_source);
        restore_env(IMAGE_API_KEY_ENV, old_target);
    }

    #[test]
    #[serial]
    fn non_tuzi_provider_cannot_read_arbitrary_process_env_and_clears_derived_key() {
        let temp = tempfile::tempdir().expect("tempdir");
        let old_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        let old_secret = std::env::var_os("AWS_SECRET_ACCESS_KEY");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        std::env::set_var("AWS_SECRET_ACCESS_KEY", "must-not-copy");
        codex_config::write_managed_env_key_file(IMAGE_API_KEY_ENV, "old-image-key")
            .expect("seed image key");
        let settings = serde_json::json!({
            "auth": {},
            "config": config("https://example.com/v1", "AWS_SECRET_ACCESS_KEY")
        });
        assert!(!reconcile_managed_image_api_key(Some(&settings)).expect("reject"));
        assert!(read_managed_image_api_key().expect("read").is_none());

        restore_env("CC_SWITCH_TEST_HOME", old_home);
        restore_env("AWS_SECRET_ACCESS_KEY", old_secret);
    }

    #[test]
    #[serial]
    fn tuzi_provider_cannot_read_arbitrary_process_env() {
        let temp = tempfile::tempdir().expect("tempdir");
        let old_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        let old_secret = std::env::var_os("AWS_SECRET_ACCESS_KEY");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        std::env::set_var("AWS_SECRET_ACCESS_KEY", "must-not-copy");
        let settings = serde_json::json!({
            "auth": {},
            "config": config("https://api.tu-zi.com/v1", "AWS_SECRET_ACCESS_KEY")
        });

        assert!(!reconcile_managed_image_api_key(Some(&settings)).expect("reject"));
        assert!(read_managed_image_api_key().expect("read").is_none());

        restore_env("CC_SWITCH_TEST_HOME", old_home);
        restore_env("AWS_SECRET_ACCESS_KEY", old_secret);
    }

    #[test]
    #[serial]
    fn invalid_provider_config_clears_previous_derived_key() {
        let temp = tempfile::tempdir().expect("tempdir");
        let old_home = std::env::var_os("CC_SWITCH_TEST_HOME");
        std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
        codex_config::write_managed_env_key_file(IMAGE_API_KEY_ENV, "old-image-key")
            .expect("seed image key");
        let settings = serde_json::json!({
            "auth": {"OPENAI_API_KEY": "new-key"},
            "config": "not valid toml = ["
        });

        assert!(reconcile_managed_image_api_key(Some(&settings)).is_err());
        assert!(read_managed_image_api_key().expect("read").is_none());
        restore_env("CC_SWITCH_TEST_HOME", old_home);
    }

    fn restore_env(name: &str, value: Option<std::ffi::OsString>) {
        match value {
            Some(value) => std::env::set_var(name, value),
            None => std::env::remove_var(name),
        }
    }
}
