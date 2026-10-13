# 源码核验记录

核验日期 2026-10-12；仅静态读取、本地 Git 检查和文档核验。没有运行应用、请求线上、读取 .env/凭证/用户数据、迁移、安装、构建或业务测试。以下“已有”仅指固定版本源码，不证明部署、配置或可用容量。

## 版本与规则

| 仓库 | 读取版本 | 初始工作区 |
|---|---|---|
| C：兔子助手 `/Users/syd08/Documents/tuzi-switch` | `8ce1777d52fd4bce1ade76cf224f0cb2ccc07c98`，tag v1.3.1；已有分支 codex/tuzi-assistant-dev | 无 tracked 修改；21 个已有未跟踪文件（Word、product-plan-v1.5 预览/附件）保留 |
| S：API `/Users/syd08/Documents/tuzi/tuzi-api` | `72af0d4de3487033e800adcc38e42e320a993f75`，本地 origin/dev；已有分支 codex/tuzi-assistant-dev | 初始 clean |

已搜索仓库及路径上级 AGENTS：客户端原无 AGENTS，API 根 AGENTS 已读，未发现仓库内更深层 AGENTS。API 原规则包括 JSON wrapper、三数据库兼容、Bun、项目归属、支付回归等，保留后追加本期规则。API go.mod 实际 Go 1.25.12（旧 AGENTS 概述的 1.22+ 不是精确构建版本）。历史文档仅作证据，不视为部署/操作授权。

下文路径前 C/S 表示上表对应仓库，**所有路径和符号均绑定上述 SHA**。可用 `git show <SHA>:<路径>` 重现；行号仅作辅助，符号是主要定位依据。

类别：R=已有可复用，A=已有需适配，N=本期新增，U=源码不能确认。一个功能可同时包含多类。

## 客户端

| ID / 要求 | 已有实现与证据（C） | 分类与实施缺口 / 风险 | 任务 / AC |
|---|---|---|---|
| C01 导航与工具 | `src/App.tsx:118` View、本地 view/app 选择；`src/components/AppSwitcher.tsx`；七工具 VALID_APPS | R 复用工具页；A 新侧栏接入；N 账户页面，不引入新的全局路由重构 | T12 / AC-01 |
| C02 原生与调用层 | `package.json` React18/TS/Vite7/React Query5；`src-tauri/Cargo.toml` Tauri2/Rust1.85/reqwest/tokio；`src/lib/api/` invoke；`src-tauri/src/lib.rs` 注册命令 | R IPC/HTTP 基础；N 账户专用模块/错误 DTO，禁止通用任意 URL+Bearer IPC | T04～T06 / AC-02、16 |
| C03 外部浏览器 | `src-tauri/src/commands/misc.rs:24` open_external 使用 opener；同文件 open_webview_with_key 注入 Key 并自动点击 | R 系统浏览器唤起；A 增加受信入口；账户登录和 Coding/GACCode 新入口不能复用注入 WebView | T05、T18 / AC-02、14 |
| C04 回调 | `src-tauri/tauri.conf.json:57` tuziswitch；`src-tauri/src/lib.rs:164` handle_deeplink_url、single_instance、on_open_url、RunEvent::Opened；`src-tauri/src/deeplink/parser.rs:13` 只认 v1/import | R 协议注册/单实例；N auth/callback 分流、pending/state/PKCE、冷启动状态恢复、重复事件去重；RunEvent 有独立解析分支要统一适配，不能只改一条回调路径 | T05 / AC-02、17 |
| C05 认证与安全存储 | `src/lib/api/auth.ts` / `src-tauri/src/commands/auth.rs` 仅 github_copilot/codex_oauth；`src-tauri/src/proxy/providers/codex_oauth_auth.rs:244` JSON 文件、get_refresh_lock/save_to_disk；`src-tauri/src/services/subscription.rs` 读取工具 Keychain | A 可参考锁与错误模式；N 独立兔子账户安全存储与生命周期。工具 Keychain 读取不等于可复用跨平台账户存储；现有 JSON 原子写/0600 不满足本期禁止明文要求 | T04、T06 / AC-03、16 |
| C06 配置/供应商 | `src/components/providers/AddProviderDialog.tsx:30` 无账户预填参数；`forms/ProviderForm.tsx:430` initialData、isEditMode；`forms/ClaudeDesktopProviderForm.tsx` 单独实现；`src-tauri/src/services/provider/mod.rs:1619` add | R 现有表单/保存；A 增独立 createPrefill，不能拿 initialData 冒充新建。首个供应商可能自动启用，additive 工具有 add_to_live，Codex 非当前也可能注册配置；展示真实结果 | T15 / AC-08、09 |
| C07 备份恢复 | `src-tauri/src/config.rs:196` atomic_write；`services/provider/live.rs:1053` LiveSnapshot 仅部分工具；`database/backup.rs` DB 快照/SQL导入导出；`services/webdav_sync.rs` | R 工具级原子写/备份基础；A 七工具受影响文件矩阵和补偿恢复；DB 备份不等于外部工具文件备份。N OAuth 从所有导出/同步排除；新增本机关联不随 WebDAV 误传播 | T04、T15、T20 / AC-09、16 |
| C08 预设差异 | `src/config/*ProviderPresets.ts`、`src-tauri/src/database/dao/providers_seed.rs`；Claude apius 域名，Codex 主站 /v1、独立 /coding、GACCode；`claudeDesktopProviderPresets.ts` 列表为空 | R 现有预设与服务写入；A 按实际工具建立支持矩阵，不能从七工具存在推断七工具都有兔子预设。前端 Codex TUZI01 与后端 TUZI 索引/模型默认有差异，保留现行分配规则，不硬编码历史文档 envKey | T01、T15 / AC-08 |
| C09 查询入口偏差 | `src/components/providers/ProviderCard.tsx:430` Coding 指向 api.tu-zi.com/reseller 且可注入 Key；GACCode 指向 /credits | A 按 v1.5 改成 coding.tu-zi.com/reseller 与 gaccode.com/subscriptions，无自动提交。不能把现状写成已满足方案；其他既有主站查询/第三方脚本保持 | T18 / AC-14 |
| C10 请求/缓存/错误 | `src/lib/query/queryClient.ts` retry1/focus刷新/stale0；`queries.ts` 按 app 缓存，部分错误捕获后返回空集合；`src/utils/errorUtils.ts` 提取原文 | R React Query、UI组件；N 账户键、代际、取消、迟到结果抑制、结构化脱敏错误；不能沿用“失败返回空集合”的账户语义，不能全局改变工具 query 默认值 | T06、T13～T18 / AC-15 |
| C11 验证 | `vitest.config.ts`、`tests/msw/`、`tests/integration/App.test.tsx`、ProviderForm/AddProviderDialog 等；`src-tauri/tests/` provider/deeplink/import-export，Rust 模块测试 | R Vitest/RTL/MSW/Rust；N 真实默认浏览器+协议+OS安全存储三平台矩阵。MSW 不是后端联调 | T19、T20 / AC-17 |

## API 站

| ID / 要求 | 已有实现与证据（S） | 分类与实施缺口 / 风险 | 任务 / AC |
|---|---|---|---|
| S01 OAuth 注册 | `model/oauth_provider_config.go:13` 单例 id=1，SaveOAuthProviderConfig；`controller/oauth_provider.go` load/ready/authenticateClient/knownScope | R 哈希配置管理；N 多客户端或独立桌面注册与 public 类型。现有 ready/auth 强制 secret，knownScope 仅四项且配置数量上限4；修改旧配置可能撤销全部旧授权 | T01、T02 / AC-02、05、17 |
| S02 回调/授权 | `controller/oauth_provider.go:721` HTTPS或loopback HTTP；validateOAuthProviderAuthorizationRequest 精确登记、S256/state；Authorize 受保护POST+Origin/Referer；`router/api-router.go:126` UserAuth | R 核心校验；A 仅登记桌面客户端精确放行 tuziswitch://auth/callback，不全局允许自定义scheme。保留网站来源/会话保护；源码未证明有独立 CSRF nonce，T03验证防跨站策略 | T02、T03 / AC-02 |
| S03 授权页 | `web/src/pages/OAuthAuthorize/index.jsx` return_to 登录返回、同意/取消、服务端名称；标题/警示面向聚合中心 | R 登录/2FA站内链路；A 桌面可信文案、切账号、手动再次打开和失败恢复，不以打开页面自动批准 | T03 / AC-02、14 |
| S04 换码/刷新 | `controller/oauth_provider.go:24` code 5分钟；:559/605/642 form换码、refresh、Token响应；`model/oauth_provider.go` 事务条件更新，哈希、family、轮换旧AT失效、RT重放撤销family | R 核心事务；A 公共客户端、账号检查、绝对寿命/闲置策略、并发与响应丢失；N 连接记录。目前每次刷新重新算 TTL，未有family绝对截止字段 | T02、T06、T07 / AC-03 |
| S05 撤销/安全事件 | `model/oauth_provider.go:303` RT撤销family、AT仅撤销自身；`middleware/auth.go:418` 用户状态检查；`model/user.go:1767` UpdateProfile、:2046 ResetUserPasswordByEmail | A 状态鉴权能拒绝禁用，但没有证明所有改密/删号路径撤销桌面family；检索未发现相应 OAuth 挂钩/本人设备列表。N 持久连接撤销及网页管理，避免重新启用复活；普通退出应以连接/family语义 | T07 / AC-04 |
| S06 旧认证兼容 | `controller/user.go:441` GenerateAccessToken、`model/user.go` AccessToken；`middleware/auth.go` authHelper/UserAuth、UserAuthOrOAuthScope | R 原 session/旧系统令牌路径；桌面禁止 /api/user/token（GET也会写入新令牌）。OAuth prefix 分流不回落旧认证；原站/旧聚合接口保持 | T02、T07、T20 / AC-17 |
| S07 身份/余额/资料 | `router/api-router.go:134` userinfo/account 均 token:read；`controller/oauth_provider.go:233` userinfo 无邮箱、account仅quota；`controller/user.go:574` GetSelf含管理权限/绑定/完整setting | R 本人身份/余额；A 桌面最小账户 DTO；N 安全资料白名单接口。不能简单把整个 /user 自助组改 OAuth；其含密码、token、支付、绑定、删号 | T08、T11 / AC-05、06、13 |
| S08 Key | `router/api-router.go:864` 单条CRUD+group+search逐scope，批量仍UserAuth；`controller/token.go:95/245/529/697` 掩码、reveal POST、create返回id/key；`model/token.go` GetTokenByIds；`controller/token_group.go` 账号分组 | R 单条能力；A 多客户端适配后逐项归属/字段测试，完整Key只短暂使用。UpdateToken非PATCH，多个未提交字段会被零值覆盖；必须读改写或桌面白名单适配保留其余字段 | T08、T14 / AC-07 |
| S09 日志 | `router/api-router.go:935` self/stat/advanced_stat/request 仍UserAuth；`controller/log.go:149/198/542/589`；`model/log.go:355/1817` 本人过滤、删除admin_info且id重编号 | R 本人查询/统计/脱敏基础；A 显式OAuth scope/有界范围/摘要DTO，不能用列表id请求详情；self/stat使用username而非可信user_id需要适配；管理员图片权限参数需要压缩 | T09 / AC-05、10 |
| S10 用量统计 | `controller/usedata.go:47` data/self限制30天；`model/usedata.go` 小时聚合、DataExportEnabled/Interval；`controller/consumption_stats.go:16` 按role可指定他人；`model/consumption_stats.go` chart/table、半开时间窗 | R 聚合数据；A desktop强制user_id、禁止channel和其他source越界。图表非即时全请求，可能受异步统计/开关影响；不能只加 scope 中间件保留管理员分支 | T09、T13 / AC-06 |
| S11 定价 | `router/api-router.go:101` TryUserAuth；`middleware/auth.go:388` 只读session；`controller/pricing.go:1531/1551/1974` role管理视图、用户分组/折扣、snapshot、账户缓存指纹 | R 账户可见价格引擎；A OAuth身份/普通业务视图、客户端隔离缓存。匿名200不证明取到账户价；不得把管理员role直接透传成管理价；保留动态/表达式等计费展示 | T10、T17 / AC-12 |
| S12 模型状态 | `router/api-router.go:104` TryUserAuth；`controller/perf_metrics.go:28/74/160` 可见模型分组、最多24h、批量最多1000、管理角色额外request_count；`pkg/perf_metrics/types.go` has_samples/TTFT级别、历史值 | R 普通公开视图；A OAuth本人可见组，desktop禁止额外计数；status不是个人调用成功率。无样本数值0须按has_samples转空，不展示100% | T10 / AC-11 |
| S13 资料写 | `controller/user.go:1063` UpdateSelf混合语言/边栏与账号密码；:1775 UpdateUserSetting含通知secret等；`web/src/components/settings/personalSettingsModel.js`、`personal/cards/NotificationSettings.jsx:615` 价格两个开关 | R PatchUserSettings/UpdateProfile相关逻辑；N 专用五字段白名单（用户已确认），返回设置也只选这些，不能把通知凭证读给desktop | T11 / AC-13 |
| S14 数据/迁移 | `model/oauth_provider.go` codes/tokens 哈希唯一索引、client/user/family/expiry普通索引；`model/main.go:837` MigrateOAuthProviderDB仅建缺表；:857/:3521 without-full仍有增量路径；`cmd/db-migrate/main.go` sidecar/full/oauth选项 | A 增量独立小表/索引、已有表补列及三库幂等验证；不能假设既有 -oauth-provider 会升级已有表。历史“零启动DDL”文档与当前代码有差异；实际发布流程U | T01、T02、T21 / AC-18 |
| S15 限流/清理 | `router/api-router.go:127/130` 授权CT、token/revoke PB；`middleware/rate-limit.go:224/314/327` CT/PB/KA及Redis/本地实现；`model/oauth_provider.go:118` 签code同步Delete | A 桌面独立namespace，不挤占现有桶；N 有界后台token清理与重放保留。已用授权码立即符合删除条件；过期未用保留约1h；清理错误被忽略。未检索到tokens定期清理；配置测试会话清理不是token清理 | T07 / AC-15、18 |
| S16 测试 | `model/oauth_provider_test.go`、`controller/oauth_provider_test.go`、`middleware/auth_test.go`；pricing/perf/consumption测试；`web/package.json` Bun/部分node tests | R 现有OAuth/归属/计价测试；现有OAuth核心测试SQLite内存且连接数1，不能证明MySQL并发、多节点或真实授权。历史聚合中心联调记录也不是桌面验收 | T19～T21 / AC-17、18 |

## 未被本地源码证明的事实

用户明确部署分支 **dev**、数据库 **MySQL**。尚无实际运行 SHA/镜像摘要、MySQL 版本、主库/日志库位置与容量、表/索引现状、schema迁移编排、Redis共享情况/实例数、代理来源头信任设置、各站点功能开关、授权客户端配置、线上账号资格/价格、预期并发量、性能门槛或三平台支持结果。详见 Q02/Q04/Q05/Q09。

历史 `docs/2026-08-09-多节点Schema迁移与Redis部署复盘.md` 提到六实例/RDS/分散Redis，是历史描述，不能认定今日仍如此。`docs/2026-08-10-统一支付修改防回归检查清单.md` 的兼容门禁必须保留，但本文没有访问订单或发起支付。

## 复用结论

直接复用：七工具页面、供应商业务服务、IPC/React Query基础、网站登录/二次验证、OAuth哈希/一次性消费核心、Key单条CRUD和本人日志/价格计算基础。

需要适配：多客户端鉴权、回调分流、授权页、受限账户/日志/统计/价格权限、资料白名单、创建预填、逐工具备份和查询网页入口。

需要新增：桌面安全存储、账户请求/缓存隔离、连接记录与安全事件撤销、后台有界清理、桌面独立限流和功能开关、账户页面与全量联调验收矩阵。
