//! MCP 服务器数据访问对象
//!
//! 提供 MCP 服务器的 CRUD 操作。

use crate::app_config::{McpApps, McpServer};
use crate::database::{lock_conn, Database};
use crate::error::AppError;
use indexmap::IndexMap;
use rusqlite::{params, Connection, OptionalExtension};

fn save_server(conn: &Connection, server: &McpServer) -> Result<(), AppError> {
    conn.execute(
        "INSERT OR REPLACE INTO mcp_servers (
            id, name, server_config, description, homepage, docs, tags,
            enabled_claude, enabled_codex, enabled_gemini, enabled_opencode, enabled_hermes, enabled_grokbuild, enabled_pi, enabled_mcode, pi_managed
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            server.id, server.name,
            serde_json::to_string(&server.server).map_err(|e| AppError::Database(format!("Failed to serialize server config: {e}")))?,
            server.description, server.homepage, server.docs,
            serde_json::to_string(&server.tags).map_err(|e| AppError::Database(format!("Failed to serialize tags: {e}")))?,
            server.apps.claude, server.apps.codex, server.apps.gemini, server.apps.opencode,
            server.apps.hermes, server.apps.grokbuild, server.apps.pi, server.apps.mcode, server.apps.pi_managed,
        ],
    ).map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

impl Database {
    /// Commit managed MCP state and matching Codex provider/common snapshots
    /// together. Otherwise restoring a saved provider can resurrect deleted MCP.
    pub(crate) fn commit_mcp_change(
        &self,
        previous: Option<&McpServer>,
        next: Option<&McpServer>,
    ) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;
        if let Some(old) = previous.filter(|s| s.apps.codex) {
            let spec = next.filter(|s| s.apps.codex).map(|s| &s.server);
            let mut stmt = tx
                .prepare("SELECT id, settings_config FROM providers WHERE app_type = 'codex'")
                .map_err(|e| AppError::Database(e.to_string()))?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| AppError::Database(e.to_string()))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| AppError::Database(e.to_string()))?;
            drop(stmt);
            for (id, raw) in rows {
                let mut settings: serde_json::Value = serde_json::from_str(&raw)
                    .map_err(|_| AppError::Message("Codex 已保存配置无效，未修改 MCP".into()))?;
                let Some(text) = settings.get("config").and_then(|v| v.as_str()) else {
                    continue;
                };
                if let Some(text) = update_codex_snapshot(text, old, spec)? {
                    settings["config"] = serde_json::Value::String(text);
                    tx.execute("UPDATE providers SET settings_config = ?1 WHERE id = ?2 AND app_type = 'codex'", params![settings.to_string(),id])
                        .map_err(|e| AppError::Database(e.to_string()))?;
                }
            }
            let snippet: Option<String> = tx
                .query_row(
                    "SELECT value FROM settings WHERE key = 'common_config_codex'",
                    [],
                    |r| r.get(0),
                )
                .optional()
                .map_err(|e| AppError::Database(e.to_string()))?;
            if let Some(text) = snippet {
                if let Some(text) = update_codex_snapshot(&text, old, spec)? {
                    tx.execute(
                        "UPDATE settings SET value = ?1 WHERE key = 'common_config_codex'",
                        params![text],
                    )
                    .map_err(|e| AppError::Database(e.to_string()))?;
                }
            }
        }
        if let Some(next) = next {
            save_server(&tx, next)?;
        } else if let Some(previous) = previous {
            tx.execute(
                "DELETE FROM mcp_servers WHERE id = ?1",
                params![previous.id],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        }
        tx.commit().map_err(|e| AppError::Database(e.to_string()))
    }

    /// 获取所有 MCP 服务器
    pub fn get_all_mcp_servers(&self) -> Result<IndexMap<String, McpServer>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn.prepare(
            "SELECT id, name, server_config, description, homepage, docs, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode, enabled_hermes, enabled_grokbuild, enabled_pi, enabled_mcode, pi_managed
             FROM mcp_servers
             ORDER BY name ASC, id ASC"
        ).map_err(|e| AppError::Database(e.to_string()))?;

        let server_iter = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let name: String = row.get(1)?;
                let server_config_str: String = row.get(2)?;
                let description: Option<String> = row.get(3)?;
                let homepage: Option<String> = row.get(4)?;
                let docs: Option<String> = row.get(5)?;
                let tags_str: String = row.get(6)?;
                let enabled_claude: bool = row.get(7)?;
                let enabled_codex: bool = row.get(8)?;
                let enabled_gemini: bool = row.get(9)?;
                let enabled_opencode: bool = row.get(10)?;
                let enabled_hermes: bool = row.get(11)?;

                let server = serde_json::from_str(&server_config_str).unwrap_or_default();
                let tags = serde_json::from_str(&tags_str).unwrap_or_default();

                Ok((
                    id.clone(),
                    McpServer {
                        id,
                        name,
                        server,
                        apps: McpApps {
                            claude: enabled_claude,
                            codex: enabled_codex,
                            gemini: enabled_gemini,
                            opencode: enabled_opencode,
                            hermes: enabled_hermes,
                            grokbuild: row.get(12)?,
                            pi: row.get(13)?,
                            mcode: row.get(14)?,
                            pi_managed: row.get(15)?,
                        },
                        description,
                        homepage,
                        docs,
                        tags,
                    },
                ))
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut servers = IndexMap::new();
        for server_res in server_iter {
            let (id, server) = server_res.map_err(|e| AppError::Database(e.to_string()))?;
            servers.insert(id, server);
        }
        Ok(servers)
    }

    /// 保存 MCP 服务器
    pub fn save_mcp_server(&self, server: &McpServer) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        save_server(&conn, server)
    }

    pub(crate) fn save_mcp_servers_atomic(&self, servers: &[McpServer]) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;
        for server in servers {
            save_server(&tx, server)?;
        }
        tx.commit().map_err(|e| AppError::Database(e.to_string()))
    }

    /// 删除 MCP 服务器
    pub fn delete_mcp_server(&self, id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute("DELETE FROM mcp_servers WHERE id = ?1", params![id])
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }
}

fn update_codex_snapshot(
    text: &str,
    old: &McpServer,
    next: Option<&serde_json::Value>,
) -> Result<Option<String>, AppError> {
    if !text.contains(&old.id) {
        return Ok(None);
    }
    let doc = text
        .parse::<toml_edit::DocumentMut>()
        .map_err(|_| AppError::Message("Codex 已保存配置无效，未修改 MCP".into()))?;
    if doc
        .get("mcp_servers")
        .and_then(|v| v.get(&old.id))
        .is_none()
    {
        return Ok(None);
    }
    let bytes = crate::mcp::transaction::transform(
        &crate::app_config::AppType::Codex,
        std::path::Path::new("config.toml"),
        Some(text.as_bytes()),
        &old.id,
        Some(&old.server),
        next,
    )?;
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| AppError::Message("Codex 已保存配置编码无效".into()))
}
