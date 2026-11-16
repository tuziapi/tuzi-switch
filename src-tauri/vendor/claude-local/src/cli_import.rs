//! 把命令行（终端、BaoCode 等）建的 Claude Code 会话登记进 Desktop 的会话列表。
//!
//! Desktop 左侧只列它自己有记录的会话（`claude-code-sessions/<账号>/<组织>/local_*.json`），
//! 命令行会话的对话记录虽然也在 `~/.claude/projects`，列表里却没有。这里在启动 Claude 前补登：
//! 记录格式照 Desktop 自己「导入 CLI 会话」写的那份（`local_<cliSessionId>`、`fromCliTranscript`）。
//!
//! 不登记的：Desktop 已经知道的（任一记录里出现过这个会话 id）、Desktop 里删掉过的、
//! 没有真正对话的空壳。只在 Claude 没运行时调用（Desktop 运行时会自己改写会话记录）。

use std::collections::HashSet;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use anyhow::Result;
use serde_json::{Value, json};

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ImportReport {
    pub imported: usize,
    pub skipped_empty: usize,
}

/// `code_dir` 是 Code 页签实际用的配置目录（共用时就是 `~/.claude`），`sessions_dir` 是完整功能模式
/// 读会话列表的目录（`<profile>/claude-code-sessions/<账号>/<组织>`）。
pub fn import_cli_sessions(code_dir: &Path, sessions_dir: &Path) -> Result<ImportReport> {
    let mut report = ImportReport::default();
    let projects = code_dir.join("projects");
    if !projects.is_dir() {
        return Ok(report);
    }
    let known = known_session_ids(sessions_dir);
    let mut pending = Vec::new();
    for project in fs::read_dir(&projects)?.flatten() {
        if !project.file_type().is_ok_and(|kind| kind.is_dir()) {
            continue;
        }
        let names: Vec<String> = fs::read_dir(project.path())?
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        for name in &names {
            let Some(id) = name.strip_suffix(".jsonl") else { continue };
            if !is_uuid(id) || known.contains(id) || deleted_in_desktop(id, &names) {
                continue;
            }
            pending.push((id.to_string(), project.path().join(name)));
        }
    }
    if pending.is_empty() {
        return Ok(report);
    }
    fs::create_dir_all(sessions_dir)?;
    for (id, path) in pending {
        let Some(summary) = summarize(&path)? else {
            report.skipped_empty += 1;
            continue;
        };
        let record = record_for(&id, &summary, now_ms());
        crate::fsutil::atomic_write(
            &sessions_dir.join(format!("local_{id}.json")),
            &serde_json::to_vec_pretty(&record)?,
        )?;
        report.imported += 1;
    }
    Ok(report)
}

/// Desktop 已有记录里出现过的所有会话 id（包括续接、分叉留下的旧 id），避免重复登记。
fn known_session_ids(sessions_dir: &Path) -> HashSet<String> {
    let mut known = HashSet::new();
    let Ok(entries) = fs::read_dir(sessions_dir) else {
        return known;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("local_") {
            continue;
        }
        if let Ok(text) = fs::read_to_string(entry.path()) {
            known.extend(uuids_in(&text));
        }
    }
    known
}

/// Desktop 删除会话时会把记录改名为 `<id>.jsonl.desktop-deleted-*`，或者留一个 `<id>.desktop-released.json`。
fn deleted_in_desktop(id: &str, names: &[String]) -> bool {
    names.iter().any(|name| {
        name == &format!("{id}.desktop-released.json")
            || name.starts_with(&format!("{id}.jsonl.desktop-deleted-"))
    })
}

#[derive(Debug, Default, PartialEq)]
struct Summary {
    cwd: String,
    title: String,
    model: Option<String>,
    permission_mode: Option<String>,
    created_ms: Option<i64>,
    modified_ms: i64,
}

/// 读一遍对话记录：取工作目录、标题（手动改过的名字 > 自动标题 > 第一句话）、模型、权限模式、起止时间。
/// 没有真正的一问一答就返回 `None`。只对含相关字段的行解析 JSON，大文件也不慢。
fn summarize(path: &Path) -> Result<Option<Summary>> {
    let modified_ms = fs::metadata(path)?
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_else(now_ms);
    let mut summary = Summary { modified_ms, ..Summary::default() };
    let (mut custom_title, mut ai_title, mut first_prompt, mut fallback_prompt) = (None, None, None, None);
    let mut has_assistant = false;
    for line in BufReader::new(fs::File::open(path)?).lines() {
        let Ok(line) = line else { break };
        let kind = if line.contains("\"type\":\"user\"") {
            "user"
        } else if line.contains("\"type\":\"assistant\"") {
            "assistant"
        } else if line.contains("\"type\":\"custom-title\"") {
            "custom-title"
        } else if line.contains("\"type\":\"ai-title\"") {
            "ai-title"
        } else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
        match kind {
            "user" => {
                if value["isSidechain"].as_bool() == Some(true) || value["isMeta"].as_bool() == Some(true) {
                    continue;
                }
                if summary.cwd.is_empty()
                    && let Some(cwd) = value["cwd"].as_str()
                {
                    summary.cwd = cwd.to_string();
                }
                if summary.created_ms.is_none() {
                    summary.created_ms = value["timestamp"].as_str().and_then(parse_timestamp_ms);
                }
                if let Some(mode) = value["permissionMode"].as_str() {
                    summary.permission_mode = Some(mode.to_string());
                }
                if first_prompt.is_none() {
                    first_prompt = prompt_text(&value["message"]["content"]);
                }
                if first_prompt.is_none() && fallback_prompt.is_none() {
                    fallback_prompt = placeholder_text(&value["message"]["content"]);
                }
            }
            "assistant" => {
                has_assistant = true;
                if let Some(model) = value["message"]["model"].as_str().filter(|model| !model.starts_with('<')) {
                    summary.model = Some(model.to_string());
                }
            }
            "custom-title" => custom_title = value["customTitle"].as_str().map(str::to_string),
            "ai-title" => ai_title = value["aiTitle"].as_str().map(str::to_string),
            _ => {}
        }
    }
    let first_prompt = first_prompt.or(fallback_prompt);
    if !has_assistant || summary.cwd.is_empty() || first_prompt.is_none() {
        return Ok(None);
    }
    summary.title = [custom_title, ai_title, first_prompt]
        .into_iter()
        .flatten()
        .map(|title| title.trim().to_string())
        .find(|title| !title.is_empty())
        .unwrap_or_else(|| "命令行会话".into());
    Ok(Some(summary))
}

fn content_text(content: &Value) -> Option<String> {
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(parts) => Some(
            parts
                .iter()
                .filter(|part| part["type"] == "text")
                .filter_map(|part| part["text"].as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        ),
        _ => None,
    }
}

/// 这一行只是占位：`[Image #1]`、`[Request interrupted by user]` 这类方括号整行，或 `<command-name>` 之类的包装。
fn is_placeholder(line: &str) -> bool {
    line.starts_with('<') || (line.starts_with('[') && line.ends_with(']'))
}

/// 用户这一轮说的话：第一行不是占位的正文，行首的 `[Image #1]` 之类去掉（截 80 字）。
fn prompt_text(content: &Value) -> Option<String> {
    let text = content_text(content)?;
    let line = text
        .lines()
        .map(|line| strip_leading_placeholders(line.trim()))
        .find(|line| !line.is_empty() && !is_placeholder(line))?;
    Some(line.chars().take(80).collect())
}

/// 去掉行首连着的 `[…]` 占位（`[Image #1] [Image #2] 看看这个` → `看看这个`）。
fn strip_leading_placeholders(mut line: &str) -> &str {
    while let Some(rest) = line.strip_prefix('[') {
        let Some(end) = rest.find(']') else { break };
        line = rest[end + 1..].trim_start();
    }
    line
}

/// 整段都是占位时（只贴了一张图）退而用占位本身作标题，但包装标签（`<…>`）不算。
fn placeholder_text(content: &Value) -> Option<String> {
    let text = content_text(content)?;
    let line = text.lines().map(str::trim).find(|line| !line.is_empty())?;
    (!line.starts_with('<')).then(|| line.chars().take(80).collect())
}

/// 与 Desktop 自己导入命令行会话时写的记录同形（其余字段 Desktop 加载时会补默认值）。
fn record_for(id: &str, summary: &Summary, now: i64) -> Value {
    let mut record = json!({
        "sessionId": format!("local_{id}"),
        "cliSessionId": id,
        "cwd": summary.cwd,
        "originCwd": summary.cwd,
        "createdAt": summary.created_ms.unwrap_or(summary.modified_ms),
        "lastActivityAt": summary.modified_ms,
        "indexedAt": now,
        "isArchived": false,
        "title": summary.title,
        "titleSource": "auto",
        "permissionMode": summary.permission_mode.as_deref().unwrap_or("default"),
        "adoptedFromOtherSurface": true,
        "fromCliTranscript": true,
        "sessionPermissionUpdates": [],
        "alwaysAllowedReasons": [],
    });
    if let Some(model) = &summary.model {
        record["model"] = json!(model);
    }
    record
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

/// `2026-11-09T12:34:56.789Z` → 毫秒时间戳（只认 UTC 的 `Z` 结尾，记录里都是这种）。
fn parse_timestamp_ms(text: &str) -> Option<i64> {
    let text = text.strip_suffix('Z')?;
    let (date, time) = text.split_once('T')?;
    let mut date_parts = date.split('-').map(|part| part.parse::<i32>().ok());
    let (year, month, day) = (date_parts.next()??, date_parts.next()??, date_parts.next()??);
    let (clock, fraction) = time.split_once('.').unwrap_or((time, "0"));
    let mut clock_parts = clock.split(':').map(|part| part.parse::<u8>().ok());
    let (hour, minute, second) = (clock_parts.next()??, clock_parts.next()??, clock_parts.next()??);
    let millis: i64 = format!("{:0<3}", &fraction[..fraction.len().min(3)]).parse().ok()?;
    let date = time::Date::from_calendar_date(year, time::Month::try_from(month as u8).ok()?, day as u8).ok()?;
    let clock = time::Time::from_hms(hour, minute, second).ok()?;
    let seconds = time::PrimitiveDateTime::new(date, clock).assume_utc().unix_timestamp();
    Some(seconds * 1000 + millis)
}

fn is_uuid(text: &str) -> bool {
    text.len() == 36
        && text.char_indices().all(|(index, ch)| {
            if [8, 13, 18, 23].contains(&index) { ch == '-' } else { ch.is_ascii_hexdigit() }
        })
}

fn uuids_in(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    let mut index = 0;
    while index + 36 <= bytes.len() {
        if let Some(candidate) = text.get(index..index + 36)
            && is_uuid(candidate)
        {
            found.push(candidate.to_ascii_lowercase());
            index += 36;
        } else {
            index += 1;
        }
    }
    found
}

/// 完整功能模式读会话列表的目录（主 profile 的 `claude-code-sessions/<mock 账号>/<mock 组织>`）。
pub fn full_mode_sessions_dir(profile_data_dir: &Path) -> PathBuf {
    profile_data_dir
        .join("claude-code-sessions")
        .join(crate::session_sync::FULL_ACCOUNT)
        .join(crate::session_sync::FULL_ORG)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLI: &str = "11111111-2222-4333-8444-555555555555";
    const KNOWN: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const EMPTY: &str = "99999999-2222-4333-8444-555555555555";
    const DELETED: &str = "77777777-2222-4333-8444-555555555555";

    fn transcript(title_line: &str) -> String {
        [
            r#"{"type":"last-prompt","lastPrompt":"x"}"#,
            r#"{"type":"user","isMeta":true,"cwd":"/meta","message":{"role":"user","content":"<local-command-caveat>…</local-command-caveat>"}}"#,
            r#"{"type":"user","cwd":"/work/app","permissionMode":"acceptEdits","timestamp":"2026-11-09T12:34:56.789Z","message":{"role":"user","content":[{"type":"text","text":"帮我修一下登录页\n顺便看看样式"}]}}"#,
            r#"{"type":"assistant","message":{"model":"claude-opus-5-5","content":[]}}"#,
            title_line,
        ]
        .join("\n")
    }

    #[test]
    fn imports_only_cli_sessions_desktop_does_not_know() {
        let temp = tempfile::tempdir().unwrap();
        let code = temp.path().join(".claude");
        let project = code.join("projects/-work-app");
        fs::create_dir_all(&project).unwrap();
        fs::write(project.join(format!("{CLI}.jsonl")), transcript(r#"{"type":"ai-title","aiTitle":"登录页修复"}"#)).unwrap();
        fs::write(project.join(format!("{KNOWN}.jsonl")), transcript("")).unwrap();
        fs::write(project.join(format!("{EMPTY}.jsonl")), r#"{"type":"custom-title","customTitle":"hi"}"#).unwrap();
        fs::write(project.join(format!("{DELETED}.jsonl")), transcript("")).unwrap();
        fs::write(project.join(format!("{DELETED}.desktop-released.json")), r#"{"reason":"delete"}"#).unwrap();
        let sessions = temp.path().join("sessions");
        fs::create_dir_all(&sessions).unwrap();
        // Desktop 已有的记录里出现过 KNOWN（比如作为续接前的旧 id）。
        fs::write(sessions.join("local_x.json"), format!(r#"{{"cliSessionId":"other","previous":["{KNOWN}"]}}"#)).unwrap();

        let report = import_cli_sessions(&code, &sessions).unwrap();
        assert_eq!(report, ImportReport { imported: 1, skipped_empty: 1 });
        let record: Value =
            serde_json::from_slice(&fs::read(sessions.join(format!("local_{CLI}.json"))).unwrap()).unwrap();
        assert_eq!(record["sessionId"], format!("local_{CLI}"));
        assert_eq!(record["cliSessionId"], CLI);
        assert_eq!(record["cwd"], "/work/app", "跳过 isMeta 行，取真实工作目录");
        assert_eq!(record["title"], "登录页修复");
        assert_eq!(record["model"], "claude-opus-5-5");
        assert_eq!(record["permissionMode"], "acceptEdits");
        assert_eq!(record["createdAt"], 1_794_227_696_789_i64);
        assert_eq!(record["fromCliTranscript"], true);
        assert!(!sessions.join(format!("local_{KNOWN}.json")).exists());
        assert!(!sessions.join(format!("local_{DELETED}.json")).exists(), "Desktop 里删过的不再登记");

        // 再跑一次：已经登记过的不重复。
        assert_eq!(import_cli_sessions(&code, &sessions).unwrap(), ImportReport { imported: 0, skipped_empty: 1 });
    }

    #[test]
    fn title_prefers_custom_then_ai_then_first_prompt() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("t.jsonl");
        fs::write(&path, transcript(r#"{"type":"custom-title","customTitle":"我改的名字"}"#)).unwrap();
        assert_eq!(summarize(&path).unwrap().unwrap().title, "我改的名字");
        fs::write(&path, transcript("")).unwrap();
        assert_eq!(summarize(&path).unwrap().unwrap().title, "帮我修一下登录页");
        // 开头是占位（贴图、打断）就往下找正文；只有占位时才用占位本身。
        assert_eq!(prompt_text(&json!("[Image #1] \n看看这个按钮为什么歪了")).as_deref(), Some("看看这个按钮为什么歪了"));
        assert_eq!(prompt_text(&json!("[Image #1]")), None);
        assert_eq!(prompt_text(&json!("[Image #1] [Image #2] 这几个发到哪")).as_deref(), Some("这几个发到哪"));
        assert_eq!(placeholder_text(&json!("[Image #1]")).as_deref(), Some("[Image #1]"));
        assert_eq!(placeholder_text(&json!("<command-name>/model</command-name>")), None);
    }

    #[test]
    fn timestamps_and_ids_parse_strictly() {
        assert_eq!(parse_timestamp_ms("1970-01-01T00:00:01.5Z"), Some(1500));
        assert_eq!(parse_timestamp_ms("2026-11-09T12:34:56Z"), Some(1_794_227_696_000));
        assert_eq!(parse_timestamp_ms("not a time"), None);
        assert!(is_uuid(CLI));
        assert!(!is_uuid("agent-1234"));
        assert_eq!(uuids_in(&format!("x{CLI}y{KNOWN}")), vec![CLI.to_string(), KNOWN.to_string()]);
    }
}
