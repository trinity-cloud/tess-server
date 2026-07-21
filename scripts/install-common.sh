#!/bin/bash

if [ "${TESS_INSTALL_COMMON_LOADED:-0}" = "1" ]; then
  return 0
fi
TESS_INSTALL_COMMON_LOADED=1

tess_install_die() {
  printf 'tess install: %s\n' "$*" >&2
  exit 2
}

tess_install_root() {
  printf '%s\n' "${TESS_INSTALL_ROOT:-$HOME/Library/Application Support/Tess/server}"
}

tess_validate_version() {
  case "$1" in
    ''|*[!0-9A-Za-z._-]*) tess_install_die "invalid version string in package manifest" ;;
  esac
}

tess_package_version() {
  local package_root version product
  package_root=$1
  product=$(/usr/bin/plutil -extract product raw -o - "$package_root/share/tess-server/manifest.json" 2>/dev/null) || tess_install_die "package manifest is missing or invalid"
  [ "$product" = "tess-server" ] || tess_install_die "package manifest is not for tess-server"
  version=$(/usr/bin/plutil -extract version raw -o - "$package_root/share/tess-server/manifest.json" 2>/dev/null) || tess_install_die "package version is missing"
  tess_validate_version "$version"
  printf '%s\n' "$version"
}

tess_verify_package() {
  local package_root
  package_root=$1
  [ -f "$package_root/SHA256SUMS" ] || tess_install_die "package SHA256SUMS is missing"
  (cd "$package_root" && /usr/bin/shasum -a 256 -c SHA256SUMS >/dev/null) || tess_install_die "package checksum verification failed"
}

tess_verify_binary_contract() {
  local package_root expected_version binary manifest version_json field expected actual
  local binary_metallib_sha manifest_metallib_sha actual_metallib_sha distribution expected_team actual_team
  package_root=$1
  expected_version=$2
  binary="$package_root/bin/tess-server"
  manifest="$package_root/share/tess-server/manifest.json"
  [ -x "$binary" ] || tess_install_die "package tess-server binary is missing or not executable"
  [ -f "$package_root/bin/default.metallib" ] || tess_install_die "package default.metallib is missing"
  /usr/bin/codesign --verify --strict "$binary" >/dev/null 2>&1 || tess_install_die "package binary code signature is invalid"
  version_json=$("$binary" --version-json 2>/dev/null) || tess_install_die "package binary failed its version startup check"
  for field in product version build_id engine_commit upstream_merge_base distribution; do
    expected=$(/usr/bin/plutil -extract "$field" raw -o - "$manifest" 2>/dev/null) || tess_install_die "package manifest is missing $field"
    actual=$(printf '%s\n' "$version_json" | /usr/bin/plutil -extract "$field" raw -o - - 2>/dev/null) || tess_install_die "package binary version data is missing $field"
    [ "$actual" = "$expected" ] || tess_install_die "package binary/manifest mismatch: $field"
  done
  actual=$(printf '%s\n' "$version_json" | /usr/bin/plutil -extract version raw -o - - 2>/dev/null) || tess_install_die "package binary version is invalid"
  [ "$actual" = "$expected_version" ] || tess_install_die "package binary version does not match the install destination"
  binary_metallib_sha=$(printf '%s\n' "$version_json" | /usr/bin/plutil -extract metallib_sha256 raw -o - - 2>/dev/null) || tess_install_die "package binary lacks its metallib contract"
  manifest_metallib_sha=$(/usr/bin/plutil -extract 'files.bin/default\.metallib.sha256' raw -o - "$manifest" 2>/dev/null) || tess_install_die "package manifest lacks the metallib checksum"
  actual_metallib_sha=$(/usr/bin/shasum -a 256 "$package_root/bin/default.metallib" | /usr/bin/awk '{print $1}') || tess_install_die "cannot hash package default.metallib"
  [ "$binary_metallib_sha" = "$manifest_metallib_sha" ] && [ "$actual_metallib_sha" = "$manifest_metallib_sha" ] || tess_install_die "package metallib contract is invalid"

  distribution=$(printf '%s\n' "$version_json" | /usr/bin/plutil -extract distribution raw -o - - 2>/dev/null) || tess_install_die "package binary distribution is missing"
  if [ "$distribution" = "developer-id" ]; then
    expected_team=$(/usr/bin/plutil -extract signing.binary.team_id raw -o - "$manifest" 2>/dev/null) || tess_install_die "external package manifest lacks the signing team"
    actual_team=$(/usr/bin/codesign -dvvv "$binary" 2>&1 | /usr/bin/awk -F= '$1 == "TeamIdentifier" {print $2; exit}')
    [ -n "$actual_team" ] && [ "$actual_team" = "$expected_team" ] || tess_install_die "external package signing team mismatch"
  fi
}

tess_smoke_binary() {
  local package_root binary smoke_root log pid endpoint body status attempt smoke_ok
  package_root=$1
  binary="$package_root/bin/tess-server"
  smoke_root=$(mktemp -d /tmp/tess-install-smoke.XXXXXX) || tess_install_die "cannot create startup-smoke directory"
  /bin/mkdir -p "$smoke_root/models" "$smoke_root/cache"
  log="$smoke_root/server.log"
  smoke_ok=0
  LLAMA_CACHE="$smoke_root/cache" "$binary" \
    --host 127.0.0.1 --port 0 \
    --models-dir "$smoke_root/models" --no-models-autoload \
    --no-webui --no-ui-mcp-proxy --no-agent >"$log" 2>&1 &
  pid=$!
  for ((attempt = 0; attempt < 100; attempt++)); do
    if ! /bin/kill -0 "$pid" 2>/dev/null; then
      break
    fi
    endpoint=$(/usr/bin/sed -n 's/.*listening on \(http:\/\/127\.0\.0\.1:[0-9][0-9]*\).*/\1/p' "$log" | /usr/bin/tail -1)
    if [ -n "$endpoint" ]; then
      body=$(/usr/bin/curl -fsS --max-time 2 "$endpoint/health" 2>/dev/null || true)
      status=$(printf '%s\n' "$body" | /usr/bin/plutil -extract status raw -o - - 2>/dev/null || true)
      if [ "$status" = "ok" ]; then
        smoke_ok=1
        break
      fi
    fi
    /bin/sleep 0.1
  done
  /bin/kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  /bin/rm -rf "$smoke_root"
  [ "$smoke_ok" = "1" ] || tess_install_die "package binary failed its no-model startup/health check"
}

tess_set_link() {
  local root name target link_tmp
  root=$1
  name=$2
  target=$3
  if { [ -e "$root/$name" ] || [ -L "$root/$name" ]; } && [ ! -L "$root/$name" ]; then
    tess_install_die "install root contains a non-symlink $name path; refusing to overwrite it"
  fi
  link_tmp="$root/.$name.$$"
  /bin/ln -s "$target" "$link_tmp" || tess_install_die "cannot create $name link"
  /bin/mv -f "$link_tmp" "$root/$name" || tess_install_die "cannot update $name link"
}

tess_switch_current() {
  local root version current_target
  root=$1
  version=$2
  current_target=$(/usr/bin/readlink "$root/current" 2>/dev/null || true)
  if [ -n "$current_target" ] && [ "$current_target" != "versions/$version" ]; then
    tess_set_link "$root" previous "$current_target"
  fi
  tess_set_link "$root" current "versions/$version"
}
