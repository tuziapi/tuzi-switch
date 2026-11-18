use crate::database::{lock_conn, Database};
use crate::error::AppError;
use crate::proxy::usage::{
    calculator::{CostCalculator, ModelPricing},
    parser::TokenUsage,
};
use crate::services::{
    session_usage::{get_sync_state, update_sync_state, SessionSyncResult},
    sql_helpers::INPUT_TOKEN_SEMANTICS_FRESH,
    usage_stats::find_model_pricing_row,
};
use crate::session_manager::providers::workbuddy;
use rust_decimal::Decimal;
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;
use std::time::UNIX_EPOCH;

const DATA_SOURCE: &str = "workbuddy_session";

pub fn sync_workbuddy_usage(db: &Database) -> Result<SessionSyncResult, AppError> {
    sync_projects(db, &workbuddy::projects_dir())
}

fn sync_projects(db: &Database, projects: &Path) -> Result<SessionSyncResult, AppError> {
    let files = workbuddy::usage_files(projects);
    let mut result = SessionSyncResult {
        files_scanned: files.len() as u32,
        ..Default::default()
    };
    for (path, parent_session) in files {
        let metadata = match fs::metadata(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .and_then(|duration| i64::try_from(duration.as_nanos()).ok())
            .unwrap_or(0);
        let key = path.to_string_lossy().to_string();
        let (last_modified, last_offset) = get_sync_state(db, &key)?;
        let length = metadata.len() as i64;
        if length == last_offset && modified == last_modified {
            continue;
        }
        let offset = if (0..length).contains(&last_offset) {
            last_offset
        } else {
            0
        };
        let (imported, skipped, new_offset) =
            sync_file(db, &path, parent_session.as_deref(), offset)?;
        result.imported += imported;
        result.skipped += skipped;
        update_sync_state(db, &key, modified, new_offset)?;
    }
    Ok(result)
}

fn sync_file(
    db: &Database,
    path: &Path,
    parent_session: Option<&str>,
    offset: i64,
) -> Result<(u32, u32, i64), AppError> {
    let mut file = fs::File::open(path).map_err(|error| AppError::io(path, error))?;
    file.seek(SeekFrom::Start(offset as u64))
        .map_err(|error| AppError::io(path, error))?;
    let mut reader = BufReader::new(file);
    let mut bytes = offset;
    let mut imported = 0;
    let mut skipped = 0;
    let mut line = Vec::new();
    loop {
        line.clear();
        let size = reader
            .read_until(b'\n', &mut line)
            .map_err(|error| AppError::io(path, error))?;
        if size == 0 || line.last() != Some(&b'\n') {
            break;
        }
        bytes += size as i64;
        let Ok(record) = serde_json::from_slice::<Value>(&line) else {
            continue;
        };
        let Some(usage) = workbuddy::assistant_usage(&record) else {
            continue;
        };
        if usage.is_empty() {
            continue;
        }
        let Some(event_id) = record.get("id").and_then(Value::as_str) else {
            continue;
        };
        let session_id = parent_session
            .or_else(|| record.get("sessionId").and_then(Value::as_str))
            .unwrap_or("unknown");
        let request_id = format!("workbuddy:{session_id}:{event_id}");
        let model = usage.model.clone().unwrap_or_else(|| "unknown".into());
        let Some(created_ms) = record.get("timestamp").and_then(Value::as_i64) else {
            continue;
        };
        let created_at = created_ms / 1000;
        let usage_row = TokenUsage {
            input_tokens: usage.fresh_input.min(u32::MAX as u64) as u32,
            output_tokens: usage.output.min(u32::MAX as u64) as u32,
            cache_read_tokens: usage.cache_read.min(u32::MAX as u64) as u32,
            cache_creation_tokens: usage.cache_write.min(u32::MAX as u64) as u32,
            model: Some(model.clone()),
            message_id: None,
        };
        let mut conn = lock_conn!(db.conn);
        let tx = conn.transaction()?;
        let pricing =
            find_model_pricing_row(&tx, &model)?.and_then(|(input, output, read, write)| {
                ModelPricing::from_strings(&input, &output, &read, &write).ok()
            });
        let costs = pricing.as_ref().map(|price| {
            CostCalculator::calculate_with_input_semantics(
                &usage_row,
                price,
                Decimal::ONE,
                INPUT_TOKEN_SEMANTICS_FRESH,
            )
        });
        let zero = || "0".to_string();
        let (input_cost, output_cost, read_cost, write_cost, total_cost) = costs
            .map(|cost| {
                (
                    cost.input_cost.to_string(),
                    cost.output_cost.to_string(),
                    cost.cache_read_cost.to_string(),
                    cost.cache_creation_cost.to_string(),
                    cost.total_cost.to_string(),
                )
            })
            .unwrap_or_else(|| (zero(), zero(), zero(), zero(), zero()));
        let inserted = tx.execute("INSERT INTO proxy_request_logs (request_id, provider_id, app_type, model, request_model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, input_cost_usd, output_cost_usd, cache_read_cost_usd, cache_creation_cost_usd, total_cost_usd, latency_ms, first_token_ms, status_code, error_message, session_id, provider_type, is_streaming, cost_multiplier, created_at, data_source, input_token_semantics) VALUES (?1, '_workbuddy_session', 'workbuddy', ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, NULL, 200, NULL, ?12, 'workbuddy', 1, '1', ?13, ?14, ?15) ON CONFLICT(request_id) DO NOTHING", rusqlite::params![request_id, model, usage_row.input_tokens, usage_row.output_tokens, usage_row.cache_read_tokens, usage_row.cache_creation_tokens, input_cost, output_cost, read_cost, write_cost, total_cost, session_id, created_at, DATA_SOURCE, INPUT_TOKEN_SEMANTICS_FRESH])?;
        tx.commit()?;
        if inserted == 1 {
            imported += 1;
        } else {
            skipped += 1;
        }
    }
    Ok((imported, skipped, bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn workbuddy_imports_complete_events_once_and_attributes_subagent_usage() -> Result<(), AppError>
    {
        let directory = tempfile::tempdir().unwrap();
        let project = directory.path().join("project");
        let agents = project.join("parent/subagents");
        fs::create_dir_all(&agents).unwrap();
        let db = Database::memory().unwrap();
        let assistant = serde_json::json!({"id":"a", "sessionId":"parent", "timestamp":1700000001000_i64, "type":"message", "role":"assistant", "providerData":{"rawUsage":null,"usage":{"inputTokens":10,"outputTokens":2,"inputTokensDetails":[{"cached_tokens":3}]}}});
        let mut undated = assistant.clone();
        undated.as_object_mut().unwrap().remove("timestamp");
        undated["id"] = "undated".into();
        fs::write(
            project.join("parent.jsonl"),
            format!("{undated}\n{assistant}\n{assistant}\n"),
        )
        .unwrap();
        let child = serde_json::json!({"id":"tool", "sessionId":"child", "timestamp":1700000002000_i64, "type":"function_call", "providerData":{"rawUsage":{"prompt_tokens":20,"completion_tokens":4,"prompt_cache_hit_tokens":5,"cache_creation_input_tokens":2}}});
        let path = agents.join("child.jsonl");
        fs::write(&path, child.to_string()).unwrap();
        assert_eq!(sync_projects(&db, directory.path()).unwrap().imported, 1);
        fs::OpenOptions::new()
            .append(true)
            .open(path)
            .unwrap()
            .write_all(b"\n")
            .unwrap();
        assert_eq!(sync_projects(&db, directory.path()).unwrap().imported, 1);
        assert_eq!(sync_projects(&db, directory.path()).unwrap().imported, 0);
        let conn = lock_conn!(db.conn);
        let totals: (i64, i64, i64, i64, i64) = conn.query_row("SELECT count(*), sum(input_tokens), sum(output_tokens), sum(cache_read_tokens), sum(cache_creation_tokens) FROM proxy_request_logs WHERE session_id='parent'", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?))).unwrap();
        assert_eq!(totals, (2, 20, 6, 8, 2));
        Ok(())
    }
}
