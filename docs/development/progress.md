# 当前阶段与跨仓库进度

基线 `TA-AC-1.5-B3`，更新2026-10-13。阶段：**G1本地开发检查点已交付（desktop-v1.1）；完整平台/环境验收受限，未发布。**

## B1历史事实（非当前G1状态）

- 完整读取Word v1.5正文/表格，核查两个仓库规则、HEAD/历史、相关实现和测试能力。
- 建立PRD、源码审计、接口草案、技术方案、T01～T22任务、未决问题和ADR；客户端新AGENTS，API原AGENTS保留后追加。
- 用户已确认资料五字段及价格两开关、MySQL、desktop安全事件撤销和30m/7d/30d寿命。详见ADR-001。
- 没有业务代码/依赖修改，没有创建分支、worktree、聊天或并行实现，没有commit/push/PR，没有执行数据库迁移、部署、访问生产或无关安装/构建/测试。
- 原有21个未跟踪方案/预览/附件保持；原Word哈希见README。文档验证结果见末尾。
- 公开运行时核验（2026-10-12）：`https://api.tu-zi.com/` 响应头返回 `x-new-api-version: dev-20261012-72af0d4de348`，首页 PWA 标识同样含 `dev-20261012-72af0d4de348`；这与本地 API 审计 SHA 的前 12 位一致，但只能证明该公开入口返回的版本标识，不能证明所有实例或镜像均一致。公开 `/api/status` 显示站点名称“兔子API”、服务地址、文档入口、额度显示为 USD、`quota_per_unit=500000`、`usd_exchange_rate=0.7`、自定义货币为 `¥`、数据导出开启、签到关闭；这些是公开站点配置线索，不等同于桌面接口契约或数据库事实。
- 公开 GitHub 组织 `tuziapi` 当前可见 9 个公开仓库，未列出 `tuzi-api`；对 `tuziapi/tuzi-api` 的公开 API 查询返回 404。因此服务端仓库可见性、部署流水线和发布记录仍需仓库权限或运维资料确认，不能把 GitHub 组织列表当成完整仓库清单。

## 2026-10-13开发流程补充记录

- 来源：用户本轮明确补充“先本地开发，再推到远程仓库进行上线”“API上线版数据库MySQL”“API开发分支codex/tuzi-assistant-dev”。
- API开发集成分支已指定为 `codex/tuzi-assistant-dev`；后续并行实现使用从其建立的独立任务分支/worktree，本地核验后集成。客户端当前同名分支只属Git现状，本轮未指定其为开发集成分支。历史部署分支dev与本地开发分支不是同一用途，分支名不证明上线状态。
- 本轮核查：客户端HEAD `8ce1777d52fd4bce1ade76cf224f0cb2ccc07c98`、API HEAD `72af0d4de3487033e800adcc38e42e320a993f75`，两端当前分支均 `codex/tuzi-assistant-dev`；保护已有未提交文档，仅追加/修订相关流程记录，未fetch或访问生产。
- 已更新两仓库AGENTS、统一README、本进度、open-questions和API基线指针；属于事实/流程补充，不修改产品范围或接口契约，B2/desktop-v1.0不变。本轮不含业务编码、分支/worktree创建、commit、push、PR、合并、迁移或部署授权；T02～T22状态不变。
- 后续执行：获新编码授权后本地开发、测试、分任务commit；push及上线分别遵守另行授权和发布门禁。MySQL精确版本、运行实例/拓扑、隔离环境与容量仍按Q02/Q04/Q09处理。
- 文档验证：本地Python标准库检查与修改前快照对比，六个目标文件的本地链接/围栏/行尾检查通过，其余既存文件哈希不变；两仓库 `git diff --check` 退出0，HEAD/分支/暂存区不变。没有运行业务测试、构建、安装或环境探测；不构成数据库或线上验证。

## 任务看板

| 任务 | 当前状态 | 代码 | 测试 | 联调 | 发布 | 主要门禁 |
|---|---|---|---|---|---|---|
| 基线文档（B1） | 已交付历史基线 | 不适用 | 文档检查 | 不适用 | 不适用 | 不构成编码授权 |
| T01 | 文档设计完成（2026-10-13） | 不适用 | 文档核对通过；HTTP/DB未执行 | 不适用 | 不适用 | 运行事实/联调/容量转后续门禁 |
| T02/T03/T07 | 代码集成、审查完成；实库/浏览器验收受限 | S 615f501207b1c6d02be765fad97c469e6c213bc6 | 五Go包、6网站测试、网站构建通过 | Go＋Rust局部真实loopback通过；完整登录未测 | 未发布 | MySQL/PG、共享Redis、完整浏览器登录/2FA |
| T04/T05/T06 | 代码集成、审查完成；跨平台受限 | C ec78f883dc536a35fbbd72ae88305227d0a1ef4c | Rust18通过/2默认忽略；显式Keychain配对通过 | macOS真实Keychain＋Go；安装包回跳未测 | 未发布 | Windows/Linux、默认浏览器/冷暖OS回跳 |
| T12 | G1状态壳代码/本地检查完成 | C ec78f883dc536a35fbbd72ae88305227d0a1ef4c | TS、24定向UI、renderer构建通过 | 原生状态接线；组件测试含Mock | 未发布 | G2业务面板未实现，未冒称占位业务完成 |
| T08～T11/T13～T18 | 未开始（G2） | 未开始 | 未执行 | 未开始 | 未发布 | 本轮不扩大范围 |
| T19 | 未开始 | 未开始 | 未执行 | 未开始 | 未发布 | 隔离环境与两端实现 |
| T20 | 未开始 | 不适用 | 未执行 | 未开始 | 未发布 | 三平台已安装包/设备 |
| T21 | 未开始 | 不适用 | 未执行 | 未开始 | 未发布 | MySQL版本/规模/拓扑/容量等 |
| T22 | 未开始 | 不适用 | 未执行 | 未开始 | 未发布 | 全部AC及另行发布授权 |

仅原生认证生命周期的真实本地Go＋macOS Keychain配对通过；不是完整网站登录/2FA、已安装包或T19～T21验收。历史快照中的“未集成/进行中”由末尾交付记录取代。

## T01历史下一步与开工条件

T01已完成：十项scope、固定client/origin/callback/code寿命、IF-01～16路径/DTO/错误/单位/白名单、独立表/索引/锁序/迁移入口、限流/清理/开关、七工具支持设计及合成fixture/兼容矩阵已形成desktop-v1.0，ADR-002记录理由，API指针同步。核对由同一执行者对两端源码完成，没有虚构独立第二位reviewer；这些接口尚未实现。

下一轮编码授权后建议T02、T04、T12可独立起步，后续T03/T05/T06/T07按依赖接线。T02注册与迁移代码开发不是实际生产登记/迁移授权。Q07安全存储库/最低OS版本在T04内选型验证，未做明文fallback。MySQL精确版本/拓扑、隔离站/账户/平台、容量与灰度阈值分别是Q02/Q04/Q09，影响T19～T22；不需要重新回答产品方向问题才开始基础实现，但不能保证后续环境验证不会要求技术调整。需要产品范围变更时再向用户确认。

## 责任与跨仓库记录

角色尚未指派具体执行者。建议由本聊天后续被授权的执行者承担“接口契约/集成负责人”，维护权威文档；客户端与API执行者只负责各自任务/worktree与验证；产品范围及最终产品验收由用户，环境/发布由用户指定负责人。此安排只是工作方案，未创建执行者。

每个跨仓库任务使用以下记录，单仓任务另一端填“不适用（理由）”，不能只写分支名：

| 字段 | 填写格式 |
|---|---|
| 任务/验收 | T编号；AC/IF编号；基线ID/契约修订 |
| 客户端 | 仓库身份；独立worktree路径；codex/分支；起点SHA；交付SHA；工作区残留说明 |
| API | 同上；兼容的dev起点；迁移版本；client配置版本（不含secret） |
| 代码完成 | 日期、review范围、未完成项；不能替代测试 |
| 测试通过 | 命令、运行环境/数据库版本、退出码、证据路径、Mock与真实HTTP区分、限制 |
| 联调通过 | 两端实际运行SHA/包、隔离站点、合成账号矩阵、平台/浏览器、完整scope与AC结果、凭证已清理/撤销证据 |
| 发布完成 | 另行授权来源、API镜像/客户端包/迁移、开关、灰度与观察结果；没有就写未发布 |
| 兼容/顺序 | 可配对版本；S迁移→S应用/网页→C→灰度；不兼容组合的明确行为 |
| 回退 | 开关停desktop/保留revoke→配对应用回退；保留增量schema与撤销证据；revert提交及验证 |
| 风险/阻塞 | Q编号、责任人、下一步；不明项不标完成 |

## 验收结果模板

`AC编号 | T任务 | 客户端SHA | API SHA | 环境/平台/数据库 | 测试层级（单元/Mock/真实隔离联调/灰度） | 结果 | 证据 | 未验证限制 | 验收人/日期`。

每个AC至少包含正常、错误/权限、跨账号、恢复场景中相关的项。正式验收表全部18项填结果，不能仅勾任务“完成”。

## B1与T01验证记录

B1于2026-10-12已完成文档基础核验；T01于2026-10-13更新权威文件、追加ADR-002及t01-verification，不改原Word/source-audit/ADR-001。以下仅设计和文档验证，不是业务API测试。

- T01静态核对：两端固定SHA下OAuth/client/安全事件/Key/日志/统计/价格/性能/资料结构、迁移入口及七工具协议；IF-01～16对应AC-02～16正常/负例/恢复，全部18项AC仍由T01～T22覆盖。
- 文档一致性：`python3 /tmp/validate-tuzi-baseline.py`退出0；14个Markdown文件的本地链接、围栏、表格、常见凭证模式检查通过，18个AC、16个IF、22个T编号及全部AC任务覆盖、依赖DAG检查通过；两端B2版本指针同步。临时检查器不作为业务交付物。
- 合成fixture：Python JSON/Decimal断言退出0；6个JSON围栏解析通过，120s授权码及30m/7d/30d寿命裁剪、10s临近绝对截止、无损大整数、金额half-up舍入/单位、十项scope与八项native能力核对通过。样例不含真实凭证，不算真实HTTP/联调结果。
- 边界：上述检查器确认原有21输入逐文件SHA256不变、原API AGENTS前缀保留、两仓库HEAD/分支不变、暂存区为空且仅允许文档修改；双方`git diff --check`退出0。未运行构建/安装/业务测试/迁移/部署，没有创建分支/worktree/commit/push/PR或并行执行者。
- 限制：仅本地源码与先前公开入口非敏感证据，无法证明MySQL版本/拓扑/Redis/容量/所有实例版本。未执行网站浏览器、真实OAuth、系统安全存储、模型/支付/平台/负载验证；所有编码/单端测试/真实联调/发布仍未开始。

T01记录：C/S起点为source-audit的两个SHA；当前既有分支均codex/tuzi-assistant-dev，未新建，交付SHA不适用（文档未提交）；契约desktop-v1.0、迁移设计desktop-oauth-1；产品范围不变；相关问题见open-questions。后续实现必须登记两端独立交付SHA及实际验证，不能用本记录替代。

## 当前G1执行（优先于上方历史文档任务记录）

- 用户/goal正式授权G1本地编码、依赖、隔离测试、子智能体、worktree、本地commit及集成；不push/PR/部署，不进入G2。
- 两端集成分支codex/tuzi-assistant-dev。客户端已有分支符合本任务故继续使用，起点8ce1777d52fd4bce1ade76cf224f0cb2ccc07c98；API依指定分支，起点72af0d4de3487033e800adcc38e42e320a993f75。
- 开工时C的AGENTS/docs/development/product-plan-v1.5/Word未跟踪，S的AGENTS已修改、指针未跟踪；均读取核对并保留，快照/tmp/tuzi-g1-baseline。只定向提交本任务相关基线文档/代码，不夹带附件预览。
- 主智能体负责公共契约/进度/指针和集成；server负责T02/T03/T07，worktree /Users/syd08/Documents/tuzi/tuzi-api-g1-server，codex/g1-server；native负责T04/T05/T06与lib.rs，/Users/syd08/Documents/tuzi-switch-g1-native，codex/g1-native；navigation负责T12/App.tsx/UI/i18n，/Users/syd08/Documents/tuzi-switch-g1-navigation，codex/g1-navigation。各自从对应集成起点建立，不共享可写目录。
- ADR-003闭合日志/退款/累计与窗口统计、安装标记/required、兼容回退和keyring3.6/固定HTTP；B3/desktop-v1.1保持scope/OAuth wire/寿命，G2日志增加refunded语义。设计闭合不等于代码通过。
- T02/T04/T12实施中，后续T03/T05/T06/T07按依赖；作者定向测试→稳定SHA非作者审查→修复复验→本地集成。代码/测试/真实联调/发布尚未完成。实际证据登记g1-verification.md。

### G1阶段提交与审查（进行中）

文档配对C `4aa2343` / S `196aef035`，均集成codex/tuzi-assistant-dev。navigation非作者稳定文档审查无剩余阻断。server首T02提交 `bd28e0fbb` 尚未集成：主智能体非作者审查要求修复schema/独立开关、显式迁移不兼容拒绝/已装缺失、清理锁围栏等；定向测试通过但不能标T02完成。原生与导航接线/测试继续。所有业务交付SHA与最终测试待登记，不建议此刻进入G2。

### G1原生与导航审查快照

- native稳定 `94fa489`：T04/T05安全存储与认证基础；作者报告Rust账户单测9通过/1忽略，显式macOS Keychain唯一合成条目测试1通过且删除后NoEntry。navigation正在非作者审查稳定提交。Windows/Linux和已安装包回跳未验证。
- navigation稳定 `216d7ba`：T12八入口/原工具导航；作者报告TS类型检查、renderer构建、17项定向测试通过。主审确认invalid状态保留令牌但页面不提供logout，clear失败也缺重试清除路径；已退回修复，并要求补回归测试。
- 主审另要求native将refresh journal恢复的localCleared修正为false，避免误报已清除；T06请求/cache及故障测试继续。上述均未集成，不能以作者测试代替最终复验。

### G1第二次审查快照

当前API任务分支稳定到 `1d5ddd76a`，原生任务分支到 `81a145a`，导航到 `4864283`；均未正式集成。主审定向Go测试通过但新marker版本探针失败；hard-delete-with-data撤销漏口已确认。navigation非作者发现插件把auth URL广播到WebView，native正在修复。T06真正并发401运输、T03网站、T07限流/清理/安全入口测试继续，G1保持未完成。详情见g1-verification。

### G1第三次稳定审查快照

API `8c0f887f1` 在独立review worktree的五包定向测试与未知marker版本探针均通过；删除/恢复不复活、token归属及scope绑定已补回归。剩余：冻结限流分桶尚未按规格实现，HTTP测试暴露custom scheme回跳构建错误正在修正，跨连接/并发及全部安全入口测试需补足。原生 `ff93465` 修复raw回调广播、存储读取失败的清除状态及退出后内存凭证保留；navigation非作者结构复查通过，实际运输故障测试继续。Rust→Go首次fixture试跑遇到测试服务Redis默认值错误，已停止并修复中，不能计联调通过。

## G1最终本地交付检查点（2026-10-13）

必要规范修订已闭合：B3 / desktop-v1.1 / scope desktop-v1，ADR-003。不改产品范围和令牌寿命，不进入G2/G4；所有发现的阻断代码问题已修复并复验。主智能体核查作者证据并在独立worktree审查API，navigation非作者审查native；主智能体审查T12，详见[g1-verification.md](g1-verification.md)。

| 仓库/任务 | 起点 | 已审稳定任务提交 | 本地集成代码检查点 |
|---|---|---|---|
| C T04/T05/T06 | 8ce1777d52fd4bce1ade76cf224f0cb2ccc07c98 | codex/g1-native 34f4274de126b25d06745e7364b78167d2de712f | codex/tuzi-assistant-dev ec78f883dc536a35fbbd72ae88305227d0a1ef4c |
| C T12 | 同上 | codex/g1-navigation 4864283e3c73a6d8b037c7a398e0c68f666b9cff | 同上；native合并后导航合并，追加非作者已审MSW测试补丁 |
| S T02/T03/T07 | 72af0d4de3487033e800adcc38e42e320a993f75 | codex/g1-server 9abd1fa3eb64a3a5faa22e87f93526f4a0d6e276 | codex/tuzi-assistant-dev 615f501207b1c6d02be765fad97c469e6c213bc6 |

阶段提交保留独立任务历史；文档阶段C 4aa2343/5b21cc0/ee20c06/a8cad8b/81f419e，S 196aef035/be599deec。最终文档提交在上述代码检查点之后，可由本地git log定位；它们不改变运行代码配对。原Word/product-plan预览附件未提交、未改动；API主工作区无业务残留。子任务/审查worktree保留供复查，不无差别清理。

实际本地验证：Darwin arm64，临时SQLite文件/合成用户、独立macOS Keychain测试条目；集成C类型检查、24个UI/query/App测试、renderer构建通过；S五包定向Go测试、6网站组件测试/22断言、Vite网站构建通过。非作者native稳定34f4274测试18通过/2默认忽略，旧import定向30项此前通过且最终增量未改插件。显式真实Keychain＋Go认证/刷新/退出配对1项通过、条目删除确认NoEntry、fixture停止和临时DB清理；不是Mock，也不是完整网站浏览器验收。

兼容组合：上述C/S代码检查点，desktop-oauth-1 schema。未来另授权部署顺序仍为S显式迁移→S应用/网页（默认关桌面）→独立client登记→C→受控验证；本轮没有生产迁移/登记。兼容回退候选S 615f501须保持用户安全事务钩子/revoke/连接管理/cleanup/schema检测，关闭签发/刷新/业务并永久保留DESKTOP_SCHEMA_REQUIRED；保留schema/撤销证据，不回退未知桌面表的历史二进制。隔离SQLite开关/撤销/清理测试通过不替代实际MySQL副本回退演练。已提交代码变更通常git revert，不能用应用revert删除数据库证据。

仍受限：MySQL精确版本/主日志库拓扑、PG实库、多实例Redis与DDL/负载/回退实测；Windows/Linux安全存储及安装包；macOS实际默认浏览器、完整网站登录/2FA、OS冷暖回跳。G1代码交付完成不等于这些任务完整验收通过；T19～T22未开始、发布未完成。未使用生产端点/不明DSN，无push/PR/部署。

建议可进入G2本地开发，须新任务授权；不建议上线。最少后续环境信息是脱敏MySQL版本及拓扑、可用隔离DB/Redis测试环境、Windows/Linux/macOS安装包测试设备。缺少这些不阻塞冻结契约下的G2普通实现，但阻塞相应实库/平台/首版验收。本轮停在G1检查点。

最终补验：native34f4274（与集成原生代码一致）＋API集成5abbe82f6在真实macOS Keychain/Go loopback再次1项通过，消除早期API配对版本限制；服务和唯一条目清理完成。精确命令及证据见g1-verification末尾，未扩大浏览器/平台/数据库通过范围。

## G1 用户反馈修复（进行中，2026-10-13）

四项反馈经源码确认成立：text/plain绕过桌面专用授权限流、展示账户未绑定批准账户、临时刷新错误直接终止连接、连接列表遗漏RT闲置过期。按ADR-004冻结desktop-v1.1安全修订r1。起点C 1504b05250e47c0c5bb536674f6261d9cbcd8b66 / S 5abbe82f69ffb9fa754a2a4533b1a5b6a1cfbd28，均codex/tuzi-assistant-dev；原未跟踪Word及预览保留。server/native分别在独立codex/g1-auth-followup-server与codex/g1-auth-followup-native实施；主智能体负责公共文档和服务端非作者审查，navigation负责原生非作者审查。此次新增回归尚未通过，不把此前交付视为已修复。

### G1 r1 修复交付（2026-10-13）

上述四项已修复、非作者审查和当前本地验证通过，并集成回两端 codex/tuzi-assistant-dev。规范仍B3 / desktop-v1.1安全修订r1，scope/寿命/schema不变。T02/T03/T06/T07本次缺陷重新关闭；T12不变，不扩大G2，完整跨环境验收仍受限。

| 配对 | 已审任务提交 | 本地集成代码提交 |
|---|---|---|
| C 原生刷新/恢复 | 1ddb9b69164e0cbde583630ebf948232d2e6e09f | b85673968c4679db3878ac231ad6aebc82d58c3b |
| S 限流/授权页绑定/连接列表/刷新结果 | 155efcaf3e8ab7174d47bcbd3b9d6a3657c9ce62 | 6eca23f5a97828a91a2eb337acefd08a16c6013f |

作者server_finish/native_finish接续中断前独立worktree；review_finish在独立worktree审查原生稳定SHA，主智能体在新的API审查worktree审查服务端稳定SHA。无剩余已知阻断；原生23项通过/2默认忽略、Go五包通过、网站8项/28断言通过、网站构建通过。真实Go+macOS Keychain配对1项通过（含服务端503拒绝、RT保留及安全落盘、恢复轮换）；唯一条目删除后NoEntry，fixture停止PASS。集成后比对两端运行代码与已审/实测提交无差异，无冲突。详细命令、失败修复及限制见g1-verification。

代码完成、本地测试通过、上述限定真实配对通过；发布未执行。尚未验证MySQL/PG、共享Redis多实例、完整网站登录/2FA与安装包回跳、Windows/Linux及T19～T22。新增部署核验为共享SESSION_SECRET和代理结果头约束；旧网页与API须配对升级，无数据库迁移，不回退到本次缺陷版本。后续可在新授权下进入G2，但本轮停止在G1修复检查点。没有push/PR/生产访问；原Word/预览附件保留且未提交。
