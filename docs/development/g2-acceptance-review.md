# G2 独立验收（2026-10-14）

最新复验：**R1/R2/R3 均已修复并独立复验通过；G2 本地研发门禁通过，具备进入 G3 验证阶段的条件。** 以本文末尾“R3 修复后独立复验与 G2 门禁结论”为准，下方不通过结论保留历史；不表示 G3、正式产品验收或发布通过。

结论：**G2 暂不通过**。已交付范围内的主体实现与现有本地回归通过，但独立验收复现 R1 安全缺陷及 R2 不确定写入恢复缺陷；修复并复验前，不应把 G2 标记为无剩余阻断或直接进入 G3。

## 范围与版本

- 用户授权：验收 G2 是否达到要求；本轮仅代码/文档审查、隔离验证及验收记录，不修改业务实现、不提交、不推送、不执行 G3 或生产操作。
- 权威基线：TA-AC-1.5-B3 / desktop-v1.1 / desktop-v1；PRD、tasks、api-contract、ADR-003/004/005。
- 客户端：`codex/tuzi-assistant-dev`，HEAD `b78743fdcc352b3fb9d3b54cb53a04284db04eb1`，代码检查点 `49ea2584c2a6f8f9699ef62eb210aa63e778d268`。
- API：`codex/tuzi-assistant-dev`，HEAD `38ce291b661a4ff08ba73223c2cc750383f53b69`，代码检查点 `665f318466afce017a8db89c349eeedefcf7f3ea`。
- 涉及 T08—T11 / T13—T18；重点检查本人归属/scope/DTO、秘密生命周期、日志统计口径、七工具写前备份与恢复、真实业务传输。
- 两仓库原有未提交文档及未跟踪 Word/预览附件保留。临时前端探针执行后删除；Go 探针采用仓库外 overlay，不改原测试文件。

## R1：IP 列表接受规则与模型鉴权解析不一致（P1，待修复）

影响任务：T08、T14；PRD AC-07 要求 IP 限制生效并可回读。

API `controller/desktop_keys.go:306–321` 按逗号、换行或空格拆分 IP/CIDR 校验，却原样持久化。实际模型鉴权调用 `model/token.go:129–148`：只按换行分项，并删除空格/逗号。`middleware/auth.go:1082–1104` 再用该解析结果判断允许/禁止 IP。

复现：通过真实桌面 HTTP PATCH 提交 `{"exclude_ips":"192.0.2.1,198.51.100.2"}` 或对应空格分隔值，返回 200；读数据库并调用模型实际使用的 `GetExcludeIpLimits()`，得到单项 `192.0.2.1198.51.100.2`，两项预期 IP 均不能通过实际 `common.IsIpInCIDRList` 成员判断。因此禁止列表未能阻止这些 IP；同样输入到 allow_ips 会误拦原本应允许的请求。使用合成保留 IP，无真实凭证/模型调用。

独立 Go overlay 探针 `TestDesktopG2IndependentIPRules` 包含 allow/exclude × 逗号/空格/换行六种组合：逗号/空格四种失败，换行两种通过。执行命令：`go test -overlay=<仓库外 overlay.json> ./controller -run '^TestDesktopG2IndependentIPRules$' -count=1 -v -timeout=120s`，退出 1。探针用项目 `desktopBusinessFixture`、`desktopHTTP`，HTTP 写入后检验存储 Token 的实际解析和 IP 成员关系。

修复验收：保持旧模型请求兼容，在桌面写入边界规范化为实际解析支持的格式，或拒绝不能正确执行的格式；增加多 IP/CIDR、空白、分隔符及禁止/允许优先级回归，证明桌面保存成功的限制在实际模型鉴权中生效。不要仅断言 PATCH 成功或 DTO 回读原字符串。

## R2：Key 回读失败仍清除不确定写入状态（P2，待修复）

影响任务：T14；PRD AC-07/15，以及 tasks T14 的“创建结果未知不重复提交”；api-contract 第 57 行要求写入超时显示结果待核实并回读。

`src/components/account/Keys.tsx:266–272` 无条件在 `list.refetch()` / `detail.refetch()` 后执行 `clear()`。React Query 默认把回读错误放在返回结果中，不抛异常；回读失败仍会移除 outcomeUnknown 并解锁保存。

独立 React 探针使用真实 Keys 组件、真实 QueryClient，仅 mock 原生传输：首次列表读取成功 → 创建 POST 抛 outcomeUnknown → 点击“核实结果” → 列表 GET 抛离线错误。断言结果待核实提示应保留、保存应禁用，两项均失败：提示消失且保存按钮可用。此时服务器可能已成功创建，再点保存可能产生重复 Key。

临时探针：`pnpm exec vitest run tests/account/g2-independent-review.temp.test.tsx`，1 项失败（两项行为断言失败）；执行后已删除。首次探针的错误文案匹配使用不存在的 offline 翻译项，不能作为证据；更正为实际 generic 文案后复跑，确认上述两个行为断言失败。

同类旁路也应一起检查：创建/详情/取消按钮可直接 clear，reveal 调用 useWrite 也会重置共用 error。应把未核实的写入与普通表单/揭示错误分开，不能通过无关动作悄悄解除保护。

修复验收：回读失败、仍在回读时保留不确定写入状态；成功回读后按原操作核对实际结果，再允许明确的后续操作。覆盖 create/edit/status/delete、失败回读、重复点击、切换表单、reveal、换账号等路径，不能只验证首次超时后按钮禁用。可参考 ProfilePage 已有的成功回读判断，但创建核实还需辨别新记录而非只清空提示。

## 独立验证结果

实际环境：本机 macOS / Darwin arm64，临时 SQLite / 合成用户和日志，真实 Go loopback HTTP，专用 UUID macOS 系统安全存储条目。未访问生产数据库/站点或发起付费模型请求。

| 验证 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| 前端账户/组件/兼容定向 Vitest | 12 文件，113 项通过 |
| `pnpm build:renderer` | 通过；已有浏览器数据/分块大小警告 |
| Rust `tuzi_account`（串行） | 31 通过、3 默认忽略；真实业务配对另显式执行 |
| Rust `services::tuzi_provider`（串行） | 12 通过 |
| Go controller/middleware/router/model/cmd/db-migrate 定向回归 | 五包通过 |
| Go `pkg/perf_metrics` 全包 | 通过 |
| 本轮真实 Go HTTP → Rust 业务配对 | 1 通过，0 失败 |
| R1 独立 HTTP/真实模型 IP 解析探针 | 4 个失败分隔场景、2 个通过换行场景 |
| R2 独立 React 不确定写入探针 | 复现失败回读仍解锁保存 |

前端定向命令：

```sh
pnpm exec vitest run tests/account tests/components/AccountPage.test.tsx tests/components/AppSwitcher.accountCompatibility.test.tsx tests/integration/App.test.tsx tests/components/ProviderForm.test.tsx tests/components/AddProviderDialog.test.tsx tests/hooks/useProviderActions.test.tsx tests/components/ProviderActions.test.tsx tests/utils/providerConfigUtils.apiKey.test.ts tests/utils/providerConfigUtils.codex.test.ts
```

Go/Rust 定向命令：

```sh
go test ./controller ./middleware ./router ./model ./cmd/db-migrate -run 'Desktop|OAuthProvider|Pricing|UserSettings|MigrationArgs' -count=1 -timeout=120s
go test ./pkg/perf_metrics -count=1 -timeout=120s
cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml --lib services::tuzi_provider -- --test-threads=1
```

真实配对：API 以 `TUZI_DESKTOP_LOOPBACK_PORT_FILE=/tmp/tuzi-g2-independent-review-origin go test ./router -run '^TestDesktopLoopbackFixture$' -count=1 -timeout=12m` 启动专用合成 fixture，实际端口为 `127.0.0.1:59332`；客户端以 `TUZI_NATIVE_TEST_ORIGIN=http://127.0.0.1:59332 cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account::tests::real_go_business_pair -- --ignored --exact` 执行，1 passed。Go fixture 收到 stop 后 PASS/exit0；测试结束包含 Keychain 删除后 NoEntry 断言，关闭服务和临时 DB。不是完整登录/2FA、OS 浏览器回跳、真实 MySQL 或安装包验收。

## 后续门禁

先修复 R1/R2、补有效回归、重新独立验收 G2；保留此前通过结果作为限定范围证据，不把原 g2-verification 中“无剩余阻断”继续当成最新结论。两项均属于现有 PRD 和冻结契约中的实现问题，无需用户新增产品决策。

MySQL 实际版本及主库/LOG_DB 拓扑、PostgreSQL、共享 Redis 多实例、三平台安装包/实机、完整浏览器/2FA、T19—T22 仍属于后续 G3/发布验收门禁，本轮不把这些未执行项当成上述 G2 缺陷。未代用户完成产品验收，未发布。

## R1/R2 修复后独立复验（2026-10-14）

用户本轮请求确认修复并重新判断是否可进入 G3。两仓库仍为 `codex/tuzi-assistant-dev`，客户端 HEAD `f9f153f19ca6413da9e17656b05e1175fa4d407d`（修复代码 `29437625f85fcb8680386c5264670b6b0d498c97`），API HEAD `8ecf6c84ae5e97a95c7b42e56edd6ed658b4fa05`（修复代码 `931b9bb12831c91a52c615ac031cedd56645fbcc`）。基线 B3 / desktop-v1.1 / desktop-v1 不变。既有未提交文档和附件保留。

### 已关闭 R1/R2

- R1：桌面边界将逗号及 Unicode 空白拆分、校验，再按换行持久化；旧 API 与鉴权解析未改变。原独立 overlay 探针六种场景全部通过；新增正式 `TestDesktopKeyIPRulesReachModelAuth` 经真实 HTTP/存储/TokenAuth 验证 IPv4、IPv6、CIDR、五种分隔方式、禁止优先、非法值原子拒绝及清空，亦通过。修复前保存的非规范列表需重新保存字段；本轮不操作生产数据。
- R2：核实与 reveal 错误分离，失败回读保留不确定状态；创建/详情/取消不能清除保护，成功回读展示当前结果供用户明确核对后关闭原操作，不自动重发。原独立失败回读探针已通过，新增 create/edit/status/delete 四项保护回归通过。创建核实按原名称分页读取，编辑/启停/删除按原 ID 核实；源码检查了会话代次和迟到结果拒绝。

### 新增 R3：当日消费窗口固定在首次挂载（P2，待修复）

影响 T13、AC-06/15。tasks T13 明确要求当日消费、同窗口统计及跨午夜/时区验证；这属于 G2 已有要求，不是增加产品范围。

位置：`src/components/account/Overview.tsx:22–39`。`useState` 初始化后不再更新 start_time/end_time，趋势与汇总永久沿用该窗口；`useDesktop` 在窗口重新显示/聚焦时会重新读取，但不会重新计算请求时间。服务端收到显式 start/end 会按它们统计，因此不能依赖服务端默认“今日”修正。

独立复现使用真实 Overview/QueryClient 和 visibilitychange，mock 传输、仅模拟 Date，不改系统时间：

1. 2026-10-14 本地时间 23:50 打开总览，完成首轮查询。
2. 隐藏窗口，将测试时间推进到 10-15 00:10，再显示窗口。
3. 确认组件确实发出新的 `/api/desktop/usage` 请求；其 start_time 仍是 10-14 00:00（1791907200），end_time 仍是 10-14 23:50（1791993000），而应为 10-15 00:00（1791993600）至 00:10（1791994200）。起止时间两项断言均失败。

结果：页面“当日”仍显示昨天的统计，读取时间却可以更新；同一天再次读取也遗漏首次打开之后的新消费。累计余额等其他查询可更新，进一步造成不同时间基准。切换页面重新挂载可暂时恢复，不构成正确的当日刷新行为。

命令：`pnpm exec vitest run tests/account/g2-overview-review.temp.test.tsx`，1 项失败（两个时间断言失败）。探针只验证请求窗口而非真实账单，执行后已删除；源码与服务端显式时间参数处理共同证明影响。

修复验收要求：在有效重新读取时更新当日统计窗口，趋势与汇总使用同一窗口；覆盖同日时间推进、隐藏后跨午夜再显示，以及所声明时区/DST边界。禁止仅更改“读取时间”或加入高频轮询掩盖问题，避免趋势/汇总落在不同时间段。补回归后复验 T13。

### 本轮任务覆盖复核与测试

本轮在前次审查基础上核查增量，并按 PRD/tasks 再查以下范围。表中“未发现新增阻断”是审查结论，不声称穷尽所有缺陷或替代后续环境验收。

| 范围 | 核查点 | 本轮结果 |
|---|---|---|
| T08/T14 | Key 权限/归属/字段保留、IP实际生效、秘密与不确定写入 | R1/R2关闭；相关定向回归通过 |
| T09/T16 | 日志筛选/分页、摘要/统计、调用结果和计费独立 | 结合前次源码审查及本轮回归，未发现新增阻断 |
| T10/T17 | 当前账号定价、模型筛选/快照、1/6/24h、无样本/历史值、配置资格 | 组件/路由接线复核及已有回归通过，未发现新增阻断 |
| T11/T18 | 五字段白名单、false/PATCH回读、固定网页链接 | 组件/控制器复核及回归通过，未发现新增阻断 |
| T13 | 金额元数据/独立来源、当日汇总和趋势、刷新时间范围 | 新增 R3，未达到跨午夜要求 |
| T15及原生传输 | 七工具事务、来源证明、固定受信端点/账户隔离 | 本次代码无增量；沿用前次31项账户/12项工具事务通过证据，本轮另重跑真实业务配对通过；非本轮重新执行全部Rust测试 |

本轮实际执行：

- `pnpm typecheck` 通过；与上次相同的 12 文件前端定向命令：117 项通过；`pnpm build:renderer` 通过（分块体积/浏览器映射数据警告保留，不改依赖）。
- `go test ./controller ./middleware ./router ./model ./cmd/db-migrate -run 'Desktop|OAuthProvider|Pricing|UserSettings|MigrationArgs|TokenAuth|IpLimits' -count=1 -timeout=120s` 五包通过；`go test ./pkg/perf_metrics -count=1 -timeout=120s` 通过。
- 原独立 IP overlay：6 场景通过；原独立 Key 回读失败探针：1 项通过。未把作者测试替代原失败用例复验。
- 真实配对：API `TUZI_DESKTOP_LOOPBACK_PORT_FILE=/tmp/tuzi-g2-rereview-origin go test ./router -run '^TestDesktopLoopbackFixture$' -count=1 -timeout=12m`；实际 `127.0.0.1:61306`；客户端 `TUZI_NATIVE_TEST_ORIGIN=http://127.0.0.1:61306 cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account::tests::real_go_business_pair -- --ignored --exact`：1 passed。Go 收到 stop 后 PASS/exit0，专用系统安全存储条目删除后 NoEntry 断言通过，临时服务/DB/标记清理。
- 新增跨午夜探针：复现 R3；不将117项常规回归通过解释为该场景通过。

结论：**上次两项修复通过，当前仍有一项已确认的 G2 问题 R3；暂不把 G2 标记全部通过，建议先修复 R3 再进入 G3 执行。** G3 环境清单和用例准备可提前整理，但不能据此关闭 T13。G3 仍为 T19真实隔离联调、T20三平台/旧行为、T21数据库/容量/回退；缺失环境事实继续按 Q02/Q04/Q09记录，不等于本轮新增缺陷。未修改业务代码、commit/push/PR/部署或执行 G3。

## R3 修复后独立复验与 G2 门禁结论（2026-10-14）

用户再次请求复验。客户端 HEAD `43ac2941036042453b0753f6df47d0048117448f`，本轮修复代码 `8462c0012a8fd91a6678ba03a7c25e340ab1f89d`；API HEAD 仍为 `8ecf6c84ae5e97a95c7b42e56edd6ed658b4fa05`（服务端代码 `931b9bb12831c91a52c615ac031cedd56645fbcc`）。两端分支均 `codex/tuzi-assistant-dev`，基线仍 TA-AC-1.5-B3 / desktop-v1.1 / desktop-v1。检查增量仅涉及总览、共用查询包装及对应测试/文档，无 API、Rust、依赖或契约变化。

### R3 关闭

源码复核：起止时间与系统 IANA 时区改为在每次实际 queryFn 读取时计算；趋势、汇总使用同一组参数和同一取消信号，Promise.all 全部成功后作为同一逻辑查询更新。useAccountRead 保留原 useDesktop 的账号/连接/代次 query key、隐藏取消、可见恢复、staleTime、禁止前端自动重试、按需轮询等行为；普通渲染不会新增读取，也未增加轮询。

原独立跨午夜探针未改变断言：10-14 23:50 打开、隐藏、推进至 10-15 00:10、显示窗口后，实际 usage 请求现已使用新日零点到当前时刻，**通过**。原独立 R2 失败回读探针也再次通过，排除共用查询包装对该保护的回归。两份临时测试执行后已删除，无业务代码修改。

本轮实际验证（本机 macOS，合成数据/mock 原生传输，仅模拟测试 Date，不改系统时钟）：

| 验证 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| 本文前述12文件前端定向命令 | 121项通过，含账户、Key、总览、App及原供应商兼容 |
| `TZ=America/New_York pnpm exec vitest run tests/account/desktop-business.test.tsx -t 'overview time window'` | 5项通过、21项按过滤跳过；包括夏令时跳时日 |
| 原R3跨午夜与原R2失败回读独立探针 | 2文件、2项通过 |
| `pnpm build:renderer` | 通过；已有分块大小及浏览器映射数据警告保留 |
| 文档/工作区检查 | diff --check通过；原有未提交文档及附件保留 |

核查内容包含同日失效重读、隐藏后跨午夜恢复、DST日、趋势/汇总同窗口、隐藏不读取、普通重渲染不重复请求、取消后的旧日迟到数据不覆盖新日结果。本次测试集中于实际发生变化的 React/查询层；API 与 Rust 无增量，因此沿用前两轮五Go包、性能全包、31项账户Rust、12项工具事务及真实Go HTTP→Rust业务配对证据，**未在本轮重复运行这些命令**。本轮组件测试不是新增完整端到端或安装包联调证据。

### 当前门禁

R1（IP限制）、R2（不确定Key写入）、R3（当日消费窗口）均关闭。结合前两轮对 T08—T11 / T13—T18 的范围复核和本轮增量审查，当前检查范围内未发现剩余 G2 阻断，**G2 本地研发门禁通过，可以进入 G3 验证阶段**。这不是对所有代码绝无缺陷的保证，也不替代完整首版验收。

下一阶段按任务依赖先开展 T19（完整权限与真实隔离联调），随后 T20（三平台安装包、七工具及旧行为兼容）和 T21（三库、实际MySQL版本副本、多实例、容量及回退）。Q02/Q04/Q09 对应的实际 MySQL 版本/主日志库与Redis拓扑、测试环境/账号/设备、容量与退化阈值仍未关闭；可先准备G3清单和具备条件的验证，缺环境的项目明确阻塞，不能虚构通过。T22发布需G3及全部AC通过和另行授权。

本轮仅验收及文档记录，未执行G3、业务修改、本地提交、推送、PR、部署或生产操作。历史失败和作者修复记录保留，最新状态以本节为准。
