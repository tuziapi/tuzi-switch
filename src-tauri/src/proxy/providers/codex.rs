//! Codex (OpenAI) Provider Adapter
//!
//! 仅透传模式，支持直连 OpenAI API
//!
//! ## 客户端检测
//! 支持检测官方 Codex 客户端 (codex_vscode, codex_cli_rs)

use super::adapter::auth_header_value;
use super::{AuthInfo, AuthStrategy, ProviderAdapter};
use crate::provider::{CodexChatReasoning, Provider};
use crate::proxy::error::ProxyError;
use regex::Regex;
use serde_json::Value as JsonValue;
use std::collections::{HashSet, VecDeque};
#[cfg(test)]
use std::fmt::Display;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime};
use tokio::sync::{Mutex as AsyncMutex, OwnedMutexGuard, OwnedSemaphorePermit, Semaphore};
use toml::Value as TomlValue;

/// 官方 Codex 客户端 User-Agent 正则
#[allow(dead_code)]
static CODEX_CLIENT_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(codex_vscode|codex_cli_rs)/[\d.]+").unwrap());

const TUZI_CODING_BASE_URL: &str = "https://api.tu-zi.com/coding";
const LEGACY_CODING_ENV_KEY: &str = "CODING_CODEX_API_KEY";
const CODING_ENV_KEY_PREFIX: &str = "CODING";
const CODEX_API_KEY_SUFFIX: &str = "_CODEX_API_KEY";
const ENV_KEY_CACHE_CAPACITY: usize = 8;
const ENV_KEY_CACHE_FILE_CHECK_INTERVAL: Duration = Duration::from_millis(250);
const ENV_KEY_CACHE_NEGATIVE_TTL: Duration = Duration::from_millis(250);
const ENV_KEY_CACHE_VALUE_TTL: Duration = Duration::from_secs(5);
const MAX_CACHED_ENV_KEY_BYTES: usize = 64 * 1024;
const MAX_CODEX_ENV_FILE_BYTES: u64 = 256 * 1024;
const PROXY_MANAGED_PLACEHOLDER: &str = "PROXY_MANAGED";
const ENV_KEY_BLOCKING_READ_LIMIT: usize = 8;

#[derive(Clone, Debug, Eq, PartialEq)]
struct CodexEnvFileFingerprint {
    len: u64,
    modified: SystemTime,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(windows)]
    volume_serial: Option<u32>,
    #[cfg(windows)]
    file_index: Option<u64>,
    #[cfg(not(any(unix, windows)))]
    created: Option<SystemTime>,
}

impl CodexEnvFileFingerprint {
    fn from_metadata(metadata: &fs::Metadata) -> std::io::Result<Self> {
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        #[cfg(windows)]
        use std::os::windows::fs::MetadataExt;

        Ok(Self {
            len: metadata.len(),
            modified: metadata.modified()?,
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
            #[cfg(windows)]
            volume_serial: metadata.volume_serial_number(),
            #[cfg(windows)]
            file_index: metadata.file_index(),
            #[cfg(not(any(unix, windows)))]
            created: metadata.created().ok(),
        })
    }

    #[cfg(test)]
    fn synthetic(identity: u64, modified_secs: u64, len: u64) -> Self {
        Self {
            len,
            modified: SystemTime::UNIX_EPOCH + Duration::from_secs(modified_secs),
            #[cfg(unix)]
            device: 1,
            #[cfg(unix)]
            inode: identity,
            #[cfg(windows)]
            volume_serial: Some(1),
            #[cfg(windows)]
            file_index: Some(identity),
            #[cfg(not(any(unix, windows)))]
            created: Some(SystemTime::UNIX_EPOCH + Duration::from_secs(identity)),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct CodexEnvCredentialCacheKey {
    path: PathBuf,
    env_key: String,
    fingerprint: Option<CodexEnvFileFingerprint>,
}

struct CachedCodexEnvCredential {
    key: CodexEnvCredentialCacheKey,
    value: Option<Vec<u8>>,
    loaded_at: Instant,
    last_file_check: Instant,
}

impl CachedCodexEnvCredential {
    fn exposed_value(&self) -> Option<String> {
        // Values enter the cache only after validation from a Rust String.
        self.value.as_ref().map(|value| {
            String::from_utf8(value.clone()).expect("cached Codex API key must remain UTF-8")
        })
    }
}

impl Drop for CachedCodexEnvCredential {
    fn drop(&mut self) {
        if let Some(value) = self.value.as_mut() {
            value.fill(0);
        }
    }
}

#[derive(Default)]
struct CodexEnvCredentialCache {
    entries: VecDeque<CachedCodexEnvCredential>,
}

impl CodexEnvCredentialCache {
    fn store(
        &mut self,
        path: &Path,
        env_key: &str,
        fingerprint: Option<CodexEnvFileFingerprint>,
        value: Option<&str>,
        now: Instant,
    ) -> Vec<CachedCodexEnvCredential> {
        let mut evicted = Vec::new();
        while let Some(index) = self
            .entries
            .iter()
            .position(|entry| entry.key.path == path && entry.key.env_key.as_str() == env_key)
        {
            if let Some(entry) = self.entries.remove(index) {
                evicted.push(entry);
            }
        }
        while self.entries.len() >= ENV_KEY_CACHE_CAPACITY {
            if let Some(entry) = self.entries.pop_front() {
                evicted.push(entry);
            }
        }
        self.entries.push_back(CachedCodexEnvCredential {
            key: CodexEnvCredentialCacheKey {
                path: path.to_path_buf(),
                env_key: env_key.to_string(),
                fingerprint,
            },
            value: value.map(|value| value.as_bytes().to_vec()),
            loaded_at: now,
            last_file_check: now,
        });
        evicted
    }

    #[cfg(test)]
    fn resolve<E>(
        &mut self,
        path: &Path,
        env_key: &str,
        now: Instant,
        mut fingerprint_file: impl FnMut(&Path) -> Result<Option<CodexEnvFileFingerprint>, E>,
        mut read_value: impl FnMut(&str) -> Result<Option<String>, E>,
    ) -> Result<Option<String>, E> {
        let existing_index = self
            .entries
            .iter()
            .position(|entry| entry.key.path == path && entry.key.env_key.as_str() == env_key);

        if let Some(index) = existing_index {
            let value_age = now
                .checked_duration_since(self.entries[index].loaded_at)
                .unwrap_or_default();

            if self.entries[index].value.is_none() {
                if value_age < ENV_KEY_CACHE_NEGATIVE_TTL {
                    return Ok(None);
                }
                self.entries.remove(index);
            } else if value_age < ENV_KEY_CACHE_VALUE_TTL {
                let file_check_age = now
                    .checked_duration_since(self.entries[index].last_file_check)
                    .unwrap_or_default();
                if file_check_age < ENV_KEY_CACHE_FILE_CHECK_INTERVAL {
                    return Ok(self.entries[index].exposed_value());
                }

                let expected = self.entries[index].key.fingerprint.clone();
                match fingerprint_file(path) {
                    Ok(current) if current == expected => {
                        self.entries[index].last_file_check = now;
                        return Ok(self.entries[index].exposed_value());
                    }
                    Ok(_) => {
                        self.entries.remove(index);
                    }
                    Err(error) => {
                        self.entries.remove(index);
                        drop(self.store(path, env_key, None, None, now));
                        return Err(error);
                    }
                }
            } else {
                self.entries.remove(index);
            }
        }

        let fingerprint_before = match fingerprint_file(path) {
            Ok(Some(fingerprint)) => fingerprint,
            Ok(None) => {
                drop(self.store(path, env_key, None, None, now));
                return Ok(None);
            }
            Err(error) => {
                drop(self.store(path, env_key, None, None, now));
                return Err(error);
            }
        };
        let value = match read_value(env_key) {
            Ok(value) => value.and_then(normalize_cached_env_key_value),
            Err(error) => {
                drop(self.store(path, env_key, Some(fingerprint_before), None, now));
                return Err(error);
            }
        };
        let Some(value) = value else {
            drop(self.store(path, env_key, Some(fingerprint_before), None, now));
            return Ok(None);
        };
        let fingerprint_after = match fingerprint_file(path) {
            Ok(fingerprint) => fingerprint,
            Err(error) => {
                drop(self.store(path, env_key, None, None, now));
                return Err(error);
            }
        };
        if fingerprint_after.as_ref() != Some(&fingerprint_before) {
            drop(self.store(path, env_key, fingerprint_after, None, now));
            return Ok(None);
        }

        drop(self.store(path, env_key, Some(fingerprint_before), Some(&value), now));
        Ok(Some(value))
    }

    fn lookup(
        &mut self,
        path: &Path,
        env_key: &str,
        now: Instant,
    ) -> (CodexEnvCredentialCacheLookup, Vec<CachedCodexEnvCredential>) {
        let Some(index) = self
            .entries
            .iter()
            .position(|entry| entry.key.path == path && entry.key.env_key == env_key)
        else {
            return (CodexEnvCredentialCacheLookup::Miss, Vec::new());
        };
        let value_age = now
            .checked_duration_since(self.entries[index].loaded_at)
            .unwrap_or_default();

        if self.entries[index].value.is_none() {
            if value_age < ENV_KEY_CACHE_NEGATIVE_TTL {
                return (CodexEnvCredentialCacheLookup::Hit(None), Vec::new());
            }
        } else if value_age < ENV_KEY_CACHE_VALUE_TTL {
            let file_check_age = now
                .checked_duration_since(self.entries[index].last_file_check)
                .unwrap_or_default();
            if file_check_age < ENV_KEY_CACHE_FILE_CHECK_INTERVAL {
                return (
                    CodexEnvCredentialCacheLookup::Hit(self.entries[index].exposed_value()),
                    Vec::new(),
                );
            }
            return (
                CodexEnvCredentialCacheLookup::NeedProbe(
                    self.entries[index].key.fingerprint.clone(),
                ),
                Vec::new(),
            );
        }

        let evicted = self.entries.remove(index).into_iter().collect();
        (CodexEnvCredentialCacheLookup::Miss, evicted)
    }

    fn refresh_after_unchanged_probe(
        &mut self,
        path: &Path,
        env_key: &str,
        expected: &Option<CodexEnvFileFingerprint>,
        now: Instant,
    ) -> Option<String> {
        let entry = self.entries.iter_mut().find(|entry| {
            entry.key.path == path
                && entry.key.env_key == env_key
                && entry.key.fingerprint == *expected
                && entry.value.is_some()
                && now
                    .checked_duration_since(entry.loaded_at)
                    .unwrap_or_default()
                    < ENV_KEY_CACHE_VALUE_TTL
        })?;
        entry.last_file_check = now;
        entry.exposed_value()
    }
}

enum CodexEnvCredentialCacheLookup {
    Hit(Option<String>),
    NeedProbe(Option<CodexEnvFileFingerprint>),
    Miss,
}

#[derive(Default)]
struct CodexEnvCredentialCacheCoordinator {
    cache: CodexEnvCredentialCache,
}

static CODEX_ENV_CREDENTIAL_CACHE: LazyLock<Arc<Mutex<CodexEnvCredentialCacheCoordinator>>> =
    LazyLock::new(|| Arc::new(Mutex::new(CodexEnvCredentialCacheCoordinator::default())));
static CODEX_ENV_CREDENTIAL_GATES: LazyLock<Vec<Arc<AsyncMutex<()>>>> =
    LazyLock::new(|| (0..100).map(|_| Arc::new(AsyncMutex::new(()))).collect());
static CODEX_ENV_CREDENTIAL_READ_LIMIT: LazyLock<Arc<Semaphore>> =
    LazyLock::new(|| Arc::new(Semaphore::new(ENV_KEY_BLOCKING_READ_LIMIT)));

fn normalize_provider_api_key(value: &str) -> Option<String> {
    if value.len() > MAX_CACHED_ENV_KEY_BYTES || value.chars().any(char::is_control) {
        return None;
    }
    let value = value.trim();
    (!value.is_empty()
        && value != PROXY_MANAGED_PLACEHOLDER
        && value.len() <= MAX_CACHED_ENV_KEY_BYTES)
        .then(|| value.to_string())
}

#[cfg(test)]
fn normalize_cached_env_key_value(value: String) -> Option<String> {
    normalize_provider_api_key(&value)
}

fn coding_env_key_allowed(env_key: &str) -> bool {
    env_key_gate_index(env_key).is_some()
}

fn env_key_gate_index(env_key: &str) -> Option<usize> {
    if env_key == LEGACY_CODING_ENV_KEY {
        return Some(0);
    }
    let Some(number) = env_key
        .strip_prefix(CODING_ENV_KEY_PREFIX)
        .and_then(|value| value.strip_suffix(CODEX_API_KEY_SUFFIX))
    else {
        return None;
    };
    if number.len() != 2 || !number.as_bytes().iter().all(u8::is_ascii_digit) {
        return None;
    }
    number
        .parse::<usize>()
        .ok()
        .filter(|index| (1..=99).contains(index))
}

fn is_tuzi_coding_base_url(base_url: &str) -> bool {
    base_url == TUZI_CODING_BASE_URL
        || base_url
            .strip_suffix('/')
            .is_some_and(|value| value == TUZI_CODING_BASE_URL)
}

fn effective_codex_base_url(provider: &Provider) -> Option<String> {
    if let Some(value) = provider
        .settings_config
        .get("base_url")
        .and_then(JsonValue::as_str)
    {
        return Some(value.to_string());
    }
    if let Some(value) = provider
        .settings_config
        .get("baseURL")
        .and_then(JsonValue::as_str)
    {
        return Some(value.to_string());
    }
    if let Some(config) = provider.settings_config.get("config") {
        if config.is_object() {
            return config
                .get("base_url")
                .and_then(JsonValue::as_str)
                .map(ToString::to_string);
        }
        return config.as_str().and_then(extract_codex_base_url_from_toml);
    }
    None
}

fn fingerprint_codex_env_file(path: &Path) -> Result<Option<CodexEnvFileFingerprint>, String> {
    match fs::metadata(path) {
        Ok(metadata) => CodexEnvFileFingerprint::from_metadata(&metadata)
            .map(Some)
            .map_err(|error| error.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

struct SensitiveBytes(Vec<u8>);

impl Drop for SensitiveBytes {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}

struct SensitiveString(String);

impl Drop for SensitiveString {
    fn drop(&mut self) {
        // SAFETY: replacing bytes with zero preserves the string's UTF-8 validity.
        unsafe {
            self.0.as_bytes_mut().fill(0);
        }
    }
}

fn read_codex_env_key_from_path(path: &Path, env_key: &str) -> Result<Option<String>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let size = file.metadata().map_err(|error| error.to_string())?.len();
    if size > MAX_CODEX_ENV_FILE_BYTES {
        return Err("Codex .env 文件超过大小限制".to_string());
    }

    let mut content = SensitiveBytes(Vec::with_capacity(size as usize));
    file.take(MAX_CODEX_ENV_FILE_BYTES + 1)
        .read_to_end(&mut content.0)
        .map_err(|error| error.to_string())?;
    if content.0.len() as u64 > MAX_CODEX_ENV_FILE_BYTES {
        return Err("Codex .env 文件超过大小限制".to_string());
    }

    let content_str = std::str::from_utf8(&content.0).map_err(|error| error.to_string())?;
    let mut values = crate::gemini_config::parse_env_file(content_str);
    let selected = values.remove(env_key).map(SensitiveString);
    for (_, value) in values {
        drop(SensitiveString(value));
    }
    Ok(selected.and_then(|value| normalize_provider_api_key(&value.0)))
}

type CodexEnvFingerprintReader =
    Arc<dyn Fn(&Path) -> Result<Option<CodexEnvFileFingerprint>, String> + Send + Sync>;
type CodexEnvValueReader = Arc<dyn Fn(&Path, &str) -> Result<Option<String>, String> + Send + Sync>;

enum CodexEnvCredentialBlockingAction {
    Probe(Option<CodexEnvFileFingerprint>),
    Load,
}

fn cache_lookup(
    coordinator: &Arc<Mutex<CodexEnvCredentialCacheCoordinator>>,
    path: &Path,
    env_key: &str,
) -> CodexEnvCredentialCacheLookup {
    let (lookup, evicted) = {
        let mut coordinator = coordinator
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        coordinator.cache.lookup(path, env_key, Instant::now())
    };
    drop(evicted);
    lookup
}

fn store_cache_entry(
    coordinator: &Arc<Mutex<CodexEnvCredentialCacheCoordinator>>,
    path: &Path,
    env_key: &str,
    fingerprint: Option<CodexEnvFileFingerprint>,
    value: Option<&str>,
) {
    let evicted = {
        let mut coordinator = coordinator
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        coordinator
            .cache
            .store(path, env_key, fingerprint, value, Instant::now())
    };
    drop(evicted);
}

fn resolve_codex_env_key_blocking(
    coordinator: Arc<Mutex<CodexEnvCredentialCacheCoordinator>>,
    path: PathBuf,
    env_key: String,
    action: CodexEnvCredentialBlockingAction,
    fingerprint_file: CodexEnvFingerprintReader,
    read_value: CodexEnvValueReader,
    _gate_guard: OwnedMutexGuard<()>,
    _read_permit: OwnedSemaphorePermit,
) -> Result<Option<String>, String> {
    let fingerprint_before = match action {
        CodexEnvCredentialBlockingAction::Probe(expected) => {
            let current = match fingerprint_file(&path) {
                Ok(current) => current,
                Err(error) => {
                    store_cache_entry(&coordinator, &path, &env_key, None, None);
                    return Err(error);
                }
            };
            if current == expected {
                let cached = {
                    let mut coordinator = coordinator
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    coordinator.cache.refresh_after_unchanged_probe(
                        &path,
                        &env_key,
                        &expected,
                        Instant::now(),
                    )
                };
                if cached.is_some() {
                    return Ok(cached);
                }
            }
            let Some(fingerprint) = current else {
                store_cache_entry(&coordinator, &path, &env_key, None, None);
                return Ok(None);
            };
            fingerprint
        }
        CodexEnvCredentialBlockingAction::Load => match fingerprint_file(&path) {
            Ok(Some(fingerprint)) => fingerprint,
            Ok(None) => {
                store_cache_entry(&coordinator, &path, &env_key, None, None);
                return Ok(None);
            }
            Err(error) => {
                store_cache_entry(&coordinator, &path, &env_key, None, None);
                return Err(error);
            }
        },
    };
    let value = match read_value(&path, &env_key) {
        Ok(value) => value.and_then(|value| {
            let value = SensitiveString(value);
            normalize_provider_api_key(&value.0)
        }),
        Err(error) => {
            store_cache_entry(
                &coordinator,
                &path,
                &env_key,
                Some(fingerprint_before),
                None,
            );
            return Err(error);
        }
    };
    let Some(value) = value.map(SensitiveString) else {
        store_cache_entry(
            &coordinator,
            &path,
            &env_key,
            Some(fingerprint_before),
            None,
        );
        return Ok(None);
    };
    let fingerprint_after = match fingerprint_file(&path) {
        Ok(fingerprint) => fingerprint,
        Err(error) => {
            store_cache_entry(&coordinator, &path, &env_key, None, None);
            return Err(error);
        }
    };
    if fingerprint_after.as_ref() != Some(&fingerprint_before) {
        store_cache_entry(&coordinator, &path, &env_key, fingerprint_after, None);
        return Ok(None);
    }

    store_cache_entry(
        &coordinator,
        &path,
        &env_key,
        Some(fingerprint_before),
        Some(&value.0),
    );
    Ok(Some(value.0.clone()))
}

async fn resolve_cached_codex_env_key_with(
    coordinator: Arc<Mutex<CodexEnvCredentialCacheCoordinator>>,
    read_limit: Arc<Semaphore>,
    path: PathBuf,
    env_key: String,
    fingerprint_file: CodexEnvFingerprintReader,
    read_value: CodexEnvValueReader,
) -> Result<Option<String>, String> {
    if let CodexEnvCredentialCacheLookup::Hit(value) = cache_lookup(&coordinator, &path, &env_key) {
        return Ok(value);
    }

    let gate_index = env_key_gate_index(&env_key)
        .ok_or_else(|| format!("Codex env_key 不在允许列表: {env_key}"))?;
    let gate = Arc::clone(&CODEX_ENV_CREDENTIAL_GATES[gate_index]);
    let gate_guard = gate.lock_owned().await;

    let action = match cache_lookup(&coordinator, &path, &env_key) {
        CodexEnvCredentialCacheLookup::Hit(value) => return Ok(value),
        CodexEnvCredentialCacheLookup::NeedProbe(expected) => {
            CodexEnvCredentialBlockingAction::Probe(expected)
        }
        CodexEnvCredentialCacheLookup::Miss => CodexEnvCredentialBlockingAction::Load,
    };
    let read_permit = read_limit
        .acquire_owned()
        .await
        .map_err(|error| error.to_string())?;

    tokio::task::spawn_blocking(move || {
        resolve_codex_env_key_blocking(
            coordinator,
            path,
            env_key,
            action,
            fingerprint_file,
            read_value,
            gate_guard,
            read_permit,
        )
    })
    .await
    .map_err(|error| format!("Codex .env 后台读取失败: {error}"))?
}

async fn read_cached_codex_env_key(env_key: &str) -> Result<Option<String>, String> {
    let path = crate::codex_config::get_codex_config_dir().join(".env");
    resolve_cached_codex_env_key_with(
        Arc::clone(&CODEX_ENV_CREDENTIAL_CACHE),
        Arc::clone(&CODEX_ENV_CREDENTIAL_READ_LIMIT),
        path,
        env_key.to_string(),
        Arc::new(fingerprint_codex_env_file),
        Arc::new(read_codex_env_key_from_path),
    )
    .await
}

/// Codex 适配器
pub struct CodexAdapter;

/// Whether this Codex provider's real upstream should be called through
/// OpenAI Chat Completions, even if the local Codex client talks to tuzi-switch
/// through the Responses API.
pub fn codex_provider_uses_chat_completions(provider: &Provider) -> bool {
    if let Some(api_format) = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.api_format.as_deref())
        .or_else(|| {
            provider
                .settings_config
                .get("api_format")
                .and_then(|v| v.as_str())
        })
        .or_else(|| {
            provider
                .settings_config
                .get("apiFormat")
                .and_then(|v| v.as_str())
        })
    {
        return is_chat_wire_api(api_format);
    }

    if let Some(wire_api) = provider
        .settings_config
        .get("config")
        .and_then(|v| v.as_str())
        .and_then(extract_codex_wire_api_from_toml)
    {
        return is_chat_wire_api(&wire_api);
    }

    if let Some(base_url) = provider
        .settings_config
        .get("base_url")
        .or_else(|| provider.settings_config.get("baseURL"))
        .and_then(|v| v.as_str())
    {
        return is_chat_completions_url(base_url);
    }

    provider
        .settings_config
        .get("config")
        .and_then(|v| v.as_str())
        .and_then(extract_codex_base_url_from_toml)
        .map(|url| is_chat_completions_url(&url))
        .unwrap_or(false)
}

pub fn should_convert_codex_responses_to_chat(provider: &Provider, endpoint: &str) -> bool {
    let path = endpoint
        .split_once('?')
        .map_or(endpoint, |(path, _query)| path);

    matches!(
        path,
        "/responses" | "/v1/responses" | "/responses/compact" | "/v1/responses/compact"
    ) && codex_provider_uses_chat_completions(provider)
}

fn codex_provider_upstream_model(provider: &Provider) -> Option<String> {
    provider
        .settings_config
        .get("model")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(ToString::to_string)
        .or_else(|| {
            provider
                .settings_config
                .get("config")
                .and_then(|v| v.as_str())
                .and_then(extract_codex_model_from_toml)
        })
}

fn codex_provider_catalog_model_ids(provider: &Provider) -> HashSet<String> {
    provider
        .settings_config
        .get("modelCatalog")
        .and_then(|catalog| catalog.get("models"))
        .and_then(|models| models.as_array())
        .map(|models| {
            models
                .iter()
                .filter_map(|model| model.get("model").and_then(|value| value.as_str()))
                .map(str::trim)
                .filter(|model| !model.is_empty())
                .map(ToString::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// For Codex Chat providers, ensure the request uses the configured upstream
/// model before converting the request to Chat Completions.
pub fn apply_codex_chat_upstream_model(
    provider: &Provider,
    body: &mut JsonValue,
) -> Option<String> {
    if !codex_provider_uses_chat_completions(provider) {
        return None;
    }

    let catalog_model_ids = codex_provider_catalog_model_ids(provider);
    if let Some(request_model) = body
        .get("model")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|model| !model.is_empty())
    {
        if catalog_model_ids.contains(request_model) {
            return Some(request_model.to_string());
        }
    }

    let upstream_model = codex_provider_upstream_model(provider)?;
    body["model"] = JsonValue::String(upstream_model.clone());
    Some(upstream_model)
}

pub fn resolve_codex_chat_reasoning_config(
    provider: &Provider,
    body: &JsonValue,
) -> Option<CodexChatReasoning> {
    if let Some(config) = provider
        .meta
        .as_ref()
        .and_then(|meta| meta.codex_chat_reasoning.clone())
    {
        return Some(normalize_codex_chat_reasoning_config(config));
    }

    infer_codex_chat_reasoning_config(provider, body)
}

fn normalize_codex_chat_reasoning_config(mut config: CodexChatReasoning) -> CodexChatReasoning {
    if config.supports_effort.unwrap_or(false) && config.supports_thinking.is_none() {
        config.supports_thinking = Some(true);
    }
    config
}

fn infer_codex_chat_reasoning_config(
    provider: &Provider,
    body: &JsonValue,
) -> Option<CodexChatReasoning> {
    let model = body
        .get("model")
        .and_then(|value| value.as_str())
        .map(ToString::to_string)
        .or_else(|| codex_provider_upstream_model(provider))
        .unwrap_or_default()
        .to_ascii_lowercase();
    let base_url = provider
        .settings_config
        .get("base_url")
        .or_else(|| provider.settings_config.get("baseURL"))
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
        .or_else(|| {
            provider
                .settings_config
                .get("config")
                .and_then(|v| v.as_str())
                .and_then(extract_codex_base_url_from_toml)
        })
        .unwrap_or_default()
        .to_ascii_lowercase();
    let name = provider.name.to_ascii_lowercase();

    if let Some(config) = infer_aggregator_platform_config(&name, &base_url) {
        return Some(config);
    }

    let haystack = format!("{name} {base_url} {model}");

    if haystack.contains("deepseek") {
        return Some(CodexChatReasoning {
            supports_thinking: Some(true),
            supports_effort: Some(true),
            thinking_param: Some("thinking".to_string()),
            effort_param: Some("reasoning_effort".to_string()),
            effort_value_mode: Some("deepseek".to_string()),
            output_format: Some("reasoning_content".to_string()),
        });
    }

    if haystack.contains("stepfun") || haystack.contains("step-3.5-flash-2603") {
        return Some(CodexChatReasoning {
            supports_thinking: Some(true),
            supports_effort: Some(model.contains("2603")),
            thinking_param: Some("none".to_string()),
            effort_param: Some("reasoning_effort".to_string()),
            effort_value_mode: Some("low_high".to_string()),
            output_format: Some("reasoning".to_string()),
        });
    }

    if haystack.contains("kimi") || haystack.contains("moonshot") {
        return Some(CodexChatReasoning {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("thinking".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_content".to_string()),
        });
    }

    if haystack.contains("glm") || haystack.contains("zhipu") || haystack.contains("z.ai") {
        return Some(CodexChatReasoning {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("thinking".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_content".to_string()),
        });
    }

    if haystack.contains("qwen") || haystack.contains("dashscope") || haystack.contains("bailian") {
        return Some(CodexChatReasoning {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("enable_thinking".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_content".to_string()),
        });
    }

    if haystack.contains("minimax") {
        return Some(CodexChatReasoning {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("reasoning_split".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_details".to_string()),
        });
    }

    if haystack.contains("mimo") {
        return Some(CodexChatReasoning {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("thinking".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_content".to_string()),
        });
    }

    None
}

fn infer_aggregator_platform_config(name: &str, base_url: &str) -> Option<CodexChatReasoning> {
    let platform = format!("{name} {base_url}");

    if platform.contains("openrouter") {
        return Some(CodexChatReasoning {
            supports_thinking: Some(false),
            supports_effort: Some(true),
            thinking_param: Some("none".to_string()),
            effort_param: Some("reasoning.effort".to_string()),
            effort_value_mode: Some("openrouter".to_string()),
            output_format: Some("auto".to_string()),
        });
    }

    if platform.contains("siliconflow") {
        return Some(CodexChatReasoning {
            supports_thinking: Some(true),
            supports_effort: Some(false),
            thinking_param: Some("enable_thinking".to_string()),
            effort_param: Some("none".to_string()),
            effort_value_mode: None,
            output_format: Some("reasoning_content".to_string()),
        });
    }

    None
}

fn is_chat_wire_api(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "chat"
            | "chat_completions"
            | "chat-completions"
            | "openai_chat"
            | "openai-chat"
            | "openai_chat_completions"
    )
}

fn is_chat_completions_url(value: &str) -> bool {
    value
        .trim_end_matches('/')
        .to_ascii_lowercase()
        .ends_with("/chat/completions")
}

fn extract_codex_wire_api_from_toml(config_text: &str) -> Option<String> {
    let doc = config_text.parse::<TomlValue>().ok()?;

    if let Some(active_provider) = doc.get("model_provider").and_then(|v| v.as_str()) {
        if let Some(wire_api) = doc
            .get("model_providers")
            .and_then(|providers| providers.get(active_provider))
            .and_then(|provider| provider.get("wire_api"))
            .and_then(|v| v.as_str())
        {
            return Some(wire_api.to_string());
        }
    }

    doc.get("wire_api")
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
}

fn extract_codex_model_from_toml(config_text: &str) -> Option<String> {
    let doc = config_text.parse::<TomlValue>().ok()?;

    doc.get("model")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(ToString::to_string)
}

fn extract_codex_base_url_from_toml(config_text: &str) -> Option<String> {
    let doc = config_text.parse::<TomlValue>().ok()?;

    if let Some(active_provider) = doc.get("model_provider").and_then(|v| v.as_str()) {
        if let Some(base_url) = doc
            .get("model_providers")
            .and_then(|providers| providers.get(active_provider))
            .and_then(|provider| provider.get("base_url"))
            .and_then(|v| v.as_str())
        {
            return Some(base_url.to_string());
        }
    }

    doc.get("base_url")
        .and_then(|v| v.as_str())
        .map(ToString::to_string)
}

impl CodexAdapter {
    pub fn new() -> Self {
        Self
    }

    /// 检测是否为官方 Codex 客户端
    ///
    /// 匹配 User-Agent 模式: `^(codex_vscode|codex_cli_rs)/[\d.]+`
    #[allow(dead_code)]
    pub fn is_official_client(user_agent: &str) -> bool {
        CODEX_CLIENT_REGEX.is_match(user_agent)
    }

    /// 仅解析 Provider 中显式保存的 API Key，不访问磁盘。
    fn extract_explicit_key(&self, provider: &Provider) -> Option<String> {
        // 1. 尝试从 env 中获取
        if let Some(env) = provider.settings_config.get("env") {
            if let Some(key) = env.get("OPENAI_API_KEY").and_then(|v| v.as_str()) {
                if let Some(key) = normalize_provider_api_key(key) {
                    return Some(key);
                }
            }
        }

        // 2. 尝试从 auth 中获取 (Codex CLI 格式)
        if let Some(auth) = provider.settings_config.get("auth") {
            if let Some(key) = auth.get("OPENAI_API_KEY").and_then(|v| v.as_str()) {
                if let Some(key) = normalize_provider_api_key(key) {
                    return Some(key);
                }
            }
        }

        // 3. 尝试直接获取
        if let Some(key) = provider
            .settings_config
            .get("apiKey")
            .or_else(|| provider.settings_config.get("api_key"))
            .and_then(|v| v.as_str())
        {
            if let Some(key) = normalize_provider_api_key(key) {
                return Some(key);
            }
        }

        // 4. 尝试从 config 对象中获取
        provider
            .settings_config
            .get("config")
            .and_then(|config| {
                config
                    .get("api_key")
                    .or_else(|| config.get("apiKey"))
                    .and_then(|v| v.as_str())
            })
            .and_then(normalize_provider_api_key)
    }

    fn eligible_env_key(provider: &Provider) -> Option<String> {
        let config = provider.settings_config.get("config");
        let config_text = config.and_then(JsonValue::as_str);
        let env_key = config_text
            .and_then(crate::codex_config::extract_codex_env_key)
            .or_else(|| {
                provider
                    .settings_config
                    .pointer("/env/envKey")
                    .and_then(JsonValue::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })?;
        effective_codex_base_url(provider)
            .as_deref()
            .is_some_and(is_tuzi_coding_base_url)
            .then_some(env_key)
            .filter(|key| coding_env_key_allowed(key))
    }

    fn extract_legacy_bearer(provider: &Provider) -> Option<String> {
        provider
            .settings_config
            .get("config")
            .and_then(JsonValue::as_str)
            .and_then(crate::codex_config::extract_codex_experimental_bearer_token)
            .and_then(|key| normalize_provider_api_key(&key))
    }

    #[cfg(test)]
    fn extract_key_with_env_reader<E>(
        &self,
        provider: &Provider,
        read_env_key: impl Fn(&str) -> Result<Option<String>, E>,
    ) -> Option<String>
    where
        E: Display,
    {
        if let Some(key) = self.extract_explicit_key(provider) {
            return Some(key);
        }

        // 5. 官方 Codex Provider 只保存 env_key，真实 Key 位于 ~/.codex/.env。
        // TOML 是活动配置的权威来源，旧版 env.envKey 仅作为兼容回退。
        if let Some(env_key) = Self::eligible_env_key(provider) {
            match read_env_key(&env_key) {
                Ok(Some(key)) => {
                    if let Some(key) = normalize_provider_api_key(&key) {
                        return Some(key);
                    }
                }
                Ok(None) => {}
                Err(error) => {
                    log::warn!("[Codex] 读取 env_key {env_key} 失败: {error}");
                }
            }
        }

        // 6. 兼容旧版直接写入 TOML 的 Bearer Token。
        Self::extract_legacy_bearer(provider)
    }
}

/// 解析 Codex 认证。显式 Key 优先；仅受信任 Coding 上游可异步读取 `.env`。
pub(crate) async fn resolve_codex_auth(provider: &Provider) -> Option<AuthInfo> {
    let adapter = CodexAdapter::new();
    if let Some(key) = adapter.extract_explicit_key(provider) {
        return Some(AuthInfo::new(key, AuthStrategy::Bearer));
    }

    if let Some(env_key) = CodexAdapter::eligible_env_key(provider) {
        match read_cached_codex_env_key(&env_key).await {
            Ok(Some(key)) => return Some(AuthInfo::new(key, AuthStrategy::Bearer)),
            Ok(None) => {}
            Err(error) => log::warn!("[Codex] 读取 env_key {env_key} 失败: {error}"),
        }
    }

    CodexAdapter::extract_legacy_bearer(provider)
        .map(|key| AuthInfo::new(key, AuthStrategy::Bearer))
}

impl Default for CodexAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl ProviderAdapter for CodexAdapter {
    fn name(&self) -> &'static str {
        "Codex"
    }

    fn extract_base_url(&self, provider: &Provider) -> Result<String, ProxyError> {
        effective_codex_base_url(provider)
            .map(|url| url.trim_end_matches('/').to_string())
            .ok_or_else(|| ProxyError::ConfigError("Codex Provider 缺少 base_url 配置".to_string()))
    }

    fn extract_auth(&self, provider: &Provider) -> Option<AuthInfo> {
        self.extract_explicit_key(provider)
            .or_else(|| Self::extract_legacy_bearer(provider))
            .map(|key| AuthInfo::new(key, AuthStrategy::Bearer))
    }

    fn build_url(&self, base_url: &str, endpoint: &str) -> String {
        let base_trimmed = base_url.trim_end_matches('/');
        let endpoint_trimmed = endpoint.trim_start_matches('/');

        // OpenAI/Codex 的 base_url 可能是：
        // - 纯 origin: https://api.openai.com  (需要自动补 /v1)
        // - 已含 /v1: https://api.openai.com/v1 (直接拼接)
        // - 自定义前缀: https://xxx/openai (不添加 /v1，直接拼接)

        // 检查 base_url 是否已经包含 /v1
        let already_has_v1 = base_trimmed.ends_with("/v1");

        // 检查是否是纯 origin（没有路径部分）
        let origin_only = match base_trimmed.split_once("://") {
            Some((_scheme, rest)) => !rest.contains('/'),
            None => !base_trimmed.contains('/'),
        };

        let mut url = if already_has_v1 {
            // 已经有 /v1，直接拼接
            format!("{base_trimmed}/{endpoint_trimmed}")
        } else if origin_only {
            // 纯 origin，添加 /v1
            format!("{base_trimmed}/v1/{endpoint_trimmed}")
        } else {
            // 自定义前缀，不添加 /v1，直接拼接
            format!("{base_trimmed}/{endpoint_trimmed}")
        };

        // 去除重复的 /v1/v1（可能由 base_url 与 endpoint 都带版本导致）
        while url.contains("/v1/v1") {
            url = url.replace("/v1/v1", "/v1");
        }

        url
    }

    fn get_auth_headers(&self, auth: &AuthInfo) -> Vec<(http::HeaderName, http::HeaderValue)> {
        let bearer = format!("Bearer {}", auth.api_key);
        auth_header_value(
            self.name(),
            http::HeaderName::from_static("authorization"),
            &bearer,
        )
        .into_iter()
        .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::ProviderMeta;
    use serde_json::json;
    use std::cell::Cell;
    use std::sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc,
    };
    use std::thread;

    fn create_provider(config: serde_json::Value) -> Provider {
        Provider {
            id: "test".to_string(),
            name: "Test Codex".to_string(),
            settings_config: config,
            website_url: None,
            category: Some("codex".to_string()),
            created_at: None,
            sort_index: None,
            notes: None,
            meta: None,
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        }
    }

    fn create_provider_with_meta(config: serde_json::Value, meta: ProviderMeta) -> Provider {
        let mut provider = create_provider(config);
        provider.meta = Some(meta);
        provider
    }

    fn coding_toml(base_url: &str, env_key: &str) -> String {
        format!(
            r#"model_provider = "tuzi"

[model_providers.tuzi]
base_url = "{base_url}"
env_key = "{env_key}"
"#
        )
    }

    #[test]
    fn test_extract_base_url_direct() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "base_url": "https://api.openai.com/v1"
        }));

        let url = adapter.extract_base_url(&provider).unwrap();
        assert_eq!(url, "https://api.openai.com/v1");
    }

    #[test]
    fn test_effective_base_url_uses_forwarder_precedence() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "base_url": "https://first.example/v1/",
            "baseURL": "https://second.example/v1",
            "config": coding_toml(TUZI_CODING_BASE_URL, "CODING01_CODEX_API_KEY")
        }));
        assert_eq!(
            adapter.extract_base_url(&provider).unwrap(),
            "https://first.example/v1"
        );

        let provider = create_provider(json!({
            "baseURL": "https://second.example/v1/",
            "config": coding_toml(TUZI_CODING_BASE_URL, "CODING01_CODEX_API_KEY")
        }));
        assert_eq!(
            adapter.extract_base_url(&provider).unwrap(),
            "https://second.example/v1"
        );

        let provider = create_provider(json!({
            "base_url": { "unexpected": true },
            "baseURL": "https://fallback.example/v1/",
            "config": coding_toml(TUZI_CODING_BASE_URL, "CODING01_CODEX_API_KEY")
        }));
        assert_eq!(
            adapter.extract_base_url(&provider).unwrap(),
            "https://fallback.example/v1"
        );

        let provider = create_provider(json!({
            "config": { "base_url": "https://object.example/v1/" }
        }));
        assert_eq!(
            adapter.extract_base_url(&provider).unwrap(),
            "https://object.example/v1"
        );
    }

    #[test]
    fn test_tuzi_coding_url_match_is_exact() {
        for accepted in [
            "https://api.tu-zi.com/coding",
            "https://api.tu-zi.com/coding/",
        ] {
            assert!(is_tuzi_coding_base_url(accepted), "{accepted}");
        }
        for rejected in [
            " https://api.tu-zi.com/coding",
            "https://api.tu-zi.com/coding/ ",
            "http://api.tu-zi.com/coding",
            "https://API.TU-ZI.COM/coding",
            "https://api.tu-zi.com:443/coding",
            "https://user@api.tu-zi.com/coding",
            "https://api.tu-zi.com.evil/coding",
            "https://api.tu-zi.com/coding//",
            "https://api.tu-zi.com/coding/v1",
            "https://api.tu-zi.com/coding?x=1",
            "https://api.tu-zi.com/coding#x",
        ] {
            assert!(!is_tuzi_coding_base_url(rejected), "{rejected}");
        }
    }

    #[test]
    fn test_coding_env_key_allowlist_is_narrow_and_bounded() {
        for accepted in [
            "CODING_CODEX_API_KEY",
            "CODING01_CODEX_API_KEY",
            "CODING50_CODEX_API_KEY",
            "CODING99_CODEX_API_KEY",
        ] {
            assert!(coding_env_key_allowed(accepted), "{accepted}");
        }
        for rejected in [
            "OPENAI_API_KEY",
            "TUZI_CODEX_API_KEY",
            "TUZI01_CODEX_API_KEY",
            "TUZI_CODEX_IMAGE_API_KEY",
            "CODING00_CODEX_API_KEY",
            "CODING1_CODEX_API_KEY",
            "CODING001_CODEX_API_KEY",
            "CODING100_CODEX_API_KEY",
            "CODINGAA_CODEX_API_KEY",
            "coding01_CODEX_API_KEY",
            "CUSTOM_SECRET",
        ] {
            assert!(!coding_env_key_allowed(rejected), "{rejected}");
        }
    }

    #[test]
    fn test_provider_api_key_validation_rejects_placeholders_and_unsafe_values() {
        assert_eq!(
            normalize_provider_api_key("  live-key  ").as_deref(),
            Some("live-key")
        );
        for rejected in ["", "   ", "PROXY_MANAGED", " PROXY_MANAGED ", "key\nvalue"] {
            assert!(
                normalize_provider_api_key(rejected).is_none(),
                "{rejected:?}"
            );
        }
        assert!(normalize_provider_api_key(&"x".repeat(MAX_CACHED_ENV_KEY_BYTES + 1)).is_none());
        assert!(normalize_provider_api_key(&"x".repeat(MAX_CACHED_ENV_KEY_BYTES)).is_some());
    }

    #[test]
    fn test_extract_auth_from_auth_field() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "auth": {
                "OPENAI_API_KEY": "sk-test-key-12345678"
            }
        }));

        let auth = adapter.extract_auth(&provider).unwrap();
        assert_eq!(auth.api_key, "sk-test-key-12345678");
        assert_eq!(auth.strategy, AuthStrategy::Bearer);
    }

    #[test]
    fn test_extract_auth_from_env() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "env": {
                "OPENAI_API_KEY": "sk-env-key-12345678"
            }
        }));

        let auth = adapter.extract_auth(&provider).unwrap();
        assert_eq!(auth.api_key, "sk-env-key-12345678");
    }

    #[test]
    fn test_extract_auth_from_codex_dotenv_env_key() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "auth": {},
            "env": { "envKey": "CODING02_CODEX_API_KEY" },
            "config": r#"model_provider = "tuzi"

[model_providers.tuzi]
base_url = "https://api.tu-zi.com/coding"
env_key = "CODING02_CODEX_API_KEY"
"#
        }));

        let key = adapter.extract_key_with_env_reader(&provider, |env_key| {
            assert_eq!(env_key, "CODING02_CODEX_API_KEY");
            Ok::<_, &str>(Some("dotenv-key".to_string()))
        });
        assert_eq!(key.as_deref(), Some("dotenv-key"));
    }

    #[test]
    fn test_extract_auth_reads_env_only_for_effective_coding_route() {
        let adapter = CodexAdapter::new();
        for invalid_url in [
            "https://attacker.example/v1",
            "https://api.tu-zi.com/coding?x=1",
            "https://api.tu-zi.com/coding/v1",
        ] {
            let provider = create_provider(json!({
                "base_url": invalid_url,
                "config": coding_toml(TUZI_CODING_BASE_URL, "CODING02_CODEX_API_KEY")
            }));
            let calls = Cell::new(0);
            let key = adapter.extract_key_with_env_reader(&provider, |_| {
                calls.set(calls.get() + 1);
                Ok::<_, &str>(Some("must-not-be-read".to_string()))
            });
            assert!(key.is_none(), "{invalid_url}");
            assert_eq!(calls.get(), 0, "{invalid_url}");
        }

        let provider = create_provider(json!({
            "baseURL": "https://attacker.example/v1",
            "config": coding_toml(TUZI_CODING_BASE_URL, "CODING02_CODEX_API_KEY")
        }));
        let calls = Cell::new(0);
        assert!(adapter
            .extract_key_with_env_reader(&provider, |_| {
                calls.set(calls.get() + 1);
                Ok::<_, &str>(Some("must-not-be-read".to_string()))
            })
            .is_none());
        assert_eq!(calls.get(), 0);

        let provider = create_provider(json!({
            "base_url": TUZI_CODING_BASE_URL,
            "config": coding_toml("https://attacker.example/v1", "CODING02_CODEX_API_KEY")
        }));
        assert_eq!(
            adapter
                .extract_key_with_env_reader(&provider, |_| {
                    Ok::<_, &str>(Some("allowed-by-effective-route".to_string()))
                })
                .as_deref(),
            Some("allowed-by-effective-route")
        );
    }

    #[test]
    fn test_extract_auth_rejects_non_allowlisted_env_keys_without_reading() {
        let adapter = CodexAdapter::new();
        for env_key in [
            "OPENAI_API_KEY",
            "TUZI_CODEX_API_KEY",
            "TUZI_CODEX_IMAGE_API_KEY",
            "CODING00_CODEX_API_KEY",
            "CUSTOM_SECRET",
        ] {
            let provider = create_provider(json!({
                "config": coding_toml(TUZI_CODING_BASE_URL, env_key)
            }));
            let calls = Cell::new(0);
            assert!(
                adapter
                    .extract_key_with_env_reader(&provider, |_| {
                        calls.set(calls.get() + 1);
                        Ok::<_, &str>(Some("must-not-be-read".to_string()))
                    })
                    .is_none(),
                "{env_key}"
            );
            assert_eq!(calls.get(), 0, "{env_key}");
        }
    }

    #[test]
    fn test_extract_auth_prefers_toml_env_key_over_stale_legacy_env_key() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "auth": {},
            "env": { "envKey": "CODING01_CODEX_API_KEY" },
            "config": r#"model_provider = "tuzi"

[model_providers.tuzi]
base_url = "https://api.tu-zi.com/coding"
env_key = "CODING02_CODEX_API_KEY"
"#
        }));

        let key = adapter.extract_key_with_env_reader(&provider, |env_key| {
            Ok::<_, &str>(Some(format!("resolved-{env_key}")))
        });
        assert_eq!(key.as_deref(), Some("resolved-CODING02_CODEX_API_KEY"));
    }

    #[test]
    fn test_extract_auth_explicit_key_bypasses_env_reader() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "auth": { "OPENAI_API_KEY": " explicit-key " },
            "env": { "envKey": "CODING02_CODEX_API_KEY" }
        }));
        let calls = Cell::new(0);

        let key = adapter.extract_key_with_env_reader(&provider, |_| {
            calls.set(calls.get() + 1);
            Ok::<_, &str>(Some("dotenv-key".to_string()))
        });
        assert_eq!(key.as_deref(), Some("explicit-key"));
        assert_eq!(calls.get(), 0);
    }

    #[test]
    fn test_extract_auth_ignores_explicit_placeholder_then_uses_eligible_env_key() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "env": { "OPENAI_API_KEY": "PROXY_MANAGED" },
            "auth": { "OPENAI_API_KEY": "PROXY_MANAGED" },
            "apiKey": "PROXY_MANAGED",
            "config": coding_toml(TUZI_CODING_BASE_URL, "CODING02_CODEX_API_KEY")
        }));
        assert_eq!(
            adapter
                .extract_key_with_env_reader(&provider, |_| {
                    Ok::<_, &str>(Some("dotenv-key".to_string()))
                })
                .as_deref(),
            Some("dotenv-key")
        );
    }

    #[test]
    fn test_extract_auth_ignores_missing_empty_and_failed_env_reads() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "auth": {},
            "base_url": TUZI_CODING_BASE_URL,
            "env": { "envKey": "CODING02_CODEX_API_KEY" }
        }));

        assert!(adapter
            .extract_key_with_env_reader(&provider, |_| Ok::<_, &str>(None))
            .is_none());
        assert!(adapter
            .extract_key_with_env_reader(&provider, |_| { Ok::<_, &str>(Some("   ".to_string())) })
            .is_none());
        assert!(adapter
            .extract_key_with_env_reader(&provider, |_| Err::<Option<String>, _>("read failed"))
            .is_none());
    }

    #[test]
    fn test_extract_auth_uses_legacy_bearer_only_after_env_key() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "auth": {},
            "config": r#"model_provider = "tuzi"

[model_providers.tuzi]
base_url = "https://api.tu-zi.com/coding"
env_key = "CODING02_CODEX_API_KEY"
experimental_bearer_token = "legacy-key"
"#
        }));

        let env_key = adapter.extract_key_with_env_reader(&provider, |_| {
            Ok::<_, &str>(Some("dotenv-key".to_string()))
        });
        assert_eq!(env_key.as_deref(), Some("dotenv-key"));

        let legacy_key = adapter.extract_key_with_env_reader(&provider, |_| Ok::<_, &str>(None));
        assert_eq!(legacy_key.as_deref(), Some("legacy-key"));
    }

    #[test]
    fn test_extract_auth_filters_unsafe_env_and_legacy_bearer_values() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "config": format!(
                "{}experimental_bearer_token = \"PROXY_MANAGED\"\n",
                coding_toml(TUZI_CODING_BASE_URL, "CODING02_CODEX_API_KEY")
            )
        }));
        assert!(adapter
            .extract_key_with_env_reader(&provider, |_| {
                Ok::<_, &str>(Some("bad\nkey".to_string()))
            })
            .is_none());
    }

    #[test]
    fn test_extract_auth_falls_back_to_config_bearer_token() {
        let adapter = CodexAdapter::new();
        let provider = create_provider(json!({
            "auth": {},
            "config": r#"model_provider = "tuzi"

[model_providers.tuzi]
experimental_bearer_token = "sk-live-token"
"#
        }));

        let auth = adapter.extract_auth(&provider).unwrap();
        assert_eq!(auth.api_key, "sk-live-token");
    }

    #[test]
    fn test_codex_provider_uses_chat_completions_from_meta_api_format() {
        let provider = create_provider_with_meta(
            json!({
                "config": r#"model_provider = "tuzi"

[model_providers.tuzi]
wire_api = "responses"
"#
            }),
            ProviderMeta {
                api_format: Some("openai_chat".to_string()),
                ..ProviderMeta::default()
            },
        );

        assert!(codex_provider_uses_chat_completions(&provider));
        assert!(should_convert_codex_responses_to_chat(
            &provider,
            "/responses/compact?foo=bar"
        ));
        assert!(!should_convert_codex_responses_to_chat(
            &provider,
            "/chat/completions"
        ));
    }

    #[test]
    fn test_apply_codex_chat_upstream_model_preserves_catalog_model_selection() {
        let provider = create_provider_with_meta(
            json!({
                "config": r#"model_provider = "tuzi"
model = "deepseek-v4"

[model_providers.tuzi]
base_url = "https://relay.example/v1"
"#,
                "modelCatalog": {
                    "models": [
                        { "model": "kimi-k2" },
                        { "model": "deepseek-v4" }
                    ]
                }
            }),
            ProviderMeta {
                api_format: Some("openai_chat".to_string()),
                ..ProviderMeta::default()
            },
        );
        let mut body = json!({
            "model": "kimi-k2",
            "input": "hi"
        });

        let upstream_model = apply_codex_chat_upstream_model(&provider, &mut body);

        assert_eq!(upstream_model.as_deref(), Some("kimi-k2"));
        assert_eq!(body["model"], "kimi-k2");
    }

    #[test]
    fn test_resolve_codex_chat_reasoning_prefers_meta_config() {
        let provider = create_provider_with_meta(
            json!({
                "config": r#"model_provider = "tuzi"
model = "deepseek-v4"

[model_providers.tuzi]
base_url = "https://relay.example/v1"
"#
            }),
            ProviderMeta {
                api_format: Some("openai_chat".to_string()),
                codex_chat_reasoning: Some(CodexChatReasoning {
                    supports_effort: Some(true),
                    effort_param: Some("reasoning.effort".to_string()),
                    ..CodexChatReasoning::default()
                }),
                ..ProviderMeta::default()
            },
        );

        let config = resolve_codex_chat_reasoning_config(&provider, &json!({})).unwrap();

        assert_eq!(config.supports_thinking, Some(true));
        assert_eq!(config.effort_param.as_deref(), Some("reasoning.effort"));
    }

    #[test]
    fn test_env_cache_fast_hit_and_file_check_do_not_reread() {
        let mut cache = CodexEnvCredentialCache::default();
        let path = Path::new("/test/codex/.env");
        let fingerprint = CodexEnvFileFingerprint::synthetic(1, 1, 32);
        let now = Instant::now();
        let fingerprint_calls = Cell::new(0);
        let read_calls = Cell::new(0);

        let first = cache
            .resolve(
                path,
                "CODING01_CODEX_API_KEY",
                now,
                |_| {
                    fingerprint_calls.set(fingerprint_calls.get() + 1);
                    Ok::<_, &str>(Some(fingerprint.clone()))
                },
                |_| {
                    read_calls.set(read_calls.get() + 1);
                    Ok::<_, &str>(Some("cached-key".to_string()))
                },
            )
            .unwrap();
        assert_eq!(first.as_deref(), Some("cached-key"));
        assert_eq!(fingerprint_calls.get(), 2);
        assert_eq!(read_calls.get(), 1);

        let fast_hit = cache
            .resolve(
                path,
                "CODING01_CODEX_API_KEY",
                now + Duration::from_millis(100),
                |_| -> Result<Option<CodexEnvFileFingerprint>, &str> {
                    panic!("fast hit must not touch the file")
                },
                |_| -> Result<Option<String>, &str> {
                    panic!("fast hit must not reread the value")
                },
            )
            .unwrap();
        assert_eq!(fast_hit.as_deref(), Some("cached-key"));

        let checked_hit = cache
            .resolve(
                path,
                "CODING01_CODEX_API_KEY",
                now + Duration::from_millis(300),
                |_| {
                    fingerprint_calls.set(fingerprint_calls.get() + 1);
                    Ok::<_, &str>(Some(fingerprint.clone()))
                },
                |_| -> Result<Option<String>, &str> {
                    panic!("unchanged file must not reread the value")
                },
            )
            .unwrap();
        assert_eq!(checked_hit.as_deref(), Some("cached-key"));
        assert_eq!(fingerprint_calls.get(), 3);
        assert_eq!(read_calls.get(), 1);
    }

    #[test]
    fn test_env_cache_ttl_and_fingerprint_changes_reload_value() {
        let mut cache = CodexEnvCredentialCache::default();
        let path = Path::new("/test/codex/.env");
        let first_fingerprint = CodexEnvFileFingerprint::synthetic(1, 1, 32);
        let second_fingerprint = CodexEnvFileFingerprint::synthetic(2, 2, 48);
        let now = Instant::now();
        let reads = Cell::new(0);

        assert_eq!(
            cache
                .resolve(
                    path,
                    "CODING01_CODEX_API_KEY",
                    now,
                    |_| Ok::<_, &str>(Some(first_fingerprint.clone())),
                    |_| {
                        reads.set(reads.get() + 1);
                        Ok::<_, &str>(Some("first-key".to_string()))
                    },
                )
                .unwrap()
                .as_deref(),
            Some("first-key")
        );

        assert_eq!(
            cache
                .resolve(
                    path,
                    "CODING01_CODEX_API_KEY",
                    now + Duration::from_millis(300),
                    |_| Ok::<_, &str>(Some(second_fingerprint.clone())),
                    |_| {
                        reads.set(reads.get() + 1);
                        Ok::<_, &str>(Some("second-key".to_string()))
                    },
                )
                .unwrap()
                .as_deref(),
            Some("second-key")
        );
        assert_eq!(reads.get(), 2);

        assert_eq!(
            cache
                .resolve(
                    path,
                    "CODING01_CODEX_API_KEY",
                    now + Duration::from_secs(6),
                    |_| Ok::<_, &str>(Some(second_fingerprint.clone())),
                    |_| {
                        reads.set(reads.get() + 1);
                        Ok::<_, &str>(Some("ttl-key".to_string()))
                    },
                )
                .unwrap()
                .as_deref(),
            Some("ttl-key")
        );
        assert_eq!(reads.get(), 3);
    }

    #[test]
    fn test_env_cache_negative_entry_backs_off_and_stale_error_clears_value() {
        let mut cache = CodexEnvCredentialCache::default();
        let path = Path::new("/test/codex/.env");
        let fingerprint = CodexEnvFileFingerprint::synthetic(1, 1, 32);
        let changed = CodexEnvFileFingerprint::synthetic(2, 2, 48);
        let now = Instant::now();

        assert_eq!(
            cache
                .resolve(
                    path,
                    "CODING01_CODEX_API_KEY",
                    now,
                    |_| Ok::<_, &str>(Some(fingerprint.clone())),
                    |_| Ok::<_, &str>(Some("first-key".to_string())),
                )
                .unwrap()
                .as_deref(),
            Some("first-key")
        );

        let error = cache.resolve(
            path,
            "CODING01_CODEX_API_KEY",
            now + Duration::from_millis(300),
            |_| Ok::<_, &str>(Some(changed.clone())),
            |_| Err::<Option<String>, _>("read failed"),
        );
        assert_eq!(error.unwrap_err(), "read failed");
        assert!(cache.entries.back().unwrap().value.is_none());

        let backed_off = cache
            .resolve(
                path,
                "CODING01_CODEX_API_KEY",
                now + Duration::from_millis(301),
                |_| -> Result<Option<CodexEnvFileFingerprint>, &str> {
                    panic!("negative cache must suppress metadata I/O")
                },
                |_| -> Result<Option<String>, &str> {
                    panic!("negative cache must suppress file I/O")
                },
            )
            .unwrap();
        assert!(backed_off.is_none());

        assert_eq!(
            cache
                .resolve(
                    path,
                    "CODING01_CODEX_API_KEY",
                    now + Duration::from_millis(600),
                    |_| Ok::<_, &str>(Some(changed.clone())),
                    |_| Ok::<_, &str>(Some("recovered-key".to_string())),
                )
                .unwrap()
                .as_deref(),
            Some("recovered-key")
        );
    }

    #[test]
    fn test_env_cache_is_path_scoped_and_capacity_bounded() {
        let mut cache = CodexEnvCredentialCache::default();
        let now = Instant::now();
        let fingerprint = CodexEnvFileFingerprint::synthetic(1, 1, 32);

        for (path, value) in [
            (Path::new("/test/one/.env"), "one-key"),
            (Path::new("/test/two/.env"), "two-key"),
        ] {
            assert_eq!(
                cache
                    .resolve(
                        path,
                        "CODING01_CODEX_API_KEY",
                        now,
                        |_| Ok::<_, &str>(Some(fingerprint.clone())),
                        |_| Ok::<_, &str>(Some(value.to_string())),
                    )
                    .unwrap()
                    .as_deref(),
                Some(value)
            );
        }
        assert_eq!(cache.entries.len(), 2);

        for index in 0..ENV_KEY_CACHE_CAPACITY {
            let env_key = format!("CODING{:02}_CODEX_API_KEY", index + 10);
            cache
                .resolve(
                    Path::new("/test/capacity/.env"),
                    &env_key,
                    now,
                    |_| Ok::<_, &str>(Some(fingerprint.clone())),
                    |_| Ok::<_, &str>(Some(format!("key-{index}"))),
                )
                .unwrap();
        }
        assert_eq!(cache.entries.len(), ENV_KEY_CACHE_CAPACITY);
        assert!(cache
            .entries
            .iter()
            .all(|entry| entry.key.path != Path::new("/test/one/.env")));
        assert!(cache.entries.iter().any(|entry| {
            entry.key.path == Path::new("/test/capacity/.env")
                && entry.key.env_key == "CODING17_CODEX_API_KEY"
        }));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn test_async_env_cache_concurrent_miss_reads_once() {
        let coordinator = Arc::new(Mutex::new(CodexEnvCredentialCacheCoordinator::default()));
        let read_limit = Arc::new(Semaphore::new(ENV_KEY_BLOCKING_READ_LIMIT));
        let read_calls = Arc::new(AtomicUsize::new(0));
        let fingerprint = CodexEnvFileFingerprint::synthetic(1, 1, 32);
        let mut handles = Vec::new();

        for _ in 0..8 {
            let coordinator = Arc::clone(&coordinator);
            let read_limit = Arc::clone(&read_limit);
            let read_calls = Arc::clone(&read_calls);
            let fingerprint = fingerprint.clone();
            handles.push(tokio::spawn(resolve_cached_codex_env_key_with(
                coordinator,
                read_limit,
                PathBuf::from("/test/concurrent/.env"),
                "CODING01_CODEX_API_KEY".to_string(),
                Arc::new(move |_| Ok(Some(fingerprint.clone()))),
                Arc::new(move |_, _| {
                    read_calls.fetch_add(1, Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(50));
                    Ok(Some("shared-key".to_string()))
                }),
            )));
        }

        for handle in handles {
            assert_eq!(
                handle.await.unwrap().unwrap().as_deref(),
                Some("shared-key")
            );
        }
        assert_eq!(read_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn test_async_env_cache_changed_fingerprint_reloads_with_single_probe() {
        let coordinator = Arc::new(Mutex::new(CodexEnvCredentialCacheCoordinator::default()));
        let path = PathBuf::from("/test/probe/.env");
        let env_key = "CODING01_CODEX_API_KEY";
        let first = CodexEnvFileFingerprint::synthetic(1, 1, 32);
        let changed = CodexEnvFileFingerprint::synthetic(2, 2, 48);
        store_cache_entry(&coordinator, &path, env_key, Some(first), Some("old-key"));
        {
            let mut coordinator = coordinator.lock().unwrap();
            coordinator.cache.entries[0].last_file_check =
                Instant::now() - ENV_KEY_CACHE_FILE_CHECK_INTERVAL;
        }
        let fingerprint_calls = Arc::new(AtomicUsize::new(0));
        let calls = Arc::clone(&fingerprint_calls);
        let fingerprint_reader: CodexEnvFingerprintReader = Arc::new(move |_| {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(Some(changed.clone()))
        });

        assert_eq!(
            resolve_cached_codex_env_key_with(
                coordinator,
                Arc::new(Semaphore::new(ENV_KEY_BLOCKING_READ_LIMIT)),
                path,
                env_key.to_string(),
                fingerprint_reader,
                Arc::new(|_, _| Ok(Some("new-key".to_string()))),
            )
            .await
            .unwrap()
            .as_deref(),
            Some("new-key")
        );
        assert_eq!(fingerprint_calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn test_async_env_cache_different_keys_do_not_block_each_other() {
        let coordinator = Arc::new(Mutex::new(CodexEnvCredentialCacheCoordinator::default()));
        let read_limit = Arc::new(Semaphore::new(ENV_KEY_BLOCKING_READ_LIMIT));
        let active = Arc::new(AtomicUsize::new(0));
        let max_active = Arc::new(AtomicUsize::new(0));
        let fingerprint = CodexEnvFileFingerprint::synthetic(1, 1, 32);
        let mut handles = Vec::new();

        for env_key in ["CODING01_CODEX_API_KEY", "CODING02_CODEX_API_KEY"] {
            let active = Arc::clone(&active);
            let max_active = Arc::clone(&max_active);
            let fingerprint = fingerprint.clone();
            handles.push(tokio::spawn(resolve_cached_codex_env_key_with(
                Arc::clone(&coordinator),
                Arc::clone(&read_limit),
                PathBuf::from("/test/parallel/.env"),
                env_key.to_string(),
                Arc::new(move |_| Ok(Some(fingerprint.clone()))),
                Arc::new(move |_, key| {
                    let current = active.fetch_add(1, Ordering::SeqCst) + 1;
                    max_active.fetch_max(current, Ordering::SeqCst);
                    let deadline = Instant::now() + Duration::from_millis(500);
                    while active.load(Ordering::SeqCst) < 2 && Instant::now() < deadline {
                        thread::sleep(Duration::from_millis(2));
                    }
                    active.fetch_sub(1, Ordering::SeqCst);
                    Ok(Some(format!("value-{key}")))
                }),
            )));
        }

        for handle in handles {
            tokio::time::timeout(Duration::from_secs(2), handle)
                .await
                .expect("different keys should resolve concurrently")
                .unwrap()
                .unwrap();
        }
        assert_eq!(max_active.load(Ordering::SeqCst), 2);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn test_async_env_cache_slow_read_does_not_block_runtime_timer() {
        let coordinator = Arc::new(Mutex::new(CodexEnvCredentialCacheCoordinator::default()));
        let read_limit = Arc::new(Semaphore::new(ENV_KEY_BLOCKING_READ_LIMIT));
        let started = Arc::new(AtomicBool::new(false));
        let read_started = Arc::clone(&started);
        let fingerprint = CodexEnvFileFingerprint::synthetic(1, 1, 32);
        let resolver = tokio::spawn(resolve_cached_codex_env_key_with(
            coordinator,
            read_limit,
            PathBuf::from("/test/timer/.env"),
            "CODING01_CODEX_API_KEY".to_string(),
            Arc::new(move |_| Ok(Some(fingerprint.clone()))),
            Arc::new(move |_, _| {
                read_started.store(true, Ordering::SeqCst);
                thread::sleep(Duration::from_millis(150));
                Ok(Some("timer-key".to_string()))
            }),
        ));

        while !started.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
        tokio::time::timeout(
            Duration::from_millis(50),
            tokio::time::sleep(Duration::from_millis(10)),
        )
        .await
        .expect("blocking file read must not occupy the current-thread runtime");
        assert_eq!(
            resolver.await.unwrap().unwrap().as_deref(),
            Some("timer-key")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn test_async_env_cache_cancelled_waiter_keeps_singleflight_load() {
        let coordinator = Arc::new(Mutex::new(CodexEnvCredentialCacheCoordinator::default()));
        let read_limit = Arc::new(Semaphore::new(ENV_KEY_BLOCKING_READ_LIMIT));
        let started = Arc::new(AtomicBool::new(false));
        let read_started = Arc::clone(&started);
        let read_calls = Arc::new(AtomicUsize::new(0));
        let counted_reads = Arc::clone(&read_calls);
        let fingerprint = CodexEnvFileFingerprint::synthetic(1, 1, 32);
        let fingerprint_reader: CodexEnvFingerprintReader =
            Arc::new(move |_| Ok(Some(fingerprint.clone())));
        let value_reader: CodexEnvValueReader = Arc::new(move |_, _| {
            counted_reads.fetch_add(1, Ordering::SeqCst);
            read_started.store(true, Ordering::SeqCst);
            thread::sleep(Duration::from_millis(100));
            Ok(Some("cancel-safe-key".to_string()))
        });

        let first = tokio::spawn(resolve_cached_codex_env_key_with(
            Arc::clone(&coordinator),
            Arc::clone(&read_limit),
            PathBuf::from("/test/cancel/.env"),
            "CODING01_CODEX_API_KEY".to_string(),
            Arc::clone(&fingerprint_reader),
            Arc::clone(&value_reader),
        ));
        while !started.load(Ordering::SeqCst) {
            tokio::task::yield_now().await;
        }
        first.abort();

        let second = resolve_cached_codex_env_key_with(
            coordinator,
            read_limit,
            PathBuf::from("/test/cancel/.env"),
            "CODING01_CODEX_API_KEY".to_string(),
            fingerprint_reader,
            value_reader,
        );
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(1), second)
                .await
                .expect("second waiter should receive the background result")
                .unwrap()
                .as_deref(),
            Some("cancel-safe-key")
        );
        assert_eq!(read_calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_env_key_gate_index_covers_exact_allowlist() {
        assert_eq!(CODEX_ENV_CREDENTIAL_GATES.len(), 100);
        assert_eq!(env_key_gate_index(LEGACY_CODING_ENV_KEY), Some(0));
        for index in 1..=99 {
            assert_eq!(
                env_key_gate_index(&format!("CODING{index:02}_CODEX_API_KEY")),
                Some(index)
            );
        }
        for rejected in [
            "CODING00_CODEX_API_KEY",
            "CODING100_CODEX_API_KEY",
            "OPENAI_API_KEY",
        ] {
            assert_eq!(env_key_gate_index(rejected), None);
        }
    }

    #[test]
    fn test_build_url() {
        let adapter = CodexAdapter::new();
        let url = adapter.build_url("https://api.openai.com/v1", "/responses");
        assert_eq!(url, "https://api.openai.com/v1/responses");
    }

    #[test]
    fn test_build_url_origin_adds_v1() {
        let adapter = CodexAdapter::new();
        let url = adapter.build_url("https://api.openai.com", "/responses");
        assert_eq!(url, "https://api.openai.com/v1/responses");
    }

    #[test]
    fn test_build_url_custom_prefix_no_v1() {
        let adapter = CodexAdapter::new();
        let url = adapter.build_url("https://example.com/openai", "/responses");
        assert_eq!(url, "https://example.com/openai/responses");
    }

    #[test]
    fn test_build_url_dedup_v1() {
        let adapter = CodexAdapter::new();
        // base_url 已包含 /v1，endpoint 也包含 /v1
        let url = adapter.build_url("https://www.packyapi.com/v1", "/v1/responses");
        assert_eq!(url, "https://www.packyapi.com/v1/responses");
    }

    // 官方客户端检测测试
    #[test]
    fn test_is_official_client_vscode() {
        assert!(CodexAdapter::is_official_client("codex_vscode/1.0.0"));
        assert!(CodexAdapter::is_official_client("codex_vscode/2.3.4"));
        assert!(CodexAdapter::is_official_client("codex_vscode/0.1"));
    }

    #[test]
    fn test_is_official_client_cli() {
        assert!(CodexAdapter::is_official_client("codex_cli_rs/1.0.0"));
        assert!(CodexAdapter::is_official_client("codex_cli_rs/0.5.2"));
    }

    #[test]
    fn test_is_not_official_client() {
        assert!(!CodexAdapter::is_official_client("Mozilla/5.0"));
        assert!(!CodexAdapter::is_official_client("curl/7.68.0"));
        assert!(!CodexAdapter::is_official_client("python-requests/2.25.1"));
        assert!(!CodexAdapter::is_official_client("codex_other/1.0.0"));
        assert!(!CodexAdapter::is_official_client(""));
    }

    #[test]
    fn test_is_official_client_partial_match() {
        // 必须从开头匹配
        assert!(!CodexAdapter::is_official_client("some codex_vscode/1.0.0"));
        assert!(!CodexAdapter::is_official_client(
            "prefix_codex_cli_rs/1.0.0"
        ));
    }
}
