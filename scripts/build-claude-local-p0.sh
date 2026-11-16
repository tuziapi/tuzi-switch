#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Local macOS experiment only. Does not install, publish or enable automatic updates.
pnpm tauri build --debug --features claude-local-poc --bundles app --config src-tauri/tauri.claude-local-p0.conf.json
