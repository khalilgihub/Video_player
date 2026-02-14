/**
 * Hybrid Player - IPC Handlers
 * Secure IPC communication between main and renderer
 */

const { dialog, shell, app, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const SUPPORTED_VIDEO = ['.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v', '.wmv', '.ts'];
const SUPPORTED_AUDIO = ['.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma'];
const SUPPORTED_SUBS = ['.srt', '.vtt', '.ass', '.ssa'];

function setupIpcHandlers(ipcMain, win, db, saveDatabase, DB_PATH) {

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
  ipcMain.handle('window:isMaximized', () => win.isMaximized());
  ipcMain.handle('window:isFullScreen', () => {
    if (typeof win.__hybridFullscreenState === 'boolean') {
      return win.__hybridFullscreenState;
    }
    return win.isFullScreen();
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

  ipcMain.handle('file:readText', async (_, filePath) => {
    try {
      return fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      return null;
    }
  });

  ipcMain.handle('file:exists', async (_, filePath) => {
    return fs.existsSync(filePath);
  });

  ipcMain.handle('file:getMediaUrl', async (_, filePath) => {
    // Return a file:// URL for the video element
    return `file://${filePath.replace(/\\/g, '/')}`;
  });

  ipcMain.handle('file:scanFolder', async (_, folderPath) => {
    try {
      const files = [];
      const entries = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_VIDEO.includes(ext) || SUPPORTED_AUDIO.includes(ext)) {
            const fullPath = path.join(folderPath, entry.name);
            const stats = fs.statSync(fullPath);
            files.push({
              name: entry.name,
              path: fullPath,
              ext: ext,
              size: stats.size,
              modified: stats.mtimeMs,
              isVideo: SUPPORTED_VIDEO.includes(ext),
              isAudio: SUPPORTED_AUDIO.includes(ext)
            });
          }
        }
      }
      return files.sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      return [];
    }
  });

  // ─── Database Operations ───────────────────────────────
  ipcMain.handle('db:get', async (_, key) => {
    return db[key];
  });

  ipcMain.handle('db:set', async (_, key, value) => {
    db[key] = value;
    saveDatabase(db);
    return true;
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

  ipcMain.handle('history:getAll', async () => db.history);
  ipcMain.handle('history:getRecent', async (_, count) => db.history.slice(0, count || 20));
  ipcMain.handle('history:clear', async () => { db.history = []; saveDatabase(db); return true; });

  ipcMain.handle('resume:save', async (_, filePath, time) => {
    db.resumePositions[filePath] = time;
    saveDatabase(db);
    return true;
  });

  ipcMain.handle('resume:get', async (_, filePath) => {
    return db.resumePositions[filePath] || 0;
  });

  ipcMain.handle('resume:clear', async (_, filePath) => {
    delete db.resumePositions[filePath];
    saveDatabase(db);
    return true;
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
  ipcMain.handle('playlist:delete', async (_, id) => {
    db.playlists = db.playlists.filter(p => p.id !== id);
    saveDatabase(db);
    return true;
  });

  // ─── Library Paths ─────────────────────────────────────
  ipcMain.handle('library:getPaths', async () => db.libraryPaths);
  ipcMain.handle('library:addPath', async (_, folderPath) => {
    if (!db.libraryPaths.includes(folderPath)) {
      db.libraryPaths.push(folderPath);
      saveDatabase(db);
    }
    return db.libraryPaths;
  });
  ipcMain.handle('library:removePath', async (_, folderPath) => {
    db.libraryPaths = db.libraryPaths.filter(p => p !== folderPath);
    saveDatabase(db);
    return db.libraryPaths;
  });

  // ─── Screenshot ────────────────────────────────────────
  ipcMain.handle('screenshot:save', async (_, dataUrl, format) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = format === 'jpg' ? 'jpg' : 'png';
    const result = await dialog.showSaveDialog(win, {
      title: 'Save Screenshot',
      defaultPath: `hybrid-player-${timestamp}.${ext}`,
      filters: [
        { name: 'PNG Image', extensions: ['png'] },
        { name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }
      ]
    });
    if (result.canceled) return null;
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(result.filePath, Buffer.from(base64Data, 'base64'));
    return result.filePath;
  });

  // ─── App Info ──────────────────────────────────────────
  ipcMain.handle('app:getVersion', async () => app.getVersion());
  ipcMain.handle('app:getPath', async (_, name) => app.getPath(name));

  // ─── Shell ─────────────────────────────────────────────
  ipcMain.handle('shell:openExternal', async (_, url) => shell.openExternal(url));
  ipcMain.handle('shell:showInFolder', async (_, filePath) => shell.showItemInFolder(filePath));
}

module.exports = { setupIpcHandlers };
