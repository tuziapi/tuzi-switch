## ADDED Requirements
### Requirement: Explicit discussion backend
The system SHALL use the configured text model when disconnected and the selected local Codex model when connected. It SHALL NOT silently fall back after a connected request fails.
#### Scenario: Disconnect
- **WHEN** the user disconnects Codex
- **THEN** subsequent discussions use the original configured text model without rewriting it.
### Requirement: Bounded local planning
The system SHALL expose actual streamed reply and available reasoning summary while keeping media generation behind the existing preview and confirmation.
#### Scenario: Media plan
- **WHEN** Codex returns an image plan
- **THEN** the selected image model and original canvas remain authoritative and no media task starts before confirmation.
