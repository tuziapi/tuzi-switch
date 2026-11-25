# ECOM-RESULTS-MCP-1123：图片记录样式与官方 MCP 集成

用户确认缩略图紧凑列表方案，并明确要求把另一会话的官方 MCP 一键连接集成到当前源码。当前分支 `codex/ecommerce-desktop-integration`，基准 `c7c40aec`。授权本地修改、验证、构建和更新既有独立测试版；不含 push、PR、发布、服务端部署或代用户批准 OAuth 授权。

## 图片记录

- 生成记录、完成数量、模型集中在同一面板顶部；完成时简化提示。
- 每张图片显示 46px 缩略图、名称、带图标的状态；保存和详情统一靠右。
- 点击缩略图选中并滚动到已有大图预览，复用既有 Blob URL 及释放逻辑，不产生模型请求。
- HTTP、请求编号等保留在按需展开的详情里；错误、暂停、未发送及付费重试确认保持可见和可操作。
- 记录面板增加深色变量和按容器宽度换行；键盘焦点、展开状态和缩略图选中状态有可访问标记。
- 无本地持久字段、接口、计费或任务执行规则变更。

## 官方 MCP 来源与集成

从 `/Users/sdy09/.codex/worktrees/tuzi-mcp-one-click/tuzi-switch` 的 `codex/tuzi-mcp-one-click-20261123` 工作区读取，源 HEAD 为 `a4e4c1bbd9754642ed468d5872ec852a30a985fe`，功能位于该工作区未提交改动中。逐文件校验当前基准后合入；保留当前电商实现及文档新记录，没有修改来源工作区。

包括官方卡片、原生命令注册、Codex app-server 授权与状态检查、既有配置事务、中英日文文案、使用手册、测试和 ADR-026。入口为 **MCP 管理 → 兔子官方 MCP**。首版支持 Codex；OpenTu 本地画布连接器继续独立保留。账户契约仍为 `system-token-v1`，不分发系统令牌，不新增数据库字段。

## 本轮验证

- 创作任务／执行器／页面生命周期 13 项通过；其中页面 2 项在补充缩略图选择断言后重跑通过，证明选择已有图片不增加模型调用次数。
- 官方 MCP 卡片及原 MCP 表单 16 项通过；宿主 `pnpm typecheck` 通过。
- `cargo test --lib official_mcp::` 4 项通过，另 2 项显式环境测试默认忽略；随后单独执行隔离安装／回滚测试通过。
- 当前编译的原生测试二进制与实际 Codex 配对测试 `TestMCPNativeAssistantCodex` 通过，包含授权、查询、重启及撤销；仅本机回环合成账户，不是生产 OAuth GUI 验收。
- API 测试工作区 HEAD `cd8895842eb6e8cea47d469d35b49e362306f28d` 加另一会话在审改动；测试前后 `git diff --binary -- mcpserver model router` 摘要均为 `f10bf9942b9c1dc9065944fe5277f8f4bfed07aad20e458aaff9496b57e6a476`，本轮没有改 API。该验证不等同于该 HEAD 单独部署通过。
- 浏览器合成预览检查了完成列表、缩略图选中、请求详情、360px 深色容器、失败重试确认及生成中状态；缩略图是合成样式素材，不是新付费生图。
- 2026-11-23 只读请求正式站 OAuth 元数据，仍无 `registration_endpoint`，认证方式为 `client_secret_basic` / `client_secret_post`。生产一键授权依赖配套 API 上线，不将“入口已集成”写成“线上授权已通过”。

## 桌面交付

- 最终 `pnpm build:local` 完整通过，日志 `/tmp/tuzi-mcp-results-final-build.log`。前一个构建未用于交付；最终包包含对 `.creative-root[data-theme="dark"]` 的实际主题选择器修正，构建产物 CSS 在预览中复验通过。
- 已原位安装并启动 `/Applications/Tuzi Assistant Test.app`，1.6.3 Mac ARM64，标识 `com.tuziswitch.desktop.acceptance`。安装程序与最终构建程序逐字节一致，签名完整性检查通过。
- 主程序 SHA-256：`6bd69b084ed744aac72f3996d9bdb52b274e9def05150941aac55d0e0bd16fd7`。
- 交付包：`/Users/sdy09/Documents/tuzi-switch-artifacts/ecommerce-results-mcp-20261123/Tuzi-Assistant-Test-1.6.3-results-mcp-mac-arm64.dmg`。
- DMG SHA-256：`bfa7958285ba15eb1c58902d2a888b3e40d063b0cf6afe398e8a60b7205db700`。
- 原生窗口实测：MCP 管理显示官方卡片、当前助手账号及“连接兔子 MCP”按钮，无 IPC 未注册错误；没有代用户发起正式 OAuth 授权，也未改真实 Codex 配置。
- 原生创作工作区中，原有两个项目、账户连接、商品套图 2/2 及用户 A+ 5/5 记录保留。五张 A+ 图片均显示缩略图；点击“核心卖点图”切换到 2/5 大图，展开详情保留原请求编号及 HTTP 200。已通过原生保存对话框实际导出到本轮产物目录 `verified-existing-selling-point.png`；未重新生图。
- 测试应用停留在新版 A+ 结果列表。旧测试应用移至 `/Users/sdy09/.Trash/Tuzi Assistant Test before results-mcp 20261123.app`，可以恢复；没有清空废纸篓、删除项目或改动正式 `/Applications/兔子助手.app`。
- 这是 ad-hoc 签名的本地测试包，无正式 Developer ID 公证／updater 签名。Windows/Linux 与生产 HTTPS 授权全流程没有据此放行；未 push、PR 或发布。
