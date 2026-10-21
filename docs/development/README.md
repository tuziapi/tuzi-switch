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

## R02 v1.4.1 本地缺陷修复（2026-10-21）

用户授权在 `codex/tuzi-assistant-system-token` 修复 Key 模型列表、下拉滚动和 Codex TOML 编辑/保存，并打开本地构建测试。客户端实现与145项前端、41项账户测试通过；全库原生1405通过、1项历史恢复测试失败、1忽略，明确保留限制。独立测试应用已构建并打开，API未改动，未推送/发布，实际Key及用户验收待完成。详见 [R02验证](r02-model-editor-verification.md) 和 [ADR-012](decisions/0012-key-model-list-and-toml-drafts.md)。

## R03 Codex 模型列表实际验收纠正（2026-10-21）

R02 用户实际验收未通过：额外协议过滤导致模型仍缺失。R03 将 Codex 展示/选择与手动获取列表统一，保存保持 Key 权限及成员检查，其他工具不变。前端96项、原生账户42项通过（1真实配对忽略），API未改，详见 [R03验证](r03-codex-model-list-verification.md)。实际账户验收仍待完成。

## R04 Codex 首次添加保留自定义名称（2026-10-21）

用户批准统一修复Codex各线路首次添加、再次编辑及落盘命名。仅凭证索引仍受程序管理，不再自动重命名用户provider；增加冲突提示及初始账户草稿独立标识。110项前端、29项供应商、67项Codex、14项账户工具和3项真实文件回归通过；独立R04测试包构建完成。API未改、未推送/发布，实际验收待完成。详见 [R04记录](r04-codex-provider-identity.md)。

## R05 密钥搜索交互（2026-10-21）

客户端修复筛选栏跳动、搜索输入期间报错及后4位精确匹配错误；固定反馈区域、300ms防抖、同账户保留列表及失败重试。类型检查、100项前端及43项原生账户测试通过（1项既有忽略），合成UI确认筛选栏位置稳定。API未改，实际用户验收待完成，见 [R05验证](r05-key-search-verification.md)。

## R06 模型选择器修复（2026-10-21）

用户授权的文案、隐藏未知项及协议识别修复已本地完成，后四位搜索清空问题暂缓。当前行为与验证限制见 [R06记录](r06-model-picker-verification.md) 和 ADR-012 追加决定。未发布。

## R07 Codex账户凭证读取（2026-10-21）

修复账户生成的TUZI_SWITCH独立凭证引用被模型检查/代理读取规则拒绝的问题；旧引用和安全边界保留，无凭证迁移。定向回归及复用R06数据的R07测试包见 [R07验证](r07-codex-credential-verification.md)。本地实施，未发布。

## R08 Codex 同名 provider（2026-10-21）

不同卡片可使用相同 provider 标识，独立保存凭证，只有生效卡片写入当前配置；替代 R04 全局唯一和未启用预注册规则。见 [ADR-013](decisions/0013-codex-card-local-provider-ids.md)、[R08验证](r08-codex-duplicate-provider-verification.md)。API 契约不变，仅本地验证，未发布。

## R09 Codex 保存与启用失败补偿（2026-10-21）

普通配置准备不再提前写Key，最终保存/启用在原生层处理写入和失败恢复；设计与验证见 [ADR-014](decisions/0014-codex-save-activation-compensation.md)、[R09记录](r09-codex-transaction-verification.md)。用户已授权提交、推送和创建客户端 PR；不包含合并/发布。此前“仅本地、不推送”是各阶段历史授权记录。全量单元仍有1项既有历史恢复失败，实际发布验收尚未完成。
