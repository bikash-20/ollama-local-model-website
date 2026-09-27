#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start-nocta.sh — documented "one command" wrapper.
#
# Brings up the three Nocta services in the background:
#   1. Voice server    (FastAPI STT + TTS)  → http://127.0.0.1:5005  /  :5006
#   2. Static HTTP UI  (python3 -m http.server) → http://127.0.0.1:${NOCTA_HTTP_PORT}
#   3. Ollama daemon   (ollama serve)      → http://127.0.0.1:11434
#
# Each component writes logs/<name>.log and logs/<name>.pid, matching the
# exact contract expected by ./stop-nocta.sh (SIGTERM → 5s grace → SIGKILL).
# After spawning, this script tails -F all three logs so you can watch
# everything in one terminal. Ctrl-C exits only the tail; the daemons keep
# running and can be stopped with ./stop-nocta.sh.
#
# Honors env vars from .env (loaded automatically):
#   NOCTA_HTTP_PORT    default 8000
#   OLLAMA_ORIGINS     comma-separated origins passed to `ollama serve`
#   STT_HOST / STT_PORT / TTS_HOST / TTS_PORT — passed through to voice_server.py
#
# Flags:
#   --no-voice         skip the voice server
#   --no-http          skip the static HTTP server
#   --no-ollama        skip `ollama serve` (use if Ollama is already running)
#   --no-tail          start the daemons and exit (don't follow logs)
#   -h, --help         show this comment
#
# You must have run ./setup.sh at least once before this script will work.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Resolve paths relative to THIS script (not cwd), like setup.sh does.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---- Pretty logging (mirrors setup.sh's helpers) ----------------------------
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

# ---- Flag parsing -----------------------------------------------------------
START_VOICE=1
START_HTTP=1
START_OLLAMA=1
TAIL_LOGS=1
for arg in "$@"; do
    case "$arg" in
        --no-voice)  START_VOICE=0 ;;
        --no-http)   START_HTTP=0 ;;
        --no-ollama) START_OLLAMA=0 ;;
        --no-tail)   TAIL_LOGS=0 ;;
        -h|--help)
            sed -n '2,28p' "$0"
            exit 0 ;;
        *) die "Unknown flag: $arg (try --help)" ;;
    esac
done

# ---- Load .env into our env so NOCTA_HTTP_PORT / OLLAMA_ORIGINS stick ------
if [[ -f ".env" ]]; then
    # set -a exports every variable assignment; set +a stops.
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
else
    warn ".env not found — falling back to defaults. (Run ./setup.sh if this surprises you.)"
fi

# Defaults (kept here too so the script still works without .env).
: "${NOCTA_HTTP_PORT:=8123}"
: "${STT_PORT:=5005}"
: "${TTS_PORT:=5006}"

# ---- Preflight --------------------------------------------------------------
say "Preflight checks..."

if [[ ! -d ".venv" ]]; then
    die "Missing .venv/. Run ./setup.sh first (creates venv + installs deps)."
fi

if [[ ! -f "voice_server.py" ]]; then
    die "voice_server.py not found in $SCRIPT_DIR. Broken install — re-clone the repo."
fi

# Check the heavy deps import. The .venv is Python 3.14 in this repo, and
# faster-whisper / piper-tts don't always have wheels that new — catch that
# here with an actionable message instead of a stack trace on first request.
if ! source .venv/bin/activate >/dev/null 2>&1; then
    die ".venv is broken. Run ./setup.sh --reinstall to rebuild it."
fi
if ! python -c "import faster_whisper, piper" >/dev/null 2>&1; then
    die "faster_whisper or piper not importable in .venv.
Fix: ./setup.sh --reinstall
Likely cause: Python 3.14 has no wheels yet for one of these packages."
fi

# ---- Helper: is this port already bound by something we started? ----------
port_owner() {
    # $1 = port, returns the PID listening on it (or empty).
    lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1
}

# If a port we want is busy and the PID matches a live process we didn't
# start, we warn loudly. stop-nocta.sh can only kill processes whose PID
# is in logs/<name>.pid, so we don't try to kill someone else's process.
check_port() {
    local name="$1" port="$2"
    local owner
    owner=$(port_owner "$port")
    if [[ -n "$owner" ]] && kill -0 "$owner" >/dev/null 2>&1; then
        # Check if our own PID file points to this owner.
        if [[ -f "logs/${name}.pid" ]] && [[ "$(cat "logs/${name}.pid")" == "$owner" ]]; then
            info "${name} already running (PID $owner) on :$port — reusing"
            return 0
        fi
        warn "Port $port is busy (owned by PID $owner, not us)."
        warn "  Stop it with: lsof -nP -iTCP:$port -sTCP:LISTEN -t | xargs kill"
        warn "  Then re-run this script. Skipping ${name}."
        return 1
    fi
    return 0
}

mkdir -p logs

# ---- Start voice server -----------------------------------------------------
if (( START_VOICE )); then
    if check_port voice "$STT_PORT" && check_port voice "$TTS_PORT"; then
        say "Starting voice server (STT :$STT_PORT, TTS :$TTS_PORT)..."
        # nohup so the process survives this script's exit; redirect into the
        # exact log path stop-nocta.sh expects.
        nohup python voice_server.py > logs/voice.log 2>&1 &
        echo $! > logs/voice.pid
        # Brief settle, then sanity check.
        sleep 1
        if kill -0 "$(cat logs/voice.pid)" >/dev/null 2>&1; then
            info "voice server PID $(cat logs/voice.pid) — log: logs/voice.log"
        else
            warn "voice server exited immediately. Last log lines:"
            tail -n 20 logs/voice.log >&2 || true
            die "voice server failed to start."
        fi
    else
        START_VOICE=0
    fi
fi

# ---- Start static HTTP server ----------------------------------------------
if (( START_HTTP )); then
    if check_port http "$NOCTA_HTTP_PORT"; then
        say "Starting static HTTP server on http://127.0.0.1:${NOCTA_HTTP_PORT}/ ..."
        # --bind 127.0.0.1: same threat-model as voice_server.py. The README
        # documents changing this if you want LAN access.
        nohup python3 -m http.server "$NOCTA_HTTP_PORT" --bind 127.0.0.1 \
            > logs/http.log 2>&1 &
        echo $! > logs/http.pid
        sleep 1
        if kill -0 "$(cat logs/http.pid)" >/dev/null 2>&1; then
            info "http server PID $(cat logs/http.pid) — log: logs/http.log"
        else
            warn "http server exited immediately. Last log lines:"
            tail -n 20 logs/http.log >&2 || true
            die "http server failed to start."
        fi
    else
        START_HTTP=0
    fi
fi

# ---- Start Ollama -----------------------------------------------------------
if (( START_OLLAMA )); then
    if ! command -v ollama >/dev/null 2>&1; then
        warn "ollama not found on PATH — skipping."
        warn "  Install from https://ollama.com/download, or pass --no-ollama if it's already running."
    elif check_port ollama 11434; then
        # Only start ollama if port 11434 is free. If something else (e.g.
        # the Ollama menu-bar app) is already on it, just reuse.
        say "Starting Ollama daemon on http://127.0.0.1:11434 ..."
        # OLLAMA_ORIGINS is honored only by `ollama serve` itself; passing
        # it through env lets hosted Nocta pages (e.g. GitHub Pages) call in.
        nohup env "OLLAMA_ORIGINS=${OLLAMA_ORIGINS:-}" ollama serve \
            > logs/ollama.log 2>&1 &
        echo $! > logs/ollama.pid
        sleep 2
        if kill -0 "$(cat logs/ollama.pid)" >/dev/null 2>&1; then
            info "ollama PID $(cat logs/ollama.pid) — log: logs/ollama.log"
        else
            warn "ollama exited immediately. Last log lines:"
            tail -n 20 logs/ollama.log >&2 || true
            die "ollama failed to start."
        fi
    else
        info "ollama already on :11434 (probably the menu-bar app) — reusing"
    fi
fi

# ---- Summary ----------------------------------------------------------------
echo ""
say "${BOLD}Nocta is up.${RESET}"
(( START_HTTP   )) && info "Open:    http://localhost:${NOCTA_HTTP_PORT}/"
(( START_VOICE  )) && info "Voice:   http://127.0.0.1:${STT_PORT}/transcribe  +  http://127.0.0.1:${TTS_PORT}/speak"
(( START_OLLAMA )) && info "Ollama:  http://127.0.0.1:11434/"
echo ""
info "Stop everything with:  ./stop-nocta.sh"
echo ""

# ---- Follow logs (unless --no-tail) ----------------------------------------
if (( TAIL_LOGS )); then
    # -F (capital) survives log truncation/rotation, important when the
    # user restarts a component later.
    # shellcheck disable=SC2086
    LOG_FILES=()
    (( START_VOICE  )) && LOG_FILES+=(logs/voice.log)
    (( START_HTTP   )) && LOG_FILES+=(logs/http.log)
    (( START_OLLAMA )) && LOG_FILES+=(logs/ollama.log)

    if (( ${#LOG_FILES[@]} > 0 )); then
        info "Following logs (Ctrl-C exits tail; daemons keep running)."
        echo ""
        exec tail -F "${LOG_FILES[@]}"
    fi
fi
