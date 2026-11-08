## ADDED Requirements
### Requirement: Protocol-aware text chat
The client SHALL use the selected provider and declared text protocol, preserve native account validation and normalize streaming content, reasoning summaries, usage and completion states.
#### Scenario: Provider-specific streams
- **WHEN** a configured Chat Completions, Responses, Messages or Gemini model responds
- **THEN** the corresponding decoder renders text incrementally and distinguishes complete, interrupted and failed output without silently retrying a paid request
### Requirement: Isolated durable conversations
The client SHALL isolate requests by conversation and persist partial output, model identity and explicit status with backward-compatible optional fields.
#### Scenario: Switch while generating
- **WHEN** the user switches conversations and stops one request
- **THEN** only that request is stopped and its partial output remains in its original conversation after reopening
### Requirement: Focus and canvas layouts
The client SHALL provide text and creative modes in one drawer with focus and side-by-side layouts.
#### Scenario: Reading a long answer
- **WHEN** the user scrolls upward during generation
- **THEN** automatic scrolling stops until the user returns to the bottom or explicitly selects the latest reply
### Requirement: Message and session actions
The client SHALL support copy, explicit regeneration, title search, rename and recoverable drafts without overwriting prior responses.
#### Scenario: Regenerate a reply
- **WHEN** the user requests another answer
- **THEN** the original user prompt is sent with only its preceding context and prior answers remain available
#### Scenario: Discover and collapse chat
- **WHEN** the user clicks the top-right chat entry in the creative canvas
- **THEN** the existing drawer toggles with synchronized expanded state, and the text history can independently collapse in a single click
#### Scenario: Model menu inside the desktop workspace
- **WHEN** the text model selector opens in focus or canvas layouts
- **THEN** its menu remains anchored to the trigger within the embedded viewport, scrolls overflowing models, and Escape dismisses the menu before the drawer

### Requirement: Bounded long-conversation rendering
The client SHALL limit mounted messages to the visible region and a small overscan for long conversations, without truncating persisted messages or provider context. Hidden chat SHALL stop its UI subscription while background requests and durable saves continue.
#### Scenario: Browse long history while receiving a reply
- **WHEN** a conversation contains 800 messages and the user scrolls upward during a reply
- **THEN** the first message remains reachable without a delayed jump to the bottom, and the explicit latest action restores the live reply
#### Scenario: Close during generation
- **WHEN** the user hides the chat while a reply is streaming
- **THEN** the chat message DOM is unmounted, and reopening or reloading after completion restores the full reply and earlier messages
#### Scenario: Wait for durable new conversation
- **WHEN** creation of a new conversation is waiting for its local write
- **THEN** duplicate creation and message input are disabled until the new session is selected, preventing input from accidentally modifying the prior draft
