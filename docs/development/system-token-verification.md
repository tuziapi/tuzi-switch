# B4 本地迁移验证与交付记录

2026-10-18，macOS；有效基线 `TA-AC-1.5-B4`，契约 `system-token-v1`。本记录描述隔离合成环境，不是用户验收或发布证明。

最新同步记录：2026-10-18 `B08-local-mainline-sync` 的精确配对、检查结果及3项既有失败见 [主分支同步验证](mainline-sync-verification.md)。本文下方原迁移/修复/真实UI记录保留其原时点，不表示这些流程在同步后重跑。

## 版本与状态

| 层级 | 实际结果 |
|---|---|
| 客户端代码 | `05419d66f48066fee78a9adf95590484cb78c639`，`codex/tuzi-assistant-system-token`，worktree `/Users/syd08/Documents/tuzi-switch-system-token` |
| API/网站代码 | `382e22e4c6a66adf9397b1ccc93c8852011045b1`，同名分支，worktree `/Users/syd08/Documents/tuzi/tuzi-api-system-token` |
| 代码与定向测试 | 本地完成；文档交付提交在上述代码提交之后，不改变被测业务代码 |
| 真实本地联调 | Go→SQLite、Rust→Go、macOS Keychain、网站登录引导及最终 B debug app 的连接/恢复/切号/断开通过 |
| 用户验收 | 未完成；用户仅协助允许系统钥匙串访问，不等于接受全部产品 |
| 发布 | 未 push、PR、远程合并、部署、生产迁移或上线 |

API最终文档交付HEAD `3bdd71cae479aa20b078f54eb051b2c62e0c0136`（其业务代码仍为上表版本）。客户端最终文档交付HEAD由本报告提交的Git记录定位，避免自引用SHA。

原客户端仍为 `c3902fe7c4fc847e769b23d7712092a30aa67c57`，既有未跟踪 Word 和 product-plan 附件保留；原 API 检出仍为 `dded57caedc376c4399f778ebb2147748bc24743`，干净。未在原工作区编码或清理。

## 执行的验证

客户端最终集成目录执行：

```sh
pnpm typecheck
pnpm test:unit --run tests/hooks/useAutoCompact.test.tsx tests/components/AccountPage.test.tsx tests/account tests/components/AppSwitcher.accountCompatibility.test.tsx tests/integration/App.test.tsx tests/components/ProviderList.test.tsx tests/components/ProviderActions.test.tsx
bash scripts/build-local-preview.sh
```

类型检查通过；9 文件 66 项前端测试通过；本地 debug app 构建通过。组件测试包含 Mock，不单独作为真实连接证明。临时结果日志 `/tmp/tuzi-system-token-frontend-tests.log`、`/tmp/tuzi-system-token-desktop-build.log` 不包含凭证。

```sh
TUZI_SYSTEM_TOKEN_PAIR_CREDENTIALS='/Users/syd08/Library/Application Support/com.tuziswitch.desktop.preview/system-token-api/credentials.json' CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account::tests -- --include-ignored --test-threads=4
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib services::tuzi_provider::tests -- --test-threads=1
```

最终集成目录再次运行：账户原生 24/24 通过（含显式启用的真实 Go 配对和独立 macOS 安全存储）；七工具事务 12/12 通过。测试仅从权限0600私有文件读取合成凭证，不输出值。真实配对覆盖普通/管理员本人范围、身份 Header、完整 Key CRUD/reveal、原子部分更新保留高级字段、mixed IPv4/IPv6/CIDR 规范化、profile/groups/log summary/明细/usage/models/perf 单项及批量、未知参数与 secret DTO 排除、切号/无效粘贴/迟到响应隔离。独立测试 Key 删除、资料恢复、测试账户内存断开，独立安全存储项删除并验证 NoEntry；未触发真实上游。七工具事务使用临时文件和合成模型 Key，验证备份、全部适配器、失败补偿、冲突、来源约束与独立 Codex 凭证，不证明实际工具付费调用。

API 最终集成目录执行：

```sh
go test ./middleware ./controller ./model ./router ./pkg/perf_metrics -count=1
```

最终五包全部通过（controller42.750s、model37.112s、router17.919s）。包含引导 Header/无效/轮换/禁用、旧认证兼容、原子 Key/profile PATCH 与并发高级字段保护、>150模型全量汇总/退款/半开时间边界/日志不可用、性能样本可用性与令牌 SQL 日志脱敏。额外真实普通/管理员 HTTP→Go→SQLite 全业务配对通过。

网站最终集成 `web/` 目录执行：

```sh
bun test ./src/components/settings/personal/cards/SystemTokenCard.test.jsx ./src/helpers/auth.return-target.test.jsx ./src/helpers/loginReturnTarget.test.js ./src/helpers/auth.test.jsx ./src/components/settings/PersonalSetting.alert-migration.test.jsx
bun test ./src/helpers/loginReturnTarget.test.js ./src/helpers/utils.test.js
bun run build
```

网站引导 5 文件 37 测试及 helpers/utils 2 文件 103 测试通过，`bun run build` 通过。覆盖可信返回地址、普通登录和个人设置不受影响、当前令牌只读/复制、无令牌生成、明确轮换确认、剪贴板/读取失败和401恢复；测试中的浏览器原语/API为Mock，下面单独列真实浏览器证据。

## 真实网站与桌面 UI

网站 `http://127.0.0.1:5180` → Go3180，独立合成 SQLite。已登录直达个人设置的安全卡片，自动定位及高亮；复制成功显示“返回兔子助手，粘贴令牌并连接。”读取前后数据库值与 current 返回值一致，未轮换。浏览器虚拟剪贴板未能证明字节值，因此不宣称该工具读取到的剪贴板等于令牌。主动轮换确认框已查看并取消，不在 UI 中轮换。无令牌生成/剪贴板故障主要由定向组件及服务端测试覆盖。

真实过期流程：同源 `/api/user/logout` 仅清除浏览器会话并保留前端缓存；访问固定助手引导页产生实际401，跳转 `/login?expired=true&return_to=%2Fconsole%2Fpersonal%3Fsource%3Dtuzi-assistant%23system-token`；合成用户登录后回到正确个人页、安全 tab，焦点在 system-token 卡片。URL不含凭证。

最终 B app：`/Users/syd08/Documents/tuzi-switch-system-token/src-tauri/target/debug/bundle/macos/兔子助手.app`。第一次读取同命名空间旧记录遇到 macOS Keychain 系统授权，自动化禁止操作 SecurityAgent；由用户明确回复“已允许本地预览访问”后继续，未绕过系统保护、改变命名空间或删除旧数据。

- 合成普通账户粘贴连接成功，输入框消失，余额 CNY730.00、今日消费 CNY14.60、21次、输入/输出16010/4005；Key 列表显示合成掩码 Key。
- 正常退出再启动，安全存储恢复并服务器确认连接，数据一致。
- 本地断开立即清空账户数据；退出重启保持未连接，不恢复旧状态。
- 无效合成令牌显示“系统令牌无效或已重新生成”，保留安全输入供重贴；有效管理员令牌可重连。
- 管理员仅显示本人消费0、调用0、Tokens0/0及本人空 Key 列表，不混入普通账户21次；断开后再次连接普通账户恢复本人数据。
- 仍只公开 Key 页和顶部概要；隐藏完整概览/日志/模型/性能/资料/配置到工具由真实 Rust→Go 路由配对及前端/事务测试验证，没有将其开放给普通用户；未声称逐个隐藏页面都完成实际点击。

脱敏证据：[网站引导](system-token-evidence/website-guide.png)、[桌面普通账户](system-token-evidence/desktop-connected.png)、[桌面管理员本人范围](system-token-evidence/desktop-admin-self.png)。均只显示合成数据和掩码，不包含账户系统令牌或完整模型 Key。

## A 退出和实际数据库

账户 OAuth 发起/回调/兑换/续期及 `/api/desktop` 调用退出。旧账户回调被识别并丢弃，import 与工具 OAuth 基础设施保留。v1 旧记录不作为 B 凭证复用，提示重连；B version2 和空 tombstone 阻止恢复旧状态，切号通过 generation/取消信号隔离。连接先持久化空记录再验证，安全存储失败不降级明文。

旧 API 预览库只读核查：222表，desktop_schema_installations1行(installed/version1)、oauth_desktop_clients1、connections10、authorization_codes10、tokens40；均保留。旧客户端业务库 user_version11、17表、providers16行、settings1行和历史备份保留；只查名称/计数，不读取值或凭证。B 使用独立 system-token-api 库，无 desktop schema 或 OAuth 专用表/钩子/清理任务。完整事实见 API 实施说明；不推断生产库或旧凭证有效性。

B 系统令牌具有原站实际角色权限，不是受 scope 限制的 OAuth 凭证或模型 Key；静态 Header、隐藏功能、客户端白名单不缩小泄露后的服务端权限。无 OAuth 自动续期；主动网站轮换使旧值失效并影响共享接入，禁用账户使请求失败；临时网络错误保留安全存储并显示离线。设备本地断开不轮换或撤销网站令牌。

## 预览与用户验收

当前 Go3180/Vite5180 和最终 B app 保留运行，普通合成账户已连接。若重启，在 API worktree 执行 `bash scripts/system-token-local-preview.sh`；已有端口会拒绝启动，不接管原服务。客户端 worktree 执行 `bash scripts/build-local-preview.sh` 后打开上述 app。脚本不读取生产 .env；合成登录信息仅在预览目录私有 credentials.json；不要复制到报告、日志或截图。

验收步骤：从助手连接区前往获取令牌→网站已有登录直达/退出后登录返回→查看并复制已有系统令牌→回助手粘贴→检查本人 Key 与概要→退出重启→断开后重启→重新连接。检查各七工具原入口仍在，隐藏页面不出现在默认导航；不进行实际支付或付费模型调用。首次系统钥匙串访问由用户处理。

## 未验证与后续顺序

未验证真实 MySQL/PostgreSQL、生产拓扑/容量、Windows/Linux安全存储、三平台发行安装包、完整旧站第三方OAuth/支付端到端及逐项用户验收。不使用SQLite、组件Mock、截图或编译替代这些门禁。

上线未执行：另获授权后先完成数据库/平台/旧站/容量和用户验收；先兼容 API及网站、后B客户端，保持Phase1。旧API缺bootstrap/PATCH/summary时B明确失败，不降级A或GET+PUT覆盖。回退先客户端/引导后API兼容扩展，用可审查revert，保留数据库、备份和A表；v2记录不能交给A使用，回退须显式重连并复核A表/钩子，不自动恢复旧会话。发现凭证泄露由用户在网站主动轮换，设备断开不等于远端撤销。

## 2026-10-18 P2/P3 定向复查修复

P2：原生资料投影对 `record_ip_log` 缺省、`null` 返回 `true`，保留显式 `true`/`false`；其余两布尔默认不变。新增合成 loopback HTTP→AccountService 测试逐一覆盖四情况。旧代码在 missing 情况断言失败；修复后通过。既有资料组件回归继续验证 true→false 仅提交 `{record_ip_log:false}`。资料页面保持隐藏。

P3：网站改为 Semi `Input readonly`，测试直接加载已安装 Semi Input，验证遮罩/展开/剪贴板失败三种状态均只读、展开后聚焦全选。网络、按钮与弹窗仍为替身。旧 `readOnly` 使两项测试失败，修复后通过，不冒称浏览器端到端验收。

本次命令与结果：

- `CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account::tests -- --test-threads=4`：23 通过、2 默认忽略（真实 Go 配对/OS 安全存储本次未复跑）。
- `pnpm test:unit --run tests/account/desktop-business.test.tsx`：27 通过，包含显式 false 资料部分提交。
- 网站五文件 Bun 命令同上文：37 通过；真实 Input 只读和选择范围断言纳入原有 7 项卡片测试。
- 两份 Rust 文件 `rustfmt --edition 2021 --check`、两份网站 JSX `bunx prettier --check`、两仓 `git diff --check`：通过。

配对网站修复 `9f0bdbb1388334cd176c97460adb7e68bbcaaec1`；客户端 P2 由本节同一 Git 提交定位，两仓分支及契约不变。以上是本次代码/定向测试证据；先前联调记录保留其时点含义。本次未重建正在运行的桌面预览、未新增浏览器人工验收，未 push/PR/部署/生产操作或使用真实凭证。
