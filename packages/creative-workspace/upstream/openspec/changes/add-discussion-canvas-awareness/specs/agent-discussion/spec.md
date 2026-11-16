## ADDED Requirements

### Requirement: Sampled reference video input
The discussion SHALL attach sampled video frames with timestamps to the selected backend and disclose sampling scope and missing audio.

#### Scenario: Four reference videos
- **WHEN** a user sends four playable reference videos
- **THEN** the request contains four actual image contact sheets with five timestamps each, and the transcript shows their duration and sampled range

#### Scenario: Missing explicit video
- **WHEN** a selected video cannot be read or decoded
- **THEN** no model request is sent and an actionable media error is shown

### Requirement: Current canvas awareness
The discussion SHALL capture the current board including unselected elements and SHALL label partial previews or truncated text.

#### Scenario: Follow-up without reselecting media
- **WHEN** a user asks a follow-up without selecting new references
- **THEN** the previous explicit references remain available and a fresh current-board snapshot is sent

### Requirement: Reversible bounded canvas edits
The host SHALL validate canvas actions, gate delete and replace on user confirmation, and batch successful content edits for undo.

#### Scenario: Stale response or different board
- **WHEN** board identity or content revision differs from the planning snapshot
- **THEN** the host rejects the edits without modifying canvas contents

#### Scenario: Confirm delete
- **WHEN** the model proposes deletion
- **THEN** the host displays target elements and waits for confirmation, and executes at most once

#### Scenario: Restart during an edit
- **WHEN** a saved action has started status on restore
- **THEN** it becomes uncertain/error and is never replayed automatically
