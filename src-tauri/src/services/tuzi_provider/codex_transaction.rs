//! Compensating transaction for ordinary Codex saves and normal activation.
//! Account saves already own a journal and therefore reuse their outer transaction.
use super::*;

// Scoped restoration deliberately excludes usage, history and other applications.
const CODEX_TABLES: &[&str] = &[
    "providers",
    "provider_endpoints",
    "tuzi_provider_sources",
    "proxy_live_backup",
];

fn rows(conn: &Connection, table: &str) -> Result<Vec<Vec<rusqlite::types::Value>>, AppError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT * FROM {table} WHERE app_type='codex' ORDER BY rowid"
    ))?;
    let count = stmt.column_count();
    let result = stmt
        .query_map([], |row| {
            (0..count)
                .map(|i| row.get(i))
                .collect::<Result<Vec<_>, _>>()
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(result)
}

// Switching is frequent: do not copy the potentially large usage/history database.
// The retained recovery database contains only the Codex rows this operation owns.
fn snapshot_codex(db: &Database) -> Result<Connection, AppError> {
    let source = crate::database::lock_conn!(db.conn);
    let snapshot = Connection::open_in_memory()?;
    for table in CODEX_TABLES.iter().copied().chain(["settings"]) {
        let schema: String = source.query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |r| r.get(0),
        )?;
        snapshot.execute_batch(&schema)?;
        // settings.json is journaled separately. No global database settings are
        // mutated by ordinary Codex operations; retain an empty schema for Plan.
        if table == "settings" {
            continue;
        }
        for row in rows(&source, table)? {
            snapshot.execute(
                &format!(
                    "INSERT INTO {table} VALUES ({})",
                    vec!["?"; row.len()].join(",")
                ),
                rusqlite::params_from_iter(row),
            )?;
        }
    }
    Ok(snapshot)
}

fn rollback_database(
    state: &AppState,
    before: &Connection,
    after: &Connection,
    restore: impl FnOnce() -> Result<(), AppError>,
) -> Result<(), AppError> {
    let mut conn = crate::database::lock_conn!(state.db.conn);
    let tx = conn.transaction()?;
    for table in CODEX_TABLES {
        if rows(&tx, table)? != rows(after, table)? {
            return Err(AppError::Config(
                "Codex 数据被并发修改，未覆盖并发修改".into(),
            ));
        }
    }
    // Update existing providers in place: deleting/reinserting them would cascade
    // into health rows, which do not belong to this operation.
    let old_providers = rows(before, "providers")?;
    let new_providers = rows(after, "providers")?;
    for row in &new_providers {
        if !old_providers.iter().any(|old| old[0] == row[0]) {
            tx.execute(
                "DELETE FROM providers WHERE id=?1 AND app_type='codex'",
                [&row[0]],
            )?;
        }
    }
    let columns = {
        let mut stmt = tx.prepare("PRAGMA table_info(providers)")?;
        let result = stmt
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<Result<Vec<_>, _>>()?;
        result
    };
    let update = columns
        .iter()
        .filter(|c| *c != "id" && *c != "app_type")
        .map(|c| format!("{c}=excluded.{c}"))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "INSERT INTO providers ({}) VALUES ({}) ON CONFLICT(id,app_type) DO UPDATE SET {update}",
        columns.join(","),
        vec!["?"; columns.len()].join(",")
    );
    for row in old_providers {
        if !new_providers.contains(&row) {
            tx.execute(&sql, rusqlite::params_from_iter(row))?;
        }
    }
    for table in &CODEX_TABLES[1..] {
        let old = rows(before, table)?;
        if old == rows(after, table)? {
            continue;
        }
        tx.execute(&format!("DELETE FROM {table} WHERE app_type='codex'"), [])?;
        for row in old {
            let sql = format!(
                "INSERT INTO {table} VALUES ({})",
                vec!["?"; row.len()].join(",")
            );
            tx.execute(&sql, rusqlite::params_from_iter(row))?;
        }
    }
    restore()?;
    tx.commit()?;
    Ok(())
}

thread_local! {
    // Values remain native-only; never include these records in an error or log.
    static BACKUP_DIR: std::cell::RefCell<Option<PathBuf>> = const { std::cell::RefCell::new(None) };
    static ENVIRONMENT: std::cell::RefCell<Option<HashMap<String, (Environment, String)>>> = const { std::cell::RefCell::new(None) };
}
struct EnvironmentGuard;
impl Drop for EnvironmentGuard {
    fn drop(&mut self) {
        ENVIRONMENT.with(|e| *e.borrow_mut() = None);
        BACKUP_DIR.with(|d| *d.borrow_mut() = None);
    }
}

pub(crate) fn before_environment_write(key: &str, value: &str) -> Result<(), AppError> {
    ENVIRONMENT.with(|e| {
        let mut e = e.borrow_mut();
        if let Some(records) = e.as_mut() {
            if !records.contains_key(key) {
                let before = capture_environment(key)?;
                BACKUP_DIR.with(|d| -> Result<(), AppError> {
                    if let Some(dir) = d.borrow().as_ref() {
                        private_write(
                            &dir.join(format!("environment-{}.json", hash(key.as_bytes()))),
                            &serde_json::to_vec(&before)
                                .map_err(|_| AppError::Config("环境备份编码失败".into()))?,
                        )?;
                    }
                    Ok(())
                })?;
                records.insert(key.into(), (before, value.into()));
            } else if let Some(record) = records.get_mut(key) {
                record.1 = value.into();
            }
        }
        Ok(())
    })
}

fn environment_records() -> Result<Vec<Option<EnvironmentRecord>>, AppError> {
    ENVIRONMENT.with(|e| {
        e.borrow()
            .as_ref()
            .into_iter()
            .flat_map(|m| m.values())
            .map(|(before, attempted)| {
                let now = capture_environment(&before.key)?;
                // setx may fail between registry and process updates. Either component
                // can still be the old value; a third-party value must never be erased.
                if (now.registry != before.registry && now.registry.as_deref() != Some(attempted))
                    || (now.process != before.process && now.process.as_deref() != Some(attempted))
                {
                    return Err(AppError::Config("Codex 环境项被并发修改，恢复中止".into()));
                }
                Ok(Some(EnvironmentRecord {
                    before: before.clone(),
                    expected: environment_signature(&now),
                }))
            })
            .collect()
    })
}

pub(crate) fn run<T>(
    state: &AppState,
    provider: &Provider,
    action: impl FnOnce() -> Result<T, AppError>,
) -> Result<T, AppError> {
    if account_backup_active() {
        return action();
    }
    // Caller holds OperationGuard throughout snapshot, writes and compensation.
    let plan = Plan {
        environment: None,
        app: AppType::Codex,
        provider_hash: vec![],
        files: write_set(&AppType::Codex, provider)?
            .into_iter()
            .map(capture)
            .collect::<Result<_, _>>()?,
        database: snapshot_codex(&state.db)?,
        created: chrono::Utc::now().timestamp(),
    };
    let id = uuid::Uuid::new_v4().to_string();
    let dir = crate::config::get_app_config_dir()
        .join("codex-operation-backups")
        .join(&id);
    persist_before(&plan, &dir)?;
    files_unchanged(&plan.files)?;
    ENVIRONMENT.with(|e| *e.borrow_mut() = Some(HashMap::new()));
    BACKUP_DIR.with(|d| *d.borrow_mut() = Some(dir.clone()));
    let _environment = EnvironmentGuard;
    let journal = Journal::begin(&plan.files);
    let result = action();
    let recorded = journal.after();
    drop(journal);
    let recovery_error = || {
        AppError::Config(format!(
        "Codex 操作未完整完成，自动恢复遇到冲突或写入错误；已保留备份 codex-operation-backups/{id}，请核对后重试"
    ))
    };
    let recorded = recorded.map_err(|_| recovery_error())?;
    let environments = environment_records().map_err(|_| recovery_error())?;
    if result.is_err() {
        let after = snapshot_codex(&state.db).map_err(|_| recovery_error())?;
        let expected = plan
            .files
            .iter()
            .map(|f| {
                recorded
                    .iter()
                    .find(|r| r.path == f.path)
                    .cloned()
                    .ok_or_else(recovery_error)
            })
            .collect::<Result<Vec<_>, _>>()?;
        rollback_database(state, &plan.database, &after, || {
            restore_files(&plan.files, &expected)?;
            for record in &environments {
                restore_environment(record)?;
            }
            Ok(())
        })
        .map_err(|_| recovery_error())?;
    }
    // Successful operations and fully compensated failures need no retained secrets.
    // Interrupted/conflicting operations retain their private pre-write backup.
    if fs::remove_dir_all(&dir).is_err() {
        log::warn!("Codex operation backup cleanup deferred: {id}");
    }
    result
}
