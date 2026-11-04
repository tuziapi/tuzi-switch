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
    fn write(&self, value: &Record) -> Result<(), AccountError> {
        *self.0.lock().unwrap() = Some(value.clone());
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq)]
struct Observed {
    method: Method,
    uri: String,
    content_type: Option<String>,
    request_id: Option<String>,
    body: Vec<u8>,
}
#[derive(Clone, Default)]
struct Fixture {
    mode: Arc<Mutex<&'static str>>,
    requests: Arc<Mutex<Vec<Observed>>>,
    credentials: Arc<Mutex<usize>>,
    entered: Arc<tokio::sync::Notify>,
}
async fn connected() -> (Arc<AccountService>, Fixture, tokio::task::JoinHandle<()>) {
    async fn endpoint(
        State(f): State<Fixture>,
        method: Method,
        uri: Uri,
        headers: HeaderMap,
        bytes: Bytes,
    ) -> Response {
        let mode = *f.mode.lock().unwrap();
        if uri.path().starts_with("/api/") {
            assert_eq!(headers["authorization"], "Bearer synthetic-system-token");
            return match uri.path() {
                "/api/user/self/bootstrap" => Json(json!({"success":true,"data":{"id":7,"username":"synthetic-user"}})).into_response(),
                "/api/token/9" => Json(json!({"success":true,"data":{"id":9,"name":"Synthetic","key":"****1234","status":if mode=="disabled" {2} else {1},"group":"default","expired_time":-1,"remain_quota":100,"used_quota":0,"unlimited_quota":true,"model_limits_enabled":false,"model_limits":""}})).into_response(),
                "/api/token/9/key" => {
                    *f.credentials.lock().unwrap() += 1;
                    if mode == "credential-wait" {
                        f.entered.notify_one();
                        std::future::pending::<()>().await;
                    }
                    Json(json!({"success":true,"data":{"key":"SYNTHETIC_CREATIVE_KEY"}})).into_response()
                },
                _ => panic!("Unexpected account path"),
            };
        }
        assert_eq!(headers["authorization"], "Bearer sk-SYNTHETIC_CREATIVE_KEY");
        for name in ["new-api-user", "x-api-key", "x-goog-api-key", "cookie"] {
            assert!(!headers.contains_key(name));
        }
        f.requests.lock().unwrap().push(Observed {
            method,
            uri: uri.to_string(),
            content_type: headers
                .get("content-type")
                .map(|v| v.to_str().unwrap().to_owned()),
            request_id: headers
                .get("x-request-id")
                .map(|v| v.to_str().unwrap().to_owned()),
            body: bytes.to_vec(),
        });
        f.entered.notify_one();
        match mode {
            "wait" => {
                std::future::pending::<()>().await;
                unreachable!()
            }
            "redirect" => (
                axum::http::StatusCode::FOUND,
                [("location", "/api/token/9/key")],
            )
                .into_response(),
            "error" => (
                axum::http::StatusCode::FORBIDDEN,
                "sk-SYNTHETIC_CREATIVE_KEY",
            )
                .into_response(),
            _ if uri.path() == "/v1/models" => {
                Json(json!({"data":[{"id":"synthetic-no-endpoint-metadata"}]})).into_response()
            }
            _ if uri.path() == "/v1/chat/completions" => (
                [("content-type", "text/event-stream")],
                "data: {\"text\":\"synthetic\"}\n\ndata: [DONE]\n\n",
            )
                .into_response(),
            _ => (
                [
                    ("content-type", "application/octet-stream"),
                    ("x-request-id", "synthetic-response"),
                ],
                bytes,
            )
                .into_response(),
        }
    }
    let fixture = Fixture::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new().fallback(endpoint).with_state(fixture.clone());
    let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
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
    (service, fixture, server)
}
async fn bound(service: &AccountService, path: &Path) -> CreativeBinding {
    bind(
        service,
        BindRequest {
            generation: service.state().generation,
            token_id: "9".into(),
        },
        path,
    )
    .await
    .unwrap()
}
fn request(
    service: &AccountService,
    binding: &CreativeBinding,
    method: &str,
    suffix: &str,
    body: Option<&[u8]>,
) -> AccountHttpRequest {
    AccountHttpRequest {
        generation: service.state().generation,
        binding_id: binding.id.clone(),
        request_id: uuid::Uuid::new_v4().to_string(),
        url: format!("{}{suffix}", service.origin),
        method: method.into(),
        headers: BTreeMap::from([
            ("content-type".into(), "application/json".into()),
            ("x-request-id".into(), "synthetic-request".into()),
            (
                "authorization".into(),
                "Bearer tuzi-account:synthetic-reference".into(),
            ),
            ("X-API-Key".into(), "must-be-replaced".into()),
            ("New-Api-User".into(), "another-user".into()),
        ]),
        body: body.map(|b| STANDARD.encode(b)),
    }
}
fn record(chunks: &Mutex<Vec<Value>>, chunk: CreativeChunk) -> Result<(), String> {
    chunks
        .lock()
        .unwrap()
        .push(serde_json::to_value(chunk).unwrap());
    Ok(())
}

#[tokio::test]
async fn real_http_parity_for_all_media_protocols_without_catalog_gate() {
    let (service, fixture, server) = connected().await;
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("bindings.json");
    let binding = bound(&service, &path).await;
    let multipart = b"--synthetic-boundary\r\nContent-Disposition: form-data; name=\"image\"; filename=\"original.png\"\r\nContent-Type: image/png\r\n\r\n\x00\xff\x80\x01\r\n--synthetic-boundary--\r\n";
    for (method, suffix, body, mime) in [
        (
            "POST",
            "/v1/images/generations",
            Some(b"{\"model\":\"synthetic-image\",\"n\":2}".as_slice()),
            "application/json",
        ),
        (
            "POST",
            "/v1/images/edits",
            Some(multipart.as_slice()),
            "multipart/form-data; boundary=synthetic-boundary",
        ),
        (
            "POST",
            "/v1/videos",
            Some(b"{\"model\":\"synthetic-video\"}".as_slice()),
            "application/json",
        ),
        (
            "POST",
            "/kling/v1/videos/text2video",
            Some(b"{\"model_name\":\"synthetic\"}".as_slice()),
            "application/json",
        ),
        (
            "POST",
            "/v2/video_generation",
            Some(b"{\"model\":\"synthetic-h3\"}".as_slice()),
            "application/json",
        ),
        (
            "GET",
            "/kling/v1/videos/text2video/synthetic-task",
            None,
            "application/json",
        ),
        (
            "GET",
            "/v1/videos/synthetic-task/content",
            None,
            "application/json",
        ),
        (
            "POST",
            "/suno/submit/music",
            Some(b"{\"mv\":\"synthetic-suno\"}".as_slice()),
            "application/json",
        ),
        (
            "POST",
            "/suno/v2/music",
            Some(b"{\"prompt\":\"synthetic\"}".as_slice()),
            "application/json",
        ),
        (
            "POST",
            "/suno/api/v1/generate",
            Some(b"{\"instrumental\":true}".as_slice()),
            "application/json",
        ),
        (
            "GET",
            "/suno/api/v1/generate/record-info?taskId=synthetic&channel=desktop",
            None,
            "application/json",
        ),
        (
            "POST",
            "/v1/chat/completions",
            Some(b"{\"model\":\"synthetic\",\"stream\":true}".as_slice()),
            "application/json",
        ),
        (
            "POST",
            "/v1/responses",
            Some(b"{\"input\":\"synthetic\"}".as_slice()),
            "application/json",
        ),
        (
            "POST",
            "/v1/messages",
            Some(b"{\"model\":\"synthetic\"}".as_slice()),
            "application/json",
        ),
        (
            "POST",
            "/v1beta/models/synthetic:streamGenerateContent?alt=sse",
            Some(b"{\"contents\":[]}".as_slice()),
            "application/json",
        ),
        (
            "POST",
            "/mj/submit/imagine",
            Some(b"{\"prompt\":\"synthetic\"}".as_slice()),
            "application/json",
        ),
        (
            "GET",
            "/flux/v1/get_result?id=synthetic-task",
            None,
            "application/json",
        ),
        (
            "GET",
            "/log/get-request?id=synthetic-request",
            None,
            "application/json",
        ),
    ] {
        let mut req = request(&service, &binding, method, suffix, body);
        req.headers.insert("content-type".into(), mime.into());
        let mut headers = req.headers.clone();
        headers.retain(|k, _| !POLICY.credential_headers.contains(&k.to_ascii_lowercase()));
        headers.insert(
            "authorization".into(),
            "Bearer sk-SYNTHETIC_CREATIVE_KEY".into(),
        );
        let manual = ManualRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            url: req.url.clone(),
            method: req.method.clone(),
            headers,
            body: req.body.clone(),
        };
        let account_chunks = Mutex::new(vec![]);
        execute_http(&service, req, &path, |c| record(&account_chunks, c))
            .await
            .unwrap();
        let manual_chunks = Mutex::new(vec![]);
        crate::creative_http::execute(manual, |c| record(&manual_chunks, c))
            .await
            .unwrap();
        assert_eq!(
            *account_chunks.lock().unwrap(),
            *manual_chunks.lock().unwrap(),
            "{suffix}"
        );
        let requests = fixture.requests.lock().unwrap();
        assert_eq!(
            requests[requests.len() - 1],
            requests[requests.len() - 2],
            "{suffix}"
        );
    }
    // Submissions and polling did not need /v1/models at all. An explicit fetch
    // returns the same raw model list (even without endpoint metadata) as manual.
    assert!(!fixture
        .requests
        .lock()
        .unwrap()
        .iter()
        .any(|r| r.uri == "/v1/models"));
    let chunks = Mutex::new(vec![]);
    execute_http(
        &service,
        request(&service, &binding, "GET", "/v1/models", None),
        &path,
        |c| record(&chunks, c),
    )
    .await
    .unwrap();
    let persisted = std::fs::read_to_string(path).unwrap();
    assert!(!persisted.contains("SYNTHETIC_CREATIVE_KEY"));
    assert!(!persisted.contains("synthetic-system-token"));
    assert!(service.business_pending.lock().unwrap().is_empty());
    server.abort();
}

#[tokio::test]
async fn rejects_wrong_account_destination_and_disabled_key_before_submission() {
    let (service, fixture, server) = connected().await;
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("bindings.json");
    let binding = bound(&service, &path).await;
    let before = *fixture.credentials.lock().unwrap();
    for suffix in [
        "/api/token/9/key",
        "/v1/../api/token/9",
        "/v1/%2e%2e/api/token/9",
        "/suno/%252e%252e/api/token/9",
        "/v1/models?api_key=synthetic",
        "/v1/models#fragment",
    ] {
        assert!(execute_http(
            &service,
            request(&service, &binding, "GET", suffix, None),
            &path,
            |_| Ok(())
        )
        .await
        .is_err());
    }
    let mut req = request(&service, &binding, "GET", "/v1/models", None);
    req.url = "https://attacker.invalid/v1/models".into();
    assert!(execute_http(&service, req, &path, |_| Ok(()))
        .await
        .is_err());
    let mut req = request(&service, &binding, "GET", "/v1/models", None);
    req.generation += 1;
    assert!(execute_http(&service, req, &path, |_| Ok(()))
        .await
        .is_err());
    let mut req = request(&service, &binding, "GET", "/v1/models", None);
    req.binding_id = "another-account".into();
    assert!(execute_http(&service, req, &path, |_| Ok(()))
        .await
        .is_err());
    *fixture.mode.lock().unwrap() = "disabled";
    assert_eq!(
        execute_http(
            &service,
            request(&service, &binding, "GET", "/v1/models", None),
            &path,
            |_| Ok(())
        )
        .await
        .unwrap_err(),
        "provider_selection_not_qualified"
    );
    assert_eq!(*fixture.credentials.lock().unwrap(), before);
    assert!(fixture.requests.lock().unwrap().is_empty());
    assert!(service.business_pending.lock().unwrap().is_empty());
    server.abort();
}

#[tokio::test]
async fn upstream_errors_are_responses_and_redirects_never_forward_credentials() {
    let (service, fixture, server) = connected().await;
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("bindings.json");
    let binding = bound(&service, &path).await;
    *fixture.mode.lock().unwrap() = "error";
    let chunks = Mutex::new(vec![]);
    execute_http(
        &service,
        request(&service, &binding, "POST", "/v1/videos", Some(b"{}")),
        &path,
        |c| record(&chunks, c),
    )
    .await
    .unwrap();
    let chunks = chunks.lock().unwrap();
    assert!(chunks.iter().any(|c| c["status"] == 403));
    for chunk in chunks.iter().filter(|c| c["type"] == "data") {
        let decoded = STANDARD.decode(chunk["data"].as_str().unwrap()).unwrap();
        assert!(!String::from_utf8(decoded)
            .unwrap()
            .contains("SYNTHETIC_CREATIVE_KEY"));
    }
    drop(chunks);
    *fixture.mode.lock().unwrap() = "redirect";
    assert_eq!(
        execute_http(
            &service,
            request(&service, &binding, "POST", "/v1/videos", Some(b"{}")),
            &path,
            |_| Ok(())
        )
        .await
        .unwrap_err(),
        "creative_redirect_rejected"
    );
    assert_eq!(fixture.requests.lock().unwrap().len(), 2);
    server.abort();
}

#[tokio::test]
async fn logout_cancels_credential_resolution_and_inflight_generation_without_replay() {
    for mode in ["credential-wait", "wait"] {
        let (service, fixture, server) = connected().await;
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("bindings.json");
        let binding = bound(&service, &path).await;
        *fixture.mode.lock().unwrap() = mode;
        let req = request(
            &service,
            &binding,
            "POST",
            "/suno/api/v1/generate",
            Some(b"{}"),
        );
        let copy = service.clone();
        let task = tokio::spawn(async move { execute_http(&copy, req, &path, |_| Ok(())).await });
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
        assert_eq!(
            fixture.requests.lock().unwrap().len(),
            if mode == "wait" { 1 } else { 0 }
        );
        assert!(service.business_pending.lock().unwrap().is_empty());
        server.abort();
    }
}

#[test]
fn rejects_unknown_ipc_fields() {
    assert!(serde_json::from_value::<AccountHttpRequest>(json!({"generation":1,"bindingId":"synthetic","requestId":uuid::Uuid::new_v4().to_string(),"url":"https://api.tu-zi.com/v1/models","method":"GET","headers":{},"body":null,"secret":"synthetic"})).is_err());
}
