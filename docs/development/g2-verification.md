# G2 本地验收记录

后续状态（2026-10-14）：独立验收发现 R1/P1 IP 限制与 R2/P2 未知写入保护问题，原“无剩余阻塞”结论不能覆盖该发现。两项现已定向修复并回归，精确提交与证据见 [g2-fixes.md](g2-fixes.md)；下方保持原交付时点记录，不代表本次重新独立验收。

基线 TA-AC-1.5-B3 / desktop-v1.1 / desktop-v1。2026-10-14；**G2 本地研发检查点通过**。本目标授权代码、隔离测试、独立任务 worktree、非作者审查、阶段本地提交及本地集成；不授权远程操作或生产操作，不进入 G3。下方实施中/首次失败内容为过程记录，最终结论以“最终检查点与验证”为准。

起点：客户端 `8e8ff2a974ebfd4565b7936dc02d5f3f06b8d897`，API `1cc7027863a2229fb5ffbc7f866c9cbc70a2e112`；两端集成分支均 `codex/tuzi-assistant-dev`。G1 最新独立复验通过。主工作区既有未提交 G1 验收文档及 API 指针、未跟踪 Word/预览保持，不能夹带任务提交。历史文档阶段禁编码已被当前明确 G2 目标授权替代。

## 任务—验收—接口—实现—证据清单

| 任务 | AC / IF | 实现所有权与位置 | 当前状态 | 必需证据 |
|---|---|---|---|---|
| T08 | AC-05/06/07；IF-05～08/16 | codex/g2-api；desktop 路由/控制器/DTO/本人 Key 查询 | 本地通过 | scope/角色/归属/版本/秘密投影/PATCH高级字段保留/HTTP矩阵 |
| T09 | AC-05/06/10/15；IF-09～11 | codex/g2-api；日志/统计/LOG_DB用量窄投影 | 本地通过 | type2错误/收费/退款独立、窗口/时区/分页/同request_id隔离 |
| T10 | AC-05/11/12；IF-12/13 | codex/g2-api；现有定价/质量权限快照适配 | 本地通过 | 用户价/分组/复杂计价/失效AT/1、6、24h/管理员普通视图 |
| T11 | AC-05/13；IF-14 | codex/g2-api；资料事务白名单 | 本地通过 | 五字段/null/未知/false/原子保留/并发/回读 |
| T13 | AC-06/15；IF-05/10/11/16 | codex/g2-ui；账户总览/精确金额/本机状态 | 本地通过 | 真实原生接线、单位/数据来源/迟到与切号 |
| T14 | AC-07/15/16；IF-06～08 | codex/g2-ui；Key页面/表单/主动揭示 | 本地通过 | CRUD/分页/筛选/秘密清理/未知结果不重试 |
| T15 | AC-08/09/16；IF-08 | codex/g2-tools；既有provider创建/原生写集事务/关联DAO | 本地通过 | 七工具临时目录/完整备份/零写入/补偿/恢复/并发冲突 |
| T16 | AC-10/15；IF-09/10 | codex/g2-ui；调用详情/筛选/摘要 | 本地通过 | 筛选重置分页、单位/状态/缓存取消/无敏感正文 |
| T17 | AC-11/12/15；IF-12/13 | codex/g2-ui；模型市场/性能与T15入口 | 本地通过 | 隔离快照/复杂计价/空样本/单位/1、6、24h/兼容配置 |
| T18 | AC-13/14/15；IF-14/15 | codex/g2-ui与codex/g2-native；资料/固定网页opener | 本地通过 | false/PATCH回读/固定URL/兑换能力/无凭证传网页 |
| 原生运输 | AC-03/15/16；全部G2 IF | codex/g2-native；src-tauri/src/tuzi_account/business.rs | 本地通过 | 受限端点/代次/并发401一次刷新/403/429/只读有界重试/写不确定 |
| 本地真实配对 | G2目标硬条件4 | 合成Go HTTP/临时SQLite→Rust真实业务链路 | 最终配对通过 | 全业务与鉴权错误实测；服务、DB、专用系统存储条目清理 |
| 最终独立审查/集成 | G2目标硬条件5～7 | 非作者固定SHA审查、修复复验、两仓本地集成 | 审查及集成通过 | 最终配对SHA/复现步骤/兼容与回退记录 |

上表各任务的范围内AC均通过本目标要求的G2本地研发验收，最终证据如下。作者测试、非作者审查、实际配对、发布分别记录；用户产品验收未代为确认。未运行生产 MySQL/PG、多实例 Redis、Windows/Linux 实机、安装包、完整浏览器/2FA；这些作为 G3/后续环境门槛，不替代 G2 必须完成的本地验证。没有 push、PR、部署、生产迁移或付费测试。

## 原生传输阶段证据（2026-10-14）

`codex/g2-native`：`83e0568c7e76c67fa28ede9777bd73d975a8e68d`。受限 desktop 路径与固定网页目标；业务响应白名单契约校验；连接/身份/代次隔离；取消业务请求但不取消刷新 journal；并发 401 一次刷新；403 不刷新；429 保留 Retry-After；只读最多两次重试；写操作不自动重试并区分结果未知。同步工具事务来源守卫持有账户锁，拒绝失效授权、刷新中、用户/代次不符。

作者验证：

- native worktree 中 `CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account -- --test-threads=1`：27 passed、3 ignored；ignored 为显式系统安全存储及两种 Go 配对测试。
- API `codex/g2-api` 尚未提交的合成 fixture，`TUZI_DESKTOP_LOOPBACK_PORT_FILE=/tmp/tuzi-g2-api-origin go test ./router -run '^TestDesktopLoopbackFixture$' -count=1 -timeout=12m`；原生 `TUZI_NATIVE_TEST_ORIGIN=http://127.0.0.1:54191 ... cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account::tests::real_go_business_pair -- --ignored --exact`：1 passed（最终提交配对仍须再执行）。
- 实测账户/能力、Key组/创建/详情/揭示/PATCH/启停/搜索/删除、本人日志/摘要/统计/用量、模型价格和 1/6/24h 性能及 batch、五字段资料更新/回读/敏感字段拒绝；原生响应解码实测旧系统令牌 401、错误契约 409、跨用户 header 403。额外 header/版本 probe 仅 cfg(test)，正式应用没有任意 origin/headers 通道。
- Go fixture 停止后 PASS，关闭 HTTP 和临时 SQLite、移除端口文件与临时数据库；Rust 使用唯一合成安全存储命名空间，测试末尾断言删除后的 NoEntry，Drop 亦作清理。

本项为 G2 真实隔离本地配对证据，不是 T19 完整浏览器/安装包联调。API 最终 SHA 配对、非作者审查及集成未完成，G2 仍未通过。

## API 固定提交审查与本地集成（2026-10-14）

非作者主智能体审查 API `6518993325b312549bb7017b6f30c57ca07c7aa6`（T08/T11/T09/T10分别提交后追加修复）。覆盖 dedicated desktop 鉴权、契约与 scope、管理员本人视图、DTO 投影、Key 高级字段保留、settings 行锁原子合并、日志独立计费/退款语义、LOG_DB用量、用户折扣/特殊/表达式价格及快照、性能历史各自时间戳。最终新增修复补齐新鉴权上下文价格配置，禁止生成Key及完整settings写入的Gorm诊断日志；未知JSON、非法query编码及DELETE正文拒绝。当前固定提交无未解决API验收阻塞。

API 在 `codex/tuzi-assistant-dev` fast-forward 本地集成至上述SHA；原有 `docs/tuzi-assistant-development.md` 未提交修改仍保留。集成目录执行 `go test ./controller ./middleware ./router ./model ./cmd/db-migrate -run 'Desktop|OAuthProvider|Pricing|UserSettings|MigrationArgs' -count=1 -timeout=120s`：五包通过。任务分支 `go test ./pkg/perf_metrics -count=1 -timeout=120s` 全性能引擎测试通过。缺scope 403使用可信context路由单测；缺完整scope的持久凭证按G1规则401，不伪造降低scope的正式grant。

固定API `6518993325b312549bb7017b6f30c57ca07c7aa6` 与native `83e0568c7e76c67fa28ede9777bd73d975a8e68d` 第二次真实配对：Go合成fixture `127.0.0.1:55775` → Rust `real_go_business_pair` 1 passed；覆盖前述完整业务和鉴权错误。随后fixture停止，Go PASS、exit0，端口/stop文件删除、55775无监听、测试临时DB关闭清理。最终工具来源守卫修订及客户端集成提交仍须重新配对。

## 客户端审查修复进展

UI作者在 `89207fae65e3c3aeb7eabe5a90ed0cc76654c893` 完成42项相关测试、typecheck和renderer build。非作者主智能体检查发现资料未知写入结果回读后不能再次保存，`9cee750c7733b9655c5dd95516f674d507946a9b` 修复为仅成功回读后清错误并重建表单；`69cca49` 增补同日用量/摘要窗口相同断言，18项业务组件测试通过。Key关闭/筛选/分页/取消及迟到create/reveal按epoch丢弃；模型和配置页处理snapshot_changed。工具完整事务仍在补强来源证明、Codex异步派生写入、恢复冲突可见记录和Windows环境签名；未完成最终审查，不判G2通过。

主集成客户端中间检查点 `983b5af79a14e6aa8cdac1f31fc866fc823cd1e8`：typecheck通过；账户/查询/兼容/App六文件45项测试通过；`pnpm build:renderer`通过（既存bundle大小、动态导入和浏览器数据库陈旧提示）。既有供应商流程回归命令 `pnpm exec vitest run tests/components/ProviderForm.test.tsx tests/components/AddProviderDialog.test.tsx tests/hooks/useProviderActions.test.tsx tests/components/ProviderActions.test.tsx tests/utils/providerConfigUtils.apiKey.test.ts tests/utils/providerConfigUtils.codex.test.ts`：六文件68项通过。最终T15原生/预填增量尚未集成，不将本次结果冒充最终检查点验证。

工具固定提交 `2e2289c92dba8c8665431c68314864c042feedf2` 经API非作者事务审查通过；原生来源提交 `23e411454d300fabc8b5ca1218b513601b3f066a` 经UI非作者审查通过。工具作者逐工具11项事务、28项provider回归、176项config回归通过；UI独立账户Rust31通过/3默认忽略，API独立事务11项与账户业务8项通过。主智能体追加发现旧endpoint的userinfo/query/fragment可能在预览展示，`4a181140096dc7ba7a2652213537e9d97297b73e`脱敏修复、合成负例和Windows readonly恢复已审查并本地集成。

最终配对首次尝试（API651899332、客户端717a174，127.0.0.1:57975）在揭示失败：API返回裸48字符模型Key，而新原生来源证明要求sk-前缀，触发invalid_response；单端测试未覆盖此差异。当前G2仍未通过，必须修复并复验。失败fixture已正常停止，Go PASS/exit0（170.422s），端口无监听且origin/stop文件已删除；Rust专用Keychain由Drop清理。不得将fixture生命周期PASS当业务配对PASS。

## 最终检查点与验证（2026-10-14）

最终配对代码：客户端 `49ea2584c2a6f8f9699ef62eb210aa63e778d268`；API `665f318466afce017a8db89c349eeedefcf7f3ea`。两端均已集成至各自 `codex/tuzi-assistant-dev`，契约desktop-v1.1 / scope desktop-v1 / B3。文档提交在此代码检查点之后，不改变配对代码。

- 最终客户端typecheck通过；`pnpm exec vitest run tests/account tests/components/AccountPage.test.tsx tests/components/AppSwitcher.accountCompatibility.test.tsx tests/integration/App.test.tsx tests/components/ProviderForm.test.tsx tests/components/AddProviderDialog.test.tsx tests/hooks/useProviderActions.test.tsx tests/components/ProviderActions.test.tsx tests/utils/providerConfigUtils.apiKey.test.ts tests/utils/providerConfigUtils.codex.test.ts`：12文件113项通过。`pnpm build:renderer`通过，存在原有bundle大小/动态导入/浏览器数据库陈旧提示。之后仅新增7行真实pair测试，无前端业务变化。
- 集成目录Rust `tuzi_account`：31通过/3默认忽略；`services::tuzi_provider`：12通过。ignored不算通过，业务Go配对另显式执行。作者既有provider28项及config176项回归通过；非作者独立账户31项、事务12项与business8项通过。七工具使用临时home和合成Key，逐工具覆盖完整写前备份、保存、失败补偿、恢复、并发冲突；Codex第二卡独立env与imagecompat后台副作用、恢复自身IO失败补偿亦覆盖。
- API集成目录 `go test ./controller ./middleware ./router ./model ./cmd/db-migrate ./pkg/perf_metrics -run 'Desktop|OAuthProvider|Pricing|UserSettings|MigrationArgs|Performance' -count=1 -timeout=120s`：相关五包通过；该过滤下perf_metrics无匹配测试，不能计为性能引擎验证。性能引擎另由作者执行全包 `go test ./pkg/perf_metrics -count=1 -timeout=120s`通过。Key格式修复另由非作者HTTP复验通过。
- 最终真实配对：API665f31846启动合成SQLite/HTTP `127.0.0.1:58751`，客户端49ea258执行 `real_go_business_pair`：1通过/0失败。覆盖完整业务、401/403/409鉴权错误、Key创建/揭示sk-可调用格式、错误token/错误Key来源拒绝、正确来源成功与再次消费拒绝、当前Key模型协议资格正负例。fixture随后Go PASS/exit0（68.671s），临时数据库/服务清理，origin/stop文件删除，58751无监听；Rust正常退出断言专用Keychain删除后NoEntry。前述失败已修复且复验通过。
- 非作者固定审查：主智能体审API651899332全量与665f31846修复；tools独立审665f31846并HTTP通过；API审工具2e2289c及4a18114且独立12项通过；UI审来源23e4114、工具选模型、最终集成08ce0be；最后测试only fd0ce97→49ea258由主智能体审查并真实配对通过。集成均无冲突，注册/参数/模块连接已核对，无剩余验收、安全或配置损坏阻塞。
- 文档收尾：两仓G2入口/任务/契约格式注解/进度/验证/ADR/API指针的UTF-8、Markdown本地链接、围栏与表格列数检查通过；两仓`git diff --check`通过。用户既有G1验收文档、进度及API指针增量不夹带入G2文档提交。

兼容：旧网站API保留裸Key存储/返回规则，desktop create/reveal返回网站复制动作相同的sk-可调用形式；未改旧认证/relay/支付/计费引擎。服务器G2无生产schema迁移；客户端增量本机关联表排除WebDAV/SQL导出。OAuth仍仅系统安全存储，不进入任何工具备份。

回退：使用git revert本地任务提交，先回退依赖G2 IPC的页面与T15入口，再回退原生业务/工具事务，之后回退服务端G2 facade；保留G1与R1/R2安全修复和增量OAuth表/撤销证据。工具真实配置使用本机备份入口核对恢复，不能用Git回退代替配置恢复；并发/损坏记录保留人工核对而不强制覆盖。发布时的开关停desktop/保留revoke、API/网站/客户端配对顺序仍按technical-design执行，本目标未发布。

## 本地复现步骤

所有步骤只用本地合成数据，不需要生产账户、模型Key或付费模型调用。先核查两个仓库实际HEAD与本文最终配对记录，不能把开发分支名当部署版本。不要执行 npm version 或 release 脚本（postversion会push）。

1. 客户端目录运行 `pnpm typecheck` 和本文最终React命令；原生运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account -- --test-threads=1` 与 `cargo test --manifest-path src-tauri/Cargo.toml --lib services::tuzi_provider -- --test-threads=1`。逐工具测试在内部将CC_SWITCH_TEST_HOME指向临时目录，结束还原环境，不修改真实工具配置。
2. API目录运行上文五Go包定向命令与 `go test ./pkg/perf_metrics -count=1 -timeout=120s`。仅自动化测试创建隔离SQLite，禁止把真实生产DSN带入验证。
3. API目录启动 `TUZI_DESKTOP_LOOPBACK_PORT_FILE=/tmp/tuzi-g2-repro-origin go test ./router -run '^TestDesktopLoopbackFixture$' -count=1 -timeout=12m`。等待该文件产生实际127.0.0.1随机端口；文件内容是测试origin，不是秘密。
4. 在客户端目录，把实际origin代入 `TUZI_NATIVE_TEST_ORIGIN=http://127.0.0.1:<端口> cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account::tests::real_go_business_pair -- --ignored --exact`。正式应用不支持此任意origin；仅cfg(test)允许loopback。macOS测试需要本机系统安全存储可用，使用UUID专用命名空间；测试断言退出后NoEntry。
5. 创建空文件 `/tmp/tuzi-g2-repro-origin.stop` 停止fixture，等待Go PASS和退出0；确认origin/stop文件删除、端口不监听、临时DB已清理。不要把持续运行的fixture当配对完成。

## G3 准备门槛（本目标不执行）

- 运维提供真实MySQL版本、主库/LOG_DB拓扑、读写副本、驱动/连接池与实际运行镜像SHA；在隔离副本复验G1安装、行锁并发profile、查询索引、限流和回退。保留SQLite/MySQL/PostgreSQL兼容，不以SQLite测试替代实库。
- 明确Redis共享权威、实例数、SESSION_SECRET一致性和反向代理头策略；多实例不能用本地单实例限流开关替代共享验证。
- 提供三平台安装包/签名/协议回跳环境，执行Windows安全存储/注册表环境变量、Linux安全存储及七工具实际配置兼容；Claude Desktop Linux按现有不支持状态。
- 执行完整默认浏览器网站登录/2FA/签名确认/账户A与B差异/取消及回跳、安装包OAuth恢复/安全事件撤销；G2合成session不代表T19完整浏览器联调。
- 验证原网站/旧OAuth/模型调用/支付兼容时使用隔离非付费场景；真实订单、生产登记/迁移/部署、push/PR仍须另行授权。T19—T22证据闭合和明确发布授权后才进入上线流程。
