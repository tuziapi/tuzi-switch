use super::*;
use axum::{
    body::Bytes,
    http::{HeaderMap, Uri},
    response::{IntoResponse, Response},
    Router,
};
use std::sync::Arc;

async fn server() -> (String, tokio::task::JoinHandle<()>) {
    async fn endpoint(uri: Uri, headers: HeaderMap, bytes: Bytes) -> Response {
        assert_eq!(headers["authorization"], "Bearer sk-synthetic-manual");
        assert!(!headers.contains_key("new-api-user"));
        match uri.path() {
            "/redirect" => (axum::http::StatusCode::FOUND, [("location", "/must-not-follow")]).into_response(),
            "/error" => (axum::http::StatusCode::UNAUTHORIZED, "sk-synthetic-manual").into_response(),
            "/wait" => {
                std::future::pending::<()>().await;
                unreachable!()
            }
            "/must-not-follow" => panic!("redirect was followed"),
            _ => (
                [
                    ("content-type", "application/octet-stream"),
                    ("x-request-id", "synthetic-request"),
                ],
                bytes,
            )
                .into_response(),
        }
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, Router::new().fallback(endpoint))
            .await
            .unwrap()
    });
    (url, task)
}
fn request(url: &str) -> ManualRequest {
    ManualRequest {
        request_id: uuid::Uuid::new_v4().to_string(),
        url: url.into(),
        method: "POST".into(),
        headers: BTreeMap::from([("authorization".into(), "Bearer sk-synthetic-manual".into())]),
        body: Some(STANDARD.encode([0, 1, 255, 128])),
    }
}

#[tokio::test]
async fn native_binary_request_stream_and_error_redaction() {
    let (url, server) = server().await;
    for (path, status) in [("/echo", 200), ("/error", 401)] {
        let chunks = Mutex::new(Vec::new());
        execute(request(&format!("{url}{path}")), |c| {
            chunks.lock().unwrap().push(c);
            Ok(())
        })
        .await
        .unwrap();
        let chunks = chunks.lock().unwrap();
        assert!(matches!(chunks.first(), Some(CreativeChunk::Ready)));
        assert!(chunks
            .iter()
            .any(|c| matches!(c, CreativeChunk::Start {status: s, ..} if *s == status)));
        assert!(matches!(chunks.last(), Some(CreativeChunk::End)));
        let bytes: Vec<_> = chunks
            .iter()
            .flat_map(|c| match c {
                CreativeChunk::Data { data } => STANDARD.decode(data).unwrap(),
                _ => vec![],
            })
            .collect();
        if status == 200 {
            assert_eq!(bytes, [0, 1, 255, 128]);
        } else {
            assert!(!String::from_utf8(bytes).unwrap().contains("sk-synthetic"));
        }
    }
    server.abort();
}

#[tokio::test]
async fn native_redirect_is_never_followed_and_cancel_releases_pending_request() {
    let (url, server) = server().await;
    assert_eq!(
        execute(request(&format!("{url}/redirect")), |_| Ok(()))
            .await
            .unwrap_err(),
        "creative_redirect_rejected"
    );
    let req = request(&format!("{url}/wait"));
    let id = req.request_id.clone();
    let ready = Arc::new(tokio::sync::Notify::new());
    let notify = ready.clone();
    let task = tokio::spawn(async move {
        execute(req, |c| {
            if matches!(c, CreativeChunk::Ready) {
                notify.notify_one();
            }
            Ok(())
        })
        .await
    });
    ready.notified().await;
    creative_manual_cancel(id.clone());
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err(),
        "creative_cancelled_outcome_unknown"
    );
    assert!(!PENDING.lock().unwrap().contains_key(&id));
    server.abort();
}

#[test]
fn rejects_local_files_credentials_references_and_header_injection() {
    let client = reqwest::Client::new();
    for url in [
        "file:///etc/passwd",
        "https://user:pass@example.invalid/",
        "https://example.invalid/?key=tuzi-account%3Asecret",
        "https://example.invalid/#fragment",
    ] {
        assert!(prepare(&request(url), &client).is_err());
    }
    for (name, value) in [
        ("authorization", "Bearer tuzi-account:ref"),
        ("host", "other.invalid"),
        ("x-api-key", "secret\r\nInjected: yes"),
    ] {
        let mut req = request("http://127.0.0.1/v1/models");
        req.headers.insert(name.into(), value.into());
        assert!(prepare(&req, &client).is_err());
    }
}


#[test]
fn ordered_failure_delivery_preserves_native_error_contract() {
    let seen = Mutex::new(Vec::new());
    deliver_creative_result(Err("creative_stream_interrupted".into()), |chunk| {
        seen.lock().unwrap().push(chunk);
        Ok(())
    }).unwrap();
    assert!(matches!(seen.lock().unwrap().first(), Some(CreativeChunk::Error {code}) if code == "creative_stream_interrupted"));
    assert_eq!(deliver_creative_result(Err("creative_outcome_unknown".into()), |_| Err("consumer_closed".into())), Err("consumer_closed".into()));
}

#[tokio::test]
async fn connection_failure_is_distinct_from_unknown_response() {
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url=format!("http://{}",listener.local_addr().unwrap());
    drop(listener);
    assert_eq!(execute(request(&url), |_| Ok(())).await.unwrap_err(), "creative_connection_failed");
}
