## ADDED Requirements
### Requirement: Desktop canvas browsing and panning
The integrated desktop canvas SHALL start with the selection tool on each workspace mount, use existing hand/selection tools without additional browse/edit controls, and support panning without modifying project content.

#### Scenario: Browse an image
- **WHEN** the user drags over an image in browse mode
- **THEN** the viewport pans and the image world coordinates remain unchanged.

#### Scenario: Edit and return to browsing
- **WHEN** the user selects edit and drags an image
- **THEN** the existing selection/movement behavior applies; the existing hand tool restores panning.

#### Scenario: Reopen with selection
- **WHEN** the workspace restarts
- **THEN** the actual pointer and toolbar both start in selection, even if the previous tool was hand or an obsolete local browse preference exists; no tool preference is read or written.

#### Scenario: Existing tools and typing
- **WHEN** the user selects H/V or an editing tool outside text entry
- **THEN** the actual pointer follows the existing tool; typing those characters in chat or other inputs does not change the mode.

#### Scenario: Temporary pan
- **WHEN** the user temporarily pans with Space or the middle button in edit mode
- **THEN** image world coordinates remain unchanged and the selection tool is restored when temporary panning ends.
