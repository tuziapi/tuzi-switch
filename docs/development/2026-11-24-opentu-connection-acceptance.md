# UC-OPENTU-CONNECT-1124：真实连接核查

用户要求真实连接，并尽量做到点击一次完成。基线 `codex/ecommerce-desktop-integration` / `16e04452`，本轮先核验当前已安装测试版，无推送或发布。

## 实际完成

- 在 `/Applications/Tuzi Assistant Test.app` 的项目页实际点击「连接 Codex / MCP」和「一键连接 Codex」，成功显示配置已写入、等待客户端调用。原生「检查连接」通过认证、初始化和 9 个工具发现。
- 实际生成的配置位于 `~/Library/Application Support/com.tuziswitch.desktop.acceptance/home/.codex/config.toml`；运行发现文件位于同一应用数据根的 `opentu-connector/runtime.json`，文件均为 0600。没有读取或输出凭证内容，没有修改用户实际 Codex 配置。
- 打开现有验收画布，通过已安装包的 `--opentu-mcp-stdio` 模式真实调用 `opentu_get_canvas` 和 `opentu_list_models`。北京时间 2026-11-24 09:44:12 返回 20 个元素、519 个模型选项；未输出画布内容、未编辑画布、未提交模型请求。
- 保持同一个连接器子进程运行，完全退出助手并核实 GUI 进程消失，重新启动并打开同一画布；09:45:21 同一连接器再次读取成功，仍是 20 个元素、519 个模型选项。不重装配置、不重新复制端口或令牌。
- 返回原生配对面板，显示「本次运行已收到连接器转发的成功工具调用」。该成功由验收进程触发，不冒充 ChatGPT/Codex 桌面会话调用。
- 可重复只读脚本：`scripts/qa/opentu-connector-read.mjs`。参数为安装程序绝对路径、运行发现文件绝对路径，可用 `--watch` 保持连接器进程，并输入 `probe` 在助手重启后重测、`quit` 结束。报告只包含时间、工具/元素/模型数量及验收边界，不输出令牌和媒体数据。

## 当前缺口与下一步

`src-tauri/src/opentu_connector.rs` 的 `config_path()` 在 `isolated-profile` 下始终使用测试目录。此隔离行为是明确保护措施，但当前界面仍显示「请在 Codex 刷新 MCP」，没有解释写入的是隔离目录。**因此当前测试版按钮成功不能使正在使用的真实桌面客户端自动发现服务。** 正式模式的路径逻辑不同，不能由本次隔离验收推出正式客户端已接通。

已向用户提出明确范围选择：允许增加面向真实本机客户端的连接入口，仅写入自有 `tuzi-opentu` 项并保留其他配置，或继续保持隔离。等待选择期间，没有移除全局隔离保护、改写实际客户端配置或擅自搭建公网 Tunnel。

电脑控制工具对当前显示为 ChatGPT、内部标识 `com.openai.codex` 的客户端返回明确限制：`Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.` 未绕过限制。目标客户端的刷新/确认及实际发起工具调用仍需用户配合；本轮没有目标 ChatGPT 生图、入画布验收。

公开 OpenAI 文档检索未返回可用结果，官方 Codex MCP 页面 HTTP 请求为 403，因此未据此宣称当前客户端支持某种新增一键协议。代码/原生安装结果足以确认本地配置与自动重连，但不足以确认目标客户端完整兼容性。

本轮只新增可复用只读验收脚本和记录；没有修改业务实现或重建安装包。原本的图片、视频、专用服务及正式发布门禁继续有效。
