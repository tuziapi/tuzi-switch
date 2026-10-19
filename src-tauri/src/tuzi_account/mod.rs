//! Account system-token connection. Credentials stay in a private native local file.
pub mod business;
mod store;
mod prefill;
#[cfg(test)]
mod tests;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}},
    time::Duration,
};
use store::{LocalFileStore, TokenStore};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use url::Url;
use zeroize::{Zeroize, ZeroizeOnDrop};
#[cfg(all(feature = "local-preview", not(debug_assertions)))]
compile_error!("local-preview is restricted to debug builds");
#[cfg(not(feature = "local-preview"))]
const ORIGIN: &str = "https://api.tu-zi.com";
#[cfg(feature = "local-preview")]
const ORIGIN: &str = "http://127.0.0.1:5180";
// Keep account identity stable; old Keychain records are not read or migrated.
#[cfg(not(feature = "local-preview"))]
const CLIENT: &str = "tuzi-switch-desktop";
#[cfg(feature = "local-preview")]
const CLIENT: &str = "tuzi-switch-desktop-test";
fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountError {
    pub code: String,
    pub message: String,
    pub retry_after: Option<u64>,
}
impl AccountError {
    fn new(code: &str) -> Self {
        Self {
            code: code.into(),
            message: code.into(),
            retry_after: None,
        }
    }
    fn storage() -> Self {
        Self::new("secure_storage_unavailable")
    }
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub user_id: String,
    pub username: String,
    pub display_name: String,
    pub connection_id: String,
}
#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountState {
    pub status: String,
    pub generation: u64,
    pub revision: u64,
    pub identity: Option<Identity>,
    pub error: Option<AccountError>,
    pub local_cleared: bool,
    pub remote_revoked: Option<bool>,
    pub expires_at: Option<i64>,
    pub grant_expires_at: Option<i64>,
}
impl Default for AccountState {
    fn default() -> Self {
        Self {
            status: "disconnected".into(),
            generation: 0,
            revision: 0,
            identity: None,
            error: None,
            local_cleared: true,
            remote_revoked: None,
            expires_at: None,
            grant_expires_at: None,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
struct Tokens {
    access_token: String,
    user_id: String,
    connection_id: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Record {
    version: u32,
    origin: String,
    client: String,
    generation: u64,
    #[serde(default)]
    tokens: Option<Tokens>,
    #[serde(default)]
    identity: Option<Identity>,
}
impl Default for Record {
    fn default() -> Self {
        Self {
            version: 2,
            origin: ORIGIN.into(),
            client: CLIENT.into(),
            generation: 0,
            tokens: None,
            identity: None,
        }
    }
}
struct ModelKeyProof {
    generation: u64,
    user_id: String,
    token_id: String,
    key_hash: [u8; 32],
    expires: i64,
}
struct Inner {
    token_prefill: Option<prefill::TokenPrefill>,
    model_key_proof: Option<ModelKeyProof>,
    record: Record,
    state: AccountState,
    loaded: bool,
}
pub struct AccountService {
    inner: Mutex<Inner>,
    operation: tokio::sync::Mutex<()>,
    store: Arc<dyn TokenStore>,
    http: reqwest::Client,
    origin: String,
    client: String,
    app: Mutex<Option<tauri::AppHandle>>,
    revision: std::sync::atomic::AtomicU64,
    business_pending: Mutex<std::collections::HashMap<String, tokio::sync::watch::Sender<bool>>>,
}
impl AccountService {
    /// Keep a confirmed account source valid throughout a synchronous local
    /// provider transaction. Logout cannot change the generation while the
    /// closure performs the approved write set. The closure must not call back
    /// into this account service.
    pub fn with_confirmed_source<T>(
        &self,
        user_id: &str,
        generation: u64,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.load();
        let i = self.inner.lock().unwrap();
        if i.record.generation != generation
            || i.state.status != "connected"
            || i.record.tokens.is_none()
            || i.state
                .identity
                .as_ref()
                .is_none_or(|identity| identity.user_id != user_id)
        {
            return Err("stale_account".into());
        }
        write()
    }
    /// A source association may only consume the exact model Key explicitly revealed
    /// by this native session. Hash-only proof is memory-local and expires with the draft.
    pub fn with_confirmed_model_source<T>(
        &self,
        user_id: &str,
        generation: u64,
        token_id: &str,
        key: &str,
        write: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        self.load();
        let mut i = self.inner.lock().unwrap();
        if i.record.generation != generation
            || i.state.status != "connected"
            || i.record.tokens.is_none()
            || i.state
                .identity
                .as_ref()
                .is_none_or(|identity| identity.user_id != user_id)
        {
            return Err("stale_account".into());
        }
        let digest: [u8; 32] = Sha256::digest(key.as_bytes()).into();
        if !key.starts_with("sk-")
            || i.model_key_proof.as_ref().is_none_or(|proof| {
                proof.generation != generation
                    || proof.user_id != user_id
                    || proof.token_id != token_id
                    || proof.key_hash != digest
                    || proof.expires <= now()
            })
        {
            return Err("model_key_reveal_required".into());
        }
        let result = write();
        if result.is_ok() {
            i.model_key_proof = None;
        }
        result
    }
    fn remember_model_key_reveal(
        &self,
        generation: u64,
        token_id: &str,
        key: &str,
    ) -> Result<(), AccountError> {
        let mut i = self.inner.lock().unwrap();
        if i.record.generation != generation || i.state.status != "connected" {
            return Err(AccountError::new("stale_account"));
        }
        if !key.starts_with("sk-") || key.contains(['\r', '\n']) {
            return Err(AccountError::new("invalid_response"));
        }
        let user_id = i
            .state
            .identity
            .as_ref()
            .ok_or_else(|| AccountError::new("stale_account"))?
            .user_id
            .clone();
        i.model_key_proof = Some(ModelKeyProof {
            generation,
            user_id,
            token_id: token_id.into(),
            key_hash: Sha256::digest(key.as_bytes()).into(),
            expires: now() + 600,
        });
        Ok(())
    }

    pub fn new() -> Result<Self, AccountError> {
        Self::with_store(Arc::new(LocalFileStore::new(ORIGIN, CLIENT)?), ORIGIN, CLIENT)
    }
    fn with_store(
        store: Arc<dyn TokenStore>,
        origin: &str,
        client: &str,
    ) -> Result<Self, AccountError> {
        let url = Url::parse(origin).map_err(|_| AccountError::new("untrusted_origin"))?;
        if !(origin == ORIGIN
            || cfg!(test) && url.scheme() == "http" && url.host_str() == Some("127.0.0.1"))
        {
            return Err(AccountError::new("untrusted_origin"));
        }
        let http = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|_| AccountError::new("http_unavailable"))?;
        Ok(Self {
            inner: Mutex::new(Inner {
                token_prefill: None,
                model_key_proof: None,
                record: Record {
                    origin: origin.into(),
                    client: client.into(),
                    ..Default::default()
                },
                state: Default::default(),
                loaded: false,
            }),
            operation: tokio::sync::Mutex::new(()),
            store,
            http,
            origin: origin.into(),
            client: client.into(),
            app: Mutex::new(None),
            revision: std::sync::atomic::AtomicU64::new(0),
            business_pending: Mutex::new(std::collections::HashMap::new()),
        })
    }
    pub fn attach(self: &Arc<Self>, app: tauri::AppHandle) {
        *self.app.lock().unwrap() = Some(app);
    }
    fn publish(&self, state: &mut AccountState) {
        state.revision = self
            .revision
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            + 1;
        if let Some(app) = self.app.lock().unwrap().as_ref() {
            emit(app, state);
        }
    }
    fn persist(&self, record: &Record) -> Result<(), AccountError> {
        self.store.write(record)
    }
    fn load(&self) {
        let mut i = self.inner.lock().unwrap();
        if i.loaded {
            return;
        }
        match self.store.read() {
            Err(e) => {
                i.state.status = "error".into();
                i.state.error = Some(e);
                i.state.local_cleared = false;
                return;
            }
            Ok(None) => {}
            Ok(Some(r)) => {
                i.state.generation = r.generation;
                if r.origin != self.origin || r.client != self.client || r.version != 2 {
                    i.state.status = "invalid".into();
                    i.state.error = Some(AccountError::new("reconnect_required"));
                    i.state.local_cleared = false;
                    i.record.generation = r.generation;
                } else {
                    i.state.local_cleared = r.tokens.is_none();
                    if r.tokens.is_some() {
                        i.state.status = "offline".into();
                    }
                    i.record = r;
                }
            }
        }
        i.loaded = true;
    }
    pub fn state(&self) -> AccountState {
        self.load();
        self.inner.lock().unwrap().state.clone()
    }
    fn fail(&self, generation: u64, e: AccountError, invalid: bool) -> AccountState {
        let mut i = self.inner.lock().unwrap();
        if i.record.generation == generation {
            i.state.status = if invalid {
                "invalid"
            } else if e.code == "network_uncertain" {
                "offline"
            } else {
                "error"
            }
            .into();
            i.state.error = Some(e);
            if invalid {
                i.model_key_proof = None;
                i.token_prefill = None;
                i.state.identity = None;
            }
            self.publish(&mut i.state);
        }
        i.state.clone()
    }
    async fn identity(&self, token: &str, user: Option<&str>) -> Result<Identity, AccountError> {
        let mut request = self
            .http
            .get(format!("{}/api/user/self/bootstrap", self.origin))
            .bearer_auth(token);
        if let Some(user) = user {
            request = request.header("New-Api-User", user);
        }
        let response = self
            .business_response(request, false)
            .await
            .map_err(|e| AccountError::new(&e.code))?;
        let data = &response["data"];
        let id = data["id"]
            .as_i64()
            .filter(|id| *id > 0)
            .map(|id| id.to_string())
            .ok_or_else(|| AccountError::new("invalid_response"))?;
        if user.is_some_and(|u| u != id) {
            return Err(AccountError::new("identity_mismatch"));
        }
        Ok(Identity {
            user_id: id,
            username: data["username"].as_str().unwrap_or("").into(),
            display_name: data["display_name"].as_str().unwrap_or("").into(),
            connection_id: String::new(),
        })
    }
    pub async fn connect(&self, token: String) -> AccountState {
        let token = zeroize::Zeroizing::new(token);
        self.load();
        let _operation = self.operation.lock().await;
        let generation = {
            let mut i = self.inner.lock().unwrap();
            let generation = i.record.generation + 1;
            let r = Record {
                generation,
                origin: self.origin.clone(),
                client: self.client.clone(),
                ..Default::default()
            };
            if let Err(e) = self.persist(&r) {
                drop(i);
                return self.fail(self.state().generation, e, false);
            }
            i.record = r;
            i.model_key_proof = None;
            i.token_prefill = None;
            i.state = AccountState {
                status: "verifying".into(),
                generation,
                ..Default::default()
            };
            self.publish(&mut i.state);
            generation
        };
        for sender in self.business_pending.lock().unwrap().values() {
            let _ = sender.send(true);
        }
        if token.trim().is_empty()
            || token.len() > 4096
            || token
                .trim()
                .chars()
                .any(|c| c.is_control() || c.is_whitespace())
        {
            return self.fail(
                generation,
                AccountError::new("invalid_token"),
                true,
            );
        }
        let mut identity = match self.identity(token.trim(), None).await {
            Ok(v) => v,
            Err(e) => {
                return self.fail(
                    generation,
                    e.clone(),
                    matches!(
                        e.code.as_str(),
                        "invalid_token" | "account_disabled" | "identity_mismatch"
                    ),
                )
            }
        };
        identity.connection_id = uuid::Uuid::new_v4().to_string();
        let mut i = self.inner.lock().unwrap();
        if i.record.generation != generation {
            return i.state.clone();
        }
        let mut r = i.record.clone();
        r.tokens = Some(Tokens {
            access_token: token.trim().into(),
            user_id: identity.user_id.clone(),
            connection_id: identity.connection_id.clone(),
        });
        r.identity = Some(identity.clone());
        if let Err(e) = self.persist(&r) {
            drop(i);
            return self.fail(generation, e, false);
        }
        i.record = r;
        i.state = AccountState {
            status: "connected".into(),
            generation,
            identity: Some(identity),
            local_cleared: false,
            ..Default::default()
        };
        self.publish(&mut i.state);
        i.state.clone()
    }
    pub async fn retry(&self) -> AccountState {
        self.load();
        let _operation = self.operation.lock().await;
        let (t, generation) = {
            let i = self.inner.lock().unwrap();
            if i.state.status == "invalid" {
                return i.state.clone();
            }
            let Some(t) = i.record.tokens.clone() else {
                return i.state.clone();
            };
            (t, i.record.generation)
        };
        match self.identity(&t.access_token, Some(&t.user_id)).await {
            Ok(mut identity) => {
                identity.connection_id = t.connection_id.clone();
                let mut i = self.inner.lock().unwrap();
                if i.record.generation == generation {
                    i.state.status = "connected".into();
                    i.state.identity = Some(identity);
                    i.state.error = None;
                    self.publish(&mut i.state);
                }
                i.state.clone()
            }
            Err(e) => {
                let invalid = matches!(
                    e.code.as_str(),
                    "invalid_token" | "account_disabled" | "identity_mismatch"
                );
                self.fail(generation, e, invalid)
            }
        }
    }
    pub async fn logout(&self) -> AccountState {
        self.load();
        let mut i = self.inner.lock().unwrap();
        let generation = i.record.generation + 1;
        let r = Record {
            generation,
            origin: self.origin.clone(),
            client: self.client.clone(),
            ..Default::default()
        };
        let result = self.persist(&r);
        i.record = r;
        i.model_key_proof = None;
        i.token_prefill = None;
        i.state = AccountState {
            generation,
            ..Default::default()
        };
        if let Err(e) = result {
            i.state.status = "error".into();
            i.state.error = Some(e);
            i.state.local_cleared = false;
        }
        for sender in self.business_pending.lock().unwrap().values() {
            let _ = sender.send(true);
        }
        self.publish(&mut i.state);
        i.state.clone()
    }
}
fn emit(app: &tauri::AppHandle, state: &AccountState) {
    let _ = app.emit("account-state-changed", state);
}
pub fn is_import_input(input: &str) -> bool {
    Url::parse(input).is_ok_and(|u| {
        u.scheme() == "tuziswitch"
            && u.host_str() == Some("v1")
            && u.path() == "/import"
            && u.username().is_empty()
            && u.password().is_none()
            && u.port().is_none()
    })
}
pub fn is_auth_input(input: &str) -> bool {
    input.to_ascii_lowercase().starts_with("tuziswitch://auth")
}
static OPEN_ACCOUNT_PENDING: AtomicBool = AtomicBool::new(false);
// A navigation route only. Never accept credentials or a caller-supplied destination.
pub fn is_account_navigation(input: &str) -> bool {
    Url::parse(input).is_ok_and(|u| u.scheme() == "tuziswitch"
        && u.host_str() == Some("account") && u.path() == "/connect"
        && u.query().is_none() && u.fragment().is_none()
        && u.username().is_empty() && u.password().is_none() && u.port().is_none())
}
#[tauri::command]
pub fn account_take_open_request() -> bool {
    OPEN_ACCOUNT_PENDING.swap(false, Ordering::SeqCst)
}
// Old A callbacks and invalid account links are consumed, never sent to import/logging.
pub fn handle_callback(app: &tauri::AppHandle, input: &str) -> bool {
    if is_account_navigation(input) {
        if let Some(service) = app.try_state::<Arc<AccountService>>() {
            if let Some(pending) = service.inner.lock().unwrap().token_prefill.as_mut() {
                pending.returned();
            }
        }
        OPEN_ACCOUNT_PENDING.store(true, Ordering::SeqCst);
        let _ = app.emit("account-open-requested", ());
        return true;
    }
    is_auth_input(input) || input.to_ascii_lowercase().starts_with("tuziswitch://account")
}
#[tauri::command]
pub async fn account_get_state(
    service: tauri::State<'_, Arc<AccountService>>,
) -> Result<AccountState, AccountError> {
    let state = service.state();
    Ok(if state.status == "offline" {
        service.retry().await
    } else {
        state
    })
}
#[tauri::command]
pub async fn account_connect(
    service: tauri::State<'_, Arc<AccountService>>,
    token: String,
) -> Result<AccountState, AccountError> {
    Ok(service.connect(token).await)
}
#[tauri::command]
pub async fn account_open_token_page(app: tauri::AppHandle, service: tauri::State<'_, Arc<AccountService>>) -> Result<(), AccountError> {
    service.load();
    {
        let mut inner = service.inner.lock().unwrap();
        inner.token_prefill = if inner.state.identity.is_none() && inner.state.status != "verifying" {
            Some(prefill::TokenPrefill::new(inner.state.generation))
        } else { None };
    }
    let result = app.opener().open_url(
        format!("{ORIGIN}/console/personal?source=tuzi-assistant#system-token"), None::<&str>,
    ).map_err(|_| AccountError::new("browser_unavailable"));
    if result.is_err() { service.inner.lock().unwrap().token_prefill = None; }
    result
}
#[tauri::command]
pub fn account_cancel_token_prefill(service: tauri::State<'_, Arc<AccountService>>) {
    service.inner.lock().unwrap().token_prefill = None;
}
#[tauri::command]
pub async fn account_take_token_prefill(service: tauri::State<'_, Arc<AccountService>>) -> Result<Option<String>, AccountError> {
    let service = service.inner().clone();
    Ok(tokio::task::spawn_blocking(move || service.take_token_prefill(|| {
        arboard::Clipboard::new().ok()?.get_text().ok()
    })).await.ok().flatten())
}
impl AccountService {
    fn take_token_prefill(&self, read: impl FnOnce() -> Option<String>) -> Option<String> {
        let mut inner = self.inner.lock().unwrap();
        // Consume before touching the clipboard, including rejection/read failure.
        let pending = inner.token_prefill.take()?;
        if !pending.permits(inner.state.generation) || inner.state.identity.is_some() || inner.state.status == "verifying" {
            return None;
        }
        let mut value = read()?;
        if prefill::is_system_token_candidate(&value) { Some(value) }
        else { value.zeroize(); None }
    }
}
#[tauri::command]
pub async fn account_logout(
    service: tauri::State<'_, Arc<AccountService>>,
) -> Result<AccountState, AccountError> {
    Ok(service.logout().await)
}
#[tauri::command]
pub async fn account_retry(
    service: tauri::State<'_, Arc<AccountService>>,
) -> Result<AccountState, AccountError> {
    Ok(service.retry().await)
}
