#!/bin/bash
# Tess-4/Qwen3.6-35B-A3B native context profile with fixed MTP configuration.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../profile-common.sh"
tess_reject_unmodeled_tuning_env
tess_validate_server_settings
MODEL=${MODEL:?path to Tess-4/Qwen3.6 merged-MTP GGUF}; CTX=${CTX:-131072}; NP=${NP:-1}
[ -z "${UB+x}" ] || tess_die "UB is locked at 2048 for Tess-4"
[ -z "${BATCH+x}" ] || tess_die "BATCH is locked by the Tess-4 profile"
tess_require_uint CTX "$CTX"
case "$CTX" in
  32768|65536|131072|262144)
    ROPE_MODE=native
    ROPE_FACTOR=1
    SPECULATION=mtp
    ;;
  524288)
    ROPE_MODE=yarn
    ROPE_FACTOR=2
    SPECULATION=off
    ;;
  1010000)
    ROPE_MODE=yarn
    ROPE_FACTOR=4
    SPECULATION=off
    ;;
  *) tess_die "unsupported Tess-4 context; choose 32768, 65536, 131072, 262144, 524288, or 1010000" ;;
esac
BATCH=2048; UB=2048
tess_profile_begin qwen36-a3b-q8-q4mtp
tess_require_single_slot "$NP"
if [ "$CTX" = 1010000 ]; then
  tess_mark_custom CONTEXT_MODE "yarn-factor-$ROPE_FACTOR" native
fi

if [ "${PRINT_CONFIG:-0}" = 1 ]; then
  tess_print_effective_config "model=$(basename -- "$MODEL")" "context=$CTX" "batch=$BATCH" "ubatch=$UB" "slots=$NP" "rope=$ROPE_MODE" "rope_factor=$ROPE_FACTOR" "yarn_original_context=262144" "speculation=$SPECULATION" "n_max=$([ "$SPECULATION" = mtp ] && echo 5 || echo 0)" "p_min=$([ "$SPECULATION" = mtp ] && echo 0.7 || echo 0)" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi
tess_preflight_port
tess_verify_profile_files "$MODEL"
tess_prepare_runtime_links "$MODEL"
tess_log_runtime_label
cd "$TESS_RUNTIME_DIR"
ARGS=(-m "$TESS_RUNTIME_MODEL" -c "$CTX" -b "$BATCH" -ub "$UB" -np "$NP" -ngl 99 -fa on --jinja --metrics --slots --no-webui --no-ui-mcp-proxy --no-agent --alias "$ALIAS" --host 127.0.0.1 --port "$PORT")
if [ "$ROPE_MODE" = yarn ]; then
  ARGS+=(--rope-scaling yarn --rope-scale "$ROPE_FACTOR" --yarn-orig-ctx 262144)
fi
if [ "$SPECULATION" = mtp ]; then
  ARGS+=(--spec-type draft-mtp --spec-draft-n-max 5 --spec-draft-n-min 0 --spec-draft-p-min 0.7)
fi
tess_exec_server "${ARGS[@]}"
