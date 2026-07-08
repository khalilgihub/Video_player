/**
 * Hybrid Player - Preload Script
 * Secure bridge between main and renderer processes.
 * Exposes hybridAPI with mpv control methods alongside original utilities.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('hybridAPI', {
  app: {
    getStartupDiagnostics: () => ipcRenderer.invoke('app:get-startup-diagnostics')
  },

  // ─── Window Controls ───────────────────────────────────
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('toggle-maximize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    titlebarDragStart: (payload) => ipcRenderer.invoke('window:titlebar-drag-start', payload),
    titlebarDragMove: (payload) => ipcRenderer.invoke('window:titlebar-drag-move', payload),
    titlebarDragEnd: () => ipcRenderer.invoke('window:titlebar-drag-end'),
    setHitTestExclusions: (rects) => ipcRenderer.invoke('window:set-hit-test-exclusions', rects),
    fullscreen: (state) => ipcRenderer.invoke('window:fullscreen', state),
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    setUiLocked: (state) => ipcRenderer.invoke('window:set-ui-locked', state),
    onStateChanged: (cb) => {
      const listener = (_, state) => cb(state);
      ipcRenderer.on('window-state-changed', listener);
      return () => ipcRenderer.removeListener('window-state-changed', listener);
    }
  },

  // ─── mpv Engine ────────────────────────────────────────
  mpv: {
    // Generic
    command: (...args) => ipcRenderer.invoke('mpv:command', ...args),
    setProperty: (name, value) => ipcRenderer.invoke('mpv:set-property', name, value),
    getProperty: (name) => ipcRenderer.invoke('mpv:get-property', name),
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
    setSub: (id) => ipcRenderer.invoke('mpv:set-sub', id),
    setSubDelay: (sec) => ipcRenderer.invoke('mpv:set-sub-delay', sec),
    setSubVisibility: (vis) => ipcRenderer.invoke('mpv:set-sub-visibility', vis),
    addSubFile: (path) => ipcRenderer.invoke('mpv:add-sub-file', path),

    // Audio
    setAudio: (id) => ipcRenderer.invoke('mpv:set-audio', id),

    // Chapters
    setChapter: (idx) => ipcRenderer.invoke('mpv:set-chapter', idx),

    // Frame stepping
    frameStep: () => ipcRenderer.invoke('mpv:frame-step'),
    frameBackStep: () => ipcRenderer.invoke('mpv:frame-back-step'),

    // A-B loop
    setABLoopA: (t) => ipcRenderer.invoke('mpv:set-ab-loop-a', t),
    setABLoopB: (t) => ipcRenderer.invoke('mpv:set-ab-loop-b', t),
    clearABLoop: () => ipcRenderer.invoke('mpv:clear-ab-loop'),

    // Screenshot
    screenshot: (mode, debugMeta) => ipcRenderer.invoke('mpv:screenshot', mode, debugMeta),
    screenshotFast: (mode, debugMeta) => ipcRenderer.invoke('mpv:screenshot-fast', mode, debugMeta),
    capturePausedFrame: (mode) => ipcRenderer.invoke('mpv:capture-paused-frame', mode),
    screenshotOpenFolder: () => ipcRenderer.invoke('mpv:screenshot-open-folder'),

    // Thumbnail capture for seek-bar hover preview
    captureThumbnail: (time) => ipcRenderer.invoke('mpv:capture-thumbnail', time),

    // Events from main → renderer
    onPropertyChange: (cb) => {
      const listener = (_, name, value) => cb(name, value);
      ipcRenderer.on('mpv:property-change', listener);
      return () => ipcRenderer.removeListener('mpv:property-change', listener);
    },
    onEvent: (cb) => {
      const listener = (_, event, data) => cb(event, data);
      ipcRenderer.on('mpv:event', listener);
      return () => ipcRenderer.removeListener('mpv:event', listener);
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
    getPreference: (key) => ipcRenderer.invoke('db:getPreference', key),
    setPreference: (key, value) => ipcRenderer.invoke('db:setPreference', key, value),
    getAllPreferences: () => ipcRenderer.invoke('db:getAllPreferences'),
    saveAllPreferences: (prefs) => ipcRenderer.invoke('db:saveAllPreferences', prefs)
  },

  // ─── History & Resume ─────────────────────────────────
  history: {
    add: (entry) => ipcRenderer.invoke('history:add', entry),
    getRecent: (count) => ipcRenderer.invoke('history:getRecent', count),
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
    save: (playlist) => ipcRenderer.invoke('playlist:save', playlist)
  },

  youtube: {
    getQualityHeights: (url) => ipcRenderer.invoke('youtube:get-quality-heights', url)
  },

  media: {
    clipSegment: (payload) => ipcRenderer.invoke('media:clip-segment', payload)
  },

  debug: {
    appendLog: (scope, payload) => ipcRenderer.invoke('debug:append-log', scope, payload),
    getLogFilePath: () => ipcRenderer.invoke('debug:get-log-file-path'),
    tailLog: (lines) => ipcRenderer.invoke('debug:tail-log', lines),
  },

  // ─── Event Listeners ─────────────────────────────────
  on: (channel, callback) => {
    const validChannels = [
      'menu-action', 'open-file-from-args', 'window-state-changed',
      'window-is-fullscreen', 'window-is-maximized',
      'window-fullscreen-transition-start',
      'screenshot-ready',
      'mpv:property-change', 'mpv:event'
    ];
    if (validChannels.includes(channel)) {
      const listener = (_, ...args) => callback(...args);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
    return () => {};
  },
});
