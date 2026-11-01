//! Native-file adapters for additional tools. Their login and active-model state stay tool-owned.
use crate::services::tuzi_provider::{ProviderSource, Source};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

pub(crate) static LOCK: Mutex<()> = Mutex::new(());
const MAX_BYTES: u64 = 1024 * 1024;
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NativeTool {
    Grokbuild,
    Pi,
    Mcode,
}
impl NativeTool {
    fn id(self) -> &'static str {
        match self {
            Self::Grokbuild => "grokbuild",
            Self::Pi => "pi",
            Self::Mcode => "mcode",
        }
    }
    fn path(self) -> Result<PathBuf, String> {
        let home = crate::config::get_home_dir();
        // Preview builds never follow environment overrides into real tool directories.
        let fallback = match self {
            Self::Grokbuild => home.join(".grok/config.toml"),
            Self::Pi => home.join(".pi/agent/models.json"),
            Self::Mcode => home.join(".minimax/config.yaml"),
        };
        #[cfg(not(feature = "local-preview"))]
        {
            let vars: &[&str] = match self {
                Self::Grokbuild => &[],
                Self::Pi => &["PI_CODING_AGENT_DIR"],
                Self::Mcode => &["MINIMAX_DATA_DIR", "MAVIS_DATA_DIR"],
            };
            for var in vars {
                if let Some(dir) = std::env::var_os(var).filter(|v| !v.is_empty()) {
                    let dir = PathBuf::from(dir);
                    if !dir.is_absolute() {
                        return Err(format!("{var} must be an absolute directory"));
                    }
                    return Ok(dir.join(if self == Self::Pi {
                        "models.json"
                    } else {
                        "config.yaml"
                    }));
                }
            }
        }
        Ok(fallback)
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: String,
    pub providers: BTreeMap<String, Value>,
    pub current: Option<String>,
    pub path: String,
    pub can_restore: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub revision: String,
    pub id: String,
    pub config: Option<Value>,
    #[serde(default)]
    pub select: bool,
}
#[derive(Serialize, Deserialize)]
struct Backup {
    before: Option<Vec<u8>>,
    after: String,
    #[serde(default)]
    target: String,
    #[serde(default)]
    sources_before: Vec<Origin>,
    #[serde(default)]
    sources_after: Vec<Origin>,
    #[serde(default)]
    restored: bool,
}
/// Provenance is local metadata, never written into a tool's native schema.
#[derive(Clone, Serialize, Deserialize)]
struct Origin {
    site: String,
    user_id: String,
    token_id: String,
    provider_id: String,
    config_hash: String,
}
fn config_hash(config: &Value) -> String {
    let mut canonical = config.clone();
    canonical.sort_all_objects();
    digest(Some(
        &serde_json::to_vec(&canonical).expect("JSON value is serializable"),
    ))
}
fn origins(
    path: &Path,
    backup: &Path,
    bytes: Option<&[u8]>,
    nodes: &BTreeMap<String, Value>,
) -> Result<Vec<Origin>, String> {
    let saved = match fs::read(backup) {
        Ok(bytes) => serde_json::from_slice::<Backup>(&bytes)
            .map_err(|_| "Invalid native backup; inspect it before saving")?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(_) => return Err("Cannot read native provenance".into()),
    };
    if saved.target != path.to_string_lossy() {
        return Ok(vec![]);
    }
    let revision = digest(bytes);
    let records = if digest(saved.before.as_deref()) == revision
        || (saved.restored && saved.after != revision)
    {
        saved.sources_before
    } else {
        saved.sources_after
    };
    Ok(records
        .into_iter()
        .filter(|record| {
            nodes
                .get(&record.provider_id)
                .is_some_and(|v| config_hash(v) == record.config_hash)
        })
        .collect())
}
fn digest(bytes: Option<&[u8]>) -> String {
    bytes
        .map(|v| format!("{:x}", Sha256::digest(v)))
        .unwrap_or_else(|| "missing".into())
}
pub(crate) fn read_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Ok(meta) => {
            if !meta.is_file() || meta.len() > MAX_BYTES {
                return Err("Configuration must be a regular file under 1 MiB".into());
            }
            fs::read(path)
                .map(Some)
                .map_err(|_| "Cannot read native configuration".into())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Cannot inspect native configuration".into()),
    }
}
fn decode(tool: NativeTool, bytes: Option<&[u8]>) -> Result<Value, String> {
    let text = std::str::from_utf8(bytes.unwrap_or_default())
        .map_err(|_| "Native configuration is not UTF-8")?;
    if text.trim().is_empty() {
        return Ok(json!({}));
    }
    let value = match tool {
        NativeTool::Grokbuild => toml::from_str::<toml::Value>(text)
            .ok()
            .and_then(|v| serde_json::to_value(v).ok()),
        NativeTool::Pi => json5::from_str(text).ok(),
        NativeTool::Mcode => serde_yaml::from_str(text).ok(),
    }
    .ok_or("Invalid native configuration; original file was preserved")?;
    if !value.is_object() {
        return Err("Native configuration root must be an object".into());
    }
    Ok(value)
}
fn node_key(tool: NativeTool) -> &'static str {
    match tool {
        NativeTool::Grokbuild => "model",
        NativeTool::Pi => "providers",
        NativeTool::Mcode => "custom_provider",
    }
}
fn providers(tool: NativeTool, value: &Value) -> Result<BTreeMap<String, Value>, String> {
    match value.get(node_key(tool)) {
        None | Some(Value::Null) => Ok(BTreeMap::new()),
        Some(Value::Object(map)) => Ok(map.iter().map(|(k, v)| (k.clone(), v.clone())).collect()),
        _ => Err("Native providers must be an object".into()),
    }
}
fn validate(id: &str, tool: NativeTool, value: &Value) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("Provider ID must use letters, digits, - or _".into());
    }
    if !value.is_object() {
        return Err("Provider configuration must be an object".into());
    }
    let (base, key, api) = match tool {
        NativeTool::Grokbuild => (
            value.get("base_url"),
            value.get("api_key").or_else(|| value.get("env_key")),
            value.get("api_backend"),
        ),
        NativeTool::Pi => (value.get("baseUrl"), value.get("apiKey"), value.get("api")),
        NativeTool::Mcode => (
            value.pointer("/options/baseURL"),
            value.pointer("/options/apiKey"),
            value.get("api"),
        ),
    };
    let url = base
        .and_then(Value::as_str)
        .and_then(|s| url::Url::parse(s).ok())
        .ok_or("Enter a valid endpoint")?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("Enter an HTTP(S) endpoint without embedded credentials".into());
    }
    if key
        .and_then(Value::as_str)
        .is_none_or(|s| s.trim().is_empty())
    {
        return Err("An API key or tool-native environment reference is required".into());
    }
    let allowed: &[&str] = if tool == NativeTool::Grokbuild {
        &["responses", "chat_completions", "messages"]
    } else {
        &[
            "openai-completions",
            "openai-responses",
            "anthropic-messages",
        ]
    };
    if !api
        .and_then(Value::as_str)
        .is_some_and(|v| allowed.contains(&v))
    {
        return Err("Unsupported API format".into());
    }
    if tool == NativeTool::Grokbuild {
        for field in ["name", "model"] {
            if value
                .get(field)
                .and_then(Value::as_str)
                .is_none_or(|s| s.trim().is_empty())
            {
                return Err(format!("Missing {field}"));
            }
        }
        if value
            .get("context_window")
            .is_some_and(|v| v.as_u64().is_none_or(|n| n == 0))
        {
            return Err("Positive context_window required".into());
        }
    } else if tool == NativeTool::Pi {
        if value
            .get("models")
            .and_then(Value::as_array)
            .is_none_or(|models| {
                models.is_empty()
                    || models.iter().any(|v| {
                        v.get("id")
                            .and_then(Value::as_str)
                            .is_none_or(|s| s.trim().is_empty())
                    })
            })
        {
            return Err("Add models with nonempty IDs".into());
        }
    } else if value
        .get("models")
        .and_then(Value::as_object)
        .is_none_or(|models| {
            models.is_empty()
                || models
                    .iter()
                    .any(|(id, v)| id.trim().is_empty() || !v.is_object())
        })
    {
        return Err("Add at least one model".into());
    }
    Ok(())
}
fn encode(tool: NativeTool, value: &Value) -> Result<Vec<u8>, String> {
    match tool {
        NativeTool::Grokbuild => toml::to_string_pretty(value)
            .map(String::into_bytes)
            .map_err(|_| "Cannot encode Grok TOML".into()),
        NativeTool::Pi => {
            serde_json::to_vec_pretty(value).map_err(|_| "Cannot encode Pi JSON".into())
        }
        NativeTool::Mcode => serde_yaml::to_string(value)
            .map(String::into_bytes)
            .map_err(|_| "Cannot encode MiniMax YAML".into()),
    }
}
/// Private temporary file is synced before atomic replacement. Existing parent permissions stay intact.
pub(crate) fn private_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid path")?;
    if !parent.exists() {
        fs::create_dir_all(parent).map_err(|_| "Cannot create configuration directory")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Cannot protect configuration directory")?;
        }
    }
    let mut tmp =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| "Cannot prepare atomic write")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tmp.as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "Cannot protect configuration file")?;
    }
    tmp.write_all(bytes)
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|_| "Cannot write configuration")?;
    tmp.persist(path)
        .map_err(|_| "Cannot replace configuration atomically")?;
    Ok(())
}
fn backup_path(tool: NativeTool) -> PathBuf {
    crate::config::get_app_config_dir()
        .join("native-tool-backups")
        .join(format!("{}.json", tool.id()))
}
fn snapshot(tool: NativeTool, path: &Path, backup: &Path) -> Result<Snapshot, String> {
    let bytes = read_bytes(path)?;
    let revision = digest(bytes.as_deref());
    let value = decode(tool, bytes.as_deref())?;
    Ok(Snapshot {
        providers: providers(tool, &value)?,
        current: if tool == NativeTool::Grokbuild {
            value
                .pointer("/models/default")
                .and_then(Value::as_str)
                .map(str::to_owned)
        } else {
            None
        },
        can_restore: fs::read(backup)
            .ok()
            .and_then(|b| serde_json::from_slice::<Backup>(&b).ok())
            .is_some_and(|b| {
                !b.restored && b.after == revision && b.target == path.to_string_lossy()
            }),
        revision,
        path: path.to_string_lossy().into(),
    })
}
fn apply(tool: NativeTool, path: &Path, backup: &Path, change: Change) -> Result<Snapshot, String> {
    apply_with_source(tool, path, backup, change, None)
}
fn apply_with_source(
    tool: NativeTool,
    path: &Path,
    backup: &Path,
    change: Change,
    source: Option<&Source>,
) -> Result<Snapshot, String> {
    apply_transaction(tool, path, backup, change, source, private_write)
}
fn apply_transaction(
    tool: NativeTool,
    path: &Path,
    backup: &Path,
    change: Change,
    source: Option<&Source>,
    write_target: impl FnOnce(&Path, &[u8]) -> Result<(), String>,
) -> Result<Snapshot, String> {
    let before = read_bytes(path)?;
    if digest(before.as_deref()) != change.revision {
        return Err("Configuration changed outside the assistant. Refresh before saving.".into());
    }
    let mut root = decode(tool, before.as_deref())?;
    let mut nodes = providers(tool, &root)?;
    let sources_before = origins(path, backup, before.as_deref(), &nodes)?;
    if let Some(source) = source {
        if nodes.contains_key(&change.id)
            || sources_before.iter().any(|r| {
                r.site == source.site
                    && r.user_id == source.user_id
                    && r.token_id == source.token_id
            })
        {
            return Err("此 Key 已配置到工具或标识已存在，请刷新并查看已有配置".into());
        }
    }
    if tool == NativeTool::Mcode
        && nodes
            .get(&change.id)
            .and_then(|v| v.get("kind"))
            .and_then(Value::as_str)
            .is_some_and(|v| v != "custom")
    {
        return Err("MiniMax Code owns this account provider; edit it in MiniMax Code".into());
    }
    if tool == NativeTool::Mcode {
        let prefix = format!("custom_provider:{}/", change.id);
        for field in ["defaultModel", "defaultLightModel"] {
            if let Some(model) = root
                .get(field)
                .and_then(Value::as_str)
                .and_then(|s| s.strip_prefix(&prefix))
            {
                if !change.config.as_ref().is_some_and(|v| {
                    v.get("enabled") != Some(&Value::Bool(false))
                        && v.get("models").and_then(|m| m.get(model)).is_some_and(|m| {
                            m.is_object() && m.get("enabled") != Some(&Value::Bool(false))
                        })
                }) {
                    return Err("Select another default model in MiniMax Code before removing or disabling its model".into());
                }
            }
        }
    }
    if let Some(config) = change.config {
        validate(&change.id, tool, &config)?;
        nodes.insert(change.id.clone(), config);
    } else {
        if tool == NativeTool::Grokbuild
            && root.pointer("/models/default").and_then(Value::as_str) == Some(change.id.as_str())
        {
            return Err("Select another Grok profile before removing the current profile".into());
        }
        if tool == NativeTool::Mcode {
            let prefix = format!("custom_provider:{}/", change.id);
            if ["defaultModel", "defaultLightModel"].iter().any(|k| {
                root.get(k)
                    .and_then(Value::as_str)
                    .is_some_and(|s| s.starts_with(&prefix))
            }) {
                return Err(
                    "Select another model in MiniMax Code before removing this provider".into(),
                );
            }
        }
        nodes.remove(&change.id);
    }
    let mut sources_after: Vec<_> = sources_before
        .iter()
        .filter(|r| {
            nodes
                .get(&r.provider_id)
                .is_some_and(|v| config_hash(v) == r.config_hash)
        })
        .cloned()
        .collect();
    if let Some(source) = source {
        let config = nodes
            .get(&change.id)
            .ok_or("Missing account configuration")?;
        sources_after.push(Origin {
            site: source.site.clone(),
            user_id: source.user_id.clone(),
            token_id: source.token_id.clone(),
            provider_id: change.id.clone(),
            config_hash: config_hash(config),
        });
    }
    root[node_key(tool)] = serde_json::to_value(&nodes).map_err(|_| "Cannot encode providers")?;
    if change.select {
        if tool != NativeTool::Grokbuild {
            return Err("Choose the active model in the native tool".into());
        }
        if !root[node_key(tool)]
            .get(&change.id)
            .is_some_and(Value::is_object)
        {
            return Err("Profile not found".into());
        }
        if root.get("models").is_none() {
            root["models"] = json!({});
        }
        if !root["models"].is_object() {
            return Err("Invalid Grok models table".into());
        }
        root["models"]["default"] = json!(change.id);
    }
    let bytes = if tool == NativeTool::Grokbuild {
        let original = std::str::from_utf8(before.as_deref().unwrap_or_default())
            .map_err(|_| "Invalid TOML encoding")?;
        let mut doc = original
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| "Invalid Grok TOML")?;
        let replacement = String::from_utf8(encode(tool, &root)?)
            .map_err(|_| "Invalid TOML encoding")?
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| "Cannot encode Grok model tables")?;
        doc["model"] = replacement["model"].clone();
        if change.select {
            doc["models"]["default"] = replacement["models"]["default"].clone();
        }
        doc.to_string().into_bytes()
    } else {
        encode(tool, &root)?
    };
    let saved_backup = Backup {
        before,
        after: digest(Some(&bytes)),
        target: path.to_string_lossy().into_owned(),
        sources_before,
        sources_after,
        restored: false,
    };
    let previous_backup = fs::read(backup).ok();
    private_write(
        backup,
        &serde_json::to_vec(&saved_backup).map_err(|_| "Cannot encode backup")?,
    )?;
    if digest(read_bytes(path)?.as_deref()) != change.revision {
        return Err("Native configuration changed while preparing the save".into());
    }
    if write_target(path, &bytes).is_err() {
        // The target replacement is atomic: only the prepared backup changed.
        let compensated = match previous_backup {
            Some(previous) => private_write(backup, &previous),
            None => fs::remove_file(backup).map_err(|_| "Cannot remove prepared backup".into()),
        };
        return Err(if compensated.is_ok() {
            "保存失败，工具配置未改动"
        } else {
            "保存失败，工具配置未改动；备份写入失败，请检查本机备份"
        }
        .into());
    }
    Ok(Snapshot {
        revision: saved_backup.after,
        providers: nodes,
        current: root
            .pointer("/models/default")
            .and_then(Value::as_str)
            .filter(|_| tool == NativeTool::Grokbuild)
            .map(str::to_owned),
        path: path.to_string_lossy().into_owned(),
        can_restore: true,
    })
}
// Keep the sidecar inode stable. The OS releases its advisory lock even when
// the process exits without running Drop; unlinking it would allow two owners.
pub(crate) struct FileLock {
    _file: fs::File,
}
pub(crate) fn file_lock(path: &Path) -> Result<FileLock, String> {
    let parent = path.parent().ok_or("Invalid path")?;
    if !parent.exists() {
        fs::create_dir_all(parent).map_err(|_| "Cannot create tool directory")?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
                .map_err(|_| "Cannot protect tool directory")?;
        }
    }
    let lock = PathBuf::from(format!("{}.lock", path.display()));
    match fs::symlink_metadata(&lock) {
        Ok(meta) if meta.is_dir() && !meta.file_type().is_symlink() => {
            // Legacy locks contain no owner information. Never reclaim one while
            // an older app could still be writing; give an explicit recovery path.
            return Err(format!("检测到旧版配置锁目录：{}。请退出所有旧版兔子助手，确认没有配置写入后删除此空目录，再重试；工具配置未改动。", lock.display()));
        }
        Ok(meta) if !meta.is_file() || meta.file_type().is_symlink() => {
            return Err(format!("配置锁必须是普通文件：{}", lock.display()));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(format!("无法读取配置锁：{}", lock.display())),
    }
    let mut options = fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&lock)
        .map_err(|_| format!("无法打开配置锁：{}", lock.display()))?;
    file.try_lock()
        .map_err(|_| "Tool configuration is busy; retry after the other writer finishes")?;
    Ok(FileLock { _file: file })
}
#[tauri::command]
pub fn native_tool_read(tool: NativeTool) -> Result<Snapshot, String> {
    let _guard = LOCK.lock().map_err(|_| "Native tool lock unavailable")?;
    snapshot(tool, &tool.path()?, &backup_path(tool))
}
#[tauri::command]
pub fn native_tool_write(tool: NativeTool, change: Change) -> Result<Snapshot, String> {
    let _guard = LOCK.lock().map_err(|_| "Native tool lock unavailable")?;
    let path = tool.path()?;
    let _file = file_lock(&path)?;
    apply(tool, &path, &backup_path(tool), change)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountSelection {
    id: String,
    name: String,
    model: String,
    protocol: String,
    key: String,
    context_window: Option<u64>,
}
fn account_config(tool: NativeTool, selection: &AccountSelection) -> Result<Value, String> {
    if selection.name.trim().is_empty()
        || selection.name.len() > 200
        || selection.model.trim().is_empty()
        || selection.model.len() > 256
        || selection.model.chars().any(char::is_control)
        || !selection.key.starts_with("sk-")
        || selection.key.chars().any(char::is_control)
        || selection.context_window == Some(0)
    {
        return Err("配置名称、模型或 Key 无效".into());
    }
    let api = match selection.protocol.as_str() {
        "responses" => "openai-responses",
        "chat" => "openai-completions",
        "anthropic" => "anthropic-messages",
        _ => return Err("工具不支持此协议".into()),
    };
    // Pi and MiniMax's Anthropic SDK appends /v1/messages itself. Grok's
    // messages backend appends /messages to the configured API base instead.
    let endpoint = if tool != NativeTool::Grokbuild && selection.protocol == "anthropic" {
        "https://api.tu-zi.com"
    } else {
        "https://api.tu-zi.com/v1"
    };
    let mut config = match tool {
        NativeTool::Grokbuild => {
            json!({"name":selection.name.trim(),"model":selection.model,"base_url":endpoint,"api_key":selection.key,"api_backend":match selection.protocol.as_str() {"responses"=>"responses","chat"=>"chat_completions",_=>"messages"}})
        }
        NativeTool::Pi => {
            json!({"baseUrl":endpoint,"apiKey":selection.key,"api":api,"models":[{"id":selection.model,"name":selection.name.trim()}]})
        }
        NativeTool::Mcode => {
            json!({"name":selection.name.trim(),"kind":"custom","enabled":true,"api":api,"options":{"baseURL":endpoint,"apiKey":selection.key},"models":{selection.model.clone():{}}})
        }
    };
    if tool == NativeTool::Grokbuild {
        if let Some(context) = selection.context_window {
            config["context_window"] = json!(context);
        }
        if selection.protocol == "anthropic" {
            config["extra_headers"] = json!({"anthropic-version":"2023-06-01"});
        }
    }
    validate(&selection.id, tool, &config)?;
    Ok(config)
}
/// Qualification is read again online; the reveal guard stays held through the
/// single-file native transaction, so stale sessions cannot write after logout.
#[tauri::command]
pub async fn tuzi_native_tool_save(
    handle: tauri::AppHandle,
    tool: NativeTool,
    revision: String,
    selection: AccountSelection,
    source: Source,
) -> Result<Snapshot, String> {
    let service = handle.state::<std::sync::Arc<crate::tuzi_account::AccountService>>();
    save_account_to(
        &service,
        tool,
        revision,
        selection,
        source,
        &tool.path()?,
        &backup_path(tool),
    )
    .await
}
pub(crate) async fn save_account_to(
    service: &crate::tuzi_account::AccountService,
    tool: NativeTool,
    revision: String,
    selection: AccountSelection,
    source: Source,
    path: &Path,
    backup: &Path,
) -> Result<Snapshot, String> {
    crate::services::tuzi_provider::validate_account_source(service, &source)?;
    let config = account_config(tool, &selection)?;
    service
        .provider_qualification(
            source.generation,
            &source.token_id,
            std::slice::from_ref(&selection.model),
            &selection.protocol,
            tool.id(),
        )
        .await?;
    service.with_confirmed_model_source(
        &source.user_id,
        source.generation,
        &source.token_id,
        &selection.key,
        || {
            let _guard = LOCK.lock().map_err(|_| "Native tool lock unavailable")?;
            let _file = file_lock(path)?;
            apply_with_source(
                tool,
                path,
                backup,
                Change {
                    revision,
                    id: selection.id,
                    config: Some(config),
                    select: false,
                },
                Some(&source),
            )
        },
    )
}
#[derive(Serialize)]
pub struct AccountSources {
    sources: Vec<ProviderSource>,
    unavailable: Vec<String>,
}
#[tauri::command]
pub fn tuzi_native_tool_sources() -> Result<AccountSources, String> {
    let _guard = LOCK.lock().map_err(|_| "Native tool lock unavailable")?;
    let mut result = vec![];
    let mut unavailable = vec![];
    for tool in [NativeTool::Grokbuild, NativeTool::Pi, NativeTool::Mcode] {
        let read = (|| -> Result<Vec<Origin>, String> {
            let path = tool.path()?;
            let bytes = read_bytes(&path)?;
            let nodes = providers(tool, &decode(tool, bytes.as_deref())?)?;
            origins(&path, &backup_path(tool), bytes.as_deref(), &nodes)
        })();
        let records = match read {
            Ok(records) => records,
            Err(_) => {
                unavailable.push(tool.id().into());
                continue;
            }
        };
        for record in records {
            result.push(ProviderSource {
                site: record.site,
                user_id: record.user_id,
                token_id: record.token_id,
                app: tool.id().into(),
                provider_id: record.provider_id,
            });
        }
    }
    Ok(AccountSources {
        sources: result,
        unavailable,
    })
}
#[tauri::command]
pub fn native_tool_restore(tool: NativeTool, revision: String) -> Result<Snapshot, String> {
    let _guard = LOCK.lock().map_err(|_| "Native tool lock unavailable")?;
    let path = tool.path()?;
    let _file = file_lock(&path)?;
    restore(tool, &path, &backup_path(tool), &revision)
}
fn restore(
    tool: NativeTool,
    path: &Path,
    backup: &Path,
    revision: &str,
) -> Result<Snapshot, String> {
    let original_backup = fs::read(backup).map_err(|_| "No backup available")?;
    let mut saved: Backup =
        serde_json::from_slice(&original_backup).map_err(|_| "Invalid backup")?;
    if saved.target != path.to_string_lossy()
        || saved.restored
        || saved.after != revision
        || digest(read_bytes(path)?.as_deref()) != revision
    {
        return Err("Native configuration changed; refusing to overwrite external edits".into());
    }
    // Persist the provenance direction before the atomic file operation. If
    // interrupted, exact before/after hashes still select the correct records.
    saved.restored = true;
    private_write(
        backup,
        &serde_json::to_vec(&saved).map_err(|_| "Cannot encode backup")?,
    )?;
    let result = match saved.before {
        Some(bytes) => private_write(path, &bytes),
        None => fs::remove_file(path).map_err(|_| "Cannot restore absent configuration".into()),
    };
    if let Err(error) = result {
        private_write(backup, &original_backup).map_err(|_| "恢复失败，备份状态需要人工核对")?;
        return Err(error);
    }
    snapshot(tool, path, backup)
}

#[cfg(test)]
mod tests {
    #[test]
    fn file_lock_recovers_after_process_exit() {
        const CHILD_PATH: &str = "TUZI_FILE_LOCK_TEST_PATH";
        if let Some(path) = std::env::var_os(CHILD_PATH) {
            let path = std::path::PathBuf::from(path);
            if std::env::var("TUZI_FILE_LOCK_TEST_MODE").unwrap() == "contend" {
                assert!(super::file_lock(&path).is_err());
                return;
            }
            let _held = super::file_lock(&path).expect("child lock");
            // Simulate termination without Drop, with an OS-held lock.
            std::process::exit(0);
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let child = |mode: &str| {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "native_tools::tests::file_lock_recovers_after_process_exit", "--test-threads=1"])
                .env(CHILD_PATH, &path)
                .env("TUZI_FILE_LOCK_TEST_MODE", mode)
                .status().expect("run lock child")
        };
        let first = super::file_lock(&path).unwrap();
        assert!(super::file_lock(&path).is_err());
        assert!(child("contend").success());
        drop(first);
        assert!(child("exit").success());
        let _recovered = super::file_lock(&path).expect("lock after abrupt exit");
    }

    #[test]
    fn legacy_lock_requires_explicit_recovery_and_preserves_configuration() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        std::fs::write(&path, b"synthetic-original").unwrap();
        let lock = dir.path().join("config.json.lock");
        std::fs::create_dir(&lock).unwrap();
        assert!(super::file_lock(&path).err().unwrap().contains("旧版配置锁"));
        assert!(lock.is_dir());
        assert_eq!(std::fs::read(&path).unwrap(), b"synthetic-original");
        std::fs::remove_dir(&lock).unwrap();
        let _recovered = super::file_lock(&path).unwrap();
    }

    use super::*;
    fn config(tool: NativeTool) -> Value {
        match tool {
            NativeTool::Grokbuild => {
                json!({"name":"Synthetic","model":"grok-synthetic","base_url":"https://example.invalid/v1","api_key":"SYNTHETIC","api_backend":"responses","context_window":500000})
            }
            NativeTool::Pi => {
                json!({"baseUrl":"https://example.invalid/v1","apiKey":"SYNTHETIC","api":"openai-completions","models":[{"id":"synthetic"}]})
            }
            NativeTool::Mcode => {
                json!({"options":{"baseURL":"https://example.invalid/v1","apiKey":"SYNTHETIC"},"api":"openai-completions","models":{"synthetic":{}}})
            }
        }
    }
    fn source(token: &str) -> Source {
        Source {
            site: "https://api.tu-zi.com".into(),
            user_id: "7".into(),
            token_id: token.into(),
            generation: 1,
        }
    }
    fn selection(protocol: &str) -> AccountSelection {
        AccountSelection {
            id: "tuzi-synthetic".into(),
            name: "兔子线路-合成".into(),
            model: "synthetic/model".into(),
            protocol: protocol.into(),
            key: "sk-SYNTHETIC_MODEL_KEY".into(),
            context_window: None,
        }
    }
    fn change(revision: &str, id: &str, config: Option<Value>) -> Change {
        Change {
            revision: revision.into(),
            id: id.into(),
            config,
            select: false,
        }
    }
    #[test]
    fn account_protocol_matrix_generates_native_configs_without_changing_login_or_defaults() {
        for tool in [NativeTool::Grokbuild, NativeTool::Pi, NativeTool::Mcode] {
            for protocol in ["responses", "chat", "anthropic"] {
                let config = account_config(tool, &selection(protocol)).unwrap();
                let endpoint = match tool {
                    NativeTool::Grokbuild => &config["base_url"],
                    NativeTool::Pi => &config["baseUrl"],
                    NativeTool::Mcode => &config["options"]["baseURL"],
                };
                assert_eq!(
                    endpoint,
                    if tool != NativeTool::Grokbuild && protocol == "anthropic" {
                        "https://api.tu-zi.com"
                    } else {
                        "https://api.tu-zi.com/v1"
                    }
                );
                assert!(serde_json::to_string(&config)
                    .unwrap()
                    .contains("sk-SYNTHETIC_MODEL_KEY"));
                assert!(!serde_json::to_string(&config)
                    .unwrap()
                    .contains("system-token"));
                assert!(account_config(tool, &selection("gemini")).is_err());
                let dir = tempfile::tempdir().unwrap();
                let path = dir.path().join("config");
                let backup = dir.path().join("backup");
                let saved = apply_with_source(
                    tool,
                    &path,
                    &backup,
                    change("missing", "tuzi-synthetic", Some(config)),
                    Some(&source("9")),
                )
                .unwrap();
                assert_eq!(saved.current, None);
                let bytes = read_bytes(&path).unwrap();
                let nodes = providers(tool, &decode(tool, bytes.as_deref()).unwrap()).unwrap();
                assert_eq!(
                    origins(&path, &backup, bytes.as_deref(), &nodes)
                        .unwrap()
                        .len(),
                    1,
                    "canonical hash must survive native serialization"
                );
                restore(tool, &path, &backup, &saved.revision).unwrap();
                assert!(!path.exists());
                assert!(origins(&path, &backup, None, &BTreeMap::new())
                    .unwrap()
                    .is_empty());
            }
        }
        assert_eq!(
            account_config(NativeTool::Grokbuild, &selection("chat")).unwrap()["api_backend"],
            "chat_completions"
        );
        assert!(
            account_config(NativeTool::Grokbuild, &selection("responses"))
                .unwrap()
                .get("context_window")
                .is_none()
        );
        let mut custom = selection("responses");
        custom.context_window = Some(32000);
        assert_eq!(
            account_config(NativeTool::Grokbuild, &custom).unwrap()["context_window"],
            32000
        );
    }
    #[test]
    fn provenance_survives_unrelated_edits_and_restores_but_rejects_duplicate_and_changed_config() {
        for tool in [NativeTool::Grokbuild, NativeTool::Pi, NativeTool::Mcode] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("config");
            let backup = dir.path().join("backup");
            let cfg = account_config(tool, &selection("responses")).unwrap();
            let first = apply_with_source(
                tool,
                &path,
                &backup,
                change("missing", "tuzi-synthetic", Some(cfg.clone())),
                Some(&source("9")),
            )
            .unwrap();
            let original = fs::read(&path).unwrap();
            let saved_backup = fs::read(&backup).unwrap();
            for (id, token) in [("different", "9"), ("tuzi-synthetic", "10")] {
                assert!(apply_with_source(
                    tool,
                    &path,
                    &backup,
                    change(&first.revision, id, Some(cfg.clone())),
                    Some(&source(token))
                )
                .is_err());
                assert_eq!(fs::read(&path).unwrap(), original);
                assert_eq!(fs::read(&backup).unwrap(), saved_backup);
            }
            let mut root = decode(tool, Some(&original)).unwrap();
            root["unrelated"] = json!(true);
            fs::write(&path, encode(tool, &root).unwrap()).unwrap();
            let current = snapshot(tool, &path, &backup).unwrap();
            assert_eq!(
                origins(
                    &path,
                    &backup,
                    read_bytes(&path).unwrap().as_deref(),
                    &current.providers
                )
                .unwrap()
                .len(),
                1
            );
            let mut edited = cfg.clone();
            edited["note"] = json!("synthetic edit");
            let updated = apply(
                tool,
                &path,
                &backup,
                change(&current.revision, "tuzi-synthetic", Some(edited)),
            )
            .unwrap();
            assert!(origins(
                &path,
                &backup,
                read_bytes(&path).unwrap().as_deref(),
                &updated.providers
            )
            .unwrap()
            .is_empty());
            let restored = restore(tool, &path, &backup, &updated.revision).unwrap();
            assert!(!restored.can_restore);
            assert_eq!(
                origins(
                    &path,
                    &backup,
                    read_bytes(&path).unwrap().as_deref(),
                    &restored.providers
                )
                .unwrap()
                .len(),
                1
            );
            // Provenance also survives unrelated edits after restoring.
            let mut restored_root = decode(tool, read_bytes(&path).unwrap().as_deref()).unwrap();
            restored_root["after_restore_note"] = json!(true);
            fs::write(&path, encode(tool, &restored_root).unwrap()).unwrap();
            let restored = snapshot(tool, &path, &backup).unwrap();
            assert_eq!(
                origins(
                    &path,
                    &backup,
                    read_bytes(&path).unwrap().as_deref(),
                    &restored.providers
                )
                .unwrap()
                .len(),
                1
            );
            // A subsequent save retains the recovered association and adds another Key.
            let second = apply_with_source(
                tool,
                &path,
                &backup,
                change(&restored.revision, "second", Some(cfg)),
                Some(&source("10")),
            )
            .unwrap();
            assert_eq!(
                origins(
                    &path,
                    &backup,
                    read_bytes(&path).unwrap().as_deref(),
                    &second.providers
                )
                .unwrap()
                .len(),
                2
            );
        }
    }
    #[test]
    fn account_backup_and_target_failures_leave_file_and_existing_provenance_intact() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("models.json");
        let backup = dir.path().join("backup");
        let cfg = account_config(NativeTool::Pi, &selection("chat")).unwrap();
        let saved = apply_with_source(
            NativeTool::Pi,
            &path,
            &backup,
            change("missing", "first", Some(cfg.clone())),
            Some(&source("9")),
        )
        .unwrap();
        let original = fs::read(&path).unwrap();
        let original_backup = fs::read(&backup).unwrap();
        assert!(apply_transaction(
            NativeTool::Pi,
            &path,
            &backup,
            change(&saved.revision, "second", Some(cfg.clone())),
            Some(&source("10")),
            |_, _| Err("synthetic disk failure".into())
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        assert_eq!(fs::read(&backup).unwrap(), original_backup);
        let blocked = dir.path().join("blocked");
        fs::write(&blocked, b"not a directory").unwrap();
        assert!(apply_with_source(
            NativeTool::Pi,
            &path,
            &blocked.join("backup"),
            change(&saved.revision, "second", Some(cfg)),
            Some(&source("10"))
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
    }
    #[test]
    fn account_selection_rejects_unsafe_or_missing_fields_and_stale_revisions() {
        let mut sel = selection("chat");
        sel.model = "bad\nmodel".into();
        assert!(account_config(NativeTool::Pi, &sel).is_err());
        sel = selection("chat");
        sel.key = "SYSTEM_TOKEN_SYNTHETIC".into();
        assert!(account_config(NativeTool::Pi, &sel).is_err());
        sel = selection("chat");
        sel.id = "../outside".into();
        assert!(account_config(NativeTool::Pi, &sel).is_err());
        sel = selection("chat");
        sel.context_window = Some(0);
        assert!(account_config(NativeTool::Grokbuild, &sel).is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config");
        let backup = dir.path().join("backup");
        fs::write(&path, b"{}").unwrap();
        assert!(apply_with_source(
            NativeTool::Pi,
            &path,
            &backup,
            change("missing", "demo", Some(config(NativeTool::Pi))),
            Some(&source("9"))
        )
        .is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{}");
        assert!(!backup.exists());
    }
    #[test]
    fn all_adapters_preserve_unrelated_values_and_restore_exact_bytes() {
        for tool in [NativeTool::Grokbuild, NativeTool::Pi, NativeTool::Mcode] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("config");
            let backup = dir.path().join("backup");
            let original = encode(tool, &json!({"unrelated":{"preserve":true}})).unwrap();
            fs::write(&path, &original).unwrap();
            let saved = apply(
                tool,
                &path,
                &backup,
                Change {
                    revision: digest(Some(&original)),
                    id: "synthetic".into(),
                    config: Some(config(tool)),
                    select: tool == NativeTool::Grokbuild,
                },
            )
            .unwrap();
            assert!(saved.providers.contains_key("synthetic"));
            assert_eq!(
                decode(tool, read_bytes(&path).unwrap().as_deref()).unwrap()["unrelated"]
                    ["preserve"],
                true
            );
            restore(tool, &path, &backup, &saved.revision).unwrap();
            assert_eq!(fs::read(path).unwrap(), original);
        }
    }
    #[test]
    fn external_changes_and_invalid_input_never_replace_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("models.json");
        let backup = dir.path().join("backup");
        fs::write(&path, b"{\"other\":true}").unwrap();
        assert!(apply(
            NativeTool::Pi,
            &path,
            &backup,
            Change {
                revision: "missing".into(),
                id: "synthetic".into(),
                config: Some(config(NativeTool::Pi)),
                select: false
            }
        )
        .is_err());
        assert!(validate("../../bad", NativeTool::Pi, &config(NativeTool::Pi)).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "{\"other\":true}");
    }
    #[test]
    fn removal_checks_mcode_default_and_grok_selected_profile() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config");
        let backup = dir.path().join("backup");
        for (tool, root) in [
            (
                NativeTool::Mcode,
                json!({"defaultModel":"custom_provider:demo/model","custom_provider":{"demo":{}}}),
            ),
            (
                NativeTool::Grokbuild,
                json!({"models":{"default":"demo"},"model":{"demo":{}}}),
            ),
        ] {
            let bytes = encode(tool, &root).unwrap();
            fs::write(&path, &bytes).unwrap();
            assert!(apply(
                tool,
                &path,
                &backup,
                Change {
                    revision: digest(Some(&bytes)),
                    id: "demo".into(),
                    config: None,
                    select: false
                }
            )
            .is_err());
            assert_eq!(fs::read(&path).unwrap(), bytes);
        }
    }
    #[test]
    fn restore_refuses_external_edits_and_new_files_are_private() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi/models.json");
        let backup = dir.path().join("backup");
        let saved = apply(
            NativeTool::Pi,
            &path,
            &backup,
            Change {
                revision: "missing".into(),
                id: "demo".into(),
                config: Some(config(NativeTool::Pi)),
                select: false,
            },
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::write(&path, b"{}").unwrap();
        assert!(restore(NativeTool::Pi, &path, &backup, &saved.revision).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{}");
    }
}
