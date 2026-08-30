#!/bin/bash
# Deprecated compatibility wrapper. Inspection validates structure and sizes;
# it intentionally performs no model-content hashing.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec "$SCRIPT_DIR/inspect-model.sh" "$@"
