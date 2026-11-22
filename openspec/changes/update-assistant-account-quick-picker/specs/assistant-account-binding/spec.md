## MODIFIED Requirements

### Requirement: Native account binding

The application SHALL associate an explicitly selected own Key with a native source reference, never copying the system token or model secret into ordinary creative settings or renderer-facing provider metadata. Desktop tool saves MAY resolve the selected model Key inside the native transaction before writing the external tool's required credential file.

#### Scenario: Account changes during binding

- **WHEN** account generation or identity changes before a binding or tool save finishes
- **THEN** the stale operation is rejected without replacing the previous provider or writing a tool credential

#### Scenario: Tool form selects a Rabbit Key

- **WHEN** a user selects an enabled, unexpired, qualified Rabbit Key in a supported tool form
- **THEN** the form submits only the transient source identity and the native transaction validates and resolves the Key before committing the existing atomic provider write set

#### Scenario: Manual configuration remains available

- **WHEN** a user switches the form to manual configuration
- **THEN** the existing manual API address and Key flow remains available and is not converted into an account binding

### Requirement: First-send account quick setup

The application SHALL open a focused account Key and model selection dialog before the first OpenTu creative generation when no usable invocation route is configured and the connected Rabbit account has at least one usable Key.

#### Scenario: Connected account with usable Key

- **WHEN** the user submits an image generation request without a usable creative route while the Rabbit account is connected and has an enabled, unexpired, non-exhausted Key
- **THEN** the application opens the quick picker, lets the user choose a masked Key, retrieves eligible models, and resumes the pending request only after explicit successful completion

#### Scenario: No account Key or disconnected account

- **WHEN** the account is disconnected or no usable Key can be selected
- **THEN** the application opens the existing full settings/manual configuration flow and does not attempt an account bind

#### Scenario: Cancel or failed quick setup

- **WHEN** the user cancels the quick picker or Key/model binding fails
- **THEN** the pending generation is not submitted or replayed, and the user receives a retry or full-settings path

#### Scenario: Existing manual route

- **WHEN** a valid manual creative route already exists
- **THEN** the existing route is used without opening the account quick picker
