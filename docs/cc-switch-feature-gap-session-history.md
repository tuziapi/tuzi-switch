# tuzi-switch 对比 cc-switch 功能差距分析：会话保存

## 背景

本次以 `cc-switch` 为主，对比 `tuzi-switch` 的功能缺口，重点关注 Codex 会话保存、会话历史归属、会话恢复能力。

当前状态：会话归桶迁移、官方与第三方历史统一、SQLite state DB 同步迁移、备份账本、关闭后的精确还原，以及项目 Profile 均已补齐。本文保留原始差距与实施路线，已完成项以当前状态为准。

## 项目位置

- `tuzi-switch`
- `cc-switch`

## 对比结论

### 1. 基础会话管理

两边都有基础会话管理能力：

- 扫描 Claude Code / Codex / Gemini / OpenCode / OpenClaw / Hermes 会话。
- 查看会话消息。
- 复制 resume 命令。
- 删除单个或批量删除会话。

`tuzi-switch` 相关文件：

- `src/components/sessions/SessionManagerPage.tsx`
- `src/lib/api/sessions.ts`
- `src-tauri/src/session_manager/`
- `src-tauri/src/commands/session_manager.rs`

这一层不是主要差距。

### 2. Codex 会话保存的核心差距

Codex 会话历史不是只靠 jsonl 文件保存。Codex 还会在 `state_5.sqlite` 中维护 thread 元数据，并按 `model_provider` 归类和过滤 resume history。

`tuzi-switch` 当前主要做的是稳定 live config 中的 `model_provider`，避免切换 provider 后历史看起来移动：

- `src-tauri/src/codex_config.rs`
- 关键逻辑：`normalize_codex_settings_config_model_provider`

这能缓解新写入配置时的历史分裂，但不处理已经存在的历史数据，也不处理 SQLite state DB 中已有 thread 的归属。

`cc-switch` 在此基础上补齐了完整迁移链路：

- `src-tauri/src/codex_state_db.rs`
- `src-tauri/src/codex_history_migration.rs`

### 3. `state_5.sqlite` 路径解析缺失

`cc-switch` 有独立模块解析 Codex state DB 位置：

- 默认：`~/.codex/state_5.sqlite`
- `config.toml` 中的 `sqlite_home`
- 环境变量 `CODEX_SQLITE_HOME`

相关文件：

- `cc-switch/src-tauri/src/codex_state_db.rs`

`tuzi-switch` 未发现对应模块。影响：

- Session Manager 无法完整读取 relocated SQLite state。
- 历史迁移无法覆盖用户自定义 SQLite 目录。
- 会话标题、thread metadata 可能不完整。

### 4. 第三方 Codex 历史归桶迁移缺失

`cc-switch` 会把历史上由旧 provider id 产生的 Codex 会话迁入统一 provider bucket。

相关逻辑：

- `maybe_migrate_codex_third_party_history_provider_bucket`
- 迁移 jsonl 中的 `session_meta.model_provider`
- 迁移 `state_5.sqlite` 中 `threads.model_provider`
- 迁移前做备份
- 完成标记写入 settings，失败后下次启动可重试

`tuzi-switch` 目前只做 provider id 稳定化，不迁移既有会话。因此历史会话可能仍分散在 `rightcode`、`aihubmix`、`deepseek` 等旧 provider bucket 中。

影响：

- 用户切换供应商后，历史会话可能“看起来消失”。
- resume picker 里官方和第三方历史可能分裂。
- 旧版本产生的会话无法自动归一。

### 5. 官方 Codex 会话与第三方会话统一缺失

`cc-switch` 增加了统一 Codex 会话历史能力：

- 设置项：`unifyCodexSessionHistory`
- 开启时让官方订阅和第三方 provider 共享 `custom` provider bucket。
- 用户可选择迁移既有官方会话。
- 迁移官方 `openai` 桶到共享 `custom` 桶。

相关文件：

- `cc-switch/src/types.ts`
- `cc-switch/src-tauri/src/settings.rs`
- `cc-switch/src-tauri/src/codex_history_migration.rs`
- `cc-switch/src-tauri/src/commands/settings.rs`

`tuzi-switch` 未发现对应设置项和迁移实现。

影响：

- 官方 Codex 登录产生的会话仍归 `openai` 桶。
- 第三方 provider 会话归自定义 provider 桶。
- 两边历史无法自然出现在同一个 resume history 中。

### 6. 关闭统一会话后的精确还原缺失

`cc-switch` 的设计不是简单地把所有 `custom` 会话搬回 `openai`，而是通过备份账本精确还原：

- 只还原开启统一历史时从 `openai` 迁入的官方会话。
- 不触碰开启期间新产生的会话。
- 还原前再次备份目标文件和 DB。
- 支持重复执行，避免误伤第三方会话。

相关逻辑：

- `restore_codex_official_history_from_backups`
- `collect_official_ledger`
- `restore_codex_state_db_official_threads`

`tuzi-switch` 当前没有备份账本，也没有关闭后的精确恢复能力。

这是“会话保存”里最关键的安全差距：没有账本就无法可靠区分某条 `custom` 会话原本来自官方还是第三方。

### 7. Session Manager 标题来源增强缺失

`cc-switch` 的 Codex session provider 会读取：

- `session_index.jsonl`
- `state_5.sqlite`

用于补全 thread title。

相关文件：

- `cc-switch/src-tauri/src/session_manager/providers/codex.rs`

`tuzi-switch` 的 Codex session 管理更偏向扫描 session jsonl 文件，缺少对 relocated state DB 的统一标题读取能力。

影响：

- 部分 Codex 会话标题可能缺失或降级。
- 用户定位旧会话更困难。

## 其他明显功能差异

### 项目 Profile / 配置快照

`cc-switch` 还有一个与“会话保存”容易混淆的功能：项目 Profile。

它保存的不是对话会话本身，而是项目级配置快照：

- 当前 provider
- MCP 启用状态
- Skills 启用状态
- Prompt 激活状态

并按 scope 隔离：

- Claude
- Claude Desktop
- Codex

相关文件：

- `cc-switch/src-tauri/src/services/profile.rs`
- `cc-switch/src/components/profiles/`
- `cc-switch/src/lib/api/profiles.ts`

`tuzi-switch` 已补齐同等的项目级快照编排服务，并恢复主页、通用设置和托盘入口：

- `src-tauri/src/services/profile.rs`
- `src-tauri/src/commands/profile.rs`
- `src/components/profiles/`
- `src/lib/api/profiles.ts`

## tuzi-switch 建议补齐路线

### P0：补 state DB 解析

新增类似 `codex_state_db.rs` 的模块：

- 统一解析 `state_5.sqlite` 候选路径。
- 支持 `sqlite_home`。
- 支持 `CODEX_SQLITE_HOME`。
- 去重路径。

这是后续所有会话迁移、标题读取、恢复逻辑的基础。

### P0：补第三方历史归桶迁移

新增一次性迁移：

- 扫描 Codex session jsonl。
- 扫描 `state_5.sqlite` 的 `threads` 表。
- 将已知旧 provider id 迁入稳定 bucket。
- 每次改写前备份。
- 写 settings marker，失败时允许重试。

注意：jsonl 必须按行流式处理，SQLite `IN` 参数要分块，避免大内存占用。

### P1：补统一 Codex 会话历史开关

增加设置：

- 是否启用官方与第三方统一历史。
- 是否迁移既有官方会话。

开启时：

- live config 走共享 provider bucket。
- 可选迁移 `openai` 桶历史到共享 bucket。
- 迁移 jsonl 和 state DB。

关闭时：

- 不自动粗暴搬回。
- 只允许按备份账本精确恢复。

### P1：补备份账本与精确还原

必须记录：

- 迁移前 jsonl 文件备份。
- 迁移前 state DB 备份。
- 备份代际对应的 Codex config dir。
- 哪些 session/thread 原本属于官方 `openai` 桶。

还原时只处理账本内项目，避免误伤开启期间新产生的第三方会话。

### P2：补 Session Manager 标题增强

Session Manager 读取 Codex 会话时：

- 读取 `session_index.jsonl`。
- 读取所有候选 `state_5.sqlite`。
- 将 thread title 合并到 session meta。

### P2：补项目 Profile（已完成）

已补齐项目配置快照：

- Profile 实体。
- 按 app/scope 保存 provider、MCP、Skills、Prompt。
- 切换项目时保存当前快照并应用目标快照。

这个功能和会话历史不是同一层，当前已在会话保存闭环之后完成。

## 风险点

- 不能直接删除或覆盖用户历史会话。
- 迁移前必须备份。
- jsonl 改写要流式处理，避免一次性读入大文件。
- SQLite 更新要分块，避免参数过多。
- 恢复逻辑必须基于账本，不能按当前 provider id 粗暴判断归属。
- 统一历史开启期间产生的新会话来源不可逆推，关闭时默认不搬回。

## 最小可验收标准

补齐会话保存能力后，应满足：

- 切换 Codex 第三方 provider 后，历史会话不再分散到多个 provider bucket。
- 官方 Codex 与第三方 Codex 可选择共享同一个 resume history。
- 开启统一历史前已有官方会话可迁入。
- 关闭统一历史时，可按备份账本还原原官方会话。
- 用户的历史 jsonl 和 state DB 在迁移前都有备份。
- 自定义 `sqlite_home` / `CODEX_SQLITE_HOME` 用户不漏迁。

## 推荐优先级

推荐先做：

1. `codex_state_db` 路径解析。
2. 第三方历史 provider bucket 迁移。
3. Session Manager 标题读取增强。
4. 统一官方/第三方 Codex 会话历史开关。
5. 备份账本恢复 UI。
6. 项目 Profile（已完成）。

这样可以先解决用户最容易感知的“会话不见了 / 会话没有保存 / 切换后无法统一 resume”的问题，再扩展项目级配置快照。
