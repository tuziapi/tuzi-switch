## ADDED Requirements
### Requirement: Free-canvas-only creative workspace
The integrated creative workspace SHALL provide projects and free canvas and SHALL NOT bundle the removed workflow workspace or its dedicated assets.

#### Scenario: Previously selected workflow page
- **WHEN** the remembered creative tab is workflow
- **THEN** the application shows projects with no workflow entry, preserves existing local data and allows opening a free canvas.

### Requirement: Shared free-canvas functionality
The removal SHALL preserve the free canvas's drawing, local persistence, generation runtime and manual image recovery query behavior.

#### Scenario: Find an image by request ID
- **WHEN** a user queries an existing image request from the free canvas
- **THEN** the shared query uses the selected provider and preserves request-ID matching and transport-failure fallback without importing the removed application or its settings store.
