#!/bin/bash
# Muse Glimmer 30B K-Quant with its exact DFlash companion and fixed short-round policy.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../profile-common.sh"
tess_reject_unmodeled_tuning_env
tess_validate_server_settings
MODEL=${MODEL:?path to muse-glimmer-30B-kquant-17gb.gguf}
DRAFT_MODEL=${DRAFT_MODEL:?path to dflash-kquant.gguf}
CTX=${CTX:-16384}; NP=${NP:-1}
[ -z "${UB+x}" ] || tess_die "UB is locked at 2048 for Muse Glimmer"
[ -z "${BATCH+x}" ] || tess_die "BATCH is locked at 2048 for Muse Glimmer"
tess_require_uint CTX "$CTX"
case "$CTX" in
  8192|16384|32768|65536|131072) ;;
  *) tess_die "unsupported Muse Glimmer context; choose 8192, 16384, 32768, 65536, or 131072" ;;
esac
BATCH=2048; UB=2048
tess_profile_begin muse-glimmer-30b-kquant-dflash
tess_require_single_slot "$NP"
if [ "$CTX" -gt 16384 ]; then tess_mark_custom QUALIFICATION pending qualified; fi

if [ "${PRINT_CONFIG:-0}" = 1 ]; then
  tess_print_effective_config "model=$(basename -- "$MODEL")" "draft=$(basename -- "$DRAFT_MODEL")" "context=$CTX" "batch=$BATCH" "ubatch=$UB" "slots=$NP" "kv_type=f16" "speculation=dflash" "n_max=3" "p_min=0.7" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi
tess_preflight_port
tess_inspect_profile_files "$MODEL" "$DRAFT_MODEL"
tess_prepare_runtime_links "$MODEL" "$DRAFT_MODEL"
tess_log_runtime_label
cd "$TESS_RUNTIME_DIR"
tess_exec_server -m "$TESS_RUNTIME_MODEL" -md "$TESS_RUNTIME_DRAFT" -c "$CTX" -b "$BATCH" -ub "$UB" -np "$NP" -ngl 99 -fa on --jinja --metrics --slots --no-webui --no-ui-mcp-proxy --no-agent --spec-type draft-dflash --spec-draft-n-max 3 --spec-draft-n-min 0 --spec-draft-p-min 0.7 --alias "$ALIAS" --host 127.0.0.1 --port "$PORT"
