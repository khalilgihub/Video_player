/**
 * Hybrid Player - Preload Script
 * Secure bridge between main and renderer processes.
 * Exposes hybridAPI with mpv control methods alongside original utilities.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openMultipleFiles: () => ipcRenderer.invoke('dialog:openMultiple'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  quitPlayer: () => ipcRenderer.invoke('app:quit'),
  getYoutubeQualities: (url) => ipcRenderer.invoke('youtube:get-quality-heights', url)
});

contextBridge.exposeInMainWorld('hybridAPI', {
  // ─── Window Controls ───────────────────────────────────
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    fullscreen: (state) => ipcRenderer.invoke('window:fullscreen', state),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    onStateChanged: (cb) => ipcRenderer.on('window-state-changed', (_, state) => cb(state))
  },

  // ─── mpv Engine ────────────────────────────────────────
  mpv: {
    // Generic
    command: (...args) => ipcRenderer.invoke('mpv:command', ...args),
    setProperty: (name, value) => ipcRenderer.invoke('mpv:set-property', name, value),
    getProperty: (name) => ipcRenderer.invoke('mpv:get-property', name),
    observeProperty: (name) => ipcRenderer.invoke('mpv:observe-property', name),
    isReady: () => ipcRenderer.invoke('mpv:is-ready'),

    // File loading
    loadFile: (filePath) => ipcRenderer.invoke('mpv:load-file', filePath),

    // Playback
    play: () => ipcRenderer.invoke('mpv:play'),
    pause: () => ipcRenderer.invoke('mpv:pause'),
    togglePause: () => ipcRenderer.invoke('mpv:toggle-pause'),
    stop: () => ipcRenderer.invoke('mpv:stop'),
    seek: (time, flags) => ipcRenderer.invoke('mpv:seek', time, flags),
    seekRelative: (sec) => ipcRenderer.invoke('mpv:seek-relative', sec),
    seekPercent: (pct) => ipcRenderer.invoke('mpv:seek-percent', pct),

    // Volume / Speed
    setVolume: (v) => ipcRenderer.invoke('mpv:set-volume', v),
    setMute: (m) => ipcRenderer.invoke('mpv:set-mute', m),
    setSpeed: (s) => ipcRenderer.invoke('mpv:set-speed', s),

    // Subtitles
    cycleSub: () => ipcRenderer.invoke('mpv:cycle-sub'),
    setSub: (id) => ipcRenderer.invoke('mpv:set-sub', id),
    setSubDelay: (sec) => ipcRenderer.invoke('mpv:set-sub-delay', sec),
    setSubVisibility: (vis) => ipcRenderer.invoke('mpv:set-sub-visibility', vis),
    addSubFile: (path) => ipcRenderer.invoke('mpv:add-sub-file', path),

    // Audio
    cycleAudio: () => ipcRenderer.invoke('mpv:cycle-audio'),
    setAudio: (id) => ipcRenderer.invoke('mpv:set-audio', id),

    // Chapters
    setChapter: (idx) => ipcRenderer.invoke('mpv:set-chapter', idx),
    nextChapter: () => ipcRenderer.invoke('mpv:next-chapter'),
    prevChapter: () => ipcRenderer.invoke('mpv:prev-chapter'),

    // Frame stepping
    frameStep: () => ipcRenderer.invoke('mpv:frame-step'),
    frameBackStep: () => ipcRenderer.invoke('mpv:frame-back-step'),

    // A-B loop
    setABLoopA: (t) => ipcRenderer.invoke('mpv:set-ab-loop-a', t),
    setABLoopB: (t) => ipcRenderer.invoke('mpv:set-ab-loop-b', t),
    clearABLoop: () => ipcRenderer.invoke('mpv:clear-ab-loop'),

    // Screenshot
    screenshot: (mode) => ipcRenderer.invoke('mpv:screenshot', mode),
    screenshotOpenFolder: () => ipcRenderer.invoke('mpv:screenshot-open-folder'),

    // Thumbnail capture for seek-bar hover preview
    captureThumbnail: (time) => ipcRenderer.invoke('mpv:capture-thumbnail', time),

    // Events from main → renderer
    onPropertyChange: (cb) => {
      ipcRenderer.on('mpv:property-change', (_, name, value) => cb(name, value));
    },
    onEvent: (cb) => {
      ipcRenderer.on('mpv:event', (_, event, data) => cb(event, data));
    },
  },

  // ─── Dialog ────────────────────────────────────────────
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    openMultiple: () => ipcRenderer.invoke('dialog:openMultiple'),
    openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
    openSubtitle: () => ipcRenderer.invoke('dialog:openSubtitle')
  },

  // ─── File Operations ──────────────────────────────────
  file: {
    readText: (filePath) => ipcRenderer.invoke('file:readText', filePath),
    exists: (filePath) => ipcRenderer.invoke('file:exists', filePath),
    getMediaUrl: (filePath) => ipcRenderer.invoke('file:getMediaUrl', filePath),
    scanFolder: (folderPath) => ipcRenderer.invoke('file:scanFolder', folderPath),
    getPathForDroppedFile: (file) => {
      try {
        return webUtils.getPathForFile(file) || null;
      } catch {
        return null;
      }
    }
  },

  // ─── Database / Preferences ───────────────────────────
  db: {
    get: (key) => ipcRenderer.invoke('db:get', key),
    set: (key, value) => ipcRenderer.invoke('db:set', key, value),
    getPreference: (key) => ipcRenderer.invoke('db:getPreference', key),
    setPreference: (key, value) => ipcRenderer.invoke('db:setPreference', key, value),
    getAllPreferences: () => ipcRenderer.invoke('db:getAllPreferences'),
    saveAllPreferences: (prefs) => ipcRenderer.invoke('db:saveAllPreferences', prefs)
  },

  // ─── History & Resume ─────────────────────────────────
  history: {
    add: (entry) => ipcRenderer.invoke('history:add', entry),
    getAll: () => ipcRenderer.invoke('history:getAll'),
    getRecent: (count) => ipcRenderer.invoke('history:getRecent', count),
    clear: () => ipcRenderer.invoke('history:clear')
  },

  resume: {
    save: (filePath, time) => ipcRenderer.invoke('resume:save', filePath, time),
    get: (filePath) => ipcRenderer.invoke('resume:get', filePath),
    clear: (filePath) => ipcRenderer.invoke('resume:clear', filePath)
  },

  speed: {
    save: (filePath, speed) => ipcRenderer.invoke('speed:save', filePath, speed),
    get: (filePath) => ipcRenderer.invoke('speed:get', filePath)
  },

  subtitleDelay: {
    save: (filePath, delay) => ipcRenderer.invoke('subtitleDelay:save', filePath, delay),
    get: (filePath) => ipcRenderer.invoke('subtitleDelay:get', filePath)
  },

  // ─── Playlists ────────────────────────────────────────
  playlist: {
    getAll: () => ipcRenderer.invoke('playlist:getAll'),
    save: (playlist) => ipcRenderer.invoke('playlist:save', playlist),
    delete: (id) => ipcRenderer.invoke('playlist:delete', id)
  },

  // ─── Library ──────────────────────────────────────────
  library: {
    getPaths: () => ipcRenderer.invoke('library:getPaths'),
    addPath: (path) => ipcRenderer.invoke('library:addPath', path),
    removePath: (path) => ipcRenderer.invoke('library:removePath', path)
  },

  // ─── Screenshot (legacy) ──────────────────────────────
  screenshot: {
    save: (dataUrl, format) => ipcRenderer.invoke('screenshot:save', dataUrl, format)
  },

  // ─── App ──────────────────────────────────────────────
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPath: (name) => ipcRenderer.invoke('app:getPath', name)
  },

  // ─── Shell ────────────────────────────────────────────
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    showInFolder: (filePath) => ipcRenderer.invoke('shell:showInFolder', filePath)
  },

  youtube: {
    getQualityHeights: (url) => ipcRenderer.invoke('youtube:get-quality-heights', url)
  },

  // ─── Event Listeners ─────────────────────────────────
  on: (channel, callback) => {
    const validChannels = [
      'menu-action', 'open-file-from-args', 'window-state-changed',
      'mpv:property-change', 'mpv:event'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_, ...args) => callback(...args));
    }
  },

  removeListener: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  }
});
