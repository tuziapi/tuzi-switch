## ADDED Requirements
### Requirement: Desktop canvas browsing and panning
The integrated desktop canvas SHALL default to browse mode, use existing hand/selection tools without additional browse/edit controls, and restore the last local mode without modifying project content.

#### Scenario: Browse an image
- **WHEN** the user drags over an image in browse mode
- **THEN** the viewport pans and the image world coordinates remain unchanged.

#### Scenario: Edit and return to browsing
- **WHEN** the user selects edit and drags an image
- **THEN** the existing selection/movement behavior applies; the existing hand tool restores panning.

#### Scenario: Restore and recover preference
- **WHEN** the workspace restarts
- **THEN** browse/edit is restored; missing or invalid preference defaults to browse, and unavailable storage does not block current interaction.

#### Scenario: Existing tools and typing
- **WHEN** the user selects H/V or an editing tool outside text entry
- **THEN** the actual pointer follows the existing tool; typing those characters in chat or other inputs does not change the mode.

#### Scenario: Temporary pan
- **WHEN** the user temporarily pans with Space or the middle button in edit mode
- **THEN** the persisted edit preference is unchanged.
