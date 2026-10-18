# 账户中心与工具管理开发基线

当前有效基线：`TA-AC-1.5-B4`；契约：`system-token-v1`；日期：2026-10-18（Asia/Shanghai）。本轮用户明确授权账户接入由 A（桌面 OAuth、`/api/desktop`）迁移至 B（网站复制账户系统令牌、原生安全保存、调用原站业务接口），允许两仓本地编码、隔离验证、独立 worktree、子智能体、提交及集成。禁止 push、PR、远程合并、发布、部署、生产迁移、生产数据、真实凭证、实际支付和付费模型调用。

最终集成分支两仓均为 `codex/tuzi-assistant-system-token`，替代本任务旧 API 集成分支要求；分支名不证明部署。当前代码、测试、联调、用户验收和发布状态分别见 [progress.md](progress.md)，配对 SHA 及兼容限制见 [跨仓库兼容记录](cross-repo-compatibility.md)。本文不宣称本地目标已完成。

## 权威文件与阅读顺序

| 顺序 | 文件 | 职责 |
|---|---|---|
| 1 | [AGENTS.md](../../AGENTS.md)、[progress.md](progress.md) | 操作约束、当前事实及剩余验证 |
| 2 | [PRD.md](PRD.md) | 当前产品行为、全部既有功能和 Phase 1 可见性、AC |
| 3 | [api-contract.md](api-contract.md) | B 认证、原站路由及必要兼容扩展 |
| 4 | [technical-design.md](technical-design.md)、[ADR-008](decisions/0008-system-token-connection.md) | 原生边界、A 退出、迁移与回退 |
| 5 | [迁移矩阵及兼容记录](cross-repo-compatibility.md) | 所有已实现能力、接口、验证及配对 |
| 6 | [tasks.md](tasks.md)、[open-questions.md](open-questions.md) | 当前 B 任务、环境门禁；历史任务保留 |

客户端 `docs/development/` 是唯一产品开发基线。API 仓库 `/Users/syd08/Documents/tuzi/tuzi-api` 的 `docs/tuzi-assistant-development.md` 只维护指针、服务端实施、迁移及发布说明，不另建 PRD。worktree 路径不同按仓库身份、基线和配对 SHA 定位。

## 来源、历史与优先级

Word v1.5 留存不动，SHA-256 `48dfdb009fb48ddff4689e97223159396997083425852ec03468650a5c23ef7a`；原始未跟踪的产品附件和预览不复制、不提交、不修改。Markdown 是后续唯一执行依据。原 [源码审计](source-audit.md)、G1/G2 验证和 ADR-001～007 是其时点证据；不能冒充当前 B 实现或生产状态。

B4 的批准来源为本轮目标文件（2026-10-18，`goal-objective.md`）：保留所有业务和当前隐藏状态，仅替换账户认证及接入，不实施未来 SSO。B3 有效文档的原样历史快照见 [history/b3-oauth-a](history/b3-oauth-a/README.md)。历史文档内相对链接按快照原目录解析，仅供审计；执行以本目录 B4 为准。旧 `desktop-v1.1`、桌面 scope/AT/RT/撤销/表迁移/Phase 1 服务端闸门不再是 B 的有效要求；替代范围逐项见 ADR-008。七工具、资料、金额、日志、事务和发布可见性要求继续有效。

Phase 1 仍只公开 API 密钥页和顶部四项概要，其他已实现页面及配置到工具入口保持隐藏；不删除、不降级为空壳。B 系统令牌具有原站账户/角色实际权限，客户端隐藏和原生操作白名单不构成服务端最小权限。

## 本轮源码基准与交付规则

迁移开始核查：C `codex/tuzi-assistant-dev` / `c3902fe7c4fc847e769b23d7712092a30aa67c57`，只有既有未跟踪 Word/产品附件；S 最新网站 `codex/unified-currency-display` / `dded57caedc376c4399f778ebb2147748bc24743`，工作区干净；A API 分支 `codex/tuzi-assistant-dev` / `111497e6f` 仅用于差异审计。B 服务端以最新网站为底，不整体回退或整批挑入 A。

本地阶段提交、相称检查、隔离合成数据及预览已授权；远程和生产仍需新授权。文档改动仅跑链接、编号和一致性检查；代码负责人记录实际命令、环境及结果，Mock、构建、HTTP、原生层和真实 UI 分层报告。发布前仍需三平台安全存储、实际 MySQL/其他数据库、性能、网站旧接入和用户验收证据，不能用限制说明替代通过。
