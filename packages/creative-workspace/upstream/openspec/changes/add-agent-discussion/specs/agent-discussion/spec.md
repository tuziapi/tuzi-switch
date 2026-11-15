## ADDED Requirements
### Requirement: Shared discussion
The system SHALL bind a discussion to a board and use the main composer as its input and show conversation context in an attached transcript. Standalone text chat retains its independent drafts.
#### Scenario: Main composer discussion
- **WHEN** a user sends through discussion mode
- **THEN** the message and streamed reply appear in the same board-linked conversation above the composer.
### Requirement: Compact status
The system SHALL display a single-line 30px status strip attached to the composer and toggle the attached discussion on click without resizing the canvas.
#### Scenario: Collapsed discussion
- **WHEN** the attached discussion is closed during execution
- **THEN** generation continues and the strip reports its stage without rendering the message list.
### Requirement: Shared media tasks
The system SHALL execute only validated image/video tools, bound batches, and reuse task results in chat and their originating board.
#### Scenario: Board changed
- **WHEN** a task finishes on another board
- **THEN** the result waits for its originating board and is not regenerated.
### Requirement: Compatible storage
The system SHALL validate optional discussion fields in restore and preserve existing text sessions and backups.
#### Scenario: Old session
- **WHEN** no discussion fields exist
- **THEN** the session retains its existing plain text behavior.

### Requirement: Planning failure recovery
The system SHALL permit explicit retry only when a durable marker proves no media submission has started; legacy messages and uncertain media submissions remain non-replayable.
#### Scenario: Interrupted text plan
- **WHEN** a text planning request fails before media dispatch
- **THEN** the transcript explains that no media task was submitted and allows a user-initiated retry preserving context.
#### Scenario: Uncertain dispatch
- **WHEN** submission has begun or the durable marker is absent
- **THEN** retry of that discussion turn remains disabled.

### Requirement: Attached discussion layout
The system SHALL remove the bottom Discussion button, attach a closable transcript above the main input and keep the uncovered canvas operable.
#### Scenario: Locate generated media
- **WHEN** the user locates a result that exists on the current board
- **THEN** the transcript collapses and the canvas locates the existing result without generation.
#### Scenario: Read a longer conversation
- **WHEN** the user expands reading mode
- **THEN** the transcript grows within the canvas viewport and keeps the main input available.

### Requirement: Expand discussion into a larger dialog
The existing expand control SHALL open a centered responsive dialog containing the same board discussion and main composer, preserving draft and running work without a second conversation or composer.

#### Scenario: Continue in a large discussion dialog
- **WHEN** a user expands a board discussion
- **THEN** the dialog is larger than the attached panel, fits within the workspace, and preserves the same composer DOM, draft, model selection and transcript
- **AND** sending, cancellation, plan confirmation and canvas location continue through the existing runtime

#### Scenario: Return to the canvas
- **WHEN** the user shrinks the dialog
- **THEN** the same discussion returns above the main input
- **WHEN** the user closes the dialog or presses Escape without an inner popup open
- **THEN** only the narrow strip remains and focus returns to its trigger, without cancelling running work
