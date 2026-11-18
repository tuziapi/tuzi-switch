use super::local_session::*;
use crate::provider::Provider;
use crate::{database::Database, services::proxy::ProxyService};
use axum::http::{header, HeaderMap};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
static CANCELLED: AtomicBool = AtomicBool::new(false);
struct CancelProbe;
impl Drop for CancelProbe {
    fn drop(&mut self) {
        CANCELLED.store(true, Ordering::SeqCst);
    }
}
use axum::{extract::State, response::IntoResponse, routing::post, Json, Router};

fn provider(base: &str) -> Provider {
    Provider::with_id(
        "p0-synthetic".into(),
        "P0 Synthetic".into(),
        json!({"env": {
            "ANTHROPIC_BASE_URL": base, "ANTHROPIC_AUTH_TOKEN": "synthetic-upstream-key",
            "ANTHROPIC_MODEL": "upstream-test-model"
        }}),
        None,
    )
}
fn headers(token: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(
        header::AUTHORIZATION,
        format!("Bearer {token}").parse().unwrap(),
    );
    h
}

#[test]
fn local_session_snapshot_auth_and_revocation() {
    let original = provider("http://127.0.0.1:1");
    let fixed = snapshot(original.clone()).unwrap();
    assert!(original.meta.is_none());
    assert!(!crate::claude_desktop_config::proxy_model_routes(&fixed).unwrap()[0].supports_1m);
    let session = LocalSession::default();
    assert!(session.authorize(&headers("invalid")).is_err());
    let token = session.bind(fixed.clone()).unwrap();
    assert!(session.bind(fixed).is_err());
    assert_eq!(session.authorize(&headers(&token)).unwrap().id, original.id);
    let mut browser = headers(&token);
    browser.insert(header::ORIGIN, "https://example.test".parse().unwrap());
    assert!(session.authorize(&browser).is_err());
    session.clear();
    assert!(session.authorize(&headers(&token)).is_err());
    let mut oauth = original.clone();
    oauth.meta = Some(crate::provider::ProviderMeta {
        provider_type: Some("codex_oauth".into()),
        ..Default::default()
    });
    assert!(snapshot(oauth).is_err());
    assert!(snapshot(Provider::with_id(
        "empty".into(),
        "Empty".into(),
        json!({}),
        None
    ))
    .is_err());
}

async fn mock_upstream(
    State(seen): State<Arc<Mutex<Vec<(HeaderMap, Value)>>>>,
    h: HeaderMap,
    Json(body): Json<Value>,
) -> axum::response::Response {
    seen.lock().unwrap().push((h, body.clone()));
    if body["messages"][0]["content"] == "fail" {
        return (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":{"type":"api_error","message":"synthetic failure"}})),
        )
            .into_response();
    }
    if body["messages"][0]["content"] == "cancel" {
        let stream = async_stream::stream! {
            let _probe = CancelProbe;
            loop {
                yield Ok::<_, std::io::Error>(bytes::Bytes::from_static(b"event: ping\ndata: {\"type\":\"ping\"}\n\n"));
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            }
        };
        return axum::response::Response::builder()
            .header("content-type", "text/event-stream")
            .body(axum::body::Body::from_stream(stream))
            .unwrap();
    }
    if body["stream"] == true {
        let events = [
            (
                "message_start",
                json!({"type":"message_start","message":{"id":"synthetic-stream","type":"message","role":"assistant","model":"upstream-test-model","content":[],"usage":{"input_tokens":2,"output_tokens":0}}}),
            ),
            (
                "content_block_start",
                json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
            ),
            (
                "content_block_delta",
                json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"synthetic hello"}}),
            ),
            (
                "content_block_stop",
                json!({"type":"content_block_stop","index":0}),
            ),
            (
                "message_delta",
                json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}),
            ),
            ("message_stop", json!({"type":"message_stop"})),
        ];
        let body = events
            .iter()
            .map(|(event, data)| format!("event: {event}\ndata: {data}\n\n"))
            .collect::<String>();
        return axum::response::Response::builder()
            .header("content-type", "text/event-stream")
            .body(axum::body::Body::from_stream(futures::stream::once(async move {
                Ok::<_, std::io::Error>(bytes::Bytes::from(body))
            }))).unwrap();
    }
    Json(json!({"id":"synthetic", "type":"message", "role":"assistant", "model":"upstream-test-model",
        "content":[{"type":"tool_use","id":"tool-synthetic","name":"echo","input":{"text":"hello"}}],
        "stop_reason":"tool_use", "usage":{"input_tokens":2,"output_tokens":3}})).into_response()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn local_gateway_http_sse_tools_and_lifecycle() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let router = Router::new()
        .route("/v1/messages", post(mock_upstream))
        .with_state(seen.clone());
    let mock_task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let db = Arc::new(Database::memory().unwrap());
    let reservation = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let mut config = db.get_proxy_config().await.unwrap();
    config.listen_port = reservation.local_addr().unwrap().port();
    drop(reservation);
    db.update_proxy_config(config.clone()).await.unwrap();
    let fixed = snapshot(provider(&base)).unwrap();
    db.save_provider("claude-desktop", &fixed).unwrap();
    let service = ProxyService::new(db.clone());
    let (info, token) = service.bind_local(fixed.clone()).await.unwrap();
    let gateway = format!(
        "http://127.0.0.1:{}/claude-desktop-local/v1/messages",
        info.port
    );
    assert!(service.stop().await.is_err());
    assert!(service.stop_with_restore().await.is_err());
    assert!(service.stop_with_restore_keep_state().await.is_err());
    let mut changed = config.clone();
    changed.listen_port += 1;
    assert!(service.update_config(&changed).await.is_err());
    assert_eq!(
        db.get_proxy_config().await.unwrap().listen_port,
        config.listen_port
    );
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap();
    let body = json!({"model":"claude-local-default","max_tokens":32,"messages":[{"role":"user","content":"hello"}],"tools":[{"name":"echo","input_schema":{"type":"object","properties":{"text":{"type":"string"}}}}]});
    assert!(!client
        .post(&gateway)
        .json(&body)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    assert!(!client
        .post(&gateway)
        .bearer_auth(&token)
        .header("origin", "https://example.test")
        .json(&body)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    let response = client
        .post(&gateway)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .unwrap();
    let status = response.status();
    let value: Value = response.json().await.unwrap();
    assert!(status.is_success(), "{status}: {value}");
    assert_eq!(value["content"][0]["type"], "tool_use");
    // Editing DB credentials/models/current supplier cannot change the already bound clone.
    let mut edited = provider("http://127.0.0.1:1");
    edited.settings_config["env"]["ANTHROPIC_MODEL"] = "wrong-model".into();
    db.save_provider("claude-desktop", &edited).unwrap();
    let mut second = edited.clone();
    second.id = "other-provider".into();
    db.save_provider("claude-desktop", &second).unwrap();
    db.set_current_provider("claude-desktop", &second.id)
        .unwrap();
    let mut followup = body.clone();
    followup["stream"] = true.into();
    followup["messages"].as_array_mut().unwrap().extend([
        json!({"role":"assistant","content":value["content"]}),
        json!({"role":"user","content":[{"type":"tool_result","tool_use_id":"tool-synthetic","content":"hello"}]})]);
    let streamed = client
        .post(&gateway)
        .bearer_auth(&token)
        .json(&followup)
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(streamed.contains("synthetic hello") && streamed.contains("message_stop"));
    // The protocol parser is shared with Claude Code; consumption belongs to Desktop.
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            let ready = {
                let conn = db.conn.lock().unwrap();
                let counts: (i64, i64) = conn.query_row(
                    "SELECT COUNT(*), COALESCE(SUM(CASE WHEN app_type = 'claude-desktop' THEN 1 ELSE 0 END), 0) FROM proxy_request_logs WHERE status_code = 200",
                    [], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
                if counts.0 >= 2 { assert_eq!(counts.0, counts.1); true } else { false }
            };
            if ready { break; }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    }).await.unwrap_or_else(|_| {
        let conn = db.conn.lock().unwrap();
        let rows: Vec<(String, String, i64)> = conn.prepare("SELECT request_id, app_type, status_code FROM proxy_request_logs").unwrap()
            .query_map([], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap().map(Result::unwrap).collect();
        panic!("both native and SSE requests must produce Desktop usage records: {rows:?}");
    });
    let mut unknown = body.clone();
    unknown["model"] = "claude-unbound".into();
    assert_eq!(
        client
            .post(&gateway)
            .bearer_auth(&token)
            .json(&unknown)
            .send()
            .await
            .unwrap()
            .status(),
        400
    );
    let mut fail = body.clone();
    fail["messages"][0]["content"] = "fail".into();
    assert!(!client
        .post(&gateway)
        .bearer_auth(&token)
        .json(&fail)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    {
        let captured = seen.lock().unwrap();
        assert_eq!(captured.len(), 3, "no hidden retries or failover");
        for (headers, body) in captured.iter() {
            assert_eq!(body["model"], "upstream-test-model");
            let auth = headers
                .get("authorization")
                .or_else(|| headers.get("x-api-key"))
                .unwrap()
                .to_str()
                .unwrap();
            assert!(auth.contains("synthetic-upstream-key") && !auth.contains(&token));
            assert!(
                headers
                    .values()
                    .all(|v| !v.to_str().unwrap_or_default().contains(&token)),
                "scoped token must not leak to upstream headers"
            );
        }
        assert_eq!(captured[1].1["messages"].as_array().unwrap().len(), 3);
    }
    let mut cancel = body.clone();
    cancel["messages"][0]["content"] = "cancel".into();
    cancel["stream"] = true.into();
    let mut response = client
        .post(&gateway)
        .bearer_auth(&token)
        .json(&cancel)
        .send()
        .await
        .unwrap();
    assert!(response.chunk().await.unwrap().is_some());
    drop(response);
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while !CANCELLED.load(Ordering::SeqCst) {
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("cancellation must reach the upstream stream");
    assert_eq!(
        db.get_current_provider("claude-desktop").unwrap(),
        Some(second.id)
    );
    service.release_local().await;
    assert!(service.is_running().await, "shared gateway is left running");
    assert!(!client
        .post(&gateway)
        .bearer_auth(&token)
        .json(&body)
        .send()
        .await
        .unwrap()
        .status()
        .is_success());
    service.stop().await.unwrap();
    mock_task.abort();

}
