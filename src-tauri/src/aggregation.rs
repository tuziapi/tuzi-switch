//! Explicit model-to-provider dispatch. Unknown reserved IDs fail closed.
use crate::{
    app_config::AppType, database::Database, native_tools::private_write, provider::Provider,
    store::AppState,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
};
static MODE_LOCK: tokio::sync::RwLock<()> = tokio::sync::RwLock::const_new(());
pub(crate) fn read_operation() -> Result<tokio::sync::RwLockReadGuard<'static, ()>, String> {
    MODE_LOCK
        .try_read()
        .map_err(|_| "Connection mode is changing; retry when it finishes".into())
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub provider_id: String,
    pub model: String,
    pub display_name: String,
    #[serde(default = "default_window")]
    pub context_window: u64,
}
fn default_window() -> u64 {
    128000
}
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    #[serde(default)]
    pub default_provider_id: String,
    #[serde(default)]
    pub models: Vec<Model>,
}
#[derive(Clone, Deserialize, Serialize)]
struct Overlay {
    before: Option<Vec<u8>>,
    written: String,
    #[serde(default)]
    target: String,
}
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AggregationState {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub plan: Plan,
    #[serde(default)]
    overlays: BTreeMap<String, Overlay>,
}
fn app(app: &str) -> Result<AppType, String> {
    match app {
        "claude" => Ok(AppType::Claude),
        "codex" => Ok(AppType::Codex),
        _ => Err("Aggregation supports Claude Code and Codex only".into()),
    }
}
fn path(app: &str) -> PathBuf {
    crate::config::get_app_config_dir()
        .join("aggregation")
        .join(format!("{app}.json"))
}
fn hash(bytes: Option<&[u8]>) -> String {
    bytes
        .map(|b| format!("{:x}", Sha256::digest(b)))
        .unwrap_or_else(|| "missing".into())
}
fn bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if !meta.is_file() || meta.len() > 8 * 1024 * 1024 {
            return Err("Aggregation requires a regular configuration file under 8 MiB".into());
        }
    }
    match fs::read(path) {
        Ok(v) => Ok(Some(v)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => Err("Cannot read aggregation configuration".into()),
    }
}
pub(crate) fn load(app_name: &str) -> Result<AggregationState, String> {
    app(app_name)?;
    match bytes(&path(app_name))? {
        Some(b) => serde_json::from_slice(&b)
            .map_err(|_| "Invalid aggregation state; restore before continuing".into()),
        None => Ok(AggregationState::default()),
    }
}
fn store(app: &str, state: &AggregationState) -> Result<(), String> {
    private_write(
        &path(app),
        &serde_json::to_vec(state).map_err(|_| "Cannot encode aggregation state")?,
    )
}
pub(crate) fn ensure_inactive(app: &str) -> Result<(), String> {
    if !matches!(app, "claude" | "codex") {
        return Ok(());
    }
    let state = load(app)?;
    if state.enabled || !state.overlays.is_empty() {
        Err("Exit aggregation before changing providers or connection mode".into())
    } else {
        Ok(())
    }
}
fn key(provider_id: &str) -> String {
    provider_id
        .as_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
pub(crate) fn model_id(app: &str, model: &Model, default: &str) -> String {
    if model.provider_id == default {
        return model.model.clone();
    }
    if app == "claude" {
        format!("ccs-claude-{}--{}", key(&model.provider_id), model.model)
    } else {
        format!("ccs-{}/{}", key(&model.provider_id), model.model)
    }
}
fn validate(db: &Database, app_name: &str, plan: &Plan) -> Result<(), String> {
    app(app_name)?;
    if plan.models.is_empty() || plan.models.len() > 200 {
        return Err("Choose 1–200 aggregation models".into());
    }
    if !plan
        .models
        .iter()
        .any(|m| m.provider_id == plan.default_provider_id)
    {
        return Err("Default provider must publish at least one model".into());
    }
    let mut seen = HashSet::new();
    for model in &plan.models {
        if model.model.trim().is_empty()
            || model.model.starts_with("ccs-")
            || model.context_window == 0
            || !seen.insert((model.provider_id.clone(), model.model.clone()))
        {
            return Err("Invalid, duplicate or reserved model ID".into());
        }
        let provider = db
            .get_provider_by_id(&model.provider_id, app_name)
            .map_err(|_| "Cannot read provider")?
            .ok_or("Aggregation provider no longer exists")?;
        if !provider.settings_config.is_object() {
            return Err("Invalid provider settings".into());
        }
        let adapter = crate::proxy::providers::get_adapter(&app(app_name)?);
        adapter
            .extract_base_url(&provider)
            .map_err(|_| "Aggregation provider endpoint is missing")?;
        if adapter.extract_auth(&provider).is_none() {
            return Err("Aggregation provider credentials are unavailable".into());
        }
        if provider.category.as_deref() == Some("official")
            || provider.is_codex_oauth()
            || provider
                .meta
                .as_ref()
                .and_then(|m| m.provider_type.as_deref())
                .is_some_and(|v| v == "github_copilot")
        {
            return Err("This version supports explicit API providers in aggregation; use direct mode for official OAuth accounts".into());
        }
    }
    Ok(())
}
fn files(app: &str) -> BTreeMap<String, PathBuf> {
    if app == "claude" {
        BTreeMap::from([("config".into(), crate::config::get_claude_settings_path())])
    } else {
        BTreeMap::from([
            (
                "config".into(),
                crate::codex_config::get_codex_config_path(),
            ),
            (
                "catalog".into(),
                crate::config::get_app_config_dir().join("aggregation/codex-models.json"),
            ),
        ])
    }
}
fn overlay_files(
    app: &str,
    plan: &Plan,
    originals: &BTreeMap<String, Option<Vec<u8>>>,
) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let raw = originals
        .get("config")
        .and_then(|b| b.as_deref())
        .ok_or("Connect the tool before enabling aggregation")?;
    let text = std::str::from_utf8(raw).map_err(|_| "Tool configuration is not UTF-8")?;
    let mut writes = BTreeMap::new();
    if app == "claude" {
        let mut value: Value = serde_json::from_str(text).map_err(|_| "Invalid Claude settings")?;
        if !value.is_object() {
            return Err("Claude settings must be an object".into());
        }
        let default = plan
            .models
            .iter()
            .find(|m| m.provider_id == plan.default_provider_id)
            .ok_or("Missing default model")?;
        if value.get("env").is_none() {
            value["env"] = json!({});
        }
        if !value["env"].is_object() {
            return Err("Invalid Claude environment".into());
        }
        value["env"]["ANTHROPIC_MODEL"] = json!(default.model);
        value["env"]["CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"] = json!("1");
        for field in [
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_FABLE_MODEL",
        ] {
            value["env"][field] = json!(default.model);
        }
        if let Some(env) = value["env"].as_object_mut() {
            env.remove("CLAUDE_CODE_SUBAGENT_MODEL");
        }
        writes.insert(
            "config".into(),
            serde_json::to_vec_pretty(&value).map_err(|_| "Cannot encode settings")?,
        );
    } else {
        let mut doc = text
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| "Invalid Codex TOML")?;
        let catalog_path = files(app).remove("catalog").ok_or("Missing catalog path")?;
        doc["model_catalog_json"] = toml_edit::value(catalog_path.to_string_lossy().as_ref());
        let default = plan
            .models
            .iter()
            .find(|m| m.provider_id == plan.default_provider_id)
            .ok_or("Missing default model")?;
        doc["model"] = toml_edit::value(default.model.as_str());
        let models=plan.models.iter().map(|m|json!({"model":model_id(app,m,&plan.default_provider_id),"displayName":m.display_name,"contextWindow":m.context_window})).collect::<Vec<_>>();
        let catalog = crate::codex_config::aggregation_model_catalog(&models).map_err(|_| {
            "Codex model template is unavailable. Start Codex once before enabling aggregation."
        })?;
        writes.insert(
            "catalog".into(),
            serde_json::to_vec_pretty(&catalog).map_err(|_| "Cannot encode model catalog")?,
        );
        writes.insert("config".into(), doc.to_string().into_bytes());
    }
    Ok(writes)
}
/// Overlay journal is persisted before any write; retries recover partial writes.
fn restore_overlay(app: &str, state: &mut AggregationState) -> Result<(), String> {
    let paths = files(app);
    for (name, overlay) in &state.overlays {
        let p = paths.get(name).ok_or("Unknown overlay file")?;
        if overlay.target != p.to_string_lossy() {
            return Err("Tool directory changed; restore its original directory before recovering aggregation".into());
        }
        let actual = hash(bytes(p)?.as_deref());
        if actual != overlay.written && actual != hash(overlay.before.as_deref()) {
            return Err("Tool configuration was edited externally. Keep the backup and resolve the conflict before exiting aggregation.".into());
        }
    }
    for (name, overlay) in &state.overlays {
        let p = &paths[name];
        if hash(bytes(p)?.as_deref()) == hash(overlay.before.as_deref()) {
            continue;
        }
        match &overlay.before {
            Some(b) => private_write(p, b)?,
            None => fs::remove_file(p).map_err(|_| "Cannot remove aggregation overlay")?,
        }
    }
    state.enabled = false;
    state.overlays.clear();
    store(app, state)
}
pub(crate) fn restore_before_route_exit(app_name: &str) -> Result<(), String> {
    if !matches!(app_name, "claude" | "codex") {
        return Ok(());
    }
    let mut state = load(app_name)?;
    if state.enabled || !state.overlays.is_empty() {
        restore_overlay(app_name, &mut state)?;
    }
    Ok(())
}
#[tauri::command]
pub fn aggregation_read(app_name: String) -> Result<Value, String> {
    let state = load(&app_name)?;
    Ok(
        json!({"enabled":state.enabled,"plan":state.plan,"needsRecovery":!state.enabled && !state.overlays.is_empty()}),
    )
}
#[tauri::command]
pub async fn aggregation_apply(
    state: tauri::State<'_, AppState>,
    app_name: String,
    plan: Plan,
    enabled: bool,
) -> Result<(), String> {
    let _guard = MODE_LOCK.write().await;
    apply_inner(state.inner(), &app_name, plan, enabled).await
}
async fn apply_inner(
    state: &AppState,
    app_name: &str,
    plan: Plan,
    enabled: bool,
) -> Result<(), String> {
    let app_type = app(&app_name)?;
    let mut previous = load(&app_name)?;
    if !enabled {
        return restore_overlay(&app_name, &mut previous);
    }
    if previous.enabled || !previous.overlays.is_empty() {
        return Err("Exit aggregation before editing its plan".into());
    }
    validate(&state.db, &app_name, &plan)?;
    let current = crate::settings::get_current_provider(&app_type).unwrap_or_default();
    if current != plan.default_provider_id {
        return Err("Enable the default provider on its card before entering aggregation".into());
    }
    let taken = state.proxy_service.get_takeover_status().await?;
    let already = if app_name == "claude" {
        taken.claude
    } else {
        taken.codex
    };
    // Build and validate the catalog before changing native routing state.
    let paths = files(&app_name);
    let before: BTreeMap<_, _> = paths
        .iter()
        .map(|(k, p)| bytes(p).map(|b| (k.clone(), b)))
        .collect::<Result<_, _>>()?;
    overlay_files(&app_name, &plan, &before)?;
    if app_name == "codex" {
        crate::services::codex_image_compat::set_manual_takeover(state, true).await?;
    } else {
        state
            .proxy_service
            .set_takeover_for_app(&app_name, true)
            .await?;
    }
    let result = (|| {
        let _provider_operation = crate::services::provider::OperationGuard::acquire()
            .map_err(|_| "Provider operation unavailable")?;
        validate(&state.db, &app_name, &plan)?;
        if crate::settings::get_current_provider(&app_type).as_deref()
            != Some(plan.default_provider_id.as_str())
        {
            return Err("Default provider changed during mode setup".into());
        }
        let originals: BTreeMap<_, _> = paths
            .iter()
            .map(|(k, p)| bytes(p).map(|b| (k.clone(), b)))
            .collect::<Result<_, _>>()?;
        let writes = overlay_files(&app_name, &plan, &originals)?;
        let mut pending = AggregationState {
            enabled: false,
            plan: plan.clone(),
            overlays: writes
                .iter()
                .map(|(k, b)| {
                    (
                        k.clone(),
                        Overlay {
                            before: originals[k].clone(),
                            written: hash(Some(b)),
                            target: paths[k].to_string_lossy().into_owned(),
                        },
                    )
                })
                .collect(),
        };
        store(&app_name, &pending)?;
        for (name, data) in &writes {
            if hash(bytes(&paths[name])?.as_deref()) != hash(originals[name].as_deref()) {
                return Err("Tool configuration changed during aggregation setup".into());
            }
            if let Err(error) = private_write(&paths[name], data) {
                let recovery = restore_overlay(&app_name, &mut pending);
                return Err(format!("{error}; overlay recovery: {recovery:?}"));
            }
        }
        pending.enabled = true;
        store(&app_name, &pending)
    })();
    if result.is_err() && !already {
        let mut pending = load(&app_name)?;
        restore_overlay(&app_name, &mut pending)?;
        if app_name == "codex" {
            crate::services::codex_image_compat::set_manual_takeover(state, false).await?;
        } else {
            state
                .proxy_service
                .set_takeover_for_app(&app_name, false)
                .await?;
        }
    }
    result
}
/// Returns the sole selected provider and decoded upstream model; never runs failover.
pub(crate) fn resolve(
    db: &Database,
    app_name: &str,
    requested: &str,
) -> Result<Option<(Provider, String)>, String> {
    if !matches!(app_name, "claude" | "codex") {
        return Ok(None);
    }
    let state = load(app_name)?;
    if !state.enabled {
        if requested.starts_with("ccs-") {
            return Err("Aggregation model is inactive".into());
        }
        return Ok(None);
    }
    let selected = state
        .plan
        .models
        .iter()
        .find(|m| model_id(app_name, m, &state.plan.default_provider_id) == requested);
    let (provider_id, upstream) = if let Some(m) = selected {
        (&m.provider_id, m.model.as_str())
    } else if requested.starts_with("ccs-") {
        return Err("Unknown or removed aggregation model".into());
    } else {
        (&state.plan.default_provider_id, requested)
    };
    let mut provider = db
        .get_provider_by_id(provider_id, app_name)
        .map_err(|_| "Cannot read aggregation provider")?
        .ok_or("Aggregation provider was deleted")?;
    // Bypass legacy single-provider mapping for the exact selected model, including Codex Chat conversion.
    if let Some(env) = provider
        .settings_config
        .get_mut("env")
        .and_then(Value::as_object_mut)
    {
        for name in [
            "ANTHROPIC_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
        ] {
            env.remove(name);
        }
    }
    provider.settings_config["modelCatalog"] = json!({"models":[{"model":upstream}]});
    Ok(Some((provider, upstream.to_owned())))
}
pub(crate) fn discovery(app_name: &str) -> Result<Value, String> {
    let state = load(app_name)?;
    let data: Vec<Value> = if state.enabled {
        state.plan.models.iter().map(|m|json!({"id":model_id(app_name,m,&state.plan.default_provider_id),"type":"model","display_name":m.display_name,"created_at":"2026-01-01T00:00:00Z"})).collect()
    } else {
        vec![]
    };
    Ok(
        json!({"data":data,"has_more":false,"first_id":data.first().and_then(|m|m.get("id")),"last_id":data.last().and_then(|m|m.get("id"))}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestHome {
        dir: tempfile::TempDir,
        previous: Option<std::ffi::OsString>,
    }
    impl TestHome {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let previous = std::env::var_os("CC_SWITCH_TEST_HOME");
            std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
            crate::settings::reload_settings().unwrap();
            Self { dir, previous }
        }
    }
    impl Drop for TestHome {
        fn drop(&mut self) {
            match &self.previous {
                Some(v) => std::env::set_var("CC_SWITCH_TEST_HOME", v),
                None => std::env::remove_var("CC_SWITCH_TEST_HOME"),
            }
        }
    }
    fn plan() -> Plan {
        Plan {
            default_provider_id: "a".into(),
            models: vec![
                Model {
                    provider_id: "a".into(),
                    model: "synthetic-a".into(),
                    display_name: "Synthetic A".into(),
                    context_window: 128000,
                },
                Model {
                    provider_id: "b".into(),
                    model: "vendor/synthetic-b".into(),
                    display_name: "Synthetic B".into(),
                    context_window: 128000,
                },
            ],
        }
    }
    #[tokio::test]
    #[serial_test::serial]
    #[ignore = "requires installed Claude Code and Codex CLI binaries"]
    async fn installed_clis_route_prefixed_models_through_aggregation() {
        use axum::{routing::post, Json, Router};
        use std::{process::Command, sync::Arc};
        let home = TestHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let requests = Arc::new(tokio::sync::Mutex::new(Vec::<Value>::new()));
        let handler = |seen: Arc<tokio::sync::Mutex<Vec<Value>>>, responses: bool| {
            move |headers: axum::http::HeaderMap, Json(body): Json<Value>| async move {
                seen.lock().await.push(json!({"model":body["model"],"key":headers.get("authorization").and_then(|v|v.to_str().ok())}));
                let events = if responses {
                    vec![
                        json!({"type":"response.created","response":{"id":"resp_synthetic","object":"response","created_at":1,"status":"in_progress","output":[]}}),
                        json!({"type":"response.output_item.added","output_index":0,"item":{"id":"msg_synthetic","type":"message","status":"in_progress","role":"assistant","content":[]}}),
                        json!({"type":"response.content_part.added","item_id":"msg_synthetic","output_index":0,"content_index":0,"part":{"type":"output_text","text":"","annotations":[]}}),
                        json!({"type":"response.output_text.delta","item_id":"msg_synthetic","output_index":0,"content_index":0,"delta":"synthetic-ok"}),
                        json!({"type":"response.output_item.done","output_index":0,"item":{"id":"msg_synthetic","type":"message","status":"completed","role":"assistant","content":[{"type":"output_text","text":"synthetic-ok","annotations":[]}]}}),
                        json!({"type":"response.completed","response":{"id":"resp_synthetic","object":"response","created_at":1,"status":"completed","model":"vendor/synthetic-b","output":[],"usage":{"input_tokens":1,"input_tokens_details":{"cached_tokens":0},"output_tokens":1,"output_tokens_details":{"reasoning_tokens":0},"total_tokens":2}}}),
                    ]
                } else {
                    vec![
                        json!({"type":"message_start","message":{"id":"synthetic","type":"message","role":"assistant","model":"vendor/synthetic-b","content":[],"stop_reason":null,"usage":{"input_tokens":1,"output_tokens":0}}}),
                        json!({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}),
                        json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"synthetic-ok"}}),
                        json!({"type":"content_block_stop","index":0}),
                        json!({"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}),
                        json!({"type":"message_stop"}),
                    ]
                };
                let stream = events
                    .iter()
                    .enumerate()
                    .map(|(index, event)| {
                        let mut event = event.clone();
                        event["sequence_number"] = json!(index);
                        format!(
                            "event: {}\ndata: {}\n\n",
                            event["type"].as_str().unwrap(),
                            event
                        )
                    })
                    .collect::<String>();
                (
                    [(axum::http::header::CONTENT_TYPE, "text/event-stream")],
                    stream,
                )
            }
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream = format!("http://{}", listener.local_addr().unwrap());
        let router = Router::new()
            .route("/v1/messages", post(handler(requests.clone(), false)))
            .route("/v1/responses", post(handler(requests.clone(), true)));
        let upstream_task =
            tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        for app_name in ["claude", "codex"] {
            for id in ["a", "b"] {
                let settings = if app_name == "claude" {
                    json!({"env":{"ANTHROPIC_BASE_URL":upstream,"ANTHROPIC_AUTH_TOKEN":format!("SYNTHETIC_{id}")}})
                } else {
                    json!({"auth":{"OPENAI_API_KEY":format!("SYNTHETIC_{id}")},"config":format!("model_provider = \"synthetic\"\n[model_providers.synthetic]\nbase_url = \"{upstream}/v1\"\nwire_api = \"responses\"\n")})
                };
                db.save_provider(
                    app_name,
                    &Provider::with_id(id.into(), id.into(), settings, None),
                )
                .unwrap();
            }
            db.set_current_provider(app_name, "a").unwrap();
            store(
                app_name,
                &AggregationState {
                    enabled: true,
                    plan: plan(),
                    overlays: BTreeMap::new(),
                },
            )
            .unwrap();
        }
        let mut config = db.get_proxy_config().await.unwrap();
        let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        config.listen_port = port;
        config.listen_address = "127.0.0.1".into();
        let server = crate::proxy::server::ProxyServer::new(
            config,
            db,
            None,
            Arc::from("SYNTHETIC_IMAGE_TOKEN"),
        );
        server.start().await.unwrap();
        let root = home.dir.path().to_owned();
        let output = tokio::task::spawn_blocking(move || {
            let claude = std::env::var("TUZI_TEST_CLAUDE").unwrap();
            let codex = std::env::var("TUZI_TEST_CODEX").unwrap();
            let node_path = std::env::var("TUZI_TEST_PATH").unwrap();
            let codex_home = root.join("codex-cli");
            fs::create_dir_all(&codex_home).unwrap();
            fs::write(codex_home.join("config.toml"), format!("model_provider = \"synthetic\"\n[model_providers.synthetic]\nname = \"Synthetic\"\nbase_url = \"http://127.0.0.1:{port}/v1\"\nenv_key = \"SYNTHETIC_API_KEY\"\nwire_api = \"responses\"\n")).unwrap();
            let common = |command: &mut Command| {
                command.env_clear().env("HOME", &root).env("PATH", &node_path)
                    .env("HTTP_PROXY", "http://127.0.0.1:9").env("HTTPS_PROXY", "http://127.0.0.1:9")
                    .env("NO_PROXY", "127.0.0.1,localhost").env("OTEL_SDK_DISABLED", "true")
                    .current_dir(&root);
            };
            let mut c = Command::new(claude);
            common(&mut c);
            c.env("CLAUDE_CONFIG_DIR", root.join("claude-cli")).env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1")
                .env("ANTHROPIC_BASE_URL", format!("http://127.0.0.1:{port}"))
                .env("ANTHROPIC_API_KEY", "SYNTHETIC_CLIENT")
                .args(["--bare", "--tools", "", "--model", "ccs-claude-62--vendor/synthetic-b", "--print", "synthetic test"]);
            let first = c.output().unwrap();
            let mut c = Command::new(codex);
            common(&mut c);
            c.env("CODEX_HOME", codex_home).env("SYNTHETIC_API_KEY", "SYNTHETIC_CLIENT")
                .args(["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--model", "ccs-62/vendor/synthetic-b", "synthetic test"]);
            (first, c.output().unwrap())
        }).await.unwrap();
        server.stop().await.unwrap();
        upstream_task.abort();
        for result in [output.0, output.1] {
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            assert!(String::from_utf8_lossy(&result.stdout).contains("synthetic-ok"));
        }
        let seen = requests.lock().await;
        assert_eq!(seen.len(), 2);
        for request in seen.iter() {
            assert_eq!(request["model"], "vendor/synthetic-b");
            assert_eq!(request["key"], "Bearer SYNTHETIC_b");
        }
    }
    #[tokio::test]
    #[serial_test::serial]
    async fn aggregation_dispatches_over_http_without_failover_or_provider_switch() {
        use axum::{routing::post, Json, Router};
        use std::sync::Arc;
        let home = TestHome::new();
        assert!(home.dir.path().exists());
        let requests = Arc::new(tokio::sync::Mutex::new(Vec::<Value>::new()));
        let seen = requests.clone();
        let upstream=Router::new().route("/v1/messages",post(move |headers:axum::http::HeaderMap,Json(body):Json<Value>|{let seen=seen.clone();async move{seen.lock().await.push(json!({"model":body["model"],"key":headers.get("authorization").and_then(|v|v.to_str().ok())}));Json(json!({"id":"synthetic","type":"message","role":"assistant","model":body["model"],"content":[{"type":"text","text":"Synthetic only"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}))}}));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream_port = listener.local_addr().unwrap().port();
        let task = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap() });
        let db = Arc::new(Database::memory().unwrap());
        for id in ["a", "b"] {
            let provider = Provider::with_id(
                id.into(),
                format!("Synthetic {id}"),
                json!({"env":{"ANTHROPIC_BASE_URL":format!("http://127.0.0.1:{upstream_port}"),"ANTHROPIC_AUTH_TOKEN":format!("SYNTHETIC_{id}"),"ANTHROPIC_MODEL":"must-not-remap"}}),
                None,
            );
            db.save_provider("claude", &provider).unwrap();
        }
        db.set_current_provider("claude", "a").unwrap();
        let mut state = AggregationState::default();
        state.enabled = true;
        state.plan = plan();
        store("claude", &state).unwrap();
        let mut config = db.get_proxy_config().await.unwrap();
        config.listen_port = 0;
        config.listen_address = "127.0.0.1".into();
        let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        config.listen_port = port;
        let server = crate::proxy::server::ProxyServer::new(
            config,
            db.clone(),
            None,
            Arc::from("SYNTHETIC_IMAGE_TOKEN"),
        );
        server.start().await.unwrap();
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let id = model_id("claude", &state.plan.models[1], "a");
        let response=client.post(format!("http://127.0.0.1:{port}/v1/messages")).json(&json!({"model":id,"max_tokens":5,"messages":[{"role":"user","content":"Synthetic"}],"stream":false})).send().await.unwrap();
        assert!(
            response.status().is_success(),
            "{}",
            response.text().await.unwrap()
        );
        assert_eq!(requests.lock().await[0]["model"], "vendor/synthetic-b");
        assert_eq!(requests.lock().await[0]["key"], "Bearer SYNTHETIC_b");
        assert_eq!(
            db.get_current_provider("claude").unwrap().as_deref(),
            Some("a")
        );
        assert_eq!(server.get_status().await.failover_count, 0);
        let response = client
            .post(format!("http://127.0.0.1:{port}/v1/messages"))
            .json(&json!({"model":"ccs-claude-removed--model","messages":[]}))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::BAD_REQUEST);
        assert_eq!(requests.lock().await.len(), 1);
        let response = client
            .get(format!("http://127.0.0.1:{port}/v1/models"))
            .header("anthropic-version", "2023-06-01")
            .send()
            .await
            .unwrap()
            .json::<Value>()
            .await
            .unwrap();
        assert_eq!(response["data"].as_array().unwrap().len(), 2);
        server.stop().await.unwrap();
        task.abort();
    }
    #[test]
    #[serial_test::serial]
    fn overlay_restore_is_exact_and_refuses_external_changes() {
        let _home = TestHome::new();
        let paths = files("claude");
        let original = b"{\"env\":{\"KEEP\":\"synthetic\"},\"unrelated\":true}".to_vec();
        private_write(&paths["config"], &original).unwrap();
        let originals = BTreeMap::from([("config".into(), Some(original.clone()))]);
        let writes = overlay_files("claude", &plan(), &originals).unwrap();
        let mut state = AggregationState {
            enabled: true,
            plan: plan(),
            overlays: BTreeMap::from([(
                "config".into(),
                Overlay {
                    before: Some(original.clone()),
                    written: hash(Some(&writes["config"])),
                    target: paths["config"].to_string_lossy().into_owned(),
                },
            )]),
        };
        private_write(&paths["config"], &writes["config"]).unwrap();
        store("claude", &state).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&writes["config"]).unwrap()["env"]
                ["CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"],
            "1"
        );
        private_write(&paths["config"], b"{\"external\":true}").unwrap();
        assert!(restore_overlay("claude", &mut state).is_err());
        assert!(state.enabled);
        private_write(&paths["config"], &writes["config"]).unwrap();
        restore_overlay("claude", &mut state).unwrap();
        assert_eq!(fs::read(&paths["config"]).unwrap(), original);
        assert!(!load("claude").unwrap().enabled);
    }
    #[test]
    #[serial_test::serial]
    fn validation_and_deleted_models_fail_closed() {
        let _home = TestHome::new();
        let db = Database::memory().unwrap();
        let provider = Provider::with_id(
            "a".into(),
            "Synthetic".into(),
            json!({"env":{"ANTHROPIC_BASE_URL":"https://example.invalid","ANTHROPIC_AUTH_TOKEN":"SYNTHETIC"}}),
            None,
        );
        db.save_provider("claude", &provider).unwrap();
        let mut plan = plan();
        assert!(validate(&db, "claude", &plan).is_err());
        plan.models.truncate(1);
        validate(&db, "claude", &plan).unwrap();
        let mut invalid = plan.clone();
        invalid.models.push(invalid.models[0].clone());
        assert!(validate(&db, "claude", &invalid).is_err());
        store(
            "claude",
            &AggregationState {
                enabled: true,
                plan,
                overlays: BTreeMap::new(),
            },
        )
        .unwrap();
        db.delete_provider("claude", "a").unwrap();
        assert!(resolve(&db, "claude", "synthetic-a").is_err());
    }
    #[test]
    fn namespaces_are_stable_and_collision_free() {
        let a = Model {
            provider_id: "a/b".into(),
            model: "vendor/model".into(),
            display_name: "Synthetic".into(),
            context_window: 128000,
        };
        let mut b = a.clone();
        b.provider_id = "a-b".into();
        assert_ne!(
            model_id("codex", &a, "default"),
            model_id("codex", &b, "default")
        );
        assert_eq!(model_id("codex", &a, "a/b"), "vendor/model");
        assert!(model_id("claude", &a, "default").starts_with("ccs-claude-"));
    }
    #[test]
    fn unsupported_apps_fail_closed() {
        assert!(app("gemini").is_err());
        assert!(app("../../bad").is_err());
    }
    #[tokio::test]
    #[serial_test::serial]
    async fn claude_enable_exit_and_native_route_restore_preserve_original_files() {
        use std::sync::Arc;
        let _home = TestHome::new();
        let db = Arc::new(Database::memory().unwrap());
        let state = AppState::new(db.clone());
        let root = json!({"env":{"ANTHROPIC_BASE_URL":"https://example.invalid","ANTHROPIC_AUTH_TOKEN":"SYNTHETIC","ANTHROPIC_MODEL":"synthetic-a","KEEP":"synthetic"},"permissions":{"allow":[]}});
        private_write(
            &crate::config::get_claude_settings_path(),
            &serde_json::to_vec(&root).unwrap(),
        )
        .unwrap();
        let provider = Provider::with_id("a".into(), "Synthetic A".into(), root.clone(), None);
        db.save_provider("claude", &provider).unwrap();
        db.set_current_provider("claude", "a").unwrap();
        crate::settings::set_current_provider(&AppType::Claude, Some("a")).unwrap();
        let probe = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        let mut config = db.get_proxy_config().await.unwrap();
        config.listen_port = port;
        db.update_proxy_config(config).await.unwrap();
        let mut plan = plan();
        plan.models.truncate(1);
        apply_inner(&state, "claude", plan.clone(), true)
            .await
            .unwrap();
        assert!(load("claude").unwrap().enabled);
        let live: Value =
            serde_json::from_slice(&fs::read(crate::config::get_claude_settings_path()).unwrap())
                .unwrap();
        assert_eq!(
            live["env"]["CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY"],
            "1"
        );
        assert!(crate::services::ProviderService::switch(&state, AppType::Claude, "a").is_err());
        apply_inner(&state, "claude", plan, false).await.unwrap();
        assert!(!load("claude").unwrap().enabled);
        assert!(
            state
                .proxy_service
                .get_takeover_status()
                .await
                .unwrap()
                .claude
        );
        state
            .proxy_service
            .set_takeover_for_app("claude", false)
            .await
            .unwrap();
        let restored: Value =
            serde_json::from_slice(&fs::read(crate::config::get_claude_settings_path()).unwrap())
                .unwrap();
        assert_eq!(restored, root);
        crate::settings::reload_settings().unwrap();
    }
    #[test]
    #[serial_test::serial]
    fn codex_catalog_keeps_existing_config_and_restores_previous_catalog() {
        let _home = TestHome::new();
        let dir = crate::codex_config::get_codex_config_dir();
        fs::create_dir_all(&dir).unwrap();
        private_write(&dir.join("models_cache.json"),br#"{"models":[{"slug":"gpt-5.5","display_name":"Synthetic template","input_modalities":["text"],"supported_reasoning_levels":[],"default_reasoning_level":"medium"}]}"#).unwrap();
        let original=b"# preserve this comment\nmodel_provider = \"synthetic\"\nmodel = \"synthetic-a\"\nmodel_catalog_json = \"/synthetic/user-models.json\"\n[model_providers.synthetic]\nbase_url = \"http://127.0.0.1:15721/v1\"\nwire_api = \"responses\"\n".to_vec();
        let paths = files("codex");
        let previous_catalog = br#"{"models":[],"synthetic":"prior"}"#.to_vec();
        let originals = BTreeMap::from([
            ("config".into(), Some(original.clone())),
            ("catalog".into(), Some(previous_catalog.clone())),
        ]);
        let writes = overlay_files("codex", &plan(), &originals).unwrap();
        let catalog: Value = serde_json::from_slice(&writes["catalog"]).unwrap();
        assert_eq!(catalog["models"].as_array().unwrap().len(), 2);
        assert_eq!(catalog["models"][1]["slug"], "ccs-62/vendor/synthetic-b");
        assert!(String::from_utf8(writes["config"].clone())
            .unwrap()
            .contains("# preserve this comment"));
        let mut state = AggregationState {
            enabled: true,
            plan: plan(),
            overlays: writes
                .iter()
                .map(|(name, b)| {
                    (
                        name.clone(),
                        Overlay {
                            before: originals[name].clone(),
                            written: hash(Some(b)),
                            target: paths[name].to_string_lossy().into_owned(),
                        },
                    )
                })
                .collect(),
        };
        for (name, b) in &writes {
            private_write(&paths[name], b).unwrap();
        }
        store("codex", &state).unwrap();
        restore_overlay("codex", &mut state).unwrap();
        assert_eq!(fs::read(&paths["config"]).unwrap(), original);
        assert_eq!(fs::read(&paths["catalog"]).unwrap(), previous_catalog);
    }
}
