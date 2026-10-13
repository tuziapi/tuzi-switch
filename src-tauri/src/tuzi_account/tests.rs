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
