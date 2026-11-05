## ADDED Requirements

### Requirement: Explicit signed installation
The assistant SHALL download and verify an update before offering an explicit restart-and-install action. Download completion SHALL NOT install or restart the app.

#### Scenario: Download completes
- **WHEN** the signed download resolves
- **THEN** every update entry displays the same ready state and waits for the user's install action

#### Scenario: Signature rejected
- **WHEN** signature verification fails after transfer
- **THEN** installation remains unavailable and download can be retried

### Requirement: Preserve creative work before update
The assistant SHALL block update installation while task restoration, generation, native requests or unsaved board persistence is incomplete.

#### Scenario: Active generation
- **WHEN** the user requests installation during generation
- **THEN** installation and restart do not run and the downloaded update remains available

#### Scenario: Persistence fails
- **WHEN** flushing a board fails
- **THEN** installation does not run and the original unsaved state is retained for retry
