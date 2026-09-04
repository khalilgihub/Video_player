# Hybrid Player

A next-generation desktop video player built with Electron, designed to rival VLC with a modern, premium UI and power-user features.

![Hybrid Player](https://img.shields.io/badge/Electron-40-blue?logo=electron) ![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### Core
- **mpv-backed, hardware-accelerated** video playback (GPU decoding)
- **Multiple format support**: MP4, MKV, AVI, MOV, WebM, FLV, M4V, WMV, TS
- **Network streaming**: HTTP(S), HLS/DASH, RTSP, RTMP, and SRT URL playback
- **Secure architecture**: contextIsolation, sandboxed IPC, no nodeIntegration
- **JSON-based database** for preferences, history, resume positions, playlists

### UI / UX
- **YouTube-inspired** premium control bar with smooth animations
- **Glassmorphism** effects with backdrop blur
- **Three themes**: Dark, OLED Black, Light + custom accent color
- **Auto-hiding controls** when idle
- **Collapsible sidebar playlist** with search
- **Drag & drop** file support
- **Custom frameless window** with native-feel title bar

### Playback
- **mpv volume control** with keyboard and mouse-wheel support
- **10-band audio equalizer** with 9 presets (Bass Boost, Rock, Jazz, etc.)
- **Frame stepping** (forward/backward with `,` and `.` keys)
- **A-B loop** for section repeat
- **Playback speed** control (0.1x to 4x) with per-file speed memory
- **Smart resume** — remembers where you stopped for every file
- **Sleep timer** — auto-pause after set duration

### Subtitles
- **SRT, VTT, ASS/SSA** loading and native mpv rendering
- **Sync adjustment** (+/- milliseconds, saved per file)
- **Font size, color, background** customization
- External subtitle file loading

### Screenshots & Frame Capture
- **Single Tap & Hold-to-Burst**:
  - Tap `S` to capture an instant screenshot.
  - Hold `S` to trigger a continuous high-speed frame burst capture.
- **Quick Delete & Undo (`D` / `Z`)**:
  - Tap `D` to delete the latest screenshot immediately with an in-card red badge animation.
  - Tap `Z` to immediately restore the most recently deleted screenshot with an in-card green glow pop animation.
- **Delete Carousel (`Ctrl + D`)**:
  - Compact, semi-transparent glassmorphic preview card showing session screenshots.
  - Navigate with `←` / `→` or `<` / `>` buttons; counter displays current index (e.g. `2 / 5`).
  - Press `Enter` or `D` to delete the selected screenshot and dismiss immediately with animation.
- **Restore Carousel (`Ctrl + Z`)**:
  - Visual selector to browse all deleted screenshots in the current session's trash.
  - Press `Enter` or `Z` to restore the selected screenshot with the signature green restoration pop animation.
- **Fullscreen-Safe `Escape`**: Pressing `Esc` dismisses active carousels or modals cleanly without un-fullscreening the video player.

### Power User
- **Customizable keyboard shortcuts** (50+ actions)
- **Mouse gestures**: scroll wheel volume, double-tap seek, interactive carousel navigation
- **Playback stats overlay** (resolution, dropped frames, FPS, buffer)
- **Playback history** with recently played on welcome screen
- **Recursive folder scanning** for video and audio files with bounded depth/file limits
- **Native Windows DWM Integration**:
  - Custom border suppression, snap layouts, titlebar synchronization, and persistent paused-frame composition with crisp subtitle overlay.

### Settings
- Settings panel for appearance, behavior, background effects, and player actions
- Theme & accent color picker
- All preferences persist across sessions

---

## Project Structure

```
hybrid-player/
├── src/
│   ├── main/
│   │   ├── main.js                     # Electron main process & window lifecycle
│   │   ├── ipc-handlers.js             # IPC handler registration & window state
│   │   ├── mpv-process.js              # mpv child-process manager & IPC sockets
│   │   ├── mpv-ipc-bridge.js           # mpv IPC allowlisted bridge & screenshot engine
│   │   ├── native-dwm.js               # Windows DWM helper & border controller
│   │   ├── media-folder-resolver.js    # Folder recursion & media resolution
│   │   └── windows-shell-integration.js# Windows AppID & taskbar pin integration
│   ├── preload/
│   │   └── preload.js                  # Secure context bridge
│   ├── renderer/
│   │   ├── index.html                  # Main window UI
│   │   ├── app.js                      # App bootstrap & playback orchestrator
│   │   ├── modules/
│   │   │   ├── player.js               # Video player, screenshot & carousel engine
│   │   │   ├── controls.js             # UI controls & progress bar
│   │   │   ├── playlist.js             # Playlist management
│   │   │   ├── subtitles.js            # Subtitle tracks, styling & sync controls
│   │   │   ├── audio.js                # Audio track management & presets
│   │   │   ├── equalizer.js            # 10-band audio equalizer
│   │   │   ├── settings.js             # Settings panel & visual effects
│   │   │   ├── shortcuts.js            # Keyboard shortcuts orchestrator
│   │   │   ├── thumbnails.js           # Thumbnail previews & canvas blur
│   │   │   └── gestures.js             # Mouse/trackpad gestures
│   │   └── styles/
│   │       ├── themes.css              # Theme engine (Dark / OLED / Light)
│   │       ├── main.css                # Core layout, carousel cards & badges
│   │       ├── controls.css            # YouTube-inspired control bar
│   │       ├── playlist.css            # Playlist sidebar styles
│   │       ├── settings.css            # Settings & equalizer styles
│   │       └── animations.css          # Keyframe animations & toasts
├── assets/
│   ├── icons/                          # Multi-resolution icons & Windows assets
│   └── fonts/
├── tests/
│   ├── restore-carousel.spec.js        # 10-scenario restore carousel test suite
│   ├── screenshot-carousel.spec.js     # 9-scenario delete carousel test suite
│   ├── screenshot-deletion.spec.js     # LIFO delete/restore lifecycle suite
│   ├── subtitle-sync.spec.js           # Subtitle delay & synchronization tests
│   └── full-feature-smoke.spec.js      # Complete feature integration smoke tests
├── package.json
├── electron-builder.json
└── README.md
```

---

## Getting Started

### Prerequisites
- **Node.js** 18+ ([nodejs.org](https://nodejs.org))
- **npm** or **yarn**

### Install

```bash
cd hybrid-player
npm install
```

### Run (Development)

```bash
npm start
```

Or with logging:
```bash
npm run dev
```

### Test and Audit

```bash
npm run verify
```

For individual checks:

```bash
npm run check:static
npx playwright test
npm audit
```

### Build for Production

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

Built packages will be in the `dist/` folder.

---

## Keyboard Shortcuts

| Shortcut | Action | Description |
|---|---|---|
| **`Space`** / **`K`** | Play / Pause | Toggle playback |
| **`F`** | Toggle Fullscreen | Enter or exit fullscreen |
| **`Esc`** | Smart Dismiss | Closes carousels/modals first; exits fullscreen if clean |
| **`M`** | Toggle Mute | Mute or unmute audio |
| **`↑`** / **`↓`** | Volume Up / Down | Adjust volume (±5%) |
| **`←`** / **`→`** | Seek Backward / Forward | Jump ±5 seconds |
| **`J`** / **`L`** | Seek Backward / Forward | Jump ±10 seconds |
| **`0` – `9`** | Seek to Percentage | Jump to 0% – 90% of duration |
| **`[`** / **`]`** | Speed Down / Up | Decrease / increase playback speed |
| **`.`** / **`,`** | Frame Step | Step one video frame forward / backward |
| **`A`** | Audio Track | Cycle audio tracks / toggle anime Subs & Dubs mode |
| **`C`** | Subtitles Panel | Open subtitle track selector & sync slider |
| **`Z`** / **`X`** | Subtitle Delay | Adjust subtitle delay (-0.1s / +0.1s) |
| **`E`** | Equalizer | Toggle 10-band audio equalizer |
| **`I`** | Stats Overlay | Toggle playback technical statistics overlay |
| **`R`** | Repeat Mode | Cycle Repeat Off / Repeat One / Repeat All / A-B Loop |
| **`T`** | Time Format | Toggle elapsed time vs. remaining time display |
| **`N`** | Next Track | Play next item in playlist |
| **`P`** | Previous Track | Play previous item in playlist |
| **`S`** *(Tap)* | Screenshot | Capture single video frame |
| **`S`** *(Hold)* | Burst Capture | Stream high-speed frame burst until released |
| **`D`** | Delete Screenshot | Delete the latest screenshot with in-card animation |
| **`Z`** | Restore Screenshot | Quick undo restore latest deleted screenshot |
| **`Ctrl + D`** | Delete Carousel | Open visual carousel to select which screenshot to delete |
| **`Ctrl + Z`** | Restore Carousel | Open visual carousel to select which deleted screenshot to restore |
| **`Enter`** / **`D`** *(in Delete Carousel)* | Confirm Delete | Delete selected screenshot and immediately close |
| **`Enter`** / **`Z`** *(in Restore Carousel)* | Confirm Restore | Restore selected screenshot and immediately close |
| **`←`** / **`→`** *(in Carousel)* | Carousel Navigate | Cycle between screenshot items |
| **`Ctrl + S`** | Record Clip | Start / stop video clip recording |
| **`Ctrl + O`** | Open File | Open single video file |
| **`Ctrl + Shift + O`** | Open Multiple Files | Select and open multiple files |
| **`Ctrl + F`** | Open Folder | Recursively scan and queue media files in a directory |
| **`Ctrl + N`** | Network Stream | Open network stream URL modal |
| **`Ctrl + L`** | Playlist | Toggle sidebar playlist |
| **`Ctrl + ,`** | Settings | Open settings and customization panel |
| **`Ctrl + Q`** | Quit | Exit player |

---

## Performance & Architecture Highlights

1. **Hardware GPU Acceleration**: Direct mpv video output surface (`--vo=gpu`, `--hwdec=auto-safe`) embedded via native child HWND.
2. **Persistent Paused Subtitles**: Zero subtitle loss on pause via smart subtitle-mode frame compositing.
3. **Atomic File Safety**: Deletion uses safe temp staging with instantaneous LIFO undo and recovery.
4. **Fullscreen-Safe Escape**: Multi-layered event handling ensures modal and carousel dismissal never drops window fullscreen status unexpectedly.
5. **Single Instance Lock**: Ensures media files opened from Windows Explorer open in the existing player window.

---

## License

MIT © Hybrid Player Team
