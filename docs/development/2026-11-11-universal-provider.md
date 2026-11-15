# UC-UNIVERSAL-01：统一供应商入口与同步补齐

日期：2026-11-11。用户确认方案 B：定向复用，保留现有界面和数据，仅本地开发验证；继续遵守“先别发布”。

## 来源与范围

- 工作分支：`codex/fix-universal-provider-sync`，基于 `5cb56b0631a81642e18f6c0f442a597534c409d9`；保留上一轮媒体菜单、兔子图标、Windows 名称及安装模板的未提交修改。
- 对照 CC Switch：`abf50589ed0ff60900ead3a83cfda9ff009cd6ef`，已核对本地 main 源码；不是线上部署证明。
- 支持 Claude Code、Codex、Gemini CLI；不包含 Claude Desktop、其他 CLI 工具或画布创作模型。账户契约、真实账户/工具配置均不修改。
- 无付费请求，无 push/PR/发布，无版本号变更，无重新打包安装或替换正在运行的客户端。

## 交付行为

- 独立页面标题右侧、空状态内新增“添加统一供应商”；原添加供应商弹窗继续保留自己的入口，避免重复按钮。
- 新建与修改统一执行保存后同步；请求中锁住重复提交，失败保留表单。保存成功但同步失败单独提示，重试 ID 不变，复制失败同样复用原副本。
- 原生同步保留各工具专属设置和排序，当前工具更新实际配置或代理恢复备份。新建不切换当前使用项，未使用的工具不重写 live 文件。
- 修复旧 Codex 统一记录同步后没有有效凭证引用的问题；保留官方 OAuth 文件和其他供应商凭证索引。
- 取消勾选、删除时保护当前使用的子供应商；部分同步失败也刷新工具列表。错误提示仅展示已知工具名，不泄露原始解析错误。
- 中英日说明对齐实际支持范围；错误提示放在顶部中央，避免遮挡表单底部重试按钮。

技术取舍、兼容及回退见 [ADR-021](decisions/0021-universal-provider-sync.md)。

## 验证

| 层次 | 命令/内容 | 结果 |
| --- | --- | --- |
| 前端回归 | `pnpm exec vitest run tests/components/UniversalProviderPanel.test.tsx tests/components/AddProviderDialog.test.tsx tests/components/TuziSidebar.test.tsx` | 16 项通过 |
| 原生专项 | `cargo test --manifest-path src-tauri/Cargo.toml --lib universal_ -- --test-threads=1` | 17 项通过 |
| 类型 | `pnpm typecheck` | 通过 |
| 宿主生产构建 | `pnpm exec vite build` | 通过，已有大 chunk 警告保留 |
| 浏览器 | `tests/visual/universal-provider-acceptance.cjs`，Chromium/WebKit | 各 6 组通过，无页面异常；最终结果见证据目录 |

原生测试在临时 home、合成凭证和隔离 SQLite 上实际写入/读取三工具配置；覆盖保存、重试、不自动切换、当前工具投影、元数据/TOML 保留、代理接管保护、独立 Codex 凭证、官方认证文件保留、数据库关闭重开、禁用/删除保护。不是实际 CLI 发起模型请求的验证。

浏览器使用真实 React 页面及显式合成 IPC，外网请求被阻止；覆盖两个添加入口、失败保留、部分失败重试不重复、编辑确认、重新加载、窄窗口/深色、同步和删除。浏览器存储恢复是合成夹具，持久数据库恢复另由原生测试验证。

错误发现记录：普通更新路径覆盖停止代理的接管配置已先由失败测试复现；改用既有投影后通过。测试最初错误假设空数据库无官方种子以及第三方 Codex 写入 auth.json，已改为检查原有当前项不变及独立凭证路径。

证据目录：`/Users/sdy09/Documents/tuzi-switch-artifacts/local-universal-provider-2026-11-11/`。本机原生安装包交互、Windows/Linux 实机和真实网关调用尚未验证，不因专项测试通过宣称全平台可上线。
