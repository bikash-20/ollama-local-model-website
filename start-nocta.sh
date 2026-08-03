#!/usr/bin/env bash
# start-nocta.sh — brings up everything Nocta needs in one command.
#   - Starts Ollama (if not already running on :11434)
#   - Starts the local voice server on :5005 / :5006
# Both run in the background via nohup; logs go to logs/*.log and
# PIDs to logs/*.pid. Run ./stop-nocta.sh to shut everything down.

set -euo pipefail
cd "$(dirname "$0")"

LOGS_DIR="logs"
mkdir -p "$LOGS_DIR"

OLLAMA_LOG="$LOGS_DIR/ollama.log"
OLLAMA_PID="$LOGS_DIR/ollama.pid"
VOICE_LOG="$LOGS_DIR/voice.log"
VOICE_PID="$LOGS_DIR/voice.pid"

# ---- Helpers ----------------------------------------------------------------
port_in_use() {
    lsof -i :"$1" -sTCP:LISTEN -P -n >/dev/null 2>&1
}

# ---- Optional .env hints ----------------------------------------------------
# Honor OLLAMA_ORIGINS from .env so the hosted PWA (e.g.
# https://bikash-20.github.io) isn't rejected by Ollama with HTTP 403.
# file://, http://localhost, and http://127.0.0.1 are already allowed by
# Ollama's defaults — we only forward extra origins.
if [[ -f ".env" ]]; then
    ENV_OLLAMA_ORIGINS="$(grep -E '^OLLAMA_ORIGINS=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)"
    if [[ -n "${ENV_OLLAMA_ORIGINS:-}" ]]; then
        export OLLAMA_ORIGINS="$ENV_OLLAMA_ORIGINS"
        echo "    using OLLAMA_ORIGINS from .env: $OLLAMA_ORIGINS"
    fi
fi

# ---- Ollama -----------------------------------------------------------------
echo "==> Checking Ollama (port 11434)..."
if port_in_use 11434; then
  echo "    Ollama already listening on :11434 — skipping."
else
  if ! command -v ollama >/dev/null 2>&1; then
    echo "    ERROR: ollama not found on PATH. Install from https://ollama.com/download" >&2
    exit 1
  fi
  echo "    Starting Ollama..."
  nohup ollama serve >"$OLLAMA_LOG" 2>&1 &
  OLLAMA_NEW_PID=$!
  echo "$OLLAMA_NEW_PID" >"$OLLAMA_PID"

  # Wait up to ~10s for the port to open.
  waited=0
  until port_in_use 11434; do
    waited=$((waited + 1))
    if (( waited > 20 )); then
      echo "    ERROR: Ollama did not start within 10s. Check $OLLAMA_LOG." >&2
      exit 1
    fi
    if ! kill -0 "$OLLAMA_NEW_PID" 2>/dev/null; then
      echo "    ERROR: ollama serve exited immediately. Tail of $OLLAMA_LOG:" >&2
      tail -n 20 "$OLLAMA_LOG" >&2 || true
      exit 1
    fi
    sleep 0.5
  done
  echo "    Ollama started (PID $OLLAMA_NEW_PID). Logs: $OLLAMA_LOG"
fi

# ---- Voice server -----------------------------------------------------------
echo "==> Checking voice server (ports 5005/5006)..."
STT_PORT=5005
TTS_PORT=5006
if port_in_use "$STT_PORT" && port_in_use "$TTS_PORT"; then
  echo "    Voice server already listening on :$STT_PORT and :$TTS_PORT — skipping."
elif port_in_use "$STT_PORT" || port_in_use "$TTS_PORT"; then
  echo "    ERROR: Only one of :$STT_PORT/:$TTS_PORT is in use. Stop the stray process first" >&2
  echo "    (try ./stop-nocta.sh, or:  lsof -i :$STT_PORT ; lsof -i :$TTS_PORT)." >&2
  exit 1
else
  if [[ ! -d ".venv" ]]; then
    echo "    ERROR: .venv not found. Run ./setup.sh first." >&2
    exit 1
  fi
  if [[ ! -f "voice_server.py" ]]; then
    echo "    ERROR: voice_server.py not found. Did you clone the full repo?" >&2
    exit 1
  fi

  echo "    Starting voice server..."
  (
    # shellcheck disable=SC1091
    source .venv/bin/activate
    nohup python voice_server.py >"$VOICE_LOG" 2>&1 &
    echo $! >"$VOICE_PID"
  )
  VOICE_NEW_PID="$(cat "$VOICE_PID" 2>/dev/null || true)"

  # Wait up to ~15s for both ports to open.
  waited=0
  until port_in_use "$STT_PORT" && port_in_use "$TTS_PORT"; do
    waited=$((waited + 1))
    if (( waited > 30 )); then
      echo "    ERROR: Voice server did not open :$STT_PORT/:$TTS_PORT within 15s. Check $VOICE_LOG." >&2
      exit 1
    fi
    if ! kill -0 "$VOICE_NEW_PID" 2>/dev/null; then
      echo "    ERROR: voice_server.py exited immediately. Tail of $VOICE_LOG:" >&2
      tail -n 20 "$VOICE_LOG" >&2 || true
      exit 1
    fi
    sleep 0.5
  done
  echo "    Voice server started (PID $VOICE_NEW_PID). Logs: $VOICE_LOG"
fi

# ---- Summary ----------------------------------------------------------------
cat <<EOF

Everything's up. Open your Nocta app (PWA or index.html) and start chatting.

  Ollama       -> http://localhost:11434
  Voice (STT)  -> http://localhost:${STT_PORT}/transcribe
  Voice (TTS)  -> http://localhost:${TTS_PORT}/speak
  OLLAMA_ORIGINS = ${OLLAMA_ORIGINS:-<default — file://, http://localhost, http://127.0.0.1>}

If you opened the hosted PWA (https://bikash-20.github.io/...) and saw
HTTP 403 on /api/tags, set OLLAMA_ORIGINS in your .env to that origin
and re-run ./start-nocta.sh.

Run ./stop-nocta.sh when you're done to shut both servers down cleanly.
EOF
