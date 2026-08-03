#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# stop-nocta.sh — stop the Ollama + voice-server processes started by
# ./start-nocta.sh.
#
# Behavior:
#   * Reads logs/ollama.pid and logs/voice.pid, and sends SIGTERM
#     (then SIGKILL after a short grace period) to each live process.
#   * Removes the PID files once handled.
#   * Prints what was stopped — or says nothing was running.
#   * Falls back to manual lsof commands if a port is still held, so
#     the user can clean up anything we did not start here.
#
# POSIX-portable bash — targets macOS and Linux.
#
# Usage:
#   ./stop-nocta.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
DIM=$'\033[0;90m'
RESET=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$GREEN"  "$RESET" "$*"; }
warn() { printf '%s!!%s  %s\n' "$YELLOW" "$RESET" "$*"; }
quiet() { printf '%s   %s%s\n' "$DIM" "$*" "$RESET"; }

LOGS_DIR="$SCRIPT_DIR/logs"
OLLAMA_PID="$LOGS_DIR/ollama.pid"
VOICE_PID="$LOGS_DIR/voice.pid"
OLLAMA_PORT=11434
STT_PORT=5005
TTS_PORT=5006

stop_one() {
    local label="$1"
    local pidfile="$2"
    local grace_seconds="${3:-5}"

    if [[ ! -f "$pidfile" ]]; then
        quiet "no $label PID file at $pidfile (never started, or already cleaned up)"
        return 0
    fi

    local pid
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [[ -z "${pid:-}" ]]; then
        warn "$label PID file is empty — removing."
        rm -f "$pidfile"
        return 0
    fi

    if ! kill -0 "$pid" 2>/dev/null; then
        warn "$label (pid $pid) is not running. Stale PID file — removing."
        rm -f "$pidfile"
        return 0
    fi

    say "Stopping $label (pid $pid)..."
    kill -TERM "$pid" 2>/dev/null || true

    # Wait up to N seconds for a clean exit.
    local waited=0
    while kill -0 "$pid" 2>/dev/null; do
        waited=$((waited + 1))
        if (( waited >= grace_seconds * 2 )); then
            warn "$label did not exit after ${grace_seconds}s — sending SIGKILL."
            kill -KILL "$pid" 2>/dev/null || true
            break
        fi
        sleep 0.5
    done
    rm -f "$pidfile"
}

stopped_any=0

# Ollama
if [[ -f "$OLLAMA_PID" ]]; then
    stop_one "Ollama" "$OLLAMA_PID" 5
    stopped_any=1
fi

# Voice server
if [[ -f "$VOICE_PID" ]]; then
    stop_one "Voice server" "$VOICE_PID" 5
    stopped_any=1
fi

if (( ! stopped_any )); then
    warn "Nothing to stop — no PID files in $LOGS_DIR/."
fi

# ---- Fallback hints ---------------------------------------------------------
port_in_use() {
    local port="$1"
    command -v lsof >/dev/null 2>&1 || return 1
    lsof -i :"$port" -sTCP:LISTEN -P -n >/dev/null 2>&1
}

leftover=""
for p in "$OLLAMA_PORT" "$STT_PORT" "$TTS_PORT"; do
    if port_in_use "$p"; then
        leftover="$leftover $p"
    fi
done

if [[ -n "$leftover" ]]; then
    cat <<EOF

${YELLOW}Heads up:${RESET} something is still listening on:${leftover}.
Those were not started by start-nocta.sh (or were started elsewhere).
Find and kill them manually:

  lsof -i :${OLLAMA_PORT} -sTCP:LISTEN -P -n
  lsof -i :${STT_PORT} -sTCP:LISTEN -P -n
  lsof -i :${TTS_PORT} -sTCP:LISTEN -P -n
  # Note the PID in the rightmost column, then:  kill <PID>

EOF
else
    echo
    say "All clear."
fi
