#!/bin/bash
# Shared profile validation for the packaged Tess launchers. Apple system tools
# only: no Python, jq, Homebrew, or network access is required.

if [ "${TESS_PROFILE_COMMON_LOADED:-0}" = "1" ]; then
  return 0
fi
TESS_PROFILE_COMMON_LOADED=1

TESS_SCRIPTS_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TESS_PACKAGE_ROOT=${TESS_PACKAGE_ROOT:-$(CDPATH= cd -- "$TESS_SCRIPTS_DIR/.." && pwd)}
TESS_PROFILE_DIR=${TESS_PROFILE_DIR:-"$TESS_PACKAGE_ROOT/profiles"}
TESS_RUNTIME_LABEL=verified
TESS_CUSTOM_REASONS=

tess_die() {
  printf 'tess profile: %s\n' "$*" >&2
  exit 2
}

tess_note() {
  printf 'tess profile: %s\n' "$*" >&2
}

tess_profile_get() {
  /usr/bin/plutil -extract "$1" raw -o - "$TESS_PROFILE_FILE" 2>/dev/null
}

tess_json_get() {
  local key=$1
  /usr/bin/plutil -extract "$key" raw -o - - 2>/dev/null
}

tess_payload_checksum() {
  local target checksum_file value
  target=$1
  checksum_file="$TESS_PACKAGE_ROOT/SHA256SUMS"
  [ -f "$checksum_file" ] || tess_die "packaged payload SHA256SUMS is missing"
  value=$(/usr/bin/awk -v target="$target" '$2 == target {print $1}' "$checksum_file")
  [ -n "$value" ] || tess_die "packaged checksum is missing for $target"
  [ "$(printf '%s\n' "$value" | /usr/bin/wc -l | /usr/bin/tr -d ' ')" = "1" ] || tess_die "packaged checksum is ambiguous for $target"
  printf '%s\n' "$value"
}

tess_verify_payload_file() {
  local target expected actual
  target=$1
  expected=$(tess_payload_checksum "$target")
  [ -f "$TESS_PACKAGE_ROOT/$target" ] || tess_die "packaged payload file is missing: $target"
  actual=$(/usr/bin/shasum -a 256 "$TESS_PACKAGE_ROOT/$target" | /usr/bin/awk '{print $1}') || tess_die "cannot hash packaged payload file: $target"
  [ "$actual" = "$expected" ] || tess_die "packaged payload checksum mismatch: $target"
}

tess_reject_unmodeled_tuning_env() {
  local allowed key ignored
  allowed=" $* "
  while IFS='=' read -r key ignored; do
    case "$key" in
      GGML_*|LLAMA_*|MLX_*|MTL_*)
        case "$allowed" in
          *" $key "*) ;;
          *) tess_die "unmodeled tuning environment variable is set: $key; use the profile defaults or invoke tess-server directly for a custom run" ;;
        esac
        ;;
    esac
  done < <(/usr/bin/env)
}

tess_resolve_server() {
  local candidate resolved version_json product version expected_version metallib_sha
  local manifest expected_binary_sha expected_metallib_sha actual_binary_sha manifest_binary_sha manifest_metallib_sha
  local binary_rel metallib_rel metallib_manifest_key variant manifest_variant
  local field manifest_value binary_value
  variant=${TESS_ENGINE_VARIANT:-primary}
  case "$variant" in
    primary)
      binary_rel=bin/tess-server
      metallib_rel=bin/default.metallib
      metallib_manifest_key='bin/default\.metallib'
      ;;
    upstream)
      binary_rel=bin/upstream/tess-server
      metallib_rel=bin/upstream/default.metallib
      metallib_manifest_key='bin/upstream/default\.metallib'
      ;;
    *) tess_die "unknown packaged engine variant: $variant" ;;
  esac
  if [ -n "${TESS_SERVER:-}" ]; then
    candidate=$TESS_SERVER
  elif [ -x "$TESS_PACKAGE_ROOT/$binary_rel" ]; then
    candidate="$TESS_PACKAGE_ROOT/$binary_rel"
  else
    tess_die "packaged $variant engine is missing: $binary_rel"
  fi

  case "$candidate" in
    */*)
      [ -x "$candidate" ] || tess_die "tess-server binary is not executable; set TESS_SERVER to the packaged binary"
      resolved=$candidate
      ;;
    *)
      resolved=$(command -v "$candidate" 2>/dev/null) || tess_die "tess-server binary not found; set TESS_SERVER or put it on PATH"
      ;;
  esac
  case "$resolved" in
    */*) resolved=$(CDPATH= cd -- "$(dirname -- "$resolved")" && pwd)/$(basename -- "$resolved") ;;
  esac
  TESS_SERVER=$resolved

  manifest="$TESS_PACKAGE_ROOT/share/tess-server/manifest.json"
  [ -f "$manifest" ] || tess_die "packaged release manifest is missing"
  tess_verify_payload_file share/tess-server/manifest.json
  if [ -n "${TESS_PROFILE_ID:-}" ]; then
    manifest_variant=$(/usr/bin/plutil -extract "profiles.$TESS_PROFILE_ID.engine_variant" raw -o - "$manifest" 2>/dev/null) || tess_die "release manifest lacks the engine route for $TESS_PROFILE_ID"
    [ "$manifest_variant" = "$variant" ] || tess_die "runtime and release manifest disagree on the engine route for $TESS_PROFILE_ID"
  fi
  expected_binary_sha=$(tess_payload_checksum "$binary_rel")
  expected_metallib_sha=$(tess_payload_checksum "$metallib_rel")
  tess_verify_payload_file "$metallib_rel"
  actual_binary_sha=$(/usr/bin/shasum -a 256 "$TESS_SERVER" | /usr/bin/awk '{print $1}') || tess_die "cannot hash selected tess-server binary"
  [ "$actual_binary_sha" = "$expected_binary_sha" ] || tess_die "selected tess-server does not match the packaged $variant engine checksum"
  manifest_binary_sha=$(/usr/bin/plutil -extract "files.$binary_rel.sha256" raw -o - "$manifest" 2>/dev/null) || tess_die "release manifest lacks the $variant binary checksum"
  [ "$manifest_binary_sha" = "$expected_binary_sha" ] || tess_die "release manifest and payload checksum disagree for the $variant engine"
  manifest_metallib_sha=$(/usr/bin/plutil -extract "files.$metallib_manifest_key.sha256" raw -o - "$manifest" 2>/dev/null) || tess_die "release manifest lacks the $variant metallib checksum"
  [ "$manifest_metallib_sha" = "$expected_metallib_sha" ] || tess_die "release manifest and payload checksum disagree for the $variant metallib"

  if [ "$variant" = upstream ]; then
    [ "$TESS_SERVER" = "$TESS_PACKAGE_ROOT/$binary_rel" ] || tess_die "the upstream profile engine must run from its checksum-bound package directory"
    return 0
  fi

  version_json=$("$TESS_SERVER" --version-json 2>/dev/null) || tess_die "binary does not provide the Tess --version-json contract"
  product=$(printf '%s\n' "$version_json" | tess_json_get product) || tess_die "invalid --version-json output"
  [ "$product" = "tess-server" ] || tess_die "selected binary is not a Tess product build"
  version=$(printf '%s\n' "$version_json" | tess_json_get version) || tess_die "version missing from --version-json"
  expected_version=$(tess_profile_get engine.min_version) || tess_die "profile engine version is missing"
  [ "$version" = "$expected_version" ] || tess_die "profile requires Tess $expected_version; selected binary is $version"
  metallib_sha=$(printf '%s\n' "$version_json" | tess_json_get metallib_sha256) || tess_die "metallib hash missing from --version-json"
  [ -n "$metallib_sha" ] || tess_die "default.metallib is missing beside tess-server"

  for field in product version build_id engine_commit upstream_merge_base distribution; do
    manifest_value=$(/usr/bin/plutil -extract "$field" raw -o - "$manifest" 2>/dev/null) || tess_die "release manifest is missing $field"
    binary_value=$(printf '%s\n' "$version_json" | tess_json_get "$field") || tess_die "version JSON is missing $field"
    [ "$manifest_value" = "$binary_value" ] || tess_die "binary/release manifest mismatch: $field"
  done

  [ "$metallib_sha" = "$expected_metallib_sha" ] || tess_die "selected default.metallib does not match the packaged metallib checksum"
}

tess_profile_engine_variant() {
  case "$1" in
    dsv4-dspark|dsv4-0731-dspark|minimax-m27-iq4xs) printf '%s\n' upstream ;;
    *) printf '%s\n' primary ;;
  esac
}

tess_profile_begin() {
  local expected_id actual_id
  expected_id=$1
  TESS_PROFILE_FILE="$TESS_PROFILE_DIR/$expected_id.json"
  [ -f "$TESS_PROFILE_FILE" ] || tess_die "profile descriptor not found: $expected_id.json"
  [ "$TESS_PROFILE_FILE" = "$TESS_PACKAGE_ROOT/profiles/$expected_id.json" ] || tess_die "verified launch requires the packaged profile descriptor"
  tess_verify_payload_file "profiles/$expected_id.json"
  actual_id=$(tess_profile_get profile_id) || tess_die "profile_id missing from $expected_id.json"
  [ "$actual_id" = "$expected_id" ] || tess_die "profile ID does not match its filename"
  TESS_PROFILE_ID=$actual_id
  TESS_ENGINE_VARIANT=$(tess_profile_engine_variant "$TESS_PROFILE_ID")
  tess_resolve_server
}

tess_mark_custom() {
  local key actual expected
  key=$1
  actual=$2
  expected=$3
  if [ "$actual" != "$expected" ]; then
    TESS_RUNTIME_LABEL=custom
    if [ -n "$TESS_CUSTOM_REASONS" ]; then
      TESS_CUSTOM_REASONS="$TESS_CUSTOM_REASONS, "
    fi
    TESS_CUSTOM_REASONS="${TESS_CUSTOM_REASONS}${key}=${actual} (verified ${expected})"
  fi
}

tess_require_single_slot() {
  [ "$1" = "1" ] || tess_die "profile $TESS_PROFILE_ID requires exactly one slot; NP=$1 is unsafe"
}

tess_require_uint() {
  local key value
  key=$1
  value=$2
  case "$value" in
    ''|*[!0-9]*) tess_die "$key must be a non-negative integer" ;;
  esac
}

tess_validate_server_settings() {
  local permissions key_bytes
  PORT=${PORT:-8787}
  ALIAS=${ALIAS:-local-llama-server}
  tess_require_uint PORT "$PORT"
  [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || tess_die "PORT must be between 1024 and 65535"
  [ -n "$ALIAS" ] || tess_die "ALIAS must not be empty"
  case "$ALIAS" in
    *$'\n'*|*$'\r'*|*$'\t'*) tess_die "ALIAS must not contain control characters" ;;
  esac
  TESS_SERVER_AUTH_ARGS=()
  TESS_AUTH_MODE=off
  if [ -n "${API_KEY_FILE:-}" ]; then
    [ ! -L "$API_KEY_FILE" ] || tess_die "API_KEY_FILE must not be a symbolic link"
    [ -f "$API_KEY_FILE" ] && [ -r "$API_KEY_FILE" ] || tess_die "API_KEY_FILE must be a readable regular file"
    permissions=$(/usr/bin/stat -f %Lp "$API_KEY_FILE" 2>/dev/null) || tess_die "cannot inspect API_KEY_FILE permissions"
    case "$permissions" in *00) ;; *) tess_die "API_KEY_FILE permissions must deny group/other access" ;; esac
    key_bytes=$(/usr/bin/tr -d '[:space:]' < "$API_KEY_FILE" | /usr/bin/wc -c | /usr/bin/tr -d ' ')
    [ "$key_bytes" -ge 32 ] || tess_die "API_KEY_FILE must contain at least 32 non-whitespace characters"
    TESS_SERVER_AUTH_ARGS=(--api-key-file "$API_KEY_FILE")
    TESS_AUTH_MODE=bearer
  fi
}

tess_exec_server() {
  if [ "$TESS_AUTH_MODE" = "bearer" ]; then
    exec "$TESS_SERVER" "$@" --api-key-file "$API_KEY_FILE"
  fi
  exec "$TESS_SERVER" "$@"
}

tess_preflight_port() {
  if [ -x /usr/sbin/lsof ] && /usr/sbin/lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    tess_die "127.0.0.1:$PORT is already in use; choose another port in Configure Server"
  fi
}

tess_cache_root() {
  if [ -n "${TESS_HASH_CACHE_DIR:-}" ]; then
    printf '%s\n' "$TESS_HASH_CACHE_DIR"
  elif [ -n "${XDG_CACHE_HOME:-}" ]; then
    printf '%s\n' "$XDG_CACHE_HOME/tess-server/model-hashes-v1"
  else
    printf '%s\n' "$HOME/Library/Caches/Tess/server/model-hashes-v1"
  fi
}

tess_verify_file() {
  local path expected_name expected_bytes expected_sha actual_name actual_bytes signature
  local cache_root cache_file cached_signature actual_sha cache_tmp
  path=$1
  expected_name=$2
  expected_bytes=$3
  expected_sha=$4

  [ -f "$path" ] || tess_die "required model file is missing: $expected_name"
  actual_name=$(basename -- "$path")
  [ "$actual_name" = "$expected_name" ] || tess_die "model filename mismatch: expected $expected_name, got $actual_name"
  actual_bytes=$(/usr/bin/stat -f %z "$path" 2>/dev/null) || tess_die "cannot stat model file: $expected_name"
  [ "$actual_bytes" = "$expected_bytes" ] || tess_die "model size mismatch: $expected_name"

  signature=$(/usr/bin/stat -f '%d:%i:%z:%m:%c' "$path" 2>/dev/null) || tess_die "cannot read model metadata: $expected_name"
  cache_root=$(tess_cache_root)
  /bin/mkdir -p "$cache_root" || tess_die "cannot create model verification cache"
  /bin/chmod 700 "$cache_root" 2>/dev/null || true
  cache_file="$cache_root/$expected_sha"
  if [ -f "$cache_file" ]; then
    cached_signature=$(/bin/cat "$cache_file" 2>/dev/null || true)
    if [ "$cached_signature" = "$signature" ]; then
      tess_note "hash verified (cached): $expected_name"
      return 0
    fi
  fi

  tess_note "hashing $expected_name (first verified use only)"
  actual_sha=$(/usr/bin/shasum -a 256 "$path" 2>/dev/null | /usr/bin/awk '{print $1}') || tess_die "cannot hash model file: $expected_name"
  [ "$actual_sha" = "$expected_sha" ] || tess_die "model SHA-256 mismatch: $expected_name"
  cache_tmp="$cache_file.$$"
  (umask 077 && printf '%s\n' "$signature" > "$cache_tmp") || tess_die "cannot write model verification cache"
  /bin/mv -f "$cache_tmp" "$cache_file" || tess_die "cannot update model verification cache"
  tess_note "hash verified: $expected_name"
}

tess_verify_collection() {
  local collection first_path directory index name bytes sha path
  collection=$1
  first_path=$2
  directory=$(dirname -- "$first_path")
  index=0
  while name=$(tess_profile_get "$collection.$index.name"); do
    bytes=$(tess_profile_get "$collection.$index.bytes") || tess_die "bytes missing for $name"
    sha=$(tess_profile_get "$collection.$index.sha256") || tess_die "sha256 missing for $name"
    if [ "$index" = "0" ]; then
      path=$first_path
    else
      path="$directory/$name"
    fi
    tess_verify_file "$path" "$name" "$bytes" "$sha"
    index=$((index + 1))
  done
  [ "$index" -gt 0 ] || tess_die "profile collection is empty: $collection"
}

tess_verify_profile_files() {
  local model_path draft_path draft_name
  model_path=$1
  draft_path=${2:-}
  if [ "${ALLOW_UNVERIFIED_MODEL:-0}" = "1" ]; then
    TESS_RUNTIME_LABEL=custom
    TESS_CUSTOM_REASONS="${TESS_CUSTOM_REASONS}${TESS_CUSTOM_REASONS:+, }model hash verification skipped"
    tess_note "WARNING: model hash verification skipped; runtime label is custom"
    return 0
  fi

  tess_verify_collection shards "$model_path"
  if draft_name=$(tess_profile_get draft.0.name); then
    if [ "${TESS_DRAFT_OPTIONAL:-0}" = "1" ] && [ -z "$draft_path" ]; then
      tess_note "draft verification: not required by resolved target-only configuration"
    else
      [ -n "$draft_path" ] || tess_die "profile requires draft artifact: $draft_name"
      tess_verify_collection draft "$draft_path"
    fi
  elif [ -n "$draft_path" ]; then
    tess_die "profile does not accept a separate draft artifact"
  fi
}

tess_runtime_link_root() {
  if [ -n "${TESS_RUNTIME_LINK_DIR:-}" ]; then
    printf '%s\n' "$TESS_RUNTIME_LINK_DIR/$TESS_PROFILE_ID"
  elif [ -n "${XDG_CACHE_HOME:-}" ]; then
    printf '%s\n' "$XDG_CACHE_HOME/tess-server/runtime-links-v1/$TESS_PROFILE_ID"
  else
    printf '%s\n' "$HOME/Library/Caches/Tess/server/runtime-links-v1/$TESS_PROFILE_ID"
  fi
}

tess_link_collection() {
  local collection first_path runtime_root directory index name source destination
  collection=$1
  first_path=$2
  runtime_root=$3
  directory=$(dirname -- "$first_path")
  index=0
  while name=$(tess_profile_get "$collection.$index.name"); do
    if [ "$index" = "0" ]; then
      source=$first_path
    else
      source="$directory/$name"
    fi
    [ -f "$source" ] || tess_die "required model file is missing: $name"
    destination="$runtime_root/$name"
    if [ -e "$destination" ] && [ ! -L "$destination" ]; then
      tess_die "runtime link path is not a symlink: $name"
    fi
    /bin/ln -sfn "$source" "$destination" || tess_die "cannot prepare private runtime link: $name"
    if [ "$index" = "0" ]; then
      if [ "$collection" = "shards" ]; then
        TESS_RUNTIME_MODEL=$name
      else
        TESS_RUNTIME_DRAFT=$name
      fi
    fi
    index=$((index + 1))
  done
}

tess_prepare_runtime_links() {
  local model_path draft_path runtime_root draft_name
  model_path=$1
  draft_path=${2:-}
  runtime_root=$(tess_runtime_link_root)
  /bin/mkdir -p "$runtime_root" || tess_die "cannot create private runtime-link directory"
  /bin/chmod 700 "$runtime_root" 2>/dev/null || true
  TESS_RUNTIME_DIR=$runtime_root
  TESS_RUNTIME_MODEL=
  TESS_RUNTIME_DRAFT=
  tess_link_collection shards "$model_path" "$runtime_root"
  if draft_name=$(tess_profile_get draft.0.name); then
    if [ "${TESS_DRAFT_OPTIONAL:-0}" != "1" ] || [ -n "$draft_path" ]; then
      [ -n "$draft_path" ] || tess_die "profile requires draft artifact: $draft_name"
      tess_link_collection draft "$draft_path" "$runtime_root"
    fi
  fi
}

tess_print_effective_config() {
  local item
  printf 'profile_id=%s\n' "$TESS_PROFILE_ID"
  printf 'runtime_label=%s\n' "$TESS_RUNTIME_LABEL"
  if [ -n "$TESS_CUSTOM_REASONS" ]; then
    printf 'custom_reasons=%s\n' "$TESS_CUSTOM_REASONS"
  fi
  for item in "$@"; do
    printf '%s\n' "$item"
  done
}

tess_log_runtime_label() {
  tess_note "runtime label: $TESS_RUNTIME_LABEL"
  if [ -n "$TESS_CUSTOM_REASONS" ]; then
    tess_note "custom overrides: $TESS_CUSTOM_REASONS"
  fi
}
