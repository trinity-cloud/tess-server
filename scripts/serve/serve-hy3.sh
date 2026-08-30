#!/bin/bash
# Tencent Hy3 IQ2_M with exact one-token MTP and context-managed ubatch.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../profile-common.sh"
tess_reject_unmodeled_tuning_env GGML_METAL_FA_GQA_NQ GGML_METAL_FA_GQA_NSGMAX GGML_METAL_MV_EXT_F32
tess_validate_server_settings
MODEL=${MODEL:?path to Hy3 IQ2_M shard 00001}; CTX=${CTX:-32768}; NP=${NP:-1}
[ -z "${UB+x}" ] || tess_die "UB is managed automatically for Hy3; remove the manual override"
[ -z "${BATCH+x}" ] || tess_die "BATCH is locked by the Hy3 profile"
tess_require_uint CTX "$CTX"
case "$CTX" in
  8192|16384|32768) BATCH=8192; UB=8192 ;;
  49152|65536) BATCH=8192; UB=512 ;;
  *) tess_die "unsupported Hy3 context; choose 8192, 16384, 32768, 49152, or 65536" ;;
esac
export GGML_METAL_FA_GQA_NQ=${GGML_METAL_FA_GQA_NQ:-2}
export GGML_METAL_FA_GQA_NSGMAX=${GGML_METAL_FA_GQA_NSGMAX:-2}
export GGML_METAL_MV_EXT_F32=${GGML_METAL_MV_EXT_F32:-0}
[ "$GGML_METAL_FA_GQA_NQ" = 2 ] && [ "$GGML_METAL_FA_GQA_NSGMAX" = 2 ] && [ "$GGML_METAL_MV_EXT_F32" = 0 ] || tess_die "Hy3 verified serving requires NQ=2, NSGMAX=2, and GGML_METAL_MV_EXT_F32=0"
tess_profile_begin hy3-iq2m
tess_require_single_slot "$NP"
tess_mark_custom CTX "$CTX" 32768

if [ "${PRINT_CONFIG:-0}" = 1 ]; then
  tess_print_effective_config "model=$(basename -- "$MODEL")" "context=$CTX" "batch=$BATCH" "ubatch=$UB" "slots=$NP" "kv_type=f16" "speculation=mtp-1" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi
REQ=129024
CUR=$(/usr/sbin/sysctl -n iogpu.wired_limit_mb 2>/dev/null || echo 0)
if [ "$CUR" -lt "$REQ" ] 2>/dev/null || [ "$CUR" = 0 ]; then
  echo "This Hy3 profile requires a 129,024 MiB GPU-wired limit." >&2
  echo "Run \`sudo sysctl iogpu.wired_limit_mb=129024\` once for this boot, then relaunch." >&2
  echo "Tess Server never requests root or changes the limit itself." >&2
  exit 2
fi
tess_preflight_port
tess_inspect_profile_files "$MODEL"
tess_prepare_runtime_links "$MODEL"
tess_log_runtime_label
cd "$TESS_RUNTIME_DIR"
tess_exec_server -m "$TESS_RUNTIME_MODEL" -c "$CTX" -b "$BATCH" -ub "$UB" -np "$NP" -ngl 99 -fa on --jinja --metrics --slots --no-webui --no-ui-mcp-proxy --no-agent --spec-type draft-mtp --spec-draft-n-max 1 --spec-draft-n-min 0 --spec-draft-p-min 0.70 --alias "$ALIAS" --host 127.0.0.1 --port "$PORT"
