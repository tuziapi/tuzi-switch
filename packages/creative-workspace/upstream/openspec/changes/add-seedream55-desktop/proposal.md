# Change: Complete approved Seedream 5.5 desktop support

## Why
The user explicitly approved generation, transparent backgrounds, layers and OCR on 2026-11-15. Generic model discovery currently drops controls and layer metadata.

## What Changes
- Add the exact model, model-specific validation and generation controls.
- Add an explicit Seedream 5.5 layer/OCR dialog on the image toolbar; preserve the existing local decomposition action.
- Preserve optional OCR, background and unknown response metadata through canvas persistence/export; reject partial and over-limit responses.

## Impact
Primary contract: API commit 28443ae853a24165b23638a8b98d3ad96ddba4f0, docs/2026-11-11-seedream55.md and shared native fixtures. No database migration, automatic paid fallback or production request. The user-approved scope authorizes implementation; release still requires separate real acceptance.
