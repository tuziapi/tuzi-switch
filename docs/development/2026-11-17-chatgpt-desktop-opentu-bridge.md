# ChatGPT Desktop → OpenTu 本地桥接

## 状态

2026-11-17：完成第一版本地 MCP 桥接实现，仍只在本地分支，未安装、未发布、未接入真实 ChatGPT 账号验收。

## 架构

兔子助手启动时在 `127.0.0.1` 随机端口监听 `/mcp`。服务使用每次启动重新生成的 256 位 bearer token；供应商 API Key 只留在 OpenTu 的现有配置和执行链中，不通过 MCP 返回。

ChatGPT 通过 MCP 调用 OpenTu，OpenTu 再通过 Tauri 事件把请求交给现有前端 MCP 注册中心和当前画布。生成任务复用 `generate_image`、`generate_video`、`generate_audio`，画布插入复用 `insert_to_canvas`，画布读取和编辑复用现有快照、版本校验和可撤销编辑逻辑。

## 工具

- `opentu_list_models`：返回本地创作能力和当前画板 ID，不返回密钥。
- `opentu_get_canvas`：返回当前画板元素、位置、文字、选中和可编辑状态。
- `opentu_get_task`：查询异步创作任务状态、进度和结果。
- `opentu_create_image`、`opentu_create_video`、`opentu_create_audio`、`opentu_create_text`：加入 OpenTu 现有任务队列，可选完成后插入当前画板。
- `opentu_insert_to_canvas`：插入已有文本或媒体结果。
- `opentu_apply_canvas_edit`：执行带版本校验的可撤销编辑；删除和替换必须传 `confirmed=true`。

## 配对

原生命令 `opentu_mcp_pairing` 返回当前启动实例的 endpoint、token 和协议版本。正式 UI 还需要补一个“ChatGPT Desktop 接入”面板，用一次性复制操作提供配对信息；不得把 token 写入日志、项目文件或普通配置。

ChatGPT 的连接能力受账户类型和客户端入口限制。普通 localhost 地址不能直接当成公网远程 MCP 使用；桌面插件或 Secure MCP Tunnel 的具体配置需按当前 ChatGPT 账户可用入口完成。未完成该入口的真实连接验收前，不宣称 ChatGPT Desktop 已经可用。

## 验证边界

- 前端创作包构建通过。
- Rust 检查需要在完整依赖编译完成后复跑；本机此前因并发构建和磁盘空间出现过失败，不能把该失败写成通过。
- 尚未用真实 ChatGPT Desktop 发送 `initialize`、`tools/list`、`tools/call`，也没有真实模型付费验收。
