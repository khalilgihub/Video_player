/**
 * Hybrid Player - IPC Handlers
 * Secure IPC communication between main and renderer
 */

const { app, dialog } = require('electron');
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
