#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# setup.sh — one-command bootstrap for the voice server on macOS / Linux.
#
# What it does:
#   1. Checks Python >= 3.9 is available.
#   2. Creates a local virtual environment in ./.venv (skipped if present).
#   3. Installs requirements.txt into it.
#   4. Copies .env.example to .env (skipped if .env already exists).
#   5. Downloads the default Piper voice (~60MB) into ./voices/.
#   6. Prints next steps.
#
# Idempotent: re-running it skips anything that's already done.
# Tested on macOS 13+ and Ubuntu 22.04.
#
# Usage:
#   ./setup.sh                  # full bootstrap
#   ./setup.sh --skip-voice     # skip the Piper download
#   ./setup.sh --reinstall      # nuke .venv and reinstall
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Resolve paths relative to THIS script, not the cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ---- CLI flags --------------------------------------------------------------
SKIP_VOICE=0
REINSTALL=0
for arg in "$@"; do
    case "$arg" in
        --skip-voice)  SKIP_VOICE=1 ;;
        --reinstall)   REINSTALL=1 ;;
        -h|--help)
            sed -n '2,18p' "$0"
            exit 0 ;;
        *) echo "Unknown flag: $arg"; exit 1 ;;
    esac
done

# ---- Pretty logging ---------------------------------------------------------
GREEN=$'\033[0;32m'
YELLOW=$'\033[0;33m'
RED=$'\033[0;31m'
RESET=$'\033[0m'
say()  { printf '%s==>%s %s\n' "$GREEN"  "$RESET" "$*"; }
warn() { printf '%s!!%s  %s\n' "$YELLOW" "$RESET" "$*"; }
die()  { printf '%sXX%s  %s\n' "$RED"    "$RESET" "$*" >&2; exit 1; }

# ---- 1. Python check --------------------------------------------------------
say "Checking Python..."
PY=""
for cand in python3 python; do
    if command -v "$cand" >/dev/null 2>&1; then
        PY="$cand"
        break
    fi
done
[[ -n "$PY" ]] || die "Python not found. Install Python 3.9+ from https://python.org or your package manager."

PY_VERSION="$($PY -c 'import sys;print("%d.%d"%sys.version_info[:2])')"
PY_MAJOR="$($PY -c 'import sys;print(sys.version_info[0])')"
PY_MINOR="$($PY -c 'import sys;print(sys.version_info[1])')"
if (( PY_MAJOR < 3 || (PY_MAJOR == 3 && PY_MINOR < 9) )); then
    die "Found Python $PY_VERSION but need 3.9+. Please install a newer Python."
fi
say "Found Python $PY_VERSION at $(command -v $PY)"

# ---- 2. Virtual environment -------------------------------------------------
if (( REINSTALL )); then
    warn "--reinstall: removing existing .venv"
    rm -rf .venv
fi

if [[ ! -d ".venv" ]]; then
    say "Creating virtual environment in .venv..."
    $PY -m venv .venv
else
    say ".venv already exists — skipping create (use --reinstall to nuke)"
fi

# shellcheck disable=SC1091
source .venv/bin/activate

say "Upgrading pip..."
python -m pip install --quiet --upgrade pip

# ---- 3. Install requirements ------------------------------------------------
say "Installing Python dependencies from requirements.txt (this can take a few minutes the first time)..."
python -m pip install --quiet -r requirements.txt
say "Dependencies installed."

# ---- 4. .env ----------------------------------------------------------------
if [[ ! -f ".env" ]]; then
    if [[ -f ".env.example" ]]; then
        cp .env.example .env
        say "Created .env from .env.example — edit it if you want to change defaults"
    else
        warn ".env.example missing — skipping .env creation"
    fi
else
    say ".env already exists — leaving it alone"
fi

# ---- 5. Piper voice ---------------------------------------------------------
if (( SKIP_VOICE )); then
    warn "--skip-voice: skipping Piper voice download"
else
    mkdir -p voices
    # Read voice name from .env if present, otherwise default.
    PIPER_VOICE="en_US-amy-medium"
    if [[ -f ".env" ]]; then
        ENV_VAL=$(grep -E '^PIPER_VOICE=' .env | head -1 | cut -d= -f2- | tr -d '"' || true)
        [[ -n "$ENV_VAL" ]] && PIPER_VOICE="$ENV_VAL"
    fi

    VOICE_ONNX="voices/${PIPER_VOICE}.onnx"
    VOICE_JSON="voices/${PIPER_VOICE}.onnx.json"

    if [[ -f "$VOICE_ONNX" && -f "$VOICE_JSON" ]]; then
        say "Piper voice '$PIPER_VOICE' already in ./voices/ — skipping download"
    else
        say "Downloading Piper voice '$PIPER_VOICE' (~60MB) into ./voices/ ..."
        # HuggingFace URL convention: en/en_US/<name_short>/<quality>/<name>
        # Example: en_US-amy-medium -> en/en_US/amy/medium/en_US-amy-medium.onnx
        QUALITY="$(echo "$PIPER_VOICE" | awk -F- '{print $NF}')"
        SHORT="$(echo "$PIPER_VOICE" | sed -E 's/^en_US-//; s/-[a-z]+$//')"
        BASE="https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/${SHORT}/${QUALITY}/${PIPER_VOICE}"

        if command -v curl >/dev/null 2>&1; then
            curl -fL --progress-bar -o "$VOICE_ONNX"   "${BASE}.onnx"      || die "voice download failed"
            curl -fL --progress-bar -o "$VOICE_JSON"   "${BASE}.onnx.json" || die "voice config download failed"
        elif command -v wget >/dev/null 2>&1; then
            wget -q --show-progress -O "$VOICE_ONNX"  "${BASE}.onnx"      || die "voice download failed"
            wget -q --show-progress -O "$VOICE_JSON"  "${BASE}.onnx.json" || die "voice config download failed"
        else
            die "Neither curl nor wget found. Install one and rerun."
        fi
        say "Voice downloaded."
    fi
fi

# ---- 6. Done ----------------------------------------------------------------
cat <<EOF

${GREEN}Setup complete!${RESET}

Next steps:

  1. Start Ollama (in a separate terminal):
       ollama serve

  2. Start the voice server (in another terminal):
       source .venv/bin/activate
       python voice_server.py
     First request will lazy-load the Whisper model (~10-20s).

  3. Open ${YELLOW}index.html${RESET} in Chrome, Edge, or Brave.
     Click the gear icon -> Preferences and set:
       Voice (STT) endpoint : http://localhost:5005/transcribe
       Voice (TTS) endpoint : http://localhost:5006/speak
     Click Save. The mic and speaker icons appear in the input bar.

If you ever need to redo everything from scratch:
  rm -rf .venv voices .env && ./setup.sh

EOF
