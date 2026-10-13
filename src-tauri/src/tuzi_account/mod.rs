//! Desktop OAuth is deliberately separate from tool credentials and configuration/export.
mod store;
#[cfg(test)]
mod tests;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::Duration,
};
use store::{SystemStore, TokenStore};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use url::Url;
use zeroize::{Zeroize, ZeroizeOnDrop};

pub mod business;
const ORIGIN: &str = "https://api.tu-zi.com";
const CLIENT: &str = "tuzi-switch-desktop";
const CALLBACK: &str = "tuziswitch://auth/callback";
const SCOPES: &str = "account:read token:read token:write token:reveal logs:read usage:read models:read profile:read profile:write offline_access";
fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountError {
    pub code: String,
    pub message: String,
    pub retry_after: Option<u64>,
    #[serde(skip)]
    refresh_not_consumed: bool,
}
impl AccountError {
    fn new(code: &str) -> Self {
        Self {
            code: code.into(),
            message: code.into(),
            retry_after: None,
            refresh_not_consumed: false,
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
struct Pending {
    state: String,
    verifier: String,
    expires: i64,
    generation: u64,
}
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
struct Tokens {
    access_token: String,
    refresh_token: String,
    user_id: String,
    connection_id: String,
    access_expires: i64,
    refresh_expires: i64,
    grant_expires: i64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Record {
    version: u32,
    origin: String,
    client: String,
    generation: u64,
    pending: Option<Pending>,
    tokens: Option<Tokens>,
    identity: Option<Identity>,
    refresh_in_flight: bool,
    #[serde(default)]
    refresh_retry_at: i64,
}
impl Default for Record {
    fn default() -> Self {
        Self {
            version: 1,
            origin: ORIGIN.into(),
            client: CLIENT.into(),
            generation: 0,
            pending: None,
            tokens: None,
            identity: None,
            refresh_in_flight: false,
            refresh_retry_at: 0,
        }
    }
}
struct Inner {
    record: Record,
    state: AccountState,
    loaded: bool,
    cleanup_token: Option<Tokens>,
    retry_not_before: i64,
    maintenance_attempts: u8,
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
            || i.record.refresh_in_flight
            || i.record
                .tokens
                .as_ref()
                .is_none_or(|t| t.grant_expires <= now() || t.refresh_expires <= now())
            || i.state
                .identity
                .as_ref()
                .is_none_or(|identity| identity.user_id != user_id)
        {
            return Err("stale_account".into());
        }
        write()
    }
    pub fn new() -> Result<Self, AccountError> {
        Self::with_store(Arc::new(SystemStore::new(ORIGIN, CLIENT)?), ORIGIN, CLIENT)
    }
    fn with_store(
        store: Arc<dyn TokenStore>,
        origin: &str,
        client: &str,
    ) -> Result<Self, AccountError> {
        let url = Url::parse(origin).map_err(|_| AccountError::new("untrusted_origin"))?;
        let trusted = origin == ORIGIN
            || cfg!(test) && url.scheme() == "http" && url.host_str() == Some("127.0.0.1");
        if !trusted {
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
                record: Record::default(),
                state: AccountState::default(),
                loaded: false,
                cleanup_token: None,
                retry_not_before: 0,
                maintenance_attempts: 0,
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
        *self.app.lock().unwrap() = Some(app.clone());
        let weak = Arc::downgrade(self);
        tauri::async_runtime::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(5)).await;
                let Some(service) = weak.upgrade() else { break; };
                let state = service.state(); // Expire pending even after process restart.
                let visible = app.get_webview_window("main").is_some_and(|w| w.is_visible().unwrap_or(false));
                if visible && matches!(state.status.as_str(), "connected" | "offline") {
                    let due = service.take_maintenance_attempt(visible);
                    if due { service.retry().await; }
                }
            }
        });
    }
    fn take_maintenance_attempt(&self, visible: bool) -> bool {
        let mut i = self.inner.lock().unwrap();
        let due = visible && matches!(i.state.status.as_str(), "connected" | "offline")
            && i.record.tokens.as_ref().is_some_and(|t| t.access_expires <= now() + 30)
            && i.retry_not_before <= now() && i.maintenance_attempts < 3;
        if due { i.maintenance_attempts += 1; }
        due
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
    fn load(&self) {
        let mut i = self.inner.lock().unwrap();
        if i.loaded {
            return;
        }
        match self.store.read() {
            Err(e) => {
                i.state.status = "error".into();
                i.state.local_cleared = false;
                i.state.error = Some(e);
                return;
            }
            Ok(None) => {}
            Ok(Some(r)) => {
                if r.version != 1 || r.origin != self.origin || r.client != self.client {
                    i.state.status = "error".into();
                    i.state.local_cleared = false;
                    i.state.error = Some(AccountError::new("storage_invalid"));
                    return;
                }
                i.state.generation = r.generation;
                i.record = r;
                i.retry_not_before = i.record.refresh_retry_at;
                i.state.local_cleared = i.record.tokens.is_none() && !i.record.refresh_in_flight;
                if i.record.refresh_in_flight {
                    i.state.status = "invalid".into();
                    i.state.error = Some(AccountError::new("refresh_uncertain"));
                    // Never reuse a possibly consumed RT. Persisted journal remains a tombstone.
                } else if i.record.pending.as_ref().is_some_and(|p| p.expires > now()) {
                    i.state.status = "authorizing".into();
                } else if i.record.tokens.is_some() {
                    i.state.status = "offline".into();
                    i.state.local_cleared = false;
                    // Identity is shown only after the stored authorization is verified online.
                }
            }
        }
        i.loaded = true;
    }
    pub fn state(&self) -> AccountState {
        self.load();
        let mut i = self.inner.lock().unwrap();
        if i.record
            .pending
            .as_ref()
            .is_some_and(|p| p.expires <= now())
        {
            let mut r = i.record.clone();
            r.pending = None;
            match self.persist(&r) {
                Ok(()) => {
                    i.record = r;
                    i.state.status = "invalid".into();
                    i.state.error = Some(AccountError::new("authorization_timeout"));
                }
                Err(e) => {
                    i.state.status = "error".into();
                    i.state.error = Some(e);
                }
            }
            self.publish(&mut i.state);
        }
        if i.state.status == "connected" && i.record.tokens.as_ref().is_some_and(|t| t.access_expires <= now()) {
            i.state.status = "offline".into();
            i.state.error = Some(AccountError::new("access_expired"));
            self.publish(&mut i.state);
        }
        i.state.clone()
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
            i.retry_not_before = now().saturating_add(e.retry_after.unwrap_or(30).max(1).min(i64::MAX as u64) as i64);
            i.state.error = Some(e);
            if invalid {
                i.state.identity = None;
                // Block in-memory reuse even if the secure-store write fails.
                let mut r = i.record.clone();
                r.refresh_in_flight = r.tokens.is_some();
                if self.persist(&r).is_err() {
                    i.state.local_cleared = false;
                    i.state.error = Some(AccountError::storage());
                }
                i.record = r;
            }
            self.publish(&mut i.state);
        }
        i.state.clone()
    }
    fn persist(&self, record: &Record) -> Result<(), AccountError> {
        self.store.write(record)
    }
    pub fn begin(&self) -> Result<(AccountState, String), AccountError> {
        self.load();
        let mut i = self.inner.lock().unwrap();
        if !i.loaded || (!i.state.local_cleared && i.record.tokens.is_none()) {
            return Err(AccountError::storage());
        }
        if i.record.tokens.is_some() {
            return Err(AccountError::new("logout_required"));
        }
        let mut bytes = [0u8; 32];
        OsRng.fill_bytes(&mut bytes);
        let state = URL_SAFE_NO_PAD.encode(bytes);
        OsRng.fill_bytes(&mut bytes);
        let verifier = URL_SAFE_NO_PAD.encode(bytes);
        bytes.zeroize();
        let generation = i.record.generation + 1;
        let mut record = i.record.clone();
        record.generation = generation;
        record.pending = Some(Pending {
            state: state.clone(),
            verifier: verifier.clone(),
            expires: now() + 600,
            generation,
        });
        record.refresh_in_flight = false;
        self.persist(&record)?;
        i.record = record;
        i.state = AccountState {
            status: "authorizing".into(),
            generation,
            ..Default::default()
        };
        self.publish(&mut i.state);
        let mut url = Url::parse(&format!("{}/oauth/authorize", self.origin)).unwrap();
        url.query_pairs_mut().extend_pairs([
            ("response_type", "code"),
            ("client_id", &self.client),
            ("redirect_uri", CALLBACK),
            ("scope", SCOPES),
            ("state", &state),
            ("code_challenge_method", "S256"),
            (
                "code_challenge",
                &URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())),
            ),
        ]);
        Ok((i.state.clone(), url.to_string()))
    }
    async fn response<T: serde::de::DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, AccountError> {
        let response = request
            .send()
            .await
            .map_err(|_| AccountError::new("network_uncertain"))?;
        let status = response.status();
        if !status.is_success() {
            let mut e = AccountError::new(match status.as_u16() {
                400 | 401 => "invalid_grant",
                403 => "insufficient_scope",
                429 => "rate_limited",
                404 | 409 => "protocol_unavailable",
                503 => "temporarily_unavailable",
                _ => "server_error",
            });
            e.retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|x| x.to_str().ok())
                .and_then(|x| x.parse().ok());
            let marked = matches!(status.as_u16(), 429 | 503)
                && response.headers().get_all("OAuth-Refresh-Outcome").iter().count() == 1
                && response.headers().get("OAuth-Refresh-Outcome").is_some_and(|h| h == "not-consumed");
            if marked {
                // Drain and validate the bounded response. A truncated or foreign
                // response never proves that the refresh was rejected preflight.
                let mut response = response;
                let mut body = zeroize::Zeroizing::new(Vec::new());
                while let Some(chunk) = response.chunk().await.map_err(|_| AccountError::new("network_uncertain"))? {
                    if body.len() + chunk.len() > 65536 { return Err(AccountError::new("invalid_response")); }
                    body.extend_from_slice(&chunk);
                }
                e.refresh_not_consumed = serde_json::from_slice::<serde_json::Value>(&body)
                    .ok()
                    .is_some_and(|v| {
                        v.get("error").and_then(|v| v.as_str()) == Some("temporarily_unavailable")
                    });
            }
            return Err(e);
        }
        if response.content_length().is_some_and(|n| n > 65536) {
            return Err(AccountError::new("invalid_response"));
        }
        let mut response = response;
        let mut bytes = zeroize::Zeroizing::new(Vec::new());
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| AccountError::new("network_uncertain"))?
        {
            if bytes.len() + chunk.len() > 65536 {
                return Err(AccountError::new("invalid_response"));
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| AccountError::new("invalid_response"))
    }
    async fn revoke(&self, token: &str) -> bool {
        self.http
            .post(format!("{}/api/oauth-provider/revoke", self.origin))
            .form(&[
                ("client_id", self.client.as_str()),
                ("token", token),
                ("token_type_hint", "refresh_token"),
            ])
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
    }
    async fn identity(&self, t: &Tokens) -> Result<Identity, AccountError> {
        let u: UserInfo = self
            .response(
                self.http
                    .get(format!("{}/api/oauth-provider/userinfo", self.origin))
                    .bearer_auth(&t.access_token),
            )
            .await?;
        if u.sub != t.user_id || u.user_id != t.user_id {
            return Err(AccountError::new("identity_mismatch"));
        }
        Ok(Identity {
            user_id: u.user_id,
            username: u.preferred_username,
            display_name: u.name,
            connection_id: t.connection_id.clone(),
        })
    }
    async fn commit_tokens(
        &self,
        generation: u64,
        t: Tokens,
        verified: Option<Identity>,
    ) -> AccountState {
        {
            let mut i = self.inner.lock().unwrap();
            if i.record.generation == generation {
                i.state.status = "verifying".into();
                self.publish(&mut i.state);
            }
        }
        let identity_result = match verified {
            Some(v) => Ok(v),
            None => self.identity(&t).await,
        };
        let identity = match identity_result {
            Ok(v) => v,
            Err(e) => {
                self.revoke(&t.refresh_token).await;
                return self.fail(generation, e, true);
            }
        };
        let result = {
            let mut i = self.inner.lock().unwrap();
            if generation != i.record.generation {
                Err(AccountError::new("cancelled"))
            } else {
                let mut r = i.record.clone();
                r.tokens = Some(t.clone());
                r.identity = Some(identity.clone());
                r.pending = None;
                r.refresh_in_flight = false;
                r.refresh_retry_at = 0;
                match self.persist(&r) {
                    Err(e) => Err(e),
                    Ok(()) => {
                        i.record = r;
                        i.maintenance_attempts = 0;
                        i.retry_not_before = 0;
                        i.state = AccountState {
                            status: "connected".into(),
                            generation,
                            revision: 0,
                            identity: Some(identity),
                            error: None,
                            local_cleared: false,
                            remote_revoked: None,
                            expires_at: Some(t.access_expires),
                            grant_expires_at: Some(t.grant_expires),
                        };
                        self.publish(&mut i.state);
                        Ok(i.state.clone())
                    }
                }
            }
        };
        match result {
            Ok(s) => s,
            Err(e) => {
                self.revoke(&t.refresh_token).await;
                self.fail(generation, e, true)
            }
        }
    }
    pub async fn callback(&self, input: &str) -> AccountState {
        self.load();
        let parsed = match parse_callback(input) {
            Ok(p) => p,
            Err(_) => return self.state(),
        };
        let _operation = self.operation.lock().await;
        let (pending, generation) = {
            let mut i = self.inner.lock().unwrap();
            let Some(p) = i.record.pending.clone() else {
                return i.state.clone();
            };
            if parsed.state != p.state || p.expires <= now() || p.generation != i.record.generation
            {
                return i.state.clone();
            }
            let mut r = i.record.clone();
            r.pending = None;
            if let Err(e) = self.persist(&r) {
                i.state.error = Some(e);
                i.state.status = "error".into();
                return i.state.clone();
            }
            i.record = r;
            i.state.status = "exchanging".into();
            self.publish(&mut i.state);
            (p, i.record.generation)
        };
        let Some(code) = parsed.code else {
            return self.fail(generation, AccountError::new("access_denied"), true);
        };
        let wire: WireTokens = match self
            .response(
                self.http
                    .post(format!("{}/api/oauth-provider/token", self.origin))
                    .form(&[
                        ("grant_type", "authorization_code"),
                        ("client_id", self.client.as_str()),
                        ("redirect_uri", CALLBACK),
                        ("code", &code),
                        ("code_verifier", &pending.verifier),
                    ]),
            )
            .await
        {
            Ok(w) => w,
            Err(e) => return self.fail(generation, e, true),
        };
        let t = match wire.validate(now(), None) {
            Ok(t) => t,
            Err(e) => {
                self.revoke(&wire.refresh_token).await;
                return self.fail(generation, e, true);
            }
        };
        self.commit_tokens(generation, t, None).await
    }
    pub async fn retry(&self) -> AccountState {
        self.retry_inner(None).await
    }
    async fn retry_inner(&self, rejected_access: Option<&str>) -> AccountState {
        self.load();
        let clear_failed = {
            let i = self.inner.lock().unwrap();
            !i.state.local_cleared && i.record.tokens.is_none()
        };
        if clear_failed {
            return self.logout().await;
        }
        let _operation = self.operation.lock().await;
        let (t, generation) = {
            let i = self.inner.lock().unwrap();
            if i.record.refresh_in_flight || i.retry_not_before > now() {
                return i.state.clone();
            }
            let Some(t) = i.record.tokens.clone() else {
                return i.state.clone();
            };
            (t, i.record.generation)
        };
        if rejected_access.is_some_and(|rejected| rejected != t.access_token) {
            return self.state(); // Another waiter already completed this refresh.
        }
        if t.grant_expires <= now() || t.refresh_expires <= now() {
            return self.fail(generation, AccountError::new("authorization_expired"), true);
        }
        if rejected_access.is_none() && t.access_expires > now() + 30 {
            match self.identity(&t).await {
                Ok(identity) => return self.commit_tokens(generation, t, Some(identity)).await,
                Err(e) if e.code == "invalid_grant" => {}
                Err(e) => return self.fail(generation, e, false),
            }
        }
        {
            let mut i = self.inner.lock().unwrap();
            if i.record.generation != generation {
                return i.state.clone();
            }
            let mut r = i.record.clone();
            r.refresh_in_flight = true;
            if let Err(e) = self.persist(&r) {
                i.state.status = "error".into();
                i.state.error = Some(e);
                return i.state.clone();
            }
            i.record = r;
            i.state.status = "refreshing".into();
            self.publish(&mut i.state);
        }
        let wire: WireTokens = match self
            .response(
                self.http
                    .post(format!("{}/api/oauth-provider/token", self.origin))
                    .form(&[
                        ("grant_type", "refresh_token"),
                        ("client_id", self.client.as_str()),
                        ("refresh_token", &t.refresh_token),
                    ]),
            )
            .await
        {
            Ok(w) => w,
            Err(e) if e.refresh_not_consumed => {
                let mut i = self.inner.lock().unwrap();
                if i.record.generation != generation { return i.state.clone(); }
                let mut r = i.record.clone();
                r.refresh_in_flight = false;
                r.refresh_retry_at = now().saturating_add(e.retry_after.unwrap_or(30).max(1).min(i64::MAX as u64) as i64);
                match self.persist(&r) {
                    Ok(()) => {
                        i.retry_not_before = r.refresh_retry_at;
                        i.record = r;
                        i.state.status = "offline".into();
                        i.state.error = Some(e);
                    }
                    Err(e) => {
                        // Original durable in-flight record remains terminal. Do
                        // not reuse the RT until safe storage can be confirmed.
                        i.state.status = "invalid".into();
                        i.state.identity = None;
                        i.state.local_cleared = false;
                        i.state.error = Some(e);
                    }
                }
                self.publish(&mut i.state);
                return i.state.clone();
            }
            Err(e) => {
                let remote = self.revoke(&t.refresh_token).await;
                self.fail(generation, e, true);
                let mut i = self.inner.lock().unwrap();
                if i.record.generation == generation { i.state.remote_revoked = Some(remote); self.publish(&mut i.state); }
                return i.state.clone();
            }
        };
        let next = match wire.validate(now(), Some(&t)) {
            Ok(t) => t,
            Err(e) => {
                self.revoke(&wire.refresh_token).await;
                return self.fail(generation, e, true);
            }
        };
        self.commit_tokens(generation, next, None).await
    }
    pub async fn logout(&self) -> AccountState {
        self.load();
        for sender in self.business_pending.lock().unwrap().values() {
            let _ = sender.send(true);
        }
        let (token, generation) = {
            let mut i = self.inner.lock().unwrap();
            let token = i.record.tokens.clone().or_else(|| i.cleanup_token.clone());
            let generation = i.record.generation + 1;
            let r = Record {
                generation,
                origin: self.origin.clone(),
                client: self.client.clone(),
                ..Default::default()
            };
            let saved = self.persist(&r);
            i.record = r;
            i.cleanup_token = token.clone();
            i.retry_not_before = 0;
            i.maintenance_attempts = 0;
            i.state = AccountState {
                generation,
                local_cleared: saved.is_ok(),
                ..Default::default()
            };
            if let Err(e) = saved {
                i.state.status = "error".into();
                i.state.error = Some(e);
            }
            self.publish(&mut i.state);
            (token, generation)
        };
        let remote = match token {
            Some(t) => Some(self.revoke(&t.refresh_token).await),
            None => None,
        };
        let mut i = self.inner.lock().unwrap();
        if i.record.generation == generation {
            if remote == Some(true) || i.state.local_cleared { i.cleanup_token = None; }
            i.state.remote_revoked = remote;
            self.publish(&mut i.state);
        }
        i.state.clone()
    }
}
#[derive(Deserialize)]
struct UserInfo {
    sub: String,
    user_id: String,
    preferred_username: String,
    name: String,
}
#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
struct WireTokens {
    access_token: String,
    refresh_token: String,
    token_type: String,
    expires_in: i64,
    scope: String,
    user_id: String,
    refresh_expires_in: i64,
    connection_id: String,
    grant_expires_at: i64,
    scope_version: String,
}
impl WireTokens {
    fn validate(&self, at: i64, old: Option<&Tokens>) -> Result<Tokens, AccountError> {
        let mut scopes = self.scope.split_whitespace().collect::<Vec<_>>();
        scopes.sort();
        let mut required = SCOPES.split_whitespace().collect::<Vec<_>>();
        required.sort();
        let valid = self.token_type == "Bearer"
            && self.scope_version == "desktop-v1"
            && scopes == required
            && self.access_token.len() >= 43
            && self.refresh_token.len() >= 43
            && self.access_token.len() <= 1024
            && self.refresh_token.len() <= 1024
            && !self.user_id.is_empty()
            && self.user_id.bytes().all(|c| c.is_ascii_digit())
            && uuid::Uuid::parse_str(&self.connection_id).is_ok()
            && (1..=1800).contains(&self.expires_in)
            && (1..=604800).contains(&self.refresh_expires_in)
            && self.grant_expires_at > at
            && self.grant_expires_at <= at + 2592000
            && at + self.expires_in <= self.grant_expires_at + 5
            && at + self.refresh_expires_in <= self.grant_expires_at + 5
            && old.is_none_or(|o| {
                o.user_id == self.user_id
                    && o.connection_id == self.connection_id
                    && o.grant_expires == self.grant_expires_at
            });
        if !valid {
            return Err(AccountError::new("invalid_response"));
        }
        Ok(Tokens {
            access_token: self.access_token.clone(),
            refresh_token: self.refresh_token.clone(),
            user_id: self.user_id.clone(),
            connection_id: self.connection_id.clone(),
            access_expires: (at + self.expires_in).min(self.grant_expires_at),
            refresh_expires: (at + self.refresh_expires_in).min(self.grant_expires_at),
            grant_expires: self.grant_expires_at,
        })
    }
}
struct Callback {
    state: String,
    code: Option<String>,
}
fn parse_callback(input: &str) -> Result<Callback, AccountError> {
    let bad = || AccountError::new("invalid_callback");
    let u = Url::parse(input).map_err(|_| bad())?;
    if u.scheme() != "tuziswitch"
        || u.host_str() != Some("auth")
        || u.path() != "/callback"
        || u.port().is_some()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.fragment().is_some()
    {
        return Err(bad());
    }
    let mut q = BTreeMap::new();
    for (k, v) in u.query_pairs() {
        if !["state", "code", "error", "error_description"].contains(&k.as_ref())
            || q.insert(k.into_owned(), v.into_owned()).is_some()
        {
            return Err(bad());
        }
    }
    let state = q.remove("state").ok_or_else(bad)?;
    if !(43..=128).contains(&state.len())
        || !state
            .bytes()
            .all(|x| x.is_ascii_alphanumeric() || b"-._~".contains(&x))
    {
        return Err(bad());
    }
    let code = q.remove("code");
    let error = q.remove("error");
    if code.is_some() == error.is_some()
        || code
            .as_ref()
            .is_some_and(|v| v.is_empty() || v.len() > 1024)
        || code.is_some() && q.contains_key("error_description")
    {
        return Err(bad());
    }
    Ok(Callback { state, code })
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
        || Url::parse(input)
            .is_ok_and(|u| u.scheme() == "tuziswitch" && u.host_str() == Some("auth"))
}
pub fn handle_callback(app: &tauri::AppHandle, input: &str) -> bool {
    // Route all auth-host inputs away from the tool import parser, including malformed auth callbacks.
    if !is_auth_input(input) {
        return false;
    }
    let app = app.clone();
    let input = input.to_string();
    tauri::async_runtime::spawn(async move {
        let service = app.state::<Arc<AccountService>>();
        let state = service.callback(&input).await;
        emit(&app, &state);
    });
    true
}
#[tauri::command]
pub async fn account_get_state(
    service: tauri::State<'_, Arc<AccountService>>,
) -> Result<AccountState, AccountError> {
    let state = service.state();
    if state.status == "offline" {
        Ok(service.retry().await)
    } else {
        Ok(state)
    }
}
#[tauri::command]
pub async fn account_start_login(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<AccountService>>,
) -> Result<AccountState, AccountError> {
    let previous = service.state();
    if matches!(previous.status.as_str(), "invalid" | "error" | "offline") {
        let cleared = service.logout().await;
        if !cleared.local_cleared {
            return Err(AccountError::storage());
        }
    }
    let (state, url) = service.begin()?;
    if app.opener().open_url(url, None::<&str>).is_err() {
        let state = service.logout().await;
        emit(&app, &state);
        return Err(AccountError::new("browser_unavailable"));
    }
    emit(&app, &state);
    let generation = state.generation;
    let service = service.inner().clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(600)).await;
        if service.state().generation == generation {
            let state = service.state();
            emit(&app, &state);
        }
    });
    Ok(state)
}
#[tauri::command]
pub async fn account_cancel_login(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<AccountService>>,
) -> Result<AccountState, AccountError> {
    let state = service.logout().await;
    emit(&app, &state);
    Ok(state)
}
#[tauri::command]
pub async fn account_logout(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<AccountService>>,
) -> Result<AccountState, AccountError> {
    let state = service.logout().await;
    emit(&app, &state);
    Ok(state)
}
#[tauri::command]
pub async fn account_retry(
    app: tauri::AppHandle,
    service: tauri::State<'_, Arc<AccountService>>,
) -> Result<AccountState, AccountError> {
    service.inner.lock().unwrap().maintenance_attempts = 0;
    let state = service.retry().await;
    emit(&app, &state);
    Ok(state)
}
