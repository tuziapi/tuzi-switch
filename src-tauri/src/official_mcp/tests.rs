use super::*;
use std::fs;

#[test]
fn config_accepts_only_official_transport_and_preserves_other_entries() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(validate_config(dir.path()), Ok(false));
    let path = dir.path().join("config.toml");
    let prefix = "model = 'synthetic'\n[mcp_servers.other]\ncommand = 'untouched'\n";
    let official = format!("{prefix}[mcp_servers.tuzi-official]\nurl = '{ENDPOINT}'\n");
    fs::write(&path, &official).unwrap();
    assert_eq!(validate_config(dir.path()), Ok(true));
    assert_eq!(fs::read_to_string(&path).unwrap(), official);
    for suffix in [
        "enabled = false\n",
        "bearer_token_env_var = 'SYSTEM_TOKEN'\n",
        "command = 'unexpected'\n",
        "http_headers = { Authorization = 'synthetic' }\n",
    ] {
        fs::write(&path, format!("{official}{suffix}")).unwrap();
        assert_eq!(validate_config(dir.path()), Err("config_conflict"));
    }
    fs::write(
        &path,
        official.replace(ENDPOINT, "https://evil.invalid/mcp"),
    )
    .unwrap();
    assert_eq!(validate_config(dir.path()), Err("config_conflict"));
    fs::write(&path, "[broken").unwrap();
    assert_eq!(validate_config(dir.path()), Err("config_conflict"));
}

#[test]
fn authorization_urls_cannot_escape_the_official_server() {
    assert!(valid_authorization_url(
        "https://api.tu-zi.com/mcp/authorize?resource=https%3A%2F%2Fapi.tu-zi.com%2Fmcp",
        ENDPOINT
    ));
    for url in [
        "https://evil.invalid/mcp/authorize?resource=https://api.tu-zi.com/mcp",
        "http://api.tu-zi.com/mcp/authorize?resource=https://api.tu-zi.com/mcp",
        "https://api.tu-zi.com/redirect?resource=https://api.tu-zi.com/mcp",
        "https://user@api.tu-zi.com/mcp/authorize?resource=https://api.tu-zi.com/mcp",
        "https://api.tu-zi.com/mcp/authorize?resource=https://other.invalid/mcp",
    ] {
        assert!(!valid_authorization_url(url, ENDPOINT));
    }
}

#[test]
fn tool_errors_and_missing_data_cannot_be_reported_as_success() {
    assert!(tool_data(json!({"isError":true,"structuredContent":{"id":1}})).is_err());
    assert!(
        tool_data(json!({"content":[{"type":"text","text":"synthetic private error"}]})).is_err()
    );
    assert_eq!(
        tool_data(json!({"content":[{"type":"text","text":"{\"id\":1}"}]})).unwrap()["id"],
        1
    );
    assert_eq!(
        tool_data(json!({"structuredContent":{"id":1}})).unwrap()["id"],
        1
    );
}

#[test]
#[ignore = "changes process environment; run alone with one test thread"]
fn install_isolated_preserves_settings_and_rolls_back_database_failure() {
    let home = tempfile::tempdir().unwrap();
    std::env::set_var("CC_SWITCH_TEST_HOME", home.path());
    let codex = crate::codex_config::get_codex_config_dir();
    fs::create_dir_all(&codex).unwrap();
    let path = codex.join("config.toml");
    let original =
        "# customer setting\nmodel = 'synthetic'\n[mcp_servers.keep]\ncommand = 'existing'\n";
    fs::write(&path, original).unwrap();
    let state = crate::store::AppState::new(Arc::new(crate::database::Database::memory().unwrap()));
    state.db.conn.lock().unwrap().execute_batch("CREATE TRIGGER fail_official BEFORE INSERT ON mcp_servers BEGIN SELECT RAISE(FAIL, 'synthetic failure'); END;").unwrap();
    assert!(crate::services::McpService::install_official_tuzi(&state, &codex).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), original);
    assert!(state.db.get_all_mcp_servers().unwrap().is_empty());
    state
        .db
        .conn
        .lock()
        .unwrap()
        .execute_batch("DROP TRIGGER fail_official")
        .unwrap();
    crate::services::McpService::install_official_tuzi(&state, &codex).unwrap();
    assert_eq!(validate_config(&codex), Ok(true));
    let content = fs::read_to_string(&path).unwrap();
    assert!(content.contains("# customer setting"));
    let parsed: toml::Value = toml::from_str(&content).unwrap();
    assert_eq!(
        parsed["mcp_servers"]["keep"]["command"].as_str(),
        Some("existing")
    );
    assert_eq!(parsed["model"].as_str(), Some("synthetic"));
    crate::services::McpService::install_official_tuzi(&state, &codex).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), content);
    assert_eq!(state.db.get_all_mcp_servers().unwrap().len(), 1);
    fs::write(
        &path,
        content.replace(ENDPOINT, "https://other.invalid/mcp"),
    )
    .unwrap();
    let conflict = fs::read(&path).unwrap();
    assert!(crate::services::McpService::install_official_tuzi(&state, &codex).is_err());
    assert_eq!(fs::read(&path).unwrap(), conflict);
    std::env::remove_var("CC_SWITCH_TEST_HOME");
}

// Invoked by the API repository's loopback-only Go fixture. This runs the
// installed Codex app-server against the actual API implementation, with
// temporary Codex home/file credentials, no model turns and no real accounts.
#[test]
#[ignore = "requires paired loopback API fixture and installed Codex"]
fn actual_codex_authorization_check_and_revoke() {
    let (Ok(binary), Ok(endpoint)) = (
        std::env::var("TEST_CODEX_BINARY"),
        std::env::var("TEST_TUZI_MCP_ENDPOINT"),
    ) else {
        return;
    };
    let url = url::Url::parse(&endpoint).unwrap();
    assert_eq!(url.host_str(), Some("127.0.0.1"));
    assert_eq!(url.scheme(), "http");
    let home = tempfile::tempdir().unwrap();
    let cwd = tempfile::tempdir().unwrap();
    let marker = home.path().join("other-server-started");
    // An unrelated configured stdio server must not start in helper sessions.
    let config = format!("mcp_oauth_credentials_store = 'file'\n[mcp_servers.unrelated]\ncommand = 'touch'\nargs = [{}]\n", toml::Value::String(marker.display().to_string()));
    fs::write(home.path().join("config.toml"), &config).unwrap();
    let cancel = AtomicBool::new(false);
    let mut client =
        rpc::Rpc::spawn(Path::new(&binary), home.path(), cwd.path(), &endpoint).unwrap();
    client.initialize(&cancel).unwrap();
    assert!(
        !marker.exists(),
        "initialization must not start unrelated MCPs"
    );
    let login = client
        .call(
            "mcpServer/oauth/login",
            json!({"name":SERVER_ID,"timeoutSecs":30}),
            30,
            &cancel,
        )
        .unwrap();
    let authorization = login["authorizationUrl"].as_str().unwrap();
    assert!(valid_authorization_url(authorization, &endpoint));
    let authorization = url::Url::parse(authorization).unwrap();
    let mut consent = serde_json::Map::new();
    for (key, value) in authorization.query_pairs() {
        consent.insert(key.into_owned(), Value::String(value.into_owned()));
    }
    consent.insert("approve".into(), json!(true));
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap();
        let origin = url.origin().ascii_serialization();
        let response: Value = http
            .post(format!("{origin}/test-consent"))
            .header("Origin", &origin)
            .json(&consent)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(response["success"], true);
        let callback = response["data"]["redirect_uri"].as_str().unwrap();
        let callback_url = url::Url::parse(callback).unwrap();
        assert!(matches!(
            callback_url.host_str(),
            Some("127.0.0.1" | "localhost" | "[::1]")
        ));
        http.get(callback).send().await.unwrap();
    });
    client.wait_login(&cancel).unwrap();
    assert!(!marker.exists(), "login must not start unrelated MCPs");
    drop(client);
    let mut fresh =
        rpc::Rpc::spawn(Path::new(&binary), home.path(), cwd.path(), &endpoint).unwrap();
    fresh.initialize(&cancel).unwrap();
    assert_eq!(
        verify(&mut fresh, cwd.path(), &cancel).unwrap(),
        ("1".into(), "mcp-user".into())
    );
    assert!(!marker.exists(), "unrelated MCP command must not start");
    assert_eq!(
        fs::read_to_string(home.path().join("config.toml")).unwrap(),
        config
    );
    drop(fresh);
    runtime.block_on(async {
        reqwest::Client::new()
            .post(format!(
                "{}/test-revoke",
                url.origin().ascii_serialization()
            ))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap();
    });
    let mut revoked =
        rpc::Rpc::spawn(Path::new(&binary), home.path(), cwd.path(), &endpoint).unwrap();
    revoked.initialize(&cancel).unwrap();
    assert!(verify(&mut revoked, cwd.path(), &cancel).is_err());
    assert!(!marker.exists());
}
