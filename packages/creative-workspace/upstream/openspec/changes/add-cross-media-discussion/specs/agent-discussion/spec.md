## ADDED Requirements
### Requirement: Cross-media discussion planning
The system SHALL preserve the selected execution type and model when discussion opens and SHALL allow a separate configured text model to plan.
#### Scenario: Image model preserved
- **WHEN** the user opens discussion after selecting an image model
- **THEN** the image selection remains and a separate text selector is shown.
### Requirement: Durable bounded execution plans
The system SHALL preview at most ten tasks and persist confirmation before creating queued work.
#### Scenario: Confirmation and restart
- **WHEN** a saved ready plan is confirmed twice or recovered after submission
- **THEN** it is submitted only once and never replayed automatically.
### Requirement: Result placement
The system SHALL associate all generated results with the original discussion and board and keep text off the canvas until requested.
#### Scenario: Text placement
- **WHEN** a text execution finishes
- **THEN** the result is visible in discussion and the user can explicitly place it on the bound board without regenerating.

### Requirement: Discussion generation reserves canvas task slots
After explicit plan confirmation, the application SHALL create a separate canvas task card for each image, video or audio task before dispatch, using the original board and shared task identity. Text results SHALL remain in discussion until explicitly placed. Task completion SHALL hand off to the result in the reserved position without refocusing the viewport.

#### Scenario: Discussion is collapsed during a batch
- **WHEN** the user confirms a two-video plan and closes the discussion
- **THEN** two canvas cards show queue/generation state, failures remain retryable, and completed videos replace their own slots
- **AND** the batch is not submitted again on reload

#### Scenario: Canvas video is dragged
- **WHEN** the user drags the video image area in the desktop renderer
- **THEN** the video moves and its position persists
- **AND** the playback controls remain usable without starting a canvas drag
