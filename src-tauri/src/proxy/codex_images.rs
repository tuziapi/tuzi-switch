//! Dedicated upstream for Codex's built-in Images API client.
//!
//! Image traffic bypasses text-provider mapping, request overrides, media
//! rewriting, usage parsing, and body logging. Large edit bodies are spooled to
//! disk so concurrent requests remain memory-bounded.

use super::{
    content_encoding::{decompress_body_limited, get_content_encoding},
    forwarder::ActiveConnectionGuard,
    response_processor::strip_hop_by_hop_response_headers,
    server::ProxyState,
    ProxyError,
};
use axum::body::Body;
use bytes::Bytes;
use futures::{stream, StreamExt};
use http::{header, Extensions, HeaderMap, HeaderValue, StatusCode, Uri};
use serde_json::Value;
use std::{
    collections::hash_map::DefaultHasher,
    env,
    hash::{Hash, Hasher},
    net::{IpAddr, SocketAddr},
    sync::{Arc, OnceLock, RwLock as StdRwLock},
    time::Duration,
};
use tempfile::NamedTempFile;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{OwnedSemaphorePermit, RwLock, Semaphore};

pub(crate) const IMAGE_UPSTREAM_BASE_URL: &str = "https://api.tu-zi.com/coding";
pub(crate) const IMAGE_MODEL: &str = "gpt-image-2";
const IMAGE_ACTOR_HEADER: &str = "x-openai-actor-authorization";
const IMAGE_ACTOR_HEADER_VALUE: &str = "http://coding.tu-zi.com";
pub(crate) const IMAGE_AUTH_HEADER: &str = "x-tuzi-image-token";
const MAX_IMAGE_JSON_BYTES: usize = 4 * 1024 * 1024;
const MAX_IMAGE_EDIT_BYTES: u64 = 64 * 1024 * 1024;
const FILE_STREAM_CHUNK_BYTES: usize = 64 * 1024;
const MAX_MODEL_FIELD_BYTES: usize = 128;
const MAX_MULTIPART_TEXT_FIELD_BYTES: u64 = 1024 * 1024;
const MAX_MULTIPART_BOUNDARY_BYTES: usize = 70;
const MAX_MULTIPART_PREAMBLE_BYTES: usize = 8 * 1024;
const MAX_MULTIPART_HEADER_BYTES: usize = 16 * 1024;
const MAX_MULTIPART_PADDING_BYTES: usize = 128;
const MAX_IMAGE_EDIT_FIELDS: usize = 64;
const MAX_CONCURRENT_IMAGE_REQUESTS: usize = 4;
const IMAGE_JSON_TOTAL_TIMEOUT: Duration = Duration::from_secs(30);
const IMAGE_JSON_IDLE_TIMEOUT: Duration = Duration::from_secs(10);
const IMAGE_EDIT_TOTAL_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const IMAGE_EDIT_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const IMAGE_BUSY_RETRY_AFTER_SECONDS: &str = "1";
static IMAGE_REQUEST_LIMIT: OnceLock<Arc<Semaphore>> = OnceLock::new();
static IMAGE_HTTP_CLIENT: OnceLock<StdRwLock<Option<(ImageClientKey, reqwest::Client)>>> =
    OnceLock::new();

#[derive(Clone, Eq, PartialEq)]
struct ImageClientKey {
    proxy_url: Option<String>,
    system_proxy_fingerprint: u64,
    bypass_system_proxy: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ImageEndpoint {
    Generations,
    Edits,
}

impl ImageEndpoint {
    fn from_uri(uri: &Uri) -> Self {
        if uri.path().ends_with("/images/edits") {
            Self::Edits
        } else {
            Self::Generations
        }
    }

    fn path(self) -> &'static str {
        match self {
            Self::Generations => "/images/generations",
            Self::Edits => "/images/edits",
        }
    }
}

enum PreparedBody {
    Bytes {
        body: Bytes,
        content_type: HeaderValue,
    },
    File {
        file: NamedTempFile,
        content_type: HeaderValue,
        len: u64,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MultipartGuardStage {
    Preamble,
    BoundarySuffix,
    Headers,
    Body,
    Done,
}

struct MultipartHeaderGuard {
    first_boundary: Vec<u8>,
    body_boundary: Vec<u8>,
    buffer: Vec<u8>,
    stage: MultipartGuardStage,
    field_count: usize,
    candidate_from_body: bool,
}

impl MultipartHeaderGuard {
    fn new(boundary: &str) -> Self {
        Self {
            first_boundary: format!("--{boundary}").into_bytes(),
            body_boundary: format!("\r\n--{boundary}").into_bytes(),
            buffer: Vec::with_capacity(FILE_STREAM_CHUNK_BYTES + MAX_MULTIPART_HEADER_BYTES),
            stage: MultipartGuardStage::Preamble,
            field_count: 0,
            candidate_from_body: false,
        }
    }

    fn push(&mut self, bytes: &[u8]) -> std::io::Result<()> {
        if self.stage == MultipartGuardStage::Done {
            return Ok(());
        }
        self.buffer.extend_from_slice(bytes);
        self.process(false)
    }

    fn finish(&mut self) -> std::io::Result<()> {
        self.process(true)?;
        if self.stage == MultipartGuardStage::Done {
            Ok(())
        } else {
            Err(multipart_guard_error(
                "Image edit multipart body ended before the closing boundary",
            ))
        }
    }

    fn process(&mut self, eof: bool) -> std::io::Result<()> {
        loop {
            match self.stage {
                MultipartGuardStage::Preamble => {
                    if let Some(index) = find_subslice(&self.buffer, &self.first_boundary) {
                        if index > MAX_MULTIPART_PREAMBLE_BYTES {
                            return Err(multipart_guard_error(
                                "Image edit multipart preamble is too large",
                            ));
                        }
                        self.buffer.drain(..index + self.first_boundary.len());
                        self.candidate_from_body = false;
                        self.stage = MultipartGuardStage::BoundarySuffix;
                    } else {
                        if self.buffer.len()
                            > MAX_MULTIPART_PREAMBLE_BYTES + self.first_boundary.len()
                        {
                            return Err(multipart_guard_error(
                                "Image edit multipart preamble is too large",
                            ));
                        }
                        return if eof {
                            Err(multipart_guard_error(
                                "Image edit multipart opening boundary is missing",
                            ))
                        } else {
                            Ok(())
                        };
                    }
                }
                MultipartGuardStage::BoundarySuffix => {
                    if self.buffer.starts_with(b"--") {
                        self.buffer.clear();
                        self.stage = MultipartGuardStage::Done;
                        return Ok(());
                    }

                    let padding = self
                        .buffer
                        .iter()
                        .take_while(|byte| matches!(byte, b' ' | b'\t'))
                        .count();
                    if padding > MAX_MULTIPART_PADDING_BYTES {
                        if self.candidate_from_body {
                            self.stage = MultipartGuardStage::Body;
                            continue;
                        }
                        return Err(multipart_guard_error(
                            "Image edit multipart boundary padding is too large",
                        ));
                    }
                    if self.buffer.len() < padding + 2 {
                        return if eof {
                            Err(multipart_guard_error(
                                "Image edit multipart boundary suffix is incomplete",
                            ))
                        } else {
                            Ok(())
                        };
                    }
                    if &self.buffer[padding..padding + 2] != b"\r\n" {
                        if self.candidate_from_body {
                            self.stage = MultipartGuardStage::Body;
                            continue;
                        }
                        return Err(multipart_guard_error(
                            "Image edit multipart boundary suffix is invalid",
                        ));
                    }
                    self.buffer.drain(..padding + 2);
                    self.field_count = self.field_count.saturating_add(1);
                    if self.field_count > MAX_IMAGE_EDIT_FIELDS {
                        return Err(multipart_guard_error(
                            "Image edit contains too many multipart fields",
                        ));
                    }
                    self.candidate_from_body = false;
                    self.stage = MultipartGuardStage::Headers;
                }
                MultipartGuardStage::Headers => {
                    if let Some(index) = find_subslice(&self.buffer, b"\r\n\r\n") {
                        if index + 4 > MAX_MULTIPART_HEADER_BYTES {
                            return Err(multipart_guard_error(
                                "Image edit multipart field headers are too large",
                            ));
                        }
                        self.buffer.drain(..index + 4);
                        self.stage = MultipartGuardStage::Body;
                    } else {
                        if self.buffer.len() > MAX_MULTIPART_HEADER_BYTES {
                            return Err(multipart_guard_error(
                                "Image edit multipart field headers are too large",
                            ));
                        }
                        return if eof {
                            Err(multipart_guard_error(
                                "Image edit multipart field headers are incomplete",
                            ))
                        } else {
                            Ok(())
                        };
                    }
                }
                MultipartGuardStage::Body => {
                    if let Some(index) = find_subslice(&self.buffer, &self.body_boundary) {
                        self.buffer.drain(..index + self.body_boundary.len());
                        self.candidate_from_body = true;
                        self.stage = MultipartGuardStage::BoundarySuffix;
                    } else {
                        let retained = self.body_boundary.len().saturating_sub(1);
                        if self.buffer.len() > retained {
                            self.buffer.drain(..self.buffer.len() - retained);
                        }
                        return if eof {
                            Err(multipart_guard_error(
                                "Image edit multipart closing boundary is missing",
                            ))
                        } else {
                            Ok(())
                        };
                    }
                }
                MultipartGuardStage::Done => {
                    self.buffer.clear();
                    return Ok(());
                }
            }
        }
    }
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn multipart_guard_error(message: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, message)
}

impl PreparedBody {
    fn content_type(&self) -> HeaderValue {
        match self {
            Self::Bytes { content_type, .. } | Self::File { content_type, .. } => {
                content_type.clone()
            }
        }
    }

    fn content_len(&self) -> u64 {
        match self {
            Self::Bytes { body, .. } => body.len() as u64,
            Self::File { len, .. } => *len,
        }
    }

    async fn reqwest_body(&self) -> Result<reqwest::Body, ProxyError> {
        match self {
            Self::Bytes { body, .. } => Ok(reqwest::Body::from(body.clone())),
            Self::File { file, .. } => {
                let file = file.reopen().map_err(|error| {
                    ProxyError::Internal(format!("Failed to reopen image edit spool: {error}"))
                })?;
                let file = tokio::fs::File::from_std(file);
                let chunks = stream::try_unfold(file, |mut file| async move {
                    let mut buffer = vec![0_u8; FILE_STREAM_CHUNK_BYTES];
                    let read = file.read(&mut buffer).await?;
                    if read == 0 {
                        Ok::<_, std::io::Error>(None)
                    } else {
                        buffer.truncate(read);
                        Ok::<_, std::io::Error>(Some((Bytes::from(buffer), file)))
                    }
                });
                Ok(reqwest::Body::wrap_stream(chunks))
            }
        }
    }
}

pub(crate) async fn handle(
    state: &ProxyState,
    request: axum::extract::Request,
) -> Result<axum::response::Response, ProxyError> {
    let (parts, body) = request.into_parts();
    require_local_codex_client(
        &parts.headers,
        &parts.extensions,
        state.image_auth_token.as_ref(),
    )?;
    let concurrency_permit = match acquire_image_request_slot() {
        Ok(permit) => permit,
        Err(_) => return Ok(image_busy_response()),
    };

    let endpoint = ImageEndpoint::from_uri(&parts.uri);
    let upstream_url = image_upstream_url(endpoint, &parts.uri)?;
    let local_proxy_port = state.status.read().await.port;
    let client = image_http_client(local_proxy_port)?;
    let api_key = resolve_image_api_key()?;
    let prepared = prepare_body(endpoint, &parts.headers, body).await?;
    let headers = upstream_headers(&parts.headers, &api_key, prepared.content_type())?;
    let app_config = state
        .db
        .get_proxy_config_for_app("codex")
        .await
        .map_err(|error| ProxyError::DatabaseError(error.to_string()))?;
    let timeout = Duration::from_secs(u64::from(app_config.non_streaming_timeout.max(1)));

    {
        let mut status = state.status.write().await;
        status.total_requests = status.total_requests.saturating_add(1);
        status.last_request_at = Some(chrono::Utc::now().to_rfc3339());
    }
    let connection_guard = ActiveConnectionGuard::acquire(state.status.clone()).await;
    let response = match send_once(
        &client,
        &upstream_url,
        parts.method,
        headers,
        &prepared,
        timeout,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => {
            record_terminal_error(state, &error).await;
            return Err(error);
        }
    };

    passthrough_response(
        response,
        connection_guard,
        concurrency_permit,
        state.status.clone(),
    )
}

fn require_local_codex_client(
    headers: &HeaderMap,
    extensions: &Extensions,
    expected_image_token: &str,
) -> Result<(), ProxyError> {
    match extensions.get::<SocketAddr>() {
        Some(address) if address.ip().is_loopback() => {}
        Some(_) => Err(ProxyError::AuthError(
            "Codex Images API only accepts local requests".to_string(),
        ))?,
        None => Err(ProxyError::AuthError(
            "Codex Images API cannot verify the local client".to_string(),
        ))?,
    }

    if headers.contains_key(header::ORIGIN)
        || headers
            .keys()
            .any(|name| name.as_str().starts_with("sec-fetch-"))
    {
        return Err(ProxyError::AuthError(
            "Browser-originated Codex Images API requests are not allowed".to_string(),
        ));
    }

    let authorized = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            let mut parts = value.split_ascii_whitespace();
            let scheme = parts.next()?;
            let token = parts.next()?;
            (parts.next().is_none()
                && scheme.eq_ignore_ascii_case("bearer")
                && token == super::forwarder::PROXY_AUTH_PLACEHOLDER)
                .then_some(())
        })
        .is_some();
    if !authorized {
        return Err(ProxyError::AuthError(
            "Codex Images API requires the managed local proxy credential".to_string(),
        ));
    }
    let supplied_image_token = headers
        .get(IMAGE_AUTH_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !constant_time_eq(
        supplied_image_token.as_bytes(),
        expected_image_token.as_bytes(),
    ) {
        return Err(ProxyError::AuthError(
            "Codex Images API requires the current image route credential".to_string(),
        ));
    }
    Ok(())
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let mut difference = left.len() ^ right.len();
    for index in 0..left.len().max(right.len()) {
        difference |= usize::from(
            left.get(index).copied().unwrap_or_default()
                ^ right.get(index).copied().unwrap_or_default(),
        );
    }
    difference == 0
}

fn image_request_limit() -> &'static Arc<Semaphore> {
    IMAGE_REQUEST_LIMIT.get_or_init(|| Arc::new(Semaphore::new(MAX_CONCURRENT_IMAGE_REQUESTS)))
}

fn acquire_image_request_slot() -> Result<OwnedSemaphorePermit, ProxyError> {
    Arc::clone(image_request_limit())
        .try_acquire_owned()
        .map_err(|_| {
            ProxyError::ForwardFailed(
                "Codex Images API is busy; retry after an in-flight image request completes"
                    .to_string(),
            )
        })
}

fn image_busy_response() -> axum::response::Response {
    let mut response = axum::response::Response::new(Body::from(
        r#"{"error":{"message":"Codex Images API is busy; retry shortly","type":"rate_limit_error"}}"#,
    ));
    *response.status_mut() = StatusCode::TOO_MANY_REQUESTS;
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    response.headers_mut().insert(
        header::RETRY_AFTER,
        HeaderValue::from_static(IMAGE_BUSY_RETRY_AFTER_SECONDS),
    );
    response
}

fn image_upstream_url(endpoint: ImageEndpoint, request_uri: &Uri) -> Result<String, ProxyError> {
    let mut url = url::Url::parse(IMAGE_UPSTREAM_BASE_URL)
        .map_err(|error| ProxyError::ConfigError(format!("Invalid image upstream URL: {error}")))?;
    let base_path = url.path().trim_end_matches('/');
    url.set_path(&format!("{base_path}{}", endpoint.path()));
    url.set_query(request_uri.query());
    Ok(url.into())
}

fn resolve_image_api_key() -> Result<String, ProxyError> {
    crate::services::codex_image_config::read_managed_image_api_key()
        .map_err(|error| ProxyError::AuthError(error.to_string()))?
        .ok_or_else(|| {
            ProxyError::AuthError(format!(
                "Missing private image credential {}; reapply the Tuzi Codex provider",
                crate::services::codex_image_config::IMAGE_API_KEY_ENV
            ))
        })
}

async fn prepare_body(
    endpoint: ImageEndpoint,
    headers: &HeaderMap,
    body: Body,
) -> Result<PreparedBody, ProxyError> {
    match endpoint {
        ImageEndpoint::Generations => prepare_json_body(headers, body).await,
        ImageEndpoint::Edits => prepare_edit_body(headers, body).await,
    }
}

async fn prepare_json_body(headers: &HeaderMap, body: Body) -> Result<PreparedBody, ProxyError> {
    tokio::time::timeout(
        IMAGE_JSON_TOTAL_TIMEOUT,
        prepare_json_body_with_idle_timeout(headers, body, IMAGE_JSON_IDLE_TIMEOUT),
    )
    .await
    .map_err(|_| {
        ProxyError::Timeout(format!(
            "Image generation upload exceeded {} seconds",
            IMAGE_JSON_TOTAL_TIMEOUT.as_secs()
        ))
    })?
}

async fn prepare_json_body_with_idle_timeout(
    headers: &HeaderMap,
    body: Body,
    idle_timeout: Duration,
) -> Result<PreparedBody, ProxyError> {
    require_media_type(headers, "application/json", "Image generation")?;
    require_content_length_within_limit(headers, MAX_IMAGE_JSON_BYTES as u64, "Image generation")?;
    let mut stream = body.into_data_stream();
    let mut body = Vec::new();
    loop {
        let next = tokio::time::timeout(idle_timeout, stream.next())
            .await
            .map_err(|_| {
                ProxyError::Timeout(format!(
                    "Image generation upload was idle for {} seconds",
                    idle_timeout.as_secs_f64()
                ))
            })?;
        let Some(chunk) = next else {
            break;
        };
        let chunk = chunk.map_err(|error| {
            ProxyError::InvalidRequest(format!("Failed to read image generation request: {error}"))
        })?;
        if body.len().saturating_add(chunk.len()) > MAX_IMAGE_JSON_BYTES {
            return Err(ProxyError::InvalidRequest(format!(
                "Image request exceeds {} bytes",
                MAX_IMAGE_JSON_BYTES
            )));
        }
        body.extend_from_slice(&chunk);
    }
    let body = match get_content_encoding(headers) {
        Some(encoding) => decompress_body_limited(&encoding, &body, MAX_IMAGE_JSON_BYTES)
            .map_err(|error| {
                ProxyError::InvalidRequest(format!(
                    "Failed to decompress image generation request ({encoding}): {error}"
                ))
            })?
            .ok_or_else(|| {
                ProxyError::InvalidRequest(format!(
                    "Unsupported image generation content-encoding: {encoding}"
                ))
            })?,
        None => body.to_vec(),
    };
    let value: Value = serde_json::from_slice(&body).map_err(|error| {
        ProxyError::InvalidRequest(format!("Invalid image generation JSON: {error}"))
    })?;
    let model = value.get("model").and_then(Value::as_str);
    if model != Some(IMAGE_MODEL) {
        return Err(ProxyError::InvalidRequest(format!(
            "Codex image generation requires model {IMAGE_MODEL}"
        )));
    }

    Ok(PreparedBody::Bytes {
        body: Bytes::from(body),
        content_type: HeaderValue::from_static("application/json"),
    })
}

async fn prepare_edit_body(headers: &HeaderMap, body: Body) -> Result<PreparedBody, ProxyError> {
    tokio::time::timeout(
        IMAGE_EDIT_TOTAL_TIMEOUT,
        prepare_edit_body_with_idle_timeout(headers, body, IMAGE_EDIT_IDLE_TIMEOUT),
    )
    .await
    .map_err(|_| {
        ProxyError::Timeout(format!(
            "Image edit upload exceeded {} seconds",
            IMAGE_EDIT_TOTAL_TIMEOUT.as_secs()
        ))
    })?
}

async fn prepare_edit_body_with_idle_timeout(
    headers: &HeaderMap,
    body: Body,
    idle_timeout: Duration,
) -> Result<PreparedBody, ProxyError> {
    if let Some(encoding) = get_content_encoding(headers) {
        return Err(ProxyError::InvalidRequest(format!(
            "Compressed image edit requests are not supported (content-encoding: {encoding})"
        )));
    }

    let content_type = require_media_type(headers, "multipart/form-data", "Image edit")?;
    require_content_length_within_limit(headers, MAX_IMAGE_EDIT_BYTES, "Image edit")?;
    let content_type_text = content_type.to_str().map_err(|_| {
        ProxyError::InvalidRequest("Image edit has an invalid Content-Type".to_string())
    })?;

    let spool = tempfile::Builder::new()
        .prefix("tuzi-codex-image-edit-")
        .tempfile()
        .map_err(|error| {
            ProxyError::Internal(format!("Failed to create image edit spool: {error}"))
        })?;
    let writer = spool.reopen().map_err(|error| {
        ProxyError::Internal(format!("Failed to open image edit spool: {error}"))
    })?;
    let mut writer = tokio::fs::File::from_std(writer);
    let mut stream = body.into_data_stream();
    let mut written = 0_u64;
    loop {
        let next = tokio::time::timeout(idle_timeout, stream.next())
            .await
            .map_err(|_| {
                ProxyError::Timeout(format!(
                    "Image edit upload was idle for {} seconds",
                    idle_timeout.as_secs_f64()
                ))
            })?;
        let Some(chunk) = next else {
            break;
        };
        let chunk = chunk.map_err(|error| {
            ProxyError::InvalidRequest(format!("Failed to read image edit request: {error}"))
        })?;
        written = written.saturating_add(chunk.len() as u64);
        if written > MAX_IMAGE_EDIT_BYTES {
            return Err(ProxyError::InvalidRequest(
                "Image edit request exceeds 64 MiB".to_string(),
            ));
        }
        writer.write_all(&chunk).await.map_err(|error| {
            ProxyError::Internal(format!("Failed to spool image edit request: {error}"))
        })?;
    }
    writer.flush().await.map_err(|error| {
        ProxyError::Internal(format!("Failed to flush image edit spool: {error}"))
    })?;
    drop(writer);

    validate_edit_model(&spool, content_type_text).await?;

    Ok(PreparedBody::File {
        file: spool,
        content_type,
        len: written,
    })
}

fn require_content_length_within_limit(
    headers: &HeaderMap,
    limit: u64,
    request_name: &str,
) -> Result<(), ProxyError> {
    let Some(value) = headers.get(header::CONTENT_LENGTH) else {
        return Ok(());
    };
    let value = value.to_str().map_err(|_| {
        ProxyError::InvalidRequest(format!("{request_name} has an invalid Content-Length"))
    })?;
    let length = value.parse::<u64>().map_err(|_| {
        ProxyError::InvalidRequest(format!("{request_name} has an invalid Content-Length"))
    })?;
    if length > limit {
        return Err(ProxyError::InvalidRequest(format!(
            "{request_name} request exceeds {limit} bytes"
        )));
    }
    Ok(())
}

fn require_media_type(
    headers: &HeaderMap,
    expected: &str,
    request_name: &str,
) -> Result<HeaderValue, ProxyError> {
    let content_type = headers.get(header::CONTENT_TYPE).ok_or_else(|| {
        ProxyError::InvalidRequest(format!("{request_name} is missing Content-Type"))
    })?;
    let content_type_text = content_type.to_str().map_err(|_| {
        ProxyError::InvalidRequest(format!("{request_name} has an invalid Content-Type"))
    })?;
    if !content_type_text
        .split(';')
        .next()
        .is_some_and(|value| value.trim().eq_ignore_ascii_case(expected))
    {
        return Err(ProxyError::InvalidRequest(format!(
            "{request_name} must use {expected}"
        )));
    }
    Ok(content_type.clone())
}

async fn validate_edit_model(spool: &NamedTempFile, content_type: &str) -> Result<(), ProxyError> {
    let boundary = multer::parse_boundary(content_type).map_err(|error| {
        ProxyError::InvalidRequest(format!(
            "Image edit has an invalid multipart boundary: {error}"
        ))
    })?;
    if boundary.is_empty() {
        return Err(ProxyError::InvalidRequest(
            "Image edit multipart boundary cannot be empty".to_string(),
        ));
    }
    if boundary.len() > MAX_MULTIPART_BOUNDARY_BYTES {
        return Err(ProxyError::InvalidRequest(format!(
            "Image edit multipart boundary exceeds {MAX_MULTIPART_BOUNDARY_BYTES} bytes"
        )));
    }
    let file = spool.reopen().map_err(|error| {
        ProxyError::Internal(format!("Failed to reopen image edit spool: {error}"))
    })?;
    let file = tokio::fs::File::from_std(file);
    let guard = MultipartHeaderGuard::new(&boundary);
    let stream = stream::try_unfold((file, guard), |(mut file, mut guard)| async move {
        let mut buffer = vec![0_u8; FILE_STREAM_CHUNK_BYTES];
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            guard.finish()?;
            Ok::<_, std::io::Error>(None)
        } else {
            buffer.truncate(read);
            guard.push(&buffer)?;
            Ok::<_, std::io::Error>(Some((Bytes::from(buffer), (file, guard))))
        }
    });
    let constraints = multer::Constraints::new().size_limit(
        multer::SizeLimit::new()
            .whole_stream(MAX_IMAGE_EDIT_BYTES)
            .per_field(MAX_MULTIPART_TEXT_FIELD_BYTES)
            .for_field("model", MAX_MODEL_FIELD_BYTES as u64)
            .for_field("image", MAX_IMAGE_EDIT_BYTES)
            .for_field("image[]", MAX_IMAGE_EDIT_BYTES)
            .for_field("mask", MAX_IMAGE_EDIT_BYTES),
    );
    let mut multipart = multer::Multipart::with_constraints(stream, boundary, constraints);
    let mut model = None;
    let mut field_count = 0_usize;
    while let Some(mut field) = multipart.next_field().await.map_err(|error| {
        ProxyError::InvalidRequest(format!("Invalid image edit multipart body: {error}"))
    })? {
        field_count = field_count.saturating_add(1);
        if field_count > MAX_IMAGE_EDIT_FIELDS {
            return Err(ProxyError::InvalidRequest(format!(
                "Image edit contains more than {MAX_IMAGE_EDIT_FIELDS} multipart fields"
            )));
        }
        let is_model = field.name() == Some("model");
        let mut model_bytes = Vec::with_capacity(MAX_MODEL_FIELD_BYTES);
        while let Some(chunk) = field.chunk().await.map_err(|error| {
            ProxyError::InvalidRequest(format!("Invalid image edit multipart field: {error}"))
        })? {
            if is_model {
                model_bytes.extend_from_slice(&chunk);
            }
        }
        if is_model {
            if model.is_some() {
                return Err(ProxyError::InvalidRequest(
                    "Image edit contains duplicate model fields".to_string(),
                ));
            }
            let value = std::str::from_utf8(&model_bytes).map_err(|_| {
                ProxyError::InvalidRequest("Image edit model is not valid UTF-8".to_string())
            })?;
            model = Some(value.to_string());
        }
    }
    if model.as_deref() != Some(IMAGE_MODEL) {
        return Err(ProxyError::InvalidRequest(format!(
            "Codex image edit requires model {IMAGE_MODEL}"
        )));
    }
    Ok(())
}

fn upstream_headers(
    incoming: &HeaderMap,
    api_key: &str,
    content_type: HeaderValue,
) -> Result<HeaderMap, ProxyError> {
    let mut headers = HeaderMap::new();
    for name in [header::ACCEPT, header::ACCEPT_ENCODING, header::USER_AGENT] {
        for value in incoming.get_all(&name) {
            headers.append(name.clone(), value.clone());
        }
    }

    let mut authorization = HeaderValue::from_str(&format!("Bearer {api_key}")).map_err(|_| {
        ProxyError::AuthError(format!(
            "{} is not a valid HTTP credential",
            crate::services::codex_image_config::IMAGE_API_KEY_ENV
        ))
    })?;
    authorization.set_sensitive(true);
    headers.insert(header::AUTHORIZATION, authorization);
    headers.insert(header::CONTENT_TYPE, content_type);
    headers.insert(
        IMAGE_ACTOR_HEADER,
        HeaderValue::from_static(IMAGE_ACTOR_HEADER_VALUE),
    );
    Ok(headers)
}

async fn send_once(
    client: &reqwest::Client,
    url: &str,
    method: http::Method,
    headers: HeaderMap,
    body: &PreparedBody,
    timeout: Duration,
) -> Result<reqwest::Response, ProxyError> {
    let request_body = body.reqwest_body().await?;
    client
        .request(method, url)
        .headers(headers)
        .header(header::CONTENT_LENGTH, body.content_len())
        .body(request_body)
        .timeout(timeout)
        .send()
        .await
        .map_err(|error| {
            ProxyError::ForwardFailed(format!("Image upstream {}", safe_reqwest_error(&error)))
        })
}

fn image_http_client(local_proxy_port: u16) -> Result<reqwest::Client, ProxyError> {
    let proxy_url = super::http_client::get_current_proxy_url();
    let (system_proxy_fingerprint, bypass_system_proxy) = if proxy_url.is_none() {
        system_proxy_state(local_proxy_port)
    } else {
        (0, false)
    };
    let key = ImageClientKey {
        proxy_url,
        system_proxy_fingerprint,
        bypass_system_proxy,
    };
    let cache = IMAGE_HTTP_CLIENT.get_or_init(|| StdRwLock::new(None));
    {
        let cached = cache.read().map_err(|_| {
            ProxyError::Internal("Image HTTP client cache is unavailable".to_string())
        })?;
        if let Some((cached_key, client)) = cached.as_ref() {
            if cached_key == &key {
                return Ok(client.clone());
            }
        }
    }

    let client = build_image_http_client(key.proxy_url.as_deref(), key.bypass_system_proxy)?;
    let mut cached = cache
        .write()
        .map_err(|_| ProxyError::Internal("Image HTTP client cache is unavailable".to_string()))?;
    if let Some((cached_key, cached_client)) = cached.as_ref() {
        if cached_key == &key {
            return Ok(cached_client.clone());
        }
    }
    *cached = Some((key, client.clone()));
    Ok(client)
}

fn build_image_http_client(
    proxy_url: Option<&str>,
    bypass_system_proxy: bool,
) -> Result<reqwest::Client, ProxyError> {
    let mut builder = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(MAX_CONCURRENT_IMAGE_REQUESTS)
        .tcp_keepalive(Duration::from_secs(60))
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd();
    if let Some(proxy_url) = proxy_url {
        let proxy = reqwest::Proxy::all(proxy_url)
            .map_err(|_| ProxyError::ConfigError("Invalid global proxy URL".to_string()))?;
        builder = builder.proxy(proxy);
    } else if bypass_system_proxy {
        builder = builder.no_proxy();
    }
    builder.build().map_err(|error| {
        ProxyError::Internal(format!("Failed to build image HTTP client: {error}"))
    })
}

fn system_proxy_state(local_proxy_port: u16) -> (u64, bool) {
    const PROXY_KEYS: [&str; 6] = [
        "HTTP_PROXY",
        "http_proxy",
        "HTTPS_PROXY",
        "https_proxy",
        "ALL_PROXY",
        "all_proxy",
    ];
    const BYPASS_KEYS: [&str; 2] = ["NO_PROXY", "no_proxy"];
    let mut fingerprint = DefaultHasher::new();
    let mut points_to_local_proxy = false;
    for key in PROXY_KEYS {
        key.hash(&mut fingerprint);
        match env::var(key) {
            Ok(value) => {
                value.hash(&mut fingerprint);
                points_to_local_proxy |= proxy_points_to_local_port(value.trim(), local_proxy_port);
            }
            Err(_) => 0_u8.hash(&mut fingerprint),
        }
    }
    for key in BYPASS_KEYS {
        key.hash(&mut fingerprint);
        env::var(key).ok().hash(&mut fingerprint);
    }
    (fingerprint.finish(), points_to_local_proxy)
}

fn proxy_points_to_local_port(value: &str, local_proxy_port: u16) -> bool {
    if value.is_empty() || local_proxy_port == 0 {
        return false;
    }
    let parsed = if value.contains("://") {
        url::Url::parse(value).ok()
    } else {
        url::Url::parse(&format!("http://{value}")).ok()
    };
    parsed.is_some_and(|url| {
        let is_loopback = url.host_str().is_some_and(|host| {
            host.eq_ignore_ascii_case("localhost")
                || host
                    .parse::<IpAddr>()
                    .is_ok_and(|address| address.is_loopback())
        });
        is_loopback && url.port_or_known_default() == Some(local_proxy_port)
    })
}

fn safe_reqwest_error(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "request timed out"
    } else if error.is_connect() {
        "connection failed"
    } else if error.is_body() {
        "request body stream failed"
    } else {
        "request failed"
    }
}

async fn record_response_status(
    proxy_status: &RwLock<super::types::ProxyStatus>,
    response_status: reqwest::StatusCode,
    stream_completed: bool,
) {
    let mut status = proxy_status.write().await;
    if !stream_completed {
        status.failed_requests = status.failed_requests.saturating_add(1);
        status.last_error = Some("Images upstream response stream did not complete".to_string());
        update_success_rate(&mut status);
        return;
    }
    if response_status.is_success() {
        status.success_requests = status.success_requests.saturating_add(1);
        status.last_error = None;
    } else {
        status.failed_requests = status.failed_requests.saturating_add(1);
        status.last_error = Some(format!("Images upstream returned HTTP {response_status}"));
    }
    update_success_rate(&mut status);
}

struct ImageResponseOutcomeGuard {
    proxy_status: Arc<RwLock<super::types::ProxyStatus>>,
    response_status: reqwest::StatusCode,
    stream_completed: bool,
}

impl ImageResponseOutcomeGuard {
    fn new(
        proxy_status: Arc<RwLock<super::types::ProxyStatus>>,
        response_status: reqwest::StatusCode,
    ) -> Self {
        Self {
            proxy_status,
            response_status,
            stream_completed: false,
        }
    }

    fn mark_completed(&mut self) {
        self.stream_completed = true;
    }
}

impl Drop for ImageResponseOutcomeGuard {
    fn drop(&mut self) {
        let proxy_status = self.proxy_status.clone();
        let response_status = self.response_status;
        let stream_completed = self.stream_completed;
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                record_response_status(&proxy_status, response_status, stream_completed).await;
            });
        }
    }
}

async fn record_terminal_error(state: &ProxyState, error: &ProxyError) {
    let mut status = state.status.write().await;
    status.failed_requests = status.failed_requests.saturating_add(1);
    status.last_error = Some(error.to_string());
    update_success_rate(&mut status);
}

fn update_success_rate(status: &mut super::types::ProxyStatus) {
    if status.total_requests > 0 {
        status.success_rate =
            (status.success_requests as f32 / status.total_requests as f32) * 100.0;
    }
}

fn passthrough_response(
    response: reqwest::Response,
    connection_guard: ActiveConnectionGuard,
    concurrency_permit: OwnedSemaphorePermit,
    proxy_status: Arc<RwLock<super::types::ProxyStatus>>,
) -> Result<axum::response::Response, ProxyError> {
    let status = response.status();
    let mut headers = response.headers().clone();
    strip_hop_by_hop_response_headers(&mut headers);
    let upstream = response.bytes_stream();
    let outcome_guard = ImageResponseOutcomeGuard::new(proxy_status, status);
    let stream = async_stream::stream! {
        let _connection_guard = connection_guard;
        let _concurrency_permit = concurrency_permit;
        let mut outcome_guard = outcome_guard;
        tokio::pin!(upstream);
        while let Some(chunk) = upstream.next().await {
            match chunk {
                Ok(bytes) => yield Ok::<_, std::io::Error>(bytes),
                Err(_) => {
                    log::warn!("[CodexImages] upstream response stream failed");
                    yield Err(std::io::Error::other("Image upstream response stream failed"));
                    return;
                }
            }
        }
        outcome_guard.mark_completed();
    };

    let mut builder = axum::response::Response::builder().status(status);
    for (name, value) in &headers {
        builder = builder.header(name, value);
    }
    builder
        .body(Body::from_stream(stream))
        .map_err(|error| ProxyError::Internal(format!("Failed to build image response: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::convert::Infallible;

    fn authorized_headers(content_type: HeaderValue) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer PROXY_MANAGED"),
        );
        headers.insert(
            header::HeaderName::from_static(IMAGE_AUTH_HEADER),
            HeaderValue::from_static("test-image-token"),
        );
        headers.insert(header::CONTENT_TYPE, content_type);
        headers
    }

    fn loopback_extensions() -> Extensions {
        let mut extensions = Extensions::new();
        extensions.insert("127.0.0.1:1234".parse::<SocketAddr>().unwrap());
        extensions
    }

    #[test]
    fn normalizes_all_generation_and_edit_aliases_to_fixed_tuzi_paths() {
        for path in [
            "/images/generations",
            "/v1/images/generations",
            "/v1/v1/images/generations",
            "/codex/v1/images/generations",
        ] {
            let uri: Uri = path.parse().expect("uri");
            assert_eq!(
                image_upstream_url(ImageEndpoint::from_uri(&uri), &uri).expect("upstream"),
                "https://api.tu-zi.com/coding/images/generations"
            );
        }
        for path in [
            "/images/edits",
            "/v1/images/edits",
            "/v1/v1/images/edits",
            "/codex/v1/images/edits",
        ] {
            let uri: Uri = path.parse().expect("uri");
            assert_eq!(
                image_upstream_url(ImageEndpoint::from_uri(&uri), &uri).expect("upstream"),
                "https://api.tu-zi.com/coding/images/edits"
            );
        }
    }

    #[test]
    fn requires_verified_loopback_and_managed_proxy_credential() {
        for address in ["127.0.0.1:1234", "[::1]:1234"] {
            let mut extensions = Extensions::new();
            extensions.insert(address.parse::<SocketAddr>().expect("address"));
            assert!(require_local_codex_client(
                &authorized_headers(HeaderValue::from_static("application/json")),
                &extensions,
                "test-image-token"
            )
            .is_ok());
        }

        let mut remote = Extensions::new();
        remote.insert("192.168.1.10:1234".parse::<SocketAddr>().unwrap());
        assert!(matches!(
            require_local_codex_client(
                &authorized_headers(HeaderValue::from_static("application/json")),
                &remote,
                "test-image-token"
            ),
            Err(ProxyError::AuthError(_))
        ));
        assert!(matches!(
            require_local_codex_client(
                &authorized_headers(HeaderValue::from_static("application/json")),
                &Extensions::new(),
                "test-image-token"
            ),
            Err(ProxyError::AuthError(_))
        ));
        assert!(matches!(
            require_local_codex_client(
                &HeaderMap::new(),
                &loopback_extensions(),
                "test-image-token"
            ),
            Err(ProxyError::AuthError(_))
        ));
    }

    #[test]
    fn requires_current_private_image_route_credential() {
        let mut missing = authorized_headers(HeaderValue::from_static("application/json"));
        missing.remove(IMAGE_AUTH_HEADER);
        assert!(matches!(
            require_local_codex_client(&missing, &loopback_extensions(), "test-image-token"),
            Err(ProxyError::AuthError(_))
        ));

        let mut stale = authorized_headers(HeaderValue::from_static("application/json"));
        stale.insert(
            header::HeaderName::from_static(IMAGE_AUTH_HEADER),
            HeaderValue::from_static("stale-image-token"),
        );
        assert!(matches!(
            require_local_codex_client(&stale, &loopback_extensions(), "test-image-token"),
            Err(ProxyError::AuthError(_))
        ));
    }

    #[test]
    fn private_image_route_credential_comparison_rejects_mismatches() {
        assert!(constant_time_eq(b"same-token", b"same-token"));
        assert!(!constant_time_eq(b"same-token", b"other-token"));
        assert!(!constant_time_eq(b"same-token", b"same-token-longer"));
    }

    #[test]
    fn rejects_browser_origin_and_fetch_metadata_headers() {
        for (name, value) in [
            (header::ORIGIN, "https://example.com"),
            (
                header::HeaderName::from_static("sec-fetch-site"),
                "cross-site",
            ),
        ] {
            let mut headers = authorized_headers(HeaderValue::from_static("application/json"));
            headers.insert(name, HeaderValue::from_str(value).unwrap());
            assert!(matches!(
                require_local_codex_client(&headers, &loopback_extensions(), "test-image-token"),
                Err(ProxyError::AuthError(_))
            ));
        }
    }

    #[tokio::test]
    async fn generations_preserve_original_gpt_image_2_json_bytes() {
        let original = br#"{ "model": "gpt-image-2", "prompt": "draw", "n": 1 }"#;
        let headers = authorized_headers(HeaderValue::from_static("application/json"));
        let prepared = prepare_json_body(&headers, Body::from(original.as_slice()))
            .await
            .expect("prepare");
        let PreparedBody::Bytes { body, .. } = prepared else {
            panic!("expected bytes");
        };
        assert_eq!(body.as_ref(), original);
    }

    #[tokio::test]
    async fn generations_reject_text_models_instead_of_mapping_them() {
        let headers = authorized_headers(HeaderValue::from_static("application/json"));
        let error = prepare_json_body(
            &headers,
            Body::from(r#"{"model":"gpt-5.4","prompt":"draw"}"#),
        )
        .await
        .err()
        .expect("must reject");
        assert!(matches!(error, ProxyError::InvalidRequest(_)));
    }

    #[tokio::test]
    async fn generations_require_application_json() {
        for content_type in ["text/plain", "application/x-www-form-urlencoded"] {
            let headers = authorized_headers(HeaderValue::from_str(content_type).unwrap());
            let error = prepare_json_body(
                &headers,
                Body::from(r#"{"model":"gpt-image-2","prompt":"draw"}"#),
            )
            .await
            .err()
            .expect("non-JSON content type must be rejected");
            assert!(matches!(error, ProxyError::InvalidRequest(_)));
        }
    }

    #[tokio::test]
    async fn generation_upload_rejects_declared_oversize_and_idle_streams() {
        let mut oversized = authorized_headers(HeaderValue::from_static("application/json"));
        oversized.insert(
            header::CONTENT_LENGTH,
            HeaderValue::from_str(&(MAX_IMAGE_JSON_BYTES as u64 + 1).to_string()).unwrap(),
        );
        assert!(matches!(
            prepare_json_body(&oversized, Body::empty()).await,
            Err(ProxyError::InvalidRequest(_))
        ));

        let pending = stream::pending::<Result<Bytes, Infallible>>();
        let error = prepare_json_body_with_idle_timeout(
            &authorized_headers(HeaderValue::from_static("application/json")),
            Body::from_stream(pending),
            Duration::from_millis(10),
        )
        .await
        .err()
        .expect("idle generation upload must time out");
        assert!(matches!(error, ProxyError::Timeout(_)));
    }

    #[tokio::test]
    async fn edits_spool_original_binary_bytes_without_rebuilding_multipart() {
        let boundary = "tuzi-boundary";
        let original = Bytes::from_static(
            b"--tuzi-boundary\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\ngpt-image-2\r\n--tuzi-boundary\r\nContent-Disposition: form-data; name=\"image\"; filename=\"x.png\"\r\nContent-Type: image/png\r\n\r\n\x00\x01\xff\x03\r\n--tuzi-boundary--\r\n",
        );
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&format!("multipart/form-data; boundary={boundary}")).unwrap(),
        );
        let prepared = prepare_edit_body(&headers, Body::from(original.clone()))
            .await
            .expect("prepare");
        let PreparedBody::File { file, len, .. } = prepared else {
            panic!("expected file");
        };
        assert_eq!(len, original.len() as u64);
        assert_eq!(std::fs::read(file.path()).unwrap(), original.as_ref());
    }

    #[tokio::test]
    async fn edits_reject_missing_or_text_model() {
        for body in [
            b"--b\r\nContent-Disposition: form-data; name=\"image\"\r\n\r\nx\r\n--b--\r\n"
                .as_slice(),
            b"--b\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\ngpt-5.4\r\n--b--\r\n"
                .as_slice(),
        ] {
            let mut headers = HeaderMap::new();
            headers.insert(
                header::CONTENT_TYPE,
                HeaderValue::from_static("multipart/form-data; boundary=b"),
            );
            let error = match prepare_edit_body(&headers, Body::from(body.to_vec())).await {
                Ok(_) => panic!("invalid edit model must be rejected"),
                Err(error) => error,
            };
            assert!(matches!(error, ProxyError::InvalidRequest(_)));
        }
    }

    #[tokio::test]
    async fn edits_reject_oversized_boundary_and_text_fields() {
        let spool = tempfile::NamedTempFile::new().expect("spool");
        assert!(matches!(
            validate_edit_model(&spool, "multipart/form-data; boundary=\"\"").await,
            Err(ProxyError::InvalidRequest(_))
        ));

        let long_boundary = "b".repeat(MAX_MULTIPART_BOUNDARY_BYTES + 1);
        let content_type = format!("multipart/form-data; boundary={long_boundary}");
        assert!(matches!(
            validate_edit_model(&spool, &content_type).await,
            Err(ProxyError::InvalidRequest(_))
        ));

        let boundary = "b";
        let oversized_text = "x".repeat(MAX_MULTIPART_TEXT_FIELD_BYTES as usize + 1);
        let original = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{IMAGE_MODEL}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"prompt\"\r\n\r\n{oversized_text}\r\n--{boundary}--\r\n"
        );
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&format!("multipart/form-data; boundary={boundary}")).unwrap(),
        );
        assert!(matches!(
            prepare_edit_body(&headers, Body::from(original)).await,
            Err(ProxyError::InvalidRequest(_))
        ));
    }

    #[tokio::test]
    async fn edits_reject_oversized_field_headers_without_buffering_the_full_body() {
        let boundary = "b";
        let oversized_header = "x".repeat(MAX_MULTIPART_HEADER_BYTES + 1);
        let original = format!(
            "--{boundary}\r\nX-Oversized: {oversized_header}\r\n\r\nignored\r\n--{boundary}--\r\n"
        );
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&format!("multipart/form-data; boundary={boundary}")).unwrap(),
        );
        assert!(matches!(
            prepare_edit_body(&headers, Body::from(original)).await,
            Err(ProxyError::InvalidRequest(_))
        ));
    }

    #[tokio::test]
    async fn edits_allow_near_boundary_bytes_inside_image_data() {
        let boundary = "tuzi-boundary";
        let original = Bytes::from_static(
            b"--tuzi-boundary\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\ngpt-image-2\r\n--tuzi-boundary\r\nContent-Disposition: form-data; name=\"image\"; filename=\"x.png\"\r\nContent-Type: image/png\r\n\r\nbinary\r\n--tuzi-boundarX\r\nmore-binary\r\n--tuzi-boundary--\r\n",
        );
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_str(&format!("multipart/form-data; boundary={boundary}")).unwrap(),
        );

        let prepared = prepare_edit_body(&headers, Body::from(original.clone()))
            .await
            .expect("near-boundary image bytes must remain valid");
        let PreparedBody::File { file, .. } = prepared else {
            panic!("expected file");
        };
        assert_eq!(std::fs::read(file.path()).unwrap(), original.as_ref());
    }

    #[tokio::test]
    async fn edit_upload_rejects_idle_stream() {
        let pending = stream::pending::<Result<Bytes, Infallible>>();
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("multipart/form-data; boundary=b"),
        );
        let error = prepare_edit_body_with_idle_timeout(
            &headers,
            Body::from_stream(pending),
            Duration::from_millis(10),
        )
        .await
        .err()
        .expect("idle edit upload must time out");
        assert!(matches!(error, ProxyError::Timeout(_)));
    }

    #[test]
    fn upstream_headers_use_only_allowlisted_client_headers_and_private_key() {
        let mut incoming = HeaderMap::new();
        incoming.insert(
            header::AUTHORIZATION,
            HeaderValue::from_static("Bearer local"),
        );
        incoming.insert("x-api-key", HeaderValue::from_static("old"));
        incoming.insert("cookie", HeaderValue::from_static("session=old"));
        incoming.insert("x-forwarded-for", HeaderValue::from_static("10.0.0.1"));
        incoming.insert(header::ACCEPT, HeaderValue::from_static("application/json"));
        let headers = upstream_headers(
            &incoming,
            "tuzi-secret",
            HeaderValue::from_static("application/json"),
        )
        .expect("headers");

        assert_eq!(headers[header::AUTHORIZATION], "Bearer tuzi-secret");
        assert!(headers[header::AUTHORIZATION].is_sensitive());
        assert_eq!(headers[header::ACCEPT], "application/json");
        assert!(!headers.contains_key("x-api-key"));
        assert!(!headers.contains_key("cookie"));
        assert!(!headers.contains_key("x-forwarded-for"));
        assert_eq!(headers[IMAGE_ACTOR_HEADER], IMAGE_ACTOR_HEADER_VALUE);
    }

    #[test]
    fn image_requests_have_a_hard_concurrency_limit() {
        let permits = (0..MAX_CONCURRENT_IMAGE_REQUESTS)
            .map(|_| acquire_image_request_slot().expect("slot"))
            .collect::<Vec<_>>();
        assert!(matches!(
            acquire_image_request_slot(),
            Err(ProxyError::ForwardFailed(_))
        ));
        drop(permits);
        assert!(acquire_image_request_slot().is_ok());
    }

    #[test]
    fn busy_response_is_retryable_without_using_generic_proxy_errors() {
        let response = image_busy_response();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            response.headers().get(header::RETRY_AFTER).unwrap(),
            IMAGE_BUSY_RETRY_AFTER_SECONDS
        );
    }

    async fn assert_image_client_does_not_follow_redirect(status: StatusCode) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener");
        let address = listener.local_addr().expect("address");
        let response = format!(
            "HTTP/1.1 {} {}\r\nLocation: /second\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            status.as_u16(),
            status.canonical_reason().expect("redirect reason")
        );
        let server = tokio::spawn(async move {
            let mut requests = 0_usize;
            loop {
                let accepted =
                    tokio::time::timeout(Duration::from_millis(250), listener.accept()).await;
                let Ok(Ok((mut socket, _))) = accepted else {
                    break;
                };
                requests += 1;
                let mut request = Vec::new();
                let mut buffer = [0_u8; 1024];
                loop {
                    let read = socket.read(&mut buffer).await.expect("read request");
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                    if request.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }
                socket
                    .write_all(response.as_bytes())
                    .await
                    .expect("write response");
            }
            requests
        });

        let client = build_image_http_client(None, true).expect("client");
        let response = client
            .post(format!("http://{address}/first"))
            .body("image request")
            .send()
            .await
            .expect("request");
        assert_eq!(response.status(), status);
        assert_eq!(server.await.expect("server"), 1);
    }

    #[tokio::test]
    async fn image_client_returns_redirect_without_replaying_post() {
        for status in [
            StatusCode::TEMPORARY_REDIRECT,
            StatusCode::PERMANENT_REDIRECT,
        ] {
            assert_image_client_does_not_follow_redirect(status).await;
        }
    }

    #[test]
    fn detects_only_the_current_loopback_proxy_port() {
        assert!(proxy_points_to_local_port("http://127.0.0.1:15721", 15721));
        assert!(proxy_points_to_local_port("localhost:15721", 15721));
        assert!(!proxy_points_to_local_port("http://127.0.0.1:7890", 15721));
        assert!(!proxy_points_to_local_port(
            "https://example.com:15721",
            15721
        ));
    }

    #[tokio::test]
    async fn incomplete_response_stream_is_recorded_as_failure() {
        let status = RwLock::new(super::super::types::ProxyStatus {
            total_requests: 1,
            ..Default::default()
        });
        record_response_status(&status, reqwest::StatusCode::OK, false).await;
        let status = status.read().await;
        assert_eq!(status.success_requests, 0);
        assert_eq!(status.failed_requests, 1);
        assert!(status
            .last_error
            .as_deref()
            .is_some_and(|message| message.contains("did not complete")));
    }
}
