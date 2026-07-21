#!/bin/bash
# Recoverable per-user uninstall. Only the Tess Server engine installation is
# moved to Trash; external models, settings, logs, and hash cache are preserved.
set -euo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/install-common.sh"

[ "${1:-}" = "--confirm" ] || tess_install_die "usage: $0 --confirm"
INSTALL_ROOT=$(tess_install_root)
if [ ! -d "$INSTALL_ROOT" ]; then
  echo "tess-server is not installed at the per-user install root"
  exit 0
fi

TRASH_ROOT=${TESS_TRASH_ROOT:-"$HOME/.Trash"}
/bin/mkdir -p "$TRASH_ROOT"
/bin/chmod 700 "$TRASH_ROOT" 2>/dev/null || true
STAMP=$(/bin/date -u +%Y%m%dT%H%M%SZ)
TRASH_DEST="$TRASH_ROOT/tess-server-uninstalled-$STAMP"
[ ! -e "$TRASH_DEST" ] || tess_install_die "uninstall destination already exists"
/bin/mv "$INSTALL_ROOT" "$TRASH_DEST"
printf 'tess-server engine moved to %s\n' "$TRASH_DEST"
echo "Models, settings, logs, and the model-verification cache were not changed."
