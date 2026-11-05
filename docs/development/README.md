# 账户中心与工具管理开发基线

2026-11-05 UC-PERF-01：用户批准批量生图局部进度刷新，移除桌面占位整树重建及仅预计进度导致的画布保存；2151 项创作回归、类型/构建、Chrome 1/10/20 张和 WebKit 20 张合成落位/重载通过。仅本地，性能范围和实机限制见 [记录](2026-11-05-batch-image-performance.md)。

2026-11-05 OFFICIAL-REL-03：仅整合今天两个侧边对话及本会话改动，已合入两仓 main；v1.5.5 四平台重建、正式附件替换、下载页和脚本部署及公网核验完成。同版本需手动重装，范围与验证限制见 [重建记录](2026-11-05-v1.5.5-rebuild.md)。

2026-11-05 OFFICIAL-UP-01：用户确认正式渠道改用 Release 新版本提醒、先看说明再下载对应系统安装包并手动安装；只读取 tuziapi，保留签名实现。58 项定向回归、类型、宿主前端构建和四平台浏览器模拟通过。独立本地分支，尚未进入发布包，见 [更新提醒记录](2026-11-05-official-manual-update-notices.md)。

2026-11-05 UC-SYNC-02：用户批准增量同步 opentu develop 1.2.6 两组特性；恢复原图标，适配 2.6-1k/GIF、生成错误详情与桌面 SVG/剪贴板。类型、772 项宿主测试、2,149 项创作测试、生产前端、双浏览器及来源重建通过；仅本地，未发布。见 [同步记录](2026-11-05-opentu-develop-sync.md)。

2026-11-05 MAC-INSTALL-01：用户确认以现有 v1.5.5 发布校验式 Mac 安装脚本及下载页入口，已通过 13 项 Mac 安装回归和 12 项页面测试，经 PR #59 合入 main 并完成 Pages 发布、公网脚本/页面字节核验；验证和限制见 [安装脚本记录](2026-11-05-macos-installer.md)。

2026-11-05 OFFICIAL-REL-02：v1.5.5 四平台重新构建成功，用户明确取消本次签名要求；七种手动安装文件及源码、校验记录已公开到正式仓库。正式下载页已完成 Pages 部署和公网核验，七种直链均可下载。见 [手动交付记录](2026-11-05-v1.5.5-manual-delivery.md)。

2026-11-05 OFFICIAL-REL-01：用户确认正式/测试仓库分离，准备 v1.5.5 的正式渠道构建；下载来源、更新公钥、完整安装更新与流水线已在独立本地分支统一。权限补齐后已获用户授权推送并启动仅构建流程；run 41964518572 因 GitHub 账户计费锁定在 runner 启动前失败，尚无安装包或公开发布。验证及前置条件见 [正式渠道记录](2026-11-05-official-release.md)。

2026-11-04 UC-REAL-04：实际下载安装 v1.5.4 后完成四类真实调用，视频播放、图片/文字显示、项目导出及正常重启恢复通过；用户确认音乐正常并要求停止专项测试，其他平台及既有门禁保留，见 [发布包真实验收](2026-11-04-v1.5.4-installed-real-acceptance.md)。

2026-11-04 UC-REL-04：v1.5.4 已发布到 AiW520 测试/分发仓库，正式 PR #53 已更新；四平台构建、23 个公开附件、更新签名、Mac 包内身份和下载页七项直链核验通过。原生合成音视频播放/重启恢复通过，真实供应商与跨平台实机限制保留，见 [交付记录](2026-11-04-v1.5.4-delivery.md)。

2026-11-04 UC-MEDIA-01：用户批准补齐既有视频/音乐账户适配。75 项固定媒体动作、原生任务/媒体绘制、加载和状态同步、本地多媒体回归已实施；真实提供方与原生完整验收仍有门禁，见 [验收记录](2026-11-04-media-acceptance.md)。

2026-11-04 UC-REL-03：v1.5.3 已发布至 AiW520 分发仓库，四平台构建、23 个公开附件摘要、更新签名、Mac 包内身份与公网下载页七项直链全部核验通过；正式仓库 PR #53 包含完整下载页，保持 Draft。见 [交付记录](2026-11-04-v1.5.3-delivery.md)。

2026-11-04 UC-FIX-03：模型获取、账户生图接口标签、原生大响应交付、删除确认框和加载提示已修复并随 v1.5.3 发布；真实生图、保存、定位、重启及生成图片跨应用复制通过，见 [验证记录](2026-11-04-creative-models-and-delete-fixes.md)。

2026-11-04 UC-UP-02：应用内下载与明确点击重启安装已完成本地实现，真实 macOS 隔离签名安装及篡改拒绝通过；v1.5.2 四平台构建、正式发布、下载页同步与公网安装包/签名核验已完成，见 [记录](2026-11-04-inapp-updates.md)。

2026-11-04 UC-REL-02：v1.5.1 已发布到 AiW520 分发仓库并同步公网下载页。七个实际下载安装包通过源码/版本/架构/摘要检查，旧 v1.5.0 原生客户端的新版本提醒及 DMG 下载链通过。自动检查后由用户手动安装；真实付费生图及跨平台安装等限制保留，见 [交付记录](2026-11-04-v1.5.1-delivery.md)。

2026-11-04 UC-SYNC-FEATURE-01：从“拉取 openFOX 并创建新目录”会话的 `5148d469` 增量补齐批量生图、蒙版/图片工具、历史筛选、模型目录、Suno 和保存同步；保留本地图片右键与账户桥接。范围、字段兼容和本项目重跑结果见 [同步记录](2026-11-04-creative-feature-sync.md)。

2026-11-04 UC-IMG-MENU-01：用户批准 B 自动保存副本并定位；图片五项右键菜单、原图复制/保存、菜单边界和取消反馈已本地实现。验证与原生验收限制见 [图片菜单记录](2026-11-04-image-context-menu.md)。

2026-11-04 UC-FIX-01：修复统一客户端的画布图片/生成占位 WebKit 渲染分支，以及旧孤立 endpoint 导致的 Codex 新增供应商外键报错。复现、回归与发布边界见 [修复记录](2026-11-04-canvas-provider-fixes.md)。

2026-11-02 UC-UP-01：测试渠道独立构建身份、自动更新提醒与手动下载、成功构建后自动发布下载页/更新清单。见 [更新提醒记录](2026-11-02-update-notifications.md)。

2026-11-02 UC-DL-02：修正公网主下载误指旧正式版的问题，主按钮直接下载含 opentu 的集成测试包，支持 macOS 双架构并校验构建归属与有效期。见 [下载入口修正](2026-11-02-download-target-fix.md)。

2026-11-02 UC-SYNC-54：合入 PR #54 最终账户四页工作区及价格修订，保留 opentu 集成；625 项前端及 58 项账户原生回归通过，重建使用线上账户地址的隔离测试包。见 [同步记录](2026-11-02-pr54-integration.md)。

2026-11-02 UC-TEST-01：用户已批准测试 main、未签名测试构建及正式仓库 Draft PR；主按钮与蓝兔图标同步调整。验证和剩余发布门禁见 [测试交付记录](2026-11-02-unified-test-delivery.md)。

2026-11-02 UC-DL-01：下载页已在独立网站 worktree 完成重设计与本地预览，18 个浏览器场景通过；客户端现有发布门禁仍未关闭。见 [进度记录](progress.md#2026-11-02-uc-dl-01统一客户端下载页)。

2026-11-02 UC-AC-R1：逐项上线验收已发现并修复后台图片交付、工具主题、外站浏览器入口和备份预检问题；598项前端及1480项原生单元通过，但原生退出保护、完整迁移/扩展隔离、真实业务与三平台发布仍有门禁，**不能上线**。见 [验收报告](opentu-release-acceptance-2026-11-02.md)。

2026-11-02 UC-P03：用户批准正式实现后补齐手动原生请求、取消竞争与媒体 CSP，核实 PR #7 已包含且源码完整保留。实现与分层验证见 [原生接入记录](opentu-native-runtime-implementation.md)。

2026-11-01 UC-P01.3：按用户反馈补齐进入创作时的向上收起、布局展开和内容淡入；宿主和本地预览共用过渡组件，支持减少动态效果。验证见 [实施记录](opentu-unified-client-implementation.md)。

2026-11-01 UC-P02：用户已选择 B，并要求复用现有设置、保留手动配置。统一账户来源、顶部/画布双入口和原生受限请求已本地实现；设计修订见 [关联设计](opentu-account-binding-design.md)，分层验证及真实联调限制见 [实施记录](opentu-account-binding-implementation.md)。账户契约不变，未发布。

2026-11-01 UC-P01.2：按用户要求移除独立工作流应用、入口、资源和专属依赖，保留自由画布内部任务与旧用户数据；569 项前端测试、类型、renderer 与浏览器回归通过，见 [实施记录](opentu-unified-client-implementation.md)。

2026-11-01 UC-P01.1：用户确认创作自动向上收起助手导航；核对 opentu 版本并补齐暖白点阵显示适配，验证见 [实施记录](opentu-unified-client-implementation.md)。

2026-11-01 UC-P01：用户批准基于 [统一客户端设计 v0.2](opentu-unified-client-design.md) 开始本地预览，并指定 AiW520/tuzi-switch 的 codex/assistant-main-sync 分支。实施基线、可验收范围和限制见 [UC-P01 记录](opentu-unified-client-implementation.md)。
2026-11-02 ACCOUNT-OPEN-03：用户要求暂时隐藏账户设置入口（保留实现且不挂载）；调用摘要及账务说明移入列表下方消费统计；模型标签直接展示、移除模型页账户价格提示、统一筛选布局并美化模型详情。仅本地前端调整，契约不变。见 [开放记录](account-workspace-opening.md)。


2026-11-01 ACCOUNT-OPEN-01：用户批准四个账户内 Tab，默认密钥；四项概要仅在密钥页，不设独立总览；资料放账户设置抽屉。替代历史 Phase 1 隐藏规则，允许本地分阶段提交，未授权推送或发布。见 [账户页面开放记录](account-workspace-opening.md)。


2026-10-29 UI-15：用户授权版本历程按需自动同步公开Release，本地档案与缓存兜底；边界与回退见 [ADR-017](decisions/0017-release-history-sync.md)，验证见progress.md。

2026-10-28 MAIN-SYNC-01：将上游 main `0b5ff2bd`（中文操作统计、默认账户启动）合入已验收改造分支，保留新版工作区与失败恢复；77 文件543项前端回归、类型及 renderer 构建通过。用户授权推送 fork 并创建目标 main 的 PR，不含合并或发布，见 [同步记录](2026-10-28-main-sync-pr.md)。

2026-10-26：用户确认第一期客户端操作统计方案，ANALYTICS-02 在最新 main v1.4.2 基础上本地实施；事件范围、隐私边界与验证见 [操作统计说明](analytics-events.md)。不改变账户契约或授权发布。

2026-10-27 UI-11：五个实际 CLI 已在隔离配置和本机合成上游进行兼容验证，桌面预览包已重新构建；真实服务及用户验收待完成，见 [UI-11记录](ui11-cli-compatibility.md)。

2026-10-27 UI-10：账户 Key 已本地接入 Grok Build、Pi、MiniMax Code 配置；真实工具联调和用户验收待完成，见 [UI-10记录](ui10-native-account-tools.md)。

2026-10-27 UI-09：兔子账户公开页面、密钥及配置弹窗已统一圆角视觉，499项前端、类型与独立macOS构建通过；仅本地，真实账户与工具验收待完成，见 [UI-09记录](ui09-account-polish.md)。

2026-10-27 UI-07：已本地接入 Claude Code/OpenCode 用户级 Markdown Agent 文件管理，含冲突保护和单步恢复；前端499项、原生1437项及macOS独立预览构建通过，真实工具文件和用户验收未完成，见 [UI-07记录](ui07-agents-management.md)。

2026-10-27 UI-06：已本地补齐固定全局工作区导航、授权/本机统计真实入口及目标工具支持边界；未支持工具不静默改写 Claude。前端492项及macOS独立预览构建通过，完整用户验收和发布未完成，见 [UI-06记录](ui06-global-workspace.md)。

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


2026-11-03 UC-REL-01：用户授权正式版本与 DMG/EXE 直接下载，实施与发布证据见 [正式交付记录](2026-11-03-formal-direct-download.md)。既有验收限制仍保留，不据发布标记认定全部验收通过。
