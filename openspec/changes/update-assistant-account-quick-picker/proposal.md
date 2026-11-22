# Change: Add account Key quick selection before creative generation

## Why

The desktop already supports native Rabbit account bindings in OpenTu settings, but the first image generation attempt still opens the full settings window when no usable route is configured. When the Rabbit account is connected and has an available Key, the user should be able to choose that Key in a focused dialog, fetch its eligible models, and continue configuring the creative route without copying a secret or navigating the full settings page.

The desktop provider forms also need the same account-originated selection flow for Codex, Claude, and other supported Rabbit routes while preserving manual credentials.

## What Changes

- Add a masked Rabbit account Key picker to supported desktop provider creation/edit forms.
- Keep manual API Key entry available and independent.
- Submit account selections as a transient native source reference; the native save transaction revalidates account generation, identity, Key status, model eligibility, and endpoint before writing the target tool configuration.
- Reuse the existing `tuzi_provider_sources` source association and backup/rollback transaction. Do not add plaintext Keys or system tokens to ordinary provider settings, exports, logs, or analytics.
- Add an OpenTu quick setup dialog for the first creative generation when the Rabbit account is connected and has usable Keys. The dialog selects a masked Key, binds it natively, retrieves eligible models, selects the requested media route, and resumes the pending generation only after an explicit save/continue action.
- If the account is disconnected, has no usable Key, the user cancels, or the operation fails, retain the existing full settings/manual configuration path and do not replay the pending request automatically.

## Impact

- Client provider forms and native provider transaction commands.
- OpenTu creative workspace account bridge, settings routing, and first-send configuration gate.
- Existing account binding/source validation and manual provider behavior remain compatible.
- Local implementation and synthetic verification only; no push, PR, deployment, production data, real credentials, or paid model calls.
