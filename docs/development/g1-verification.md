# G1验证与配对交付记录

2026-10-13，B3 / desktop-v1.1 / scope desktop-v1。当前实施中，本文件不把计划断言计为通过。

## 必须执行的矩阵

| 任务 | 必测 | 证据状态 |
|---|---|---|
| T02 | public/旧confidential隔离、S256/固定redirect/全集scope、code一次/过期、AT30m/RT7d/绝对30d、并发轮换/重放 | 待执行 |
| T02迁移 | 隔离新库/旧库/部分安装/重跑、列索引不兼容中止、never-installed/required/installed缺失 | 待执行；三库实际服务分别记录 |
| T03 | context不签发、纯网站session拒旧token、Origin/CSRF、账号切换/登录恢复、批准/取消/回跳失败 | 待执行 |
| T04 | 系统存储故障无明文、唯一测试条目清理、IPC/日志无秘密、记录绑定、HTTP无redirect/任意origin | 待执行；macOS实机与Mock分开 |
| T05 | 所有deep-link入口、重复key/错state/超时/取消/重复callback、userinfo/scope不符、旧import | 待执行 |
| T06 | single-flight、401一次/403不刷新、in-flight崩溃/响应丢失、写失败、退出/切号迟到不复活、缓存隔离 | 待执行 |
| T07 | 两用户多连接、各安全入口撤销原子性、撤销失败回滚、清理重放证据保留/围栏/暂停、桶隔离/Redis故障 | 待执行 |
| T12 | 全账户入口、七工具及原页可达、真实原生状态接线、状态/错误/取消/切号 | 待执行 |
| 兼容回退 | compatible基线关签发/刷新/业务仍revoke/安全事件/cleanup；原旧版不可充当此目标 | 待执行；实际MySQL副本T21 |
| G2统计规范 | type2收费失败不成功、退款优先、历史unknown、累计vs窗口、日志关闭非零账单 | 仅契约闭合；G2执行 |

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
