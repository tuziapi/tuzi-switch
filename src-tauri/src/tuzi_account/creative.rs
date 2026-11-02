//! Creative account bindings contain provenance only. Secrets stay in native memory.
use super::*;
use base64::{engine::general_purpose::STANDARD, Engine};
use futures::StreamExt;
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path, sync::LazyLock};

static BINDING_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
const MAX_BODY: usize = 64 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreativeBinding {
    schema_version: u32,
    id: String,
    account_origin: String,
    user_id: String,
    token_id: String,
    name: String,
    key_mask: String,
    group: String,
    updated_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BindRequest {
    generation: u64,
    token_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelRequest {
    generation: u64,
    binding_id: String,
    request_id: String,
    upstream_request_id: Option<String>,
    action: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    task_id: String,
    body: Option<Value>,
    #[serde(default)]
    parts: Vec<FormPart>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FormPart {
    name: String,
    value: Option<String>,
    data: Option<String>,
    mime: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CreativeChunk {
    Ready,
    Start {
        status: u16,
        content_type: String,
        headers: BTreeMap<String, String>,
    },
    Data {
        data: String,
    },
    End,
}

fn binding_id(origin: &str, user: &str, token: &str) -> String {
    let digest = Sha256::digest(format!("{origin}:{user}:{token}"));
    format!(
        "tuzi-account-{}",
        digest[..16]
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}

fn binding_path() -> std::path::PathBuf {
    crate::config::get_app_config_dir().join("creative-account-bindings.json")
}

fn read_bindings(path: &Path, origin: &str) -> Result<Vec<CreativeBinding>, String> {
    if !path.exists() {
        return Ok(vec![]);
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "binding_read_failed")?;
    if metadata.file_type().is_symlink() || metadata.len() > 1024 * 1024 {
        return Err("binding_storage_invalid".into());
    }
    let bytes = std::fs::read(path).map_err(|_| "binding_read_failed")?;
    let items: Vec<CreativeBinding> =
        serde_json::from_slice(&bytes).map_err(|_| "binding_storage_invalid")?;
    let mut ids = std::collections::HashSet::new();
    if items.len() > 200
        || items.iter().any(|b| {
            b.schema_version != 1
                || b.id != binding_id(&b.account_origin, &b.user_id, &b.token_id)
                || b.account_origin != origin
                || b.user_id.parse::<u64>().ok().filter(|id| *id > 0).is_none()
                || b.token_id
                    .parse::<u64>()
                    .ok()
                    .filter(|id| *id > 0)
                    .is_none()
                || !ids.insert(&b.id)
        })
    {
        return Err("binding_storage_invalid".into());
    }
    Ok(items)
}

fn account(service: &AccountService, generation: u64) -> Result<Identity, String> {
    let state = service.state();
    if state.generation != generation || state.status != "connected" {
        return Err("creative_account_unavailable".into());
    }
    state
        .identity
        .ok_or_else(|| "creative_account_unavailable".into())
}

fn owned_binding(
    service: &AccountService,
    generation: u64,
    id: &str,
    path: &Path,
) -> Result<CreativeBinding, String> {
    let identity = account(service, generation)?;
    let _guard = BINDING_LOCK.lock().unwrap();
    read_bindings(path, &service.origin)?
        .into_iter()
        .find(|b| b.id == id && b.account_origin == service.origin && b.user_id == identity.user_id)
        .ok_or_else(|| "creative_binding_not_found".into())
}

#[tauri::command]
pub fn creative_account_bindings(
    service: tauri::State<'_, Arc<AccountService>>,
    generation: u64,
) -> Result<Vec<CreativeBinding>, String> {
    let identity = account(&service, generation)?;
    let _guard = BINDING_LOCK.lock().unwrap();
    Ok(read_bindings(&binding_path(), &service.origin)?
        .into_iter()
        .filter(|b| b.account_origin == service.origin && b.user_id == identity.user_id)
        .collect())
}

#[tauri::command]
pub async fn creative_account_bind(
    service: tauri::State<'_, Arc<AccountService>>,
    request: BindRequest,
) -> Result<CreativeBinding, String> {
    bind(&service, request, &binding_path()).await
}

async fn bind(
    service: &AccountService,
    request: BindRequest,
    path: &Path,
) -> Result<CreativeBinding, String> {
    if request
        .token_id
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0)
        .is_none()
    {
        return Err("invalid_key_id".into());
    }
    let identity = account(&service, request.generation)?;
    let catalog = service
        .key_model_catalog(request.generation, &request.token_id)
        .await
        .map_err(|e| e.code)?;
    let key = &catalog["key"];
    let mask = key["masked_key"].as_str().unwrap_or("");
    let tail: String = mask
        .chars()
        .rev()
        .take(4)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    let id = binding_id(&service.origin, &identity.user_id, &request.token_id);
    let binding = CreativeBinding {
        schema_version: 1,
        id,
        account_origin: service.origin.clone(),
        user_id: identity.user_id.clone(),
        token_id: request.token_id,
        name: key["name"]
            .as_str()
            .unwrap_or("兔子账户")
            .chars()
            .take(100)
            .collect(),
        key_mask: format!("•••• {tail}"),
        group: key["group"].as_str().unwrap_or("").into(),
        updated_at: now(),
    };
    service.with_confirmed_source(&identity.user_id, request.generation, || {
        let _guard = BINDING_LOCK.lock().unwrap();
        let mut items = read_bindings(&path, &service.origin)?;
        items.retain(|b| b.id != binding.id);
        if items.len() >= 200 {
            return Err("binding_limit_reached".into());
        }
        items.push(binding.clone());
        let bytes = serde_json::to_vec(&items).map_err(|_| "binding_write_failed")?;
        crate::config::atomic_write(&path, &bytes).map_err(|_| "binding_write_failed".to_string())
    })?;
    Ok(binding)
}

// Only known model actions, never renderer-supplied URLs or arbitrary headers.
fn target(request: &ModelRequest) -> Result<(&'static str, String), String> {
    let id = &request.task_id;
    let valid_id = || {
        !id.is_empty()
            && id.len() <= 200
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b))
    };
    let path = match request.action.as_str() {
        "models" => return Ok(("GET", "/v1/models".into())),
        "image.generate" => "/v1/images/generations",
        "image.edit" => "/v1/images/edits",
        "chat" => "/v1/chat/completions",
        "responses" => "/v1/responses",
        "video.create" => "/v1/videos",
        "audio.speech" => "/v1/audio/speech",
        "audio.transcribe" => "/v1/audio/transcriptions",
        "video.poll" if valid_id() => return Ok(("GET", format!("/v1/videos/{id}"))),
        "video.content" if valid_id() => return Ok(("GET", format!("/v1/videos/{id}/content"))),
        "image.result" if valid_id() => return Ok(("GET", format!("/log/get-request?id={id}"))),
        "gemini.generate" | "gemini.stream" => {
            if request.model.is_empty()
                || request.model.len() > 200
                || !request
                    .model
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b))
            {
                return Err("invalid_model".into());
            }
            let operation = if request.action == "gemini.stream" {
                "streamGenerateContent?alt=sse"
            } else {
                "generateContent"
            };
            return Ok((
                "POST",
                format!("/v1beta/models/{}:{operation}", request.model),
            ));
        }
        _ => return Err("creative_action_unsupported".into()),
    };
    Ok(("POST", path.into()))
}

fn encode_body(request: &ModelRequest) -> Result<(Vec<u8>, String), String> {
    if request.parts.is_empty() {
        let body = request.body.as_ref().ok_or("missing_body")?;
        if !body.is_object() {
            return Err("invalid_body".into());
        }
        let bytes = serde_json::to_vec(body).map_err(|_| "invalid_body")?;
        if bytes.len() > MAX_BODY {
            return Err("body_too_large".into());
        }
        return Ok((bytes, "application/json".into()));
    }
    if request.body.is_some() || request.parts.len() > 64 {
        return Err("invalid_body".into());
    }
    let boundary = format!("tuzi-{}", uuid::Uuid::new_v4());
    let mut body = Vec::new();
    for part in &request.parts {
        if part.name.len() > 100
            || part.name.is_empty()
            || !part
                .name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-[]".contains(&b))
        {
            return Err("invalid_form_field".into());
        }
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{}\"",
                part.name
            )
            .as_bytes(),
        );
        match (&part.value, &part.data) {
            (Some(value), None) => {
                body.extend_from_slice(b"\r\n\r\n");
                body.extend_from_slice(value.as_bytes());
            }
            (None, Some(encoded)) if encoded.len() <= MAX_BODY * 4 / 3 + 4 => {
                let mime = part.mime.as_deref().unwrap_or("application/octet-stream");
                if !mime
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"/+.-".contains(&b))
                {
                    return Err("invalid_mime".into());
                }
                let extension = match mime {
                    "image/png" => "png",
                    "image/jpeg" => "jpg",
                    "image/webp" => "webp",
                    "audio/wav" => "wav",
                    "audio/mpeg" => "mp3",
                    _ => "bin",
                };
                body.extend_from_slice(
                    format!("; filename=\"upload.{extension}\"\r\nContent-Type: {mime}\r\n\r\n")
                        .as_bytes(),
                );
                body.extend(STANDARD.decode(encoded).map_err(|_| "invalid_upload")?);
            }
            _ => return Err("invalid_form_field".into()),
        }
        body.extend_from_slice(b"\r\n");
        if body.len() > MAX_BODY {
            return Err("body_too_large".into());
        }
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    Ok((body, format!("multipart/form-data; boundary={boundary}")))
}

fn supports_action(model: &Value, action: &str) -> bool {
    let (path, aliases): (&str, &[&str]) = match action {
        "chat" => (
            "/v1/chat/completions",
            &[
                "openai",
                "openai-chat",
                "chat",
                "openai_chat",
                "openai_completions",
            ],
        ),
        "responses" => (
            "/v1/responses",
            &[
                "openai-response",
                "openai-responses",
                "responses",
                "codex_responses",
            ],
        ),
        "image.generate" => (
            "/v1/images/generations",
            &["openai-image", "openai-images", "image-generation"],
        ),
        "image.edit" => (
            "/v1/images/edits",
            &["openai-image", "openai-images", "image-edit"],
        ),
        "video.create" => ("/v1/videos", &["openai-video", "openai-videos"]),
        "audio.speech" => ("/v1/audio/speech", &["openai-tts", "text-to-speech"]),
        "audio.transcribe" => (
            "/v1/audio/transcriptions",
            &["openai-stt", "speech-to-text"],
        ),
        "gemini.generate" | "gemini.stream" => (
            "/v1beta/models/{model}:generateContent",
            &[
                "gemini",
                "google",
                "gemini-native",
                "gemini_native",
                "google_generative_ai",
                "gemini generatecontent",
            ],
        ),
        _ => return false,
    };
    let valid_detail = |detail: &Value| {
        let declared = if detail.is_string() {
            detail.as_str()
        } else {
            detail["path"].as_str()
        };
        let method = detail["method"].as_str().unwrap_or("POST");
        method.eq_ignore_ascii_case("POST")
            && declared.is_some_and(|p| p.trim_end_matches('/') == path)
    };
    if model["endpoints"]
        .as_object()
        .is_some_and(|endpoints| endpoints.values().any(valid_detail))
    {
        return true;
    }
    model["supported_endpoint_types"]
        .as_array()
        .is_some_and(|types| {
            types.iter().any(|t| {
                let Some(name) = t.as_str() else {
                    return false;
                };
                if !aliases.contains(&name.trim().to_lowercase().as_str()) {
                    return false;
                }
                match model["endpoints"]
                    .as_object()
                    .and_then(|m| {
                        m.iter()
                            .find(|(key, _)| key.trim().eq_ignore_ascii_case(name.trim()))
                    })
                    .map(|(_, value)| value)
                {
                    Some(detail) if !detail.is_null() => valid_detail(detail),
                    _ => true,
                }
            })
        })
}

fn validate_model(request: &ModelRequest, catalog: &Value) -> Result<(), String> {
    let models: Vec<&str> = if request.parts.is_empty() {
        request
            .body
            .as_ref()
            .and_then(|b| b["model"].as_str())
            .into_iter()
            .collect()
    } else {
        request
            .parts
            .iter()
            .filter(|p| p.name == "model")
            .filter_map(|p| p.value.as_deref())
            .collect()
    };
    let model = if request.action.starts_with("gemini.") {
        request.model.as_str()
    } else if models.len() == 1 {
        models[0]
    } else {
        return Err("invalid_model".into());
    };
    if !catalog["items"].as_array().is_some_and(|items| {
        items
            .iter()
            .any(|m| m["model_name"] == model && supports_action(m, &request.action))
    }) {
        return Err("model_not_qualified".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn creative_account_request(
    service: tauri::State<'_, Arc<AccountService>>,
    request: ModelRequest,
    on_chunk: tauri::ipc::Channel<CreativeChunk>,
) -> Result<(), String> {
    execute(&service, request, &binding_path(), on_chunk).await
}

async fn execute(
    service: &AccountService,
    request: ModelRequest,
    path: &Path,
    on_chunk: tauri::ipc::Channel<CreativeChunk>,
) -> Result<(), String> {
    if uuid::Uuid::parse_str(&request.request_id).is_err() {
        return Err("invalid_request_id".into());
    }
    let (cancel, mut cancelled) = tokio::sync::watch::channel(false);
    {
        let mut pending = service.business_pending.lock().unwrap();
        if pending.len() >= 128 || pending.contains_key(&request.request_id) {
            return Err("duplicate_request".into());
        }
        pending.insert(request.request_id.clone(), cancel);
    }
    let operation = async {
        on_chunk
            .send(CreativeChunk::Ready)
            .map_err(|_| "consumer_closed")?;
        let binding = owned_binding(service, request.generation, &request.binding_id, path)?;
        let (method, path) = target(&request)?;
        let (catalog, secret) = service
            .qualified_creative_key(request.generation, &binding.token_id)
            .await
            .map_err(|e| e.code)?;
        account(&service, request.generation)?;
        if request.action == "models" {
            let items: Vec<_> = catalog["items"].as_array().ok_or("invalid_catalog")?.iter()
                .map(|m| json!({"id":m["model_name"],"supported_endpoint_types":m["supported_endpoint_types"],"endpoints":m["endpoints"]})).collect();
            on_chunk
                .send(CreativeChunk::Start {
                    status: 200,
                    content_type: "application/json".into(),
                    headers: BTreeMap::new(),
                })
                .map_err(|_| "consumer_closed")?;
            on_chunk
                .send(CreativeChunk::Data {
                    data: STANDARD.encode(json!({"data":items}).to_string()),
                })
                .map_err(|_| "consumer_closed")?;
        } else {
            let payload = if method == "POST" {
                validate_model(&request, &catalog)?;
                Some(encode_body(&request)?)
            } else {
                if request.body.is_some() || !request.parts.is_empty() {
                    return Err("invalid_body".into());
                }
                None
            };
            // A switch/logout while qualification ran must stop the outgoing request.
            let current = account(&service, request.generation)?;
            if current.user_id != binding.user_id {
                return Err("stale_account".into());
            }
            let upstream_id = request
                .upstream_request_id
                .as_deref()
                .unwrap_or(&request.request_id);
            if upstream_id.is_empty()
                || upstream_id.len() > 200
                || !upstream_id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-.".contains(&b))
            {
                return Err("invalid_request_id".into());
            }
            let mut builder = service
                .http
                .request(
                    reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "invalid_method")?,
                    format!("{}{path}", service.origin),
                )
                .bearer_auth(secret.as_str())
                .header("X-Request-Id", upstream_id)
                .timeout(Duration::from_secs(600));
            if let Some((body, content_type)) = payload {
                builder = builder.header("Content-Type", content_type).body(body);
            }
            let response = builder
                .send()
                .await
                .map_err(|_| "creative_outcome_unknown")?;
            account(&service, request.generation)?;
            let status = response.status();
            if status.is_redirection() {
                return Err("creative_redirect_rejected".into());
            }
            let content_type = response
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("application/octet-stream")
                .to_string();
            if !status.is_success() {
                // Do not expose upstream error bodies or authentication diagnostics.
                return Err(format!("creative_upstream_{}", status.as_u16()));
            }
            if response
                .content_length()
                .is_some_and(|n| n > MAX_BODY as u64)
            {
                return Err("response_too_large".into());
            }
            let headers = ["x-oneapi-request-id", "x-request-id"]
                .iter()
                .filter_map(|name| {
                    response
                        .headers()
                        .get(*name)
                        .and_then(|v| v.to_str().ok())
                        .map(|v| (name.to_string(), v.to_string()))
                })
                .collect();
            on_chunk
                .send(CreativeChunk::Start {
                    status: status.as_u16(),
                    content_type,
                    headers,
                })
                .map_err(|_| "consumer_closed")?;
            let mut total = 0usize;
            let mut stream = response.bytes_stream();
            while let Some(chunk) = stream.next().await {
                account(&service, request.generation)?;
                let bytes = chunk.map_err(|_| "creative_outcome_unknown")?;
                total += bytes.len();
                if total > MAX_BODY {
                    return Err("response_too_large".into());
                }
                on_chunk
                    .send(CreativeChunk::Data {
                        data: STANDARD.encode(bytes),
                    })
                    .map_err(|_| "consumer_closed")?;
            }
        }
        on_chunk
            .send(CreativeChunk::End)
            .map_err(|_| "consumer_closed")?;
        Ok(())
    };
    let result = tokio::select! {
        biased;
        _ = cancelled.changed() => Err("creative_cancelled_outcome_unknown".into()),
        result = operation => result,
    };
    service
        .business_pending
        .lock()
        .unwrap()
        .remove(&request.request_id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    mod http;
    fn request(action: &str) -> ModelRequest {
        serde_json::from_value(json!({"generation":1,"bindingId":"synthetic","requestId":uuid::Uuid::new_v4().to_string(),"action":action,"body":{"model":"synthetic"}})).unwrap()
    }
    #[test]
    fn controlled_actions_reject_paths_and_unknown_operations() {
        assert_eq!(
            target(&request("image.generate")).unwrap(),
            ("POST", "/v1/images/generations".into())
        );
        assert!(target(&request("https://attacker.invalid")).is_err());
        let mut r = request("video.poll");
        r.task_id = "../api/token/1".into();
        assert!(target(&r).is_err());
        r.task_id = "synthetic-task".into();
        assert_eq!(target(&r).unwrap().1, "/v1/videos/synthetic-task");
        r.action = "image.result".into();
        assert_eq!(target(&r).unwrap().1, "/log/get-request?id=synthetic-task");
    }
    #[test]
    fn qualification_requires_membership_and_endpoint_not_model_name() {
        let catalog =
            json!({"items":[{"model_name":"synthetic","supported_endpoint_types":["openai"]}]});
        assert!(validate_model(&request("chat"), &catalog).is_ok());
        assert!(validate_model(&request("image.generate"), &catalog).is_err());
        assert!(validate_model(&request("chat"), &json!({"items":[]})).is_err());
        assert!(!supports_action(
            &json!({"model_name":"gpt-image-2"}),
            "image.generate"
        ));
        assert!(supports_action(
            &json!({"endpoints":{"custom":{"path":"/v1/images/generations","method":"POST"}}}),
            "image.generate"
        ));
        assert!(!supports_action(
            &json!({"supported_endpoint_types":["openai"],"endpoints":{"openai":{"path":"/v1/images/generations","method":"POST"}}}),
            "chat"
        ));
    }
    #[test]
    fn multipart_is_encoded_natively_and_rejects_header_injection() {
        let mut r = request("image.edit");
        r.body = None;
        r.parts = vec![
            FormPart {
                name: "model".into(),
                value: Some("synthetic".into()),
                data: None,
                mime: None,
            },
            FormPart {
                name: "image[]".into(),
                value: None,
                data: Some(STANDARD.encode(b"synthetic-image")),
                mime: Some("image/png".into()),
            },
        ];
        let (bytes, content) = encode_body(&r).unwrap();
        assert!(content.starts_with("multipart/form-data; boundary=tuzi-"));
        assert!(String::from_utf8(bytes)
            .unwrap()
            .contains("filename=\"upload.png\""));
        r.parts[1].mime = Some("image/png\r\nAuthorization: secret".into());
        assert!(encode_body(&r).is_err());
        r.parts[1].mime = Some("image/png".into());
        r.parts[1].name = "image\"\r\nX-Injected".into();
        assert!(encode_body(&r).is_err());
    }
    #[test]
    fn duplicated_models_and_mixed_payloads_are_rejected() {
        let mut r = request("image.edit");
        r.parts = vec![
            FormPart {
                name: "model".into(),
                value: Some("synthetic".into()),
                data: None,
                mime: None,
            },
            FormPart {
                name: "model".into(),
                value: Some("other".into()),
                data: None,
                mime: None,
            },
        ];
        assert!(encode_body(&r).is_err());
        r.body = None;
        assert!(validate_model(&r,&json!({"items":[{"model_name":"synthetic","supported_endpoint_types":["openai-image"]}]})).is_err());
    }
    #[test]
    fn binding_identity_cannot_cross_site_user_or_key() {
        let id = binding_id("https://api.tu-zi.com", "1", "2");
        assert_ne!(id, binding_id("https://api.tu-zi.com", "2", "2"));
        assert_ne!(id, binding_id("https://api.tu-zi.com", "1", "3"));
        assert_ne!(id, binding_id("https://other.invalid", "1", "2"));
        assert_eq!(id, binding_id("https://api.tu-zi.com", "1", "2"));
    }
    #[test]
    fn binding_file_is_strict_and_contains_no_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("bindings.json");
        let binding = CreativeBinding {
            schema_version: 1,
            id: binding_id("https://api.tu-zi.com", "1", "2"),
            account_origin: "https://api.tu-zi.com".into(),
            user_id: "1".into(),
            token_id: "2".into(),
            name: "synthetic".into(),
            key_mask: "•••• TEST".into(),
            group: "default".into(),
            updated_at: 0,
        };
        let bytes = serde_json::to_vec(&vec![binding.clone()]).unwrap();
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(
            read_bindings(&path, "https://api.tu-zi.com").unwrap().len(),
            1
        );
        let mut forged = serde_json::to_value(vec![binding]).unwrap();
        forged[0]["userId"] = json!("999");
        std::fs::write(&path, forged.to_string()).unwrap();
        assert!(read_bindings(&path, "https://api.tu-zi.com").is_err());
        forged[0]["apiKey"] = json!("synthetic");
        assert!(serde_json::from_value::<Vec<CreativeBinding>>(forged).is_err());
        assert!(!String::from_utf8(bytes).unwrap().contains("apiKey"));
    }
    #[test]
    fn renderer_cannot_supply_arbitrary_native_urls_or_headers() {
        assert!(serde_json::from_value::<ModelRequest>(json!({"generation":1,"bindingId":"synthetic","requestId":"synthetic","action":"models","url":"https://attacker.invalid"})).is_err());
    }
}
