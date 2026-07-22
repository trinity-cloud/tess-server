#!/bin/bash
# Laguna S.2 Q4_K_M with the exact BF16 DFlash companion and managed policy.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../profile-common.sh"
tess_reject_unmodeled_tuning_env GGML_METAL_FA_GQA_NQ LLAMA_DFLASH_SWA
tess_validate_server_settings
MODEL=${MODEL:?path to laguna-s-2.1-Q4_K_M.gguf}
DRAFT_MODEL=${DRAFT_MODEL:?path to laguna-s-2.1-DFlash-BF16.gguf}
CTX=${CTX:-32768}; NP=${NP:-1}
[ -z "${UB+x}" ] || tess_die "UB is locked at 2048 for Laguna S.2"
[ -z "${BATCH+x}" ] || tess_die "BATCH is locked at 2048 for Laguna S.2"
tess_require_uint CTX "$CTX"
case "$CTX" in
  8192|16384|32768) ;;
  65536) tess_die "64K Laguna qualification is pending; use 32768 or lower" ;;
  131072) tess_die "128K begins after the 64K Laguna gate passes" ;;
  262144) tess_die "Full trained-context Laguna qualification is pending" ;;
  *) tess_die "unsupported Laguna context; choose 8192, 16384, 32768, 65536, 131072, or 262144" ;;
esac
BATCH=2048; UB=2048
export GGML_METAL_FA_GQA_NQ=${GGML_METAL_FA_GQA_NQ:-2}
export LLAMA_DFLASH_SWA=${LLAMA_DFLASH_SWA:-512}
[ "$GGML_METAL_FA_GQA_NQ" = 2 ] && [ "$LLAMA_DFLASH_SWA" = 512 ] || tess_die "Laguna verified serving requires NQ=2 and DFlash SWA=512"
tess_profile_begin laguna-s21-q4km-dflash
tess_require_single_slot "$NP"
tess_mark_custom CTX "$CTX" 32768

if [ "${PRINT_CONFIG:-0}" = 1 ]; then
  tess_print_effective_config "model=$(basename -- "$MODEL")" "draft=$(basename -- "$DRAFT_MODEL")" "context=$CTX" "batch=$BATCH" "ubatch=$UB" "slots=$NP" "kv_type=f16" "speculation=dflash" "n_max=15" "p_min=0.7" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi
tess_preflight_port
tess_verify_profile_files "$MODEL" "$DRAFT_MODEL"
tess_prepare_runtime_links "$MODEL" "$DRAFT_MODEL"
tess_log_runtime_label
cd "$TESS_RUNTIME_DIR"
tess_exec_server -m "$TESS_RUNTIME_MODEL" -md "$TESS_RUNTIME_DRAFT" -c "$CTX" -b "$BATCH" -ub "$UB" -np "$NP" -ngl 99 -fa on --jinja --metrics --slots --no-webui --no-ui-mcp-proxy --no-agent --spec-type draft-dflash --spec-draft-n-max 15 --spec-draft-n-min 0 --spec-draft-p-min 0.7 --alias "$ALIAS" --host 127.0.0.1 --port "$PORT"
