# 当前 B 本地预览（2026-10-19，含B09）

当前有效基线 `TA-AC-1.5-B4` / 契约 `system-token-v1`。当前流程为“前往获取系统令牌”→网站登录/定位安全卡片→查看并复制账户系统令牌→引导复制后尝试唤起账户页→手动粘贴并点击“连接”；普通个人设置复制不唤起。深链只导航、不携带凭证；不再使用账户 OAuth 授权、回调或换码。生产可信引导地址为 `https://api.tu-zi.com/console/personal?source=tuzi-assistant#system-token`；本轮验证只使用隔离本机站点与合成凭证，不使用生产账户。

- 两仓最终分支均为 `codex/tuzi-assistant-system-token`；客户端集成 worktree `/Users/syd08/Documents/tuzi-switch-system-token`，API 集成 worktree `/Users/syd08/Documents/tuzi/tuzi-api-system-token`。精确配对、实际运行包、启动命令、截图及用户验收步骤见 [B4验证报告](system-token-verification.md)，分支名不证明运行版本。
- 当前 B 隔离 API/网站入口使用 `http://127.0.0.1:5180`；Vite5180→Go3180；API worktree执行 `bash scripts/system-token-local-preview.sh`，客户端worktree执行 `bash scripts/build-local-preview.sh`，打开最终worktree的debug app。不要照抄下方A脚本。
- B09 最终构建从客户端 B worktree 执行 `CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target bash scripts/build-local-preview.sh`；实际运行包为 `/Users/syd08/Documents/tuzi-switch/src-tauri/target/debug/bundle/macos/兔子助手.app`，共享 target 路径不代表使用原工作区源码。最终包已正常连接本地合成管理员。最新配对、命令、截图及手工验证限制见 [B09验证记录](account-improvements-verification.md)。
- B09 按用户授权公开 API 密钥页、顶部四概要及每条 Key 的配置入口；其他隐藏页面仍保留且隐藏。配置复用原工具表单，已有配置直接定位，保存后留在工具页并可返回账户。
- 系统令牌由原生安全存储保存；旧 A v1 连接需按新流程重连。B 本地断开覆盖空 v2 记录，不轮换网站共享令牌。已有 A 预览数据库、表和业务数据保留，不自动删除或清空。
- 全程仅合成数据，不配置真实上游、不实际支付或调用付费模型；实际 OS 存储、原生/UI 联调、用户验收、三平台与数据库限制分别记录，未推送或发布。

以下整段保留的是 A 的历史操作与证据，**不是当前 B 的启动或连接指引**。其中“当前使用”“当前服务”等措辞均属于所记载历史时点。

---

# 历史 A 本地功能预览

2026-10-14，T19 本机交互预览子集；B3 / desktop-v1.1 / desktop-v1。

## 当前使用

- 桌面：`src-tauri/target/debug/bundle/macos/兔子助手.app`（隔离配置的独立应用，保留原名称）。
- 网站：http://127.0.0.1:5180/login；API：http://127.0.0.1:3180。
- **仅本机合成账户**：用户名 `preview`，密码 `TuziPreviewOnly2026!`。不是线上账号，不包含真实资产和请求。
- 配置隔离目录：`~/Library/Application Support/com.tuziswitch.desktop.preview/home`；OAuth 留在 macOS Keychain 的本地 origin/client 命名空间。
- 从桌面“通过浏览器连接”开始。浏览器登录后确认“兔子助手”，允许系统打开同名应用。首次从旧临时库切换需重新连接；此后重启 API 保留合成账户和连接。
- 可查看总览、Key 管理、调用明细、模型服务状态、模型广场与资料。助手充值/兑换/个人资料跳转到本地原站相应页面，支付与兑换复用原控制器，没有演示成功逻辑。独立订阅外链保留原地址。初始不配置商户、邮件或模型上游；用户显式添加模型渠道后可以发生真实上游调用和费用，合成余额不代表上游免费。

## 重启

API 仓库执行（占用 3180 / 5180，端口冲突会停止，不接管已有进程）：

```sh
cd /Users/syd08/Documents/tuzi/tuzi-api
bash scripts/desktop-local-preview.sh
```

客户端仓库执行：

```sh
cd /Users/syd08/Documents/tuzi-switch
bash scripts/build-local-preview.sh
```

然后打开构建生成的 .app。服务窗口 Ctrl-C 停止两项服务，API 最长运行 8 小时。合成数据保留在 `~/Library/Application Support/com.tuziswitch.desktop.preview/api/synthetic.sqlite`，随机 session.key 同目录保存；目录权限 0700、会话密钥权限 0600。日常版本不使用 `local-preview` feature。

## 首次预览历史证据（旧临时实现）

基于 C `43ac2941036042453b0753f6df47d0048117448f` / S `8ecf6c84ae5e97a95c7b42e56edd6ed658b4fa05`，两仓 `codex/tuzi-assistant-dev` 上的本地预览增量；无推送或部署。

- debug .app / renderer 构建成功。
- 真实 Chrome 网站密码登录 → 完整 scope 授权页 → macOS 自定义协议 → 原生系统安全存储 → 桌面“已连接”成功。用户已确认仅本地合成账号的条款与登录授权。
- 实际界面显示合成账户 `preview`，总览余额 CNY 73.00、累计请求 3 和当日消费记录；模型广场显示本地 seed 与代码内置模型配置，不能理解为线上模型可用性证据。
- Rust 账户回归原 31 项通过，3 项显式实机 fixture 默认忽略；新增隔离 origin 待授权重启回归 1 项通过；Go 预览包编译/默认 opt-in 跳过检查、启动脚本语法和两仓 diff 空白检查通过。
- 当前服务保留供用户体验，不重启打断连接。后续启动脚本启用严格代理、随机会话密钥及公告表初始化；初次运行存在无公告表的非阻断日志，此项不影响已验证的账户链路。
- 未代用户验收全部页面；未验证真实支付/上游模型调用、MySQL/Redis、多平台、完整 2FA 和 G3 其余项目。

旧实现初次运行停止：创建 `/tmp/tuzi-local-preview.origin.stop` 正常结束旧 API fixture。当前使用上方启动脚本，勿停止用户原有 3100 / 5173 服务。

## 完整原站接口与持久化修正（2026-10-14）

用户确认先本地测试再考虑上线，保留原站名称和充值支付逻辑。旧 fixture 只注册少量路由、session/me 缺完整账户字段，网站其他请求 404，余额出现 NaN；临时数据库与生产钱包跳转不适合持续联调。

当前复用完整 SetApiRouter、Dashboard 路由与原 GetSelf/Login，原 UI/支付控制器不修改。SQLite 完整建表，仅隔离 fixture 应用受保护迁移计划，处理建表/索引顺序和保留列名，不绕过正式数据库迁移门禁。启动脚本不读取 .env，仅绑定 localhost，后端退出同步停止 Vite。

合成账户初始 quota 50,000,000（默认汇率约 CNY 730）、累计请求 24；一条合成 Key、24 条成功日志及错误/退款样例、模型和性能数据。首次 seed 使用事务，重启不重复 seed。测试兑换码 `LOCALPREVIEW2026SYNTHETIC0000001` 额度 5,000,000，仅此本地库可用，原兑换流程消耗一次后失效。

验证：debug .app/renderer 构建及 local-preview 网页入口 Rust 定向测试通过；原站登录后账户、Key、日志、充值信息、模型、连接、用量接口成功；完整 PKCE 授权/换令牌后 desktop 账户、Key、分组、资料、模型、能力接口通过；desktop PATCH 资料→原站 GetSelf 回读一致，并恢复合成原值。服务重启后账户及 27 条日志保留；全新独立 SQLite 目录启动和 seed 亦通过，临时探针库已清理。SQLite 保留列名实际执行回归、启动脚本语法、diff 空白检查通过。

本地登录页实际显示原站“兔子API”，助手已打开并发起本地连接。当前 UI 重新授权和所有页面由用户测试，未代确认验收；未验证真实支付/上游调用、邮件、MySQL/Redis/多平台，不将接口探针冒充全部原生实机联调。两仓基于 C 43ac294 / S 8ecf6c8 的未提交增量，无推送或部署。
# 当前交互阻塞补充

2026-10-14 补充：钥匙串提示经用户处理后原生已恢复；网站 UI 登录/余额/请求次数展示通过。用户随后创建渠道与 Key 并请求模型时发现 `/v1/chat/completions` 404，原因是启动 fixture 漏注册原 relay 路由。现已增加 `SetRelayRouter` 与渠道缓存初始化，重启保留数据库；3180 直连与 5180 代理的无凭证请求均返回标准 401，证实路由生效。初始数据不配置上游；用户添加渠道后可以按原业务发起真实模型请求。未代发任何上游付费请求，真实模型响应和消费日志仍待用户测试。

最终服务启动后接口探针再次通过，资料写入后原网站回读通过；当日 usage buckets 随窗口变化，本次为 23，不以固定数量作持续运行断言。原生助手重启后停在读取账户状态，进程采样确认阻塞于 `SystemStore::read` → `SecKeychainFindGenericPassword`。macOS 安全授权界面不可由自动化操作，已请用户检查并处理钥匙串提示。登录页测试账户已填写，协议勾选等待用户单独确认；当前原生 UI 验收未完成，不将运行中的应用等同可用验收。


## 2026-10-15 本地提交整理

用户授权将现有预览源码、脚本和说明纳入本地版本管理；上文未提交状态为历史。复跑默认账户 Rust 测试：32 通过、3 忽略；local-preview 特性的 business_allowlist_and_web_urls 定向测试 1 通过。两个启动脚本 bash -n 通过；API SQLite 保留字回归通过，常规运行中预览服务测试按 opt-in 设计跳过。本轮未重启服务或重新执行真实浏览器联调。配对 SHA、提交及回退说明以 progress.md 最新记录为准。
