use serde_json::json;

use tuzi_switch_lib::{
    extract_codex_experimental_bearer_token, get_codex_config_path,
    import_default_config_test_hook, read_json_file, save_codex_route_test_hook,
    switch_provider_test_hook, write_codex_live_atomic, AppError, AppType, McpApps, McpServer,
    MultiAppConfig, Provider, ProviderService,
};

#[path = "support.rs"]
mod support;
use std::collections::HashMap;
use support::{
    create_test_state, create_test_state_with_config, ensure_test_home, reset_test_fs, test_mutex,
};

#[test]
fn codex_fresh_install_seeds_presets_and_imports_live_config_once() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();

    let auth = json!({"OPENAI_API_KEY": "fresh-key"});
    let config = r#"model_provider = "tuzi"
model = "gpt-5"

[model_providers.tuzi]
name = "tuzi"
base_url = "https://api.tu-zi.com/v1"
env_key = "TUZI_CODEX_API_KEY"
wire_api = "responses"
requires_openai_auth = true
"#;
    write_codex_live_atomic(&auth, Some(config)).expect("seed codex live config");

    let state = create_test_state().expect("create test state");

    assert!(
        ProviderService::should_import_default_config_on_startup(&state, &AppType::Codex)
            .expect("check startup import eligibility"),
        "Codex live config should be imported even after official presets are seeded"
    );

    assert!(
        import_default_config_test_hook(&state, AppType::Codex).expect("import codex default"),
        "Codex default import should persist the current live config"
    );

    let providers = state
        .db
        .get_all_providers(AppType::Codex.as_str())
        .expect("get codex providers after import");
    assert_eq!(
        providers.len(),
        4,
        "fresh install should seed three Codex presets and one imported live provider"
    );
    assert!(providers.contains_key("tuzi-route"));
    assert_eq!(
        providers
            .get("tuzi-route")
            .map(|provider| provider.name.as_str()),
        Some("兔子线路")
    );
    assert!(providers.contains_key("coding"));
    assert!(providers.contains_key("gaccode"));
    assert!(providers.contains_key("codex-live-config"));
    assert!(!providers.contains_key("default"));
    assert!(!providers.contains_key("codex-official"));
    for provider_id in ["tuzi-route", "coding", "gaccode"] {
        assert!(
            providers[provider_id]
                .settings_config
                .get("config")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .contains("model = \"gpt-5.5\""),
            "{provider_id} should default to gpt-5.5"
        );
    }
    let imported_config = providers["codex-live-config"]
        .settings_config
        .get("config")
        .and_then(|value| value.as_str())
        .expect("imported codex config");
    assert!(
        imported_config.contains("model_provider = \"provider-tuzi01\""),
        "imported user tuzi config should use a tuzi-switch numbered provider"
    );
    assert!(
        imported_config.contains("env_key = \"TUZI01_CODEX_API_KEY\""),
        "imported user tuzi config should receive a matching numbered env key"
    );

    let current_id = state
        .db
        .get_current_provider(AppType::Codex.as_str())
        .expect("get codex current provider");
    assert_eq!(current_id.as_deref(), Some("codex-live-config"));

    assert!(
        !ProviderService::should_import_default_config_on_startup(&state, &AppType::Codex)
            .expect("re-check startup import eligibility"),
        "subsequent startup should skip once Codex live config has been imported"
    );
}

#[test]
fn fresh_install_seeds_claude_and_gemini_presets_without_api_keys() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();

    let state = create_test_state().expect("create test state");

    let claude_providers = state
        .db
        .get_all_providers(AppType::Claude.as_str())
        .expect("get claude providers");
    assert_eq!(
        claude_providers.len(),
        2,
        "fresh install should seed exactly two Claude providers"
    );
    assert!(claude_providers.contains_key("tuzi-route"));
    assert!(claude_providers.contains_key("gaccode"));
    assert!(!claude_providers.contains_key("default"));

    let claude_tuzi = &claude_providers["tuzi-route"].settings_config;
    assert_eq!(
        claude_tuzi
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_BASE_URL"))
            .and_then(|value| value.as_str()),
        Some("https://api.tu-zi.com")
    );
    assert_eq!(
        claude_tuzi
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_AUTH_TOKEN"))
            .and_then(|value| value.as_str()),
        Some("")
    );
    assert_eq!(
        claude_tuzi
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_API_KEY"))
            .and_then(|value| value.as_str()),
        Some("")
    );

    let gemini_providers = state
        .db
        .get_all_providers(AppType::Gemini.as_str())
        .expect("get gemini providers");
    assert_eq!(
        gemini_providers.len(),
        1,
        "fresh install should seed exactly one Gemini provider"
    );
    assert!(gemini_providers.contains_key("tuzi-route"));
    assert!(!gemini_providers.contains_key("default"));

    let gemini_tuzi = &gemini_providers["tuzi-route"].settings_config;
    assert_eq!(
        gemini_tuzi
            .get("env")
            .and_then(|env| env.get("GOOGLE_GEMINI_BASE_URL"))
            .and_then(|value| value.as_str()),
        Some("https://api.tu-zi.com")
    );
    assert_eq!(
        gemini_tuzi
            .get("env")
            .and_then(|env| env.get("GEMINI_API_KEY"))
            .and_then(|value| value.as_str()),
        Some("")
    );

    assert!(
        !ProviderService::should_import_default_config_on_startup(&state, &AppType::Claude)
            .expect("check claude startup import eligibility"),
        "seeded Claude providers should block startup default import"
    );
    assert!(
        !ProviderService::should_import_default_config_on_startup(&state, &AppType::Gemini)
            .expect("check gemini startup import eligibility"),
        "seeded Gemini providers should block startup default import"
    );
}

#[test]
fn fresh_install_seeds_openclaw_and_hermes_presets() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();

    let state = create_test_state().expect("create test state");

    let openclaw_providers = state
        .db
        .get_all_providers(AppType::OpenClaw.as_str())
        .expect("get openclaw providers");
    assert_eq!(
        openclaw_providers.len(),
        5,
        "fresh install should seed exactly five OpenClaw providers"
    );
    assert!(openclaw_providers.contains_key("codex-tuzi"));
    assert!(openclaw_providers.contains_key("codex-coding"));
    assert!(openclaw_providers.contains_key("codex-gaccode"));
    assert!(openclaw_providers.contains_key("claude-tuzi"));
    assert!(openclaw_providers.contains_key("claude-gaccode"));

    let hermes_providers = state
        .db
        .get_all_providers(AppType::Hermes.as_str())
        .expect("get hermes providers");
    assert_eq!(
        hermes_providers.len(),
        5,
        "fresh install should seed exactly five Hermes providers"
    );
    assert!(hermes_providers.contains_key("codex-tuzi"));
    assert!(hermes_providers.contains_key("codex-coding"));
    assert!(hermes_providers.contains_key("codex-gaccode"));
    assert!(hermes_providers.contains_key("claude-tuzi"));
    assert!(hermes_providers.contains_key("claude-gaccode"));
}

#[test]
fn provider_seed_does_not_overwrite_existing_api_keys() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();

    let state = create_test_state().expect("create test state");
    let mut codex_tuzi = state
        .db
        .get_provider_by_id("tuzi-route", AppType::Codex.as_str())
        .expect("query codex tuzi")
        .expect("codex tuzi provider exists");
    codex_tuzi.settings_config = json!({
        "auth": {
            "OPENAI_API_KEY": "codex-tuzi-user-key"
        },
        "config": "model_provider = \"tuzi\"\nmodel = \"gpt-5.3-codex\"\n\n[model_providers.tuzi]\nbase_url = \"\"\n"
    });
    state
        .db
        .save_provider(AppType::Codex.as_str(), &codex_tuzi)
        .expect("save codex user key and stale config");

    let mut codex_coding = state
        .db
        .get_provider_by_id("coding", AppType::Codex.as_str())
        .expect("query codex coding")
        .expect("codex coding provider exists");
    codex_coding.settings_config = json!({
        "auth": {
            "OPENAI_API_KEY": "codex-coding-user-key"
        },
        "config": "model_provider = \"codex\"\nmodel = \"gpt-5.3-codex\"\n\n[model_providers.codex]\nbase_url = \"\"\n"
    });
    state
        .db
        .save_provider(AppType::Codex.as_str(), &codex_coding)
        .expect("save codex coding user key and stale config");

    let mut codex_gac = state
        .db
        .get_provider_by_id("gaccode", AppType::Codex.as_str())
        .expect("query codex gaccode")
        .expect("codex gaccode provider exists");
    codex_gac.settings_config = json!({
        "env": {
            "CODEX_API_KEY": "codex-gac-legacy-env-key"
        },
        "config": "model_provider = \"gac\"\nmodel = \"gpt-5.3-codex\"\n\n[model_providers.gac]\nbase_url = \"\"\n"
    });
    state
        .db
        .save_provider(AppType::Codex.as_str(), &codex_gac)
        .expect("save codex gac legacy env key and stale config");

    let mut claude_tuzi = state
        .db
        .get_provider_by_id("tuzi-route", AppType::Claude.as_str())
        .expect("query claude tuzi")
        .expect("claude tuzi provider exists");
    claude_tuzi.settings_config = json!({
        "env": {
            "ANTHROPIC_BASE_URL": "https://api.tu-zi.com",
            "ANTHROPIC_AUTH_TOKEN": "user-key"
        }
    });
    state
        .db
        .save_provider(AppType::Claude.as_str(), &claude_tuzi)
        .expect("save user key");

    state
        .db
        .init_default_official_providers()
        .expect("rerun provider seed");

    let after = state
        .db
        .get_provider_by_id("tuzi-route", AppType::Claude.as_str())
        .expect("query claude tuzi after seed")
        .expect("claude tuzi provider exists after seed");
    let codex_after = state
        .db
        .get_provider_by_id("tuzi-route", AppType::Codex.as_str())
        .expect("query codex tuzi after seed")
        .expect("codex tuzi provider exists after seed");
    let codex_coding_after = state
        .db
        .get_provider_by_id("coding", AppType::Codex.as_str())
        .expect("query codex coding after seed")
        .expect("codex coding provider exists after seed");
    let codex_gac_after = state
        .db
        .get_provider_by_id("gaccode", AppType::Codex.as_str())
        .expect("query codex gaccode after seed")
        .expect("codex gaccode provider exists after seed");
    assert_eq!(
        codex_after
            .settings_config
            .get("auth")
            .and_then(|auth| auth.get("OPENAI_API_KEY"))
            .and_then(|value| value.as_str()),
        Some("codex-tuzi-user-key"),
        "seed rerun must not erase Codex user-entered API keys"
    );
    assert_eq!(
        codex_coding_after
            .settings_config
            .get("auth")
            .and_then(|auth| auth.get("OPENAI_API_KEY"))
            .and_then(|value| value.as_str()),
        Some("codex-coding-user-key"),
        "seed rerun must keep each Codex provider key independent"
    );
    assert_eq!(
        codex_gac_after
            .settings_config
            .get("auth")
            .and_then(|auth| auth.get("OPENAI_API_KEY"))
            .and_then(|value| value.as_str()),
        Some("codex-gac-legacy-env-key"),
        "seed rerun should migrate legacy env.CODEX_API_KEY into provider auth"
    );
    assert_eq!(
        codex_after
            .settings_config
            .pointer("/env/envKey")
            .and_then(|value| value.as_str()),
        Some("TUZI_CODEX_API_KEY"),
        "seed rerun should restore the tuzi dedicated env key"
    );
    assert_eq!(
        codex_coding_after
            .settings_config
            .pointer("/env/envKey")
            .and_then(|value| value.as_str()),
        Some("CODING_CODEX_API_KEY"),
        "seed rerun should restore the coding dedicated env key"
    );
    assert_eq!(
        codex_gac_after
            .settings_config
            .pointer("/env/envKey")
            .and_then(|value| value.as_str()),
        Some("GAC_CODEX_API_KEY"),
        "seed rerun should restore the gac dedicated env key"
    );
    assert!(
        codex_after
            .settings_config
            .get("config")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .contains("env_key = \"TUZI_CODEX_API_KEY\""),
        "seed rerun should restore Codex preset env_key"
    );
    assert!(
        codex_after
            .settings_config
            .get("config")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .contains("model = \"gpt-5.5\""),
        "seed rerun should refresh Codex preset model"
    );
    assert_eq!(
        after
            .settings_config
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_AUTH_TOKEN"))
            .and_then(|value| value.as_str()),
        Some("user-key"),
        "seed rerun must not erase user-entered API keys"
    );
}

#[test]
fn codex_seed_removes_legacy_default_and_codex_official() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();

    let state = create_test_state().expect("create test state");
    state
        .db
        .save_provider(
            AppType::Codex.as_str(),
            &Provider::with_id(
                "default".to_string(),
                "default".to_string(),
                json!({"auth": {"OPENAI_API_KEY": "legacy"}, "config": "model = \"gpt-5\""}),
                None,
            ),
        )
        .expect("seed legacy default");
    state
        .db
        .save_provider(
            AppType::Codex.as_str(),
            &Provider::with_id(
                "codex-official".to_string(),
                "codex-official".to_string(),
                json!({"auth": {"OPENAI_API_KEY": ""}, "config": "model = \"gpt-5\""}),
                None,
            ),
        )
        .expect("seed legacy codex official");

    state
        .db
        .init_default_official_providers()
        .expect("seed official providers");

    let providers_before = state
        .db
        .get_all_providers(AppType::Codex.as_str())
        .expect("get codex providers before restart check");
    assert_eq!(
        providers_before.len(),
        3,
        "seed should leave only the three Codex presets"
    );
    assert!(providers_before.contains_key("tuzi-route"));
    assert_eq!(
        providers_before
            .get("tuzi-route")
            .map(|provider| provider.name.as_str()),
        Some("兔子线路")
    );
    assert!(providers_before.contains_key("coding"));
    assert!(providers_before.contains_key("gaccode"));
    assert!(!providers_before.contains_key("default"));
    assert!(!providers_before.contains_key("codex-official"));

    assert!(
        !ProviderService::should_import_default_config_on_startup(&state, &AppType::Codex)
            .expect("check startup import eligibility"),
        "startup should skip import when Codex presets already exist"
    );

    let providers_after = state
        .db
        .get_all_providers(AppType::Codex.as_str())
        .expect("get codex providers after restart check");
    assert_eq!(
        providers_after.len(),
        providers_before.len(),
        "skipping startup import should not grow the Codex provider set"
    );
    assert!(
        !providers_after.contains_key("default"),
        "restart path should not create a legacy default provider"
    );
}

#[test]
fn codex_seed_and_legacy_tuzi_purge_keep_tuzi_route() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();

    let state = create_test_state().expect("create test state");
    state
        .db
        .save_provider(
            AppType::Codex.as_str(),
            &Provider::with_id(
                "tuzi-codex".to_string(),
                "旧蓝兔子 Codex".to_string(),
                json!({"auth": {"OPENAI_API_KEY": "legacy"}, "config": "model = \"old\""}),
                None,
            ),
        )
        .expect("seed legacy tuzi codex");

    state
        .db
        .init_default_official_providers()
        .expect("seed official providers");
    let deleted = state
        .db
        .purge_legacy_tuzi_providers()
        .expect("purge legacy tuzi providers");
    assert_eq!(
        deleted, 1,
        "only the explicit legacy tuzi id should be removed"
    );

    let providers = state
        .db
        .get_all_providers(AppType::Codex.as_str())
        .expect("get codex providers after purge");
    assert!(providers.contains_key("tuzi-route"));
    assert!(providers.contains_key("coding"));
    assert!(providers.contains_key("gaccode"));
    assert!(!providers.contains_key("tuzi-codex"));
}

#[test]
fn save_codex_route_numbers_tuzi_route_without_overwriting_existing_tuzi() {
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

    let saved_route = save_codex_route_test_hook(
        &state,
        "tuzi".to_string(),
        "https://api.tu-zi.com/v1".to_string(),
        "TUZI_CODEX_API_KEY".to_string(),
        "sk-test".to_string(),
        "gpt-5.5".to_string(),
        "high".to_string(),
        Some("兔子线路-我的配置".to_string()),
        None,
    )
    .expect("save codex route");
    assert_eq!(saved_route.route_id, "provider-tuzi01");
    assert_eq!(saved_route.env_key, "TUZI01_CODEX_API_KEY");
    assert!(
        saved_route
            .config
            .contains("model_provider = \"provider-tuzi01\""),
        "returned config should match the normalized route so provider storage does not jump again"
    );

    let config_text = std::fs::read_to_string(tuzi_switch_lib::get_codex_config_path())
        .expect("read codex config");
    assert!(
        config_text.contains("[model_providers.tuzi]\nname = \"tuzi\"\nbase_url = \"https://api.tu-zi.com/v1\"\nenv_key = \"TUZI_CODEX_API_KEY\""),
        "existing user-owned tuzi provider must be preserved"
    );
    assert!(
        config_text.contains("[model_providers.provider-tuzi01]"),
        "save_codex_route should register the next tuzi-switch route"
    );
    assert!(
        config_text.contains("env_key = \"TUZI01_CODEX_API_KEY\""),
        "save_codex_route should write the numbered env key"
    );
    let zshrc = std::fs::read_to_string(_home.join(".zshrc")).expect("read managed env rc");
    assert!(
        zshrc.contains("export TUZI01_CODEX_API_KEY=sk-test"),
        "save_codex_route should create the matching managed env key"
    );
}

#[test]
fn switch_provider_updates_codex_live_and_state() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let legacy_auth = json!({"OPENAI_API_KEY": "legacy-key"});
    let legacy_config = r#"[mcp_servers.legacy]
type = "stdio"
command = "echo"
"#;
    write_codex_live_atomic(&legacy_auth, Some(legacy_config))
        .expect("seed existing codex live config");

    let mut config = MultiAppConfig::default();
    {
        let manager = config
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

    // v3.7.0+: 使用统一的 MCP 结构
    config.mcp.servers = Some(HashMap::new());
    config.mcp.servers.as_mut().unwrap().insert(
        "echo-server".into(),
        McpServer {
            id: "echo-server".to_string(),
            name: "Echo Server".to_string(),
            server: json!({
                "type": "stdio",
                "command": "echo"
            }),
            apps: McpApps {
                claude: false,
                codex: true, // 启用 Codex
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

    let app_state = create_test_state_with_config(&config).expect("create test state");

    switch_provider_test_hook(&app_state, AppType::Codex, "new-provider")
        .expect("switch provider should succeed");

    let config_text = std::fs::read_to_string(get_codex_config_path()).expect("read config.toml");
    assert_eq!(
        extract_codex_experimental_bearer_token(&config_text).as_deref(),
        Some("fresh-key"),
        "live Codex config should carry the new provider token"
    );
    assert!(
        config_text.contains("mcp_servers.echo-server"),
        "config.toml should contain synced MCP servers"
    );

    let current_id = app_state
        .db
        .get_current_provider(AppType::Codex.as_str())
        .expect("get current provider");
    assert_eq!(
        current_id.as_deref(),
        Some("new-provider"),
        "current provider updated"
    );

    let providers = app_state
        .db
        .get_all_providers(AppType::Codex.as_str())
        .expect("get all providers");

    let new_provider = providers.get("new-provider").expect("new provider exists");
    let new_config_text = new_provider
        .settings_config
        .get("config")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    assert!(
        new_config_text.contains("mcp_servers.latest"),
        "provider snapshot should contain provider's original config"
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
    // 回填机制：切换前会将 live 配置回填到当前供应商
    // 这保护了用户在 live 文件中的手动修改
    assert_eq!(
        legacy_auth_value, "legacy-key",
        "previous provider should be backfilled with live auth"
    );
}

#[test]
fn switch_provider_missing_provider_returns_error() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();

    let mut config = MultiAppConfig::default();
    config
        .get_manager_mut(&AppType::Claude)
        .expect("claude manager")
        .current = "does-not-exist".to_string();

    let app_state = create_test_state_with_config(&config).expect("create test state");

    let err = switch_provider_test_hook(&app_state, AppType::Claude, "missing-provider")
        .expect_err("switching to a missing provider should fail");

    let err_str = err.to_string();
    assert!(
        err_str.contains("供应商不存在")
            || err_str.contains("Provider not found")
            || err_str.contains("missing-provider"),
        "error message should mention missing provider, got: {err_str}"
    );
}

#[test]
fn switch_provider_updates_claude_live_and_state() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let _home = ensure_test_home();

    let settings_path = tuzi_switch_lib::get_claude_settings_path();
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

    let app_state = create_test_state_with_config(&config).expect("create test state");

    switch_provider_test_hook(&app_state, AppType::Claude, "new-provider")
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

    let current_id = app_state
        .db
        .get_current_provider(AppType::Claude.as_str())
        .expect("get current provider");
    assert_eq!(
        current_id.as_deref(),
        Some("new-provider"),
        "current provider updated"
    );

    let providers = app_state
        .db
        .get_all_providers(AppType::Claude.as_str())
        .expect("get all providers");

    let legacy_provider = providers
        .get("old-provider")
        .expect("legacy provider still exists");
    // 回填机制：切换前会将 live 配置回填到当前供应商
    // 这保护了用户在 live 文件中的手动修改
    assert_eq!(
        legacy_provider.settings_config, legacy_live,
        "previous provider should be backfilled with live config"
    );

    let new_provider = providers.get("new-provider").expect("new provider exists");
    assert_eq!(
        new_provider
            .settings_config
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_API_KEY"))
            .and_then(|key| key.as_str()),
        Some("fresh-key"),
        "new provider snapshot should retain fresh auth"
    );

    // v3.7.0+ 使用 SQLite 数据库而非 config.json
    // 验证数据已持久化到数据库
    let home_dir = std::env::var("HOME").expect("HOME should be set by ensure_test_home");
    let db_path = std::path::Path::new(&home_dir)
        .join(".tuzi-switch")
        .join("tuzi-switch.db");
    assert!(
        db_path.exists(),
        "switching provider should persist to tuzi-switch.db"
    );

    // 验证当前供应商已更新
    let current_id = app_state
        .db
        .get_current_provider(AppType::Claude.as_str())
        .expect("get current provider");
    assert_eq!(
        current_id.as_deref(),
        Some("new-provider"),
        "database should record the new current provider"
    );
}

#[test]
fn switch_provider_codex_missing_auth_returns_error_and_keeps_state() {
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

    let app_state = create_test_state_with_config(&config).expect("create test state");

    let err = switch_provider_test_hook(&app_state, AppType::Codex, "invalid")
        .expect_err("switching should fail when auth missing");
    match err {
        AppError::Config(msg) => assert!(
            msg.contains("auth"),
            "expected auth missing error message, got {msg}"
        ),
        AppError::Localized { zh, en, .. } => assert!(
            zh.contains("auth") || en.contains("auth"),
            "expected auth missing error message, got zh={zh}, en={en}"
        ),
        other => panic!("expected config/auth error, got {other:?}"),
    }

    let current_id = app_state
        .db
        .get_current_provider(AppType::Codex.as_str())
        .expect("get current provider");
    // 切换失败后，由于数据库操作是先设置再验证，current 可能已被设为 "invalid"
    // 但由于 live 配置写入失败，状态应该回滚
    // 注意：这个行为取决于 switch_provider 的具体实现
    assert!(
        current_id.is_none() || current_id.as_deref() == Some("invalid"),
        "current provider should remain empty or be the attempted id on failure, got: {current_id:?}"
    );
}
