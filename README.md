# Hybrid Player

A next-generation desktop video player built with Electron and mpv, engineered for peak performance, frame-accurate precision, and a luxury glassmorphism UI.

![Hybrid Player](https://img.shields.io/badge/Electron-40-blue?logo=electron) ![mpv](https://img.shields.io/badge/mpv-IPC-red) ![License](https://img.shields.io/badge/License-MIT-green)

---

## Highlights

- **Hardware-Accelerated Playback**: Direct mpv video output surface (`--vo=gpu`, `--hwdec=auto-safe`) with native GPU decoding.
- **Frame-Accurate Exact Seeking**: High-precision seek engine (`--hr-seek=yes`, `--hr-seek-framedrop=no`, `seek relative+exact`) with configurable 1s, 5s, or 10s steps.
- **Luxury Obsidian Glass UI**: YouTube-inspired floating control bar, responsive breakpoints (1000px, 950px, 860px), and seamless backdrop blur.
- **Dynamic OSD Feedback**: Luxury center Play/Pause badge, top-right Volume pill OSD, and directional skip indicators.
- **Interactive Screenshot Engine**: Single tap capture (`S`), continuous hold burst capture, instant LIFO delete/restore (`D`/`Z`), and visual glassmorphic carousels (`Ctrl+D`/`Ctrl+Z`).
- **Welcome Screen Visual Shaders**: Dynamic procedural backgrounds including Dither Waves, Particles, Faulty Terminal CRT glitch, and Grid Motion with an interactive Accordion Gallery picker.
- **Pro Audio & Subtitle Controls**: 10-band equalizer with 9 presets, multi-stream voice switching, external subtitle loader, custom typography styling, and live millisecond delay sync.
- **Local Persistence & Privacy**: Fully offline, zero telemetries, JSON-based persistent database for resume points, playback history, and preferences.

---

## Features

### Core Playback & Media Engine
- **Vast Format Compatibility**: Seamlessly plays MP4, MKV, AVI, MOV, WebM, FLV, M4V, WMV, TS, and more.
- **Network Streaming**: Supports HTTP(S), HLS, DASH, RTSP, RTMP, and SRT URL playback.
- **Configurable Seeking**: Customize arrow-key seek intervals to 1s, 5s, or 10s directly from settings.
- **Single-Click vs. Double-Click Fullscreen**: Toggle double-click to fullscreen; when disabled, single-click canvas toggles playback instantly with zero debounce delay.
- **Smart Resume**: Automatically remembers last playback position per file.
- **Frame Stepping**: Precision single-frame advance and rewind (`.` and `,`).
- **A-B Repeat Loop**: Loop specific video intervals seamlessly for detailed study or practice.
- **Single Instance Lock**: Media files opened from Windows Explorer automatically forward to the existing player window.

### User Interface & Experience
- **Adaptive Control Bar**: Automatically optimizes layout on narrower viewports to prevent button collisions when the playlist sidebar is open.
- **Three Core Themes**: Obsidian Dark, OLED Black, and High-Contrast Light with customizable accent highlights.
- **Titlebar Polish**: Custom frameless titlebar with native Windows snap layouts, window controls, and contrast-safe styling across all themes.
- **Motion Profiles**: Choose between Balanced, Showcase, and Reduced Motion for smooth transitions tailored to your system.
- **Brand Typography Option**: Toggle stylized brand typography or fallback system fonts at will.
- **Collapsible Sidebar Playlist**: Drag-and-drop files, instant playlist search filter, and auto-queue next media.

### Visual Welcome Backdrops & Accordion Gallery
When no media is playing, Hybrid Player transforms into an artistic canvas with selectable WebGL/Canvas shaders:
- **Dither Waves**: Retro animated Bayer matrix dither wave field with WebGL context recycling.
- **Particles**: Ambient drifting particle network with subtle mouse responsiveness.
- **Faulty Terminal**: CRT glitch, scanline flicker, and retro terminal screen simulation.
- **Grid Motion**: Interactive gliding matrix lattice with custom image uploads.
- **Minimalist OLED**: Pure pitch-black OLED background.
- **Accordion Gallery Picker**: Interactive accordion popover previewing shaders before applying.

### Screenshot Suite & Image Management
- **Instant Capture**: Tap `S` to snapshot the current frame at native resolution.
- **Continuous Burst Mode**: Hold `S` to stream high-speed frame burst captures until released.
- **Quick Undo / Redo (`D` / `Z`)**:
  - Tap `D` to delete the latest capture with an in-card red badge animation.
  - Tap `Z` to restore the last deleted capture from the session trash with a signature green glow.
- **Delete Specific Image (`Ctrl + D`)**:
  - Visual selector modal displaying session screenshots in compact glassmorphic cards.
  - Navigate with `←` / `→` arrow keys; press `Enter` or `D` to delete the chosen image.
- **Restore Specific Deleted Image (`Ctrl + Z`)**:
  - Visual selector to browse all deleted captures in the session's trash.
  - Press `Enter` or `Z` to recover the chosen deleted image back to disk.
- **Fullscreen-Safe Escape**: Pressing `Esc` dismisses active selectors or modals cleanly without un-fullscreening the video player.

### Audio & Subtitles
- **10-Band Graphic Equalizer**: Fine-tune 31 Hz to 16 kHz with preamp control and presets (Flat, Bass Boost, Vocal, Rock, Jazz, Classical, Acoustic, Electronic, Pop).
- **Multi-Track Voice & Audio Switcher**: Cycle audio tracks or toggle between native dubs and original subs.
- **Subtitle Sync Adjustment**: Fine-tune subtitle delay on-the-fly (`G` to retard -100ms, `H` to advance +100ms) with instant toast feedback.
- **Subtitle Styling**: Configure font size, text color, and background opacity in real-time.

---

## Keyboard Shortcuts

| Shortcut | Action | Description |
|---|---|---|
| **`Space`** / **`K`** | Play / Pause | Toggle video playback |
| **`F`** | Fullscreen | Toggle fullscreen mode |
| **`Esc`** | Smart Dismiss | Dismisses active modal or selector first; exits fullscreen if clean |
| **`M`** | Mute | Toggle audio mute |
| **`↑`** / **`↓`** | Volume Up / Down | Adjust volume (±5%) with top-right OSD pill |
| **`←`** / **`→`** | Seek Backward / Forward | Jump configured step (1s, 5s, or 10s) with directional OSD |
| **`0` – `9`** | Seek to Percentage | Jump directly to 0% – 90% of duration |
| **`[`** / **`]`** | Speed Down / Up | Adjust playback speed (0.25x – 3.0x) |
| **`.`** / **`,`** | Frame Step | Step one video frame forward / backward |
| **`A`** | Audio Track | Cycle available audio and voice streams |
| **`C`** | Subtitles Panel | Open subtitle configuration & sync modal |
| **`G`** / **`H`** | Subtitle Delay | Adjust subtitle delay (-0.1s / +0.1s) with toast notification |
| **`E`** | Equalizer | Toggle 10-band audio equalizer modal |
| **`I`** | Stats Overlay | Toggle detailed video & stream playback statistics |
| **`L`** | Repeat Mode | Cycle Repeat Off / Repeat One / Repeat All / A-B Loop |
| **`T`** | Time Format | Toggle elapsed time vs. remaining time display |
| **`N`** | Next Track | Play next item in playlist |
| **`P`** | Previous Track | Play previous item in playlist |
| **`S`** *(Tap)* | Screenshot | Capture single video frame |
| **`S`** *(Hold)* | Burst Capture | High-speed continuous frame burst capture |
| **`D`** | Quick Delete | Delete latest screenshot with in-card animation |
| **`Z`** | Quick Restore | Undo latest screenshot deletion |
| **`Ctrl + D`** | Delete Specific Image | Open visual selector to choose and delete a specific screenshot |
| **`Ctrl + Z`** | Restore Specific Deleted Image | Open visual selector to choose and restore a specific deleted screenshot from trash |
| **`Enter`** *(in Selector)* | Confirm Selection | Delete or restore selected screenshot and close selector |
| **`←`** / **`→`** *(in Selector)* | Navigate Images | Cycle between screenshot items |
| **`Ctrl + S`** | Record Clip | Start / stop video clip recording |
| **`Ctrl + O`** | Open File | Open video file dialog |
| **`Ctrl + Shift + O`** | Open Multiple Files | Select and open multiple files |
| **`Ctrl + F`** | Open Folder | Scan and queue media files in directory |
| **`Ctrl + N`** | Network Stream | Open network stream URL dialog |
| **`Ctrl + L`** | Playlist | Toggle sidebar playlist |
| **`Ctrl + ,`** | Settings | Open settings and customization panel |
| **`Ctrl + Q`** | Quit | Exit player |

---

## Project Structure

```
hybrid-player/
├── src/
│   ├── main/
│   │   ├── main.js                      # Electron main process & window lifecycle
│   │   ├── ipc-handlers.js              # IPC handlers & window state persistence
│   │   ├── mpv-process.js               # mpv process management & exact seek flags
│   │   ├── mpv-ipc-bridge.js            # mpv IPC bridge & screenshot filesystem engine
│   │   ├── native-dwm.js                # Windows DWM helper & border controller
│   │   ├── media-folder-resolver.js     # Recursive directory scanner
│   │   └── windows-shell-integration.js # Windows AppID & taskbar integration
│   ├── preload/
│   │   └── preload.js                   # Secure contextIsolation bridge
│   └── renderer/
│       ├── index.html                   # Main interface, modals & titlebar
│       ├── app.js                       # Bootstrap & application orchestration
│       ├── modules/
│       │   ├── player.js                # Video player & screenshot carousel logic
│       │   ├── controls.js              # YouTube-inspired controls & OSD indicators
│       │   ├── playlist.js              # Playlist queue & drag-and-drop
│       │   ├── subtitles.js             # Subtitle rendering, fonts & sync offset
│       │   ├── audio.js                 # Multi-track audio & voice cycling
│       │   ├── equalizer.js             # 10-band audio equalizer & presets
│       │   ├── settings.js              # Preference management & UI bindings
│       │   ├── shortcuts.js             # Global & local keyboard shortcuts
│       │   ├── ditherWaves.js           # Procedural Bayer dither canvas shader
│       │   ├── faultyTerminal.js        # CRT glitch and scanline shader
│       │   ├── gridMotion.js            # Gliding interactive lattice shader
│       │   ├── particles.js             # Ambient drifting particle field
│       │   └── gestures.js              # Mouse gestures & scroll wheel handling
│       └── styles/
│           ├── main.css                 # Core typography, glassmorphism & cards
│           ├── controls.css             # Control bar, volume slider & responsive breakpoints
│           ├── playlist.css             # Sidebar playlist layout & animations
│           ├── settings.css             # Settings panel, equalizer & modal styling
│           ├── themes.css               # Color variables for Dark, OLED & Light themes
│           └── animations.css           # Keyframe transitions, toasts & glows
├── assets/
│   ├── icons/                           # Windows and app icons
│   └── fonts/                           # Optional brand typography
├── package.json
├── electron-builder.json
├── .gitignore
└── README.md
```

---

## Getting Started

### Prerequisites
- **Node.js** 18+ ([nodejs.org](https://nodejs.org))
- **npm** or **yarn**

### Installation

```bash
git clone https://github.com/khalilgihub/Video_player.git
cd Video_player
npm install
```

### Development Run

```bash
npm start
```

Or run with verbose console logging:
```bash
npm run dev
```

### Static Readiness Check

```bash
npm run check:static
```

### Packaging & Distribution

```bash
# Windows (.exe installer and portable)
npm run build:win

# macOS
npm run build:mac

# Linux (.AppImage, .deb)
npm run build:linux
```

Built executables and distribution artifacts will be generated in the `dist/` directory.

---

## Architecture & Security Highlights

1. **Strict Context Isolation**: Renderer runs with `contextIsolation: true` and `nodeIntegration: false`. All operations communicate through allowlisted IPC channels in `preload.js`.
2. **Native GPU Embed**: Direct `mpv.exe` window attachment via child HWND embedding for flawless 4K/8K 60fps playback without Electron video tag overhead.
3. **High-Precision Seeking**: Uses exact keyframe targeting (`seek relative+exact` and `--hr-seek=yes`) to guarantee zero audio drift or visual stutter when skipping.
4. **Debounce-Free Single Click**: Instantaneous play/pause response when double-click to fullscreen is toggled off.
5. **Session Trash Buffer**: Screenshot deletion moves files to temporary staging with instant undo/redo (`D` and `Z`) before final dismissal.

---

## License

MIT © [Hybrid Player Team](https://github.com/khalilgihub/Video_player)
