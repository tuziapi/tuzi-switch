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
