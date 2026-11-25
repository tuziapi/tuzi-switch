# TUZI-MCP-1123：官方 MCP 一键连接 Codex

集成更新（2026-11-23）：用户已授权将本客户端实现纳入 `codex/ecommerce-desktop-integration`，与图片记录样式一起构建本地测试版。当前集成、安装和验证状态见 [集成交付记录](2026-11-23-results-style-mcp-integration.md)。下文“客户端未提交／未安装”等为来源工作区的历史状态；不代表当前集成分支状态。

最新交付状态（2026-11-23）：用户另行授权 API 同步 dev 并提交 PR。API 分支已按 issue 规则改为 `codex/525-mcp-native-oauth`，提交 `cd8895842eb6e8cea47d469d35b49e362306f28d`，草稿 PR https://github.com/tuziapi/tuzi-api/pull/526 面向 dev（`124ba4a10647557d7daa2dd432eea8fe1dabb859`），未合并或发布。实际 Codex 配对测试、24 项网站测试和构建复验通过；扩大检查发现 7 个图片路由测试失败，远程 dev 原始 Go 文件 overlay 对照同样复现；全仓离线检查因低磁盘空间停止。草稿保留上述回归及测试站/公网验收门槛。客户端本分支仍未提交、未推送；以下“未推送 PR”描述为前一实施阶段的历史状态。

2026-11-23。用户选择“一键配置＋首次授权”并要求开始实现。客户端基准 `a4e4c1bbd9754642ed468d5872ec852a30a985fe`，独立分支 `codex/tuzi-mcp-one-click-20261123`；API 配对为 `codex/mcp-codex-oauth-20261123`（基准 `124ba4a10` 加本地自动注册实现）。两端未提交、未推送、未发布。产品账户契约保持 `system-token-v1`。决策见 [ADR-026](decisions/0026-official-tuzi-mcp-codex.md)。

## 客户操作

1. 打开兔子助手的 **MCP 管理**，点击顶部 **兔子官方 MCP → 连接兔子 MCP**。首版目标为 Codex，必须已安装并初始化。
2. 助手自动保存官方服务器地址，在系统浏览器打开授权页。客户登录自己的兔子账号、核对权限并确认；无需填写 Client ID、Client Secret、Bearer 或系统令牌。
3. 返回助手等待检查。只有 Codex 实际成功读取账户和文档才显示“已连接”，并展示授权账号及检查时间。账号与助手不同会明显提示，不宣称已关联同一账号。
4. 在 Codex 新会话中可询问“通过兔子 MCP 查询 API 总指南及我的账户用量”。接入检查没有付费调用；后续敏感操作仍由网站审批。
5. “检查连接”重新验证；“重新授权”重新打开浏览器；“管理 / 撤销授权”进入网站连接管理。取消等待保留已保存配置；如已批准授权，需在网站撤销。原 MCP 列表仍可管理/删除该配置条目，删除本地配置不等于撤销服务端授权。

助手系统令牌仍只用于原账户业务。浏览器是否已登录、Codex 是否已获授权是独立状态。这里没有后台自动将助手账号切换到 Codex，也不分发账户凭证。

## 实现与保护

- `OfficialTuziMcpCard` 与 4 个原生命令实现连接、检查、取消和网站管理；中英日文已补齐。
- 配置通过 `McpService::install_official_tuzi` 进入现有文件/数据库事务；校验同名冲突、设置目录与 `CODEX_HOME` 一致性，保存失败回滚。
- 原生 helper 使用 Codex app-server，固定官方服务器与两个只读工具。stdout 每帧 1 MiB 上限、16 帧有界队列，取消/请求/授权有超时，退出清理子进程；不运行 shell，不发起模型 turn。
- 真实测试发现 Codex 会合并 MCP 配置，随后显式禁用临时验证会话中的其他服务器。还处理了 config/read 的 null 默认值不能直接回写配置覆盖的问题。均已修复后复测。
- 生产预检使用 HTTPS、证书验证、禁止重定向、10 秒请求上限、64 KiB 响应上限，检查官方 issuer、registration endpoint 和 `none` 客户端认证方式。旧服务明确提示升级，不改远端设置。
- 没有新增数据库表、列、索引或迁移；服务端本轮新增的只是跨仓库测试夹具。安装使用原有本地 MCP 表。

## 已验证

| 检查 | 结果 / 边界 |
|---|---|
| 前端卡片 + 原 MCP 表单 | 16 项通过；覆盖无需凭证、配置与授权状态分离、取消/防重复、账号不一致、撤销入口、错误脱敏 |
| TypeScript | `pnpm exec tsc --noEmit` 通过；独立工作树补齐既有依赖链接后通过，未改依赖 |
| 前端构建 | `pnpm exec vite build` 通过；既有大分包提示保留 |
| 原生编译/单元测试 | `cargo test --lib official_mcp::` 编译通过；4 项默认测试通过，2 项显式环境测试另行执行 |
| 安装事务真实隔离测试 | 显式执行 `install_isolated_preserves_settings_and_rolls_back_database_failure` 通过；内存本地数据库 + 临时配置目录；保留其他 MCP/模型/注释，重复配置幂等，冲突不覆盖，数据库失败恢复原文件 |
| 实际 Codex 配对联调 | API `TestMCPNativeAssistantCodex` 调用客户端编译的 Rust 测试，使用 `codex-cli 0.160.0`：发现/注册/PKCE 授权、实际回环 callback、重新启动 app-server 后读取已保存凭证、账户/文档查询、服务端撤销后拒绝均通过 |
| 无旁路影响 | 配对测试确认不启动其他配置中的 stdio MCP、不修改原配置、没有模型 relay 调用；凭证只写临时 CODEX_HOME，不读取客户配置/钥匙串 |
| 页面人工检查 | 本地浏览器合成预览检查了连接等待、按钮禁用、取消恢复、账号不一致及布局；不是已安装桌面包或生产授权验收 |

原生环境测试默认忽略；配对命令（测试二进制路径由 `cargo test --no-run` 返回）：

```sh
TEST_CODEX_BINARY=/path/to/codex \
TEST_TUZI_ASSISTANT_TEST_BINARY=/path/to/tuzi_switch_lib-test-binary \
go test ./mcpserver -run '^TestMCPNativeAssistantCodex$' -count=1 -v
```

测试服务仅监听本机 HTTP、合成账户、既有内存测试库；不是公网 TLS、生产 MySQL或真实客户账户验收。系统浏览器授权页的用户点击由合成同意夹具完成；没有伪称整套原生 UI 已在客户安装包验收。

日志保留于本机 `/tmp/tuzi-official-mcp-*.log`，页面截图 `/tmp/tuzi-official-mcp-20261123/customer-setup.jpg`。

## 尚未交付的环境项

- 2026-11-23 只读检查正式站：OAuth 元数据没有 `registration_endpoint`，认证方式仍为 `client_secret_basic` / `client_secret_post`。因此正式站尚不能完成本版 Codex 自动注册，需先发布配对 API 分支。
- 测试机 `192.168.50.207` 的 22 / 3210 / 3443 三端口本轮仍超时，没有部署。按既有“测试站先验收再 PR”的要求，未推送 PR。
- 未修改当前已安装兔子助手、未写入用户真实 Codex 配置，没有覆盖其他会话的电商工作区；首版功能在独立分支。
- 未生成/安装本版完整桌面包；Windows/Linux、其他 Codex 版本、真实公网 HTTPS＋客户浏览器授权仍待验收。
- 先完成 API 多节点测试部署，再用独立助手测试包核查按钮、真实网页登录、重启恢复和撤销；通过后提交两端配对 PR。其他 MCP 工具尚未声明一键授权兼容。
