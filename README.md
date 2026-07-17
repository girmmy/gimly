# Gimly

A personal desktop AI assistant — invisible overlay, screen + audio context, real-time answers.

## What it does

- Lives on your desktop as an always-on-top, invisible overlay (doesn't show up in screen recordings or screenshots)
- Sees your screen and hears system/mic audio for context
- Answers questions and summarizes meetings in real time
- Runs entirely on **your own API key** — no account, no sign-up, no hosted proxy

## Prerequisites

- [Node.js 20.x](https://nodejs.org/en/download) (use [nvm](https://github.com/nvm-sh/nvm) if you need to switch versions: `nvm install 20 && nvm use 20`)
- [Python](https://www.python.org/downloads/) (needed by some native module builds)
- **Windows only:** [Build Tools for Visual Studio](https://visualstudio.microsoft.com/downloads/)
- An API key from one of: [OpenAI](https://platform.openai.com/api-keys), [Google Gemini](https://aistudio.google.com/apikey), or [Anthropic](https://console.anthropic.com/settings/keys) — or run fully local with [Ollama](https://ollama.com) + Whisper

## Run it

```bash
npm run setup
```

This installs dependencies for both the Electron app and the local web UI, builds everything, and launches the app. On first launch, choose **"Use Personal API keys"** and paste in your key — there's no other login path.

For subsequent runs (after the first `npm run setup`):

```bash
npm start
```

### Building a standalone app

```bash
npm run build       # current platform
npm run build:win   # Windows
```

Output lands in `dist/`. Code signing is not configured — unsigned builds will trigger Gatekeeper/SmartScreen warnings on first run; right-click → Open (macOS) or "More info → Run anyway" (Windows) to bypass.

## Keyboard Shortcuts

- `Ctrl/Cmd + \` — show/hide the main window
- `Ctrl/Cmd + Enter` — ask the AI using everything seen/heard so far
- `Ctrl/Cmd + Arrows` — move the window

## Notes

- Personal-API-key-only: no hosted login, no auto-update, no external account.
- The Firebase-backed cloud sync/auth code paths are still present in the source (not ripped out) but are unused now that the hosted-login entry points are gone — everything runs locally against your own API key.

## License

GPL-3.0 — see [LICENSE](LICENSE).
