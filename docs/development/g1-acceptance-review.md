# G1 独立验收复查（2026-10-13）

结论：**本次验收暂不通过，先修复以下两项，再复验是否进入G2。** 现有G1代码和阶段提交保留；这不是推翻架构，也不是宣称发现了生产事故。历史通过记录仅覆盖当时已执行的用例，本次新增边界用例揭示其覆盖缺口。

## 范围与固定版本

- 客户端HEAD：`74aa8ed5de159e7ea2c7150e47e449fc660387eb`；API HEAD：`7c131f18eaf4dff64dd6b501e324b989e4331552`；两端分支均 `codex/tuzi-assistant-dev`。
- 依据：B3 / desktop-v1.1 / scope desktop-v1、PRD、T02～T07/T12、ADR-003/004和g1-verification。检查两端关键实现与变更、重跑定向测试、补充隔离HTTP回归探针；本轮由当前执行者复查，没有新启动子智能体。
- 本轮仅审查/隔离测试/文档记录，不修改业务代码，不创建分支、提交、推送或部署。已有Word和预览未跟踪文件保持。

## R1：共享授权入口改变旧接入方认证行为（P1，T02/T03兼容）

定位：API `router/api-router.go:128`、`:129`；`middleware/desktop_auth.go:16`。

两个共享授权路由将原有 `UserAuth()` 全部替换为 `PureWebsiteSession()`，旧confidential client也先经过纯会话限制。此前已允许的“旧client + 有效系统访问令牌 + 用户ID头”请求现在在进入控制器前返回401。这与契约“旧网站、系统token、旧OAuth已有允许路径保持原行为”不符；桌面要求纯网站会话不应扩大为旧客户端协议变更。

隔离复现：临时SQLite中创建合成用户、合成系统访问令牌及旧 `aggregation-client` 登记，用同一合法授权query调用真实 `OAuthProviderAuthorizeContext`。分别组装原 `UserAuth()` 和现 `PureWebsiteSession()` 路由链，前者200，后者401。只证明该合法旧请求的兼容回归，不声称线上一定正在使用此调用方式。

修复要求：在可信、有界、一致解析client身份后区分桌面和旧客户端；桌面context/approve仍必须纯网站会话、签名账户上下文及Origin校验，旧client保留原鉴权行为。不能简单全局恢复UserAuth而放开桌面授权。补GET context和POST approve的旧系统令牌、旧网站会话、桌面纯会话/拒绝系统令牌，以及歧义参数/请求格式的路由级回归。

## R2：限流预解析绕过token请求体上限（P2，T02安全边界）

定位：API `middleware/desktop_rate_limit.go:97`、`:98`，以及 `controller/oauth_provider.go:193`。

新增限流中间件在控制器安装64 KiB的 `http.MaxBytesReader` 之前调用 `c.PostForm`。Gin已解析并缓存PostForm，控制器随后再次调用ParseForm不会重新读取受限Body，因此原大小限制不再有效。该预解析也作用于共享token入口的旧client。默认解析器仍有自己的上限，不能据此声称无限大小；确认的缺陷是64 KiB边界失效及更大的请求进入认证处理。

隔离复现：临时SQLite中登记桌面测试client，批准合成用户并创建合法code/verifier；构造71,914字节的form，额外长度位于当前白名单允许但本次换码不使用的refresh_token字段。直接调用原token控制器时400 invalid_request；加当前 `DesktopOAuthRateLimit("token")` 后返回200并签发测试凭证。输出只记录长度/状态，不记录返回凭证。

修复要求：在任何PostForm/ParseForm/ParseMultipartForm读取之前施加统一有界读取，解析错误立即拒绝；限流与控制器共用有效解析结果，不能忽略已缓存的解析错误。补64 KiB边界内/外、未知Content-Length/流式请求、桌面与旧client、合法换码和刷新等路由级回归，验证超限拒绝且不消费code/RT、不创建新凭证。

## 本轮执行结果

| 检查 | 命令/范围 | 实际结果 |
|---|---|---|
| 客户端类型 | `pnpm typecheck` | 退出0 |
| 客户端UI/query/App | `pnpm exec vitest run tests/account/account-query.test.tsx tests/components/AccountPage.test.tsx tests/components/AppSwitcher.accountCompatibility.test.tsx tests/integration/App.test.tsx` | 4文件24项通过；既有浏览器映射数据陈旧提示 |
| Rust账户 | `cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account -- --test-threads=1` | 23通过、2默认忽略；本轮未重跑真实系统存储/Go配对 |
| 服务端 | `env -u TUZI_DESKTOP_LOOPBACK_PORT_FILE go test ./model ./controller ./middleware ./router ./cmd/db-migrate -run 'Desktop\|OAuthProvider\|MigrationArgs' -count=1 -timeout=90s` | 五包退出0；隔离SQLite/HTTP |
| 网站授权页 | web目录 `bun test src/helpers/desktopAuthorization.test.js src/pages/OAuthAuthorize/index.test.jsx` | 8通过、28断言 |
| 新增验收探针 | Go overlay注入临时测试文件，`go test -overlay=<overlay.json> ./router -run '^TestG1Acceptance' -count=1 -timeout=60s -v` | 退出1；两项当前行为断言失败，各自对照组通过 |

探针名：`TestG1AcceptanceLegacyAuthorizationCompatibility`、`TestG1AcceptanceTokenRequestBodyLimit`。临时源码与overlay在 `/var/folders/y5/pxpgfd896pn3xyjqw2x9g9w00000gn/T/tuzi-g1-acceptance-rl_qjrpc/`，未写入API源码树。该临时目录不是永久证据依赖；上述输入、链路差异和结果用于后续建立正式回归测试。

## 后续门禁

先以独立G1修复任务处理R1/R2、补正式回归、非作者审查、阶段提交并同步配对/验证记录，再决定进入G2。两项属于现有兼容与安全要求内的修复，不需要新增产品决定。

MySQL/PostgreSQL实库、共享Redis、多实例、Windows/Linux、安装包冷暖回跳及完整浏览器登录/2FA仍是既有未验证事项。本轮未执行这些验证，不将其混同本次已复现缺陷；修复两项后也不自动等于可上线。

## 修复后正式复验（2026-10-13）

结论：**R1/R2 修复、正式回归和非作者审查通过；本地可以形成修复后的 G1 检查点，并具备在新任务授权下进入 G2 本地开发的条件。本轮不开展 G2、不宣称上线。**

### 修复与配对提交

| 项目 | 独立任务提交 | API 集成提交 | 状态 |
|---|---|---|---|
| R1 旧 OAuth 授权兼容 | `8ffbf5d027f7ed824f5a7da3f65c3b9619b54c82` | `20f797d33a93642fedb666110d47837b9706fec0` | 已集成 |
| R2 token 请求体上限 | `0a319f14fa687b741a3f663d46208218b33f8fd8` | `1ff07d190` | 已集成 |

API 集成分支为 `codex/tuzi-assistant-dev`，当前集成 HEAD 为 `20f797d33`；集成提交分别保留 R2、R1 的独立提交关系。客户端业务代码未改，客户端 `74aa8ed5de159e7ea2c7150e47e449fc660387eb` 继续作为配对客户端检查点。两仓库均未 push、PR、远程合并、部署或生产迁移。

### 正式回归与审查

- R1 路由回归：`go test ./router -run 'TestOAuthProviderAuthorizeRoutesPreserveLegacyAndDesktopAuth|TestDesktopAuthorizationHTTPAccountBindingAndMediaTypes' -count=1` 通过；覆盖旧系统令牌/网站会话、桌面系统令牌拒绝、桌面纯会话、Origin、签名账户绑定、切号、重复/异常 `client_id`。
- R2 回归：`go test ./middleware ./router -run 'TestDesktopOAuthRateLimitBoundsStreamingAndLegacyFormReuse|TestDesktopOAuthTokenBodyLimitDoesNotConsumeGrant' -count=1` 通过；覆盖 64 KiB 边界、未知 `Content-Length` 流式请求、桌面/旧 client、换码/刷新、超限不消费 code/RT 和不签发凭证。
- 集成相关包：`go test ./model ./controller ./middleware ./router ./cmd/db-migrate -run 'Desktop|OAuthProvider|MigrationArgs' -count=1 -timeout=120s` 通过；随后 `go test ./middleware ./controller ./router -count=1` 通过。
- `git diff --check` 通过；非作者在独立只读 worktree 审查集成 HEAD `20f797d33`，结论为无安全、兼容或解析边界阻断。

### 未验证限制

本次使用隔离 SQLite、合成用户/令牌和本地 HTTP 服务，没有连接生产。仍未验证 `go test -race`、真实 MySQL/PostgreSQL、共享 Redis 多实例、Windows/Linux、安装包冷暖回跳、真实默认浏览器完整登录/2FA 和跨平台联调。R2 新测试没有单独增加“未知 Content-Length 且恰好 64 KiB 成功边界”及 revoke 超限状态断言；代码审查未发现绕过，该项作为后续测试增强记录，不构成当前阻断。

## 用户请求后的独立复验（2026-10-14）

结论：**R1/R2 独立复验通过；当前 G1 本地研发门禁通过，可以在新任务授权后开始 G2。** 本结论不等于 T19～T22、三平台、实库或正式发布验收完成。

- 固定版本：客户端 HEAD `8e8ff2a974ebfd4565b7936dc02d5f3f06b8d897`，API HEAD `1cc7027863a2229fb5ffbc7f866c9cbc70a2e112`，均为 `codex/tuzi-assistant-dev`。相对上次独立验收客户端仅有文档变更，业务代码检查点仍为 `74aa8ed5de159e7ea2c7150e47e449fc660387eb`；API 运行代码已含 R2 `1ff07d190` 和 R1 `20f797d33`。
- 检查 API 修复差异、路由与解析/鉴权/限流链：桌面精确识别且保持纯网站会话；旧客户端保持 UserAuth；表单首次解析前限制 64 KiB，错误立即拒绝，控制器复用解析结果。桌面 form 控制器拒绝任何非空 query，未把 query 分流差异认定为可成功换码/刷新绕过。
- `env -u TUZI_DESKTOP_LOOPBACK_PORT_FILE go test ./model ./controller ./middleware ./router ./cmd/db-migrate -run 'Desktop|OAuthProvider|MigrationArgs' -count=1 -timeout=120s`：五包通过。
- `env -u TUZI_DESKTOP_LOOPBACK_PORT_FILE go test ./middleware ./controller ./router -count=1 -timeout=120s`：三个相关包通过。
- API web 目录 `bun test src/helpers/desktopAuthorization.test.js src/pages/OAuthAuthorize/index.test.jsx`：8 项通过、28 断言。
- 重用上次独立探针输入，但在新的临时 overlay 中把 R1 当前链改为实际 `OAuthProviderAuthorizeSession()`，避免继续测试已废弃的全局纯会话链。`go test -overlay=<临时overlay.json> ./router -run '^TestG1Acceptance' -count=1 -timeout=60s -v`：两项通过。71,914 字节 form 在控制器单独/中间件加控制器两条链均为 400 invalid_request；合法旧客户端系统令牌请求在原链/新分流链均为 200。只记录状态，不记录签发凭证。
- 两仓库 `git diff --check` 通过。客户端无业务增量，本轮未重复原生/UI 全量测试或真实 Keychain/Go 配对；其既有证据及限制继续保留。本轮无新增子智能体、业务修改、分支、commit、push、部署或生产访问；Word/预览未跟踪文件保留。

下一阶段为任务计划 G2：服务端 T08～T11，客户端 T13～T18。用户将相应提示词提交为新任务/目标才构成 G2 编码授权。
