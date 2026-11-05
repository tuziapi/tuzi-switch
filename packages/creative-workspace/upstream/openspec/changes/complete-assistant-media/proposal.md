# Change: Complete account-backed media in the unified client

## Why
The user reported MiniMax-H3 rejection, invisible video placeholders, image loading artifacts and inconsistent task status. Existing image-only acceptance missed these paths.

## Scope and approval
2026-11-04 the user explicitly chose B: complete account integration for existing video/music capabilities and comprehensively validate them. Preserve manual providers and existing key/account checks. This approval covers local implementation and verification. Do not treat historical publication as blanket authorization for a new release.

## What Changes
- Share a finite media action manifest between renderer and Rust, including MiniMax, Kling, Seedance and existing Suno legacy/v2/native operations.
- Resolve implicit Suno permission models from audited server routes; never copy managed secrets to frontend configuration.
- Repair native task card painting and make native image state use the existing readiness controller.
- Verify images, video, audio and text with explicit distinction between synthetic transport and live provider acceptance.

## Impact
Host account bridge/native request validation, embedded task presentation and regression fixtures. No database or binding-file schema migration. Canonical record: host docs/development/2026-11-04-media-acceptance.md.
