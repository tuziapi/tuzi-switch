use serde_json::json;

use tuzi_switch_lib::{
    extract_codex_experimental_bearer_token, get_claude_settings_path, read_json_file,
    write_codex_live_atomic, AppError, AppType, McpApps, McpServer, MultiAppConfig, Provider,
    ProviderMeta, ProviderService,
};

#[path = "support.rs"]
mod support;
use support::{
    create_test_state, create_test_state_with_config, ensure_test_home, reset_test_fs, test_mutex,
};

fn sanitize_provider_name(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            _ => c,
        })
        .collect::<String>()
        .to_lowercase()
}

#[test]
fn migrate_legacy_common_config_usage_marks_historical_provider_enabled() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Claude)
            .expect("claude manager");
        manager.current = "legacy-provider".to_string();
        manager.providers.insert(
            "legacy-provider".to_string(),
            Provider::with_id(
                "legacy-provider".to_string(),
                "Legacy".to_string(),
                json!({
                    "includeCoAuthoredBy": false,
                    "env": {
                        "ANTHROPIC_API_KEY": "legacy-key"
                    }
                }),
                None,
            ),
        );
    }

    let state = create_test_state_with_config(&config).expect("create test state");
    state
        .db
        .set_config_snippet(
            AppType::Claude.as_str(),
            Some(r#"{ "includeCoAuthoredBy": false }"#.to_string()),
        )
        .expect("set common config snippet");

    ProviderService::migrate_legacy_common_config_usage_if_needed(&state, AppType::Claude)
        .expect("migrate legacy common config");

    let providers = state
        .db
        .get_all_providers(AppType::Claude.as_str())
        .expect("get providers after migration");
    let provider = providers
        .get("legacy-provider")
        .expect("legacy provider exists");

    assert_eq!(
        provider
            .meta
            .as_ref()
            .and_then(|meta| meta.common_config_enabled),
        Some(true),
        "historical provider should be explicitly marked as using common config"
    );
    assert!(
        provider
            .settings_config
            .get("includeCoAuthoredBy")
            .is_none(),
        "common config fields should be stripped from provider storage after migration"
    );
    assert_eq!(
        provider
            .settings_config
            .get("env")
            .and_then(|v| v.get("ANTHROPIC_API_KEY"))
            .and_then(|v| v.as_str()),
        Some("legacy-key"),
        "provider-specific auth should remain untouched"
    );
}

#[test]
fn provider_service_switch_codex_updates_live_and_config() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let legacy_auth = json!({ "OPENAI_API_KEY": "legacy-key" });
    let legacy_config = r#"[mcp_servers.legacy]
type = "stdio"
command = "echo"
"#;
    write_codex_live_atomic(&legacy_auth, Some(legacy_config))
        .expect("seed existing codex live config");

    let mut initial_config = MultiAppConfig::default();
    {
        let manager = initial_config
            .get_manager_mut(&AppType::Codex)
            .expect("codex manager");
        manager.current = "old-provider".to_string();
        manager.providers.insert(
            "old-provider".to_string(),
            Provider::with_id(
                "old-provider".to_string(),
                "Legacy".to_string(),
                json!({
                    "auth": {"OPENAI_API_KEY": "stale"},
                    "config": "stale-config"
                }),
                None,
            ),
        );
        manager.providers.insert(
            "new-provider".to_string(),
            Provider::with_id(
                "new-provider".to_string(),
                "Latest".to_string(),
                json!({
                    "auth": {"OPENAI_API_KEY": "fresh-key"},
                    "config": r#"[mcp_servers.latest]
type = "stdio"
command = "say"
"#
                }),
                None,
            ),
        );
    }

    // 使用新的统一 MCP 结构（v3.7.0+）
    let servers = initial_config
        .mcp
        .servers
        .get_or_insert_with(Default::default);
    servers.insert(
        "echo-server".into(),
        McpServer {
            id: "echo-server".into(),
            name: "Echo Server".into(),
            server: json!({
                "type": "stdio",
                "command": "echo"
            }),
            apps: McpApps {
                claude: false,
                codex: true,
                gemini: false,
                opencode: false,
                hermes: false,
            },
            description: None,
            homepage: None,
            docs: None,
            tags: Vec::new(),
        },
    );

    let state = create_test_state_with_config(&initial_config).expect("create test state");

    ProviderService::switch(&state, AppType::Codex, "new-provider")
        .expect("switch provider should succeed");

    let config_text = std::fs::read_to_string(tuzi_switch_lib::get_codex_config_path())
        .expect("read config.toml");
    assert_eq!(
        extract_codex_experimental_bearer_token(&config_text).as_deref(),
        Some("fresh-key"),
        "live Codex config should carry the new provider token"
    );
    assert!(
        config_text.contains("mcp_servers.echo-server"),
        "config.toml should contain synced MCP servers"
    );

    let current_id = state
        .db
        .get_current_provider(AppType::Codex.as_str())
        .expect("read current provider after switch");
    assert_eq!(
        current_id.as_deref(),
        Some("new-provider"),
        "current provider updated"
    );

    let providers = state
        .db
        .get_all_providers(AppType::Codex.as_str())
        .expect("read providers after switch");

    let new_provider = providers.get("new-provider").expect("new provider exists");
    let new_config_text = new_provider
        .settings_config
        .get("config")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    // provider 存储的是原始配置，不包含 MCP 同步后的内容
    assert!(
        new_config_text.contains("mcp_servers.latest"),
        "provider config should contain original MCP servers"
    );
    // live 文件额外包含同步的 MCP 服务器
    assert!(
        config_text.contains("mcp_servers.echo-server"),
        "live config should include synced MCP servers"
    );

    let legacy = providers
        .get("old-provider")
        .expect("legacy provider still exists");
    let legacy_auth_value = legacy
        .settings_config
        .get("auth")
        .and_then(|v| v.get("OPENAI_API_KEY"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert_eq!(
        legacy_auth_value, "legacy-key",
        "previous provider should be backfilled with live auth"
    );
}

#[test]
fn provider_service_switch_codex_preserves_live_model_provider_id_for_history() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let legacy_auth = json!({ "OPENAI_API_KEY": "rightcode-key" });
    let legacy_config = r#"model_provider = "rightcode"
model = "gpt-5.4"

[model_providers.rightcode]
name = "RightCode"
base_url = "https://rightcode.example/v1"
wire_api = "responses"
requires_openai_auth = true
"#;
    write_codex_live_atomic(&legacy_auth, Some(legacy_config))
        .expect("seed existing codex live config");

    let mut initial_config = MultiAppConfig::default();
    {
        let manager = initial_config
            .get_manager_mut(&AppType::Codex)
            .expect("codex manager");
        manager.current = "old-provider".to_string();
        manager.providers.insert(
            "old-provider".to_string(),
            Provider::with_id(
                "old-provider".to_string(),
                "RightCode".to_string(),
                json!({
                    "auth": {"OPENAI_API_KEY": "stale"},
                    "config": legacy_config
                }),
                None,
            ),
        );
        manager.providers.insert(
            "new-provider".to_string(),
            Provider::with_id(
                "new-provider".to_string(),
                "AiHubMix".to_string(),
                json!({
                    "auth": {"OPENAI_API_KEY": "fresh-key"},
                    "config": r#"model_provider = "aihubmix"
model = "gpt-5.4"

[model_providers.aihubmix]
name = "AiHubMix"
base_url = "https://aihubmix.example/v1"
wire_api = "responses"
requires_openai_auth = true
"#
                }),
                None,
            ),
        );
    }

    let state = create_test_state_with_config(&initial_config).expect("create test state");

    ProviderService::switch(&state, AppType::Codex, "new-provider")
        .expect("switch provider should succeed");

    let config_text = std::fs::read_to_string(tuzi_switch_lib::get_codex_config_path())
        .expect("read config.toml");
    let parsed: toml::Value = toml::from_str(&config_text).expect("parse config.toml");

    assert_eq!(
        parsed.get("model_provider").and_then(|v| v.as_str()),
        Some("aihubmix"),
        "live Codex model_provider should point at the selected provider"
    );

    let model_providers = parsed
        .get("model_providers")
        .and_then(|v| v.as_table())
        .expect("model_providers table exists");
    assert!(
        model_providers.get("rightcode").is_some(),
        "existing provider entry should be preserved in main config"
    );
    assert_eq!(
        model_providers
            .get("aihubmix")
            .and_then(|v| v.get("base_url"))
            .and_then(|v| v.as_str()),
        Some("https://aihubmix.example/v1"),
        "target provider id should point at the newly selected supplier endpoint"
    );

    let providers = state
        .db
        .get_all_providers(AppType::Codex.as_str())
        .expect("read providers after switch");
    let new_config_text = providers
        .get("new-provider")
        .expect("new provider exists")
        .settings_config
        .get("config")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    assert!(
        new_config_text.contains("[model_providers.aihubmix]"),
        "stored provider template should remain provider-specific"
    );
}

#[test]
fn provider_service_add_codex_registers_provider_without_switching_current() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let existing_config = r#"model_provider = "rightcode"
model = "gpt-5.4"

[model_providers.rightcode]
name = "RightCode"
base_url = "https://rightcode.example/v1"
wire_api = "responses"
requires_openai_auth = true

[mcp_servers.keep]
type = "stdio"
command = "echo"
"#;
    write_codex_live_atomic(&json!({}), Some(existing_config)).expect("seed codex config");

    let mut initial_config = MultiAppConfig::default();
    {
        let manager = initial_config
            .get_manager_mut(&AppType::Codex)
            .expect("codex manager");
        manager.current = "current-provider".to_string();
        manager.providers.insert(
            "current-provider".to_string(),
            Provider::with_id(
                "current-provider".to_string(),
                "RightCode".to_string(),
                json!({
                    "auth": {},
                    "config": existing_config
                }),
                None,
            ),
        );
    }

    let state = create_test_state_with_config(&initial_config).expect("create test state");
    let provider = Provider::with_id(
        "new-provider".to_string(),
        "codex订阅-我的线路".to_string(),
        json!({
            "auth": {},
            "config": r#"model_provider = "codex_sub"
model = "gpt-5.5"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.codex_sub]
name = "codex_sub"
base_url = "https://api.tu-zi.com/coding"
env_key = "CODEX_SUB_CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = true
"#
        }),
        Some("aggregator".to_string()),
    );

    ProviderService::add(&state, AppType::Codex, provider, false).expect("add codex provider");

    let config_text = std::fs::read_to_string(tuzi_switch_lib::get_codex_config_path())
        .expect("read codex config");
    let parsed: toml::Value = toml::from_str(&config_text).expect("parse config");
    assert_eq!(
        parsed.get("model_provider").and_then(|v| v.as_str()),
        Some("rightcode"),
        "adding a non-current Codex provider must not switch the active provider"
    );
    assert!(
        parsed
            .get("model_providers")
            .and_then(|v| v.get("codex_sub"))
            .is_some(),
        "main config.toml should include the newly added provider"
    );
    assert!(
        config_text.contains("[mcp_servers.keep]"),
        "existing Codex config sections should be preserved"
    );

    let profile_path = home.join(".codex").join("codex订阅-我的线路.config.toml");
    let profile_text = std::fs::read_to_string(profile_path).expect("read codex profile");
    assert!(
        profile_text.contains("[model_providers.codex_sub]"),
        "Codex profile config should be created for the provider"
    );
}

#[test]
fn provider_service_add_codex_preserves_provider_extension_fields_in_live_config() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    write_codex_live_atomic(
        &json!({}),
        Some(
            r#"model_provider = "rightcode"
model = "gpt-5.4"

[model_providers.rightcode]
name = "RightCode"
base_url = "https://rightcode.example/v1"
wire_api = "responses"
requires_openai_auth = true
"#,
        ),
    )
    .expect("seed codex config");

    let state = create_test_state().expect("create test state");
    let provider = Provider::with_id(
        "new-provider".to_string(),
        "New Provider".to_string(),
        json!({
            "auth": {},
            "config": r#"model_provider = "codex_sub"
model = "gpt-5.5"
model_reasoning_effort = "high"

[model_providers.codex_sub]
name = "codex_sub"
base_url = "https://api.tu-zi.com/coding"
env_key = "CODEX_SUB_CODEX_API_KEY"
wire_api = "chat"
requires_openai_auth = false
request_max_retries = 4
stream_idle_timeout_ms = 300000

[model_providers.codex_sub.headers]
X-Custom-Trace = "keep-me"
"#
        }),
        Some("aggregator".to_string()),
    );

    ProviderService::add(&state, AppType::Codex, provider, false).expect("add codex provider");

    let config_text = std::fs::read_to_string(tuzi_switch_lib::get_codex_config_path())
        .expect("read codex config");
    let parsed: toml::Value = toml::from_str(&config_text).expect("parse config");
    let provider = parsed
        .get("model_providers")
        .and_then(|value| value.get("codex_sub"))
        .expect("codex_sub provider should be registered");

    assert_eq!(
        provider
            .get("request_max_retries")
            .and_then(|value| value.as_integer()),
        Some(4),
        "Codex provider retry tuning should be preserved"
    );
    assert_eq!(
        provider
            .get("stream_idle_timeout_ms")
            .and_then(|value| value.as_integer()),
        Some(300000),
        "Codex provider stream timeout should be preserved"
    );
    assert_eq!(
        provider
            .get("headers")
            .and_then(|value| value.get("X-Custom-Trace"))
            .and_then(|value| value.as_str()),
        Some("keep-me"),
        "Codex provider nested headers should be preserved"
    );
    assert_eq!(
        provider.get("wire_api").and_then(|value| value.as_str()),
        Some("chat"),
        "Codex provider wire_api should respect provider-specific config"
    );
    assert_eq!(
        provider
            .get("requires_openai_auth")
            .and_then(|value| value.as_bool()),
        Some(false),
        "Codex provider auth mode should respect provider-specific config"
    );
}

#[test]
fn provider_service_add_codex_tuzi_route_uses_numbered_provider_without_overwriting_existing_tuzi()
{
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let existing_config = r#"model_provider = "custom"
model = "gpt-5.4"

[model_providers.tuzi]
name = "tuzi"
base_url = "https://api.tu-zi.com/v1"
env_key = "TUZI_CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = true

[model_providers.custom]
name = "custom"
base_url = "https://api.tu-zi.com/coding"
wire_api = "responses"
requires_openai_auth = true
"#;
    write_codex_live_atomic(&json!({}), Some(existing_config)).expect("seed codex config");

    let state = create_test_state().expect("create test state");
    let provider = Provider::with_id(
        "new-tuzi".to_string(),
        "兔子线路-我的配置".to_string(),
        json!({
            "auth": {},
            "config": r#"model_provider = "tuzi"
model = "gpt-5.5"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.tuzi]
name = "tuzi"
base_url = "https://api.tu-zi.com/v1"
env_key = "TUZI_CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = true
"#
        }),
        Some("https://api.tu-zi.com".to_string()),
    );

    ProviderService::add(&state, AppType::Codex, provider, false).expect("add tuzi provider");

    let saved_provider = state
        .db
        .get_provider_by_id("new-tuzi", AppType::Codex.as_str())
        .expect("query new tuzi provider")
        .expect("new tuzi provider exists");
    let saved_config = saved_provider
        .settings_config
        .get("config")
        .and_then(|value| value.as_str())
        .expect("saved codex config");
    assert!(
        saved_config.contains("model_provider = \"provider-tuzi01\""),
        "new tuzi provider should avoid existing numbered route and legacy tuzi key"
    );
    assert!(
        saved_config.contains("env_key = \"TUZI01_CODEX_API_KEY\""),
        "new tuzi provider should receive the matching numbered env key"
    );

    let live_config = std::fs::read_to_string(tuzi_switch_lib::get_codex_config_path())
        .expect("read codex live config");
    assert!(
        live_config.contains("[model_providers.tuzi]\nname = \"tuzi\"\nbase_url = \"https://api.tu-zi.com/v1\"\nenv_key = \"TUZI_CODEX_API_KEY\""),
        "existing user-owned tuzi provider must be preserved"
    );
    assert!(
        live_config.contains("[model_providers.provider-tuzi01]"),
        "numbered tuzi switch provider should be registered separately"
    );
}

#[test]
fn provider_service_switch_codex_backfill_keeps_provider_specific_model_provider_id() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let legacy_auth = json!({ "OPENAI_API_KEY": "rightcode-key" });
    let provider_a_config = r#"model_provider = "rightcode"
model = "gpt-5.4"

[model_providers.rightcode]
name = "RightCode"
base_url = "https://rightcode.example/v1"
wire_api = "responses"
requires_openai_auth = true
"#;
    write_codex_live_atomic(&legacy_auth, Some(provider_a_config))
        .expect("seed existing codex live config");

    let mut initial_config = MultiAppConfig::default();
    {
        let manager = initial_config
            .get_manager_mut(&AppType::Codex)
            .expect("codex manager");
        manager.current = "provider-a".to_string();
        manager.providers.insert(
            "provider-a".to_string(),
            Provider::with_id(
                "provider-a".to_string(),
                "RightCode".to_string(),
                json!({
                    "auth": {"OPENAI_API_KEY": "rightcode-key"},
                    "config": provider_a_config
                }),
                None,
            ),
        );
        manager.providers.insert(
            "provider-b".to_string(),
            Provider::with_id(
                "provider-b".to_string(),
                "AiHubMix".to_string(),
                json!({
                    "auth": {"OPENAI_API_KEY": "aihubmix-key"},
                    "config": r#"model_provider = "aihubmix"
model = "gpt-5.4"
profile = "work"

[model_providers.aihubmix]
name = "AiHubMix"
base_url = "https://aihubmix.example/v1"
wire_api = "responses"
requires_openai_auth = true

[profiles.work]
model_provider = "aihubmix"
model = "gpt-5.4"
"#
                }),
                None,
            ),
        );
        manager.providers.insert(
            "provider-c".to_string(),
            Provider::with_id(
                "provider-c".to_string(),
                "Vendor C".to_string(),
                json!({
                    "auth": {"OPENAI_API_KEY": "vendor-c-key"},
                    "config": r#"model_provider = "vendor_c"
model = "gpt-5.4"

[model_providers.vendor_c]
name = "Vendor C"
base_url = "https://vendor-c.example/v1"
wire_api = "responses"
requires_openai_auth = true
"#
                }),
                None,
            ),
        );
    }

    let state = create_test_state_with_config(&initial_config).expect("create test state");

    ProviderService::switch(&state, AppType::Codex, "provider-b")
        .expect("switch to provider b should succeed");
    ProviderService::switch(&state, AppType::Codex, "provider-c")
        .expect("switch to provider c should succeed");

    let providers = state
        .db
        .get_all_providers(AppType::Codex.as_str())
        .expect("read providers after switches");
    let provider_b_config = providers
        .get("provider-b")
        .expect("provider b exists")
        .settings_config
        .get("config")
        .and_then(|v| v.as_str())
        .expect("provider b config");
    let parsed: toml::Value = toml::from_str(provider_b_config).expect("parse provider b config");

    assert_eq!(
        parsed.get("model_provider").and_then(|v| v.as_str()),
        Some("aihubmix"),
        "backfill should restore provider b's storage-specific model_provider id"
    );
    assert!(
        parsed
            .get("model_providers")
            .and_then(|v| v.get("aihubmix"))
            .is_some(),
        "provider b should keep its own model_providers table after backfill"
    );
    assert_eq!(
        parsed
            .get("profiles")
            .and_then(|v| v.get("work"))
            .and_then(|v| v.get("model_provider"))
            .and_then(|v| v.as_str()),
        Some("aihubmix"),
        "profile overrides should be restored to provider b's storage-specific id"
    );
}

#[test]
fn sync_current_provider_for_app_keeps_live_takeover_and_updates_restore_backup() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Claude)
            .expect("claude manager");
        manager.current = "current-provider".to_string();

        let mut provider = Provider::with_id(
            "current-provider".to_string(),
            "Current".to_string(),
            json!({
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "real-token",
                    "ANTHROPIC_BASE_URL": "https://claude.example"
                }
            }),
            None,
        );
        provider.meta = Some(ProviderMeta {
            common_config_enabled: Some(true),
            ..Default::default()
        });

        manager
            .providers
            .insert("current-provider".to_string(), provider);
    }

    let state = create_test_state_with_config(&config).expect("create test state");
    state
        .db
        .set_config_snippet(
            AppType::Claude.as_str(),
            Some(r#"{ "includeCoAuthoredBy": false }"#.to_string()),
        )
        .expect("set common config snippet");

    let taken_over_live = json!({
        "env": {
            "ANTHROPIC_BASE_URL": "http://127.0.0.1:5000",
            "ANTHROPIC_AUTH_TOKEN": "PROXY_MANAGED"
        }
    });
    let settings_path = get_claude_settings_path();
    std::fs::create_dir_all(settings_path.parent().expect("settings dir")).expect("create dir");
    std::fs::write(
        &settings_path,
        serde_json::to_string_pretty(&taken_over_live).expect("serialize taken over live"),
    )
    .expect("write taken over live");

    futures::executor::block_on(state.db.save_live_backup("claude", "{\"env\":{}}"))
        .expect("seed live backup");

    let mut proxy_config = futures::executor::block_on(state.db.get_proxy_config_for_app("claude"))
        .expect("get proxy config");
    proxy_config.enabled = true;
    futures::executor::block_on(state.db.update_proxy_config_for_app(proxy_config))
        .expect("enable takeover");

    ProviderService::sync_current_provider_for_app(&state, AppType::Claude)
        .expect("sync current provider should succeed");

    let live_after: serde_json::Value =
        read_json_file(&settings_path).expect("read live settings after sync");
    assert_eq!(
        live_after, taken_over_live,
        "sync should not overwrite live config while takeover is active"
    );

    let backup = futures::executor::block_on(state.db.get_live_backup("claude"))
        .expect("get live backup")
        .expect("backup exists");
    let backup_value: serde_json::Value =
        serde_json::from_str(&backup.original_config).expect("parse backup value");

    assert_eq!(
        backup_value
            .get("includeCoAuthoredBy")
            .and_then(|v| v.as_bool()),
        Some(false),
        "restore backup should receive the updated effective config"
    );
    assert_eq!(
        backup_value
            .get("env")
            .and_then(|v| v.get("ANTHROPIC_AUTH_TOKEN"))
            .and_then(|v| v.as_str()),
        Some("real-token"),
        "restore backup should preserve the provider token rather than proxy placeholder"
    );
}

#[test]
fn explicitly_cleared_common_snippet_is_not_auto_extracted() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let state = create_test_state().expect("create test state");
    state
        .db
        .set_config_snippet_cleared(AppType::Claude.as_str(), true)
        .expect("mark snippet explicitly cleared");

    assert!(
        !state
            .db
            .should_auto_extract_config_snippet(AppType::Claude.as_str())
            .expect("check auto-extract eligibility"),
        "explicitly cleared snippets should block auto-extraction"
    );

    state
        .db
        .set_config_snippet(AppType::Claude.as_str(), Some("{}".to_string()))
        .expect("set snippet");
    state
        .db
        .set_config_snippet_cleared(AppType::Claude.as_str(), false)
        .expect("clear explicit-empty marker");

    assert!(
        !state
            .db
            .should_auto_extract_config_snippet(AppType::Claude.as_str())
            .expect("check auto-extract after snippet saved"),
        "existing snippets should also block auto-extraction"
    );
}

#[test]
fn legacy_common_config_migration_flag_roundtrip() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let state = create_test_state().expect("create test state");

    assert!(
        !state
            .db
            .is_legacy_common_config_migrated()
            .expect("initial migration flag"),
        "migration flag should default to false"
    );

    state
        .db
        .set_legacy_common_config_migrated(true)
        .expect("set migration flag");
    assert!(
        state
            .db
            .is_legacy_common_config_migrated()
            .expect("read migration flag"),
        "migration flag should persist once set"
    );

    state
        .db
        .set_legacy_common_config_migrated(false)
        .expect("clear migration flag");
    assert!(
        !state
            .db
            .is_legacy_common_config_migrated()
            .expect("read migration flag after clear"),
        "migration flag should be removable for tests/debugging"
    );
}

#[test]
fn switch_packycode_gemini_updates_security_selected_type() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Gemini)
            .expect("gemini manager");
        manager.current = "packy-gemini".to_string();
        manager.providers.insert(
            "packy-gemini".to_string(),
            Provider::with_id(
                "packy-gemini".to_string(),
                "PackyCode".to_string(),
                json!({
                    "env": {
                        "GEMINI_API_KEY": "pk-key",
                        "GOOGLE_GEMINI_BASE_URL": "https://www.packyapi.com"
                    }
                }),
                Some("https://www.packyapi.com".to_string()),
            ),
        );
    }

    let state = create_test_state_with_config(&config).expect("create test state");

    ProviderService::switch(&state, AppType::Gemini, "packy-gemini")
        .expect("switching to PackyCode Gemini should succeed");

    // Gemini security settings are written to ~/.gemini/settings.json, not ~/.tuzi-switch/settings.json
    let settings_path = home.join(".gemini").join("settings.json");
    assert!(
        settings_path.exists(),
        "Gemini settings.json should exist at {}",
        settings_path.display()
    );
    let raw = std::fs::read_to_string(&settings_path).expect("read gemini settings.json");
    let value: serde_json::Value =
        serde_json::from_str(&raw).expect("parse gemini settings.json after switch");

    assert_eq!(
        value
            .pointer("/security/auth/selectedType")
            .and_then(|v| v.as_str()),
        Some("gemini-api-key"),
        "PackyCode Gemini should set security.auth.selectedType"
    );
}

#[test]
fn packycode_partner_meta_triggers_security_flag_even_without_keywords() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Gemini)
            .expect("gemini manager");
        manager.current = "packy-meta".to_string();
        let mut provider = Provider::with_id(
            "packy-meta".to_string(),
            "Generic Gemini".to_string(),
            json!({
                "env": {
                    "GEMINI_API_KEY": "pk-meta",
                    "GOOGLE_GEMINI_BASE_URL": "https://generativelanguage.googleapis.com"
                }
            }),
            Some("https://example.com".to_string()),
        );
        provider.meta = Some(ProviderMeta {
            partner_promotion_key: Some("packycode".to_string()),
            ..ProviderMeta::default()
        });
        manager.providers.insert("packy-meta".to_string(), provider);
    }

    let state = create_test_state_with_config(&config).expect("create test state");

    ProviderService::switch(&state, AppType::Gemini, "packy-meta")
        .expect("switching to partner meta provider should succeed");

    // Gemini security settings are written to ~/.gemini/settings.json, not ~/.tuzi-switch/settings.json
    let settings_path = home.join(".gemini").join("settings.json");
    assert!(
        settings_path.exists(),
        "Gemini settings.json should exist at {}",
        settings_path.display()
    );
    let raw = std::fs::read_to_string(&settings_path).expect("read gemini settings.json");
    let value: serde_json::Value =
        serde_json::from_str(&raw).expect("parse gemini settings.json after switch");

    assert_eq!(
        value
            .pointer("/security/auth/selectedType")
            .and_then(|v| v.as_str()),
        Some("gemini-api-key"),
        "Partner meta should set security.auth.selectedType even without packy keywords"
    );
}

#[test]
fn switch_google_official_gemini_preserves_env_vars() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Gemini)
            .expect("gemini manager");
        manager.current = "google-official".to_string();
        let mut provider = Provider::with_id(
            "google-official".to_string(),
            "Google".to_string(),
            json!({
                "env": {
                    "GEMINI_MODEL": "gemini-2.5-pro"
                }
            }),
            Some("https://ai.google.dev".to_string()),
        );
        provider.meta = Some(ProviderMeta {
            partner_promotion_key: Some("google-official".to_string()),
            ..ProviderMeta::default()
        });
        manager
            .providers
            .insert("google-official".to_string(), provider);
    }

    let state = create_test_state_with_config(&config).expect("create test state");

    ProviderService::switch(&state, AppType::Gemini, "google-official")
        .expect("switching to Google official Gemini should succeed");

    // Verify env vars are preserved in ~/.gemini/.env
    let env_path = home.join(".gemini").join(".env");
    assert!(
        env_path.exists(),
        "Gemini .env should exist at {}",
        env_path.display()
    );
    let env_content = std::fs::read_to_string(&env_path).expect("read gemini .env");
    assert!(
        env_content.contains("GEMINI_MODEL=gemini-2.5-pro"),
        "GEMINI_MODEL should be preserved in .env, got: {env_content}"
    );

    // Verify OAuth security flag is still set correctly
    let gemini_settings = home.join(".gemini").join("settings.json");
    let gemini_raw = std::fs::read_to_string(&gemini_settings).expect("read gemini settings");
    let gemini_value: serde_json::Value =
        serde_json::from_str(&gemini_raw).expect("parse gemini settings");
    assert_eq!(
        gemini_value
            .pointer("/security/auth/selectedType")
            .and_then(|v| v.as_str()),
        Some("oauth-personal"),
        "OAuth security flag should still be set"
    );
}

#[test]
fn provider_service_switch_claude_updates_live_and_state() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let settings_path = get_claude_settings_path();
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent).expect("create claude settings dir");
    }
    let legacy_live = json!({
        "env": {
            "ANTHROPIC_API_KEY": "legacy-key"
        },
        "workspace": {
            "path": "/tmp/workspace"
        }
    });
    std::fs::write(
        &settings_path,
        serde_json::to_string_pretty(&legacy_live).expect("serialize legacy live"),
    )
    .expect("seed claude live config");

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Claude)
            .expect("claude manager");
        manager.current = "old-provider".to_string();
        manager.providers.insert(
            "old-provider".to_string(),
            Provider::with_id(
                "old-provider".to_string(),
                "Legacy Claude".to_string(),
                json!({
                    "env": { "ANTHROPIC_API_KEY": "stale-key" }
                }),
                None,
            ),
        );
        manager.providers.insert(
            "new-provider".to_string(),
            Provider::with_id(
                "new-provider".to_string(),
                "Fresh Claude".to_string(),
                json!({
                    "env": { "ANTHROPIC_API_KEY": "fresh-key" },
                    "workspace": { "path": "/tmp/new-workspace" }
                }),
                None,
            ),
        );
    }

    let state = create_test_state_with_config(&config).expect("create test state");

    ProviderService::switch(&state, AppType::Claude, "new-provider")
        .expect("switch provider should succeed");

    let live_after: serde_json::Value =
        read_json_file(&settings_path).expect("read claude live settings");
    assert_eq!(
        live_after
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_API_KEY"))
            .and_then(|key| key.as_str()),
        Some("fresh-key"),
        "live settings.json should reflect new provider auth"
    );

    let providers = state
        .db
        .get_all_providers(AppType::Claude.as_str())
        .expect("get all providers");
    let current_id = state
        .db
        .get_current_provider(AppType::Claude.as_str())
        .expect("get current provider");
    assert_eq!(
        current_id.as_deref(),
        Some("new-provider"),
        "current provider updated"
    );

    let legacy_provider = providers
        .get("old-provider")
        .expect("legacy provider still exists");
    assert_eq!(
        legacy_provider.settings_config, legacy_live,
        "previous provider should receive backfilled live config"
    );
}

#[test]
fn provider_service_switch_claude_writes_settings_json_even_when_legacy_file_exists() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let claude_dir = home.join(".claude");
    std::fs::create_dir_all(&claude_dir).expect("create claude dir");
    std::fs::write(
        claude_dir.join("claude.json"),
        serde_json::to_string_pretty(&json!({
            "env": { "ANTHROPIC_API_KEY": "legacy-file-key" }
        }))
        .expect("serialize legacy claude json"),
    )
    .expect("seed legacy claude json");

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Claude)
            .expect("claude manager");
        manager.current = "old-provider".to_string();
        manager.providers.insert(
            "old-provider".to_string(),
            Provider::with_id(
                "old-provider".to_string(),
                "Legacy Claude".to_string(),
                json!({
                    "env": { "ANTHROPIC_API_KEY": "old-key" }
                }),
                None,
            ),
        );
        manager.providers.insert(
            "new-provider".to_string(),
            Provider::with_id(
                "new-provider".to_string(),
                "Fresh Claude".to_string(),
                json!({
                    "env": { "ANTHROPIC_API_KEY": "fresh-key" }
                }),
                None,
            ),
        );
    }

    let state = create_test_state_with_config(&config).expect("create test state");
    ProviderService::switch(&state, AppType::Claude, "new-provider")
        .expect("switch provider should succeed");

    let settings_path = home.join(".claude").join("settings.json");
    let live_after: serde_json::Value =
        read_json_file(&settings_path).expect("read claude settings.json");
    assert_eq!(
        live_after
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_API_KEY"))
            .and_then(|key| key.as_str()),
        Some("fresh-key"),
        "new Claude live config should be written to settings.json"
    );
    let legacy_after: serde_json::Value =
        read_json_file(&claude_dir.join("claude.json")).expect("read legacy claude json");
    assert_eq!(
        legacy_after
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_API_KEY"))
            .and_then(|key| key.as_str()),
        Some("legacy-file-key"),
        "legacy claude.json should not be used as the live write target"
    );
}

#[test]
fn provider_service_switch_missing_provider_returns_error() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let state = create_test_state().expect("create test state");

    let err = ProviderService::switch(&state, AppType::Claude, "missing")
        .expect_err("switching missing provider should fail");
    match err {
        AppError::Message(msg) => {
            assert!(
                msg.contains("不存在") || msg.contains("not found"),
                "expected provider not found message, got {msg}"
            );
        }
        other => panic!("expected Message error for provider not found, got {other:?}"),
    }
}

#[test]
fn provider_service_switch_codex_missing_auth_returns_error() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Codex)
            .expect("codex manager");
        manager.providers.insert(
            "invalid".to_string(),
            Provider::with_id(
                "invalid".to_string(),
                "Broken Codex".to_string(),
                json!({
                    "config": "[mcp_servers.test]\ncommand = \"noop\""
                }),
                None,
            ),
        );
    }

    let state = create_test_state_with_config(&config).expect("create test state");

    let err = ProviderService::switch(&state, AppType::Codex, "invalid")
        .expect_err("switching should fail without auth");
    match err {
        AppError::Config(msg) => assert!(
            msg.contains("auth"),
            "expected auth related message, got {msg}"
        ),
        AppError::Localized { zh, en, .. } => assert!(
            zh.contains("auth") || en.contains("auth"),
            "expected auth related message, got zh={zh}, en={en}"
        ),
        other => panic!("expected config error, got {other:?}"),
    }
}

#[test]
fn provider_service_delete_codex_removes_provider_but_keeps_live_config() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Codex)
            .expect("codex manager");
        manager.current = "keep".to_string();
        manager.providers.insert(
            "keep".to_string(),
            Provider::with_id(
                "keep".to_string(),
                "Keep".to_string(),
                json!({
                    "auth": {"OPENAI_API_KEY": "keep-key"},
                    "env": {"envKey": "KEEP_CODEX_API_KEY"},
                    "config": "model_provider = \"provider-keep\"\nmodel = \"gpt-5.5\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.provider-keep]\nname = \"provider-keep\"\nbase_url = \"https://keep.example/v1\"\nenv_key = \"KEEP_CODEX_API_KEY\"\nwire_api = \"responses\"\nrequires_openai_auth = true\n"
                }),
                None,
            ),
        );
        manager.providers.insert(
            "to-delete".to_string(),
            Provider::with_id(
                "to-delete".to_string(),
                "DeleteCodex".to_string(),
                json!({
                    "auth": {"OPENAI_API_KEY": "delete-key"},
                    "env": {"envKey": "DELETE_CODEX_API_KEY"},
                    "config": "model_provider = \"provider-delete\"\nmodel = \"gpt-5.5\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.provider-delete]\nname = \"provider-delete\"\nbase_url = \"https://delete.example/v1\"\nenv_key = \"DELETE_CODEX_API_KEY\"\nwire_api = \"responses\"\nrequires_openai_auth = true\n"
                }),
                None,
            ),
        );
    }

    let sanitized = sanitize_provider_name("DeleteCodex");
    let codex_dir = home.join(".codex");
    std::fs::create_dir_all(&codex_dir).expect("create codex dir");
    let auth_path = codex_dir.join(format!("auth-{sanitized}.json"));
    let cfg_path = codex_dir.join(format!("config-{sanitized}.toml"));
    std::fs::write(&auth_path, "{}").expect("seed auth file");
    std::fs::write(&cfg_path, "base_url = \"https://example\"").expect("seed config file");
    let profile_path = codex_dir.join(format!("{sanitized}.config.toml"));
    std::fs::write(&profile_path, "model_provider = \"provider-delete\"\n")
        .expect("seed codex profile file");
    let live_config = r#"model_provider = "provider-keep"
model = "gpt-5.5"
model_reasoning_effort = "high"
disable_response_storage = true

[model_providers.provider-keep]
name = "provider-keep"
base_url = "https://keep.example/v1"
env_key = "KEEP_CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = true

[model_providers.provider-delete]
name = "provider-delete"
base_url = "https://delete.example/v1"
env_key = "DELETE_CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = true
"#;
    std::fs::write(codex_dir.join("config.toml"), live_config).expect("seed codex live config");
    std::fs::write(
        home.join(".zshrc"),
        "# >>> tuzi-switch codex env >>>\nexport KEEP_CODEX_API_KEY=\"keep-key\"\nexport DELETE_CODEX_API_KEY=\"delete-key\"\n# <<< tuzi-switch codex env <<<\n",
    )
    .expect("seed managed codex env");

    let app_state = create_test_state_with_config(&config).expect("create test state");

    ProviderService::delete(&app_state, AppType::Codex, "to-delete")
        .expect("delete provider should succeed");

    let providers = app_state
        .db
        .get_all_providers(AppType::Codex.as_str())
        .expect("get all providers");
    assert!(
        !providers.contains_key("to-delete"),
        "provider entry should be removed"
    );
    let live_after =
        std::fs::read_to_string(codex_dir.join("config.toml")).expect("read codex live config");
    assert!(
        live_after.contains("[model_providers.provider-delete]"),
        "deleting from tuzi-switch should not remove the user's Codex live route"
    );
    assert!(
        live_after.contains("[model_providers.provider-keep]"),
        "unrelated Codex route should be preserved"
    );
    assert!(
        profile_path.exists(),
        "deleting from tuzi-switch should not remove the user's Codex profile config"
    );
    let zshrc_after = std::fs::read_to_string(home.join(".zshrc")).expect("read managed env rc");
    assert!(
        zshrc_after.contains("DELETE_CODEX_API_KEY"),
        "deleting from tuzi-switch should not remove the user's managed env key"
    );
    assert!(
        zshrc_after.contains("KEEP_CODEX_API_KEY"),
        "unrelated managed env key should be preserved"
    );
}

#[test]
fn provider_service_delete_claude_removes_provider_files() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Claude)
            .expect("claude manager");
        manager.current = "keep".to_string();
        manager.providers.insert(
            "keep".to_string(),
            Provider::with_id(
                "keep".to_string(),
                "Keep".to_string(),
                json!({
                    "env": { "ANTHROPIC_API_KEY": "keep-key" }
                }),
                None,
            ),
        );
        manager.providers.insert(
            "delete".to_string(),
            Provider::with_id(
                "delete".to_string(),
                "DeleteClaude".to_string(),
                json!({
                    "env": { "ANTHROPIC_API_KEY": "delete-key" }
                }),
                None,
            ),
        );
    }

    let sanitized = sanitize_provider_name("DeleteClaude");
    let claude_dir = home.join(".claude");
    std::fs::create_dir_all(&claude_dir).expect("create claude dir");
    let by_name = claude_dir.join(format!("settings-{sanitized}.json"));
    let by_id = claude_dir.join("settings-delete.json");
    std::fs::write(&by_name, "{}").expect("seed settings by name");
    std::fs::write(&by_id, "{}").expect("seed settings by id");

    let app_state = create_test_state_with_config(&config).expect("create test state");

    ProviderService::delete(&app_state, AppType::Claude, "delete").expect("delete claude provider");

    let providers = app_state
        .db
        .get_all_providers(AppType::Claude.as_str())
        .expect("get all providers");
    assert!(
        !providers.contains_key("delete"),
        "claude provider should be removed"
    );
    // v3.7.0+ 不再使用供应商特定文件（如 settings-*.json）
    // 删除供应商只影响数据库记录，不清理这些旧格式文件
}

#[test]
fn provider_service_delete_additive_provider_keeps_live_config() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::OpenCode)
            .expect("opencode manager");
        manager.providers.insert(
            "delete".to_string(),
            Provider::with_id(
                "delete".to_string(),
                "DeleteOpenCode".to_string(),
                json!({
                    "npm": "@ai-sdk/openai-compatible",
                    "name": "DeleteOpenCode",
                    "options": {
                        "baseURL": "https://delete.example/v1",
                        "apiKey": "delete-key"
                    },
                    "models": {
                        "gpt-5.5": {}
                    }
                }),
                None,
            ),
        );
    }

    let opencode_dir = home.join(".config").join("opencode");
    std::fs::create_dir_all(&opencode_dir).expect("create opencode dir");
    std::fs::write(
        opencode_dir.join("opencode.json"),
        serde_json::to_string_pretty(&json!({
            "$schema": "https://opencode.ai/config.json",
            "provider": {
                "delete": {
                    "npm": "@ai-sdk/openai-compatible",
                    "name": "DeleteOpenCode",
                    "options": {
                        "baseURL": "https://delete.example/v1",
                        "apiKey": "delete-key"
                    },
                    "models": {
                        "gpt-5.5": {}
                    }
                }
            }
        }))
        .expect("serialize opencode config"),
    )
    .expect("seed opencode config");

    let app_state = create_test_state_with_config(&config).expect("create test state");

    ProviderService::delete(&app_state, AppType::OpenCode, "delete")
        .expect("delete opencode provider");

    let providers = app_state
        .db
        .get_all_providers(AppType::OpenCode.as_str())
        .expect("get all providers");
    assert!(
        !providers.contains_key("delete"),
        "opencode provider should be removed from tuzi-switch DB"
    );
    let live_after: serde_json::Value =
        read_json_file(&opencode_dir.join("opencode.json")).expect("read opencode live config");
    assert!(
        live_after.pointer("/provider/delete").is_some(),
        "deleting from tuzi-switch should not remove additive app live config"
    );
}

#[test]
fn provider_service_delete_current_provider_returns_error() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Claude)
            .expect("claude manager");
        manager.current = "keep".to_string();
        manager.providers.insert(
            "keep".to_string(),
            Provider::with_id(
                "keep".to_string(),
                "Keep".to_string(),
                json!({
                    "env": { "ANTHROPIC_API_KEY": "keep-key" }
                }),
                None,
            ),
        );
    }

    let app_state = create_test_state_with_config(&config).expect("create test state");

    let err = ProviderService::delete(&app_state, AppType::Claude, "keep")
        .expect_err("deleting current provider should fail");
    match err {
        AppError::Localized { zh, .. } => assert!(
            zh.contains("不能删除当前正在使用的供应商")
                || zh.contains("无法删除当前正在使用的供应商"),
            "unexpected message: {zh}"
        ),
        AppError::Config(msg) => assert!(
            msg.contains("不能删除当前正在使用的供应商")
                || msg.contains("无法删除当前正在使用的供应商"),
            "unexpected message: {msg}"
        ),
        AppError::Message(msg) => assert!(
            msg.contains("不能删除当前正在使用的供应商")
                || msg.contains("无法删除当前正在使用的供应商"),
            "unexpected message: {msg}"
        ),
        other => panic!("expected Config/Message error, got {other:?}"),
    }
}
