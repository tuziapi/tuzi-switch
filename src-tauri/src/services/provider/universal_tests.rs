// Synthetic fixtures only; with_test_home redirects every tool path to a temp directory.
#[test]
#[serial]
fn universal_proxy_sync_keeps_takeover_and_updates_backup() {
    with_test_home(|state, _| {
        let mut p = universal_fixture(state);
        let id = "universal-claude-shared";
        state.db.set_current_provider("claude", id).unwrap();
        crate::settings::set_current_provider(&AppType::Claude, Some(id)).unwrap();
        let takeover = json!({"env":{"ANTHROPIC_BASE_URL":"http://127.0.0.1:5000","ANTHROPIC_AUTH_TOKEN":"PROXY_MANAGED"}});
        write_json_file(&get_claude_settings_path(), &takeover).unwrap();
        futures::executor::block_on(state.db.save_live_backup("claude", "{\"env\":{}}")).unwrap();
        p.api_key = "synthetic-proxy-updated-key".into();
        ProviderService::upsert_universal(state, p.clone()).unwrap();
        ProviderService::sync_universal_to_apps(state, &p.id).unwrap();
        assert_eq!(
            read_json_file::<Value>(&get_claude_settings_path()).unwrap(),
            takeover
        );
        let backup = futures::executor::block_on(state.db.get_live_backup("claude"))
            .unwrap()
            .unwrap();
        let contents: Value = serde_json::from_str(&backup.original_config).unwrap();
        assert_eq!(contents["env"]["ANTHROPIC_AUTH_TOKEN"], p.api_key);
    });
}

fn universal_fixture(state: &AppState) -> UniversalProvider {
    crate::settings::reload_settings().unwrap();
    let mut p = UniversalProvider::new(
        "shared".into(),
        "Synthetic Gateway".into(),
        "custom_gateway".into(),
        "https://gateway.example.invalid".into(),
        "synthetic-key".into(),
    );
    p.apps.claude = true;
    p.apps.codex = true;
    p.apps.gemini = true;
    ProviderService::upsert_universal(state, p.clone()).unwrap();
    ProviderService::sync_universal_to_apps(state, &p.id).unwrap();
    p
}

#[test]
#[serial]
fn universal_creation_does_not_activate_or_write_tool_files() {
    with_test_home(|state, _| {
        crate::settings::reload_settings().unwrap();
        let before: Vec<_> = [AppType::Claude, AppType::Codex, AppType::Gemini]
            .iter()
            .map(|app| crate::settings::get_effective_current_provider(&state.db, app).unwrap())
            .collect();
        universal_fixture(state);
        for (index, app) in [AppType::Claude, AppType::Codex, AppType::Gemini]
            .iter()
            .enumerate()
        {
            assert_eq!(
                state
                    .db
                    .get_all_providers(app.as_str())
                    .unwrap()
                    .keys()
                    .filter(|id| id.starts_with("universal-"))
                    .count(),
                1
            );
            assert_eq!(
                crate::settings::get_effective_current_provider(&state.db, app).unwrap(),
                before[index]
            );
        }
        assert!(!get_claude_settings_path().exists());
        assert!(!crate::codex_config::get_codex_config_path().exists());
        assert!(!crate::gemini_config::get_gemini_env_path().exists());
    });
}

#[test]
#[serial]
fn universal_sync_preserves_tool_metadata_and_codex_toml() {
    with_test_home(|state, _| {
        let mut p = universal_fixture(state);
        for app in ["claude", "codex", "gemini"] {
            let id = format!("universal-{app}-shared");
            let mut child = state.db.get_provider_by_id(&id, app).unwrap().unwrap();
            child.created_at = Some(123);
            child.sort_index = Some(9);
            child.meta = Some(
                serde_json::from_value(
                    json!({"commonConfigEnabled": false, "endpointAutoSelect": true}),
                )
                .unwrap(),
            );
            child.settings_config["local_setting"] = json!("keep");
            if app == "codex" {
                let config = child.settings_config["config"].as_str().unwrap();
                child.settings_config["config"] = json!(format!("approval_policy = \"on-request\"\n{config}\n[mcp_servers.fixture]\ncommand = \"synthetic\"\n"));
            }
            state.db.save_provider(app, &child).unwrap();
            state
                .db
                .add_custom_endpoint(app, &id, "https://extra.example.invalid")
                .unwrap();
        }
        p.name = "Updated Gateway".into();
        p.api_key = "synthetic-updated-key".into();
        ProviderService::upsert_universal(state, p.clone()).unwrap();
        ProviderService::sync_universal_to_apps(state, &p.id).unwrap();
        for app in ["claude", "codex", "gemini"] {
            let id = format!("universal-{app}-shared");
            let child = state
                .db
                .get_all_providers(app)
                .unwrap()
                .shift_remove(&id)
                .unwrap();
            assert_eq!(child.name, "Updated Gateway");
            assert_eq!(child.created_at, Some(123));
            assert_eq!(child.sort_index, Some(9));
            assert_eq!(child.settings_config["local_setting"], "keep");
            let meta = serde_json::to_value(&child.meta).unwrap();
            assert_eq!(meta["endpointAutoSelect"], true);
            assert_eq!(child.meta.as_ref().unwrap().custom_endpoints.len(), 1);
            if app == "codex" {
                let doc = child.settings_config["config"]
                    .as_str()
                    .unwrap()
                    .parse::<toml_edit::DocumentMut>()
                    .unwrap();
                assert_eq!(doc["approval_policy"].as_str(), Some("on-request"));
                assert_eq!(
                    doc["mcp_servers"]["fixture"]["command"].as_str(),
                    Some("synthetic")
                );
            }
        }
    });
}

#[test]
#[serial]
fn universal_sync_updates_three_active_tool_files_and_retries_same_records() {
    with_test_home(|state, _| {
        let mut p = universal_fixture(state);
        for app in [AppType::Claude, AppType::Codex, AppType::Gemini] {
            let id = format!("universal-{}-shared", app.as_str());
            state.db.set_current_provider(app.as_str(), &id).unwrap();
            crate::settings::set_current_provider(&app, Some(&id)).unwrap();
        }
        p.base_url = "https://updated.example.invalid".into();
        p.api_key = "synthetic-updated-key".into();
        let official_auth = json!({"tokens":{"access_token":"synthetic-official-token"}});
        write_json_file(&crate::codex_config::get_codex_auth_path(), &official_auth).unwrap();
        ProviderService::upsert_universal(state, p.clone()).unwrap();
        for _ in 0..2 {
            ProviderService::sync_universal_to_apps(state, &p.id).unwrap();
        }
        let claude: Value = read_json_file(&get_claude_settings_path()).unwrap();
        assert_eq!(claude["env"]["ANTHROPIC_AUTH_TOKEN"], p.api_key);
        assert_eq!(claude["env"]["ANTHROPIC_BASE_URL"], p.base_url);
        let codex = fs::read_to_string(crate::codex_config::get_codex_config_path()).unwrap();
        assert!(codex.contains("https://updated.example.invalid/v1"));
        let child = state
            .db
            .get_provider_by_id("universal-codex-shared", "codex")
            .unwrap()
            .unwrap();
        let key_name = codex_provider_env_key(&child).expect("isolated Codex credential index");
        assert_eq!(
            crate::codex_config::read_managed_env_key(&key_name).as_deref(),
            Some(p.api_key.as_str())
        );
        assert_eq!(
            read_json_file::<Value>(&crate::codex_config::get_codex_auth_path()).unwrap(),
            official_auth
        );
        let gemini = crate::gemini_config::read_gemini_env().unwrap();
        assert_eq!(gemini["GEMINI_API_KEY"], p.api_key);
        for app in ["claude", "codex", "gemini"] {
            assert_eq!(
                state
                    .db
                    .get_all_providers(app)
                    .unwrap()
                    .keys()
                    .filter(|id| id.starts_with("universal-"))
                    .count(),
                1
            );
        }
        crate::settings::reload_settings().unwrap();
        assert_eq!(
            crate::settings::get_effective_current_provider(&state.db, &AppType::Claude)
                .unwrap()
                .as_deref(),
            Some("universal-claude-shared")
        );
    });
}

#[test]
#[serial]
fn universal_records_survive_database_reopen() {
    with_test_home(|_, _| {
        let id = {
            let state = AppState::new(Arc::new(Database::init().unwrap()));
            universal_fixture(&state).id
        };
        crate::settings::reload_settings().unwrap();
        let state = AppState::new(Arc::new(Database::init().unwrap()));
        let p = ProviderService::get_universal(&state, &id)
            .unwrap()
            .unwrap();
        assert_eq!(p.name, "Synthetic Gateway");
        for app in ["claude", "codex", "gemini"] {
            assert!(state
                .db
                .get_provider_by_id(&format!("universal-{app}-{id}"), app)
                .unwrap()
                .is_some());
        }
    });
}

#[test]
#[serial]
fn universal_codex_gateways_use_distinct_stable_credentials() {
    with_test_home(|state, _| {
        let first = universal_fixture(state);
        ProviderService::sync_universal_to_apps(state, &first.id).unwrap();
        let first_child = state
            .db
            .get_provider_by_id("universal-codex-shared", "codex")
            .unwrap()
            .unwrap();
        let first_key = codex_provider_env_key(&first_child).unwrap();
        let mut second = first.clone();
        second.id = "second".into();
        second.api_key = "synthetic-second-key".into();
        second.apps.claude = false;
        second.apps.gemini = false;
        ProviderService::upsert_universal(state, second.clone()).unwrap();
        ProviderService::sync_universal_to_apps(state, &second.id).unwrap();
        ProviderService::sync_universal_to_apps(state, &second.id).unwrap();
        let second_child = state
            .db
            .get_provider_by_id("universal-codex-second", "codex")
            .unwrap()
            .unwrap();
        let second_key = codex_provider_env_key(&second_child).unwrap();
        assert_ne!(first_key, second_key);
        assert_eq!(
            crate::codex_config::read_managed_env_key(&first_key).as_deref(),
            Some(first.api_key.as_str())
        );
        assert_eq!(
            crate::codex_config::read_managed_env_key(&second_key).as_deref(),
            Some(second.api_key.as_str())
        );
        ProviderService::sync_universal_to_apps(state, &second.id).unwrap();
        let reloaded = state
            .db
            .get_provider_by_id("universal-codex-second", "codex")
            .unwrap()
            .unwrap();
        assert_eq!(
            codex_provider_env_key(&reloaded).as_deref(),
            Some(second_key.as_str())
        );
    });
}

#[test]
#[serial]
fn universal_partial_failure_updates_other_tools_and_is_retryable() {
    with_test_home(|state, _| {
        let mut p = universal_fixture(state);
        let id = "universal-claude-shared";
        state.db.set_current_provider("claude", id).unwrap();
        crate::settings::set_current_provider(&AppType::Claude, Some(id)).unwrap();
        let path = get_claude_settings_path();
        fs::create_dir_all(&path).unwrap(); // A directory blocks the atomic file replacement.
        p.api_key = "synthetic-retry-key".into();
        ProviderService::upsert_universal(state, p.clone()).unwrap();
        let error = ProviderService::sync_universal_to_apps(state, &p.id)
            .unwrap_err()
            .to_string();
        assert!(error.contains("claude"));
        assert!(!error.contains(&p.api_key));
        let gemini = state
            .db
            .get_provider_by_id("universal-gemini-shared", "gemini")
            .unwrap()
            .unwrap();
        assert_eq!(gemini.settings_config["env"]["GEMINI_API_KEY"], p.api_key);
        fs::remove_dir(&path).unwrap();
        ProviderService::sync_universal_to_apps(state, &p.id).unwrap();
        let live: Value = read_json_file(&path).unwrap();
        assert_eq!(live["env"]["ANTHROPIC_AUTH_TOKEN"], p.api_key);
    });
}

#[test]
#[serial]
fn universal_disable_and_delete_preserve_active_provider() {
    with_test_home(|state, _| {
        let mut p = universal_fixture(state);
        let id = "universal-claude-shared";
        state.db.set_current_provider("claude", id).unwrap();
        crate::settings::set_current_provider(&AppType::Claude, Some(id)).unwrap();
        p.apps.claude = false;
        ProviderService::upsert_universal(state, p.clone()).unwrap();
        assert!(ProviderService::sync_universal_to_apps(state, &p.id).is_err());
        assert!(ProviderService::delete_universal(state, &p.id).is_err());
        assert!(state.db.get_provider_by_id(id, "claude").unwrap().is_some());
        assert!(state.db.get_universal_provider(&p.id).unwrap().is_some());
        crate::settings::set_current_provider(&AppType::Claude, None).unwrap();
        state
            .db
            .clear_current_provider_if_matches("claude", id)
            .unwrap();
        ProviderService::sync_universal_to_apps(state, &p.id).unwrap();
        assert!(state.db.get_provider_by_id(id, "claude").unwrap().is_none());
        ProviderService::delete_universal(state, &p.id).unwrap();
        assert!(state.db.get_universal_provider(&p.id).unwrap().is_none());
        for app in ["claude", "codex", "gemini"] {
            assert!(state
                .db
                .get_all_providers(app)
                .unwrap()
                .keys()
                .all(|id| !id.starts_with("universal-")));
        }
    });
}
