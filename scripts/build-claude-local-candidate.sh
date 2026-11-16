#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Unsigned local candidate only: normal app identity and data paths. Does not
# install, launch, publish, increment versions, or modify release workflows.
python3 scripts/prepare-claude-local-node.py
CARGO_INCREMENTAL=0 pnpm tauri build --debug --features claude-desktop-local --bundles app --no-sign --config src-tauri/tauri.claude-local.conf.json --config '{"bundle":{"createUpdaterArtifacts":false}}'
