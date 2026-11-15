## ADDED Requirements
### Requirement: Native batch generation progress rendering
The desktop renderer SHALL retain an anchor's SVG structure when only its progress or subtitle changes, without changing batch size or request concurrency.

#### Scenario: Waiting for twenty image results
- **WHEN** twenty image tasks remain active and display progress changes
- **THEN** progress and subtitle update without replacing the anchor background, spinner or grid nodes
- **AND** the display clock does not dirty or persist the board solely for estimated progress; real task events and lifecycle repairs still persist

#### Scenario: Result, failure or geometry changes
- **WHEN** an anchor changes phase, geometry, preview or failure diagnostics
- **THEN** it renders the current state and preserves working retry, close and diagnostic-copy actions

#### Scenario: Estimated progress stalls or history grows
- **WHEN** displayed estimated progress does not change or reaches its cap
- **THEN** no clock-driven React render is requested until the displayed value changes or a new attempt starts
- **AND** a reconciliation sweep reads task history once and the next sweep observes fresh tasks

#### Scenario: Activate a native failure card
- **WHEN** a user presses and releases Retry or Close while selection/controller updates occur
- **THEN** unchanged failure diagnostics preserve the button DOM, and pointer/mouse events do not trigger canvas interaction
- **AND** Close resolves the current board node by ID before deletion; retries target only the selected card's task
- **AND** ordinary details use readable neutral text, only error information receives danger emphasis, and both desktop themes remain legible
