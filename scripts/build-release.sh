#!/bin/bash
# Produce two clean Tess Server builds, a private runtime-Metal reference, and measured provenance.
set -euo pipefail

if [ "$#" -lt 4 ] || [ "$#" -gt 5 ]; then
  echo "usage: $0 <clean-engine-source> <new-build-root> <version> <build-id> [distribution]" >&2
  exit 2
fi

SOURCE=$(CDPATH= cd -- "$1" && pwd)
BUILD_ROOT=$2
VERSION=$3
BUILD_ID=$4
DISTRIBUTION=${5:-unsigned-dev}
MIN_MACOS=15.0
PRODUCT_CONTRACT=${TESS_PRODUCT_CONTRACT:-1}

case "$PRODUCT_CONTRACT" in
  0) OUTPUT_NAME=llama-server ;;
  1) OUTPUT_NAME=tess-server ;;
  *) echo "TESS_PRODUCT_CONTRACT must be 0 or 1" >&2; exit 2 ;;
esac

: "${DEVELOPER_DIR:?set DEVELOPER_DIR to the exact Xcode Developer directory used for the release}"
: "${TESS_UPSTREAM_MERGE_BASE:?set TESS_UPSTREAM_MERGE_BASE to the reviewed full upstream commit}"
export DEVELOPER_DIR

case "$BUILD_ID" in
  *[!A-Za-z0-9._-]*|'') echo "invalid build ID: $BUILD_ID" >&2; exit 2 ;;
esac
case "$VERSION" in
  *[!0-9A-Za-z.+-]*|'') echo "invalid version: $VERSION" >&2; exit 2 ;;
esac
case "$DISTRIBUTION" in
  unsigned-dev|internal-adhoc|developer-id) ;;
  *) echo "invalid distribution: $DISTRIBUTION" >&2; exit 2 ;;
esac
case "$TESS_UPSTREAM_MERGE_BASE" in
  *[!0-9a-f]*|'') echo "TESS_UPSTREAM_MERGE_BASE must be a full lowercase commit hash" >&2; exit 2 ;;
esac
[ "${#TESS_UPSTREAM_MERGE_BASE}" = "40" ] || { echo "TESS_UPSTREAM_MERGE_BASE must contain exactly 40 hex characters" >&2; exit 2; }

git -C "$SOURCE" rev-parse --is-inside-work-tree >/dev/null
if [ -n "$(git -C "$SOURCE" status --porcelain --untracked-files=all --ignored=matching)" ]; then
  echo "FAIL: engine source is not pristine (tracked, untracked, or ignored files present)" >&2
  exit 1
fi

# Freeze the audited vendored dependency set. Any update here stops the build
# until THIRD_PARTY_NOTICES, shipped license texts, and the SPDX inventory have
# been reviewed together.
if [ "$PRODUCT_CONTRACT" = 1 ]; then
  CPPHTTPLIB_VERSION=0.49.0
else
  CPPHTTPLIB_VERSION=0.53.1
fi
grep -Fq "#define CPPHTTPLIB_VERSION \"$CPPHTTPLIB_VERSION\"" "$SOURCE/vendor/cpp-httplib/httplib.h" || { echo "FAIL: unaudited cpp-httplib version" >&2; exit 1; }
grep -Fq '#define NLOHMANN_JSON_VERSION_MAJOR 3' "$SOURCE/vendor/nlohmann/json.hpp" || { echo "FAIL: unaudited nlohmann-json major version" >&2; exit 1; }
grep -Fq '#define NLOHMANN_JSON_VERSION_MINOR 12' "$SOURCE/vendor/nlohmann/json.hpp" || { echo "FAIL: unaudited nlohmann-json minor version" >&2; exit 1; }
grep -Fq '#define NLOHMANN_JSON_VERSION_PATCH 0' "$SOURCE/vendor/nlohmann/json.hpp" || { echo "FAIL: unaudited nlohmann-json patch version" >&2; exit 1; }
grep -Fq 'stb_image - v2.30' "$SOURCE/vendor/stb/stb_image.h" || { echo "FAIL: unaudited stb_image version" >&2; exit 1; }
grep -Fq '#define MA_VERSION_MAJOR    0' "$SOURCE/vendor/miniaudio/miniaudio.h" || { echo "FAIL: unaudited miniaudio major version" >&2; exit 1; }
grep -Fq '#define MA_VERSION_MINOR    11' "$SOURCE/vendor/miniaudio/miniaudio.h" || { echo "FAIL: unaudited miniaudio minor version" >&2; exit 1; }
grep -Fq '#define MA_VERSION_REVISION 25' "$SOURCE/vendor/miniaudio/miniaudio.h" || { echo "FAIL: unaudited miniaudio revision" >&2; exit 1; }
grep -Fq 'This is free and unencumbered software released into the public domain.' "$SOURCE/vendor/sheredom/subprocess.h" || { echo "FAIL: unaudited subprocess.h license" >&2; exit 1; }

ENGINE_COMMIT=$(git -C "$SOURCE" rev-parse HEAD)
ENGINE_COMMIT_SHORT=$(git -C "$SOURCE" rev-parse --short=9 HEAD)
UPSTREAM_MERGE_BASE=$(git -C "$SOURCE" rev-parse "$TESS_UPSTREAM_MERGE_BASE^{commit}")
git -C "$SOURCE" merge-base --is-ancestor "$UPSTREAM_MERGE_BASE" HEAD || {
  echo "FAIL: reviewed upstream merge base is not an ancestor of the engine revision" >&2
  exit 1
}
SOURCE_DATE_EPOCH=$(git -C "$SOURCE" show -s --format=%ct HEAD)
CMAKE=$(command -v cmake)
file "$CMAKE" | grep -q 'arm64' || { echo "FAIL: cmake is not native arm64" >&2; exit 1; }
xcodebuild -version >/dev/null
SDK_PATH=$(xcrun --sdk macosx --show-sdk-path)
SDK_VERSION=$(xcrun --sdk macosx --show-sdk-version)
CLANG=$(xcrun --sdk macosx --find clang++)
METAL=$(xcrun --sdk macosx --find metal)
METALLIB=$(xcrun --sdk macosx --find metallib)

mkdir -p "$BUILD_ROOT"
BUILD_ROOT=$(CDPATH= cd -- "$BUILD_ROOT" && pwd)
BUILD_A="$BUILD_ROOT/$BUILD_ID-a"
BUILD_B="$BUILD_ROOT/$BUILD_ID-b"
BUILD_REFERENCE="$BUILD_ROOT/$BUILD_ID-reference"
for build in "$BUILD_A" "$BUILD_B" "$BUILD_REFERENCE"; do
  if [ -e "$build" ]; then
    echo "FAIL: refusing to reuse build directory: $build" >&2
    exit 1
  fi
done

PREFIX_FLAGS="-ffile-prefix-map=$SOURCE=. -fdebug-prefix-map=$SOURCE=."
configure_build() {
  local build embed product
  local tess_args=()
  build=$1
  embed=$2
  product=$3
  if [ "$product" = "1" ]; then
    tess_args=(
      -DTESS_PRODUCT_VERSION="$VERSION"
      -DTESS_BUILD_ID="$BUILD_ID"
      -DTESS_UPSTREAM_MERGE_BASE="$UPSTREAM_MERGE_BASE"
      -DTESS_DISTRIBUTION="$DISTRIBUTION"
    )
  fi
  SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH "$CMAKE" -S "$SOURCE" -B "$build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_OSX_ARCHITECTURES=arm64 \
    -DCMAKE_OSX_DEPLOYMENT_TARGET="$MIN_MACOS" \
    -DCMAKE_OSX_SYSROOT="$SDK_PATH" \
    -DLLAMA_BUILD_COMMIT="$ENGINE_COMMIT" \
    -DCMAKE_C_COMPILER="$(xcrun --sdk macosx --find clang)" \
    -DCMAKE_CXX_COMPILER="$CLANG" \
    -DCMAKE_C_FLAGS_RELEASE="-O3 -DNDEBUG -gline-tables-only $PREFIX_FLAGS" \
    -DCMAKE_CXX_FLAGS_RELEASE="-O3 -DNDEBUG -gline-tables-only $PREFIX_FLAGS" \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_CCACHE=OFF \
    -DGGML_METAL=ON \
    -DGGML_METAL_EMBED_LIBRARY="$embed" \
    -DGGML_METAL_MACOSX_VERSION_MIN="$MIN_MACOS" \
    -DGGML_METAL_SHADER_DEBUG=OFF \
    -DGGML_NATIVE=OFF \
    -DLLAMA_BUILD_APP=OFF \
    -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_SERVER=ON \
    -DLLAMA_BUILD_TESTS=OFF \
    -DLLAMA_BUILD_UI=OFF \
    -DLLAMA_USE_PREBUILT_UI=OFF \
    -DLLAMA_OPENSSL=OFF \
    -DLLAMA_LLGUIDANCE=OFF \
    -DMTMD_VIDEO=OFF \
    ${tess_args[@]+"${tess_args[@]}"}
}

compile_upstream_metallib() {
  local build
  build=$1
  cp "$SOURCE/ggml/src/ggml-common.h" "$build/bin/ggml-common.h"
  cp "$SOURCE/ggml/src/ggml-metal/ggml-metal.metal" "$build/bin/ggml-metal.metal"
  cp "$SOURCE/ggml/src/ggml-metal/ggml-metal-impl.h" "$build/bin/ggml-metal-impl.h"
  (
    cd "$build/bin"
    "$METAL" -O3 -DGGML_METAL_HAS_BF16=1 -mmacosx-version-min="$MIN_MACOS" -c ggml-metal.metal -o default.air
    "$METALLIB" default.air -o default.metallib
    rm -f default.air ggml-common.h ggml-metal.metal ggml-metal-impl.h
  )
}

for build in "$BUILD_A" "$BUILD_B"; do
  configure_build "$build" OFF "$PRODUCT_CONTRACT"
  SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH "$CMAKE" --build "$build" --target llama-server ggml-metal-lib -j 12
  if [ "$PRODUCT_CONTRACT" = 0 ]; then
    # Current upstream's offline CMake path omits the per-device BF16 feature
    # define used by its runtime compiler. Recompile the external library with
    # that same feature so BF16 model tensors cannot request absent pipelines.
    compile_upstream_metallib "$build"
  fi
  dsymutil "$build/bin/$OUTPUT_NAME" -o "$build/tess-server.dSYM"
  strip -S -x "$build/bin/$OUTPUT_NAME"
  codesign --force --sign - --timestamp=none "$build/bin/$OUTPUT_NAME"
  codesign --verify --strict "$build/bin/$OUTPUT_NAME"
done

configure_build "$BUILD_REFERENCE" ON 0
SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH "$CMAKE" --build "$BUILD_REFERENCE" --target llama-server -j 12
strip -S -x "$BUILD_REFERENCE/bin/llama-server"
codesign --force --sign - --timestamp=none "$BUILD_REFERENCE/bin/llama-server"
codesign --verify --strict "$BUILD_REFERENCE/bin/llama-server"

EXE_BYTE_IDENTICAL=False
if cmp -s "$BUILD_A/bin/$OUTPUT_NAME" "$BUILD_B/bin/$OUTPUT_NAME"; then
  EXE_BYTE_IDENTICAL=True
else
  # ld64 assigns a fresh LC_UUID to every otherwise-identical link, and the
  # ad-hoc signature covers that UUID. Compare the executable content after
  # removing those two pieces of per-link metadata.
  NORMALIZE_DIR=$(mktemp -d /tmp/tess-macho-compare.XXXXXX)
  trap 'rm -rf "$NORMALIZE_DIR"' EXIT
  cp "$BUILD_A/bin/$OUTPUT_NAME" "$NORMALIZE_DIR/a"
  cp "$BUILD_B/bin/$OUTPUT_NAME" "$NORMALIZE_DIR/b"
  codesign --remove-signature "$NORMALIZE_DIR/a"
  codesign --remove-signature "$NORMALIZE_DIR/b"
  python3 - "$NORMALIZE_DIR/a" "$NORMALIZE_DIR/b" <<'PY'
import struct, sys
for path in sys.argv[1:]:
    data = bytearray(open(path, "rb").read())
    endian = "<" if data[:4] == b"\xcf\xfa\xed\xfe" else ">"
    ncmds = struct.unpack_from(endian + "I", data, 16)[0]
    offset = 32
    found = 0
    for _ in range(ncmds):
        command, size = struct.unpack_from(endian + "II", data, offset)
        if command == 0x1B:  # LC_UUID
            data[offset + 8:offset + 24] = b"\0" * 16
            found += 1
        offset += size
    if found != 1:
        raise SystemExit(f"FAIL: expected one LC_UUID in {path}, found {found}")
    open(path, "wb").write(data)
PY
  cmp -s "$NORMALIZE_DIR/a" "$NORMALIZE_DIR/b" || { echo "FAIL: executable content differs" >&2; exit 1; }
fi
cmp -s "$BUILD_A/bin/default.metallib" "$BUILD_B/bin/default.metallib" || { echo "FAIL: metallibs differ" >&2; exit 1; }

if [ "$PRODUCT_CONTRACT" = 1 ]; then
  VERSION_A=$($BUILD_A/bin/$OUTPUT_NAME --version-json)
  VERSION_B=$($BUILD_B/bin/$OUTPUT_NAME --version-json)
  [ "$VERSION_A" = "$VERSION_B" ] || { echo "FAIL: version JSON differs" >&2; exit 1; }
  VERSION_ENGINE_COMMIT=$(printf '%s\n' "$VERSION_A" | plutil -extract engine_commit raw -o - -)
  VERSION_UPSTREAM_BASE=$(printf '%s\n' "$VERSION_A" | plutil -extract upstream_merge_base raw -o - -)
  [ "$VERSION_ENGINE_COMMIT" = "$ENGINE_COMMIT" ] || { echo "FAIL: version JSON does not report the exact engine commit" >&2; exit 1; }
  [ "$VERSION_UPSTREAM_BASE" = "$UPSTREAM_MERGE_BASE" ] || { echo "FAIL: version JSON does not report the exact upstream merge base" >&2; exit 1; }
else
  VERSION_A=null
  VERSION_B=null
fi

EXE_SHA=$(shasum -a 256 "$BUILD_A/bin/$OUTPUT_NAME" | awk '{print $1}')
LIB_SHA=$(shasum -a 256 "$BUILD_A/bin/default.metallib" | awk '{print $1}')
REFERENCE_SHA=$(shasum -a 256 "$BUILD_REFERENCE/bin/llama-server" | awk '{print $1}')
BINARY_SDK=$(vtool -show-build "$BUILD_A/bin/$OUTPUT_NAME" | awk '$1 == "sdk" {print $2; exit}')
BINARY_MINOS=$(vtool -show-build "$BUILD_A/bin/$OUTPUT_NAME" | awk '$1 == "minos" {print $2; exit}')
BINARY_UUID=$(dwarfdump --uuid "$BUILD_A/bin/$OUTPUT_NAME" | awk '{print $2}')
DSYM_UUID=$(dwarfdump --uuid "$BUILD_A/tess-server.dSYM" | awk '{print $2}')
[ "$BINARY_MINOS" = "$MIN_MACOS" ] || { echo "FAIL: binary minOS is $BINARY_MINOS" >&2; exit 1; }
[ "$BINARY_SDK" = "$SDK_VERSION" ] || { echo "FAIL: binary SDK $BINARY_SDK != selected SDK $SDK_VERSION" >&2; exit 1; }
[ "$BINARY_UUID" = "$DSYM_UUID" ] || { echo "FAIL: binary/dSYM UUID mismatch" >&2; exit 1; }

XCODE_VERSION=$(xcodebuild -version | tr '\n' ';' | sed 's/;$//')
CMAKE_VERSION=$($CMAKE --version | head -n 1)
CLANG_VERSION=$($CLANG --version | head -n 1)
METAL_VERSION=$($METAL --version 2>&1 | head -n 1)

for build in "$BUILD_A" "$BUILD_B"; do
  python3 - "$build/build-provenance.json" "$VERSION_A" <<PY
import json, sys
out, version_raw = sys.argv[1:]
version = json.loads(version_raw)
data = {
    "schema_version": 1,
    "product": "tess-server",
    "version": "$VERSION",
    "build_id": "$BUILD_ID",
    "distribution": "$DISTRIBUTION",
    "product_contract": bool(int("$PRODUCT_CONTRACT")),
    "binary_name": "$OUTPUT_NAME",
    "source": {
        "engine_commit": "$ENGINE_COMMIT",
        "engine_commit_short": "$ENGINE_COMMIT_SHORT",
        "upstream_merge_base": "$UPSTREAM_MERGE_BASE",
        "source_date_epoch": int("$SOURCE_DATE_EPOCH"),
        "tree_clean": True,
    },
    "toolchain": {
        "cmake": "$CMAKE_VERSION",
        "xcode": "$XCODE_VERSION",
        "sdk": "$SDK_VERSION",
        "compiler": "$CLANG_VERSION",
        "metal": "$METAL_VERSION",
        "architecture": "arm64",
    },
    "build": {
        "type": "Release",
        "min_macos": "$MIN_MACOS",
        "binary_sdk": "$BINARY_SDK",
        "static": True,
        "embedded_metal_source": False,
        "ui": False,
        "openssl": False,
        "native_tuning": False,
        "stripped": True,
        "adhoc_signed": True,
    },
    "outputs": {
        "tess_server_sha256": "$EXE_SHA",
        "default_metallib_sha256": "$LIB_SHA",
        "binary_uuid": "$BINARY_UUID",
        "dsym_uuid": "$DSYM_UUID",
    },
    "private_reference": {
        "purpose": "same-source runtime-compiled Metal A/B control",
        "llama_server_sha256": "$REFERENCE_SHA",
        "embedded_metal_source": True,
        "stripped": True,
        "adhoc_signed": True,
    },
    "reproducibility": {
        "independent_builds": 2,
        "executable_byte_identical": $EXE_BYTE_IDENTICAL,
        "executable_content_identical_after_macho_metadata_normalization": True,
        "metallib_byte_identical": True,
    },
    "version_json": version,
}
with open(out, "w", encoding="utf-8") as handle:
    json.dump(data, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY
done

cmp -s "$BUILD_A/build-provenance.json" "$BUILD_B/build-provenance.json" || { echo "FAIL: provenance records differ" >&2; exit 1; }
echo "release double-build: PASS"
echo "product contract: $PRODUCT_CONTRACT"
echo "build A: $BUILD_A"
echo "build B: $BUILD_B"
echo "$OUTPUT_NAME sha256: $EXE_SHA"
echo "default.metallib sha256: $LIB_SHA"
echo "private runtime-Metal reference sha256: $REFERENCE_SHA"
echo "private dSYM UUID: $BINARY_UUID"
