## ADDED Requirements
### Requirement: Shared creative settings
The application SHALL reuse the existing provider settings from the toolbar and canvas menu, retaining manual providers and model presets.
#### Scenario: Open settings on projects
- **WHEN** a user opens creative settings from projects
- **THEN** the same persisted providers are editable without creating a canvas
### Requirement: Native account binding
The application SHALL associate an explicitly selected own Key with a native source reference, never copying the system token or model secret into creative settings.
#### Scenario: Account changes during binding
- **WHEN** account generation changes before a binding finishes
- **THEN** the stale operation is rejected without replacing the previous provider
### Requirement: Controlled account transport
The application SHALL validate account identity, Key status, model eligibility and request destination natively before account-authenticated calls.
#### Scenario: Caller changes the endpoint
- **WHEN** a managed reference is used with an unapproved endpoint
- **THEN** the request is rejected without network fallback or secret disclosure
### Requirement: Independent manual configuration
The application SHALL preserve manual providers and their existing settings.
#### Scenario: Account disconnected
- **WHEN** the assistant account is disconnected
- **THEN** managed generation is blocked while manual providers and local projects remain available
