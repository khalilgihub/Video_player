/**
 * Hybrid Player - Main Process
 * Production-grade Electron video player
 */

const { app, BrowserWindow, ipcMain, dialog, globalShortcut, screen, Menu, protocol, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { setupIpcHandlers } = require('./ipc-handlers');
const { MpvProcess } = require('./mpv-process');
const { setupMpvIpc } = require('./mpv-ipc-bridge');

const YT_DEBUG = true;
function ytdbg(...args) {
  if (!YT_DEBUG) return;
  console.log('[YTDBG][main]', ...args);
}

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v', '.wmv', '.ts', '.m2ts', '.mts',
  '.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff', '.alac',
  '.m3u8', '.mpd'
]);

const PLAYLIST_VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v', '.wmv', '.ts', '.m2ts', '.mts'
]);

function createMediaFilters() {
  return [
    {
      name: 'Media Files',
      extensions: [
        'mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'm4v', 'wmv', 'ts', 'm2ts', 'mts',
        'mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'wma', 'opus', 'aiff', 'alac',
        'm3u8', 'mpd'
      ]
    },
    { name: 'All Files', extensions: ['*'] }
  ];
}

async function collectFolderMediaFiles(folderPath) {
  try {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .filter((entry) => PLAYLIST_VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .map((entry) => path.join(folderPath, entry.name))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b), undefined, { numeric: true, sensitivity: 'base' }));
  } catch {
    return [];
  }
}

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseJsonObjectFromStdout(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }
  }

  return null;
}

function resolveBundledBinaryPath(binaryName) {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mpv', binaryName);
  }
  return path.join(__dirname, '../../mpv', binaryName);
}

function resolveFfmpegBinary() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg.exe'),
        path.join(process.resourcesPath || '', 'mpv', 'ffmpeg.exe'),
        path.join(path.dirname(process.execPath), 'ffmpeg', 'ffmpeg.exe'),
        path.join(__dirname, '../../ffmpeg/ffmpeg.exe'),
        'ffmpeg.exe',
        'ffmpeg',
      ]
    : [
        path.join(process.resourcesPath || '', 'ffmpeg', 'ffmpeg'),
        path.join(process.resourcesPath || '', 'mpv', 'ffmpeg'),
        path.join(path.dirname(process.execPath), 'ffmpeg', 'ffmpeg'),
        path.join(__dirname, '../../ffmpeg/ffmpeg'),
        'ffmpeg',
      ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate === 'ffmpeg' || candidate === 'ffmpeg.exe') {
      return candidate;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function formatFfmpegTimestamp(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  return safeSeconds.toFixed(3);
}

function createClipOutputPath(filePath) {
  const parsed = path.parse(filePath);
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');

  let candidate = path.join(parsed.dir, `${parsed.name}-clip-${stamp}${parsed.ext}`);
  let counter = 1;

  while (fs.existsSync(candidate)) {
    counter += 1;
    candidate = path.join(parsed.dir, `${parsed.name}-clip-${stamp}-${counter}${parsed.ext}`);
  }

  return candidate;
}

async function clipMediaSegment({ filePath, startTime, duration }) {
  const targetPath = typeof filePath === 'string' ? filePath.trim() : '';
  const safeStartTime = Math.max(0, Number(startTime) || 0);
  const safeDuration = Math.max(0, Number(duration) || 0);

  if (!targetPath) {
    throw new Error('Missing source file path');
  }
  if (!fs.existsSync(targetPath)) {
    throw new Error('Source file not found');
  }
  if (!Number.isFinite(safeDuration) || safeDuration <= 0) {
    throw new Error('Clip duration must be greater than zero');
  }

  const ffmpegBinary = resolveFfmpegBinary();
  const outputPath = createClipOutputPath(targetPath);
  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel', 'error',
    '-ss', formatFfmpegTimestamp(safeStartTime),
    '-i', targetPath,
    '-t', formatFfmpegTimestamp(safeDuration),
    '-map', '0',
    '-c', 'copy',
    outputPath,
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(ffmpegBinary, ffmpegArgs, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';

    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('error', (error) => {
      reject(new Error(`Failed to start ffmpeg: ${error.message}`));
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve({
          outputPath,
          startTime: safeStartTime,
          duration: safeDuration,
        });
        return;
      }

      const message = stderr.trim() || `ffmpeg exited with code ${code}`;
      reject(new Error(message));
    });
  });
}

async function getYoutubeQualityHeights(url) {
  const target = typeof url === 'string' ? url.trim() : '';
  if (!target) {
    ytdbg('getYoutubeQualityHeights skipped: empty URL');
    return [];
  }

  ytdbg('extract qualities start', { url: target });

  const candidates = process.platform === 'win32'
    ? [
      resolveBundledBinaryPath('yt-dlp.exe'),
      resolveBundledBinaryPath('yt-dlp'),
      'yt-dlp.exe',
      'yt-dlp'
    ]
    : [
      resolveBundledBinaryPath('yt-dlp'),
      'yt-dlp'
    ];
  const uniqueCandidates = Array.from(new Set(candidates));

  let payload = null;
  const args = ['-J', '--no-warnings', '--no-playlist', target];

  for (const bin of uniqueCandidates) {
    try {
      ytdbg('running yt-dlp', { bin, args });
      const { stdout, stderr } = await execFileAsync(bin, args, {
        windowsHide: true,
        maxBuffer: 25 * 1024 * 1024
      });
      if (stderr && String(stderr).trim()) {
        ytdbg('yt-dlp stderr', String(stderr).trim().slice(0, 800));
      }
      payload = parseJsonObjectFromStdout(stdout);
      if (payload) {
        ytdbg('yt-dlp payload parsed', {
          hasFormats: Array.isArray(payload.formats),
          formatCount: Array.isArray(payload.formats) ? payload.formats.length : 0,
          title: payload.title || null
        });
        break;
      }
      ytdbg('yt-dlp payload parse failed', { bin });
    } catch (error) {
      ytdbg('yt-dlp command error', {
        bin,
        code: error?.code,
        message: error?.message,
        stderr: String(error?.stderr || '').trim().slice(0, 800)
      });
      if (error && error.code === 'ENOENT') {
        continue;
      }
    }
  }

  if (!payload || !Array.isArray(payload.formats)) {
    ytdbg('extract qualities failed: no formats in payload');
    return [];
  }

  const heights = new Set();
  for (const format of payload.formats) {
    if (!format || format.vcodec === 'none') continue;
    const value = Number(format.height);
    if (Number.isFinite(value) && value > 0) {
      heights.add(Math.round(value));
    }
  }

  const result = Array.from(heights).sort((a, b) => b - a);
  ytdbg('extract qualities success', { count: result.length, heights: result });
  return result;
}

function registerSystemDialogHandlers(win) {
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Open Media File',
      properties: ['openFile'],
      filters: createMediaFilters()
    });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });

  ipcMain.handle('dialog:openMultiple', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Open Multiple Media Files',
      properties: ['openFile', 'multiSelections'],
      filters: createMediaFilters()
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Open Folder',
      properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    return collectFolderMediaFiles(result.filePaths[0]);
  });

  ipcMain.handle('media:clip-segment', async (_, payload) => {
    return clipMediaSegment(payload || {});
  });

  ipcMain.handle('youtube:get-quality-heights', async (_, url) => {
    ytdbg('ipc youtube:get-quality-heights request', { url: String(url || '') });
    const heights = await getYoutubeQualityHeights(url);
    ytdbg('ipc youtube:get-quality-heights response', { heights });
    return heights;
  });
}

// Hardware acceleration
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');

// VAAPI applies to Linux; forcing it on Windows can cause decode instability.
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder');
}

// Memory optimization
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');

let mainWindow = null;
let mpvProcess = null;
let fullscreenTransitionUntil = 0;
const WINDOWED_WIDTH = 1920;
const WINDOWED_HEIGHT = 1020;

// TEMP DEBUG: fullscreen/input tracing
const FS_DEBUG = true;
function fsdbg(...args) {
  if (!FS_DEBUG) return;
  console.log('[FSDBG][main]', ...args);
}

function getTrackedFullscreen(win) {
  if (!win || win.isDestroyed()) return false;
  if (typeof win.__hybridFullscreenState === 'boolean') {
    return win.__hybridFullscreenState;
  }
  return !!win.isFullScreen();
}

function setTrackedFullscreen(win, target, source = 'unknown') {
  if (!win || win.isDestroyed()) return false;

  const desired = !!target;
  const now = Date.now();
  const current = getTrackedFullscreen(win);

  // Guard repeated toggles while Windows is transitioning fullscreen.
  if (source.includes('toggle') && now < fullscreenTransitionUntil) {
    fsdbg('setTrackedFullscreen skipped (transition lock)', { source, desired, current });
    return current;
  }

  if (current === desired) {
    fsdbg('setTrackedFullscreen no-op', { source, desired });
    return current;
  }

  fullscreenTransitionUntil = now + 350;
  win.__hybridFullscreenState = desired;
  fsdbg('setTrackedFullscreen apply', { source, from: current, to: desired });
  win.setFullScreen(desired);
  return desired;
}

function applyWindowedSize(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) {
    win.unmaximize();
  }
  win.setSize(WINDOWED_WIDTH, WINDOWED_HEIGHT, false);
  win.center();
}

const DB_PATH = path.join(app.getPath('userData'), 'hybrid-player-db.json');

function loadDatabase() {
  const defaults = {
    preferences: {
      theme: 'dark',
      accentColor: '#e50914',
      autoResume: true,
      volume: 1.0,
      equalizerPreset: 'flat',
      equalizerBands: [0,0,0,0,0,0,0,0,0,0],
      motionProfile: 'balanced',
      brandFontEnabled: true,
    },
    history: [],
    resumePositions: {},
    playlists: [],
    speedMemory: {},
    subtitleDelayMemory: {},
    recentFiles: []
  };

  try {
    if (fs.existsSync(DB_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
      return {
        ...defaults,
        ...parsed,
        preferences: {
          ...defaults.preferences,
          ...(parsed?.preferences || {})
        }
      };
    }
  } catch (e) {
    console.error('Failed to load database:', e);
  }
  return defaults;
}

function saveDatabase(db) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    console.error('Failed to save database:', e);
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOWED_WIDTH,
    height: WINDOWED_HEIGHT,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    transparent: false,
    fullscreenable: true,
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    icon: path.join(__dirname, '../../assets/icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: true
    },
    show: false
  });
  mainWindow.__hybridFullscreenState = false;
  mainWindow.__hybridUiLocked = false;

  mpvProcess = new MpvProcess();
  setupMpvIpc(mainWindow, mpvProcess);
  mpvProcess.on('log', (line) => {
    const msg = String(line || '').trim();
    if (msg) {
      console.log('[mpv]', msg);
    }
  });
  mpvProcess.on('stderr-log', (line) => {
    const msg = String(line || '').trim();
    if (msg) {
      console.error('[MPV ERROR]', msg);
    }
  });
  mpvProcess.on('log-message', (payload) => {
    if (!payload) return;
    const level = payload.level || 'info';
    const prefix = payload.prefix || '';
    const text = String(payload.text || '').trim();
    if (!text) return;

    if (level === 'error' || level === 'fatal' || level === 'warn') {
      console.error(`[MPV ERROR][IPC:${level}]`, prefix, text);
    } else {
      console.log(`[MPV LOG][IPC:${level}]`, prefix, text);
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  fsdbg('createMainWindow ready', { id: mainWindow.id });

  // Renderer-side fallback for key handling when Chromium receives input.
  // (Global shortcuts below remain the safety net when mpv child has focus.)
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (!mainWindow || mainWindow.isDestroyed() || input.type !== 'keyDown') return;
    if (mainWindow.__hybridUiLocked) return;

    const key = String(input.key || '').toLowerCase();
    const wantsDevtools =
      key === 'f12' ||
      ((input.control || input.meta) && input.shift && key === 'i');
    if (wantsDevtools) {
      event.preventDefault();
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools();
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
      return;
    }

    if (key === 'f' || key === 'escape' || key === 'f11') {
      fsdbg('before-input-event', {
        key,
        code: input.code,
        focused: mainWindow.isFocused(),
        fullscreen: mainWindow.isFullScreen()
      });
    }
    if (key === 'f') {
      event.preventDefault();
      const next = !getTrackedFullscreen(mainWindow);
      fsdbg('before-input-event toggle fullscreen', { from: getTrackedFullscreen(mainWindow), to: next });
      setTrackedFullscreen(mainWindow, next, 'before-input-toggle');
      return;
    }

    if (key === 'escape' && getTrackedFullscreen(mainWindow)) {
      event.preventDefault();
      fsdbg('before-input-event force exit fullscreen');
      setTrackedFullscreen(mainWindow, false, 'before-input-escape');
    }
  });

  // Smooth show – also spawn mpv once the window is visible
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Get native window handle and spawn mpv into it
    const nativeHandle = mainWindow.getNativeWindowHandle();
    const resolvedMpvPath = process.platform === 'win32'
      ? resolveBundledBinaryPath('mpv.exe')
      : resolveBundledBinaryPath('mpv');
    const resolvedYtdlpPath = process.platform === 'win32'
      ? resolveBundledBinaryPath('yt-dlp.exe')
      : resolveBundledBinaryPath('yt-dlp');
    try {
      mpvProcess.spawn(nativeHandle, {
        mpvPath: resolvedMpvPath,
        ytdlPath: resolvedYtdlpPath,
        hwdec: 'auto-safe',
        screenshotDir: path.join(app.getPath('pictures'), 'Hybrid Player Screenshots')
      });
      console.log('mpv process spawned and IPC bridge ready');
    } catch (err) {
      console.error('Failed to spawn mpv:', err);
    }
  });

  mainWindow.on('closed', () => {
    if (mpvProcess) {
      mpvProcess.destroy();
      mpvProcess = null;
    }
    mainWindow = null;
  });

  // Track window state for renderer
  mainWindow.on('maximize', () => {
    fsdbg('window maximize');
    mainWindow.webContents.send('window-state-changed', 'maximized');
  });
  mainWindow.on('unmaximize', () => {
    fsdbg('window unmaximize');
    mainWindow.webContents.send('window-state-changed', 'normal');
  });
  mainWindow.on('enter-full-screen', () => {
    mainWindow.__hybridFullscreenState = true;
    fsdbg('window enter-full-screen');
    mainWindow.webContents.send('window-state-changed', 'fullscreen');
  });
  mainWindow.on('leave-full-screen', () => {
    mainWindow.__hybridFullscreenState = false;
    applyWindowedSize(mainWindow);
    fsdbg('window leave-full-screen');
    mainWindow.webContents.send('window-state-changed', 'normal');
  });
  mainWindow.on('focus', () => fsdbg('window focus'));
  mainWindow.on('blur', () => fsdbg('window blur'));

  return mainWindow;
}

// ─── Global Shortcut safety net ──────────────────────────
// Catches F11 and Escape even when the mpv native child window has
// OS keyboard focus and the script-message relay hasn't fired.
function setupGlobalShortcuts() {
  const KEYS = ['F', 'F11', 'Escape'];

  const unregisterManaged = () => {
    for (const key of KEYS) {
      if (globalShortcut.isRegistered(key)) {
        fsdbg('globalShortcut unregister', key);
        globalShortcut.unregister(key);
      }
    }
  };

  const canHandle = () => (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    mainWindow.isVisible() &&
    !mainWindow.isMinimized() &&
    mainWindow.isFocused() &&
    !mainWindow.__hybridUiLocked
  );

  const toggleFullscreen = () => {
    if (!canHandle()) return;
    const next = !getTrackedFullscreen(mainWindow);
    fsdbg('globalShortcut toggle fullscreen', { from: getTrackedFullscreen(mainWindow), to: next });
    setTrackedFullscreen(mainWindow, next, 'globalShortcut-toggle');
  };

  const exitFullscreen = () => {
    if (!canHandle()) return;
    if (getTrackedFullscreen(mainWindow)) {
      fsdbg('globalShortcut exit fullscreen');
      setTrackedFullscreen(mainWindow, false, 'globalShortcut-escape');
    }
  };

  const sync = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      unregisterManaged();
      return;
    }

    const focused = mainWindow.isFocused();
    fsdbg('globalShortcut sync', { focused, fullscreen: getTrackedFullscreen(mainWindow) });

    if (focused) {
      if (!globalShortcut.isRegistered('F')) {
        const ok = globalShortcut.register('F', toggleFullscreen);
        fsdbg('globalShortcut register F', { ok });
      }
      if (!globalShortcut.isRegistered('F11')) {
        const ok = globalShortcut.register('F11', toggleFullscreen);
        fsdbg('globalShortcut register F11', { ok });
      }
      if (!globalShortcut.isRegistered('Escape')) {
        const ok = globalShortcut.register('Escape', exitFullscreen);
        fsdbg('globalShortcut register Escape', { ok });
      }
    } else {
      unregisterManaged();
    }
  };

  mainWindow.on('focus', sync);
  mainWindow.on('blur', unregisterManaged);
  mainWindow.on('enter-full-screen', sync);
  mainWindow.on('leave-full-screen', sync);
  mainWindow.on('closed', unregisterManaged);

  sync();
}

// Initialize
app.whenReady().then(() => {
  // Register custom protocol for local files
  protocol.handle('local-file', (request) => {
    const filePath = decodeURIComponent(request.url.replace('local-file://', ''));
    return new Response(fs.createReadStream(filePath), {
      headers: { 'Content-Type': getMimeType(filePath) }
    });
  });

  const db = loadDatabase();
  const win = createMainWindow();
  setupGlobalShortcuts();
  Menu.setApplicationMenu(null);
  registerSystemDialogHandlers(win);
  setupIpcHandlers(ipcMain, win, db, saveDatabase);
});

app.on('will-quit', () => {
  // Can fire before app is ready (e.g., second-instance lock fails).
  // globalShortcut API throws if used before readiness.
  if (app.isReady()) {
    globalShortcut.unregisterAll();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      // Open file from argv if provided
      const filePath = argv.find(arg => /\.(mp4|mkv|avi|mov|webm|flv|m3u8)$/i.test(arg));
      if (filePath) {
        mainWindow.webContents.send('open-file-from-args', filePath);
      }
    }
  });
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime', '.webm': 'video/webm', '.flv': 'video/x-flv',
    '.m3u8': 'application/x-mpegURL', '.srt': 'text/plain', '.vtt': 'text/vtt',
    '.ass': 'text/plain', '.jpg': 'image/jpeg', '.png': 'image/png'
  };
  return types[ext] || 'application/octet-stream';
}
