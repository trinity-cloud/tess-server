#!/bin/bash
# DeepSeek-V4-Flash UD-IQ3_XXS with profile-owned context and DSpark controls.
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
. "$SCRIPT_DIR/../profile-common.sh"
tess_reject_unmodeled_tuning_env
tess_validate_server_settings
MODEL=${MODEL:?path to DeepSeek-V4-Flash UD-IQ3_XXS shard 00001}
DRAFT=${DRAFT:-1}; NP=${NP:-1}; CTX=${CTX:-32768}; DMAX=${DMAX:-5}; PMIN=${PMIN:-0.65}
[ -z "${UB+x}" ] || tess_die "UB is managed automatically for DeepSeek; remove the manual override"
[ -z "${BATCH+x}" ] || tess_die "BATCH is locked by the DeepSeek profile"
tess_require_uint CTX "$CTX"; tess_require_uint DMAX "$DMAX"
case "$CTX" in
  4096|8192|16384|32768) UB=2048 ;;
  65536|131072|262144) UB=512 ;;
  524288|1048576) UB=512 ;;
  *) tess_die "unsupported DeepSeek context; choose 4096, 8192, 16384, 32768, 65536, 131072, 262144, 524288, or 1048576" ;;
esac
[ "$DRAFT" = "0" ] || [ "$DRAFT" = "1" ] || tess_die "DRAFT must be 0 or 1"
[ "$DMAX" -ge 1 ] && [ "$DMAX" -le 5 ] || tess_die "DMAX must be between 1 and 5"
/usr/bin/awk -v value="$PMIN" 'BEGIN { exit !(value ~ /^[0-9]*\.?[0-9]+$/ && value >= 0 && value <= 1) }' || tess_die "PMIN must be between 0 and 1"
if [ "$DRAFT" = "1" ]; then DSPARK=${DSPARK:?path to dspark-draft.gguf}; else TESS_DRAFT_OPTIONAL=1; export TESS_DRAFT_OPTIONAL; fi
tess_profile_begin dsv4-dspark
tess_require_single_slot "$NP"
tess_mark_custom CTX "$CTX" 32768
tess_mark_custom DRAFT "$DRAFT" 1
tess_mark_custom DMAX "$DMAX" 5
tess_mark_custom PMIN "$PMIN" 0.65

if [ "${PRINT_CONFIG:-0}" = "1" ]; then
  tess_print_effective_config "model=$(basename -- "$MODEL")" "context=$CTX" "ubatch=$UB" "slots=$NP" "speculation=$([ "$DRAFT" = 1 ] && echo dspark || echo off)" "draft_depth=$DMAX" "p_min=$PMIN" "host=127.0.0.1" "port=$PORT" "alias=$ALIAS" "auth=$TESS_AUTH_MODE"
  exit 0
fi

REQ=129024
CUR=$(/usr/sbin/sysctl -n iogpu.wired_limit_mb 2>/dev/null || echo 0)
if [ "$CUR" -lt "$REQ" ] 2>/dev/null || [ "$CUR" = "0" ]; then
  echo "This profile needs a 129,024 MiB GPU-wired limit." >&2
  echo "Run \`sudo sysctl iogpu.wired_limit_mb=129024\` once for this boot, then relaunch." >&2
  echo "Tess Server never requests root or changes the limit itself." >&2
  exit 2
fi
tess_preflight_port
if [ "$DRAFT" = "1" ]; then
  tess_verify_profile_files "$MODEL" "$DSPARK"
  tess_prepare_runtime_links "$MODEL" "$DSPARK"
else
  tess_verify_profile_files "$MODEL"
  tess_prepare_runtime_links "$MODEL"
fi
tess_log_runtime_label
cd "$TESS_RUNTIME_DIR"
ARGS=(-m "$TESS_RUNTIME_MODEL" -c "$CTX" -ub "$UB" -np "$NP" -ngl 99 -fa on --jinja --metrics --slots --no-webui --no-ui-mcp-proxy --no-agent --alias "$ALIAS" --host 127.0.0.1 --port "$PORT")
if [ "$DRAFT" = "1" ]; then ARGS+=(--spec-dspark "$TESS_RUNTIME_DRAFT" --spec-draft-n-max "$DMAX" --spec-draft-p-min "$PMIN"); fi
tess_exec_server "${ARGS[@]}"
