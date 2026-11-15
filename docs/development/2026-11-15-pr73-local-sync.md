# PR #73 与本地实现同步

任务：`SYNC-PR73-LOCAL-01`；日期：2026-11-15（Asia/Shanghai）。

用户要求保留本地实现，在其基础上同步已合并的 PR #73。仅本地备份、合并和验证，不含 push、PR、发布、安装升级或真实模型调用。

## 来源与保留

- 原目录：`/Users/sdy09/Documents/tuzi-switch`，分支 `gaizhao`，HEAD `c99282989cfcaa04e55ac26c31e65dd8b2592874`。
- 原工作区：29 个已修改文件、5 个未跟踪文件；均先按原字节备份，并以独立索引生成本地快照 `387ee8f30cbdd08a1c86b2d840d8032b2189294a`，不改动原暂存区。
- 远程：`tuziapi/tuzi-switch`，PR #73 功能提交 `e5313891c3ffc5c0a57dfaef5c7bc170cda0dbce`，main 合并提交 `6cf7201f51de5f7abf447cd9f15f45b18d8af979`，2026-11-15 10:17（北京时间）已合并。
- 集成分支：`codex/sync-pr73-preserve-local`，从本地快照出发合并上述 main，以双父提交保留两侧历史。
- 原 HEAD 是 main 的祖先，落后 158 个提交且缺少创作工作区，故需同步承载 PR 的完整实现，不能只挑入末尾的视频提交。

34 个本地文件中，31 个在远程历史中找到完全相同的 Git blob，包括全部代码、测试和 MCP 验证记录。不是将独有代码直接舍弃；当前远程实现已经包含这些改动及后续修复。逐文件 SHA-256、blob 和匹配提交见[保留审计](history/pr73-local-preserved/preservation-audit.json)。

其余三个文件为本地开发入口和 v0.2 设计稿，已[原字节留档](history/pr73-local-preserved/README.md)，当前文档采用主线后续实施记录。完整原工作区还保留在本地备份分支 `codex/backup-local-before-pr73-20261115`。

## 冲突处理

共处理 12 个文件的内容或同名新增冲突。代码冲突均沿用已包含本地实现的主线后续版本：

- Grok Build、Pi、MiniMax Code MCP 的表单、状态字段、数据库 v12 默认值与迁移、导入、启停和删除继续保留。
- 保留旧工具与新增工具的跨文件失败补偿、Codex 已保存配置同步更新及聚合模式保护，避免恢复旧的数据库先写流程。
- Pi 的可导出标记继续兼容，但本机写入权由独立 receipt 确认；不恢复跨设备数据库标记直接授予写权限的旧行为。
- 保留进程退出自动释放的配置文件锁、部分导入错误的持续反馈、列表刷新、操作统计和创作预览接线。
- 文档冲突保留主线最新实施事实，独有原稿留档，不将旧的待审阅设计重新作为现行产品规则。

集成后的业务代码、测试、依赖锁和数据库定义与上述 main 完全一致；本轮额外差异仅为同步记录及历史留档，没有新增接口、环境变量或数据库字段。

## 验证

macOS、Node 22、pnpm 10.33.0、Rust/Cargo 1.95.0。依赖按冻结锁文件安装，未改锁文件；所有执行的业务测试使用合成数据。结果：

| 检查 | 本轮结果 |
| --- | --- |
| PR 原 15 个定向视频测试文件 | 554 项通过 |
| MCP 表单、工作区查询与导航 | 3 文件、18 项通过 |
| MCP 校验 Hook | 1 文件、18 项通过 |
| 宿主 `pnpm typecheck` | 通过 |
| 视频合同/媒体/型号模块严格 TypeScript 检查 | 通过 |
| `pnpm build:renderer`（创作模块 + 宿主） | 通过；保留既有 Sass、动态导入、chunk 大小和浏览器数据库告警 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib mcp -- --test-threads=1` | 59 项通过，2 项环境变量测试默认忽略 |
| 两项 `services::mcp::native_integration_tests` | 分别独立进程 `--ignored --exact --test-threads=1` 执行，各 1 项通过 |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib native_tools::tests -- --test-threads=1` | 10 项通过，包含子进程退出锁恢复 |
| 相对 main 的同步差异、冲突标记、保留文件摘要与 Git 祖先检查 | 通过；产品代码与合并源一致 |

原生 MCP 测试补验覆盖新增三工具保存、启停、删除、导入、数据库失败回滚、Codex 快照一致性和 Pi 跨设备归属。共 590 项前端、71 项原生测试通过，不将这些定向检查称为全库全量回归。

具体视频和类型检查命令沿用 [PR QA](../../qa/2026-11-14-video-model-parameters.md)；原始日志保留在本地备份目录的 `validation/`。从旧 HEAD 检查整批上游差异会报告既有 vendored/patch 尾随空白，本轮不整库格式化；相对精确合并源的新增差异 `git diff --check` 通过。

本轮不重新发起付费视频请求，未构建/安装原生应用，也未做跨平台或真实账户联调；PR 中的历史真实验收不作为本次本地重新验收结果。

回退可切回保留的原工作快照；已提交集成按仓库约定使用 revert，不重写或强推历史。不清理用户数据库、工具配置或创作素材。
