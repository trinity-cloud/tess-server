#!/bin/bash
# Stage a tess-server release archive from an RC build, per the packaging plan:
# explicit allowlist, personal-path/secret/plaintext-metal scan, manifest.json,
# minimal SPDX SBOM, SHA256SUMS, canonical tar.gz.
#
# Usage: stage-release.sh <rc-build-bin-dir> <version> <build_id> <channel>
set -euo pipefail
BIN=${1:?rc build bin dir}; VER=${2:?version}; BID=${3:?build id}; CHANNEL=${4:-internal}
BUILD_DIR=$(CDPATH= cd -- "$BIN/.." && pwd)
PROVENANCE="$BUILD_DIR/build-provenance.json"
DSYM="$BUILD_DIR/tess-server.dSYM"
UPSTREAM_BIN=${TESS_UPSTREAM_BIN:?set TESS_UPSTREAM_BIN to the clean upstream variant bin directory}
UPSTREAM_BIN=$(CDPATH= cd -- "$UPSTREAM_BIN" && pwd)
UPSTREAM_BUILD_DIR=$(CDPATH= cd -- "$UPSTREAM_BIN/.." && pwd)
UPSTREAM_PROVENANCE="$UPSTREAM_BUILD_DIR/build-provenance.json"
UPSTREAM_DSYM="$UPSTREAM_BUILD_DIR/tess-server.dSYM"
METADATA_RESTAGE=${METADATA_RESTAGE:-0}
REPO=$(cd "$(dirname "$0")/.." && pwd)
DIST_DIR=${DIST_DIR:-$REPO/dist/$BID-$CHANNEL}
NAME="tess-server-$VER-macos-arm64"
case "$CHANNEL" in
  internal|external) ;;
  *) echo "FAIL: channel must be internal or external" >&2; exit 2 ;;
esac
[ ! -e "$DIST_DIR" ] || { echo "FAIL: refusing to overwrite existing stage output: $DIST_DIR" >&2; exit 1; }
if [ "$CHANNEL" = "external" ]; then
  LICENSE_SOURCE="$REPO/LICENSE.md"
  [ -f "$LICENSE_SOURCE" ] || { echo "FAIL: external channel requires owner-approved LICENSE.md" >&2; exit 1; }
else
  LICENSE_SOURCE="$REPO/LICENSE.md"
  [ -f "$LICENSE_SOURCE" ] || LICENSE_SOURCE="$REPO/LICENSE.draft.md"
fi
[ -f "$PROVENANCE" ] || { echo "FAIL: missing measured build provenance beside bin/: $PROVENANCE" >&2; exit 1; }
[ -f "$UPSTREAM_PROVENANCE" ] || { echo "FAIL: missing upstream build provenance beside bin/: $UPSTREAM_PROVENANCE" >&2; exit 1; }
case "$METADATA_RESTAGE" in 0|1) ;; *) echo "FAIL: METADATA_RESTAGE must be 0 or 1" >&2; exit 2 ;; esac
if [ "$METADATA_RESTAGE" = 1 ]; then
  [ "$CHANNEL" = internal ] || { echo "FAIL: metadata restaging is limited to internal distributions" >&2; exit 1; }
else
  [ -d "$DSYM" ] || { echo "FAIL: matching private dSYM is missing beside bin/: $DSYM" >&2; exit 1; }
  [ -d "$UPSTREAM_DSYM" ] || { echo "FAIL: matching upstream private dSYM is missing beside bin/: $UPSTREAM_DSYM" >&2; exit 1; }
fi
if [ "${ALLOW_DIRTY_PACKAGE:-0}" != "1" ] && [ -n "$(git -C "$REPO" status --porcelain --untracked-files=all -- . ':(exclude)dist')" ]; then
  echo "FAIL: packaging inputs are dirty; commit or remove every non-dist change before release staging" >&2
  echo "Set ALLOW_DIRTY_PACKAGE=1 only for a non-release stager test." >&2
  exit 1
fi
bash -n "$REPO/scripts/build-release.sh" "$REPO/scripts/sign-notarize-release.sh" "$REPO/scripts/profile-common.sh" "$REPO/scripts/verify-profile.sh" "$REPO/scripts/install-common.sh" "$REPO/scripts/install.sh" "$REPO/scripts/rollback.sh" "$REPO/scripts/uninstall.sh" "$REPO"/scripts/serve/*.sh "$REPO"/scripts/tests/*.sh
STAGE_ROOT=$(mktemp -d /tmp/tess-stage.XXXXXX)
VERIFY_ROOT=
trap 'rm -rf "$STAGE_ROOT" ${VERIFY_ROOT:+"$VERIFY_ROOT"}' EXIT
STAGE="$STAGE_ROOT/$NAME"
mkdir -p "$STAGE/bin/upstream" "$STAGE/profiles" "$STAGE/scripts/serve" "$STAGE/share/tess-server/engines/upstream" "$STAGE/share/tess-server/licenses" "$STAGE/share/tess-server/templates"
LICENSE_FILES=(
  cpp-httplib-MIT.txt
  llama.cpp-MIT.txt
  miniaudio-MIT-0.txt
  nlohmann-json-MIT.txt
  poolside-OpenMDW-1.1.txt
  sheredom-subprocess-UNLICENSE.txt
  stb-MIT.txt
)
[ "$(find "$REPO/licenses" -maxdepth 1 -type f | wc -l | tr -d ' ')" = "${#LICENSE_FILES[@]}" ] || {
  echo "FAIL: licenses/ contains an unexpected or missing file; review the dependency inventory" >&2
  exit 1
}

# --- allowlist copy (nothing else enters) ---
cp "$BIN/tess-server"        "$STAGE/bin/tess-server"
cp "$BIN/default.metallib"   "$STAGE/bin/default.metallib"
cp "$UPSTREAM_BIN/llama-server"      "$STAGE/bin/upstream/tess-server"
cp "$UPSTREAM_BIN/default.metallib"  "$STAGE/bin/upstream/default.metallib"
cp "$REPO"/profiles/*.json   "$STAGE/profiles/"
cp "$REPO/scripts/profile-common.sh" "$REPO/scripts/verify-profile.sh" "$REPO/scripts/install-common.sh" "$REPO/scripts/install.sh" "$REPO/scripts/rollback.sh" "$REPO/scripts/uninstall.sh" "$STAGE/scripts/"
cp "$REPO"/scripts/serve/*.sh "$STAGE/scripts/serve/"
cp "$PROVENANCE"                     "$STAGE/share/tess-server/build-provenance.json"
cp "$UPSTREAM_PROVENANCE"            "$STAGE/share/tess-server/engines/upstream/build-provenance.json"
cp "$REPO/README.md"                 "$STAGE/share/tess-server/README.md"
cp "$REPO/THIRD_PARTY_NOTICES.md"    "$STAGE/share/tess-server/THIRD_PARTY_NOTICES"
cp "$REPO/templates/laguna-s21-chat-template.jinja" "$STAGE/share/tess-server/templates/"
for license_file in "${LICENSE_FILES[@]}"; do
  [ -f "$REPO/licenses/$license_file" ] || { echo "FAIL: missing license text: $license_file" >&2; exit 1; }
  cp "$REPO/licenses/$license_file" "$STAGE/share/tess-server/licenses/"
done
cp "$LICENSE_SOURCE"                 "$STAGE/share/tess-server/LICENSE"
chmod 755 "$STAGE/bin/tess-server" "$STAGE/bin/upstream/tess-server" "$STAGE/scripts/verify-profile.sh" "$STAGE/scripts/install.sh" "$STAGE/scripts/rollback.sh" "$STAGE/scripts/uninstall.sh" "$STAGE"/scripts/serve/*.sh
chmod 644 "$STAGE/bin/default.metallib" "$STAGE/bin/upstream/default.metallib" "$STAGE/scripts/profile-common.sh" "$STAGE/scripts/install-common.sh" "$STAGE"/profiles/*.json "$STAGE"/share/tess-server/engines/upstream/build-provenance.json "$STAGE"/share/tess-server/licenses/*.txt "$STAGE"/share/tess-server/templates/*.jinja

# --- product/static closure ---
file "$STAGE/bin/tess-server" | grep -q 'Mach-O 64-bit executable arm64' || { echo "FAIL: executable is not thin arm64" >&2; exit 1; }
BAD_DEPS=$(otool -L "$STAGE/bin/tess-server" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/System/Library/|/usr/lib/)' || true)
[ -z "$BAD_DEPS" ] || { echo "FAIL: non-system runtime dependency: $BAD_DEPS" >&2; exit 1; }
LOAD_COMMANDS=$(otool -l "$STAGE/bin/tess-server")
case "$LOAD_COMMANDS" in *LC_RPATH*) echo "FAIL: executable contains an RPATH" >&2; exit 1 ;; esac
BINARY_MINOS=$(vtool -show-build "$STAGE/bin/tess-server" | awk '$1 == "minos" {print $2; exit}')
BINARY_SDK=$(vtool -show-build "$STAGE/bin/tess-server" | awk '$1 == "sdk" {print $2; exit}')
[ "$BINARY_MINOS" = "15.0" ] || { echo "FAIL: executable minOS is $BINARY_MINOS, expected 15.0" >&2; exit 1; }
[ -n "$BINARY_SDK" ] || { echo "FAIL: executable SDK version is missing" >&2; exit 1; }
SYMBOLS=$(nm -m "$STAGE/bin/tess-server" 2>/dev/null)
case "$SYMBOLS" in *" non-external "*) echo "FAIL: executable still contains local symbols" >&2; exit 1 ;; esac
codesign --verify --strict "$STAGE/bin/tess-server"
BINARY_UUID=$(dwarfdump --uuid "$STAGE/bin/tess-server" | awk '{print $2}')
if [ "$METADATA_RESTAGE" = 1 ]; then
  PROVENANCE_BINARY_UUID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["outputs"]["binary_uuid"])' "$PROVENANCE")
  PROVENANCE_DSYM_UUID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["outputs"]["dsym_uuid"])' "$PROVENANCE")
  [ -n "$BINARY_UUID" ] && [ "$BINARY_UUID" = "$PROVENANCE_BINARY_UUID" ] && [ "$BINARY_UUID" = "$PROVENANCE_DSYM_UUID" ] || { echo "FAIL: binary/provenance UUID mismatch during metadata restage" >&2; exit 1; }
else
  DSYM_UUID=$(dwarfdump --uuid "$DSYM" | awk '{print $2}')
  [ -n "$BINARY_UUID" ] && [ "$BINARY_UUID" = "$DSYM_UUID" ] || { echo "FAIL: binary/private dSYM UUID mismatch" >&2; exit 1; }
fi

file "$STAGE/bin/upstream/tess-server" | grep -q 'Mach-O 64-bit executable arm64' || { echo "FAIL: upstream executable is not thin arm64" >&2; exit 1; }
UPSTREAM_HELP=$("$STAGE/bin/upstream/tess-server" --help 2>&1)
case "$UPSTREAM_HELP" in *--spec-draft-model*) ;; *) echo "FAIL: upstream executable lacks the packaged draft-model interface" >&2; exit 1 ;; esac
case "$UPSTREAM_HELP" in *draft-dspark*) ;; *) echo "FAIL: upstream executable lacks DSpark speculation" >&2; exit 1 ;; esac
UPSTREAM_BAD_DEPS=$(otool -L "$STAGE/bin/upstream/tess-server" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/System/Library/|/usr/lib/)' || true)
[ -z "$UPSTREAM_BAD_DEPS" ] || { echo "FAIL: upstream non-system runtime dependency: $UPSTREAM_BAD_DEPS" >&2; exit 1; }
UPSTREAM_LOAD_COMMANDS=$(otool -l "$STAGE/bin/upstream/tess-server")
case "$UPSTREAM_LOAD_COMMANDS" in *LC_RPATH*) echo "FAIL: upstream executable contains an RPATH" >&2; exit 1 ;; esac
UPSTREAM_BINARY_MINOS=$(vtool -show-build "$STAGE/bin/upstream/tess-server" | awk '$1 == "minos" {print $2; exit}')
UPSTREAM_BINARY_SDK=$(vtool -show-build "$STAGE/bin/upstream/tess-server" | awk '$1 == "sdk" {print $2; exit}')
[ "$UPSTREAM_BINARY_MINOS" = "15.0" ] || { echo "FAIL: upstream executable minOS is $UPSTREAM_BINARY_MINOS, expected 15.0" >&2; exit 1; }
[ -n "$UPSTREAM_BINARY_SDK" ] || { echo "FAIL: upstream executable SDK version is missing" >&2; exit 1; }
UPSTREAM_SYMBOLS=$(nm -m "$STAGE/bin/upstream/tess-server" 2>/dev/null)
case "$UPSTREAM_SYMBOLS" in *" non-external "*) echo "FAIL: upstream executable still contains local symbols" >&2; exit 1 ;; esac
codesign --verify --strict "$STAGE/bin/upstream/tess-server"
UPSTREAM_BINARY_UUID=$(dwarfdump --uuid "$STAGE/bin/upstream/tess-server" | awk '{print $2}')
if [ "$METADATA_RESTAGE" = 1 ]; then
  UPSTREAM_PROVENANCE_BINARY_UUID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["outputs"]["binary_uuid"])' "$UPSTREAM_PROVENANCE")
  UPSTREAM_PROVENANCE_DSYM_UUID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["outputs"]["dsym_uuid"])' "$UPSTREAM_PROVENANCE")
  [ -n "$UPSTREAM_BINARY_UUID" ] && [ "$UPSTREAM_BINARY_UUID" = "$UPSTREAM_PROVENANCE_BINARY_UUID" ] && [ "$UPSTREAM_BINARY_UUID" = "$UPSTREAM_PROVENANCE_DSYM_UUID" ] || { echo "FAIL: upstream binary/provenance UUID mismatch during metadata restage" >&2; exit 1; }
else
  UPSTREAM_DSYM_UUID=$(dwarfdump --uuid "$UPSTREAM_DSYM" | awk '{print $2}')
  [ -n "$UPSTREAM_BINARY_UUID" ] && [ "$UPSTREAM_BINARY_UUID" = "$UPSTREAM_DSYM_UUID" ] || { echo "FAIL: upstream binary/private dSYM UUID mismatch" >&2; exit 1; }
fi
"$REPO/scripts/tests/test-product-security.sh" "$STAGE/bin/tess-server" >/dev/null

# --- scans ---
fail=0
if strings - "$STAGE/bin/tess-server" | grep -E "/Users/[^/[:space:]]+" > "$STAGE_ROOT/pathleaks.txt" 2>/dev/null && [ -s "$STAGE_ROOT/pathleaks.txt" ]; then
  echo "WARN: personal paths in executable:"; sort -u "$STAGE_ROOT/pathleaks.txt" | head -5; fail=1
fi
if strings - "$STAGE/bin/default.metallib" | grep -cE "/Users/[^/[:space:]]+" | grep -qv '^0$'; then
  echo "WARN: personal paths in metallib"; fail=1
fi
if strings - "$STAGE/bin/upstream/tess-server" | grep -E "/Users/[^/[:space:]]+" > "$STAGE_ROOT/upstream-pathleaks.txt" 2>/dev/null && [ -s "$STAGE_ROOT/upstream-pathleaks.txt" ]; then
  echo "WARN: personal paths in upstream executable:"; sort -u "$STAGE_ROOT/upstream-pathleaks.txt" | head -5; fail=1
fi
if strings - "$STAGE/bin/upstream/default.metallib" | grep -cE "/Users/[^/[:space:]]+" | grep -qv '^0$'; then
  echo "WARN: personal paths in upstream metallib"; fail=1
fi
strings - "$STAGE/bin/upstream/default.metallib" | grep -F 'kernel_mul_mv_ext_bf16_f32_r1_2' >/dev/null || { echo "FAIL: upstream metallib lacks required BF16 pipelines" >&2; exit 1; }
if find "$STAGE" -type f \( -name "*.json" -o -name "*.jinja" -o -name "*.md" -o -name "*.sh" -o -name "*.txt" \) -print0 | xargs -0 grep -nE '/Users/[^/[:space:]]+' > "$STAGE_ROOT/text-pathleaks.txt" 2>/dev/null; then
  echo "WARN: personal paths in staged text:"; head -5 "$STAGE_ROOT/text-pathleaks.txt"; fail=1
fi
if find "$STAGE" -type f \( -name "*.json" -o -name "*.jinja" -o -name "*.md" -o -name "*.sh" -o -name "*.txt" \) -print0 | xargs -0 grep -nE 'AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY' > "$STAGE_ROOT/secrets.txt" 2>/dev/null; then
  echo "FAIL: credential-like material in staged text"; fail=1
fi
if strings - "$STAGE/bin/tess-server" | grep -E "kernel void kernel_" > "$STAGE_ROOT/metal-source.txt"; then
  echo "FAIL: plaintext Metal source in executable"; exit 1
fi
if strings - "$STAGE/bin/upstream/tess-server" | grep -E "kernel void kernel_" > "$STAGE_ROOT/upstream-metal-source.txt"; then
  echo "FAIL: plaintext Metal source in upstream executable"; exit 1
fi
RESIDUE=$(find "$STAGE" \( -name "*.metal" -o -name "*.h" -o -name "*.log" -o -name ".DS_Store" \) -print)
[ -z "$RESIDUE" ] || { echo "FAIL: source/log residue staged: $RESIDUE"; exit 1; }

# --- manifest ---
EXE_SHA=$(openssl dgst -sha256 -r "$STAGE/bin/tess-server" | awk '{print $1}')
LIB_SHA=$(openssl dgst -sha256 -r "$STAGE/bin/default.metallib" | awk '{print $1}')
UPSTREAM_EXE_SHA=$(openssl dgst -sha256 -r "$STAGE/bin/upstream/tess-server" | awk '{print $1}')
UPSTREAM_LIB_SHA=$(openssl dgst -sha256 -r "$STAGE/bin/upstream/default.metallib" | awk '{print $1}')
VJ=$("$STAGE/bin/tess-server" --version-json)
python3 - "$STAGE" "$NAME" "$VER" "$BID" "$CHANNEL" "$EXE_SHA" "$LIB_SHA" "$UPSTREAM_EXE_SHA" "$UPSTREAM_LIB_SHA" "$REPO" "$BINARY_MINOS" "$BINARY_SDK" "$UPSTREAM_BINARY_MINOS" "$UPSTREAM_BINARY_SDK" << 'PY'
import datetime, glob, json, os, re, subprocess, sys
stage, name, ver, bid, channel, exe_sha, lib_sha, upstream_exe_sha, upstream_lib_sha, repo, actual_minos, actual_sdk, upstream_minos, upstream_sdk = sys.argv[1:15]
vj = json.loads(subprocess.check_output([f"{stage}/bin/tess-server", "--version-json"]))
provenance = json.load(open(f"{stage}/share/tess-server/build-provenance.json"))
upstream_provenance = json.load(open(f"{stage}/share/tess-server/engines/upstream/build-provenance.json"))
pkg_commit = subprocess.check_output(["git", "-C", repo, "rev-parse", "HEAD"], text=True).strip()
profiles = {}
upstream_profiles = {"dsv4-dspark", "dsv4-0731-dspark", "minimax-m27-iq4xs"}
for p in sorted(glob.glob(f"{stage}/profiles/*.json")):
    d = json.load(open(p))
    profiles[d["profile_id"]] = {"schema_version": d["schema_version"],
        "sha256": subprocess.check_output(["openssl","dgst","-sha256","-r",p],text=True).split()[0],
        "engine_variant": "upstream" if d["profile_id"] in upstream_profiles else "primary"}
files = {}
for p in sorted(glob.glob(f"{stage}/**/*", recursive=True)):
    if not os.path.isfile(p):
        continue
    rel = os.path.relpath(p, stage)
    files[rel] = {
        "sha256": subprocess.check_output(["openssl", "dgst", "-sha256", "-r", p], text=True).split()[0],
        "bytes": os.path.getsize(p),
    }
manifest = {
  "product": "tess-server", "version": ver, "channel": channel, "build_id": bid,
  "artifact": f"{name}.tar.gz",
  "engine_commit": vj["engine_commit"], "engine_build_number": vj["engine_build_number"],
  "upstream_merge_base": vj["upstream_merge_base"], "packaging_commit": pkg_commit,
  "engine_variants": {
    "primary": {
      "binary": "bin/tess-server", "metallib": "bin/default.metallib", "product_contract": True,
      "engine_commit": provenance["source"]["engine_commit"], "upstream_merge_base": provenance["source"]["upstream_merge_base"],
      "binary_sha256": exe_sha, "metallib_sha256": lib_sha,
    },
    "upstream": {
      "binary": "bin/upstream/tess-server", "metallib": "bin/upstream/default.metallib", "product_contract": False,
      "engine_commit": upstream_provenance["source"]["engine_commit"], "upstream_merge_base": upstream_provenance["source"]["upstream_merge_base"],
      "binary_sha256": upstream_exe_sha, "metallib_sha256": upstream_lib_sha,
    },
  },
  "toolchain": provenance["toolchain"],
  "build_target": vj["build_target"], "min_macos": vj["min_macos"],
  "distribution": vj["distribution"],
  "source": provenance["source"],
  "sources": {"primary": provenance["source"], "upstream": upstream_provenance["source"]},
  "build": provenance["build"],
  "builds": {"primary": provenance["build"], "upstream": upstream_provenance["build"]},
  "outputs": provenance["outputs"],
  "reproducibility": provenance["reproducibility"],
  "created_utc": datetime.datetime.fromtimestamp(
      int(provenance["source"]["source_date_epoch"]), datetime.timezone.utc
  ).strftime("%Y-%m-%dT%H:%M:%SZ"),
  "files": files,
  "metallib_matches_version_output": vj["metallib_sha256"] == lib_sha,
  "profiles": profiles,
  "launchers": sorted(os.path.relpath(p, stage) for p in glob.glob(f"{stage}/scripts/serve/*.sh")),
  "file_manifest_scope": "all payload files and SBOM; manifest.json and root SHA256SUMS are covered by SHA256SUMS to avoid self-reference",
  "notes": [(
      "Executable and metallib were byte-identical across two clean independent build directories; see build-provenance.json."
      if provenance["reproducibility"]["executable_byte_identical"] else
      "Executable content matched across two clean independent builds after normalizing ld64 LC_UUID and its ad-hoc signature; metallib was byte-identical."
  )],
}
if os.environ.get("METADATA_RESTAGE") == "1":
    manifest["metadata_restage"] = True
    manifest["notes"].insert(0, "Metadata-only restage from a previously checksummed release payload; executable and metallib are unchanged.")
license_text = open(f"{stage}/share/tess-server/LICENSE", encoding="utf-8").read()
license_is_draft = "DRAFT FOR OWNER REVIEW" in license_text or "Status: DRAFT" in license_text
manifest["license_status"] = "draft-internal-only" if license_is_draft else "owner-approved"
if license_is_draft:
    manifest["notes"].insert(0, "LICENSE is a draft pending owner approval (internal channel only).")
tess_license = "NOASSERTION" if license_is_draft else "LicenseRef-Tess-Proprietary"
engine_revision = provenance["source"]["engine_commit"]
upstream_revision = upstream_provenance["source"]["engine_commit"]
components = [
    ("SPDXRef-Package-tess-server", "tess-server", ver, tess_license, "Copyright 2026 Trinity Cloud, Inc.", "APPLICATION"),
    ("SPDXRef-Package-llama-cpp", "llama.cpp", engine_revision, "MIT", "Copyright (c) 2023-2026 The ggml authors", "LIBRARY"),
    ("SPDXRef-Package-ggml", "ggml", engine_revision, "MIT", "Copyright (c) 2023-2026 The ggml authors", "LIBRARY"),
    ("SPDXRef-Package-llama-cpp-upstream", "llama.cpp upstream engine variant", upstream_revision, "MIT", "Copyright (c) 2023-2026 The ggml authors", "LIBRARY"),
    ("SPDXRef-Package-ggml-upstream", "ggml upstream engine variant", upstream_revision, "MIT", "Copyright (c) 2023-2026 The ggml authors", "LIBRARY"),
    ("SPDXRef-Package-cpp-httplib", "cpp-httplib (primary engine)", "0.49.0", "MIT", "Copyright (c) 2017 yhirose", "LIBRARY"),
    ("SPDXRef-Package-cpp-httplib-upstream", "cpp-httplib (upstream engine)", "0.53.1", "MIT", "Copyright (c) 2017 yhirose", "LIBRARY"),
    ("SPDXRef-Package-nlohmann-json", "nlohmann-json", "3.12.0", "MIT", "Copyright (c) 2013-2025 Niels Lohmann", "LIBRARY"),
    ("SPDXRef-Package-stb", "stb_image", "2.30", "MIT", "Copyright (c) 2017 Sean Barrett", "LIBRARY"),
    ("SPDXRef-Package-sheredom-subprocess", "sheredom-subprocess.h", None, "Unlicense", "NOASSERTION", "LIBRARY"),
    ("SPDXRef-Package-miniaudio", "miniaudio", "0.11.25", "MIT-0", "Copyright 2026 David Reid", "LIBRARY"),
]
created = datetime.datetime.fromtimestamp(
    int(provenance["source"]["source_date_epoch"]), datetime.timezone.utc
).strftime("%Y-%m-%dT%H:%M:%SZ")
packages = []
for spdx_id, component_name, component_version, license_id, copyright_text, purpose in components:
    package = {
        "name": component_name,
        "SPDXID": spdx_id,
        "downloadLocation": "NOASSERTION",
        "filesAnalyzed": False,
        "licenseConcluded": license_id,
        "licenseDeclared": license_id,
        "copyrightText": copyright_text,
        "primaryPackagePurpose": purpose,
    }
    if component_version is not None:
        package["versionInfo"] = component_version
    if component_name == "tess-server":
        package["supplier"] = "Organization: Trinity Cloud, Inc."
    packages.append(package)
sbom = {
    "spdxVersion": "SPDX-2.3",
    "dataLicense": "CC0-1.0",
    "SPDXID": "SPDXRef-DOCUMENT",
    "name": f"{name}-sbom",
    "documentNamespace": (
        f"https://trinitycloud.ai/spdx/tess-server/{ver}/{bid}/"
        f"{provenance['source']['engine_commit']}"
    ),
    "creationInfo": {
        "created": created,
        "creators": ["Organization: Trinity Cloud, Inc.", "Tool: tess-server-stage-release"],
    },
    "documentDescribes": ["SPDXRef-Package-tess-server"],
    "packages": packages,
    "relationships": [
        {"spdxElementId": "SPDXRef-DOCUMENT", "relationshipType": "DESCRIBES", "relatedSpdxElement": "SPDXRef-Package-tess-server"}
    ] + [
        {"spdxElementId": "SPDXRef-Package-tess-server", "relationshipType": "STATIC_LINK", "relatedSpdxElement": spdx_id}
        for spdx_id, *_ in components[1:]
    ],
}
if not license_is_draft:
    sbom["hasExtractedLicensingInfos"] = [{
        "licenseId": "LicenseRef-Tess-Proprietary",
        "name": "Tess Server License",
        "extractedText": license_text,
    }]
sbom_path = f"{stage}/share/tess-server/sbom.spdx.json"
json.dump(sbom, open(sbom_path,"w"), indent=2, sort_keys=True)
manifest["files"]["share/tess-server/sbom.spdx.json"] = {
    "sha256": subprocess.check_output(["openssl", "dgst", "-sha256", "-r", sbom_path], text=True).split()[0],
    "bytes": os.path.getsize(sbom_path),
}
json.dump(manifest, open(f"{stage}/share/tess-server/manifest.json","w"), indent=2)
print("manifest + sbom written; metallib/version cross-check:", manifest["metallib_matches_version_output"])
if vj["version"] != ver:
    raise SystemExit(f"version mismatch: binary={vj['version']} requested={ver}")
if vj["build_id"] != bid:
    raise SystemExit(f"build ID mismatch: binary={vj['build_id']} requested={bid}")
for field, value in (
    ("engine commit", vj.get("engine_commit")),
    ("upstream merge base", vj.get("upstream_merge_base")),
    ("packaging commit", pkg_commit),
):
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{40}", value) is None:
        raise SystemExit(f"{field} is not an exact lowercase 40-character revision")
if vj.get("min_macos") != actual_minos:
    raise SystemExit("version JSON and Mach-O minOS mismatch")
if vj.get("build_target") != "Darwin arm64":
    raise SystemExit("version JSON build target is not Darwin arm64")
if not manifest["metallib_matches_version_output"]:
    raise SystemExit("metallib hash does not match --version-json")
if channel == "internal" and vj.get("distribution") not in {"unsigned-dev", "internal-adhoc"}:
    raise SystemExit("internal channel requires an unsigned-dev or internal-adhoc product build")
if channel == "external" and vj.get("distribution") != "developer-id":
    raise SystemExit("external channel requires a developer-id product build")
if channel == "external" and license_is_draft:
    raise SystemExit("external channel refuses the draft license")
if provenance.get("product") != "tess-server" or provenance.get("version") != ver or provenance.get("build_id") != bid:
    raise SystemExit("build provenance product/version/build ID mismatch")
if provenance.get("distribution") != vj.get("distribution"):
    raise SystemExit("build provenance distribution mismatch")
if provenance.get("source", {}).get("tree_clean") is not True:
    raise SystemExit("build provenance does not attest to a clean engine source tree")
if provenance.get("source", {}).get("engine_commit") != vj.get("engine_commit"):
    raise SystemExit("build provenance engine commit mismatch")
if provenance.get("source", {}).get("upstream_merge_base") != vj.get("upstream_merge_base"):
    raise SystemExit("build provenance upstream merge base mismatch")
if provenance.get("outputs", {}).get("tess_server_sha256") != exe_sha:
    raise SystemExit("build provenance executable hash mismatch")
if provenance.get("outputs", {}).get("default_metallib_sha256") != lib_sha:
    raise SystemExit("build provenance metallib hash mismatch")
build = provenance.get("build", {})
expected_build = {
    "type": "Release",
    "min_macos": actual_minos,
    "static": True,
    "embedded_metal_source": False,
    "ui": False,
    "openssl": False,
    "native_tuning": False,
    "stripped": True,
    "adhoc_signed": True,
}
for key, expected in expected_build.items():
    if build.get(key) != expected:
        raise SystemExit(f"build provenance {key}={build.get(key)!r}, expected {expected!r}")
if build.get("binary_sdk") != actual_sdk or provenance.get("toolchain", {}).get("sdk") != actual_sdk:
    raise SystemExit("build provenance SDK does not match the Mach-O SDK")
repro = provenance.get("reproducibility", {})
executable_reproduced = (
    repro.get("executable_byte_identical") is True or
    repro.get("executable_content_identical_after_macho_metadata_normalization") is True
)
if repro.get("independent_builds") != 2 or not executable_reproduced or not repro.get("metallib_byte_identical"):
    raise SystemExit("build provenance does not prove a reproducible double-build")

if upstream_provenance.get("product") != "tess-server" or upstream_provenance.get("version") != ver or upstream_provenance.get("build_id") != bid:
    raise SystemExit("upstream build provenance product/version/build ID mismatch")
if upstream_provenance.get("distribution") != vj.get("distribution"):
    raise SystemExit("upstream build provenance distribution mismatch")
if upstream_provenance.get("product_contract") is not False or upstream_provenance.get("binary_name") != "llama-server":
    raise SystemExit("upstream build provenance does not identify the unmodified llama-server variant")
if upstream_provenance.get("source", {}).get("tree_clean") is not True:
    raise SystemExit("upstream build provenance does not attest to a clean engine source tree")
for field in ("engine_commit", "upstream_merge_base"):
    value = upstream_provenance.get("source", {}).get(field)
    if not isinstance(value, str) or re.fullmatch(r"[0-9a-f]{40}", value) is None:
        raise SystemExit(f"upstream provenance {field} is not an exact revision")
if upstream_provenance.get("outputs", {}).get("tess_server_sha256") != upstream_exe_sha:
    raise SystemExit("upstream build provenance executable hash mismatch")
if upstream_provenance.get("outputs", {}).get("default_metallib_sha256") != upstream_lib_sha:
    raise SystemExit("upstream build provenance metallib hash mismatch")
upstream_build = upstream_provenance.get("build", {})
for key, expected in {**expected_build, "min_macos": upstream_minos}.items():
    if upstream_build.get(key) != expected:
        raise SystemExit(f"upstream build provenance {key}={upstream_build.get(key)!r}, expected {expected!r}")
if upstream_build.get("binary_sdk") != upstream_sdk or upstream_provenance.get("toolchain", {}).get("sdk") != upstream_sdk:
    raise SystemExit("upstream build provenance SDK does not match the Mach-O SDK")
upstream_repro = upstream_provenance.get("reproducibility", {})
upstream_executable_reproduced = (
    upstream_repro.get("executable_byte_identical") is True or
    upstream_repro.get("executable_content_identical_after_macho_metadata_normalization") is True
)
if upstream_repro.get("independent_builds") != 2 or not upstream_executable_reproduced or not upstream_repro.get("metallib_byte_identical"):
    raise SystemExit("upstream build provenance does not prove a reproducible double-build")
PY

# --- checksums + archive ---
( cd "$STAGE" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | sort | xargs shasum -a 256 > SHA256SUMS )
find "$STAGE" -type d -exec chmod 755 {} +
CANONICAL_EPOCH=${SOURCE_DATE_EPOCH:-$(git -C "$REPO" show -s --format=%ct HEAD)}
python3 - "$STAGE" "$CANONICAL_EPOCH" << 'PY'
import os, sys
root, epoch_raw = sys.argv[1:3]
epoch = int(epoch_raw)
for directory, subdirs, files in os.walk(root):
    for name in [*subdirs, *files]:
        os.utime(os.path.join(directory, name), (epoch, epoch), follow_symlinks=False)
os.utime(root, (epoch, epoch), follow_symlinks=False)
PY
( cd "$STAGE_ROOT" && find "$NAME" -print | LC_ALL=C sort | COPYFILE_DISABLE=1 tar --no-xattrs --format ustar --no-recursion --uid 0 --gid 0 --numeric-owner -cf "$NAME.tar" -T - && gzip -n -9 "$NAME.tar" )
ARCH_SHA=$(openssl dgst -sha256 -r "$STAGE_ROOT/$NAME.tar.gz" | awk '{print $1}')
mkdir -p "$DIST_DIR"
mv "$STAGE_ROOT/$NAME.tar.gz" "$DIST_DIR/"
cp "$STAGE/share/tess-server/manifest.json" "$DIST_DIR/"
( cd "$DIST_DIR" && shasum -a 256 "$NAME.tar.gz" manifest.json > SHA256SUMS )
VERIFY_ROOT=$(mktemp -d /tmp/tess-extract-check.XXXXXX)
tar -xzf "$DIST_DIR/$NAME.tar.gz" -C "$VERIFY_ROOT"
( cd "$VERIFY_ROOT/$NAME" && shasum -a 256 -c SHA256SUMS >/dev/null )
echo ""
echo "STAGED: $DIST_DIR/$NAME.tar.gz"
echo "archive sha256: $ARCH_SHA"
if [ $fail -eq 0 ]; then
  echo "scans: CLEAN"
  echo "extract/checksum test: PASS"
else
  echo "scans: FAILED (see above)" >&2
  exit 1
fi
