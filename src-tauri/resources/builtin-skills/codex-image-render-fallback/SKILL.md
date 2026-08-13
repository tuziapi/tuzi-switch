---
name: codex-image-render-fallback
description: Safely publish PNG, JPEG, or WebP files from Codex built-in imagegen savedPath items or legacy image_generation_call Base64 results, with local Markdown previews and download links. Use after image generation or editing, when Codex Desktop shows a blank or missing image, or when a generated image must be verified and delivered from the current Codex session.
---

# Codex Image Render Fallback

Publish a validated local image artifact when the native Codex image card is unavailable. Treat this as a delivery fallback, not a repair of the native renderer.

## Publish Images

1. Prefer each `savedPath` returned by built-in imagegen. Run:

```bash
SKILL_DIR="<absolute directory containing this selected SKILL.md>"
python3 "$SKILL_DIR/scripts/extract_images.py" \
  --saved-path "/absolute/path/from/savedPath" \
  --output-dir "$PWD/outputs/codex-images"
```

2. Use the current session JSONL only when no usable `savedPath` is available:

```bash
SKILL_DIR="<absolute directory containing this selected SKILL.md>"
python3 "$SKILL_DIR/scripts/extract_images.py" \
  --output-dir "$PWD/outputs/codex-images" \
  --call-id "ig_..."
```

Use the actual absolute location reported for the selected skill; do not derive `SKILL_DIR` from `CODEX_HOME`. The script resolves the exact `CODEX_THREAD_ID` under the Codex home containing this installed skill, then `archived_sessions`. Pass `--session "/absolute/session.jsonl"` only when recovering a different known session. Repeat `--saved-path` or `--call-id` for multiple images.

3. Read the JSON summary from stdout. Return each `markdown` value exactly so Codex Desktop receives both an inline local preview and a local download link.

## Safety Rules

- Never print, paste, log, or return a Base64 image result.
- Never use an ad hoc shell Base64 pipeline. Use the bundled script so bytes, dimensions, pixel count, and format are bounded and verified.
- Keep the default limits unless a known image requires a narrow increase.
- Write outside Codex session directories. Do not edit source files or session JSONL.
- Do not scan the newest or unrelated session when exact thread resolution fails.
- Report structured extraction errors without exposing image payloads.

The script reads JSONL one bounded line at a time, prefers `savedPath` within session events, decodes legacy Base64 in chunks only as a fallback, accepts PNG/JPEG/WebP, and publishes with an atomic same-directory rename.
