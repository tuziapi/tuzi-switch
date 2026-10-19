use super::*;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};

mod prepush_regressions;

// All credentials and identities in this module are synthetic local fixtures.
const SYNTHETIC_TOKEN: &str = "synthetic-account-system-token";
const SYNTHETIC_KEY: &str = "sk-synthetic-model-key";

#[derive(Default)]
struct MemoryStore {
    record: Mutex<Option<Record>>,
    fail_read: Mutex<bool>,
    fail_write_at: Mutex<Option<usize>>,
    writes: AtomicUsize,
}
impl TokenStore for MemoryStore {
    fn read(&self) -> Result<Option<Record>, AccountError> {
        if *self.fail_read.lock().unwrap() {
            Err(AccountError::storage())
        } else {
            Ok(self.record.lock().unwrap().clone())
        }
    }
    fn write(&self, record: &Record) -> Result<(), AccountError> {
        let count = self.writes.fetch_add(1, Ordering::SeqCst) + 1;
        if *self.fail_write_at.lock().unwrap() == Some(count) {
            Err(AccountError::storage())
        } else {
            *self.record.lock().unwrap() = Some(record.clone());
            Ok(())
        }
    }
}
#[derive(Clone)]
struct Fixture {
    response: Arc<Mutex<(StatusCode, Value)>>,
    requests: Arc<Mutex<Vec<(String, HeaderMap)>>>,
    entered: Arc<tokio::sync::Notify>,
    release: Arc<tokio::sync::Notify>,
    blocked: Arc<Mutex<bool>>,
    redirect: Arc<Mutex<Option<String>>>,
}
impl Fixture {
    fn set(&self, status: StatusCode, value: Value) {
        *self.response.lock().unwrap() = (status, value);
    }
    fn block(&self) {
        *self.blocked.lock().unwrap() = true;
    }
}
async fn local_server() -> (String, Fixture, tokio::task::JoinHandle<()>) {
    let fixture = Fixture {
        response: Arc::new(Mutex::new((
            StatusCode::OK,
            json!({"success":true,"data":{"id":7,"username":"synthetic-user","display_name":"Synthetic User"}}),
        ))),
        requests: Default::default(),
        entered: Default::default(),
        release: Default::default(),
        blocked: Default::default(),
        redirect: Default::default(),
    };
    async fn endpoint(
        State(f): State<Fixture>,
        uri: axum::http::Uri,
        headers: HeaderMap,
    ) -> Response {
        f.requests.lock().unwrap().push((uri.to_string(), headers));
        f.entered.notify_one();
        if *f.blocked.lock().unwrap() {
            f.release.notified().await;
        }
        if let Some(target) = f.redirect.lock().unwrap().clone() {
            return (StatusCode::FOUND, [("location", target)]).into_response();
        }
        let (status, value) = f.response.lock().unwrap().clone();
        (status, [("connection", "close")], Json(value)).into_response()
    }
    let router = Router::new()
        .route("/api/user/self/bootstrap", get(endpoint))
        .route("/api/token/9/key", post(endpoint))
        .fallback(endpoint)
        .with_state(fixture.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (origin, fixture, task)
}
fn service(store: Arc<MemoryStore>, origin: &str) -> Arc<AccountService> {
    Arc::new(AccountService::with_store(store, origin, CLIENT).unwrap())
}
fn request(generation: u64, method: &str, path: &str) -> business::BusinessRequest {
    serde_json::from_value(json!({"generation":generation,"method":method,"path":path,"body":null}))
        .unwrap()
}
async fn connected() -> (
    Arc<AccountService>,
    Arc<MemoryStore>,
    Fixture,
    tokio::task::JoinHandle<()>,
) {
    let (origin, fixture, task) = local_server().await;
    let store = Arc::new(MemoryStore::default());
    let service = service(store.clone(), &origin);
    assert_eq!(
        service.connect(SYNTHETIC_TOKEN.into()).await.status,
        "connected"
    );
    (service, store, fixture, task)
}

#[tokio::test]
async fn local_file_connection_survives_restart_and_disconnect_without_keychain() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("account/connection.json");
    let (origin, fixture, task) = local_server().await;
    let create = || AccountService::with_store(
        Arc::new(LocalFileStore::at(path.clone())), &origin, CLIENT).unwrap();
    let first = create();
    assert_eq!(first.state().status, "disconnected");
    assert_eq!(first.connect(SYNTHETIC_TOKEN.into()).await.status, "connected");
    let restarted = create();
    assert_eq!(restarted.state().status, "offline");
    assert_eq!(restarted.retry().await.status, "connected");
    assert_eq!(fixture.requests.lock().unwrap().len(), 2);
    let projection = serde_json::to_string(&restarted.state()).unwrap();
    assert!(!projection.contains(SYNTHETIC_TOKEN));
    assert_eq!(restarted.logout().await.status, "disconnected");
    assert_eq!(create().state().status, "disconnected");
    assert!(!std::fs::read_to_string(&path).unwrap().contains(SYNTHETIC_TOKEN));
    task.abort();
}

#[tokio::test]
async fn profile_record_ip_defaults_match_website_and_preserve_explicit_values() {
    let (s, _, fixture, task) = connected().await;
    let generation = s.state().generation;
    for (label, settings, expected) in [
        ("missing", json!({}), true),
        ("null", json!({"record_ip_log": null}), true),
        ("true", json!({"record_ip_log": true}), true),
        ("false", json!({"record_ip_log": false}), false),
    ] {
        fixture.set(
            StatusCode::OK,
            json!({"success":true,"data":{"id":7,"setting":settings.to_string()}}),
        );
        let response = s
            .business_request(request(generation, "GET", "/account/profile"))
            .await
            .unwrap();
        assert_eq!(response["data"]["record_ip_log"], expected, "{label}");
        assert_eq!(response["data"]["accept_unset_model_ratio_model"], false);
        assert_eq!(response["data"]["high_concurrency_enabled"], false);
    }
    task.abort();
}

#[tokio::test]
async fn connect_bootstraps_identity_without_user_header_and_persists_only_in_native_store() {
    let (s, store, fixture, task) = connected().await;
    let state = s.state();
    assert_eq!(state.identity.as_ref().unwrap().user_id, "7");
    assert!(!state.identity.as_ref().unwrap().connection_id.is_empty());
    assert!(state.expires_at.is_none() && state.grant_expires_at.is_none());
    let requests = fixture.requests.lock().unwrap();
    assert_eq!(requests[0].0, "/api/user/self/bootstrap");
    assert_eq!(
        requests[0].1["authorization"],
        format!("Bearer {SYNTHETIC_TOKEN}")
    );
    assert!(requests[0].1.get("new-api-user").is_none());
    assert!(requests[0].1.get("cookie").is_none());
    let record = store.record.lock().unwrap();
    assert_eq!(record.as_ref().unwrap().version, 2);
    assert_eq!(
        record
            .as_ref()
            .unwrap()
            .tokens
            .as_ref()
            .unwrap()
            .access_token,
        SYNTHETIC_TOKEN
    );
    let wire = serde_json::to_string(&state).unwrap();
    assert!(!wire.contains(SYNTHETIC_TOKEN));
    assert!(!format!("{state:?}").contains(SYNTHETIC_TOKEN));
    assert!(!wire.contains("refresh_token"));
    task.abort();
}
#[tokio::test]
async fn restart_requires_server_confirmation_and_sends_confirmed_user_header() {
    let (s, store, fixture, task) = connected().await;
    let original = s.state();
    let restarted = service(store, &s.origin);
    assert_eq!(restarted.state().status, "offline");
    assert!(restarted.state().identity.is_none());
    let state = restarted.retry().await;
    assert_eq!(state.status, "connected");
    assert_eq!(
        state.identity.unwrap().connection_id,
        original.identity.unwrap().connection_id
    );
    assert_eq!(fixture.requests.lock().unwrap()[1].1["new-api-user"], "7");
    task.abort();
}
#[tokio::test]
async fn http_200_errors_do_not_connect_or_store_rejected_token() {
    for (code, status) in [
        ("invalid_token", "invalid"),
        ("account_disabled", "invalid"),
        ("dependency_unavailable", "error"),
    ] {
        let (origin, fixture, task) = local_server().await;
        fixture.set(
            StatusCode::OK,
            json!({"success":false,"error":{"code":code},"message":SYNTHETIC_TOKEN}),
        );
        let store = Arc::new(MemoryStore::default());
        let s = service(store.clone(), &origin);
        let state = s.connect(SYNTHETIC_TOKEN.into()).await;
        assert_eq!(state.status, status);
        assert_eq!(state.error.as_ref().unwrap().code, code);
        assert!(!serde_json::to_string(&state)
            .unwrap()
            .contains(SYNTHETIC_TOKEN));
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
}
#[tokio::test]
async fn revoked_or_disabled_saved_token_is_invalid_but_network_failure_is_offline() {
    for code in ["invalid_token", "account_disabled", "session_expired"] {
        let (s, _, fixture, task) = connected().await;
        fixture.set(
            StatusCode::OK,
            json!({"success":false,"error":{"code":code}}),
        );
        let state = s.retry().await;
        assert_eq!(state.status, "invalid");
        assert!(state.identity.is_none());
        task.abort();
    }
    let (s, store, _, task) = connected().await;
    task.abort();
    task.await.unwrap_err();
    let state = s.retry().await;
    assert_eq!(state.status, "offline");
    assert_eq!(state.error.unwrap().code, "network_uncertain");
    assert!(store
        .record
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .tokens
        .is_some());
}
#[tokio::test]
async fn identity_change_during_retry_invalidates_connection() {
    let (s, _, fixture, task) = connected().await;
    fixture.set(StatusCode::OK, json!({"success":true,"data":{"id":8}}));
    let state = s.retry().await;
    assert_eq!(state.status, "invalid");
    assert_eq!(state.error.unwrap().code, "identity_mismatch");
    assert!(state.identity.is_none());
    task.abort();
}
#[tokio::test]
async fn malformed_and_ambiguous_identity_cannot_become_connected() {
    for data in [
        json!({"id":0}),
        json!({"id":-1}),
        json!({"id":"7"}),
        json!({}),
    ] {
        let (origin, fixture, task) = local_server().await;
        fixture.set(StatusCode::OK, json!({"success":true,"data":data}));
        let s = service(Default::default(), &origin);
        let state = s.connect(SYNTHETIC_TOKEN.into()).await;
        assert_eq!(state.error.unwrap().code, "invalid_response");
        assert!(state.identity.is_none());
        task.abort();
    }
}
#[tokio::test]
async fn invalid_input_never_reaches_network_or_stores_secret() {
    let (origin, fixture, task) = local_server().await;
    for token in [
        "".to_string(),
        "  ".into(),
        "synthetic token".into(),
        "synthetic\ntoken".into(),
        "x".repeat(4097),
    ] {
        let store = Arc::new(MemoryStore::default());
        let s = service(store.clone(), &origin);
        assert_eq!(s.connect(token).await.error.unwrap().code, "invalid_token");
        assert_eq!(store.writes.load(Ordering::SeqCst), 1);
        assert!(store
            .record
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .tokens
            .is_none());
    }
    assert!(fixture.requests.lock().unwrap().is_empty());
    task.abort();
}
#[tokio::test]
async fn storage_failures_before_request_or_after_verification_do_not_report_connected() {
    for fail_at in [1, 2] {
        let (origin, fixture, task) = local_server().await;
        let store = Arc::new(MemoryStore::default());
        *store.fail_write_at.lock().unwrap() = Some(fail_at);
        let s = service(store.clone(), &origin);
        let state = s.connect(SYNTHETIC_TOKEN.into()).await;
        assert_eq!(state.status, "error");
        assert_eq!(state.error.unwrap().code, "secure_storage_unavailable");
        assert!(s.inner.lock().unwrap().record.tokens.is_none());
        assert!(store
            .record
            .lock()
            .unwrap()
            .as_ref()
            .is_none_or(|r| r.tokens.is_none()));
        assert_eq!(fixture.requests.lock().unwrap().len(), fail_at - 1);
        task.abort();
    }
}
#[test]
fn storage_read_failure_does_not_report_an_empty_successful_store() {
    let store = Arc::new(MemoryStore::default());
    *store.fail_read.lock().unwrap() = true;
    let s = service(store, ORIGIN);
    let state = s.state();
    assert_eq!(state.status, "error");
    assert!(!state.local_cleared);
    assert_eq!(state.error.unwrap().code, "secure_storage_unavailable");
}
#[tokio::test]
async fn local_disconnect_clears_store_without_remote_revocation() {
    let (s, store, fixture, task) = connected().await;
    let generation = s.state().generation;
    let disconnected = s.logout().await;
    assert_eq!(disconnected.status, "disconnected");
    assert!(disconnected.generation > generation);
    assert!(disconnected.local_cleared);
    assert!(disconnected.remote_revoked.is_none());
    assert!(store
        .record
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .tokens
        .is_none());
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);
    let restarted = service(store, &s.origin);
    assert_eq!(restarted.state().status, "disconnected");
    task.abort();
}
#[tokio::test]
async fn disconnect_storage_failure_is_explicit_and_erases_in_memory_source() {
    let (s, store, _, task) = connected().await;
    *store.fail_write_at.lock().unwrap() = Some(store.writes.load(Ordering::SeqCst) + 1);
    let state = s.logout().await;
    assert_eq!(state.status, "error");
    assert!(!state.local_cleared);
    assert_eq!(state.error.unwrap().code, "secure_storage_unavailable");
    assert!(s.inner.lock().unwrap().record.tokens.is_none());
    assert!(s
        .with_confirmed_source("7", state.generation, || Ok(()))
        .is_err());
    task.abort();
}
#[test]
fn legacy_oauth_v1_is_recognized_as_reconnect_required_and_not_reused() {
    let record: Record = serde_json::from_value(json!({
        "version":1,"origin":ORIGIN,"client":CLIENT,"generation":9,
        "pending":null,"refresh_in_flight":false,"refresh_retry_at":0,
        "tokens":{"access_token":"synthetic-old-oauth","refresh_token":"synthetic-old-refresh","user_id":"7","connection_id":"synthetic-old-connection","access_expires":9999999999i64,"refresh_expires":9999999999i64,"grant_expires":9999999999i64},
        "identity":{"userId":"7","username":"old","displayName":"Old","connectionId":"synthetic-old-connection"}
    })).unwrap();
    let store = Arc::new(MemoryStore::default());
    store.write(&record).unwrap();
    let s = service(store.clone(), ORIGIN);
    let state = s.state();
    assert_eq!(state.status, "invalid");
    assert_eq!(state.error.unwrap().code, "reconnect_required");
    assert_eq!(state.generation, 9);
    assert!(state.identity.is_none());
    assert!(s.inner.lock().unwrap().record.tokens.is_none());
    assert_eq!(store.record.lock().unwrap().as_ref().unwrap().version, 1);
}
#[test]
fn origin_and_client_mismatch_require_reconnection_and_arbitrary_origin_is_rejected() {
    for (origin, client) in [("https://other.invalid", CLIENT), (ORIGIN, "other-client")] {
        let store = Arc::new(MemoryStore::default());
        let record = Record {
            origin: origin.into(),
            client: client.into(),
            ..Default::default()
        };
        store.write(&record).unwrap();
        assert_eq!(
            service(store, ORIGIN).state().error.unwrap().code,
            "reconnect_required"
        );
    }
    assert!(AccountService::with_store(
        Arc::new(MemoryStore::default()),
        "https://other.invalid",
        CLIENT
    )
    .is_err());
    assert!(AccountService::with_store(
        Arc::new(MemoryStore::default()),
        "http://localhost:5180",
        CLIENT
    )
    .is_err());
}
#[tokio::test]
async fn late_connect_and_retry_cannot_restore_a_disconnected_generation() {
    let (s, store, fixture, task) = connected().await;
    fixture.block();
    let clone = s.clone();
    let pending = tokio::spawn(async move { clone.retry().await });
    // A prior request left a notify permit; wait for the actual second request.
    tokio::time::timeout(Duration::from_secs(2), async {
        while fixture.requests.lock().unwrap().len() < 2 {
            fixture.entered.notified().await;
        }
    })
    .await
    .unwrap();
    let disconnected = s.logout().await;
    fixture.release.notify_one();
    assert_eq!(pending.await.unwrap().generation, disconnected.generation);
    assert_eq!(s.state().status, "disconnected");
    assert!(store
        .record
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .tokens
        .is_none());
    task.abort();
    let (origin, fixture, task) = local_server().await;
    fixture.block();
    let store = Arc::new(MemoryStore::default());
    let s = service(store.clone(), &origin);
    let clone = s.clone();
    let pending = tokio::spawn(async move { clone.connect(SYNTHETIC_TOKEN.into()).await });
    fixture.entered.notified().await;
    s.logout().await;
    fixture.release.notify_one();
    assert_eq!(pending.await.unwrap().status, "disconnected");
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
async fn redirects_are_not_followed_or_forwarded_credentials() {
    let (target, target_fixture, target_task) = local_server().await;
    let (origin, fixture, task) = local_server().await;
    *fixture.redirect.lock().unwrap() = Some(format!("{target}/api/user/self/bootstrap"));
    let s = service(Default::default(), &origin);
    assert_ne!(s.connect(SYNTHETIC_TOKEN.into()).await.status, "connected");
    assert!(target_fixture.requests.lock().unwrap().is_empty());
    task.abort();
    target_task.abort();
}
#[tokio::test]
async fn model_source_proof_is_exact_one_use_and_retained_only_after_failed_write() {
    let (s, _, _, task) = connected().await;
    let g = s.state().generation;
    s.remember_model_key_reveal(g, "9", SYNTHETIC_KEY).unwrap();
    for (user, generation, id, key, expected) in [
        ("8", g, "9", SYNTHETIC_KEY, "stale_account"),
        ("7", g + 1, "9", SYNTHETIC_KEY, "stale_account"),
        ("7", g, "8", SYNTHETIC_KEY, "model_key_reveal_required"),
        ("7", g, "9", SYNTHETIC_TOKEN, "model_key_reveal_required"),
        (
            "7",
            g,
            "9",
            "sk-other-synthetic-key",
            "model_key_reveal_required",
        ),
    ] {
        assert_eq!(
            s.with_confirmed_model_source(user, generation, id, key, || -> Result<(), String> {
                panic!("invalid source performed write")
            })
            .unwrap_err(),
            expected
        );
    }
    assert_eq!(
        s.with_confirmed_model_source("7", g, "9", SYNTHETIC_KEY, || Err::<(), _>(
            "synthetic-write-failed".into()
        ))
        .unwrap_err(),
        "synthetic-write-failed"
    );
    assert_eq!(
        s.with_confirmed_model_source("7", g, "9", SYNTHETIC_KEY, || Ok(17))
            .unwrap(),
        17
    );
    assert!(s
        .with_confirmed_model_source("7", g, "9", SYNTHETIC_KEY, || Ok(()))
        .is_err());
    task.abort();
}
#[tokio::test]
async fn model_proof_expiry_and_logout_block_tool_writes() {
    let (s, _, _, task) = connected().await;
    let g = s.state().generation;
    for bad in [SYNTHETIC_TOKEN, "sk-synthetic\r\nkey"] {
        assert!(s.remember_model_key_reveal(g, "9", bad).is_err());
    }
    s.remember_model_key_reveal(g, "9", SYNTHETIC_KEY).unwrap();
    s.inner
        .lock()
        .unwrap()
        .model_key_proof
        .as_mut()
        .unwrap()
        .expires = now();
    assert_eq!(
        s.with_confirmed_model_source("7", g, "9", SYNTHETIC_KEY, || Ok(()))
            .unwrap_err(),
        "model_key_reveal_required"
    );
    s.remember_model_key_reveal(g, "9", SYNTHETIC_KEY).unwrap();
    s.logout().await;
    assert!(s.inner.lock().unwrap().model_key_proof.is_none());
    assert!(s.with_confirmed_source("7", g, || Ok(())).is_err());
    assert!(s.remember_model_key_reveal(g, "9", SYNTHETIC_KEY).is_err());
    task.abort();
}
#[tokio::test]
async fn late_http_reveal_cannot_create_proof_after_disconnect() {
    let (s, _, fixture, task) = connected().await;
    let g = s.state().generation;
    fixture.set(
        StatusCode::OK,
        json!({"success":true,"data":{"key":"synthetic-model-key"}}),
    );
    fixture.block();
    let clone = s.clone();
    let pending = tokio::spawn(async move {
        clone
            .business_request(request(g, "POST", "/account/keys/9/reveal"))
            .await
    });
    tokio::time::timeout(Duration::from_secs(2), async {
        while fixture.requests.lock().unwrap().len() < 2 {
            fixture.entered.notified().await;
        }
    })
    .await
    .unwrap();
    s.logout().await;
    fixture.release.notify_one();
    assert!(pending.await.unwrap().is_err());
    assert!(s.inner.lock().unwrap().model_key_proof.is_none());
    task.abort();
}
#[tokio::test]
async fn controlled_business_requests_cannot_proxy_admin_or_override_identity() {
    let (s, _, fixture, task) = connected().await;
    let g = s.state().generation;
    for path in [
        "/api/user/",
        "/api/desktop/account",
        "https://other.invalid/api/user/self",
        "/account/keys/../1",
        "/account/keys/1?x=1",
    ] {
        assert_eq!(
            s.business_request(request(g, "GET", path))
                .await
                .unwrap_err()
                .code,
            "invalid_request"
        );
    }
    for input in [
        json!({"generation":g,"method":"GET","path":"/account/profile","headers":{"New-Api-User":"8"}}),
        json!({"generation":g,"method":"GET","path":"/account/profile","origin":"https://other.invalid"}),
    ] {
        assert!(serde_json::from_value::<business::BusinessRequest>(input).is_err());
    }
    let mut input =
        json!({"generation":g,"method":"GET","path":"/account/profile","query":[["user_id","8"]]});
    assert_eq!(
        s.business_request(serde_json::from_value(input.take()).unwrap())
            .await
            .unwrap_err()
            .code,
        "invalid_request"
    );
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);
    task.abort();
}

#[tokio::test]
async fn reconnecting_another_account_replaces_identity_and_invalidates_old_source() {
    let (s, store, fixture, task) = connected().await;
    let original = s.state();
    s.remember_model_key_reveal(original.generation, "9", SYNTHETIC_KEY)
        .unwrap();
    fixture.set(
        StatusCode::OK,
        json!({"success":true,"data":{"id":8,"username":"second-synthetic-user"}}),
    );
    let state = s.connect("synthetic-second-system-token".into()).await;
    assert_eq!(state.status, "connected");
    assert_eq!(state.identity.as_ref().unwrap().user_id, "8");
    assert!(state.generation > original.generation);
    assert_ne!(
        state.identity.unwrap().connection_id,
        original.identity.unwrap().connection_id
    );
    assert!(s
        .with_confirmed_source("7", original.generation, || Ok(()))
        .is_err());
    assert!(s.inner.lock().unwrap().model_key_proof.is_none());
    let record = store.record.lock().unwrap();
    let token = record.as_ref().unwrap().tokens.as_ref().unwrap();
    assert_eq!(token.user_id, "8");
    assert_eq!(token.access_token, "synthetic-second-system-token");
    let requests = fixture.requests.lock().unwrap();
    assert!(requests[1].1.get("new-api-user").is_none());
    task.abort();
}

#[tokio::test]
async fn invalid_paste_replaces_connected_generation_and_clears_old_source() {
    let (s, store, fixture, task) = connected().await;
    let original = s.state();
    s.remember_model_key_reveal(original.generation, "9", SYNTHETIC_KEY)
        .unwrap();
    let invalid = s.connect("synthetic invalid token".into()).await;
    assert_eq!(invalid.status, "invalid");
    assert_eq!(invalid.error.unwrap().code, "invalid_token");
    assert!(invalid.generation > original.generation);
    assert!(invalid.identity.is_none());
    assert!(s.inner.lock().unwrap().model_key_proof.is_none());
    assert!(store
        .record
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .tokens
        .is_none());
    assert_eq!(fixture.requests.lock().unwrap().len(), 1);
    assert!(s
        .with_confirmed_source("7", original.generation, || Ok(()))
        .is_err());
    assert!(s
        .with_confirmed_model_source("7", original.generation, "9", SYNTHETIC_KEY, || Ok(()))
        .is_err());
    task.abort();
}

#[test]
fn obsolete_account_callbacks_are_consumed_without_disabling_import_links() {
    assert!(is_auth_input("tuziswitch://auth/callback?code=synthetic"));
    assert!(is_auth_input("TUZISWITCH://AUTH/callback"));
    assert!(!is_auth_input("tuziswitch://v1/import?data=synthetic"));
    assert!(is_import_input("tuziswitch://v1/import?data=synthetic"));
    assert!(!is_import_input("tuziswitch://user@v1/import"));
}
// Reproduce against router.TestSystemTokenLocalPreview with its isolated synthetic DB:
// TUZI_SYSTEM_TOKEN_PAIR_CREDENTIALS=/absolute/private/credentials.json \
// cargo test --lib tuzi_account::tests::real_go_system_token_business_pair -- --ignored --exact
// Never use a production credential file. This test refuses non-loopback origins,
// non-synthetic accounts, and (on Unix) credential files without private 0600 permissions.
fn pair_require(ok: bool, label: &str) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(label.into())
    }
}
async fn pair_call(
    s: &AccountService,
    method: &str,
    path: &str,
    query: Vec<(&str, String)>,
    body: Option<Value>,
) -> Result<Value, String> {
    let req=serde_json::from_value(json!({"method":method,"path":path,"generation":s.state().generation,"query":query,"body":body})).map_err(|_|"pair request construction".to_string())?;
    s.business_request(req)
        .await
        .map(|v| v["data"].clone())
        .map_err(|e| format!("native {method} {path}: {}", e.code))
}
async fn pair_raw(
    s: &AccountService,
    token: &str,
    user: Option<&str>,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let mut req = s
        .http
        .request(
            reqwest::Method::from_bytes(method.as_bytes()).unwrap(),
            format!("{}{path}", s.origin),
        )
        .bearer_auth(token);
    if let Some(user) = user {
        req = req.header("New-Api-User", user);
    }
    if let Some(body) = body {
        req = req.json(&body);
    }
    let response = req
        .send()
        .await
        .map_err(|_| format!("pair raw network {method} {path}"))?;
    response
        .json()
        .await
        .map_err(|_| format!("pair raw JSON {method} {path}"))
}
#[tokio::test]
#[ignore = "Opt-in real Go localhost + synthetic credentials + isolated local credential file pairing; no relay/payment calls"]
async fn real_go_system_token_business_pair() {
    let file = std::env::var("TUZI_SYSTEM_TOKEN_PAIR_CREDENTIALS")
        .expect("explicit private synthetic credentials file required");
    let metadata = std::fs::symlink_metadata(&file).expect("synthetic credentials file metadata");
    assert!(
        metadata.is_file(),
        "credentials must be a regular file, not symlink"
    );
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            metadata.permissions().mode() & 0o777,
            0o600,
            "credentials require mode 0600"
        );
    }
    let bytes = zeroize::Zeroizing::new(
        std::fs::read(file).expect("read private synthetic credentials file"),
    );
    let credentials: Value =
        serde_json::from_slice(&bytes).expect("synthetic credentials JSON shape");
    let origin = credentials["website_origin"]
        .as_str()
        .expect("website_origin required");
    let parsed = Url::parse(origin).expect("loopback origin URL");
    assert!(
        parsed.scheme() == "http"
            && parsed.host_str() == Some("127.0.0.1")
            && parsed.port().is_some()
            && parsed.path() == "/"
            && parsed.username().is_empty()
            && parsed.password().is_none()
            && parsed.query().is_none()
            && parsed.fragment().is_none(),
        "only exact localhost HTTP origin permitted"
    );
    let local_files = tempfile::tempdir().unwrap();
    for username in ["preview", "preview-admin"] {
        let token = credentials[username]["system_token"]
            .as_str()
            .expect("synthetic system_token required");
        assert!(
            token.starts_with("synthetic-system-token-"),
            "fixture refuses non-synthetic system tokens"
        );
        let user = credentials[username]["user_id"]
            .as_i64()
            .filter(|id| *id > 0)
            .expect("synthetic user_id required")
            .to_string();
        let client = format!("tuzi-system-token-pair-{}", uuid::Uuid::new_v4());
        let store_path = local_files.path().join(format!("{username}/connection.json"));
        let store = Arc::new(LocalFileStore::at(store_path.clone()));
        let s = AccountService::with_store(store.clone(), origin, &client).unwrap();
        let connected = s.connect(token.into()).await;
        assert!(connected.status == "connected", "fixture connection failed");
        assert!(
            connected
                .identity
                .as_ref()
                .is_some_and(|id| id.user_id == user),
            "fixture identity mismatch"
        );
        let restarted = AccountService::with_store(store.clone(), origin, &client).unwrap();
        assert_eq!(restarted.state().status, "offline");
        assert_eq!(restarted.retry().await.status, "connected");
        let s = &restarted;
        let mut created_id: Option<String> = None;
        let mut original_profile: Option<Value> = None;
        let result:Result<(),String>=async {
            let account=pair_call(s,"GET","/account/account",vec![],None).await?;
            pair_require(account["user_id"]==user,"own identity projection")?;
            pair_require(account["quota"]=="50000000"&&account["money"]["base_currency"]=="USD"&&account["money"]["quota_per_unit"]=="500000","money integer/string and USD conversion DTO")?;
            pair_require(account["used_quota"]==if username=="preview"{"1200000"}else{"0"},"own account used quota")?;
            let state_wire=serde_json::to_string(&s.state()).unwrap();
            pair_require(!state_wire.contains(token),"account state secret exclusion")?;
            let no_auth=s.http.get(format!("{}/api/user/self",s.origin)).header("New-Api-User",&user).send().await.map_err(|_|"unauthenticated request network")?.json::<Value>().await.map_err(|_|"unauthenticated response JSON")?;
            pair_require(no_auth["success"]!=true,"missing system token cannot read profile")?;
            let missing=pair_raw(s,token,None,"GET","/api/user/self",None).await?;
            pair_require(missing["success"]!=true,"subsequent business request requires confirmed user header")?;
            let wrong=pair_raw(s,token,Some("999999"),"GET","/api/user/self",None).await?;
            pair_require(wrong["success"]!=true,"wrong confirmed user header rejected")?;
            let profile=pair_call(s,"GET","/account/profile",vec![],None).await?;
            pair_require(profile["user_id"]==user,"profile identity")?;
            original_profile=Some(json!({"display_name":profile["display_name"],"language":profile["language"],"accept_unset_model_ratio_model":profile["accept_unset_model_ratio_model"],"high_concurrency_enabled":profile["high_concurrency_enabled"],"record_ip_log":profile["record_ip_log"]}));
            let new_profile=pair_call(s,"PATCH","/account/profile",vec![],Some(json!({"display_name":"Native pair fixture","language":"en","record_ip_log":false}))).await?;
            pair_require(new_profile["display_name"]=="Native pair fixture"&&new_profile["record_ip_log"]==false,"profile partial update and explicit false")?;
            let groups=pair_call(s,"GET","/account/key-groups",vec![],None).await?;
            pair_require(groups.as_array().is_some_and(|rows|rows.iter().any(|v|v["id"]=="default")),"group projection")?;
            let name=format!("npair-{}",uuid::Uuid::new_v4());
            let created=pair_call(s,"POST","/account/keys",vec![],Some(json!({"name":name,"group":"default","expired_time":-1,"unlimited_quota":false,"remain_quota":"7654321","model_limits_enabled":true,"model_limits":"synthetic-g2-model","allow_ips":"192.0.2.1, 2001:db8::/32","exclude_ips":"198.51.100.1 198.51.100.2"}))).await?;
            let id=created["id"].as_str().ok_or("created string id")?.to_string();
            created_id=Some(id.clone());
            pair_require(created["key"].as_str().is_some_and(|key|key.starts_with("sk-")&&!key.is_empty()),"created full model Key")?;
            let path=format!("/account/keys/{id}");
            let detail=pair_call(s,"GET",&path,vec![],None).await?;
            pair_require(detail["name"]==name&&detail["remain_quota"]=="7654321"&&detail["model_limits_enabled"]==true,"key details and decimal DTO")?;
            pair_require(detail["allow_ips"]=="192.0.2.1\n2001:db8::/32"&&detail["exclude_ips"]=="198.51.100.1\n198.51.100.2","mixed IP create normalized for actual model parser")?;
            pair_require(!serde_json::to_string(&detail).unwrap().contains(created["key"].as_str().unwrap()),"read detail must not reveal full Key")?;
            let list=pair_call(s,"GET","/account/keys",vec![("page","1".into()),("page_size","1".into()),("keyword",name.clone())],None).await?;
            pair_require(list["items"].as_array().is_some_and(|rows|rows.len()==1)&&list["total"]=="1"&&list["has_more"]==false,"key filtered pagination")?;
            let first_page=pair_call(s,"GET","/account/keys",vec![("page","1".into()),("page_size","1".into())],None).await?;
            let second_page=pair_call(s,"GET","/account/keys",vec![("page","2".into()),("page_size","1".into())],None).await?;
            pair_require(first_page["has_more"]==(username=="preview")&&second_page["items"].as_array().is_some_and(|rows|rows.len()==if username=="preview"{1}else{0}),"key page boundary and has_more")?;
            // Seed an advanced website-only field using its existing full update,
            // then ensure a simplified native PATCH cannot overwrite that field.
            let raw=pair_raw(s,token,Some(&user),"GET",&format!("/api/token/{id}"),None).await?;
            pair_require(raw["success"]==true,"website key detail")?;
            let mut advanced=raw["data"].clone();
            advanced["rate_limits_enabled"]=true.into(); advanced["rate_limits_time"]=60.into(); advanced["rate_limits_count"]=23.into();
            advanced["routing_preference"]="quality".into();advanced["routing_quality_threshold"]=80.into();
            let updated=pair_raw(s,token,Some(&user),"PUT","/api/token/",Some(advanced)).await?;
            pair_require(updated["success"]==true,"website advanced Key update")?;
            let rename=format!("{name}-edit");
            pair_call(s,"PATCH",&path,vec![],Some(json!({"name":rename,"remain_quota":"0","allow_ips":"","exclude_ips":"198.51.100.3, 2001:db8::1","model_limits_enabled":false}))).await?;
            let after=pair_raw(s,token,Some(&user),"GET",&format!("/api/token/{id}"),None).await?;
            pair_require(after["data"]["rate_limits_enabled"]==true&&after["data"]["rate_limits_count"]==23&&after["data"]["routing_preference"]=="quality"&&after["data"]["routing_quality_threshold"]==80,"native partial patch preserves advanced website fields")?;
            pair_require(after["data"]["allow_ips"]==""&&after["data"]["exclude_ips"]=="198.51.100.3\n2001:db8::1"&&after["data"]["remain_quota"]==0&&after["data"]["model_limits_enabled"]==false,"patch explicit empty zero false")?;
            pair_call(s,"PATCH",&format!("{path}/status"),vec![],Some(json!({"status":2}))).await?;
            let disabled=pair_call(s,"GET",&path,vec![],None).await?;
            pair_require(disabled["status"]==2,"key status patch")?;
            let revealed=pair_call(s,"POST",&format!("{path}/reveal"),vec![],None).await?;
            pair_require(revealed["key"]==created["key"],"reveal exact full Key")?;
            let g=s.state().generation;
            pair_require(s.with_confirmed_model_source(&user,g,&id,revealed["key"].as_str().unwrap(),||Ok(())).is_ok(),"real reveal source proof")?;
            let start=(now()-48*3600).to_string(); let end=(now()+60).to_string();
            let log_query=||vec![("start_timestamp",start.clone()),("end_timestamp",end.clone())];
            let summary=pair_call(s,"GET","/account/logs/summary",log_query(),None).await?;
            let normal=username=="preview";
            for (field,expected) in [("quota","1200100"),("record_count","27"),("error_count","1"),("prompt_tokens","19210"),("completion_tokens","4805"),("refund_quota","100")] {
                pair_require(summary[field]==if normal{expected}else{"0"},&format!("own {username} summary {field}"))?;
            }
            pair_require(summary["coverage"]=="recorded_logs_only","log coverage semantics")?;
            let stats=pair_call(s,"GET","/account/logs/statistics",log_query(),None).await?;
            pair_require(stats["summary"]==summary&&stats["trend"].is_array()&&stats["by_model"].is_array()&&stats["by_error"].is_array(),"statistics DTO and complete summary")?;
            if normal {
                let detail=pair_call(s,"GET","/account/logs/requests/synthetic-g2-request",vec![],None).await?;
                pair_require(detail["items"].as_array().is_some_and(|rows|rows.len()==3),"request log detail preserves own charged/error/refund rows")?;
            }
            let mut logs_query=log_query();logs_query.extend([("page","1".into()),("page_size","2".into())]);
            let logs=pair_call(s,"GET","/account/logs",logs_query,None).await?;
            pair_require(logs["total"]==if normal{"27"}else{"0"},"own paginated logs")?;
            pair_require(logs["has_more"]==normal,"logs has_more")?;
            let usage_query=||vec![("start_time",start.clone()),("end_time",end.clone()),("timezone","UTC".into())];
            let usage_summary=pair_call(s,"GET","/account/usage/summary",usage_query(),None).await?;
            pair_require(usage_summary["quota"]==summary["quota"]&&usage_summary["call_count"]==if normal{"25"}else{"0"},"usage summary complete own totals")?;
            let usage=pair_call(s,"GET","/account/usage",usage_query(),None).await?;
            pair_require(usage["chart"].is_array()&&usage["table"].is_array()&&usage["coverage"]=="recorded_logs_only","usage series DTO")?;
            if !normal {pair_require(usage["table"].as_array().unwrap().is_empty(),"admin own usage does not aggregate ordinary account")?;}
            let models=pair_call(s,"GET","/account/models",vec![("page","1".into()),("page_size","1".into()),("models","synthetic-g2-model".into())],None).await?;
            pair_require(models["items"].as_array().is_some_and(|rows|rows.len()==1)&&models["pagination"]["total"].is_string(),"model pagination decimal total")?;
            let perf=pair_call(s,"GET","/account/model-performance",vec![("model","synthetic-g2-model".into()),("hours","48".into()),("resolution","30m".into()),("group","default".into())],None).await?;
            pair_require(perf["model_name"]=="synthetic-g2-model"&&perf["aggregate"].is_object()&&perf["groups"].is_array(),"single performance DTO")?;
            let batch=pair_call(s,"POST","/account/model-performance/batch",vec![],Some(json!({"models":["synthetic-g2-model"],"groups":["default"],"hours":48,"resolution":"30m"}))).await?;
            pair_require(batch.as_array().is_some_and(|rows|rows.len()==1&&rows[0]["model_name"]=="synthetic-g2-model"),"batch performance DTO")?;
            let bad=serde_json::from_value(json!({"generation":g,"method":"GET","path":"/account/logs/summary","query":[["user_id","999999"]]})).unwrap();
            pair_require(s.business_request(bad).await.is_err_and(|e|e.code=="invalid_request"),"unknown and ownership params rejected by facade")?;
            pair_require(!serde_json::to_string(&account).unwrap().contains(token)&&!serde_json::to_string(&profile).unwrap().contains(token),"business projection secret exclusion")?;
            Ok(())
        }.await;
        let key_cleanup = if let Some(id) = created_id {
            pair_call(s, "DELETE", &format!("/account/keys/{id}"), vec![], None)
                .await
                .map(|_| ())
        } else {
            Ok(())
        };
        let profile_cleanup = if let Some(profile) = original_profile {
            pair_call(s, "PATCH", "/account/profile", vec![], Some(profile))
                .await
                .map(|_| ())
        } else {
            Ok(())
        };
        let logout = s.logout().await;
        std::fs::remove_file(&store_path).unwrap();
        assert!(store.read().unwrap().is_none());
        assert!(key_cleanup.is_ok(), "fixture key cleanup failed");
        assert!(
            profile_cleanup.is_ok(),
            "fixture profile restoration failed"
        );
        assert_eq!(logout.status, "disconnected");
        if let Err(error) = result {
            panic!("{error}");
        }
    }
}

#[test]
fn account_navigation_accepts_only_fixed_credential_free_route() {
    assert!(super::is_account_navigation("tuziswitch://account/connect"));
    for value in ["tuziswitch://account/connect?token=synthetic", "tuziswitch://account/connect#synthetic", "tuziswitch://account/other", "https://account/connect", "tuziswitch://user@account/connect", "tuziswitch://account:123/connect", "tuziswitch://v1/import?resource=provider"] {
        assert!(!super::is_account_navigation(value));
    }
}

#[test]
fn clipboard_prefill_is_one_use_and_never_reads_without_permission() {
    let service = service(Default::default(), ORIGIN);
    service.state();
    let arm = || {
        let mut inner = service.inner.lock().unwrap();
        let mut pending = prefill::TokenPrefill::new(inner.state.generation);
        pending.returned();
        inner.token_prefill = Some(pending);
    };
    assert!(service.take_token_prefill(|| panic!("unarmed clipboard read")).is_none());
    arm();
    assert_eq!(service.take_token_prefill(|| Some("A".repeat(30))), Some("A".repeat(30)));
    assert!(service.take_token_prefill(|| panic!("replayed clipboard read")).is_none());
    arm();
    assert!(service.take_token_prefill(|| None).is_none());
    assert!(service.take_token_prefill(|| panic!("read failure must consume permission")).is_none());
    arm();
    assert!(service.take_token_prefill(|| Some("sk-synthetic-model-key".into())).is_none());
    arm();
    service.inner.lock().unwrap().state.generation += 1;
    assert!(service.take_token_prefill(|| panic!("stale generation clipboard read")).is_none());
    arm();
    service.inner.lock().unwrap().state.status = "verifying".into();
    assert!(service.take_token_prefill(|| panic!("connection already started")).is_none());
    service.inner.lock().unwrap().state.status = "connected".into();
    arm();
    service.inner.lock().unwrap().state.identity = Some(Identity {user_id:"synthetic".into(),username:"synthetic".into(),display_name:"synthetic".into(),connection_id:"synthetic".into()});
    assert!(service.take_token_prefill(|| panic!("connected clipboard read")).is_none());
}
