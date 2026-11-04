//! The model adapter already chose the request. Only resolve its credential here.
use super::*;
use crate::creative_http::{prepare, send_response, ManualRequest};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountHttpRequest {
    generation: u64,
    binding_id: String,
    request_id: String,
    url: String,
    method: String,
    headers: BTreeMap<String, String>,
    body: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestPolicy {
    model_path_prefixes: Vec<String>,
    model_paths: Vec<String>,
    credential_headers: Vec<String>,
    credential_query_keys: Vec<String>,
}
static POLICY: LazyLock<RequestPolicy> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../../../src/config/creativeRequestPolicy.json"
    ))
    .expect("checked-in creative request policy")
});

fn validate_destination(request: &ManualRequest, origin: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(&request.url).map_err(|_| "invalid_url")?;
    let trusted = reqwest::Url::parse(origin).map_err(|_| "invalid_url")?;
    // Namespace boundary only. Do not interpret model names, payloads, task IDs,
    // protocol metadata or operation-specific query parameters a second time.
    if url.origin() != trusted.origin()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.path().contains('\\')
        || ["%25", "%2f", "%5c"]
            .iter()
            .any(|escape| url.path().to_ascii_lowercase().contains(escape))
        || !(POLICY
            .model_path_prefixes
            .iter()
            .any(|prefix| url.path().starts_with(prefix))
            || POLICY.model_paths.iter().any(|path| url.path() == path))
        || url.query_pairs().any(|(key, value)| {
            POLICY
                .credential_query_keys
                .contains(&key.to_ascii_lowercase())
                || value.contains("tuzi-account:")
        })
    {
        return Err("creative_destination_rejected".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn creative_account_http_request(
    service: tauri::State<'_, Arc<AccountService>>,
    request: AccountHttpRequest,
    on_chunk: tauri::ipc::Channel<CreativeChunk>,
) -> Result<(), String> {
    execute_http(&service, request, &binding_path(), |chunk| {
        on_chunk.send(chunk).map_err(|_| "consumer_closed".into())
    })
    .await
}

async fn execute_http(
    service: &AccountService,
    request: AccountHttpRequest,
    path: &Path,
    send: impl Fn(CreativeChunk) -> Result<(), String>,
) -> Result<(), String> {
    let generation = request.generation;
    let binding_id = request.binding_id;
    let mut http = ManualRequest {
        request_id: request.request_id,
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
    };
    validate_destination(&http, &service.origin)?;
    // Never accept caller-supplied identity or credentials for a managed source.
    http.headers.retain(|name, _| {
        !POLICY
            .credential_headers
            .contains(&name.to_ascii_lowercase())
    });
    let builder = prepare(&http, &service.http)?.timeout(Duration::from_secs(600));
    let (cancel, mut cancelled) = tokio::sync::watch::channel(false);
    {
        let mut pending = service.business_pending.lock().unwrap();
        if pending.len() >= 128 || pending.contains_key(&http.request_id) {
            return Err("duplicate_request".into());
        }
        pending.insert(http.request_id.clone(), cancel);
    }
    let operation = async {
        send(CreativeChunk::Ready)?;
        let binding = owned_binding(service, generation, &binding_id, path)?;
        let (_key, secret) = service
            .creative_key(generation, &binding.token_id)
            .await
            .map_err(|error| error.code)?;
        let validate = || {
            let identity = account(service, generation)?;
            if identity.user_id != binding.user_id {
                return Err("stale_account".into());
            }
            Ok(())
        };
        // The relay enforces model permissions, just as for the same Key in a
        // manual provider. Catalog metadata is not an authorization allowlist.
        send_response(builder.bearer_auth(secret.as_str()), &send, validate).await
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
        .remove(&http.request_id);
    result
}

#[cfg(test)]
mod tests;
