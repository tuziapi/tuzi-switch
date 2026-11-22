## 1. Proposal and contracts

- [x] 1.1 Confirm the quick-picker behavior and supported tool scope.
- [x] 1.2 Add/adjust TypeScript transient setup types without adding persistent secret fields.

## 2. Desktop provider selection

- [ ] 2.1 Add a reusable masked Rabbit Key picker to supported provider forms.
- [ ] 2.2 Preserve manual API Key input and explicit account/manual mode switching.
- [ ] 2.3 Carry the selected source through the add/edit submit path without persisting raw secrets in the renderer state or provider metadata.
- [ ] 2.4 Add explicit source replacement behavior for existing account-backed providers.

## 3. Native transaction

- [ ] 3.1 Resolve and qualify the selected Key natively against the current account generation and selected models.
- [ ] 3.2 Reuse backup, concurrency, atomic write, compensation and `tuzi_provider_sources` association semantics.
- [ ] 3.3 Reject stale, revoked, disabled, expired, exhausted, unauthorized and protocol-incompatible selections before file/database writes.

## 4. OpenTu quick setup

- [x] 4.1 Add a first-send quick account picker event and modal path.
- [x] 4.2 List masked Keys, bind the selected Key, discover eligible models and update the existing provider/invocation route.
- [x] 4.3 Resume the blocked generation only after explicit successful completion; preserve cancel/error/manual fallback behavior.

## 5. Verification and records

- [x] 5.1 Add targeted renderer regression coverage for the async setup gate.
- [x] 5.2 Run targeted tests and diff checks; type/build checks are recorded with existing dependency limitations.
- [x] 5.3 Record implementation and validation limits in `docs/development/` and update progress after completion.
