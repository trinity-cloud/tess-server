#!/bin/bash
set -euo pipefail

[ "$#" = "1" ] || { echo "usage: $0 <tess-server-binary>" >&2; exit 2; }
SERVER=$1
[ -x "$SERVER" ] || { echo "tess-server binary is not executable: $SERVER" >&2; exit 2; }

PRODUCT=$($SERVER --version-json | /usr/bin/plutil -extract product raw -o - -)
[ "$PRODUCT" = "tess-server" ] || { echo "binary does not report the tess-server product contract" >&2; exit 1; }

ERROR_LOG=$(mktemp /tmp/tess-security-test.XXXXXX)
SERVER_PID=
trap '[ -z "$SERVER_PID" ] || kill "$SERVER_PID" 2>/dev/null || true; rm -f "$ERROR_LOG"' EXIT
"$SERVER" --host 0.0.0.0 --port 0 >"$ERROR_LOG" 2>&1 &
SERVER_PID=$!
STATUS=
for ((attempt = 0; attempt < 50; attempt++)); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    set +e
    wait "$SERVER_PID"
    STATUS=$?
    set -e
    SERVER_PID=
    break
  fi
  sleep 0.1
done
if [ -n "$SERVER_PID" ]; then
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=
  echo "unauthenticated non-loopback bind did not fail promptly" >&2
  exit 1
fi
if [ "$STATUS" = "0" ]; then
  echo "unauthenticated non-loopback bind was accepted" >&2
  exit 1
fi
grep -q "requires --api-key or --api-key-file" "$ERROR_LOG" || {
  echo "non-loopback rejection did not report the authentication requirement" >&2
  exit 1
}

"$SERVER" --host 127.example --port 0 >"$ERROR_LOG" 2>&1 &
SERVER_PID=$!
STATUS=
for ((attempt = 0; attempt < 50; attempt++)); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    set +e
    wait "$SERVER_PID"
    STATUS=$?
    set -e
    SERVER_PID=
    break
  fi
  sleep 0.1
done
if [ -n "$SERVER_PID" ]; then
  kill "$SERVER_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=
  echo "127.-prefixed DNS name did not fail promptly" >&2
  exit 1
fi
if [ "$STATUS" = "0" ] || ! grep -q "requires --api-key or --api-key-file" "$ERROR_LOG"; then
  echo "127.-prefixed DNS name bypassed the authentication requirement" >&2
  exit 1
fi

TEST_API_KEY=tess-public-bind-test-key-7c1e9a
"$SERVER" --host 0.0.0.0 --port 0 --api-key "$TEST_API_KEY" >"$ERROR_LOG" 2>&1 &
SERVER_PID=$!
sleep 1
if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=
  echo "authenticated non-loopback bind did not remain available" >&2
  exit 1
fi
if grep -Fq "$TEST_API_KEY" "$ERROR_LOG"; then
  echo "API key appeared in default server logs" >&2
  exit 1
fi
kill "$SERVER_PID"
wait "$SERVER_PID" 2>/dev/null || true
SERVER_PID=

echo "product non-loopback authentication gate: PASS"
