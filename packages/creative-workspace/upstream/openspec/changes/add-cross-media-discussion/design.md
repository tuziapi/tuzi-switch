# Design

Keep the existing board-linked conversation and its legacy `executionMode: agent` storage discriminator for compatibility. UI discussion activation is independent of generation type. The session owns the planner model; the composer owns the execution model. Each saved plan snapshots only prompt, count, type, model reference, user-selected controls and known references. The model cannot inject credentials, routing or canvas identities.

Each plan is ready, started or cancelled. Persist the started marker before queue creation; after an ambiguous interruption never replay automatically. The runtime locks per session against double clicks. Restore/backup validates new optional fields and preserves legacy sessions. Batches are at most ten tasks using the existing queue concurrency. Transcript subscriptions remain isolated from canvas rendering and unmount on collapse.

Audio reuses provider-specific Suno parameter builders. Text reuses the existing text queue with automatic insertion disabled; explicit placement reuses the existing insertion guard and result identity. No database migration or provider/API contract change.
