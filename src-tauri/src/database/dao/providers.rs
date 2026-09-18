use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::provider::{Provider, ProviderMeta};
use indexmap::IndexMap;
use rusqlite::params;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

type OmoProviderRow = (
    String,
    String,
    String,
    Option<String>,
    Option<i64>,
    Option<usize>,
    Option<String>,
    String,
);

fn build_codex_official_provider(
    id: &str,
    name: &str,
    website_url: &str,
    base_url: &str,
    env_key: &str,
    model: &str,
) -> Provider {
    let route_id = "custom";
    let config = format!(
        "model_provider = \"{route_id}\"\nmodel = \"{model}\"\nmodel_reasoning_effort = \"high\"\ndisable_response_storage = true\n\n[model_providers.{route_id}]\nname = \"{name}\"\nbase_url = \"{base_url}\"\nenv_key = \"{env_key}\"\nwire_api = \"responses\"\nrequires_openai_auth = false\n"
    );
    let mut provider = Provider::with_id(
        id.to_string(),
        name.to_string(),
        json!({
            "auth": {},
            "config": config,
            "env": { "envKey": env_key },
        }),
        Some(website_url.to_string()),
    );
    provider.icon = Some(
        match id {
            "coding" => "codex-sub",
            "gaccode" => "gaccode",
            _ => "tuzi",
        }
        .to_string(),
    );
    provider.icon_color = None;
    provider
}

fn build_claude_official_provider(id: &str, name: &str, base_url: &str, model: &str) -> Provider {
    let api_key_url = match id {
        "tuzi-route" => Some("https://api.tu-zi.com"),
        "gaccode" => Some("https://store.tu-zi.com/cat/1"),
        _ => None,
    };
    let mut provider = Provider::with_id(
        id.to_string(),
        name.to_string(),
        json!({
            "env": {
                "ANTHROPIC_BASE_URL": base_url,
                "ANTHROPIC_AUTH_TOKEN": "",
                "ANTHROPIC_API_KEY": "",
                "ANTHROPIC_MODEL": model,
                "ANTHROPIC_DEFAULT_HAIKU_MODEL": "anthropic/claude-haiku-4.5",
                "ANTHROPIC_DEFAULT_SONNET_MODEL": model,
                "ANTHROPIC_DEFAULT_OPUS_MODEL": "anthropic/claude-opus-4.7",
            },
        }),
        api_key_url.map(|s| s.to_string()),
    );
    provider.icon = Some(
        match id {
            "gaccode" => "gaccode",
            _ => "tuzi",
        }
        .to_string(),
    );
    provider.icon_color = None;
    provider
}

fn build_gemini_official_provider(id: &str, name: &str, base_url: &str, model: &str) -> Provider {
    let api_key_url = match id {
        "tuzi-route" => Some("https://api.tu-zi.com"),
        _ => None,
    };
    let mut provider = Provider::with_id(
        id.to_string(),
        name.to_string(),
        json!({
            "env": {
                "GOOGLE_GEMINI_BASE_URL": base_url,
                "GEMINI_API_KEY": "",
                "GEMINI_MODEL": model,
            },
        }),
        api_key_url.map(|s| s.to_string()),
    );
    provider.icon = Some("tuzi".to_string());
    provider.icon_color = None;
    provider
}

fn build_openclaw_official_provider(
    id: &str,
    name: &str,
    api_key_url: &str,
    base_url: &str,
    api: &str,
) -> Provider {
    let mut provider = Provider::with_id(
        id.to_string(),
        name.to_string(),
        json!({
            "baseUrl": base_url,
            "apiKey": "",
            "api": api,
            "models": match api {
                "anthropic-messages" => vec![
                    json!({
                        "id": "claude-sonnet-4-6",
                        "name": "Claude Sonnet 4.6",
                        "contextWindow": 1000000,
                        "cost": { "input": 3, "output": 15 },
                    })
                ],
                _ => vec![
                    json!({
                        "id": "gpt-5.5",
                        "name": "GPT-5.5",
                        "contextWindow": 200000,
                        "cost": { "input": 5, "output": 15 },
                    })
                ],
            },
        }),
        Some(api_key_url.to_string()),
    );
    provider.icon = Some(
        match id {
            "codex-coding" => "codex-sub",
            "codex-gaccode" | "claude-gaccode" => "gaccode",
            _ => "tuzi",
        }
        .to_string(),
    );
    provider.icon_color = None;
    provider
}

fn build_hermes_official_provider(
    id: &str,
    name: &str,
    api_key_url: &str,
    base_url: &str,
    api_mode: &str,
) -> Provider {
    let mut provider = Provider::with_id(
        id.to_string(),
        name.to_string(),
        json!({
            "name": name,
            "base_url": base_url,
            "api_key": "",
            "api_mode": api_mode,
            "models": match api_mode {
                "anthropic_messages" => vec![
                    json!({
                        "id": "claude-sonnet-4-6",
                        "name": "Claude Sonnet 4.6",
                        "context_length": 1000000,
                    })
                ],
                _ => vec![
                    json!({
                        "id": "gpt-5.5",
                        "name": "GPT-5.5",
                        "context_length": 200000,
                    })
                ],
            },
        }),
        Some(api_key_url.to_string()),
    );
    provider.icon = Some(
        match id {
            "codex-coding" => "codex-sub",
            "codex-gaccode" | "claude-gaccode" => "gaccode",
            _ => "tuzi",
        }
        .to_string(),
    );
    provider.icon_color = None;
    provider
}

impl Database {
    pub fn get_all_providers(
        &self,
        app_type: &str,
    ) -> Result<IndexMap<String, Provider>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn.prepare(
            "SELECT id, name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, in_failover_queue
             FROM providers WHERE app_type = ?1
             ORDER BY COALESCE(sort_index, 999999), created_at ASC, id ASC"
        ).map_err(|e| AppError::Database(e.to_string()))?;

        let provider_iter = stmt
            .query_map(params![app_type], |row| {
                let id: String = row.get(0)?;
                let name: String = row.get(1)?;
                let settings_config_str: String = row.get(2)?;
                let website_url: Option<String> = row.get(3)?;
                let category: Option<String> = row.get(4)?;
                let created_at: Option<i64> = row.get(5)?;
                let sort_index: Option<usize> = row.get(6)?;
                let notes: Option<String> = row.get(7)?;
                let icon: Option<String> = row.get(8)?;
                let icon_color: Option<String> = row.get(9)?;
                let meta_str: String = row.get(10)?;
                let in_failover_queue: bool = row.get(11)?;

                let settings_config =
                    serde_json::from_str(&settings_config_str).unwrap_or(serde_json::Value::Null);
                let meta: ProviderMeta = serde_json::from_str(&meta_str).unwrap_or_default();

                Ok((
                    id,
                    Provider {
                        id: "".to_string(), // Placeholder, set below
                        name,
                        settings_config,
                        website_url,
                        category,
                        created_at,
                        sort_index,
                        notes,
                        meta: Some(meta),
                        icon,
                        icon_color,
                        in_failover_queue,
                    },
                ))
            })
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut providers = IndexMap::new();
        for provider_res in provider_iter {
            let (id, mut provider) = provider_res.map_err(|e| AppError::Database(e.to_string()))?;
            provider.id = id.clone();

            let mut stmt_endpoints = conn.prepare(
                "SELECT url, added_at FROM provider_endpoints WHERE provider_id = ?1 AND app_type = ?2 ORDER BY added_at ASC, url ASC"
            ).map_err(|e| AppError::Database(e.to_string()))?;

            let endpoints_iter = stmt_endpoints
                .query_map(params![id, app_type], |row| {
                    let url: String = row.get(0)?;
                    let added_at: Option<i64> = row.get(1)?;
                    Ok((
                        url,
                        crate::settings::CustomEndpoint {
                            url: "".to_string(),
                            added_at: added_at.unwrap_or(0),
                            last_used: None,
                        },
                    ))
                })
                .map_err(|e| AppError::Database(e.to_string()))?;

            let mut custom_endpoints = HashMap::new();
            for ep_res in endpoints_iter {
                let (url, mut ep) = ep_res.map_err(|e| AppError::Database(e.to_string()))?;
                ep.url = url.clone();
                custom_endpoints.insert(url, ep);
            }

            if let Some(meta) = &mut provider.meta {
                meta.custom_endpoints = custom_endpoints;
            }

            providers.insert(id, provider);
        }

        Ok(providers)
    }

    pub fn get_current_provider(&self, app_type: &str) -> Result<Option<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id FROM providers WHERE app_type = ?1 AND is_current = 1 LIMIT 1")
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut rows = stmt
            .query(params![app_type])
            .map_err(|e| AppError::Database(e.to_string()))?;

        if let Some(row) = rows.next().map_err(|e| AppError::Database(e.to_string()))? {
            Ok(Some(
                row.get(0).map_err(|e| AppError::Database(e.to_string()))?,
            ))
        } else {
            Ok(None)
        }
    }

    pub fn get_provider_by_id(
        &self,
        id: &str,
        app_type: &str,
    ) -> Result<Option<Provider>, AppError> {
        let conn = lock_conn!(self.conn);
        let result = conn.query_row(
            "SELECT name, settings_config, website_url, category, created_at, sort_index, notes, icon, icon_color, meta, in_failover_queue
             FROM providers WHERE id = ?1 AND app_type = ?2",
            params![id, app_type],
            |row| {
                let name: String = row.get(0)?;
                let settings_config_str: String = row.get(1)?;
                let website_url: Option<String> = row.get(2)?;
                let category: Option<String> = row.get(3)?;
                let created_at: Option<i64> = row.get(4)?;
                let sort_index: Option<usize> = row.get(5)?;
                let notes: Option<String> = row.get(6)?;
                let icon: Option<String> = row.get(7)?;
                let icon_color: Option<String> = row.get(8)?;
                let meta_str: String = row.get(9)?;
                let in_failover_queue: bool = row.get(10)?;

                let settings_config = serde_json::from_str(&settings_config_str).unwrap_or(serde_json::Value::Null);
                let meta: ProviderMeta = serde_json::from_str(&meta_str).unwrap_or_default();

                Ok(Provider {
                    id: id.to_string(),
                    name,
                    settings_config,
                    website_url,
                    category,
                    created_at,
                    sort_index,
                    notes,
                    meta: Some(meta),
                    icon,
                    icon_color,
                    in_failover_queue,
                })
            },
        );

        match result {
            Ok(provider) => Ok(Some(provider)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn save_provider(&self, app_type: &str, provider: &Provider) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        let mut meta_clone = provider.meta.clone().unwrap_or_default();
        let endpoints = std::mem::take(&mut meta_clone.custom_endpoints);

        let existing: Option<(bool, bool)> = tx
            .query_row(
                "SELECT is_current, in_failover_queue FROM providers WHERE id = ?1 AND app_type = ?2",
                params![provider.id, app_type],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .ok();

        let is_update = existing.is_some();
        let (is_current, in_failover_queue) =
            existing.unwrap_or((false, provider.in_failover_queue));

        if is_update {
            tx.execute(
                "UPDATE providers SET
                    name = ?1,
                    settings_config = ?2,
                    website_url = ?3,
                    category = ?4,
                    created_at = ?5,
                    sort_index = ?6,
                    notes = ?7,
                    icon = ?8,
                    icon_color = ?9,
                    meta = ?10,
                    is_current = ?11,
                    in_failover_queue = ?12
                WHERE id = ?13 AND app_type = ?14",
                params![
                    provider.name,
                    serde_json::to_string(&provider.settings_config).map_err(|e| {
                        AppError::Database(format!("Failed to serialize settings_config: {e}"))
                    })?,
                    provider.website_url,
                    provider.category,
                    provider.created_at,
                    provider.sort_index,
                    provider.notes,
                    provider.icon,
                    provider.icon_color,
                    serde_json::to_string(&meta_clone).map_err(|e| AppError::Database(format!(
                        "Failed to serialize meta: {e}"
                    )))?,
                    is_current,
                    in_failover_queue,
                    provider.id,
                    app_type,
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        } else {
            tx.execute(
                "INSERT INTO providers (
                    id, app_type, name, settings_config, website_url, category,
                    created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    provider.id,
                    app_type,
                    provider.name,
                    serde_json::to_string(&provider.settings_config)
                        .map_err(|e| AppError::Database(format!("Failed to serialize settings_config: {e}")))?,
                    provider.website_url,
                    provider.category,
                    provider.created_at,
                    provider.sort_index,
                    provider.notes,
                    provider.icon,
                    provider.icon_color,
                    serde_json::to_string(&meta_clone)
                        .map_err(|e| AppError::Database(format!("Failed to serialize meta: {e}")))?,
                    is_current,
                    in_failover_queue,
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

            for (url, endpoint) in endpoints {
                tx.execute(
                    "INSERT INTO provider_endpoints (provider_id, app_type, url, added_at)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![provider.id, app_type, url, endpoint.added_at],
                )
                .map_err(|e| AppError::Database(e.to_string()))?;
            }
        }

        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn delete_provider(&self, app_type: &str, id: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM providers WHERE id = ?1 AND app_type = ?2",
            params![id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn set_current_provider(&self, app_type: &str, id: &str) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        tx.execute(
            "UPDATE providers SET is_current = 0 WHERE app_type = ?1",
            params![app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        tx.execute(
            "UPDATE providers SET is_current = 1 WHERE id = ?1 AND app_type = ?2",
            params![id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn clear_current_provider(&self, app_type: &str) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE providers SET is_current = 0 WHERE app_type = ?1",
            params![app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn clear_current_provider_if_matches(
        &self,
        app_type: &str,
        id: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE providers SET is_current = 0 WHERE app_type = ?1 AND id = ?2",
            params![app_type, id],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn update_provider_settings_config(
        &self,
        app_type: &str,
        provider_id: &str,
        settings_config: &serde_json::Value,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE providers SET settings_config = ?1 WHERE id = ?2 AND app_type = ?3",
            params![
                serde_json::to_string(settings_config).map_err(|e| AppError::Database(format!(
                    "Failed to serialize settings_config: {e}"
                )))?,
                provider_id,
                app_type
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn add_custom_endpoint(
        &self,
        app_type: &str,
        provider_id: &str,
        url: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        let added_at = chrono::Utc::now().timestamp_millis();
        conn.execute(
            "INSERT INTO provider_endpoints (provider_id, app_type, url, added_at) VALUES (?1, ?2, ?3, ?4)",
            params![provider_id, app_type, url, added_at],
        ).map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn remove_custom_endpoint(
        &self,
        app_type: &str,
        provider_id: &str,
        url: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "DELETE FROM provider_endpoints WHERE provider_id = ?1 AND app_type = ?2 AND url = ?3",
            params![provider_id, app_type, url],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn set_omo_provider_current(
        &self,
        app_type: &str,
        provider_id: &str,
        category: &str,
    ) -> Result<(), AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;
        tx.execute(
            "UPDATE providers SET is_current = 0 WHERE app_type = ?1 AND category = ?2",
            params![app_type, category],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        // OMO ↔ OMO Slim mutually exclusive: deactivate the opposite category
        let opposite = match category {
            "omo" => Some("omo-slim"),
            "omo-slim" => Some("omo"),
            _ => None,
        };
        if let Some(opp) = opposite {
            tx.execute(
                "UPDATE providers SET is_current = 0 WHERE app_type = ?1 AND category = ?2",
                params![app_type, opp],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        }
        let updated = tx
            .execute(
                "UPDATE providers SET is_current = 1 WHERE id = ?1 AND app_type = ?2 AND category = ?3",
                params![provider_id, app_type, category],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        if updated != 1 {
            return Err(AppError::Database(format!(
                "Failed to set {category} provider current: provider '{provider_id}' not found in app '{app_type}'"
            )));
        }
        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn is_omo_provider_current(
        &self,
        app_type: &str,
        provider_id: &str,
        category: &str,
    ) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        match conn.query_row(
            "SELECT is_current FROM providers
             WHERE id = ?1 AND app_type = ?2 AND category = ?3",
            params![provider_id, app_type, category],
            |row| row.get(0),
        ) {
            Ok(is_current) => Ok(is_current),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn clear_omo_provider_current(
        &self,
        app_type: &str,
        provider_id: &str,
        category: &str,
    ) -> Result<(), AppError> {
        let conn = lock_conn!(self.conn);
        conn.execute(
            "UPDATE providers SET is_current = 0
             WHERE id = ?1 AND app_type = ?2 AND category = ?3",
            params![provider_id, app_type, category],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(())
    }

    pub fn get_current_omo_provider(
        &self,
        app_type: &str,
        category: &str,
    ) -> Result<Option<Provider>, AppError> {
        let conn = lock_conn!(self.conn);
        let row_data: Result<OmoProviderRow, rusqlite::Error> = conn.query_row(
            "SELECT id, name, settings_config, category, created_at, sort_index, notes, meta
             FROM providers
             WHERE app_type = ?1 AND category = ?2 AND is_current = 1
             LIMIT 1",
            params![app_type, category],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        );

        let (id, name, settings_config_str, _row_category, created_at, sort_index, notes, meta_str) =
            match row_data {
                Ok(v) => v,
                Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(None),
                Err(e) => return Err(AppError::Database(e.to_string())),
            };

        let settings_config = serde_json::from_str(&settings_config_str).map_err(|e| {
            AppError::Database(format!(
                "Failed to parse {category} provider settings_config (provider_id={id}): {e}"
            ))
        })?;
        let meta: crate::provider::ProviderMeta = if meta_str.trim().is_empty() {
            crate::provider::ProviderMeta::default()
        } else {
            serde_json::from_str(&meta_str).map_err(|e| {
                AppError::Database(format!(
                    "Failed to parse {category} provider meta (provider_id={id}): {e}"
                ))
            })?
        };

        Ok(Some(Provider {
            id,
            name,
            settings_config,
            website_url: None,
            category: Some(category.to_string()),
            created_at,
            sort_index,
            notes,
            meta: Some(meta),
            icon: None,
            icon_color: None,
            in_failover_queue: false,
        }))
    }

    /// 判断 providers 表是否为空（全 app_type 一起算）。
    ///
    /// 用于区分"全新安装"和"升级用户"：在启动流程 import/seed 之前调用。
    /// 使用 `EXISTS` 短路查询，比 `COUNT(*)` 在将来表变大时更高效。
    pub fn is_providers_empty(&self) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let exists: bool = conn
            .query_row("SELECT EXISTS(SELECT 1 FROM providers)", [], |row| {
                row.get(0)
            })
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(!exists)
    }

    /// 仅获取指定 app 下所有 provider 的 id 集合。
    ///
    /// 比 `get_all_providers` 轻量得多：只读 id 列、无 endpoint 子查询。
    /// 用于只需要做存在性检查的场景（如 additive 模式的 live 同步去重）。
    pub fn get_provider_ids(&self, app_type: &str) -> Result<HashSet<String>, AppError> {
        let conn = lock_conn!(self.conn);
        let mut stmt = conn
            .prepare("SELECT id FROM providers WHERE app_type = ?1")
            .map_err(|e| AppError::Database(e.to_string()))?;
        let rows = stmt
            .query_map(params![app_type], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::Database(e.to_string()))?;
        let mut ids = HashSet::new();
        for row in rows {
            ids.insert(row.map_err(|e| AppError::Database(e.to_string()))?);
        }
        Ok(ids)
    }

    /// 判断指定 app 下是否已存在任意 provider。
    ///
    /// 启动阶段的 live import 需要使用这个更严格的判断：
    /// 只要该 app 已经有任何 provider（包括官方 seed），就不应再自动导入 `default`。
    pub fn has_any_provider_for_app(&self, app_type: &str) -> Result<bool, AppError> {
        let conn = lock_conn!(self.conn);
        let exists: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM providers WHERE app_type = ?1)",
                params![app_type],
                |row| row.get(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
        Ok(exists)
    }

    /// 删除旧版蓝兔子预设及其相关残留。
    ///
    /// 只清理明确的历史 ID，避免误删新版 Codex 的 `tuzi-route` 预设。
    pub fn purge_legacy_tuzi_providers(&self) -> Result<usize, AppError> {
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        let deleted = tx
            .execute(
                "DELETE FROM providers WHERE id IN ('tuzi-claude', 'tuzi-codex', 'tuzi-gemini')",
                [],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        tx.execute(
            "DELETE FROM settings WHERE key = 'official_providers_seeded'",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(deleted)
    }

    pub fn init_default_official_providers(&self) -> Result<usize, AppError> {
        let previous_claude_current = self.get_current_provider("claude")?;
        let previous_codex_current = self.get_current_provider("codex")?;
        let previous_gemini_current = self.get_current_provider("gemini")?;
        let mut conn = lock_conn!(self.conn);
        let tx = conn
            .transaction()
            .map_err(|e| AppError::Database(e.to_string()))?;

        tx.execute(
            "DELETE FROM providers WHERE app_type IN ('claude', 'codex', 'gemini') AND id IN ('default', 'codex-official')",
            [],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        let mut seeded = 0usize;

        for (sort_index, (id, name, base_url, model)) in
            crate::database::dao::providers_seed::CLAUDE_OFFICIAL_PROVIDER_IDS
                .iter()
                .enumerate()
        {
            let provider = build_claude_official_provider(id, name, base_url, model);
            seeded += upsert_seed_provider(&tx, "claude", &provider, sort_index)?;
        }
        migrate_claude_tuzi_route_base_url(&tx)?;

        for (sort_index, (id, name, website_url, base_url, env_key, model)) in
            crate::database::dao::providers_seed::CODEX_OFFICIAL_PROVIDER_IDS
                .iter()
                .enumerate()
        {
            let provider =
                build_codex_official_provider(id, name, website_url, base_url, env_key, model);
            seeded += upsert_seed_provider(&tx, "codex", &provider, sort_index)?;
        }

        for (sort_index, (id, name, base_url, model)) in
            crate::database::dao::providers_seed::GEMINI_OFFICIAL_PROVIDER_IDS
                .iter()
                .enumerate()
        {
            let provider = build_gemini_official_provider(id, name, base_url, model);
            seeded += upsert_seed_provider(&tx, "gemini", &provider, sort_index)?;
        }

        for (sort_index, (id, name, api_key_url, base_url, api)) in
            crate::database::dao::providers_seed::OPENCLAW_OFFICIAL_PROVIDER_IDS
                .iter()
                .enumerate()
        {
            let provider = build_openclaw_official_provider(id, name, api_key_url, base_url, api);
            seeded += upsert_seed_provider(&tx, "openclaw", &provider, sort_index)?;
        }

        for (sort_index, (id, name, api_key_url, base_url, api_mode)) in
            crate::database::dao::providers_seed::HERMES_OFFICIAL_PROVIDER_IDS
                .iter()
                .enumerate()
        {
            let provider =
                build_hermes_official_provider(id, name, api_key_url, base_url, api_mode);
            seeded += upsert_seed_provider(&tx, "hermes", &provider, sort_index)?;
        }

        ensure_seed_current_provider(&tx, "claude", previous_claude_current.as_deref())?;
        ensure_seed_current_provider(&tx, "codex", previous_codex_current.as_deref())?;
        ensure_seed_current_provider(&tx, "gemini", previous_gemini_current.as_deref())?;
        ensure_seed_current_provider(&tx, "openclaw", None)?;
        ensure_seed_current_provider(&tx, "hermes", None)?;

        tx.commit().map_err(|e| AppError::Database(e.to_string()))?;
        Ok(seeded)
    }
}

fn upsert_seed_provider(
    tx: &rusqlite::Transaction<'_>,
    app_type: &str,
    provider: &Provider,
    sort_index: usize,
) -> Result<usize, AppError> {
    let exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM providers WHERE app_type = ?1 AND id = ?2)",
            params![app_type, provider.id],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    if exists {
        let next_settings_config =
            seed_settings_config_update_for_existing(tx, app_type, provider)?;

        if let Some(settings_config) = next_settings_config {
            tx.execute(
                "UPDATE providers SET
                    name = ?1,
                    settings_config = ?2,
                    website_url = ?3,
                    category = 'aggregator',
                    sort_index = ?4,
                    icon = ?5,
                    icon_color = ?6
                WHERE app_type = ?7 AND id = ?8",
                params![
                    provider.name,
                    serde_json::to_string(&settings_config).map_err(|e| {
                        AppError::Database(format!("Failed to serialize settings_config: {e}"))
                    })?,
                    provider.website_url,
                    sort_index,
                    provider.icon,
                    provider.icon_color,
                    app_type,
                    provider.id,
                ],
            )
            .map_err(|e| AppError::Database(e.to_string()))?;
            return Ok(0);
        }

        tx.execute(
            "UPDATE providers SET
                name = ?1,
                website_url = ?2,
                category = 'aggregator',
                sort_index = ?3,
                icon = ?4,
                icon_color = ?5
            WHERE app_type = ?6 AND id = ?7",
            params![
                provider.name,
                provider.website_url,
                sort_index,
                provider.icon,
                provider.icon_color,
                app_type,
                provider.id,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
        return Ok(0);
    }

    tx.execute(
        "INSERT INTO providers (
            id, app_type, name, settings_config, website_url, category,
            created_at, sort_index, notes, icon, icon_color, meta, is_current, in_failover_queue
        ) VALUES (?1, ?2, ?3, ?4, ?5, 'aggregator', strftime('%s','now'), ?6, NULL, ?7, ?8, '{}', 0, 0)",
        params![
            provider.id,
            app_type,
            provider.name,
            serde_json::to_string(&provider.settings_config)
                .map_err(|e| AppError::Database(format!("Failed to serialize settings_config: {e}")))?,
            provider.website_url,
            sort_index,
            provider.icon,
            provider.icon_color,
        ],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;

    Ok(1)
}

fn seed_settings_config_update_for_existing(
    tx: &rusqlite::Transaction<'_>,
    app_type: &str,
    provider: &Provider,
) -> Result<Option<Value>, AppError> {
    // Claude 兔子线路：仅迁移历史默认域名，其他用户配置原样保留。
    if app_type == "claude" && provider.id == "tuzi-route" {
        let existing_settings_config = tx
            .query_row(
                "SELECT settings_config FROM providers WHERE app_type = ?1 AND id = ?2",
                params![app_type, provider.id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let Ok(mut existing) = serde_json::from_str::<Value>(&existing_settings_config) else {
            log::warn!(
                "跳过 Claude 兔子线路默认域名迁移：provider {} 的 settings_config 不是有效 JSON",
                provider.id
            );
            return Ok(None);
        };
        let Some(env) = existing.get_mut("env").and_then(Value::as_object_mut) else {
            return Ok(None);
        };
        let is_old_default = env
            .get("ANTHROPIC_BASE_URL")
            .and_then(Value::as_str)
            .is_some_and(|value| value.trim().trim_end_matches('/') == "https://api.tu-zi.com");
        if !is_old_default {
            return Ok(None);
        }

        env.insert(
            "ANTHROPIC_BASE_URL".to_string(),
            json!("https://apius.tu-zi.com"),
        );
        return Ok(Some(existing));
    }

    // Codex: 保留用户已填的 API key，其余字段用种子数据覆盖
    if app_type == "codex"
        && crate::database::dao::providers_seed::CODEX_OFFICIAL_PROVIDER_IDS
            .iter()
            .any(|(id, _, _, _, _, _)| *id == provider.id)
    {
        let existing_settings_config = tx
            .query_row(
                "SELECT settings_config FROM providers WHERE app_type = ?1 AND id = ?2",
                params![app_type, provider.id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let existing: Value =
            serde_json::from_str(&existing_settings_config).unwrap_or_else(|_| json!({}));
        let mut next = provider.settings_config.clone();

        let api_key_opt = existing
            .get("auth")
            .and_then(|auth| auth.get("OPENAI_API_KEY"))
            .and_then(|value| value.as_str())
            .or_else(|| {
                // 仅作为旧数据迁移来源；目标配置仍使用每个官方供应商自己的 env_key。
                existing
                    .get("env")
                    .and_then(|env| env.get("CODEX_API_KEY"))
                    .and_then(|value| value.as_str())
            });

        if let Some(api_key) = api_key_opt {
            if let Some(auth) = next.get_mut("auth").and_then(|value| value.as_object_mut()) {
                auth.insert("OPENAI_API_KEY".to_string(), json!(api_key));
            }
        }

        return Ok(Some(next));
    }

    // OpenClaw / Hermes: 保留用户已填的 apiKey / api_key，其余字段用种子数据覆盖
    if (app_type == "openclaw" || app_type == "hermes")
        && (crate::database::dao::providers_seed::OPENCLAW_OFFICIAL_PROVIDER_IDS
            .iter()
            .any(|(id, _, _, _, _)| *id == provider.id)
            || crate::database::dao::providers_seed::HERMES_OFFICIAL_PROVIDER_IDS
                .iter()
                .any(|(id, _, _, _, _)| *id == provider.id))
    {
        let existing_settings_config = tx
            .query_row(
                "SELECT settings_config FROM providers WHERE app_type = ?1 AND id = ?2",
                params![app_type, provider.id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| AppError::Database(e.to_string()))?;

        let existing: Value =
            serde_json::from_str(&existing_settings_config).unwrap_or_else(|_| json!({}));
        let mut next = provider.settings_config.clone();

        // 保留用户的 apiKey (openclaw) 或 api_key (hermes)
        let key_field = if app_type == "openclaw" {
            "apiKey"
        } else {
            "api_key"
        };
        if let Some(api_key) = existing.get(key_field).and_then(|v| v.as_str()) {
            if !api_key.is_empty() {
                if let Some(obj) = next.as_object_mut() {
                    obj.insert(key_field.to_string(), json!(api_key));
                }
            }
        }

        return Ok(Some(next));
    }

    Ok(None)
}

fn migrate_claude_tuzi_route_base_url(tx: &rusqlite::Transaction<'_>) -> Result<(), AppError> {
    tx.execute(
        "UPDATE providers
         SET settings_config = json_set(
             settings_config,
             '$.env.ANTHROPIC_BASE_URL',
             'https://apius.tu-zi.com'
         )
         WHERE app_type = 'claude'
           AND name = '兔子线路'
           AND rtrim(
               CASE
                   WHEN json_valid(settings_config)
                   THEN json_extract(settings_config, '$.env.ANTHROPIC_BASE_URL')
                   ELSE NULL
               END,
               '/ ' || char(9) || char(10) || char(13)
           ) = 'https://api.tu-zi.com'",
        [],
    )
    .map_err(|e| AppError::Database(e.to_string()))?;
    Ok(())
}

fn ensure_seed_current_provider(
    tx: &rusqlite::Transaction<'_>,
    app_type: &str,
    previous_current: Option<&str>,
) -> Result<(), AppError> {
    let current_exists: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM providers WHERE app_type = ?1 AND is_current = 1)",
            params![app_type],
            |row| row.get(0),
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

    if current_exists && !matches!(previous_current, Some("default") | Some("codex-official")) {
        return Ok(());
    }

    let current_id = tx
        .query_row(
            "SELECT id FROM providers WHERE app_type = ?1 ORDER BY COALESCE(sort_index, 999999), created_at ASC, id ASC LIMIT 1",
            params![app_type],
            |row| row.get::<_, String>(0),
        )
        .ok();
    if let Some(id) = current_id {
        tx.execute(
            "UPDATE providers SET is_current = CASE WHEN id = ?1 THEN 1 ELSE 0 END WHERE app_type = ?2",
            params![id, app_type],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;
    }

    Ok(())
}
