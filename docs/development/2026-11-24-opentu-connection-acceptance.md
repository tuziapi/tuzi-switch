# UC-OPENTU-CONNECT-1124：真实连接核查

用户要求真实连接，并尽量做到点击一次完成。基线 `codex/ecommerce-desktop-integration` / `16e04452`，本轮先核验当前已安装测试版，无推送或发布。

## 首轮核查（旧包）

- 在 `/Applications/Tuzi Assistant Test.app` 的项目页实际点击「连接 Codex / MCP」和「一键连接 Codex」，成功显示配置已写入、等待客户端调用。原生「检查连接」通过认证、初始化和 9 个工具发现。
- 实际生成的配置位于 `~/Library/Application Support/com.tuziswitch.desktop.acceptance/home/.codex/config.toml`；运行发现文件位于同一应用数据根的 `opentu-connector/runtime.json`，文件均为 0600。没有读取或输出凭证内容，没有修改用户实际 Codex 配置。
- 打开现有验收画布，通过已安装包的 `--opentu-mcp-stdio` 模式真实调用 `opentu_get_canvas` 和 `opentu_list_models`。北京时间 2026-11-24 09:44:12 返回 20 个元素、519 个模型选项；未输出画布内容、未编辑画布、未提交模型请求。
- 保持同一个连接器子进程运行，完全退出助手并核实 GUI 进程消失，重新启动并打开同一画布；09:45:21 同一连接器再次读取成功，仍是 20 个元素、519 个模型选项。不重装配置、不重新复制端口或令牌。
- 返回原生配对面板，显示「本次运行已收到连接器转发的成功工具调用」。该成功由验收进程触发，不冒充 ChatGPT/Codex 桌面会话调用。
- 可重复只读脚本：`scripts/qa/opentu-connector-read.mjs`。参数为安装程序绝对路径、运行发现文件绝对路径，可用 `--watch` 保持连接器进程，并输入 `probe` 在助手重启后重测、`quit` 结束。报告只包含时间、工具/元素/模型数量及验收边界，不输出令牌和媒体数据。

## 首轮发现的问题与授权

首轮源码 `src-tauri/src/opentu_connector.rs` 的 `config_path()` 在 `isolated-profile` 下始终使用测试目录。此隔离行为是明确保护措施，但旧界面仍显示「请在 Codex 刷新 MCP」，没有解释写入的是隔离目录。**因此旧测试版按钮成功不能使正在使用的真实桌面客户端自动发现服务。** 正式模式的路径逻辑不同，不能由首轮隔离验收推出正式客户端已接通。

用户随后确认「确认，开始实现吧」，批准增加显式本机连接入口。核查实际配置时发现同名 `tuzi-opentu` 指向 `/tmp/opentu-connector-target/debug/opentu-connector`，没有可验证归属标记；用户进一步明确批准「允许备份并替换旧连接」。该批准仅覆盖这一条旧连接，其他 MCP、模型和登录配置必须保留。

电脑控制工具对当前显示为 ChatGPT、内部标识 `com.openai.codex` 的客户端返回明确限制：`Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.` 未绕过限制。目标客户端的刷新/确认及实际发起工具调用仍需用户配合；本轮没有目标 ChatGPT 生图、入画布验收。

公开 OpenAI 文档检索未返回可用结果，官方 Codex MCP 页面 HTTP 请求为 403，因此未据此宣称当前客户端支持某种新增一键协议。代码/原生安装结果足以确认本地配置与自动重连，但不足以确认目标客户端完整兼容性。

以上是首轮核查结论，后续实现与验证见下文。原本的图片、视频、专用服务及正式发布门禁继续有效。

## 显式本机连接实现

决策见 [ADR-028](decisions/0028-opentu-explicit-local-client.md)。设置页与项目页明确传入 `connectLocal=true`，展示目标路径，并将展示的 `expectedConfigPath` 传入安装/解除命令；目标改变即拒绝。原命令默认值和全局隔离不变，合成测试环境仍强制隔离。隔离版的实际本机连接单独使用 `opentu-local-connector` 运行目录，重启刷新两种已启用连接，解除只处理选中的连接。

本地验证：

- 8 项面板/API 测试通过（`/tmp/tuzi-local-connector-ui-tests.log`）。
- 15 项画布桥接测试通过（`/tmp/tuzi-local-connector-bridge-tests.log`）。
- `pnpm typecheck` 通过（`/tmp/tuzi-local-connector-types.log`）。
- 4 项 release 原生专项通过：路径与隔离、目标变化拒绝、幂等安装/解除、冲突保护（`/tmp/tuzi-local-connector-native-tests.log`）。
- 真实配置已私有备份至 `/Users/sdy09/.codex/tuzi-opentu-backup-BiRo0x/config.toml`，目录 0700、文件 0600，备份内容与原文件一致；仅核对目标旧条目，不输出其他配置内容。

## 新包真实配置与原生验收

实现基于 `2c44042a`，在相同本地任务分支完成。首次构建因磁盘剩余不足 300MB，LLVM 报 `No space left on device`；用 `cargo clean --manifest-path src-tauri/Cargo.toml --profile dev --package tu-zi-switch` 清理可重建调试产物后可用空间恢复到 8.4GB。没有清理源码、作品、凭证、备份或已安装应用数据。重新执行 `pnpm build:local` 退出 0，日志 `/tmp/tuzi-local-connector-build-retry.log`。

- 最终应用已安装到 `/Applications/Tuzi Assistant Test.app`，身份 `com.tuziswitch.desktop.acceptance`。源包与安装包二进制一致，`codesign --verify --deep --strict` 通过。SHA-256：`4c6e07ed2059909c6e75708014caf5bddb4485b9df1332f667e8c0efa0c9ff0e`。
- 旧测试应用移至 `/Users/sdy09/.Trash/Tuzi Assistant Test-before-local-connector-20261124.app`，可恢复，未清空废纸篓。
- 交付 DMG：`/Users/sdy09/Documents/tuzi-switch-artifacts/opentu-local-connector-20261124/Tuzi-Assistant-Test-1.6.3-local-connector-arm64.dmg`。SHA-256：`8bbf0000ee15cf025c71748baa9dafc71b8aeecb991dd543d5f77ee7dc1e2b6f`，`hdiutil verify` 通过。仅本地 ad-hoc 测试包，无公证/正式 updater 发布。
- 原生项目页显示实际目标 `/Users/sdy09/.codex/config.toml`。保留旧项时点击连接得到冲突错误；配置与备份逐字节相同，新运行文件及 enabled 未遗留，原隔离连接保留。
- 按用户授权只移除核实过的旧四行条目，再通过原生「连接本机 Codex」安装。新条目使用已安装应用绝对路径、`opentu-local-connector/runtime.json` 和归属标记；未将模型 Key 写入条目。TOML 解析比较确认其他 MCP、模型及登录配置全部相同。
- 点击「修复本机连接」前后完整配置摘要一致；解除后目标条目与该运行文件/marker 消失，其他设置和旧隔离运行文件保留；再次点击连接成功。最终保留连接，配置和运行文件 0600、运行目录 0700。
- 原生「检查连接」返回本地认证、初始化和 9 工具检查通过。
- 北京时间 10:36:17，实际已安装 stdio 连接器返回 20 个画布元素、519 个模型选项、9 个工具。保持该进程不变，完全退出助手并核实 GUI 进程消失；重新启动、进入同一画布，10:37:23 再次读取成功，数量一致，配置摘要未变化。
- 原生连接面板显示「本次运行已收到连接器转发的成功工具调用」，实际布局已目视检查。最后关闭验收进程，助手保留在已打开画布上。

本次均为本地只读连接器验收，无新增付费生图。当前会话工具清单没有加载 `tuzi-opentu` 工具，目标客户端窗口仍受上述电脑控制限制；需要用户刷新/重新开启客户端会话并真正发起工具调用。不能把连接器脚本通过写成 ChatGPT/Codex 客户端端到端验收完成，更不能放行全产品上线。无 push/PR/发布。
