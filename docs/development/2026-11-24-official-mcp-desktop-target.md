# TUZI-MCP-DESKTOP-1124：官方 MCP 连接本机 Codex

## 范围与实现

用户要求“现在去实现一下，优化一下代码”。在已批准的一键配置＋首次网页授权方案内，本地完善官方 MCP 卡片。助手分支 `codex/ecommerce-desktop-integration`，起点 `738461f135ac50136884d77e248dcef2393bf76c`。不推送、不发布、不部署 API。

- 显示实际 Codex 配置位置，按钮明确“连接到桌面 Codex”；测试包的这个入口显式连接本机，其他设置保持隔离。
- 复用 OpenTu 的配置选址与 MCP 文件事务；目标变化、同名冲突时拒绝写入，保留用户其他 MCP 和模型设置。
- 先检查正式站是否支持桌面动态授权，再启动 Codex/写配置；旧授权仍可以独立检查连接。
- 成功状态要求实际查询通过；配置缺失、目标变化、账号不符、查询错误时不显示成功。补充新对话使用说明。
- 实测发现新版桌面 Codex 已将程序移至 `Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`，补齐 ChatGPT/Codex 两种应用名下的新旧路径，继续保留 CLI 回退。
- 状态和 IPC 新字段在原生、TypeScript、界面、三语、测试和可视夹具同步。无数据库或服务端字段变化，兼容与回退见 [ADR-026](decisions/0026-official-tuzi-mcp-codex.md)。

## 两仓与正式服务

只读核对 API 工作树 `/Users/sdy09/.codex/worktrees/mcp-codex-oauth/tuzi-api2`，分支 `codex/525-mcp-guide-self-service`，HEAD `393e30c880c9634a139b3bef276b34407c181b0a`。其已有未提交文档/UI 修改未动。服务端动态注册已实现，另有测试机验收记录，不能视为正式部署。

2026-11-24 正式域名元数据仍返回 `registration_endpoint: null`，认证方式只有 `client_secret_basic` / `client_secret_post`，版本头 `dev-20261119-0728d98d06fc`、缓存 `no-store`。因此当前公网自动授权不满足客户端契约，必须先升级正式 MCP 服务。账户基线仍为 `system-token-v1`；不复制系统令牌或模型 Key。

## 验证

以下区分本地实现、合成账号配对和正式服务实测，不将服务端阻断视作授权成功。

- 前端全套：112 文件、944 项通过（实施中版本）。最终专项四文件 17 项通过。
- 最终原生官方 MCP：7 项通过；另外单独运行隔离配置/数据库回滚 1 项、OpenTu 共享选址回归 4 项通过。
- `pnpm typecheck`：最终版本通过。
- 实际 Codex＋本地 Go API 配对：首次使用已移除的旧程序路径失败并暴露探测兼容问题；修正后以本机 `codex-cli 0.171.0-alpha.13` 运行 `TestMCPNativeAssistantCodex` 通过。覆盖合成账号 OAuth、重新启动 app-server 后凭证可用、只读查询、撤销后拒绝及不启动其他 MCP；无真实账号或付费模型请求。
- `pnpm build:local`：最终 Mac ARM 应用与 DMG 构建成功。本地 ad-hoc 签名，未做开发者发行签名/公证或 updater 发布；安装前后 `codesign --verify --deep --strict` 及最终 `hdiutil verify` 通过。
- 已安装原生 `tauri://localhost`：目标展开显示 `/Users/sdy09/.codex/config.toml`；初始“尚未配置”，实点连接显示服务检查、按钮禁用，随后显示正式服务未开放自动授权；第二次点击同样正确恢复，未出现虚假成功。
- 两次连接前后真实配置 SHA-256 均为 `ff89437d46bd8de98b36fc6e058addec3ebb90d1f55ddb91479bc673deca78b9`；本轮未写入真实官方 MCP 配置，也未触发真实 OAuth 授权。界面中常规 MCP 列表仍管理预览配置，官方卡片明确显示独立本机目标。

## 本机安装与回退

保留唯一应用入口 `/Applications/Tuzi Assistant Test.app`，数据与账户配置保留。此前应用移动至 `/Users/sdy09/.Trash/Tuzi Assistant Test-before-official-desktop-20261124.app`，可退出新应用后恢复；没有永久删除旧包。

| 产物 | SHA-256 |
| --- | --- |
| 构建及安装后的 `Contents/MacOS/tu-zi-switch` | `4221916353e98d530ac0baac8fc9323cbce8f44ea2d645053754562232abf094` |
| `src-tauri/target/release/bundle/dmg/Tuzi Assistant Test_1.6.3_aarch64.dmg` | `e447c6e38bcf91c38e1507d060ac120a7b8acb7972e425ee7f7912f51efbe342` |

本地原生窗口连接及重试结果通过辅助功能树核验；电脑控制首次抓取与一次重试截图出现系统流错误，重新读取窗口后完成操作，不把失败的工具操作计作成功。

## 交付边界

本轮只交付本地客户端优化。生产自动授权、目标桌面 Codex 对话中的实际工具调用及跨平台实机仍须分别验收；不能用组件测试或辅助 app-server 配对代替目标客户端验收。此前视频及完整创作发布门禁保持不变，公开测试下载页不更新。
