# 账户中心与工具管理开发基线

2026-10-14 最新验收状态：G2 的 IP 限制、未知 Key 写入保护及总览当日消费窗口问题均已修复并独立复验通过，**G2 本地研发门禁通过，可进入 G3 验证阶段**。见 [独立验收记录](g2-acceptance-review.md) 最新章节及 [修复记录](g2-fixes.md)。G3 实库/三平台/完整联调仍待执行，不表示已可发布，也不自动授权本轮执行 G3。

基线 ID：`TA-AC-1.5-B3`；建立日期：2026-10-12，G2更新：2026-10-14（Asia/Shanghai）。契约 `desktop-v1.1` / scope `desktop-v1` 已技术冻结，G2本地研发检查点已交付；跨平台/实库/完整浏览器验收受限，未发布。设计冻结不等于运行环境已验证。

## 权威文件与阅读顺序

| 顺序 | 文件 | 唯一职责 |
|---|---|---|
| 1 | [AGENTS.md](../../AGENTS.md)、[progress.md](progress.md) | 操作约束、当前状态与下一步 |
| 2 | [PRD.md](PRD.md) | 首版范围、流程、AC 验收项 |
| 3 | [source-audit.md](source-audit.md) | 固定源码版本、可复用/适配/新增证据 |
| 4 | [api-contract.md](api-contract.md) | 功能—scope—接口—归属—验收映射，现状与冻结协议 |
| 5 | [technical-design.md](technical-design.md) | 两端实施边界、故障恢复、发布顺序 |
| 6 | [tasks.md](tasks.md) | 稳定任务编号、依赖、交付/验证及并行安排 |
| 7 | [open-questions.md](open-questions.md)、[decisions/0001-baseline.md](decisions/0001-baseline.md) | 未决项与已确认决策，技术建议不能冒充批准 |

[ADR-002](decisions/0002-desktop-contract.md)记录T01技术选择；[t01-verification.md](t01-verification.md)记录补充源码证据、合成fixture及正负/兼容矩阵（预期，未执行）。

API 仓库：`/Users/syd08/Documents/tuzi/tuzi-api`。其 [基线指针与服务端实施说明](/Users/syd08/Documents/tuzi/tuzi-api/docs/tuzi-assistant-development.md) 不维护另一份 PRD。分离 checkout/worktree 时通过该指针定位本仓库，路径不同则使用仓库身份和基线 ID 定位，不复制权威文档另改。

## 来源与版本

来源：[兔子助手-账户中心与工具管理产品方案-v1.5.docx](../兔子助手-账户中心与工具管理产品方案-v1.5.docx)，SHA-256：`48dfdb009fb48ddff4689e97223159396997083425852ec03468650a5c23ef7a`。本轮完整读取 Word 正文和表格；现有 [核验说明](../product-plan-v1.5/verification-notes.md) 与 [预览](../product-plan-v1.5/preview.html) 作为历史辅助材料，截图为示例，不是联调证据。原 Word/预览及附件没有修改。

初始B1 在 v1.5 上纳入本轮用户确认：原生资料白名单、价格偏好的两个具体开关、MySQL、桌面安全事件撤销规则和 30 分钟/闲置 7 天/绝对 30 天令牌策略。详见 ADR-001；B2由T01将授权码120秒等普通技术选择冻结为desktop-v1.0，来源是ADR-002技术决定，不冒充Word或用户确认。

源码基准：客户端 `8ce1777d52fd4bce1ade76cf224f0cb2ccc07c98`（1.3.1）；API `72af0d4de3487033e800adcc38e42e320a993f75`（本地 origin/dev）。用户确认部署分支 dev、数据库 MySQL；实际运行 SHA/镜像、版本及拓扑待确认。未 fetch、访问生产或执行环境探测。

### 2026-10-13开发流程补充确认

- 用户确认先本地开发和验证，后续再推送远程仓库并按发布流程上线；推送不等于发布成功，也不是本轮执行授权。
- 用户指定API开发集成分支为 `codex/tuzi-assistant-dev`；本轮Git核查确认API当前就在该分支，HEAD仍为上述审计SHA。编码授权后先核查已有修改；并行任务从该分支建立独立 `codex/` 任务分支/worktree，验证后在本地集成。
- 用户再次确认API上线版数据库为MySQL；精确版本、主库/日志库拓扑及本地测试数据库尚未确认。生产MySQL事实不免除API仓库既有三数据库兼容规则。
- 此次仅补充环境事实与开发流程，基线仍为 `TA-AC-1.5-B2`、契约仍为 `desktop-v1.0`；历史部署分支dev记录保留，与本地开发分支明确区分，实际发布目标及运行版本在发布前核查。客户端开发分支未被本次补充指定。

## 后续维护

- Markdown 自 B1 起作为开发执行的唯一权威版本。Word v1.5 留存不动；需要对外 Word 时从已批准 Markdown 生成有新版本号的快照，注明基线 ID，不能独立修改 Word 后默认为已同步。
- 每次变更先标记类型：产品范围变更、技术契约变更或事实勘误。产品范围须用户确认；技术实现选择由负责执行者形成 ADR 并做两端影响审查。
- 改动时更新相关 AC/接口/任务及进度，保留稳定 ID；删除能力标记废止并说明批准来源，不重用编号。基线版本递增 B2/B3，契约冻结后独立记录 `desktop-v1` 修订号。
- `source-audit.md` 是 B1 的历史证据。后续在任务记录新增实际 SHA/差异，不能把旧核验改写成当前代码已实现。
- `progress.md` 只登记已发生事实。接口草案、未执行命令、Mock 结果均明确状态。待确认项关闭需记录回答/证据、日期、影响文件和任务。
- 集成负责人维护权威文件；任务执行者提交变更建议和结果，避免多 worktree 同时修改计划。API 服务端说明同步基线 ID、契约修订及兼容关系，具体两端 SHA 登记在 progress。

## 门禁

T01文档设计已完成，下一轮获编码授权后可从T02（服务端认证/迁移）、T04（原生安全存储）、T12（导航状态壳）开始。T04库/最低OS版本按任务形成ADR，T12须接真实状态后才完成。环境Q02/Q04/Q09仍约束真实联调、容量与发布；本轮T01授权不等于业务编码/部署授权。完整首版发布必须完成 AC-01～AC-18 和 T20～T22 的对应验证，不能以只完成登录/余额/Key 的灰度结果替代。

## G1 B3修订与编码授权（2026-10-13）

本轮用户正式授权G1本地开发/验证/子智能体/阶段提交与本地集成，替代历史文档阶段禁编码限制。当前基线B3、契约desktop-v1.1、scope仍desktop-v1；[ADR-003](decisions/0003-g1-safety-and-recovery.md)闭合日志/退款语义、安装状态、兼容回退和T04存储选型。OAuth wire/授权寿命及产品范围不变；旧T01/ADR-002/源码审计记录保留历史B2/v1.0，不作为当前实现状态。当前状态及SHA以progress、[G1验证记录](g1-verification.md)为准。

## G1 安全修订 r1（2026-10-13）

B3 / desktop-v1.1 / scope desktop-v1 保持，[ADR-004](decisions/0004-g1-auth-corrections.md)冻结授权解析一致性、签名账户上下文、明确未消费的刷新退避、当前RT闲置到期展示。T02/T03/T06/T07重新打开对应缺陷验证；实现/审查/集成结果见progress及g1-verification，先前检查点不代表这些新增回归已通过。网页与API须配对更新，无数据库迁移，不扩展G2。

## G2 本地检查点（2026-10-14，当前状态）

T08—T11、T13—T18 已完成本地实现、相称验证、固定提交非作者审查与两仓集成，真实隔离 Go HTTP → Rust 业务配对通过并清理。基线仍为 B3 / desktop-v1.1 / desktop-v1；Key 创建/揭示的可调用格式说明属于事实补充，不改变范围或版本。

[G2 验证与复现记录](g2-verification.md)提供任务—AC—接口—实现—证据清单、最终代码 SHA、回退及 G3 环境门槛；[ADR-005](decisions/0005-g2-local-tool-transactions.md)记录原生传输、来源证明与完整工具写入事务。最新进度以 [progress.md](progress.md) 的 G2 章节为准，上方 G1/未开始文字保留为历史。未推送或发布，T19—T22、用户产品验收未完成；本目标在 G2 停止。
