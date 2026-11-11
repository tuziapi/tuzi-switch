# Change: Cross-media discussion orchestration

## Why
The user approved cross-media discussion on 2026-11-10 and explicitly chose text results remaining in discussion until manually placed on the canvas. The current discussion forces Agent mode and cannot preview batches.

## What Changes
- Discussion opens independently of the image/video/audio/text execution selection.
- A configured text model plans and streams provider-returned reasoning; execution uses application-pinned routes.
- Persist bounded plans for explicit preview, execute or cancel; no media dispatch before confirmation.
- Images, video and audio return to their original board. Text results stay in discussion until explicitly inserted.

## Impact
- Extends agent-discussion, text-chat runtime/storage, composer and existing queue tools.
- Local implementation, synthetic validation and macOS build only. No paid calls or publishing.
