# Change: Embed opentu in the existing assistant shell

## Why
The user approved design UC-D02 v0.2 and explicitly authorized local implementation and a runnable preview on 2026-11-01. One client must preserve the existing assistant navigation while providing real opentu editing.

## What Changes
- Add one creative navigation entry without changing tool AppIds.
- Extract a locally bundled React library from pinned opentu source; no second root, updater, remote page or separate application.
- First slice: projects, real canvas/workflow, IndexedDB persistence, scoped styling, local browser preview.
- Native media, credentials, background generation and legacy import remain later acceptance gates; do not advertise them as complete.

## Impact
- Affected specs: assistant-creative-workspace
- Affected code: assistant shell, packages/creative-workspace, build configuration.
- Canonical design: ../../../../../docs/development/opentu-unified-client-design.md (relative from package root use ../../docs/development/).
- Approval: current user confirmation; this records the already-approved design and does not require duplicate approval.

## Superseding scope
On 2026-11-01 the user explicitly removed the standalone workflow workspace. The current scope is governed by `remove-assistant-workflow`; historical workflow implementation checks below are not current delivery requirements.
