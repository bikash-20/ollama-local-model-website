# Nocta — a local AI chat for Ollama

> **Just want to try it?**
>
> 1. Open **https://bikash-20.github.io/ollama-local-model-website/** in Chrome, Edge, or Brave.
> 2. Install [Ollama](https://ollama.com/download) and pull a model: `ollama pull llama3.2`
> 3. In Nocta's sidebar, pick the model and start chatting.
>
> The full setup (LAN access, installing as an app, troubleshooting) is below — only read on if the three lines above didn't work for you.
<img width="1280" height="808" alt="image" src="https://github.com/user-attachments/assets/1c673b22-8ce7-4463-a55c-0dc05d406498" />


---

Nocta is a single self-contained HTML file that gives you a polished chat
interface on top of a running [Ollama](https://ollama.com) daemon. There is
no build step, no Node tooling, no backend to deploy. You open
`index.html` in any modern browser and start talking to the model
that is running on your machine — or on any other machine on your LAN.

It is built with the quirks of local open-weight models in mind. Ragged
tables get auto-repaired. Formulas that the model forgot to wrap in
`$...$` delimiters still get rendered. Streaming responses don't re-render
the whole page on every token. The whole thing is small enough to fit on a
USB stick.

[![Made with vanilla JS](https://img.shields.io/badge/Made%20with-vanilla%20JS-f7df1e?logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![No build step](https://img.shields.io/badge/Build-none-success)](#quick-start)
[![No backend](https://img.shields.io/badge/Backend-none-success)](#quick-start)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#license)

---

## Table of contents

- [What is Nocta?](#what-is-nocta)
- [Quick start](#quick-start)
- [Install and run Ollama](#install-and-run-ollama)
- [Use it from any device on your LAN](#use-it-from-any-device-on-your-lan)
- [Install it as an app (PWA)](#install-it-as-an-app-pwa)
- [The curated model catalog](#the-curated-model-catalog)
- [Features](#features)
- [Preferences and settings](#preferences-and-settings)
- [Voice input and output (local)](#voice-input-and-output-local)
- [Math rendering (KaTeX)](#math-rendering-katex)
- [Table repair](#table-repair)
- [Performance strategy](#performance-strategy)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Where your data lives](#where-your-data-lives)
- [Troubleshooting](#troubleshooting)
- [Architecture notes](#architecture-notes)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)

---

## What is Nocta?

Nocta is one file, `index.html`, that contains the markup, the
styles, and the JavaScript for the whole app. You can:

- Drop it on a USB stick and open it from any browser.
- Host it as a static file on any web server.
- Use it offline once it has been loaded — the only network requirement
  is the connection to Ollama and the CDN scripts/fonts that are loaded
  with `defer`.

It is tuned for the way people actually run local models. Smaller open
models frequently emit tables with ragged rows, formulas without
delimiters, and code blocks that subtly miss a fence. Nocta normalises all
of that before the text reaches the markdown renderer, so the output
looks the way you would expect it to.

---

## Quick start

You need two things: this repository (or just the single file) and a
running Ollama daemon.

### 1. Get the file

Clone the repo, or download `index.html` directly from this
repository. The HTML file is the only runtime file.

```bash
git clone https://github.com/bikash-20/ollama-local-model-website.git
cd ollama-local-model-website
```

### 2. Start Ollama

```bash
# macOS / Linux
ollama serve

# or, if you installed the desktop app, just launch it
```

By default Ollama listens on `http://localhost:11434`. That is already the
default endpoint in Nocta, so nothing else needs to change for local use.

### 3. Open the file

Double-click `index.html`, or:

```bash
# macOS
open index.html

# Linux
xdg-open index.html

# Or serve it (any static server works)
python3 -m http.server 8000
# then visit http://localhost:8000/
```

The first time it loads you will see a small skeleton while the page
boots, then the sidebar appears with your model list pulled from
`/api/tags`. Start typing.

That is the whole setup. No `npm install`, no Node version to manage, no
service to bring up.

---

## Install and run Ollama

If you don't already have Ollama installed:

| OS | Install command |
|----|-----------------|
| macOS | Download from <https://ollama.com/download/mac> or `brew install ollama` |
| Linux | `curl -fsSL https://ollama.com/install.sh \| sh` |
| Windows | Download the installer from <https://ollama.com/download/windows> |

Then pull a model:

```bash
ollama pull llama3.2:3b          # small, fast, a good default
ollama pull qwen2.5-coder:7b     # great for code
ollama pull deepseek-r1:7b       # distilled reasoning
ollama pull gemma2:9b            # strong general model
```

The model list inside Nocta shows everything you have already pulled via
`GET /api/tags`. Anything not installed yet is still listed as a
suggestion in the catalog — click **Pull** to download it.

---

## Use it from any device on your LAN

The whole point of running an LLM locally is that any device on the same
network can reach it. A phone, a tablet, a second laptop — they don't need
Ollama installed, only a browser and the host's IP address.

### Step 1 — bind Ollama to all interfaces

By default Ollama only listens on `127.0.0.1`. Expose it on the LAN:

```bash
# macOS / Linux
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

To make this permanent:

```bash
# macOS (launchd)
launchctl setenv OLLAMA_HOST "0.0.0.0:11434"

# Linux (systemd)
sudo systemctl edit ollama
# add the lines:
#   [Service]
#   Environment="OLLAMA_HOST=0.0.0.0:11434"
```

### Step 2 — find the host's IP

```bash
# macOS
ipconfig getifaddr en0

# Linux
hostname -I | awk '{print $1}'
```

You will get something like `192.168.1.42`.

### Step 3 — point the UI at it

Open Nocta, click the **gear icon** in the sidebar to open the
**Preferences** modal, and set the **Server URL** to:

```
http://192.168.1.42:11434
```

Click **Test connection** to confirm it can reach Ollama, then **Save**.

The endpoint is persisted in `localStorage` under the key
`nocta_settings_v1.serverUrl`, so each device keeps its own pointer to
whichever host has the GPU.

### Optional — firewall

If `Test connection` fails on macOS, allow incoming connections for
Ollama once:

```bash
# System Settings -> Network -> Firewall -> allow ollama
# or one-shot via CLI:
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/local/bin/ollama
```

---

## Install it as an app (PWA)

Nocta is a Progressive Web App. The browser can install it onto your phone,
tablet, laptop, or desktop so it opens in its own window with its own icon,
no address bar, and works offline once it has loaded.

### Prerequisites

PWA install needs a secure origin. That means either:

- Serving the file over `https://` (GitHub Pages, Netlify, Cloudflare Pages,
  your own domain with a TLS cert), or
- Loading it from `http://localhost` / `http://127.0.0.1` while developing.

Opening `index.html` directly from disk (`file://`) will not work for
PWA install — but the page itself still loads and the chat still functions.

### On Chrome, Edge, Brave, or Arc (desktop)

1. Open the page over `https://` or `localhost`.
2. Look for the install icon in the right side of the address bar, or use
   the **Install app** entry that appears in the sidebar once the page
   detects it can be installed.
3. Confirm the install prompt. Nocta will appear in your Applications
   folder and Start menu.

### On Android (Chrome, Edge, Samsung Internet)

1. Open the page in Chrome.
2. Tap the **three-dot menu** → **Install app** (or **Add to Home
   screen**). The sidebar also shows an **Install app** row.
3. The icon appears on your home screen and opens in standalone mode.

### On iPhone and iPad (Safari)

Safari does not surface a button for PWAs — install is one share-sheet tap
away:

1. Open the page in Safari.
2. Tap the **Share** button (square with the up arrow).
3. Scroll down and tap **Add to Home Screen**.
4. Confirm the name. The icon appears on your home screen and opens
   without Safari's chrome.

The manifest declares `apple-mobile-web-app-capable` so the icon opens in
standalone mode with a status-bar tint that matches the app theme.

### On macOS (Safari)

The same flow as iOS works in Safari 17 and later: **File → Add to
Dock**. Nocta will appear in the Dock and the Applications folder with
its own window and icon.

### After install

- The icon is the moon-glyph SVG in the `assets/` folder (rendered to PNG
  at every standard size, including a maskable variant for Android).
- The service worker (`sw.js`) caches the app shell and the four CDN
  scripts (marked, KaTeX, highlight.js, fonts). Once you've opened the
  app once online, it loads fully offline.
- The app never phones home. Updates happen silently when you reopen the
  app — the SW picks up the new HTML and asset list in the background.

### Troubleshooting install

| Symptom | Fix |
|---------|-----|
| Install button never appears | You are probably on `file://`. Serve over `http://localhost` or `https://`. |
| "Add to Home Screen" is greyed out on iOS | You opened the page in a non-Safari browser. Use Safari. |
| Install succeeds but the app opens in a browser tab | Your manifest is missing `display: standalone`. Open an issue with the browser + version. |
| Offline launch shows the wrong theme | Hard-refresh (Shift+Reload) to force the SW to re-cache the latest HTML. |

---

## The curated model catalog

Nocta ships with a built-in catalog of popular Ollama models so you can
pull a model before you have ever opened the app. Once `/api/tags`
responds, the live installed list takes priority and the catalog becomes
a fallback list of suggestions.

The catalog covers (with metadata like family, parameter size,
quantization, and format):

- Llama — 3.2, 3.1, 3.3 (1B through 70B)
- Qwen 2.5 — including the Coder line for code generation
- Mistral and Mixtral — including Mistral Nemo and Mixtral 8x7B MoE
- Phi-3 — Microsoft's compact reasoning models
- Gemma 2 — Google's open-weights line
- Codestral — Mistral's code specialist
- DeepSeek R1 — distilled reasoning at multiple sizes

Each entry carries a one-line description (e.g. "Meta Llama 3.2 — small
and fast chat model") so you can pick with confidence even when you have
never heard of the family before.

---

## Features

### Core chat

- Streaming responses — tokens appear the instant Ollama produces them
- Multiple chats with a searchable sidebar
- Edit and resend — click any user message to edit it and regenerate from there
- Copy any message with one click
- Regenerate the last assistant response against the same prompt
- Stop a generation mid-stream without freezing the UI

### UI and theming

- Dark and light mode toggle (persisted)
- Mobile-friendly layout with collapsible sidebar and overlay
- Collapsible sidebar — keep only the chat on screen when you need room
- Boot loader skeleton — the page paints fast, hydration happens after
- Responsive typography that reads well from phone to ultrawide

### Persistence

- All chats stored locally in your browser's `localStorage`
- Export the current chat to a Markdown file
- Clear all chats with a confirmation

### Streaming intelligence

- Live tokens-per-second stat shown under each assistant message
- Elapsed time stat alongside the token rate
- Streaming-aware rendering — during a stream the assistant bubble just
  appends text. The full Markdown to HTML pipeline runs once when the
  stream completes. No flickering, no partial KaTeX, no broken table rows.

### Markdown fidelity

- Auto-repair of malformed GFM tables (see [Table repair](#table-repair))
- Tolerant LaTeX detection for models that forget delimiters (see
  [Math rendering](#math-rendering-katex))
- Syntax-highlighted code blocks via highlight.js

---

## Preferences and settings

The **gear icon** lives in the **sidebar footer** — the pinned row of
controls at the very bottom of the left sidebar. That footer is always
visible, regardless of how many chats you have, and contains (from top
to bottom):

1. **Dark mode** toggle
2. **Preferences** — the gear icon. This is what you want.
3. **Install app** — only appears when the browser signals that the PWA
   is installable on your device.
4. **Export current chat**
5. **Clear all chats**

Click the **Preferences** row (the gear icon) to open the settings
modal. There are three settings:

| Setting | Description | Default |
|---------|-------------|---------|
| Server URL | Where to find Ollama. Use `http://host:port`. | `http://localhost:11434` |
| System prompt | Prepended to every new chat as the `system` role. | _(empty)_ |
| Temperature | Sampling temperature, `0.0` (deterministic) to `2.0` (chaos). | `0.7` |

There are also two checkboxes that toggle:

- **Send system prompt on every turn** (default: ON) — so the persona
  sticks across edits and regenerations.
- **Clear conversation context after each message** (advanced) — useful
  for benchmarks.

Click **Test connection** inside Preferences to ping Ollama before
saving.
---

## Voice input and output (local)

Nocta ships with an optional **fully local voice layer**: tap a mic icon
to dictate, and toggle a speaker icon to have the assistant's reply
read back to you. Speech-to-text runs on
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) and
text-to-speech runs on [Piper](https://github.com/rhasspy/piper).
Nothing leaves your machine — both models run on CPU and download on
first use.

The voice UI only appears once the endpoints are configured, so the
chat app behaves identically to before if you don't set this up.

### Prerequisites

- **Python 3.9 or newer** (`python3 --version`). The setup script
  refuses to run on anything older.
- **Ollama** running locally on `http://localhost:11434` (see the
  [Quick start](#quick-start) above).
- **A modern browser**: Chrome, Edge, Brave, or Arc. Firefox supports
  the chat but its `MediaRecorder` support for opus is limited.
- **~250MB of free disk** for the default Whisper base model + the
  Piper Amy medium voice.

### 1. One-command bootstrap (macOS / Linux)

```bash
git clone https://github.com/bikash-20/ollama-local-model-website.git
cd ollama-local-model-website
./setup.sh
```

`setup.sh` is idempotent and does the following:

1. Checks for Python 3.9+.
2. Creates `./.venv/` and installs `requirements.txt` into it.
3. Copies `.env.example` to `.env` (skipped if `.env` already exists).
4. Downloads the default Piper voice (~60MB) into `./voices/`.
5. Prints exactly which commands to run next.

Re-running `./setup.sh` skips anything that's already done. Use
`./setup.sh --reinstall` to wipe `.venv/` and start fresh, or
`./setup.sh --skip-voice` if you want to install Python deps but fetch
the voice file yourself.

### 2. Manual bootstrap (any OS, including Windows)

```bash
git clone https://github.com/bikash-20/ollama-local-model-website.git
cd ollama-local-model-website

# 1. Create a venv
python -m venv .venv

# 2. Activate it
#    macOS / Linux:
source .venv/bin/activate
#    Windows (cmd):
.venv\Scripts\activate.bat
#    Windows (PowerShell):
.venv\Scripts\Activate.ps1

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure (optional — defaults are fine for most people)
copy .env.example .env       # Windows
cp .env.example .env          # macOS / Linux

# 5. Download a Piper voice into ./voices/
#    (Windows: use Invoke-WebRequest or just download from
#     https://huggingface.co/rhasspy/piper-voices in your browser.)
mkdir voices
curl -fL -o voices/en_US-amy-medium.onnx      https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx
curl -fL -o voices/en_US-amy-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json
```

### 3. Start the voice server

In the same venv:

```bash
python voice_server.py
```

You'll see two FastAPI apps boot in one process:

| Endpoint | Default port | Purpose |
|---|---|---|
| `POST /transcribe` | `5005` | multipart `audio` field in → `{"text": "..."}` out |
| `POST /speak` | `5006` | JSON `{"text": "..."}` in → `audio/wav` bytes out |

Both endpoints enable CORS for any origin, so Nocta can call them
directly from `file://` or `http://localhost`.

Optional: install `ffmpeg` (`brew install ffmpeg` on macOS,
`apt install ffmpeg` on Linux, `winget install ffmpeg` on Windows).
The server falls back to the Python `wave` decoder if ffmpeg is
absent, but Chrome/Edge's default webm-opus blobs need ffmpeg.

### 4. Configure Nocta

Open `index.html` in Chrome/Edge/Brave, click the **gear icon →
Preferences**, and fill in:

- **Voice (STT) endpoint** — `http://localhost:5005/transcribe`
- **Voice (TTS) endpoint** — `http://localhost:5006/speak`

Click **Save**. The mic and speaker icons appear in the input bar.

### 5. Using it

- **Mic button** — click to start recording (a red pulse + dot appear
  in the input bar). Click again to stop, or just stop talking — the
  server auto-stops after ~1.5 s of silence (60 s hard cap). The audio
  is POSTed to your STT endpoint, the transcript is dropped into the
  text input, and `sendMessage()` runs through the existing pipeline
  so it shows up in your conversation history like any typed message.
- **Speaker button** — click once to enable read-aloud. After each
  assistant reply finishes streaming, the cleaned text is POSTed to
  your TTS endpoint and the returned `.wav` is autoplayed inline. The
  bubble it's playing from gets a soft cyan glow. Click again to mute.
- **First autoplay** — browsers require a user gesture before they
  allow audio to play. The first click on the speaker toggle counts
  as that gesture, so subsequent replies play automatically.

Errors are reported through the same red error banner the rest of the
app uses — no silent failures. Mic permission denied, the voice
server being down, or transcription returning empty text all surface
there.

### Configuration reference

All settings live in `.env`. Anything you leave blank falls back to
the defaults below:

| Variable | Default | Notes |
|---|---|---|
| `STT_HOST` | `127.0.0.1` | Set to `0.0.0.0` to accept from other LAN devices |
| `STT_PORT` | `5005` | |
| `TTS_HOST` | `127.0.0.1` | |
| `TTS_PORT` | `5006` | |
| `WHISPER_MODEL` | `base` | `tiny`/`base`/`small`/`medium`/`large-v3` |
| `WHISPER_COMPUTE` | `int8` | `int8` (CPU), `float16` (GPU), `float32` |
| `WHISPER_BEAM` | `1` | Higher = slower but more accurate |
| `PIPER_VOICE` | `en_US-amy-medium` | Must match a file in `VOICES_DIR` |
| `VOICES_DIR` | `./voices` | Relative paths are resolved from the project root |
| `PIPER_VOICE_URL` | (HuggingFace default) | Override if you mirror the voice elsewhere |

Disk footprint with defaults: **~210MB** total (150MB Whisper base +
60MB Piper en_US-amy-medium). Set `WHISPER_MODEL=tiny` and
`PIPER_VOICE=en_US-amy-low` to drop back to ~135MB.

### Troubleshooting

- **"Couldn't reach the voice server"** — make sure `voice_server.py`
  is running in a terminal and the URL in Preferences matches the
  port you actually bound (`STT_PORT`/`TTS_PORT`). Try
  `curl http://localhost:5005/healthz` from another terminal.
- **"Address already in use" on startup** — another process is using
  port 5005 or 5006. Either stop it (`lsof -ti:5005 | xargs kill` on
  macOS/Linux) or change the port in `.env` and update the URLs in
  Nocta's Preferences to match.
- **Autoplay blocked** — click the speaker toggle once to grant the
  gesture, then replies will autoplay.
- **"No speech detected"** — speak louder / move closer to the mic,
  or upgrade `WHISPER_MODEL=small` for noticeably better accuracy at
  the cost of another ~350MB.
- **ffmpeg missing / webm decode errors** — install ffmpeg (see step
  3). Without it the server can't decode Chrome/Edge's default
  webm-opus blobs.
- **Mic permission denied** — in Chrome, click the lock icon in the
  address bar and grant Microphone permission for `file://` or
  `http://localhost:*`. Then reload the page.
- **CORS errors in the browser console** — the server already allows
  any origin (`*`), so CORS errors almost always mean the URL is
  wrong or the server isn't actually running. Check the terminal
  where `voice_server.py` is running.
- **On Windows: `python` not found** — install Python from
  https://python.org and tick "Add Python to PATH" in the installer,
  or use the `py` launcher instead.

---


---

## Math rendering (KaTeX)

Local chat models are wildly inconsistent about LaTeX. Some wrap every
formula in `$...$`. Some wrap display equations in `$$...$$`. Some — like
Qwen 2.5 Coder — drop the delimiters entirely, or wrap a multi-line
derivation in plain `[ ... ]` brackets. Nocta handles all three.

### What the preprocessor catches

| Input shape | What Nocta does |
|-------------|-----------------|
| `$\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$` | Leaves it alone — already inline math |
| `$$ \begin{aligned} ... \end{aligned} $$` | Leaves it alone — already block math |
| `[ x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a} ]` | Rewrites the outer brackets to `$$ ... $$` |
| `of the form ( ax^2 + bx + c = 0 )` | Rewrites the parenthetical to `$ax^2 + bx + c = 0$` |
| A bare line `x^2 + 2x + 1 = 0` | Wraps in `$...$` automatically |
| A short line `b^2 - 4ac` or `a_n + 1` | Wraps in `$...$` automatically |

### How the detection works

There are four passes, in order, each idempotent:

1. **Multi-line `[ ... ]` unwrap** — if a block is just square brackets
   surrounding TeX, convert it to `$$ ... $$`.
2. **Paren-wrap** — `( LaTeX )` segments that read as math get the inner
   part rewrapped to `$...$`.
3. **Bare TeX line wrap** — any line containing `\cmd` primitives or TeX
   symbols (`\frac`, `\sqrt`, `\sum`, `\pi`, Greek letters, and so on)
   with no existing delimiter gets wrapped in `$...$`. Markdown structure
   lines (headings, lists, tables) are explicitly skipped so a bullet
   point never gets accidentally math-ified.
4. **Implicit equation pass** — short lines (under 60 characters) that
   have implicit math (`x^2`, `a_n`) and match a tight character class
   get wrapped.

### Why a retry loop

KaTeX is loaded with `defer`, which means it may not be ready the moment
the first response lands. `renderFinalMarkdown` retries
`renderMathInElement` every 80 ms (capped) until KaTeX is present, so the
first render of a cold page still gets math.

### Customisation

If the heuristic ever wraps something it shouldn't, edit the regexes at
the top of `wrapBareLatex` inside the file. They are deliberately short
and read like English.

---

## Table repair

Smaller open-weight models often emit GFM tables with ragged rows — the
second row (the `|---|---|` separator) doesn't match the column count
of the data rows, or the data rows are shorter than the header. Most
Markdown engines (and KaTeX's auto-render) silently drop or corrupt these
tables.

Nocta's `preprocessMarkdown` runs a two-pass repair before the text
hits `marked.parse()`:

1. **Separator normalisation** — every `|---|---|` line is rewritten to
   exactly N dashes where N matches the header column count.
2. **Row padding** — short data rows are padded with empty cells so
   every row lines up.

This makes a hallucinated table like:

```text
| Name | Score | Notes |
| --- | --- | ---
apple | 9 | tasty
```

still render as a 3-column table rather than a misaligned mess.

---

## Performance strategy

Nocta is a single 100 KB HTML file but the runtime has a lot going on
(markdown pipeline, KaTeX, highlight.js, two CDNs of fonts). The first
paint is fast because:

- System fonts first — no FOIT, no font swap, no invisible text. Web
  fonts are loaded non-blocking.
- Deferred third-party scripts — `marked`, `highlight.js`, and KaTeX's
  auto-render extension use `defer` or the `media="print" onload` swap
  pattern so they never block parsing.
- Skeleton UI — the chrome paints immediately; sidebar and data fill in
  after scripts hydrate.
- No re-renders during streaming — `appendStreamingText` writes to a
  single text node. No DOM thrash, no `innerHTML` per token.
- `preprocessMarkdown` is O(n) — table repair and LaTeX detection run
  once over the completed text, not per chunk.

The end result: time-to-first-byte for the page itself is dominated by
your disk, not by anything we ship.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift` + `Enter` | New line in input |
| `Esc` | Close open modal or stop generating |
| `Cmd` / `Ctrl` + `K` | Focus the chat search box |

---

## Where your data lives

Everything is in your browser's `localStorage`:

| Key | Contents |
|-----|----------|
| `nocta_state_v1` | All chats, the active chat id, the model picker state, the sidebar collapsed state |
| `nocta_settings_v1` | Server URL, system prompt, temperature, theme |

Nothing leaves your browser unless you explicitly click **Export current
chat**. No analytics, no telemetry, no calls home.

To wipe everything: clear site data from your browser's DevTools, or use
the **Clear all chats** button in the sidebar footer.

---

## Troubleshooting

### "Test connection" fails but Ollama is running

1. **Bind address** — make sure Ollama is listening on `0.0.0.0`, not
   just `127.0.0.1`. See
   [Use it from any device on your LAN](#use-it-from-any-device-on-your-lan).
2. **CORS** — Ollama allows any origin by default. If you have set
   `OLLAMA_ORIGINS`, add the page's URL to the allow-list.
3. **Firewall** — see the firewall note above for macOS.
4. **Mixed content** — if the page is served over `https://`, Ollama
   must be reachable over `https://` too. Easiest fix: open the HTML
   file directly (`file://`) or serve it over plain HTTP.

### Math shows as raw text

- Confirm the response has actually finished streaming — during a
  stream, plain text is shown by design, because KaTeX can't render a
  half-delimited formula.
- Open DevTools console. If you see any KaTeX or `renderMathInElement`
  errors, please open an issue with the model name and a paste of the
  raw response.

### Tables look broken or have empty columns

The automatic repair only pads short rows to the column count of the
header. If the model emits a row that is longer than the header, the
extras get dropped. This is a conservative choice — please file an issue
with the offending output and we will widen the heuristic.

### The page feels slow on first load

The first load pays the full CDN cost for fonts, marked, KaTeX, and
highlight.js. Subsequent loads hit the browser cache. If you need it
fully offline, vendor those four scripts into a sibling `vendor/`
directory and swap the `<script src>` tags inside `index.html`.

### Editing a user message regenerates the assistant reply but loses context

This is by design — edit-and-resend truncates the chat at the edited
message so the model gets a clean slate from that point on. If you want
to keep earlier context, just send a follow-up instead of editing.

---

## Architecture notes

The whole app is one HTML file. Inside the `<script>` tag, the runtime
is structured as:

```
state                  // in-memory + localStorage-backed chat state
settings               // in-memory + localStorage-backed preferences
ollamaBase()           // single source of truth for the server URL
preprocessMarkdown(src) // table repair + LaTeX detection passes
wrapBareLatex(src)      // tolerant LaTeX preprocessor (4 passes)
appendStreamingText(b,t)   // append-only text node during streams
renderFinalMarkdown(b,t)  // full marked -> KaTeX -> hljs pipeline
paintStreamingStats(m,...) // tokens/sec + elapsed UI
editAndResend(msgEl)       // edit and resend user messages
```

- No framework. Vanilla JS by design — the whole file is around 2,300
  lines and is readable top to bottom.
- One paint pipeline. Streaming never re-parses markdown. The final
  render happens exactly once, when the stream ends.
- Defensive preprocessor. Both tables and LaTeX get normalised before
  the markdown engine sees them.

---

## Roadmap

- Per-model parameter overrides (`top_p`, `top_k`, `repeat_penalty`)
- Streaming cancel that visibly un-disables the input
- Pin a specific message and branch the chat from it
- Image and vision model support (Ollama `/api/chat` multimodal)
- PWA manifest so it installs to the home screen on iOS and Android
- Optional backend proxy to bypass CORS for the truly paranoid

---

## Contributing

Issues and PRs are welcome. The bar to merge a PR is just:

1. The code still fits in one file (or, if you are splitting it up, has
   a reason and a one-line explanation in the PR body).
2. The README is updated for any user-visible change.
3. Keep the zero-build promise — don't add a `package.json` unless we
   are really ready to commit to that.

---

## License

[MIT](./LICENSE) — do whatever you want, just keep the copyright.

---

## Credits

Crafted by **Bikash Talukder**.

Built on the shoulders of:

- [Ollama](https://ollama.com) — for making local LLM inference trivially easy
- [marked](https://marked.js.org/) — the Markdown parser
- [KaTeX](https://katex.org/) — fast math typesetting
- [highlight.js](https://highlightjs.org/) — syntax highlighting

If you find this useful, dropping a star on the repo helps more than
you would think.
