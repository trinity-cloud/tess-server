#!/bin/bash
# DeepSeek-V4-Flash-0731 2.4-bit mixed, Tess MLX target-only runtime.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../profile-common.sh"
tess_reject_unmodeled_tuning_env
tess_validate_server_settings

MODEL=${MODEL:?path to the DeepSeek-V4-Flash-0731 MLX model directory}
CTX=${CTX:-32768}
tess_require_uint CTX "$CTX"
case "$CTX" in
  32768|65536|131072|262144|524288|1048576) ;;
  *) tess_die "unsupported DeepSeek MLX context; choose 32768, 65536, 131072, 262144, 524288, or 1048576" ;;
esac

tess_profile_begin_mlx dsv4-0731-mlx-24mixed

if [ "${PRINT_CONFIG:-0}" = 1 ]; then
  tess_print_effective_config "engine=tess-mlx" "model=$(basename -- "$MODEL")" "context=$CTX" "slots=1" "speculation=off" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi

tess_preflight_port
tess_inspect_profile_files "$MODEL"
tess_resolve_mlx_server
tess_log_runtime_label

ARGS=(--model "$MODEL" --profile "$TESS_MLX_MODEL_PROFILE" --host 127.0.0.1 --port "$PORT" --alias "$ALIAS" --context "$CTX")
if [ "$TESS_AUTH_MODE" = bearer ]; then ARGS+=(--api-key-file "$API_KEY_FILE"); fi
exec "$TESS_MLX_SERVER" "${ARGS[@]}"
