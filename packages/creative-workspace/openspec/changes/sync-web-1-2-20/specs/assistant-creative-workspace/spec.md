## ADDED Requirements
### Requirement: Compatible upstream video and canvas integration
The desktop SHALL expose the approved web model capabilities while retaining native transports, persisted user selections and task recovery without duplicate submissions.

#### Scenario: Restore existing choices and jobs
- **WHEN** a user opens an existing workspace after the update
- **THEN** existing model and provider selections are retained and saved jobs are restored without resubmission.

#### Scenario: Submit Vidu Mix from ecommerce
- **WHEN** the user configures valid image references, public audio URLs and Mix parameters
- **THEN** the planned job snapshots those parameters and the request uses the same values after restoration or retry.

#### Scenario: Recover canvas editing and navigation
- **WHEN** the user restores a generation draft, changes selection or switches boards
- **THEN** snapshots remain bounded and viewport persistence does not overwrite another board's content.
