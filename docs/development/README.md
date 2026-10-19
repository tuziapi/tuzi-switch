# 账户中心与工具管理开发基线

当前有效基线：`TA-AC-1.5-B4`；契约：`system-token-v1`；日期：2026-10-19（Asia/Shanghai）。本轮用户明确授权账户接入由 A（桌面 OAuth、`/api/desktop`）迁移至 B（网站复制账户系统令牌、原生安全保存、调用原站业务接口），允许两仓本地编码、隔离验证、独立 worktree、子智能体、提交及集成。禁止 push、PR、远程合并、发布、部署、生产迁移、生产数据、真实凭证、实际支付和付费模型调用。

最终集成分支两仓均为 `codex/tuzi-assistant-system-token`，替代本任务旧 API 集成分支要求；分支名不证明部署。当前代码、测试、联调、用户验收和发布状态分别见 [progress.md](progress.md)，配对 SHA 及兼容限制见 [跨仓库兼容记录](cross-repo-compatibility.md)。本地代码/定向验证/隔离联调已完成，分层证据与未完成门禁见 [B4验证报告](system-token-verification.md)；用户验收和发布未完成。

最新 B17：按用户指定修复提交前审查第 1、3 项（删除未知结果回读、多模型分批校验），第 2 项空分组问题保持不变。修复已提交，用户已授权推送及创建两仓 PR；代码配对见跨仓库兼容记录，验证及 API 优先上线顺序见 [B17验证](prepush-fixes-verification.md)。

此前 B15：账户配置短暂定位、按密钥命名及连接检查反馈已本地完成；见 [B15验证](provider-feedback-verification.md)。未发布。

此前 B13：用户明确批准账户系统令牌改用独立本地配置文件、Codex表单移除环境变量字段；见 [ADR-011](decisions/0011-local-account-file-and-hidden-codex-env.md) 和 [B13验证](local-account-file-verification.md)。旧钥匙串不读取，首次更新需重新连接。

此前 B12：按用户确认将账户配置的“添加”改为直接保存，后台保留校验、备份和恢复；见 [B12验证](provider-direct-save-verification.md)。

此前 B11：标题行高、受控令牌预填、兔子线路预填和供应商保存修复已实施，分层验证见 [B11验证](token-prefill-provider-verification.md) / [ADR-010](decisions/0010-token-prefill-and-provider-drafts.md)。两仓仍在用户指定 B 分支，本地开发，无远程或发布。

此前 B10：名称统一“兔子助手”、账户品牌图标、网站令牌短暂柔和高亮、移除工具页返回提示均本地完成；兼容身份及分层验证见 [B10验证](brand-ui-verification.md) 与 [ADR-009](decisions/0009-assistant-brand-identity.md)。未发布，用户验收待完成。

最新本地改进：2026-10-19 `B09-account-improvements` 九项需求及后续三项微调（复制提示后延迟1.5秒唤起、币种激活样式、工具选项右侧图标）代码完成。最新精确配对、分层验证和本地配置条件核查见 [B09验证记录](account-improvements-verification.md) 文末。

此前本地同步：2026-10-18 `B08-local-mainline-sync` 已将 API `origin/dev`、客户端 `origin/main` merge 到上述 B 分支，精确代码配对和既有失败见 [主分支同步验证](mainline-sync-verification.md)。未发布，历史联调不自动代表本次同步后联调。

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

2026-10-19 B09 用户补充授权：Phase 1 公开 API 密钥页、顶部四项概要和每条 Key 的配置到工具入口；其他已实现页面保持隐藏，不加载其请求，不删除、不降级为空壳。B 系统令牌具有原站账户/角色实际权限，客户端隐藏和原生操作白名单不构成服务端最小权限。

## 本轮源码基准与交付规则

迁移开始核查：C `codex/tuzi-assistant-dev` / `c3902fe7c4fc847e769b23d7712092a30aa67c57`，只有既有未跟踪 Word/产品附件；S 最新网站 `codex/unified-currency-display` / `dded57caedc376c4399f778ebb2147748bc24743`，工作区干净；A API 分支 `codex/tuzi-assistant-dev` / `111497e6f` 仅用于差异审计。B 服务端以最新网站为底，不整体回退或整批挑入 A。

本地阶段提交、相称检查、隔离合成数据及预览已授权；远程和生产仍需新授权。文档改动仅跑链接、编号和一致性检查；代码负责人记录实际命令、环境及结果，Mock、构建、HTTP、原生层和真实 UI 分层报告。发布前仍需三平台本地凭证文件权限/恢复、实际 MySQL/其他数据库、性能、网站旧接入和用户验收证据，不能用限制说明替代通过。
