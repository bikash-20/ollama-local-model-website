#!/usr/bin/env bash
# stop-nocta.sh — stops the servers started by start-nocta.sh.
#
# Shutdown policy:
#   1. SIGTERM (graceful). Lets Piper finish the in-flight audio chunk and
#      lets Python FastAPI drain any in-progress /transcribe or /speak
#      request instead of killing the listener mid-packet.
#   2. Wait up to 5s for the process to exit cleanly.
#   3. SIGKILL only as a last resort, with a warning so the user knows
#      something was holding the process open.
#
# This matters because Piper synthesis can take ~3-4s for a long reply
# and we'd rather wait for that to land than truncate audio mid-sentence.

cd "$(dirname "$0")"

GRACE_SECONDS=5

stop_pid() {
  local name="$1"
  local pidfile="logs/$2.pid"
  if [ ! -f "$pidfile" ]; then
    echo "==> No PID file for $name — nothing to stop from this script."
    return
  fi
  local pid
  pid=$(cat "$pidfile")
  if ! kill -0 "$pid" >/dev/null 2>&1; then
    echo "==> $name (PID $pid) was not running"
    rm -f "$pidfile"
    return
  fi

  # Step 1 — ask politely.
  echo "==> Stopping $name (PID $pid, sending SIGTERM)…"
  kill -TERM "$pid" 2>/dev/null || true

  # Step 2 — poll for clean exit, up to GRACE_SECONDS.
  local waited=0
  while kill -0 "$pid" >/dev/null 2>&1; do
    waited=$((waited + 1))
    if (( waited >= GRACE_SECONDS * 2 )); then
      # 10 ticks = 5s (each sleep is 0.5s).
      break
    fi
    sleep 0.5
  done

  # Step 3 — escalate only if SIGTERM was ignored.
  if kill -0 "$pid" >/dev/null 2>&1; then
    echo "    !! $name did not exit within ${GRACE_SECONDS}s; sending SIGKILL"
    kill -9 "$pid" 2>/dev/null || true
  else
    echo "    $name exited cleanly"
  fi

  rm -f "$pidfile"
}

stop_pid "voice server" "voice"
stop_pid "HTTP server" "http"
stop_pid "Ollama" "ollama"

echo ""
echo "If anything is still holding a port, check manually with:"
echo "  lsof -i :11434   # Ollama"
echo "  lsof -i :5005     # STT"
echo "  lsof -i :5006     # TTS"
echo "  lsof -i :8000     # Static HTTP server (default NOCTA_HTTP_PORT)"
