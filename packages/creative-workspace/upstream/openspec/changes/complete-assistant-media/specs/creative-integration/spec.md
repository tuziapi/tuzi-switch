## ADDED Requirements
### Requirement: Account media requests are explicit and validated
The client SHALL support the existing documented video and music actions through a shared finite action manifest, preserving account ownership, key eligibility, request cancellation and credential isolation.
#### Scenario: MiniMax generation and polling
- **WHEN** an eligible account key submits MiniMax-H3 video
- **THEN** the native request uses the fixed generation endpoint and polls the returned task without replaying the submission.
#### Scenario: Suno implicit model
- **WHEN** a Suno action omits the API permission model from its body
- **THEN** the native layer checks the server-defined routing and billing models in that key's catalogue, independently of renderer input.
#### Scenario: Unknown route
- **WHEN** a caller supplies an unknown action, task path injection or unapproved query
- **THEN** the request is rejected before credentials reach the network.
### Requirement: Native canvas media state is visible and current
The client SHALL paint video/music/text task feedback in the native WebView and derive image loading state from the same task and readiness events as the web presentation.
#### Scenario: Task and canvas status agree
- **WHEN** an associated task changes from pending to generating, completed, failed or cancelled
- **THEN** the canvas card reflects its current state and does not remain blank or stale.
