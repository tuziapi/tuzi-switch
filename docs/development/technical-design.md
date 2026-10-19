# 统一技术方案：系统令牌接入

基线 `TA-AC-1.5-B4`；契约 `system-token-v1`；决定见 [ADR-008](decisions/0008-system-token-connection.md)。本文取代 A 认证设计，保留业务与工具事务要求；[B3 原样快照](history/b3-oauth-a/technical-design.md) 仅历史审计。

## 架构与原生可信边界

React 保持现有页面和业务 DTO，仅连接区改成网站入口、系统令牌输入/验证。输入只在提交流程短暂存在，成功/取消/退出清除，不写 localStorage/持久 query cache，不从普通 IPC 查询取回安全存储秘密。Rust 接受受控 connect/retry/disconnect/业务操作，不提供任意 HTTP 代理。

Rust 使用固定可信 origin、禁重定向、无 Cookie 的专用 HTTP client（保留原受信 no_proxy 策略）。生产为 `https://api.tu-zi.com`；loopback 仅显式本地预览构建/测试受信配置，不能通过页面或深链改 origin。凭证及 New-Api-User 只由原生构造。首次 bootstrap 用 Bearer，不给用户 ID；确认返回身份后后续发 matching ID。连接成功必须在服务端身份验证及安全记录保存均成功之后。

`/account/*` 是 IPC 逻辑操作，不是网络端点；Rust 验证方法、精确路径/ID、查询字段/类型/上限及请求 body，再映射原站路由。拒绝绝对 URL、路径逃逸、额外 Header、管理员参数和未列操作；成功 payload 转为旧页面 DTO，删除原站额外字段。保留 owner/原生权限校验和取消 requestId，不因改接入扩大功能。

## 本地账户文件及连接生命周期（B13）

按2026-10-19用户明确要求，账户系统令牌由原生 LocalFileStore 写入独立本地明文JSON，不再调用 keyring/Keychain。这是批准的存储方案替换，不是失败时降级。位置为系统用户本地数据目录下 `com.tuziswitch.desktop/account/<SHA256(origin + NUL + client)>.json`，预览使用 `com.tuziswitch.desktop.preview/account/`。该位置独立于可迁移应用配置、SQLite、工具配置和WebDAV；系统级备份及同用户进程不在应用权限隔离承诺内。Unix目录0700、文件0600，Windows继承当前用户本地数据目录ACL。原子临时文件替换、大小限制和符号链接拒绝；失败仅返回固定错误码，不泄露原文。

B的Record v2仍包含version/origin/client/generation/tokens/identity。恢复校验版本、固定origin和client；普通IPC不返回令牌。旧钥匙串记录不读取、不迁移、不删除，首次更新需重新连接。macOS已通过本地验证，Windows/Linux实际文件权限与安装升级仍待对应平台验收。

若本地文件中出现旧 v1 A AT/RT/pending/journal，不能解释为 B。恢复检测后只投影 reconnect_required/明确重连说明，不恢复 OAuth、自动换码或删除业务数据。明确连接先递增代次并将不含 tokens/identity 的空 v2 记录持久化，成功后才进入 verifying 并验证输入，防止验证失败或中断后恢复旧账户。空记录写失败不开始验证，明确报告存储错误；验证成功后再保存含身份和令牌的 v2 记录，第二次保存失败也不进入 connected、不返回令牌。重启时读取原生记录并回读身份，网络错误保留可重试状态；无效/轮换/禁用时停止旧业务并清账户缓存，不能用到期/刷新模型解释。

系统令牌没有原站独立 TTL，不自动轮换、不实现 refresh/revoke。本地 disconnect/logout 递增代次，以不含 tokens/identity 的空 v2 记录（tombstone）覆盖本地账户文件，并清内存身份及临时账户状态，不是轮换网站令牌，也不操作旧钥匙串条目。覆盖失败仍清本轮内存状态，但报告 error 且 `localCleared=false`，不能宣称已清除磁盘凭证；不请求站点生成/轮换，不声称远程失效。用户需主动在网站轮换才能使共享旧令牌失效，且会影响其他接入。改密码对系统令牌失效未有证据，不照搬 A 承诺。

## 状态、缓存和异常

保持单一活跃账户。明确 connect（包括切换或重新粘贴连接）在空记录持久成功后发布新 generation；logout 发布新 generation，二者向原生 pending 业务请求发送取消信号。retry 仅重验已保存身份，沿用当前代次，不等同新连接。React 在代次/connection ID 改变或身份清空时取消并移除账户查询，清旧筛选选择/图表/预填和临时模型 Key。原生业务请求在发出和返回时校验代次，React 也检查状态 revision/查询 AbortSignal，迟到响应不能改新缓存或表单。取消信号只停止本机等待，已发远端写无法保证撤销，旧账号结果可能待核实，不能显示给新账号。

当前账户 query key 包含账户命名空间、固定 origin、`system-token-v1`、user ID、connection ID、generation、feature 和 filters（契约标记亦在 key 中）；B 来源由这一命名空间/契约表达，不要求安全记录另存 `auth_source`。模型响应仍按 snapshot/schema 处理。仅内存缓存，重启离线无数据则显示离线。正常切页去重，隐藏页不触发请求，窗口隐藏暂停轮询；读请求有界超时/重试及 Retry-After，不秒级拉日志。不可恢复认证失败不显示旧身份缓存，普通网络错误不销毁凭证或供应商。

原站 HTTP200 success:false 必须按业务失败解析；认证错误、账户禁用、无资格、限流、5xx 和无数据各有反馈。写超时不盲重试、回读确认。原生投影只包含业务最小数据，不将管理角色字段或敏感资料泄到页面；这限制助手调用面，不能缩小泄露系统令牌的服务端权限。

## 网站引导与凭证边界

固定 URL `/console/personal?source=tuzi-assistant#system-token`。PrivateRoute 保存完整受信站内 return_to，现有登录及 OAuth 登录回调保持来源/查询/锚点，失败可回登录再继续。只在精确引导条件选择安全 tab、渲染后滚动聚焦、卡片细边/淡色背景强调2秒再以400ms淡出（减少动画时无平滑滚动/过渡）；普通默认 tab 不变。

SystemTokenCard 分开 read/current、copy、generate、rotate。只读接口不改变令牌；空值才提供明确生成按钮，读失败只给重试；轮换独立 Modal 说明共享失效。介绍使用 PRD 指定短句；引导态复制成功后仅唤起固定账户导航 URI，普通复制不跳转，失败显示可选明文；失效登录清旧网站身份并保留目标重新登录。令牌不进 URL/重定向/埋点/日志，无自动回传、OAuth 或未来 SSO 实施。

## 服务端最小兼容扩展

以最新网站 `dded57caedc376c4399f778ebb2147748bc24743` 为基础，只引入窄 bootstrap、原 token/user 的原子 PATCH、明确本人完整汇总、现有可选认证的系统令牌支持。具体 whitelist、数据/时间/错误以 [契约](api-contract.md) 为准。旧路由和网站 DTO 不整体替换，不放开敏感接口，不取消全局 ID Header、不信任静态客户端 Header。

Key PATCH 在锁内只写提供字段，保留并发网站高级修改；profile PATCH 锁内合并未知 settings。所有 self 查询从认证上下文确定身份，管理员 self=true 也不可聚合全站。汇总直接 SQL 全量 sum/count，不从有限模型表相加，日志可用性/覆盖/退款/失败各自表达。pricing/perf 可选认证有效 Bearer 取得账户资格，无效 Bearer 不降级匿名；原生投影保留隐藏业务原功能。

## 工具预填、写入和脱敏

不新增独立配置向导。AddProviderDialog/ProviderForm增加显式创建预填上下文，区别编辑initialData；包括目标app、主站预设/协议/端点、模型候选、短期Key句柄或受控值、来源账户generation。只有选择目标并验证兼容后才reveal。

保留七工具能力矩阵：可否按现有主站配置创建、支持协议/端点、Key写入位置、预设来源、配置文件集合、备份/恢复及自动启用语义。Claude Desktop当前预设数组为空，不能照搬其他工具索引；可按现有表单能力适配；下表记录的新默认预设/端点仍需逐项核实，验证状态按 progress 登记，不能把源码可实施当实际模型调用通过。

以下保留既有七工具协议/备份规范。实现与平台验证状态以 progress 为准，不存在的预设不能依靠数组序号；本轮不做真实付费模型调用。

| 工具 | 采用现有能力与主站端点 | 预填/写入与备份对象 | 完成门禁 |
|---|---|---|---|
| Claude Code | 现有主站Anthropic预设，https://apius.tu-zi.com | env的ANTHROPIC_BASE_URL/AUTH_TOKEN，清既有冲突API_KEY按原规则；Claude settings与provider DB/环境写集 | 保留原协议/路径；模型由可见兼容列表选，不把旧默认模型当保证 |
| Codex | https://api.tu-zi.com/v1，responses | auth/config TOML及provider独立envKey、provider DB | 多卡环境键隔离，不能写coding Key，不强改共享OPENAI_API_KEY |
| Gemini CLI | https://api.tu-zi.com，Gemini协议 | .env GEMINI_API_KEY/GOOGLE_GEMINI_BASE_URL、settings.json及provider DB | 多文件失败补偿，保留其他settings |
| OpenCode | 原预设为空；新增主站创建项，现有npm表单支持OpenAI Responses、chat兼容、Anthropic、Google | OpenCode JSON/JSONC provider配置、provider DB；按所选协议决定/v1或原根地址 | 仅显示账号模型同时满足端点与SDK能力的选项；不是任意模型通用 |
| OpenClaw | 主站codex-tuzi为openai-completions；claude为anthropic-messages，/v1 | OpenClaw JSON配置及provider DB，保留additive行为 | 不误改为responses；读实际live写集再备份 |
| Hermes | codex_responses或anthropic_messages，/v1 | ~/.hermes/config.yaml的custom_providers及provider DB；providers_dict保持只读 | YAML无关字段保留，原工具认证不替换 |
| Claude Desktop | 原预设为空；新增主站项接现有proxy模式；macOS/Windows原有支持，Linux此工具无现有支持 | 普通Claude配置、Claude-3p配置、configLibrary/{PROFILE_ID}.json与_meta.json、代理状态/DB按现有路径helper定位 | 不承诺未证实direct企业网关；代理Key与模型Key分开；Linux按钮明确不可用（不等于整个应用Linux不支持） |

平台路径不硬拼，复用src-tauri现有各工具path/config helper。写集在Rust保存计划阶段取得：存在文件字节/权限/哈希与不存在标记、环境项和provider/代理DB状态；备份在任何首次写/自动启用前完成。期间文件哈希改变则中止/提示冲突，不用旧备份覆盖用户新修改。跨文件/DB按操作日志补偿恢复，备份中模型Key按现有本地秘密保管与访问限制，不进入脱敏预览/遥测；账户系统令牌永不入备份。

B12：点击表单“添加”后，后台生成原生变更计划，不再另弹脱敏diff确认框；在首次可能写入环境变量、provider DB或live文件之前备份所有受影响对象。原子写只保护单文件，跨文件/DB需要操作记录与补偿恢复；失败不留下“保存成功”或错误当前供应商。备份失败阻止写入，恢复前检查用户期间是否另改文件，不盲覆盖新的用户修改。保留现有注释、未相关配置、MCP/skills/profile和工具OAuth。

Model Key工具运行保存遵循现有机制；账户系统令牌不进入其中。Codex每卡独立envKey，不强行回到共享OPENAI_API_KEY，也不把前端新建和后端seed的名称硬合并。主站Key与Coding/GACCode创建路径分离。保存完成后仅记录真实来源 `{站点,用户ID,tokenID,app,providerID}`；既有未知来源显示“未关联/未知”，无需扫描/上传所有本地Key。

新的账户/订阅网页入口只用opener和固定HTTPS目标，不使用open_webview_with_key。允许改方案明确要求的Coding/GACCode查询URL；其他现有工具用量脚本/本机统计按现状保留。

## A 退出与非破坏性数据库处理

客户端针对性退出账户 OAuth 发起、回调、交换、刷新、revoke 和 `/api/desktop` 网络请求；保留工具自身 OAuth、v1/import 等仍使用的深链基础设施，不能批量回退 A 提交中的页面/业务/安全与工具功能。删除旧账户专用入口不删除本地业务数据，v1 安全记录提示重连。

API B 基于最新网站而不是 A 分支；A `/api/desktop`、独立 OAuth 表模型/迁移入口、安装 required 标记、撤销钩子/清理器停止集成，不能留下安全操作引用缺表。旧站已有 OAuth provider、登录、安全、支付、模型功能照常。复用 A 的字段保护、本人隔离、统计逻辑时搬业务逻辑，不搬已失效认证结构。

执行者须只读核查实际本地 DB 的存在、表/安装标记和预览配置（不打印凭证/用户行），记录证据；A 只本地不等于可以删表。已有 A 独立表、迁移标记及用户数据保留，不自动 DROP/清空/回滚 schema，不运行生产迁移。新 B 隔离预览使用单独合成 SQLite，升级原预览尽量非破坏；若需 destructive 操作另行授权。

从 A 切到 B 后，任何回退到 A 的计划均须核对旧表完整性、安装标记、安全钩子与清理器及旧凭证状态，不能由旧二进制自动恢复旧 OAuth 凭证。B 与 v1 存储版本不互认；回退应提示重连，不能将系统令牌写成 AT。B 不需要新增 A schema，也不以禁用原 OAuth provider 作为止损。

## 发布准备与回退（只计划，未授权执行）

1. 固定配对 SHA、契约和回归证据，核实目标运行版本、数据库/日志拓扑、三库/三平台及容量门禁；检查现存 A 安装事实。
2. 获新授权后先部署向后兼容 API 扩展/网站引导，验证原网站、其他 OAuth、模型及支付；不创建或清除 A 表，不改变现有令牌。
3. 部署配对 B 客户端，按 B09 的 Phase 1 可见性（四概要、Key、单 Key 配置入口），旧本地 A 连接明确重连。其他隐藏页面仅开发验收。
4. 灰度观察本人统计、错误、数据库成本、旧站回归，用户验收与正式发布分别记录。任何 push/PR/部署/生产操作需另授权。

回退优先停止/回退 B 客户端和网站引导，再按已验证兼容组合回退 API 扩展；先回 API 时新客户端遇缺接口显示不兼容而不 fallback 到 A/任意端点。原站旧业务继续，无服务端系统令牌自动 revoke；若令牌疑似泄露须由用户主动轮换并告知共享影响。保留 schema/历史业务数据，不把 git revert 当 DB 回退，不恢复旧令牌或旧 OAuth 为有效。两仓本地 commit 独立配对，通常以 revert 回退，不 reset/force push。

## B09 账户体验实现（2026-10-19）

连接页使用账户作用域 CSS 居中卡片，校验采用短暂 toast；密钥工作区采用同一弹窗组件，创建/只读详情/显式编辑/揭示/确认删除状态隔离。写入去重及结果未知回读保留，临时秘密仍受卸载、代次和短时清除约束。金额用 BigInt 十进制换算，币种偏好默认 CNY，可改 USD；不改服务端额度。

原生精确解析无参数账户导航链接，设置一次性 pending 标志并发送事件；React 先注册监听再消费 pending，处理冷启动，切到账户并聚焦输入。链接不携带凭证，不连接、不轮换。无效账户链接和旧 A 回调不进入导入解析/日志。

单条 Key 的配置按钮打开工具选择弹窗，复用兼容模型与原 TuziProviderDialog。已有来源需 JOIN 当前 provider 的 id 与 app_type，避免已删除或其他工具同 ID 被误认；不删历史来源。保存使来源查询失效，转到对应工具页、滚动突出供应商并提供返回账户入口。换号清选择、草稿和返回上下文。没有兼容模型时明确提示，不削弱协议/资格过滤，不代发模型测试。

## B11：受控剪贴板预填及创建草稿（2026-10-19）

按用户确认实施 [ADR-010](decisions/0010-token-prefill-and-provider-drafts.md)。许可仅原生内存，5分钟/单次/generation/固定回跳限制；前端空输入及修订序号保护，不自动连接，不增加持久缓存或令牌 URL。新增 IPC `account_take_token_prefill` / `account_cancel_token_prefill`，原 `account_open_token_page` 负责许可；网站 HTTP 不变。

显式创建分类从 initialData 初始化并随表单提交；兔子线路名称/图标及 Codex TOML 默认参数保留，选中模型和独立环境键覆盖默认值。三种附加工具草稿带唯一 providerKey，保存采用该值。B11 曾显示变更确认框；B12 根据用户确认取消该额外步骤，添加操作内依次执行原 preview/save IPC，准备及保存全程去重/防关闭，失败保留表单、提示并允许重新准备后重试，卸载后不启动后续保存。来源/资格/事务检查保持。B10 已取消工具页返回提示；上文 B09 返回入口记录仅为历史。
