#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start-all.sh — single-terminal convenience launcher.
#
# Runs voice server + static HTTP UI + Ollama all in the foreground of one
# terminal, each tagged with a colored prefix so you can tell the streams
# apart. Ctrl-C kills all three at once.
#
# Use this when you want everything visible together and don't need to
# detach the processes. If you want PID files + ./stop-nocta.sh semantics,
# use ./start-nocta.sh instead.
#
# Flags:
#   --no-voice         skip the voice server
#   --no-http          skip the static HTTP server
#   --no-ollama        skip `ollama serve`
#   --save-logs        also tee each stream into logs/<name>.log so
#                      ./stop-nocta.sh can find them later
#   -h, --help         show this comment
#
# Honors the same .env vars as start-nocta.sh:
#   NOCTA_HTTP_PORT (default 8000), OLLAMA_ORIGINS, STT_PORT, TTS_PORT
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Color helpers (matches setup.sh's palette).
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
RED=$'\033[0;31m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
RESET=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$GREEN"  "$RESET" "$*"; }
info() { printf '%s··%s  %s\n' "$CYAN"   "$RESET" "$*"; }
warn() { printf '%s!!%s  %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%sXX%s  %s\n' "$RED"    "$RESET" "$*" >&2; exit 1; }

# Per-process tag colors so you can scan the merged output.
VOICE_TAG="[voice]"
HTTP_TAG="[http ]"
OLLAMA_TAG="[ollama]"
tag_color() {
    case "$1" in
        voice)  printf '\033[1;35m%s\033[0m' "$VOICE_TAG" ;;   # magenta
        http)   printf '\033[1;36m%s\033[0m' "$HTTP_TAG"  ;;   # cyan
        ollama) printf '\033[1;33m%s\033[0m' "$OLLAMA_TAG";;   # yellow
    esac
}

# ---- Flag parsing -----------------------------------------------------------
START_VOICE=1
START_HTTP=1
START_OLLAMA=1
SAVE_LOGS=0
for arg in "$@"; do
    case "$arg" in
        --no-voice)  START_VOICE=0 ;;
        --no-http)   START_HTTP=0 ;;
        --no-ollama) START_OLLAMA=0 ;;
        --save-logs) SAVE_LOGS=1 ;;
        -h|--help)
            sed -n '2,22p' "$0"
            exit 0 ;;
        *) die "Unknown flag: $arg (try --help)" ;;
    esac
done

# ---- Load .env --------------------------------------------------------------
if [[ -f ".env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
else
    warn ".env not found — falling back to defaults."
fi

: "${NOCTA_HTTP_PORT:=8123}"
: "${STT_PORT:=5005}"
: "${TTS_PORT:=5006}"

# ---- Preflight (same as start-nocta.sh) ------------------------------------
say "Preflight checks..."

if [[ ! -d ".venv" ]]; then
    die "Missing .venv/. Run ./setup.sh first."
fi
if [[ ! -f "voice_server.py" ]]; then
    die "voice_server.py not found in $SCRIPT_DIR. Broken install — re-clone."
fi
if ! source .venv/bin/activate >/dev/null 2>&1; then
    die ".venv is broken. Run ./setup.sh --reinstall."
fi
if (( START_VOICE )) && ! python -c "import faster_whisper, piper" >/dev/null 2>&1; then
    die "faster_whisper or piper not importable. Run ./setup.sh --reinstall."
fi

mkdir -p logs

# If saving logs, also write PID files so ./stop-nocta.sh can find them.
write_pid() {
    local name="$1" pid="$2"
    echo "$pid" > "logs/${name}.pid"
    info "saved PID for $name → logs/${name}.pid"
}

# ---- Run one process under a colored prefix tag -----------------------------
# Args: tag-name, log-path (or ""), command...
# Uses sed -u (unbuffered) so the prefix shows up immediately; without -u,
# the pipe buffers and the user sees nothing for tens of seconds.
run_tagged() {
    local tag="$1"; shift
    local logpath="$1"; shift
    local color
    color=$(tag_color "$tag")
    # Build the pipeline. We use process substitution so the colored tag
    # is applied to every line, including stderr merged into stdout.
    if [[ -n "$logpath" ]]; then
        # tee to both stdout (with color) and the log file (without ANSI).
        # awk strips ANSI from the file copy.
        stdbuf -oL -eL "$@" 2>&1 \
            | tee >(sed -u "s/^/${color} /" >&2) \
                  >(sed -u $'s/\x1b\\[[0-9;]*m//g; s/^/'"$(printf '%s' "$VOICE_TAG" | sed 's/voice/'"$tag"'/')"' /' >> "$logpath") \
            >/dev/null
    else
        stdbuf -oL -eL "$@" 2>&1 \
            | sed -u "s/^/${color} /"
    fi
}

# Cleaner approach: each component is its own backgrounded pipeline, and
# we just `wait` on them. SIGINT/SIGTERM from Ctrl-C is caught and forwarded
# to the whole process group.

PIDS=()

cleanup() {
    # Kill every backgrounded child + their subprocess trees.
    trap '' INT TERM EXIT
    say "Shutting down..."
    for pid in "${PIDS[@]}"; do
        kill -TERM "$pid" 2>/dev/null || true
    done
    # Give them 2s to die gracefully, then SIGKILL stragglers.
    sleep 2
    for pid in "${PIDS[@]}"; do
        kill -KILL "$pid" 2>/dev/null || true
    done
    exit 0
}
trap cleanup INT TERM

# ---- Voice server -----------------------------------------------------------
if (( START_VOICE )); then
    say "Launching voice server (STT :$STT_PORT, TTS :$TTS_PORT)..."
    logfile=""
    (( SAVE_LOGS )) && logfile="logs/voice.log"
    (
        # The whole pipeline runs in a subshell so we can capture its PID.
        # Prefix every line with the colored voice tag.
        # shellcheck disable=SC2086
        stdbuf -oL -eL python voice_server.py 2>&1 \
            | sed -u "s/^/$(tag_color voice) /"
    ) &
    VPID=$!
    PIDS+=("$VPID")
    (( SAVE_LOGS )) && write_pid voice "$VPID"
fi

# ---- HTTP server ------------------------------------------------------------
if (( START_HTTP )); then
    say "Launching static HTTP server on http://127.0.0.1:${NOCTA_HTTP_PORT}/ ..."
    logfile=""
    (( SAVE_LOGS )) && logfile="logs/http.log"
    (
        stdbuf -oL -eL python3 -m http.server "$NOCTA_HTTP_PORT" --bind 127.0.0.1 2>&1 \
            | sed -u "s/^/$(tag_color http) /"
    ) &
    HPID=$!
    PIDS+=("$HPID")
    (( SAVE_LOGS )) && write_pid http "$HPID"
fi

# ---- Ollama -----------------------------------------------------------------
if (( START_OLLAMA )); then
    if ! command -v ollama >/dev/null 2>&1; then
        warn "ollama not found on PATH — skipping. (Use --no-ollama to silence this.)"
    else
        say "Launching Ollama daemon on http://127.0.0.1:11434 ..."
        logfile=""
        (( SAVE_LOGS )) && logfile="logs/ollama.log"
        (
            stdbuf -oL -eL env "OLLAMA_ORIGINS=${OLLAMA_ORIGINS:-}" ollama serve 2>&1 \
                | sed -u "s/^/$(tag_color ollama) /"
        ) &
        OPID=$!
        PIDS+=("$OPID")
        (( SAVE_LOGS )) && write_pid ollama "$OPID"
    fi
fi

# ---- Summary ----------------------------------------------------------------
echo ""
say "${BOLD}All processes launched.${RESET}"
(( START_HTTP   )) && info "Open Nocta:    http://localhost:${NOCTA_HTTP_PORT}/"
(( START_VOICE  )) && info "Voice STT/TTS: http://127.0.0.1:${STT_PORT}/  http://127.0.0.1:${TTS_PORT}/"
(( START_OLLAMA )) && info "Ollama:        http://127.0.0.1:11434/"
echo ""
info "Ctrl-C to stop everything. Pass --save-logs to also write logs/*.log + PID files."
echo ""

# Block until any child exits OR the user hits Ctrl-C.
# `wait -n` returns as soon as one child exits; we treat that as fatal
# (one component crashing usually means the user wants to know).
if (( ${#PIDS[@]} > 0 )); then
    wait -n "${PIDS[@]}" || true
    warn "A child process exited. Tearing down the rest."
    cleanup
fi
