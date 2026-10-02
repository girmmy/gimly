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

Output lands in `dist/`. Unsigned builds trigger Gatekeeper/SmartScreen on first run; right-click
→ Open (macOS) or "More info → Run anyway" (Windows) to bypass.

**macOS, and why permissions may be asked for repeatedly:** macOS ties Screen Recording and
Microphone grants to an app's code signature. `npm run package` (and any build made with no
signing identity in the keychain) produces an ad-hoc signature, which macOS cannot pin — so the
grant does not stick and the permission screen returns on every launch. Check with:

```bash
codesign -dv --verbose=2 /Applications/Gimly.app
```

`Signature=adhoc` or `Identifier=Electron` means grants will not persist. Install an Apple
Development certificate (Xcode → Settings → Accounts → Manage Certificates → + → Apple
Development, free with any Apple ID), confirm it with `security find-identity -v -p codesigning`,
then `npm run build`. Keep exactly one Gimly bundle installed: two bundles sharing the
`com.gimmy.gimly` id fight over the same permission record.

## Solving what's on screen

`Ctrl/Cmd + Shift + Enter`, or the **Solve** button in the header, captures the screen and
answers whatever problem is on it without you typing anything. It works from any state,
including with every window hidden, so a single press goes from nothing visible to an answer.

Use it on a coding problem, an error or stack trace, a form, a written question, a diagram.
With nothing solvable on screen it says what it sees in one line rather than inventing a
problem to solve. The answer style follows the **Answer style** setting below, so an algorithm
problem picked up in *Interview prep* comes back with the full solution, complexity and edge
cases.

This is distinct from `Ctrl/Cmd + Enter`, which opens the Ask window so you can type, and
sends the screen along with whatever you ask.

## Interview prep / answer style

Settings has an **Answer style** switch:

- **Live meeting** — terse, glanceable answers for a call in progress.
- **Interview prep** — full behavioral answers (situation → action → result), complete coded
  solutions with complexity and edge cases, and the follow-up an interviewer asks next.

### Telling Gimly about yourself

Gimly will not invent your history, so behavioral answers need your background. It reads
`~/.gimly/context.md` — outside the repo, `chmod 700`, your account only. Settings → **Set up my
context** creates it and opens it; `~/.gimly/README.md` explains the format. A folder of files
(`~/.gimly/context/resume.md`, `projects.md`, …) works too, and `GIMLY_CONTEXT_FILE` overrides
the location. Edits apply to the next question, no restart.

## Keyboard Shortcuts

- `Ctrl/Cmd + \` — show/hide the main window
- `Ctrl/Cmd + Enter` — ask the AI using everything seen/heard so far
- `Ctrl/Cmd + Shift + Enter` — solve whatever is on screen, without typing (see below)
- `Ctrl/Cmd + Arrows` — move the window

All of these are rebindable in Settings → Shortcuts.

## Tests

```bash
npm test
```

Node's built-in runner (`node --test`), no test framework dependency. The main-process modules
pull in electron, sqlite and network clients at require time, so `test/helpers/loadWithStubs.js`
seeds `require.cache` with stubs before loading the module under test. `npm run test:watch`
reruns on change.

## Notes

- Personal-API-key-only: no hosted login, no auto-update, no external account.
- macOS liquid-glass window material is off by default because it strips every window background
  and depends on private APIs that change between macOS releases (transparent windows with
  unreadable text). Opt in with `GIMLY_LIQUID_GLASS=1 npm start`.
- The Firebase-backed cloud sync/auth code paths are still present in the source (not ripped out) but are unused now that the hosted-login entry points are gone — everything runs locally against your own API key.

## License

GPL-3.0 — see [LICENSE](LICENSE).
