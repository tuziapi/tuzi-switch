## ADDED Requirements

### Requirement: Exact basic image model integration
The assistant SHALL classify gpt-image-2.6-flare, gpt-image-2.6-sunburst and gpt-image-2.6-1k as image models and SHALL provide basic image generation/edit and prompt GIF with an explicit default/Codex scope, without granting model access from public metadata.

#### Scenario: Prompt GIF and unsupported format options
- **WHEN** a basic route receives a prompt asking for GIF
- **THEN** it uses the existing Base64 image request without forcing a raster format
- **AND** explicit GIF/SVG output-format options are rejected with a clear scope explanation instead of silently changing the requested format

#### Scenario: Original media preservation
- **WHEN** an approved route returns a valid supported GIF response
- **THEN** preview, cache and download preserve its real format and original bytes through the existing safe media handling path

### Requirement: Automatic upgrade discovery
The assistant SHALL automatically schedule model discovery for configured enabled sources in the background after a new host release or relevant same-version model adaptation revision, without requiring a settings interaction.

#### Scenario: Existing user upgrades
- **WHEN** the application starts with an older or absent successful refresh identity and its configured source is ready
- **THEN** discovery runs automatically without mounting the canvas or submitting a generation
- **AND** entering the creative workspace shares that discovery rather than duplicating it

#### Scenario: Repeat startup after success
- **WHEN** the same source has durably completed discovery for the current identity
- **THEN** normal restart and navigation do not repeat the upgrade refresh

### Requirement: Incremental authorized catalog merge
The assistant SHALL merge refreshed authorized models with current user settings, preserving custom models, manual bindings and deliberate deselections while enabling newly discovered authorized models.

#### Scenario: New models appear
- **WHEN** an authenticated model response includes new IDs
- **THEN** the new IDs become available automatically and existing valid active choices remain unchanged
- **AND** public metadata alone cannot add IDs absent from that response

#### Scenario: Selection changes during refresh
- **WHEN** the user modifies selections or manual bindings while discovery is running
- **THEN** completion merges against the latest settings without overwriting those changes

### Requirement: Failure and lifecycle safe refresh
The assistant SHALL retain cached settings on transient failures, retry with bounded backoff when the source becomes ready, and reject results belonging to obsolete source or account state.

#### Scenario: Offline upgrade
- **WHEN** discovery fails because the network is unavailable
- **THEN** old models remain usable according to existing authorization rules and no successful identity is written
- **AND** connectivity recovery or a later start can retry automatically

#### Scenario: Account or source changes
- **WHEN** a source is removed, disabled or reconfigured, or its account changes during discovery
- **THEN** the obsolete response cannot replace the current catalog or mark the new source refreshed

#### Scenario: Persistence failure
- **WHEN** catalog persistence fails after a successful HTTP response
- **THEN** the refresh is not durably marked complete and can be retried without losing prior configuration

### Requirement: Backward compatible synchronization state
The assistant SHALL supply defaults and complete normalization for any added optional refresh state and SHALL keep credentials out of that state.

#### Scenario: Existing configuration lacks fields
- **WHEN** an older configuration is loaded
- **THEN** providers, presets, catalogs and tasks remain readable and only the missing upgrade refresh is scheduled
