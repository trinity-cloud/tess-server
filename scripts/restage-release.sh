#!/bin/bash
# Restage public metadata around an already checksummed internal release payload.
# The proprietary executable and metallib are copied byte-for-byte and revalidated.
# Usage: restage-release.sh <release.tar.gz> <version> <build-id>
set -euo pipefail

ARCHIVE=${1:?release archive}
VER=${2:?version}
BID=${3:?build id}
REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ARCHIVE=$(cd "$(dirname -- "$ARCHIVE")" && pwd)/$(basename -- "$ARCHIVE")
CHECKSUMS=$(dirname -- "$ARCHIVE")/SHA256SUMS

[ -f "$ARCHIVE" ] || { echo "FAIL: release archive not found: $ARCHIVE" >&2; exit 1; }
[ -f "$CHECKSUMS" ] || { echo "FAIL: adjacent SHA256SUMS not found: $CHECKSUMS" >&2; exit 1; }

ARCHIVE_NAME=$(basename -- "$ARCHIVE")
EXPECTED=$(awk -v name="$ARCHIVE_NAME" '$2 == name { print $1 }' "$CHECKSUMS")
[ "$(printf '%s\n' "$EXPECTED" | sed '/^$/d' | wc -l | tr -d ' ')" = 1 ] || { echo "FAIL: archive must have exactly one adjacent checksum row" >&2; exit 1; }
ACTUAL=$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')
[ "$ACTUAL" = "$EXPECTED" ] || { echo "FAIL: release archive checksum mismatch" >&2; exit 1; }

if tar -tzf "$ARCHIVE" | awk 'BEGIN { bad=0 } /^\// { bad=1 } /(^|\/)\.\.(\/|$)/ { bad=1 } END { exit bad ? 0 : 1 }'; then
  echo "FAIL: unsafe path in release archive" >&2
  exit 1
fi

WORK=$(mktemp -d /tmp/tess-metadata-restage.XXXXXX)
trap 'rm -rf "$WORK"' EXIT
EXTRACT="$WORK/extract"
BUILD="$WORK/build"
mkdir -p "$EXTRACT" "$BUILD/bin"
tar -xzf "$ARCHIVE" -C "$EXTRACT"

TOP_LEVEL=$(find "$EXTRACT" -mindepth 1 -maxdepth 1 -type d -print)
[ "$(printf '%s\n' "$TOP_LEVEL" | sed '/^$/d' | wc -l | tr -d ' ')" = 1 ] || { echo "FAIL: release archive must contain exactly one payload directory" >&2; exit 1; }
(cd "$TOP_LEVEL" && shasum -a 256 -c SHA256SUMS >/dev/null)

cp "$TOP_LEVEL/bin/tess-server" "$BUILD/bin/tess-server"
cp "$TOP_LEVEL/bin/default.metallib" "$BUILD/bin/default.metallib"
cp "$TOP_LEVEL/share/tess-server/build-provenance.json" "$BUILD/build-provenance.json"
chmod 755 "$BUILD/bin/tess-server"
chmod 644 "$BUILD/bin/default.metallib" "$BUILD/build-provenance.json"

METADATA_RESTAGE=1 "$REPO/scripts/stage-release.sh" "$BUILD/bin" "$VER" "$BID" internal
