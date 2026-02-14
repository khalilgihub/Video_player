# Hybrid Player

A next-generation desktop video player built with Electron, designed to rival VLC with a modern, premium UI and power-user features.

![Hybrid Player](https://img.shields.io/badge/Electron-33-blue?logo=electron) ![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### Core
- **Hardware-accelerated** video playback (GPU decoding)
- **Multiple format support**: MP4, MKV, AVI, MOV, WebM, FLV, M4V, WMV, TS
- **Network streaming**: HTTP, HLS (.m3u8) URL playback
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
- **Volume boost** up to 300% (via Web Audio API gain node)
- **10-band audio equalizer** with 9 presets (Bass Boost, Rock, Jazz, etc.)
- **Frame stepping** (forward/backward with `,` and `.` keys)
- **A-B loop** for section repeat
- **Playback speed** control (0.1x to 4x) with per-file speed memory
- **Smart resume** — remembers where you stopped for every file
- **Sleep timer** — auto-pause after set duration

### Subtitles
- **SRT, VTT, ASS/SSA** parsing and rendering
- **Sync adjustment** (+/- milliseconds, saved per file)
- **Font size, color, background** customization
- External subtitle file loading

### Screenshots
- Capture video frames as **PNG or JPG**
- Save dialog with auto-generated filename

### Power User
- **Customizable keyboard shortcuts** (40+ actions)
- **Mouse gestures**: scroll wheel volume, double-tap seek
- **Playback stats overlay** (resolution, dropped frames, FPS, buffer)
- **Playback history** with recently played on welcome screen
- **Folder scanning** for media files

### Settings
- Tabbed settings panel (General, Playback, Subtitles, Audio, Advanced)
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
│   │   └── menu.js              # Application menu
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
│   ├── components/
│   │   ├── toast.js             # Toast notification system
│   │   └── modal.js             # Modal management
│   └── services/
│       ├── database.js          # Database abstraction
│       └── preferences.js       # Preferences service
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
| `Ctrl+O` | Open file |
| `Ctrl+Shift+O` | Open folder |
| `Ctrl+L` | Toggle playlist |
| `Ctrl+,` | Settings |
| `Esc` | Exit fullscreen / Close modal |

---

## Performance Optimization Tips

1. **GPU acceleration** is enabled by default via Chromium flags
2. **Background blur** renders at 64×36 resolution and updates every 500ms
3. **Resume autosave** triggers every 5 seconds (not on every frame)
4. **Stats overlay** only computes when visible
5. Memory: old-space limit set to 512MB to prevent runaway usage
6. **Single instance lock** prevents duplicate processes
7. Database writes are batched through a simple JSON store

## Security Best Practices

- `contextIsolation: true` — renderer cannot access Node.js
- `nodeIntegration: false` — no require() in renderer
- `webSecurity: true` — enforces same-origin policy
- All IPC uses `invoke/handle` pattern (no `send/on` for data requests)
- File access goes through validated IPC handlers
- Content Security Policy set in HTML `<meta>` tag
- No `allowRunningInsecureContent`

---

## Future Enhancements

- [ ] FFmpeg/ffprobe integration for extended codec info & transcoding
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
