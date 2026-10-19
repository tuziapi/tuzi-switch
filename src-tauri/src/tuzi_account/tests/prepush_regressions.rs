use super::*;

#[tokio::test]
async fn token_not_found_code_survives_http_200_without_masking_other_failures() {
    let (service, _, fixture, task) = connected().await;
    let generation = service.state().generation;
    for (body, expected) in [
        (
            json!({"success":false,"message":"record not found","error":{"code":"not_found"}}),
            "not_found",
        ),
        (
            json!({"success":false,"message":"record not found"}),
            "business_error",
        ),
        (
            json!({"success":false,"message":"synthetic database failure"}),
            "business_error",
        ),
    ] {
        fixture.set(StatusCode::OK, body);
        let error = service
            .business_request(request(generation, "GET", "/account/keys/9"))
            .await
            .unwrap_err();
        assert_eq!(error.code, expected);
        assert_eq!(serde_json::to_value(error).unwrap()["status"], 200);
        assert_eq!(service.state().status, "connected");
    }
    task.abort();
}

#[derive(Clone, Default)]
struct CatalogFixture {
    mode: &'static str,
    batches: Arc<Mutex<Vec<Vec<String>>>>,
    snapshots: Arc<Mutex<Vec<Option<String>>>>,
    entered: Arc<tokio::sync::Notify>,
    release: Arc<tokio::sync::Notify>,
}

async fn catalog_server(
    mode: &'static str,
) -> (
    Arc<AccountService>,
    CatalogFixture,
    tokio::task::JoinHandle<()>,
) {
    async fn endpoint(State(f): State<CatalogFixture>, uri: axum::http::Uri) -> Response {
        if uri.path() == "/api/user/self/bootstrap" {
            return Json(json!({"success":true,"data":{"id":7,"username":"synthetic-user"}}))
                .into_response();
        }
        if uri.path() == "/api/token/9" {
            return Json(json!({"success":true,"data":{"id":9,"status":1,"group":"default","expired_time":-1,"remain_quota":100,"used_quota":0,"unlimited_quota":true,"model_limits_enabled":false,"model_limits":""}})).into_response();
        }
        assert_eq!(uri.path(), "/api/pricing/models");
        let query: Vec<_> = url::form_urlencoded::parse(uri.query().unwrap_or_default().as_bytes())
            .into_owned()
            .collect();
        let names: Vec<String> = query
            .iter()
            .filter(|(k, _)| k == "models")
            .map(|(_, v)| v.clone())
            .collect();
        let snapshot = query
            .iter()
            .find(|(k, _)| k == "snapshot_id")
            .map(|(_, v)| v.clone());
        let index = {
            let mut batches = f.batches.lock().unwrap();
            batches.push(names.clone());
            batches.len()
        };
        f.snapshots.lock().unwrap().push(snapshot);
        // Match the real Go endpoint limit, including its failing HTTP status.
        if names.len() > 3 || (index > 1 && f.mode == "error") {
            return (StatusCode::BAD_REQUEST, Json(json!({"success":false}))).into_response();
        }
        if index > 1 && f.mode == "logout" {
            f.entered.notify_one();
            f.release.notified().await;
        }
        let mut items: Vec<_> = names.iter().map(|name| json!({
            "model_name":name, "enable_groups":["default"], "supported_endpoint_types":["openai-response"]
        })).collect();
        if index > 1 {
            match f.mode {
                "missing" => {
                    items.clear();
                }
                "protocol" => {
                    items[0]["supported_endpoint_types"] = json!(["anthropic"]);
                }
                "group" => {
                    items[0]["enable_groups"] = json!(["unavailable"]);
                }
                _ => {}
            }
        }
        Json(json!({
            "success":true,"data":items,"pagination":{"total":names.len()},
            "snapshot_id":if f.mode == "no_snapshot" { "" } else if index > 1 && f.mode == "snapshot" { "synthetic-new" } else { "synthetic-original" },
            "snapshot_refreshed":index > 1 && f.mode == "refreshed",
            "meta":{"usable_group":{"default":"Default"},"default_effective_group":"default"}
        })).into_response()
    }
    let fixture = CatalogFixture {
        mode,
        ..Default::default()
    };
    let router = Router::new().fallback(endpoint).with_state(fixture.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let service = service(Arc::new(MemoryStore::default()), &origin);
    assert_eq!(
        service.connect(SYNTHETIC_TOKEN.into()).await.status,
        "connected"
    );
    (service, fixture, task)
}

#[tokio::test]
async fn multi_model_qualification_batches_and_rejects_incomplete_or_changed_catalogs() {
    for (mode, count, expected) in [
        ("ok", 3, Ok(())),
        ("ok", 4, Ok(())),
        ("ok", 50, Ok(())),
        ("missing", 4, Err("provider_selection_not_qualified")),
        ("protocol", 4, Err("provider_selection_not_qualified")),
        ("group", 4, Err("provider_selection_not_qualified")),
        ("snapshot", 4, Err("snapshot_changed")),
        ("refreshed", 4, Err("snapshot_changed")),
        ("no_snapshot", 4, Err("invalid_response")),
        ("error", 4, Err("invalid_request")),
    ] {
        let (service, fixture, task) = catalog_server(mode).await;
        let names: Vec<_> = (0..count).map(|n| format!("synthetic-model-{n}")).collect();
        let result = service
            .provider_qualification(service.state().generation, "9", &names, "responses")
            .await;
        assert_eq!(
            result.as_ref().map_err(String::as_str),
            expected.as_ref().map_err(|e| *e),
            "{mode}/{count}"
        );
        let batches = fixture.batches.lock().unwrap();
        assert!(batches.iter().all(|b| !b.is_empty() && b.len() <= 3));
        if expected.is_ok() {
            assert_eq!(batches.iter().flatten().cloned().collect::<Vec<_>>(), names);
        }
        let snapshots = fixture.snapshots.lock().unwrap();
        assert_eq!(snapshots[0], None);
        assert!(snapshots
            .iter()
            .skip(1)
            .all(|id| id.as_deref() == Some("synthetic-original")));
        task.abort();
    }
}

#[tokio::test]
async fn multi_model_qualification_rejects_logout_between_batches() {
    let (service, fixture, task) = catalog_server("logout").await;
    let worker = service.clone();
    let pending = tokio::spawn(async move {
        let names = (0..4)
            .map(|n| format!("synthetic-model-{n}"))
            .collect::<Vec<_>>();
        worker
            .provider_qualification(worker.state().generation, "9", &names, "responses")
            .await
    });
    tokio::time::timeout(Duration::from_secs(3), fixture.entered.notified())
        .await
        .unwrap();
    service.logout().await;
    fixture.release.notify_one();
    assert_eq!(pending.await.unwrap(), Err("stale_account".into()));
    task.abort();
}
