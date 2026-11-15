use super::*;
use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, Method, Uri},
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
    requests: Arc<Mutex<Vec<(String, String, Vec<u8>)>>>,
    entered: Arc<tokio::sync::Notify>,
}
async fn connected() -> (Arc<AccountService>, Fixture, tokio::task::JoinHandle<()>) {
    async fn endpoint(
        State(f): State<Fixture>,
        uri: Uri,
        method: Method,
        headers: HeaderMap,
        body: Bytes,
    ) -> Response {
        let model_request =
            !uri.path().starts_with("/api/token/") && !uri.path().starts_with("/api/user/");
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
            "/v1/models" => {
                let mut items = vec![json!({"id":"synthetic","supported_endpoint_types":["generate","edit","openai-video"]})];
                if mode == "media" {
                    let mut names = std::collections::HashSet::new();
                    for action in MEDIA_ACTIONS.iter() {
                        for model in &action.models {
                            if names.insert(model) { items.push(json!({"id":model})); }
                        }
                    }
                }
                Json(json!({"data":items})).into_response()
            },
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
            _ if mode == "media" && MEDIA_ACTIONS.iter().any(|a| a.method == method.as_str() && a.path.replace("{taskId}", "synthetic-task_1") == uri.to_string()) => {
                f.requests.lock().unwrap().push((method.to_string(), uri.to_string(), body.to_vec()));
                Json(json!({"task_id":"synthetic-task_1","status":"SUCCESS"})).into_response()
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

#[tokio::test]
async fn media_manifest_executes_over_http_with_model_key_and_exact_payloads() {
    let (service, fixture, server) = connected().await;
    *fixture.mode.lock().unwrap() = "media";
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
    for entry in MEDIA_ACTIONS.iter() {
        let mut r = request(&entry.action);
        r.generation = generation;
        r.binding_id = binding.id.clone();
        r.task_id = "synthetic-task_1".into();
        let expected_body = if entry.method == "GET" {
            None
        } else if let Some(field) = &entry.model_field {
            Some(json!({field: "synthetic", "prompt": "SYNTHETIC MEDIA ONLY"}))
        } else {
            Some(json!({"prompt":"SYNTHETIC MUSIC ONLY","mv":"chirp-v5"}))
        };
        r.body = expected_body.clone();
        let (channel, chunks) = output();
        execute(&service, r, &path, channel)
            .await
            .unwrap_or_else(|e| panic!("{}: {e}", entry.action));
        assert_eq!(chunks.lock().unwrap().last().unwrap()["type"], "end");
        let requests = fixture.requests.lock().unwrap();
        let sent = requests.last().unwrap();
        assert_eq!(sent.0, entry.method);
        assert_eq!(sent.1, entry.path.replace("{taskId}", "synthetic-task_1"));
        match expected_body {
            Some(body) => assert_eq!(serde_json::from_slice::<Value>(&sent.2).unwrap(), body),
            None => assert!(sent.2.is_empty()),
        }
    }
    assert_eq!(fixture.requests.lock().unwrap().len(), MEDIA_ACTIONS.len());
    assert!(service.business_pending.lock().unwrap().is_empty());
    server.abort();
}
