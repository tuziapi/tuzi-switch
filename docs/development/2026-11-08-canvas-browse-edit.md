# UC-CANVAS-MODE-01：画布浏览／编辑（2026-11-08）

> 后续反馈 UC-CANVAS-MODE-02：用户要求取消顶部额外按钮，保留平移改善。当前实现已移除按钮；下文保留为历史记录，最新结果见文末。

用户反馈鼠标拖动画布容易选中图片，明确批准方案 B：默认浏览，明确区分浏览／编辑。仅本地开发、验证、构建与提交；未推送、创建 PR 或发布。本轮模型调用 0 次。

## 实现

- 顶部增加浏览／编辑切换，与原有手形、选择工具及 H/V 快捷键同步。首次进入浏览，实际 board 指针与工具栏保持一致；浏览中拖动图片平移视口，编辑中可选择、移动图片和排版。
- 记住本机最后模式。新增 localStorage 字段 `tuzi-canvas-interaction-mode-v1`，值为 `browse` 或 `edit`；缺失、非法值、读取异常均回退浏览，写入异常不影响当前操作。无变化不重复写入。不进入画板、导出、同步或凭证配置，不改变服务端契约和数据库。
- 浏览器回归发现旧 Space 临时平移仍可能移动图片，补齐临时实际手形指针。松键、窗口失焦、输入框聚焦及卸载恢复之前工具；不覆盖主动选择的新工具，不更改记忆模式。输入框、按钮、对话框、预览和输入法输入保持隔离。
- 改动仅在助手集成构建启用。顶部样式由宿主加载，避免上游 `.creative-root` 样式作用域导致 portal 无样式。
- 复用现有平移逻辑，没有新增 pointermove 监听、逐帧 React 状态或拖动中的存储写入。本次针对误操作及交互可靠性，不代表所有设备或大画板零卡顿。

## 验证

| 层级 | 结果 |
| --- | --- |
| 偏好和临时平移单元 | 9 项通过：默认/非法/异常存储、重复写入、松键、失焦、输入隔离、主动切换、卸载 |
| 宿主 CreativeWorkspace | 2 项通过 |
| Chromium / WebKit | 各 9 项，共 18 项通过；合成图片验证真实视口与图像坐标、模式重载、H/V、Space、聊天输入隔离、700px 布局和深色截图 |
| 宿主类型检查 | `pnpm typecheck` 通过 |
| 创作目标类型检查 | 仍有既存 7 项 ArrayBufferLike/BlobPart 错误；本次新增文件没有报错，不能认定创作全量严格类型检查通过 |
| 构建 | 创作/宿主前端、macOS debug isolated-profile `.app` 构建通过 |
| OpenSpec / 来源 | 严格校验通过；源提交 f36267808b131c416e6d6efebce3259692ee40f8，1522 原始 + 68 本地文件，共 1590 文件重建通过 |
| macOS 原生 | 首次默认浏览、在图片上拖动平移、切换编辑并选择图片、正常退出后重启恢复编辑均通过；最终停在浏览模式 |

执行命令：

```sh
pnpm test:creative upstream/packages/drawnix/src/utils/canvas-interaction-mode.test.ts upstream/packages/drawnix/src/hooks/use-canvas-temporary-pan.test.tsx
pnpm exec vitest run tests/components/CreativeWorkspace.test.tsx
pnpm typecheck
PLAYWRIGHT_MODULE=/Users/sdy09/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright CANVAS_QA_BROWSER=chromium node tests/visual/canvas-interaction-mode.cjs
PLAYWRIGHT_MODULE=/Users/sdy09/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright CANVAS_QA_BROWSER=webkit node tests/visual/canvas-interaction-mode.cjs
PATH=/opt/homebrew/opt/rustup/bin:$PATH pnpm tauri build --debug --features isolated-profile --bundles app --config /tmp/tuzi-text-native.json
python3 scripts/refresh-creative-provenance.py --source-repo '/Users/sdy09/Documents/ChatGPT/opentu桌面版'
```

浏览器测试使用隔离 IndexedDB 合成图片、阻断外部网络，无模型请求；原生使用已有隔离验收配置，不点击发送或生成。未进行 Windows/Linux 原生验证或大画板帧率基准。用户最终手感验收待完成。此前模型真实验收的 DeepSeek 不可用和生图 HTTP 429 限制仍保留，见 [真实验收记录](2026-11-08-native-chat-acceptance.md)。

## 本地交付与回退

交付目录：`/Users/sdy09/Documents/tuzi-switch-artifacts/text-chat-2026-11-08/画布浏览编辑版/`。使用 `启动新版测试.command` 启动以保留隔离配置；测试应用已打开。证据 JSON 见 [验证数据](evidence/2026-11-08-canvas-browse-edit.json)，原生截图位于交付目录的 `验收截图/`。

基础提交：`502d492e950239f5e048a18665dd4f17e1d73760`；最终提交记录于交付目录 `BUILD-INFO.json` 的 `sourceCommit`。二进制 SHA256：`874f9638a43099ecc9cf0eca18354fab0612e72579b614e066b2121b16cb3ed9`。Bundle ID：`com.tuziswitch.desktop.textchatqa`。

回退本地提交即可恢复旧交互；新增偏好字段可保留，旧代码不读取，不需迁移用户画板。

## UC-CANVAS-MODE-02：取消额外按钮

用户查看 Release 实机后明确要求“不需要这些，保证滑动没有问题就好了”，覆盖先前顶部浏览／编辑按钮要求。移除宿主入口、按钮 portal 和独立 CSS，后台仅保留工具偏好同步及 Space 临时平移。首次默认手形，左侧已有工具和 H/V 继续使用，偏好字段格式不变。未增加逐帧操作或模型调用。

9 项偏好/临时平移测试、2 项宿主测试、宿主类型检查通过。Chromium/WebKit 各 10 项（共 20 项）通过：顶部无额外按钮、直接拖图片平移且世界坐标不变、竖向滚轮及双轴触控板式滚动事件、原有编辑、重载、快捷键、Space 和输入隔离。触控板项目为模拟滚动事件，不等同真实硬件实测；未做大画板帧率基准。证据见 [简化验证数据](evidence/2026-11-08-canvas-simple-pan.json)。

本机 Release 构建与原生复验结果记录在交付目录 `本机体验版-简洁画布/BUILD-INFO.json`，仅本地，未发布。

最终 Release 构建通过，macOS 实机已确认顶部额外按钮消失、手形工具恢复、直接拖动图片区域平移及上下滚动正常。新包已打开；二进制 SHA256 为 `a0a7c6ebec1a650abeb18e43b8f352eb5a185e3f06ed69284c955f7ad73dc5c5`。
