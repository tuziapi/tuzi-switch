# UC-TEXT-01：OpenTu 文本对话工作区

2026-11-08。用户批准四页交互预览、开始实施，并明确复用配置中的文本模型。分支 `codex/opentu-text-chat`，基线 `f731039e1323945bf8b955a926b140089f2b2110`。仅本地实现、合成验证、隔离构建及提交；无 push/PR/发布、真实凭证或付费调用。

## 实现

- 同一抽屉提供文本对话/创作助手，支持专注和画布并排；专注隐藏画布悬浮工具条，原有创作功能保留。
- 直接使用现有 ModelSelector、模型目录、供应商引用、路由与账户/手动请求桥接。配置按钮打开原创作配置，无第二套模型或 Key 存储。会话只保存模型引用；新会话沿用全局默认文本模型。
- 普通聊天不混入创作 Agent 提示，也不执行输出中的工具调用。四种协议：OpenAI Chat Completions（包括 Claude/DeepSeek 兼容接口）、Responses、Anthropic Messages、Gemini 原生。协议由配置端点决定，不按品牌强切协议。
- 流式正文、独立推理折叠区、Markdown/表格/代码高亮及复制/KaTeX 公式、停止、复制回复、显式重试/重新生成、历史搜索/重命名/确认删除、草稿、会话系统提示和可选最大输出长度。
- 重新生成保留旧回复并标明原问题；上下文只带对应问题之前的最新完整回复。可明确点击插入画布、引用画布选中文字。本版不包含文件/图片附件。
- 每会话独立 AbortController，40ms 渲染与700ms保存节流。用户消息先保存成功再发请求；停止、网络/解析错误保留部分内容，重启恢复未完成状态为中断。无自动付费重试。保存失败可以重试保存。
- 更新前检查文本任务及保存错误；备份导出先 flush，恢复拒绝进行中的文本生成，恢复后重载运行时。

## 协议边界

UTF-8任意分块、CRLF、多行SSE、无空格data字段、末尾未换行记录、JSON回退、空回复、缺完成标记、取消、32MiB响应限制均有处理。单条20万字符、上下文80万字符，超出明确提示，不暗中截断。请求最长10分钟。

Chat正文结束后继续读取usage，直到DONE/正常EOF；默认不加采样参数。用户显式输出长度对o系列、GPT 5–9前缀用`max_completion_tokens`，其他兼容模型用`max_tokens`；自定义别名仍须确认上游参数能力。Responses用角色文本input、instructions、store:false；处理completed/incomplete/failed。Anthropic用顶层system、必需max_tokens（默认4096）、text/thinking delta与message_stop。Gemini保留配置路径，改为streamGenerateContent，分离thought并读取finishReason。

账户桥新增受限动作`anthropic.messages`，固定POST `/v1/messages`，原生注入固定版本头；保留目录归属、模型权限、源引用与取消。未修改账户服务端或系统令牌契约（仍为`system-token-v1`）。手动Claude原生使用既有header凭证路径；账户仍只传不透明引用。

## 字段与兼容

| 位置 | 新字段/默认语义 |
| --- | --- |
| ChatSession | 可选kind=text；缺失仍是旧创作会话。可选textChat仅文本会话使用。 |
| TextConversationState | version=1、messages、draft、systemPrompt、可选maxOutput；未填draft/systemPrompt为空，maxOutput缺失表示协议默认。未知版本/损坏结构保留数据并显示读取失败。 |
| TextMessage | id、role、content、reasoning、createdAt、status；可选model、replyTo、error、finishReason、usage。reasoning默认空；pending/streaming重启变为interrupted。 |
| DrawerState | 可选mode/textFocus/textActiveSessionId，默认text/true/null；旧activeSessionId继续属于创作会话。 |

文本会话元数据及全部消息在现有`aitu-chat/sessions`的同一记录中原子保存，无数据库版本变更、批量迁移或清空旧会话。既有备份携带嵌套原始session，round-trip测试覆盖全部新字段及旧会话。旧客户端主动修改新记录的向前兼容不作保证，降级前导出备份。

## 验证

- 宿主97文件/815项通过，`pnpm typecheck`通过。
- 创作最终全量142文件/2334项通过。
- 文本协议/路由/请求/运行时/Markdown/备份/更新保护：7文件/52项通过。
- Rust账户创作13项通过，包括合成loopback HTTP、取消、新增Messages目录/方法/路径限制；不等同真实供应商验证。
- renderer及独立macOS测试app构建通过。测试命令：`pnpm tauri build --debug --features isolated-profile --bundles app --config /tmp/tuzi-text-native.json`。未运行版本脚本。
- `tests/visual/text-chat-acceptance.cjs`使用实际构建产物、真实设置/画布/IndexedDB，只模拟原生HTTP边界并拦截所有外部请求。覆盖模型列表搜索选择、流式/推理/用量、草稿与历史重载、追问/重新生成、并发/停止、错误重试、画布插入、暗色与小窗口。
- 根tsconfig不包含上游，另用ES2022/bundler/现有aliases检查新UI及依赖；改动文件零错误，依赖链仍有7条位于本轮未改动文件的ArrayBufferLike/BlobPart错误，不将其记为上游整体严格类型检查通过。
- 原生测试app成功启动到主窗口（日志证据）；CUA的ScreenCaptureKit报-3811，未完成原生自动点击/剪贴板/重启GUI验收。

日志`/tmp/tuzi-text-*`，浏览器证据`/tmp/tuzi-text-chat-qa/`。全部模型返回为合成数据。来源补丁按固定桌面源`f36267808b131c416e6d6efebce3259692ee40f8`重建并逐字节验证1581文件（1522原始+59本地）。

## 状态及回退

真实供应商逐模型联调、Windows/Linux GUI、用户最终验收及发布未完成。原生强制退出的最后瞬间保存不作零丢失保证；`pagehide`只是尽力flush，周期保存/更新保护不等于完整退出握手。局部回退使用本次提交的`git revert`，不删除文本记录或用户资料。本轮不涉及跨仓发布顺序。

## 收尾验收

Chrome与WebKit各13组检查通过（26组合计），包含首次未发送草稿重载、配置模型搜索选择、并发停止归属、画布落位与暗色布局；无浏览器运行时异常。第一次Chrome草稿断言在存储恢复完成前读取了可见但禁用的输入框，截图证明随后已恢复正确内容；脚本改为等待实际恢复值后两浏览器通过，未将此瞬时加载状态误判为数据丢失。

Mac测试包位于 `/Users/sdy09/Documents/tuzi-switch-artifacts/text-chat-2026-11-08/`。通过 `启动文本对话测试版.command` 启动，设置独立 `CC_SWITCH_TEST_HOME`，使用自有profile及bundle id `com.tuziswitch.desktop.textchatqa`；不导入日常客户端凭证。包仍为1.5.7的本地开发构建，无更新发布。原生GUI捕获受阻记录保留。
