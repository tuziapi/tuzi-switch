## ADDED Requirements
### Requirement: Native Seedream 5.5 contract
The desktop SHALL validate generation and decomposition against the paired API contract and preserve explicit false values.
#### Scenario: Transparent JPEG
- **WHEN** transparent background and JPEG are selected
- **THEN** the request fails before network submission.
#### Scenario: Layer count and OCR
- **WHEN** a user selects up to 99 foreground layers and OCR
- **THEN** one input, total max_images including the base and text_recognition are sent without background.
### Requirement: Durable layer metadata
The desktop SHALL retain distinct layers with duplicate URLs, optional OCR and unknown provider fields through canvas metadata and manifest export.
#### Scenario: Partial or excessive result
- **WHEN** any layer fails or the total exceeds the requested maximum
- **THEN** the complete result is rejected before canvas mutation.
#### Scenario: Provider does not supply measured quality
- **WHEN** Seedream returns native layers without SSIM
- **THEN** no fabricated quality score is shown or persisted.
