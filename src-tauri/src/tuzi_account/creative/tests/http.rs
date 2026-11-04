use super::*;
use axum::{
    extract::State,
    http::{HeaderMap, Uri},
    response::{IntoResponse, Response},
    Json, Router,
};

#[derive(Default)]
struct MemoryStore(Mutex<Option<Record>>);
impl TokenStore for MemoryStore {
    fn read(&self) -> Result<Option<Record>, AccountError> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn write(&self, record: &Record) -> Result<(), AccountError> {
        *self.0.lock().unwrap() = Some(record.clone());
        Ok(())
    }
}
#[derive(Clone, Default)]
struct Fixture {
    mode: Arc<Mutex<&'static str>>,
    submissions: Arc<Mutex<usize>>,
    entered: Arc<tokio::sync::Notify>,
}
async fn connected() -> (Arc<AccountService>, Fixture, tokio::task::JoinHandle<()>) {
    async fn endpoint(State(f): State<Fixture>, uri: Uri, headers: HeaderMap) -> Response {
        let model_request = uri.path().starts_with("/v1/");
        assert_eq!(
            headers["authorization"],
            if model_request {
                "Bearer sk-SYNTHETIC_CREATIVE_KEY"
            } else {
                "Bearer synthetic-system-token"
            }
        );
        if model_request {
            assert!(!headers.contains_key("new-api-user"));
        }
        let mode = *f.mode.lock().unwrap();
        match uri.path() {
            "/api/user/self/bootstrap" => Json(json!({"success":true,"data":{"id":7,"username":"synthetic-user"}})).into_response(),
            "/api/token/9" => Json(json!({"success":true,"data":{"id":9,"name":"Synthetic","key":"****1234","status":if mode=="disabled" {2} else {1},"group":"default","expired_time":-1,"remain_quota":100,"used_quota":0,"unlimited_quota":true,"model_limits_enabled":false,"model_limits":""}})).into_response(),
            "/api/token/9/key" => Json(json!({"success":true,"data":{"key":"SYNTHETIC_CREATIVE_KEY"}})).into_response(),
            "/v1/models" => Json(json!({"data":[{"id":"synthetic","supported_endpoint_types":["generate","edit"]}]})).into_response(),
            "/v1/images/generations" => {
                *f.submissions.lock().unwrap() += 1;
                f.entered.notify_one();
                match mode {
                    "wait" => { std::future::pending::<()>().await; unreachable!() },
                    "redirect" => (axum::http::StatusCode::FOUND, [("location","/must-not-follow")]).into_response(),
                    "error" => (axum::http::StatusCode::UNAUTHORIZED, "SYNTHETIC_CREATIVE_KEY").into_response(),
                    _ => Json(json!({"data":[{"b64_json":"c3ludGhldGlj"}]})).into_response(),
                }
            },
            _ => panic!("Unexpected fixture path: {}", uri.path()),
        }
    }
    let fixture = Fixture::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new().fallback(endpoint).with_state(fixture.clone());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let service = Arc::new(
        AccountService::with_store(Arc::new(MemoryStore::default()), &origin, CLIENT).unwrap(),
    );
    assert_eq!(
        service
            .connect("synthetic-system-token".into())
            .await
            .status,
        "connected"
    );
    (service, fixture, task)
}

fn output() -> (tauri::ipc::Channel<CreativeChunk>, Arc<Mutex<Vec<Value>>>) {
    let chunks = Arc::new(Mutex::new(Vec::new()));
    let capture = chunks.clone();
    (
        tauri::ipc::Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                capture
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(&json).unwrap());
            }
            Ok(())
        }),
        chunks,
    )
}

#[tokio::test]
async fn bind_reload_qualify_and_execute_with_only_model_key_at_model_endpoint() {
    let (service, fixture, server) = connected().await;
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("bindings.json");
    let generation = service.state().generation;
    let binding = bind(
        &service,
        BindRequest {
            generation,
            token_id: "9".into(),
        },
        &path,
    )
    .await
    .unwrap();
    assert_eq!(read_bindings(&path, &service.origin).unwrap().len(), 1);
    let persisted = std::fs::read_to_string(&path).unwrap();
    assert!(!persisted.contains("SYNTHETIC_CREATIVE_KEY"));
    assert!(!persisted.contains("synthetic-system-token"));
    let mut req = request("image.generate");
    req.generation = generation;
    req.binding_id = binding.id.clone();
    let (channel, chunks) = output();
    execute(&service, req, &path, channel).await.unwrap();
    let chunks = chunks.lock().unwrap();
    assert_eq!(chunks.first().unwrap()["type"], "ready");
    assert_eq!(chunks.last().unwrap()["type"], "end");
    assert_eq!(*fixture.submissions.lock().unwrap(), 1);
    drop(chunks);
    for (mode, expected) in [
        ("disabled", "provider_selection_not_qualified"),
        ("redirect", "creative_redirect_rejected"),
        ("error", "creative_upstream_401"),
    ] {
        *fixture.mode.lock().unwrap() = mode;
        let mut req = request("image.generate");
        req.generation = generation;
        req.binding_id = binding.id.clone();
        assert_eq!(
            execute(&service, req, &path, output().0).await.unwrap_err(),
            expected
        );
    }
    let mut req = request("image.generate");
    req.generation = generation + 1;
    req.binding_id = binding.id;
    assert_eq!(
        execute(&service, req, &path, output().0).await.unwrap_err(),
        "creative_account_unavailable"
    );
    assert!(service.business_pending.lock().unwrap().is_empty());
    server.abort();
}

#[tokio::test]
async fn disconnect_cancels_waiting_model_request_without_replaying_it() {
    let (service, fixture, server) = connected().await;
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("bindings.json");
    let generation = service.state().generation;
    let binding = bind(
        &service,
        BindRequest {
            generation,
            token_id: "9".into(),
        },
        &path,
    )
    .await
    .unwrap();
    *fixture.mode.lock().unwrap() = "wait";
    let mut req = request("image.generate");
    req.generation = generation;
    req.binding_id = binding.id;
    let copy = service.clone();
    let task = tokio::spawn(async move { execute(&copy, req, &path, output().0).await });
    tokio::time::timeout(Duration::from_secs(5), fixture.entered.notified())
        .await
        .unwrap();
    service.logout().await;
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err(),
        "creative_cancelled_outcome_unknown"
    );
    assert_eq!(*fixture.submissions.lock().unwrap(), 1);
    assert!(service.business_pending.lock().unwrap().is_empty());
    server.abort();
}
