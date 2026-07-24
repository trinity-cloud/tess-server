#!/bin/bash
# Laguna S.2 Q4_K_M with the exact BF16 DFlash companion and managed policy.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../profile-common.sh"
tess_reject_unmodeled_tuning_env GGML_METAL_FA_GQA_NQ
tess_validate_server_settings
MODEL=${MODEL:?path to laguna-s-2.1-Q4_K_M.gguf}
DRAFT_MODEL=${DRAFT_MODEL:?path to laguna-s-2.1-DFlash-BF16.gguf}
CHAT_TEMPLATE_REL=share/tess-server/templates/laguna-s21-chat-template.jinja
CHAT_TEMPLATE="$TESS_PACKAGE_ROOT/$CHAT_TEMPLATE_REL"
CTX=${CTX:-16384}; NP=${NP:-1}
[ -z "${UB+x}" ] || tess_die "UB is locked at 2048 for Laguna S.2"
[ -z "${BATCH+x}" ] || tess_die "BATCH is locked at 2048 for Laguna S.2"
tess_require_uint CTX "$CTX"
case "$CTX" in
  8192|16384|32768|65536|131072|262144) ;;
  *) tess_die "unsupported Laguna context; choose 8192, 16384, 32768, 65536, 131072, or 262144" ;;
esac
BATCH=2048; UB=2048
export GGML_METAL_FA_GQA_NQ=${GGML_METAL_FA_GQA_NQ:-2}
[ "$GGML_METAL_FA_GQA_NQ" = 2 ] || tess_die "Laguna verified serving requires the managed NQ=2 policy"
tess_profile_begin laguna-s21-q4km-dflash
tess_verify_payload_file "$CHAT_TEMPLATE_REL"
tess_require_single_slot "$NP"

if [ "${PRINT_CONFIG:-0}" = 1 ]; then
  tess_print_effective_config "model=$(basename -- "$MODEL")" "draft=$(basename -- "$DRAFT_MODEL")" "context=$CTX" "batch=$BATCH" "ubatch=$UB" "slots=$NP" "kv_type=f16" "speculation=dflash" "n_max=15" "p_min=0.7" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi
tess_preflight_port
tess_verify_profile_files "$MODEL" "$DRAFT_MODEL"
tess_prepare_runtime_links "$MODEL" "$DRAFT_MODEL"
tess_log_runtime_label
cd "$TESS_RUNTIME_DIR"
tess_exec_server -m "$TESS_RUNTIME_MODEL" -md "$TESS_RUNTIME_DRAFT" -c "$CTX" -b "$BATCH" -ub "$UB" -np "$NP" -ngl 99 -fa on --jinja --chat-template-file "$CHAT_TEMPLATE" --reasoning on --reasoning-preserve --metrics --slots --no-webui --no-ui-mcp-proxy --no-agent --spec-type draft-dflash --spec-draft-n-max 15 --spec-draft-n-min 0 --spec-draft-p-min 0.7 --alias "$ALIAS" --host 127.0.0.1 --port "$PORT"
