#!/bin/bash
# Install or activate this exact package for the current user. Existing versions
# remain available for rollback; model files and user configuration are external.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
. "$SCRIPT_DIR/install-common.sh"

INSTALL_ROOT=$(tess_install_root)
VERSION=$(tess_package_version "$PACKAGE_ROOT")
VERSIONS="$INSTALL_ROOT/versions"
DESTINATION="$VERSIONS/$VERSION"

tess_verify_package "$PACKAGE_ROOT"
[ ! -L "$INSTALL_ROOT" ] || tess_install_die "install root must not be a symlink"
[ ! -L "$VERSIONS" ] || tess_install_die "versions path must not be a symlink"
/bin/mkdir -p "$VERSIONS"
/bin/chmod 700 "$INSTALL_ROOT" "$VERSIONS"

[ ! -L "$DESTINATION" ] || tess_install_die "installed version path must not be a symlink"
if [ -d "$DESTINATION" ]; then
  tess_verify_package "$DESTINATION"
  installed_manifest=$(/usr/bin/shasum -a 256 "$DESTINATION/share/tess-server/manifest.json" | /usr/bin/awk '{print $1}')
  package_manifest=$(/usr/bin/shasum -a 256 "$PACKAGE_ROOT/share/tess-server/manifest.json" | /usr/bin/awk '{print $1}')
  [ "$installed_manifest" = "$package_manifest" ] || tess_install_die "version $VERSION already exists with different bytes"
  tess_verify_binary_contract "$DESTINATION" "$VERSION"
  tess_smoke_binary "$DESTINATION"
else
  INSTALL_TMP=$(mktemp -d "$VERSIONS/.install.$VERSION.XXXXXX")
  trap 'rm -rf "$INSTALL_TMP"' EXIT
  /usr/bin/ditto "$PACKAGE_ROOT" "$INSTALL_TMP/payload"
  tess_verify_package "$INSTALL_TMP/payload"
  /bin/chmod -R u+rwX,go-rwx "$INSTALL_TMP/payload"
  tess_verify_binary_contract "$INSTALL_TMP/payload" "$VERSION"
  tess_smoke_binary "$INSTALL_TMP/payload"
  /bin/mv "$INSTALL_TMP/payload" "$DESTINATION"
fi

tess_switch_current "$INSTALL_ROOT" "$VERSION"
printf 'tess-server %s installed at %s\n' "$VERSION" "$DESTINATION"
printf 'current -> versions/%s\n' "$VERSION"
