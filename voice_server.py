#!/usr/bin/env python3
"""
voice_server.py — small local FastAPI app that pairs with Nocta's voice UI.

Endpoints (defaults):
    POST http://localhost:5005/transcribe   -> {"text": "..."}   (faster-whisper)
    POST http://localhost:5006/speak        -> audio/wav bytes   (piper TTS)

Why two ports? They are independent services; running each on its own port
keeps CORS, restarts, and failure modes isolated. Both can also be combined
behind a single uvicorn process by importing both routers.

Dependencies (CPU is fine; GPU optional):
    pip install -r requirements.txt
    # Or manually:
    #   pip install fastapi 'uvicorn[standard]' python-multipart python-dotenv
    #   pip install faster-whisper piper-tts

Configuration:
    Copy .env.example to .env and edit as needed. Anything you leave
    blank falls back to the defaults below. The script is fully
    self-contained — no absolute paths, no machine-specific config.

Model downloads happen on first request and are cached under:
    faster-whisper: ~/.cache/huggingface/hub
    piper:         ./voices/  (relative to this script's directory)

Disk footprint (defaults below): ~150MB whisper base + ~60MB piper voice
≈ 210MB total. Set WHISPER_MODEL=tiny + PIPER_VOICE=en_US-amy-low for ~135MB.

Run:
    python voice_server.py
Then in Nocta -> Preferences -> Voice, set:
    STT: http://localhost:5005/transcribe
    TTS: http://localhost:5006/speak

For a one-command bootstrap on macOS/Linux, run ./setup.sh instead.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import struct
import sys
import threading
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Resolve paths relative to THIS script's directory (not the cwd), so the
# server works the same way no matter where you invoke it from.
_SCRIPT_DIR = Path(__file__).resolve().parent

# Load .env from the project root if present. Missing file is fine — all
# settings have defaults. Existing real env vars always win over .env.
load_dotenv(_SCRIPT_DIR / ".env", override=False)

from fastapi import FastAPI, File, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

log = logging.getLogger("voice_server")

# ─────────────────────────────────────────────────────────────────────────────
# Configuration via environment variables / .env (all optional)
# ─────────────────────────────────────────────────────────────────────────────
STT_HOST = os.environ.get("STT_HOST", "127.0.0.1")
STT_PORT = int(os.environ.get("STT_PORT", "5005"))
TTS_HOST = os.environ.get("TTS_HOST", "127.0.0.1")
TTS_PORT = int(os.environ.get("TTS_PORT", "5006"))

# Whisper model size: tiny (~75MB), base (~150MB), small (~500MB).
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
# Whisper compute type: int8 (CPU, smallest), float16 (GPU), float32 (CPU fallback).
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
WHISPER_BEAM = int(os.environ.get("WHISPER_BEAM", "1"))

# Piper voice: ~60MB en_US voice, auto-downloaded on first run if absent.
# Override with PIPER_VOICE=en_US-amy-low if you want the smaller low-quality voice.
PIPER_VOICE = os.environ.get("PIPER_VOICE", "en_US-amy-medium")

# Voice directory. Relative paths are resolved from the script directory
# (so the project is self-contained and portable). Default is ./voices/.
_raw_voices_dir = os.environ.get(
    "VOICES_DIR",
    os.environ.get("PIPER_VOICES_DIR", "./voices"),  # legacy alias
)
_voices_path = Path(_raw_voices_dir)
if not _voices_path.is_absolute():
    _voices_path = (_SCRIPT_DIR / _voices_path).resolve()
PIPER_VOICES_DIR = _voices_path

# ─────────────────────────────────────────────────────────────────────────────
# Optional imports — kept lazy so the user can run STT-only or TTS-only.
# ─────────────────────────────────────────────────────────────────────────────
class _LazyModel:
    """Holds a heavy model and only initialises it on first .get() call."""
    def __init__(self, name: str, loader):
        self.name = name
        self._loader = loader
        self._model = None
        self._lock = threading.Lock()

    def get(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    log.info("loading %s ...", self.name)
                    self._model = self._loader()
                    log.info("%s ready", self.name)
        return self._model

# These will be filled at runtime if the user opts in.
_whisper = _LazyModel("faster-whisper", lambda: None)
_piper = _LazyModel("piper", lambda: None)


# ─────────────────────────────────────────────────────────────────────────────
# Audio helpers — convert whatever the browser sends into 16kHz mono PCM,
# which is what faster-whisper expects.
# ─────────────────────────────────────────────────────────────────────────────
def _decode_audio_to_pcm16(audio_bytes: bytes, src_hint: str = "") -> tuple[bytes, int]:
    """
    Return (pcm16_bytes, sample_rate). Tries ffmpeg if available, falls back to
    the stdlib `wave` module for raw WAV input. Whisper will resample, but
    decoding once up-front keeps the latency predictable.
    """
    # 1) Try ffmpeg first — it handles webm/opus/m4a/ogg in one go.
    try:
        import subprocess, tempfile
        with tempfile.NamedTemporaryFile(suffix=Path(src_hint).suffix or ".bin", delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name
        try:
            proc = subprocess.run(
                ["ffmpeg", "-nostdin", "-loglevel", "error",
                 "-i", tmp_path,
                 "-f", "s16le", "-acodec", "pcm_s16le",
                 "-ac", "1", "-ar", "16000", "-"],
                capture_output=True, timeout=30,
            )
            if proc.returncode == 0 and proc.stdout:
                return proc.stdout, 16000
            log.warning("ffmpeg decode failed: %s", proc.stderr.decode("utf-8", "ignore")[:200])
        finally:
            try: os.unlink(tmp_path)
            except OSError: pass
    except FileNotFoundError:
        log.info("ffmpeg not on PATH; falling back to stdlib wave for raw WAV input")
    except subprocess.TimeoutExpired:
        log.warning("ffmpeg timed out decoding audio")

    # 2) Fallback: assume the bytes are a WAV file (works for Safari/Edge uploads).
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            ch = wf.getnchannels()
            sw = wf.getsampwidth()
            sr = wf.getframerate()
            raw = wf.readframes(wf.getnframes())
        if sw != 2:
            raise HTTPException(400, f"unsupported WAV sample width {sw} (need 16-bit)")
        if ch == 1:
            return raw, sr
        # downmix stereo to mono
        samples = struct.unpack("<%dh" % (len(raw) // 2), raw)
        mono = samples[0::2]  # crude: take left channel
        return struct.pack("<%dh" % len(mono), *mono), sr
    except wave.Error as e:
        raise HTTPException(400, f"could not decode audio ({e}). Install ffmpeg to support webm/opus.") from e


# ─────────────────────────────────────────────────────────────────────────────
# /transcribe — speech to text via faster-whisper
# ─────────────────────────────────────────────────────────────────────────────
def _load_whisper():
    from faster_whisper import WhisperModel
    return WhisperModel(WHISPER_MODEL, device="auto", compute_type=WHISPER_COMPUTE)

def _stt_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("STT endpoint ready on http://%s:%d", STT_HOST, STT_PORT)
        yield

    app = FastAPI(title="Nocta STT", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/")
    async def root():
        return {"service": "nocta-stt", "model": WHISPER_MODEL, "compute": WHISPER_COMPUTE}

    @app.get("/health")
    async def health():
        return {"ok": True, "whisper_loaded": _whisper._model is not None}

    @app.post("/transcribe")
    async def transcribe(audio: bytes = File(...), language: Optional[str] = Form(None)):
        if not audio:
            raise HTTPException(400, "empty audio upload")
        try:
            pcm, sr = await asyncio.to_thread(_decode_audio_to_pcm16, audio)
        except HTTPException:
            raise
        except Exception as e:
            log.exception("audio decode failed")
            raise HTTPException(400, f"audio decode failed: {e}")

        try:
            model = _whisper.get()
            if model is None:
                _whisper._model = await asyncio.to_thread(_load_whisper)
                model = _whisper._model
            segments, info = await asyncio.to_thread(
                model.transcribe,
                pcm, language=language, beam_size=WHISPER_BEAM,
                vad_filter=True, condition_on_previous_text=False,
            )
            text = " ".join(seg.text.strip() for seg in segments).strip()
            return JSONResponse({
                "text": text,
                "language": info.language,
                "duration": info.duration,
            })
        except HTTPException:
            raise
        except Exception as e:
            log.exception("transcription failed")
            raise HTTPException(500, f"transcription failed: {e}")

    return app


# ─────────────────────────────────────────────────────────────────────────────
# /speak — text to speech via piper
# ─────────────────────────────────────────────────────────────────────────────
def _ensure_piper_voice():
    """Download a Piper voice if it isn't on disk yet."""
    PIPER_VOICES_DIR.mkdir(parents=True, exist_ok=True)
    onnx_path = PIPER_VOICES_DIR / f"{PIPER_VOICE}.onnx"
    json_path = PIPER_VOICES_DIR / f"{PIPER_VOICE}.onnx.json"
    if onnx_path.exists() and json_path.exists():
        return onnx_path, json_path

    base = f"https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/{PIPER_VOICE.split('-',1)[-1] if '-' in PIPER_VOICE else 'low'}/{PIPER_VOICE}"
    # The exact path under rhasspy/piper-voices is:
    #   en/en_US/<voice>/<quality>/<PIPER_VOICE>.onnx[.json]
    # We let users override the dir via PIPER_VOICE_URL if the convention moves.
    # The default below mirrors the file layout shipped with piper's release zip.
    url_root = os.environ.get("PIPER_VOICE_URL")
    if not url_root:
        # Heuristic: most en_US-low voices live under en/en_US/amy/low/en_US-amy-low.onnx
        # We try a couple of common subpaths before giving up.
        candidates = [
            f"https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/{PIPER_VOICE.split('en_US-')[-1].split('-', 1)[0]}/{PIPER_VOICE.split('-')[-1]}/{PIPER_VOICE}",
            f"https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/{PIPER_VOICE.split('en_US-')[-1].split('-', 1)[0]}/{PIPER_VOICE}",
        ]
    else:
        candidates = [url_root]

    try:
        import urllib.request
    except ImportError:
        raise HTTPException(500, "piper voice missing and urllib unavailable; restore the file manually")

    last_err = None
    for base in candidates:
        try:
            for fname in ("onnx", "onnx.json"):
                target = PIPER_VOICES_DIR / f"{PIPER_VOICE}.{fname}"
                if target.exists():
                    continue
                url = f"{base}.{fname}"
                log.info("downloading %s", url)
                urllib.request.urlretrieve(url, target)
            return onnx_path, json_path
        except Exception as e:
            last_err = e
            log.warning("voice download attempt failed (%s)", e)
    raise HTTPException(
        500,
        f"could not download piper voice {PIPER_VOICE}: {last_err}. "
        "Set PIPER_VOICE_URL to the directory containing the .onnx and .onnx.json files."
    )


def _load_piper():
    try:
        from piper import PiperVoice
    except ImportError as e:
        raise RuntimeError(
            "piper-tts is not installed. Run: pip install piper-tts"
        ) from e
    onnx_path, json_path = _ensure_piper_voice()
    return PiperVoice.load(str(onnx_path), config_path=str(json_path), use_cuda=False)


def _tts_app() -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("TTS endpoint ready on http://%s:%d", TTS_HOST, TTS_PORT)
        yield

    app = FastAPI(title="Nocta TTS", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["POST", "GET", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/")
    async def root():
        return {"service": "nocta-tts", "voice": PIPER_VOICE, "voices_dir": str(PIPER_VOICES_DIR)}

    @app.get("/health")
    async def health():
        return {"ok": True, "piper_loaded": _piper._model is not None}

    @app.post("/speak")
    async def speak(request: Request):
        try:
            payload = await request.json()
        except Exception:
            raise HTTPException(400, "expected JSON body with `text`")
        text = (payload.get("text") or "").strip()
        if not text:
            raise HTTPException(400, "empty `text`")
        # Hard cap so a runaway reply can't tie up the CPU for minutes.
        text = text[:4000]

        try:
            if _piper._model is None:
                _piper._model = await asyncio.to_thread(_load_piper)
            voice = _piper._model

            def synth():
                buf = io.BytesIO()
                with wave.open(buf, "wb") as wf:
                    voice.synthesize(text, wf)
                return buf.getvalue()

            wav_bytes = await asyncio.to_thread(synth)
            return Response(content=wav_bytes, media_type="audio/wav")
        except HTTPException:
            raise
        except Exception as e:
            log.exception("synthesis failed")
            raise HTTPException(500, f"synthesis failed: {e}")

    return app


# ─────────────────────────────────────────────────────────────────────────────
# Combined launcher — start STT and TTS together in one process.
# ─────────────────────────────────────────────────────────────────────────────
def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    try:
        import uvicorn
    except ImportError:
        print("uvicorn not installed. Run: pip install 'uvicorn[standard]'", file=sys.stderr)
        sys.exit(1)

    # Warm the models on startup so the first user request doesn't pay the load cost.
    if "--no-warmup" not in sys.argv:
        def warm():
            try:
                _whisper.get() if _whisper._loader is not None else None
            except Exception as e:
                log.warning("whisper warmup failed: %s", e)
            try:
                _piper.get()
            except Exception as e:
                log.warning("piper warmup failed: %s", e)
        threading.Thread(target=warm, daemon=True).start()

    stt = _stt_app()
    tts = _tts_app()

    config_stt = uvicorn.Config(stt, host=STT_HOST, port=STT_PORT, log_level="info")
    config_tts = uvicorn.Config(tts, host=TTS_HOST, port=TTS_PORT, log_level="info")
    server_stt = uvicorn.Server(config_stt)
    server_tts = uvicorn.Server(config_tts)

    async def run():
        await asyncio.gather(server_stt.serve(), server_tts.serve())

    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        log.info("shutting down")


if __name__ == "__main__":
    main()