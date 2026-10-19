# B16 模型端点名称兼容（2026-10-19）

用户要求修复“Key 可以调用，但客户端列表因端点名称差异漏显示”的问题；授权仅本地编码和验证，不推送、不部署、不改线上配置。两仓均为 `codex/tuzi-assistant-system-token`，有效基线 `TA-AC-1.5-B4` / `system-token-v1`，服务端接口字段和工具写入协议未改变。

## 代码与配对

客户端代码 `f64ebcc8c2b6a625cb6a6528b32657e9817d75b0`；配对未修改 API HEAD `21cd7acd51349407cdc5d332a763907d065f9a86`。本地临时 Responses 模型夹具仍是未提交改动，未进入该提交。其他原有工作树修改保留；构建基于当前工作树，包含既有本地修复，不能视为仅此提交的干净检出构建。

前端筛选与原生保存前资格检查共用 `src/lib/tuziEndpointProtocols.json`。规范别名去首尾空白、不区分大小写；新增已核实的网站显示标签 `claude code`、`gemini generateContent`，要求对应模型声明了端点，并提供匹配的标准路径。标准名称在没有详情时保留原有兼容；若提供详情，路径必须匹配协议、方法必须为 POST（缺省方法按 API 默认 POST），不接受冲突/外部 URL/畸形详情。未知标签不凭模型名或宽泛路径猜测，Responses compact、图片/视频专用接口不能冒充 Responses/Claude/Gemini 协议。

七工具仍按自身协议集合选择模型，现有 Key 状态、有效期、额度、分组、模型限制、来源证明和写入事务保持不变；没有更改工具目标地址或凭证索引。

## 公开接口核查（只读、无登录、无模型调用）

读取 `https://api.tu-zi.com/api/pricing/models` 的分页公开目录，662 条/662 个不同模型。仅将公开名称、声明端点/详情、分组保存在本机 `/tmp/tuzi-public-model-endpoints.json`，未读取私有账户或密钥。新旧规则对比记录 `/tmp/tuzi-endpoint-public-audit.json`：

| 协议 | 修复前识别 | 修复后识别 | 原可识别项减少 |
| --- | ---: | ---: | ---: |
| Anthropic | 57 | 61 | 0 |
| Responses | 26 | 26 | 0 |
| OpenAI Chat | 447 | 548 | 0 |
| Gemini | 37 | 51 | 0 |

Claude 新增包括 claude-haiku-5-5、claude-sonnet-5-5、claude-opus-5-5、claude-3-7-sonnet-20250219-thinking。Gemini 新增包括 gemini-3.1-pro-preview、gemini-2.5-pro、gemini-3-flash-preview 等。统计为协议识别结果，不代表某个用户的实际可见数量，不等价于模型调用能力或上游可用性证明。

## 验证

- `pnpm exec vitest run tests/account/tuzi-endpoint-compatibility.test.ts tests/account/tuzi-tool-compatibility.test.ts tests/account/account-improvements.test.tsx`：61 项通过。45 组共享数据覆盖规范别名、大小写/空白、两个公开标签、旧空详情、错误路径/方法、畸形值、外部 URL、Responses compact 和未知标签；七工具协议组合复用这些数据。组件回归验证 Claude/Gemini/OpenClaw 选择模型并将原 Key/模型/协议正确传入下一步。
- `CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target cargo test --manifest-path src-tauri/Cargo.toml --lib tuzi_account::business::`：普通（非 local-preview）构建下 3 项通过；同一 45 组数据经原生判断及实际 qualified_models 校验，对禁用、过期、零额度、分组不符和模型受限 Key 仍拒绝。
- 同环境 `cargo test --manifest-path src-tauri/Cargo.toml --lib services::tuzi_provider::tests`：14 项通过，覆盖七工具保存/恢复/失败补偿、独立 Codex 凭证和配置保护。
- `pnpm typecheck`、`git diff --check` 通过。
- `CARGO_TARGET_DIR=/Users/syd08/Documents/tuzi-switch/src-tauri/target bash scripts/build-local-preview.sh`：macOS debug 预览构建通过，保留既有构建警告。本轮没有重启用户当前应用。

日志 `/tmp/tuzi-endpoint-{tests,native,save-tests,types,build}.log`。未执行真实账户到正式客户端的端到端保存或付费调用，未做三平台发布验收；不能据此宣称已上线。发布前需移除或排除本地测试夹具，并使用普通正式构建。

回退正式修复使用本提交的 git revert；API 无配套变更或数据迁移。临时夹具与其他未提交修改不能随回退清理。
