# UC-P01：统一客户端本地预览

日期：2026-11-01。用户已批准 UC-D02 v0.2，并明确要求改用 `AiW520/tuzi-switch` 的 `codex/assistant-main-sync`。本轮范围是本地实现和可运行预览，不包含推送、PR、发布或真实模型调用。

## 精确基线

| 对象 | 基线与处理 |
| --- | --- |
| 兔子助手 | `fork/codex/assistant-main-sync` / `71314a670b4cca0e1aaf2b2af3295b4fca6d8ad8` |
| 本地工作分支 | `codex/opentu-assistant-sync`，从上述提交新建的独立 worktree |
| opentu | `7d05f299fec40599221294a34c9b26f888177c9e`，只读取其 Git 跟踪源码，不引入 outputs、node_modules、用户数据 |
| 旧工作区 | `gaizhao` 的原有改动未覆盖，也未带入新的指定基线 |
| API | 未修改；账户仍采用 `system-token-v1` / ADR-011，不声称真实服务联调通过 |

新基线默认进入兔子账户，保留这一行为，不恢复旧分支已经删除的 last-view 逻辑。创作内部页签在当前会话中单独记忆。

## 当前范围更新

UC-P01.2 用户明确移除独立工作流模块，当前仅保留项目与自由画布。下方 P01/P01.1 的工作流实现和测试属于先前阶段记录，不代表当前仍交付该模块。最新删除范围和验证见文末。

## 首次接入路径（历史记录）

- 现有 TuziSidebar 在账户下方增加「opentu 创作」，原十工具和工作区入口保留；没有新增 AppId。
- 本地包 `@tuzi/creative-workspace` 导出 React 组件，由宿主懒加载，共用 React / React DOM。没有导入独立 main/bootstrap、第二个应用根、更新器或 Service Worker。
- 项目首页使用 opentu 原 WorkspaceService，支持真实新建、搜索、打开、重命名与 IndexedDB 保存。没有预置作品、假成功或伪造任务数据。
- 自由画布复用原 Drawnix 和保存逻辑；工作流复用原 WorkflowApp、节点编辑器和存储。
- 工作流顶层路由适配为内存导航，宿主地址与历史不被工作流切换覆盖。
- 创作 CSS 在包构建阶段限制到 `.creative-root`，工作流 reset 另限 `.workflow-app-root`；转换已编译的 Tailwind 4 层，防止宿主 Tailwind 3 重复解释。原生 portal 移入创作容器，工作流不覆盖宿主侧栏。
- 用户后续批准自动向上收起：进入创作隐藏整条助手侧栏，顶部入口展开原导航浮层；不改写侧栏偏好，关闭浮层不卸载画布，返回工具恢复原宽度。离开创作卸载编辑界面、触发自由画布保存；当前阶段不承诺跨工作区持续运行生成。
- 不从 URL 或 opentu 旧桥接导入账户令牌。opentu 原生命令以显式 `__TUZI_CREATIVE_NATIVE__` 接口为门槛，不能因为宿主存在 Tauri 就把未迁入的命令发给宿主。

## 代码与复现入口

宿主入口：`src/features/creative/CreativeWorkspace.tsx`、`src/App.tsx`、`src/components/shell/TuziSidebar.tsx`。

创作源码：`packages/creative-workspace/src/` 与 `upstream/`；来源 SHA、逐文件原始哈希和本地补丁见包内 `UPSTREAM.json`、`UPSTREAM-PATCHES.patch`。只引入前端业务源码和必需资源，未复制 Nx 工程和 opentu 的 Rust Builder。当前源码快照仍较大，后续发布前继续收敛依赖与分包。

```sh
pnpm install --frozen-lockfile
pnpm preview:creative
```

浏览器打开 `http://127.0.0.1:5197/ui04.html?canvas=1&page=creative`。这个验收入口复用真实侧栏和创作模块；账户/工具 IPC 使用原有合成 fixture，不读取真实账户或工具文件。创作项目实际存入这个浏览器 origin 的 IndexedDB，不能将此入口当作桌面原生联调证明。源应用本身也已接入 creative View，并通过 renderer 构建。

完整 renderer 构建：`pnpm build:renderer`，会先构建创作包。此命令不涉及版本脚本或推送。

可重复浏览器验收：`tests/visual/creative-smoke.cjs`；使用独立无痕浏览器上下文和合成绘制内容，阻断全部外部请求。通过 `PLAYWRIGHT_MODULE` 指定已安装的 Playwright，`CHROME_PATH` 指定 Chrome，`CREATIVE_QA_OUTPUT` 指定截图/JSON输出目录。

## 验证与边界

- `pnpm build:renderer`：创作包与宿主均通过。宿主输出约 36 MB，包含原有资源；存在上游 Sass 弃用和大 chunk 提示，未完成启动、内存或包体优化验收。
- `pnpm typecheck`：宿主类型检查通过。未声称整个导入的 opentu 源码在宿主严格 TS 配置下完成独立类型验收。
- `pnpm test:unit`：81 个文件、564 项测试通过，包括新增路由与专注模式回归。
- `openspec validate add-assistant-creative-workspace --strict`：通过。
- 来源核对：1775 个原始文件的 SHA-256 与固定源提交逐一一致；50 个集成修改文件与 `UPSTREAM-PATCHES.patch` 完整对应。
- 浏览器验收通过：真实画笔绘制、IndexedDB 保存、工具往返、刷新恢复、专注模式恢复、重命名、多项目、工作流节点保存及刷新、宿主 URL 与侧栏样式隔离；1360 / 1024 / 900 像素无横向溢出，深色项目页已核查。页面脚本错误为 0。最后视觉复核修复了逗号分组选择器前空白导致的重复作用域，避免深色项目卡片保留浅色背景。证据为本轮 `results.json` 和截图，不代表所有创作功能已验收。

## 尚未完成的交付门槛

本地预览已通过系统浏览器打开，Codex 内嵌浏览器打开请求已排队；用户实际验收仍待反馈。

| 项目 | 当前状态 |
| --- | --- |
| 桌面原生媒体与文件 | 未迁入 `creative_*` Rust 命令、媒体协议和受控路径授权；目前使用 Web 存储路径 |
| 模型凭证与账户配置 | 尚未接入账户 Key → 创作；本轮没有读取真实令牌、配置真实 Key 或发送付费生成 |
| 设置中心 | 原创作设置界面仍在；统一设置入口、凭证存储及权限门槛待 P2 收口 |
| 生成生命周期 | 未验收离开创作后的持续生成、退出等待、任务恢复和未知结果处理 |
| 数据迁移 | 未读取/迁移/删除旧 opentu SQLite、IndexedDB、媒体或旧钥匙串 |
| 插件和外部资源 | 仅局部样式、路由和命令适配；原可执行插件/外部资源的完整同窗权限审计仍是发布阻断项 |
| 全部原创作业务 | 视频、音频、PPT、Agent、插件、素材导入导出等未逐项实测，不作为完成声明 |
| 原生客户端与发布 | 本轮没有构建 macOS/Windows/Linux 安装包；未签名、未发布，用户验收待完成 |

后续继续沿批准的 P1→P2→P3→P4 完成原生适配、账户与任务、数据导入、安装更新验收。这里的浏览器预览不是“用户只下载一个客户端”的最终交付完成证明。


## UC-P01.1：自动向上收起与桌面外观适配（2026-11-01）

用户确认进入 opentu 自动向上收起助手导航，并指出预览外观与最新版桌面端有差异。

- `TuziNavigation` 在创作页面提供顶部下拉浮层，复用原 `TuziSidebar` 的账户、十工具、工作区和设置路由。原 App 与浏览器预览均接入；内容区宽度归零偏移，没有保留 68px 图标栏。点击收起按钮、Escape 或外部区域关闭；浮层不重新挂载编辑器。
- 移除旧手动专注模式。创作不改写 `tuzi-sidebar-collapsed`，返回工具可恢复 228px 或 68px；不新增持久化字段。
- 只读核实 `git ls-remote public refs/heads/main refs/tags/v1.2.17-preview.2`：main 为 `7d05f299fec40599221294a34c9b26f888177c9e`，预览标签为 `4a8e414076e86fef1174dccf0d8a15a4d88c1edd`。原会话、本地快照与远程 main 一致，没有遗漏新提交。
- 确认外观遗漏：暖白点阵画布的样式类及世界坐标对齐 hook 仅在 `isTauriEnvironment()` 下启用。集成预览刻意隔离原生命令，导致该样式未启用。两处显示条件补充 `VITE_TUZI_ASSISTANT`，继续沿用新版原样式和定位计算；不打开 Tauri 命令或独立更新器。
- 项目首页是已批准的集成入口，并非独立 opentu 原首页。原生媒体、凭证、任务与安装包限制继续有效。

本轮验证：宿主类型检查通过；82 文件 / 565 项前端测试通过；创作包与宿主 renderer 构建通过；OpenSpec 严格校验通过。真实浏览器复测通过自动收起、顶部展开、Escape/收起按钮/外部点击关闭、画布 DOM 保持挂载及尺寸不变、两种侧栏宽度恢复、真实绘制/存储/刷新恢复、工作流节点保存、暖白底色/点阵/定位变量、1360/1024/900 宽度和深色项目页。外部请求全部阻断，页面脚本错误为 0。证据位于本轮 `top-navigation/results.json` 与截图；本轮仍未验证原生安装包或付费生成。


## UC-P01.2：移除独立工作流（2026-11-01）

用户明确要求删除“工作流”页签及其中的全部内容。本轮只在现有本地集成分支实施；原 opentu 源仓不变，不清空用户存储、不推送或发布。

- 删除 `workflow-mode/` 完整独立应用，包括节点编辑器、其生图/视频/提示词/资产/渠道配置页面、stores、路由、桥接、插件及 public 资源。
- 删除顶部页签、首页卡片、自由画布菜单入口与回调、恢复/更新逻辑中的专用分支、工作流资产 Vite 插件及其挂载、专用 alias 和样式作用域。
- 本轮删除 421 个文件（419 个上游源码/资源文件以及宿主资源插件和专用路由测试），移除 22 个直接依赖；离线锁文件更新移除 409 个安装依赖包。
- 保留自由画布项目、绘制、生图/媒体/任务及其内部生成编排。自由画布也使用的手动图片找回查询迁至 `services/query-image-result.ts`：保持原渠道、请求 ID 匹配、鉴权失败不回退和可信节点恢复规则，脱离已删除模块的代理配置 store。
- 旧 `tuzi-creative-page=workflow` 回到项目页；不读取/删除/迁移旧工作流业务内容。浏览器验收用合成旧数据库标记确认其仍保留。
- 来源清单更新为 1356 个保留原始文件、54 个原始文件补丁和 1 个有来源记录的本地查询服务。`omittedPaths` 记录删除范围，补丁中不复制被删应用。操作前本地备份位于 `/tmp/tuzi-creative-before-workflow-removal-20261101.tar.gz`；该备份不打包、不提交。

验证结果：离线依赖更新、`pnpm typecheck`、`pnpm build:renderer` 和 OpenSpec 严格校验通过；`pnpm test:unit` 为 82 文件 / 569 项通过。宿主产物约 30 MB，产物未匹配独立模块路径 `workflow-mode/` 或 `workflow-assets/`。新增图片找回的 5 项合成回归验证渠道、请求 ID 和失败边界。真实浏览器通过无工作流入口、旧页签回退、旧数据库标记保留、绘制/保存/工具往返/刷新恢复、顶部导航不卸载画布、多项目、1360/1024/900 布局和深色项目页检查，页面脚本错误为 0。截图与结果在本轮 `without-workflow/` 目录。全部外部请求阻断，没有真实账户或付费生成验证；未构建原生安装包、未推送或发布。

## UC-P01.3：进入创作的连续过渡（2026-11-01）

用户指出从兔子账户点击 opentu 时侧栏突然消失、切换突兀，要求有收起过程。当前用户要求授权本地界面修复，不涉及 UC-D03 的账户绑定实现。

- 新增共享 `TuziSidebarTransition`，在退出时保留旧导航 280ms，以从底部向上裁切、轻微上移和淡出收起；退出开始就设 `inert`、隐藏无障碍树并禁止指针交互，不留下可误触的旧路由。
- 宿主 App 和实际合成预览共用此组件。顶栏 left/width 与主内容 margin-left 使用同一 350ms 曲线，避免内容和标题错位；创作工作区与顶部导航短暂延后淡入。
- 返回助手时导航展开，保留原 228px/68px 宽度。无延迟路由定时器，不写新偏好；顶部浮层开关不会重新挂载画布。初次打开普通助手页面不播放侧栏展开。
- 尊重 `prefers-reduced-motion`：原生系统偏好由既有 Framer Motion hook 读取，布局和内容 CSS 同时关闭位移动画。

验证：`pnpm typecheck` 通过；前端回归 82 文件 / 569 项通过；`pnpm exec vite build` 宿主 renderer 构建通过（创作包源码本轮未变，复用已验证产物）。独立浏览器逐帧验证入口中间态、顶栏与正文对齐、退出侧栏 inert、退出结束卸载、正常/减少动态效果以及两种宽度往返。既有 `creative-smoke.cjs` 调整为等待退出完成后再断言侧栏移除，完整绘制、保存、刷新、工具往返、浮层不卸载画布、三种窗口宽度、深色与旧数据保留检查均通过，页面错误为 0。证据位于本会话可视化目录 `navigation-transition/results.json` 和 `navigation-transition/canvas-regression/`，外部请求全阻断。仅本地预览和构建，不代表原生安装包及真实账户联调验收；未推送/发布。


## UC-P02 后续：统一账户来源

用户已批准统一账户关联并要求复用原设置。顶部入口、手动/账户来源、原生受限请求和本地验证已经接入，字段与真实联调限制见 [UC-P02](opentu-account-binding-implementation.md)；本文件此前未实施账户关联的文字保留为 UC-P01 当时状态，不代表最新本地代码。
