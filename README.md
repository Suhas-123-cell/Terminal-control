# Remote Terminal

A native mobile app that turns your phone into a full, unrestricted remote
terminal **and** remote screen for your laptop. Type any command, run
interactive programs, send Ctrl+C to kill a running task, keep multiple
independent terminals open at once, and — when you need it — switch to a
live view of your actual desktop and control the mouse and keyboard
directly. All from a standalone Android/iOS app talking to a small server
that runs on your laptop.

- `server/` — WebSocket + PTY server that runs on your laptop (Node.js,
  `node-pty`, `ws`). Manages one or more real shells, each backed by a
  pseudo-terminal, plus (on macOS) screen capture and mouse/keyboard
  injection via `screencapture` and `cliclick`.
- `app/` — React Native (Expo) app. Renders each terminal with xterm.js
  inside a WebView, with a tab bar for multiple terminals and a special-keys
  toolbar (Ctrl+C, Ctrl+D, Ctrl+Z, Esc, Tab, arrows, sticky Ctrl) pinned
  above the keyboard. A toggle button (🖥️/⌨️) in the header switches to a
  live screen view where taps/drags become real mouse clicks/drags.

This is a full passthrough terminal, not a command menu: every keystroke is
sent to the laptop as-is. There is no allow-list and no restriction on what
you can run.

## 1. Run the server on your laptop

```bash
cd server
npm install
cp .env.example .env
# edit .env: set TERM_TOKEN to a long random string
#   openssl rand -hex 24
npm start
```

The server listens on `PORT` (default `3000`) and only accepts WebSocket
connections that include the matching `?token=` query parameter.

### Screen control (macOS only, optional)

The 🖥️ toggle in the app streams your desktop and lets you click/type on it
remotely. This needs two things on your laptop:

1. **`cliclick`** (mouse/keyboard injection): `brew install cliclick`
2. **Permissions** for whichever app you run `npm start` in (e.g. Terminal,
   iTerm) — go to **System Settings → Privacy & Security** and enable both:
   - **Screen Recording**
   - **Accessibility**

   macOS only applies these grants to a process the *next* time it starts,
   so **fully quit and reopen** your terminal app after granting them, then
   run `npm start` again.

Without these, the terminal features still work fine — you'll just see
"Waiting for screen…" in the 🖥️ view instead of a live picture.

## 2. Point the app at the server

In the app's Connection screen, enter:

| Field | Value |
|---|---|
| Host | see below |
| Port | `3000` (or whatever you set) |
| Token | the `TERM_TOKEN` from your `.env` |

**Host, depending on where the app is running:**

- **Android emulator** → `10.0.2.2` (the emulator's alias for the host
  machine's `localhost`)
- **iOS Simulator** → `localhost`
- **A real phone** → your laptop's **Tailscale IP** (e.g. `100.x.y.z`).
  Install [Tailscale](https://tailscale.com) on both your laptop and your
  phone, join the same tailnet, and use the laptop's Tailscale IP as the
  host. **Do not** port-forward the server to the public internet — it is
  meant to be reachable only over your private Tailscale network, gated
  further by the `TERM_TOKEN`.

## 3. Build and install the app

The app is a real React Native project with a generated native `android/`
project (an `ios/` project can be generated the same way once Xcode is
available). It is **not** run inside Expo Go — you build and install an
actual binary.

### Android

```bash
cd app
npm install
npx expo prebuild -p android --no-install   # generates android/ from app.json
cd android
./gradlew assembleRelease                   # bundles the JS in; no Metro needed at runtime
adb install -r app/build/outputs/apk/release/app-release.apk
```

(`assembleDebug` also works, but a debug APK expects a Metro dev server —
use `assembleRelease` for a standalone build that runs on its own.)

### iOS

Requires full Xcode (not just Command Line Tools) and an iOS Simulator or
device.

```bash
cd app
npx expo prebuild -p ios --no-install
cd ios
xcodebuild -workspace app.xcworkspace -scheme app -configuration Release \
  -sdk iphonesimulator -derivedDataPath build
xcrun simctl install booted build/Build/Products/Release-iphonesimulator/app.app
```

## How it works

- The server keeps a registry of sessions (`sessionId → PTY`), each with a
  rolling scrollback buffer. A **single WebSocket connection is multiplexed**
  across every open terminal tab using a `sessionId` field on every message
  (`create`, `list`, `attach`, `input`, `resize`, `close`, and the server's
  `output`/`exit`/`created`/`sessions` replies).
- **Sessions are not killed when the WebSocket disconnects.** A shell only
  goes away when you explicitly close its tab or the shell process exits on
  its own. That's what lets a long-running task keep going while you switch
  tabs, background the app, or lose connection — reattach later and it's
  still there, with scrollback replayed.
- Each terminal tab is a `react-native-webview` running xterm.js, kept
  mounted (just hidden) when its tab isn't active so its content and
  scrollback survive tab switches without needing a fresh reattach.
- The special-keys toolbar sends raw control bytes into the active
  terminal (`Ctrl+C` → `\x03`, `Ctrl+D` → `\x04`, `Ctrl+Z` → `\x1a`, arrows →
  `\x1b[A/B/C/D`, etc.), plus a sticky Ctrl modifier that turns the next
  typed letter into its control code.
- Screen control reuses the same WebSocket connection: `screen-start`/
  `screen-stop` turn a `screencapture` polling loop on/off (~2.5 fps JPEG
  frames sent as `screen-frame` messages), and `screen-input` messages
  (`move`/`click`/`rightclick`/`doubleclick`/`drag`/`type`/`key`) are
  translated into `cliclick` invocations. The app maps a tap's position on
  the displayed frame to the real screen's pixel coordinates using the
  frame's reported width/height, so it's always a 1:1 "tap where you want
  to click" mapping regardless of phone screen size.

## Security notes

- Keep the server on your private network / Tailscale tailnet only. Never
  expose it to the public internet.
- `TERM_TOKEN` is the only auth gate — treat it like a password. It's
  checked during the WebSocket handshake itself (bad tokens never get a
  connection accepted).
- The server runs your real login shell with your real environment and
  permissions — anyone with the token has full access to your laptop. With
  screen control enabled, that also means full mouse/keyboard control of
  your desktop, not just the shell.
