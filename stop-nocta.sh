#!/bin/bash
# stop-nocta.sh — stops the servers started by start-nocta.sh.

cd "$(dirname "$0")"

stop_pid() {
  local name="$1"
  local pidfile="logs/$2.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill -9 "$pid" >/dev/null 2>&1
      echo "==> Stopped $name (PID $pid)"
    else
      echo "==> $name (PID $pid) was not running"
    fi
    rm -f "$pidfile"
  else
    echo "==> No PID file for $name — nothing to stop from this script."
  fi
}

stop_pid "voice server" "voice"
stop_pid "Ollama" "ollama"

echo ""
echo "If anything is still holding a port, check manually with:"
echo "  lsof -i :11434   # Ollama"
echo "  lsof -i :5005     # STT"
echo "  lsof -i :5006     # TTS"
