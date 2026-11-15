use indexmap::IndexMap;
use std::collections::HashMap;
use std::sync::Mutex;

use crate::app_config::{AppType, McpServer};
use crate::error::AppError;
use crate::mcp;
use crate::store::AppState;

/// MCP 相关业务逻辑（v3.7.0 统一结构）
pub struct McpService;
static MCP_MUTATION_LOCK: Mutex<()> = Mutex::new(());

fn mutation_lock() -> Result<std::sync::MutexGuard<'static, ()>, AppError> {
    MCP_MUTATION_LOCK
        .lock()
        .map_err(|_| AppError::Message("MCP 操作锁不可用".into()))
}

#[cfg(all(test, not(feature = "local-preview")))]
mod native_integration_tests {
    use super::*;
    use crate::app_config::McpApps;
    use serde_json::json;
    use std::{fs, sync::Arc};

    #[test]
    #[ignore = "changes process environment; run alone with one test thread"]
    fn native_mcp_service_mixed_tools_failure_and_restore() {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("CC_SWITCH_TEST_HOME", dir.path());
        std::env::set_var("PI_CODING_AGENT_DIR", dir.path().join("pi"));
        std::env::set_var("MINIMAX_DATA_DIR", dir.path().join("mcode"));
        fs::create_dir_all(dir.path().join(".codex")).unwrap();
        fs::create_dir_all(dir.path().join(".claude")).unwrap();
        let codex = crate::codex_config::get_codex_config_path();
        fs::write(&codex, "[broken").unwrap();
        let state = AppState::new(Arc::new(crate::database::Database::memory().unwrap()));
        let server = McpServer {
            id: "failure-fixture".into(),
            name: "Fixture".into(),
            server: json!({"command":"synthetic"}),
            apps: McpApps {
                claude: true,
                codex: true,
                pi: true,
                mcode: true,
                ..Default::default()
            },
            description: None,
            homepage: None,
            docs: None,
            tags: vec![],
        };
        assert!(McpService::upsert_server(&state, server.clone()).is_err());
        assert!(state.db.get_all_mcp_servers().unwrap().is_empty());
        assert!(!dir.path().join("pi/mcp.json").exists());
        assert!(!crate::config::get_claude_mcp_path().exists());
        assert_eq!(fs::read_to_string(&codex).unwrap(), "[broken");
        fs::write(&codex, b"# existing model\nmodel = \"synthetic\"\n").unwrap();
        // A database failure after all file writes restores every original byte.
        state.db.conn.lock().unwrap().execute_batch("CREATE TRIGGER fail_save BEFORE INSERT ON mcp_servers BEGIN SELECT RAISE(FAIL, 'synthetic failure'); END;").unwrap();
        let before = fs::read(&codex).unwrap();
        assert!(McpService::upsert_server(&state, server.clone()).is_err());
        assert_eq!(fs::read(&codex).unwrap(), before);
        assert!(!dir.path().join("pi/mcp.json").exists());
        assert!(!crate::config::get_claude_mcp_path().exists());
        state
            .db
            .conn
            .lock()
            .unwrap()
            .execute_batch("DROP TRIGGER fail_save;")
            .unwrap();
        McpService::upsert_server(&state, server.clone()).unwrap();
        let snapshot = fs::read_to_string(&codex).unwrap();
        let provider = crate::provider::Provider::with_id(
            "codex-live-config".into(),
            "Synthetic current config".into(),
            json!({"auth":{}, "config":snapshot}),
            None,
        );
        state.db.save_provider("codex", &provider).unwrap();
        state
            .db
            .set_config_snippet("codex", Some(snapshot.clone()))
            .unwrap();
        let claude = crate::config::get_claude_mcp_path();
        let claude_before = fs::read(&claude).unwrap();
        let pi_path = dir.path().join("pi/mcp.json");
        let pi_before = fs::read(&pi_path).unwrap();
        let codex_before = fs::read(&codex).unwrap();
        state.db.conn.lock().unwrap().execute_batch("CREATE TRIGGER fail_delete BEFORE DELETE ON mcp_servers BEGIN SELECT RAISE(FAIL, 'synthetic failure'); END;").unwrap();
        assert!(McpService::delete_server(&state, &server.id).is_err());
        assert_eq!(
            state
                .db
                .get_provider_by_id("codex-live-config", "codex")
                .unwrap()
                .unwrap()
                .settings_config["config"],
            snapshot
        );
        assert_eq!(
            state.db.get_config_snippet("codex").unwrap().unwrap(),
            snapshot
        );
        assert_eq!(fs::read(&claude).unwrap(), claude_before);
        assert_eq!(fs::read(&pi_path).unwrap(), pi_before);
        assert_eq!(fs::read(&codex).unwrap(), codex_before);
        state.db.conn.lock().unwrap().execute_batch("DROP TRIGGER fail_delete; CREATE TRIGGER fail_save BEFORE INSERT ON mcp_servers BEGIN SELECT RAISE(FAIL, 'synthetic failure'); END;").unwrap();
        assert!(McpService::toggle_app(&state, &server.id, AppType::Codex, false).is_err());
        assert_eq!(fs::read(&codex).unwrap(), codex_before);
        assert!(
            state.db.get_all_mcp_servers().unwrap()[&server.id]
                .apps
                .codex
        );
        state
            .db
            .conn
            .lock()
            .unwrap()
            .execute_batch("DROP TRIGGER fail_save;")
            .unwrap();
        // SQL/WebDAV restoration carries desired flags, but never Pi ownership.
        McpService::toggle_native_app(&state, &server.id, "pi", false).unwrap();
        let sql = state.db.export_sql_string().unwrap();
        let sync_sql = state.db.export_sql_string_for_sync().unwrap();
        assert!(!sql.contains("tuzi-ownership"));
        let device_b = dir.path().join("device-b");
        fs::create_dir_all(&device_b).unwrap();
        fs::copy(&pi_path, device_b.join("mcp.json")).unwrap();
        std::env::set_var("PI_CODING_AGENT_DIR", &device_b);
        for sync in [false, true] {
            if sync {
                state.db.import_sql_string_for_sync(&sync_sql).unwrap();
            } else {
                state.db.import_sql_string(&sql).unwrap();
            }
            let before = fs::read(device_b.join("mcp.json")).unwrap();
            assert!(McpService::delete_server(&state, &server.id)
                .unwrap_err()
                .to_string()
                .contains("先导入"));
            assert_eq!(fs::read(device_b.join("mcp.json")).unwrap(), before);
            assert_eq!(fs::read(&claude).unwrap(), claude_before);
        }
        // Same-device restore retains the receipt; explicitly importing on B claims B only.
        std::env::set_var("PI_CODING_AGENT_DIR", dir.path().join("pi"));
        McpService::toggle_native_app(&state, &server.id, "pi", true).unwrap();
        std::env::set_var("PI_CODING_AGENT_DIR", &device_b);
        McpService::import_from_native_tools(&state).unwrap();
        McpService::delete_server(&state, &server.id).unwrap();
        assert!(!state
            .db
            .get_provider_by_id("codex-live-config", "codex")
            .unwrap()
            .unwrap()
            .settings_config["config"]
            .as_str()
            .unwrap()
            .contains("failure-fixture"));
        assert!(!state
            .db
            .get_config_snippet("codex")
            .unwrap()
            .unwrap()
            .contains("failure-fixture"));
        assert!(state.db.get_all_mcp_servers().unwrap().is_empty());
        assert!(serde_json::from_slice::<serde_json::Value>(
            &fs::read(device_b.join("mcp.json")).unwrap()
        )
        .unwrap()["mcpServers"]
            .get(&server.id)
            .is_none());
        assert!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(&pi_path).unwrap()).unwrap()
                ["mcpServers"]
                .get(&server.id)
                .is_some()
        );
        // Per-source partial import, conflict, failure injection, and repeat recovery.
        fs::write(
            &claude,
            br#"{"mcpServers":{"first":{"command":"first"},"second":{"command":"second"}}}"#,
        )
        .unwrap();
        state.db.conn.lock().unwrap().execute_batch("CREATE TRIGGER fail_second BEFORE INSERT ON mcp_servers WHEN NEW.id = 'second' BEGIN SELECT RAISE(FAIL, 'synthetic failure'); END;").unwrap();
        assert!(McpService::import_from_claude(&state).is_err());
        assert!(state.db.get_all_mcp_servers().unwrap().is_empty());
        state
            .db
            .conn
            .lock()
            .unwrap()
            .execute_batch("DROP TRIGGER fail_second;")
            .unwrap();
        fs::write(&codex, "[invalid").unwrap();
        let failure = McpService::import_all(&state).unwrap_err().to_string();
        assert!(failure.contains("成功来源已保存 2 项"));
        assert!(failure.contains("Codex"));
        assert_eq!(state.db.get_all_mcp_servers().unwrap().len(), 2);
        fs::write(&codex, "").unwrap();
        assert_eq!(McpService::import_all(&state).unwrap(), 0);
        fs::write(
            &claude,
            br#"{"mcpServers":{"first":{"command":"conflicting"},"third":{"command":"third"}}}"#,
        )
        .unwrap();
        assert!(McpService::import_from_claude(&state).is_err());
        assert!(!state
            .db
            .get_all_mcp_servers()
            .unwrap()
            .contains_key("third"));
        std::env::remove_var("CC_SWITCH_TEST_HOME");
        std::env::remove_var("PI_CODING_AGENT_DIR");
        std::env::remove_var("MINIMAX_DATA_DIR");
    }

    #[test]
    #[ignore = "changes process environment; run alone with one test thread"]
    fn native_mcp_service_roundtrip_uses_isolated_files() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path();
        let pi_dir = home.join("pi");
        let mcode_dir = home.join("mcode");
        std::env::set_var("CC_SWITCH_TEST_HOME", home);
        std::env::set_var("PI_CODING_AGENT_DIR", &pi_dir);
        std::env::set_var("MINIMAX_DATA_DIR", &mcode_dir);
        let state = AppState::new(Arc::new(crate::database::Database::memory().unwrap()));
        let server = McpServer {
            id: "fixture".into(),
            name: "Fixture".into(),
            server: json!({"type":"stdio", "command":"synthetic"}),
            apps: McpApps {
                grokbuild: true,
                pi: true,
                mcode: true,
                ..Default::default()
            },
            description: None,
            homepage: None,
            docs: None,
            tags: vec![],
        };
        McpService::upsert_server(&state, server).unwrap();
        assert!(home.join(".grok/config.toml").exists());
        assert!(mcode_dir.join("mcp.json").exists());
        assert!(
            state.db.get_all_mcp_servers().unwrap()["fixture"]
                .apps
                .pi_managed
        );
        McpService::toggle_native_app(&state, "fixture", "pi", false).unwrap();
        let pi: serde_json::Value =
            serde_json::from_slice(&fs::read(pi_dir.join("mcp.json")).unwrap()).unwrap();
        assert_eq!(pi["mcpServers"]["fixture"]["enabled"], false);
        assert!(McpService::delete_server(&state, "fixture").unwrap());
        let pi: serde_json::Value =
            serde_json::from_slice(&fs::read(pi_dir.join("mcp.json")).unwrap()).unwrap();
        assert!(pi["mcpServers"].get("fixture").is_none());
        assert!(state.db.get_all_mcp_servers().unwrap().is_empty());
        std::env::remove_var("CC_SWITCH_TEST_HOME");
        std::env::remove_var("PI_CODING_AGENT_DIR");
        std::env::remove_var("MINIMAX_DATA_DIR");
    }
}

impl McpService {
    /// Each source commits atomically. Successful sources are retained and retries
    /// are idempotent; the UI keeps this recovery message visible on failure.
    pub fn import_all(state: &AppState) -> Result<usize, AppError> {
        let mut total = 0;
        let mut errors = Vec::new();
        type Importer = fn(&AppState) -> Result<usize, AppError>;
        let sources: [(&str, Importer); 6] = [
            ("Claude", Self::import_from_claude),
            ("Codex", Self::import_from_codex),
            ("Gemini", Self::import_from_gemini),
            ("OpenCode", Self::import_from_opencode),
            ("Hermes", Self::import_from_hermes),
            ("Grok / Pi / MiniMax", Self::import_from_native_tools),
        ];
        for (name, import) in sources {
            match import(state) {
                Ok(count) => total += count,
                Err(error) => errors.push(format!("{name}: {error}")),
            }
        }
        if errors.is_empty() {
            Ok(total)
        } else {
            Err(AppError::Message(format!("导入未全部完成：成功来源已保存 {total} 项，失败来源未保存。已保存项会保留，修复以下问题后可再次导入，不会重复新增。{}", errors.join("; "))))
        }
    }

    pub fn import_from_native_tools(state: &AppState) -> Result<usize, AppError> {
        let _guard = mutation_lock()?;
        crate::native_mcp::import(state)
    }
    /// 获取所有 MCP 服务器（统一结构）
    pub fn get_all_servers(state: &AppState) -> Result<IndexMap<String, McpServer>, AppError> {
        state.db.get_all_mcp_servers()
    }

    /// 添加或更新 MCP 服务器
    pub fn upsert_server(state: &AppState, mut server: McpServer) -> Result<(), AppError> {
        let _provider_guard = crate::services::provider::OperationGuard::acquire()?;
        let _guard = mutation_lock()?;
        // 读取旧状态：用于处理“编辑时取消勾选某个应用”的场景（需要从对应 live 配置中移除）
        let previous = state.db.get_all_mcp_servers()?.get(&server.id).cloned();
        let prev_apps = previous
            .as_ref()
            .map(|s| s.apps.clone())
            .unwrap_or_default();
        server.apps.pi_managed = prev_apps.pi_managed || server.apps.pi;

        crate::native_mcp::commit(previous.as_ref(), Some(&server), || {
            state.db.commit_mcp_change(previous.as_ref(), Some(&server))
        })?;

        Ok(())
    }

    /// 删除 MCP 服务器
    pub fn delete_server(state: &AppState, id: &str) -> Result<bool, AppError> {
        let _provider_guard = crate::services::provider::OperationGuard::acquire()?;
        let _guard = mutation_lock()?;
        let server = state.db.get_all_mcp_servers()?.shift_remove(id);

        if let Some(server) = server {
            crate::native_mcp::commit(Some(&server), None, || {
                state.db.commit_mcp_change(Some(&server), None)
            })?;

            Ok(true)
        } else {
            Ok(false)
        }
    }

    pub fn toggle_native_app(
        state: &AppState,
        server_id: &str,
        app: &str,
        enabled: bool,
    ) -> Result<(), AppError> {
        let _provider_guard = crate::services::provider::OperationGuard::acquire()?;
        let _guard = mutation_lock()?;
        let previous = state
            .db
            .get_all_mcp_servers()?
            .shift_remove(server_id)
            .ok_or_else(|| AppError::Message("MCP 服务器不存在".into()))?;
        let mut next = previous.clone();
        match app {
            "grokbuild" => next.apps.grokbuild = enabled,
            "pi" => next.apps.pi = enabled,
            "mcode" => next.apps.mcode = enabled,
            _ => return Err(AppError::Message("不支持的工具".into())),
        }
        next.apps.pi_managed = previous.apps.pi_managed || next.apps.pi;
        if next.apps == previous.apps {
            return Ok(());
        }
        crate::native_mcp::commit(Some(&previous), Some(&next), || {
            state.db.commit_mcp_change(Some(&previous), Some(&next))
        })
    }

    /// 切换指定应用的启用状态
    pub fn toggle_app(
        state: &AppState,
        server_id: &str,
        app: AppType,
        enabled: bool,
    ) -> Result<(), AppError> {
        let _provider_guard = crate::services::provider::OperationGuard::acquire()?;
        let _guard = mutation_lock()?;
        let previous = state
            .db
            .get_all_mcp_servers()?
            .shift_remove(server_id)
            .ok_or_else(|| AppError::Message("MCP 服务器不存在".into()))?;
        let mut next = previous.clone();
        next.apps.set_enabled_for(&app, enabled);
        crate::native_mcp::commit(Some(&previous), Some(&next), || {
            state.db.commit_mcp_change(Some(&previous), Some(&next))
        })
    }

    /// 将 MCP 服务器同步到指定应用
    fn sync_server_to_app(
        _state: &AppState,
        server: &McpServer,
        app: &AppType,
    ) -> Result<(), AppError> {
        Self::sync_server_to_app_no_config(server, app)
    }

    fn sync_server_to_app_no_config(server: &McpServer, app: &AppType) -> Result<(), AppError> {
        match app {
            AppType::Claude => {
                mcp::sync_single_server_to_claude(&Default::default(), &server.id, &server.server)?;
            }
            AppType::ClaudeDesktop => {
                log::debug!("Claude Desktop 3P profiles do not use tuzi switch MCP sync, skipping");
            }
            AppType::Codex => {
                // Codex uses TOML format, must use the correct function
                mcp::sync_single_server_to_codex(&Default::default(), &server.id, &server.server)?;
            }
            AppType::Gemini => {
                mcp::sync_single_server_to_gemini(&Default::default(), &server.id, &server.server)?;
            }
            AppType::OpenCode => {
                mcp::sync_single_server_to_opencode(
                    &Default::default(),
                    &server.id,
                    &server.server,
                )?;
            }
            AppType::OpenClaw => {
                // OpenClaw MCP support is still in development (Issue #4834)
                // Skip for now
                log::debug!("OpenClaw MCP support is still in development, skipping sync");
            }
            AppType::Hermes => {
                mcp::sync_single_server_to_hermes(&Default::default(), &server.id, &server.server)?;
            }
        }
        Ok(())
    }

    fn remove_server_from_app(_state: &AppState, id: &str, app: &AppType) -> Result<(), AppError> {
        match app {
            AppType::Claude => mcp::remove_server_from_claude(id)?,
            AppType::ClaudeDesktop => {
                log::debug!("Claude Desktop 3P profiles do not use tuzi switch MCP sync, skipping");
            }
            AppType::Codex => mcp::remove_server_from_codex(id)?,
            AppType::Gemini => mcp::remove_server_from_gemini(id)?,
            AppType::OpenCode => {
                mcp::remove_server_from_opencode(id)?;
            }
            AppType::OpenClaw => {
                // OpenClaw MCP support is still in development
                log::debug!("OpenClaw MCP support is still in development, skipping remove");
            }
            AppType::Hermes => {
                mcp::remove_server_from_hermes(id)?;
            }
        }
        Ok(())
    }

    /// 手动同步所有启用的 MCP 服务器到对应的应用
    pub fn sync_all_enabled(state: &AppState) -> Result<(), AppError> {
        let servers = Self::get_all_servers(state)?;

        for app in AppType::all() {
            Self::project_servers_to_app(state, &servers, &app)?;
        }

        Ok(())
    }

    /// 将启用状态只投影到指定应用。供应商或通用配置重写单个应用的
    /// live 文件后使用此入口，避免扫描并改写所有无关应用的配置文件。
    pub fn sync_enabled_for_app(state: &AppState, app: &AppType) -> Result<(), AppError> {
        let servers = Self::get_all_servers(state)?;
        Self::project_servers_to_app(state, &servers, app)
    }

    fn project_servers_to_app(
        state: &AppState,
        servers: &indexmap::IndexMap<String, McpServer>,
        app: &AppType,
    ) -> Result<(), AppError> {
        if matches!(app, AppType::OpenClaw | AppType::ClaudeDesktop) {
            return Ok(());
        }

        for server in servers.values() {
            if server.apps.is_enabled_for(app) {
                Self::sync_server_to_app(state, server, app)?;
            } else {
                Self::remove_server_from_app(state, &server.id, app)?;
            }
        }

        Ok(())
    }

    // ========================================================================
    // 兼容层：支持旧的 v3.6.x 命令（已废弃，将在 v4.0 移除）
    // ========================================================================

    /// [已废弃] 获取指定应用的 MCP 服务器（兼容旧 API）
    #[deprecated(since = "3.7.0", note = "Use get_all_servers instead")]
    pub fn get_servers(
        state: &AppState,
        app: AppType,
    ) -> Result<HashMap<String, serde_json::Value>, AppError> {
        let all_servers = Self::get_all_servers(state)?;
        let mut result = HashMap::new();

        for (id, server) in all_servers {
            if server.apps.is_enabled_for(&app) {
                result.insert(id, server.server);
            }
        }

        Ok(result)
    }

    /// [已废弃] 设置 MCP 服务器在指定应用的启用状态（兼容旧 API）
    #[deprecated(since = "3.7.0", note = "Use toggle_app instead")]
    pub fn set_enabled(
        state: &AppState,
        app: AppType,
        id: &str,
        enabled: bool,
    ) -> Result<bool, AppError> {
        Self::toggle_app(state, id, app, enabled)?;
        Ok(true)
    }

    /// [已废弃] 同步启用的 MCP 到指定应用（兼容旧 API）
    #[deprecated(since = "3.7.0", note = "Use sync_all_enabled instead")]
    pub fn sync_enabled(state: &AppState, app: AppType) -> Result<(), AppError> {
        let servers = Self::get_all_servers(state)?;

        for server in servers.values() {
            if server.apps.is_enabled_for(&app) {
                Self::sync_server_to_app(state, server, &app)?;
            }
        }

        Ok(())
    }

    fn import_legacy(
        state: &AppState,
        app: AppType,
        importer: fn(&mut crate::app_config::MultiAppConfig) -> Result<usize, AppError>,
    ) -> Result<usize, AppError> {
        let _guard = mutation_lock()?;
        let mut config = crate::app_config::MultiAppConfig::default();
        importer(&mut config)?;
        let existing = state.db.get_all_mcp_servers()?;
        let mut pending = Vec::new();
        for server in config.mcp.servers.unwrap_or_default().into_values() {
            if let Some(old) = existing.get(&server.id) {
                if !crate::mcp::transaction::connections_match(&app, &server.server, &old.server)? {
                    return Err(AppError::Message(format!(
                        "{} 与已有服务器连接配置冲突；该来源未导入",
                        server.id
                    )));
                }
                if !old.apps.is_enabled_for(&app) {
                    let mut merged = old.clone();
                    merged.apps.set_enabled_for(&app, true);
                    pending.push(merged);
                }
            } else {
                pending.push(server);
            }
        }
        state.db.save_mcp_servers_atomic(&pending)?;
        Ok(pending.len())
    }
    pub fn import_from_claude(state: &AppState) -> Result<usize, AppError> {
        Self::import_legacy(state, AppType::Claude, crate::mcp::import_from_claude)
    }
    pub fn import_from_codex(state: &AppState) -> Result<usize, AppError> {
        Self::import_legacy(state, AppType::Codex, crate::mcp::import_from_codex)
    }
    pub fn import_from_gemini(state: &AppState) -> Result<usize, AppError> {
        Self::import_legacy(state, AppType::Gemini, crate::mcp::import_from_gemini)
    }
    pub fn import_from_opencode(state: &AppState) -> Result<usize, AppError> {
        Self::import_legacy(state, AppType::OpenCode, crate::mcp::import_from_opencode)
    }
    pub fn import_from_hermes(state: &AppState) -> Result<usize, AppError> {
        Self::import_legacy(state, AppType::Hermes, crate::mcp::import_from_hermes)
    }
}
