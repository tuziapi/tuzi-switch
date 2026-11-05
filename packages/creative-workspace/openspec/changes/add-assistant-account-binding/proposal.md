# Change: Reuse creative settings with unified assistant account bindings

## Why
The user selected UC-D03 option B on 2026-11-01 and explicitly retained manual configuration while requesting reuse and simplification of the existing settings.

## What Changes
- Open the existing settings from the creative toolbar and original canvas menu.
- Add explicit account Key selection alongside manual credentials in the same supplier form.
- Persist native source bindings, never system tokens or model secrets in creative settings.
- Route supported account model requests through native validation and keep manual suppliers independent.
- Add the account Key configuration target without changing CLI AppId.

## Impact
- Host UI/native account service and creative settings/transport.
- Approval: user's explicit selection of B and implementation steering in this turn.
- Local implementation and synthetic verification only; no remote writes or paid calls.
