## ADDED Requirements
### Requirement: Original creative brand
The host SHALL use the authentic opentu logo for creative navigation and account configuration entry points.

#### Scenario: Expanded and collapsed navigation
- **WHEN** a user opens either navigation presentation
- **THEN** the original logo is bundled locally and the button retains its accessible name.

### Requirement: GPT Image 2.6 and original media
The creative workspace SHALL recognize gpt-image-2.6-1k with isolated supported parameters and preserve original GIF bytes and actual media dimensions.

#### Scenario: Account or manual generation
- **WHEN** the authenticated provider supports the exact model
- **THEN** generation and editing retain its model ID and selected supported size through the existing account or native manual transport.

#### Scenario: Animated output download
- **WHEN** a cached GIF is saved through desktop media actions
- **THEN** the original bytes, MIME and extension are retained and cancellation does not report success.

### Requirement: Compatible generation diagnostics
The workspace SHALL display and copy available error, model, provider Request ID and remote task metadata while preserving desktop clipboard and old task compatibility.

#### Scenario: Failure in a free-canvas task chain
- **WHEN** a generation fails
- **THEN** diagnostics survive persistence, refer to the failed step, avoid credentials and do not reintroduce the removed standalone workflow.

#### Scenario: Historical task without diagnostics
- **WHEN** an old task lacks new optional fields
- **THEN** its existing error remains readable without invented identifiers or data migration.
