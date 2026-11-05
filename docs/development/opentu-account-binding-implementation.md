# UC-P02：创作设置与账户关联本地实施

日期 2026-11-01。授权为用户选择 B，并要求同时支持手动配置、复用与简化现有设置。方案和字段以 [UC-D03](opentu-account-binding-design.md) 的本轮修订为准。

## 代码范围

- 宿主创作顶部及原画布菜单复用原 SettingsDialog，分类横排、常用配置优先、高级项目折叠、保存/取消供应商草稿。
- 同一供应商表单选择兔子账户 Key 或手动地址/Key；原模型获取、选择、预设与本地存储保留。
- 账户 Key 配置增加 opentu 目标，并指向同一表单；不增加 CLI AppId。
- CreativeAccountBridge 传公开账户状态与受管来源引用；native creative 模块持久化非敏感来源并按固定动作发送请求。
- 原生资格共用接口不再触碰工具保存 proof；拒绝错账户、无资格模型、未知协议、任意 URL、危险 multipart 和重定向；取消/断开保留不明结果语义。
- 模型发现、图片找回、ProviderTransport 和共享 fetch 接入引用；定价公共请求不发送引用；导入导出剔除账户引用。

账户 `system-token-v1` 与 API 仓库无修改。源基线与本地分支见 UC-D03；所有本轮验证使用合成值，未读真实凭证、未调用付费模型、未 push/PR/发布。

## 验证记录

| 层次 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| 宿主类型 | `pnpm typecheck` | 通过；创作上游依赖另由 Vite 构建校验，不宣称全量上游 tsc 已通过 |
| 前端回归 | `pnpm exec vitest run` | 83 文件 / 580 项通过，含 11 项新增账户桥接边界测试 |
| 原生编译 | `cargo check --locked --manifest-path src-tauri/Cargo.toml --lib` | 通过，保留 2 项既有 dead-code 警告 |
| 原生账户 | `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib tuzi_account:: -- --test-threads=1` | 54 项通过、1 项既有真实配对测试忽略；含 7 项新增来源/动作/协议/multipart/文件解析测试 |
| 创作包 / renderer | `pnpm build:creative`、`pnpm exec vite build`，最终 `pnpm build:renderer` | 通过；保留 Sass 旧语法及 bundle 体积警告 |
| 设置浏览器 | `tests/visual/creative-account-smoke.cjs` | 账户绑定保存重载、模型列表/添加/重载、取消草稿、手动新增保存、断开后手动保留、原菜单不卸载画布、账户选定 Key 入口、停用 Key 禁用、浅深色、1360/1024/900 宽度 footer 均通过 |
| 画布回归 | `tests/visual/creative-smoke.cjs` | 绘图、IndexedDB、重载、多项目、重命名、自动侧栏收起、导航往返和旧数据保留通过 |
| OpenSpec | `pnpm dlx @fission-ai/openspec validate add-assistant-account-binding --strict` | 通过 |
| 来源还原 | 固定 SHA 原始哈希 + 临时目录 `git apply --check` / 应用后逐字节对比 | 1356 原文件、61 修改原文件、4 本地文件；完整还原一致 |

浏览器验证阻断所有外部请求，页面错误为 0，受管引用出站 HTTP 为 0。使用 Chrome + Playwright、macOS ARM Rust 1.95；未运行打包后的 native IPC 全链路或真实账户/付费生成。

日志位于本机 `/tmp/opentu-binding-{typecheck,all-tests,native-check,native-tests,creative-build,renderer-build,provenance,spec,canvas}.log` 与 `/tmp/opentu-account-browser.log`、`/tmp/opentu-binding-final-build.log`；截图及 `results.json` 位于本会话可视化目录 `account-binding/`。测试运行器使用隔离临时目录和合成数据；为释放构建空间，仅移除了本 worktree 本轮生成的 Rust incremental 缓存和测试可执行文件，没有清理用户数据。

## 已知边界

- 浏览器预览用现有合成账户和真实创作设置/IndexedDB；仅模型列表支持合成返回，生成操作明确拒绝。原生编译/单元与浏览器界面验证分开记录。
- 原生适配只涵盖设计列明的动作；未声明协议的模型或专用适配器应使用手动配置，受管引用不会被自动换成明文 Key。
- 选择 Key 先记录非秘密来源，取消尚未保存的表单不会启用关联，但可能保留未引用元数据；设置沿用原多窗口存储语义。
- 原生账户全局取消会停止本地等待，无法保证服务端已取消任务；结果未知时不自动重发。
- 真实账户、完整付费媒体链、原生 IPC 端到端、跨平台安装包、用户验收和发布未完成。


## UC-P02.1：创作设置入口左置

2026-11-01 用户要求将创作配置一起放到左侧。仅调整宿主顶部布局，将“创作设置”紧接“我的项目 / 自由画布”，复用同一配置弹窗。现有导航测试 2 项通过；浏览器验证 1360/1024/900 宽度均保持左侧相邻、设置开关正常、页面错误 0。预览通过 Vite 热更新生效；本次仅布局调整，未重新运行原生构建或发布。日志 `/tmp/opentu-settings-left-{test,browser}.log`。
