#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Unsigned local candidate only: normal app identity and data paths. Does not
# install, launch, publish, increment versions, or modify release workflows.
exec python3 scripts/build-claude-local-candidate.py "$@"
