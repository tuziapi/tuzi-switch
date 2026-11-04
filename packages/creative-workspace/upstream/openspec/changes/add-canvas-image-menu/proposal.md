# Change: Canvas image context menu

## Why
In the unified desktop, image right-click currently exposes the WebView menu. Cached originals have no user-visible file location.

## What Changes
- Provide copy image, save as, show file, preview and copy prompt on canvas images.
- User approved option B on 2026-11-04: automatically export an original copy under Pictures/兔子助手 before revealing it. Reuse identical copies, recreate deleted copies, preserve edited copies.
- Route single-image downloads through the same explicit native save boundary.

## Impact
- Canvas menu, host bridge, native clipboard/file dialogs and file manager. No account contract, generation request or database schema changes.
- Canonical implementation/verification record: host docs/development/2026-11-04-image-context-menu.md.
- Approved locally; no publication in this task.
