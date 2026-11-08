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

## UC-TEXT-02：截图反馈修正

2026-11-08，用户要求修正模型菜单、优化会话列表并支持一键收起，在画布顶部右侧增加对话按钮；进一步确认模型问题为“菜单离按钮太远”。范围是现有文本工作区的本地界面修正，不改变模型配置、接口或凭证。

- 根因：创作宿主 `contain: layout paint` 建立局部 fixed 定位坐标系，ModelSelector 却直接使用窗口坐标。改为使用创作容器坐标与可用空间，限制菜单宽高、左右溢出和上下摆放；内部供应商/模型列独立滚动。Esc 优先关闭模型菜单，避免画布仍拥有焦点时误关闭整个对话面板。
- 会话侧栏由真实开关状态控制，修复专注布局 CSS 强制显示导致的一键收起失效。宽屏内联、并排/窄屏浮层；浮层打开聚焦搜索，支持关闭按钮、点击遮罩及 Esc。专注模式切换会话保持列表可见。
- 会话列表增加数量、今天/昨天/近7天/更早分组、草稿或最近回复摘要、选中高亮；重命名/删除在悬停或键盘聚焦时出现，触摸设备常显。沿用现有搜索、重命名和删除确认流程。
- 宿主导航栏右侧提供“对话”按钮，通过 React portal 复用实际抽屉的同一开关和展开状态；文本/创作模式均可收起、恢复，原侧边把手继续可用。
- 无新增持久化字段或数据库变更；分组/摘要由现有数据派生，侧栏开关为页面内 UI 状态。旧会话、模型引用、备份格式维持原兼容语义。

验证：Chrome/WebKit 各16组（共32组）通过，使用实际编译页面及合成HTTP；新增定位几何断言、700×600模型菜单/侧栏浮层、两布局顶部开关、长列表滚动、会话重命名/搜索回归。原有草稿恢复、流式、并发停止、画布与暗色回归通过。宿主导航2项和根类型检查通过；上游UI入口改动文件无错误，原有依赖7条类型错误仍保留。renderer及独立macOS包构建通过；来源1581文件重建逐字节一致；OpenSpec严格校验通过。可读源文件diff检查通过，生成来源补丁中的空上下文行按patch格式保留。

`docs/development/evidence/2026-11-08-text-chat-polish.json`保存本轮验收结果。交付包与32组浏览器截图位于原交付目录的`界面优化版/`，通过`启动界面优化测试版.command`启动，继续使用同一隔离profile；需先退出旧测试版再启动新版。原包保留，未覆盖运行中的应用。CUA已打开新版浏览器菜单并核对其紧贴模型按钮，浏览器预览已保留。真实供应商及原生 GUI 的既有限制继续保留；无推送或发布。


## UC-TEXT-03：桌面长会话性能

2026-11-08，用户明确要求本地桌面版避免大量卡顿。本轮基线 `c9b7039cf4b8cd4584195305a78ee5d3e25323ba`，继续在 `codex/opentu-text-chat` 本地开发、合成验证和隔离构建。具体选择与代价见 [ADR-020](decisions/0020-text-chat-rendering.md)。

### 实现及兼容

- 超过 60 条消息复用已有虚拟列表依赖，只挂载视口及前后各 4 条附近消息。历史、请求上下文和本地保存仍完整；短会话继续原布局。无新依赖或数据库字段。
- 会话侧栏行 memo，收起侧栏不挂载列表；收起聊天后暂停 UI 订阅并卸载消息 DOM，后台请求与保存继续。组件可选 `visible` 参数默认 true。
- 保存成功且没有错误变化时不重复通知界面，保存失败及恢复仍通知；保留 40ms 显示、700ms 保存、发送前保存和最后落盘。
- 新建会话在首次持久化完成前锁定重复新建与输入，避免快速输入落到旧草稿。
- WebKit 回归发现虚拟列表 scrollToIndex 的延迟重试可能覆盖用户上翻，改用立即定位与高度观察器跟随；两浏览器复测上翻、返回最新和换布局通过。

### 测量

`tests/visual/text-chat-performance.cjs` 在实际编译页面建立一次性浏览器资料，使用真实 IndexedDB、300 个合成历史会话（另有设置时自动建立的 1 个空白会话）、当前 800 条含代码/公式的消息、160 个间隔 20ms 的合成流片段；外部请求全部拦截。串行执行，不同时运行构建或其他浏览器测试。机器 Apple M4 / macOS 26.5.2，1360×900 headless 浏览器。测量是页面重载后打开聊天区，不是整个桌面应用的冷启动。基线、最终普通 CPU Chrome、最终 WebKit 和 Chrome 4 倍 CPU 限速各取一次主样本；后续补充跟随定位断言的回归样本单独保留，不挑选最佳值。

| 指标 | Chrome 基线 | Chrome 优化后 | WebKit 优化后 | Chrome 4 倍限速（仅优化后） |
| --- | ---: | ---: | ---: | ---: |
| 打开长会话至末尾消息挂载 | 305.1ms | 218.2ms | 346ms | 509.1ms |
| 打开后聊天区 DOM 节点 | 35,710 | 6,415 | 6,415 | 6,415 |
| 当前挂载的助手回复 | 400 | 4 | 4 | 4 |
| 输入到下一帧 p95 | 16.1ms | 15.1ms | 19ms | 14.2ms |
| 流式阶段帧间隔 p95 | 33.3ms | 16.8ms | 24ms | 16.8ms |
| 流式阶段最大帧间隔 | 333.4ms | 16.8ms | 43ms | 50ms |
| 流式阶段 >50ms 帧数 | 10 | 0 | 0 | 0 |
| 连续滚动最大帧间隔 | 33.3ms | 16.8ms | 22ms | 33.4ms |

节点减少约 82%；这一收益来自少渲染历史消息。WebKit 无 Long Tasks API，记录中的 longTasks=0 不代表没有长任务；帧间隔单独测量。输入阶段的帧统计包含打开窗口，输入延迟来自 input 到下一个 rAF；它不是操作系统输入到屏幕显示的完整延迟。IndexedDB put 仅测同步调用耗时，不代表事务总耗时。JS heap 受 GC/浏览器缓存影响，不据此宣称内存降低比例。

首次打开仍有主线程工作：WebKit 主样本最大帧间隔 136ms，4 倍限速 Chrome 为 249.9ms；CPU 限速不是实际低端硬件验证。单条极长 Markdown、超大总历史、真实模型网络、原生 WebView 与其他设备仍未做性能承诺。虚拟化后视口外内容不在 DOM，浏览器全文查找/跨越多条的原生选区有范围限制，逐条复制和全部本地历史保留。

### 验证与交付

- 长会话专项覆盖有界 DOM、最早消息可访问、上翻不抢位置、返回最新、并排/专注动态高度、收起期间后台完整保存、重载后 804 条消息完整恢复；无浏览器运行时异常。
- 原有 Chrome/WebKit 各 16 组，共 32 组回归通过。运行时 13 项通过，新增成功保存不发 UI 通知、失败与恢复仍通知检查。
- 根类型检查通过；上游 UI 入口改动文件无错误，原有依赖链 7 条 ArrayBufferLike/BlobPart 错误仍在，不记整体严格类型检查通过。
- renderer 与新的 macOS 隔离包构建通过；来源 1581 文件逐字节重建一致，OpenSpec 严格校验通过。两浏览器补充“持续流式自动跟随末尾”断言通过；主样本与补充样本分别保存在 `evidence/2026-11-08-text-chat-performance.json`。未进行真实供应商调用、原生 GUI 性能验收或发布；原生 GUI 的既有 ScreenCaptureKit -3811 限制保留。

交付位置为原测试目录下 `性能优化版/`，双击 `启动性能优化测试版.command`；先退出旧测试版，新旧包共用同一隔离 profile。旧包保留，未替换运行中的应用。BUILD-INFO 保存二进制 SHA-256、源码提交及所有主/补充样本；构建通过不记为原生 GUI 性能验收。
