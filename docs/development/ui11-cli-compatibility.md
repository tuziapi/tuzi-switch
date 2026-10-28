# UI-11 CLI 隔离兼容验证

2026-10-27，基于客户端 `gaizhao` / `decb7ee5` 和 `system-token-v1`，验证上阶段新增工具及聚合能力。未修改 API，未访问真实账户、用户工具配置或付费模型；不代表发布、三平台或用户验收。

## 实际 CLI 与合成上游

| 工具及版本 | 结果与范围 |
| --- | --- |
| Grok Build 1.0.70 | 独立 HOME 中识别合成模型；Responses、Chat Completions、Anthropic 三种配置均向本机模拟服务发出流式请求并收到合成响应。 |
| Pi 1.4.0 | 独立 `PI_CODING_AGENT_DIR` 中识别合成模型；三种协议均通过本机流式请求。 |
| MiniMax Code 0.7.0 | 独立 `MINIMAX_DATA_DIR` 中识别供应商；三种协议均通过内置 provider test 和本机合成响应。 |
| Claude Code 2.1.220、Codex CLI 0.160.0 | 两个实际 CLI 分别经应用聚合代理向本机合成上游发起流式请求；上游断言收到还原的模型名和第二供应商的合成凭证。Codex app-server 的 `model/list` 另确认可列出合成目录中的默认与前缀模型。 |

新工具测试手工构造与应用输出结构一致的配置并使用本机端点，未通过账户真实保存流程或真实服务验证。CLI 版本仅为本次测试版本；Grok 安装脚本地址连接超时，使用其官方 npm 包及平台包的隔离安装。CLI 不继承用户环境和凭证；测试不使用工具执行功能。CLI 模型列表验证与聚合代理链路是分开进行的，未进行完整图形选择器人工验收。

## 验证与恢复

- 新增手动运行的 `aggregation::tests::installed_clis_route_prefixed_models_through_aggregation`：测试自建本机模拟上游与代理，临时 HOME 和合成密钥，指定本机 CLI 路径；默认忽略，显式运行通过。
- 复现时将 `TUZI_TEST_CLAUDE`、`TUZI_TEST_CODEX` 设置为两个 CLI 的绝对路径，`TUZI_TEST_PATH` 设置为包含其 Node 运行时及系统工具的 PATH，再运行 `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib installed_clis_route_prefixed_models_through_aggregation -- --ignored --test-threads=1`。CLI 版本可能影响结果。
- 既有聚合定向测试覆盖真实本机 HTTP 分发、Claude 接管退出、Codex 目录和文件恢复、外部修改冲突。新工具定向测试覆盖写入、备份与恢复；这些是隔离文件测试，不等同于实际用户数据操作。
- 使用 Rust 1.95 工具链路径重新执行 `scripts/build-local-preview.sh`，独立 macOS 预览包成功构建并启动。浏览器合成预览仍在 `http://127.0.0.1:5193/ui04.html?canvas=1&page=account`。
- 真实工具的 UI 选模、真实站点模型、真实账户、Windows/Linux 和发布仍待验证；本轮未 push、PR、部署或发布。
