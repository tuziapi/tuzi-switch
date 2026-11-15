# Change: Sync approved creative features into the current assistant

## Why
The user requested the new features implemented in thread 01a194e2-0921-7232-8faa-3d2d42d45aaf. That thread used the earlier assistant snapshot and lacks this workspace's subsequent image actions.

## Scope and approval
The 2026-11-04 user request authorizes integrating that implementation. Apply the delta from common assistant 3f610e60 to incoming 5148d469 on current 501af92c. Retain current host/native behavior and excluded standalone workflow. No publication or paid calls.

## What Changes
- Bring in batch import/export, mask/image tools, history filters, authenticated model discovery, Suno support and persistence fixes.
- Preserve native image context menu, original export, account/manual bridges and rendering fixes.
- Add isolated creative tests and regenerate provenance.

## Impact
Embedded creative sources, test configuration and documentation. No account contract, required database columns, native capability expansion or release identity changes. Canonical record: docs/development/2026-11-04-creative-feature-sync.md in the host repository.
