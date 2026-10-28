//! Account-originated creation backs up the complete adapter write set before any write.
pub(crate) mod codex_transaction;
use crate::{
    app_config::AppType, database::Database, error::AppError, provider::Provider, store::AppState,
};
use rusqlite::{backup::Backup, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};
use tauri::Manager;

static OPERATIONS: Mutex<()> = Mutex::new(());
static PLANS: OnceLock<Mutex<HashMap<String, Plan>>> = OnceLock::new();
fn plans() -> &'static Mutex<HashMap<String, Plan>> {
    PLANS.get_or_init(Default::default)
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub site: String,
    pub user_id: String,
    pub token_id: String,
    pub generation: u64,
}
#[derive(Serialize)]
pub struct Preview {
    pub id: String,
    pub changes: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(Debug)]
pub struct SaveOutcome {
    backup_id: String,
    enabled: bool,
    tested: bool,
}
#[derive(Clone)]
struct FileState {
    path: PathBuf,
    content: Option<Vec<u8>>,
    permissions: Option<fs::Permissions>,
}
struct Plan {
    environment: Option<Environment>,
    app: AppType,
    provider_hash: Vec<u8>,
    files: Vec<FileState>,
    database: Connection,
    created: i64,
}
#[derive(Serialize, Deserialize)]
struct Manifest {
    app: String,
    provider_id: String,
    created_at: i64,
    environment: Option<EnvironmentRecord>,
    modes: Vec<Option<u32>>,
    #[serde(default)]
    expected_modes: Vec<Option<u32>>,
    paths: Vec<PathBuf>,
    existed: Vec<bool>,
    expected: Vec<Option<String>>,
    database_expected: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct Environment {
    key: String,
    registry: Option<String>,
    process: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct EnvironmentRecord {
    before: Environment,
    expected: String,
}
fn environment_for(app: &AppType, provider: &Provider) -> Result<Option<Environment>, AppError> {
    #[cfg(windows)]
    {
        if matches!(app, AppType::Codex) {
            let key = super::provider::codex_provider_env_key(provider)
                .ok_or_else(|| AppError::Config("Codex 环境键缺失".into()))?;
            let state = capture_environment(&key)?;
            if state.registry.is_some() || state.process.is_some() {
                return Err(AppError::Config("独立环境键已存在，请重新创建".into()));
            }
            return Ok(Some(state));
        }
    }
    let _ = (app, provider);
    Ok(None)
}
fn capture_environment(key: &str) -> Result<Environment, AppError> {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let registry = match RegKey::predef(HKEY_CURRENT_USER).open_subkey("Environment") {
            Ok(registry) => match registry.get_value::<String, _>(key) {
                Ok(value) => Some(value),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
                Err(_) => return Err(AppError::Config("不能安全读取环境项".into())),
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(_) => return Err(AppError::Config("不能安全读取用户环境".into())),
        };
        return Ok(Environment {
            key: key.into(),
            registry,
            process: std::env::var(key).ok(),
        });
    }
    #[cfg(not(windows))]
    {
        Ok(Environment {
            key: key.into(),
            registry: None,
            process: None,
        })
    }
}
fn environment_signature(state: &Environment) -> String {
    hash(&serde_json::to_vec(state).expect("environment serializable"))
}
fn restore_environment(record: &Option<EnvironmentRecord>) -> Result<(), AppError> {
    if let Some(record) = record {
        let current = capture_environment(&record.before.key)?;
        if environment_signature(&current) == environment_signature(&record.before) {
            return Ok(());
        }
        if environment_signature(&current) != record.expected {
            return Err(AppError::Config("环境项被并发修改，恢复中止".into()));
        }
        #[cfg(windows)]
        {
            use winreg::{
                enums::{HKEY_CURRENT_USER, KEY_WRITE},
                RegKey,
            };
            let registry = RegKey::predef(HKEY_CURRENT_USER)
                .open_subkey_with_flags("Environment", KEY_WRITE)
                .map_err(|_| AppError::Config("无法恢复用户环境".into()))?;
            match &record.before.registry {
                Some(value) => registry
                    .set_value(&record.before.key, value)
                    .map_err(|_| AppError::Config("无法恢复用户环境".into()))?,
                None => {
                    if let Err(error) = registry.delete_value(&record.before.key) {
                        if error.kind() != std::io::ErrorKind::NotFound {
                            return Err(AppError::Config("无法恢复用户环境".into()));
                        }
                    }
                }
            }
            match &record.before.process {
                Some(value) => std::env::set_var(&record.before.key, value),
                None => std::env::remove_var(&record.before.key),
            }
        }
    }
    Ok(())
}
// Restore only the named synthetic variables after Windows tests exercise setx/reg.
#[cfg(all(test, windows))]
pub(crate) struct TestEnvironmentGuard(Vec<Environment>);
#[cfg(all(test, windows))]
impl TestEnvironmentGuard {
    pub(crate) fn new(keys: &[&str]) -> Self {
        Self(keys.iter().map(|key| capture_environment(key).expect("capture test environment")).collect())
    }
}
#[cfg(all(test, windows))]
impl Drop for TestEnvironmentGuard {
    fn drop(&mut self) {
        for before in &self.0 {
            let current = capture_environment(&before.key).expect("read test environment");
            restore_environment(&Some(EnvironmentRecord {
                before: before.clone(),
                expected: environment_signature(&current),
            })).expect("restore test environment");
        }
    }
}

fn mode(file: &FileState) -> Option<u32> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.permissions.as_ref().map(|p| p.mode())
    }
    #[cfg(not(unix))]
    {
        file.permissions.as_ref().map(|p| u32::from(p.readonly()))
    }
}
fn permissions(mode: Option<u32>) -> Option<fs::Permissions> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        mode.map(fs::Permissions::from_mode)
    }
    #[cfg(not(unix))]
    {
        mode.and_then(|m| {
            fs::metadata(backup_directory()).ok().map(|meta| {
                let mut p = meta.permissions();
                p.set_readonly(m != 0);
                p
            })
        })
    }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn provider_hash(provider: &Provider) -> Result<Vec<u8>, AppError> {
    Ok(
        Sha256::digest(serde_json::to_vec(provider).map_err(|e| AppError::Config(e.to_string()))?)
            .to_vec(),
    )
}
fn capture(path: PathBuf) -> Result<FileState, AppError> {
    match fs::symlink_metadata(&path) {
        Ok(meta) => {
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err(AppError::Config(
                    "配置目标必须是普通文件（不跟随符号链接）".into(),
                ));
            }
            Ok(FileState {
                content: Some(fs::read(&path).map_err(|e| AppError::io(&path, e))?),
                permissions: Some(meta.permissions()),
                path,
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(FileState {
            path,
            content: None,
            permissions: None,
        }),
        Err(e) => Err(AppError::io(&path, e)),
    }
}
fn files_unchanged(files: &[FileState]) -> Result<(), AppError> {
    for original in files {
        let now = capture(original.path.clone())?;
        if now.content != original.content || mode(&now) != mode(original) {
            return Err(AppError::Config(
                "配置已被其他操作修改，请重新预览；未覆盖并发修改".into(),
            ));
        }
    }
    Ok(())
}
fn write_set(app: &AppType, provider: &Provider) -> Result<Vec<PathBuf>, AppError> {
    use crate::{codex_config as codex, config};
    let mut paths = vec![config::get_app_config_dir().join("settings.json")];
    match app {
        AppType::Claude => paths.push(config::get_claude_settings_path()),
        AppType::ClaudeDesktop => {
            paths.extend(crate::claude_desktop_config::configuration_write_paths()?)
        }
        AppType::Codex => {
            paths.extend([
                codex::get_codex_auth_path(),
                codex::get_codex_config_path(),
                codex::get_codex_model_catalog_path(),
                codex::get_codex_profile_config_path(&provider.name),
                codex::get_codex_config_dir().join(".env"),
                config::get_app_config_dir().join("codex-env"),
                codex::get_codex_config_dir().join("AGENTS.md"),
                codex::get_codex_config_dir().join("AGENTS.override.md"),
            ]);
            paths.extend(codex::shell_rc_candidates());
        }
        AppType::Gemini => paths.extend([
            crate::gemini_config::get_gemini_env_path(),
            crate::gemini_config::get_gemini_settings_path(),
        ]),
        AppType::OpenCode => paths.push(crate::opencode_config::get_opencode_config_path()),
        AppType::OpenClaw => paths.push(crate::openclaw_config::get_openclaw_config_path()),
        AppType::Hermes => paths.push(crate::hermes_config::get_hermes_config_path()),
    }
    paths.sort();
    paths.dedup();
    Ok(paths)
}
#[derive(Clone)]
struct WriteRecord {
    expected: FileState,
    attempted: Option<Option<Vec<u8>>>,
}
thread_local! { static WRITE_JOURNAL: std::cell::RefCell<Option<HashMap<PathBuf,WriteRecord>>> = const { std::cell::RefCell::new(None) }; }
struct Journal;
impl Journal {
    fn begin(files: &[FileState]) -> Self {
        WRITE_JOURNAL.with(|j| {
            *j.borrow_mut() = Some(
                files
                    .iter()
                    .map(|f| {
                        (
                            f.path.clone(),
                            WriteRecord {
                                expected: f.clone(),
                                attempted: None,
                            },
                        )
                    })
                    .collect(),
            )
        });
        Self
    }
    fn after(&self) -> Result<Vec<FileState>, AppError> {
        WRITE_JOURNAL.with(|j| {
            j.borrow()
                .as_ref()
                .expect("active journal")
                .values()
                .map(|record| {
                    let current = capture(record.expected.path.clone())?;
                    if (current.content != record.expected.content
                        && record.attempted.as_ref() != Some(&current.content))
                        || mode(&current) != mode(&record.expected)
                    {
                        return Err(AppError::Config("配置存在并发修改，拒绝用备份覆盖".into()));
                    }
                    Ok(current)
                })
                .collect()
        })
    }
}
pub(crate) fn account_backup_active() -> bool {
    WRITE_JOURNAL.with(|j| j.borrow().is_some())
}
impl Drop for Journal {
    fn drop(&mut self) {
        WRITE_JOURNAL.with(|j| *j.borrow_mut() = None);
    }
}
#[cfg(test)]
thread_local! {static FAIL_WRITE_AT:std::cell::Cell<Option<usize>>=const {std::cell::Cell::new(None)};}
/// Ordinary writes are unchanged; account creation records and verifies each declared write.
pub(crate) fn before_config_write(path: &Path, bytes: Option<&[u8]>) -> Result<(), AppError> {
    WRITE_JOURNAL.with(|j| {
        let mut journal = j.borrow_mut();
        let Some(records) = journal.as_mut() else {
            return Ok(());
        };
        #[cfg(test)]
        FAIL_WRITE_AT.with(|remaining| {
            if let Some(count) = remaining.get() {
                if count == 1 {
                    remaining.set(None);
                    return Err(AppError::Config("synthetic adapter write failure".into()));
                }
                remaining.set(Some(count - 1));
            }
            Ok(())
        })?;
        let record = records
            .get_mut(path)
            .ok_or_else(|| AppError::Config("适配器写入超出已备份集合，已阻止".into()))?;
        let current = capture(path.to_owned())?;
        if current.content != record.expected.content || mode(&current) != mode(&record.expected) {
            return Err(AppError::Config("配置存在并发修改，保存已中止".into()));
        }
        record.attempted = Some(bytes.map(|b| b.to_vec()));
        Ok(())
    })
}
pub(crate) fn after_config_write(path: &Path) {
    WRITE_JOURNAL.with(|j| {
        if let Some(record) = j.borrow_mut().as_mut().and_then(|r| r.get_mut(path)) {
            if let Some(attempted) = record.attempted.take() {
                record.expected.content = attempted;
                if let Ok(current) = capture(path.to_owned()) {
                    if current.content == record.expected.content {
                        record.expected.permissions = current.permissions;
                    }
                }
            }
        }
    });
}
pub(crate) fn record_config_mode(path: &Path, value: u32) {
    WRITE_JOURNAL.with(|j| {
        if let Some(record) = j.borrow_mut().as_mut().and_then(|r| r.get_mut(path)) {
            record.expected.permissions = permissions(Some(value));
        }
    });
}
const TABLES: &[&str] = &[
    "providers",
    "provider_endpoints",
    "settings",
    "tuzi_provider_sources",
];
fn db_signature(conn: &Connection) -> Result<String, AppError> {
    let mut bytes = Vec::new();
    for table in TABLES {
        let mut stmt = conn.prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))?;
        let count = stmt.column_count();
        let mut rows = stmt.query([])?;
        while let Some(row) = rows.next()? {
            for i in 0..count {
                let value: rusqlite::types::Value = row.get(i)?;
                bytes.extend(format!("{value:?}").as_bytes());
                bytes.push(0);
            }
        }
    }
    Ok(hash(&bytes))
}
fn restore_db(
    db: &Database,
    before: &Connection,
    expected: &str,
    app: &str,
    provider_id: &str,
    files: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), AppError> {
    let mut conn = crate::database::lock_conn!(db.conn);
    if db_signature(&conn)? != expected {
        return Err(AppError::Config(
            "本地数据库已改变，恢复已中止以保护并发修改".into(),
        ));
    }
    let tx = conn.transaction()?;
    // Restore only adapter write tables. Usage/history and unrelated schemas are retained.
    for table in TABLES {
        let filter = match *table {
            "providers" => "id=?1 AND app_type=?2",
            "provider_endpoints" | "tuzi_provider_sources" => "provider_id=?1 AND app_type=?2",
            "settings" => {
                "key='claude_desktop_gateway_token' AND ?1 IS NOT NULL AND ?2='claude-desktop'"
            }
            _ => return Err(AppError::Config("恢复表无效".into())),
        };
        tx.execute(
            &format!("DELETE FROM {table} WHERE {filter}"),
            rusqlite::params![provider_id, app],
        )?;
        let mut stmt = before.prepare(&format!("SELECT * FROM {table} WHERE {filter}"))?;
        let count = stmt.column_count();
        let mut rows = stmt.query(rusqlite::params![provider_id, app])?;
        let sql = format!(
            "INSERT INTO {table} VALUES ({})",
            vec!["?"; count].join(",")
        );
        while let Some(row) = rows.next()? {
            let values = (0..count)
                .map(|i| row.get::<_, rusqlite::types::Value>(i))
                .collect::<Result<Vec<_>, _>>()?;
            tx.execute(&sql, rusqlite::params_from_iter(values))?;
        }
    }
    files()?;
    tx.commit()?;
    Ok(())
}
fn backup_directory() -> PathBuf {
    crate::config::get_app_config_dir().join("tool-backups")
}
fn private_dir(path: &Path) -> Result<(), AppError> {
    fs::create_dir_all(path).map_err(|e| AppError::io(path, e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|e| AppError::io(path, e))?;
    }
    #[cfg(windows)]
    {
        // Apply an explicit current-user ACL before writing any model credential backup.
        let script="$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); $acl.AddAccessRule($rule); Set-Acl -LiteralPath $env:TUZI_BACKUP_DIRECTORY -AclObject $acl -ErrorAction Stop";
        let status = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("TUZI_BACKUP_DIRECTORY", path)
            .output()
            .map_err(|_| AppError::Config("备份访问权限设置失败".into()))?;
        if !status.status.success() {
            return Err(AppError::Config("备份访问权限设置失败".into()));
        }
    }
    Ok(())
}
fn private_write(path: &Path, bytes: &[u8]) -> Result<(), AppError> {
    use std::io::Write;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|e| AppError::io(path, e))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| AppError::io(path, e))
}
fn persist_before(plan: &Plan, dir: &Path) -> Result<(), AppError> {
    private_dir(dir)?;
    for (i, file) in plan.files.iter().enumerate() {
        if let Some(content) = &file.content {
            private_write(&dir.join(format!("{i}.before")), content)?;
        }
    }
    let dbpath = dir.join("before.db");
    private_write(&dbpath, &[])?;
    let mut target = Connection::open(&dbpath)?;
    let backup = Backup::new(&plan.database, &mut target)?;
    backup.step(-1)?;
    drop(backup);
    drop(target);
    private_write(
        &dir.join("before.json"),
        &serde_json::to_vec(&Manifest {
            app: plan.app.as_str().into(),
            provider_id: String::new(),
            created_at: plan.created,
            environment: plan.environment.as_ref().map(|e| EnvironmentRecord {
                before: e.clone(),
                expected: environment_signature(e),
            }),
            modes: plan.files.iter().map(mode).collect(),
            expected_modes: vec![],
            paths: plan.files.iter().map(|f| f.path.clone()).collect(),
            existed: plan.files.iter().map(|f| f.content.is_some()).collect(),
            expected: vec![],
            database_expected: db_signature(&plan.database)?,
        })
        .map_err(|e| AppError::Config(e.to_string()))?,
    )?;
    Ok(())
}
#[cfg(test)]
thread_local! { static RESTORE_FAIL_AT: std::cell::Cell<Option<usize>>=const {std::cell::Cell::new(None)}; }
fn write_file_states(files: &[FileState]) -> Result<(), AppError> {
    for file in files {
        #[cfg(test)]
        RESTORE_FAIL_AT.with(|remaining| {
            if let Some(n) = remaining.get() {
                if n == 1 {
                    remaining.set(None);
                    return Err(AppError::Config("synthetic restore IO failure".into()));
                }
                remaining.set(Some(n - 1));
            }
            Ok(())
        })?;
        if let Some(bytes) = &file.content {
            crate::config::atomic_write(&file.path, bytes)?;
            if let Some(p) = &file.permissions {
                fs::set_permissions(&file.path, p.clone())
                    .map_err(|e| AppError::io(&file.path, e))?;
            }
        } else if file.path.exists() {
            crate::config::delete_file(&file.path)?;
        }
    }
    crate::settings::reload_settings()?;
    Ok(())
}
fn restore_files(before: &[FileState], expected: &[FileState]) -> Result<(), AppError> {
    files_unchanged(expected)?;
    if let Err(error) = write_file_states(before) {
        // Reverse only states that still match our restore writes; never overwrite a new external edit.
        for (original, saved) in before.iter().zip(expected) {
            let now = capture(original.path.clone())?;
            if now.content == original.content || now.content == saved.content {
                write_file_states(std::slice::from_ref(saved))?;
            } else {
                return Err(AppError::Config(
                    "恢复遇到并发修改；保留备份供人工核对".into(),
                ));
            }
        }
        return Err(error);
    }
    Ok(())
}
fn restore_state(
    before: &[FileState],
    expected: &[FileState],
    environment: &Option<EnvironmentRecord>,
) -> Result<(), AppError> {
    files_unchanged(expected)?;
    if let Some(record) = environment {
        let current = environment_signature(&capture_environment(&record.before.key)?);
        if current != record.expected && current != environment_signature(&record.before) {
            return Err(AppError::Config("环境项被并发修改，恢复中止".into()));
        }
    }
    restore_files(before, expected)?;
    if let Err(error) = restore_environment(environment) {
        restore_files(expected, before)?;
        return Err(error);
    }
    Ok(())
}
pub(crate) fn validate_source(handle: &tauri::AppHandle, source: &Source) -> Result<(), String> {
    let service = handle.state::<Arc<crate::tuzi_account::AccountService>>();
    validate_account_source(&service, source)
}
pub(crate) fn validate_account_source(
    service: &crate::tuzi_account::AccountService,
    source: &Source,
) -> Result<(), String> {
    let current = service.state();
    if source.site != "https://api.tu-zi.com"
        || current.status != "connected"
        || current.generation != source.generation
        || current.identity.as_ref().map(|i| i.user_id.as_str()) != Some(source.user_id.as_str())
        || source
            .token_id
            .parse::<u64>()
            .ok()
            .filter(|n| *n > 0)
            .is_none()
    {
        return Err("账户已改变或来源无效，请重新选择 Key".into());
    }
    Ok(())
}
fn model_key<'a>(app: &AppType, provider: &'a Provider) -> Option<&'a str> {
    let pointer = match app {
        AppType::Claude | AppType::ClaudeDesktop => "/env/ANTHROPIC_AUTH_TOKEN",
        AppType::Codex => "/auth/OPENAI_API_KEY",
        AppType::Gemini => "/env/GEMINI_API_KEY",
        AppType::OpenCode => "/options/apiKey",
        AppType::OpenClaw => "/apiKey",
        AppType::Hermes => "/api_key",
    };
    provider
        .settings_config
        .pointer(pointer)
        .and_then(serde_json::Value::as_str)
}
fn validate_provider(app: &AppType, provider: &Provider) -> Result<(), AppError> {
    let config = &provider.settings_config;
    let text = |pointer: &str| {
        config
            .pointer(pointer)
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .to_owned()
    };
    if provider
        .meta
        .as_ref()
        .and_then(|m| m.auth_binding.as_ref())
        .is_some()
    {
        return Err(AppError::Config("主站账户配置不能绑定工具 OAuth".into()));
    }
    for pointer in [
        "/env/ANTHROPIC_API_KEY",
        "/env/CLAUDE_CODE_OAUTH_TOKEN",
        "/env/GOOGLE_APPLICATION_CREDENTIALS",
        "/options/headers",
        "/headers",
    ] {
        if config.pointer(pointer).is_some() {
            return Err(AppError::Config("主站账户配置不能夹带其他认证字段".into()));
        }
    }
    let root = "https://api.tu-zi.com";
    let v1 = "https://api.tu-zi.com/v1";
    let (endpoint, key, protocol_ok) = match app {
        AppType::Claude | AppType::ClaudeDesktop => (
            text("/env/ANTHROPIC_BASE_URL"),
            text("/env/ANTHROPIC_AUTH_TOKEN"),
            !matches!(app, AppType::ClaudeDesktop)
                || matches!(
                    provider
                        .meta
                        .as_ref()
                        .and_then(|m| m.claude_desktop_mode.as_ref()),
                    Some(crate::provider::ClaudeDesktopMode::Proxy)
                ),
        ),
        AppType::Codex => {
            let toml = text("/config");
            if config
                .get("auth")
                .and_then(serde_json::Value::as_object)
                .is_none_or(|auth| auth.len() != 1 || !auth.contains_key("OPENAI_API_KEY"))
                || [
                    "experimental_bearer_token",
                    "http_headers",
                    "env_http_headers",
                    "api_key",
                ]
                .iter()
                .any(|field| toml.contains(field))
            {
                return Err(AppError::Config(
                    "Codex 账户配置不能夹带其他认证字段".into(),
                ));
            }
            crate::codex_config::validate_provider_tables(&toml)?;
            let doc = toml
                .parse::<toml_edit::DocumentMut>()
                .map_err(|_| AppError::Config("Codex TOML 无效".into()))?;
            let route = doc
                .get("model_provider")
                .and_then(|i| i.as_str())
                .unwrap_or("");
            let section = &doc["model_providers"][route];
            let env = section
                .get("env_key")
                .and_then(|i| i.as_str())
                .unwrap_or("");
            if !env.starts_with("TUZI_SWITCH_")
                || !env.ends_with("_CODEX_API_KEY")
                || !env
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
            {
                return Err(AppError::Config(
                    "Codex 必须使用独立账户供应商环境键".into(),
                ));
            }
            (
                section
                    .get("base_url")
                    .and_then(|i| i.as_str())
                    .unwrap_or("")
                    .to_owned(),
                text("/auth/OPENAI_API_KEY"),
                section.get("wire_api").and_then(|i| i.as_str()) == Some("responses"),
            )
        }
        AppType::Gemini => (
            text("/env/GOOGLE_GEMINI_BASE_URL"),
            text("/env/GEMINI_API_KEY"),
            true,
        ),
        AppType::OpenCode => {
            let npm = text("/npm");
            (
                text("/options/baseURL"),
                text("/options/apiKey"),
                matches!(
                    npm.as_str(),
                    "@ai-sdk/openai"
                        | "@ai-sdk/openai-compatible"
                        | "@ai-sdk/anthropic"
                        | "@ai-sdk/google"
                ),
            )
        }
        AppType::OpenClaw => (
            text("/baseUrl"),
            text("/apiKey"),
            matches!(
                text("/api").as_str(),
                "openai-completions" | "anthropic-messages"
            ),
        ),
        AppType::Hermes => (
            text("/base_url"),
            text("/api_key"),
            matches!(
                text("/api_mode").as_str(),
                "codex_responses" | "anthropic_messages"
            ),
        ),
    };
    let expected = match app {
        AppType::Claude | AppType::ClaudeDesktop => "https://apius.tu-zi.com",
        AppType::Gemini => root,
        AppType::OpenCode if text("/npm") == "@ai-sdk/google" => root,
        _ => v1,
    };
    if !protocol_ok
        || endpoint.trim_end_matches('/') != expected
        || !key.starts_with("sk-")
        || key.contains(['\r', '\n'])
        || !matches!(
            provider.category.as_deref(),
            Some("third_party" | "aggregator")
        )
    {
        return Err(AppError::Config(
            "账户 Key 配置必须使用主站兼容协议、固定端点和模型 Key".into(),
        ));
    }
    if provider
        .meta
        .as_ref()
        .map(|m| &m.custom_endpoints)
        .is_some_and(|items| {
            items
                .keys()
                .any(|url| url.trim_end_matches('/') != expected)
        })
    {
        return Err(AppError::Config("账户配置不允许其他备用端点".into()));
    }
    Ok(())
}
fn selected_models(
    app: &AppType,
    provider: &Provider,
) -> Result<(&'static str, Vec<String>), String> {
    let c = &provider.settings_config;
    let mut models = Vec::new();
    let protocol = match app {
        AppType::ClaudeDesktop => {
            models.extend(
                crate::claude_desktop_config::proxy_model_routes(provider)
                    .map_err(|e| e.to_string())?
                    .into_iter()
                    .map(|r| r.upstream_model),
            );
            "anthropic"
        }
        AppType::Claude => {
            for field in [
                "ANTHROPIC_MODEL",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                "ANTHROPIC_DEFAULT_SONNET_MODEL",
                "ANTHROPIC_DEFAULT_OPUS_MODEL",
            ] {
                if let Some(m) = c.pointer(&format!("/env/{field}")).and_then(|v| v.as_str()) {
                    if !m.is_empty() {
                        models.push(m.into());
                    }
                }
            }
            "anthropic"
        }
        AppType::Codex => {
            let doc = c
                .get("config")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .parse::<toml_edit::DocumentMut>()
                .map_err(|_| "Codex配置无效")?;
            if let Some(m) = doc.get("model").and_then(|v| v.as_str()) {
                models.push(m.into());
            }
            "responses"
        }
        AppType::Gemini => {
            if let Some(m) = c.pointer("/env/GEMINI_MODEL").and_then(|v| v.as_str()) {
                models.push(m.into());
            }
            "gemini"
        }
        AppType::OpenCode => {
            if let Some(obj) = c.get("models").and_then(|v| v.as_object()) {
                models.extend(obj.keys().cloned());
            }
            match c.get("npm").and_then(|v| v.as_str()) {
                Some("@ai-sdk/anthropic") => "anthropic",
                Some("@ai-sdk/google") => "gemini",
                Some("@ai-sdk/openai-compatible") => "chat",
                _ => "responses",
            }
        }
        AppType::OpenClaw | AppType::Hermes => {
            if let Some(list) = c.get("models").and_then(|v| v.as_array()) {
                for item in list {
                    if let Some(m) = item.get("id").and_then(|v| v.as_str()) {
                        models.push(m.into());
                    }
                }
            }
            let mode = c
                .get("api")
                .or_else(|| c.get("api_mode"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            if mode.starts_with("anthropic") {
                "anthropic"
            } else if matches!(app, AppType::Hermes) {
                "responses"
            } else {
                "chat"
            }
        }
    };
    models.sort();
    models.dedup();
    Ok((protocol, models))
}
fn public_display(value: &str) -> String {
    if value.starts_with("http:") || value.starts_with("https:") {
        match url::Url::parse(value) {
            Ok(mut url) => {
                let _ = url.set_username("");
                let _ = url.set_password(None);
                url.set_query(None);
                url.set_fragment(None);
                url.to_string()
            }
            Err(_) => "无效地址（已脱敏）".into(),
        }
    } else {
        value.into()
    }
}
fn public_field(field: &str, value: &str) -> String {
    if field.to_ascii_lowercase().contains("base_url")
        || field.to_ascii_lowercase().contains("baseurl")
    {
        if !value.starts_with("https:") && !value.starts_with("http:") {
            return "无效地址（已脱敏）".into();
        }
    }
    public_display(value)
}
fn safe_file_fields(file: &FileState) -> String {
    fn walk(value: &serde_json::Value, path: &str, out: &mut Vec<String>) {
        if let Some(object) = value.as_object() {
            for (key, value) in object {
                let path = format!("{path}/{key}");
                if [
                    "base_url",
                    "baseURL",
                    "baseUrl",
                    "ANTHROPIC_BASE_URL",
                    "GOOGLE_GEMINI_BASE_URL",
                    "ANTHROPIC_MODEL",
                    "GEMINI_MODEL",
                    "model",
                    "wire_api",
                    "env_key",
                    "npm",
                    "api",
                    "api_mode",
                ]
                .contains(&key.as_str())
                {
                    if let Some(v) = value.as_str() {
                        out.push(format!("{path}={}", public_field(key, v)));
                    }
                }
                if key == "models" {
                    if let Some(o) = value.as_object() {
                        out.push(format!(
                            "{path}={}",
                            o.keys().cloned().collect::<Vec<_>>().join(",")
                        ));
                    }
                }
                walk(value, &path, out);
            }
        } else if let Some(array) = value.as_array() {
            for (i, v) in array.iter().enumerate() {
                walk(v, &format!("{path}/{i}"), out);
            }
        }
    }
    let Some(bytes) = &file.content else {
        return "不存在".into();
    };
    let mut fields = Vec::new();
    if let Ok(value) = serde_json::from_slice(bytes) {
        walk(&value, "", &mut fields);
    } else if let Ok(text) = std::str::from_utf8(bytes) {
        if let Ok(doc) = text.parse::<toml_edit::DocumentMut>() {
            for key in ["model", "model_provider"] {
                if let Some(v) = doc.get(key).and_then(|v| v.as_str()) {
                    fields.push(format!("{key}={v}"));
                }
            }
            if let Some(routes) = doc.get("model_providers").and_then(|v| v.as_table()) {
                for (route, item) in routes.iter() {
                    for field in ["base_url", "wire_api", "env_key"] {
                        if let Some(v) = item.get(field).and_then(|v| v.as_str()) {
                            fields.push(format!("{route}.{field}={}", public_field(field, v)));
                        }
                    }
                }
            }
        }
        for line in text.lines() {
            if let Some((key, value)) = line.split_once('=') {
                if ["GEMINI_MODEL", "GOOGLE_GEMINI_BASE_URL"].contains(&key.trim()) {
                    fields.push(format!(
                        "{}={}",
                        key.trim(),
                        public_field(key.trim(), value.trim())
                    ));
                }
            }
        }
    }
    if fields.is_empty() {
        "已有文件；无可展示的公开路由字段（凭证与正文不展示）".into()
    } else {
        fields.join("; ")
    }
}
fn masked_settings(provider: &Provider) -> String {
    let config = &provider.settings_config;
    let mut fields = Vec::new();
    for pointer in [
        "/env/ANTHROPIC_BASE_URL",
        "/env/ANTHROPIC_MODEL",
        "/env/GOOGLE_GEMINI_BASE_URL",
        "/env/GEMINI_MODEL",
        "/options/baseURL",
        "/npm",
        "/baseUrl",
        "/api",
        "/base_url",
        "/api_mode",
    ] {
        if let Some(value) = config.pointer(pointer).and_then(serde_json::Value::as_str) {
            fields.push(format!("{} = {}", pointer, public_field(pointer, value)));
        }
    }
    if let Some(toml) = config.get("config").and_then(serde_json::Value::as_str) {
        if let Ok(doc) = toml.parse::<toml_edit::DocumentMut>() {
            if let Some(route) = doc.get("model_provider").and_then(|i| i.as_str()) {
                for field in ["base_url", "wire_api", "env_key"] {
                    if let Some(value) = doc["model_providers"][route]
                        .get(field)
                        .and_then(|i| i.as_str())
                    {
                        fields.push(format!("Codex {field} = {}", public_field(field, value)));
                    }
                }
            }
            if let Some(model) = doc.get("model").and_then(|i| i.as_str()) {
                fields.push(format!("model = {model}"));
            }
        }
    }
    if let Some(models) = config.get("models") {
        if let Some(o) = models.as_object() {
            fields.push(format!(
                "models = {}",
                o.keys().cloned().collect::<Vec<_>>().join(",")
            ));
        } else if let Some(a) = models.as_array() {
            fields.push(format!(
                "models = {}",
                a.iter()
                    .filter_map(|v| v.get("id").and_then(|v| v.as_str()))
                    .collect::<Vec<_>>()
                    .join(",")
            ));
        }
    }
    if let Some(meta) = &provider.meta {
        for (route, value) in &meta.claude_desktop_model_routes {
            fields.push(format!("Desktop route {route} → {}", value.model));
        }
    }
    fields.push("模型 Key = ••••••••（显式选中的主站 Key）".into());
    fields.join("\n")
}
fn preview(state: &AppState, app: AppType, provider: &Provider) -> Result<Preview, AppError> {
    validate_provider(&app, provider)?;
    if state
        .db
        .get_provider_by_id(&provider.id, app.as_str())?
        .is_some()
    {
        return Err(AppError::Config("创建不能覆盖已有供应商".into()));
    }
    let files = write_set(&app, provider)?
        .into_iter()
        .map(capture)
        .collect::<Result<Vec<_>, _>>()?;
    let changes = files
        .iter()
        .map(|f| {
            format!(
                "{}：当前公开配置 [{}] → 本次创建目标公开字段见下；凭证固定脱敏，保留适配器定义的无关字段",
                f.path.display(),
                safe_file_fields(f)
            )
        })
        .chain(std::iter::once(format!("供应商卡片：不存在 → 新增；配置字段目标：\n{}", masked_settings(provider))))
        .chain(std::iter::once(if app.is_additive_mode() { "实际配置：保留已有供应商，新增本卡片；不更换其他卡片凭证".into() } else { let current=state.db.get_current_provider(app.as_str())?.and_then(|id| state.db.get_provider_by_id(&id, app.as_str()).ok().flatten()); format!("当前配置字段：\n{}\n目标配置字段：\n{}\n已有供应商存在时只保存新卡片，保留当前工具配置；首张卡片按原规则启用。", current.as_ref().map(masked_settings).unwrap_or_else(|| "无当前供应商；保留适配器规定的无关配置字段".into()), masked_settings(provider)) }))
        .chain(matches!(app,AppType::Codex).then(|| "Codex 图片兼容现有状态保持；本次不自动调度派生图片兼容配置收敛".into()))
        .chain(std::iter::once(
            "本地供应商、当前状态和非敏感来源关联将保存；首次供应商可能按既有规则启用".into(),
        ))
        .collect();
    let id = uuid::Uuid::new_v4().to_string();
    let plan = Plan {
        environment: environment_for(&app, provider)?,
        app,
        provider_hash: provider_hash(provider)?,
        files,
        database: state.db.snapshot_to_memory()?,
        created: chrono::Utc::now().timestamp(),
    };
    let mut plans = plans()
        .lock()
        .map_err(|_| AppError::Config("保存计划锁不可用".into()))?;
    plans.retain(|_, p| chrono::Utc::now().timestamp() - p.created < 600);
    plans.insert(id.clone(), plan);
    Ok(Preview { id, changes })
}
#[tauri::command]
pub fn tuzi_provider_preview(
    handle: tauri::AppHandle,
    app: String,
    provider: Provider,
) -> Result<Preview, String> {
    let state = handle.state::<AppState>();
    preview(
        &state,
        app.parse().map_err(|e: AppError| e.to_string())?,
        &provider,
    )
    .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn tuzi_provider_save(
    handle: tauri::AppHandle,
    app: String,
    provider: Provider,
    preview_id: String,
    source: Source,
) -> Result<SaveOutcome, String> {
    validate_source(&handle, &source)?;
    let service = handle.state::<Arc<crate::tuzi_account::AccountService>>();
    let target: AppType = app.parse().map_err(|e: AppError| e.to_string())?;
    let key = model_key(&target, &provider)
        .ok_or("模型 Key 缺失")?
        .to_owned();
    let (protocol, models) = selected_models(&target, &provider)?;
    service
        .provider_qualification(
            source.generation,
            &source.token_id,
            &models,
            protocol,
            target.as_str(),
        )
        .await?;
    service.with_confirmed_model_source(
        &source.user_id,
        source.generation,
        &source.token_id,
        &key,
        || {
            save_confirmed(
                &handle.state::<AppState>(),
                app,
                provider,
                preview_id,
                &source,
            )
        },
    )
}
fn save_confirmed(
    state: &AppState,
    app: String,
    mut provider: Provider,
    preview_id: String,
    source: &Source,
) -> Result<SaveOutcome, String> {
    let _lock = OPERATIONS.lock().map_err(|_| "配置保存锁不可用")?;
    let _operation = super::provider::OperationGuard::acquire().map_err(|e| e.to_string())?;
    let plan = plans()
        .lock()
        .map_err(|_| "配置计划锁不可用")?
        .remove(&preview_id)
        .ok_or("预览已过期，请重新预览")?;
    if plan.app.as_str() != app
        || plan.provider_hash != provider_hash(&provider).map_err(|e| e.to_string())?
        || chrono::Utc::now().timestamp() - plan.created >= 600
    {
        return Err("表单已改变，请重新预览".into());
    }
    files_unchanged(&plan.files).map_err(|e| e.to_string())?;
    let current = state.db.snapshot_to_memory().map_err(|e| e.to_string())?;
    if db_signature(&current).map_err(|e| e.to_string())?
        != db_signature(&plan.database).map_err(|e| e.to_string())?
    {
        return Err("本地状态已变化，请重新预览".into());
    }
    if let Some(environment) = &plan.environment {
        if environment_signature(&capture_environment(&environment.key).map_err(|e| e.to_string())?)
            != environment_signature(environment)
        {
            return Err("环境项已改变，请重新预览".into());
        }
    }
    let dir = backup_directory().join(&preview_id);
    persist_before(&plan, &dir).map_err(|_| "备份失败：未写入工具配置或供应商".to_string())?;
    files_unchanged(&plan.files).map_err(|e| e.to_string())?;
    let submitted_key = model_key(&plan.app, &provider)
        .unwrap_or_default()
        .to_owned();
    let journal = Journal::begin(&plan.files);
    let mut result = (|| -> Result<(), AppError> {
        if matches!(plan.app, AppType::Codex) {
            if let Some(key) = provider
                .settings_config
                .pointer("/auth/OPENAI_API_KEY")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
            {
                let env_key = super::provider::codex_provider_env_key(&provider)
                    .ok_or_else(|| AppError::Config("Codex 必须使用独立环境键".into()))?;
                if !env_key.starts_with("TUZI_SWITCH_") {
                    return Err(AppError::Config("账户配置必须使用独立 Codex 环境键".into()));
                }
                crate::codex_config::write_managed_env_key(&env_key, &key)?;
                provider.settings_config["auth"] = serde_json::json!({});
            }
        }
        super::ProviderService::add(state, plan.app.clone(), provider.clone(), true)?;
        let conn = crate::database::lock_conn!(state.db.conn);
        conn.execute("INSERT INTO tuzi_provider_sources(site,user_id,token_id,app_type,provider_id) VALUES (?1,?2,?3,?4,?5)",rusqlite::params![source.site,source.user_id,source.token_id,app,provider.id])?;
        Ok(())
    })();
    let recorded = journal.after().map_err(|_| {
        format!("配置出现并发修改；已停止自动补偿，请使用备份 {preview_id} 核对恢复")
    })?;
    drop(journal);
    let after = plan
        .files
        .iter()
        .map(|f| {
            recorded
                .iter()
                .find(|r| r.path == f.path)
                .cloned()
                .ok_or_else(|| "写入记录缺失".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let afterdb = state.db.snapshot_to_memory().map_err(|e| e.to_string())?;
    let expected = db_signature(&afterdb).map_err(|e| e.to_string())?;
    let manifest = Manifest {
        app: plan.app.as_str().into(),
        provider_id: provider.id.clone(),
        created_at: plan.created,
        environment: plan.environment.as_ref().map(|e| EnvironmentRecord {
            before: e.clone(),
            expected: environment_signature(&Environment {
                key: e.key.clone(),
                registry: Some(submitted_key.clone()),
                process: Some(submitted_key.clone()),
            }),
        }),
        modes: plan.files.iter().map(mode).collect(),
        expected_modes: after.iter().map(mode).collect(),
        paths: after.iter().map(|f| f.path.clone()).collect(),
        existed: plan.files.iter().map(|f| f.content.is_some()).collect(),
        expected: after
            .iter()
            .map(|f| f.content.as_ref().map(|c| hash(c)))
            .collect(),
        database_expected: expected.clone(),
    };
    if let Err(error) = serde_json::to_vec(&manifest)
        .map_err(|e| AppError::Config(e.to_string()))
        .and_then(|bytes| private_write(&dir.join("after.json"), &bytes))
    {
        result = Err(error);
    }
    if result.is_err() {
        restore_db(
            &state.db,
            &plan.database,
            &expected,
            &app,
            &provider.id,
            || restore_state(&plan.files, &after, &manifest.environment),
        )
        .map_err(|_| {
            format!("保存失败且恢复遇到冲突或IO错误；保留备份 {preview_id}，请核对恢复")
        })?;
        return Err(format!("保存失败，已恢复；备份 {preview_id}"));
    }
    let enabled = if plan.app.is_additive_mode() {
        true
    } else {
        state
            .db
            .get_current_provider(&app)
            .map_err(|e| e.to_string())?
            .as_deref()
            == Some(provider.id.as_str())
    };
    Ok(SaveOutcome {
        backup_id: preview_id,
        enabled,
        tested: false,
    })
}
#[tauri::command]
pub fn tuzi_provider_restore(handle: tauri::AppHandle, backup_id: String) -> Result<(), String> {
    let _lock = OPERATIONS.lock().map_err(|_| "配置锁不可用")?;
    let _operation = super::provider::OperationGuard::acquire().map_err(|e| e.to_string())?;
    uuid::Uuid::parse_str(&backup_id).map_err(|_| "备份编号无效")?;
    let state = handle.state::<AppState>();
    restore_backup(&state, &backup_id)
}
fn restore_backup(state: &AppState, backup_id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(backup_id).map_err(|_| "备份编号无效")?;
    let dir = backup_directory().join(backup_id);
    let manifest: Manifest =
        serde_json::from_slice(&fs::read(dir.join("after.json")).map_err(|_| {
            "此备份需要手工核对；完整原文件与本地数据库已保存在备份目录，自动恢复已阻止"
        })?)
        .map_err(|_| "恢复记录无效")?;
    if manifest.paths.len() != manifest.existed.len()
        || manifest.paths.len() != manifest.expected.len()
        || manifest.paths.len() != manifest.modes.len()
        || (!manifest.expected_modes.is_empty()
            && manifest.paths.len() != manifest.expected_modes.len())
    {
        return Err("恢复记录不完整".into());
    }
    let mut before = Vec::new();
    let mut expected = Vec::new();
    for (i, path) in manifest.paths.iter().enumerate() {
        let current = capture(path.clone()).map_err(|e| e.to_string())?;
        if current.content.as_ref().map(|c| hash(c)) != manifest.expected[i]
            || (!manifest.expected_modes.is_empty() && mode(&current) != manifest.expected_modes[i])
        {
            return Err("配置已被用户修改，恢复中止".into());
        }
        expected.push(current.clone());
        before.push(FileState {
            path: path.clone(),
            content: if manifest.existed[i] {
                Some(fs::read(dir.join(format!("{i}.before"))).map_err(|_| "备份文件不可读")?)
            } else {
                None
            },
            permissions: permissions(manifest.modes[i]),
        });
    }
    let conn = Connection::open(dir.join("before.db")).map_err(|e| e.to_string())?;
    if db_signature(&state.db.snapshot_to_memory().map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?
        != manifest.database_expected
    {
        return Err("本地状态已变化，恢复中止".into());
    }
    restore_db(
        &state.db,
        &conn,
        &manifest.database_expected,
        &manifest.app,
        &manifest.provider_id,
        || restore_state(&before, &expected, &manifest.environment),
    )
    .map_err(|e| e.to_string())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSource {
    pub(crate) site: String,
    pub(crate) user_id: String,
    pub(crate) token_id: String,
    pub(crate) app: String,
    pub(crate) provider_id: String,
}
#[tauri::command]
pub fn tuzi_provider_sources(
    handle: tauri::AppHandle,
    app: Option<String>,
) -> Result<Vec<ProviderSource>, String> {
    let state = handle.state::<AppState>();
    let conn = state.db.conn.lock().map_err(|_| "来源关联不可读取")?;
    read_provider_sources(&conn, app)
}
fn read_provider_sources(
    conn: &rusqlite::Connection,
    app: Option<String>,
) -> Result<Vec<ProviderSource>, String> {
    let mut stmt=conn.prepare("SELECT s.site,s.user_id,s.token_id,s.app_type,s.provider_id FROM tuzi_provider_sources s JOIN providers p ON p.id=s.provider_id AND p.app_type=s.app_type WHERE (?1 IS NULL OR s.app_type=?1) ORDER BY s.app_type,s.provider_id").map_err(|_|"来源关联不可读取")?;
    let rows = stmt
        .query_map([app], |r| {
            Ok(ProviderSource {
                site: r.get(0)?,
                user_id: r.get(1)?,
                token_id: r.get(2)?,
                app: r.get(3)?,
                provider_id: r.get(4)?,
            })
        })
        .map_err(|_| "来源关联不可读取")?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "来源关联不可读取".into())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry {
    backup_id: String,
    app: String,
    provider_id: String,
    created_at: i64,
    manual_recovery: bool,
    backup_path: String,
}
#[tauri::command]
pub fn tuzi_provider_backups(app: Option<String>) -> Result<Vec<RecoveryEntry>, String> {
    let root = backup_directory();
    if !root.exists() {
        return Ok(vec![]);
    }
    let mut entries = Vec::new();
    for entry in fs::read_dir(root).map_err(|_| "备份目录不可读取")? {
        let entry = entry.map_err(|_| "备份目录不可读取")?;
        let id = entry.file_name().to_string_lossy().to_string();
        if uuid::Uuid::parse_str(&id).is_err()
            || !entry.file_type().map_err(|_| "备份类型不可读取")?.is_dir()
        {
            continue;
        }
        let after_manifest = fs::read(entry.path().join("after.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Manifest>(&bytes).ok())
            .filter(|m| {
                m.paths.len() == m.expected.len()
                    && m.paths.len() == m.existed.len()
                    && m.paths.len() == m.modes.len()
                    && (m.expected_modes.is_empty() || m.expected_modes.len() == m.paths.len())
            });
        let manual_recovery = after_manifest.is_none();
        let manifest = match after_manifest {
            Some(m) => m,
            None => {
                let Ok(bytes) = fs::read(entry.path().join("before.json")) else {
                    continue;
                };
                let Ok(m) = serde_json::from_slice::<Manifest>(&bytes) else {
                    continue;
                };
                m
            }
        };
        if app.as_ref().is_some_and(|app| *app != manifest.app) {
            continue;
        }
        entries.push(RecoveryEntry {
            backup_id: id,
            app: manifest.app,
            provider_id: manifest.provider_id,
            created_at: manifest.created_at,
            manual_recovery,
            backup_path: entry.path().display().to_string(),
        });
    }
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.created_at));
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use serial_test::serial;
    fn ordinary_codex(id: &str, key: &str) -> Provider {
        Provider::with_id(
            id.into(),
            format!("Synthetic-{id}"),
            json!({
                "auth":{"OPENAI_API_KEY":key},
                "config":format!("model_provider = \"custom\"\nmodel = \"synthetic-model\"\n[model_providers.custom]\nname = {id:?}\nbase_url = \"https://{id}.invalid/v1\"\nenv_key = \"TUZI_SWITCH_{id}_CODEX_API_KEY\"\nwire_api = \"responses\"\n")
            }),
            None,
        )
    }

    #[test]
    #[serial]
    fn ordinary_codex_add_update_switch_compensate_each_file_write_failure() {
        for operation in ["add", "update", "switch"] {
            let mut failures = 0;
            let mut completed = false;
            for failure_at in 1..25 {
                let _home = Home::new();
                let state = state();
                let a = ordinary_codex("R09A", "sk-synthetic-original");
                let b = ordinary_codex("R09B", "sk-synthetic-second");
                if operation != "add" {
                    super::super::ProviderService::add(&state, AppType::Codex, a.clone(), false)
                        .unwrap();
                }
                if operation != "add" {
                    state.db.conn.lock().unwrap().execute("INSERT INTO provider_health(provider_id,app_type,updated_at) VALUES ('R09A','codex','synthetic')", []).unwrap();
                }
                if operation == "switch" {
                    super::super::ProviderService::add(&state, AppType::Codex, b.clone(), false)
                        .unwrap();
                }
                state
                    .db
                    .set_setting("synthetic-unrelated", "preserved")
                    .unwrap();
                let target = if operation == "switch" {
                    b
                } else {
                    let mut edited = a;
                    edited.settings_config["auth"]["OPENAI_API_KEY"] = json!("sk-synthetic-edited");
                    edited
                };
                let files = write_set(&AppType::Codex, &target)
                    .unwrap()
                    .into_iter()
                    .map(capture)
                    .collect::<Result<Vec<_>, _>>()
                    .unwrap();
                let before = db_signature(&state.db.snapshot_to_memory().unwrap()).unwrap();
                let current =
                    super::super::ProviderService::current(&state, AppType::Codex).unwrap();
                FAIL_WRITE_AT.with(|f| f.set(Some(failure_at)));
                let result = match operation {
                    "add" => super::super::ProviderService::add(
                        &state,
                        AppType::Codex,
                        target.clone(),
                        false,
                    )
                    .map(|_| ()),
                    "update" => super::super::ProviderService::update(
                        &state,
                        AppType::Codex,
                        None,
                        target.clone(),
                    )
                    .map(|_| ()),
                    _ => super::super::ProviderService::switch(&state, AppType::Codex, &target.id)
                        .map(|_| ()),
                };
                let injected = FAIL_WRITE_AT.with(|f| f.replace(None)).is_none();
                if !injected {
                    result.unwrap();
                    let saved = state
                        .db
                        .get_provider_by_id(&target.id, "codex")
                        .unwrap()
                        .unwrap();
                    assert!(saved
                        .settings_config
                        .pointer("/auth/OPENAI_API_KEY")
                        .is_none());
                    completed = true;
                    break;
                }
                assert!(result.is_err(), "{operation} write {failure_at} must fail");
                failures += 1;
                files_unchanged(&files).unwrap_or_else(|e| panic!("{operation}/{failure_at}: {e}"));
                assert_eq!(
                    db_signature(&state.db.snapshot_to_memory().unwrap()).unwrap(),
                    before,
                    "{operation}/{failure_at}"
                );
                assert_eq!(
                    super::super::ProviderService::current(&state, AppType::Codex).unwrap(),
                    current
                );
                if operation != "add" {
                    assert_eq!(
                        state
                            .db
                            .conn
                            .lock()
                            .unwrap()
                            .query_row(
                                "SELECT COUNT(*) FROM provider_health WHERE provider_id='R09A'",
                                [],
                                |r| r.get::<_, i64>(0)
                            )
                            .unwrap(),
                        1
                    );
                }
            }
            assert!(
                completed,
                "{operation} must eventually complete successfully"
            );
            assert!(
                failures >= 3,
                "exercise failures after partial writes for {operation}"
            );
        }
    }

    #[test]
    #[serial]
    fn ordinary_codex_proxy_backup_failure_restores_current_and_backup() {
        let _home = Home::new();
        let state = state();
        let a = ordinary_codex("R09PA", "sk-synthetic-a");
        let b = ordinary_codex("R09PB", "sk-synthetic-b");
        super::super::ProviderService::add(&state, AppType::Codex, a.clone(), false).unwrap();
        super::super::ProviderService::add(&state, AppType::Codex, b.clone(), false).unwrap();
        futures::executor::block_on(
            state
                .db
                .save_live_backup("codex", &a.settings_config.to_string()),
        )
        .unwrap();
        let before = state.db.snapshot_to_memory().unwrap();
        let files = write_set(&AppType::Codex, &b)
            .unwrap()
            .into_iter()
            .map(capture)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        state.db.conn.lock().unwrap().execute_batch("CREATE TRIGGER synthetic_fail_backup BEFORE INSERT ON proxy_live_backup BEGIN SELECT RAISE(ABORT,'synthetic backup failure'); END;").unwrap();
        assert!(super::super::ProviderService::switch(&state, AppType::Codex, &b.id).is_err());
        files_unchanged(&files).unwrap();
        assert_eq!(
            db_signature(&state.db.snapshot_to_memory().unwrap()).unwrap(),
            db_signature(&before).unwrap()
        );
        assert_eq!(
            super::super::ProviderService::current(&state, AppType::Codex).unwrap(),
            a.id
        );
        assert_eq!(
            futures::executor::block_on(state.db.get_live_backup("codex"))
                .unwrap()
                .unwrap()
                .original_config,
            a.settings_config.to_string()
        );
    }

    #[test]
    #[serial]
    fn ordinary_codex_database_failure_restores_submitted_key() {
        let _home = Home::new();
        let state = state();
        let provider = ordinary_codex("R09DB", "sk-synthetic-before");
        super::super::ProviderService::add(&state, AppType::Codex, provider.clone(), false)
            .unwrap();
        let files = write_set(&AppType::Codex, &provider)
            .unwrap()
            .into_iter()
            .map(capture)
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let before = db_signature(&state.db.snapshot_to_memory().unwrap()).unwrap();
        state.db.conn.lock().unwrap().execute_batch("CREATE TRIGGER synthetic_fail_update BEFORE UPDATE ON providers WHEN NEW.id='R09DB' BEGIN SELECT RAISE(ABORT,'synthetic database failure'); END;").unwrap();
        let mut changed = provider;
        changed.settings_config["auth"]["OPENAI_API_KEY"] = json!("sk-synthetic-after");
        assert!(
            super::super::ProviderService::update(&state, AppType::Codex, None, changed).is_err()
        );
        files_unchanged(&files).unwrap();
        assert_eq!(
            db_signature(&state.db.snapshot_to_memory().unwrap()).unwrap(),
            before
        );
    }

    #[test]
    #[serial]
    fn ordinary_codex_restore_failure_reports_retained_private_backup() {
        let _home = Home::new();
        let state = state();
        let provider = ordinary_codex("R09RECOVERY", "sk-synthetic-key");
        FAIL_WRITE_AT.with(|f| f.set(Some(3)));
        RESTORE_FAIL_AT.with(|f| f.set(Some(1)));
        let result = super::super::ProviderService::add(&state, AppType::Codex, provider, false);
        FAIL_WRITE_AT.with(|f| f.set(None));
        RESTORE_FAIL_AT.with(|f| f.set(None));
        assert!(result.unwrap_err().to_string().contains("保留备份"));
        let dir = fs::read_dir(crate::config::get_app_config_dir().join("codex-operation-backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert!(dir.join("before.db").is_file());
        assert!(dir.join("before.json").is_file());
        let backup = Connection::open(dir.join("before.db")).unwrap();
        assert_eq!(
            backup
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE name='proxy_request_logs'",
                    [],
                    |r| r.get::<_, i64>(0)
                )
                .unwrap(),
            0
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&dir).unwrap().permissions().mode() & 0o777,
                0o700
            );
            assert_eq!(
                fs::metadata(dir.join("before.db"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }

    #[test]
    #[serial]
    fn ordinary_codex_external_edit_is_not_overwritten_and_keeps_private_backup() {
        let _home = Home::new();
        let state = state();
        let provider = ordinary_codex("R09EXTERNAL", "sk-synthetic-key");
        let _operation = super::super::provider::OperationGuard::acquire().unwrap();
        let path = crate::codex_config::get_codex_config_path();
        let result: Result<(), AppError> = codex_transaction::run(&state, &provider, || {
            crate::config::atomic_write(&path, b"model = \"synthetic\"\n")?;
            fs::write(&path, b"# synthetic external edit\n").unwrap();
            Err(AppError::Config("synthetic operation failure".into()))
        });
        assert!(result.unwrap_err().to_string().contains("保留备份"));
        assert_eq!(fs::read(&path).unwrap(), b"# synthetic external edit\n");
        let backups = crate::config::get_app_config_dir().join("codex-operation-backups");
        assert_eq!(fs::read_dir(backups).unwrap().count(), 1);
    }

    #[test]
    fn configured_sources_only_include_existing_matching_tool_providers() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE providers(id TEXT, app_type TEXT);
            CREATE TABLE tuzi_provider_sources(site TEXT,user_id TEXT,token_id TEXT,app_type TEXT,provider_id TEXT);
            INSERT INTO providers VALUES ('existing','codex'),('same-id','claude');
            INSERT INTO tuzi_provider_sources VALUES
              ('https://api.tu-zi.com','synthetic-user','101','codex','existing'),
              ('https://api.tu-zi.com','synthetic-user','102','codex','deleted'),
              ('https://api.tu-zi.com','synthetic-user','103','codex','same-id');").unwrap();
        let sources = read_provider_sources(&conn, None).unwrap();
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0].provider_id, "existing");
        assert!(read_provider_sources(&conn, Some("claude".into()))
            .unwrap()
            .is_empty());
        conn.execute("DELETE FROM providers WHERE id='existing'", [])
            .unwrap();
        assert!(read_provider_sources(&conn, None).unwrap().is_empty());
        // Projection must preserve source history for transaction backups/recovery.
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM tuzi_provider_sources", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            3
        );
    }
    struct Home {
        #[cfg(windows)]
        _environment: TestEnvironmentGuard,
        _temp: tempfile::TempDir,
        old: Option<std::ffi::OsString>,
    }
    impl Home {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let old = std::env::var_os("CC_SWITCH_TEST_HOME");
            std::env::set_var("CC_SWITCH_TEST_HOME", temp.path());
            crate::settings::reload_settings().unwrap();
            Self {
                #[cfg(windows)]
                _environment: TestEnvironmentGuard::new(&[
                    "TUZI_SWITCH_SYNTHETIC_CODEX_API_KEY",
                    "TUZI_SWITCH_SECOND_CODEX_API_KEY",
                ]),
                _temp: temp, old,
            }
        }
    }
    impl Drop for Home {
        fn drop(&mut self) {
            match &self.old {
                Some(old) => std::env::set_var("CC_SWITCH_TEST_HOME", old),
                None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
            };
            let _ = crate::settings::reload_settings();
        }
    }
    fn state() -> AppState {
        let db = Database::memory().unwrap();
        {
            let conn = db.conn.lock().unwrap();
            conn.execute("DELETE FROM providers", []).unwrap();
        }
        AppState::new(Arc::new(db))
    }
    fn source() -> Source {
        Source {
            site: "https://api.tu-zi.com".into(),
            user_id: "synthetic-user".into(),
            token_id: "101".into(),
            generation: 1,
        }
    }
    fn provider(app: &AppType) -> Provider {
        let key = "sk-synthetic-model-key-T15";
        let config = match app {
            AppType::Claude | AppType::ClaudeDesktop => {
                json!({"env":{"ANTHROPIC_BASE_URL":"https://apius.tu-zi.com","ANTHROPIC_AUTH_TOKEN":key,"ANTHROPIC_MODEL":"synthetic-model"}})
            }
            AppType::Codex => {
                json!({"auth":{"OPENAI_API_KEY":key},"env":{"envKey":"TUZI_SWITCH_SYNTHETIC_CODEX_API_KEY"},"config":"model_provider = \"custom\"\nmodel = \"synthetic-model\"\n[model_providers.custom]\nname = \"Tuzi\"\nbase_url = \"https://api.tu-zi.com/v1\"\nwire_api = \"responses\"\nenv_key = \"TUZI_SWITCH_SYNTHETIC_CODEX_API_KEY\"\n"})
            }
            AppType::Gemini => {
                json!({"env":{"GEMINI_API_KEY":key,"GOOGLE_GEMINI_BASE_URL":"https://api.tu-zi.com","GEMINI_MODEL":"synthetic-model"},"config":{}})
            }
            AppType::OpenCode => {
                json!({"npm":"@ai-sdk/openai","options":{"baseURL":"https://api.tu-zi.com/v1","apiKey":key},"models":{"synthetic-model":{"name":"Synthetic"}}})
            }
            AppType::OpenClaw => {
                json!({"baseUrl":"https://api.tu-zi.com/v1","apiKey":key,"api":"openai-completions","models":[{"id":"synthetic-model","name":"Synthetic"}]})
            }
            AppType::Hermes => {
                json!({"base_url":"https://api.tu-zi.com/v1","api_key":key,"api_mode":"codex_responses","models":[{"id":"synthetic-model"}]})
            }
        };
        let mut provider = Provider::with_id(
            uuid::Uuid::new_v4().to_string(),
            format!("Synthetic {}", app.as_str()),
            config,
            Some("https://api.tu-zi.com".into()),
        );
        provider.category = Some("third_party".into());
        if matches!(app, AppType::ClaudeDesktop) {
            provider.meta=Some(serde_json::from_value(json!({"claudeDesktopMode":"proxy","apiFormat":"anthropic","claudeDesktopModelRoutes":{"claude-sonnet-4-6":{"model":"synthetic-model"}}})).unwrap());
        }
        provider
    }
    fn manifest(id: &str) -> Manifest {
        serde_json::from_slice(&fs::read(backup_directory().join(id).join("after.json")).unwrap())
            .unwrap()
    }
    #[test]
    #[serial]
    fn actual_frontend_form_payloads_save_and_restore_all_seven_tools() {
        // These synthetic payloads are checked against actual React form submissions.
        for (app, payload) in [
            (
                AppType::Claude,
                include_str!("../../../tests/fixtures/b11-provider-claude.json"),
            ),
            (
                AppType::ClaudeDesktop,
                include_str!("../../../tests/fixtures/b11-provider-claude-desktop.json"),
            ),
            (
                AppType::Codex,
                include_str!("../../../tests/fixtures/b11-provider-codex.json"),
            ),
            (
                AppType::Gemini,
                include_str!("../../../tests/fixtures/b11-provider-gemini.json"),
            ),
            (
                AppType::OpenCode,
                include_str!("../../../tests/fixtures/b11-provider-opencode.json"),
            ),
            (
                AppType::OpenClaw,
                include_str!("../../../tests/fixtures/b11-provider-openclaw.json"),
            ),
            (
                AppType::Hermes,
                include_str!("../../../tests/fixtures/b11-provider-hermes.json"),
            ),
        ] {
            let _home = Home::new();
            let state = state();
            let provider: Provider = serde_json::from_str(payload).unwrap();
            #[cfg(not(any(target_os = "macos", windows)))]
            if matches!(app, AppType::ClaudeDesktop) {
                continue;
            }
            let plan = preview(&state, app.clone(), &provider)
                .unwrap_or_else(|e| panic!("{} preview: {e}", app.as_str()));
            assert!(plan
                .changes
                .iter()
                .all(|value| !value.contains("sk-SYNTHETIC_ACCOUNT_MODEL_KEY")));
            let saved = save_confirmed(
                &state,
                app.as_str().into(),
                provider.clone(),
                plan.id,
                &source(),
            )
            .unwrap_or_else(|e| panic!("{} save: {e}", app.as_str()));
            assert!(!saved.tested);
            assert!(state
                .db
                .get_provider_by_id(&provider.id, app.as_str())
                .unwrap()
                .is_some());
            restore_backup(&state, &saved.backup_id).unwrap();
            assert!(state
                .db
                .get_provider_by_id(&provider.id, app.as_str())
                .unwrap()
                .is_none());
        }
    }
    #[test]
    #[serial]
    fn seven_adapters_save_complete_backup_restore_and_conflict() {
        for app in AppType::all() {
            let _home = Home::new();
            let state = state();
            let provider = provider(&app);
            #[cfg(not(any(target_os = "macos", windows)))]
            if matches!(app, AppType::ClaudeDesktop) {
                assert!(preview(&state, app, &provider).is_err());
                continue;
            }
            let expected_paths = write_set(&app, &provider).unwrap();
            let before = state.db.snapshot_to_memory().unwrap();
            let p = preview(&state, app.clone(), &provider).unwrap();
            assert!(p
                .changes
                .iter()
                .all(|c| !c.contains("sk-synthetic-model-key-T15")));
            let saved = save_confirmed(
                &state,
                app.as_str().into(),
                provider.clone(),
                p.id,
                &source(),
            )
            .unwrap_or_else(|e| panic!("{}: {e}", app.as_str()));
            assert!(!saved.tested);
            assert!(state
                .db
                .get_provider_by_id(&provider.id, app.as_str())
                .unwrap()
                .is_some());
            let backup = manifest(&saved.backup_id);
            assert_eq!(backup.paths, expected_paths);
            assert!(backup_directory()
                .join(&saved.backup_id)
                .join("before.db")
                .exists());
            let changed = backup
                .paths
                .iter()
                .zip(backup.expected.iter())
                .find(|(_, hash)| hash.is_some())
                .map(|(p, _)| p.clone())
                .unwrap();
            let content = fs::read(&changed).unwrap();
            fs::write(&changed, b"synthetic user concurrent edit").unwrap();
            assert!(restore_backup(&state, &saved.backup_id)
                .unwrap_err()
                .contains("用户修改"));
            assert_eq!(
                fs::read(&changed).unwrap(),
                b"synthetic user concurrent edit"
            );
            fs::write(&changed, content).unwrap();
            restore_backup(&state, &saved.backup_id).unwrap();
            assert_eq!(
                db_signature(&state.db.snapshot_to_memory().unwrap()).unwrap(),
                db_signature(&before).unwrap()
            );
            for path in expected_paths {
                assert!(
                    !path.exists(),
                    "{} left restored new file {}",
                    app.as_str(),
                    path.display()
                );
            }
        }
    }
    #[test]
    #[serial]
    fn backup_failure_zero_writes_and_preview_conflicts() {
        let _home = Home::new();
        let state = state();
        let app = AppType::Gemini;
        let provider = provider(&app);
        let p = preview(&state, app.clone(), &provider).unwrap();
        let before = db_signature(&state.db.snapshot_to_memory().unwrap()).unwrap();
        let backup_root = backup_directory();
        fs::create_dir_all(backup_root.parent().unwrap()).unwrap();
        fs::write(&backup_root, b"synthetic backup failure").unwrap();
        assert!(save_confirmed(
            &state,
            app.as_str().into(),
            provider.clone(),
            p.id,
            &source()
        )
        .unwrap_err()
        .contains("备份失败"));
        assert_eq!(
            db_signature(&state.db.snapshot_to_memory().unwrap()).unwrap(),
            before
        );
        assert!(!crate::gemini_config::get_gemini_env_path().exists());
        fs::remove_file(backup_root).unwrap();
        let p = preview(&state, app.clone(), &provider).unwrap();
        let env = crate::gemini_config::get_gemini_env_path();
        crate::config::atomic_write(&env, b"synthetic user edit").unwrap();
        assert!(
            save_confirmed(&state, app.as_str().into(), provider, p.id, &source())
                .unwrap_err()
                .contains("配置已")
        );
        assert_eq!(fs::read(env).unwrap(), b"synthetic user edit");
    }
    #[test]
    #[serial]
    fn every_supported_adapter_compensates_write_failure() {
        for app in AppType::all() {
            let _home = Home::new();
            let state = state();
            let provider = provider(&app);
            #[cfg(not(any(target_os = "macos", windows)))]
            if matches!(app, AppType::ClaudeDesktop) {
                continue;
            }
            let paths = write_set(&app, &provider).unwrap();
            let before = db_signature(&state.db.snapshot_to_memory().unwrap()).unwrap();
            let p = preview(&state, app.clone(), &provider).unwrap();
            FAIL_WRITE_AT.with(|f| {
                f.set(Some(
                    if matches!(
                        app,
                        AppType::Gemini | AppType::ClaudeDesktop | AppType::Codex
                    ) {
                        2
                    } else {
                        1
                    },
                ))
            });
            let error =
                save_confirmed(&state, app.as_str().into(), provider, p.id, &source()).unwrap_err();
            FAIL_WRITE_AT.with(|f| f.set(None));
            assert!(error.contains("已恢复"), "{}: {error}", app.as_str());
            assert_eq!(
                db_signature(&state.db.snapshot_to_memory().unwrap()).unwrap(),
                before,
                "{} database",
                app.as_str()
            );
            for path in paths {
                assert!(
                    !path.exists(),
                    "{} left partial file {}",
                    app.as_str(),
                    path.display()
                );
            }
        }
    }
    #[test]
    fn native_matrix_rejects_wrong_protocol_endpoint_and_credential_destination() {
        for app in AppType::all() {
            let mut p = provider(&app);
            assert!(validate_provider(&app, &p).is_ok());
            p.category = Some("coding".into());
            assert!(validate_provider(&app, &p).is_err());
        }
        let mut p = provider(&AppType::OpenClaw);
        p.settings_config["api"] = json!("responses");
        assert!(validate_provider(&AppType::OpenClaw, &p).is_err());
        let mut p = provider(&AppType::Codex);
        p.settings_config["config"]=json!("model_provider=\"custom\"\n[model_providers.custom]\nbase_url=\"https://coding.tu-zi.com/v1\"\nwire_api=\"responses\"\nenv_key=\"OPENAI_API_KEY\"");
        assert!(validate_provider(&AppType::Codex, &p).is_err());
    }
    #[test]
    #[serial]
    fn journal_rejects_unbacked_writes_and_mid_operation_edits() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("synthetic.json");
        fs::write(&path, b"before").unwrap();
        let journal = Journal::begin(&[capture(path.clone()).unwrap()]);
        crate::config::atomic_write(&path, b"owned write").unwrap();
        assert!(crate::config::atomic_write(&temp.path().join("unbacked"), b"unexpected").is_err());
        fs::write(&path, b"synthetic external edit").unwrap();
        assert!(crate::config::atomic_write(&path, b"overwrite").is_err());
        assert!(journal.after().is_err());
        drop(journal);
        assert_eq!(fs::read(path).unwrap(), b"synthetic external edit");
    }
    #[test]
    #[serial]
    fn incomplete_after_record_remains_discoverable_and_refuses_automatic_restore() {
        let _home = Home::new();
        let state = state();
        let p = provider(&AppType::Claude);
        let preview = preview(&state, AppType::Claude, &p).unwrap();
        let plan = plans().lock().unwrap().remove(&preview.id).unwrap();
        let dir = backup_directory().join(&preview.id);
        persist_before(&plan, &dir).unwrap();
        fs::write(dir.join("after.json"), b"{truncated").unwrap();
        let entries = tuzi_provider_backups(None).unwrap();
        let entry = entries.iter().find(|e| e.backup_id == preview.id).unwrap();
        assert!(entry.manual_recovery);
        assert!(entry.backup_path.contains(&preview.id));
        assert!(restore_backup(&state, &preview.id).is_err());
    }
    #[test]
    fn environment_ownership_signature_is_selected_value_not_backup_or_external() {
        let before = Environment {
            key: "TUZI_SWITCH_SYNTHETIC".into(),
            registry: None,
            process: None,
        };
        let owned = Environment {
            key: before.key.clone(),
            registry: Some("sk-synthetic-T15".into()),
            process: Some("sk-synthetic-T15".into()),
        };
        assert_ne!(
            environment_signature(&before),
            environment_signature(&owned)
        );
        let external = Environment {
            registry: Some("sk-synthetic-external".into()),
            ..owned.clone()
        };
        assert_ne!(
            environment_signature(&external),
            environment_signature(&owned)
        );
    }
    #[test]
    #[cfg(unix)]
    #[serial]
    fn chmod_conflict_is_detected_at_preview_write_and_after() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("synthetic");
        fs::write(&path, b"same").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        let original = capture(path.clone()).unwrap();
        let journal = Journal::begin(&[original.clone()]);
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(files_unchanged(&[original]).is_err());
        assert!(crate::config::atomic_write(&path, b"different").is_err());
        assert!(journal.after().is_err());
    }
    #[test]
    fn seven_final_provider_forms_select_actual_models_and_protocols() {
        for app in AppType::all() {
            let p = provider(&app);
            let (protocol, models) = selected_models(&app, &p).unwrap();
            assert!(!protocol.is_empty());
            assert_eq!(models, vec!["synthetic-model"], "{}", app.as_str());
        }
        let mut p = provider(&AppType::ClaudeDesktop);
        p.meta
            .as_mut()
            .unwrap()
            .claude_desktop_model_routes
            .get_mut("claude-sonnet-4-6")
            .unwrap()
            .model = "synthetic-edited-route".into();
        assert_eq!(
            selected_models(&AppType::ClaudeDesktop, &p).unwrap().1,
            vec!["synthetic-edited-route"]
        );
    }
    #[test]
    #[serial]
    fn second_codex_card_preserves_first_credential_and_unrelated_state() {
        let _home = Home::new();
        let state = state();
        assert!(crate::settings::codex_image_render_compat());
        let first = provider(&AppType::Codex);
        let preview1 = preview(&state, AppType::Codex, &first).unwrap();
        save_confirmed(
            &state,
            "codex".into(),
            first.clone(),
            preview1.id,
            &source(),
        )
        .unwrap();
        assert!(!crate::codex_config::get_codex_config_dir()
            .join("skills/codex-image-render-fallback")
            .exists());
        assert!(!crate::config::get_app_config_dir()
            .join("codex-image-compat-takeover-owner")
            .exists());
        let managed = crate::codex_config::get_codex_config_dir().join(".env");
        let first_bytes = fs::read(&managed).unwrap();
        let mut second = provider(&AppType::Codex);
        second.name = "Synthetic second Codex".into();
        second.settings_config["auth"]["OPENAI_API_KEY"] =
            json!("sk-synthetic-second-model-key-R07");
        second.settings_config["env"]["envKey"] = json!("TUZI_SWITCH_SECOND_CODEX_API_KEY");
        second.settings_config["config"] =
            json!(second.settings_config["config"].as_str().unwrap().replace(
                "TUZI_SWITCH_SYNTHETIC_CODEX_API_KEY",
                "TUZI_SWITCH_SECOND_CODEX_API_KEY"
            ));
        state
            .db
            .set_setting("synthetic-unrelated", "preserve-me")
            .unwrap();
        let p = preview(&state, AppType::Codex, &second).unwrap();
        let saved =
            save_confirmed(&state, "codex".into(), second.clone(), p.id, &source()).unwrap();
        let both = fs::read_to_string(&managed).unwrap();
        assert!(both.contains("TUZI_SWITCH_SYNTHETIC_CODEX_API_KEY"));
        assert!(both.contains("TUZI_SWITCH_SECOND_CODEX_API_KEY"));
        // Use the production async resolver used by model checks and proxying,
        // after the real account save has stripped inline auth from the DB.
        let runtime = tokio::runtime::Runtime::new().unwrap();
        for (id, expected) in [
            (&first.id, "sk-synthetic-model-key-T15"),
            (&second.id, "sk-synthetic-second-model-key-R07"),
        ] {
            let stored = state.db.get_provider_by_id(id, "codex").unwrap().unwrap();
            assert_eq!(stored.settings_config["auth"], json!({}));
            let auth = runtime
                .block_on(crate::proxy::providers::resolve_codex_auth(&stored))
                .expect("saved provider credential must resolve");
            assert_eq!(auth.api_key, expected);
        }

        restore_backup(&state, &saved.backup_id).unwrap();
        assert_eq!(fs::read(managed).unwrap(), first_bytes);
        assert!(state
            .db
            .get_provider_by_id(&first.id, "codex")
            .unwrap()
            .is_some());
        assert!(state
            .db
            .get_provider_by_id(&second.id, "codex")
            .unwrap()
            .is_none());
        assert_eq!(
            state
                .db
                .get_setting("synthetic-unrelated")
                .unwrap()
                .as_deref(),
            Some("preserve-me")
        );
        let exported = state.db.export_sql_string_for_sync().unwrap();
        assert!(!exported.contains("synthetic-user"));
    }
    #[test]
    #[serial]
    fn restore_file_failure_compensates_already_restored_files() {
        let temp = tempfile::tempdir().unwrap();
        let a = temp.path().join("a");
        let b = temp.path().join("b");
        fs::write(&a, b"before-a").unwrap();
        fs::write(&b, b"before-b").unwrap();
        let before = vec![capture(a.clone()).unwrap(), capture(b.clone()).unwrap()];
        fs::write(&a, b"saved-a").unwrap();
        fs::write(&b, b"saved-b").unwrap();
        let expected = vec![capture(a.clone()).unwrap(), capture(b.clone()).unwrap()];
        RESTORE_FAIL_AT.with(|f| f.set(Some(2)));
        assert!(restore_files(&before, &expected).is_err());
        assert_eq!(fs::read(a).unwrap(), b"saved-a");
        assert_eq!(fs::read(b).unwrap(), b"saved-b");
    }
    #[test]
    fn preview_url_fields_never_expose_userinfo_query_or_fragment() {
        let secret="https://user:synthetic-password@example.invalid/v1?api_key=synthetic-query#synthetic-fragment";
        let mut p = provider(&AppType::Claude);
        p.settings_config["env"]["ANTHROPIC_BASE_URL"] = json!(secret);
        let display = masked_settings(&p);
        assert!(display.contains("https://example.invalid/v1"));
        for secret in [
            "user:",
            "synthetic-password",
            "synthetic-query",
            "synthetic-fragment",
        ] {
            assert!(!display.contains(secret));
        }
        let file = FileState {
            path: PathBuf::from("synthetic.json"),
            content: Some(serde_json::to_vec(&p.settings_config).unwrap()),
            permissions: None,
        };
        let fields = safe_file_fields(&file);
        assert!(fields.contains("https://example.invalid/v1"));
        assert!(!fields.contains("synthetic-password"));
        assert!(!fields.contains("synthetic-query"));
        assert!(!fields.contains("synthetic-fragment"));
        assert_eq!(
            public_display("https://[invalid?api_key=synthetic"),
            "无效地址（已脱敏）"
        );
    }
}
