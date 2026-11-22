## Context

The Rabbit account system token authenticates the account-management service. A Rabbit model Key is a separate credential used by Codex, Claude, OpenTu, and other model routes. The existing OpenTu binding already stores an opaque `tuzi-account:<bindingId>` reference and resolves the Key natively at request time. The desktop provider transaction currently requires a revealed Key in the submitted provider payload, even though it already accepts a source identity and records `tuzi_provider_sources`.

## Goals

- Make account Key selection available from the normal tool configuration flow.
- Make the first OpenTu creative send discoverable and short when a connected account already has a usable Key.
- Keep manual provider configuration and existing settings routes intact.
- Keep secrets out of renderer state wherever the native transaction can resolve them.

## Non-goals

- Do not use the Rabbit system token as a model API Key.
- Do not build a local proxy or change the external Codex/Claude request protocol.
- Do not auto-rotate, delete, or rewrite an existing tool configuration after account disconnect or Key revocation.
- Do not auto-submit a previously blocked generation after the user closes or cancels the quick picker.

## Decisions

1. **Masked list, explicit selection.** The renderer receives only Key metadata already exposed by the account list endpoint: id, name, mask, group, status, expiry, quota and model-limit metadata where available. Disabled, expired, exhausted, and stale-account entries are not selectable.
2. **Transient source reference.** The form carries a non-persisted account source containing origin, user id, token id and generation. The native save path resolves and validates the model Key before the existing provider write set is committed. Existing `tuzi_provider_sources` remains the durable source association.
3. **Explicit change for existing providers.** Editing an account-backed provider shows its current source and requires a deliberate “更换账户 Key” action before selecting another Key. Manual mode remains available.
4. **Creative quick setup reuses the account bridge.** The quick dialog calls `listKeys` and `bindKey`, then updates the existing OpenTu provider profile and invocation route. It requests model discovery through the existing managed transport and only closes/continues after the selected model is eligible.
5. **Fallback behavior.** The existing full settings dialog remains the fallback for disconnected accounts, no usable Keys, manual setup, cancellation, and errors. The pending task is retained only while the quick dialog is open; it is never silently replayed after a cancel.

## Data and security boundaries

- No new persistent plaintext credential field.
- No system token in provider settings, creative settings, exports, analytics, logs, or screenshots.
- No raw model Key in the OpenTu quick picker UI. Existing native account binding remains the request-time secret boundary.
- Generation and identity are checked on every bind/save; stale operations fail without writing files or changing the selected route.

## Verification

- Provider-form tests: connected account list, masked selection, manual fallback, stale generation, unavailable Key, edit-time explicit replacement.
- Native tests: source-only save qualification, native Key resolution, atomic write/rollback, source association, no secret in renderer-facing DTOs, account disconnect/revocation rejection.
- OpenTu tests: first image send opens quick picker for connected account, model discovery and route selection, cancel/failure falls back without replay, disconnected/no-Key path opens full settings, pending generation resumes only after successful explicit completion.
- Run type checks, targeted frontend tests, creative workspace tests, native provider/account tests, `git diff --check`, and a local debug build. Use synthetic credentials only.
