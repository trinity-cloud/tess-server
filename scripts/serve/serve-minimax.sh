#!/bin/bash
# MiniMax-M2.7 UD-IQ4_XS with seven native context presets and locked ubatch 2048.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../profile-common.sh"
tess_reject_unmodeled_tuning_env
tess_validate_server_settings
MODEL=${MODEL:?path to MiniMax-M2.7 UD-IQ4_XS shard 00001}; CTX=${CTX:-71680}; NP=${NP:-1}; KV_QUALITY=${KV_QUALITY:-efficient}
[ -z "${UB+x}" ] || tess_die "UB is locked at 2048 for MiniMax"
[ -z "${BATCH+x}" ] || tess_die "BATCH is locked at 2048 for MiniMax"
tess_require_uint CTX "$CTX"
case "$CTX" in 32768|65536|71680|98304|131072|163840|196608) ;; *) tess_die "unsupported MiniMax context; choose 32768, 65536, 71680, 98304, 131072, 163840, or 196608" ;; esac
UB=2048; BATCH=2048
case "$KV_QUALITY" in
  efficient) KV_TYPE=q4_0 ;;
  balanced) tess_die "Balanced Q5_1 KV is qualification-pending" ;;
  high) tess_die "High Q8_0 KV is qualification-pending" ;;
  *) tess_die "KV_QUALITY must be efficient, balanced, or high" ;;
esac
tess_profile_begin minimax-m27-iq4xs
tess_require_single_slot "$NP"
tess_mark_custom CTX "$CTX" 71680

if [ "${PRINT_CONFIG:-0}" = 1 ]; then
  tess_print_effective_config "model=$(basename -- "$MODEL")" "context=$CTX" "batch=$BATCH" "ubatch=$UB" "slots=$NP" "kv_quality=$KV_QUALITY" "kv_type=$KV_TYPE" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi
if [ "$CTX" -gt 71680 ]; then
  REQ=129024
  CUR=$(/usr/sbin/sysctl -n iogpu.wired_limit_mb 2>/dev/null || echo 0)
  if [ "$CUR" -lt "$REQ" ] 2>/dev/null || [ "$CUR" = 0 ]; then
    echo "Contexts above 71,680 require a 129,024 MiB GPU-wired limit." >&2
    echo "Run \`sudo sysctl iogpu.wired_limit_mb=129024\` once for this boot, then relaunch." >&2
    echo "Tess Server never requests root or changes the limit itself." >&2
    exit 2
  fi
fi
tess_preflight_port
tess_inspect_profile_files "$MODEL"
tess_prepare_runtime_links "$MODEL"
tess_log_runtime_label
cd "$TESS_RUNTIME_DIR"
tess_exec_server -m "$TESS_RUNTIME_MODEL" -c "$CTX" -b "$BATCH" -ub "$UB" -np "$NP" -ngl 99 -fa on --jinja --metrics --slots --no-webui --no-ui-mcp-proxy --no-agent -ctk "$KV_TYPE" -ctv "$KV_TYPE" --alias "$ALIAS" --host 127.0.0.1 --port "$PORT"
