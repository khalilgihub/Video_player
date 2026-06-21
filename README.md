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

### Screenshots
- Capture video frames as **JPG** with an instant in-player preview
- Screenshots are written to the app's user-data screenshot folder
- Open the screenshot folder from the player controls
- Clip export uses packaged **ffmpeg** resources for installed builds

### Power User
- **Customizable keyboard shortcuts** (40+ actions)
- **Mouse gestures**: scroll wheel volume, double-tap seek
- **Playback stats overlay** (resolution, dropped frames, FPS, buffer)
- **Playback history** with recently played on welcome screen
- **Recursive folder scanning** for video and audio files with bounded depth/file limits

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
│   │   ├── main.js              # Electron main process
│   │   ├── ipc-handlers.js      # IPC handler registration
│   │   ├── mpv-process.js       # mpv child-process manager
│   │   ├── mpv-ipc-bridge.js    # mpv IPC allowlisted bridge
│   │   └── binary-resolver.js   # bundled binary resolution
│   ├── preload/
│   │   └── preload.js           # Secure context bridge
│   ├── renderer/
│   │   ├── index.html           # Main window
│   │   ├── app.js               # App bootstrap / orchestrator
│   │   └── modules/
│   │       ├── player.js        # Core video player engine
│   │       ├── controls.js      # UI controls & progress bar
│   │       ├── playlist.js      # Playlist management
│   │       ├── subtitles.js     # Subtitle parsing & rendering
│   │       ├── equalizer.js     # 10-band audio equalizer
│   │       ├── settings.js      # Settings panel logic
│   │       ├── shortcuts.js     # Keyboard shortcuts
│   │       ├── thumbnails.js    # Thumbnail previews & bg blur
│   │       └── gestures.js      # Mouse/trackpad gestures
│   ├── styles/
│   │   ├── themes.css           # Theme engine (Dark/OLED/Light)
│   │   ├── main.css             # Core layout & components
│   │   ├── controls.css         # Control bar styles
│   │   ├── playlist.css         # Playlist sidebar styles
│   │   ├── settings.css         # Settings & equalizer styles
│   │   └── animations.css       # Keyframe animations & toasts
│   └── components/
│       └── toast.js             # Toast notification system
├── assets/
│   ├── icons/
│   └── fonts/
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
npm test
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

### Release Verification

```bash
npm run verify:release
```

This runs static checks, tests, audit, a Windows build, and a packaged-app smoke test. To smoke-test a specific executable, set `HYBRID_PACKAGED_APP` to the packaged app path before running `npm run test:release`.

### Native Binaries

- `mpv/` is packaged as an external app resource.
- `ffmpeg-static` is installed as a production dependency and copied to `resources/ffmpeg/` during packaging.
- Development builds resolve `ffmpeg-static` directly from `node_modules` before falling back to `PATH`.

### Windows Signing

Windows signing is enabled in `electron-builder.json`. Production release builds still need a valid Windows code-signing certificate configured through electron-builder-supported environment variables or certificate settings.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` / `K` | Play / Pause |
| `F` | Toggle Fullscreen |
| `M` | Toggle Mute |
| `←` / `→` | Seek ±5 seconds |
| `J` / `L` | Seek ±10 seconds |
| `↑` / `↓` | Volume Up / Down |
| `[` / `]` | Speed Down / Up |
| `.` / `,` | Frame Forward / Backward |
| `0-9` | Seek to 0%-90% |
| `C` | Subtitle panel |
| `E` | Equalizer |
| `I` | Stats overlay |
| `N` | Next track |
| `P` | Previous track |
| `S` | Screenshot |
| `Ctrl+S` | Start / stop clip recording |
| `U` | Unlock controls |
| `Ctrl+O` | Open file |
| `Ctrl+Shift+O` | Open multiple files |
| `Ctrl+F` | Open folder |
| `Ctrl+N` | Open network stream |
| `Ctrl+L` | Toggle playlist |
| `Ctrl+,` | Settings |
| `Ctrl+Q` | Quit player |
| `Esc` | Exit fullscreen / Close modal |

---

## Performance Optimization Tips

1. **GPU acceleration** is enabled by default via Chromium flags
2. **Background blur** renders at 64×36 resolution and updates every 500ms
3. **Resume autosave** triggers every 5 seconds (not on every frame)
4. **Stats overlay** only computes when visible
5. Memory: old-space limit set to 512MB to prevent runaway usage
6. **Single instance lock** prevents duplicate processes
7. Database writes use atomic JSON-file replacement
8. Corrupt preference databases are backed up and replaced with defaults

## Security Best Practices

- `contextIsolation: true` — renderer cannot access Node.js
- `sandbox: true` — renderer runs in Electron's sandbox
- `nodeIntegration: false` — no require() in renderer
- `webSecurity: true` — enforces same-origin policy
- IPC data requests use `invoke/handle`
- mpv commands and writable properties are allowlisted in the main process
- File, playlist, history, and preference writes go through validated IPC handlers
- Content Security Policy limits scripts to local files plus the checked import map
- No `allowRunningInsecureContent`

---

## Future Enhancements

- [x] FFmpeg integration for clip export
- [ ] ffprobe integration for extended codec info
- [ ] AI-powered subtitle sync detection
- [ ] OpenSubtitles API integration for auto-download
- [ ] Chromecast / DLNA streaming
- [ ] Discord Rich Presence
- [ ] Plugin system for third-party extensions
- [ ] Cloud sync for preferences
- [ ] Auto-update system (electron-updater)
- [ ] Crash reporting
- [ ] Media server mode

---

## License

MIT © Hybrid Player Team
