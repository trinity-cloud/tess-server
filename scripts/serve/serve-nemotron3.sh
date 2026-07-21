#!/bin/bash
# NVIDIA Nemotron-3-Super UD-Q4_K_M with native context and typed reasoning controls.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../profile-common.sh"
tess_reject_unmodeled_tuning_env
tess_validate_server_settings
MODEL=${MODEL:?path to Nemotron-3-Super UD-Q4_K_M shard 00001}; CTX=${CTX:-32768}; NP=${NP:-1}; REASONING=${REASONING:-full}; PRESERVE_REASONING=${PRESERVE_REASONING:-0}
[ -z "${UB+x}" ] || tess_die "UB is locked at 2048 for Nemotron"
[ -z "${BATCH+x}" ] || tess_die "BATCH is locked at 2048 for Nemotron"
tess_require_uint CTX "$CTX"
case "$CTX" in 32768|65536|131072|262144|524288|1048576) ;; *) tess_die "unsupported Nemotron context; choose 32768, 65536, 131072, 262144, 524288, or 1048576" ;; esac
case "$REASONING" in full|low|off) ;; *) tess_die "REASONING must be full, low, or off" ;; esac
[ "$PRESERVE_REASONING" = 0 ] || tess_die "reasoning-history preservation is qualification-pending"
BATCH=2048; UB=2048
tess_profile_begin nemotron3-super-q4km
tess_require_single_slot "$NP"
tess_mark_custom CTX "$CTX" 32768
tess_mark_custom REASONING "$REASONING" full

if [ "${PRINT_CONFIG:-0}" = 1 ]; then
  tess_print_effective_config "model=$(basename -- "$MODEL")" "context=$CTX" "batch=$BATCH" "ubatch=$UB" "slots=$NP" "kv_type=f16" "reasoning=$REASONING" "preserve_reasoning=false" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi
tess_preflight_port
tess_verify_profile_files "$MODEL"
tess_prepare_runtime_links "$MODEL"
tess_log_runtime_label
cd "$TESS_RUNTIME_DIR"
ARGS=(-m "$TESS_RUNTIME_MODEL" -c "$CTX" -b "$BATCH" -ub "$UB" -np "$NP" -ngl 99 -fa on --jinja --metrics --slots --no-webui --no-ui-mcp-proxy --no-agent)
case "$REASONING" in
  full) ;;
  low) ARGS+=(--reasoning on --reasoning-budget 2048) ;;
  off) ARGS+=(--reasoning off) ;;
esac
ARGS+=(--alias "$ALIAS" --host 127.0.0.1 --port "$PORT")
tess_exec_server "${ARGS[@]}"
