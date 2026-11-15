# Design

## Existing behavior
The creative package is lazy-loaded only after first opening. Its build version is a fixed preview string. Catalog discovery preserves manual bindings but captures selection state before asynchronous fetching; credential-change refresh selects all models. Neither flow supplies safe upgrade refresh semantics unchanged.

## Proposed decisions
1. Derive a stable refresh identity from the real host release and build/model-adaptation revision, including relevant same-version rebuilds. Never use current time as an identity.
2. Provide an idle startup discovery entry without mounting the editor, task executor or keyboard handlers. The editor and startup scheduler share discovery deduplication and account lifecycle.
3. Refresh only existing enabled sources with valid configured credentials/connected native account references and model-endpoint support. Do not create account resources or export credentials.
4. Persist per-source successful refresh identity with the catalog, using compatible optional fields or a separate non-secret record with equivalent write ordering. Specify normalization, missing-field defaults, export rules and source invalidation during implementation.
5. Merge against current settings at completion. Keep explicit deselections, custom models/bindings and valid active choices; select newly discovered authorized IDs. An unavailable old ordinary ID must not remain represented as remotely authorized.
6. Serialize or deduplicate source refresh, gate result commit on source/account generation, abort on lifecycle changes, and retry transient failures with bounded backoff. Cache and successful revision remain intact on failed fetch.
7. Approved scope A shares the existing basic request policy across the three exact IDs, labels prompt GIF as default/Codex behavior, and rejects explicit unsupported GIF/SVG output parameters. Public metadata does not enable unsupported parameter controls. Group-specific format support is deferred.

## Alternatives
Scope A ships basic generation/edit plus currently tested prompt GIF and automatic upgrade discovery, with explicit remaining official-group limitations. Scope B additionally adapts declared group-specific output options. The user selected A; both retain incremental refresh. Full replacement/select-all on upgrade is rejected because it restores deliberately disabled models and can overwrite user changes.

## Compatibility and rollback
No forced default-model switch, no paid request during refresh, no task resubmission. New state is optional and old settings load without migration loss. Code can be reverted locally; an older build ignores new state. Provenance patch is regenerated only after approved upstream-source edits. Previous batch performance commits remain ancestors.

## Validation
See host UC-MODEL-03 record for the synthetic upgrade, source lifecycle, persistence, request/media and browser matrix. Public descriptions and linked-chat tests are evidence with limited scope; neither constitutes this build's live-provider acceptance.
