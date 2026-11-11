# Change: Agent 讨论与贴合输入框的状态条

## Why
用户已于 2026-11-09 确认协同方案及紧凑贴合思考条，并授权开始本地实现。主输入框与侧边讨论需要共用会话、模型配置和生成结果。

## What Changes
- 30px 单行状态条作为主输入框内部顶栏；点击打开侧边讨论，取消圆球实现。
- 讨论共用文本会话存储、附件和流式协议，复用 Agent 执行器与现有图片/视频工具。
- 使用可选的会话画板绑定、运行及任务引用，旧会话仍为普通文本会话。
- 工具只在完整响应完成后执行；批量有界，结果由现有队列落画布；切板不误插。

## Impact
- Affected specs: agent-discussion (new).
- Affected code: text-chat, agent-executor, AIInputBar, ChatDrawer, queue-utils, useAutoInsertToCanvas.
- 本地实现、合成测试和构建；不调用付费模型，不发布。

## Approved revision: UC-AGENT-CHAT-05 (2026-11-09)

The user selected prototype 3: discussion attached above the main canvas composer, and explicitly removed the bottom Discussion button. The existing narrow status strip toggles this view. There is no canvas-wide backdrop or sidebar resize. The main input continues the same board-linked Agent session. Reuse the existing transcript, history, persistence and generation pipeline; compact result cards collapse the transcript on successful canvas location. A taller reading mode remains within the canvas viewport. Standalone text chat and its independent attachment draft remain separate. No paid calls or external publishing for this UI revision.

## Approved large discussion dialog revision: UC-DISCUSS-UI-03 (2026-11-10)

The user requests a larger popup from the existing expand button. The default 30px strip and compact attached view remain. Expanding moves the same transcript and main composer into a centered responsive dialog; shrinking restores the attached view, while closing returns to the strip. Reuse configured text/Codex backend, media settings, drafts, runtime and queue. No new paid inference or external release. This explicitly supersedes the earlier restriction against a canvas-wide overlay only while expanded.
