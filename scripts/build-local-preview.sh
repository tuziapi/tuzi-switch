#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm tauri build --debug --features local-preview --bundles app --config src-tauri/tauri.preview.conf.json
