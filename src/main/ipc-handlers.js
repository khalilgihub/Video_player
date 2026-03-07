/**
 * Hybrid Player - IPC Handlers
 * Secure IPC communication between main and renderer
 */

const { app, dialog, screen } = require('electron');
const fs = require('fs');
const path = require('path');

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

function formatDebugPayload(payload) {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function appendDebugLog(scope, payload) {
  const safeScope = normalizeScope(scope);
  const message = formatDebugPayload(payload);
  const line = `${new Date().toISOString()} [${safeScope}] ${message}\n`;
  const { logDir, logFile } = getDebugLogFilePath();
  fs.mkdirSync(logDir, { recursive: true });
  fs.appendFileSync(logFile, line, 'utf8');
  return logFile;
}

function tailDebugLog(maxLines = 120) {
  const { logFile } = getDebugLogFilePath();
  if (!fs.existsSync(logFile)) return '';
  const text = fs.readFileSync(logFile, 'utf8');
  const lines = text.split(/\r?\n/);
  return lines.slice(-Math.max(1, maxLines)).join('\n');
}

function clampWindowBoundsToDisplay(bounds, point) {
  const display = screen.getDisplayNearestPoint({
    x: Math.round(point.x),
    y: Math.round(point.y),
  });
  const area = display?.workArea || screen.getPrimaryDisplay().workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  const maxX = area.x + Math.max(0, area.width - width);
  const maxY = area.y + Math.max(0, area.height - height);
  const x = Math.min(Math.max(bounds.x, area.x), maxX);
  const y = Math.min(Math.max(bounds.y, area.y), maxY);
  return { x, y, width, height };
}

function setupIpcHandlers(ipcMain, win, db, saveDatabase) {

  // ─── Window Controls ───────────────────────────────────
  ipcMain.handle('window:minimize', () => win.minimize());
  ipcMain.handle('window:maximize', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  ipcMain.handle('window:close', () => win.close());
  ipcMain.handle('window:fullscreen', (_, state) => {
    const current = typeof win.__hybridFullscreenState === 'boolean'
      ? win.__hybridFullscreenState
      : win.isFullScreen();
    const target = typeof state === 'boolean' ? state : !current;
    win.__hybridFullscreenState = !!target;
    win.setFullScreen(target);
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
  ipcMain.handle('window:isMaximized', () => win.isMaximized());

  // Native-like "drag down to restore" support for custom titlebars.
  ipcMain.handle('window:dragRestoreStart', (_, payload = {}) => {
    if (!win || win.isDestroyed() || win.isMinimized()) return false;
    if (win.__hybridUiLocked) return false;

    const screenX = Number(payload.screenX);
    const screenY = Number(payload.screenY);
    const ratioX = Math.min(1, Math.max(0, Number(payload.ratioX)));
    const offsetY = Math.min(28, Math.max(8, Number(payload.offsetY) || 14));

    if (!Number.isFinite(screenX) || !Number.isFinite(screenY) || !Number.isFinite(ratioX)) {
      return false;
    }

    if (win.isFullScreen()) {
      win.__hybridFullscreenState = false;
      win.setFullScreen(false);
    }

    if (!win.isMaximized()) {
      return false;
    }

    win.unmaximize();

    const restoredBounds = win.getBounds();
    const targetX = Math.round(screenX - restoredBounds.width * ratioX);
    const targetY = Math.round(screenY - offsetY);
    const clamped = clampWindowBoundsToDisplay(
      { x: targetX, y: targetY, width: restoredBounds.width, height: restoredBounds.height },
      { x: screenX, y: screenY }
    );

    win.setBounds(clamped, false);
    win.__hybridManualDrag = {
      active: true,
      offsetX: Math.round(screenX - clamped.x),
      offsetY: Math.round(screenY - clamped.y),
    };
    return true;
  });

  ipcMain.handle('window:dragMove', (_, payload = {}) => {
    if (!win || win.isDestroyed() || win.isMinimized()) return false;
    const dragState = win.__hybridManualDrag;
    if (!dragState || !dragState.active) return false;

    const screenX = Number(payload.screenX);
    const screenY = Number(payload.screenY);
    if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return false;

    const bounds = win.getBounds();
    const targetX = Math.round(screenX - dragState.offsetX);
    const targetY = Math.round(screenY - dragState.offsetY);
    const clamped = clampWindowBoundsToDisplay(
      { x: targetX, y: targetY, width: bounds.width, height: bounds.height },
      { x: screenX, y: screenY }
    );

    win.setPosition(clamped.x, clamped.y, false);
    return true;
  });

  ipcMain.handle('window:dragEnd', () => {
    if (win && !win.isDestroyed()) {
      win.__hybridManualDrag = null;
    }
    return true;
  });

  // ─── File Operations ───────────────────────────────────
  ipcMain.handle('dialog:openSubtitle', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Load Subtitle File',
      properties: ['openFile'],
      filters: [
        { name: 'Subtitle Files', extensions: ['srt', 'vtt', 'ass', 'ssa'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('db:getPreference', async (_, key) => {
    return db.preferences[key];
  });

  ipcMain.handle('db:setPreference', async (_, key, value) => {
    db.preferences[key] = value;
    saveDatabase(db);
    return true;
  });

  ipcMain.handle('db:getAllPreferences', async () => {
    return db.preferences;
  });

  ipcMain.handle('db:saveAllPreferences', async (_, prefs) => {
    db.preferences = { ...db.preferences, ...prefs };
    saveDatabase(db);
    return true;
  });

  // ─── History & Resume ──────────────────────────────────
  ipcMain.handle('history:add', async (_, entry) => {
    // entry: { path, name, duration, timestamp }
    db.history = db.history.filter(h => h.path !== entry.path);
    db.history.unshift({ ...entry, timestamp: Date.now() });
    if (db.history.length > 200) db.history = db.history.slice(0, 200);
    // Also update recent files
    db.recentFiles = db.recentFiles.filter(r => r !== entry.path);
    db.recentFiles.unshift(entry.path);
    if (db.recentFiles.length > 50) db.recentFiles = db.recentFiles.slice(0, 50);
    saveDatabase(db);
    return true;
  });

  ipcMain.handle('history:getRecent', async (_, count) => db.history.slice(0, count || 20));

  ipcMain.handle('resume:save', async (_, filePath, time) => {
    db.resumePositions[filePath] = time;
    saveDatabase(db);
    return true;
  });

  ipcMain.handle('resume:get', async (_, filePath) => {
    return db.resumePositions[filePath] || 0;
  });

  // ─── Speed Memory ──────────────────────────────────────
  ipcMain.handle('speed:save', async (_, filePath, speed) => {
    db.speedMemory[filePath] = speed;
    saveDatabase(db);
    return true;
  });

  ipcMain.handle('speed:get', async (_, filePath) => {
    return db.speedMemory[filePath] || null;
  });

  // ─── Subtitle Delay Memory ────────────────────────────
  ipcMain.handle('subtitleDelay:save', async (_, filePath, delay) => {
    db.subtitleDelayMemory[filePath] = delay;
    saveDatabase(db);
    return true;
  });

  ipcMain.handle('subtitleDelay:get', async (_, filePath) => {
    return db.subtitleDelayMemory[filePath] || 0;
  });

  // ─── Playlists ─────────────────────────────────────────
  ipcMain.handle('playlist:getAll', async () => db.playlists);
  ipcMain.handle('playlist:save', async (_, playlist) => {
    const idx = db.playlists.findIndex(p => p.id === playlist.id);
    if (idx >= 0) db.playlists[idx] = playlist;
    else db.playlists.push(playlist);
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
