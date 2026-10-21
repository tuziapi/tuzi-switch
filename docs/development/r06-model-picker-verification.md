# R06 模型提示、隐藏未知项与协议识别（2026-10-21）

用户批准只修复讨论中的第1、2、4项；第3项“清空后四位仍保留搜索结果”明确暂缓。客户端基于 `fa0f0786dfd1e588feaeb57576942b9792617c70`，在 `codex/tuzi-assistant-system-token` 本地实施；API同名分支 HEAD `2e72a8b8786f917ee7ce1bc2dde0ce0ba2dd4425` 只读、干净。基线B4 / system-token-v1不变，不以本地API版本代表线上版本。

## 改动与依据

- 全部工具统一显示“已获取 N 个模型”，N是共用解析器处理后的完整模型数，不是当前工具过滤后的可选数；请求失败不显示获取成功计数。
- 隐藏未知协议的禁用条目；过滤后为空显示“暂无可用于此工具的模型”，搜索无可选结果显示“没有匹配的可用模型”。错误/重试入口保留。
- 手动获取和账户入口原本已经共用 `services/model_fetch.rs::read_models_response`，保留其8MiB限制、排序去重与协议元数据。新测试验证缺少端点详情时仍保留Claude/Gemini标签及未知模型，不在读取层丢模型。
- 本地API `controller/model.go::buildOpenAIModelItem`、`dto/pricing.go::OpenAIModels` 证明 `/v1/models` 返回 `supported_endpoint_types`，不含价格目录中的 `endpoints` 路径详情。既有共享fixture已记录 `claude code` 对应 `/v1/messages`、`gemini generateContent` 对应Gemini模板路径，但原规则要求这两个已知标签必须伴随路径，导致只含标签的列表误判。将它们提升为共享协议表中的已知别名；不根据模型名推断协议，也不接受其他任意标签。
- 前端和Rust保存检查读取同一JSON表；若响应明确给出错误路径或非POST方法仍拒绝。Claude、Claude Desktop、Gemini及其他依赖相同协议的工具一并修正；Codex仍按R03显示全部Key模型并保留原生成员资格检查。
- 账户入口仍固定主站，手动入口仍按供应商地址；不同地址不保证数量相同。未获得用户具体缺失模型样本，因此只声明修复有源码证据的识别遗漏，不声称所有线上差异已验证。

## 本机验证

- `pnpm typecheck`：通过。
- `pnpm exec vitest run tests/account`：6文件110项通过。新增六工具已知别名选择/继续、未知和图片协议隐藏、搜索空态、全部隐藏空态；保留Codex132模型完整列表回归。共享fixture覆盖大小写/空格、无路径已知标签、冲突路径/方法以及Key限制。
- `cargo test --lib tuzi_account`：43通过、1项既有真实Go配对测试忽略。含共享fixture在原生保存资格中的正负校验，合成HTTP及Codex成员资格回归。没有真实Key/模型付费调用。
- `cargo test --lib services::model_fetch`：20项通过，包括共用解码器新增回归。
- `pnpm build:renderer`：通过，保留既有chunk大小等构建提示。
- 格式检查及 `git diff --check`通过；Keys.tsx和筛选请求逻辑未修改。

未执行实际账户模型验收、原生安装包构建、三平台验收或全库回归。既有R02全库历史恢复测试失败不在本轮范围。仅本地修复，可通过本任务独立提交revert回退；无API修改、迁移、push、PR或发布。
