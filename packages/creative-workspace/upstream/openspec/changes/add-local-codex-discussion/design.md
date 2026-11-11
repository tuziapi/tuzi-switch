# Design

Use the native App Server stdio protocol, with a probe and bounded on-demand processes. Rabbit conversation history is authoritative; each turn uses an ephemeral read-only thread. A snapshot of the selected backend/model is captured before submission. No automatic fallback after a connected request fails. Disable CLI execution tools and inherited MCP servers for this planning-only scope; media tools remain plan JSON validated by existing code.

The host capability is optional and independent of Rabbit account authentication. Connected state is runtime-only and never changes persisted provider settings. Message model labels preserve Codex provenance without a new database field. The native boundary accepts bounded text/image inputs and model selection, never command strings, paths or credentials from the renderer. Native events expose only assistant text and reasoning summary. Cancellation, timeout and channel failure terminate/reap the child.
