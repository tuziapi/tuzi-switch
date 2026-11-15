//! Side-effect-free preparation for the existing tools. All files are prepared
//! before native_mcp commits any file or the database.
use crate::{
    app_config::{AppType, McpServer},
    error::AppError,
    native_mcp::ChangeFile,
    native_tools,
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub(crate) fn targets(
    previous: Option<&McpServer>,
    next: Option<&McpServer>,
) -> Vec<(AppType, PathBuf)> {
    [
        AppType::Claude,
        AppType::Codex,
        AppType::Gemini,
        AppType::OpenCode,
        AppType::Hermes,
    ]
    .into_iter()
    .filter_map(|app| {
        let old = previous.is_some_and(|s| s.apps.is_enabled_for(&app));
        let new = next.is_some_and(|s| s.apps.is_enabled_for(&app));
        if (!old && !new)
            || (old == new
                && previous
                    .zip(next)
                    .is_some_and(|(a, b)| a.server == b.server))
        {
            return None;
        }
        let (directory, path) = match app {
            AppType::Claude => (
                crate::config::get_claude_config_dir(),
                crate::config::get_claude_mcp_path(),
            ),
            AppType::Codex => (
                crate::codex_config::get_codex_config_dir(),
                crate::codex_config::get_codex_config_path(),
            ),
            AppType::Gemini => (
                crate::gemini_config::get_gemini_dir(),
                crate::gemini_config::get_gemini_settings_path(),
            ),
            AppType::OpenCode => (
                crate::opencode_config::get_opencode_dir(),
                crate::opencode_config::get_opencode_config_path(),
            ),
            AppType::Hermes => (
                crate::hermes_config::get_hermes_dir(),
                crate::hermes_config::get_hermes_config_path(),
            ),
            _ => unreachable!(),
        };
        // Preserve the existing policy: don't initialize tools that aren't installed.
        (directory.exists() || path.exists()).then_some((app, path))
    })
    .collect()
}

pub(crate) fn prepare(
    app: &AppType,
    path: &Path,
    previous: Option<&McpServer>,
    next: Option<&McpServer>,
) -> Result<ChangeFile, AppError> {
    let before = native_tools::read_bytes(path).map_err(AppError::Message)?;
    let server = next
        .or(previous)
        .ok_or_else(|| AppError::Message("MCP 服务器不存在".into()))?;
    let enabled = next.is_some_and(|s| s.apps.is_enabled_for(app));
    let old = previous
        .filter(|s| s.apps.is_enabled_for(app))
        .map(|s| &s.server);
    let after = transform(
        app,
        path,
        before.as_deref(),
        &server.id,
        old,
        enabled.then_some(&server.server),
    )?;
    Ok(ChangeFile {
        path: path.to_owned(),
        before,
        after,
    })
}

fn error() -> AppError {
    AppError::Message("MCP 配置无效或同名条目已被修改，请先检查或重新导入；原文件保留".into())
}
const CORE: &[&str] = &[
    "type",
    "command",
    "args",
    "env",
    "environment",
    "cwd",
    "url",
    "httpUrl",
    "headers",
    "http_headers",
];

fn converted(app: &AppType, path: &Path, spec: &Value) -> Result<Value, AppError> {
    super::validation::validate_server_spec(spec)?;
    match app {
        AppType::Codex => {
            let table = super::codex::json_server_to_toml_table(spec)?;
            let mut document = toml_edit::DocumentMut::new();
            *document.as_table_mut() = table;
            let doc: toml::Value = toml::from_str(&document.to_string()).map_err(|_| error())?;
            serde_json::to_value(doc).map_err(|_| error())
        }
        AppType::Hermes => super::hermes::convert_to_hermes_format(spec),
        AppType::OpenCode => super::opencode::convert_to_opencode_format(spec),
        AppType::Claude | AppType::Gemini => {
            let map = [("entry".to_string(), spec.clone())].into_iter().collect();
            let root = if *app == AppType::Claude {
                crate::claude_mcp::render_mcp_servers(path, json!({}), &map)?
            } else {
                crate::gemini_mcp::render_mcp_servers(path, json!({}), &map)?
            };
            Ok(root["mcpServers"]["entry"].clone())
        }
        _ => Err(error()),
    }
}

/// Compare the representations the selected tool actually stores. Hermes and
/// OpenCode infer remote transport, so their imports cannot distinguish HTTP/SSE.
pub(crate) fn connections_match(
    app: &AppType,
    actual: &Value,
    expected: &Value,
) -> Result<bool, AppError> {
    let path = crate::config::get_claude_mcp_path();
    let actual = converted(app, &path, actual)?;
    let expected = converted(app, &path, expected)?;
    Ok(merge(Some(&actual), Some(&expected), None).is_ok())
}

fn merge(
    existing: Option<&Value>,
    old: Option<&Value>,
    next: Option<&Value>,
) -> Result<Option<Value>, AppError> {
    if let Some(entry) = existing {
        let expected = old.ok_or_else(error)?;
        let object = entry.as_object().ok_or_else(error)?;
        if CORE.iter().any(|key| {
            // Some tools omit explicit stdio and empty optional fields.
            fn normalize(v: Option<&Value>) -> Option<&Value> {
                v.filter(|v| {
                    !matches!(v, Value::Array(a) if a.is_empty())
                        && !matches!(v, Value::Object(o) if o.is_empty())
                })
            }
            if *key == "type"
                && entry.get(key).is_none()
                && ((expected.get(key) == Some(&json!("stdio")) && entry.get("command").is_some())
                    || (expected.get(key) == Some(&json!("http")) && entry.get("url").is_some()))
            {
                return false;
            }
            normalize(object.get(*key)) != normalize(expected.get(*key))
        }) {
            return Err(error());
        }
    }
    let Some(next) = next else {
        return Ok(None);
    };
    let mut result = existing
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for key in CORE {
        result.remove(*key);
    }
    for (key, value) in next.as_object().ok_or_else(error)? {
        result.insert(key.clone(), value.clone());
    }
    Ok(Some(Value::Object(result)))
}

pub(crate) fn transform(
    app: &AppType,
    path: &Path,
    before: Option<&[u8]>,
    id: &str,
    old: Option<&Value>,
    next: Option<&Value>,
) -> Result<Vec<u8>, AppError> {
    let text = std::str::from_utf8(before.unwrap_or_default()).map_err(|_| error())?;
    let old = old.map(|v| converted(app, path, v)).transpose()?;
    let next = next.map(|v| converted(app, path, v)).transpose()?;
    if *app == AppType::Codex {
        let mut doc = text
            .parse::<toml_edit::DocumentMut>()
            .map_err(|_| error())?;
        if !doc.contains_key("mcp_servers") {
            doc["mcp_servers"] = toml_edit::table();
        }
        let servers = doc["mcp_servers"].as_table_like_mut().ok_or_else(error)?;
        let existing = servers
            .get(id)
            .map(|item| {
                let val = if let Some(table) = item.as_table() {
                    let mut document = toml_edit::DocumentMut::new();
                    *document.as_table_mut() = table.clone();
                    document.to_string()
                } else if let Some(table) = item.as_inline_table() {
                    table.iter().map(|(k, v)| format!("{k} = {v}\n")).collect()
                } else {
                    return Err(error());
                };
                let value: toml::Value = toml::from_str(&val).map_err(|_| error())?;
                serde_json::to_value(value).map_err(|_| error())
            })
            .transpose()?;
        let result = merge(existing.as_ref(), old.as_ref(), next.as_ref())?;
        if let Some(value) = result {
            let value: toml::Value = serde_json::from_value(value).map_err(|_| error())?;
            let new_doc = toml::to_string(&value)
                .map_err(|_| error())?
                .parse::<toml_edit::DocumentMut>()
                .map_err(|_| error())?;
            servers.insert(id, toml_edit::Item::Table(new_doc.as_table().clone()));
        } else {
            servers.remove(id);
        }
        // Remove only this legacy entry, never other servers.
        if let Some(legacy) = doc
            .get_mut("mcp")
            .and_then(|x| x.get_mut("servers"))
            .and_then(|x| x.as_table_like_mut())
        {
            legacy.remove(id);
        }
        return Ok(doc.to_string().into_bytes());
    }
    let mut root: Value = if text.trim().is_empty() {
        json!({})
    } else if *app == AppType::Hermes {
        serde_yaml::from_str(text).map_err(|_| error())?
    } else if *app == AppType::OpenCode {
        json5::from_str(text).map_err(|_| error())?
    } else {
        serde_json::from_str(text).map_err(|_| error())?
    };
    let key = match app {
        AppType::Hermes => "mcp_servers",
        AppType::OpenCode => "mcp",
        _ => "mcpServers",
    };
    let servers = root
        .as_object_mut()
        .ok_or_else(error)?
        .entry(key)
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(error)?;
    match merge(servers.get(id), old.as_ref(), next.as_ref())? {
        Some(value) => {
            servers.insert(id.into(), value);
        }
        None => {
            servers.remove(id);
        }
    }
    if *app == AppType::Hermes {
        let yaml = serde_yaml::to_value(&root[key]).map_err(|_| error())?;
        return Ok(crate::hermes_config::replace_yaml_section(text, key, &yaml)?.into_bytes());
    }
    serde_json::to_vec_pretty(&root).map_err(|_| error())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_mcp_codex_environment_nested_tables_survive_roundtrip() {
        let spec = json!({"command":"fixture", "env":{"SYNTHETIC":"fixture"}});
        let first = transform(
            &AppType::Codex,
            Path::new("config.toml"),
            None,
            "work",
            None,
            Some(&spec),
        )
        .unwrap();
        let second = transform(
            &AppType::Codex,
            Path::new("config.toml"),
            Some(&first),
            "work",
            Some(&spec),
            Some(&spec),
        )
        .unwrap();
        let doc: toml::Value = toml::from_str(std::str::from_utf8(&second).unwrap()).unwrap();
        assert_eq!(
            doc["mcp_servers"]["work"]["env"]["SYNTHETIC"].as_str(),
            Some("fixture")
        );
    }
    #[test]
    fn legacy_mcp_codex_native_http_without_type_accepts_imported_headers() {
        let before = b"[mcp_servers.remote]\nurl = \"https://example.invalid/mcp\"\n[mcp_servers.remote.http_headers]\nAuthorization = \"synthetic-only\"\n";
        let spec = json!({"type":"http", "url":"https://example.invalid/mcp", "headers":{"Authorization":"synthetic-only"}});
        let result = transform(
            &AppType::Codex,
            Path::new("config.toml"),
            Some(before),
            "remote",
            Some(&spec),
            Some(&spec),
        )
        .unwrap();
        let doc: toml::Value = toml::from_str(std::str::from_utf8(&result).unwrap()).unwrap();
        assert!(doc["mcp_servers"]["remote"].get("headers").is_none());
        assert_eq!(
            doc["mcp_servers"]["remote"]["http_headers"]["Authorization"].as_str(),
            Some("synthetic-only")
        );
    }
    #[test]
    fn legacy_mcp_import_compares_native_transport_and_optional_fields() {
        for app in [AppType::OpenCode, AppType::Hermes] {
            assert!(connections_match(
                &app,
                &json!({"type":"sse", "url":"https://example.invalid/mcp"}),
                &json!({"type":"http", "url":"https://example.invalid/mcp"})
            )
            .unwrap());
        }
        assert!(connections_match(
            &AppType::Codex,
            &json!({"command":"fixture"}),
            &json!({"command":"fixture", "args":[], "env":{}})
        )
        .unwrap());
        assert!(!connections_match(
            &AppType::Claude,
            &json!({"command":"different"}),
            &json!({"command":"fixture"})
        )
        .unwrap());
    }
    #[test]
    fn legacy_mcp_transforms_preserve_settings_and_tool_metadata() {
        let spec = json!({"command":"fixture","type":"stdio"});
        for (app, source, root_key) in [
            (
                AppType::Claude,
                r#"{"theme":"dark","mcpServers":{"work":{"command":"fixture","timeout":30}}}"#,
                "mcpServers",
            ),
            (
                AppType::Gemini,
                r#"{"theme":"dark","mcpServers":{"work":{"command":"fixture","trust":true}}}"#,
                "mcpServers",
            ),
            (
                AppType::OpenCode,
                r#"{"theme":"dark","mcp":{"work":{"type":"local","command":["fixture"],"oauth":{"clientId":"synthetic"}}}}"#,
                "mcp",
            ),
        ] {
            let bytes = transform(
                &app,
                Path::new("fixture.json"),
                Some(source.as_bytes()),
                "work",
                Some(&spec),
                Some(&json!({"command":"next"})),
            )
            .unwrap();
            let root: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(root["theme"], "dark");
            assert!(
                root[root_key]["work"].get("timeout").is_some()
                    || root[root_key]["work"].get("trust").is_some()
                    || root[root_key]["work"].get("oauth").is_some()
            );
        }
        let source = "# Keep model comment\nmodel: synthetic\nmcp_servers:\n  work:\n    command: fixture\n    auth: oauth\n    timeout: 12\n";
        let bytes = transform(
            &AppType::Hermes,
            Path::new("config.yaml"),
            Some(source.as_bytes()),
            "work",
            Some(&spec),
            Some(&json!({"command":"next"})),
        )
        .unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("# Keep model comment"));
        let root: Value = serde_yaml::from_str(&text).unwrap();
        assert_eq!(root["mcp_servers"]["work"]["auth"], "oauth");
        assert_eq!(root["mcp_servers"]["work"]["timeout"], 12);
    }
    #[test]
    fn legacy_mcp_invalid_codex_and_foreign_entries_are_rejected() {
        let spec = json!({"command":"fixture"});
        assert!(transform(
            &AppType::Codex,
            Path::new("config.toml"),
            Some(b"[broken"),
            "work",
            None,
            Some(&spec)
        )
        .is_err());
        assert!(transform(
            &AppType::Claude,
            Path::new("config.json"),
            Some(br#"{"mcpServers":{"work":{"command":"foreign"}}}"#),
            "work",
            Some(&spec),
            None
        )
        .is_err());
        let original = b"# preserved\nmodel = \"synthetic\"\n[mcp_servers.work]\ncommand = \"fixture\"\ntool_timeout_sec = 30\n[mcp_servers.other]\ncommand = \"other\"\n";
        let bytes = transform(
            &AppType::Codex,
            Path::new("config.toml"),
            Some(original),
            "work",
            Some(&spec),
            Some(&json!({"command":"updated"})),
        )
        .unwrap();
        let text = String::from_utf8(bytes).unwrap();
        assert!(text.contains("# preserved"));
        let doc: toml::Value = toml::from_str(&text).unwrap();
        assert_eq!(
            doc["mcp_servers"]["work"]["tool_timeout_sec"].as_integer(),
            Some(30)
        );
        assert_eq!(
            doc["mcp_servers"]["other"]["command"].as_str(),
            Some("other")
        );
    }
}
