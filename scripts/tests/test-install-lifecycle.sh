#!/bin/bash
set -euo pipefail

[ "$#" = "1" ] || { echo "usage: $0 <tess-server-tar.gz>" >&2; exit 2; }
ARCHIVE=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
TEST_ROOT=$(mktemp -d /tmp/tess-install-test.XXXXXX)
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$TEST_ROOT/extract" "$TEST_ROOT/trash" "$TEST_ROOT/user-models"
printf 'preserve me\n' > "$TEST_ROOT/user-models/model.sentinel"
tar -xzf "$ARCHIVE" -C "$TEST_ROOT/extract"
PACKAGE_ROOT=$(find "$TEST_ROOT/extract" -mindepth 1 -maxdepth 1 -type d | head -1)
[ -n "$PACKAGE_ROOT" ]
PACKAGE_VERSION=$(/usr/bin/plutil -extract version raw -o - "$PACKAGE_ROOT/share/tess-server/manifest.json")

export TESS_INSTALL_ROOT="$TEST_ROOT/Application Support/Tess/server"
export TESS_TRASH_ROOT="$TEST_ROOT/trash"
"$PACKAGE_ROOT/scripts/install.sh"
"$PACKAGE_ROOT/scripts/install.sh"
"$PACKAGE_ROOT/scripts/rollback.sh" "$PACKAGE_VERSION"

[ -L "$TESS_INSTALL_ROOT/current" ]
[ "$(readlink "$TESS_INSTALL_ROOT/current")" = "versions/$PACKAGE_VERSION" ]
"$TESS_INSTALL_ROOT/current/bin/tess-server" --version-json >/dev/null
[ "$(stat -f %Lp "$TESS_INSTALL_ROOT")" = "700" ]
[ "$(stat -f %Lp "$TESS_INSTALL_ROOT/versions")" = "700" ]
[ "$(stat -f %Lp "$TESS_INSTALL_ROOT/versions/$PACKAGE_VERSION")" = "700" ]
[ "$(stat -f %Lp "$TESS_INSTALL_ROOT/current/bin/tess-server")" = "700" ]
[ "$(stat -f %Lp "$TESS_INSTALL_ROOT/current/bin/default.metallib")" = "600" ]

# A self-consistent archive whose manifest version disagrees with its binary
# must fail before either installation or activation.
BAD_PACKAGE="$TEST_ROOT/bad-upgrade"
/usr/bin/ditto "$PACKAGE_ROOT" "$BAD_PACKAGE"
/usr/bin/plutil -replace version -string 0.1.0-rc.999 "$BAD_PACKAGE/share/tess-server/manifest.json"
(cd "$BAD_PACKAGE" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | sort | xargs shasum -a 256 > SHA256SUMS)
if "$BAD_PACKAGE/scripts/install.sh" >/dev/null 2>&1; then
  echo "mismatched upgrade was accepted" >&2
  exit 1
fi
[ "$(readlink "$TESS_INSTALL_ROOT/current")" = "versions/$PACKAGE_VERSION" ]
[ ! -e "$TESS_INSTALL_ROOT/versions/0.1.0-rc.999" ]

# Existing non-symlink activation paths and a symlinked install root are never
# overwritten or followed.
/bin/mv "$TESS_INSTALL_ROOT/current" "$TESS_INSTALL_ROOT/current.saved"
/bin/mkdir "$TESS_INSTALL_ROOT/current"
if "$PACKAGE_ROOT/scripts/install.sh" >/dev/null 2>&1; then
  echo "non-symlink current path was overwritten" >&2
  exit 1
fi
[ -d "$TESS_INSTALL_ROOT/current" ] && [ ! -L "$TESS_INSTALL_ROOT/current" ]
/bin/rmdir "$TESS_INSTALL_ROOT/current"
/bin/mv "$TESS_INSTALL_ROOT/current.saved" "$TESS_INSTALL_ROOT/current"
/bin/mkdir "$TEST_ROOT/symlink-target"
/bin/ln -s "$TEST_ROOT/symlink-target" "$TEST_ROOT/symlink-install-root"
if (TESS_INSTALL_ROOT="$TEST_ROOT/symlink-install-root" "$PACKAGE_ROOT/scripts/install.sh") >/dev/null 2>&1; then
  echo "symlinked install root was followed" >&2
  exit 1
fi
[ ! -e "$TEST_ROOT/symlink-target/versions" ]

"$PACKAGE_ROOT/scripts/uninstall.sh" --confirm
[ ! -e "$TESS_INSTALL_ROOT" ]
[ -f "$TEST_ROOT/user-models/model.sentinel" ]
find "$TESS_TRASH_ROOT" -mindepth 1 -maxdepth 1 -type d | grep -q .

echo "install/permissions/failure-atomicity/idempotency/rollback/uninstall tests: PASS"
