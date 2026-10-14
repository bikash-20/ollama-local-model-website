# Nocta Setup Instructions for Windows

A step-by-step guide for Windows users who have just installed Ollama and want to use the Nocta PWA chat app.

---

## Prerequisites

Before you start, make sure you have:

| What you need | How to get it |
|---|---|
| **Windows 10 or 11** | Any modern Windows version |
| **Ollama** installed and running | Download from [ollama.com/download/windows](https://ollama.com/download/windows) |
| **Python 3.9 or newer** | Download from [python.org](https://www.python.org/downloads/windows/) — **tick "Add Python to PATH"** in the installer (very important) |
| **A modern browser** | Chrome, Edge, or Brave (Firefox works for chat but has limited microphone support) |
| **~250 MB free disk space** | Required only if you want to use voice features (Whisper STT + Piper TTS) |
| **ffmpeg** (recommended) | Install with `winget install ffmpeg` — needed to decode browser audio formats |

---

## Part 1 — Get Nocta

You have two options for getting the Nocta files. Choose whichever you prefer.

### Option A — Download as ZIP (simplest)

1. Open your browser and go to [github.com/bikash-20/ollama-local-model-website](https://github.com/bikash-20/ollama-local-model-website)
2. Click the green **Code** button near the top right
3. Click **Download ZIP**
4. Once downloaded, right-click the ZIP file and choose **Extract All...**
5. Extract it to a location you'll remember, for example `C:\Users\YourName\nocta\`

### Option B — Clone with Git

If you have Git installed, open PowerShell and run:

```powershell
cd C:\Users\YourName
git clone https://github.com/bikash-20/ollama-local-model-website.git
cd ollama-local-model-website
```

---

## Part 2 — Start Ollama

On Windows, Ollama usually installs as a system service and starts automatically. You typically don't need to start it manually.

To verify Ollama is running and pull your first model:

1. Open **PowerShell** (press the Windows key, type `powershell`, and press Enter)
2. Run the following command to download a small, fast model:

```powershell
ollama pull llama3.2:3b
```

The first download will take a few minutes depending on your internet speed (the model is about 2 GB).

**Quick test to confirm Ollama is working:**

```powershell
curl http://localhost:11434/api/tags
```

You should see a JSON response listing your installed models. If you see model names listed, Ollama is running correctly.

If the Ollama desktop app is in your system tray (bottom right of the screen), that's fine — it's already running.

---

## Part 3 — Open Nocta (Chat-Only Setup)

You have three ways to open Nocta. Pick the one that suits your needs.

### Option A — Double-click `index.html` (Easiest)

1. Open **File Explorer** and navigate to the Nocta folder you extracted
2. Double-click the file named `index.html`
3. Your default browser will open with the Nocta chat interface

> **Important note:** This method works for basic chat, but you **will not be able to install Nocta as a PWA** (Progressive Web App) from `file://` — you need `http://localhost` for that. Also, some browsers block microphone access on `file://` for security reasons. If you want voice features or PWA installation, use Option B instead.

### Option B — Local HTTP Server (Recommended)

This is the best way to use Nocta on Windows. It enables PWA installation, voice features, and avoids all browser security restrictions.

1. Open **File Explorer** to the Nocta folder
2. Click in the address bar at the top, type `powershell`, and press Enter — this opens PowerShell in that folder
3. In the PowerShell window, run:

```powershell
python -m http.server 8000
```

4. You should see output like:
   ```
   Serving HTTP on 127.0.0.1 port 8000 (http://127.0.0.1:8000/) ...
   ```

5. Open your browser (Chrome, Edge, or Brave) and go to:

   [http://localhost:8000/](http://localhost:8000/)

6. The Nocta chat interface will load

> **Keep this PowerShell window open** while using Nocta. Closing it will stop the server. To stop the server manually, press `Ctrl+C` in that PowerShell window.

### Option C — Use the Hosted GitHub Pages Version

You can also use the version hosted on GitHub Pages:

1. Open Chrome, Edge, or Brave
2. Go to [https://bikash-20.github.io/ollama-local-model-website/](https://bikash-20.github.io/ollama-local-model-website/)

> **Warning:** This will **fail to reach Ollama** on your computer. The hosted page is served over `https://` but Ollama runs on `http://`, and browsers block this "mixed content" for security. You'll see a message saying "Ollama server not detected" even though Ollama is running. Use Option A or B for actual chat functionality.

---

## Part 4 — Your First Chat

Once Nocta is open in your browser:

1. Look at the **sidebar** on the left side of the screen
2. You'll see a list of models you've installed (for example, `llama3.2:3b`)
3. Click on a model name to select it
4. Click in the **input bar** at the bottom of the screen
5. Type your message
6. Press **Enter** to send
7. The model will stream back its response one word at a time

That's it — you're chatting with a local AI model!

**Useful tips:**
- **Shift + Enter** creates a new line in the input without sending
- **Esc** closes any open dialog or stops a generation in progress
- **Ctrl + K** (or **Cmd + K** on Mac) focuses the chat search box
- Click any user message to edit and resend it
- Click the **gear icon** in the sidebar footer to open Preferences

---

## Part 5 — Install as a PWA (Optional)

Installing Nocta as a PWA gives you a standalone app with its own window and icon, no address bar, and it works offline once loaded.

This only works if you opened Nocta via **Option B** (local HTTP server) or **Option C** (GitHub Pages) from Part 3.

**To install in Chrome, Edge, or Brave:**

1. Make sure Nocta is open in your browser
2. Look for the **install icon** in the right side of the address bar — it looks like a small computer monitor with a down arrow
3. Click the install icon
4. A dialog will appear asking if you want to install — click **Install**
5. Nocta will now appear in your **Start Menu** and open in its own window without any browser chrome

**No install button appearing?** This means you opened Nocta from `file://` (Option A). Close that tab, use Option B instead, and the install option will appear.

---

## Part 6 — Add Voice Input and Output (Optional)

This section is for users who want to **talk to their model** instead of typing, and have the model **talk back** to them out loud.

Voice features require running a small local Python server. Skip this section if you only want text chat.

### 6.1 — Install ffmpeg

ffmpeg is needed to decode the audio format your browser sends.

1. Open **PowerShell as Administrator** (right-click the Start button → "Windows PowerShell (Admin)" or "Terminal (Admin)")
2. Run:

```powershell
winget install ffmpeg
```

3. Wait for the installation to complete
4. **Close and reopen all PowerShell windows** so the PATH update takes effect

### 6.2 — Set Up the Python Environment

1. Open **File Explorer** and navigate to the Nocta folder
2. Click in the address bar, type `powershell`, and press Enter
3. In the PowerShell window, run these commands one at a time:

```powershell
python -m venv .venv
```

```powershell
.venv\Scripts\Activate.ps1
```

> **Getting an error like "running scripts is disabled"?** This is Windows PowerShell's execution policy blocking the activation script. Fix it by running this command once in PowerShell **as Administrator**:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
> ```
> Then close that Administrator window, return to your regular PowerShell, and try the activation command again.

4. With the venv activated (you should see `(.venv)` at the start of your prompt), install the dependencies:

```powershell
pip install -r requirements.txt
```

This will take several minutes the first time. It downloads:
- Whisper speech recognition model (~150 MB — downloaded on first use)
- Piper text-to-speech engine
- FastAPI web framework and other supporting packages

5. Create your configuration file:

```powershell
copy .env.example .env
```

### 6.3 — Start the Voice Server

In the same PowerShell window (with the venv still activated), run:

```powershell
python voice_server.py
```

You should see output like:

```
2026-10-14 [voice_server] INFO: TTS endpoint ready on http://127.0.0.1:5006
2026-10-14 [voice_server] INFO: STT endpoint ready on http://127.0.0.1:5005
```

**Leave this window open** — the voice server runs in the foreground. The first time you use voice, Whisper will take about 30 seconds to download the speech recognition model. After that, it loads in about 3 seconds from the cache.

### 6.4 — Configure Nocta to Use the Voice Server

1. In your browser, go to Nocta (it should still be open from Part 3)
2. Click the **gear icon** at the bottom of the left sidebar to open **Preferences**
3. Find the **Voice** section and fill in:
   - **Voice (STT) endpoint**: `http://localhost:5005/transcribe`
   - **Voice (TTS) endpoint**: `http://localhost:5006/speak`
4. Click **Save**

After saving, a **microphone icon** and a **speaker icon** will appear in the input bar at the bottom of the chat.

### 6.5 — Using Voice Features

**To dictate a message:**
1. Click the **microphone icon** in the input bar
2. Speak your message — you'll see a red pulse indicating it's recording
3. Click the microphone again to stop, or just stop talking (it auto-stops after 1.5 seconds of silence)
4. Your speech is sent to Whisper for transcription
5. The transcribed text appears in the input box and is automatically sent to your model

**To hear responses read aloud:**
1. Click the **speaker icon** in the input bar to enable read-aloud
2. After each assistant reply finishes, the text is converted to speech by Piper
3. The audio plays automatically through your speakers
4. Click the speaker icon again to mute

> **Note:** The very first time you click the speaker icon, your browser may ask for permission to play audio. Click "Allow" — this is a one-time setup.

---

## Part 7 — Access from Your Phone (Optional)

Want to use Nocta from your phone while your computer runs the models? Here's how:

### 7.1 — Find Your Computer's IP Address

1. Open PowerShell on your computer
2. Run:

```powershell
ipconfig
```

3. Look for the **IPv4 Address** under your Wi-Fi adapter (it will look something like `192.168.1.42`)

### 7.2 — Allow Ollama on the LAN

By default, Ollama only accepts connections from your computer. To let other devices on your network connect:

1. **Quit the Ollama desktop app**: Right-click the Ollama icon in your system tray (bottom right) and choose **Quit**
2. Open **PowerShell as Administrator**
3. Run:

```powershell
setx OLLAMA_HOST "0.0.0.0:11434"
```

4. **Restart Ollama**: Search for "Ollama" in the Start Menu and open it
5. The Ollama app will now accept connections from other devices on your network

### 7.3 — Allow Through Windows Firewall

The first time another device tries to connect, Windows may show a firewall popup asking if you want to allow the connection. Click **Allow**.

If no popup appears, you can manually allow Ollama:

1. Open **PowerShell as Administrator**
2. Run:

```powershell
netsh advfirewall firewall add rule name="Ollama" dir=in action=allow program="C:\Users\YourName\AppData\Local\Programs\Ollama\ollama.exe" enable=yes
```

(Adjust the path if you installed Ollama to a different location.)

### 7.4 — Connect from Your Phone

1. Make sure your phone is on the **same Wi-Fi network** as your computer
2. Open Chrome on your phone
3. Go to:

   ```
   http://192.168.1.42:8000
   ```

   (Replace `192.168.1.42` with the IP address you found in step 7.1. **Do not use `localhost`** — that would point to your phone, not your computer.)

4. The Nocta page will load
5. Click the **gear icon** in the sidebar to open Preferences
6. Change the **Server URL** to `http://192.168.1.42:11434` (use your computer's IP)
7. Click **Save**

You can now chat with your model from your phone, using your computer's GPU to run the AI.

---

## Common Problems and Solutions

| Problem | Solution |
|---|---|
| `python` is not recognized as a command | Reinstall Python from [python.org](https://www.python.org/downloads/windows/) and **make sure to tick "Add Python to PATH"** in the installer. Alternatively, use the `py` command instead of `python`. |
| PowerShell won't run `Activate.ps1` | Run `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned` in PowerShell as Administrator, then try again. |
| "Ollama server not detected" in Nocta | Make sure you opened Nocta from `http://localhost:8000` (the local HTTP server), not from `file://` and not from the GitHub Pages HTTPS URL. |
| "Couldn't reach the voice server" | Make sure `voice_server.py` is still running in its own PowerShell window. Test it by opening another PowerShell and running `curl http://localhost:5005/health`. |
| Port 8000 is already in use | Use a different port: `python -m http.server 8001`, then visit `http://localhost:8001/` in your browser. |
| Whisper download is taking forever | The first request downloads the model. After that it's cached. To use a smaller model, edit the `.env` file and set `WHISPER_MODEL=tiny` (about 75 MB instead of 150 MB). |
| Microphone permission denied | In your browser, click the lock icon or camera icon in the address bar, find the Microphone permission, set it to "Allow", then reload the page. |
| PWA install button is missing | You opened Nocta from `file://`. Close that browser tab, use Option B (local HTTP server) from Part 3 instead, and the install option will appear. |
| `winget` is not recognized | You're on an older Windows version. Install ffmpeg manually from [ffmpeg.org](https://ffmpeg.org/download.html) and add it to your system PATH. |
| Python dependency installation fails | Make sure you're running PowerShell as Administrator, and that your Python version is 3.9 or newer. Check with `python --version`. |

---

## Quick Reference: The Fastest Setup

If you just want to start chatting as quickly as possible, here's the absolute minimum:

1. **Install Python 3.9+** from python.org (**tick "Add Python to PATH"**)
2. **Install Ollama** from ollama.com, then open PowerShell and run `ollama pull llama3.2:3b`
3. **Download Nocta** as a ZIP from GitHub and extract it
4. **Open PowerShell** in the extracted folder and run: `python -m http.server 8000`
5. **Open your browser** to `http://localhost:8000/`
6. **Pick a model** in the sidebar and start typing

That's it. Voice and PWA installation are optional and can be added later.

---

## Getting Help

If you run into problems not covered here:

- **Check the [README.md](README.md)** for more detailed documentation
- **Search the [GitHub Issues](https://github.com/bikash-20/ollama-local-model-website/issues)** to see if someone has reported the same problem
- **Open a new issue** on GitHub with details about what you tried and what went wrong

---

**Enjoy chatting with your local AI!** 🚀
