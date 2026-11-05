//! Manual creative providers use native HTTP without WebView CORS. This module
//! has no access to the account store and never follows credentialed redirects.
use crate::tuzi_account::creative::CreativeChunk;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures::StreamExt;
use serde::Deserialize;
use std::{
    collections::BTreeMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};

const MAX_BYTES: usize = 64 * 1024 * 1024;
static PENDING: LazyLock<Mutex<BTreeMap<String, tokio::sync::watch::Sender<bool>>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManualRequest {
    request_id: String,
    url: String,
    method: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
}

fn prepare(
    request: &ManualRequest,
    client: &reqwest::Client,
) -> Result<reqwest::RequestBuilder, String> {
    if uuid::Uuid::parse_str(&request.request_id).is_err() {
        return Err("invalid_request_id".into());
    }
    let url = reqwest::Url::parse(&request.url).map_err(|_| "invalid_url")?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.as_str().contains("tuzi-account:")
        || url.query_pairs().any(|(_, v)| v.contains("tuzi-account:"))
    {
        return Err("invalid_url".into());
    }
    if !matches!(
        request.method.as_str(),
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD"
    ) {
        return Err("invalid_method".into());
    }
    if request.headers.len() > 64 {
        return Err("invalid_headers".into());
    }
    let mut builder = client.request(
        reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| "invalid_method")?,
        url,
    );
    for (name, value) in &request.headers {
        let lower = name.to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "host"
                | "cookie"
                | "cookie2"
                | "origin"
                | "referer"
                | "content-length"
                | "connection"
                | "transfer-encoding"
                | "upgrade"
                | "trailer"
        ) || lower.starts_with("sec-")
            || lower.starts_with("proxy-")
            || value.contains("tuzi-account:")
            || value.len() > 16384
        {
            return Err("invalid_headers".into());
        }
        let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "invalid_headers")?;
        let value = reqwest::header::HeaderValue::from_str(value).map_err(|_| "invalid_headers")?;
        builder = builder.header(name, value);
    }
    if let Some(encoded) = &request.body {
        if matches!(request.method.as_str(), "GET" | "HEAD") {
            return Err("invalid_body".into());
        }
        if encoded.len() > (MAX_BYTES + 2) / 3 * 4 {
            return Err("body_too_large".into());
        }
        let bytes = STANDARD.decode(encoded).map_err(|_| "invalid_body")?;
        if bytes.len() > MAX_BYTES {
            return Err("body_too_large".into());
        }
        builder = builder.body(bytes);
    }
    Ok(builder)
}

async fn execute(
    request: ManualRequest,
    send: impl Fn(CreativeChunk) -> Result<(), String>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|_| "http_unavailable")?;
    let builder = prepare(&request, &client)?;
    let (cancel, mut cancelled) = tokio::sync::watch::channel(false);
    {
        let mut pending = PENDING.lock().unwrap();
        if pending.len() >= 128 || pending.contains_key(&request.request_id) {
            return Err("duplicate_request".into());
        }
        pending.insert(request.request_id.clone(), cancel);
    }
    let operation = async {
        send(CreativeChunk::Ready)?;
        let response = builder
            .send()
            .await
            .map_err(|_| "creative_outcome_unknown")?;
        if response.status().is_redirection() {
            return Err("creative_redirect_rejected".into());
        }
        let status = response.status();
        // Error pages can echo provider keys; expose only the HTTP status.
        if !status.is_success() {
            send(CreativeChunk::Start {
                status: status.as_u16(),
                content_type: "application/json".into(),
                headers: BTreeMap::new(),
            })?;
            send(CreativeChunk::Data { data: STANDARD.encode(serde_json::json!({"error":{"message":format!("模型服务请求失败（HTTP {}）",status.as_u16())}}).to_string()) })?;
        } else {
            if response
                .content_length()
                .is_some_and(|n| n > MAX_BYTES as u64)
            {
                return Err("response_too_large".into());
            }
            let content_type = response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_owned();
            let headers = ["x-request-id", "x-oneapi-request-id", "retry-after"]
                .iter()
                .filter_map(|name| {
                    response
                        .headers()
                        .get(*name)
                        .and_then(|v| v.to_str().ok())
                        .map(|v| (name.to_string(), v.to_string()))
                })
                .collect();
            send(CreativeChunk::Start {
                status: status.as_u16(),
                content_type,
                headers,
            })?;
            let mut stream = response.bytes_stream();
            let mut total = 0usize;
            while let Some(chunk) = stream.next().await {
                let bytes = chunk.map_err(|_| "creative_outcome_unknown")?;
                total += bytes.len();
                if total > MAX_BYTES {
                    return Err("response_too_large".into());
                }
                send(CreativeChunk::Data {
                    data: STANDARD.encode(bytes),
                })?;
            }
        }
        send(CreativeChunk::End)
    };
    let result = tokio::select! {
        biased;
        _ = cancelled.changed() => Err("creative_cancelled_outcome_unknown".into()),
        result = operation => result,
    };
    PENDING.lock().unwrap().remove(&request.request_id);
    result
}

#[tauri::command]
pub async fn creative_manual_request(
    request: ManualRequest,
    on_chunk: tauri::ipc::Channel<CreativeChunk>,
) -> Result<(), String> {
    execute(request, |chunk| {
        on_chunk.send(chunk).map_err(|_| "consumer_closed".into())
    })
    .await
}

#[tauri::command]
pub fn creative_manual_cancel(request_id: String) {
    if let Some(cancel) = PENDING.lock().unwrap().get(&request_id) {
        let _ = cancel.send(true);
    }
}

#[cfg(test)]
mod tests;

/// The frontend saves boards first; refuse installation while native requests remain.
#[tauri::command]
pub fn check_update_ready(
    service: tauri::State<'_, std::sync::Arc<crate::tuzi_account::AccountService>>,
) -> Result<(), String> {
    if !PENDING.lock().unwrap().is_empty() || service.has_pending_requests() {
        return Err("仍有请求正在处理，请稍后重试更新。".into());
    }
    Ok(())
}
