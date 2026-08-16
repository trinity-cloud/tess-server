#!/bin/bash
# Qwen3.5-122B-A10B Q4_K_M with target-only hybrid-attention serving.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../profile-common.sh"
tess_reject_unmodeled_tuning_env
tess_validate_server_settings
MODEL=${MODEL:?path to Qwen3.5-122B-A10B Q4_K_M shard 00001}; CTX=${CTX:-16384}; NP=${NP:-1}
[ -z "${UB+x}" ] || tess_die "UB is locked at 2048 for Qwen3.5-122B-A10B"
[ -z "${BATCH+x}" ] || tess_die "BATCH is locked at 2048 for Qwen3.5-122B-A10B"
tess_require_uint CTX "$CTX"
case "$CTX" in
  8192|16384|32768|65536|131072|262144) ;;
  *) tess_die "unsupported Qwen3.5-122B context; choose 8192, 16384, 32768, 65536, 131072, or 262144" ;;
esac
BATCH=2048; UB=2048
tess_profile_begin qwen35-122b-a10b-q4km
tess_require_single_slot "$NP"
if [ "$CTX" -gt 16384 ]; then tess_mark_custom QUALIFICATION pending qualified; fi

if [ "${PRINT_CONFIG:-0}" = 1 ]; then
  tess_print_effective_config "model=$(basename -- "$MODEL")" "context=$CTX" "batch=$BATCH" "ubatch=$UB" "slots=$NP" "kv_type=f16" "speculation=off" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi
tess_preflight_port
tess_verify_profile_files "$MODEL"
tess_prepare_runtime_links "$MODEL"
tess_log_runtime_label
cd "$TESS_RUNTIME_DIR"
tess_exec_server -m "$TESS_RUNTIME_MODEL" -c "$CTX" -b "$BATCH" -ub "$UB" -np "$NP" -ngl 99 -fa on --jinja --metrics --slots --no-webui --no-ui-mcp-proxy --no-agent --alias "$ALIAS" --host 127.0.0.1 --port "$PORT"
