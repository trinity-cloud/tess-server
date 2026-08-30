#!/bin/bash
set -euo pipefail

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
TEST_ROOT=$(mktemp -d /tmp/tess-profile-test.XXXXXX)
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$TEST_ROOT/bin/upstream" "$TEST_ROOT/bin/mlx" "$TEST_ROOT/profiles" "$TEST_ROOT/models/mlx" "$TEST_ROOT/cache" "$TEST_ROOT/share/tess-server/mlx"
printf 'sample\n' > "$TEST_ROOT/models/sample.gguf"
printf 'index!\n' > "$TEST_ROOT/models/mlx/model.safetensors.index.json"
MLX_INDEX_BYTES=$(stat -f %z "$TEST_ROOT/models/mlx/model.safetensors.index.json")
MLX_INDEX_SHA=$(shasum -a 256 "$TEST_ROOT/models/mlx/model.safetensors.index.json" | awk '{print $1}')
printf 'mlx library fixture\n' > "$TEST_ROOT/bin/mlx/libmlx.dylib"
printf 'jaccl library fixture\n' > "$TEST_ROOT/bin/mlx/libjaccl.dylib"
printf 'mlx metallib fixture\n' > "$TEST_ROOT/bin/mlx/mlx.metallib"
printf '{"profile":"fixture"}\n' > "$TEST_ROOT/share/tess-server/mlx/model-profile.json"
MLX_LIBRARY_SHA=$(shasum -a 256 "$TEST_ROOT/bin/mlx/libmlx.dylib" | awk '{print $1}')
MLX_METALLIB_SHA=$(shasum -a 256 "$TEST_ROOT/bin/mlx/mlx.metallib" | awk '{print $1}')
printf 'metallib fixture\n' > "$TEST_ROOT/bin/default.metallib"
SAMPLE_BYTES=$(stat -f %z "$TEST_ROOT/models/sample.gguf")
SAMPLE_SHA=$(shasum -a 256 "$TEST_ROOT/models/sample.gguf" | awk '{print $1}')
METALLIB_SHA=$(shasum -a 256 "$TEST_ROOT/bin/default.metallib" | awk '{print $1}')
printf 'upstream metallib fixture\n' > "$TEST_ROOT/bin/upstream/default.metallib"
UPSTREAM_METALLIB_SHA=$(shasum -a 256 "$TEST_ROOT/bin/upstream/default.metallib" | awk '{print $1}')

cat > "$TEST_ROOT/bin/tess-server" <<MOCK
#!/bin/bash
if [ "\${1:-}" = "--version-json" ]; then
  printf '%s\n' '{"product":"tess-server","version":"0.1.0-rc.1","build_id":"fixture","engine_commit":"fixture123","upstream_merge_base":"fixture-base","distribution":"unsigned-dev","metallib_sha256":"$METALLIB_SHA"}'
  exit 0
fi
exit 2
MOCK
chmod 755 "$TEST_ROOT/bin/tess-server"
SERVER_SHA=$(shasum -a 256 "$TEST_ROOT/bin/tess-server" | awk '{print $1}')

cat > "$TEST_ROOT/bin/upstream/tess-server" <<'MOCK'
#!/bin/bash
exit 2
MOCK
chmod 755 "$TEST_ROOT/bin/upstream/tess-server"
UPSTREAM_SERVER_SHA=$(shasum -a 256 "$TEST_ROOT/bin/upstream/tess-server" | awk '{print $1}')

cat > "$TEST_ROOT/bin/mlx/tess-mlx-server" <<MOCK
#!/bin/bash
if [ "\${1:-}" = "--version-json" ]; then
  printf '%s\n' '{"product":"tess-mlx-server","version":"0.1.6","build_id":"mlx-fixture","engine_commit":"mlx-engine-fixture","mlx_commit":"mlx-upstream-fixture","distribution":"internal-adhoc","libmlx_sha256":"$MLX_LIBRARY_SHA","metallib_sha256":"$MLX_METALLIB_SHA"}'
  exit 0
fi
exit 2
MOCK
chmod 755 "$TEST_ROOT/bin/mlx/tess-mlx-server"
cat > "$TEST_ROOT/share/tess-server/mlx/tess-mlx-manifest.json" <<'JSON'
{
  "product": "tess-mlx",
  "tess_server_version": "0.1.6",
  "build_id": "mlx-fixture",
  "engine_commit": "mlx-engine-fixture",
  "mlx_commit": "mlx-upstream-fixture",
  "distribution": "internal-adhoc",
  "source_tree_clean": true,
  "policy": {"target_only": true, "python_runtime_included": false, "dspark_included": false}
}
JSON

cat > "$TEST_ROOT/share/tess-server/manifest.json" <<JSON
{
  "product": "tess-server",
  "version": "0.1.0-rc.1",
  "build_id": "fixture",
  "engine_commit": "fixture123",
  "upstream_merge_base": "fixture-base",
  "distribution": "unsigned-dev",
  "engine_variants": {
    "primary": {"binary": "bin/tess-server", "metallib": "bin/default.metallib", "product_contract": true},
    "upstream": {"binary": "bin/upstream/tess-server", "metallib": "bin/upstream/default.metallib", "product_contract": false}
  },
  "tess_mlx": {
    "version": "0.1.6",
    "build_id": "mlx-fixture",
    "engine_commit": "mlx-engine-fixture",
    "mlx_commit": "mlx-upstream-fixture",
    "distribution": "internal-adhoc"
  },
  "profiles": {
    "fixture": {"engine_variant": "primary"},
    "dsv4-dspark": {"engine_variant": "primary"},
    "dsv4-0731-dspark": {"engine_variant": "upstream"},
    "dsv4-0731-mlx-24mixed": {"engine_variant": "tess-mlx"}
  },
  "files": {
    "bin/tess-server": {"sha256": "$SERVER_SHA"},
    "bin/default.metallib": {"sha256": "$METALLIB_SHA"},
    "bin/upstream/tess-server": {"sha256": "$UPSTREAM_SERVER_SHA"},
    "bin/upstream/default.metallib": {"sha256": "$UPSTREAM_METALLIB_SHA"}
  }
}
JSON
cat > "$TEST_ROOT/profiles/fixture.json" <<JSON
{
  "profile_id": "fixture",
  "schema_version": 1,
  "engine": {"min_version": "0.1.0-rc.1", "max_version": null},
  "shards": [
    {"name": "sample.gguf", "bytes": $SAMPLE_BYTES, "sha256": "$SAMPLE_SHA"}
  ],
  "draft": null
}
JSON
cp "$TEST_ROOT/profiles/fixture.json" "$TEST_ROOT/profiles/dsv4-dspark.json"
/usr/bin/sed -i '' 's/"profile_id": "fixture"/"profile_id": "dsv4-dspark"/' "$TEST_ROOT/profiles/dsv4-dspark.json"
cp "$TEST_ROOT/profiles/fixture.json" "$TEST_ROOT/profiles/dsv4-0731-dspark.json"
/usr/bin/sed -i '' 's/"profile_id": "fixture"/"profile_id": "dsv4-0731-dspark"/' "$TEST_ROOT/profiles/dsv4-0731-dspark.json"
cat > "$TEST_ROOT/profiles/dsv4-0731-mlx-24mixed.json" <<JSON
{
  "profile_id": "dsv4-0731-mlx-24mixed",
  "schema_version": 2,
  "engine": {"min_version": "0.1.6", "max_version": null},
  "model": {"format": "mlx"},
  "shards": [
    {"name": "model.safetensors.index.json", "bytes": $MLX_INDEX_BYTES, "sha256": "$MLX_INDEX_SHA"}
  ],
  "draft": null
}
JSON
(cd "$TEST_ROOT" && shasum -a 256 bin/tess-server bin/default.metallib bin/upstream/tess-server bin/upstream/default.metallib bin/mlx/tess-mlx-server bin/mlx/libmlx.dylib bin/mlx/libjaccl.dylib bin/mlx/mlx.metallib profiles/fixture.json profiles/dsv4-dspark.json profiles/dsv4-0731-dspark.json profiles/dsv4-0731-mlx-24mixed.json share/tess-server/manifest.json share/tess-server/mlx/model-profile.json share/tess-server/mlx/tess-mlx-manifest.json > SHA256SUMS)

TESS_SERVER="$TEST_ROOT/bin/tess-server"
TESS_PACKAGE_ROOT="$TEST_ROOT"
TESS_PROFILE_DIR="$TEST_ROOT/profiles"
TESS_HASH_CACHE_DIR="$TEST_ROOT/cache"
TESS_RUNTIME_LINK_DIR="$TEST_ROOT/runtime"
. "$REPO/scripts/profile-common.sh"

tess_profile_begin fixture
[ "$TESS_ENGINE_VARIANT" = primary ]
unset TESS_SERVER
tess_profile_begin dsv4-dspark
[ "$TESS_ENGINE_VARIANT" = primary ]
[ "$TESS_SERVER" = "$TEST_ROOT/bin/tess-server" ]
unset TESS_SERVER
tess_profile_begin dsv4-0731-dspark
[ "$TESS_ENGINE_VARIANT" = upstream ]
[ "$TESS_SERVER" = "$TEST_ROOT/bin/upstream/tess-server" ]
unset TESS_SERVER
tess_profile_begin fixture
tess_profile_begin_mlx dsv4-0731-mlx-24mixed
[ "$TESS_ENGINE_VARIANT" = tess-mlx ]
tess_inspect_profile_files "$TEST_ROOT/models/mlx"
tess_resolve_mlx_server
[ "$TESS_MLX_SERVER" = "$TEST_ROOT/bin/mlx/tess-mlx-server" ]
[ "$TESS_MLX_MODEL_PROFILE" = "$TEST_ROOT/share/tess-server/mlx/model-profile.json" ]
TESS_PACKAGE_ROOT="$TEST_ROOT" TESS_PROFILE_DIR="$TEST_ROOT/profiles" "$REPO/scripts/verify-profile.sh" dsv4-0731-mlx-24mixed "$TEST_ROOT/models/mlx" >/dev/null
tess_profile_begin fixture
(cp "$TEST_ROOT/bin/default.metallib" "$TEST_ROOT/bin/default.metallib.original"
printf 'tamper\n' >> "$TEST_ROOT/bin/default.metallib"
if (tess_profile_begin fixture) >/dev/null 2>&1; then
  echo "metallib payload checksum rejection test failed" >&2
  exit 1
fi
mv "$TEST_ROOT/bin/default.metallib.original" "$TEST_ROOT/bin/default.metallib")
(cd "$TEST_ROOT"; TESS_SERVER=bin/tess-server; tess_resolve_server; [ "$TESS_SERVER" = "$TEST_ROOT/bin/tess-server" ])
cp "$TEST_ROOT/profiles/fixture.json" "$TEST_ROOT/profiles/fixture.original"
printf ' ' >> "$TEST_ROOT/profiles/fixture.json"
if (tess_profile_begin fixture) >/dev/null 2>&1; then
  echo "profile payload checksum rejection test failed" >&2
  exit 1
fi
mv "$TEST_ROOT/profiles/fixture.original" "$TEST_ROOT/profiles/fixture.json"
cp "$TEST_ROOT/bin/tess-server" "$TEST_ROOT/bin/tess-server-tampered"
printf '\n' >> "$TEST_ROOT/bin/tess-server-tampered"
if (TESS_SERVER="$TEST_ROOT/bin/tess-server-tampered"; tess_resolve_server) >/dev/null 2>&1; then
  echo "same-version binary mismatch rejection test failed" >&2
  exit 1
fi
if (GGML_UNMODELED_TEST=1; export GGML_UNMODELED_TEST; tess_reject_unmodeled_tuning_env) >/dev/null 2>&1; then
  echo "unmodeled tuning environment rejection test failed" >&2
  exit 1
fi
(GGML_MODELED_TEST=1; export GGML_MODELED_TEST; tess_reject_unmodeled_tuning_env GGML_MODELED_TEST)
if (TESS_MLX_DECODE_PREWARM=0; export TESS_MLX_DECODE_PREWARM; tess_reject_unmodeled_tuning_env) >/dev/null 2>&1; then
  echo "Tess MLX diagnostic environment rejection test failed" >&2
  exit 1
fi
(PORT=8787; ALIAS=fixture-server; unset API_KEY_FILE; tess_validate_server_settings; [ "$TESS_AUTH_MODE" = off ])
printf '%064d\n' 0 > "$TEST_ROOT/api.key"
chmod 600 "$TEST_ROOT/api.key"
(PORT=8787; ALIAS=fixture-server; API_KEY_FILE="$TEST_ROOT/api.key"; tess_validate_server_settings; [ "$TESS_AUTH_MODE" = bearer ])
if (PORT=80; ALIAS=fixture-server; unset API_KEY_FILE; tess_validate_server_settings) >/dev/null 2>&1; then
  echo "privileged port validation test failed" >&2
  exit 1
fi
chmod 644 "$TEST_ROOT/api.key"
if (PORT=8787; ALIAS=fixture-server; API_KEY_FILE="$TEST_ROOT/api.key"; tess_validate_server_settings) >/dev/null 2>&1; then
  echo "insecure API key permission test failed" >&2
  exit 1
fi
tess_inspect_profile_files "$TEST_ROOT/models/sample.gguf"
tess_inspect_profile_files "$TEST_ROOT/models/sample.gguf"
[ -z "$(find "$TEST_ROOT/cache" -type f -print -quit)" ]
cp -p "$TEST_ROOT/models/sample.gguf" "$TEST_ROOT/reference-time"
sleep 1
printf 'mutate\n' > "$TEST_ROOT/models/sample.gguf"
touch -r "$TEST_ROOT/reference-time" "$TEST_ROOT/models/sample.gguf"
# Structural inspection deliberately does not re-read same-size model content.
tess_inspect_profile_files "$TEST_ROOT/models/sample.gguf"
printf 'sample\n' > "$TEST_ROOT/models/sample.gguf"
tess_prepare_runtime_links "$TEST_ROOT/models/sample.gguf"
[ -L "$TESS_RUNTIME_DIR/sample.gguf" ]
[ "$(readlink "$TESS_RUNTIME_DIR/sample.gguf")" = "$TEST_ROOT/models/sample.gguf" ]

tess_mark_custom CTX 2048 4096
[ "$TESS_RUNTIME_LABEL" = "custom" ]

if (tess_require_single_slot 2) >/dev/null 2>&1; then
  echo "single-slot rejection test failed" >&2
  exit 1
fi

printf 'tampered\n' > "$TEST_ROOT/models/sample.gguf"
if (tess_inspect_profile_files "$TEST_ROOT/models/sample.gguf") >/dev/null 2>&1; then
  echo "tampered-file rejection test failed" >&2
  exit 1
fi

if (tess_inspect_profile_files "$TEST_ROOT/models/missing.gguf") >/dev/null 2>&1; then
  echo "missing-file rejection test failed" >&2
  exit 1
fi

NO_AUTH_OUTPUT=$(TESS_SERVER=/usr/bin/printf TESS_AUTH_MODE=off /bin/bash -c '. scripts/profile-common.sh; tess_exec_server "%s\\n" no-auth-ok')
[ "$NO_AUTH_OUTPUT" = "no-auth-ok" ] || { echo "no-auth execution helper test failed" >&2; exit 1; }

AUTH_OUTPUT=$(TESS_SERVER=/usr/bin/printf TESS_AUTH_MODE=bearer API_KEY_FILE='/tmp/key with spaces' /bin/bash -c '. scripts/profile-common.sh; tess_exec_server "%s\\n" engine-arg')
printf '%s\n' "$AUTH_OUTPUT" | grep -Fx -- engine-arg >/dev/null
printf '%s\n' "$AUTH_OUTPUT" | grep -Fx -- --api-key-file >/dev/null
printf '%s\n' "$AUTH_OUTPUT" | grep -Fx -- '/tmp/key with spaces' >/dev/null

if grep -R 'REASONING_ARGS\[@\]' "$REPO/scripts/serve" >/dev/null; then
  echo "potentially empty reasoning-array expansion remains in a launcher" >&2
  exit 1
fi
grep -F -- '--spec-dspark' "$REPO/scripts/serve/serve-dsv4.sh" >/dev/null
grep -F -- '--spec-type draft-dspark' "$REPO/scripts/serve/serve-dsv4-0731.sh" >/dev/null
grep -F -- 'exec "$TESS_MLX_SERVER"' "$REPO/scripts/serve/serve-dsv4-0731-mlx.sh" >/dev/null
if grep -E 'python|tess_mlx\.server|DSpark|draft-depth|p-min' "$REPO/scripts/serve/serve-dsv4-0731-mlx.sh" >/dev/null; then
  echo "Python or speculation residue remains in the Tess MLX launcher" >&2
  exit 1
fi
if grep -E 'native_mlx|native-manifest|tess-mlx-native|native-mlx' \
  "$REPO/scripts/profile-common.sh" "$REPO/scripts/stage-release.sh" \
  "$REPO/scripts/sign-notarize-release.sh" "$REPO/scripts/verify-npm-sidecar.mjs" \
  "$REPO/scripts/serve/serve-dsv4-0731-mlx.sh" >/dev/null; then
  echo "retired pre-release Tess MLX product naming remains" >&2
  exit 1
fi

echo "profile preflight tests: PASS"
