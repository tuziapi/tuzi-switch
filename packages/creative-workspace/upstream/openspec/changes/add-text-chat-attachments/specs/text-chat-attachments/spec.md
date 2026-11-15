## ADDED Requirements
### Requirement: Durable text chat attachments
The text workspace SHALL accept supported images and text documents through file selection, drag/drop and image paste, keep bounded attachment payloads outside session snapshots, and include them in model context without silently dropping content.

#### Scenario: Add and send
- **WHEN** a supported file is added
- **THEN** a removable preview appears after local preparation, and attachments alone or with text can be sent after durable save.

#### Scenario: Compatibility
- **WHEN** an old conversation or backup has no attachment fields
- **THEN** it continues to work; new attachment references and payloads round-trip through backup and restart.

#### Scenario: Retry and unavailable content
- **WHEN** a user retries an attached message or switches models
- **THEN** the same attachments are included; missing payloads, declared unsupported image input and limits produce actionable errors before network submission.

#### Scenario: PDF and limits
- **WHEN** a PDF or text file is read
- **THEN** text is extracted locally with explicit size/page/character limits; image-only PDF pages are reported and no OCR is implied.

#### Scenario: Cancel and cleanup
- **WHEN** preparation is cancelled, the conversation is switched/deleted, or chat data is cleared
- **THEN** no attachment leaks into another conversation and owned attachment data is cleaned up with the relevant operation.

#### Scenario: Desktop performance
- **WHEN** sessions are listed or text streams
- **THEN** attachment payloads are not copied into every session snapshot and PDF code is loaded only when a PDF is added.
