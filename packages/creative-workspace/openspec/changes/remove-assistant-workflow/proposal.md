# Change: Remove the optional workflow workspace

## Why
The user explicitly requested removing the workflow tab and all content belonging to that workspace on 2026-11-01. This replaces its inclusion in the previous integration design.

## What Changes
- Remove the workflow tab, project landing card, alternate canvas menu, routes, components, stores, plugins, styles, assets and dedicated build/dependency configuration.
- Keep the free canvas, image generation, local projects and shared generation runtime. Move the image-result query helper out of the removed directory because the free canvas also uses it.
- Fall back from the old remembered workflow tab to projects without deleting any persisted user data.
- Preserve upstream provenance with explicit omitted paths, not a patch containing the entire deleted application.

## Impact
- Affected specs: assistant-workflow-removal
- Affected code: creative workspace package, host navigation, build setup and tests.
- Approval: this turn's explicit user request; local implementation and verification only.
