#!/bin/bash
# Atomically activate a previously installed Tess Server version.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/install-common.sh"

[ "$#" = "1" ] || tess_install_die "usage: $0 <installed-version>"
VERSION=$1
tess_validate_version "$VERSION"
INSTALL_ROOT=$(tess_install_root)
DESTINATION="$INSTALL_ROOT/versions/$VERSION"
[ -d "$DESTINATION" ] || tess_install_die "version is not installed: $VERSION"
[ ! -L "$DESTINATION" ] || tess_install_die "installed version path must not be a symlink"
tess_verify_package "$DESTINATION"
tess_verify_binary_contract "$DESTINATION" "$VERSION"
tess_smoke_binary "$DESTINATION"
tess_switch_current "$INSTALL_ROOT" "$VERSION"
printf 'tess-server rollback complete: current -> versions/%s\n' "$VERSION"
