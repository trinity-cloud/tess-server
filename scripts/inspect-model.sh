#!/bin/bash
# Structurally inspect a model for a Tess profile without hashing or loading it.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/profile-common.sh"

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "usage: $0 <profile-id> <first-model-shard-or-directory> [first-draft-shard]" >&2
  exit 2
fi

PROFILE_ID=$1
MODEL_PATH=$2
DRAFT_PATH=${3:-}

if [ "$(tess_profile_engine_variant "$PROFILE_ID")" = tess-mlx ]; then
  tess_profile_begin_mlx "$PROFILE_ID"
else
  tess_profile_begin "$PROFILE_ID"
fi
tess_inspect_profile_files "$MODEL_PATH" "$DRAFT_PATH"
printf 'model inspection passed: %s\n' "$TESS_PROFILE_ID"
