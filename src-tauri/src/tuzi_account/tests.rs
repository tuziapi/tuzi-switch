use super::*;
#[derive(Default)]
struct MemoryStore {
    record: Mutex<Option<Record>>,
    fail: Mutex<bool>,
}
impl TokenStore for MemoryStore {
    fn read(&self) -> Result<Option<Record>, AccountError> {
        if *self.fail.lock().unwrap() {
            Err(AccountError::storage())
        } else {
            Ok(self.record.lock().unwrap().clone())
        }
    }
    fn write(&self, r: &Record) -> Result<(), AccountError> {
        if *self.fail.lock().unwrap() {
            Err(AccountError::storage())
        } else {
            *self.record.lock().unwrap() = Some(r.clone());
            Ok(())
        }
    }
}
#[test]
fn isolated_origin_pending_survives_restart_without_production_namespace() {
    let store = Arc::new(MemoryStore::default());
    let origin = "http://127.0.0.1:5180";
    let client = "tuzi-switch-desktop-test";
    let service = AccountService::with_store(store.clone(), origin, client).unwrap();
    let (_, url) = service.begin().unwrap();
    assert!(url.starts_with("http://127.0.0.1:5180/oauth/authorize?"));
    let restarted = AccountService::with_store(store.clone(), origin, client).unwrap();
    assert_eq!(restarted.state().status, "authorizing");
    assert_eq!(store.record.lock().unwrap().as_ref().unwrap().client, client);
    assert!(AccountService::with_store(store, "https://example.com", client).is_err());
}
#[test]
fn callback_rejects_ambiguous_and_untrusted_inputs() {
    let state = "S".repeat(43);
    for tail in [
        "&state=other",
        "&error=access_denied",
        "#fragment",
        "&access_token=synthetic",
        "&error_description=x",
    ] {
        assert!(parse_callback(&format!("{CALLBACK}?state={state}&code=synthetic{tail}")).is_err());
    }
    for root in [
        "tuziswitch://evil/callback",
        "tuziswitch://auth:42/callback",
        "tuziswitch://user@auth/callback",
        "tuziswitch://auth/callback/",
    ] {
        assert!(parse_callback(&format!("{root}?state={state}&code=synthetic")).is_err());
    }
    assert!(parse_callback(&format!("{CALLBACK}?state={state}&code=synthetic")).is_ok());
}
#[test]
fn secure_storage_failure_never_creates_pending() {
    let store = Arc::new(MemoryStore::default());
    *store.fail.lock().unwrap() = true;
    let s = AccountService::with_store(store.clone(), ORIGIN, CLIENT).unwrap();
    assert_eq!(s.state().status, "error");
    assert!(s.begin().is_err());
    assert!(store.record.lock().unwrap().is_none());
}
#[tokio::test]
async fn cancellation_and_replay_cannot_consume_pending() {
    let store = Arc::new(MemoryStore::default());
    let s = AccountService::with_store(store.clone(), ORIGIN, CLIENT).unwrap();
    let (a, url) = s.begin().unwrap();
    let u = Url::parse(&url).unwrap();
    let q = u.query_pairs().collect::<BTreeMap<_, _>>();
    assert_eq!(q.get("scope").unwrap(), SCOPES);
    assert_eq!(q.get("code_challenge_method").unwrap(), "S256");
    assert_eq!(q.get("state").unwrap().len(), 43);
    let state = q.get("state").unwrap();
    let wrong = s
        .callback(&format!(
            "{CALLBACK}?state={}&code=synthetic",
            "X".repeat(43)
        ))
        .await;
    assert_eq!(wrong.status, "authorizing");
    let cancelled = s.logout().await;
    assert!(cancelled.generation > a.generation);
    assert_eq!(
        s.callback(&format!("{CALLBACK}?state={state}&code=synthetic"))
            .await
            .status,
        "disconnected"
    );
    assert!(store
        .record
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .pending
        .is_none());
}
#[test]
fn journal_crash_recovery_is_terminal_until_explicit_logout() {
    let store = Arc::new(MemoryStore::default());
    let mut r = Record::default();
    r.refresh_in_flight = true;
    r.generation = 7;
    store.write(&r).unwrap();
    let s = AccountService::with_store(store, ORIGIN, CLIENT).unwrap();
    assert_eq!(s.state().status, "invalid");
    assert_eq!(s.state().error.unwrap().code, "refresh_uncertain");
}
#[test]
fn ipc_and_debug_projection_excludes_secrets() {
    let store = Arc::new(MemoryStore::default());
    let s = AccountService::with_store(store, ORIGIN, CLIENT).unwrap();
    let (_, url) = s.begin().unwrap();
    let wire = serde_json::to_string(&s.state()).unwrap();
    for (k, v) in Url::parse(&url).unwrap().query_pairs() {
        if k == "state" || k == "code_challenge" {
            assert!(!wire.contains(v.as_ref()));
        }
    }
    assert!(!wire.contains("verifier"));
    assert!(!wire.contains("access_token"));
}
#[test]
fn wire_rejects_partial_scope_and_changed_identity() {
    let make = || WireTokens {
        access_token: "S".repeat(43),
        refresh_token: "R".repeat(43),
        token_type: "Bearer".into(),
        expires_in: 1800,
        refresh_expires_in: 604800,
        scope: SCOPES.into(),
        user_id: "9007199254740993".into(),
        connection_id: uuid::Uuid::new_v4().to_string(),
        grant_expires_at: now() + 2592000,
        scope_version: "desktop-v1".into(),
    };
    let mut w = make();
    let t = w.validate(now(), None).unwrap();
    w.user_id = "2".into();
    assert!(w.validate(now(), Some(&t)).is_err());
    w = make();
    w.scope = "account:read".into();
    assert!(w.validate(now(), None).is_err());
    w = make();
    w.expires_in = 1801;
    assert!(w.validate(now(), None).is_err());
}
#[test]
#[ignore = "Real OS secure-store test; run explicitly, uses unique synthetic entry and cleans it"]
fn native_secure_store_round_trip() {
    let name = format!("tuzi-assistant-test-{}", uuid::Uuid::new_v4());
    let entry = keyring::Entry::new(&name, "synthetic-test").unwrap();
    let result = (|| {
        entry.set_secret(b"synthetic-not-a-credential")?;
        assert_eq!(entry.get_secret()?, b"synthetic-not-a-credential");
        Ok::<_, keyring::Error>(())
    })();
    let cleanup = entry.delete_credential();
    result.unwrap();
    cleanup.unwrap();
    assert!(matches!(entry.get_secret(), Err(keyring::Error::NoEntry)));
}

#[derive(Clone)]
struct HttpFixture {
    exchanges: Arc<std::sync::atomic::AtomicUsize>,
    revokes: Arc<std::sync::atomic::AtomicUsize>,
    grant: i64,
    connection: String,
    wrong_identity: bool,
    failure: bool,
}
async fn local_server(
    wrong_identity: bool,
    failure: bool,
) -> (String, HttpFixture, tokio::task::JoinHandle<()>) {
    use axum::{
        extract::State,
        routing::{get, post},
        Json, Router,
    };
    let f = HttpFixture {
        exchanges: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        revokes: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
        grant: now() + 2592000,
        connection: uuid::Uuid::new_v4().to_string(),
        wrong_identity,
        failure,
    };
    async fn token(
        State(f): State<HttpFixture>,
    ) -> (axum::http::StatusCode, Json<serde_json::Value>) {
        f.exchanges
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if f.failure {
            return (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error":"synthetic"})),
            );
        }
        (
            axum::http::StatusCode::OK,
            Json(
                serde_json::json!({"access_token":"S".repeat(43),"refresh_token":"R".repeat(43),"token_type":"Bearer","scope":SCOPES,"expires_in":1800,"refresh_expires_in":604800,"grant_expires_at":f.grant,"user_id":"9007199254740993","connection_id":f.connection,"scope_version":"desktop-v1"}),
            ),
        )
    }
    async fn user(State(f): State<HttpFixture>) -> Json<serde_json::Value> {
        let id = if f.wrong_identity {
            "2"
        } else {
            "9007199254740993"
        };
        Json(
            serde_json::json!({"sub":id,"user_id":id,"preferred_username":"synthetic-user","name":"Synthetic User"}),
        )
    }
    async fn revoke(State(f): State<HttpFixture>) -> Json<serde_json::Value> {
        f.revokes.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Json(serde_json::json!({"success":true}))
    }
    let app = Router::new()
        .route("/api/oauth-provider/token", post(token))
        .route("/api/oauth-provider/userinfo", get(user))
        .route("/api/oauth-provider/revoke", post(revoke))
        .with_state(f.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (origin, f, task)
}
fn test_service(store: Arc<MemoryStore>, origin: &str) -> AccountService {
    // The trusted isolated origin is an explicit test constructor, not runtime environment input.
    let mut r = Record::default();
    r.origin = origin.into();
    r.client = "tuzi-switch-desktop-test".into();
    store.write(&r).unwrap();
    AccountService::with_store(store, origin, "tuzi-switch-desktop-test").unwrap()
}
#[tokio::test]
async fn actual_http_exchange_identity_persistence_duplicate_and_logout() {
    let (origin, f, task) = local_server(false, false).await;
    let store = Arc::new(MemoryStore::default());
    let s = test_service(store.clone(), &origin);
    let (_, url) = s.begin().unwrap();
    let state = Url::parse(&url)
        .unwrap()
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .into_owned();
    let callback = format!("{CALLBACK}?state={state}&code=synthetic-code");
    let (a, b) = tokio::join!(s.callback(&callback), s.callback(&callback));
    assert_eq!(a.status, "connected");
    assert_eq!(b.status, "connected");
    assert_eq!(f.exchanges.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(store
        .record
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .tokens
        .is_some());
    let out = s.logout().await;
    assert!(out.local_cleared);
    assert_eq!(out.remote_revoked, Some(true));
    assert!(out.identity.is_none());
    assert_eq!(f.revokes.load(std::sync::atomic::Ordering::SeqCst), 1);
    task.abort();
}
#[tokio::test]
async fn identity_mismatch_never_connects_and_revokes_issued_family() {
    let (origin, f, task) = local_server(true, false).await;
    let store = Arc::new(MemoryStore::default());
    let s = test_service(store.clone(), &origin);
    let (_, url) = s.begin().unwrap();
    let state = Url::parse(&url)
        .unwrap()
        .query_pairs()
        .find(|(k, _)| k == "state")
        .unwrap()
        .1
        .into_owned();
    assert_eq!(
        s.callback(&format!("{CALLBACK}?state={state}&code=synthetic-code"))
            .await
            .status,
        "invalid"
    );
    assert_eq!(f.revokes.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(store
        .record
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .tokens
        .is_none());
    task.abort();
}
#[tokio::test]
async fn single_flight_refresh_and_uncertain_journal_never_replays() {
    for failure in [false, true] {
        let (origin, f, task) = local_server(false, failure).await;
        let store = Arc::new(MemoryStore::default());
        let s = test_service(store.clone(), &origin);
        {
            let mut i = s.inner.lock().unwrap();
            i.loaded = true;
            i.record.tokens = Some(Tokens {
                access_token: "S".repeat(43),
                refresh_token: "R".repeat(43),
                user_id: "9007199254740993".into(),
                connection_id: f.connection.clone(),
                access_expires: now() - 1,
                refresh_expires: now() + 604800,
                grant_expires: f.grant,
            });
            s.persist(&i.record).unwrap();
        }
        let (a, b) = tokio::join!(s.retry(), s.retry());
        assert_eq!(f.exchanges.load(std::sync::atomic::Ordering::SeqCst), 1);
        if failure {
            assert_eq!(a.status, "invalid");
            assert_eq!(b.status, "invalid");
            assert!(
                store
                    .record
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .refresh_in_flight
            );
        } else {
            assert_eq!(a.status, "connected");
            assert_eq!(b.status, "connected");
            assert!(
                !store
                    .record
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .refresh_in_flight
            );
        }
        task.abort();
    }
}

#[tokio::test]
async fn failed_logout_is_truthful_and_retry_clears_persisted_secrets() {
    let store = Arc::new(MemoryStore::default());
    let s = AccountService::with_store(store.clone(), ORIGIN, CLIENT).unwrap();
    s.begin().unwrap();
    *store.fail.lock().unwrap() = true;
    let state = s.logout().await;
    assert!(!state.local_cleared);
    assert_eq!(state.status, "error");
    assert!(s.begin().is_err());
    *store.fail.lock().unwrap() = false;
    let retry = s.retry().await;
    assert!(retry.local_cleared);
    assert!(store
        .record
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .pending
        .is_none());
}
#[test]
fn restart_inflight_does_not_claim_local_clear() {
    let store = Arc::new(MemoryStore::default());
    let mut r = Record::default();
    r.refresh_in_flight = true;
    store.write(&r).unwrap();
    let s = AccountService::with_store(store, ORIGIN, CLIENT).unwrap();
    assert!(!s.state().local_cleared);
}
#[tokio::test]
async fn pending_expiry_and_restore_are_enforced() {
    let store = Arc::new(MemoryStore::default());
    let s = AccountService::with_store(store.clone(), ORIGIN, CLIENT).unwrap();
    s.begin().unwrap();
    let restored = AccountService::with_store(store.clone(), ORIGIN, CLIENT).unwrap();
    assert_eq!(restored.state().status, "authorizing");
    {
        let mut r = store.record.lock().unwrap();
        r.as_mut().unwrap().pending.as_mut().unwrap().expires = now() - 1;
    }
    let expired = AccountService::with_store(store, ORIGIN, CLIENT).unwrap();
    assert_eq!(expired.state().error.unwrap().code, "authorization_timeout");
}
#[tokio::test]
async fn trusted_client_never_follows_redirect_with_credentials() {
    use axum::{response::Redirect, routing::post, Router};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let app = Router::new().route(
        "/redirect",
        post(|| async { Redirect::temporary("https://example.invalid/stolen") }),
    );
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let s = test_service(Arc::new(MemoryStore::default()), &origin);
    let result = s
        .response::<serde_json::Value>(
            s.http
                .post(format!("{origin}/redirect"))
                .bearer_auth("synthetic-never-real"),
        )
        .await;
    assert_eq!(result.unwrap_err().code, "server_error");
    task.abort();
}

#[tokio::test]
#[ignore = "explicit paired Go loopback fixture only"]
async fn real_go_loopback_pair() {
    real_go_pair(false).await;
}
#[tokio::test]
#[ignore = "explicit paired Go G2 business fixture only"]
async fn real_go_business_pair() {
    real_go_pair(true).await;
}
async fn real_go_pair(g2: bool) {
    let origin = std::env::var("TUZI_NATIVE_TEST_ORIGIN").expect("fixture origin required");
    let parsed = Url::parse(&origin).unwrap();
    assert_eq!(parsed.scheme(), "http"); assert_eq!(parsed.host_str(), Some("127.0.0.1"));
    let name = format!("tuzi-native-paired-test-{}", uuid::Uuid::new_v4());
    let namespace_origin = format!("{origin}/{name}");
    let namespace = format!("tuzi-assistant/account/v1/{namespace_origin}/tuzi-switch-desktop-test");
    let entry = keyring::Entry::new(&namespace, "active-connection").unwrap();
    struct Cleanup(keyring::Entry);
    impl Drop for Cleanup { fn drop(&mut self) { let _ = self.0.delete_credential(); } }
    let cleanup = Cleanup(entry);
    let store = Arc::new(SystemStore::new(&namespace_origin, "tuzi-switch-desktop-test").unwrap());
    let mut record = Record::default(); record.origin = origin.clone(); record.client = "tuzi-switch-desktop-test".into(); store.write(&record).unwrap();
    let s = AccountService::with_store(store.clone(), &origin, "tuzi-switch-desktop-test").unwrap();
    let (_, authorize) = s.begin().unwrap();
    let url = Url::parse(&authorize).unwrap();
    let login = s.http.post(format!("{origin}/fixture/login")).send().await.unwrap();
    assert!(login.status().is_success());
    let cookie = login.headers().get("set-cookie").unwrap().to_str().unwrap().split(';').next().unwrap().to_string();
    let context = s.http.get(format!("{origin}/api/oauth-provider/authorize-context?{}", url.query().unwrap()))
        .header("cookie", &cookie).header("New-Api-User", "1").send().await.unwrap();
    assert!(context.status().is_success());
    let context: serde_json::Value = context.json().await.unwrap();
    let mut body = context["data"]["request"].as_object().unwrap().clone();
    body.insert("approve".into(), true.into());
    let approve: serde_json::Value = s.http.post(format!("{origin}/api/oauth-provider/authorize"))
        .header("cookie", &cookie).header("New-Api-User", "1").header("Origin", &origin)
        .json(&body).send().await.unwrap().json().await.unwrap();
    assert_eq!(approve["success"], true);
    let callback = approve["data"]["redirect_uri"].as_str().unwrap();
    let state = s.callback(callback).await;
    assert_eq!(state.status, "connected", "{}", state.error.as_ref().map(|e| e.code.as_str()).unwrap_or("none"));
    assert_eq!(state.identity.unwrap().user_id, "1");
    let old = {
        let mut i = s.inner.lock().unwrap();
        let t = i.record.tokens.as_mut().unwrap();
        t.access_expires = now() - 1;
        t.clone()
    };
    let toggle = |enabled| {
        s.http.post(format!(
            "{origin}/fixture/refresh-enabled?enabled={enabled}"
        ))
    };
    assert!(toggle(false).send().await.unwrap().status().is_success());
    let deferred = s.retry().await;
    assert_eq!(deferred.status, "offline");
    assert_eq!(deferred.error.unwrap().code, "temporarily_unavailable");
    let saved = store.read().unwrap().unwrap();
    assert!(!saved.refresh_in_flight);
    assert_eq!(saved.tokens.as_ref().unwrap().refresh_token, old.refresh_token);
    assert!(saved.refresh_retry_at >= now() + 55);
    let restored = AccountService::with_store(store.clone(), &origin, "tuzi-switch-desktop-test").unwrap();
    assert_eq!(restored.retry().await.status, "offline");
    assert!(toggle(true).send().await.unwrap().status().is_success());
    // Advance only the synthetic test deadline; production honors Retry-After.
    { let mut i = s.inner.lock().unwrap(); i.retry_not_before = 0; }
    let refreshed = s.retry().await;
    assert_eq!(refreshed.status, "connected");
    let new = s.inner.lock().unwrap().record.tokens.clone().unwrap();
    assert_eq!(store.read().unwrap().unwrap().tokens.as_ref().unwrap().refresh_token, new.refresh_token);
    assert_ne!(old.refresh_token, new.refresh_token);
    if g2 {
        verify_go_business(&s).await;
    }
    let out = s.logout().await;
    assert_eq!(out.remote_revoked, Some(true));
    assert!(out.local_cleared);
    assert_eq!(s.identity(&new).await.unwrap_err().code, "invalid_grant");
    let replay = s
        .http
        .post(format!("{origin}/api/oauth-provider/token"))
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", s.client.as_str()),
            ("refresh_token", old.refresh_token.as_str()),
        ])
        .send()
        .await
        .unwrap();
    assert!(!replay.status().is_success());
    assert!(store.read().unwrap().unwrap().tokens.is_none());
    cleanup.0.delete_credential().unwrap();
    assert!(matches!(cleanup.0.get_secret(), Err(keyring::Error::NoEntry)));
}
#[test]
fn raw_auth_is_never_an_import() {
    for url in [
        "tuziswitch://auth/callback?code=synthetic",
        "tuziswitch://user@auth/callback?code=synthetic",
        "tuziswitch://auth%2f/callback",
        "tuziswitch://auth@v1/import?code=synthetic",
    ] {
        assert!(!is_import_input(url));
    }
    assert!(is_import_input(
        "tuziswitch://v1/import?resource=provider&name=synthetic"
    ));
    let plugin = include_str!("../../vendor/tauri-plugin-deep-link/src/lib.rs");
    assert!(!plugin.contains("emit_to("));
    assert_eq!(plugin.matches(".emit(\"deep-link://new-url\"").count(), 1);
    assert!(!include_str!("../../capabilities/default.json").contains("deep-link:"));
}

#[tokio::test]
async fn http_401_refreshes_once_403_never_refreshes_and_429_respects_retry_after() {
    use axum::{routing::get, Router};
    for status in [401,403,429] {
        let (origin, f, task) = local_server(false, false).await;
        let s = test_service(Arc::new(MemoryStore::default()), &origin);
        let mut token = Tokens {access_token:"S".repeat(43),refresh_token:"R".repeat(43),user_id:"9007199254740993".into(),connection_id:f.connection.clone(),access_expires:now()+1800,refresh_expires:now()+604800,grant_expires:f.grant};
        // A dedicated origin exercises actual HTTP status handling, with the same
        // token route counting refresh requests; userinfo endpoint stays failing.
        task.abort();
        let _ = task.await;
        let port = Url::parse(&origin).unwrap().port().unwrap();
        let listener = tokio::net::TcpListener::bind(("127.0.0.1",port)).await.unwrap();
        let count = f.exchanges.clone();
        let token_wire = serde_json::json!({"access_token":"N".repeat(43),"refresh_token":"T".repeat(43),"token_type":"Bearer","scope":SCOPES,"expires_in":1800,"refresh_expires_in":604800,"grant_expires_at":f.grant,"user_id":token.user_id,"connection_id":token.connection_id,"scope_version":"desktop-v1"});
        let app = Router::new().route("/api/oauth-provider/userinfo",get(move || async move { (axum::http::StatusCode::from_u16(status).unwrap(),[("retry-after","120")]) }))
            .route("/api/oauth-provider/token", axum::routing::post(move || {let count=count.clone();let wire=token_wire.clone(); async move { count.fetch_add(1,std::sync::atomic::Ordering::SeqCst); axum::Json(wire) }}))
            .route("/api/oauth-provider/revoke",axum::routing::post(|| async { axum::http::StatusCode::OK }));
        let server=tokio::spawn(async move {axum::serve(listener,app).await.unwrap()});
        {let mut i=s.inner.lock().unwrap();i.loaded=true;i.record.tokens=Some(token.clone());s.persist(&i.record).unwrap();}
        let state=s.retry().await;
        assert_eq!(f.exchanges.load(std::sync::atomic::Ordering::SeqCst),if status==401 {1}else{0});
        if status==403 {assert_eq!(state.error.as_ref().unwrap().code,"insufficient_scope");}
        if status==429 {assert_eq!(state.error.as_ref().unwrap().retry_after,Some(120));assert!(s.inner.lock().unwrap().retry_not_before>=now()+119);}
        s.retry().await;
        assert_eq!(f.exchanges.load(std::sync::atomic::Ordering::SeqCst),if status==401 {1}else{0});
        token.zeroize(); server.abort();
    }
}
#[tokio::test]
async fn late_generation_cannot_persist_and_failed_cleanup_remains_retryable() {
    let (origin,f,task)=local_server(false,false).await;
    let store=Arc::new(MemoryStore::default()); let s=test_service(store.clone(),&origin);
    let t=Tokens {access_token:"S".repeat(43),refresh_token:"R".repeat(43),user_id:"9007199254740993".into(),connection_id:f.connection.clone(),access_expires:now()+1800,refresh_expires:now()+604800,grant_expires:f.grant};
    s.load(); let old_generation=s.state().generation;
    s.logout().await;
    let stale=s.commit_tokens(old_generation,t.clone(),None).await;
    assert_eq!(stale.status,"disconnected"); assert!(s.inner.lock().unwrap().record.tokens.is_none());
    assert_eq!(f.revokes.load(std::sync::atomic::Ordering::SeqCst),1);
    {let mut i=s.inner.lock().unwrap();i.record.tokens=Some(t);s.persist(&i.record).unwrap();}
    *store.fail.lock().unwrap()=true;
    let failed=s.logout().await;assert!(!failed.local_cleared);assert_eq!(failed.remote_revoked,Some(true));
    assert!(s.inner.lock().unwrap().record.tokens.is_none());
    *store.fail.lock().unwrap()=false;
    assert!(s.retry().await.local_cleared);
    assert!(store.record.lock().unwrap().as_ref().unwrap().tokens.is_none());
    task.abort();
}

#[tokio::test]
async fn real_http_concurrent_401_and_logout_during_identity() {
    use axum::{routing::{get,post}, Router};
    for logout in [false,true] {
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin=format!("http://{}",listener.local_addr().unwrap());
        let entered=Arc::new(tokio::sync::Notify::new()); let release=Arc::new(tokio::sync::Notify::new());
        let requests=Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let refreshes=Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let grant=now()+2592000;let connection=uuid::Uuid::new_v4().to_string();
        let notify=entered.clone();let gate=release.clone();let calls=requests.clone();let counts=refreshes.clone();let conn=connection.clone();
        let app=Router::new().route("/api/oauth-provider/userinfo",get(move || {let notify=notify.clone();let gate=gate.clone();let calls=calls.clone();async move {
            let n=calls.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
            if n==0 {notify.notify_one();gate.notified().await;}
            if n==0 && !logout {(axum::http::StatusCode::UNAUTHORIZED,axum::Json(serde_json::json!({})))} else {(axum::http::StatusCode::OK,axum::Json(serde_json::json!({"sub":"1","user_id":"1","preferred_username":"synthetic","name":"Synthetic"})))}
        }})).route("/api/oauth-provider/token",post(move || {let counts=counts.clone();let conn=conn.clone();async move {
            counts.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
            axum::Json(serde_json::json!({"access_token":"N".repeat(43),"refresh_token":"T".repeat(43),"token_type":"Bearer","scope":SCOPES,"expires_in":1800,"refresh_expires_in":604800,"grant_expires_at":grant,"user_id":"1","connection_id":conn,"scope_version":"desktop-v1"}))
        }})).route("/api/oauth-provider/revoke",post(|| async {axum::http::StatusCode::OK}));
        let server=tokio::spawn(async move{axum::serve(listener,app).await.unwrap()});
        let store=Arc::new(MemoryStore::default());let s=Arc::new(test_service(store.clone(),&origin));s.load();
        {let mut i=s.inner.lock().unwrap();i.record.tokens=Some(Tokens {access_token:"S".repeat(43),refresh_token:"R".repeat(43),user_id:"1".into(),connection_id:connection,access_expires:now()+1800,refresh_expires:now()+604800,grant_expires:grant});s.persist(&i.record).unwrap();}
        let one=s.clone();let first=tokio::spawn(async move{one.retry().await});
        tokio::time::timeout(Duration::from_secs(2),entered.notified()).await.unwrap();
        let two=s.clone();let second=tokio::spawn(async move{two.retry().await});
        if logout {assert_eq!(s.logout().await.status,"disconnected");}
        release.notify_one();
        let a=first.await.unwrap();let b=second.await.unwrap();
        if logout {assert_eq!(a.status,"disconnected");assert_eq!(b.status,"disconnected");assert!(store.read().unwrap().unwrap().tokens.is_none());assert_eq!(refreshes.load(std::sync::atomic::Ordering::SeqCst),0);} else {assert_eq!(a.status,"connected");assert_eq!(b.status,"connected");assert_eq!(refreshes.load(std::sync::atomic::Ordering::SeqCst),1);}
        server.abort();
    }
}

#[test]
fn maintenance_is_visible_bounded_and_honors_retry_after() {
    let s=AccountService::with_store(Arc::new(MemoryStore::default()),ORIGIN,CLIENT).unwrap();
    {let mut i=s.inner.lock().unwrap();i.loaded=true;i.state.status="offline".into();i.record.tokens=Some(Tokens {access_token:"S".repeat(43),refresh_token:"R".repeat(43),user_id:"1".into(),connection_id:uuid::Uuid::new_v4().to_string(),access_expires:now()-1,refresh_expires:now()+604800,grant_expires:now()+2592000});}
    assert!(!s.take_maintenance_attempt(false));
    {s.inner.lock().unwrap().retry_not_before=now()+120;}
    assert!(!s.take_maintenance_attempt(true));
    {s.inner.lock().unwrap().retry_not_before=0;}
    for _ in 0..3 {assert!(s.take_maintenance_attempt(true));}
    assert!(!s.take_maintenance_attempt(true));
    assert_eq!(s.inner.lock().unwrap().maintenance_attempts,3);
}

#[tokio::test]
async fn marked_refresh_backoff_preserves_rt_across_restart_and_never_revives_logout() {
    use axum::{routing::{get,post}, Router};
    for status in [429,503] {
        for mode in ["recover", "write_failure", "logout"] {
            let store=Arc::new(MemoryStore::default());
            let count=Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let consumed=Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let revokes=Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let c=count.clone();let used=consumed.clone();let rs=revokes.clone();let fault=store.clone();
            let grant=now()+2592000;let connection=uuid::Uuid::new_v4().to_string();let conn=connection.clone();
            let app=Router::new().route("/api/oauth-provider/token",post(move || {let c=c.clone();let used=used.clone();let conn=conn.clone();let fault=fault.clone();async move {
                let n=c.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
                if n==0 {
                    if mode=="write_failure" {*fault.fail.lock().unwrap()=true;}
                    return (axum::http::StatusCode::from_u16(status).unwrap(),[("OAuth-Refresh-Outcome","not-consumed"),("Retry-After","120")],axum::Json(serde_json::json!({"error":"temporarily_unavailable"})));
                }
                used.fetch_add(1,std::sync::atomic::Ordering::SeqCst);
                (axum::http::StatusCode::OK,[("x-synthetic","test"),("x-synthetic-two","test")],axum::Json(serde_json::json!({"access_token":"N".repeat(43),"refresh_token":"T".repeat(43),"token_type":"Bearer","scope":SCOPES,"expires_in":1800,"refresh_expires_in":604800,"grant_expires_at":grant,"user_id":"1","connection_id":conn,"scope_version":"desktop-v1"})))
            }})).route("/api/oauth-provider/userinfo",get(|| async {axum::Json(serde_json::json!({"sub":"1","user_id":"1","preferred_username":"synthetic","name":"Synthetic"}))}))
            .route("/api/oauth-provider/revoke",post(move || {let rs=rs.clone();async move {rs.fetch_add(1,std::sync::atomic::Ordering::SeqCst);axum::http::StatusCode::OK}}));
            let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let origin=format!("http://{}",listener.local_addr().unwrap());
            let server=tokio::spawn(async move {axum::serve(listener,app).await.unwrap()});
            let s=test_service(store.clone(),&origin);s.load();
            {let mut i=s.inner.lock().unwrap();i.record.tokens=Some(Tokens {access_token:"S".repeat(43),refresh_token:"R".repeat(43),user_id:"1".into(),connection_id:connection,access_expires:now()-1,refresh_expires:now()+604800,grant_expires:grant});s.persist(&i.record).unwrap();}
            let state=s.retry().await;
            assert_eq!(revokes.load(std::sync::atomic::Ordering::SeqCst),0);
            assert_eq!(consumed.load(std::sync::atomic::Ordering::SeqCst),0);
            assert_eq!(state.status,if mode=="write_failure" {"invalid"} else {"offline"});
            s.retry().await;assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst),1);
            *store.fail.lock().unwrap()=false;
            let restored=AccountService::with_store(store.clone(),&origin,"tuzi-switch-desktop-test").unwrap();restored.state();
            restored.retry().await;assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst),1);
            if mode=="recover" {
                {let mut i=restored.inner.lock().unwrap();assert!(!i.record.refresh_in_flight);assert_eq!(i.record.tokens.as_ref().unwrap().refresh_token,"R".repeat(43));i.retry_not_before=0;}
                assert_eq!(restored.retry().await.status,"connected");assert_eq!(consumed.load(std::sync::atomic::Ordering::SeqCst),1);
            } else if mode=="logout" {
                assert!(restored.logout().await.local_cleared);
                assert_eq!(AccountService::with_store(store.clone(),&origin,"tuzi-switch-desktop-test").unwrap().retry().await.status,"disconnected");
                assert_eq!(consumed.load(std::sync::atomic::Ordering::SeqCst),0);
            } else {assert!(store.read().unwrap().unwrap().refresh_in_flight);}
            server.abort();
        }
    }
}

#[tokio::test]
async fn unproven_refresh_errors_never_clear_the_journal() {
    use axum::{routing::post,Router};
    use std::sync::atomic::{AtomicUsize, Ordering};
    for (status,proof) in [(429,""),(503,""),(503,"unknown"),(500,"not-consumed"),(503,"not-consumed, not-consumed")] {
        let count = Arc::new(AtomicUsize::new(0));
        let calls = count.clone();
        let app=Router::new().route("/api/oauth-provider/token",post(move || {let calls=calls.clone(); async move {
            calls.fetch_add(1, Ordering::SeqCst);
            (axum::http::StatusCode::from_u16(status).unwrap(),[("OAuth-Refresh-Outcome",proof)],axum::Json(serde_json::json!({"error":"temporarily_unavailable"})))
        }})).route("/api/oauth-provider/revoke",post(|| async {axum::http::StatusCode::OK}));
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let origin=format!("http://{}",listener.local_addr().unwrap());
        let server=tokio::spawn(async move {axum::serve(listener,app).await.unwrap()});
        let store=Arc::new(MemoryStore::default());
        let s=test_service(store.clone(),&origin);s.load();
        {let mut i=s.inner.lock().unwrap();i.record.tokens=Some(Tokens {access_token:"S".repeat(43),refresh_token:"R".repeat(43),user_id:"1".into(),connection_id:uuid::Uuid::new_v4().to_string(),access_expires:now()-1,refresh_expires:now()+604800,grant_expires:now()+2592000});s.persist(&i.record).unwrap();}
        assert_eq!(s.retry().await.status, "invalid");
        assert!(store.read().unwrap().unwrap().refresh_in_flight);
        assert_eq!(s.retry().await.status, "invalid");
        let restored=AccountService::with_store(store,&origin,"tuzi-switch-desktop-test").unwrap();
        assert_eq!(restored.retry().await.status, "invalid");
        assert_eq!(count.load(Ordering::SeqCst), 1);
        server.abort();
    }
}

#[tokio::test]
async fn duplicate_outcome_and_truncated_body_are_not_proof() {
    use axum::{routing::post,Router};
    let app=Router::new().route("/error",post(|| async {
        let mut headers=axum::http::HeaderMap::new();
        headers.append("OAuth-Refresh-Outcome","not-consumed".parse().unwrap());
        headers.append("OAuth-Refresh-Outcome","unknown".parse().unwrap());
        (axum::http::StatusCode::SERVICE_UNAVAILABLE,headers,axum::Json(serde_json::json!({"error":"temporarily_unavailable"})))
    })).route("/truncated",post(|| async {(axum::http::StatusCode::SERVICE_UNAVAILABLE,[("OAuth-Refresh-Outcome","not-consumed")],"{\"error\":")}));
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let origin=format!("http://{}",listener.local_addr().unwrap());
    let server=tokio::spawn(async move {axum::serve(listener,app).await.unwrap()});let s=test_service(Arc::new(MemoryStore::default()),&origin);
    for path in ["error","truncated"] {assert!(!s.response::<serde_json::Value>(s.http.post(format!("{origin}/{path}"))).await.unwrap_err().refresh_not_consumed);}
    let mut e=AccountError::new("rate_limited");e.retry_after=Some(u64::MAX);s.fail(0,e,false);
    assert_eq!(s.inner.lock().unwrap().retry_not_before,i64::MAX);
    server.abort();
}

#[tokio::test]
async fn delayed_marked_rejection_cannot_restore_after_logout() {
    use axum::{routing::post,Router};
    let entered=Arc::new(tokio::sync::Notify::new());let release=Arc::new(tokio::sync::Notify::new());
    let notify=entered.clone();let gate=release.clone();
    let app=Router::new().route("/api/oauth-provider/token",post(move || {let notify=notify.clone();let gate=gate.clone();async move {notify.notify_one();gate.notified().await;(axum::http::StatusCode::SERVICE_UNAVAILABLE,[("OAuth-Refresh-Outcome","not-consumed"),("Retry-After","60")],axum::Json(serde_json::json!({"error":"temporarily_unavailable"})))}}))
        .route("/api/oauth-provider/revoke",post(|| async {axum::http::StatusCode::OK}));
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let origin=format!("http://{}",listener.local_addr().unwrap());
    let server=tokio::spawn(async move {axum::serve(listener,app).await.unwrap()});let store=Arc::new(MemoryStore::default());let s=Arc::new(test_service(store.clone(),&origin));s.load();
    {let mut i=s.inner.lock().unwrap();i.record.tokens=Some(Tokens {access_token:"S".repeat(43),refresh_token:"R".repeat(43),user_id:"1".into(),connection_id:uuid::Uuid::new_v4().to_string(),access_expires:now()-1,refresh_expires:now()+604800,grant_expires:now()+2592000});s.persist(&i.record).unwrap();}
    let service=s.clone();let refresh=tokio::spawn(async move {service.retry().await});
    tokio::time::timeout(Duration::from_secs(2),entered.notified()).await.unwrap();
    assert!(s.logout().await.local_cleared);release.notify_one();
    assert_eq!(refresh.await.unwrap().status,"disconnected");
    assert!(store.read().unwrap().unwrap().tokens.is_none());
    assert_eq!(AccountService::with_store(store,&origin,"tuzi-switch-desktop-test").unwrap().retry().await.status,"disconnected");
    server.abort();
}

#[tokio::test]
async fn incomplete_transport_and_oversized_error_are_not_proof() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    for oversized in [false, true] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            socket.read(&mut request).await.unwrap();
            let body = if oversized { format!("{{\"error\":\"temporarily_unavailable\",\"padding\":\"{}\"}}", "x".repeat(65536)) } else { "{\"error\":\"temporarily_unavailable\"}".into() };
            let declared = body.len() + if oversized { 0 } else { 100 };
            let response = format!("HTTP/1.1 503 Service Unavailable\r\nOAuth-Refresh-Outcome: not-consumed\r\nContent-Length: {declared}\r\nConnection: close\r\n\r\n{body}");
            let _ = socket.write_all(response.as_bytes()).await;
        });
        let s = test_service(Arc::new(MemoryStore::default()), &origin);
        let error = s.response::<serde_json::Value>(s.http.post(format!("{origin}/error"))).await.unwrap_err();
        assert!(!error.refresh_not_consumed);
        assert_eq!(error.code, if oversized { "invalid_response" } else { "network_uncertain" });
        server.await.unwrap();
    }
}

async fn verify_go_business(s: &AccountService) {
    use super::business::BusinessRequest;
    let access = s.inner.lock().unwrap().record.tokens.as_ref().unwrap().access_token.clone();
    for (bearer, contract, user, status, code) in [
        ("synthetic-old-system-token", "desktop-v1.1", None, 401, "invalid_token"),
        (access.as_str(), "desktop-v1.0", None, 409, "contract_mismatch"),
        (access.as_str(), "desktop-v1.1", Some("2"), 403, "account_restricted"),
    ] {
        let error = serde_json::to_value(s.business_auth_probe(bearer, contract, user).await.unwrap_err()).unwrap();
        assert_eq!(error["status"], status);
        assert_eq!(error["code"], code);
    }
    async fn call(
        s: &AccountService,
        method: &str,
        path: &str,
        query: Vec<(&str, String)>,
        body: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, business::BusinessError> {
        let request: BusinessRequest = serde_json::from_value(serde_json::json!({"method":method,"path":path,"query":query,"body":body,"generation":s.state().generation})).unwrap();
        s.business_request(request).await
    }
    let account = call(s, "GET", "/api/desktop/account", vec![], None)
        .await
        .unwrap();
    assert_eq!(account["data"]["user_id"], "1");
    assert!(account["data"]["quota"].is_string());
    assert!(account["data"].get("role").is_none());
    let caps = call(s, "GET", "/api/desktop/capabilities", vec![], None)
        .await
        .unwrap();
    assert_eq!(caps["data"]["native"]["keys"], true);
    let groups = call(s, "GET", "/api/desktop/key-groups", vec![], None)
        .await
        .unwrap();
    let group = groups["data"][0]["id"]
        .as_str()
        .expect("fixture assignable group");
    let created=call(s,"POST","/api/desktop/keys",vec![],Some(serde_json::json!({"name":"synthetic-g2-key","group":group,"expired_time":-1,"remain_quota":"1000","unlimited_quota":false,"model_limits_enabled":false,"model_limits":""}))).await.unwrap();
    let id = created["data"]["id"].as_str().unwrap();
    let key = created["data"]["key"].as_str().unwrap();
    let path = format!("/api/desktop/keys/{id}");
    let detail = call(s, "GET", &path, vec![], None).await.unwrap();
    assert!(detail["data"].get("key").is_none());
    assert_eq!(detail["data"]["name"], "synthetic-g2-key");
    let reveal = call(s, "POST", &format!("{path}/reveal"), vec![], None)
        .await
        .unwrap();
    assert_eq!(reveal["data"]["key"], key);
    assert!(key.starts_with("sk-"), "desktop reveal returns callable model-key format");
    let state = s.state();
    let user = state.identity.as_ref().unwrap().user_id.clone();
    assert!(s.with_confirmed_model_source(&user,state.generation,"999999999",key,||Ok(())).is_err());
    assert!(s.with_confirmed_model_source(&user,state.generation,id,"sk-synthetic-wrong-key",||Ok(())).is_err());
    s.with_confirmed_model_source(&user,state.generation,id,key,||Ok(())).unwrap();
    assert!(s.with_confirmed_model_source(&user,state.generation,id,key,||Ok(())).is_err());
    s.provider_qualification(s.state().generation,id,&["synthetic-g2-model".into()],"chat").await.unwrap();
    assert!(s.provider_qualification(s.state().generation,id,&["synthetic-g2-model".into()],"gemini").await.is_err());
    assert!(s.provider_qualification(s.state().generation,id,&["synthetic-missing-model".into()],"chat").await.is_err());
    let changed = call(
        s,
        "PATCH",
        &path,
        vec![],
        Some(serde_json::json!({"name":"synthetic-g2-renamed"})),
    )
    .await
    .unwrap();
    assert_eq!(changed["data"]["remain_quota"], "1000");
    let disabled = call(
        s,
        "PATCH",
        &format!("{path}/status"),
        vec![],
        Some(serde_json::json!({"status":2})),
    )
    .await
    .unwrap();
    assert_eq!(disabled["data"]["status"], 2);
    assert!(s.provider_qualification(s.state().generation,id,&["synthetic-g2-model".into()],"chat").await.is_err());
    call(
        s,
        "PATCH",
        &format!("{path}/status"),
        vec![],
        Some(serde_json::json!({"status":1})),
    )
    .await
    .unwrap();
    let keys = call(
        s,
        "GET",
        "/api/desktop/keys",
        vec![("keyword", "synthetic-g2-renamed".into())],
        None,
    )
    .await
    .unwrap();
    assert_eq!(keys["data"]["total"], "1");
    call(s, "DELETE", &path, vec![], None).await.unwrap();
    assert!(call(s, "GET", &path, vec![], None).await.is_err());
    for endpoint in [
        "/api/desktop/logs",
        "/api/desktop/logs/summary",
        "/api/desktop/logs/statistics",
    ] {
        let result = call(s, "GET", endpoint, vec![], None).await.unwrap();
        assert_eq!(result["success"], true);
    }
    let logs = call(s, "GET", "/api/desktop/logs", vec![], None)
        .await
        .unwrap();
    assert!(logs["data"]["items"].as_array().unwrap().len() >= 3);
    assert!(logs["data"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .all(|row| row.get("content").is_none() && row.get("other").is_none()));
    call(
        s,
        "GET",
        "/api/desktop/logs/requests/synthetic-g2-request",
        vec![],
        None,
    )
    .await
    .unwrap();
    for endpoint in ["/api/desktop/usage", "/api/desktop/usage/summary"] {
        let result = call(
            s,
            "GET",
            endpoint,
            vec![("timezone", "Asia/Shanghai".into())],
            None,
        )
        .await
        .unwrap();
        assert_eq!(result["data"]["source"], "usage");
        assert!(result["data"]["data_as_of"].is_null());
    }
    let models = call(s, "GET", "/api/desktop/models", vec![], None)
        .await
        .unwrap();
    assert!(!models["data"]["items"].as_array().unwrap().is_empty());
    let model = models["data"]["items"][0]["model_name"].as_str().unwrap();
    for hours in [1, 6, 24] {
        let perf = call(
            s,
            "GET",
            "/api/desktop/model-performance",
            vec![("model", model.into()), ("hours", hours.to_string())],
            None,
        )
        .await
        .unwrap();
        assert!(perf["data"]["aggregate"].get("request_count").is_none());
    }
    call(
        s,
        "POST",
        "/api/desktop/model-performance/batch",
        vec![],
        Some(serde_json::json!({"models":[model],"hours":6})),
    )
    .await
    .unwrap();
    let profile = call(s, "GET", "/api/desktop/profile", vec![], None)
        .await
        .unwrap();
    assert_eq!(profile["data"]["user_id"], "1");
    call(s,"PATCH","/api/desktop/profile",vec![],Some(serde_json::json!({"display_name":"Synthetic G2","language":"en","accept_unset_model_ratio_model":false,"high_concurrency_enabled":false,"record_ip_log":false}))).await.unwrap();
    let readback = call(s, "GET", "/api/desktop/profile", vec![], None)
        .await
        .unwrap();
    assert_eq!(readback["data"]["display_name"], "Synthetic G2");
    assert_eq!(readback["data"]["record_ip_log"], false);
    assert!(call(
        s,
        "PATCH",
        "/api/desktop/profile",
        vec![],
        Some(serde_json::json!({"password":"synthetic-never-real"}))
    )
    .await
    .is_err());
    assert!(call(
        s,
        "GET",
        "/api/desktop/keys",
        vec![("user_id", "2".into())],
        None
    )
    .await
    .is_err());
}
