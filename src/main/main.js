/**
 * Hybrid Player - Main Process
 * Production-grade Electron video player
 */

const { app, BrowserWindow, ipcMain, dialog, globalShortcut, screen, Menu, protocol, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { fileURLToPath } = require('url');
const { setupIpcHandlers } = require('./ipc-handlers');
const { MpvProcess } = require('./mpv-process');
const { setupMpvIpc } = require('./mpv-ipc-bridge');
const {
  resolveBundledBinaryPath: resolveBundledBinaryPathFromResolver,
  resolveFfmpegBinary: resolveFfmpegBinaryFromResolver,
  resolveMpvBinary,
  resolveYtDlpBinary,
} = require('./binary-resolver');

const YT_DEBUG = false;
function ytdbg(...args) {
  if (!YT_DEBUG) return;
  console.log('[YTDBG][main]', ...args);
}

const MAIN_DEBUG = false;
function maindbg(...args) {
  if (!MAIN_DEBUG) return;
  console.log('[MAINDBG][main]', ...args);
}

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v', '.wmv', '.ts', '.m2ts', '.mts',
  '.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff', '.alac',
  '.m3u8', '.mpd'
]);
const MEDIA_DIALOG_EXTENSIONS = Array.from(MEDIA_EXTENSIONS, (ext) => ext.slice(1));
const FOLDER_SCAN_MAX_DEPTH = 8;
const FOLDER_SCAN_MAX_FILES = 2000;
const FOLDER_SCAN_MAX_DIRS = 5000;

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const YT_DLP_TIMEOUT_MS = 20000;
const CLIP_EXPORT_TIMEOUT_MS = 5 * 60 * 1000;
const CLIP_MAX_DURATION_SECONDS = 6 * 60 * 60;
const CLIP_MAX_START_SECONDS = 30 * 24 * 60 * 60;

function isDevToolsEnabled() {
  return !app.isPackaged || process.env.HYBRID_ENABLE_DEVTOOLS === '1';
}

function normalizeYoutubeUrl(value) {
  const target = typeof value === 'string' ? value.trim() : '';
  if (!target || target.length > 4096) return null;

  try {
    const parsed = new URL(target);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function isTrustedRendererUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== 'file:') return false;
    return path.resolve(fileURLToPath(parsed)) === path.resolve(__dirname, '../renderer/index.html');
  } catch {
    return false;
  }
}

function hardenWebContents(win) {
  if (!win || win.isDestroyed()) return;

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isTrustedRendererUrl(targetUrl)) {
      event.preventDefault();
    }
  });

  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  win.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function createMediaFilters() {
  return [
    {
      name: 'Media Files',
      extensions: MEDIA_DIALOG_EXTENSIONS
    }
  ];
}

async function collectFolderMediaFiles(folderPath) {
  const root = resolveExistingLocalDirectory(folderPath);
  if (!root) return [];

  const mediaFiles = [];
  let visitedDirs = 0;

  async function walk(dirPath, depth) {
    if (mediaFiles.length >= FOLDER_SCAN_MAX_FILES) return;
    if (depth > FOLDER_SCAN_MAX_DEPTH) return;
    visitedDirs += 1;
    if (visitedDirs > FOLDER_SCAN_MAX_DIRS) return;

    let entries = [];
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

    for (const entry of entries) {
      if (mediaFiles.length >= FOLDER_SCAN_MAX_FILES || visitedDirs > FOLDER_SCAN_MAX_DIRS) return;
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1);
        continue;
      }
      if (entry.isFile() && MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        mediaFiles.push(entryPath);
      }
    }
  }

  await walk(root, 0);
  return mediaFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function resolveExistingLocalDirectory(dirPath) {
  if (typeof dirPath !== 'string') return null;
  const source = dirPath.trim();
  if (!source || source.length > 4096 || source.includes('\0')) return null;

  try {
    const resolved = path.resolve(source);
    const stat = fs.statSync(resolved);
    return stat.isDirectory() ? resolved : null;
  } catch {
    return null;
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
  return resolveBundledBinaryPathFromResolver(binaryName, app.isPackaged, process.resourcesPath, __dirname);
}

function resolveFfmpegBinary() {
  return resolveFfmpegBinaryFromResolver(process.resourcesPath, process.execPath, __dirname, {
    allowPathLookup: !app.isPackaged
  });
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

function resolveExistingLocalFile(filePath, allowedExtensions = null) {
  if (typeof filePath !== 'string') return null;
  const source = filePath.trim();
  if (!source || source.length > 4096 || source.includes('\0')) return null;

  try {
    const resolved = path.resolve(source);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return null;
    if (allowedExtensions && !allowedExtensions.has(path.extname(resolved).toLowerCase())) return null;
    return resolved;
  } catch {
    return null;
  }
}

async function clipMediaSegment({ filePath, startTime, duration }) {
  const targetPath = resolveExistingLocalFile(filePath, MEDIA_EXTENSIONS);
  const numericStartTime = Number(startTime);
  const numericDuration = Number(duration);

  if (!targetPath) {
    throw new Error('Source media file not found or unsupported');
  }
  if (!Number.isFinite(numericStartTime) || numericStartTime < 0 || numericStartTime > CLIP_MAX_START_SECONDS) {
    throw new Error('Clip start time is invalid');
  }
  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    throw new Error('Clip duration must be greater than zero');
  }
  if (numericDuration > CLIP_MAX_DURATION_SECONDS) {
    throw new Error('Clip duration is too long');
  }

  const ffmpegBinary = resolveFfmpegBinary();
  if (!ffmpegBinary) {
    throw new Error('ffmpeg binary not found');
  }
  const safeStartTime = Math.max(0, numericStartTime);
  const safeDuration = Math.max(0, numericDuration);
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
    let settled = false;
    const ffmpeg = spawn(ffmpegBinary, ffmpegArgs, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ffmpeg.kill('SIGKILL');
      } catch {}
      reject(new Error('Clip export timed out'));
    }, CLIP_EXPORT_TIMEOUT_MS);

    const finish = (fn) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('error', (error) => {
      finish(() => reject(new Error(`Failed to start ffmpeg: ${error.message}`)));
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        finish(() => resolve({
          outputPath,
          startTime: safeStartTime,
          duration: safeDuration,
        }));
        return;
      }

      const message = stderr.trim() || `ffmpeg exited with code ${code}`;
      finish(() => reject(new Error(message)));
    });
  });
}

async function getYoutubeQualityHeights(url) {
  const target = normalizeYoutubeUrl(url);
  if (!target) {
    ytdbg('getYoutubeQualityHeights skipped: invalid or non-YouTube URL');
    return [];
  }

  ytdbg('extract qualities start', { url: target });

  const resolvedYtDlp = resolveYtDlpBinary(process.resourcesPath, process.execPath, __dirname, {
    allowPathLookup: !app.isPackaged
  });
  const candidates = process.platform === 'win32'
    ? [
      resolvedYtDlp,
      resolveBundledBinaryPath('yt-dlp.exe'),
      resolveBundledBinaryPath('yt-dlp')
    ]
    : [
      resolvedYtDlp,
      resolveBundledBinaryPath('yt-dlp')
    ];
  const uniqueCandidates = Array.from(new Set(candidates.filter((candidate) => {
    if (!candidate) return false;
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  })));

  if (uniqueCandidates.length === 0) {
    ytdbg('extract qualities failed: yt-dlp binary not found');
    return [];
  }

  let payload = null;
  const args = ['-J', '--no-warnings', '--no-playlist', target];

  for (const bin of uniqueCandidates) {
    try {
      ytdbg('running yt-dlp', { bin, args });
      const { stdout, stderr } = await execFileAsync(bin, args, {
        windowsHide: true,
        timeout: YT_DLP_TIMEOUT_MS,
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
  ipcMain.handle('app:get-startup-diagnostics', async () => startupDiagnostics.slice());

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
const FULLSCREEN_RESTORE_DELAY_MS = 140;
const ENABLE_WINDOW_BOUNDS_CLAMP = false;
// Transparent compositor is required so that mpv --wid rendering shows through
// the Chromium layer. Without this the video appears black.
const USE_WINDOWS_TRANSPARENT_COMPOSITOR = true;
let isClampingWindowBounds = false;
const WM_NCHITTEST = 0x0084;
const WM_NCACTIVATE = 0x0086;
const HTNOWHERE = 0;
const HTCLIENT = 1;
const HTLEFT = 10;
const HTRIGHT = 11;
const HTTOP = 12;
const HTTOPLEFT = 13;
const HTTOPRIGHT = 14;
const HTBOTTOM = 15;
const HTBOTTOMLEFT = 16;
const HTBOTTOMRIGHT = 17;
const RESIZE_BORDER_DIP = 8;

// Fullscreen/input trace logging.
const FS_DEBUG = false;
function fsdbg(...args) {
  if (!FS_DEBUG) return;
  console.log('[FSDBG][main]', ...args);
}

// DWM seam diagnostics for the white top-strip issue on transparent windows.
// Keep disabled in normal runs to avoid terminal/file log spam.
const DWM_DIAG_LOG = false;
const DWM_DIAG_ECHO_CONSOLE = false;
const DWM_DIAG_BLUR_PROBE_MS = [0, 16, 33, 66, 100, 150, 250, 400, 700, 1000];
const DWM_DIAG_THROTTLE_MS = 120;
const windowDiagLastAt = new Map();
const dwmPatchLastAt = new Map();
const dwmPatchInFlight = new Set();

function appendDwmDiag(scope, payload) {
  if (!DWM_DIAG_LOG) return;
  if (!app.isReady()) return;
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    const logFile = path.join(logDir, 'hybrid-dwm-main.log');
    fs.mkdirSync(logDir, { recursive: true });
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    fs.appendFileSync(logFile, `${new Date().toISOString()} [${scope}] ${body}\n`, 'utf8');
    if (DWM_DIAG_ECHO_CONSOLE) {
      console.log(`[DWMDBG][main][${scope}]`, body);
    }
  } catch (error) {
    console.error('[DWMDBG][main] failed to append log:', error?.message || error);
  }
}

function getDisplaySnapshotForBounds(bounds) {
  const centerPoint = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
  const display = screen.getDisplayNearestPoint(centerPoint);
  if (!display) return null;
  return {
    id: display.id,
    scaleFactor: display.scaleFactor,
    rotation: display.rotation,
    bounds: display.bounds,
    workArea: display.workArea,
    workAreaSize: display.workAreaSize,
    size: display.size,
  };
}

function logWindowDwmSnapshot(win, source, extra = {}) {
  if (!DWM_DIAG_LOG) return;
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const contentBounds = win.getContentBounds();
  const cursor = screen.getCursorScreenPoint();
  const payload = {
    source,
    ts: Date.now(),
    focused: win.isFocused(),
    visible: win.isVisible(),
    minimized: win.isMinimized(),
    nativeMaximized: win.isMaximized(),
    fakeMaximized: !!win.__hybridFakeMaximized,
    fullscreenTracked: getTrackedFullscreen(win),
    fullscreenNative: win.isFullScreen(),
    bounds,
    contentBounds,
    cursor,
    display: getDisplaySnapshotForBounds(bounds),
    ...extra,
  };
  appendDwmDiag('window-state', payload);
}

function logWindowDwmSnapshotThrottled(win, source, extra = {}, throttleMs = DWM_DIAG_THROTTLE_MS) {
  if (!win || win.isDestroyed()) return;
  const key = `${win.id}:${source}`;
  const now = Date.now();
  const last = windowDiagLastAt.get(key) || 0;
  if (now - last < throttleMs) return;
  windowDiagLastAt.set(key, now);
  logWindowDwmSnapshot(win, source, extra);
}

function scheduleBlurProbe(win, source = 'blur') {
  if (!DWM_DIAG_LOG) return;
  for (const delayMs of DWM_DIAG_BLUR_PROBE_MS) {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      logWindowDwmSnapshot(win, `${source}+${delayMs}ms`);
    }, delayMs);
  }
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

  if (desired) {
    capturePreFullscreenBounds(win, source);
  }

  fullscreenTransitionUntil = now + 350;
  win.__hybridFullscreenState = desired;
  fsdbg('setTrackedFullscreen apply', { source, from: current, to: desired });
  win.setFullScreen(desired);
  return desired;
}

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const x = Math.round(Number(bounds.x));
  const y = Math.round(Number(bounds.y));
  const width = Math.round(Number(bounds.width));
  const height = Math.round(Number(bounds.height));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function capturePreFullscreenBounds(win, source = 'unknown') {
  if (!win || win.isDestroyed()) return;
  if (getTrackedFullscreen(win) || win.isFullScreen()) return;
  const bounds = normalizeBounds(win.getBounds());
  if (!bounds) return;
  win.__hybridPreFullscreenBounds = bounds;
  fsdbg('captured pre-fullscreen bounds', { source, bounds });
}

function restorePreFullscreenBounds(win, source = 'unknown') {
  if (!win || win.isDestroyed()) return false;
  const targetBounds = normalizeBounds(win.__hybridPreFullscreenBounds);
  if (!targetBounds) return false;
  if (win.isMaximized()) {
    win.unmaximize();
  }
  win.setBounds(targetBounds, false);
  win.__hybridPreFullscreenBounds = null;
  fsdbg('restored pre-fullscreen bounds', { source, bounds: targetBounds });
  return true;
}

function applyWindowedSize(win) {
  if (!win || win.isDestroyed()) return;
  if (win.__hybridFakeMaximized) {
    win.__hybridFakeMaximized = false;
    win.__hybridRestoreBounds = null;
  }
  if (win.isMaximized()) {
    win.unmaximize();
  }

  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const area = display?.workArea || screen.getPrimaryDisplay().workArea;

  const width = Math.min(WINDOWED_WIDTH, area.width);
  const height = Math.min(WINDOWED_HEIGHT, area.height);
  const x = area.x + Math.round((area.width - width) / 2);
  const y = area.y + Math.round((area.height - height) / 2);

  isClampingWindowBounds = true;
  try {
    win.setBounds({ x, y, width, height }, false);
  } finally {
    setTimeout(() => {
      isClampingWindowBounds = false;
    }, 0);
  }
}

function getFakeMaximizedBounds(win) {
  const bounds = win.getBounds();
  const centerPoint = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
  const display = screen.getDisplayNearestPoint(centerPoint);
  const workArea = display?.workArea || screen.getPrimaryDisplay().workArea;
  const scaleFactor = Number(display?.scaleFactor || 1);
  // Keep fake-maximized window aligned to the visible work area so
  // custom titlebar controls remain on-screen in windowed mode.
  const seamTopInset = 0;
  const seamSideInset = Math.max(0, Math.ceil(scaleFactor * 0));
  return {
    x: workArea.x - seamSideInset,
    y: workArea.y - seamTopInset,
    width: workArea.width + seamSideInset * 2,
    // Preserve bottom edge at taskbar.
    height: workArea.height + seamTopInset,
  };
}

function convertNativeMaximizeToFake(win, source = 'native-maximize') {
  if (!win || win.isDestroyed()) return false;
  if (win.__hybridConvertingNativeMaximize) return false;

  win.__hybridConvertingNativeMaximize = true;
  try {
    win.__hybridRestoreBounds = typeof win.getNormalBounds === 'function'
      ? win.getNormalBounds()
      : win.getBounds();

    if (win.isMaximized()) {
      win.__hybridSuppressNextUnmaximizeEvent = true;
      win.unmaximize();
    }

    const fakeBounds = getFakeMaximizedBounds(win);
    win.setBounds(fakeBounds, false);
    win.__hybridFakeMaximized = true;
    if (typeof win.__hybridPrevResizable !== 'boolean') {
      win.__hybridPrevResizable = win.isResizable();
    }
    if (win.isResizable()) {
      win.setResizable(false);
    }

    logWindowDwmSnapshot(win, 'maximize-intercepted', {
      source,
      restoreBounds: win.__hybridRestoreBounds || null,
      appliedBounds: fakeBounds,
    });
    emitWindowVisualState(win, 'maximize-intercepted');
    win.webContents.send('window-state-changed', 'maximized');
    return true;
  } finally {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      win.__hybridConvertingNativeMaximize = false;
    }, 0);
  }
}

function clampWindowToVisibleArea(win) {
  if (!ENABLE_WINDOW_BOUNDS_CLAMP) return;
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) return;
  if (getTrackedFullscreen(win) || win.isMaximized() || win.__hybridFakeMaximized) return;
  if (isClampingWindowBounds) return;
  if (Date.now() < fullscreenTransitionUntil) return;

  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  if (!display || !display.workArea) return;

  const area = display.workArea;
  const targetWidth = Math.min(bounds.width, area.width);
  const targetHeight = Math.min(bounds.height, area.height);
  const maxX = area.x + Math.max(0, area.width - targetWidth);
  const maxY = area.y + Math.max(0, area.height - targetHeight);
  const clampedX = Math.min(Math.max(bounds.x, area.x), maxX);
  const clampedY = Math.min(Math.max(bounds.y, area.y), maxY);

  if (
    clampedX === bounds.x &&
    clampedY === bounds.y &&
    targetWidth === bounds.width &&
    targetHeight === bounds.height
  ) return;

  isClampingWindowBounds = true;
  try {
    win.setBounds(
      { x: clampedX, y: clampedY, width: targetWidth, height: targetHeight },
      false
    );
    fsdbg('window bounds clamped', {
      from: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      to: { x: clampedX, y: clampedY, width: targetWidth, height: targetHeight },
      area,
    });
  } finally {
    setTimeout(() => {
      isClampingWindowBounds = false;
    }, 0);
  }
}

const DB_PATH = path.join(app.getPath('userData'), 'hybrid-player-db.json');
const startupDiagnostics = [];

function addStartupDiagnostic(level, code, message, detail = null) {
  startupDiagnostics.push({
    level,
    code,
    message,
    detail,
    timestamp: Date.now(),
  });
}

function createDefaultDatabase() {
  return {
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
}

function normalizeDatabase(parsed, defaults) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const preferences = source.preferences && typeof source.preferences === 'object' ? source.preferences : {};

  return {
    ...defaults,
    ...source,
    preferences: {
      ...defaults.preferences,
      ...preferences,
    },
    history: Array.isArray(source.history) ? source.history : defaults.history,
    playlists: Array.isArray(source.playlists) ? source.playlists : defaults.playlists,
    recentFiles: Array.isArray(source.recentFiles) ? source.recentFiles : defaults.recentFiles,
    resumePositions: source.resumePositions && typeof source.resumePositions === 'object'
      ? source.resumePositions
      : defaults.resumePositions,
    speedMemory: source.speedMemory && typeof source.speedMemory === 'object'
      ? source.speedMemory
      : defaults.speedMemory,
    subtitleDelayMemory: source.subtitleDelayMemory && typeof source.subtitleDelayMemory === 'object'
      ? source.subtitleDelayMemory
      : defaults.subtitleDelayMemory,
  };
}

function loadDatabase() {
  const defaults = createDefaultDatabase();

  try {
    if (fs.existsSync(DB_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
      return normalizeDatabase(parsed, defaults);
    }
  } catch (e) {
    console.error('Failed to load database:', e);
    const backupPath = backupUnreadableDatabase();
    addStartupDiagnostic(
      'warning',
      'DATABASE_REPAIRED',
      'Settings database could not be read. Hybrid Player loaded defaults and saved a backup of the old file.',
      backupPath ? `Backup: ${backupPath}` : 'Backup could not be created.'
    );
  }
  return defaults;
}

function backupUnreadableDatabase() {
  try {
    if (!fs.existsSync(DB_PATH)) return null;
    const dir = path.dirname(DB_PATH);
    const parsed = path.parse(DB_PATH);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(dir, `${parsed.name}.corrupt-${stamp}${parsed.ext}`);
    fs.renameSync(DB_PATH, backupPath);
    return backupPath;
  } catch (error) {
    console.error('Failed to back up unreadable database:', error);
    return null;
  }
}

function saveDatabase(db) {
  try {
    const dir = path.dirname(DB_PATH);
    fs.mkdirSync(dir, { recursive: true });
    const tmpPath = path.join(dir, `.${path.basename(DB_PATH)}.${process.pid}.${Date.now()}.tmp`);
    fs.writeFileSync(tmpPath, JSON.stringify(normalizeDatabase(db, createDefaultDatabase()), null, 2), 'utf-8');
    fs.renameSync(tmpPath, DB_PATH);
  } catch (e) {
    console.error('Failed to save database:', e);
  }
}

function emitWindowVisualState(win, source = 'unknown') {
  if (!win || win.isDestroyed()) return;
  const isFullscreen = getTrackedFullscreen(win) || win.isFullScreen();
  const isMaximized = !isFullscreen && (win.isMaximized() || !!win.__hybridFakeMaximized);
  fsdbg('emitWindowVisualState', { source, isFullscreen, isMaximized });
  win.webContents.send('window-is-fullscreen', isFullscreen);
  win.webContents.send('window-is-maximized', isMaximized);
}

function getNativeWindowHandleDecimal(win) {
  if (!win || win.isDestroyed()) return null;
  try {
    const nativeHandle = win.getNativeWindowHandle();
    if (!nativeHandle) return null;
    if (nativeHandle.length >= 8 && typeof nativeHandle.readBigUInt64LE === 'function') {
      return nativeHandle.readBigUInt64LE(0).toString();
    }
    if (nativeHandle.length >= 4 && typeof nativeHandle.readUInt32LE === 'function') {
      return String(nativeHandle.readUInt32LE(0));
    }
    return parseInt(nativeHandle.toString('hex'), 16).toString();
  } catch {
    return null;
  }
}

function applyDwmBorderColorNoneFallback(win, source = 'unknown') {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const hwnd = getNativeWindowHandleDecimal(win);
  if (!hwnd) return;

  const key = String(win.id);
  const now = Date.now();
  const last = dwmPatchLastAt.get(key) || 0;
  if (now - last < 240) return;
  if (dwmPatchInFlight.has(key)) return;

  dwmPatchLastAt.set(key, now);
  dwmPatchInFlight.add(key);

  const psExe = process.env.SystemRoot
    ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';

  const psScript = [
    '$ErrorActionPreference = "Stop"',
    `$hwnd = [IntPtr]::new(${hwnd})`,
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class HybridDwmNative {',
    '  [DllImport("dwmapi.dll")]',
    '  public static extern int DwmSetWindowAttribute(IntPtr hwnd, int dwAttribute, ref int pvAttribute, int cbAttribute);',
    '  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW", SetLastError=true)]',
    '  public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);',
    '  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW", SetLastError=true)]',
    '  public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);',
    '  [DllImport("user32.dll", SetLastError=true)]',
    '  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);',
    '}',
    '"@',
    '$darkMode = 1',
    '$borderColor = -2',
    '$captionColor = 0',
    '$textColor = 0',
    '$cornerNoRound = 1',
    '$GWL_STYLE = -16',
    '$GWL_EXSTYLE = -20',
    '$WS_CAPTION = 0x00C00000',
    '$WS_THICKFRAME = 0x00040000',
    '$WS_BORDER = 0x00800000',
    '$WS_DLGFRAME = 0x00400000',
    '$WS_EX_WINDOWEDGE = 0x00000100',
    '$WS_EX_CLIENTEDGE = 0x00000200',
    '$WS_EX_DLGMODALFRAME = 0x00000001',
    '$SWP_NOSIZE = 0x0001',
    '$SWP_NOMOVE = 0x0002',
    '$SWP_NOZORDER = 0x0004',
    '$SWP_NOACTIVATE = 0x0010',
    '$SWP_FRAMECHANGED = 0x0020',
    '$SWP_NOOWNERZORDER = 0x0200',
    '$styleMask = $WS_CAPTION -bor $WS_THICKFRAME -bor $WS_BORDER -bor $WS_DLGFRAME',
    '$exMask = $WS_EX_WINDOWEDGE -bor $WS_EX_CLIENTEDGE -bor $WS_EX_DLGMODALFRAME',
    '$style = [int64][HybridDwmNative]::GetWindowLongPtr($hwnd, $GWL_STYLE)',
    '$newStyle = $style -band (-bnot $styleMask)',
    'if ($newStyle -ne $style) {',
    '  [void][HybridDwmNative]::SetWindowLongPtr($hwnd, $GWL_STYLE, [IntPtr]$newStyle)',
    '}',
    '$exStyle = [int64][HybridDwmNative]::GetWindowLongPtr($hwnd, $GWL_EXSTYLE)',
    '$newExStyle = $exStyle -band (-bnot $exMask)',
    'if ($newExStyle -ne $exStyle) {',
    '  [void][HybridDwmNative]::SetWindowLongPtr($hwnd, $GWL_EXSTYLE, [IntPtr]$newExStyle)',
    '}',
    '$swpFlags = $SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED -bor $SWP_NOOWNERZORDER',
    '[void][HybridDwmNative]::SetWindowPos($hwnd, [IntPtr]::Zero, 0, 0, 0, 0, [uint32]$swpFlags)',
    '[HybridDwmNative]::DwmSetWindowAttribute($hwnd, 19, [ref]$darkMode, 4) | Out-Null',
    '[HybridDwmNative]::DwmSetWindowAttribute($hwnd, 20, [ref]$darkMode, 4) | Out-Null',
    '[HybridDwmNative]::DwmSetWindowAttribute($hwnd, 34, [ref]$borderColor, 4) | Out-Null',
    '[HybridDwmNative]::DwmSetWindowAttribute($hwnd, 35, [ref]$captionColor, 4) | Out-Null',
    '[HybridDwmNative]::DwmSetWindowAttribute($hwnd, 36, [ref]$textColor, 4) | Out-Null',
    '[HybridDwmNative]::DwmSetWindowAttribute($hwnd, 33, [ref]$cornerNoRound, 4) | Out-Null',
  ].join('\n');

  const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
  const child = spawn(
    psExe,
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedScript],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] }
  );

  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += String(data || '');
  });

  const finish = (status, detail = '') => {
    dwmPatchInFlight.delete(key);
    if (status === 'error') {
      appendDwmDiag('native-dwm-fallback', {
        source,
        status,
        detail,
        hwnd,
      });
    } else {
      appendDwmDiag('native-dwm-fallback', {
        source,
        status,
        hwnd,
      });
    }
  };

  child.on('error', (error) => {
    finish('error', error?.message || String(error));
  });

  child.on('close', (code) => {
    if (code === 0) {
      finish('ok');
      return;
    }
    finish('error', `exit=${code} stderr=${stderr.trim()}`);
  });
}

function scheduleWindowsBorderSuppression(win, source = 'unknown') {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  if (!win.__hybridUseFakeMaximize) return;
  const delays = [0, 50, 160, 340, 680, 1000, 1500, 2200];
  for (const delayMs of delays) {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      suppressWindowsNonClientBorder(win, `${source}+${delayMs}ms`);
    }, delayMs);
  }
}

function suppressWindowsNonClientBorder(win, source = 'unknown') {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  if (!win.__hybridUseFakeMaximize) return;
  try {
    if (typeof win.setHasShadow === 'function') {
      win.setHasShadow(false);
    }
    if (typeof win.setBackgroundMaterial === 'function') {
      win.setBackgroundMaterial('none');
    }
    if (typeof win.setAccentColor === 'function') {
      win.setAccentColor(false);
    }
    applyDwmBorderColorNoneFallback(win, source);
    fsdbg('windows non-client border suppressed', { source });
  } catch (error) {
    console.error('[window] failed to suppress non-client border', error?.message || error);
  }
}

function unpackSigned16(value) {
  const unsigned = value & 0xffff;
  return unsigned & 0x8000 ? unsigned - 0x10000 : unsigned;
}

function readWindowsMessageWord(paramBuffer) {
  if (!Buffer.isBuffer(paramBuffer) || paramBuffer.length === 0) return 0;
  try {
    if (paramBuffer.length >= 8 && typeof paramBuffer.readBigUInt64LE === 'function') {
      return Number(paramBuffer.readBigUInt64LE(0) & 0xffffffffn);
    }
    if (paramBuffer.length >= 4 && typeof paramBuffer.readUInt32LE === 'function') {
      return paramBuffer.readUInt32LE(0);
    }
  } catch {
    return 0;
  }
  return 0;
}

function readScreenPointFromLParam(lParamBuffer) {
  if (!Buffer.isBuffer(lParamBuffer) || lParamBuffer.length < 4) return null;
  const packed = lParamBuffer.readUInt32LE(0);
  return {
    x: unpackSigned16(packed),
    y: unpackSigned16(packed >>> 16),
  };
}

function pointInClientRect(point, rect) {
  if (!point || !rect) return false;
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x < rect.x + rect.width &&
    point.y < rect.y + rect.height
  );
}

function resolveNcHitTest(win, lParamBuffer) {
  if (!win || win.isDestroyed() || win.isMinimized()) return HTCLIENT;
  if (!win.isResizable()) return HTCLIENT;
  if (getTrackedFullscreen(win) || win.isFullScreen() || win.isMaximized() || win.__hybridFakeMaximized) {
    return HTCLIENT;
  }

  const physicalPoint = readScreenPointFromLParam(lParamBuffer);
  if (!physicalPoint) return HTCLIENT;
  const screenPoint = typeof screen.screenToDipPoint === 'function'
    ? screen.screenToDipPoint(physicalPoint)
    : physicalPoint;

  const bounds = win.getBounds();
  const localPoint = {
    x: Math.round(screenPoint.x - bounds.x),
    y: Math.round(screenPoint.y - bounds.y),
  };

  if (localPoint.x < 0 || localPoint.y < 0 || localPoint.x > bounds.width || localPoint.y > bounds.height) {
    return HTNOWHERE;
  }

  const exclusions = Array.isArray(win.__hybridNcHitTestExclusions) ? win.__hybridNcHitTestExclusions : [];
  if (exclusions.some((rect) => pointInClientRect(localPoint, rect))) {
    return HTCLIENT;
  }

  const left = localPoint.x <= RESIZE_BORDER_DIP;
  const right = localPoint.x >= bounds.width - RESIZE_BORDER_DIP;
  const top = localPoint.y <= RESIZE_BORDER_DIP;
  const bottom = localPoint.y >= bounds.height - RESIZE_BORDER_DIP;

  if (top && left) return HTTOPLEFT;
  if (top && right) return HTTOPRIGHT;
  if (bottom && left) return HTBOTTOMLEFT;
  if (bottom && right) return HTBOTTOMRIGHT;
  if (top) return HTTOP;
  if (bottom) return HTBOTTOM;
  if (left) return HTLEFT;
  if (right) return HTRIGHT;
  return HTCLIENT;
}

function setupWindowsNcHitTestHook(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  if (typeof win.hookWindowMessage !== 'function') return;

  win.hookWindowMessage(WM_NCHITTEST, (wParam, lParam) => {
    const hit = resolveNcHitTest(win, lParam);
    // Returning a hit-test code allows native resize cursors + edge resizing.
    return hit;
  });
}

function setupWindowsNcActivateHook(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  if (typeof win.hookWindowMessage !== 'function') return;

  win.hookWindowMessage(WM_NCACTIVATE, (wParam) => {
    const isActive = readWindowsMessageWord(wParam) !== 0;
    if (!isActive) {
      scheduleWindowsBorderSuppression(win, 'wm-ncactivate-inactive');
      // Transparent frameless windows can flash an inactive top border here.
      // Claiming this message avoids the default non-client repaint path.
      return 1;
    }
    scheduleWindowsBorderSuppression(win, 'wm-ncactivate-active');
    return undefined;
  });
}

function setResizableWhileFullscreen(win, fullscreen) {
  if (!win || win.isDestroyed()) return;
  const baseResizable = typeof win.__hybridBaseResizable === 'boolean'
    ? win.__hybridBaseResizable
    : win.isResizable();
  if (fullscreen) {
    if (typeof win.__hybridPrevFullscreenResizable !== 'boolean') {
      win.__hybridPrevFullscreenResizable = win.isResizable();
    }
    if (win.isResizable()) {
      win.setResizable(false);
    }
    return;
  }

  const previous = typeof win.__hybridPrevFullscreenResizable === 'boolean'
    ? win.__hybridPrevFullscreenResizable
    : baseResizable;
  win.setResizable(previous);
  win.__hybridPrevFullscreenResizable = null;
}

function createMainWindow() {
  const isWindows = process.platform === 'win32';
  const useTransparentOnWindows = isWindows && USE_WINDOWS_TRANSPARENT_COMPOSITOR;
  mainWindow = new BrowserWindow({
    width: WINDOWED_WIDTH,
    height: WINDOWED_HEIGHT,
    minWidth: 800,
    minHeight: 500,
    // Keep native maximize/resize path: fake-maximize + border suppression can break
    // mpv composition on some Windows/Electron combinations (white live surface).
    resizable: true,
    maximizable: true,
    frame: false,
    transparent: useTransparentOnWindows,
    fullscreenable: true,
    backgroundColor: useTransparentOnWindows ? '#00000000' : '#000000',
    hasShadow: true,
    roundedCorners: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    ...(isWindows && useTransparentOnWindows ? {
      backgroundMaterial: 'none',
      accentColor: false,
    } : {}),
    icon: path.join(__dirname, '../../assets/icons/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    },
    show: false
  });
  hardenWebContents(mainWindow);
  mainWindow.__hybridFullscreenState = false;
  mainWindow.__hybridUiLocked = false;
  mainWindow.__hybridFakeMaximized = false;
  mainWindow.__hybridRestoreBounds = null;
  mainWindow.__hybridPrevResizable = null;
  mainWindow.__hybridBaseResizable = mainWindow.isResizable();
  mainWindow.__hybridPrevFullscreenResizable = null;
  mainWindow.__hybridPreFullscreenBounds = null;
  mainWindow.__hybridSuppressNextUnmaximizeEvent = false;
  mainWindow.__hybridConvertingNativeMaximize = false;
  mainWindow.__hybridNcHitTestExclusions = [];
  mainWindow.__hybridUseFakeMaximize = false;
  if (mainWindow.__hybridUseFakeMaximize) {
    setupWindowsNcHitTestHook(mainWindow);
    setupWindowsNcActivateHook(mainWindow);
    scheduleWindowsBorderSuppression(mainWindow, 'createMainWindow');
  }
  maindbg('created BrowserWindow for mpv composition', {
    frame: false,
    transparent: useTransparentOnWindows,
    backgroundColor: useTransparentOnWindows ? '#00000000' : '#000000',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    useFakeMaximize: mainWindow.__hybridUseFakeMaximize,
  });
  logWindowDwmSnapshot(mainWindow, 'window-created', {
    config: {
      frame: false,
      transparent: useTransparentOnWindows,
      backgroundColor: useTransparentOnWindows ? '#00000000' : '#000000',
      hasShadow: true,
      titleBarStyle: 'hidden',
      titleBarOverlay: false,
      useFakeMaximize: mainWindow.__hybridUseFakeMaximize,
    },
  });

  mpvProcess = new MpvProcess();
  setupMpvIpc(mainWindow, mpvProcess);
  mpvProcess.on('stderr-log', (line) => {
    const msg = String(line || '').trim();
    if (!msg) return;
    if (/\b(error|fatal|failed|cannot|could not|denied)\b/i.test(msg)) {
      console.error('[MPV STDERR]', msg);
    }
  });
  mpvProcess.on('log-message', (payload) => {
    if (!payload) return;
    const level = String(payload.level || '').toLowerCase();
    if (!['error', 'fatal', 'warn'].includes(level)) return;
    const prefix = payload.prefix || '';
    const text = String(payload.text || '').trim();
    if (text) {
      console.error(`[MPV ${level.toUpperCase()}]`, prefix, text);
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
      if (!isDevToolsEnabled()) return;
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
    if (process.platform === 'win32' && mainWindow.__hybridUseFakeMaximize) {
      // Startup can arrive already natively-maximized (OS/session restore) without
      // reliably hitting our maximize interception path. Force-convert here.
      if (mainWindow.isMaximized() && !mainWindow.__hybridFakeMaximized) {
        convertNativeMaximizeToFake(mainWindow, 'ready-to-show');
      }
      setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (mainWindow.isMaximized() && !mainWindow.__hybridFakeMaximized) {
          convertNativeMaximizeToFake(mainWindow, 'ready-to-show+120ms');
        }
      }, 120);
    }

    mainWindow.show();
    scheduleWindowsBorderSuppression(mainWindow, 'ready-to-show');
    emitWindowVisualState(mainWindow, 'ready-to-show');
    logWindowDwmSnapshot(mainWindow, 'ready-to-show');

    // Get native window handle and spawn mpv into it
    const nativeHandle = mainWindow.getNativeWindowHandle();
    const resolvedMpvPath = resolveMpvBinary(process.resourcesPath, process.execPath, __dirname, {
      allowPathLookup: !app.isPackaged
    });
    const resolvedYtdlpPath = resolveYtDlpBinary(process.resourcesPath, process.execPath, __dirname, {
      allowPathLookup: !app.isPackaged
    });
    try {
      if (!resolvedMpvPath) {
        throw new Error('mpv binary not found');
      }
      maindbg('spawning mpv', {
        handleBytes: nativeHandle?.length || 0,
        handleHex: Buffer.isBuffer(nativeHandle) ? nativeHandle.toString('hex') : null,
        mpvPath: resolvedMpvPath,
      });
      const fastScreenshotDir = path.join(app.getPath('userData'), 'screenshots');
      mpvProcess.spawn(nativeHandle, {
        mpvPath: resolvedMpvPath,
        ytdlPath: resolvedYtdlpPath,
        hwdec: 'auto-safe',
        screenshotDir: fastScreenshotDir,
        screenshotFormat: 'jpg'
      });
      maindbg('mpv process spawned and IPC bridge ready');
    } catch (err) {
      console.error('Failed to spawn mpv:', err);
      mainWindow.webContents.send('mpv:event', 'error', {
        code: 'MPV_UNAVAILABLE',
        fatal: true,
        message: err?.message || 'Playback engine could not be started',
      });
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
    scheduleWindowsBorderSuppression(mainWindow, 'maximize');
    fsdbg('window maximize');
    logWindowDwmSnapshot(mainWindow, 'maximize');
    // Only intercept maximize when using transparent-window compositor mode on Windows.
    if (process.platform === 'win32' && mainWindow.__hybridUseFakeMaximize) {
      convertNativeMaximizeToFake(mainWindow, 'event:maximize');
      return;
    }
    mainWindow.__hybridFakeMaximized = false;
    emitWindowVisualState(mainWindow, 'maximize');
    mainWindow.webContents.send('window-state-changed', 'maximized');
  });
  mainWindow.on('unmaximize', () => {
    scheduleWindowsBorderSuppression(mainWindow, 'unmaximize');
    if (mainWindow.__hybridUseFakeMaximize) {
      if (mainWindow.__hybridSuppressNextUnmaximizeEvent) {
        mainWindow.__hybridSuppressNextUnmaximizeEvent = false;
        logWindowDwmSnapshot(mainWindow, 'unmaximize-suppressed');
        return;
      }
      mainWindow.__hybridFakeMaximized = false;
      const baseResizable = typeof mainWindow.__hybridBaseResizable === 'boolean'
        ? mainWindow.__hybridBaseResizable
        : mainWindow.isResizable();
      const previousResizable = typeof mainWindow.__hybridPrevResizable === 'boolean'
        ? mainWindow.__hybridPrevResizable
        : baseResizable;
      mainWindow.setResizable(previousResizable);
      mainWindow.__hybridPrevResizable = null;
    } else {
      mainWindow.__hybridFakeMaximized = false;
    }
    fsdbg('window unmaximize');
    logWindowDwmSnapshot(mainWindow, 'unmaximize');
    if (ENABLE_WINDOW_BOUNDS_CLAMP) {
      clampWindowToVisibleArea(mainWindow);
    }
    emitWindowVisualState(mainWindow, 'unmaximize');
    mainWindow.webContents.send('window-state-changed', 'normal');
  });
  mainWindow.on('enter-full-screen', () => {
    setResizableWhileFullscreen(mainWindow, true);
    mainWindow.__hybridFullscreenState = true;
    fsdbg('window enter-full-screen');
    logWindowDwmSnapshot(mainWindow, 'enter-full-screen');
    emitWindowVisualState(mainWindow, 'enter-full-screen');
    mainWindow.webContents.send('window-state-changed', 'fullscreen');
  });
  mainWindow.on('leave-full-screen', () => {
    setResizableWhileFullscreen(mainWindow, false);
    mainWindow.__hybridFullscreenState = false;
    let windowedRestoreApplied = false;
    // Let Windows settle the transition first, then restore windowed bounds.
    const restoreWindowed = () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (getTrackedFullscreen(mainWindow) || mainWindow.isFullScreen()) return;
      if (windowedRestoreApplied) return;
      const restoredFromSnapshot = restorePreFullscreenBounds(mainWindow, 'leave-full-screen');
      if (!restoredFromSnapshot) {
        applyWindowedSize(mainWindow);
      }
      windowedRestoreApplied = true;
      if (ENABLE_WINDOW_BOUNDS_CLAMP) {
        clampWindowToVisibleArea(mainWindow);
      }
    };
    setTimeout(restoreWindowed, FULLSCREEN_RESTORE_DELAY_MS);
    setTimeout(restoreWindowed, FULLSCREEN_RESTORE_DELAY_MS + 180);
    fsdbg('window leave-full-screen');
    logWindowDwmSnapshot(mainWindow, 'leave-full-screen');
    emitWindowVisualState(mainWindow, 'leave-full-screen');
    mainWindow.webContents.send('window-state-changed', 'normal');
  });
  mainWindow.on('focus', () => {
    if (process.platform === 'win32' && mainWindow.__hybridUseFakeMaximize) {
      // Guardrail: if Windows re-enters native maximize, push it back to fake maximize.
      if (mainWindow.isMaximized() && !mainWindow.__hybridFakeMaximized) {
        convertNativeMaximizeToFake(mainWindow, 'focus-native-maximized');
      }
    }
    scheduleWindowsBorderSuppression(mainWindow, 'focus');
    fsdbg('window focus');
    logWindowDwmSnapshot(mainWindow, 'focus');
    scheduleBlurProbe(mainWindow, 'focus-probe');
  });
  mainWindow.on('blur', () => {
    scheduleWindowsBorderSuppression(mainWindow, 'blur');
    fsdbg('window blur');
    logWindowDwmSnapshot(mainWindow, 'blur');
    scheduleBlurProbe(mainWindow, 'blur-probe');
  });
  mainWindow.on('move', () => {
    logWindowDwmSnapshotThrottled(mainWindow, 'move');
    if (ENABLE_WINDOW_BOUNDS_CLAMP) {
      clampWindowToVisibleArea(mainWindow);
    }
  });
  mainWindow.on('resize', () => {
    logWindowDwmSnapshotThrottled(mainWindow, 'resize');
  });

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

function isPathInside(childPath, parentPath) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function getLocalFileProtocolRoots() {
  return [
    path.join(app.getPath('userData'), 'screenshots'),
    path.join(app.getPath('temp'), 'hybrid-player-thumbs'),
    path.join(app.getPath('temp'), 'hybrid-player-paused-frames'),
    path.join(__dirname, '../../assets'),
  ];
}

function resolveLocalFileProtocolPath(url) {
  let rawPath = '';
  try {
    const parsed = new URL(url);
    rawPath = decodeURIComponent(`${parsed.host || ''}${parsed.pathname || ''}`);
  } catch {
    rawPath = decodeURIComponent(String(url || '').replace(/^local-file:\/\//i, ''));
  }

  if (process.platform === 'win32') {
    rawPath = rawPath.replace(/^\/([a-zA-Z]:)/, '$1');
  }

  const filePath = path.resolve(rawPath);
  const allowedRoots = getLocalFileProtocolRoots();

  if (!allowedRoots.some((root) => isPathInside(filePath, root))) {
    return null;
  }

  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() ? filePath : null;
  } catch {
    return null;
  }
}

// Initialize
app.whenReady().then(() => {
  // Register custom protocol for local files
  protocol.handle('local-file', (request) => {
    const filePath = resolveLocalFileProtocolPath(request.url);
    if (!filePath) {
      return new Response('Not found', { status: 404 });
    }
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
      // Open a trusted local media file from argv if provided.
      const filePath = argv
        .map((arg) => resolveExistingLocalFile(arg, MEDIA_EXTENSIONS))
        .find(Boolean);
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
