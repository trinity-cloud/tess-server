#!/bin/bash
set -euo pipefail

REPO=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
TEST_ROOT=$(mktemp -d /tmp/tess-profile-test.XXXXXX)
trap 'rm -rf "$TEST_ROOT"' EXIT

mkdir -p "$TEST_ROOT/bin" "$TEST_ROOT/profiles" "$TEST_ROOT/models" "$TEST_ROOT/cache" "$TEST_ROOT/share/tess-server"
printf 'sample\n' > "$TEST_ROOT/models/sample.gguf"
printf 'metallib fixture\n' > "$TEST_ROOT/bin/default.metallib"
SAMPLE_BYTES=$(stat -f %z "$TEST_ROOT/models/sample.gguf")
SAMPLE_SHA=$(shasum -a 256 "$TEST_ROOT/models/sample.gguf" | awk '{print $1}')
METALLIB_SHA=$(shasum -a 256 "$TEST_ROOT/bin/default.metallib" | awk '{print $1}')

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

cat > "$TEST_ROOT/share/tess-server/manifest.json" <<JSON
{
  "product": "tess-server",
  "version": "0.1.0-rc.1",
  "build_id": "fixture",
  "engine_commit": "fixture123",
  "upstream_merge_base": "fixture-base",
  "distribution": "unsigned-dev",
  "files": {
    "bin/tess-server": {"sha256": "$SERVER_SHA"},
    "bin/default.metallib": {"sha256": "$METALLIB_SHA"}
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
(cd "$TEST_ROOT" && shasum -a 256 bin/tess-server bin/default.metallib profiles/fixture.json share/tess-server/manifest.json > SHA256SUMS)

TESS_SERVER="$TEST_ROOT/bin/tess-server"
TESS_PACKAGE_ROOT="$TEST_ROOT"
TESS_PROFILE_DIR="$TEST_ROOT/profiles"
TESS_HASH_CACHE_DIR="$TEST_ROOT/cache"
TESS_RUNTIME_LINK_DIR="$TEST_ROOT/runtime"
. "$REPO/scripts/profile-common.sh"

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
tess_verify_profile_files "$TEST_ROOT/models/sample.gguf"
tess_verify_profile_files "$TEST_ROOT/models/sample.gguf"
[ -f "$TEST_ROOT/cache/$SAMPLE_SHA" ]
cp -p "$TEST_ROOT/models/sample.gguf" "$TEST_ROOT/reference-time"
sleep 1
printf 'mutate\n' > "$TEST_ROOT/models/sample.gguf"
touch -r "$TEST_ROOT/reference-time" "$TEST_ROOT/models/sample.gguf"
if (tess_verify_profile_files "$TEST_ROOT/models/sample.gguf") >/dev/null 2>&1; then
  echo "same-size restored-mtime tamper rejection test failed" >&2
  exit 1
fi
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
if (tess_verify_profile_files "$TEST_ROOT/models/sample.gguf") >/dev/null 2>&1; then
  echo "tampered-file rejection test failed" >&2
  exit 1
fi

ALLOW_UNVERIFIED_MODEL=1
TESS_RUNTIME_LABEL=verified
TESS_CUSTOM_REASONS=
tess_verify_profile_files "$TEST_ROOT/models/missing.gguf"
[ "$TESS_RUNTIME_LABEL" = "custom" ]

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

echo "profile preflight tests: PASS"
