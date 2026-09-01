//! Codex 第三方历史会话归桶迁移。
//!
//! 只迁移本机 `~/.codex` 历史数据；完成标记写入设备级 `settings.json`，
//! 失败时不写标记，下一次启动自动重试。

use crate::codex_config::{
    codex_custom_provider_anchor_id, get_codex_config_dir, read_codex_config_text,
    CC_SWITCH_CODEX_MODEL_PROVIDER_ID, DEFAULT_CODEX_MODEL_PROVIDER_ID,
};
use crate::codex_state_db::codex_state_db_paths;
use crate::config::{atomic_write, copy_file, get_app_config_dir};
use crate::database::Database;
use crate::error::AppError;
use crate::settings::{
    CodexHistoryAnchor, CodexOfficialHistoryUnifyMigration, CodexProviderTemplateMigration,
    CodexThirdPartyHistoryProviderBucketMigration,
};
use chrono::{Local, Utc};
use rusqlite::{backup::Backup, params_from_iter, Connection};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use toml_edit::DocumentMut;

const MIGRATION_NAME: &str = "codex-history-provider-migration-v1";
const OFFICIAL_UNIFY_MIGRATION_NAME: &str = "codex-official-history-unify-v1";
/// 还原操作自身的备份目录（与迁移备份分开，保持迁移账本目录纯净）。
const OFFICIAL_UNIFY_RESTORE_BACKUP_NAME: &str = "codex-official-history-unify-restore-v1";
/// SQLite 变量上限保守值，IN 列表按此分块。
const STATE_DB_ID_CHUNK: usize = 500;

/// 串行化官方历史的迁移与还原：开启迁移（启动重试 + 设置保存后台任务）和
/// 关闭还原可能在毫秒级先后被触发，对同一批 jsonl / state DB 双向改写。
static CODEX_OFFICIAL_HISTORY_OP_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn lock_codex_official_history_op() -> std::sync::MutexGuard<'static, ()> {
    CODEX_OFFICIAL_HISTORY_OP_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
/// Codex 内建默认 provider id：config.toml 没有 `model_provider` 键时会话归入此桶。
/// 官方订阅（ChatGPT OAuth / OpenAI API key）的历史会话都记录这个 id。
const OFFICIAL_OPENAI_CODEX_MODEL_PROVIDER_ID: &str = "openai";
/// Codex 0.1xx+ 官方登录会话使用的新内建桶名。
const OFFICIAL_CODEX_MODEL_PROVIDER_ID: &str = "codex";
const LEGACY_CC_SWITCH_CODEX_MODEL_PROVIDER_ID: &str = "ccswitch";
// If a Codex preset ever used a temporary routing key, keep that old key here
// so local history can be bucketed under the current custom provider id.
const CC_SWITCH_LEGACY_CODEX_MODEL_PROVIDER_IDS: &[&str] = &[
    LEGACY_CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
    "aicodemirror",
    "aicoding",
    "aigocode",
    "aihubmix",
    "ark_agentplan",
    "bailian",
    "bailing",
    "byteplus",
    "claudecn",
    "compshare",
    "compshare_coding",
    "crazyrouter",
    "ctok",
    "cubence",
    "deepseek",
    "dmxapi",
    "doubaoseed",
    "eflowcode",
    "etok",
    "kimi",
    "lemondata",
    "longcat",
    "micu",
    "minimax",
    "minimax_en",
    "modelscope",
    "newapi",
    "novita",
    "nvidia",
    "openrouter",
    "packycode",
    "patewayai",
    "pipellm",
    "qianfan_coding",
    "relaxycode",
    "rightcode",
    "runapi",
    "shengsuanyun",
    "siliconflow",
    "siliconflow_en",
    "sssaicode",
    "stepfun",
    "stepfun_en",
    "therouter",
    "xiaomi_mimo",
    "xiaomi_mimo_token_plan",
    "zhipu_glm",
    "zhipu_glm_en",
];

#[derive(Debug, Clone, Default)]
pub struct CodexHistoryProviderBucketMigrationOutcome {
    pub source_provider_ids: Vec<String>,
    pub migrated_jsonl_files: usize,
    pub migrated_state_rows: usize,
    pub skipped_reason: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct CodexProviderTemplateBucketMigrationOutcome {
    pub migrated_provider_ids: Vec<String>,
    pub skipped_reason: Option<String>,
}

pub fn maybe_migrate_codex_third_party_history_provider_bucket(
    db: &Database,
) -> Result<CodexHistoryProviderBucketMigrationOutcome, AppError> {
    let target_provider_id = current_codex_history_anchor_id();
    let source_provider_ids = collect_source_model_provider_ids(db, &target_provider_id)?;
    let migration_matches_target = crate::settings::get_settings()
        .local_migrations
        .as_ref()
        .and_then(|migrations| {
            migrations
                .codex_third_party_history_provider_bucket_v1
                .as_ref()
        })
        .is_some_and(|migration| {
            migration.scanned_history_files && migration.target_provider_id == target_provider_id
        });
    if migration_matches_target
        && !codex_state_dbs_have_provider_ids(&get_codex_config_dir(), &source_provider_ids)?
    {
        return Ok(CodexHistoryProviderBucketMigrationOutcome {
            skipped_reason: Some("already_migrated".to_string()),
            ..Default::default()
        });
    }

    if source_provider_ids.is_empty() {
        crate::settings::mark_codex_third_party_history_provider_bucket_migrated(
            CodexThirdPartyHistoryProviderBucketMigration {
                completed_at: Utc::now().to_rfc3339(),
                target_provider_id: target_provider_id.clone(),
                source_provider_ids: Vec::new(),
                migrated_jsonl_files: 0,
                migrated_state_rows: 0,
                scanned_history_files: true,
            },
        )?;
        return Ok(CodexHistoryProviderBucketMigrationOutcome {
            skipped_reason: Some("no_third_party_provider_ids".to_string()),
            ..Default::default()
        });
    }

    let backup_root = migration_backup_root(MIGRATION_NAME);
    let codex_dir = get_codex_config_dir();
    let migrated_jsonl_files = migrate_codex_jsonl_files(
        &codex_dir,
        &source_provider_ids,
        &target_provider_id,
        &backup_root,
    )?;
    let migrated_state_rows = migrate_codex_state_dbs(
        &codex_dir,
        &source_provider_ids,
        &target_provider_id,
        &backup_root,
    )?;

    let source_provider_ids_vec: Vec<String> = source_provider_ids.iter().cloned().collect();
    crate::settings::mark_codex_third_party_history_provider_bucket_migrated(
        CodexThirdPartyHistoryProviderBucketMigration {
            completed_at: Utc::now().to_rfc3339(),
            target_provider_id,
            source_provider_ids: source_provider_ids_vec.clone(),
            migrated_jsonl_files,
            migrated_state_rows,
            scanned_history_files: true,
        },
    )?;

    Ok(CodexHistoryProviderBucketMigrationOutcome {
        source_provider_ids: source_provider_ids_vec,
        migrated_jsonl_files,
        migrated_state_rows,
        skipped_reason: None,
    })
}

/// 补迁 state DB 中仍残留的本机自定义 Codex provider 桶。
///
/// 旧版迁移可能已经写入 marker，但当时只识别了部分 provider id 或只扫描了
/// 一个 state DB。这个入口不依赖 marker，只处理 tuzi-switch 数据库里定义过
/// 的自定义 provider id，且复用原有 SQLite 备份和事务更新。
pub fn migrate_codex_defined_state_history_to_unified_bucket(
    db: &Database,
) -> Result<CodexHistoryProviderBucketMigrationOutcome, AppError> {
    if !crate::settings::unify_codex_session_history() {
        return Ok(CodexHistoryProviderBucketMigrationOutcome {
            skipped_reason: Some("unify_toggle_off".to_string()),
            ..Default::default()
        });
    }

    let target_provider_id = current_codex_history_anchor_id();
    let source_provider_ids = collect_source_model_provider_ids(db, &target_provider_id)?;
    log::info!(
        "Codex defined state history migration sources: {:?}",
        source_provider_ids
    );
    if source_provider_ids.is_empty() {
        return Ok(CodexHistoryProviderBucketMigrationOutcome {
            skipped_reason: Some("no_defined_state_provider_ids".to_string()),
            ..Default::default()
        });
    }

    let codex_dir = get_codex_config_dir();
    if !codex_state_dbs_have_provider_ids(&codex_dir, &source_provider_ids)? {
        return Ok(CodexHistoryProviderBucketMigrationOutcome {
            skipped_reason: Some("state_already_unified".to_string()),
            ..Default::default()
        });
    }

    let backup_root = migration_backup_root(MIGRATION_NAME);
    let migrated_state_rows = migrate_codex_state_dbs(
        &codex_dir,
        &source_provider_ids,
        &target_provider_id,
        &backup_root,
    )?;
    let source_provider_ids_vec: Vec<String> = source_provider_ids.iter().cloned().collect();

    if migrated_state_rows > 0 {
        crate::settings::mark_codex_third_party_history_provider_bucket_migrated(
            CodexThirdPartyHistoryProviderBucketMigration {
                completed_at: Utc::now().to_rfc3339(),
                target_provider_id,
                source_provider_ids: source_provider_ids_vec.clone(),
                migrated_jsonl_files: 0,
                migrated_state_rows,
                // This recovery pass only inspects state DBs. Keep the JSONL
                // scan pending so the full migration below still runs.
                scanned_history_files: false,
            },
        )?;
    }

    Ok(CodexHistoryProviderBucketMigrationOutcome {
        source_provider_ids: source_provider_ids_vec,
        migrated_jsonl_files: 0,
        migrated_state_rows,
        skipped_reason: None,
    })
}

pub fn maybe_migrate_codex_provider_template_bucket(
    db: &Database,
) -> Result<CodexProviderTemplateBucketMigrationOutcome, AppError> {
    let target_provider_id = current_codex_history_anchor_id();
    let backup_root = migration_backup_root(MIGRATION_NAME);
    let outcome =
        migrate_codex_provider_templates_to_anchor(db, &target_provider_id, &backup_root)?;
    crate::settings::mark_codex_provider_template_migrated(CodexProviderTemplateMigration {
        completed_at: Utc::now().to_rfc3339(),
        migrated_provider_ids: outcome.migrated_provider_ids.clone(),
    })?;

    Ok(outcome)
}

/// 统一会话开关的存量迁移：把官方会话（内建 "openai" 桶）迁入共享 "tuziswitch" 桶。
///
/// 仅当用户在开启弹窗里勾选了"迁入既有官方会话"（`unify_codex_migrate_existing`）
/// 且本轮未完成时执行；开关关闭时标记与勾选意愿都会被清除（见 `save_settings`），
/// 重新开启并再次勾选即可补迁关闭期间产生的官方会话。
/// tuziswitch 桶里官方与第三方会话无法区分，自动逻辑绝不反向搬回；
/// 用户可在关闭开关时选择按备份账本精确还原（见 `restore_codex_official_history_from_backups`）。
/// 迁移前 jsonl / state DB 均备份到 `~/.tuzi-switch/backups/codex-official-history-unify-v1/`。
pub fn maybe_migrate_codex_official_history_to_unified_bucket(
) -> Result<CodexHistoryProviderBucketMigrationOutcome, AppError> {
    if !crate::settings::unify_codex_session_history() {
        return Ok(CodexHistoryProviderBucketMigrationOutcome {
            skipped_reason: Some("unify_toggle_off".to_string()),
            ..Default::default()
        });
    }
    if !crate::settings::unify_codex_migrate_existing_requested() {
        return Ok(CodexHistoryProviderBucketMigrationOutcome {
            skipped_reason: Some("stock_migration_not_requested".to_string()),
            ..Default::default()
        });
    }
    let _op_guard = lock_codex_official_history_op();
    let codex_dir = get_codex_config_dir();
    let target_provider_id = current_codex_history_anchor_id();
    // marker 绑定迁移时的 Codex 目录：切换 codex_config_dir 后旧 marker 不再
    // 挡住新目录的迁移（迁移幂等，重跑无害）。
    let codex_dir_key = canonical_dir_string(&codex_dir);
    if crate::settings::is_codex_official_history_unify_migrated_for_dir(&codex_dir_key) {
        return Ok(CodexHistoryProviderBucketMigrationOutcome {
            skipped_reason: Some("already_migrated".to_string()),
            ..Default::default()
        });
    }
    // live 必须已实际路由到共享 tuziswitch 桶才允许迁移：官方配置的注入可能被拒
    // （已有显式 model_provider / 形态冲突的 tuziswitch 表，见
    // `inject_codex_unified_session_bucket`），代理接管期间的 live 也不带统一
    // 路由（注入只进备份）。这些状态下新会话仍落 "openai" 桶，迁移只会把
    // 历史搬进当前 live 看不见的桶里。开关与迁移意愿保持不动，待 live 真正
    // 统一后（下次切换 / 接管释放后的启动重试）再迁。
    if !codex_config_text_routes_anchor(
        &read_codex_config_text().unwrap_or_default(),
        &target_provider_id,
    ) {
        return Ok(CodexHistoryProviderBucketMigrationOutcome {
            skipped_reason: Some("live_not_unified".to_string()),
            ..Default::default()
        });
    }

    let source_provider_ids: BTreeSet<String> = [
        OFFICIAL_OPENAI_CODEX_MODEL_PROVIDER_ID.to_string(),
        OFFICIAL_CODEX_MODEL_PROVIDER_ID.to_string(),
    ]
    .into_iter()
    .collect();
    let backup_root = migration_backup_root(OFFICIAL_UNIFY_MIGRATION_NAME);
    let migrated_jsonl_files = migrate_codex_jsonl_files(
        &codex_dir,
        &source_provider_ids,
        &target_provider_id,
        &backup_root,
    )?;
    let migrated_state_rows = migrate_codex_state_dbs(
        &codex_dir,
        &source_provider_ids,
        &target_provider_id,
        &backup_root,
    )?;
    // 备份代际记录来源目录，restore 据此只取当前目录的账本。
    write_backup_generation_meta(&backup_root, &codex_dir_key)?;

    let outcome = CodexHistoryProviderBucketMigrationOutcome {
        source_provider_ids: source_provider_ids.into_iter().collect(),
        migrated_jsonl_files,
        migrated_state_rows,
        skipped_reason: None,
    };

    // 条件写入在 settings 写锁内原子完成："迁移期间开关被关掉"时不写完成标记，
    // 避免下一次开启被标记挡住而漏迁"关闭期间"新产生的 openai 桶会话。
    // 与关闭路径（update_settings + 清标记）共用同一把锁，无检查-写入窗口。
    let marker_written = crate::settings::mark_codex_official_history_unify_migrated_if_enabled(
        CodexOfficialHistoryUnifyMigration {
            completed_at: Utc::now().to_rfc3339(),
            target_provider_id,
            migrated_jsonl_files,
            migrated_state_rows,
            codex_config_dir: Some(codex_dir_key),
        },
    )?;
    if !marker_written {
        return Ok(CodexHistoryProviderBucketMigrationOutcome {
            skipped_reason: Some("toggle_disabled_during_migration".to_string()),
            ..outcome
        });
    }

    Ok(outcome)
}

/// live config.toml 是否路由到共享 custom 桶（会话分桶只看这个实态：
/// base_url / 接管与否都不影响 session_meta 记录的 model_provider）。
fn codex_config_text_routes_anchor(config_text: &str, anchor_id: &str) -> bool {
    config_text
        .parse::<DocumentMut>()
        .ok()
        .and_then(|doc| {
            doc.get("model_provider")
                .and_then(|item| item.as_str())
                .map(|id| id.trim() == anchor_id)
        })
        .unwrap_or(false)
}

#[cfg(test)]
fn codex_config_text_routes_custom(config_text: &str) -> bool {
    codex_config_text_routes_anchor(config_text, CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
}

/// 目录的规范化字符串形式，用作 marker / 备份代际的目录身份。
/// canonicalize 失败（目录尚不存在等）时退回原始路径字符串。
fn canonical_dir_string(dir: &Path) -> String {
    crate::settings::local_path_identity(dir)
}

/// 在备份代际根目录写入 meta.json，记录这批备份来自哪个 Codex 目录。
/// 代际目录不存在（本轮没有任何文件被迁移）时跳过。
fn write_backup_generation_meta(backup_root: &Path, codex_dir_key: &str) -> Result<(), AppError> {
    if !backup_root.exists() {
        return Ok(());
    }
    let payload = serde_json::json!({ "codexConfigDir": codex_dir_key });
    let bytes =
        serde_json::to_vec_pretty(&payload).map_err(|e| AppError::JsonSerialize { source: e })?;
    atomic_write(&backup_root.join("meta.json"), &bytes)
}

#[derive(Debug, Clone, Default)]
pub struct CodexOfficialHistoryRestoreOutcome {
    pub restored_jsonl_files: usize,
    pub restored_state_rows: usize,
    pub skipped_reason: Option<String>,
}

/// 统一会话开关迁移备份的父目录（其下每次迁移一个时间戳代际目录）。
fn official_history_unify_backup_parent() -> PathBuf {
    get_app_config_dir()
        .join("backups")
        .join(OFFICIAL_UNIFY_MIGRATION_NAME)
}

/// 是否存在可用于还原的迁移备份（给前端决定要不要显示"恢复备份"勾选）。
/// 与 restore 的账本收集共用同一目录匹配口径：只认属于当前 Codex 目录的
/// 代际，避免切换 codex_config_dir 后弹出注定空跑的勾选。
/// 精确账本内容仍在真正还原时才解析。
pub fn has_codex_official_history_unify_backup() -> bool {
    has_official_history_unify_backup_for_dir(
        &official_history_unify_backup_parent(),
        &canonical_dir_string(&get_codex_config_dir()),
    )
}

fn has_official_history_unify_backup_for_dir(ledger_parent: &Path, codex_dir_key: &str) -> bool {
    let Ok(entries) = fs::read_dir(ledger_parent) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let generation = entry.path();
        generation.is_dir() && backup_generation_matches_dir(&generation, codex_dir_key)
    })
}

/// 关闭统一会话开关时的可选还原：按迁移备份账本，把当时迁入共享 custom 桶的
/// 官方会话精确翻回 "openai" 桶。
///
/// 备份是唯一可信的归属证据：备份里 model_provider=="openai" 的会话必定源自
/// 官方桶。开启期间新产生的会话不在任何备份里，**永不触碰**——它们可能来自
/// 第三方，方向无法判定（产品决策：宁可留在第三方历史）。
/// 扫描全部备份代际取并集，多次开关循环后仍能还原早期迁入的会话；
/// 还原前改动目标先备份到独立的 restore 目录（保持迁移账本目录纯净），
/// 且只改写当前仍为 custom 的目标，重复执行无害。
pub fn restore_codex_official_history_from_backups(
) -> Result<CodexOfficialHistoryRestoreOutcome, AppError> {
    let _op_guard = lock_codex_official_history_op();
    // 开关已（重新）开启时拒绝还原：live 正路由 custom，把账本会话翻回
    // openai 桶等于亲手制造分裂。覆盖"关闭保存成功后用户立刻重新开启，
    // 还原排在重开迁移之后才拿到 op lock"的时序。
    if crate::settings::unify_codex_session_history() {
        return Ok(CodexOfficialHistoryRestoreOutcome {
            skipped_reason: Some("unify_toggle_on".to_string()),
            ..Default::default()
        });
    }
    let config_text = read_codex_config_text().unwrap_or_default();
    restore_codex_official_history_inner(
        &get_codex_config_dir(),
        &official_history_unify_backup_parent(),
        &migration_backup_root(OFFICIAL_UNIFY_RESTORE_BACKUP_NAME),
        &config_text,
    )
}

fn restore_codex_official_history_inner(
    codex_dir: &Path,
    ledger_parent: &Path,
    restore_backup_root: &Path,
    config_text: &str,
) -> Result<CodexOfficialHistoryRestoreOutcome, AppError> {
    let unified_provider_ids: BTreeSet<String> = [
        current_codex_history_anchor_id(),
        CC_SWITCH_CODEX_MODEL_PROVIDER_ID.to_string(),
    ]
    .into_iter()
    .collect();
    let codex_dir_key = canonical_dir_string(codex_dir);
    let (official_sessions, official_threads) =
        collect_official_ledger(ledger_parent, &codex_dir_key)?;
    if official_sessions.is_empty() && official_threads.is_empty() {
        return Ok(CodexOfficialHistoryRestoreOutcome {
            skipped_reason: Some("no_backup_ledger".to_string()),
            ..Default::default()
        });
    }

    let mut files = Vec::new();
    collect_jsonl_files(&codex_dir.join("sessions"), &mut files, 0, 8);
    collect_jsonl_files(&codex_dir.join("archived_sessions"), &mut files, 0, 4);
    let mut restored_jsonl_files = 0;
    for file_path in files {
        if rewrite_codex_session_file_lines(&file_path, codex_dir, restore_backup_root, |line| {
            rewrite_codex_session_meta_line_for_restore(
                line,
                &official_sessions,
                &unified_provider_ids,
            )
        })? {
            restored_jsonl_files += 1;
        }
    }

    let mut restored_state_rows = 0;
    for db_path in codex_state_db_paths(codex_dir, config_text) {
        restored_state_rows += restore_codex_state_db_official_threads(
            &db_path,
            codex_dir,
            &official_threads,
            &unified_provider_ids,
            restore_backup_root,
        )?;
    }

    if restored_jsonl_files == 0 && restored_state_rows == 0 {
        // 账本非空但没有任何"当前仍为 custom"的目标（如重复还原）：
        // 以 reason 告知前端，避免误报"已还原 0 项"为成功。
        return Ok(CodexOfficialHistoryRestoreOutcome {
            skipped_reason: Some("nothing_to_restore".to_string()),
            ..Default::default()
        });
    }

    Ok(CodexOfficialHistoryRestoreOutcome {
        restored_jsonl_files,
        restored_state_rows,
        skipped_reason: None,
    })
}

/// 从备份代际收集官方会话账本：jsonl 备份里 session_meta 为 "openai" 的
/// 会话 id + state DB 备份里 model_provider 为 "openai" 的 thread id。
/// 只采纳 meta.json 目录与当前 Codex 目录一致的代际，避免切换
/// codex_config_dir 后拿旧目录的账本作用到新目录。
/// 还原操作自身的备份（restore 目录）天然不会混入：那些副本里的 id 都是
/// custom，解析后贡献为空。
fn collect_official_ledger(
    ledger_parent: &Path,
    codex_dir_key: &str,
) -> Result<(HashMap<String, String>, BTreeMap<String, String>), AppError> {
    let mut sessions = HashMap::new();
    let mut threads = BTreeMap::new();
    let entries = match fs::read_dir(ledger_parent) {
        Ok(entries) => entries,
        Err(_) => return Ok((sessions, threads)),
    };
    for entry in entries.flatten() {
        let generation = entry.path();
        if !generation.is_dir() {
            continue;
        }
        if !backup_generation_matches_dir(&generation, codex_dir_key) {
            continue;
        }
        let mut backup_files = Vec::new();
        collect_jsonl_files(&generation.join("jsonl"), &mut backup_files, 0, 10);
        for backup_file in backup_files {
            collect_official_sessions_from_backup(&backup_file, &mut sessions);
        }
        let mut backup_dbs = Vec::new();
        collect_files_with_extension(&generation.join("state"), "sqlite", &mut backup_dbs, 0, 4);
        for backup_db in backup_dbs {
            collect_official_threads_from_backup(&backup_db, &mut threads);
        }
    }
    Ok((sessions, threads))
}

/// 备份代际是否属于指定 Codex 目录。无 meta.json 或解析失败时宽容接受：
/// 早期版本的备份没有 meta，而那个时期不存在切目录场景；误纳的代价也被
/// "按会话 id 精确匹配 + 仅改写 custom"双重条件兜底。
fn backup_generation_matches_dir(generation: &Path, codex_dir_key: &str) -> bool {
    let Ok(text) = fs::read_to_string(generation.join("meta.json")) else {
        return true;
    };
    serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| {
            value
                .get("codexConfigDir")
                .and_then(Value::as_str)
                .map(|dir| dir == codex_dir_key)
        })
        .unwrap_or(true)
}

fn collect_official_sessions_from_backup(path: &Path, sessions: &mut HashMap<String, String>) {
    let Ok(content) = fs::read_to_string(path) else {
        log::debug!("Failed to read unify backup file {}", path.display());
        return;
    };
    for line in content.lines() {
        if !line.contains("\"session_meta\"") || !line.contains("\"model_provider\"") {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("session_meta") {
            continue;
        }
        let Some(payload) = value.get("payload") else {
            continue;
        };
        let Some(provider_id) = payload.get("model_provider").and_then(Value::as_str) else {
            continue;
        };
        if provider_id != OFFICIAL_OPENAI_CODEX_MODEL_PROVIDER_ID
            && provider_id != OFFICIAL_CODEX_MODEL_PROVIDER_ID
        {
            continue;
        }
        if let Some(session_id) = payload.get("id").and_then(Value::as_str) {
            sessions.insert(session_id.to_string(), provider_id.to_string());
        }
    }
}

fn collect_official_threads_from_backup(db_path: &Path, threads: &mut BTreeMap<String, String>) {
    let conn =
        match Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) {
            Ok(conn) => conn,
            Err(err) => {
                log::debug!(
                    "Failed to open unify backup state DB {}: {err}",
                    db_path.display()
                );
                return;
            }
        };
    let has_threads = Database::table_exists(&conn, "threads").unwrap_or(false)
        && Database::has_column(&conn, "threads", "model_provider").unwrap_or(false);
    if !has_threads {
        return;
    }
    let Ok(mut stmt) =
        conn.prepare("SELECT id, model_provider FROM threads WHERE model_provider IN (?1, ?2)")
    else {
        return;
    };
    let Ok(rows) = stmt.query_map(
        [
            OFFICIAL_OPENAI_CODEX_MODEL_PROVIDER_ID,
            OFFICIAL_CODEX_MODEL_PROVIDER_ID,
        ],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    ) else {
        return;
    };
    for (thread_id, provider_id) in rows.flatten() {
        threads.insert(thread_id, provider_id);
    }
}

fn collect_files_with_extension(
    dir: &Path,
    extension: &str,
    files: &mut Vec<PathBuf>,
    depth: u8,
    max_depth: u8,
) {
    if depth > max_depth || !dir.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files_with_extension(&path, extension, files, depth + 1, max_depth);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some(extension) {
            files.push(path);
        }
    }
}

fn rewrite_codex_session_meta_line_for_restore(
    line: &str,
    official_sessions: &HashMap<String, String>,
    unified_provider_ids: &BTreeSet<String>,
) -> Option<String> {
    if !line.contains("\"session_meta\"") || !line.contains("\"model_provider\"") {
        return None;
    }
    let mut value: Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }
    let payload = value.get_mut("payload")?.as_object_mut()?;
    if !unified_provider_ids.contains(payload.get("model_provider")?.as_str()?) {
        return None;
    }
    let session_id = payload.get("id")?.as_str()?;
    let original_provider = official_sessions.get(session_id)?;
    payload.insert(
        "model_provider".to_string(),
        Value::String(original_provider.clone()),
    );
    serde_json::to_string(&value).ok()
}

fn restore_codex_state_db_official_threads(
    db_path: &Path,
    codex_dir: &Path,
    official_threads: &BTreeMap<String, String>,
    unified_provider_ids: &BTreeSet<String>,
    backup_root: &Path,
) -> Result<usize, AppError> {
    if !db_path.exists() || official_threads.is_empty() {
        return Ok(0);
    }

    let mut conn = Connection::open(db_path)
        .map_err(|e| AppError::Database(format!("打开 Codex state DB 失败: {e}")))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| AppError::Database(format!("设置 Codex state DB busy_timeout 失败: {e}")))?;

    if !Database::table_exists(&conn, "threads")?
        || !Database::has_column(&conn, "threads", "model_provider")?
    {
        return Ok(0);
    }

    let mut matching_rows: i64 = 0;
    let ids: Vec<&String> = official_threads.keys().collect();
    for unified_provider_id in unified_provider_ids {
        for chunk in ids.chunks(STATE_DB_ID_CHUNK) {
            let placeholders = placeholders(chunk.len());
            let count_sql = format!(
                "SELECT COUNT(*) FROM threads WHERE model_provider = ? AND id IN ({placeholders})"
            );
            let mut values = Vec::with_capacity(chunk.len() + 1);
            values.push(unified_provider_id.clone());
            values.extend(chunk.iter().map(|id| (*id).clone()));
            let count: i64 = conn
                .query_row(&count_sql, params_from_iter(values.iter()), |row| {
                    row.get(0)
                })
                .map_err(|e| {
                    AppError::Database(format!("统计 Codex state DB 待还原行失败: {e}"))
                })?;
            matching_rows += count;
        }
    }
    if matching_rows == 0 {
        return Ok(0);
    }

    backup_codex_state_db(db_path, codex_dir, backup_root, &conn)?;

    let tx = conn
        .transaction()
        .map_err(|e| AppError::Database(format!("开启 Codex state DB 还原事务失败: {e}")))?;
    let mut changed = 0;
    for original_provider in [
        OFFICIAL_OPENAI_CODEX_MODEL_PROVIDER_ID,
        OFFICIAL_CODEX_MODEL_PROVIDER_ID,
    ] {
        let provider_ids: Vec<&String> = official_threads
            .iter()
            .filter_map(|(id, provider)| (provider == original_provider).then_some(id))
            .collect();
        for unified_provider_id in unified_provider_ids {
            for chunk in provider_ids.chunks(STATE_DB_ID_CHUNK) {
                let placeholders = placeholders(chunk.len());
                let update_sql = format!(
                    "UPDATE threads SET model_provider = ? WHERE model_provider = ? AND id IN ({placeholders})"
                );
                let mut values = Vec::with_capacity(chunk.len() + 2);
                values.push(original_provider.to_string());
                values.push(unified_provider_id.clone());
                values.extend(chunk.iter().map(|id| (*id).clone()));
                changed += tx
                    .execute(&update_sql, params_from_iter(values.iter()))
                    .map_err(|e| {
                        AppError::Database(format!("还原 Codex state DB provider 失败: {e}"))
                    })?;
            }
        }
    }
    tx.commit()
        .map_err(|e| AppError::Database(format!("提交 Codex state DB 还原事务失败: {e}")))?;
    Ok(changed)
}

fn latest_codex_history_cwd() -> Option<PathBuf> {
    let codex_dir = get_codex_config_dir();
    let config_text = read_codex_config_text().unwrap_or_default();
    let mut latest: Option<(i64, PathBuf)> = None;

    for db_path in codex_state_db_paths(&codex_dir, &config_text) {
        let Ok(conn) =
            Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        else {
            continue;
        };
        if !Database::table_exists(&conn, "threads").unwrap_or(false)
            || !Database::has_column(&conn, "threads", "cwd").unwrap_or(false)
        {
            continue;
        }
        let row = conn.query_row(
            "SELECT COALESCE(updated_at_ms, updated_at * 1000), cwd \
             FROM threads WHERE TRIM(cwd) <> '' \
             ORDER BY COALESCE(updated_at_ms, updated_at * 1000) DESC LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    PathBuf::from(row.get::<_, String>(1)?),
                ))
            },
        );
        let Ok((updated_at, cwd)) = row else {
            continue;
        };
        if latest
            .as_ref()
            .is_none_or(|(current_updated_at, _)| updated_at > *current_updated_at)
        {
            latest = Some((updated_at, cwd));
        }
    }

    latest.map(|(_, cwd)| cwd)
}

pub fn ensure_codex_history_anchor() -> Result<String, AppError> {
    let codex_dir = get_codex_config_dir();
    let codex_dir_key = canonical_dir_string(&codex_dir);
    if let Some(anchor) = crate::settings::get_codex_history_anchor_for_dir(&codex_dir_key) {
        return Ok(anchor.provider_id);
    }

    let cwd = latest_codex_history_cwd().or_else(|| codex_dir.parent().map(Path::to_path_buf));
    let effective = match crate::codex_config::read_codex_effective_model_provider(cwd.as_deref()) {
        Ok(provider) => provider,
        Err(error) => {
            log::warn!("Codex config/read 无法解析有效 model_provider，将使用安全回退: {error}");
            None
        }
    };
    let live_anchor = read_codex_config_text()
        .ok()
        .and_then(|config| codex_custom_provider_anchor_id(&config));

    let (provider_id, source, resolved_cwd) = if let Some(effective) = effective {
        (effective.provider_id, effective.source, effective.cwd)
    } else if let Some(provider_id) = live_anchor {
        (
            provider_id,
            "fallback:user-config".to_string(),
            cwd.as_ref().map(|path| path.to_string_lossy().to_string()),
        )
    } else {
        (
            DEFAULT_CODEX_MODEL_PROVIDER_ID.to_string(),
            "fallback:fresh-install".to_string(),
            cwd.as_ref().map(|path| path.to_string_lossy().to_string()),
        )
    };

    crate::settings::set_codex_history_anchor(CodexHistoryAnchor {
        provider_id: provider_id.clone(),
        codex_config_dir: codex_dir_key,
        resolved_at: Utc::now().to_rfc3339(),
        source,
        cwd: resolved_cwd,
    })?;
    log::info!("Codex unified history anchor fixed at '{provider_id}'");
    Ok(provider_id)
}

fn current_codex_history_anchor_id() -> String {
    let codex_dir = get_codex_config_dir();
    crate::settings::get_codex_history_anchor_id_for_path(&codex_dir)
        .or_else(|| {
            read_codex_config_text()
                .ok()
                .and_then(|config| codex_custom_provider_anchor_id(&config))
        })
        .unwrap_or_else(|| DEFAULT_CODEX_MODEL_PROVIDER_ID.to_string())
}

fn migrate_codex_provider_templates_to_anchor(
    db: &Database,
    target_provider_id: &str,
    backup_root: &Path,
) -> Result<CodexProviderTemplateBucketMigrationOutcome, AppError> {
    let providers = db.get_all_providers("codex")?;
    let mut migrated_provider_ids = Vec::new();

    for (_, provider) in providers {
        if provider.category.as_deref() == Some("official")
            || provider.is_codex_oauth()
            || crate::database::is_codex_official_seed_id(&provider.id)
        {
            continue;
        }

        let Some(config_text) = provider
            .settings_config
            .get("config")
            .and_then(|value| value.as_str())
        else {
            continue;
        };

        let Some(migrated_config_text) =
            migrate_provider_config_template_to_anchor(config_text, target_provider_id)?
        else {
            continue;
        };

        let mut settings = provider.settings_config.clone();
        let Some(obj) = settings.as_object_mut() else {
            log::warn!(
                "Skipping Codex provider template migration for {}: settings_config is not an object",
                provider.id
            );
            continue;
        };
        backup_provider_settings_config(&provider.id, &provider.settings_config, backup_root)?;
        obj.insert("config".to_string(), Value::String(migrated_config_text));
        db.update_provider_settings_config("codex", &provider.id, &settings)?;
        migrated_provider_ids.push(provider.id);
    }

    Ok(CodexProviderTemplateBucketMigrationOutcome {
        migrated_provider_ids,
        skipped_reason: None,
    })
}

fn collect_source_model_provider_ids(
    db: &Database,
    target_provider_id: &str,
) -> Result<BTreeSet<String>, AppError> {
    let providers = db.get_all_providers("codex")?;
    let mut ids = BTreeSet::new();

    for provider in providers.values() {
        if provider.category.as_deref() == Some("official")
            || provider.is_codex_oauth()
            || crate::database::is_codex_official_seed_id(&provider.id)
        {
            continue;
        }

        insert_known_cc_switch_legacy_source_id(&mut ids, &provider.id);

        let Some(config_text) = provider
            .settings_config
            .get("config")
            .and_then(|value| value.as_str())
        else {
            continue;
        };

        for provider_id in trusted_legacy_codex_model_provider_ids_from_config(config_text) {
            insert_known_cc_switch_legacy_source_id(&mut ids, &provider_id);
        }
        if let Some(provider_id) =
            legacy_codex_model_provider_id_from_normalized_config(config_text)
        {
            insert_known_cc_switch_legacy_source_id(&mut ids, &provider_id);
        }
    }

    let codex_dir = get_codex_config_dir();
    ids.extend(collect_existing_state_db_provider_ids(&codex_dir, &ids)?);
    // Repair data written by older releases into the fixed tuziswitch bucket
    // when this machine already has a different stable custom anchor.
    if target_provider_id != CC_SWITCH_CODEX_MODEL_PROVIDER_ID {
        ids.insert(CC_SWITCH_CODEX_MODEL_PROVIDER_ID.to_string());
    }
    ids.remove(target_provider_id);

    Ok(ids)
}

fn collect_existing_state_db_provider_ids(
    codex_dir: &Path,
    configured_provider_ids: &BTreeSet<String>,
) -> Result<BTreeSet<String>, AppError> {
    if configured_provider_ids.is_empty() {
        return Ok(BTreeSet::new());
    }

    let mut ids = BTreeSet::new();
    let config_text = read_codex_config_text().unwrap_or_default();
    for db_path in codex_state_db_paths(codex_dir, &config_text) {
        match existing_state_db_provider_ids(&db_path, configured_provider_ids) {
            Ok(found) => ids.extend(found),
            Err(err) => log::warn!("跳过不可读取的 Codex state DB {}: {err}", db_path.display()),
        }
    }
    Ok(ids)
}

fn existing_state_db_provider_ids(
    db_path: &Path,
    configured_provider_ids: &BTreeSet<String>,
) -> Result<BTreeSet<String>, AppError> {
    if !db_path.exists() {
        return Ok(BTreeSet::new());
    }

    // 枚举 provider 只读即可；使用读写打开会尝试创建 WAL/SHM，
    // 对只读挂载或无写权限的历史库会误判为整次迁移失败。
    let conn = Connection::open_with_flags(db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| AppError::Database(format!("打开 Codex state DB 失败: {e}")))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| AppError::Database(format!("设置 Codex state DB busy_timeout 失败: {e}")))?;

    if !Database::table_exists(&conn, "threads")?
        || !Database::has_column(&conn, "threads", "model_provider")?
    {
        return Ok(BTreeSet::new());
    }

    let mut stmt = conn
        .prepare("SELECT DISTINCT model_provider FROM threads WHERE model_provider IS NOT NULL")
        .map_err(|e| AppError::Database(format!("查询 Codex state DB provider 失败: {e}")))?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| AppError::Database(format!("读取 Codex state DB provider 失败: {e}")))?;

    let mut ids = BTreeSet::new();
    for row in rows {
        let provider_id = row.map_err(|e| AppError::Database(e.to_string()))?;
        if configured_provider_ids.contains(provider_id.as_str()) {
            ids.insert(provider_id);
        }
    }
    Ok(ids)
}

fn insert_known_cc_switch_legacy_source_id(ids: &mut BTreeSet<String>, provider_id: &str) {
    let trimmed = provider_id.trim();
    if is_known_cc_switch_legacy_codex_model_provider_id(trimmed) {
        ids.insert(trimmed.to_string());
    }
}

fn migration_backup_root(migration_name: &str) -> PathBuf {
    get_app_config_dir()
        .join("backups")
        .join(migration_name)
        .join(Local::now().format("%Y%m%d_%H%M%S").to_string())
}

fn is_known_cc_switch_legacy_codex_model_provider_id(provider_id: &str) -> bool {
    CC_SWITCH_LEGACY_CODEX_MODEL_PROVIDER_IDS
        .iter()
        .any(|known| known.eq_ignore_ascii_case(provider_id))
}

fn legacy_codex_model_provider_id_from_normalized_config(config_text: &str) -> Option<String> {
    let doc = config_text.parse::<DocumentMut>().ok()?;
    let provider_id = doc
        .get("model_provider")
        .and_then(|item| item.as_str())
        .map(str::trim)?;
    if provider_id != CC_SWITCH_CODEX_MODEL_PROVIDER_ID
        && provider_id != LEGACY_CC_SWITCH_CODEX_MODEL_PROVIDER_ID
    {
        return None;
    }

    let name = doc
        .get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|table| table.get(provider_id))
        .and_then(|item| item.as_table())
        .and_then(|table| table.get("name"))
        .and_then(|item| item.as_str())?
        .trim();

    normalized_legacy_codex_provider_name(name).map(str::to_string)
}

fn normalized_legacy_codex_provider_name(name: &str) -> Option<&'static str> {
    if is_known_cc_switch_legacy_codex_model_provider_id(name) {
        return CC_SWITCH_LEGACY_CODEX_MODEL_PROVIDER_IDS
            .iter()
            .copied()
            .find(|known| known.eq_ignore_ascii_case(name));
    }

    match name {
        "E-FlowCode" => Some("eflowcode"),
        "PIPELLM" => Some("pipellm"),
        _ => None,
    }
}

fn trusted_legacy_codex_model_provider_ids_from_config(config_text: &str) -> BTreeSet<String> {
    let Ok(doc) = config_text.parse::<DocumentMut>() else {
        return BTreeSet::new();
    };

    trusted_legacy_codex_model_provider_ids_from_doc(&doc)
}

fn trusted_legacy_codex_model_provider_ids_from_doc(doc: &DocumentMut) -> BTreeSet<String> {
    let mut ids = BTreeSet::new();
    insert_trusted_legacy_config_model_provider_id(&mut ids, doc, doc.get("model_provider"));

    if let Some(profiles) = doc.get("profiles").and_then(|item| item.as_table_like()) {
        for (_, profile_item) in profiles.iter() {
            if let Some(profile_table) = profile_item.as_table_like() {
                insert_trusted_legacy_config_model_provider_id(
                    &mut ids,
                    doc,
                    profile_table.get("model_provider"),
                );
            }
        }
    }

    ids
}

fn insert_trusted_legacy_config_model_provider_id(
    ids: &mut BTreeSet<String>,
    doc: &DocumentMut,
    item: Option<&toml_edit::Item>,
) {
    let Some(provider_id) = item.and_then(|item| item.as_str()).map(str::trim) else {
        return;
    };
    if provider_id.is_empty()
        || !is_known_cc_switch_legacy_codex_model_provider_id(provider_id)
        || !config_defines_model_provider(doc, provider_id)
    {
        return;
    }
    ids.insert(provider_id.to_string());
}

fn config_defines_model_provider(doc: &DocumentMut, provider_id: &str) -> bool {
    doc.get("model_providers")
        .and_then(|item| item.as_table())
        .and_then(|table| table.get(provider_id))
        .and_then(|item| item.as_table())
        .is_some()
}

fn migrate_provider_config_template_to_anchor(
    config_text: &str,
    target_provider_id: &str,
) -> Result<Option<String>, AppError> {
    if config_text.trim().is_empty() {
        return Ok(None);
    }

    let mut doc = config_text
        .parse::<DocumentMut>()
        .map_err(|e| AppError::Message(format!("Invalid Codex config.toml: {e}")))?;

    let mut source_provider_ids = trusted_legacy_codex_model_provider_ids_from_doc(&doc);
    if target_provider_id != CC_SWITCH_CODEX_MODEL_PROVIDER_ID
        && config_defines_model_provider(&doc, CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
    {
        source_provider_ids.insert(CC_SWITCH_CODEX_MODEL_PROVIDER_ID.to_string());
    }
    if source_provider_ids.is_empty() {
        return Ok(None);
    }

    let active_provider_id = doc
        .get("model_provider")
        .and_then(|item| item.as_str())
        .map(str::trim)
        .filter(|provider_id| !provider_id.is_empty())
        .map(str::to_string);

    let target_table_exists = config_defines_model_provider(&doc, target_provider_id);
    let source_provider_id_to_move = active_provider_id
        .as_deref()
        .filter(|provider_id| {
            *provider_id != target_provider_id && source_provider_ids.contains(*provider_id)
        })
        .map(str::to_string)
        .or_else(|| {
            if target_table_exists {
                None
            } else {
                source_provider_ids
                    .iter()
                    .find(|provider_id| provider_id.as_str() != target_provider_id)
                    .cloned()
            }
        });

    let mut changed = false;

    if let Some(source_provider_id) = source_provider_id_to_move {
        let Some(model_providers) = doc
            .get_mut("model_providers")
            .and_then(|item| item.as_table_mut())
        else {
            return Ok(None);
        };

        let Some(provider_table) = model_providers.remove(source_provider_id.as_str()) else {
            return Ok(None);
        };
        model_providers[target_provider_id] = provider_table;
        changed = true;
    }

    if active_provider_id.as_deref().is_some_and(|provider_id| {
        provider_id != target_provider_id && source_provider_ids.contains(provider_id)
    }) {
        doc["model_provider"] = toml_edit::value(target_provider_id);
        changed = true;
    }

    for source_provider_id in source_provider_ids {
        if source_provider_id != target_provider_id
            && rewrite_legacy_provider_profile_refs(
                &mut doc,
                source_provider_id.as_str(),
                target_provider_id,
            )
        {
            changed = true;
        }
    }

    if changed {
        Ok(Some(doc.to_string()))
    } else {
        Ok(None)
    }
}

fn rewrite_legacy_provider_profile_refs(
    doc: &mut DocumentMut,
    source_provider_id: &str,
    target_provider_id: &str,
) -> bool {
    let Some(profiles) = doc
        .get_mut("profiles")
        .and_then(|item| item.as_table_like_mut())
    else {
        return false;
    };

    let mut changed = false;
    let profile_keys: Vec<String> = profiles.iter().map(|(key, _)| key.to_string()).collect();
    for profile_key in profile_keys {
        let Some(profile_table) = profiles
            .get_mut(&profile_key)
            .and_then(|item| item.as_table_like_mut())
        else {
            continue;
        };

        let references_legacy = profile_table
            .get("model_provider")
            .and_then(|item| item.as_str())
            == Some(source_provider_id);
        if references_legacy {
            profile_table.insert("model_provider", toml_edit::value(target_provider_id));
            changed = true;
        }
    }
    changed
}

fn migrate_codex_jsonl_files(
    codex_dir: &Path,
    source_provider_ids: &BTreeSet<String>,
    target_provider_id: &str,
    backup_root: &Path,
) -> Result<usize, AppError> {
    let mut files = Vec::new();
    collect_jsonl_files(&codex_dir.join("sessions"), &mut files, 0, 8);
    collect_jsonl_files(&codex_dir.join("archived_sessions"), &mut files, 0, 4);

    let source_provider_ids: HashSet<String> = source_provider_ids.iter().cloned().collect();
    let mut migrated = 0;
    for file_path in files {
        if rewrite_codex_session_file_for_provider_bucket(
            &file_path,
            codex_dir,
            &source_provider_ids,
            target_provider_id,
            backup_root,
        )? {
            migrated += 1;
        }
    }
    Ok(migrated)
}

fn collect_jsonl_files(dir: &Path, files: &mut Vec<PathBuf>, depth: u8, max_depth: u8) {
    if depth > max_depth || !dir.is_dir() {
        return;
    }

    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(err) => {
            log::debug!(
                "Failed to read Codex session directory {}: {err}",
                dir.display()
            );
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files, depth + 1, max_depth);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

fn rewrite_codex_session_file_for_provider_bucket(
    path: &Path,
    codex_dir: &Path,
    source_provider_ids: &HashSet<String>,
    target_provider_id: &str,
    backup_root: &Path,
) -> Result<bool, AppError> {
    rewrite_codex_session_file_lines(path, codex_dir, backup_root, |line| {
        rewrite_codex_session_meta_line(line, source_provider_ids, target_provider_id)
    })
}

fn rewrite_codex_session_file_lines(
    path: &Path,
    codex_dir: &Path,
    backup_root: &Path,
    rewrite_line: impl Fn(&str) -> Option<String>,
) -> Result<bool, AppError> {
    let metadata_before = fs::metadata(path).map_err(|e| AppError::io(path, e))?;
    let modified_before = metadata_before.modified().ok();
    let len_before = metadata_before.len();
    let source = fs::File::open(path).map_err(|e| AppError::io(path, e))?;
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Config("Codex 会话文件缺少父目录".to_string()))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| AppError::io(parent, e))?;
    let temp_path = temp.path().to_path_buf();
    let mut changed = false;
    {
        let mut reader = BufReader::new(source);
        let mut writer = BufWriter::new(temp.as_file_mut());
        let mut line = String::new();
        loop {
            line.clear();
            let read = reader
                .read_line(&mut line)
                .map_err(|e| AppError::io(path, e))?;
            if read == 0 {
                break;
            }
            let (body, newline) = if let Some(body) = line.strip_suffix("\r\n") {
                (body, "\r\n")
            } else if let Some(body) = line.strip_suffix('\n') {
                (body, "\n")
            } else {
                (line.as_str(), "")
            };
            if let Some(next_line) = rewrite_line(body) {
                writer
                    .write_all(next_line.as_bytes())
                    .map_err(|e| AppError::io(&temp_path, e))?;
                changed = true;
            } else {
                writer
                    .write_all(body.as_bytes())
                    .map_err(|e| AppError::io(&temp_path, e))?;
            }
            writer
                .write_all(newline.as_bytes())
                .map_err(|e| AppError::io(&temp_path, e))?;
        }
        writer.flush().map_err(|e| AppError::io(&temp_path, e))?;
    }

    if !changed {
        return Ok(false);
    }

    ensure_codex_session_file_unchanged(path, modified_before, len_before)?;
    backup_codex_jsonl_file(path, codex_dir, backup_root)?;
    ensure_codex_session_file_unchanged(path, modified_before, len_before)?;
    #[cfg(unix)]
    if let Ok(meta) = fs::metadata(path) {
        fs::set_permissions(&temp_path, meta.permissions())
            .map_err(|e| AppError::io(&temp_path, e))?;
    }
    temp.persist(path).map_err(|e| AppError::IoContext {
        context: format!("原子替换 Codex 会话文件失败 ({})", path.display()),
        source: e.error,
    })?;
    Ok(true)
}

fn ensure_codex_session_file_unchanged(
    path: &Path,
    modified_before: Option<SystemTime>,
    len_before: u64,
) -> Result<(), AppError> {
    let metadata_after = fs::metadata(path).map_err(|e| AppError::io(path, e))?;
    if metadata_after.modified().ok() != modified_before || metadata_after.len() != len_before {
        return Err(AppError::Message(format!(
            "Codex session file changed during migration: {}",
            path.display()
        )));
    }
    Ok(())
}

fn rewrite_codex_session_meta_line(
    line: &str,
    source_provider_ids: &HashSet<String>,
    target_provider_id: &str,
) -> Option<String> {
    if !line.contains("\"session_meta\"") || !line.contains("\"model_provider\"") {
        return None;
    }

    let mut value: Value = serde_json::from_str(line).ok()?;
    if value.get("type").and_then(Value::as_str) != Some("session_meta") {
        return None;
    }

    let payload = value.get_mut("payload")?.as_object_mut()?;
    let current_provider = payload.get("model_provider")?.as_str()?;
    if !source_provider_ids.contains(current_provider) {
        return None;
    }

    payload.insert(
        "model_provider".to_string(),
        Value::String(target_provider_id.to_string()),
    );
    serde_json::to_string(&value).ok()
}

fn migrate_codex_state_dbs(
    codex_dir: &Path,
    source_provider_ids: &BTreeSet<String>,
    target_provider_id: &str,
    backup_root: &Path,
) -> Result<usize, AppError> {
    let config_text = read_codex_config_text().unwrap_or_default();
    let mut migrated = 0;
    for db_path in codex_state_db_paths(codex_dir, &config_text) {
        match migrate_codex_state_db_provider_bucket(
            &db_path,
            codex_dir,
            source_provider_ids,
            target_provider_id,
            backup_root,
        ) {
            Ok(changed) => migrated += changed,
            Err(err) => log::warn!("跳过不可迁移的 Codex state DB {}: {err}", db_path.display()),
        }
    }
    Ok(migrated)
}

fn codex_state_dbs_have_provider_ids(
    codex_dir: &Path,
    source_provider_ids: &BTreeSet<String>,
) -> Result<bool, AppError> {
    if source_provider_ids.is_empty() {
        return Ok(false);
    }

    let config_text = read_codex_config_text().unwrap_or_default();
    for db_path in codex_state_db_paths(codex_dir, &config_text) {
        match codex_state_db_has_provider_ids(&db_path, source_provider_ids) {
            Ok(true) => return Ok(true),
            Ok(false) => {}
            Err(err) => log::warn!("跳过不可检查的 Codex state DB {}: {err}", db_path.display()),
        }
    }
    Ok(false)
}

fn codex_state_db_has_provider_ids(
    db_path: &Path,
    source_provider_ids: &BTreeSet<String>,
) -> Result<bool, AppError> {
    if !db_path.exists() || source_provider_ids.is_empty() {
        return Ok(false);
    }

    let conn = Connection::open(db_path)
        .map_err(|e| AppError::Database(format!("打开 Codex state DB 失败: {e}")))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| AppError::Database(format!("设置 Codex state DB busy_timeout 失败: {e}")))?;

    if !Database::table_exists(&conn, "threads")?
        || !Database::has_column(&conn, "threads", "model_provider")?
    {
        return Ok(false);
    }

    let placeholders = placeholders(source_provider_ids.len());
    let count_sql =
        format!("SELECT COUNT(*) FROM threads WHERE model_provider IN ({placeholders})");
    let matching_rows: i64 = conn
        .query_row(
            &count_sql,
            params_from_iter(source_provider_ids.iter()),
            |row| row.get(0),
        )
        .map_err(|e| AppError::Database(format!("统计 Codex state DB 待迁移行失败: {e}")))?;
    Ok(matching_rows > 0)
}

fn migrate_codex_state_db_provider_bucket(
    db_path: &Path,
    codex_dir: &Path,
    source_provider_ids: &BTreeSet<String>,
    target_provider_id: &str,
    backup_root: &Path,
) -> Result<usize, AppError> {
    if !db_path.exists() || source_provider_ids.is_empty() {
        return Ok(0);
    }

    let mut conn = Connection::open(db_path)
        .map_err(|e| AppError::Database(format!("打开 Codex state DB 失败: {e}")))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| AppError::Database(format!("设置 Codex state DB busy_timeout 失败: {e}")))?;

    if !Database::table_exists(&conn, "threads")?
        || !Database::has_column(&conn, "threads", "model_provider")?
    {
        return Ok(0);
    }

    let placeholders = placeholders(source_provider_ids.len());
    let count_sql =
        format!("SELECT COUNT(*) FROM threads WHERE model_provider IN ({placeholders})");
    let matching_rows: i64 = conn
        .query_row(
            &count_sql,
            params_from_iter(source_provider_ids.iter()),
            |row| row.get(0),
        )
        .map_err(|e| AppError::Database(format!("统计 Codex state DB 待迁移行失败: {e}")))?;
    log::info!(
        "Codex state DB migration candidate rows: path={}, rows={}, sources={:?}",
        db_path.display(),
        matching_rows,
        source_provider_ids
    );
    if matching_rows == 0 {
        return Ok(0);
    }

    backup_codex_state_db(db_path, codex_dir, backup_root, &conn)?;

    let update_sql =
        format!("UPDATE threads SET model_provider = ? WHERE model_provider IN ({placeholders})");
    let mut values = Vec::with_capacity(source_provider_ids.len() + 1);
    values.push(target_provider_id.to_string());
    values.extend(source_provider_ids.iter().cloned());
    let tx = conn
        .transaction()
        .map_err(|e| AppError::Database(format!("开启 Codex state DB 迁移事务失败: {e}")))?;
    let changed = tx
        .execute(&update_sql, params_from_iter(values.iter()))
        .map_err(|e| AppError::Database(format!("迁移 Codex state DB provider 失败: {e}")))?;
    log::info!(
        "Codex state DB migration changed rows: path={}, rows={}",
        db_path.display(),
        changed
    );
    tx.commit()
        .map_err(|e| AppError::Database(format!("提交 Codex state DB 迁移事务失败: {e}")))?;
    Ok(changed)
}

fn placeholders(count: usize) -> String {
    std::iter::repeat_n("?", count)
        .collect::<Vec<_>>()
        .join(", ")
}

fn backup_codex_jsonl_file(
    path: &Path,
    codex_dir: &Path,
    backup_root: &Path,
) -> Result<(), AppError> {
    let backup_path = backup_root
        .join("jsonl")
        .join(relative_backup_path(path, codex_dir));
    copy_existing_file(path, &backup_path)
}

fn backup_codex_state_db(
    db_path: &Path,
    codex_dir: &Path,
    backup_root: &Path,
    source_conn: &Connection,
) -> Result<(), AppError> {
    let backup_path = backup_root
        .join("state")
        .join(relative_backup_path(db_path, codex_dir));
    if let Some(parent) = backup_path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }
    let mut destination = Connection::open(&backup_path)
        .map_err(|e| AppError::Database(format!("创建 Codex state DB 备份失败: {e}")))?;
    let backup = Backup::new(source_conn, &mut destination)
        .map_err(|e| AppError::Database(format!("初始化 Codex state DB 在线备份失败: {e}")))?;
    backup
        .run_to_completion(128, Duration::from_millis(10), None)
        .map_err(|e| AppError::Database(format!("执行 Codex state DB 在线备份失败: {e}")))?;
    Ok(())
}

fn backup_provider_settings_config(
    provider_id: &str,
    settings_config: &Value,
    backup_root: &Path,
) -> Result<(), AppError> {
    let backup_path = backup_root
        .join("providers")
        .join(provider_settings_backup_filename(provider_id));
    if let Some(parent) = backup_path.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }

    let payload = serde_json::json!({
        "providerId": provider_id,
        "settingsConfig": settings_config,
    });
    let bytes =
        serde_json::to_vec_pretty(&payload).map_err(|e| AppError::JsonSerialize { source: e })?;
    atomic_write(&backup_path, &bytes)
}

fn provider_settings_backup_filename(provider_id: &str) -> String {
    let safe_id: String = provider_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let safe_id = if safe_id.is_empty() {
        "provider".to_string()
    } else {
        safe_id
    };
    // Keep the hash stable across processes while avoiding collisions after sanitization.
    let digest = Sha256::digest(provider_id.as_bytes());
    let hash = digest[..8]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{hash}-{safe_id}.settings_config.json")
}

fn copy_existing_file(source: &Path, target: &Path) -> Result<(), AppError> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| AppError::io(parent, e))?;
    }
    copy_file(source, target)
}

fn relative_backup_path(path: &Path, root: &Path) -> PathBuf {
    if let Ok(relative) = path.strip_prefix(root) {
        return relative.to_path_buf();
    }

    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    let hash = hasher.finish();
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    PathBuf::from("external").join(format!("{hash:016x}-{file_name}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codex_state_db::CODEX_STATE_DB_FILENAME;
    use crate::provider::Provider;
    use serial_test::serial;
    use std::ffi::OsString;
    use tempfile::tempdir;

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<OsString>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &Path) -> Self {
            let previous = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            if let Some(previous) = &self.previous {
                std::env::set_var(self.key, previous);
            } else {
                std::env::remove_var(self.key);
            }
        }
    }

    fn source_ids(values: &[&str]) -> BTreeSet<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn detects_custom_routed_codex_config_for_unify_gate() {
        // 注入产物（官方 + 统一开关）
        assert!(codex_config_text_routes_custom(
            r#"model_provider = "tuziswitch"

[model_providers.tuziswitch]
name = "OpenAI"
requires_openai_auth = true
supports_websockets = true
wire_api = "responses"
"#
        ));
        // 第三方供应商的常规 custom 路由（带 base_url）同样算已统一
        assert!(codex_config_text_routes_custom(
            r#"model_provider = "tuziswitch"

[model_providers.tuziswitch]
name = "AIHubMix"
base_url = "https://aihubmix.example/v1"
"#
        ));
        // 注入被拒的形态：显式 openai 路由 / 无 model_provider（接管期间、空配置）
        assert!(!codex_config_text_routes_custom(
            "model_provider = \"openai\"\n"
        ));
        assert!(!codex_config_text_routes_custom(
            "base_url = \"http://127.0.0.1:15721/codex\"\n"
        ));
        assert!(!codex_config_text_routes_custom(""));
        assert!(!codex_config_text_routes_custom("not toml ["));
    }

    fn migrate_provider_templates_for_test(
        db: &Database,
    ) -> (
        CodexProviderTemplateBucketMigrationOutcome,
        tempfile::TempDir,
    ) {
        let backup_dir = tempdir().expect("backup dir");
        let outcome = migrate_codex_provider_templates_to_anchor(
            db,
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
            backup_dir.path(),
        )
        .expect("migrate template");
        (outcome, backup_dir)
    }

    #[test]
    fn simulates_local_codex_provider_bucket_migration_end_to_end() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        let backup_root = dir.path().join("backup");
        fs::create_dir_all(&codex_dir).expect("create codex dir");

        let db = Database::memory().expect("memory db");
        let providers = [
            Provider::with_id(
                "rightcode".to_string(),
                "RightCode".to_string(),
                serde_json::json!({
                    "auth": {},
                    "config": r#"model_provider = "aihubmix"

[model_providers.aihubmix]
name = "AIHubMix"
base_url = "https://aihubmix.example/v1"
"#
                }),
                None,
            ),
            Provider::with_id(
                "legacy-ccswitch".to_string(),
                "Legacy CC Switch".to_string(),
                serde_json::json!({
                    "auth": {},
                    "config": r#"model_provider = "ccswitch"

[model_providers.ccswitch]
name = "AIHubMix"
base_url = "https://aihubmix.example/v1"
"#
                }),
                None,
            ),
            Provider::with_id(
                "normalized-aihubmix".to_string(),
                "Already Normalized".to_string(),
                serde_json::json!({
                    "auth": {},
                    "config": r#"model_provider = "tuziswitch"

[model_providers.tuziswitch]
name = "AIHubMix"
base_url = "https://aihubmix.example/v1"
"#
                }),
                None,
            ),
            Provider::with_id(
                "manual-relay".to_string(),
                "Manual Relay".to_string(),
                serde_json::json!({
                    "auth": {},
                    "config": r#"model_provider = "my-private-relay"

[model_providers.my-private-relay]
name = "Manual Relay"
base_url = "http://localhost:8080/v1"
"#
                }),
                None,
            ),
            Provider::with_id(
                "custom-openai".to_string(),
                "Custom OpenAI".to_string(),
                serde_json::json!({
                    "auth": {},
                    "config": r#"model_provider = "openai"

[model_providers.openai]
name = "Custom OpenAI"
base_url = "https://proxy.example/v1"
"#
                }),
                None,
            ),
        ];
        for provider in providers {
            db.save_provider("codex", &provider).expect("save provider");
        }

        let mut official = Provider::with_id(
            "codex-official".to_string(),
            "OpenAI Official".to_string(),
            serde_json::json!({"auth": {}, "config": "model_provider = \"openai\""}),
            None,
        );
        official.category = Some("official".to_string());
        db.save_provider("codex", &official).expect("save official");

        let source_provider_ids =
            collect_source_model_provider_ids(&db, CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
                .expect("collect ids");
        assert_eq!(
            source_provider_ids,
            source_ids(&["aihubmix", "ccswitch", "rightcode"])
        );

        let session_dir = codex_dir.join("sessions/2026/05/28");
        fs::create_dir_all(&session_dir).expect("create session dir");
        let session_path = session_dir.join("local-sim.jsonl");
        fs::write(
            &session_path,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"rightcode\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s2\",\"model_provider\":\"aihubmix\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s3\",\"model_provider\":\"ccswitch\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s4\",\"model_provider\":\"my-private-relay\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s5\",\"model_provider\":\"openai\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s6\",\"model_provider\":\"tuziswitch\"}}\n",
            ),
        )
        .expect("write session");

        let migrated_jsonl = migrate_codex_jsonl_files(
            &codex_dir,
            &source_provider_ids,
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
            &backup_root,
        )
        .expect("migrate jsonl");
        assert_eq!(migrated_jsonl, 1);
        let session_text = fs::read_to_string(&session_path).expect("read session");
        assert_eq!(
            session_text
                .matches("\"model_provider\":\"tuziswitch\"")
                .count(),
            4
        );
        assert!(session_text.contains("\"model_provider\":\"my-private-relay\""));
        assert!(session_text.contains("\"model_provider\":\"openai\""));
        assert!(backup_root
            .join("jsonl/sessions/2026/05/28/local-sim.jsonl")
            .exists());

        let state_db_path = codex_dir.join(CODEX_STATE_DB_FILENAME);
        let conn = Connection::open(&state_db_path).expect("open state db");
        conn.execute_batch(
            "CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                model_provider TEXT NOT NULL
            );
            INSERT INTO threads (id, model_provider) VALUES
                ('rightcode-thread', 'rightcode'),
                ('aihubmix-thread', 'aihubmix'),
                ('ccswitch-thread', 'ccswitch'),
                ('manual-thread', 'my-private-relay'),
                ('openai-thread', 'openai'),
                ('custom-thread', 'tuziswitch');",
        )
        .expect("seed state db");
        drop(conn);

        let migrated_state_rows = migrate_codex_state_db_provider_bucket(
            &state_db_path,
            &codex_dir,
            &source_provider_ids,
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
            &backup_root,
        )
        .expect("migrate state db");
        assert_eq!(migrated_state_rows, 3);

        let conn = Connection::open(&state_db_path).expect("reopen state db");
        let count_provider = |provider_id: &str| -> i64 {
            conn.query_row(
                "SELECT COUNT(*) FROM threads WHERE model_provider = ?1",
                [provider_id],
                |row| row.get(0),
            )
            .expect("count provider")
        };
        assert_eq!(count_provider("tuziswitch"), 4);
        assert_eq!(count_provider("my-private-relay"), 1);
        assert_eq!(count_provider("openai"), 1);
        assert!(backup_root
            .join("state")
            .join(CODEX_STATE_DB_FILENAME)
            .exists());
        drop(conn);

        let template_outcome = migrate_codex_provider_templates_to_anchor(
            &db,
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
            &backup_root,
        )
        .expect("migrate provider templates");
        assert!(!template_outcome
            .migrated_provider_ids
            .iter()
            .any(|id| id == "normalized-aihubmix"));
        assert_eq!(
            source_ids(
                &template_outcome
                    .migrated_provider_ids
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>()
            ),
            source_ids(&["legacy-ccswitch", "rightcode"])
        );

        let config_provider_id = |provider_id: &str| -> String {
            db.get_provider_by_id(provider_id, "codex")
                .expect("get provider")
                .expect("provider exists")
                .settings_config
                .get("config")
                .and_then(Value::as_str)
                .expect("config text")
                .to_string()
        };

        let rightcode_config: toml::Value =
            toml::from_str(&config_provider_id("rightcode")).expect("parse rightcode config");
        assert_eq!(
            rightcode_config
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("tuziswitch")
        );
        assert!(rightcode_config
            .get("model_providers")
            .and_then(|value| value.get("aihubmix"))
            .is_none());

        let ccswitch_config: toml::Value =
            toml::from_str(&config_provider_id("legacy-ccswitch")).expect("parse ccswitch config");
        assert_eq!(
            ccswitch_config
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("tuziswitch")
        );
        assert!(ccswitch_config
            .get("model_providers")
            .and_then(|value| value.get("ccswitch"))
            .is_none());

        let manual_config: toml::Value =
            toml::from_str(&config_provider_id("manual-relay")).expect("parse manual config");
        assert_eq!(
            manual_config
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("my-private-relay")
        );

        let openai_config: toml::Value =
            toml::from_str(&config_provider_id("custom-openai")).expect("parse openai config");
        assert_eq!(
            openai_config
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("openai")
        );

        let normalized_config: toml::Value =
            toml::from_str(&config_provider_id("normalized-aihubmix"))
                .expect("parse normalized config");
        assert_eq!(
            normalized_config
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("tuziswitch")
        );
    }

    #[test]
    fn reconciles_legacy_unified_bucket_to_existing_local_anchor() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        let backup_root = dir.path().join("backup");
        fs::create_dir_all(codex_dir.join("sessions/2026/08/17")).expect("create session dir");

        let db = Database::memory().expect("memory db");
        let provider = Provider::with_id(
            "codex-live-config".to_string(),
            "Current Codex Config".to_string(),
            serde_json::json!({
                "auth": {},
                "config": r#"model_provider = "tuziswitch"

[model_providers.tuziswitch]
name = "RightCode"
base_url = "https://rightcode.example/v1"
env_key = "RIGHTCODE_API_KEY"
"#
            }),
            None,
        );
        db.save_provider("codex", &provider).expect("save provider");

        let session_path = codex_dir
            .join("sessions/2026/08/17")
            .join("rollout-rightcode.jsonl");
        fs::write(
            &session_path,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"legacy\",\"model_provider\":\"tuziswitch\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"native\",\"model_provider\":\"rightcode\"}}\n",
            ),
        )
        .expect("write session");

        let state_db_path = codex_dir.join(CODEX_STATE_DB_FILENAME);
        let conn = Connection::open(&state_db_path).expect("open state db");
        conn.execute_batch(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT NOT NULL);
             INSERT INTO threads VALUES ('legacy', 'tuziswitch');
             INSERT INTO threads VALUES ('native', 'rightcode');",
        )
        .expect("seed state db");
        drop(conn);

        let target = "rightcode";
        let source_provider_ids =
            collect_source_model_provider_ids(&db, target).expect("collect migration sources");
        assert!(source_provider_ids.contains(CC_SWITCH_CODEX_MODEL_PROVIDER_ID));
        assert!(!source_provider_ids.contains(target));

        assert_eq!(
            migrate_codex_jsonl_files(&codex_dir, &source_provider_ids, target, &backup_root,)
                .expect("migrate jsonl"),
            1
        );
        assert_eq!(
            migrate_codex_state_db_provider_bucket(
                &state_db_path,
                &codex_dir,
                &source_provider_ids,
                target,
                &backup_root,
            )
            .expect("migrate state db"),
            1
        );
        let template_outcome =
            migrate_codex_provider_templates_to_anchor(&db, target, &backup_root)
                .expect("migrate provider template");
        assert_eq!(
            template_outcome.migrated_provider_ids,
            vec!["codex-live-config".to_string()]
        );

        let session_text = fs::read_to_string(&session_path).expect("read session");
        assert_eq!(
            session_text
                .matches("\"model_provider\":\"rightcode\"")
                .count(),
            2
        );
        assert!(!session_text.contains("\"model_provider\":\"tuziswitch\""));

        let conn = Connection::open(&state_db_path).expect("reopen state db");
        let mismatched: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM threads WHERE model_provider != 'rightcode'",
                [],
                |row| row.get(0),
            )
            .expect("count mismatched state rows");
        assert_eq!(mismatched, 0);

        let saved = db
            .get_provider_by_id("codex-live-config", "codex")
            .expect("query provider")
            .expect("provider exists");
        let saved_config = saved
            .settings_config
            .get("config")
            .and_then(Value::as_str)
            .expect("saved config");
        let parsed: toml::Value = toml::from_str(saved_config).expect("parse saved config");
        assert_eq!(
            parsed
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some(target)
        );
        assert!(parsed
            .get("model_providers")
            .and_then(|providers| providers.get(target))
            .is_some());
    }

    #[test]
    fn simulates_official_history_unify_migration_end_to_end() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        let backup_root = dir.path().join("backup");
        fs::create_dir_all(&codex_dir).expect("create codex dir");

        let source_provider_ids = source_ids(&[
            OFFICIAL_OPENAI_CODEX_MODEL_PROVIDER_ID,
            OFFICIAL_CODEX_MODEL_PROVIDER_ID,
        ]);

        let session_dir = codex_dir.join("sessions/2026/06/12");
        fs::create_dir_all(&session_dir).expect("create session dir");
        let session_path = session_dir.join("official-sim.jsonl");
        fs::write(
            &session_path,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"openai\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s-new\",\"model_provider\":\"codex\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s2\",\"model_provider\":\"tuziswitch\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s3\",\"model_provider\":\"my-private-relay\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"text\":\"openai\"}}\n",
            ),
        )
        .expect("write session");

        let migrated_jsonl = migrate_codex_jsonl_files(
            &codex_dir,
            &source_provider_ids,
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
            &backup_root,
        )
        .expect("migrate jsonl");
        assert_eq!(migrated_jsonl, 1);
        let session_text = fs::read_to_string(&session_path).expect("read session");
        assert_eq!(
            session_text
                .matches("\"model_provider\":\"tuziswitch\"")
                .count(),
            3
        );
        assert!(!session_text.contains("\"model_provider\":\"openai\""));
        assert!(!session_text.contains("\"model_provider\":\"codex\""));
        assert!(session_text.contains("\"model_provider\":\"my-private-relay\""));
        assert!(
            session_text.contains("{\"type\":\"response_item\",\"payload\":{\"text\":\"openai\"}}")
        );
        assert!(backup_root
            .join("jsonl/sessions/2026/06/12/official-sim.jsonl")
            .exists());

        // 第二次执行应当无事可做（幂等）
        let rerun = migrate_codex_jsonl_files(
            &codex_dir,
            &source_provider_ids,
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
            &backup_root,
        )
        .expect("rerun migrate jsonl");
        assert_eq!(rerun, 0);

        let state_db_path = codex_dir.join(CODEX_STATE_DB_FILENAME);
        let conn = Connection::open(&state_db_path).expect("open state db");
        conn.execute_batch(
            "CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                model_provider TEXT NOT NULL
            );
            INSERT INTO threads (id, model_provider) VALUES
                ('openai-thread', 'openai'),
                ('codex-thread', 'codex'),
                ('custom-thread', 'tuziswitch'),
                ('manual-thread', 'my-private-relay');",
        )
        .expect("seed state db");
        drop(conn);

        let migrated_state_rows = migrate_codex_state_db_provider_bucket(
            &state_db_path,
            &codex_dir,
            &source_provider_ids,
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
            &backup_root,
        )
        .expect("migrate state db");
        assert_eq!(migrated_state_rows, 2);

        let conn = Connection::open(&state_db_path).expect("reopen state db");
        let count_provider = |provider_id: &str| -> i64 {
            conn.query_row(
                "SELECT COUNT(*) FROM threads WHERE model_provider = ?1",
                [provider_id],
                |row| row.get(0),
            )
            .expect("count provider")
        };
        assert_eq!(count_provider("tuziswitch"), 3);
        assert_eq!(count_provider("openai"), 0);
        assert_eq!(count_provider("codex"), 0);
        assert_eq!(count_provider("my-private-relay"), 1);
    }

    #[test]
    fn restores_only_ledgered_official_sessions_from_backups() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        let ledger_parent = dir.path().join("ledger");
        let restore_backup_root = dir.path().join("restore-backup");

        // 备份账本保留原桶：旧版 openai 与新版 codex 都应精确还原。
        let generation = ledger_parent.join("20260612_010101");
        let backup_session_dir = generation.join("jsonl/sessions/2026/06/01");
        fs::create_dir_all(&backup_session_dir).expect("create backup session dir");
        fs::write(
            backup_session_dir.join("official.jsonl"),
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"openai\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s-codex\",\"model_provider\":\"codex\"}}\n",
            ),
        )
        .expect("write backup session");
        let backup_state_dir = generation.join("state");
        fs::create_dir_all(&backup_state_dir).expect("create backup state dir");
        let backup_db = Connection::open(backup_state_dir.join(CODEX_STATE_DB_FILENAME))
            .expect("open backup db");
        backup_db
            .execute_batch(
                "CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT NOT NULL);
                INSERT INTO threads (id, model_provider) VALUES
                    ('t1', 'openai'),
                    ('t-codex', 'codex');",
            )
            .expect("seed backup db");
        drop(backup_db);

        // 当前数据：s1（账本内，custom）应还原；s2（开启期间新会话，不在账本）
        // 与 s3（手工 relay）必须原样保留
        let session_dir = codex_dir.join("sessions/2026/06/01");
        fs::create_dir_all(&session_dir).expect("create session dir");
        let official_path = session_dir.join("official.jsonl");
        fs::write(
            &official_path,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"tuziswitch\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s-codex\",\"model_provider\":\"tuziswitch\"}}\n",
            ),
        )
        .expect("write official session");
        let on_period_dir = codex_dir.join("sessions/2026/06/12");
        fs::create_dir_all(&on_period_dir).expect("create on-period dir");
        let on_period_path = on_period_dir.join("on-period.jsonl");
        fs::write(
            &on_period_path,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s2\",\"model_provider\":\"tuziswitch\"}}\n",
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s3\",\"model_provider\":\"my-private-relay\"}}\n",
            ),
        )
        .expect("write on-period session");

        let state_db_path = codex_dir.join(CODEX_STATE_DB_FILENAME);
        let conn = Connection::open(&state_db_path).expect("open state db");
        conn.execute_batch(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, model_provider TEXT NOT NULL);
            INSERT INTO threads (id, model_provider) VALUES
                ('t1', 'tuziswitch'),
                ('t-codex', 'tuziswitch'),
                ('t2', 'tuziswitch'),
                ('t3', 'openai');",
        )
        .expect("seed state db");
        drop(conn);

        // 代际 meta 指向当前 Codex 目录：精确匹配分支生效（而非无 meta 的宽容分支）
        fs::write(
            generation.join("meta.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "codexConfigDir": canonical_dir_string(&codex_dir)
            }))
            .expect("serialize meta"),
        )
        .expect("write meta");

        let outcome = restore_codex_official_history_inner(
            &codex_dir,
            &ledger_parent,
            &restore_backup_root,
            "",
        )
        .expect("restore");
        assert_eq!(outcome.restored_jsonl_files, 1);
        assert_eq!(outcome.restored_state_rows, 2);
        assert!(outcome.skipped_reason.is_none());

        let official_text = fs::read_to_string(&official_path).expect("read official");
        assert!(official_text.contains("\"model_provider\":\"openai\""));
        assert!(official_text.contains("\"id\":\"s-codex\",\"model_provider\":\"codex\""));
        let on_period_text = fs::read_to_string(&on_period_path).expect("read on-period");
        assert!(on_period_text.contains("\"id\":\"s2\",\"model_provider\":\"tuziswitch\""));
        assert!(on_period_text.contains("\"model_provider\":\"my-private-relay\""));

        let conn = Connection::open(&state_db_path).expect("reopen state db");
        let provider_of = |thread_id: &str| -> String {
            conn.query_row(
                "SELECT model_provider FROM threads WHERE id = ?1",
                [thread_id],
                |row| row.get(0),
            )
            .expect("thread provider")
        };
        assert_eq!(provider_of("t1"), "openai");
        assert_eq!(provider_of("t-codex"), "codex");
        assert_eq!(provider_of("t2"), "tuziswitch");
        assert_eq!(provider_of("t3"), "openai");
        drop(conn);

        // 还原前的现场已备份到独立目录
        assert!(restore_backup_root
            .join("jsonl/sessions/2026/06/01/official.jsonl")
            .exists());
        assert!(restore_backup_root
            .join("state")
            .join(CODEX_STATE_DB_FILENAME)
            .exists());

        // 幂等：第二次还原无事可做
        let rerun = restore_codex_official_history_inner(
            &codex_dir,
            &ledger_parent,
            &dir.path().join("restore-backup-2"),
            "",
        )
        .expect("rerun restore");
        assert_eq!(rerun.restored_jsonl_files, 0);
        assert_eq!(rerun.restored_state_rows, 0);
        assert_eq!(rerun.skipped_reason.as_deref(), Some("nothing_to_restore"));
    }

    #[test]
    fn restore_ignores_backup_generations_from_other_codex_dirs() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        let ledger_parent = dir.path().join("ledger");

        // 账本代际属于另一个 Codex 目录
        let generation = ledger_parent.join("20260612_010101");
        let backup_session_dir = generation.join("jsonl/sessions/2026/06/01");
        fs::create_dir_all(&backup_session_dir).expect("create backup session dir");
        fs::write(
            backup_session_dir.join("official.jsonl"),
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"openai\"}}\n",
        )
        .expect("write backup session");
        fs::write(
            generation.join("meta.json"),
            "{\n  \"codexConfigDir\": \"/some/other/codex-dir\"\n}",
        )
        .expect("write meta");

        let session_dir = codex_dir.join("sessions/2026/06/01");
        fs::create_dir_all(&session_dir).expect("create session dir");
        let session_path = session_dir.join("official.jsonl");
        fs::write(
            &session_path,
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"tuziswitch\"}}\n",
        )
        .expect("write session");

        let outcome = restore_codex_official_history_inner(
            &codex_dir,
            &ledger_parent,
            &dir.path().join("restore-backup"),
            "",
        )
        .expect("restore");
        assert_eq!(outcome.skipped_reason.as_deref(), Some("no_backup_ledger"));
        let text = fs::read_to_string(&session_path).expect("read session");
        assert!(text.contains("\"model_provider\":\"tuziswitch\""));
    }

    #[test]
    fn backup_probe_only_counts_generations_for_current_dir() {
        let dir = tempdir().expect("tempdir");
        let ledger_parent = dir.path().join("ledger");
        let codex_dir_key = "/current/codex-dir";

        // 空父目录 / 父目录不存在：无备份
        assert!(!has_official_history_unify_backup_for_dir(
            &ledger_parent,
            codex_dir_key
        ));

        // 只有其他目录的代际：不算有备份
        let other = ledger_parent.join("20260612_010101");
        fs::create_dir_all(&other).expect("create generation");
        fs::write(
            other.join("meta.json"),
            "{\n  \"codexConfigDir\": \"/some/other/codex-dir\"\n}",
        )
        .expect("write meta");
        assert!(!has_official_history_unify_backup_for_dir(
            &ledger_parent,
            codex_dir_key
        ));

        // 无 meta 的早期代际：宽容接受（与 restore 的账本口径一致）
        fs::create_dir_all(ledger_parent.join("20260612_020202")).expect("create legacy gen");
        assert!(has_official_history_unify_backup_for_dir(
            &ledger_parent,
            codex_dir_key
        ));

        // 精确匹配当前目录的代际
        fs::remove_dir_all(ledger_parent.join("20260612_020202")).expect("remove legacy gen");
        let matched = ledger_parent.join("20260612_030303");
        fs::create_dir_all(&matched).expect("create matched gen");
        fs::write(
            matched.join("meta.json"),
            format!("{{\n  \"codexConfigDir\": \"{codex_dir_key}\"\n}}"),
        )
        .expect("write matched meta");
        assert!(has_official_history_unify_backup_for_dir(
            &ledger_parent,
            codex_dir_key
        ));
    }

    #[test]
    fn restore_skips_when_no_backup_ledger_exists() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        let session_dir = codex_dir.join("sessions/2026/06/01");
        fs::create_dir_all(&session_dir).expect("create session dir");
        fs::write(
            session_dir.join("session.jsonl"),
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"tuziswitch\"}}\n",
        )
        .expect("write session");

        let outcome = restore_codex_official_history_inner(
            &codex_dir,
            &dir.path().join("missing-ledger"),
            &dir.path().join("restore-backup"),
            "",
        )
        .expect("restore");
        assert_eq!(outcome.skipped_reason.as_deref(), Some("no_backup_ledger"));
        assert_eq!(outcome.restored_jsonl_files, 0);
        assert_eq!(outcome.restored_state_rows, 0);

        let text = fs::read_to_string(session_dir.join("session.jsonl")).expect("read session");
        assert!(text.contains("\"model_provider\":\"tuziswitch\""));
    }

    #[test]
    fn rewrites_only_codex_session_meta_provider_ids() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        let backup_root = dir.path().join("backup");
        let session_dir = codex_dir.join("sessions/2026/05/20");
        fs::create_dir_all(&session_dir).expect("create session dir");
        let path = session_dir.join("rollout-test.jsonl");
        fs::write(
            &path,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"rightcode\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":\"hi\"}}\n"
            ),
        )
        .expect("write session");

        let changed = rewrite_codex_session_file_for_provider_bucket(
            &path,
            &codex_dir,
            &HashSet::from(["rightcode".to_string()]),
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
            &backup_root,
        )
        .expect("rewrite");

        assert!(changed);
        let next = fs::read_to_string(&path).expect("read rewritten");
        assert!(next.contains("\"model_provider\":\"tuziswitch\""));
        assert!(backup_root
            .join("jsonl/sessions/2026/05/20/rollout-test.jsonl")
            .exists());
    }

    #[test]
    fn does_not_rewrite_unknown_jsonl_history_without_trusted_source_id() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        let session_dir = codex_dir.join("sessions/2026/05/20");
        fs::create_dir_all(&session_dir).expect("create session dir");
        let path = session_dir.join("rollout-rightcode.jsonl");
        fs::write(
            &path,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s1\",\"model_provider\":\"rightcode\"}}\n",
                "{\"type\":\"response_item\",\"payload\":{\"type\":\"message\",\"role\":\"user\",\"content\":\"hi\"}}\n"
            ),
        )
        .expect("write session");

        let backup_root = dir.path().join("backup");
        let changed = migrate_codex_jsonl_files(
            &codex_dir,
            &source_ids(&["some-trusted-provider"]),
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
            &backup_root,
        )
        .expect("migrate jsonl");

        assert_eq!(changed, 0);
        let next = fs::read_to_string(&path).expect("read session");
        assert!(next.contains("\"model_provider\":\"rightcode\""));
        assert!(!backup_root.exists());
    }

    #[test]
    fn does_not_update_unknown_state_db_history_without_trusted_source_id() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        fs::create_dir_all(&codex_dir).expect("create codex dir");
        let db_path = codex_dir.join(CODEX_STATE_DB_FILENAME);
        let conn = Connection::open(&db_path).expect("open db");
        conn.execute_batch(
            "CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                model_provider TEXT NOT NULL
            );
            INSERT INTO threads (id, model_provider) VALUES
                ('a', 'aihubmix'),
                ('b', 'openai'),
                ('c', 'tuziswitch');",
        )
        .expect("seed db");
        drop(conn);

        let backup_root = dir.path().join("backup");
        let changed = migrate_codex_state_db_provider_bucket(
            &db_path,
            &codex_dir,
            &source_ids(&["rightcode"]),
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
            &backup_root,
        )
        .expect("migrate state db");

        assert_eq!(changed, 0);
        let conn = Connection::open(&db_path).expect("reopen db");
        let aihubmix_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM threads WHERE model_provider = 'aihubmix'",
                [],
                |row| row.get(0),
            )
            .expect("count aihubmix");
        assert_eq!(aihubmix_count, 1);
        assert!(!backup_root.exists());
    }

    #[test]
    fn updates_codex_state_db_thread_provider_ids() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        fs::create_dir_all(&codex_dir).expect("create codex dir");
        let db_path = codex_dir.join(CODEX_STATE_DB_FILENAME);
        let conn = Connection::open(&db_path).expect("open db");
        conn.execute_batch(
            "CREATE TABLE threads (
                id TEXT PRIMARY KEY,
                model_provider TEXT NOT NULL
            );
            INSERT INTO threads (id, model_provider) VALUES
                ('a', 'rightcode'),
                ('b', 'openai'),
                ('c', 'aihubmix');",
        )
        .expect("seed db");
        drop(conn);

        let backup_root = dir.path().join("backup");
        let changed = migrate_codex_state_db_provider_bucket(
            &db_path,
            &codex_dir,
            &source_ids(&["rightcode", "aihubmix"]),
            CC_SWITCH_CODEX_MODEL_PROVIDER_ID,
            &backup_root,
        )
        .expect("migrate state db");

        assert_eq!(changed, 2);
        let conn = Connection::open(&db_path).expect("reopen db");
        let custom_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM threads WHERE model_provider = 'tuziswitch'",
                [],
                |row| row.get(0),
            )
            .expect("count custom");
        let openai_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM threads WHERE model_provider = 'openai'",
                [],
                |row| row.get(0),
            )
            .expect("count openai");
        assert_eq!(custom_count, 2);
        assert_eq!(openai_count, 1);

        let backup_path = backup_root.join("state").join(CODEX_STATE_DB_FILENAME);
        let backup_conn = Connection::open(&backup_path).expect("open backup db");
        let backed_up_source_count: i64 = backup_conn
            .query_row(
                "SELECT COUNT(*) FROM threads WHERE model_provider IN ('rightcode', 'aihubmix')",
                [],
                |row| row.get(0),
            )
            .expect("count backed up source providers");
        assert_eq!(backed_up_source_count, 2);
    }

    #[test]
    #[serial]
    fn state_db_paths_include_codex_sqlite_home_env() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        let sqlite_home = dir.path().join("sqlite-home");
        let _guard = EnvVarGuard::set("CODEX_SQLITE_HOME", &sqlite_home);

        let paths = codex_state_db_paths(&codex_dir, "");

        assert_eq!(
            paths,
            vec![
                codex_dir.join(CODEX_STATE_DB_FILENAME),
                codex_dir.join("sqlite").join(CODEX_STATE_DB_FILENAME),
                sqlite_home.join(CODEX_STATE_DB_FILENAME),
            ]
        );
    }

    #[test]
    #[serial]
    fn config_sqlite_home_takes_precedence_over_codex_sqlite_home_env() {
        let dir = tempdir().expect("tempdir");
        let codex_dir = dir.path().join(".codex");
        let env_sqlite_home = dir.path().join("env-sqlite-home");
        let config_sqlite_home = dir.path().join("config-sqlite-home");
        let _guard = EnvVarGuard::set("CODEX_SQLITE_HOME", &env_sqlite_home);
        let config_text = format!("sqlite_home = \"{}\"\n", config_sqlite_home.display());

        let paths = codex_state_db_paths(&codex_dir, &config_text);

        assert_eq!(
            paths,
            vec![
                codex_dir.join(CODEX_STATE_DB_FILENAME),
                codex_dir.join("sqlite").join(CODEX_STATE_DB_FILENAME),
                config_sqlite_home.join(CODEX_STATE_DB_FILENAME),
            ]
        );
    }

    #[test]
    fn collects_third_party_provider_ids_from_codex_providers() {
        let db = Database::memory().expect("memory db");
        let third_party = Provider::with_id(
            "rightcode".to_string(),
            "RightCode".to_string(),
            serde_json::json!({
                "auth": {},
                "config": "model_provider = \"aihubmix\"\n\n[model_providers.aihubmix]\nname = \"AIHubMix\"\nbase_url = \"https://example.com/v1\""
            }),
            None,
        );
        let mut official = Provider::with_id(
            "codex-official".to_string(),
            "OpenAI Official".to_string(),
            serde_json::json!({"auth": {}, "config": "model_provider = \"openai\""}),
            None,
        );
        official.category = Some("official".to_string());

        db.save_provider("codex", &third_party)
            .expect("save third-party");
        db.save_provider("codex", &official).expect("save official");

        let ids = collect_source_model_provider_ids(&db, CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
            .expect("collect ids");
        assert!(ids.contains("rightcode"));
        assert!(ids.contains("aihubmix"));
        assert!(!ids.contains("openai"));
        assert!(!ids.contains("codex-official"));
    }

    #[test]
    fn skips_unknown_provider_model_provider_id_from_existing_config() {
        let db = Database::memory().expect("memory db");
        let mut provider = Provider::with_id(
            "manual-aggregator".to_string(),
            "Manual Aggregator".to_string(),
            serde_json::json!({
                "auth": {},
                "config": "model_provider = \"my-private-relay\"\n\n[model_providers.my-private-relay]\nname = \"Manual Relay\"\nbase_url = \"http://localhost:8080/v1\""
            }),
            None,
        );
        provider.category = Some("aggregator".to_string());

        db.save_provider("codex", &provider).expect("save provider");

        let ids = collect_source_model_provider_ids(&db, CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
            .expect("collect ids");
        assert!(!ids.contains("my-private-relay"));
    }

    #[test]
    fn skips_undefined_provider_model_provider_id_from_existing_config() {
        let db = Database::memory().expect("memory db");
        let mut provider = Provider::with_id(
            "manual-aggregator".to_string(),
            "Manual Aggregator".to_string(),
            serde_json::json!({
                "auth": {},
                "config": "model_provider = \"my-private-relay\"\n"
            }),
            None,
        );
        provider.category = Some("aggregator".to_string());

        db.save_provider("codex", &provider).expect("save provider");

        let ids = collect_source_model_provider_ids(&db, CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
            .expect("collect ids");
        assert!(!ids.contains("my-private-relay"));
    }

    #[test]
    fn skips_unknown_profile_model_provider_id_from_existing_config() {
        let db = Database::memory().expect("memory db");
        let mut provider = Provider::with_id(
            "manual-aggregator".to_string(),
            "Manual Aggregator".to_string(),
            serde_json::json!({
                "auth": {},
                "config": r#"profile = "work"

[model_providers.my-private-relay]
name = "Manual Relay"
base_url = "http://localhost:8080/v1"

[profiles.work]
model_provider = "my-private-relay"
"#
            }),
            None,
        );
        provider.category = Some("aggregator".to_string());

        db.save_provider("codex", &provider).expect("save provider");

        let ids = collect_source_model_provider_ids(&db, CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
            .expect("collect ids");
        assert!(!ids.contains("my-private-relay"));
    }

    #[test]
    fn collects_known_legacy_provider_id_from_normalized_preset_config() {
        let db = Database::memory().expect("memory db");
        let mut provider = Provider::with_id(
            "generated-uuid".to_string(),
            "AIHubMix".to_string(),
            serde_json::json!({
                "auth": {},
                "config": "model_provider = \"tuziswitch\"\n\n[model_providers.tuziswitch]\nname = \"AIHubMix\"\nbase_url = \"https://aihubmix.example/v1\""
            }),
            None,
        );
        provider.category = Some("aggregator".to_string());

        db.save_provider("codex", &provider).expect("save provider");

        let ids = collect_source_model_provider_ids(&db, CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
            .expect("collect ids");
        assert!(ids.contains("aihubmix"));
        assert!(!ids.contains("generated-uuid"));
    }

    #[test]
    fn collects_legacy_ccswitch_provider_id_from_stored_config() {
        let db = Database::memory().expect("memory db");
        let mut provider = Provider::with_id(
            "generated-uuid".to_string(),
            "Legacy Stable".to_string(),
            serde_json::json!({
                "auth": {},
                "config": "model_provider = \"ccswitch\"\n\n[model_providers.ccswitch]\nname = \"AIHubMix\"\nbase_url = \"https://aihubmix.example/v1\""
            }),
            None,
        );
        provider.category = Some("aggregator".to_string());

        db.save_provider("codex", &provider).expect("save provider");

        let ids = collect_source_model_provider_ids(&db, CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
            .expect("collect ids");
        assert!(ids.contains("ccswitch"));
        assert!(ids.contains("aihubmix"));
        assert!(!ids.contains("generated-uuid"));
    }

    #[test]
    fn migrates_stored_provider_template_to_custom() {
        let db = Database::memory().expect("memory db");
        let provider = Provider::with_id(
            "legacy".to_string(),
            "Legacy Stable".to_string(),
            serde_json::json!({
                "auth": {},
                "config": r#"model_provider = "aihubmix"
model = "gpt-5.4"
profile = "work"

[model_providers.aihubmix]
name = "AIHubMix"
base_url = "https://aihubmix.example/v1"
wire_api = "responses"

[profiles.work]
model_provider = "aihubmix"
model = "gpt-5.4"
"#
            }),
            None,
        );
        db.save_provider("codex", &provider).expect("save provider");

        let (outcome, backup_dir) = migrate_provider_templates_for_test(&db);
        assert_eq!(outcome.migrated_provider_ids, vec!["legacy".to_string()]);

        let saved = db
            .get_provider_by_id("legacy", "codex")
            .expect("get provider")
            .expect("provider exists");
        let config_text = saved
            .settings_config
            .get("config")
            .and_then(Value::as_str)
            .expect("config text");
        let parsed: toml::Value = toml::from_str(config_text).expect("parse config");

        assert_eq!(
            parsed
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("tuziswitch")
        );
        assert!(parsed
            .get("model_providers")
            .and_then(|value| value.get("aihubmix"))
            .is_none());
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("tuziswitch"))
                .and_then(|value| value.get("base_url"))
                .and_then(|value| value.as_str()),
            Some("https://aihubmix.example/v1")
        );
        assert_eq!(
            parsed
                .get("profiles")
                .and_then(|value| value.get("work"))
                .and_then(|value| value.get("model_provider"))
                .and_then(|value| value.as_str()),
            Some("tuziswitch")
        );

        let backups: Vec<_> = fs::read_dir(backup_dir.path().join("providers"))
            .expect("provider backups")
            .flatten()
            .collect();
        assert_eq!(backups.len(), 1);
        let backup_text = fs::read_to_string(backups[0].path()).expect("read provider backup");
        assert!(backup_text.contains(r#""providerId": "legacy""#));
        assert!(backup_text.contains(r#"model_provider = \"aihubmix\""#));

        let (second, _second_backup_dir) = migrate_provider_templates_for_test(&db);
        assert!(second.migrated_provider_ids.is_empty());
    }

    #[test]
    fn migrates_legacy_ccswitch_provider_template_to_custom() {
        let db = Database::memory().expect("memory db");
        let provider = Provider::with_id(
            "legacy-ccswitch".to_string(),
            "Legacy CC Switch".to_string(),
            serde_json::json!({
                "auth": {},
                "config": r#"model_provider = "ccswitch"

[model_providers.ccswitch]
name = "AIHubMix"
base_url = "https://aihubmix.example/v1"
"#
            }),
            None,
        );
        db.save_provider("codex", &provider).expect("save provider");

        let (outcome, _backup_dir) = migrate_provider_templates_for_test(&db);
        assert_eq!(
            outcome.migrated_provider_ids,
            vec!["legacy-ccswitch".to_string()]
        );

        let saved = db
            .get_provider_by_id("legacy-ccswitch", "codex")
            .expect("get provider")
            .expect("provider exists");
        let config_text = saved
            .settings_config
            .get("config")
            .and_then(Value::as_str)
            .expect("config text");
        let parsed: toml::Value = toml::from_str(config_text).expect("parse config");

        assert_eq!(
            parsed
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("tuziswitch")
        );
        assert!(parsed
            .get("model_providers")
            .and_then(|value| value.get("ccswitch"))
            .is_none());
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("tuziswitch"))
                .and_then(|value| value.get("base_url"))
                .and_then(|value| value.as_str()),
            Some("https://aihubmix.example/v1")
        );
    }

    #[test]
    fn skips_unknown_stored_provider_template() {
        let db = Database::memory().expect("memory db");
        let provider = Provider::with_id(
            "manual".to_string(),
            "Manual Relay".to_string(),
            serde_json::json!({
                "auth": {},
                "config": r#"model_provider = "my-private-relay"

[model_providers.my-private-relay]
name = "Manual Relay"
base_url = "http://localhost:8080/v1"
"#
            }),
            None,
        );
        db.save_provider("codex", &provider).expect("save provider");

        let (outcome, _backup_dir) = migrate_provider_templates_for_test(&db);
        assert!(outcome.migrated_provider_ids.is_empty());

        let saved = db
            .get_provider_by_id("manual", "codex")
            .expect("get provider")
            .expect("provider exists");
        let config_text = saved
            .settings_config
            .get("config")
            .and_then(Value::as_str)
            .expect("config text");
        let parsed: toml::Value = toml::from_str(config_text).expect("parse config");

        assert_eq!(
            parsed
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("my-private-relay")
        );
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("my-private-relay"))
                .and_then(|value| value.get("base_url"))
                .and_then(|value| value.as_str()),
            Some("http://localhost:8080/v1")
        );
    }

    #[test]
    fn skips_reserved_key_in_non_official_stored_provider_template() {
        let db = Database::memory().expect("memory db");
        let provider = Provider::with_id(
            "custom-openai".to_string(),
            "Custom OpenAI".to_string(),
            serde_json::json!({
                "auth": {},
                "config": r#"model_provider = "openai"

[model_providers.openai]
name = "Custom OpenAI"
base_url = "https://proxy.example/v1"
"#
            }),
            None,
        );
        db.save_provider("codex", &provider).expect("save provider");

        let (outcome, _backup_dir) = migrate_provider_templates_for_test(&db);
        assert!(outcome.migrated_provider_ids.is_empty());

        let saved = db
            .get_provider_by_id("custom-openai", "codex")
            .expect("get provider")
            .expect("provider exists");
        let config_text = saved
            .settings_config
            .get("config")
            .and_then(Value::as_str)
            .expect("config text");
        let parsed: toml::Value = toml::from_str(config_text).expect("parse config");

        assert_eq!(
            parsed
                .get("model_provider")
                .and_then(|value| value.as_str()),
            Some("openai")
        );
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("openai"))
                .and_then(|value| value.get("base_url"))
                .and_then(|value| value.as_str()),
            Some("https://proxy.example/v1")
        );
    }

    #[test]
    fn migrates_profile_model_provider_refs_to_custom_when_top_level_is_already_custom() {
        let db = Database::memory().expect("memory db");
        let provider = Provider::with_id(
            "profiled".to_string(),
            "Profiled Relay".to_string(),
            serde_json::json!({
                "auth": {},
                "config": r#"model_provider = "tuziswitch"
profile = "work"

[model_providers.tuziswitch]
name = "Current"
base_url = "https://current.example/v1"

[model_providers.aihubmix]
name = "AIHubMix"
base_url = "https://aihubmix.example/v1"

[profiles.work]
model_provider = "aihubmix"
"#
            }),
            None,
        );
        db.save_provider("codex", &provider).expect("save provider");

        let (outcome, _backup_dir) = migrate_provider_templates_for_test(&db);
        assert_eq!(outcome.migrated_provider_ids, vec!["profiled".to_string()]);

        let saved = db
            .get_provider_by_id("profiled", "codex")
            .expect("get provider")
            .expect("provider exists");
        let config_text = saved
            .settings_config
            .get("config")
            .and_then(Value::as_str)
            .expect("config text");
        let parsed: toml::Value = toml::from_str(config_text).expect("parse config");

        assert_eq!(
            parsed
                .get("profiles")
                .and_then(|value| value.get("work"))
                .and_then(|value| value.get("model_provider"))
                .and_then(|value| value.as_str()),
            Some("tuziswitch")
        );
        assert_eq!(
            parsed
                .get("model_providers")
                .and_then(|value| value.get("tuziswitch"))
                .and_then(|value| value.get("base_url"))
                .and_then(|value| value.as_str()),
            Some("https://current.example/v1")
        );
    }

    #[test]
    fn skips_custom_category_unknown_provider_when_created_by_cc_switch() {
        let db = Database::memory().expect("memory db");
        let mut provider = Provider::with_id(
            "generated-uuid".to_string(),
            "Manual Relay".to_string(),
            serde_json::json!({
                "auth": {},
                "config": "model_provider = \"my-private-relay\"\n\n[model_providers.my-private-relay]\nname = \"Manual Relay\"\nbase_url = \"http://localhost:8080/v1\""
            }),
            None,
        );
        provider.category = Some("custom".to_string());
        provider.created_at = Some(1);

        db.save_provider("codex", &provider).expect("save provider");

        let ids = collect_source_model_provider_ids(&db, CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
            .expect("collect ids");
        assert!(!ids.contains("my-private-relay"));
        assert!(!ids.contains("generated-uuid"));
    }

    #[test]
    fn skips_custom_category_unknown_provider_model_provider_id() {
        let db = Database::memory().expect("memory db");
        let mut provider = Provider::with_id(
            "manual".to_string(),
            "Manual Relay".to_string(),
            serde_json::json!({
                "auth": {},
                "config": "model_provider = \"my-local-relay\"\n\n[model_providers.my-local-relay]\nname = \"Manual Relay\"\nbase_url = \"http://localhost:8080/v1\""
            }),
            None,
        );
        provider.category = Some("custom".to_string());

        db.save_provider("codex", &provider).expect("save provider");

        let ids = collect_source_model_provider_ids(&db, CC_SWITCH_CODEX_MODEL_PROVIDER_ID)
            .expect("collect ids");
        assert!(!ids.contains("my-local-relay"));
    }
}
