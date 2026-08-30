#!/bin/bash
# Inkling-Small UD-IQ3_XXS with Metal banded attention and fused short convolution.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../profile-common.sh"
tess_reject_unmodeled_tuning_env LLAMA_INKLING_SCONV_FUSED
tess_validate_server_settings
MODEL=${MODEL:?path to Inkling-Small UD-IQ3_XXS shard 00001}; CTX=${CTX:-16384}; NP=${NP:-1}
[ -z "${UB+x}" ] || tess_die "UB is locked at 2048 for Inkling-Small"
[ -z "${BATCH+x}" ] || tess_die "BATCH is locked at 2048 for Inkling-Small"
tess_require_uint CTX "$CTX"
case "$CTX" in
  8192|16384|32768|65536|131072|262144|524288|1048576) ;;
  *) tess_die "unsupported Inkling-Small context; choose 8192, 16384, 32768, 65536, 131072, 262144, 524288, or 1048576" ;;
esac
BATCH=2048; UB=2048
export LLAMA_INKLING_SCONV_FUSED=${LLAMA_INKLING_SCONV_FUSED:-1}
[ "$LLAMA_INKLING_SCONV_FUSED" = 1 ] || tess_die "Inkling-Small verified serving requires fused short convolution"
tess_profile_begin inkling-small-iq3xxs
tess_require_single_slot "$NP"
if [ "$CTX" -gt 16384 ]; then tess_mark_custom QUALIFICATION pending qualified; fi

if [ "${PRINT_CONFIG:-0}" = 1 ]; then
  tess_print_effective_config "model=$(basename -- "$MODEL")" "context=$CTX" "batch=$BATCH" "ubatch=$UB" "slots=$NP" "kv_type=f16" "flash_attention=on" "shortconv=fused" "speculation=off" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi
REQ=129024
CUR=$(/usr/sbin/sysctl -n iogpu.wired_limit_mb 2>/dev/null || echo 0)
if [ "$CUR" -lt "$REQ" ] 2>/dev/null || [ "$CUR" = 0 ]; then
  echo "This Inkling-Small profile requires a 129,024 MiB GPU-wired limit." >&2
  echo "Run \`sudo sysctl iogpu.wired_limit_mb=129024\` once for this boot, then relaunch." >&2
  echo "Tess Server never requests root or changes the limit itself." >&2
  exit 2
fi
tess_preflight_port
tess_inspect_profile_files "$MODEL"
tess_prepare_runtime_links "$MODEL"
tess_log_runtime_label
cd "$TESS_RUNTIME_DIR"
tess_exec_server -m "$TESS_RUNTIME_MODEL" -c "$CTX" -b "$BATCH" -ub "$UB" -np "$NP" -ngl 99 -fa on --jinja --metrics --slots --no-webui --no-ui-mcp-proxy --no-agent --alias "$ALIAS" --host 127.0.0.1 --port "$PORT"
