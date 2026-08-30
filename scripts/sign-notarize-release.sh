#!/bin/bash
# Convert a clean external-channel stage archive into a signed, notarized, and stapled DMG.
set -euo pipefail

check_tools() {
  local tool
  for tool in codesign hdiutil shasum spctl tar; do
    command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; return 1; }
  done
  : "${DEVELOPER_DIR:?set DEVELOPER_DIR to the exact release Xcode Developer directory}"
  xcrun --find notarytool >/dev/null
  xcrun --find stapler >/dev/null
  xcodebuild -version >/dev/null
}

if [ "${1:-}" = "--check-tools" ]; then
  check_tools
  echo "external signing tools: PASS"
  exit 0
fi

if [ "$#" != "4" ]; then
  echo "usage: $0 <external-stage.tar.gz> <Developer ID Application identity> <notary Keychain profile> <new-output-root>" >&2
  exit 2
fi

ARCHIVE=$(CDPATH= cd -- "$(dirname -- "$1")" && pwd)/$(basename -- "$1")
IDENTITY=$2
NOTARY_PROFILE=$3
OUTPUT_ROOT=$4
check_tools
[ -f "$ARCHIVE" ] || { echo "release archive is missing: $ARCHIVE" >&2; exit 1; }
[ -n "$IDENTITY" ] || { echo "Developer ID Application identity is empty" >&2; exit 2; }
[ -n "$NOTARY_PROFILE" ] || { echo "notary Keychain profile is empty" >&2; exit 2; }
[ ! -e "$OUTPUT_ROOT" ] || { echo "refusing to reuse output root: $OUTPUT_ROOT" >&2; exit 1; }

ARCHIVE_DIR=$(dirname -- "$ARCHIVE")
[ -f "$ARCHIVE_DIR/SHA256SUMS" ] || { echo "release-asset SHA256SUMS is missing beside archive" >&2; exit 1; }
(cd "$ARCHIVE_DIR" && shasum -a 256 -c SHA256SUMS >/dev/null)
SOURCE_ARCHIVE_SHA=$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')

WORK_ROOT=$(mktemp -d /tmp/tess-external-sign.XXXXXX)
MOUNTED=0
MOUNT_POINT="$WORK_ROOT/mount"
cleanup() {
  if [ "$MOUNTED" = "1" ]; then
    hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK_ROOT"
}
trap cleanup EXIT
EXTRACT_ROOT="$WORK_ROOT/extract"
mkdir -p "$EXTRACT_ROOT"
if tar -tzf "$ARCHIVE" | grep -E '(^/|(^|/)\.\.(/|$))' >/dev/null; then
  echo "archive contains an unsafe path" >&2
  exit 1
fi
tar -xzf "$ARCHIVE" -C "$EXTRACT_ROOT"
PAYLOAD=$(find "$EXTRACT_ROOT" -mindepth 1 -maxdepth 1 -type d -print)
[ -n "$PAYLOAD" ] && [ "$(printf '%s\n' "$PAYLOAD" | wc -l | tr -d ' ')" = "1" ] || {
  echo "archive must contain exactly one payload directory" >&2
  exit 1
}

MANIFEST="$PAYLOAD/share/tess-server/manifest.json"
SERVER="$PAYLOAD/bin/tess-server"
UPSTREAM_SERVER="$PAYLOAD/bin/upstream/tess-server"
MLX_SERVER="$PAYLOAD/bin/mlx/tess-mlx-server"
MLX_LIBRARY="$PAYLOAD/bin/mlx/libmlx.dylib"
MLX_JACCL="$PAYLOAD/bin/mlx/libjaccl.dylib"
MLX_MANIFEST="$PAYLOAD/share/tess-server/mlx/tess-mlx-manifest.json"
[ -f "$MANIFEST" ] && [ -x "$SERVER" ] && [ -x "$UPSTREAM_SERVER" ] && [ -x "$MLX_SERVER" ] && \
  [ -f "$MLX_LIBRARY" ] && [ -f "$MLX_JACCL" ] && [ -f "$MLX_MANIFEST" ] || { echo "payload is incomplete" >&2; exit 1; }
PRODUCT=$(plutil -extract product raw -o - "$MANIFEST")
VERSION=$(plutil -extract version raw -o - "$MANIFEST")
BUILD_ID=$(plutil -extract build_id raw -o - "$MANIFEST")
CHANNEL=$(plutil -extract channel raw -o - "$MANIFEST")
ENGINE_COMMIT=$(plutil -extract engine_commit raw -o - "$MANIFEST")
UPSTREAM_MERGE_BASE=$(plutil -extract upstream_merge_base raw -o - "$MANIFEST")
PACKAGING_COMMIT=$(plutil -extract packaging_commit raw -o - "$MANIFEST")
DISTRIBUTION=$($SERVER --version-json | plutil -extract distribution raw -o - -)
LICENSE_STATUS=$(plutil -extract license_status raw -o - "$MANIFEST" 2>/dev/null) || {
  echo "manifest lacks the external-release license status contract" >&2
  exit 1
}
[ "$PRODUCT" = "tess-server" ] || { echo "manifest product mismatch" >&2; exit 1; }
[ "$CHANNEL" = "external" ] || { echo "signing requires an external-channel stage" >&2; exit 1; }
[ "$DISTRIBUTION" = "developer-id" ] || { echo "binary is not a developer-id product build" >&2; exit 1; }
[ "$LICENSE_STATUS" = "owner-approved" ] || { echo "external signing refuses an unapproved license" >&2; exit 1; }
security find-identity -v -p codesigning | grep -F -- "$IDENTITY" >/dev/null || {
  echo "Developer ID Application identity is not available in the active Keychain" >&2
  exit 1
}
mkdir -p "$OUTPUT_ROOT/private" "$OUTPUT_ROOT/not-yet-publishable"
WORK_PUBLIC="$OUTPUT_ROOT/not-yet-publishable"

DMG_NAME="tess-server-$VERSION-macos-arm64.dmg"
PRE_SIGN_SHA=$(shasum -a 256 "$SERVER" | awk '{print $1}')
UPSTREAM_PRE_SIGN_SHA=$(shasum -a 256 "$UPSTREAM_SERVER" | awk '{print $1}')
MLX_SERVER_PRE_SIGN_SHA=$(shasum -a 256 "$MLX_SERVER" | awk '{print $1}')
MLX_LIBRARY_PRE_SIGN_SHA=$(shasum -a 256 "$MLX_LIBRARY" | awk '{print $1}')
MLX_JACCL_PRE_SIGN_SHA=$(shasum -a 256 "$MLX_JACCL" | awk '{print $1}')

# Sign inner dynamic libraries before the executables that load them. Every
# executable code object in the distribution receives the hardened runtime and
# secure timestamp; notarization must never depend on a nested ad-hoc signature.
for code in "$MLX_JACCL" "$MLX_LIBRARY" "$MLX_SERVER" "$UPSTREAM_SERVER" "$SERVER"; do
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$code"
  codesign --verify --strict --verbose=2 "$code"
done
codesign -dvvv "$SERVER" > "$OUTPUT_ROOT/private/binary-codesign.txt" 2>&1
grep -q '(runtime)' "$OUTPUT_ROOT/private/binary-codesign.txt" || { echo "signed binary lacks hardened-runtime flag" >&2; exit 1; }
grep -q '^Timestamp=' "$OUTPUT_ROOT/private/binary-codesign.txt" || { echo "signed binary lacks a secure timestamp" >&2; exit 1; }
codesign -d --entitlements :- "$SERVER" > "$OUTPUT_ROOT/private/binary-entitlements.plist" 2>/dev/null || true
if grep -q 'get-task-allow' "$OUTPUT_ROOT/private/binary-entitlements.plist"; then
  echo "debug entitlement is forbidden in the external binary" >&2
  exit 1
fi
POST_SIGN_SHA=$(shasum -a 256 "$SERVER" | awk '{print $1}')
UPSTREAM_POST_SIGN_SHA=$(shasum -a 256 "$UPSTREAM_SERVER" | awk '{print $1}')
MLX_SERVER_POST_SIGN_SHA=$(shasum -a 256 "$MLX_SERVER" | awk '{print $1}')
MLX_LIBRARY_POST_SIGN_SHA=$(shasum -a 256 "$MLX_LIBRARY" | awk '{print $1}')
MLX_JACCL_POST_SIGN_SHA=$(shasum -a 256 "$MLX_JACCL" | awk '{print $1}')
TEAM_ID=$(awk -F= '$1 == "TeamIdentifier" {print $2; exit}' "$OUTPUT_ROOT/private/binary-codesign.txt")
AUTHORITY=$(awk -F= '$1 == "Authority" {print $2; exit}' "$OUTPUT_ROOT/private/binary-codesign.txt")
[ -n "$TEAM_ID" ] && [ -n "$AUTHORITY" ] || { echo "signed binary lacks Developer ID authority metadata" >&2; exit 1; }

python3 - "$PAYLOAD" "$MANIFEST" "$MLX_MANIFEST" "$TEAM_ID" "$AUTHORITY" "$DMG_NAME" \
  "$PRE_SIGN_SHA" "$POST_SIGN_SHA" \
  "$UPSTREAM_PRE_SIGN_SHA" "$UPSTREAM_POST_SIGN_SHA" \
  "$MLX_SERVER_PRE_SIGN_SHA" "$MLX_SERVER_POST_SIGN_SHA" \
  "$MLX_LIBRARY_PRE_SIGN_SHA" "$MLX_LIBRARY_POST_SIGN_SHA" \
  "$MLX_JACCL_PRE_SIGN_SHA" "$MLX_JACCL_POST_SIGN_SHA" <<'PY'
import hashlib, json, os, sys
(payload, path, tess_mlx_path, team_id, authority, dmg_name,
 primary_pre, primary_post, upstream_pre, upstream_post,
 mlx_server_pre, mlx_server_post, mlx_pre, mlx_post,
 jaccl_pre, jaccl_post) = sys.argv[1:]
with open(path, encoding="utf-8") as handle:
    manifest = json.load(handle)
code_rows = {
    "bin/tess-server": (primary_pre, primary_post),
    "bin/upstream/tess-server": (upstream_pre, upstream_post),
    "bin/mlx/tess-mlx-server": (mlx_server_pre, mlx_server_post),
    "bin/mlx/libmlx.dylib": (mlx_pre, mlx_post),
    "bin/mlx/libjaccl.dylib": (jaccl_pre, jaccl_post),
}
for relative, (pre_sha, post_sha) in code_rows.items():
    row = manifest["files"][relative]
    if row["sha256"] != pre_sha:
        raise SystemExit(f"unsigned code hash no longer matches staged manifest: {relative}")
    row["sha256"] = post_sha
    row["bytes"] = os.path.getsize(os.path.join(payload, relative))
manifest["engine_variants"]["primary"]["binary_sha256"] = primary_post
manifest["engine_variants"]["upstream"]["binary_sha256"] = upstream_post
manifest["tess_mlx"]["binary_sha256"] = mlx_server_post
manifest["tess_mlx"]["libmlx_sha256"] = mlx_post
manifest["tess_mlx"]["libjaccl_sha256"] = jaccl_post

with open(tess_mlx_path, encoding="utf-8") as handle:
    tess_mlx = json.load(handle)
for relative, post_sha in {
    "bin/mlx/tess-mlx-server": mlx_server_post,
    "bin/mlx/libmlx.dylib": mlx_post,
    "bin/mlx/libjaccl.dylib": jaccl_post,
}.items():
    tess_mlx["files"][relative]["sha256"] = post_sha
    tess_mlx["files"][relative]["bytes"] = os.path.getsize(os.path.join(payload, relative))
tess_mlx["signing"] = {
    "identity_authority": authority,
    "team_id": team_id,
    "hardened_runtime": True,
    "secure_timestamp": True,
}
with open(tess_mlx_path, "w", encoding="utf-8") as handle:
    json.dump(tess_mlx, handle, indent=2, sort_keys=True)
    handle.write("\n")
with open(tess_mlx_path, "rb") as handle:
    tess_mlx_sha = hashlib.file_digest(handle, "sha256").hexdigest()
tess_mlx_relative = "share/tess-server/mlx/tess-mlx-manifest.json"
manifest["files"][tess_mlx_relative] = {
    "sha256": tess_mlx_sha,
    "bytes": os.path.getsize(tess_mlx_path),
}
manifest["signing"] = {
    # Preserve the established install-time primary-binary contract while the
    # complete code map attests every nested executable and dylib.
    "binary": {
        "identity_authority": authority,
        "team_id": team_id,
        "hardened_runtime": True,
        "secure_timestamp": True,
        "pre_sign_sha256": primary_pre,
        "post_sign_sha256": primary_post,
    },
    "code": {
        relative: {
            "identity_authority": authority,
            "team_id": team_id,
            "hardened_runtime": True,
            "secure_timestamp": True,
            "pre_sign_sha256": pre_sha,
            "post_sign_sha256": post_sha,
        }
        for relative, (pre_sha, post_sha) in code_rows.items()
    },
    "container": {"format": "dmg", "notarization": "performed after image construction"},
}
manifest["artifact"] = dmg_name
with open(path, "w", encoding="utf-8") as handle:
    json.dump(manifest, handle, indent=2)
    handle.write("\n")
PY
(cd "$PAYLOAD" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | sort | xargs shasum -a 256 > SHA256SUMS)
(cd "$PAYLOAD" && shasum -a 256 -c SHA256SUMS >/dev/null)

DMG="$WORK_PUBLIC/$DMG_NAME"
hdiutil create -quiet -fs 'Journaled HFS+' -format UDZO -volname "Tess Server $VERSION" -srcfolder "$PAYLOAD" "$DMG"
hdiutil verify "$DMG" >/dev/null
codesign --force --timestamp --sign "$IDENTITY" "$DMG"
codesign --verify --strict --verbose=2 "$DMG"

NOTARY_JSON="$OUTPUT_ROOT/private/notary-result.json"
xcrun notarytool submit "$DMG" --keychain-profile "$NOTARY_PROFILE" --wait --timeout 1h --output-format json > "$NOTARY_JSON"
NOTARY_STATUS=$(plutil -extract status raw -o - "$NOTARY_JSON")
NOTARY_ID=$(plutil -extract id raw -o - "$NOTARY_JSON")
[ "$NOTARY_STATUS" = "Accepted" ] || { echo "notarization did not return Accepted; see $NOTARY_JSON" >&2; exit 1; }
NOTARY_LOG="$OUTPUT_ROOT/private/notary-log.json"
xcrun notarytool log "$NOTARY_ID" "$NOTARY_LOG" --keychain-profile "$NOTARY_PROFILE"
python3 - "$NOTARY_LOG" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    log = json.load(handle)
issues = log.get("issues", [])
if issues:
    raise SystemExit(f"notarization log contains {len(issues)} issue(s)")
PY
xcrun stapler staple -v "$DMG"
xcrun stapler validate -v "$DMG"
hdiutil verify "$DMG" >/dev/null
codesign --verify --strict --verbose=2 "$DMG"
spctl --assess --type open --context context:primary-signature --verbose=2 "$DMG"

mkdir -p "$MOUNT_POINT"
hdiutil attach -readonly -nobrowse -mountpoint "$MOUNT_POINT" "$DMG" >/dev/null
MOUNTED=1
(cd "$MOUNT_POINT" && shasum -a 256 -c SHA256SUMS >/dev/null)
SPACE_COPY="$WORK_ROOT/path with spaces/Tess Server $VERSION"
mkdir -p "$(dirname -- "$SPACE_COPY")"
ditto "$MOUNT_POINT" "$SPACE_COPY"
COPY_VERSION=$("$SPACE_COPY/bin/tess-server" --version-json | plutil -extract version raw -o - -)
[ "$COPY_VERSION" = "$VERSION" ] || { echo "relocated signed payload version mismatch" >&2; exit 1; }
codesign --verify --strict --verbose=2 "$SPACE_COPY/bin/tess-server"
spctl --assess --type execute --verbose=2 "$SPACE_COPY/bin/tess-server"
for code in \
  "$SPACE_COPY/bin/upstream/tess-server" \
  "$SPACE_COPY/bin/mlx/libjaccl.dylib" \
  "$SPACE_COPY/bin/mlx/libmlx.dylib" \
  "$SPACE_COPY/bin/mlx/tess-mlx-server"; do
  codesign --verify --strict --verbose=2 "$code"
done
MLX_COPY_VERSION=$("$SPACE_COPY/bin/mlx/tess-mlx-server" --version-json | plutil -extract version raw -o - -)
[ "$MLX_COPY_VERSION" = "$VERSION" ] || { echo "relocated Tess MLX server version mismatch" >&2; exit 1; }
spctl --assess --type execute --verbose=2 "$SPACE_COPY/bin/upstream/tess-server"
spctl --assess --type execute --verbose=2 "$SPACE_COPY/bin/mlx/tess-mlx-server"
hdiutil detach "$MOUNT_POINT" >/dev/null
MOUNTED=0

DMG_SHA=$(shasum -a 256 "$DMG" | awk '{print $1}')
DMG_BYTES=$(stat -f %z "$DMG")
PAYLOAD_MANIFEST_SHA=$(shasum -a 256 "$MANIFEST" | awk '{print $1}')
PUBLIC_MANIFEST="$WORK_PUBLIC/external-manifest.json"
python3 - "$PUBLIC_MANIFEST" "$VERSION" "$BUILD_ID" "$ENGINE_COMMIT" "$UPSTREAM_MERGE_BASE" "$PACKAGING_COMMIT" "$SOURCE_ARCHIVE_SHA" "$DMG_NAME" "$DMG_SHA" "$DMG_BYTES" "$PAYLOAD_MANIFEST_SHA" "$TEAM_ID" "$AUTHORITY" "$NOTARY_ID" "$NOTARY_STATUS" <<'PY'
import json, sys
(out, version, build_id, engine_commit, upstream_merge_base, packaging_commit,
 source_archive_sha, dmg_name, dmg_sha, dmg_bytes, payload_manifest_sha,
 team_id, authority, notary_id, notary_status) = sys.argv[1:]
data = {
    "schema_version": 1,
    "product": "tess-server",
    "version": version,
    "build_id": build_id,
    "channel": "external",
    "engine_commit": engine_commit,
    "upstream_merge_base": upstream_merge_base,
    "packaging_commit": packaging_commit,
    "source_stage_archive_sha256": source_archive_sha,
    "artifact": {"name": dmg_name, "sha256": dmg_sha, "bytes": int(dmg_bytes)},
    "payload_manifest_sha256": payload_manifest_sha,
    "signing": {
        "authority": authority,
        "team_id": team_id,
        "hardened_runtime": True,
        "secure_timestamp": True,
    },
    "notarization": {"id": notary_id, "status": notary_status, "stapled": True},
    "gatekeeper_assessment": "accepted on packaging host",
}
with open(out, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY
(cd "$WORK_PUBLIC" && shasum -a 256 "$DMG_NAME" external-manifest.json > SHA256SUMS)
(cd "$WORK_PUBLIC" && shasum -a 256 -c SHA256SUMS >/dev/null)
mv "$WORK_PUBLIC" "$OUTPUT_ROOT/public"

echo "external signed release: PASS"
echo "public assets: $OUTPUT_ROOT/public"
echo "private notarization result: $NOTARY_JSON"
echo "DMG sha256: $DMG_SHA"
