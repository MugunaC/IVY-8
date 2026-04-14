#!/data/data/com.termux/files/usr/bin/bash

set -eu

REPO_ROOT="${1:-$(pwd)}"
GATEWAY_PORT="${GATEWAY_PORT:-5000}"
UI_PORT="${UI_PORT:-5173}"
WAIT_SECONDS="${WAIT_SECONDS:-30}"
LOGS_DIR="${REPO_ROOT}/.tunnels"
TUNNEL_LOG="${LOGS_DIR}/gateway.log"

mkdir -p "$LOGS_DIR"
: >"$TUNNEL_LOG"

cleanup() {
  code=$?
  trap - EXIT INT TERM

  for pid in ${TAIL_PID:-} ${TUNNEL_PID:-} ${GATEWAY_PID:-} ${UI_PID:-} ${SERVER_PID:-}; do
    if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  wait ${TAIL_PID:-} ${TUNNEL_PID:-} ${GATEWAY_PID:-} ${UI_PID:-} ${SERVER_PID:-} 2>/dev/null || true
  exit "$code"
}

trap cleanup EXIT INT TERM

echo "Starting backend (API + WS)..."
(
  cd "$REPO_ROOT"
  npm run dev:server
) &
SERVER_PID=$!

echo "Starting UI (remote mode, same-origin)..."
(
  cd "$REPO_ROOT"
  npm run dev:client:remote
) &
UI_PID=$!

echo "Starting gateway (proxy UI + API + WS)..."
(
  cd "$REPO_ROOT"
  GATEWAY_VITE_PORT="$UI_PORT" GATEWAY_PROXY_UI=1 npm run dev:gateway
) &
GATEWAY_PID=$!

echo "Starting Cloudflare quick tunnel to http://127.0.0.1:${GATEWAY_PORT} ..."
(
  cd "$REPO_ROOT"
  cloudflared tunnel \
    --url "http://127.0.0.1:${GATEWAY_PORT}" \
    --logfile "$TUNNEL_LOG" \
    --loglevel info
) &
TUNNEL_PID=$!

deadline=$(( $(date +%s) + WAIT_SECONDS ))
REMOTE_URL=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ -f "$TUNNEL_LOG" ]; then
    REMOTE_URL="$(grep -Eo 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1 || true)"
    if [ -n "$REMOTE_URL" ]; then
      break
    fi
  fi
  sleep 1
done

echo
echo "Local gateway: http://127.0.0.1:${GATEWAY_PORT}"
if [ -n "$REMOTE_URL" ]; then
  echo "Remote URL:    $REMOTE_URL"
else
  echo "Remote URL:    not detected yet (check ${TUNNEL_LOG})"
fi
echo "Tunnel log:    ${TUNNEL_LOG}"
echo "Press Ctrl+C to stop all services."
echo

touch "$TUNNEL_LOG"
tail -n 20 -f "$TUNNEL_LOG" &
TAIL_PID=$!

wait "$SERVER_PID" "$UI_PID" "$GATEWAY_PID" "$TUNNEL_PID"
