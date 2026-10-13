//! Bounded desktop facade. No caller-controlled origin or authorization headers.
use super::*;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BusinessRequest {
    method: String,
    path: String,
    #[serde(default)]
    query: Vec<(String, String)>,
    body: Option<Value>,
    generation: u64,
    #[serde(default, rename = "requestId")]
    request_id: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessError {
    code: String,
    message: String,
    status: Option<u16>,
    retry_after: Option<u64>,
    field: Option<String>,
    required_scope: Option<String>,
    outcome_unknown: bool,
}
impl BusinessError {
    fn new(code: &str, unknown: bool) -> Self {
        Self {
            code: code.into(),
            message: code.into(),
            status: None,
            retry_after: None,
            field: None,
            required_scope: None,
            outcome_unknown: unknown,
        }
    }
}
impl From<AccountError> for BusinessError {
    fn from(e: AccountError) -> Self {
        let mut result = Self::new(&e.code, false);
        result.retry_after = e.retry_after;
        result
    }
}
fn allowed(method: &str, path: &str) -> bool {
    match (method, path) {
        (
            "GET",
            "/api/desktop/account"
            | "/api/desktop/capabilities"
            | "/api/desktop/keys"
            | "/api/desktop/key-groups"
            | "/api/desktop/logs"
            | "/api/desktop/logs/summary"
            | "/api/desktop/logs/statistics"
            | "/api/desktop/usage"
            | "/api/desktop/usage/summary"
            | "/api/desktop/models"
            | "/api/desktop/model-performance"
            | "/api/desktop/profile",
        ) => true,
        ("POST", "/api/desktop/keys" | "/api/desktop/model-performance/batch") => true,
        ("PATCH", "/api/desktop/profile") => true,
        _ => {
            if let Some(rest) = path.strip_prefix("/api/desktop/keys/") {
                let mut parts = rest.split('/');
                let id = parts.next().unwrap_or("");
                if id.is_empty() || id.len() > 19 || !id.bytes().all(|b| b.is_ascii_digit()) {
                    return false;
                }
                let suffix = parts.next();
                if parts.next().is_some() {
                    return false;
                }
                return matches!(
                    (method, suffix),
                    ("GET" | "PATCH" | "DELETE", None)
                        | ("PATCH", Some("status"))
                        | ("POST", Some("reveal"))
                );
            }
            if method == "GET" {
                if let Some(id) = path.strip_prefix("/api/desktop/logs/requests/") {
                    return !id.is_empty()
                        && id.len() <= 768
                        && id != "."
                        && id != ".."
                        && !id.chars().any(|c| {
                            c == '/' || c == '\\' || c == '?' || c == '#' || c.is_control()
                        })
                        && !id.to_ascii_lowercase().contains("%2f")
                        && !id.to_ascii_lowercase().contains("%5c");
                }
            }
            false
        }
    }
}
fn endpoint_aliases(protocol: &str) -> &'static [&'static str] {
    match protocol {
        "anthropic" => &["anthropic", "anthropic-messages", "anthropic_messages"],
        "responses" => &["openai-responses", "responses", "codex_responses"],
        "chat" => &["openai", "openai-chat", "chat", "openai_chat", "openai_completions"],
        "gemini" => &["gemini", "google", "gemini-native", "gemini_native", "google_generative_ai"],
        _ => &[],
    }
}
fn qualified_models(key: &Value, data: &Value, names: &[String], protocol: &str, timestamp: i64) -> Result<(), String> {
    let denied = || "provider_selection_not_qualified".to_string();
    if key["status"].as_i64() != Some(1) { return Err(denied()); }
    let expiry = key["expired_time"].as_i64().ok_or_else(denied)?;
    if expiry != -1 && expiry <= timestamp { return Err(denied()); }
    if key["unlimited_quota"].as_bool() != Some(true) {
        let quota = key["remain_quota"].as_str().and_then(|v| v.parse::<i128>().ok()).ok_or_else(denied)?;
        if quota <= 0 { return Err(denied()); }
    }
    let groups: Vec<&str> = key["group"].as_str().ok_or_else(denied)?.split(',').map(str::trim).collect();
    let limits: Vec<&str> = key["model_limits"].as_str().ok_or_else(denied)?.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
    let items = data["items"].as_array().ok_or_else(denied)?;
    let meta = &data["pricing_meta"];
    let visible = meta["usable_group"].as_object().ok_or_else(denied)?;
    for name in names {
        if key["model_limits_enabled"].as_bool() == Some(true) && !limits.is_empty() && !limits.contains(&name.as_str()) { return Err(denied()); }
        let model = items.iter().find(|m| m["model_name"].as_str() == Some(name.as_str())).ok_or_else(denied)?;
        let effective = meta["default_resolution"][name]["effective_group"].as_str()
            .or_else(|| meta["default_effective_group"].as_str()).unwrap_or("");
        let enabled = model["enable_groups"].as_array().ok_or_else(denied)?;
        if !groups.iter().any(|g| {
            let g = if *g == "default" && !effective.is_empty() { effective } else { *g };
            g != "auto" && visible.contains_key(g) && enabled.iter().any(|v| v.as_str() == Some(g))
        }) { return Err(denied()); }
        let endpoints = model["supported_endpoint_types"].as_array().ok_or_else(denied)?;
        if !endpoints.iter().any(|e| e.as_str().is_some_and(|v| endpoint_aliases(protocol).contains(&v))) { return Err(denied()); }
    }
    Ok(())
}
impl AccountService {
    /// Re-read current account Key and visible models before local side effects.
    /// This never holds the account mutex across await; save subsequently takes
    /// the reveal/source guard to reject a generation change during these reads.
    pub async fn provider_qualification(
        &self, generation: u64, token_id: &str, selected_models: &[String], protocol: &str,
    ) -> Result<(), String> {
        if token_id.parse::<u64>().ok().filter(|n| *n > 0).is_none()
            || selected_models.is_empty() || selected_models.len() > 50
            || selected_models.iter().any(|m| m.is_empty() || m.len() > 256)
            || endpoint_aliases(protocol).is_empty()
        { return Err("invalid_provider_selection".into()); }
        let get = |path: String, query: Vec<(String, String)>| BusinessRequest {
            method: "GET".into(), path, query, body: None, generation, request_id: None,
        };
        let key = self.business_request(get(format!("/api/desktop/keys/{token_id}"), vec![]))
            .await.map_err(|e| e.code)?;
        let mut query = vec![("page".into(), "1".into()), ("page_size".into(), "100".into())];
        query.extend(selected_models.iter().map(|m| ("models".into(), m.clone())));
        let models = self.business_request(get("/api/desktop/models".into(), query))
            .await.map_err(|e| e.code)?;
        qualified_models(&key["data"], &models["data"], selected_models, protocol, now())
    }
    #[cfg(test)]
    pub(super) async fn business_auth_probe(&self, bearer: &str, contract: &str, user: Option<&str>) -> Result<Value, BusinessError> {
        let mut request = self.http.get(format!("{}/api/desktop/account", self.origin))
            .bearer_auth(bearer).header("X-Tuzi-Contract", contract);
        if let Some(user) = user { request = request.header("New-Api-User", user); }
        self.business_response(request, false).await
    }
    fn business_tokens(&self, generation: u64) -> Result<Tokens, BusinessError> {
        self.load();
        let i = self.inner.lock().unwrap();
        if i.record.generation != generation {
            return Err(BusinessError::new("stale_account", false));
        }
        if i.state.identity.is_none()
            || !matches!(
                i.state.status.as_str(),
                "connected" | "offline" | "refreshing"
            )
        {
            return Err(BusinessError::new("invalid_token", false));
        }
        i.record
            .tokens
            .clone()
            .ok_or_else(|| BusinessError::new("invalid_token", false))
    }
    pub async fn business_request(&self, request: BusinessRequest) -> Result<Value, BusinessError> {
        let id = request
            .request_id
            .clone()
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        if id.len() > 128 || id.is_empty() {
            return Err(BusinessError::new("invalid_request", false));
        }
        let (sender, receiver) = tokio::sync::watch::channel(false);
        {
            let mut pending = self.business_pending.lock().unwrap();
            if pending.len() >= 128 || pending.contains_key(&id) {
                return Err(BusinessError::new("conflict", false));
            }
            pending.insert(id.clone(), sender);
        }
        let result = self.business_request_inner(request, receiver).await;
        self.business_pending.lock().unwrap().remove(&id);
        result
    }
    async fn business_request_inner(
        &self,
        request: BusinessRequest,
        mut cancellation: tokio::sync::watch::Receiver<bool>,
    ) -> Result<Value, BusinessError> {
        if !allowed(&request.method, &request.path)
            || request.query.len() > 300
            || request
                .query
                .iter()
                .any(|(k, v)| k.len() > 128 || v.len() > 2048)
            || request.method == "GET" && request.body.is_some()
        {
            return Err(BusinessError::new("invalid_request", false));
        }
        let body = request
            .body
            .as_ref()
            .map(serde_json::to_vec)
            .transpose()
            .map_err(|_| BusinessError::new("invalid_request", false))?;
        let max = if request.path == "/api/desktop/model-performance/batch" {
            16384
        } else {
            65536
        };
        if body.as_ref().is_some_and(|v| v.len() > max) {
            return Err(BusinessError::new("invalid_request", false));
        }
        let readonly = request.method == "GET";
        let mut token = self.business_tokens(request.generation)?;
        if token.access_expires <= now() + 30 {
            let state = self.retry_inner(Some(&token.access_token)).await;
            if state.status != "connected" {
                return Err(state
                    .error
                    .map(BusinessError::from)
                    .unwrap_or_else(|| BusinessError::new("invalid_token", false)));
            }
            token = self.business_tokens(request.generation)?;
            if token.access_expires <= now() {
                return Err(BusinessError::new("invalid_token", false));
            }
        }
        let mut refreshed = false;
        let mut retries = 0;
        loop {
            if *cancellation.borrow() {
                return Err(BusinessError::new("request_cancelled", false));
            }
            self.business_tokens(request.generation)?;
            let mut builder = self
                .http
                .request(
                    reqwest::Method::from_bytes(request.method.as_bytes()).unwrap(),
                    format!("{}{}", self.origin, request.path),
                )
                .timeout(Duration::from_secs(30))
                .bearer_auth(&token.access_token)
                .header("X-Tuzi-Contract", "desktop-v1.1")
                .header("Accept", "application/json")
                .query(&request.query);
            if let Some(body) = &body {
                builder = builder
                    .header("Content-Type", "application/json")
                    .body(body.clone());
            }
            let result = tokio::select! {
                result = self.business_response(builder, !readonly) => result,
                _ = cancellation.changed() => Err(BusinessError::new("request_cancelled", !readonly)),
            };
            self.business_tokens(request.generation)?; // Discard late results, including revealed keys.
            match result {
                Err(e) if e.status == Some(401) && !refreshed => {
                    refreshed = true;
                    let state = self.retry_inner(Some(&token.access_token)).await;
                    if state.status != "connected" {
                        return Err(state
                            .error
                            .map(BusinessError::from)
                            .unwrap_or_else(|| BusinessError::new("invalid_token", false)));
                    }
                    token = self.business_tokens(request.generation)?;
                }
                Err(e)
                    if readonly
                        && retries < 2
                        && (e.code == "network_uncertain"
                            || e.status.is_some_and(|s| s >= 500)) =>
                {
                    retries += 1;
                    // Retry-After is a lower bound; long waits are returned to UI.
                    let delay = e.retry_after.unwrap_or(retries);
                    if delay > 2 {
                        return Err(e);
                    }
                    tokio::time::sleep(Duration::from_millis(
                        delay * 1000 + rand::random::<u8>() as u64,
                    ))
                    .await;
                }
                Err(e) if e.status == Some(401) => {
                    self.fail(request.generation, AccountError::new("invalid_token"), true);
                    return Err(e);
                }
                Ok(value) => {
                    if request.method=="POST" {
                        if let Some(token_id)=request.path.strip_prefix("/api/desktop/keys/").and_then(|rest|rest.strip_suffix("/reveal")) {
                            let key=value.pointer("/data/key").and_then(Value::as_str).ok_or_else(||BusinessError::new("invalid_response",false))?;
                            self.remember_model_key_reveal(request.generation,token_id,key)?;
                        }
                    }
                    return Ok(value);
                }
                other => return other,
            }
        }
    }
    async fn business_response(
        &self,
        builder: reqwest::RequestBuilder,
        write: bool,
    ) -> Result<Value, BusinessError> {
        let mut response = builder
            .send()
            .await
            .map_err(|_| BusinessError::new("network_uncertain", write))?;
        let status = response.status().as_u16();
        let retry = response
            .headers()
            .get("retry-after")
            .and_then(|x| x.to_str().ok())
            .and_then(|x| x.parse().ok());
        let mut bytes = zeroize::Zeroizing::new(Vec::new());
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| BusinessError::new("network_uncertain", write))?
        {
            if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
                return Err(BusinessError::new("invalid_response", write));
            }
            bytes.extend_from_slice(&chunk);
        }
        let data: Value = match serde_json::from_slice(&bytes){Ok(data)=>data,Err(_) if !(200..300).contains(&status)=>Value::Null,Err(_)=>return Err(BusinessError::new("invalid_response",write))};
        if (200..300).contains(&status) {
            if data["success"] != true
                || data["meta"]["contract_version"] != "desktop-v1.1"
                || data.get("data").is_none()
            {
                return Err(BusinessError::new("invalid_response", write));
            }
            return Ok(data);
        }
        let code = match status {
            400 => "invalid_request",
            401 => "invalid_token",
            403 => "insufficient_scope",
            404 => "not_found",
            409 => "conflict",
            429 => "rate_limited",
            503 => "dependency_unavailable",
            _ => "server_error",
        };
        let mut e = BusinessError::new(code, write && status >= 500);
        e.status = Some(status);
        e.retry_after = retry;
        // Only protocol symbols cross into UI; never relay upstream messages.
        if let Some(code) = data["error"]["code"]
            .as_str()
            .filter(|s| s.len() <= 64 && s.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'))
        {
            e.code = code.into();
            e.message = code.into();
        }
        e.required_scope = data["error"]["required_scope"]
            .as_str()
            .filter(|s| SCOPES.split_whitespace().any(|scope| scope == *s))
            .map(str::to_owned);
        Err(e)
    }
}
#[tauri::command]
pub async fn account_request(
    service: tauri::State<'_, Arc<AccountService>>,
    request: BusinessRequest,
) -> Result<Value, BusinessError> {
    service.business_request(request).await
}
#[tauri::command]
pub fn account_cancel_request(service: tauri::State<'_, Arc<AccountService>>, request_id: String) {
    if let Some(sender) = service.business_pending.lock().unwrap().get(&request_id) {
        let _ = sender.send(true);
    }
}
fn web_target(target: &str) -> Option<&'static str> {
    match target {
        "topup" | "redemption" => Some("https://api.tu-zi.com/console/topup"),
        "personal" => Some("https://api.tu-zi.com/console/personal"),
        "coding" => Some("https://coding.tu-zi.com/reseller/"),
        "gaccode" => Some("https://gaccode.com/subscriptions"),
        _ => None,
    }
}
#[tauri::command]
pub async fn account_open_web(app: tauri::AppHandle, target: String) -> Result<(), BusinessError> {
    let url = web_target(&target).ok_or_else(|| BusinessError::new("invalid_request", false))?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| BusinessError::new("browser_unavailable", false))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        routing::{get, post},
        Json, Router,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[derive(Default)]
    struct Store(Mutex<Option<Record>>);
    impl TokenStore for Store {
        fn read(&self) -> Result<Option<Record>, AccountError> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn write(&self, r: &Record) -> Result<(), AccountError> {
            *self.0.lock().unwrap() = Some(r.clone());
            Ok(())
        }
    }
    fn service(origin: &str, conn: &str, grant: i64) -> Arc<AccountService> {
        let store = Arc::new(Store::default());
        let s = Arc::new(AccountService::with_store(store, origin, CLIENT).unwrap());
        let identity = Identity {
            user_id: "1".into(),
            username: "synthetic".into(),
            display_name: "Synthetic".into(),
            connection_id: conn.into(),
        };
        {
            let mut i = s.inner.lock().unwrap();
            i.loaded = true;
            i.record.origin = origin.into();
            i.record.identity = Some(identity.clone());
            i.record.tokens = Some(Tokens {
                access_token: "S".repeat(43),
                refresh_token: "R".repeat(43),
                user_id: "1".into(),
                connection_id: conn.into(),
                access_expires: now() + 1800,
                refresh_expires: now() + 604800,
                grant_expires: grant,
            });
            i.state.status = "connected".into();
            i.state.identity = Some(identity);
            s.persist(&i.record).unwrap();
        }
        s
    }
    fn request(method: &str, path: &str) -> BusinessRequest {
        BusinessRequest {
            method: method.into(),
            path: path.into(),
            query: vec![],
            body: None,
            generation: 0,
            request_id: None,
        }
    }
    fn envelope(data: Value) -> Value {
        serde_json::json!({"success":true,"message":"","data":data,"meta":{"contract_version":"desktop-v1.1","request_id":"synthetic","generated_at":now()}})
    }
    #[test]
    fn business_allowlist_and_web_urls() {
        for path in [
            "https://evil.test/api/desktop/account",
            "/api/user/self",
            "/api/desktop/keys/1/../2/reveal",
            "/api/desktop/logs/requests/%2fsecret",
            "/api/desktop/keys/1?key=secret",
            "/api/desktop/keys/1/export",
        ] {
            assert!(!allowed("GET", path));
            assert!(!allowed("POST", path));
        }
        assert!(allowed("POST", "/api/desktop/keys/1/reveal"));
        assert!(!allowed("GET", "/api/desktop/keys/1/reveal"));
        assert_eq!(web_target("redemption"), web_target("topup"));
        assert_eq!(
            web_target("coding"),
            Some("https://coding.tu-zi.com/reseller/")
        );
        assert_eq!(
            web_target("gaccode"),
            Some("https://gaccode.com/subscriptions")
        );
        assert!(web_target("https://evil.test").is_none());
    }
    #[tokio::test]
    async fn business_concurrent_401_refresh_once_and_errors_never_refresh() {
        let refreshes = Arc::new(AtomicUsize::new(0));
        let count = refreshes.clone();
        let grant = now() + 2592000;
        let conn = uuid::Uuid::new_v4().to_string();
        let wire_conn = conn.clone();
        let app = Router::new()
            .route("/api/desktop/account", get(|headers: axum::http::HeaderMap| async move {
                assert_eq!(headers["X-Tuzi-Contract"], "desktop-v1.1");
                if headers["authorization"].to_str().unwrap().contains(&"S".repeat(43)) {
                    (axum::http::StatusCode::UNAUTHORIZED, Json(serde_json::json!({"error":{"code":"invalid_token"}})))
                } else { (axum::http::StatusCode::OK, Json(envelope(serde_json::json!({"user_id":"1"})))) }
            }))
            .route("/api/desktop/profile", get(|| async { (axum::http::StatusCode::FORBIDDEN, Json(serde_json::json!({"error":{"code":"insufficient_scope","required_scope":"profile:read"}}))) }))
            .route("/api/desktop/keys", get(|| async { (axum::http::StatusCode::TOO_MANY_REQUESTS, [("retry-after","120")], Json(serde_json::json!({"error":{"code":"rate_limited"}}))) }))
            .route("/api/oauth-provider/token", post(move || { let count=count.clone(); let conn=wire_conn.clone(); async move {
                count.fetch_add(1, Ordering::SeqCst); tokio::time::sleep(Duration::from_millis(30)).await;
                Json(serde_json::json!({"access_token":"N".repeat(43),"refresh_token":"T".repeat(43),"token_type":"Bearer","scope":SCOPES,"expires_in":1800,"refresh_expires_in":604800,"grant_expires_at":grant,"user_id":"1","connection_id":conn,"scope_version":"desktop-v1"}))
            }}))
            .route("/api/oauth-provider/userinfo", get(|| async { Json(serde_json::json!({"sub":"1","user_id":"1","preferred_username":"synthetic","name":"Synthetic"})) }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let s = service(&origin, &conn, grant);
        let (a, b) = tokio::join!(
            s.business_request(request("GET", "/api/desktop/account")),
            s.business_request(request("GET", "/api/desktop/account"))
        );
        assert_eq!(a.unwrap()["data"]["user_id"], "1");
        assert!(b.is_ok());
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        let forbidden = s
            .business_request(request("GET", "/api/desktop/profile"))
            .await
            .unwrap_err();
        assert_eq!(forbidden.status, Some(403));
        let limited = s
            .business_request(request("GET", "/api/desktop/keys"))
            .await
            .unwrap_err();
        assert_eq!(limited.retry_after, Some(120));
        assert_eq!(refreshes.load(Ordering::SeqCst), 1);
        task.abort();
    }
    #[tokio::test]
    async fn business_write_unknown_is_not_retried_and_late_secret_is_discarded() {
        let writes = Arc::new(AtomicUsize::new(0));
        let count = writes.clone();
        let entered = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let notify = entered.clone();
        let gate = release.clone();
        let app = Router::new()
            .route(
                "/api/desktop/keys",
                post(move || {
                    let count = count.clone();
                    async move {
                        count.fetch_add(1, Ordering::SeqCst);
                        (
                            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                            Json(serde_json::json!({"error":{"code":"internal_error"}})),
                        )
                    }
                }),
            )
            .route(
                "/api/desktop/keys/1/reveal",
                post(move || {
                    let notify = notify.clone();
                    let gate = gate.clone();
                    async move {
                        notify.notify_one();
                        gate.notified().await;
                        Json(envelope(serde_json::json!({"key":"synthetic-model-key"})))
                    }
                }),
            )
            .route(
                "/api/oauth-provider/revoke",
                post(|| async { axum::http::StatusCode::OK }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let s = service(&origin, &uuid::Uuid::new_v4().to_string(), now() + 2592000);
        let error = s
            .business_request(request("POST", "/api/desktop/keys"))
            .await
            .unwrap_err();
        assert!(error.outcome_unknown);
        assert_eq!(writes.load(Ordering::SeqCst), 1);
        let other = s.clone();
        let pending = tokio::spawn(async move {
            other
                .business_request(request("POST", "/api/desktop/keys/1/reveal"))
                .await
        });
        tokio::time::timeout(Duration::from_secs(2), entered.notified())
            .await
            .unwrap();
        s.logout().await;
        release.notify_one();
        assert!(matches!(
            pending.await.unwrap().unwrap_err().code.as_str(),
            "stale_account" | "request_cancelled"
        ));
        task.abort();
    }
    #[tokio::test]
    async fn query_cancellation_keeps_connection_and_source_guard_rejects_other_user() {
        let entered = Arc::new(tokio::sync::Notify::new());
        let notify = entered.clone();
        let app = Router::new().route(
            "/api/desktop/account",
            get(move || {
                let notify = notify.clone();
                async move {
                    notify.notify_one();
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    Json(envelope(serde_json::json!({"user_id":"1"})))
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let s = service(&origin, &uuid::Uuid::new_v4().to_string(), now() + 2592000);
        assert!(s
            .with_confirmed_source("2", 0, || -> Result<(), String> {
                panic!("unauthorized source must never write")
            })
            .is_err());
        assert!(s.with_confirmed_source("1", 0, || Ok(())).is_ok());
        let other = s.clone();
        let mut req = request("GET", "/api/desktop/account");
        req.request_id = Some("synthetic-cancel".into());
        let pending = tokio::spawn(async move { other.business_request(req).await });
        tokio::time::timeout(Duration::from_secs(2), entered.notified())
            .await
            .unwrap();
        s.business_pending
            .lock()
            .unwrap()
            .get("synthetic-cancel")
            .unwrap()
            .send(true)
            .unwrap();
        let error = tokio::time::timeout(Duration::from_secs(2), pending)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert_eq!(error.code, "request_cancelled");
        assert!(!error.outcome_unknown);
        assert_eq!(s.state().status, "connected");
        assert!(s.business_pending.lock().unwrap().is_empty());
        task.abort();
    }
    #[test]
    fn provider_qualification_checks_current_key_models_and_virtual_default() {
        let mut key=serde_json::json!({"status":1,"expired_time":-1,"unlimited_quota":false,"remain_quota":"9007199254740993123","group":"default","model_limits_enabled":true,"model_limits":"synthetic-model"});
        let mut data=serde_json::json!({"items":[{"model_name":"synthetic-model","enable_groups":["vip"],"supported_endpoint_types":["openai-responses"]}],"pricing_meta":{"usable_group":{"vip":"VIP"},"default_effective_group":"vip","default_resolution":{}}});
        let names=vec!["synthetic-model".into()];
        assert!(qualified_models(&key,&data,&names,"responses",100).is_ok());
        for protocol in ["chat","gemini","anthropic","unknown"] {assert!(qualified_models(&key,&data,&names,protocol,100).is_err());}
        key["status"]=serde_json::json!(2); assert!(qualified_models(&key,&data,&names,"responses",100).is_err());key["status"]=serde_json::json!(1);
        key["expired_time"]=serde_json::json!(99);assert!(qualified_models(&key,&data,&names,"responses",100).is_err());key["expired_time"]=serde_json::json!(-1);
        key["remain_quota"]=serde_json::json!("0");assert!(qualified_models(&key,&data,&names,"responses",100).is_err());key["remain_quota"]=serde_json::json!("1");
        key["model_limits"]=serde_json::json!("other-model");assert!(qualified_models(&key,&data,&names,"responses",100).is_err());key["model_limits"]=serde_json::json!("synthetic-model");
        data["pricing_meta"]["usable_group"]=serde_json::json!({});assert!(qualified_models(&key,&data,&names,"responses",100).is_err());
        assert!(qualified_models(&key,&data,&["missing".into()],"responses",100).is_err());
    }
    #[test]
    fn revealed_model_key_proof_is_exact_ephemeral_and_consumed() {
        let s=service("http://127.0.0.1:1",&uuid::Uuid::new_v4().to_string(),now()+2592000);
        let key="sk-synthetic-reveal-T15";
        let changed=std::sync::atomic::AtomicBool::new(false);
        assert!(s.with_confirmed_model_source("1",0,"1",key,||{changed.store(true,Ordering::SeqCst);Ok(())}).is_err());assert!(!changed.load(Ordering::SeqCst));
        s.remember_model_key_reveal(0,"1",key).unwrap();
        assert!(s.with_confirmed_model_source("1",0,"2",key,||Ok(())).is_err());
        assert!(s.with_confirmed_model_source("1",0,"1","sk-synthetic-other",||Ok(())).is_err());
        assert!(s.with_confirmed_model_source("1",0,"1","desktop_synthetic",||Ok(())).is_err());
        assert!(s.with_confirmed_model_source("1",0,"1",key,||Err::<(),_>("synthetic compensated failure".into())).is_err());
        assert!(s.with_confirmed_model_source("1",0,"1",key,||Ok(())).is_ok());
        assert!(s.with_confirmed_model_source("1",0,"1",key,||Ok(())).is_err());
        s.remember_model_key_reveal(0,"1",key).unwrap();s.inner.lock().unwrap().model_key_proof.as_mut().unwrap().expires=now()-1;
        assert!(s.with_confirmed_model_source("1",0,"1",key,||Ok(())).is_err());
    }

    #[tokio::test]
    async fn successful_business_reveal_records_native_model_source_proof() {
        use axum::{Router,routing::post,Json};
        let app=Router::new().route("/api/desktop/keys/7/reveal",post(||async{Json(envelope(serde_json::json!({"key":"sk-synthetic-business-reveal"})))}));
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let origin=format!("http://{}",listener.local_addr().unwrap());let task=tokio::spawn(async move{axum::serve(listener,app).await.unwrap()});
        let s=service(&origin,&uuid::Uuid::new_v4().to_string(),now()+2592000);
        let value=s.business_request(request("POST","/api/desktop/keys/7/reveal")).await.unwrap();assert_eq!(value["data"]["key"],"sk-synthetic-business-reveal");
        assert!(s.with_confirmed_model_source("1",0,"7","sk-synthetic-business-reveal",||Ok(())).is_ok());assert!(s.inner.lock().unwrap().model_key_proof.is_none());task.abort();
    }

    #[tokio::test]
    async fn non_json_errors_preserve_status_and_retry_without_body() {
        use axum::{Router,routing::get};
        let app=Router::new().route("/api/desktop/account",get(||async{(axum::http::StatusCode::TOO_MANY_REQUESTS,[("retry-after","60")],"synthetic non-JSON secret body")}));
        let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let origin=format!("http://{}",listener.local_addr().unwrap());let task=tokio::spawn(async move{axum::serve(listener,app).await.unwrap()});let s=service(&origin,&uuid::Uuid::new_v4().to_string(),now()+2592000);
        let error=s.business_request(request("GET","/api/desktop/account")).await.unwrap_err();assert_eq!(error.status,Some(429));assert_eq!(error.retry_after,Some(60));assert_eq!(error.code,"rate_limited");assert!(!serde_json::to_string(&error).unwrap().contains("secret body"));task.abort();
    }

}
