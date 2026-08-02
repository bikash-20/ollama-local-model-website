#!/usr/bin/env python3
"""
download_voice.py — manually fetch a Piper voice file pair.

Use this when voice_server.py can't auto-download the voice (e.g. the
auto-download is blocked by SSL, firewall, or you're offline). It writes
the .onnx and .onnx.json files into ./voices/ (or wherever VOICES_DIR points).

Usage:
    python download_voice.py                          # default voice (en_US-amy-medium)
    python download_voice.py en_US-amy-low            # smaller voice
    python download_voice.py --url https://my-mirror/  # custom base URL

Environment overrides:
    VOICES_DIR / PIPER_VOICES_DIR   target directory
    PIPER_VOICE                     voice name (matches filename without suffix)
    PIPER_VOICE_URL                 custom base URL prefix (no .onnx suffix)

Exit codes:
    0  success
    1  network / TLS error
    2  missing file after download
    3  bad arguments
"""
from __future__ import annotations

import argparse
import os
import ssl
import sys
import urllib.request
from pathlib import Path

_SCRIPT_DIR = Path(__file__).resolve().parent


def _ssl_context() -> tuple[ssl.SSLContext, bool]:
    """Pick the best SSL context we can build; mirror voice_server.py logic."""
    # 1. certifi
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where()), False
    except ImportError:
        pass
    # 2. truststore
    try:
        import truststore  # type: ignore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT), False
    except ImportError:
        pass
    # 3. Default
    try:
        return ssl.create_default_context(), False
    except Exception:
        pass
    # 4. Insecure fallback
    print(
        "!! WARNING: no CA bundle found; downloading WITHOUT TLS verification.",
        file=sys.stderr,
    )
    return ssl._create_unverified_context(), True  # noqa: SLF001


def _candidate_urls(voice: str, base_override: str | None) -> list[str]:
    if base_override:
        return [base_override.rstrip("/")]
    parts = voice.split("-")
    if len(parts) >= 3 and parts[0] == "en" and parts[1] == "US":
        quality, short = parts[-1], "-".join(parts[2:-1])
        primary = (
            f"https://huggingface.co/rhasspy/piper-voices/resolve/main/"
            f"en/en_US/{short}/{quality}/{voice}"
        )
    else:
        quality = parts[-1] if len(parts) >= 2 else "medium"
        short = parts[1] if len(parts) >= 3 else voice
        primary = (
            f"https://huggingface.co/rhasspy/piper-voices/resolve/main/"
            f"en/en_US/{short}/{quality}/{voice}"
        )
    fallback = (
        f"https://huggingface.co/rhasspy/piper-voices/resolve/main/"
        f"en/en_US/{voice.split('en_US-')[-1].split('-', 1)[0]}/{voice}"
    )
    return [primary, fallback]


def _resolve_voices_dir() -> Path:
    raw = os.environ.get("VOICES_DIR") or os.environ.get("PIPER_VOICES_DIR") or "./voices"
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = (_SCRIPT_DIR / p).resolve()
    return p


def _download(url: str, dest: Path, ctx: ssl.SSLContext) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    req = urllib.request.Request(url, headers={"User-Agent": "nocta-download_voice/1.0"})
    print(f"-> downloading {url}")
    with urllib.request.urlopen(req, context=ctx, timeout=120) as resp, \
         open(tmp, "wb") as out:
        total = int(resp.headers.get("Content-Length") or 0)
        read = 0
        chunk = 64 * 1024
        while True:
            buf = resp.read(chunk)
            if not buf:
                break
            out.write(buf)
            read += len(buf)
            if total:
                pct = read * 100 // total
                print(f"\r   {pct:3d}%  {read}/{total} bytes", end="", flush=True)
        if total:
            print()  # newline after the progress line
    tmp.replace(dest)
    print(f"   saved -> {dest}  ({dest.stat().st_size} bytes)")


def main() -> int:
    ap = argparse.ArgumentParser(description="Download a Piper voice for the Nocta voice server.")
    ap.add_argument("voice", nargs="?",
                    default=os.environ.get("PIPER_VOICE", "en_US-amy-medium"),
                    help="Voice name (default: en_US-amy-medium). Matches the .onnx filename.")
    ap.add_argument("--url", default=os.environ.get("PIPER_VOICE_URL"),
                    help="Override base URL (no .onnx suffix).")
    ap.add_argument("--out", default=None,
                    help="Override output directory (defaults to VOICES_DIR or ./voices).")
    args = ap.parse_args()

    voice = args.voice
    out_dir = Path(args.out).expanduser().resolve() if args.out else _resolve_voices_dir()
    out_dir.mkdir(parents=True, exist_ok=True)

    onnx = out_dir / f"{voice}.onnx"
    cfg = out_dir / f"{voice}.onnx.json"

    if onnx.exists() and cfg.exists() \
            and onnx.stat().st_size > 1024 and cfg.stat().st_size > 32:
        print(f"voice '{voice}' already present in {out_dir} — nothing to do.")
        return 0

    ctx, insecure = _ssl_context()
    last_err = None
    for base in _candidate_urls(voice, args.url):
        try:
            for fname, target in (("onnx", onnx), ("onnx.json", cfg)):
                if target.exists() and target.stat().st_size > 1024:
                    print(f"   {target.name} already present, skipping")
                    continue
                _download(f"{base}.{fname}", target, ctx)
            print(f"\nOK: voice '{voice}' is ready in {out_dir}")
            return 0
        except Exception as e:
            last_err = e
            print(f"!! download attempt failed: {e}", file=sys.stderr)
            for f in (onnx, cfg):
                try:
                    if f.exists() and f.stat().st_size < 1024:
                        f.unlink()
                except OSError:
                    pass

    print(
        f"\nFAILED: could not download voice '{voice}'. Last error: {last_err}\n"
        "Try: install `certifi` (`pip install certifi`) or set PIPER_VOICE_URL "
        "to a mirror you can reach.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
