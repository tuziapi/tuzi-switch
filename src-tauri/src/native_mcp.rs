//! Native MCP configuration, guarded writes, and import for the three additional tools.
use serde_json::{json, Value};
use std::{fs, path::PathBuf};

use crate::{app_config::McpServer, error::AppError, native_tools};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NativeMcpTool {
    Grok,
    Pi,
    Mcode,
}

impl NativeMcpTool {
    fn enabled(self, server: &McpServer) -> bool {
        match self {
            Self::Grok => server.apps.grokbuild,
            Self::Pi => server.apps.pi,
            Self::Mcode => server.apps.mcode,
        }
    }

    fn path(self) -> Result<PathBuf, String> {
        let home = crate::config::get_home_dir();
        let fallback = match self {
            Self::Grok => home.join(".grok/config.toml"),
            Self::Pi => home.join(".pi/agent/mcp.json"),
            Self::Mcode => home.join(".minimax/mcp.json"),
        };
        #[cfg(not(feature = "local-preview"))]
        {
            let vars: &[&str] = match self {
                Self::Grok => &[],
                Self::Pi => &["PI_CODING_AGENT_DIR"],
                Self::Mcode => &["MINIMAX_DATA_DIR", "MAVIS_DATA_DIR"],
            };
            for var in vars {
                if let Some(dir) = std::env::var_os(var).filter(|v| !v.is_empty()) {
                    let dir = PathBuf::from(dir);
                    if !dir.is_absolute() {
                        return Err(format!("{var} must be an absolute directory"));
                    }
                    return Ok(dir.join("mcp.json"));
                }
            }
        }
        Ok(fallback)
    }

    fn set_enabled(self, server: &mut McpServer, enabled: bool) {
        match self {
            Self::Grok => server.apps.grokbuild = enabled,
            Self::Pi => {
                server.apps.pi = enabled;
                server.apps.pi_managed = true;
            }
            Self::Mcode => server.apps.mcode = enabled,
        }
    }
}

pub(crate) fn import(state: &crate::store::AppState) -> Result<usize, AppError> {
    let targets = [NativeMcpTool::Grok, NativeMcpTool::Pi, NativeMcpTool::Mcode]
        .into_iter()
        .map(|tool| Ok((tool, tool.path().map_err(AppError::Message)?)))
        .collect::<Result<Vec<_>, AppError>>()?;
    import_at_paths(state, targets)
}

fn import_at_paths(
    state: &crate::store::AppState,
    targets: Vec<(NativeMcpTool, PathBuf)>,
) -> Result<usize, AppError> {
    let _guard = native_tools::LOCK
        .lock()
        .map_err(|_| AppError::Message("工具配置锁不可用".into()))?;
    let mut existing = state.db.get_all_mcp_servers()?;
    let mut count = 0;
    let mut errors = Vec::new();
    let mut pending = std::collections::BTreeSet::new();
    for (tool, path) in targets {
        let bytes = native_tools::read_bytes(&path).map_err(AppError::Message)?;
        let Some(bytes) = bytes else { continue };
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| AppError::Message("MCP 配置不是 UTF-8".into()))?;
        let root: Value = if tool == NativeMcpTool::Grok {
            let root: toml::Value =
                toml::from_str(text).map_err(|_| AppError::Message("Grok 配置无效".into()))?;
            serde_json::to_value(root).map_err(|_| AppError::Message("Grok 配置无法读取".into()))?
        } else {
            serde_json::from_str(text)
                .map_err(|_| AppError::Message(format!("{} MCP JSON 无效", path.display())))?
        };
        let key = if tool == NativeMcpTool::Grok {
            "mcp_servers"
        } else {
            "mcpServers"
        };
        let root = root
            .as_object()
            .ok_or_else(|| AppError::Message("MCP 配置必须是对象".into()))?;
        let Some(entries) = root.get(key) else {
            continue;
        };
        let entries = entries
            .as_object()
            .ok_or_else(|| AppError::Message("MCP 服务器列表必须是对象".into()))?;
        for (id, native) in entries {
            let Some(object) = native.as_object() else {
                errors.push(format!("{}: {id} 格式无效", path.display()));
                continue;
            };
            let mut spec = serde_json::Map::new();
            for field in CONNECTION_FIELDS {
                if let Some(value) = object.get(*field) {
                    spec.insert((*field).into(), value.clone());
                }
            }
            if !spec.contains_key("type") {
                spec.insert(
                    "type".into(),
                    json!(if spec.contains_key("url") {
                        "http"
                    } else {
                        "stdio"
                    }),
                );
            } else if spec.get("type") == Some(&json!("streamable-http")) {
                spec.insert("type".into(), json!("http"));
            }
            let spec = Value::Object(spec);
            if validate(tool, id, &spec).is_err()
                || object.get("enabled").is_some_and(|v| !v.is_boolean())
            {
                errors.push(format!("{}: {id} 连接配置无效或不受支持", path.display()));
                continue;
            }
            let enabled = object
                .get("enabled")
                .and_then(Value::as_bool)
                .unwrap_or(true);
            let mut server = if let Some(server) = existing.get(id) {
                if !connection_matches(&spec, &server.server) {
                    errors.push(format!("{}: {id} 与已有服务器冲突", path.display()));
                    continue;
                }
                server.clone()
            } else {
                count += 1;
                McpServer {
                    id: id.clone(),
                    name: id.clone(),
                    server: spec,
                    apps: Default::default(),
                    description: None,
                    homepage: None,
                    docs: None,
                    tags: vec![],
                }
            };
            tool.set_enabled(&mut server, enabled);
            pending.insert(id.clone());
            existing.insert(id.clone(), server);
        }
    }
    if errors.is_empty() {
        let servers = pending
            .into_iter()
            .map(|id| existing[&id].clone())
            .collect::<Vec<_>>();
        state.db.save_mcp_servers_atomic(&servers)?;
        Ok(count)
    } else {
        Err(AppError::Message(format!(
            "导入未执行，请先解决以下问题：{}",
            errors.join("; ")
        )))
    }
}

const CONNECTION_FIELDS: &[&str] = &["type", "command", "args", "env", "cwd", "url", "headers"];

/// Compare connection data without treating tool-owned fields as managed state.
fn connection_matches(native: &Value, expected: &Value) -> bool {
    let (Some(native), Some(expected)) = (native.as_object(), expected.as_object()) else {
        return false;
    };
    let kind = |object: &serde_json::Map<String, Value>| {
        object
            .get("type")
            .and_then(Value::as_str)
            .map(|value| {
                if value == "streamable-http" {
                    "http"
                } else {
                    value
                }
                .to_owned()
            })
            .unwrap_or_else(|| {
                if object.contains_key("url") {
                    "http".into()
                } else {
                    "stdio".into()
                }
            })
    };
    if kind(native) != kind(expected) {
        return false;
    }
    CONNECTION_FIELDS
        .iter()
        .filter(|key| **key != "type")
        .all(|key| native.get(*key) == expected.get(*key))
}

fn existing_entry(
    tool: NativeMcpTool,
    bytes: Option<&[u8]>,
    id: &str,
) -> Result<Option<Value>, String> {
    let text = std::str::from_utf8(bytes.unwrap_or_default()).map_err(|_| "MCP 配置不是 UTF-8")?;
    if text.trim().is_empty() {
        return Ok(None);
    }
    let root: Value = if tool == NativeMcpTool::Grok {
        let root: toml::Value = toml::from_str(text).map_err(|_| "Grok 配置无效")?;
        serde_json::to_value(root).map_err(|_| "Grok 配置无法读取")?
    } else {
        serde_json::from_str(text).map_err(|_| "MCP JSON 无效")?
    };
    let root = root.as_object().ok_or("MCP 配置必须是对象")?;
    let key = if tool == NativeMcpTool::Grok {
        "mcp_servers"
    } else {
        "mcpServers"
    };
    match root.get(key) {
        None => Ok(None),
        Some(Value::Object(servers)) => Ok(servers.get(id).cloned()),
        Some(_) => Err("MCP 服务器列表必须是对象".into()),
    }
}

struct ChangeFile {
    path: PathBuf,
    before: Option<Vec<u8>>,
    after: Vec<u8>,
}

fn rollback(written: &[ChangeFile]) -> Result<(), String> {
    let mut failures = Vec::new();
    for change in written.iter().rev() {
        let result = (|| {
            if native_tools::read_bytes(&change.path)?.as_deref() != Some(change.after.as_slice()) {
                return Err("文件已被外部修改，未自动覆盖".to_string());
            }
            match &change.before {
                Some(before) => native_tools::private_write(&change.path, before),
                None => {
                    fs::remove_file(&change.path).map_err(|_| "无法删除新建配置文件".to_string())
                }
            }
        })();
        if let Err(error) = result {
            failures.push(format!("{}: {error}", change.path.display()));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

/// Prepare all native files before writing and compensate if the database update fails.
pub(crate) fn commit<T>(
    previous: Option<&McpServer>,
    next: Option<&McpServer>,
    save: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let mut targets = Vec::new();
    for tool in [NativeMcpTool::Grok, NativeMcpTool::Pi, NativeMcpTool::Mcode] {
        let was_enabled = previous.is_some_and(|server| tool.enabled(server));
        let enabled = next.is_some_and(|server| tool.enabled(server));
        let managed_pi =
            tool == NativeMcpTool::Pi && previous.is_some_and(|server| server.apps.pi_managed);
        let connection_changed = (was_enabled && enabled || managed_pi && next.is_some())
            && previous
                .zip(next)
                .is_some_and(|(old, new)| old.server != new.server);
        if was_enabled != enabled || connection_changed || (managed_pi && next.is_none()) {
            targets.push((
                tool.path().map_err(AppError::Message)?,
                tool,
                was_enabled,
                enabled,
            ));
        }
    }
    commit_at_paths(previous, next, targets, save)
}

fn commit_at_paths<T>(
    previous: Option<&McpServer>,
    next: Option<&McpServer>,
    mut targets: Vec<(PathBuf, NativeMcpTool, bool, bool)>,
    save: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    let _guard = native_tools::LOCK
        .lock()
        .map_err(|_| AppError::Message("工具配置锁不可用".into()))?;
    targets.sort_by(|a, b| a.0.cmp(&b.0));
    if targets.windows(2).any(|items| items[0].0 == items[1].0) {
        return Err(AppError::Message("多个工具的 MCP 配置路径相同".into()));
    }
    let mut locks = Vec::new();
    for (path, _, _, _) in &targets {
        locks.push(native_tools::file_lock(path).map_err(AppError::Message)?);
    }
    let mut changes = Vec::new();
    for (path, tool, was_enabled, enabled) in targets {
        let before = native_tools::read_bytes(&path).map_err(AppError::Message)?;
        let server = next.or(previous).expect("target has a server");
        let existing =
            existing_entry(tool, before.as_deref(), &server.id).map_err(AppError::Message)?;
        let managed_pi =
            tool == NativeMcpTool::Pi && previous.is_some_and(|server| server.apps.pi_managed);
        let expected = if was_enabled || managed_pi {
            &previous.unwrap().server
        } else {
            &next.unwrap().server
        };
        if let Some(entry) = &existing {
            if !was_enabled && !managed_pi {
                return Err(AppError::Message(format!(
                    "{} 中已有同名 MCP 配置，请先导入后再管理",
                    path.display()
                )));
            }
            if !connection_matches(entry, expected) {
                return Err(AppError::Message(format!(
                    "{} 中同名 MCP 配置已存在或被修改，请先检查",
                    path.display()
                )));
            }
            if managed_pi && !was_enabled && entry.get("enabled") != Some(&json!(false)) {
                return Err(AppError::Message(format!(
                    "{} 中的 Pi MCP 状态已被修改，请先检查",
                    path.display()
                )));
            }
        } else if was_enabled {
            return Err(AppError::Message(format!(
                "{} 中的 MCP 配置已被移除，请先检查",
                path.display()
            )));
        } else if managed_pi && next.is_none() {
            continue;
        } else if managed_pi && !enabled {
            return Err(AppError::Message(format!(
                "{} 中的 Pi MCP 配置已被移除，请先检查",
                path.display()
            )));
        }
        let update_disabled_pi = managed_pi && !enabled && next.is_some();
        let mut after = transform(
            tool,
            before.as_deref(),
            &server.id,
            (enabled || update_disabled_pi).then(|| &next.unwrap().server),
        )
        .map_err(AppError::Message)?;
        if update_disabled_pi {
            after = transform(tool, Some(&after), &server.id, None).map_err(AppError::Message)?;
        }
        if tool == NativeMcpTool::Pi && next.is_none() {
            let mut root: Value = serde_json::from_slice(&after)
                .map_err(|_| AppError::Message("Pi MCP 配置无效".into()))?;
            root["mcpServers"]
                .as_object_mut()
                .expect("validated servers")
                .remove(&server.id);
            after = serde_json::to_vec_pretty(&root)
                .map_err(|_| AppError::Message("无法编码 Pi MCP 配置".into()))?;
        }
        changes.push(ChangeFile {
            path,
            before,
            after,
        });
    }
    let mut written = Vec::new();
    let result = (|| {
        for change in changes {
            if native_tools::read_bytes(&change.path).map_err(AppError::Message)? != change.before {
                return Err(AppError::Message(format!(
                    "{} 已被外部修改，请重试",
                    change.path.display()
                )));
            }
            native_tools::private_write(&change.path, &change.after).map_err(AppError::Message)?;
            written.push(change);
        }
        save()
    })();
    if let Err(error) = result {
        return match rollback(&written) {
            Ok(()) => Err(error),
            Err(restore_error) => Err(AppError::Message(format!(
                "{error}; 恢复配置失败: {restore_error}"
            ))),
        };
    }
    result
}

fn validate(tool: NativeMcpTool, id: &str, spec: &Value) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("MCP 服务器标识仅支持字母、数字、下划线和短横线".into());
    }
    let object = spec.as_object().ok_or("MCP 配置必须是对象")?;
    let kind = match object.get("type") {
        None => "stdio",
        Some(Value::String(kind)) => kind.as_str(),
        Some(_) => return Err("MCP type 必须是字符串".into()),
    };
    if !matches!(kind, "stdio" | "http" | "sse")
        || (matches!(tool, NativeMcpTool::Pi | NativeMcpTool::Grok) && kind == "sse")
    {
        return Err("此工具不支持该 MCP 连接方式".into());
    }
    let required = if kind == "stdio" { "command" } else { "url" };
    if object
        .get(required)
        .and_then(Value::as_str)
        .is_none_or(|v| v.trim().is_empty())
    {
        return Err(format!("MCP 缺少 {required}"));
    }
    let forbidden: &[&str] = if kind == "stdio" {
        &["url", "headers"]
    } else {
        &["command", "args", "env", "cwd"]
    };
    if forbidden.iter().any(|key| object.contains_key(*key)) {
        return Err("MCP 连接字段与连接方式不匹配".into());
    }
    if object.get("args").is_some_and(|v| {
        v.as_array()
            .is_none_or(|values| values.iter().any(|value| !value.is_string()))
    }) {
        return Err("MCP args 必须是字符串数组".into());
    }
    for key in ["env", "headers"] {
        if object.get(key).is_some_and(|v| {
            v.as_object()
                .is_none_or(|values| values.values().any(|value| !value.is_string()))
        }) {
            return Err(format!("MCP {key} 必须是字符串键值对象"));
        }
    }
    if object.get("cwd").is_some_and(|value| !value.is_string()) {
        return Err("MCP cwd 必须是字符串".into());
    }
    Ok(())
}

/// Only connection fields are replaced. Native fields remain owned by the tool.
pub(crate) fn transform(
    tool: NativeMcpTool,
    bytes: Option<&[u8]>,
    id: &str,
    spec: Option<&Value>,
) -> Result<Vec<u8>, String> {
    if let Some(spec) = spec {
        validate(tool, id, spec)?;
    } else if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err("无效的 MCP 服务器标识".into());
    }
    let text = std::str::from_utf8(bytes.unwrap_or_default()).map_err(|_| "MCP 配置不是 UTF-8")?;
    if tool == NativeMcpTool::Grok {
        let mut doc = text
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| "Grok 配置无效")?;
        if !doc.as_table().contains_key("mcp_servers") {
            doc["mcp_servers"] = toml_edit::Item::Table(toml_edit::Table::new());
        }
        let servers = doc["mcp_servers"]
            .as_table_mut()
            .ok_or("Grok MCP 配置必须是表")?;
        if let Some(spec) = spec {
            let mut existing = match servers.get(id) {
                None => toml_edit::Table::new(),
                Some(item) => item.as_table().ok_or("Grok MCP 条目必须是表")?.clone(),
            };
            for key in CONNECTION_FIELDS {
                existing.remove(key);
            }
            existing.remove("http_headers");
            let mut connection = spec.as_object().unwrap().clone();
            connection.retain(|key, _| CONNECTION_FIELDS.contains(&key.as_str()) && key != "type");
            let value: toml::Value = serde_json::from_value(Value::Object(connection))
                .map_err(|_| "MCP 字段无法转换为 TOML")?;
            let converted = toml::to_string(&value)
                .map_err(|_| "MCP 字段无法转换为 TOML")?
                .parse::<toml_edit::DocumentMut>()
                .map_err(|_| "MCP 字段无法转换为 TOML")?;
            for (key, value) in converted.as_table().iter() {
                existing.insert(key, value.clone());
            }
            servers.insert(id, toml_edit::Item::Table(existing));
        } else {
            servers.remove(id);
        }
        return Ok(doc.to_string().into_bytes());
    }
    let mut root: Value = if text.trim().is_empty() {
        json!({})
    } else {
        serde_json::from_str(text).map_err(|_| "MCP JSON 无效")?
    };
    let root_object = root.as_object_mut().ok_or("MCP JSON 必须是对象")?;
    let servers = root_object
        .entry("mcpServers")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("mcpServers 必须是对象")?;
    if tool == NativeMcpTool::Pi
        && servers
            .keys()
            .any(|key| key != id && key.replace('-', "_") == id.replace('-', "_"))
    {
        return Err("Pi 中存在名称冲突的 MCP 服务器".into());
    }
    if let Some(spec) = spec {
        let entry = servers
            .entry(id.to_owned())
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("MCP 条目必须是对象")?;
        for key in CONNECTION_FIELDS {
            entry.remove(*key);
        }
        for (key, value) in spec.as_object().unwrap() {
            if CONNECTION_FIELDS.contains(&key.as_str()) {
                entry.insert(key.clone(), value.clone());
            }
        }
        entry.insert("enabled".into(), json!(true));
    } else if tool == NativeMcpTool::Pi {
        if let Some(entry) = servers.get_mut(id) {
            entry
                .as_object_mut()
                .ok_or("MCP 条目必须是对象")?
                .insert("enabled".into(), json!(false));
        }
    } else {
        servers.remove(id);
    }
    serde_json::to_vec_pretty(&root).map_err(|_| "无法编码 MCP 配置".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_config::McpApps;

    fn fixture() -> McpServer {
        McpServer {
            id: "fixture".into(),
            name: "Fixture".into(),
            server: json!({"type":"stdio", "command":"fixture"}),
            apps: McpApps {
                pi: true,
                pi_managed: true,
                mcode: true,
                ..Default::default()
            },
            description: None,
            homepage: None,
            docs: None,
            tags: vec![],
        }
    }

    #[test]
    fn import_merges_matching_servers_and_reports_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let pi = dir.path().join("pi.json");
        let grok = dir.path().join("grok.toml");
        let pi_bytes = br#"{"mcpServers":{"fixture":{"command":"fixture","enabled":false},"other":{"command":"other"}}}"#;
        let grok_bytes = b"[mcp_servers.fixture]\ncommand = \"different\"\n";
        fs::write(&pi, pi_bytes).unwrap();
        fs::write(&grok, grok_bytes).unwrap();
        let state = crate::store::AppState::new(std::sync::Arc::new(
            crate::database::Database::memory().unwrap(),
        ));
        let mut existing = fixture();
        existing.apps = McpApps::default();
        state.db.save_mcp_server(&existing).unwrap();
        let result = import_at_paths(
            &state,
            vec![
                (NativeMcpTool::Pi, pi.clone()),
                (NativeMcpTool::Grok, grok.clone()),
            ],
        );
        assert!(result.unwrap_err().to_string().contains("冲突"));
        let servers = state.db.get_all_mcp_servers().unwrap();
        assert!(!servers["fixture"].apps.pi);
        assert!(!servers["fixture"].apps.grokbuild);
        assert!(!servers.contains_key("other"));
        assert_eq!(fs::read(pi).unwrap(), pi_bytes);
        assert_eq!(fs::read(grok).unwrap(), grok_bytes);
    }

    #[test]
    fn import_rolls_back_when_later_database_write_fails() {
        let dir = tempfile::tempdir().unwrap();
        let pi = dir.path().join("pi.json");
        fs::write(
            &pi,
            br#"{"mcpServers":{"first":{"command":"first"},"second":{"command":"second"}}}"#,
        )
        .unwrap();
        let state = crate::store::AppState::new(std::sync::Arc::new(
            crate::database::Database::memory().unwrap(),
        ));
        {
            let conn = state.db.conn.lock().unwrap();
            conn.execute_batch("CREATE TRIGGER fail_second BEFORE INSERT ON mcp_servers WHEN NEW.id = 'second' BEGIN SELECT RAISE(FAIL, 'synthetic failure'); END;").unwrap();
        }
        assert!(import_at_paths(&state, vec![(NativeMcpTool::Pi, pi)]).is_err());
        assert!(state.db.get_all_mcp_servers().unwrap().is_empty());
    }

    #[test]
    fn pi_disable_and_delete_preserve_or_remove_as_requested() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi.json");
        let server = fixture();
        commit_at_paths(
            None,
            Some(&server),
            vec![(path.clone(), NativeMcpTool::Pi, false, true)],
            || Ok(()),
        )
        .unwrap();
        let mut disabled = server.clone();
        disabled.apps.pi = false;
        commit_at_paths(
            Some(&server),
            Some(&disabled),
            vec![(path.clone(), NativeMcpTool::Pi, true, false)],
            || Ok(()),
        )
        .unwrap();
        let value: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(value["mcpServers"]["fixture"]["enabled"], false);
        commit_at_paths(
            Some(&disabled),
            Some(&server),
            vec![(path.clone(), NativeMcpTool::Pi, false, true)],
            || Ok(()),
        )
        .unwrap();
        commit_at_paths(
            Some(&server),
            None,
            vec![(path.clone(), NativeMcpTool::Pi, true, false)],
            || Ok(()),
        )
        .unwrap();
        let value: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert!(value["mcpServers"].get("fixture").is_none());
    }

    #[test]
    fn disabled_managed_pi_entry_is_removed_on_delete() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pi.json");
        let mut server = fixture();
        server.apps.pi = false;
        fs::write(
            &path,
            br#"{"mcpServers":{"fixture":{"command":"fixture","enabled":false,"timeout":3}}}"#,
        )
        .unwrap();
        commit_at_paths(
            Some(&server),
            None,
            vec![(path.clone(), NativeMcpTool::Pi, false, false)],
            || Ok(()),
        )
        .unwrap();
        let value: Value = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert!(value["mcpServers"].get("fixture").is_none());
    }

    #[test]
    fn failed_database_save_restores_all_native_files() {
        let dir = tempfile::tempdir().unwrap();
        let pi = dir.path().join("pi.json");
        let mcode = dir.path().join("mcode.json");
        let before = br#"{"other":true}"#;
        fs::write(&pi, before).unwrap();
        let server = fixture();
        let result: Result<(), AppError> = commit_at_paths(
            None,
            Some(&server),
            vec![
                (pi.clone(), NativeMcpTool::Pi, false, true),
                (mcode.clone(), NativeMcpTool::Mcode, false, true),
            ],
            || Err(AppError::Message("synthetic database failure".into())),
        );
        assert!(result.is_err());
        assert_eq!(fs::read(pi).unwrap(), before);
        assert!(!mcode.exists());
    }

    #[test]
    fn rollback_does_not_overwrite_external_edits() {
        let dir = tempfile::tempdir().unwrap();
        let pi = dir.path().join("pi.json");
        let server = fixture();
        let result: Result<(), AppError> = commit_at_paths(
            None,
            Some(&server),
            vec![(pi.clone(), NativeMcpTool::Pi, false, true)],
            || {
                fs::write(&pi, b"external edit").unwrap();
                Err(AppError::Message("synthetic database failure".into()))
            },
        );
        assert!(result.unwrap_err().to_string().contains("外部修改"));
        assert_eq!(fs::read(pi).unwrap(), b"external edit");
    }

    #[test]
    fn conflicting_entry_does_not_write_any_target() {
        let dir = tempfile::tempdir().unwrap();
        let pi = dir.path().join("pi.json");
        let grok = dir.path().join("grok.toml");
        let before = br#"{"mcpServers":{"fixture":{"command":"other"}}}"#;
        fs::write(&pi, before).unwrap();
        let server = fixture();
        let result = commit_at_paths(
            None,
            Some(&server),
            vec![
                (grok.clone(), NativeMcpTool::Grok, false, true),
                (pi.clone(), NativeMcpTool::Pi, false, true),
            ],
            || Ok(()),
        );
        assert!(result.is_err());
        assert_eq!(fs::read(pi).unwrap(), before);
        assert!(!grok.exists());
    }

    #[test]
    fn identical_unmanaged_entry_requires_import() {
        let dir = tempfile::tempdir().unwrap();
        let pi = dir.path().join("pi.json");
        let before = br#"{"mcpServers":{"fixture":{"command":"fixture"}}}"#;
        fs::write(&pi, before).unwrap();
        let result = commit_at_paths(
            None,
            Some(&fixture()),
            vec![(pi.clone(), NativeMcpTool::Pi, false, true)],
            || Ok(()),
        );
        assert!(result.unwrap_err().to_string().contains("先导入"));
        assert_eq!(fs::read(pi).unwrap(), before);
    }
    #[test]
    fn json_preserves_native_fields_and_pi_disables_without_removing() {
        let before = br#"{"other":1,"mcpServers":{"work":{"command":"old","timeout":12,"oauth":{"clientId":"fixture"}}}}"#;
        let output = transform(
            NativeMcpTool::Pi,
            Some(before),
            "work",
            Some(&json!({"type":"stdio","command":"new"})),
        )
        .unwrap();
        let value: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(value["other"], 1);
        assert_eq!(value["mcpServers"]["work"]["timeout"], 12);
        assert_eq!(value["mcpServers"]["work"]["oauth"]["clientId"], "fixture");
        let output = transform(NativeMcpTool::Pi, Some(&output), "work", None).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&output).unwrap()["mcpServers"]["work"]["enabled"],
            false
        );
        assert!(transform(
            NativeMcpTool::Pi,
            Some(before),
            "work",
            Some(&json!({"type":"sse","url":"https://example.invalid"}))
        )
        .is_err());
        assert!(transform(
            NativeMcpTool::Pi,
            Some(br#"{"mcpServers":{"a_b":{}}}"#),
            "a-b",
            Some(&json!({"command":"x"}))
        )
        .is_err());
    }
    #[test]
    fn grok_preserves_model_and_unrelated_mcp_fields() {
        let before = b"# keep\n[models]\ndefault = \"existing\"\n[mcp_servers.work]\ncommand = \"old\"\ntimeout = 30\n";
        let output = transform(NativeMcpTool::Grok, Some(before), "work", Some(&json!({"type":"http","url":"https://example.invalid/mcp","headers":{"x-test":"synthetic"}}))).unwrap();
        let text = String::from_utf8(output).unwrap();
        assert!(text.contains("# keep"));
        let value: toml::Value = toml::from_str(&text).unwrap();
        assert_eq!(value["models"]["default"].as_str(), Some("existing"));
        assert_eq!(
            value["mcp_servers"]["work"]["timeout"].as_integer(),
            Some(30)
        );
        assert_eq!(
            value["mcp_servers"]["work"]["headers"]["x-test"].as_str(),
            Some("synthetic")
        );
        assert!(value["mcp_servers"]["work"].get("command").is_none());
    }
    #[test]
    fn invalid_documents_are_rejected_and_mcode_removes_only_target() {
        assert!(transform(NativeMcpTool::Mcode, Some(b"{"), "a", None).is_err());
        let out = transform(
            NativeMcpTool::Mcode,
            Some(br#"{"mcpServers":{"a":{"command":"x"},"b":{"command":"y"}}}"#),
            "a",
            None,
        )
        .unwrap();
        let value: Value = serde_json::from_slice(&out).unwrap();
        assert!(value["mcpServers"].get("a").is_none());
        assert_eq!(value["mcpServers"]["b"]["command"], "y");
    }

    #[test]
    fn rejects_invalid_and_mixed_connection_fields() {
        for spec in [
            json!({"type": 5, "command": "cmd"}),
            json!({"command": "cmd", "args": [1]}),
            json!({"command": "cmd", "env": {"KEY": false}}),
            json!({"type": "http", "url": "https://example.invalid", "command": "cmd"}),
            json!({"command": "cmd", "headers": {"Authorization": "x"}}),
            json!({"command": "cmd", "cwd": 42}),
        ] {
            assert!(transform(NativeMcpTool::Pi, None, "test", Some(&spec)).is_err());
        }
    }

    #[test]
    fn connection_comparison_ignores_native_metadata_but_detects_edits() {
        let expected = json!({"type":"stdio", "command":"fixture", "args":["serve"]});
        assert!(connection_matches(
            &json!({"command":"fixture", "args":["serve"], "timeout":30}),
            &expected
        ));
        assert!(!connection_matches(
            &json!({"command":"other", "args":["serve"]}),
            &expected
        ));
        assert!(!connection_matches(
            &json!({"url":"https://example.invalid"}),
            &expected
        ));
    }
}
