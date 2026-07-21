#!/bin/bash
# Verify the ordered model/draft artifacts for a Tess profile without loading
# the model or starting the server.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/profile-common.sh"

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: $0 <profile-id> <first-model-shard> [first-draft-shard]" >&2
  exit 2
fi

PROFILE_ID=$1
MODEL_PATH=$2
DRAFT_PATH=${3:-}

tess_profile_begin "$PROFILE_ID"
tess_verify_profile_files "$MODEL_PATH" "$DRAFT_PATH"
tess_log_runtime_label
printf 'profile verification passed: %s (%s)\n' "$TESS_PROFILE_ID" "$TESS_RUNTIME_LABEL"
