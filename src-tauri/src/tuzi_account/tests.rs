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
    let mut body = serde_json::Map::new();
    for (k,v) in url.query_pairs() { body.insert(k.into_owned(), serde_json::Value::String(v.into_owned())); }
    body.insert("approve".into(), true.into());
    let login = s.http.post(format!("{origin}/fixture/login")).send().await.unwrap();
    assert!(login.status().is_success());
    let cookie = login.headers().get("set-cookie").unwrap().to_str().unwrap().split(';').next().unwrap().to_string();
    let context = s.http.get(format!("{origin}/api/oauth-provider/authorize-context?{}", url.query().unwrap()))
        .header("cookie", &cookie).header("New-Api-User", "1").send().await.unwrap();
    assert!(context.status().is_success());
    let approve: serde_json::Value = s.http.post(format!("{origin}/api/oauth-provider/authorize"))
        .header("cookie", &cookie).header("New-Api-User", "1").header("Origin", &origin)
        .json(&body).send().await.unwrap().json().await.unwrap();
    assert_eq!(approve["success"], true);
    let callback = approve["data"]["redirect_uri"].as_str().unwrap();
    let state = s.callback(callback).await;
    assert_eq!(state.status, "connected", "{}", state.error.as_ref().map(|e| e.code.as_str()).unwrap_or("none"));
    assert_eq!(state.identity.unwrap().user_id, "1");
    let old = { let mut i = s.inner.lock().unwrap(); let t = i.record.tokens.as_mut().unwrap(); t.access_expires = now()-1; t.clone() };
    let refreshed = s.retry().await;
    assert_eq!(refreshed.status, "connected");
    let new = s.inner.lock().unwrap().record.tokens.clone().unwrap();
    assert_eq!(store.read().unwrap().unwrap().tokens.as_ref().unwrap().refresh_token, new.refresh_token);
    assert_ne!(old.refresh_token, new.refresh_token);
    let out = s.logout().await; assert_eq!(out.remote_revoked, Some(true)); assert!(out.local_cleared);
    assert_eq!(s.identity(&new).await.unwrap_err().code, "invalid_grant");
    let replay = s.http.post(format!("{origin}/api/oauth-provider/token")).form(&[("grant_type","refresh_token"),("client_id",s.client.as_str()),("refresh_token",old.refresh_token.as_str())]).send().await.unwrap();
    assert!(!replay.status().is_success());
    assert!(store.read().unwrap().unwrap().tokens.is_none());
    cleanup.0.delete_credential().unwrap();
    assert!(matches!(cleanup.0.get_secret(), Err(keyring::Error::NoEntry)));
}
#[test]
fn raw_auth_is_never_an_import() {
    for url in ["tuziswitch://auth/callback?code=synthetic", "tuziswitch://user@auth/callback?code=synthetic", "tuziswitch://auth%2f/callback", "tuziswitch://auth@v1/import?code=synthetic"] { assert!(!is_import_input(url)); }
    assert!(is_import_input("tuziswitch://v1/import?resource=provider&name=synthetic"));
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
