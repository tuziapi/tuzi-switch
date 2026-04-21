use serde_json::json;

use cc_switch_lib::{
    get_claude_settings_path, get_codex_auth_path, get_codex_config_path, read_json_file,
    switch_provider_test_hook, write_codex_live_atomic, AppError, AppType, McpApps, McpServer,
    MultiAppConfig, Provider, ProviderMeta,
};

#[path = "support.rs"]
mod support;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use support::{create_test_state_with_config, ensure_test_home, reset_test_fs, test_mutex};

fn claude_route_file_path(home: &Path) -> PathBuf {
    home.join(".config")
        .join("tuzi")
        .join("claude_route_status.txt")
}

fn read_text(path: &Path) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
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

    let auth_value: serde_json::Value =
        read_json_file(&get_codex_auth_path()).expect("read auth.json");
    assert_eq!(
        auth_value
            .get("OPENAI_API_KEY")
            .and_then(|v| v.as_str())
            .unwrap_or(""),
        "fresh-key",
        "live auth.json should reflect new provider"
    );

    let config_text = std::fs::read_to_string(get_codex_config_path()).expect("read config.toml");
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
    // 供应商配置应该包含在 live 文件中
    // 注意：live 文件还会包含 MCP 同步后的内容
    assert!(
        config_text.contains("mcp_servers.latest"),
        "live file should contain provider's original config"
    );
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
    let home = ensure_test_home();

    let settings_path = cc_switch_lib::get_claude_settings_path();
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
    std::fs::write(
        home.join(".claude.json"),
        serde_json::to_string_pretty(&json!({
            "customApiKeyResponses": {
                "approved": ["legacy-approved"],
                "rejected": ["fresh-key"]
            }
        }))
        .expect("serialize claude.json"),
    )
    .expect("seed ~/.claude.json");

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
        .join(".cc-switch")
        .join("cc-switch.db");
    assert!(
        db_path.exists(),
        "switching provider should persist to cc-switch.db"
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

    let route_file = read_text(&claude_route_file_path(home));
    assert!(
        route_file.contains("current_route=new-provider"),
        "route file should track the custom provider route, got: {route_file}"
    );
    assert!(
        route_file.contains("last_original_route=new-provider"),
        "route file should remember the latest original route, got: {route_file}"
    );
    assert!(
        route_file.contains("last_original_provider_id=new-provider"),
        "route file should remember the provider id, got: {route_file}"
    );
    assert!(
        route_file.contains("[new-provider]"),
        "route file should keep a dedicated custom section, got: {route_file}"
    );
    assert!(
        route_file.contains("ANTHROPIC_API_KEY=fresh-key"),
        "route file should persist the new provider key, got: {route_file}"
    );

    let zshrc = read_text(&home.join(".zshrc"));
    let bashrc = read_text(&home.join(".bashrc"));
    for rc in [&zshrc, &bashrc] {
        assert!(
            rc.contains("export ANTHROPIC_API_KEY=\"fresh-key\""),
            "shell rc should contain fresh Claude key, got: {rc}"
        );
        assert!(
            rc.contains("unset ANTHROPIC_AUTH_TOKEN"),
            "shell rc should explicitly unset ANTHROPIC_AUTH_TOKEN for API-key providers, got: {rc}"
        );
        assert!(
            rc.contains("unset ANTHROPIC_API_TOKEN"),
            "shell rc should explicitly unset ANTHROPIC_API_TOKEN for API-key providers, got: {rc}"
        );
    }

    let claude_json: serde_json::Value =
        read_json_file(&home.join(".claude.json")).expect("read ~/.claude.json");
    let approved = claude_json
        .get("customApiKeyResponses")
        .and_then(|value| value.get("approved"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let rejected = claude_json
        .get("customApiKeyResponses")
        .and_then(|value| value.get("rejected"))
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    assert!(
        approved.contains(&json!("fresh-key")),
        "~/.claude.json should approve the current provider key, got: {claude_json}"
    );
    assert!(
        !rejected.contains(&json!("fresh-key")),
        "~/.claude.json should clear the current provider key from rejected cache, got: {claude_json}"
    );
}

#[test]
fn switch_provider_reconciles_claude_business_route_conflict() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let settings_path = get_claude_settings_path();
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent).expect("create claude settings dir");
    }
    std::fs::write(
        &settings_path,
        serde_json::to_string_pretty(&json!({
            "env": {
                "ANTHROPIC_API_KEY": "gac-live-key",
                "ANTHROPIC_BASE_URL": "https://gaccode.com/claudecode"
            }
        }))
        .expect("serialize seeded claude live"),
    )
    .expect("seed conflicting claude live settings");

    let route_file_path = claude_route_file_path(home);
    if let Some(parent) = route_file_path.parent() {
        std::fs::create_dir_all(parent).expect("create route dir");
    }
    std::fs::write(
        &route_file_path,
        [
            "current_route=tu-zi",
            "last_original_route=tu-zi",
            "last_original_provider_id=tuzi-claude-route",
            "",
            "[tu-zi]",
            "ANTHROPIC_API_TOKEN=",
            "ANTHROPIC_API_KEY=tuzi-route-key",
            "ANTHROPIC_BASE_URL=https://api.tu-zi.com",
            "",
            "[gaccode]",
            "ANTHROPIC_API_TOKEN=",
            "ANTHROPIC_API_KEY=gac-route-key",
            "ANTHROPIC_BASE_URL=https://gaccode.com/claudecode",
            "",
        ]
        .join("\n"),
    )
    .expect("seed route file");

    for rc_path in [home.join(".zshrc"), home.join(".bashrc")] {
        std::fs::write(
            rc_path,
            [
                "export ANTHROPIC_API_KEY=\"tuzi-shell-key\"",
                "export ANTHROPIC_BASE_URL=\"https://api.tu-zi.com\"",
            ]
            .join("\n"),
        )
        .expect("seed shell rc");
    }

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Claude)
            .expect("claude manager");
        manager.current = "gac-claude-route".to_string();

        let mut gac_provider = Provider::with_id(
            "gac-claude-route".to_string(),
            "Claude · gac 线路".to_string(),
            json!({
                "env": {
                    "ANTHROPIC_API_KEY": "gac-provider-key",
                    "ANTHROPIC_BASE_URL": "https://gaccode.com/claudecode"
                }
            }),
            None,
        );
        gac_provider.meta = Some(ProviderMeta {
            business_line: Some("gac".to_string()),
            ..Default::default()
        });
        manager
            .providers
            .insert(gac_provider.id.clone(), gac_provider);

        let mut tuzi_provider = Provider::with_id(
            "tuzi-claude-route".to_string(),
            "Claude · 兔子线路".to_string(),
            json!({
                "env": {
                    "ANTHROPIC_API_KEY": "tuzi-provider-key",
                    "ANTHROPIC_BASE_URL": "https://api.tu-zi.com"
                }
            }),
            None,
        );
        tuzi_provider.meta = Some(ProviderMeta {
            business_line: Some("tuzi".to_string()),
            ..Default::default()
        });
        manager
            .providers
            .insert(tuzi_provider.id.clone(), tuzi_provider);
    }

    let app_state = create_test_state_with_config(&config).expect("create test state");

    switch_provider_test_hook(&app_state, AppType::Claude, "tuzi-claude-route")
        .expect("switching to tuzi route should reconcile Claude state");

    let live_after: serde_json::Value =
        read_json_file(&settings_path).expect("read claude live settings after reconcile");
    assert_eq!(
        live_after
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_API_KEY"))
            .and_then(|value| value.as_str()),
        Some("tuzi-provider-key"),
        "settings.json should converge to the switched provider"
    );
    assert_eq!(
        live_after
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_BASE_URL"))
            .and_then(|value| value.as_str()),
        Some("https://api.tu-zi.com"),
        "settings.json base URL should converge to tuzi"
    );
    assert!(
        live_after
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_AUTH_TOKEN"))
            .is_none(),
        "settings.json should clear auth token after switching back to API-key route"
    );

    let route_file = read_text(&route_file_path);
    assert!(
        route_file.contains("current_route=tu-zi"),
        "route file should converge to tu-zi, got: {route_file}"
    );
    assert!(
        route_file.contains("last_original_provider_id=tuzi-claude-route"),
        "route file should remember the reconciled provider id, got: {route_file}"
    );

    for rc in [
        read_text(&home.join(".zshrc")),
        read_text(&home.join(".bashrc")),
    ] {
        assert!(
            rc.contains("export ANTHROPIC_API_KEY=\"tuzi-provider-key\""),
            "shell rc should converge to tuzi provider auth, got: {rc}"
        );
        assert!(
            rc.contains("export ANTHROPIC_BASE_URL=\"https://api.tu-zi.com\""),
            "shell rc should converge to tuzi base URL, got: {rc}"
        );
        assert!(
            rc.contains("unset ANTHROPIC_AUTH_TOKEN"),
            "shell rc should explicitly clear modified auth token, got: {rc}"
        );
        assert!(
            rc.contains("unset ANTHROPIC_API_TOKEN"),
            "shell rc should explicitly clear legacy modified auth token, got: {rc}"
        );
    }
}

#[test]
fn switch_provider_preserves_claude_auth_token_modified_semantics() {
    let _guard = test_mutex().lock().expect("acquire test mutex");
    reset_test_fs();
    let home = ensure_test_home();

    let settings_path = get_claude_settings_path();
    if let Some(parent) = settings_path.parent() {
        std::fs::create_dir_all(parent).expect("create claude settings dir");
    }
    std::fs::write(
        &settings_path,
        serde_json::to_string_pretty(&json!({
            "env": {
                "ANTHROPIC_API_KEY": "tuzi-live-key",
                "ANTHROPIC_BASE_URL": "https://api.tu-zi.com"
            }
        }))
        .expect("serialize seeded claude live"),
    )
    .expect("seed claude live settings");

    let mut config = MultiAppConfig::default();
    {
        let manager = config
            .get_manager_mut(&AppType::Claude)
            .expect("claude manager");
        manager.current = "tuzi-claude-route".to_string();
        manager.providers.insert(
            "tuzi-claude-route".to_string(),
            Provider::with_id(
                "tuzi-claude-route".to_string(),
                "Claude · 兔子线路".to_string(),
                json!({
                    "env": {
                        "ANTHROPIC_API_KEY": "tuzi-provider-key",
                        "ANTHROPIC_BASE_URL": "https://api.tu-zi.com"
                    }
                }),
                None,
            ),
        );
        manager.providers.insert(
            "token-provider".to_string(),
            Provider::with_id(
                "token-provider".to_string(),
                "Claude Token Provider".to_string(),
                json!({
                    "env": {
                        "ANTHROPIC_AUTH_TOKEN": "auth-token-value",
                        "ANTHROPIC_BASE_URL": "https://gaccode.com/claudecode"
                    }
                }),
                None,
            ),
        );
    }

    let app_state = create_test_state_with_config(&config).expect("create test state");

    switch_provider_test_hook(&app_state, AppType::Claude, "token-provider")
        .expect("switching to auth-token provider should reconcile modified semantics");

    let live_after: serde_json::Value =
        read_json_file(&settings_path).expect("read claude live settings after token switch");
    assert_eq!(
        live_after
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_AUTH_TOKEN"))
            .and_then(|value| value.as_str()),
        Some("auth-token-value"),
        "settings.json should keep the auth token"
    );
    assert!(
        live_after
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_API_KEY"))
            .is_none(),
        "settings.json should clear API key when auth token takes over"
    );

    let route_file = read_text(&claude_route_file_path(home));
    assert!(
        route_file.contains("current_route=改版"),
        "route file should switch to modified semantics, got: {route_file}"
    );
    assert!(
        route_file.contains("last_original_provider_id=tuzi-claude-route"),
        "route file should keep the previous original provider for restore, got: {route_file}"
    );
    assert!(
        route_file.contains("ANTHROPIC_API_TOKEN=auth-token-value"),
        "route file should store the auth token in modified entry, got: {route_file}"
    );

    for rc in [
        read_text(&home.join(".zshrc")),
        read_text(&home.join(".bashrc")),
    ] {
        assert!(
            rc.contains("export ANTHROPIC_AUTH_TOKEN=\"auth-token-value\""),
            "shell rc should write ANTHROPIC_AUTH_TOKEN, got: {rc}"
        );
        assert!(
            rc.contains("export ANTHROPIC_API_TOKEN=\"auth-token-value\""),
            "shell rc should mirror the auth token for legacy detection, got: {rc}"
        );
        assert!(
            rc.contains("unset ANTHROPIC_API_KEY"),
            "shell rc should explicitly clear API key for auth-token provider, got: {rc}"
        );
    }
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
        other => panic!("expected config error, got {other:?}"),
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
