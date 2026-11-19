# ChatGPT Desktop → OpenTu 本地桥接

## 状态

2026-11-17：UC-CHATGPT-MCP-02，本地配对与独立安装验收通过。用户已确认目标客户端有 STDIO / 流式 HTTP 配置入口，并选择独立安装 OpenTu 验收版、保留现有兔子助手。真实目标客户端联调、付费模型生成和发布尚未完成。

## 架构

兔子助手启动时在 `127.0.0.1` 随机端口监听 `/mcp`。服务使用每次启动重新生成的 256 位 bearer token；供应商 API Key 只留在 OpenTu 的现有配置和执行链中，不通过 MCP 返回。

ChatGPT 通过 MCP 调用 OpenTu，OpenTu 再通过 Tauri 事件把请求交给现有前端 MCP 注册中心和当前画布。生成任务复用 `generate_image`、`generate_video`、`generate_audio`，画布插入复用 `insert_to_canvas`，画布读取和编辑复用现有快照、版本校验和可撤销编辑逻辑。

## 工具

- `opentu_list_models`：按媒体类型返回已配置可选模型的 ID、标签和 modelRef（供应商来源），不展开供应商配置、不返回密钥。
- `opentu_get_canvas`：返回当前画板元素、位置、文字、选中和可编辑状态。
- `opentu_get_task`：查询异步创作任务状态、进度和结果。
- `opentu_create_image`、`opentu_create_video`、`opentu_create_audio`、`opentu_create_text`：加入 OpenTu 现有任务队列，可选完成后插入当前画板。
- `opentu_insert_to_canvas`：插入已有文本或媒体结果。
- `opentu_apply_canvas_edit`：执行带版本校验的可撤销编辑；删除和替换既须 `confirmed=true`，又须在兔子助手原生对话框中由人确认。确认后重新检查请求期限和画布版本。

生成参数使用白名单；显式模型必须在对应类型的可选模型中唯一匹配，同名多来源使用 modelRef。生成默认不入画布，仅显式 insertToCanvas=true 才自动插入。HTTP 请求总期限为 120 秒，迟到确认不能继续编辑。

## 配对

设置 → OpenTu 接入：显示名称、流式 HTTP 类型和本次运行的真实 endpoint，提供复制地址、复制配对令牌、复制 Authorization 值及检查连接。中、英、日文完整。

`opentu_mcp_pairing` 只返回 endpoint、protocolVersion、canvasReady，不返回秘密。`opentu_mcp_copy` 在原生层复制指定字段到系统剪贴板，不把令牌送回前端、日志或项目文件。Token 输入框粘贴裸令牌；自定义请求头填 Authorization，值为复制的 Bearer 前缀内容。每次重启后必须重新配对。

`opentu_mcp_check` 对本机真实 HTTP 服务验证未认证请求 401、initialize 和 tools/list。页面明确标记这仅是本地检查，不代表 ChatGPT 已连接。前端监听准备完成后上报 ready；未准备时 tools/call 立即提示打开 OpenTu。HTTP 限制 Host 和 Origin，拒绝重复 Authorization、错误令牌及未知协议头；支持 ping 和空 202 通知确认。

ChatGPT 的连接能力受账户类型和客户端入口限制。普通 localhost 地址不能直接当成公网远程 MCP 使用；桌面插件或 Secure MCP Tunnel 的具体配置需按当前 ChatGPT 账户可用入口完成。未完成该入口的真实连接验收前，不宣称 ChatGPT Desktop 已经可用。

## 验证边界

- 修复前基线：全量创作 2823 tests、typecheck、cargo check、2 个原生定向测试通过。
- 修复后：全量创作 178 文件 / 2836 tests 通过；最终定向桥接与画布 25 tests 通过；设置和配对页 12 tests 通过；typecheck 通过；原生定向 7 tests 通过（3 个真实 loopback HTTP 测试，使用合成令牌）。
- 负向认证测试曾暴露重复 Authorization 请求仍被接受，已修复为只允许单个认证头并复验通过。
- 早期本地构建缺正式 updater 私钥，且默认 bundle 签名完整性失败；其后使用 APPLE_SIGNING_IDENTITY=- 并关闭 updater 产物的普通本地包构建、codesign --verify --deep --strict、hdiutil verify 通过。该包没有安装，不是正式签名候选。
- 独立版使用 opentu-preview Cargo feature、独立 bundle ID、URL scheme 和账户/配置/图片/视频目录，不启用调试供应商凭证，关闭 updater endpoints。现有安装来自含 Claude 功能的另一个分支，且该目录仍有未提交修改，禁止用本分支直接覆盖。
- 独立版首次构建和安装通过，原生配对页真实地址、复制和本地 HTTP 检查通过。实际客户端脚本发现上游 __TUZI_CREATIVE_NATIVE__ 标记在宿主未设置，事件监听未启动；已改为宿主 __TAURI_INTERNALS__ 检测，并将原有项目页配对弹窗同步到不返回秘密的 IPC。此修复后 27 项定向测试和 typecheck 通过，重新打包、安装、codesign 完整性和 DMG 校验通过。
- 最终本机真实 HTTP → Tauri → 已安装 WebView → 画布：initialize、空 202 通知、ping、9 个工具发现、模型列表（隔离配置为 0）、画布快照、插入合成文字、移动、过期 revision 拒绝且不修改、原生键盘撤销恢复精确 revision 均通过。首次撤销因窗口捕获异常未确认成功，恢复画布焦点后专项复验通过。
- 冷重启后旧端口关闭、新地址可配对，合成文字保留；UI 与 HTTP 分别确认。退出/重启仅针对 OpenTu 验收版，现有兔子助手仍保留。安装二进制与最终构建逐字节摘要一致。脱敏报告见 [native-acceptance-2026-11-17.json](attachments/opentu-mcp/native-acceptance-2026-11-17.json)。
- 目标 ChatGPT 应用被电脑控制工具按内部标识拒绝操作，不能绕过；目标客户端的配置和工具调用需要用户配合。尚未用该客户端发起真实工具调用，也没有此次桥接的真实模型付费验收。

## 独立验收构建

`APPLE_SIGNING_IDENTITY=- pnpm tauri build --features opentu-preview --bundles app,dmg --config src-tauri/tauri.opentu-preview.conf.json`

名称 OpenTu 验收版；标识 com.tuziswitch.desktop.opentu-preview；数据目录在对应的 Application Support 子目录内。版本仍为 1.6.2，只供本机验收。ad-hoc bundle 签名不是正式 updater 密钥签名，也不代表 Apple 公证通过。

安装位置 `/Applications/OpenTu 验收版.app`；DMG 位于 `src-tauri/target/release/bundle/dmg/OpenTu 验收版_1.6.2_aarch64.dmg`，SHA-256 `4bd29bd64506a7c88cef230c59c59667d986bc7fa97054113cee7b9e5b99fc3a`。本地曾因剩余空间不足，定向清理本工作树生成的 Rust debug 增量及对象缓存，未清理用户文件、源码或安装包。

下一步：在目标客户端配置流式 HTTP 地址及 Bearer 认证，验收列出模型和读取画布；独立配置目前没有模型账户，真实创作前须配置授权测试来源。当前工具无法操作目标客户端，需用户手动完成客户端字段填写。没有用脚本模拟的客户端替代 ChatGPT 验收，没有推送、PR 或发布。
