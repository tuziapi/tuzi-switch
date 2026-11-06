## ADDED Requirements

### Requirement: Stable three-column batch slots
The client SHALL place newly submitted image batches in row-major order with at most three slots per row, reserve the batch as a unit, and preserve each task's assigned result slot.

#### Scenario: Four or twenty requested images
- **WHEN** a new image batch is submitted
- **THEN** its slots wrap after every third image and avoid existing content as one batch region
- **AND** results arriving out of order do not reorder the slots or rearrange existing images

### Requirement: Complete batch preparation feedback
The client SHALL render the complete requested placeholder set after synchronous submission validation and before expensive asynchronous preparation, with safe cleanup of unbound slots.

#### Scenario: Reference preparation is delayed
- **WHEN** reference or route preparation takes time for a validated batch
- **THEN** all requested placeholders can be painted with preparation feedback before task submission completes
- **AND** cancellation, preparation failure or board switching cannot leave orphan placeholders or duplicate requests

### Requirement: Bounded display work during batch generation
The client SHALL avoid refreshing unrelated batch slot controllers for task or readiness events and SHALL measure submission, waiting and result insertion separately without changing request count or concurrency.

#### Scenario: Many results complete together
- **WHEN** twenty synthetic tasks produce concurrent or out-of-order completion events
- **THEN** display updates are limited to affected slots, and input and actual canvas dragging are measured against the baseline
- **AND** every result remains persisted and correctly positioned after reload
