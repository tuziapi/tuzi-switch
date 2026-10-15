# G1验证与配对交付记录

2026-10-13，B3 / desktop-v1.1 / scope desktop-v1。G1本地代码交付完成；未验证平台/实库/完整浏览器保持受限。历史审查快照由最终记录覆盖，不把计划断言计为通过。

**最新验收补充：** 当前C74aa8ed / S7c131f18e在本聊天独立复查中，现有定向测试通过，但新增路由边界探针复现两项缺陷，G1验收暂不通过。旧client系统令牌授权兼容、token请求体限长须修复并补正式回归。见 [G1独立验收报告](g1-acceptance-review.md)；下方历史“无剩余阻断”不覆盖本次新增发现。

## 必须执行的矩阵

| 任务 | 必测 | 证据状态 |
|---|---|---|
| T02 | public/旧confidential隔离、S256/固定redirect/全集scope、code一次/过期、AT30m/RT7d/绝对30d、并发轮换/重放 | Go model/HTTP测试通过；真实原生局部配对通过 |
| T02迁移 | 新/旧/部分安装/重跑、不兼容拒绝、never-installed/required/installed缺失 | 隔离SQLite及两独立进程竞争安装测试通过；MySQL/PG实库未测 |
| T03 | context不签发、纯网站session、Origin/CSRF、切号/恢复、批准/取消/回跳失败 | HTTP与6网站组件测试通过；完整网站登录/2FA和浏览器回跳未测 |
| T04 | 无明文降级、条目清理、IPC/日志隔离、记录绑定、受信HTTP | 原生故障/协议测试通过；真实macOS Keychain＋Go配对通过并确认NoEntry；Windows/Linux未测 |
| T05 | deep-link入口、错state/重复key/取消/超时/重复callback、身份/scope、旧import | 原生测试及原import30项通过；冷暖安装包OS回跳未测 |
| T06 | single-flight、401一次/403不刷、崩溃/写失败、退出迟到不复活、缓存隔离 | 原生18项及query4项通过；实际HTTP并发401只1 refresh、挂起请求期间logout、三次自动重试预算覆盖 |
| T07 | 两用户多连接、安全入口原子撤销/回滚、清理保留/围栏/暂停、桶隔离/Redis故障 | Go隔离SQLite/HTTP测试通过，含disable/reenable、email/admin password、软/硬删除、刷新vs禁用；真实共享Redis未测 |
| T12 | 八账户入口、七工具原页、原生状态接线、错误/取消/清除重试 | 集成TS、24项UI/query/App测试、renderer构建通过；组件含Mock，未冒充业务联调 |
| 兼容回退 | 关签发/刷新/业务仍保留revoke/安全事件/cleanup/schema检查 | SQLite独立开关/撤销/清理测试及固定代码审查通过；实际MySQL副本回退T21未测 |
| G2统计规范 | 收费失败非成功、退款优先、历史unknown、累计vs窗口、日志缺失 | 契约已闭合；G2业务实现/实测未开始 |

## 环境及限制

不读取生产数据库配置或访问生产数据。使用本地隔离DB/合成凭证/临时工具路径，不运行version/postversion/release。跨平台已安装包和完整首版T19～T21不在G1通过声明之内。独立审查必须登记作者外审查者、稳定SHA、具体发现和复查结果。

## 实际执行

- 开工Git核查：C 8ce1777 / S 72af0d4de，均codex/tuzi-assistant-dev；三个独立worktree创建成功。
- Rust选型：native执行cargo info keyring@3.6.3成功，MSRV1.75；平台后端及Linux crypto-rust已纳入ADR-003。不是OS存储运行验证。

- 规范非作者预审：navigation检查当前B3修订，发现IF-10 error_count和分桶可能被误读。已明确error_count只统计type6错误日志，不包括type2 error_charged；桶按桌面start/interval而非直接透传原自动桶。补G2 fixture：type2 error_charged + type6 → result均error但error_count=1。该预审尚非稳定提交审查。
- T02非作者代码审查：主智能体检查稳定bd28e0fbb8a65477461328e93955dc21cd186216，发现schema/独立开关偏离、AutoMigrate既存表未拒不兼容、已安装丢表静默修复、清理缺围栏/暂停等阻断问题；已退回server修复，尚未集成/通过。

## 稳定规范审查与阶段提交

- 客户端规范/协作基线提交 `4aa2343`；API指针/协作基线提交 `196aef035`；两端集成分支均codex/tuzi-assistant-dev。定向提交AGENTS和开发文档，未提交Word/product-plan预览附件。
- navigation非作者审查稳定C `4aa2343`（交叉API `72af0d4de`），两项IF-10口径/分桶问题已闭合，未发现其他阻断规范问题。设计审查不代替实现、系统存储或回退实测。
- 主智能体在独立审查worktree `/Users/syd08/Documents/tuzi/tuzi-api-g1-review`、分支codex/g1-server-review、稳定 `bd28e0fbb` 执行 `go test ./model -run '^TestDesktop' -count=1`，退出0。该提交有已报告阻断设计偏离，测试通过不代表可集成；作者正修复。
- 当前本机Darwin arm64，Go/Cargo/Bun/Node/pnpm可用；未发现docker/mysql/psql可执行文件。SQLite测试可用，MySQL/PostgreSQL真实运行仍未验证，不读取不明DSN补齐。

## 原生与导航首提交审查（尚未闭合）

- native `94fa489` 作者报告：`cargo test --lib tuzi_account` 9通过/1忽略；显式真实macOS Keychain测试1通过，唯一合成条目删除后NoEntry。主审尚待复验，三平台不据此通过。
- navigation `216d7ba` 作者报告：TS类型检查、Vite renderer构建通过（既有bundle大小警告）；AccountPage/AppSwitcher/App定向测试17通过。
- 主审交叉检查上述两个固定SHA：invalid/refresh journal保留令牌使begin返回logout_required，但UI仅connected/policyError显示logout；storage clear失败同样缺清除重试。交作者修复和加测试；native的journal恢复还需localCleared=false。navigation承担native非作者固定SHA审查。

## 第二次稳定实现审查（进行中）

- API稳定 `1d5ddd76a1cdea28a6d7cdc5e8b948655bd867b5`（继承bd28e0fbb）主审在独立review worktree实际执行 `go test ./model ./controller ./middleware ./router ./cmd/db-migrate -run 'Desktop|OAuthProvider|MigrationArgs' -count=1 -timeout=90s` 全部退出0；middleware无匹配测试，不计为桌面权限验证。
- 主审在review worktree增加临时故障探针：先安装再将marker.version设999，要求apply拒绝；`go test ./model -run '^TestG1ReviewMigrationUnknownVersion$' -count=1 -timeout=30s` 失败（实际返回nil）。该阻断已交server修复，探针不混入集成代码。
- 主审发现 `HardDeleteUserWithData` / `deleteUserDataTx` 绕过桌面撤销；备份恢复同一user id可能复活连接。要求在既有用户锁事务内撤销、缺schema回滚删除、恢复不复活回归。另要求实际token/connection归属与scope检查、清理候选避免旧active连接饥饿和逐批预算。
- native第二稳定 `81a145a` 的generation/revision、立即状态发布、journal localCleared和重复userinfo修复经navigation非作者复查；T06实际多请求401/403运输测试仍在补齐。
- navigation非作者发现原deep-link插件get_current和new-url广播会把auth URL送入WebView；已交native修复，不能因Rust回调处理正确而视为凭证隔离通过。原import冷/热入口须保持。
- T12修复 `4864283`（继承216d7ba）主审确认invalid/未清除状态有显式Disconnect、清除成功后恢复Connect；作者针对native81a145a类型检查/20项测试通过。等待最终原生修复后集成复验。

## 第三次独立审查与复验

- 主审固定API `8c0f887f18b6416f8f9dcac805c8ebf6144345af`，独立review worktree执行 `go test ./model ./controller ./middleware ./router ./cmd/db-migrate -run 'Desktop|OAuthProvider|MigrationArgs|G1Review' -count=1 -timeout=90s`：五包退出0，未知marker版本故障探针由失败转通过；已有同义回归纳入作者model测试。未证明多实例/三库。
- 删除备份入口同用户锁事务增加撤销，作者回归包括删除→恢复后AT/RT仍失效、缺token表删除回滚；主审检查稳定补丁和测试通过。token/connection用户、client、scope、status、版本交叉校验已补。
- 主审发现8c限流统一20/60s不符合冻结authorize5/user/300s、exchange10/clientIP/60s、refresh6/connection/60s规则，退回修复；清理候选查询需绑定总deadline，SQLite迁移跨进程锁和认证并发测试仍需补证。作者HTTP测试发现custom-scheme回跳误用旧HTTP redirect helper，另补修复，不以model测试掩盖路由失败。
- navigation非作者复查native `c1c7346` / `ff93465`：插件三处事件均过滤精确v1/import、raw get_current权限移除、OAuth只在原生分流；ff93465修复读取安全记录失败时localCleared=false和本地成功清除后内存cleanup_token残留。独立执行运输测试尚待最终稳定提交。
- 真实Rust→Go fixture首次尝试因测试服务RedisEnabled默认值引发nil Redis故障而停止；未计通过。fixture只提供合成网站会话，不构成真实登录/2FA/默认浏览器/已安装包回跳验收。

## 最终独立审查与集成验证（2026-10-13）

### 固定提交审查

- API作者server，最终稳定 `9abd1fa3eb64a3a5faa22e87f93526f4a0d6e276`。主智能体在codex/g1-server-review独立worktree分轮审查bd28→1d5→8c→e1→9abd并执行五包及未知marker版本探针；9abd执行 `go test ./model -run 'Desktop|G1Review' -count=1 -timeout=90s` 退出0。已发现的schema未知版本/损坏忽略、硬删撤销漏口、token绑定、回跳构造、限流规格、SQLite迁移竞争、清理预算等均修复；最后增量只增加安全事件和并发回归，主审检查并复验，无剩余阻断。旧schema/旧OAuth测试保留。
- native作者native，非作者navigation固定最终 `34f4274de126b25d06745e7364b78167d2de712f`，独立review worktree运行 `CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account`：18通过、0失败、2默认忽略。审查覆盖native/HTTP/store/journal、秘密不进WebView、generation/revision与退出隔离、maintenance可见性/RetryAfter/三次预算；无剩余阻断。插件原始auth广播问题在c1/ff修复，三个入口只广播精确import，raw get_current权限移除；c8独立旧deep-link30项通过，最终增量未改插件。
- T12作者navigation，主智能体审查 `4864283e3c73a6d8b037c7a398e0c68f666b9cff`（含216d7ba）；invalid/localCleared=false缺Disconnect/清除重试已修复，未发现剩余阻断。主集成测试补丁ec78f88只给App fixture空import快照，navigation只读审查无阻断，不削弱断言。

### 集成代码检查点和命令

C `ec78f883dc536a35fbbd72ae88305227d0a1ef4c` / S `615f501207b1c6d02be765fad97c469e6c213bc6`，均codex/tuzi-assistant-dev，B3/desktop-v1.1/scope desktop-v1。native与navigation先后no-ff合并，API保留阶段提交后no-ff合并最终测试；没有push。起点和回退限制详见progress。

- C `pnpm typecheck`：退出0。
- C `pnpm exec vitest run tests/account/account-query.test.tsx tests/components/AccountPage.test.tsx tests/components/AppSwitcher.accountCompatibility.test.tsx tests/integration/App.test.tsx`：4文件24项通过。初次import IPC fixture缺handler产生MSW警告，追加已审空列表handler后 `pnpm exec vitest run tests/integration/App.test.tsx` 7项通过且无该警告；不是将未处理请求一律忽略。
- C `pnpm build:renderer`：退出0；既有大chunk/动态静态重复import/浏览器数据陈旧警告保留，不触发release/version/postversion。
- S `go test ./model ./controller ./middleware ./router ./cmd/db-migrate -run 'Desktop|OAuthProvider|MigrationArgs' -count=1 -timeout=90s`：五包退出0；middleware包含纯session及独立限流/无共享权威failclosed测试。本地SQLite文件池、两独立子进程迁移、两用户多连接、code/RT并发、refresh与禁用交错；不等于MySQL/PG/共享Redis实际运行。
- S web `bun test src/helpers/desktopAuthorization.test.js src/pages/OAuthAuthorize/index.test.jsx`：6通过、22断言，批准单次、手动重开、取消、401恢复、切号、失败重载。
- S web `NODE_OPTIONS=--max-old-space-size=8192 bunx --no-install vite build`：退出0（30.03秒），大chunk/重复import/浏览器数据陈旧警告；直接运行Vite，未执行会生成站点更新元数据的包装脚本，没有发布副作用。

### 真实本地跨仓库/系统存储配对（限定范围）

固定 native `bcdc0b1` 与 API `ad2c8f61e`（native最终只加maintenance预算；API后续包含限流、迁移并发和授权页防重复提交修复及测试，已在最终API定向/网站测试复验，早期配对不单独证明最终组合；最终版本复验见下）。API独立worktree用 `TUZI_DESKTOP_LOOPBACK_PORT_FILE=/tmp/tuzi-native-g1-keychain-origin go test ./router -run '^TestDesktopLoopbackFixture$' -count=1 -v`，显式127.0.0.1随机端口、t.TempDir SQLite、合成user/client、单实例限流；fixture login只构造网站session，未走真实登录/2FA。

native以portfile实际origin运行 `TUZI_NATIVE_TEST_ORIGIN=http://127.0.0.1:<实际端口> CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account::tests::real_go_loopback_pair -- --ignored --exact`：1通过。真实Go context/approve→native callback→exchange→userinfo→强制本地AT过期→实际RT轮换并从macOS Keychain读回一致→logout→AT拒绝/旧RT失效。唯一UUID SystemStore namespace、合成凭证、不打印令牌；显式delete后get_secret确认NoEntry，RAII异常清理。portfile.stop停止Go fixture且PASS，t.TempDir清理DB。

主智能体检查 `/tmp/tuzi-g1-keychain-pair-result.txt` 的成功输出及作者cleanup断言代码；账户最终证据 `/tmp/tuzi-g1-native-final-tests.txt` 18通过/2默认忽略。临时输出路径仅本机会话证据，不作为可迁移构建产物；关键命令/固定SHA/结果已持久登记本文件。此次真实局部配对不证明默认浏览器、完整网站登录/2FA、OS协议注册/冷暖回跳、三平台或T19完整首版。

### 未验证与交付结论

G1代码、当前可用本地验证、独立审查及阶段提交已交付。T02～T07跨环境/平台验收受限，不标完整通过；T12状态壳已交付但G2业务未实现。真实MySQL/PG、共享Redis多实例、数据库副本迁移/回退/负载、Windows/Linux、macOS安装包和完整网站浏览器路径未验证。T19～T22未开始，未发布、未用户完整验收。已停止本地fixture，没有生产访问/登记/迁移/远程操作。后续G2需新任务授权，环境信息按open-questions Q02/Q04/Q09/Q10收集。


### 最终版本真实配对补验

主智能体核验2026-10-13最终日志：native `34f4274de126b25d06745e7364b78167d2de712f`（与客户端集成src-tauri无差异）＋API集成 `5abbe82f69ffb9fa754a2a4533b1a5b6a1cfbd28`（代码检查点615f501之后仅文档）复验通过。API命令 `TUZI_DESKTOP_LOOPBACK_PORT_FILE=/tmp/tuzi-g1-final-api-origin go test ./router -run '^TestDesktopLoopbackFixture$' -count=1 -v`；native命令同前，实际受信测试origin为 `http://127.0.0.1:50133`。账户真实Go＋SystemStore Keychain测试1通过/0失败；条目delete后NoEntry断言通过，Go fixture停止PASS，临时SQLite和port/stop文件已清理。证据 `/tmp/tuzi-g1-final-native-pair.txt`、`/tmp/tuzi-g1-final-api-fixture.txt`；没有代码变更。最终API限流/迁移/授权页修复后的配对证据现已闭合，完整浏览器/平台/实库限制仍不变。

## G1 r1 用户反馈回归与交付（2026-10-13）

四项反馈均确认成立；先前G1检查点未覆盖对应场景，不能以原通过结论否定缺陷。ADR-004先冻结修订，再实现；规范提交C e0d619c / S f624a2d2e。最终稳定C 1ddb9b69164e0cbde583630ebf948232d2e6e09f / S 155efcaf3e8ab7174d47bcbd3b9d6a3657c9ce62；集成分别b85673968c4679db3878ac231ad6aebc82d58c3b / 6eca23f5a97828a91a2eb337acefd08a16c6013f，运行代码逐仓diff为空。

| 回归 | 实际检查 | 结果 |
|---|---|---|
| T02 授权限流 | 隔离HTTP网站session，text/plain、JSON charset、无媒体头均第6次429 | 通过 |
| T03 展示账户绑定 | A上下文切B后批准/取消409且无签发；新B重新确认成功；签名篡改/期限边界/缺失拒绝 | 通过 |
| T03 页面恢复 | 409清旧账户，重新展示B后第二次明确点击；重载失败无旧批准按钮；原401/取消/回跳保留 | 通过 |
| T06 暂时刷新 | 429/503+唯一精确头+完整错误体才保留RT/清journal/持久deadline；跨重启退避；恢复后轮换 | 通过 |
| T06 不确定与存储失败 | 裸429/503、错误/重复头、截断/超大体不重放；写存储失败保持journal；退出generation阻迟到恢复；超大RetryAfter不溢出 | 通过 |
| T07 列表寿命 | 当前RT闲置到期边界/绝对截止、只有历史RT、历史与当前共存、无RT、pending及revoked优先 | 通过 |

### 稳定提交的非作者证据

主智能体在 `/Users/syd08/Documents/tuzi/tuzi-api-g1-auth-followup-server-review` 固定155efcaf3逐文件检查：限流内容分类/strict controller拒绝、HMAC用途隔离/常量时间比较/纯会话绑定、结果头仅消费前产生、事务错误无标记、列表只查询本人当前RT到期字段，网页重确认与旧OAuth隔离。执行 `go test ./model ./controller ./middleware ./router ./cmd/db-migrate -run 'Desktop|OAuthProvider|MigrationArgs' -count=1 -timeout=90s` 五包退出0；日志 `/tmp/tuzi-g1-r1-independent-go.txt`。作者同命令也通过。测试开发中曾因fixture cookie停留账户75却请求72列表失败，修正登录72后复验通过，未弱化断言。

review_finish在独立 `/Users/syd08/Documents/tuzi-switch-g1-auth-followup-review` 固定1ddb9b6审查并执行 `CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml tuzi_account --lib -- --test-threads=1`，23通过/2默认忽略，无剩余阻断；日志 `/tmp/tuzi-g1-followup-native-independent-review.txt`。作者结果一致。上述2项忽略为显式系统存储/真实服务fixture，不能算默认测试通过，真实配对另见下。

主智能体在固定服务端任务工作区执行 `bun test src/helpers/desktopAuthorization.test.js src/pages/OAuthAuthorize/index.test.jsx`，8通过/28断言。作者页面单独7通过/19断言。网站直接Vite首次缺ignored generated system-updates文件失败；检查构建脚本后清空两个GitHub token，用 `SYSTEM_UPDATE_GITHUB_TOKEN='' GITHUB_TOKEN='' bun run build` 生成本地git历史元数据并构建，退出0（22.49s）；脚本无push/部署，只写ignored生成文件，既有chunk/Browserslist警告保留。日志 `/tmp/tuzi-g1-followup-web-build.txt`，没有将构建当真实浏览器验证。

### 真实本地配对与清理

C1ddb9b6 + S155efcaf3，Darwin arm64，显式Go loopback + t.TempDir SQLite合成用户/client + UUID独立macOS Keychain条目。API：`TUZI_DESKTOP_LOOPBACK_PORT_FILE=/tmp/tuzi-g1-followup-pair-port go test ./router -run '^TestDesktopLoopbackFixture$' -count=1 -v`；原生：`TUZI_NATIVE_TEST_ORIGIN=http://127.0.0.1:56563 CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account::tests::real_go_loopback_pair -- --ignored --exact`。1通过：签名context授权/换码/身份→测试专用端点关闭合成client刷新→真实503 not-consumed→Keychain读回RT未变、journal=false、deadline持久→新service保持退避→恢复开关并仅在测试中推进deadline→真实轮换→退出、旧AT/RT拒绝→delete后NoEntry。不是Mock，但fixture login直接创建session，未覆盖真实登录/2FA或默认浏览器。429真实服务端限流和原生恢复分别有HTTP测试，跨仓库配对本次使用503场景。

主核对 `/tmp/tuzi-g1-followup-native-pair.txt`、`/tmp/tuzi-g1-followup-api-fixture.txt` 及测试源码断言；fixture退出PASS、port/stop删除、临时SQLite清理。仅合成凭证，不访问真实工具目录/生产数据。

文档检查：旧T01检查器仍假定HEAD不变和未提交文档，故在已授权编码提交后报基线状态不符；保留该事实，未将它算通过。按当前任务运行独立 `/tmp/validate-tuzi-g1-r1-docs.py`（链接/表格/围栏/18AC/16IF/22任务及依赖、21保护输入哈希），17文档无错误；另核查实际分支/提交/工作区和git diff --check。临时输出仅本机会话证据，结果已在此持久记录。

限制不变：MySQL/PG、共享Redis多实例、全浏览器/2FA、安装包回跳、Windows/Linux、发布拓扑及T19～T22未验证；新增共享SESSION_SECRET和代理结果头发布核验见open-questions。G1此次四缺陷已关闭，无push/PR/部署，不代表可上线。

## R1/R2 修复后复验（2026-10-13）

修复后的 API 集成提交为 R2 `1ff07d190`、R1 `20f797d33`，对应独立任务提交分别为 `0a319f14fa687b741a3f663d46208218b33f8fd8` 和 `8ffbf5d027f7ed824f5a7da3f65c3b9619b54c82`。R1/R2 正式回归均通过，非作者独立只读审查结论为通过、无阻断；客户端业务代码未改，客户端检查点仍为 `74aa8ed5de159e7ea2c7150e47e449fc660387eb`。

- R1：`go test ./router -run 'TestOAuthProviderAuthorizeRoutesPreserveLegacyAndDesktopAuth|TestDesktopAuthorizationHTTPAccountBindingAndMediaTypes' -count=1`，以及相关 controller/middleware 定向测试通过。
- R2：`go test ./middleware ./router -run 'TestDesktopOAuthRateLimitBoundsStreamingAndLegacyFormReuse|TestDesktopOAuthTokenBodyLimitDoesNotConsumeGrant' -count=1` 通过；覆盖 64 KiB 边界、未知长度流式、桌面/旧 client、换码/刷新和不消费语义。
- 集成：`go test ./model ./controller ./middleware ./router ./cmd/db-migrate -run 'Desktop|OAuthProvider|MigrationArgs' -count=1 -timeout=120s` 通过；`go test ./middleware ./controller ./router -count=1` 通过；`git diff --check` 通过。

仍未验证 `go test -race`、真实 MySQL/PostgreSQL、共享 Redis 多实例、Windows/Linux、安装包回跳、真实浏览器完整登录/2FA 和跨平台联调。R2 未单独增加未知长度恰好 64 KiB 成功边界与 revoke 超限状态断言，审查未发现实现绕过，作为后续增强记录。修复后的 G1 检查点具备在新任务授权下进入 G2 本地开发的条件；本轮不进入 G2、不发布。

## 2026-10-14 独立复验补证

当前 C `8e8ff2a974ebfd4565b7936dc02d5f3f06b8d897` / S `1cc7027863a2229fb5ffbc7f866c9cbc70a2e112`。客户端增量仅文档；服务端 R1/R2 代码及正式回归经当前执行者复查。五包 Desktop/OAuthProvider/MigrationArgs 定向 Go 测试、middleware/controller/router 三包测试均通过（`-count=1 -timeout=120s`，unset loopback fixture 环境变量）；网站授权 8 项/28 断言通过。两项独立临时 overlay 探针通过：71,914 字节 form 两条链均 400，旧客户端有效系统令牌在原 UserAuth/现实际分流链均 200。详细命令、范围和未重复验证项见 [g1-acceptance-review.md](g1-acceptance-review.md)。G1 本地研发门禁通过，后续 G2 编码仍需用户提交新目标；无生产/远程操作。
