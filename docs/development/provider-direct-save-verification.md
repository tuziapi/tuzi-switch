# B12 账户配置直接保存（2026-10-19）

用户确认账户密钥配置应与普通添加体验一致：检查预填表单后点击“添加”即保存，不再弹出文件变更确认框。本轮只修改客户端账户入口的提交编排及相关回归；原生来源/模型资格校验、完整写集备份、并发检查、失败补偿和恢复入口继续复用。失败保留当前表单及 Key，重试重新生成计划；准备及保存阶段去重并阻止关闭，准备期间卸载后不启动写入。成功后沿用工具页定位，简化成功提示。

## 版本与边界

客户端代码 `1ba0376a34ef7e4ff6e391a3af7c9622ef1cedf8`，基于 `1cad988e0b6b2614573d5add16d85ddb34325b4e`；API 未修改，HEAD `21cd7acd51349407cdc5d332a763907d065f9a86`。两仓均为 `codex/tuzi-assistant-system-token`，基线 `TA-AC-1.5-B4` / 契约 `system-token-v1`。后续文档提交不改变被测代码。

现有未提交的 Codex 创建 Key 预填、合成模型 fixture、测试和文档改动保持原状，未混入本轮代码提交；测试和构建基于包含这些改动的当前工作树，不声明干净提交独立涵盖全部先前修复。没有 push、PR、部署、生产访问或实际模型调用。

## 验证

本机 macOS 执行：

```sh
pnpm typecheck
pnpm exec vitest run tests/components/TuziProviderDialog.test.tsx tests/components/ProviderForm.test.tsx tests/hooks/useCodexConfigState.test.tsx tests/integration/App.test.tsx
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib actual_frontend_form_payloads_save_and_restore_all_seven_tools
CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target bash scripts/build-local-preview.sh
git diff --check
```

- 类型检查、4 文件 28 项前端测试通过。其中账户真实表单12项覆盖七工具直接提交及原生契约夹具、来源/计划参数、准备失败和保存失败重试、防重复提交/关闭、卸载后不继续写入。
- 原生1项循环覆盖七工具真实隔离文件保存与恢复，通过；只使用临时工具目录及内存数据库，无用户工具配置写入。原生实现及 HTTP/IPC 签名未变。
- renderer 和 macOS debug app 构建通过。保留既有嵌套按钮、MSW未匹配 account_cancel_token_prefill、chunk大小及原生未使用项告警，不声明全仓全绿。
- 使用已有 `tests/visual/b11.html?mode=form` 合成真实 React 表单，在浏览器只点击一次“添加”即出现“合成保存完成，未写入真实配置。”，无额外确认界面。该浏览器验证使用 Mock IPC，真实文件写入由上述原生隔离测试覆盖，不冒充原生实机端到端。
- 最新 `.app` 可执行文件时间20:29:45；重启前仅工具/模型选择页、模型为空，无未保存配置表单。正常退出并按完整路径重启，新进程于20:30:51启动，实机随后恢复合成管理员账户页。产物路径 `/Users/syd08/Documents/tuzi-switch/src-tauri/target/debug/bundle/macos/兔子助手.app`。
- 未在用户预览配置中实际添加供应商；完整原生UI保存、Windows/Linux及用户验收仍待完成。已有B11系统剪贴板/浏览器回跳验证限制继续保留。

## 回退

可独立 revert B12 代码与文档，交互回到 B11 二次确认；没有数据库/接口迁移或部署顺序要求。不删除备份、来源记录、凭证或用户工具配置，不覆盖既有未提交改动。

## B12 跟进：成功提示去掉恢复按钮（2026-10-19）

用户确认后只移除添加成功 toast 的“恢复配置”按钮及回调，保留保存/启用结果。后台备份、失败补偿及独立恢复组件不变。客户端代码 `42039e3`，API HEAD 仍为 `21cd7acd51349407cdc5d332a763907d065f9a86` 且未修改；两仓仍在指定 B 分支，契约不变。

本机 `pnpm typecheck`、`pnpm exec vitest run tests/components/TuziProviderDialog.test.tsx`（12项）、原 B12 macOS 本地预览构建命令均通过。本轮仅删除前端提示操作，没有重复原生/网站测试。预览可执行文件构建于20:39:22，确认无未保存表单后正常退出旧进程，按原完整路径重启并核验工具列表正常显示。未实际添加供应商、触发恢复或写入用户工具配置，成功提示留待用户实际操作验收。

代码提交仅包含提示组件和PRD。收尾核查还发现工作区出现本轮未编辑的 Cargo.toml、tuzi_account/mod.rs、store.rs 修改，一并保留且未纳入提交，不将其视为本轮被测改动；其他既有未提交文件保持原状。未推送或发布。
