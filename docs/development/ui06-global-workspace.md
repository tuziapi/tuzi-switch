# UI-06 固定全局工作区导航

日期：2026-10-27。用户确认进入固定全局导航阶段；在 `gaizhao` 基于 `270e1eec` 本地实施。仅客户端前端、合成预览及文档变化，无 API、原生命令、凭证或业务契约变更，`TA-AC-1.5-B4` / `system-token-v1` 保持。无 push、PR、发布或生产操作。

## 行为与兼容

- 侧栏固定展示 MCP、Skills、提示词、会话、授权管理、本机使用统计、Agents、统一供应商；Claude Desktop 和 Grok Build/Pi/MiniMax Code 不再隐藏全局入口，展开/折叠状态均可导航。工具专属 OpenClaw/Hermes 入口保留。
- 授权管理直接复用 `AuthCenterPanel`（Copilot / ChatGPT OAuth）；原设置入口保留。兔子账户系统令牌仍由账户页管理。
- 本机统计直接复用 `UsageDashboard`，支持现有 Claude Code/Codex/Gemini CLI 代理和会话统计；独立提示本机估算费用与兔子账户消费不同，不相加，不加载隐藏账户业务。
- Skills 与提示词显示目标工具选择；不支持的工具选项禁用。OpenClaw 的 Skills 不再自动改成 Claude。未选择目标时不挂载编辑/安装页面，顶部写入入口不显示。重启恢复到全局编辑页时重新选择目标，不推断上次原生工具或供应商页面。选择目标仅保留内存，无新增配置持久字段。
- MCP 和会话为全局管理；会话初始筛选为全部，再由页面内筛选。MCP/Skills 支持范围复用既有 appConfig 列表。
- Agents 仍未实现，导航和页面均明确标注。全局入口可见不代表所有工具都已适配。

| 功能          | 已接入工具                                       |
| ------------- | ------------------------------------------------ |
| MCP / Skills  | Claude Code、Codex、Gemini CLI、OpenCode、Hermes |
| 提示词 / 会话 | 上述五种及 OpenClaw                              |
| 工具授权      | GitHub Copilot、ChatGPT OAuth                    |
| 本机统计      | Claude Code、Codex、Gemini CLI                   |

Claude Desktop 和三个新工具的 MCP/Skills/提示词/会话仍待独立适配；官方 OAuth 聚合与聚合高级设置仍未完成。既有七工具配置保存/恢复、工具 OAuth、账户隐藏页规则不变。

## 验证与预览

前端全量、类型、renderer 和独立 macOS debug 构建的最终结果见 progress.md 本轮记录。日志分别为 `/tmp/tuzi-ui06-tests.log`、`/tmp/tuzi-ui06-typecheck.log`、`/tmp/tuzi-ui06-build.log`、`/tmp/tuzi-ui06-native-build.log`。格式和差异检查通过。无原生代码改动，本轮不重复 UI-05 的 Rust 全量测试，也不把其结果算成本轮新验证。

新增回归覆盖：十工具上下文下固定导航、折叠无障碍与选中态、未支持选项禁用、OpenClaw 提示词保留、Claude Desktop/三个新工具不回落 Claude、目标切换、重启恢复全局编辑页、全局授权/本机统计真实容器及会话全部筛选。App 测试用轻量子组件隔离路由；真实组件展示另外在合成浏览器及独立原生窗口核查，不把 Mock 视为真实登录成功。

合成页面仍在 `http://127.0.0.1:5193/ui04.html`，标题更新 UI-06，已接入真实全局页面组件。读取使用空合成数据，既有供应商/新工具演示仅改内存；未知 IPC、真实授权与其他写入拒绝。新工具和其他工具的全量配置验收请使用桌面版。

独立预览：`src-tauri/target/debug/bundle/macos/兔子助手.app`，标识 `com.tuziswitch.desktop.preview`，工具文件位于该应用隔离 home。已重启并核查全局授权页、Grok Build → Skills 未选目标提示。浏览器另核查选择 Codex 后 Skills、授权中心、本机统计页面。未点击真实 OAuth 登录、未使用真实账户或发起模型调用。

完整深浅主题/窗口宽度矩阵、真实工具运行、三平台与用户验收仍待完成。构建成功和局部窗口核查不代表完整 CC Switch 对齐、真实账户联调或发布成功。回退采用本地提交的 `git revert`，无需数据迁移。
