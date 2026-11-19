use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::utils::{parse_timestamp_to_ms, truncate_summary, TITLE_MAX_CHARS};
use crate::session_manager::{SessionMessage, SessionMeta};

pub(crate) fn projects_dir() -> PathBuf {
    crate::workbuddy_config::data_dir().join("projects")
}

pub fn scan_sessions() -> Vec<SessionMeta> {
    session_files(&projects_dir())
        .into_iter()
        .filter_map(|path| parse_session(&path))
        .collect()
}

pub(crate) fn session_files(projects: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let Ok(projects) = fs::read_dir(projects) else {
        return files;
    };
    for project in projects.flatten() {
        let Ok(entries) = fs::read_dir(project.path()) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
                files.push(path);
            }
        }
    }
    files
}

pub(crate) fn usage_files(projects: &Path) -> Vec<(PathBuf, Option<String>)> {
    let mut files = session_files(projects)
        .into_iter()
        .map(|path| (path, None))
        .collect::<Vec<_>>();
    let Ok(projects) = fs::read_dir(projects) else {
        return files;
    };
    for project in projects.flatten() {
        let Ok(sessions) = fs::read_dir(project.path()) else {
            continue;
        };
        for session in sessions.flatten() {
            let session_dir = session.path();
            let Some(parent_id) = session_dir
                .file_name()
                .and_then(|name| name.to_str())
                .map(str::to_string)
            else {
                continue;
            };
            let Ok(entries) = fs::read_dir(session_dir.join("subagents")) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() && path.extension().and_then(|ext| ext.to_str()) == Some("jsonl")
                {
                    files.push((path, Some(parent_id.clone())));
                }
            }
        }
    }
    files
}

fn for_each_jsonl_value(path: &Path, mut callback: impl FnMut(Value)) -> Result<(), String> {
    let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            callback(value);
        }
    }
    Ok(())
}

fn kind(record: &Value) -> &str {
    record.get("type").and_then(Value::as_str).unwrap_or("")
}
fn role(record: &Value) -> &str {
    record.get("role").and_then(Value::as_str).unwrap_or("")
}

fn content_text(record: &Value, field: &str) -> String {
    match record.get(field) {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.as_str())
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Some(value) => value.as_str().unwrap_or_default().to_string(),
        None => String::new(),
    }
}

fn user_query(text: &str) -> String {
    if let Some(start) = text.rfind("<user_query>") {
        let rest = &text[start + "<user_query>".len()..];
        return rest
            .split("</user_query>")
            .next()
            .unwrap_or(rest)
            .trim()
            .to_string();
    }
    text.trim().to_string()
}

fn parse_session(path: &Path) -> Option<SessionMeta> {
    let mut session_id = None;
    let mut project_dir = None;
    let mut prompt = None;
    let mut title = None;
    let mut created_at = None;
    let mut last_active_at = None;
    for_each_jsonl_value(path, |record| {
        session_id = session_id.clone().or_else(|| {
            record
                .get("sessionId")
                .and_then(Value::as_str)
                .map(str::to_string)
        });
        project_dir = project_dir.clone().or_else(|| {
            record
                .get("cwd")
                .and_then(Value::as_str)
                .filter(|cwd| !cwd.is_empty())
                .map(str::to_string)
        });
        if let Some(ts) = record.get("timestamp").and_then(parse_timestamp_to_ms) {
            created_at = Some(created_at.map_or(ts, |current: i64| current.min(ts)));
            last_active_at = Some(last_active_at.map_or(ts, |current: i64| current.max(ts)));
        }
        if prompt.is_none() && kind(&record) == "message" && role(&record) == "user" {
            let value = user_query(&content_text(&record, "content"));
            if !value.is_empty() {
                prompt = Some(value);
            }
        }
        if kind(&record) == "ai-title" {
            title = record
                .get("aiTitle")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
        }
    })
    .ok()?;
    let prompt = prompt?;
    let session_id = session_id.or_else(|| {
        path.file_stem()
            .and_then(|stem| stem.to_str())
            .map(str::to_string)
    })?;
    let title = title.unwrap_or_else(|| prompt.lines().next().unwrap_or_default().to_string());
    Some(SessionMeta {
        provider_id: "workbuddy".into(),
        session_id,
        title: Some(truncate_summary(&title, TITLE_MAX_CHARS)),
        summary: Some(truncate_summary(&prompt, 200)),
        project_dir,
        created_at,
        last_active_at,
        source_path: Some(path.to_string_lossy().into_owned()),
        resume_command: None,
    })
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Usage {
    pub model: Option<String>,
    pub fresh_input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub reasoning: u64,
}

impl Usage {
    pub(crate) fn is_empty(&self) -> bool {
        self.fresh_input == 0 && self.output == 0 && self.cache_read == 0 && self.cache_write == 0
    }
}

fn count(value: Option<&Value>, key: &str) -> u64 {
    value
        .and_then(|value| value.get(key))
        .and_then(Value::as_u64)
        .unwrap_or(0)
}

fn strip_custom_prefix(model: &str) -> &str {
    match model.split_once(':') {
        Some((prefix, id)) if prefix.starts_with("custom-") && !id.trim().is_empty() => id.trim(),
        _ => model,
    }
}

pub(crate) fn assistant_usage(record: &Value) -> Option<Usage> {
    if role(record) == "user" {
        return None;
    }
    let data = record.get("providerData");
    let model = data
        .and_then(|data| data.get("model").or_else(|| data.get("requestModelId")))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .map(strip_custom_prefix)
        .map(str::to_string);
    if let Some(raw) = data
        .and_then(|data| data.get("rawUsage"))
        .filter(|raw| raw.is_object())
    {
        let details = raw.get("prompt_tokens_details");
        let cache_read = [
            count(Some(raw), "prompt_cache_hit_tokens"),
            count(Some(raw), "cache_read_input_tokens"),
            count(Some(raw), "cached_tokens"),
            count(details, "cached_tokens"),
        ]
        .into_iter()
        .max()
        .unwrap_or(0);
        let cache_write = count(Some(raw), "cache_creation_input_tokens")
            .max(count(Some(raw), "prompt_cache_write_tokens"));
        let reasoning = count(Some(raw), "completion_thinking_tokens").max(count(
            raw.get("completion_tokens_details"),
            "reasoning_tokens",
        ));
        return Some(Usage {
            model,
            fresh_input: count(Some(raw), "prompt_tokens")
                .saturating_sub(cache_read)
                .saturating_sub(cache_write),
            output: count(Some(raw), "completion_tokens"),
            cache_read,
            cache_write,
            reasoning,
        });
    }
    if kind(record) != "message" || role(record) != "assistant" {
        return None;
    }
    let usage = data.and_then(|data| data.get("usage"))?;
    let cache_read = usage
        .get("inputTokensDetails")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|detail| count(Some(detail), "cached_tokens"))
        .sum();
    let reasoning = usage
        .get("outputTokensDetails")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|detail| count(Some(detail), "reasoning_tokens"))
        .sum();
    Some(Usage {
        model,
        fresh_input: count(Some(usage), "inputTokens").saturating_sub(cache_read),
        output: count(Some(usage), "outputTokens"),
        cache_read,
        cache_write: 0,
        reasoning,
    })
}

pub fn load_messages(path: &Path) -> Result<Vec<SessionMessage>, String> {
    let root = projects_dir()
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let path = path.canonicalize().map_err(|error| error.to_string())?;
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "Invalid WorkBuddy session location")?;
    if relative.components().count() != 2
        || path.extension().and_then(|ext| ext.to_str()) != Some("jsonl")
    {
        return Err("Invalid WorkBuddy session file".into());
    }
    let mut messages = Vec::new();
    for_each_jsonl_value(&path, |record| {
        let ts = record.get("timestamp").and_then(parse_timestamp_to_ms);
        let (message_role, content) = match kind(&record) {
            "message" if role(&record) == "user" => {
                ("user", user_query(&content_text(&record, "content")))
            }
            "message" if role(&record) == "assistant" => {
                ("assistant", content_text(&record, "content"))
            }
            "reasoning" => ("assistant", content_text(&record, "rawContent")),
            "function_call" => {
                let name = record.get("name").and_then(Value::as_str).unwrap_or("tool");
                (
                    "assistant",
                    format!(
                        "[Tool: {name}]\n{}",
                        record
                            .get("arguments")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                    ),
                )
            }
            "function_call_result" => {
                let content = match record.get("output") {
                    Some(Value::String(text)) => text.clone(),
                    Some(Value::Object(output)) => output
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| Value::Object(output.clone()).to_string()),
                    Some(value) => value.to_string(),
                    None => String::new(),
                };
                ("tool", content)
            }
            _ => return,
        };
        if content.trim().is_empty() {
            return;
        }
        messages.push(SessionMessage {
            role: message_role.to_string(),
            content,
            ts,
        });
    })?;
    Ok(messages)
}
