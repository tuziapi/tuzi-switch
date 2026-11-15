## ADDED Requirements
### Requirement: Preserve applicable incoming features
The unified assistant SHALL provide incoming batch, image, history, model, audio and persistence features while retaining its host behavior.

#### Scenario: Selected batch rows
- **WHEN** prompts or reference images are imported into selected rows
- **THEN** capacity and row identity are preserved and completed results can be inserted without regeneration.

### Requirement: Preserve current image and account boundaries
The system SHALL retain native image actions and route account references only through the host account bridge.

#### Scenario: Image export after feature sync
- **WHEN** a visible canvas image is right-clicked
- **THEN** original-byte copy/save/reveal remain available, cancellation is not success and missing originals do not trigger generation.

#### Scenario: Model discovery and masks
- **WHEN** an account reference is used for model discovery or masked editing
- **THEN** requests use the host bridge and preserve binary mask data and cancellation; pricing does not receive the account reference.

### Requirement: Existing data compatibility
New fields SHALL remain optional or have tested defaults without a database version change.

#### Scenario: Old settings and tasks
- **WHEN** old records omit new metadata or draft fields
- **THEN** loading uses compatibility defaults and preserves prior provider and task identities.
