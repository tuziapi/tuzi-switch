## ADDED Requirements
### Requirement: Existing assistant navigation
The client SHALL preserve the existing assistant shell and add exactly one creative entry below the account entry.

#### Scenario: Switch to creative work
- **WHEN** the user selects opentu 创作
- **THEN** the existing content area displays locally bundled creative modules without launching another application.

### Requirement: Real local editing
The preview SHALL use the pinned opentu editing and workspace services and SHALL report storage or loading failures.

#### Scenario: Reload a saved drawing
- **WHEN** a user edits a canvas and reloads the local preview
- **THEN** the saved canvas is restored from local storage rather than synthetic fixture data.

### Requirement: Scoped lifecycle
The creative module SHALL share the host React runtime and SHALL NOT start an independent updater, application root or account-token import.

#### Scenario: Return to the assistant
- **WHEN** the user leaves creative work
- **THEN** the host navigation remains usable and creative styles and portals do not cover the assistant.


### Requirement: Automatic top navigation
The assistant SHALL hide the entire side rail on entering creative work and expose existing navigation through a top dropdown, without modifying the saved sidebar preference.

#### Scenario: Open and dismiss assistant navigation while drawing
- **WHEN** the user opens the assistant dropdown and dismisses it using Escape, the close button or an outside click
- **THEN** the editor remains mounted at the same width and retains its contents.

#### Scenario: Return to tools
- **WHEN** the user chooses a tool from the creative dropdown
- **THEN** the existing tool navigation handler runs and the original expanded or collapsed sidebar returns.

### Requirement: Background task lifetime
The assistant SHALL retain the task executor and current account transport after the creative view has been opened, independently of visible editor lifetime.

#### Scenario: Finish on an assistant page
- **WHEN** generation completes after the user switches to an assistant tool or project list
- **THEN** returning to the source canvas delivers the saved result without another generation POST and without keeping hidden canvas keyboard handlers mounted.

#### Scenario: Another project is visible
- **WHEN** a task bound to a generation anchor completes while a different project is open
- **THEN** insertion waits for the original anchor's board and does not modify the unrelated board.

### Requirement: Public external tools
The assistant SHALL open Chat-MJ, 香蕉提示词 and 动作场景库 in the system browser using fixed public URLs without model Keys or account references, as selected by the user on 2026-11-02.

#### Scenario: Open an external tool
- **WHEN** the user selects one of the three external tools
- **THEN** the host opens its public URL, without creating an iframe or requiring a model Key; existing canvas references show an explicit browser action.

### Requirement: Backup preflight
The importer SHALL validate JSON shape, declared checksums, project counts and unsafe paths before clearing or writing any imported domain.

#### Scenario: Corrupt replacement archive
- **WHEN** replacement import contains malformed board JSON
- **THEN** it reports the damaged file and preserves existing projects.

#### Scenario: Multipart replacement
- **WHEN** a user attempts to replace the environment with one part of a multipart backup
- **THEN** it rejects that operation before mutation and directs the user to merge restoration.
