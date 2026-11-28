# UC-OPENTU-STYLE-1125：项目连接入口与弹窗排版

用户要求优化项目页“连接 Codex / MCP”的图标换行、连接弹窗展示和按钮。沿用当前网站嵌入预览分支 `codex/embedded-sites-session`，基线 `6df5a5f8`；仅本地 UI 修改、验证和预览，无 push/PR/发布。

## 修改

- 项目入口增加独立描边按钮样式，图标和文字横向排列、不拆行，与搜索和新建按钮对齐；窄宽度允许整组控件换行。
- 连接弹窗使用独立样式，不再复用重命名布局。连接状态、主要连接操作、教程和手动配置分区；配置路径默认折叠，主次按钮区分。
- 标题和底部操作固定，长内容在中间滚动；复制按钮、反馈和深色样式统一。弹窗错误不再重复出现在背景项目页。
- 不新增持久字段，不改原生命令、权限、凭证存储、连接事务或生成行为。

## 验证

- `pnpm typecheck` 通过。
- 现有 CreativeWorkspace、OpenTuConnectionGuide、OpenTuConnectionPanel 共 14 项测试通过（`.website-test.vitest.config.ts`）。
- 创作包、renderer 和独立 Mac ARM debug app 构建通过；重新注入原有隔离 test-home，adhoc 签名验证通过。
- Mac 原生窗口目视检查：入口图标与文字单行、连接状态卡片、教程卡片、滚动、展开 HTTP 配置、底部复制按钮和固定页脚均正常。仅查看配置，不执行连接/解除，不复制真实令牌或调用模型。
- 已更新并打开 `outputs/embedded-sites/Tuzi Websites Preview.app`。旧包保留于同目录 `Tuzi Websites Preview-before-mcp-style.app`；原隔离数据保持。
- 本轮未实机验证深色/Windows/Linux，UI 检查不替代原有真实登录、跨平台及发布验收。

日志：`/tmp/tuzi-mcp-style-{typecheck,tests,creative,renderer,app}.log`。

## NAV-HOME-1125 补充

用户要求导航顶部品牌区域点击返回首页。按现有默认首页 `account` 实现：品牌区改为可键盘操作的按钮，复用 onNavigate，菜单自动关闭；右侧收起箭头保持独立。适用于下拉导航和展开侧栏，无新增字段。类型检查、现有导航 7 项回归、renderer/Mac 预览构建和签名检查通过；原生实测创作页→打开菜单→点击品牌→账户首页，菜单关闭。预览包已更新打开；仅本地，无发布。日志 `/tmp/tuzi-nav-home-{typecheck,tests,renderer,app}.log`。
