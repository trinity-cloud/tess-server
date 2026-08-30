#!/bin/bash
# Explicit integrity diagnostic. Normal model discovery and launch do not call
# this script; staging/install/prepack and `tess-server doctor` do.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/profile-common.sh"

[ -f "$TESS_PACKAGE_ROOT/SHA256SUMS" ] || tess_die "packaged payload SHA256SUMS is missing"
while IFS=' ' read -r expected relative extra; do
  [ -n "$expected" ] || continue
  [ -z "${extra:-}" ] || tess_die "invalid SHA256SUMS row for $relative"
  [ -n "$relative" ] || tess_die "invalid SHA256SUMS row"
  tess_verify_payload_file "$relative"
done < "$TESS_PACKAGE_ROOT/SHA256SUMS"
printf 'payload integrity passed\n'
