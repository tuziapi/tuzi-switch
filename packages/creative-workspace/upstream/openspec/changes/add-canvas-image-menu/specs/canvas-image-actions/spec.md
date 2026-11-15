## ADDED Requirements
### Requirement: Image actions target the clicked image
The system SHALL offer copy image, save as, show image file, preview and copy prompt for the right-clicked canvas image without invoking drawing actions.

#### Scenario: Another element is selected
- **WHEN** an image is right-clicked while another element or drawing tool is active
- **THEN** actions use the clicked image and do not modify the board.

### Requirement: Original image export and automatic reveal
The desktop SHALL use original bytes and save reveal copies under system Pictures/兔子助手 using content-derived names.

#### Scenario: Repeated reveal
- **WHEN** the original copy exists unchanged
- **THEN** it is reused; a deleted copy is recreated, and an edited copy is preserved with a separate original copy.

#### Scenario: Save cancellation or missing original
- **WHEN** saving is cancelled or the original is unavailable
- **THEN** no successful save is reported, no thumbnail is substituted and no generation is submitted.

### Requirement: Accessible bounded menu
The menu SHALL remain within the host viewport and support keyboard navigation and dismissal.

#### Scenario: Near bottom edge
- **WHEN** the image is right-clicked near the bottom of the contained creative workspace
- **THEN** all actions remain visible; Escape closes the menu without changing the canvas.
