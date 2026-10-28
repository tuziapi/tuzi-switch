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
    async fn endpoint(
        State(f): State<CatalogFixture>,
        uri: axum::http::Uri,
        headers: axum::http::HeaderMap,
    ) -> Response {
        if uri.path() == "/v1/models" {
            assert_eq!(headers["authorization"], "Bearer sk-SYNTHETIC_MODEL_KEY");
            assert!(!headers.contains_key("New-Api-User"));
        } else {
            assert_eq!(
                headers["authorization"],
                format!("Bearer {SYNTHETIC_TOKEN}")
            );
        }
        if uri.path() == "/api/user/self/bootstrap" {
            return Json(json!({"success":true,"data":{"id":7,"username":"synthetic-user"}}))
                .into_response();
        }
        if uri.path() == "/api/token/9" {
            return Json(json!({"success":true,"data":{"id":9,"status":1,"group":"default","expired_time":-1,"remain_quota":100,"used_quota":0,"unlimited_quota":true,"model_limits_enabled":false,"model_limits":""}})).into_response();
        }
        if uri.path() == "/api/token/9/key" {
            return Json(json!({"success":true,"data":{"key":"SYNTHETIC_MODEL_KEY"}}))
                .into_response();
        }
        assert_eq!(uri.path(), "/v1/models");
        f.batches.lock().unwrap().push(vec!["complete-list".into()]);
        if f.mode == "error" {
            return (StatusCode::BAD_GATEWAY, Json(json!({"error":"synthetic"}))).into_response();
        }
        if f.mode == "logout" {
            f.entered.notify_one();
            f.release.notified().await;
        }
        let mut items: Vec<_> = (0..130).map(|n| json!({
            "id":format!("synthetic-model-{n}"), "supported_endpoint_types":["openai-response"]
        })).collect();
        match f.mode {
            "missing" => {
                items.clear();
            }
            "protocol" => {
                items[0]["supported_endpoint_types"] = json!(["anthropic"]);
            }
            _ => {}
        }
        Json(json!({"data":items})).into_response()
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
async fn complete_key_models_qualify_and_reject_missing_or_incompatible_models() {
    for (mode, count, expected) in [
        ("ok", 3, Ok(())),
        ("ok", 4, Ok(())),
        ("ok", 50, Ok(())),
        ("missing", 4, Err("provider_selection_not_qualified")),
        ("protocol", 4, Err("provider_selection_not_qualified")),
        ("error", 4, Err("model_list_unavailable")),
    ] {
        let (service, fixture, task) = catalog_server(mode).await;
        let names: Vec<_> = (0..count).map(|n| format!("synthetic-model-{n}")).collect();
        let result = service
            .provider_qualification(
                service.state().generation,
                "9",
                &names,
                "responses",
                "opencode",
            )
            .await;
        assert_eq!(
            result.as_ref().map_err(String::as_str),
            expected.as_ref().map_err(|e| *e),
            "{mode}/{count}"
        );
        assert_eq!(fixture.batches.lock().unwrap().len(), 1);
        task.abort();
    }
}

#[tokio::test]
async fn key_model_listing_returns_all_models_without_secret() {
    let (service, _, task) = catalog_server("ok").await;
    let result = service
        .business_request(request(
            service.state().generation,
            "GET",
            "/account/keys/9/models",
        ))
        .await
        .unwrap();
    assert_eq!(result["data"]["items"].as_array().unwrap().len(), 130);
    assert!(!result.to_string().contains("SYNTHETIC_MODEL_KEY"));
    task.abort();
}

#[tokio::test]
async fn key_model_qualification_rejects_logout_during_fetch() {
    let (service, fixture, task) = catalog_server("logout").await;
    let worker = service.clone();
    let pending = tokio::spawn(async move {
        let names = (0..4)
            .map(|n| format!("synthetic-model-{n}"))
            .collect::<Vec<_>>();
        worker
            .provider_qualification(
                worker.state().generation,
                "9",
                &names,
                "responses",
                "opencode",
            )
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

#[tokio::test]
async fn codex_uses_key_membership_without_requiring_responses_metadata() {
    for (mode, expected) in [
        ("protocol", Ok(())),
        ("missing", Err("provider_selection_not_qualified")),
        ("error", Err("model_list_unavailable")),
    ] {
        let (service, _, task) = catalog_server(mode).await;
        let result = service
            .provider_qualification(
                service.state().generation,
                "9",
                &["synthetic-model-0".into()],
                "responses",
                "codex",
            )
            .await;
        assert_eq!(
            result.as_ref().map(|_| ()).map_err(String::as_str),
            expected
        );
        task.abort();
    }
}

fn native_selection(key: &str) -> crate::native_tools::AccountSelection {
    serde_json::from_value(json!({"id":"tuzi-synthetic", "name":"兔子线路-合成", "model":"synthetic-model-0", "protocol":"responses", "key":key, "contextWindow":null})).unwrap()
}
fn native_source(generation: u64) -> crate::services::tuzi_provider::Source {
    crate::services::tuzi_provider::Source {
        site: "https://api.tu-zi.com".into(),
        user_id: "7".into(),
        token_id: "9".into(),
        generation,
    }
}
#[tokio::test]
async fn native_account_save_uses_http_qualification_reveal_and_exact_native_transaction() {
    use crate::native_tools::{save_account_to, NativeTool};
    for tool in [NativeTool::Grokbuild, NativeTool::Pi, NativeTool::Mcode] {
        let (service, _, task) = catalog_server("ok").await;
        let generation = service.state().generation;
        let revealed = service
            .business_request(request(generation, "POST", "/account/keys/9/reveal"))
            .await
            .unwrap();
        let key = revealed["data"]["key"].as_str().unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config");
        let backup = dir.path().join("backup");
        let saved = save_account_to(
            &service,
            tool,
            "missing".into(),
            native_selection(key),
            native_source(generation),
            &path,
            &backup,
        )
        .await
        .unwrap();
        assert!(saved.providers.contains_key("tuzi-synthetic"));
        assert_eq!(saved.current, None);
        assert!(std::fs::read_to_string(&path).unwrap().contains(key));
        assert!(!std::fs::read_to_string(&path)
            .unwrap()
            .contains(SYNTHETIC_TOKEN));
        let bytes = std::fs::read(&path).unwrap();
        let before_backup = std::fs::read(&backup).unwrap();
        assert!(save_account_to(
            &service,
            tool,
            saved.revision.clone(),
            native_selection(key),
            native_source(generation),
            &path,
            &backup
        )
        .await
        .is_err());
        // Re-revealing cannot bypass the duplicate source check either.
        service
            .business_request(request(generation, "POST", "/account/keys/9/reveal"))
            .await
            .unwrap();
        assert!(save_account_to(
            &service,
            tool,
            saved.revision,
            native_selection(key),
            native_source(generation),
            &path,
            &backup
        )
        .await
        .is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(std::fs::read(&backup).unwrap(), before_backup);
        task.abort();
    }
}
#[tokio::test]
async fn native_account_save_rejects_wrong_source_and_unrevealed_keys_without_files() {
    use crate::native_tools::{save_account_to, NativeTool};
    let (service, _, task) = catalog_server("ok").await;
    let generation = service.state().generation;
    service
        .business_request(request(generation, "POST", "/account/keys/9/reveal"))
        .await
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("tool/config");
    let backup = dir.path().join("backup");
    for (case, key) in [
        ("wrong-user", "sk-SYNTHETIC_MODEL_KEY"),
        ("wrong-site", "sk-SYNTHETIC_MODEL_KEY"),
        ("stale", "sk-SYNTHETIC_MODEL_KEY"),
        ("wrong-key", "sk-other-synthetic"),
        ("system-token", SYNTHETIC_TOKEN),
    ] {
        let mut source = native_source(generation);
        match case {
            "wrong-user" => source.user_id = "8".into(),
            "wrong-site" => source.site = "https://example.invalid".into(),
            "stale" => source.generation += 1,
            _ => {}
        }
        assert!(
            save_account_to(
                &service,
                NativeTool::Pi,
                "missing".into(),
                native_selection(key),
                source,
                &path,
                &backup
            )
            .await
            .is_err(),
            "{case}"
        );
        assert!(!path.exists());
        assert!(!backup.exists());
        assert!(!path.parent().unwrap().exists());
    }
    task.abort();
}
#[tokio::test]
async fn native_account_save_rejects_incompatible_or_missing_models_and_catalog_failure() {
    use crate::native_tools::{save_account_to, NativeTool};
    for mode in ["protocol", "missing", "error"] {
        let (service, _, task) = catalog_server(mode).await;
        let generation = service.state().generation;
        service
            .business_request(request(generation, "POST", "/account/keys/9/reveal"))
            .await
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config");
        let backup = dir.path().join("backup");
        assert!(
            save_account_to(
                &service,
                NativeTool::Mcode,
                "missing".into(),
                native_selection("sk-SYNTHETIC_MODEL_KEY"),
                native_source(generation),
                &path,
                &backup
            )
            .await
            .is_err(),
            "{mode}"
        );
        assert!(!path.exists());
        assert!(!backup.exists());
        task.abort();
    }
}
#[tokio::test]
async fn native_account_save_rejects_logout_while_qualifying_before_file_side_effects() {
    use crate::native_tools::{save_account_to, NativeTool};
    let (service, fixture, task) = catalog_server("logout").await;
    let generation = service.state().generation;
    service
        .business_request(request(generation, "POST", "/account/keys/9/reveal"))
        .await
        .unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config");
    let backup = dir.path().join("backup");
    let work = {
        let service = service.clone();
        let path = path.clone();
        let backup = backup.clone();
        tokio::spawn(async move {
            save_account_to(
                &service,
                NativeTool::Grokbuild,
                "missing".into(),
                native_selection("sk-SYNTHETIC_MODEL_KEY"),
                native_source(generation),
                &path,
                &backup,
            )
            .await
        })
    };
    fixture.entered.notified().await;
    service.logout().await;
    fixture.release.notify_one();
    assert!(work.await.unwrap().is_err());
    assert!(!path.exists());
    assert!(!backup.exists());
    task.abort();
}
