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
  32768|65536|131072|262144) ;;
  524288) tess_die "512K YaRN is qualification-pending; use 262144 or lower" ;;
  1010000) tess_die "1M YaRN begins after the 512K target-only gate passes" ;;
  *) tess_die "unsupported Tess-4 context; choose 32768, 65536, 131072, 262144, 524288, or 1010000" ;;
esac
UB=2048
tess_profile_begin qwen36-a3b-q8-q4mtp
tess_require_single_slot "$NP"
tess_mark_custom CTX "$CTX" 131072

if [ "${PRINT_CONFIG:-0}" = 1 ]; then
  tess_print_effective_config "model=$(basename -- "$MODEL")" "context=$CTX" "ubatch=$UB" "slots=$NP" "rope=native" "speculation=mtp" "n_max=5" "p_min=0.7" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi
tess_preflight_port
tess_verify_profile_files "$MODEL"
tess_prepare_runtime_links "$MODEL"
tess_log_runtime_label
cd "$TESS_RUNTIME_DIR"
tess_exec_server -m "$TESS_RUNTIME_MODEL" -c "$CTX" -ub "$UB" -np "$NP" -ngl 99 -fa on --jinja --metrics --slots --no-webui --no-ui-mcp-proxy --no-agent --spec-type draft-mtp --spec-draft-n-max 5 --spec-draft-n-min 0 --spec-draft-p-min 0.7 --alias "$ALIAS" --host 127.0.0.1 --port "$PORT"
