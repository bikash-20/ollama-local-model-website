#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start-nocta.sh — bring up Ollama + the voice server in one command.
#
# Behavior:
#   * If Ollama is already serving on :11434, leave it alone.
#     Otherwise start `ollama serve` in the background via nohup and
#     record its PID to logs/ollama.pid (output -> logs/ollama.log).
#   * If the voice server is already listening on :5005 and :5006,
#     leave it alone. Otherwise activate .venv, start
#     `python voice_server.py` via nohup, record its PID to
#     logs/voice.pid (output -> logs/voice.log).
#   * If .venv does not exist, print a clear error pointing at
#     ./setup.sh and exit non-zero.
#
# POSIX-portable bash — targets macOS and Linux. Windows users should
# follow the manual steps in the README instead.
#
# Usage:
#   ./start-nocta.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Resolve paths relative to THIS script, not the cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---- Pretty logging ---------------------------------------------------------
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
RED=$'\033[0;31m'
DIM=$'\033[0;90m'
RESET=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$GREEN"  "$RESET" "$*"; }
warn() { printf '%s!!%s  %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%sXX%s  %s\n' "$RED"    "$RESET" "$*" >&2; exit 1; }
quiet() { printf '%s   %s%s\n' "$DIM" "$*" "$RESET"; }

# ---- Paths ------------------------------------------------------------------
LOGS_DIR="$SCRIPT_DIR/logs"
OLLAMA_LOG="$LOGS_DIR/ollama.log"
OLLAMA_PID="$LOGS_DIR/ollama.pid"
VOICE_LOG="$LOGS_DIR/voice.log"
VOICE_PID="$LOGS_DIR/voice.pid"

mkdir -p "$LOGS_DIR"

# ---- Helpers ----------------------------------------------------------------
# `port_in_use <port>` — returns 0 if something is listening on the port,
# 1 otherwise. Uses lsof, which ships with macOS and most Linux distros.
port_in_use() {
    local port="$1"
    if command -v lsof >/dev/null 2>&1; then
        lsof -i :"$port" -sTCP:LISTEN -P -n >/dev/null 2>&1
        return $?
    fi
    # Fallback: try ss, then netstat.
    if command -v ss >/dev/null 2>&1; then
        ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN
        return $?
    fi
    if command -v netstat >/dev/null 2>&1; then
        netstat -ltn 2>/dev/null | awk '{print $4}' | grep -E "(^|:)${port}$" | grep -q LISTEN
        return $?
    fi
    warn "Could not find lsof, ss, or netstat — assuming port $port is free."
    return 1
}

# `read_pid <pidfile>` — echoes the PID from a file if it exists and
# points at a live process; otherwise echoes empty.
read_pid() {
    local f="$1"
    [[ -f "$f" ]] || return 0
    local pid
    pid="$(cat "$f" 2>/dev/null || true)"
    [[ -n "${pid:-}" ]] || return 0
    # kill -0 == "does this PID exist?"
    if command -v kill >/dev/null 2>&1 && kill -0 "$pid" 2>/dev/null; then
        printf '%s\n' "$pid"
    fi
}

# ---- 1. Ollama --------------------------------------------------------------
say "Checking Ollama (port 11434)..."
OLLAMA_PORT=11434
if port_in_use "$OLLAMA_PORT"; then
    warn "Ollama already listening on :$OLLAMA_PORT — leaving it alone."
else
    if ! command -v ollama >/dev/null 2>&1; then
        die "ollama not found on PATH. Install Ollama first: https://ollama.com/download"
    fi
    say "Starting Ollama in the background..."
    # nohup + & so this script can return. Logs go to logs/ollama.log.
    nohup ollama serve >"$OLLAMA_LOG" 2>&1 &
    OLLAMA_NEW_PID=$!
    echo "$OLLAMA_NEW_PID" >"$OLLAMA_PID"
    quiet "  pid: $OLLAMA_NEW_PID"
    quiet "  log: $OLLAMA_LOG"

    # Wait up to ~10s for the port to open, polling every 0.5s.
    waited=0
    while ! port_in_use "$OLLAMA_PORT"; do
        waited=$((waited + 1))
        if (( waited > 20 )); then
            die "Ollama did not start within 10s. Check $OLLAMA_LOG."
        fi
        # Bail out early if the process already died.
        if ! kill -0 "$OLLAMA_NEW_PID" 2>/dev/null; then
            die "ollama serve exited immediately. Tail of $OLLAMA_LOG:
$(tail -n 20 "$OLLAMA_LOG" 2>/dev/null || true)"
        fi
        sleep 0.5
    done
    say "Ollama is up on :$OLLAMA_PORT."
fi

# ---- 2. Voice server --------------------------------------------------------
say "Checking voice server (ports 5005/5006)..."
STT_PORT=5005
TTS_PORT=5006
if port_in_use "$STT_PORT" && port_in_use "$TTS_PORT"; then
    warn "Voice server already listening on :$STT_PORT and :$TTS_PORT — leaving it alone."
elif port_in_use "$STT_PORT" || port_in_use "$TTS_PORT"; then
    die "Only one of :$STT_PORT/:$TTS_PORT is in use. Stop the stray process first
  (try ./stop-nocta.sh, or:  lsof -i :$STT_PORT ; lsof -i :$TTS_PORT)."
else
    if [[ ! -d ".venv" ]]; then
        die ".venv does not exist. Run ./setup.sh first to install Python deps."
    fi
    if [[ ! -f "voice_server.py" ]]; then
        die "voice_server.py not found in $SCRIPT_DIR. Did you clone the full repo?"
    fi

    say "Starting voice server in the background..."
    # Activate the venv, then launch. We use a subshell so the activation
    # doesn't leak into the parent environment.
    (
        # shellcheck disable=SC1091
        source .venv/bin/activate
        nohup python voice_server.py >"$VOICE_LOG" 2>&1 &
        echo $! >"$VOICE_PID"
    )
    VOICE_NEW_PID="$(cat "$VOICE_PID" 2>/dev/null || true)"
    quiet "  pid: $VOICE_NEW_PID"
    quiet "  log: $VOICE_LOG"

    # Wait up to ~15s for both ports to open.
    waited=0
    while ! port_in_use "$STT_PORT" || ! port_in_use "$TTS_PORT"; do
        waited=$((waited + 1))
        if (( waited > 30 )); then
            die "Voice server did not open :$STT_PORT/:$TTS_PORT within 15s. Check $VOICE_LOG."
        fi
        if ! kill -0 "$VOICE_NEW_PID" 2>/dev/null; then
            die "voice_server.py exited immediately. Tail of $VOICE_LOG:
$(tail -n 20 "$VOICE_LOG" 2>/dev/null || true)"
        fi
        sleep 0.5
    done
    say "Voice server is up on :$STT_PORT / :$TTS_PORT."
fi

# ---- 3. Summary -------------------------------------------------------------
cat <<EOF

${GREEN}Nocta is ready.${RESET}

  Ollama       -> http://localhost:11434   (log: ${DIM}${OLLAMA_LOG}${RESET})
  Voice (STT)  -> http://localhost:${STT_PORT}/transcribe  (log: ${DIM}${VOICE_LOG}${RESET})
  Voice (TTS)  -> http://localhost:${TTS_PORT}/speak       (log: ${DIM}${VOICE_LOG}${RESET})

Open the app:
  macOS : ${YELLOW}open index.html${RESET}
  Linux : ${YELLOW}xdg-open index.html${RESET}
  (or visit https://bikash-20.github.io/ollama-local-model-website/)

When you're done: ${YELLOW}./stop-nocta.sh${RESET}

EOF
