# Change: Adapt three GPT Image 2.6 routes and automatically refresh models after upgrades

## Why
Only gpt-image-2.6-1k currently has explicit request adaptation. Existing model catalogs do not automatically refresh when the assistant upgrades, leaving configured users dependent on manual discovery. Current public descriptions distinguish provider groups, so one blanket parameter policy is insufficient.

## Approval
On 2026-11-05 the user explicitly selected “A：基础接入”. Approved: the three exact model IDs, basic generation/edit and prompt GIF for the tested default/Codex routes, plus automatic incremental upgrade discovery. Official-group GIF/SVG options, markup and complexity controls are excluded. Host decision record: `docs/development/2026-11-05-model-upgrade-sync.md` (UC-MODEL-03).

## What Changes
- Register the exact flare, sunburst and 1k IDs with accurate image classification and scope-specific descriptions.
- Scope A uses basic generation/edit and prompt-GIF adaptation with clear default/Codex scope. Explicit unsupported GIF/SVG format requests fail with actionable guidance rather than silently downgrading.
- Refresh enabled configured sources in the background after a new host release or model-adaptation revision, without opening settings.
- Preserve user selections and manual bindings, enable genuinely new authorized models, and protect against stale requests and transient failure.
- Keep account authorization native and public metadata supplemental. Add compatible optional refresh state with defaults and durable success tracking.

## Impact
Affected spec: assistant-model-upgrade-sync. Affected code: host creative startup/bridge, creative build identity, model config/adapters and media handling, provider catalog/discovery/settings persistence, and related regressions/provenance. Existing performance commits are retained. No API service, account credential contract, production configuration, release version or download page change is proposed in this implementation phase.
