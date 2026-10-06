/**
 * Hybrid Player - IPC Handlers
 * Secure IPC communication between main and renderer
 */

const { app, dialog, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { scheduleNativeDwmWindowStyles } = require('./native-dwm');
const DWM_DIAG_LOG = false;
const DWM_DIAG_ECHO_CONSOLE = false;
const dwmPatchLastAt = new Map();
const dwmPatchInFlight = new Set();
const TITLEBAR_DRAG_VERTICAL_OFFSET = 14;
const TITLEBAR_DRAG_MIN_VISIBLE_HEIGHT = 80;
const MIN_RESTORE_WIDTH = 800;
const MIN_RESTORE_HEIGHT = 500;
const MAX_DEBUG_PAYLOAD_BYTES = 8 * 1024;
const MAX_DEBUG_LOG_BYTES = 1024 * 1024;
const MAX_DEBUG_LOG_RETAIN_BYTES = 384 * 1024;
const MAX_DEBUG_TAIL_BYTES = 256 * 1024;
const MAX_DEBUG_TAIL_LINES = 1000;
const MEMORY_MAP_LIMIT = 1000;
const SUBTITLE_DELAY_MIN_MS = -10 * 60 * 1000;
const SUBTITLE_DELAY_MAX_MS = 10 * 60 * 1000;

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

const INVALID_PREF = Symbol('invalid-pref');
const WELCOME_BACKGROUNDS = new Set(['none', 'dither', 'particles', 'faulty', 'gridmotion']);
const WELCOME_QUALITIES = new Set(['low', 'medium', 'high', 'custom']);
const MOTION_PROFILES = new Set(['reduced', 'balanced', 'showcase']);
const THEMES = new Set(['dark', 'oled', 'light']);
const EQ_PRESETS = new Set([
  'flat',
  'bass-boost',
  'treble-boost',
  'vocal',
  'rock',
  'pop',
  'jazz',
  'classical',
  'electronic',
  'custom',
]);
const BG_OPTION_PREFS = new Set([
  'bgOpts_dither',
  'bgOpts_particles',
  'bgOpts_faulty',
  'bgOpts_gridmotion',
]);

function normalizeString(value, { max = 4096, trim = true } = {}) {
  if (typeof value !== 'string') return null;
  const text = trim ? value.trim() : value;
  if (!text || text.length > max) return null;
  return text;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isHexColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function clampNumber(value, min, max, fallback = min) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function sanitizeEqualizerBands(value) {
  if (!Array.isArray(value)) return INVALID_PREF;
  return value.slice(0, 10).map((band) => clampNumber(band, -12, 12, 0));
}

function sanitizeBackgroundOptions(value, key) {
  if (typeof value === 'string') {
    const maxLength = key === 'bgOpts_gridmotion' ? 10 * 1024 * 1024 : 8192;
    if (value.length > maxLength) return INVALID_PREF;
    try {
      const parsed = JSON.parse(value);
      if (!isPlainObject(parsed)) return INVALID_PREF;
      return JSON.stringify(parsed);
    } catch {
      return INVALID_PREF;
    }
  }

  if (isPlainObject(value)) {
    return JSON.stringify(value);
  }

  return INVALID_PREF;
}

function sanitizePreference(key, value) {
  const prefKey = normalizeString(key, { max: 80 });
  if (!prefKey) return INVALID_PREF;

  if (BG_OPTION_PREFS.has(prefKey)) {
    return sanitizeBackgroundOptions(value, prefKey);
  }

  switch (prefKey) {
    case 'theme':
      return THEMES.has(value) ? value : INVALID_PREF;
    case 'accentColor':
      return isHexColor(value) ? value : INVALID_PREF;
    case 'autoResume':
    case 'brandFontEnabled':
    case 'autoOrganizeScreenshots':
    case 'doubleClickFullscreen':
      return !!value;
    case 'volume':
      return clampNumber(value, 0, 1, 1);
    case 'equalizerPreset':
      return EQ_PRESETS.has(value) ? value : INVALID_PREF;
    case 'equalizerBands':
      return sanitizeEqualizerBands(value);
    case 'motionProfile':
      return MOTION_PROFILES.has(value) ? value : INVALID_PREF;
    case 'welcomeBackground':
      return WELCOME_BACKGROUNDS.has(value) ? value : INVALID_PREF;
    case 'welcomeQuality':
      return WELCOME_QUALITIES.has(value) ? value : INVALID_PREF;
    case 'screenshotDir':
      if (typeof value !== 'string') return INVALID_PREF;
      return normalizeString(value, { max: 4096, trim: true }) || '';
    case 'screenshotFormat':
      return ['jpg', 'jpeg', 'png', 'webp'].includes(String(value).toLowerCase()) ? (String(value).toLowerCase() === 'jpeg' ? 'jpg' : String(value).toLowerCase()) : INVALID_PREF;
    case 'seekStep':
      return [1, 5, 10].includes(Number(value)) ? Number(value) : INVALID_PREF;
    default:
      return INVALID_PREF;
  }
}

function sanitizePreferencePatch(prefs) {
  if (!isPlainObject(prefs)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(prefs)) {
    const sanitized = sanitizePreference(key, value);
    if (sanitized !== INVALID_PREF) {
      clean[key] = sanitized;
    }
  }
  return clean;
}

function sanitizeMediaKey(value) {
  return normalizeString(value, { max: 4096 });
}

function setBoundedMemoryValue(map, key, value, limit = MEMORY_MAP_LIMIT) {
  if (!map || typeof map !== 'object' || !key) return;
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    delete map[key];
  }
  map[key] = value;

  const keys = Object.keys(map);
  const overflow = keys.length - limit;
  if (overflow > 0) {
    keys.slice(0, overflow).forEach((oldKey) => {
      delete map[oldKey];
    });
  }
}

function sanitizeHistoryEntry(entry) {
  if (!isPlainObject(entry)) return null;
  const mediaPath = sanitizeMediaKey(entry.path);
  if (!mediaPath) return null;
  const fallbackName = path.basename(mediaPath) || 'Untitled';
  const name = normalizeString(entry.name, { max: 260 }) || fallbackName;
  return {
    path: mediaPath,
    name,
    duration: clampNumber(entry.duration, 0, 30 * 24 * 60 * 60, 0),
  };
}

async function isAvailableHistoryEntryAsync(entry) {
  const mediaPath = sanitizeMediaKey(entry?.path);
  if (!mediaPath) return false;
  if (/^(?:https?|rtsp|rtmp|rtmps|srt):\/\//i.test(mediaPath)) return true;
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, 250);

    fs.promises.stat(mediaPath)
      .then((stat) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(stat.isFile());
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(false);
        }
      });
  });
}

function sanitizePlaylist(playlist) {
  if (!isPlainObject(playlist)) return null;
  const id = normalizeString(playlist.id, { max: 128 }) || Date.now().toString(36);
  const name = normalizeString(playlist.name, { max: 200 }) || 'Untitled Playlist';
  const items = Array.isArray(playlist.items)
    ? playlist.items.slice(0, 1000).map((item) => {
        if (!isPlainObject(item)) return null;
        const itemPath = sanitizeMediaKey(item.path);
        if (!itemPath) return null;
        return {
          path: itemPath,
          name: normalizeString(item.name, { max: 260 }) || path.basename(itemPath) || 'Untitled',
        };
      }).filter(Boolean)
    : [];

  return {
    id,
    name,
    items,
    created: clampNumber(playlist.created, 0, Date.now(), Date.now()),
  };
}

function normalizeScreenPoint(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const x = Math.round(toFiniteNumber(payload.screenX, NaN));
  const y = Math.round(toFiniteNumber(payload.screenY, NaN));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function sanitizeHitTestExclusions(rects) {
  if (!Array.isArray(rects)) return [];
  return rects
    .map((rect) => {
      if (!rect || typeof rect !== 'object') return null;
      const x = Math.round(toFiniteNumber(rect.x, NaN));
      const y = Math.round(toFiniteNumber(rect.y, NaN));
      const width = Math.round(toFiniteNumber(rect.width, NaN));
      const height = Math.round(toFiniteNumber(rect.height, NaN));
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
      }
      if (width <= 0 || height <= 0) return null;
      return { x, y, width, height };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function normalizeWindowBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') return null;
  const x = Math.round(toFiniteNumber(bounds.x, NaN));
  const y = Math.round(toFiniteNumber(bounds.y, NaN));
  const width = Math.round(toFiniteNumber(bounds.width, NaN));
  const height = Math.round(toFiniteNumber(bounds.height, NaN));
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function capturePreFullscreenBounds(win, source = 'ipc') {
  if (!win || win.isDestroyed()) return;
  const fullscreen = typeof win.__hybridFullscreenState === 'boolean'
    ? win.__hybridFullscreenState
    : win.isFullScreen();
  if (fullscreen || win.isFullScreen()) return;

  win.__hybridPreFullscreenMaximized = isWindowMaximized(win);

  const bounds = normalizeWindowBounds(win.getBounds());
  if (!bounds) return;
  win.__hybridPreFullscreenBounds = bounds;
  logWindowIpcState(win, 'capture-pre-fullscreen-bounds', {
    source,
    bounds,
    maximized: win.__hybridPreFullscreenMaximized,
  });
}

function getWorkAreaForWindow(win) {
  const bounds = win.getBounds();
  const centerPoint = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
  const display = screen.getDisplayNearestPoint(centerPoint);
  const workArea = display?.workArea || screen.getPrimaryDisplay().workArea;
  const scaleFactor = Number(display?.scaleFactor || 1);
  // Match main-process fake maximize: keep the top edge on-screen so
  // custom titlebar controls stay visible in non-fullscreen mode.
  const seamTopInset = 0;
  const seamSideInset = Math.max(0, Math.ceil(scaleFactor * 0));
  return {
    x: workArea.x - seamSideInset,
    y: workArea.y - seamTopInset,
    width: workArea.width + seamSideInset * 2,
    // Keep bottom aligned with taskbar.
    height: workArea.height + seamTopInset,
  };
}

function isWindowMaximized(win) {
  if (!win || win.isDestroyed()) return false;
  if (win.__hybridFakeMaximized || win.isMaximized()) return true;
  try {
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    if (display && display.workArea) {
      const wa = display.workArea;
      return (
        bounds.x <= wa.x + 8 &&
        bounds.y <= wa.y + 8 &&
        bounds.x + bounds.width >= wa.x + wa.width - 8 &&
        bounds.y + bounds.height >= wa.y + wa.height - 8
      );
    }
  } catch {
    // Ignore bounds error
  }
  return false;
}

function emitWindowMaximizedState(win, maximized) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('window-is-maximized', !!maximized);
  win.webContents.send('window-state-changed', maximized ? 'maximized' : 'normal');
}

function setResizableForFakeMaximize(win, maximized) {
  if (!win || win.isDestroyed()) return;
  const baseResizable = typeof win.__hybridBaseResizable === 'boolean'
    ? win.__hybridBaseResizable
    : win.isResizable();
  if (maximized) {
    if (typeof win.__hybridPrevResizable !== 'boolean') {
      win.__hybridPrevResizable = win.isResizable();
    }
    if (win.isResizable()) {
      win.setResizable(false);
    }
    return;
  }

  const previous = typeof win.__hybridPrevResizable === 'boolean'
    ? win.__hybridPrevResizable
    : baseResizable;
  win.setResizable(previous);
  win.__hybridPrevResizable = null;
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

function suppressWindowsNonClientBorder(win, source = 'ipc') {
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
    appendDebugLog('dwm-main-ipc', { source: `suppressBorder:${source}`, ts: Date.now() });
  } catch (error) {
    appendDebugLog('dwm-main-ipc', {
      source: `suppressBorder:${source}:error`,
      ts: Date.now(),
      error: error?.message || String(error),
    });
  }
}

function applyFakeMaximize(win) {
  if (!win || win.isDestroyed()) return false;
  logWindowIpcState(win, 'applyFakeMaximize:start');

  if (win.isMaximized()) {
    win.setResizable(true);
    win.unmaximize();
  }
  if (win.isMinimized()) {
    win.restore();
  }

  if (!win.__hybridFakeMaximized) {
    win.__hybridRestoreBounds = typeof win.getNormalBounds === 'function'
      ? win.getNormalBounds()
      : win.getBounds();
  }

  const workArea = getWorkAreaForWindow(win);
  win.setBounds(workArea, false);
  win.__hybridFakeMaximized = true;
  setResizableForFakeMaximize(win, true);
  suppressWindowsNonClientBorder(win, 'applyFakeMaximize');
  logWindowIpcState(win, 'applyFakeMaximize:end', { appliedBounds: workArea });
  emitWindowMaximizedState(win, true);
  return true;
}

function restoreFromMaximized(win) {
  if (!win || win.isDestroyed()) return false;
  logWindowIpcState(win, 'restoreFromMaximized:start');

  const wasNativeMaximized = win.isMaximized();
  if (wasNativeMaximized) {
    win.setResizable(true);
    win.unmaximize();
  }

  const restoreBounds = win.__hybridRestoreBounds;
  if (win.__hybridFakeMaximized && restoreBounds) {
    win.setBounds(restoreBounds, false);
  }

  win.__hybridFakeMaximized = false;
  win.__hybridRestoreBounds = null;
  setResizableForFakeMaximize(win, false);
  suppressWindowsNonClientBorder(win, 'restoreFromMaximized');
  logWindowIpcState(win, 'restoreFromMaximized:end');
  emitWindowMaximizedState(win, false);
  return false;
}

function getRestoreBoundsForTitlebarDrag(win, display) {
  const workArea = display?.workArea || screen.getPrimaryDisplay().workArea;
  const source = win.__hybridRestoreBounds || (typeof win.getNormalBounds === 'function' ? win.getNormalBounds() : null);
  if (source && Number.isFinite(source.width) && Number.isFinite(source.height) && source.width > 0 && source.height > 0) {
    return {
      width: clamp(Math.round(source.width), MIN_RESTORE_WIDTH, workArea.width),
      height: clamp(Math.round(source.height), MIN_RESTORE_HEIGHT, workArea.height),
    };
  }

  return {
    width: clamp(Math.round(workArea.width * 0.72), MIN_RESTORE_WIDTH, workArea.width),
    height: clamp(Math.round(workArea.height * 0.72), MIN_RESTORE_HEIGHT, workArea.height),
  };
}

function applyDraggedWindowBounds(win, desiredBounds, display) {
  const workArea = display?.workArea || screen.getPrimaryDisplay().workArea;
  const width = clamp(Math.round(desiredBounds.width), MIN_RESTORE_WIDTH, workArea.width);
  const height = clamp(Math.round(desiredBounds.height), MIN_RESTORE_HEIGHT, workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - Math.min(height, TITLEBAR_DRAG_MIN_VISIBLE_HEIGHT);
  const x = clamp(Math.round(desiredBounds.x), workArea.x, maxX);
  const y = clamp(Math.round(desiredBounds.y), workArea.y, maxY);
  const nextBounds = { x, y, width, height };
  win.setBounds(nextBounds, false);
  return nextBounds;
}

function beginTitlebarDragSession(win, payload) {
  if (!win || win.isDestroyed() || win.isMinimized()) {
    return { handled: false, reason: 'window-unavailable' };
  }

  const pointer = normalizeScreenPoint(payload);
  if (!pointer) {
    return { handled: false, reason: 'invalid-pointer' };
  }

  const fullscreen = typeof win.__hybridFullscreenState === 'boolean'
    ? win.__hybridFullscreenState
    : win.isFullScreen();
  if (fullscreen || win.isFullScreen()) {
    return { handled: false, reason: 'fullscreen' };
  }

  if (!isWindowMaximized(win)) {
    win.__hybridTitlebarDragSession = null;
    return { handled: false, reason: 'not-maximized' };
  }

  const display = screen.getDisplayNearestPoint(pointer) || screen.getPrimaryDisplay();
  const displayBounds = display?.bounds || screen.getPrimaryDisplay().bounds;
  const restoreSize = getRestoreBoundsForTitlebarDrag(win, display);
  const cursorRatioX = clamp(
    (pointer.x - displayBounds.x) / Math.max(1, displayBounds.width),
    0,
    1
  );

  if (win.isMaximized()) {
    win.unmaximize();
  }
  win.__hybridFakeMaximized = false;
  setResizableForFakeMaximize(win, false);
  emitWindowMaximizedState(win, false);

  const restoredBounds = applyDraggedWindowBounds(
    win,
    {
      x: Math.round(pointer.x - restoreSize.width * cursorRatioX),
      y: Math.round(pointer.y - TITLEBAR_DRAG_VERTICAL_OFFSET),
      width: restoreSize.width,
      height: restoreSize.height,
    },
    display
  );

  const offsetX = clamp(pointer.x - restoredBounds.x, 0, restoredBounds.width - 1);
  const offsetY = clamp(pointer.y - restoredBounds.y, 0, restoredBounds.height - 1);

  win.__hybridRestoreBounds = { ...restoredBounds };
  win.__hybridTitlebarDragSession = {
    active: true,
    width: restoredBounds.width,
    height: restoredBounds.height,
    offsetX,
    offsetY,
  };

  logWindowIpcState(win, 'titlebar-drag-start', {
    pointer,
    cursorRatioX,
    restoredBounds,
    displayId: display?.id || null,
    displayBounds,
    workArea: display?.workArea || null,
  });

  return {
    handled: true,
    cursorRatioX,
    bounds: restoredBounds,
    displayId: display?.id || null,
  };
}

function moveTitlebarDragSession(win, payload) {
  if (!win || win.isDestroyed()) return false;
  const session = win.__hybridTitlebarDragSession;
  if (!session || !session.active) return false;

  const pointer = normalizeScreenPoint(payload);
  if (!pointer) return false;

  const display = screen.getDisplayNearestPoint(pointer) || screen.getPrimaryDisplay();
  const movedBounds = applyDraggedWindowBounds(
    win,
    {
      x: pointer.x - session.offsetX,
      y: pointer.y - session.offsetY,
      width: session.width,
      height: session.height,
    },
    display
  );

  win.__hybridRestoreBounds = { ...movedBounds };
  return true;
}

function endTitlebarDragSession(win) {
  if (!win || win.isDestroyed()) return false;
  const session = win.__hybridTitlebarDragSession;
  if (!session || !session.active) {
    win.__hybridTitlebarDragSession = null;
    return false;
  }

  win.__hybridTitlebarDragSession = null;
  logWindowIpcState(win, 'titlebar-drag-end', {
    bounds: win.getBounds(),
  });
  return true;
}

function toggleFakeMaximize(win) {
  if (isWindowMaximized(win)) {
    return restoreFromMaximized(win);
  }
  return applyFakeMaximize(win);
}

function toggleNativeMaximize(win) {
  if (!win || win.isDestroyed()) return false;
  
  // Temporarily set resizable to true so maximize/unmaximize always work
  win.setResizable(true);

  if (win.isMaximized()) {
    win.unmaximize();
    
    // Explicitly set restore bounds to force the window out of maximized state
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const area = display?.workArea || screen.getPrimaryDisplay().workArea;

    let targetBounds = null;
    try {
      const normal = typeof win.getNormalBounds === 'function' ? win.getNormalBounds() : null;
      if (normal && normal.width > 0 && normal.height > 0) {
        // Ensure the restored bounds are actually smaller than the maximized screen size
        if (normal.width < area.width || normal.height < area.height) {
          targetBounds = normal;
        }
      }
    } catch (e) {
      // Ignore
    }

    if (!targetBounds) {
      const width = 1280;
      const height = 720;
      const x = area.x + Math.round((area.width - width) / 2);
      const y = area.y + Math.round((area.height - height) / 2);
      targetBounds = { x, y, width, height };
    }

    win.setBounds(targetBounds, false);
  } else {
    win.maximize();
  }
  if (process.platform === 'win32') {
    scheduleNativeDwmWindowStyles(win, [0, 80, 200, 350]);
  }
  return win.isMaximized();
}

function toggleWindowMaximize(win) {
  if (!win || win.isDestroyed()) return false;
  const isFs = typeof win.__hybridFullscreenState === 'boolean'
    ? win.__hybridFullscreenState
    : win.isFullScreen();
  if (isFs || win.isFullScreen()) {
    win.setFullScreen(false);
    if (process.platform === 'win32') {
      scheduleNativeDwmWindowStyles(win, [0, 80, 200, 350]);
    }
    return isWindowMaximized(win);
  }
  if (win.__hybridUseFakeMaximize) {
    return toggleFakeMaximize(win);
  }
  return toggleNativeMaximize(win);
}

function getDebugLogFilePath() {
  const logDir = path.join(app.getPath('userData'), 'logs');
  return {
    logDir,
    logFile: path.join(logDir, 'hybrid-renderer-debug.log'),
  };
}

function normalizeScope(scope) {
  const value = String(scope || 'renderer').trim();
  if (!value) return 'renderer';
  return value.replace(/[^a-z0-9:_-]/gi, '').slice(0, 42) || 'renderer';
}

function truncateDebugString(value, maxBytes = MAX_DEBUG_PAYLOAD_BYTES) {
  const text = String(value || '');
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  return `${Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8')}...[truncated]`;
}

function formatDebugPayload(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return truncateDebugString(payload);
  try {
    return truncateDebugString(JSON.stringify(payload));
  } catch {
    return truncateDebugString(payload);
  }
}

function readFileTail(filePath, maxBytes) {
  const stat = fs.statSync(filePath);
  const bytesToRead = Math.min(Math.max(1, maxBytes), stat.size);
  const buffer = Buffer.alloc(bytesToRead);
  const start = Math.max(0, stat.size - bytesToRead);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, buffer, 0, bytesToRead, start);
  } finally {
    fs.closeSync(fd);
  }
  return buffer.toString('utf8');
}

function trimDebugLogIfNeeded(logFile) {
  if (!fs.existsSync(logFile)) return;
  const stat = fs.statSync(logFile);
  if (stat.size <= MAX_DEBUG_LOG_BYTES) return;
  const tail = readFileTail(logFile, MAX_DEBUG_LOG_RETAIN_BYTES);
  fs.writeFileSync(logFile, tail.replace(/^[^\n]*\n?/, ''), 'utf8');
}

function appendDebugLog(scope, payload) {
  const safeScope = normalizeScope(scope);
  if (!DWM_DIAG_LOG && safeScope.startsWith('dwm-')) {
    return getDebugLogFilePath().logFile;
  }
  const message = formatDebugPayload(payload);
  const line = `${new Date().toISOString()} [${safeScope}] ${message}\n`;
  const { logDir, logFile } = getDebugLogFilePath();
  fs.mkdirSync(logDir, { recursive: true });
  trimDebugLogIfNeeded(logFile);
  fs.appendFileSync(logFile, line, 'utf8');
  if (DWM_DIAG_ECHO_CONSOLE && safeScope.startsWith('dwm-')) {
    console.log(`[DWMDBG][ipc][${safeScope}]`, message);
  }
  return logFile;
}

function tailDebugLog(maxLines = 120) {
  const { logFile } = getDebugLogFilePath();
  if (!fs.existsSync(logFile)) return '';
  const text = readFileTail(logFile, MAX_DEBUG_TAIL_BYTES);
  const lines = text.split(/\r?\n/);
  const safeMaxLines = Math.round(clampNumber(maxLines, 1, MAX_DEBUG_TAIL_LINES, 120));
  return lines.slice(-safeMaxLines).join('\n');
}

function logWindowIpcState(win, source, extra = {}) {
  if (!DWM_DIAG_LOG) return;
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const centerPoint = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
  const display = screen.getDisplayNearestPoint(centerPoint);
  appendDebugLog('dwm-main-ipc', {
    source,
    ts: Date.now(),
    focused: win.isFocused(),
    minimized: win.isMinimized(),
    nativeMaximized: win.isMaximized(),
    fakeMaximized: !!win.__hybridFakeMaximized,
    fullscreen: win.isFullScreen(),
    bounds,
    restoreBounds: win.__hybridRestoreBounds || null,
    workArea: display?.workArea || null,
    displayBounds: display?.bounds || null,
    ...extra,
  });
}

function setupIpcHandlers(ipcMain, win, db, saveDatabase) {
  win.__hybridFakeMaximized = false;
  win.__hybridRestoreBounds = null;
  win.__hybridPrevResizable = null;
  win.__hybridBaseResizable = win.isResizable();
  win.__hybridTitlebarDragSession = null;
  win.__hybridNcHitTestExclusions = [];
  win.__hybridUseFakeMaximize = !!win.__hybridUseFakeMaximize;

  // ─── Window Controls ───────────────────────────────────
  ipcMain.handle('window:minimize', () => win.minimize());
  ipcMain.handle('toggle-maximize', () => toggleWindowMaximize(win));
  ipcMain.handle('window:maximize', () => toggleWindowMaximize(win));
  ipcMain.handle('window:close', () => {
    try {
      saveDatabase(db, { immediate: true });
    } catch {}
    win.close();
  });
  ipcMain.handle('window:titlebar-drag-start', (_, payload) => beginTitlebarDragSession(win, payload));
  ipcMain.handle('window:titlebar-drag-move', (_, payload) => moveTitlebarDragSession(win, payload));
  ipcMain.handle('window:titlebar-drag-end', () => endTitlebarDragSession(win));
  ipcMain.handle('window:set-hit-test-exclusions', (_, rects) => {
    win.__hybridNcHitTestExclusions = sanitizeHitTestExclusions(rects);
    return true;
  });
  ipcMain.handle('window:fullscreen', (_, state) => {
    logWindowIpcState(win, 'window:fullscreen:request', { requestedState: state });
    const now = Date.now();
    const lockUntil = win.__hybridFullscreenTransitionUntil || 0;
    const current = typeof win.__hybridFullscreenState === 'boolean'
      ? win.__hybridFullscreenState
      : win.isFullScreen();
    if (now < lockUntil) {
      logWindowIpcState(win, 'window:fullscreen:skipped', { current });
      return current;
    }
    const target = typeof state === 'boolean' ? state : !current;
    if (target) {
      capturePreFullscreenBounds(win, 'window:fullscreen');
      win.__hybridFakeMaximized = false;
      win.__hybridRestoreBounds = null;
    }
    win.__hybridFullscreenTransitionUntil = now + 400;
    win.__hybridFullscreenState = !!target;
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send('window-fullscreen-transition-start', !!target);
    }
    win.setFullScreen(target);
    if (process.platform === 'win32') {
      scheduleNativeDwmWindowStyles(win, [0, 80, 200, 350]);
    }
    logWindowIpcState(win, 'window:fullscreen:applied', { target });
    return target;
  });
  ipcMain.handle('window:isFullScreen', () => {
    if (typeof win.__hybridFullscreenState === 'boolean') {
      return win.__hybridFullscreenState;
    }
    return win.isFullScreen();
  });
  ipcMain.handle('window:set-ui-locked', (_, state) => {
    win.__hybridUiLocked = !!state;
    return win.__hybridUiLocked;
  });
  ipcMain.handle('window:set-prevent-exit-fullscreen', (_, state) => {
    win.__hybridPreventExitFullscreen = !!state;
    return win.__hybridPreventExitFullscreen;
  });
  ipcMain.handle('window:isMaximized', () => isWindowMaximized(win));

  // ─── File Operations ───────────────────────────────────
  ipcMain.handle('dialog:openSubtitle', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Load Subtitle File',
      properties: ['openFile'],
      filters: [
        { name: 'Subtitle Files', extensions: ['srt', 'vtt', 'ass', 'ssa', 'sub', 'idx', 'sup'] }
      ]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('db:getPreference', async (_, key) => {
    const prefKey = normalizeString(key, { max: 80 });
    return prefKey ? db.preferences[prefKey] : undefined;
  });

  ipcMain.handle('db:setPreference', async (_, key, value) => {
    const prefKey = normalizeString(key, { max: 80 });
    const sanitized = sanitizePreference(prefKey, value);
    if (!prefKey || sanitized === INVALID_PREF) return false;
    db.preferences[prefKey] = sanitized;
    saveDatabase(db);
    return true;
  });

  ipcMain.handle('db:getAllPreferences', async () => {
    return db.preferences;
  });

  ipcMain.handle('db:saveAllPreferences', async (_, prefs) => {
    const cleanPrefs = sanitizePreferencePatch(prefs);
    db.preferences = { ...db.preferences, ...cleanPrefs };
    saveDatabase(db);
    return true;
  });

  // ─── History & Resume ──────────────────────────────────
  ipcMain.handle('history:add', async (_, entry) => {
    // entry: { path, name, duration, timestamp }
    const cleanEntry = sanitizeHistoryEntry(entry);
    if (!cleanEntry) return false;
    db.history = db.history.filter(h => h.path !== cleanEntry.path);
    db.history.unshift({ ...cleanEntry, timestamp: Date.now() });
    if (db.history.length > 200) db.history = db.history.slice(0, 200);
    // Also update recent files
    db.recentFiles = db.recentFiles.filter(r => r !== cleanEntry.path);
    db.recentFiles.unshift(cleanEntry.path);
    if (db.recentFiles.length > 50) db.recentFiles = db.recentFiles.slice(0, 50);
    saveDatabase(db);
    return true;
  });

  ipcMain.handle('history:getRecent', async (_, count) => {
    const limit = Math.round(clampNumber(count || 20, 1, 100, 20));
    const historyChecks = await Promise.all(
      db.history.map(async (entry) => ({
        entry,
        available: await isAvailableHistoryEntryAsync(entry),
      }))
    );
    const availableHistory = historyChecks.filter((item) => item.available).map((item) => item.entry);
    if (availableHistory.length !== db.history.length) {
      db.history = availableHistory;
      const recentChecks = await Promise.all(
        db.recentFiles.map(async (mediaPath) => ({
          mediaPath,
          available: await isAvailableHistoryEntryAsync({ path: mediaPath }),
        }))
      );
      db.recentFiles = recentChecks.filter((item) => item.available).map((item) => item.mediaPath);
      try {
        saveDatabase(db);
      } catch (error) {
        console.warn('Failed to persist recently played cleanup:', error);
      }
    }
    return db.history.slice(0, limit);
  });

  ipcMain.handle('resume:save', async (_, filePath, time, options = {}) => {
    const mediaPath = sanitizeMediaKey(filePath);
    if (!mediaPath) return false;
    setBoundedMemoryValue(
      db.resumePositions,
      mediaPath,
      clampNumber(time, 0, 30 * 24 * 60 * 60, 0)
    );
    saveDatabase(db, options?.immediate ? { immediate: true } : undefined);
    return true;
  });

  ipcMain.handle('resume:get', async (_, filePath) => {
    const mediaPath = sanitizeMediaKey(filePath);
    return mediaPath ? db.resumePositions[mediaPath] || 0 : 0;
  });

  ipcMain.handle('resume:clear', async (_, filePath) => {
    const mediaPath = sanitizeMediaKey(filePath);
    if (!mediaPath) return false;
    if (Object.prototype.hasOwnProperty.call(db.resumePositions, mediaPath)) {
      delete db.resumePositions[mediaPath];
      saveDatabase(db);
    }
    return true;
  });

  // ─── Speed Memory ──────────────────────────────────────
  ipcMain.handle('speed:save', async (_, filePath, speed) => {
    const mediaPath = sanitizeMediaKey(filePath);
    if (!mediaPath) return false;
    setBoundedMemoryValue(db.speedMemory, mediaPath, clampNumber(speed, 0.1, 4, 1));
    saveDatabase(db);
    return true;
  });

  ipcMain.handle('speed:get', async (_, filePath) => {
    const mediaPath = sanitizeMediaKey(filePath);
    return mediaPath ? db.speedMemory[mediaPath] || null : null;
  });

  // ─── Subtitle Delay Memory ────────────────────────────
  ipcMain.handle('subtitleDelay:save', async (_, filePath, delay) => {
    const mediaPath = sanitizeMediaKey(filePath);
    if (!mediaPath) return false;
    setBoundedMemoryValue(
      db.subtitleDelayMemory,
      mediaPath,
      clampNumber(delay, SUBTITLE_DELAY_MIN_MS, SUBTITLE_DELAY_MAX_MS, 0)
    );
    saveDatabase(db);
    return true;
  });

  ipcMain.handle('subtitleDelay:get', async (_, filePath) => {
    const mediaPath = sanitizeMediaKey(filePath);
    return mediaPath ? db.subtitleDelayMemory[mediaPath] || 0 : 0;
  });

  // ─── Playlists ─────────────────────────────────────────
  ipcMain.handle('playlist:getAll', async () => db.playlists);
  ipcMain.handle('playlist:save', async (_, playlist) => {
    const cleanPlaylist = sanitizePlaylist(playlist);
    if (!cleanPlaylist) return false;
    const idx = db.playlists.findIndex(p => p.id === cleanPlaylist.id);
    if (idx >= 0) db.playlists[idx] = cleanPlaylist;
    else db.playlists.push(cleanPlaylist);
    saveDatabase(db);
    return true;
  });

  // ─── Debug Logging ─────────────────────────────────────
  ipcMain.handle('debug:append-log', async (_, scope, payload) => {
    return appendDebugLog(scope, payload);
  });

  ipcMain.handle('debug:get-log-file-path', async () => {
    return getDebugLogFilePath().logFile;
  });

  ipcMain.handle('debug:tail-log', async (_, lines) => {
    const maxLines = Number.isFinite(Number(lines)) ? Number(lines) : 120;
    return tailDebugLog(maxLines);
  });
}

module.exports = { setupIpcHandlers };
