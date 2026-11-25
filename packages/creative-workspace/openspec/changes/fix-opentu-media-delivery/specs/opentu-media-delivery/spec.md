## ADDED Requirements
### Requirement: Exact supported video parameters
The bridge SHALL list locally configured video options and reject unsupported explicit values before creating a paid task.

#### Scenario: MiniMax duration
- **WHEN** the caller requests MiniMax-H3 with 4 seconds and 768P
- **THEN** the queue receives exactly these values; 3 seconds is rejected without submission.

### Requirement: Resume existing tasks
The bridge SHALL expose bounded task queries and optional bounded waiting without invoking generation again.

#### Scenario: Lost response
- **WHEN** a caller does not know whether creation succeeded
- **THEN** it can inspect recent tasks and continue querying an existing task; instructions prohibit automatic resubmission.

#### Scenario: Desktop resumes an accepted video
- **WHEN** a processing video with a stored remote ID is restored after startup or a delayed workflow batch
- **THEN** the desktop host resumes querying it after its configured account is ready, even when the batch notification represents an image or the canvas is closed; live executions and cancelled tasks are not restarted.

#### Scenario: Slow MiniMax task
- **WHEN** an accepted MiniMax-H3 task remains in progress after ten minutes
- **THEN** recovery continues GET queries up to the main poller's 1080-attempt budget, preserving the original remote ID and an explicit polling-timeout error if exhausted, without submitting generation again.

### Requirement: Local result delivery
The bridge SHALL export only completed task media to an application-owned directory without accepting caller paths or media URLs, preserving original bytes and user-edited copies.

#### Scenario: Image or video complete
- **WHEN** a caller requests one completed task result
- **THEN** it receives a local absolute path, original metadata and an optional bounded image preview; generation and canvas insertion status remain distinct.
