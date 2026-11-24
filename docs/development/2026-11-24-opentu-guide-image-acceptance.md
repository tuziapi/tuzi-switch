# UC-OPENTU-GUIDE-1124：简明教程与真实生图入画布

用户要求为连接面板增加简单教程，并真实验证外部调用生成图片后能否显示到画布。基线 `codex/ecommerce-desktop-integration` / `edc72a25`，授权本地实现、真实生成、安装测试及本地提交；不推送或发布。

## 教程

项目连接面板和设置页共用三步说明：连接本机客户端、配置模型并打开画布、复制指令并确认客户端工具请求。提供读取画布和单张生图入画布两条示例，各有复制按钮；说明费用、复制不执行生成，以及未加载工具/未打开画布/查询已有任务的处理方式。

教程通过独立 `@tuzi/creative-workspace/connection-guide` 和 CSS 子路径复用，避免为了设置页教程提前加载整个画布引擎。支持中、英、日文，窄窗对话框可滚动。可选 `language` 仅控制显示，默认中文，不新增持久配置、接口契约或数据库字段。继续使用已有原生剪贴板命令；不改变原生连接权限、模型配置或 `insertToCanvas` 默认 false 的兼容行为。

`openai-docs` 技能用于核查客户端说明；本轮官方文档工具未返回可引用内容。因此未新增未经核实的客户端按钮名称或自动刷新承诺，教程提示首次连接后重新打开客户端并确认工具可用。当前会话工具清单仍无 `tuzi-opentu`，目标桌面客户端受电脑控制限制，不宣称已完成客户端内置 MCP 调用验收。

## 真实生图证据

- 用实际已安装应用的 stdio 连接器，经 `opentu_list_models` 选择现有唯一 `gpt-image-2.5` 来源，模型凭证仍由应用自身管理。未读取或输出 Key，未发送私有参考素材。
- 北京时间 2026-11-24 10:48:49，调用 `opentu_create_image`，明确 `insertToCanvas=true`、尺寸 `1x1`。任务 `f196a867-0dd7-4903-b09e-f3bb6eb51139`，仅提交一次，没有自动重试。
- 10:49:34 查询到 completed；原生图片详情显示完成时间 10:49:36、模型 gpt-image-2.5、实际像素 1254×1254。生成的是奶白色陶瓷兔子台灯、木桌和绿色背景，单图、无文字水印；已放大目视检查。
- 完成状态后仍需下载图片及插入画布。首版脚本等待 1.5 秒时仍读到 20 个元素，后续原生界面及 MCP 均确认自动新增，最终 21 个元素，新增图片 ID `dMHSm`。此前的过早检查不是自动插入失败；已修正验收脚本，必须等到实际图片出现才能通过，最长等 60 秒，超时不重提生成。
- 导出通过原生保存窗口完成，文件 `/Users/sdy09/Documents/tuzi-switch-artifacts/opentu-guide-image-20261124/opentu-mcp-rabbit-lamp.png`，`sips` 读取 1254×1254，SHA-256 `24515715ab65edfacc3c0877920baec6891c07d926583fcb2ce3b3f775d45167`。
- 验收脚本 `scripts/qa/opentu-connector-image.mjs` 默认 `--inspect` 只读，`--generate <profileId>` 才会单次付费生成；`--verify <taskId> <elementId>` 只查询已有任务和已知画布图片，防止把其他同提示词图片误判为恢复成功。输出不含媒体 URL、Key 或其他画布内容。

## 验证与交付

12 项定向测试通过（教程四项、原连接面板七项、IPC 一项），覆盖复制不会触发生成、复制失败脱敏与英文/日文；`pnpm typecheck` 通过。日志 `/tmp/tuzi-opentu-guide-tests-final.log`、`/tmp/tuzi-opentu-guide-types-final.log`。

`pnpm build:local` 最终成功（日志 `/tmp/tuzi-opentu-guide-build-final.log`），已更新 `/Applications/Tuzi Assistant Test.app`。首次打包遇到 Tauri 生成资源缓存缺失，清理该包可重建的 release 产物后重建，保留所有应用和用户数据。生成/插入业务未修改。

- 新包设置页 OpenTu 接入与创作项目连接弹窗均显示完整教程；原生复制成功，并在空项目搜索框粘贴核对生图指令全文，之后清空搜索，没有额外生成。帮助折叠可展开、弹窗底部按钮可用，完成目视布局检查。
- 北京时间 11:09:53，新包冷启动后在原测试画板运行 `--verify f196a867-0dd7-4903-b09e-f3bb6eb51139 dMHSm`：任务 completed、21 个元素、已知图片 dMHSm 保留。随后双击画布图片，原生预览实际显示兔子台灯及 1254×1254 尺寸；详情仍保留模型、提示词及生成时间。此步骤只读，不新增付费调用。
- 源 app 和已安装 app 可执行文件一致，`codesign --verify --deep --strict` 通过。可执行文件 SHA-256：`b262303b7b10c00a6b501af851fbc4c792671511719b8c914254be836eab153d`。
- DMG 经 `hdiutil verify` 通过，交付文件 `/Users/sdy09/Documents/tuzi-switch-artifacts/opentu-guide-image-20261124/Tuzi-Assistant-Test-1.6.3-opentu-guide-arm64.dmg`，SHA-256：`588480cdae9034b4a0550839edc1a8d1ca9bfe120c62c46d916c7f933c388518`。这是 Mac ARM 独立本地测试包，未做正式公证或更新发布。
- 上一版应用可从 `/Users/sdy09/.Trash/Tuzi Assistant Test-before-guide-20261124.app` 恢复。本轮未修改实际 Codex 配置；其 SHA-256 仍为 `ff89437d46bd8de98b36fc6e058addec3ebb90d1f55ddb91479bc673deca78b9`。

仍以 [原发布门禁](2026-11-23-ecommerce-release-gates.md) 为准：本轮不能替代视频效果、其他专用处理、跨平台或正式升级验收。没有 push/PR/发布。
