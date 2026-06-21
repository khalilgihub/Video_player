/**
 * Hybrid Player - mpv IPC Bridge (Main Process)
 * Registers ipcMain handlers that forward commands from the renderer
 * to the MpvProcess singleton, and pushes mpv events back.
 */

const { ipcMain, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { fileURLToPath } = require('url');
const { MpvProcess } = require('./mpv-process');

// Fullscreen/input trace logging.
const FS_DEBUG = false;
function fsdbg(...args) {
  if (!FS_DEBUG) return;
  console.log('[FSDBG][mpv-bridge]', ...args);
}

const SEEK_PREVIEW_DEBUG = false;
function seekdbg(...args) {
  if (!SEEK_PREVIEW_DEBUG) return;
  console.log('[SEEKDBG][preview]', ...args);
}

const YT_DEBUG = false;
function ytdbg(...args) {
  if (!YT_DEBUG) return;
  console.log('[YTDBG][mpv-bridge]', ...args);
}

const PLAYBACK_DEBUG = false;
function playdbg(...args) {
  if (!PLAYBACK_DEBUG) return;
  console.log('[PLAYDBG][mpv-bridge]', ...args);
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {import('./mpv-process').MpvProcess} mpv
 */
function setupMpvIpc(win, mpv) {
  const getTrackedFullscreen = () => {
    if (!win || win.isDestroyed()) return false;
    if (typeof win.__hybridFullscreenState === 'boolean') {
      return win.__hybridFullscreenState;
    }
    return !!win.isFullScreen();
  };

  const setTrackedFullscreen = (state) => {
    if (!win || win.isDestroyed()) return;
    win.__hybridFullscreenState = !!state;
    win.setFullScreen(!!state);
  };
  const getUiLocked = () => {
    if (!win || win.isDestroyed()) return false;
    return !!win.__hybridUiLocked;
  };

  const previewMpv = new MpvProcess({ pipePrefix: 'hybrid-mpv-thumb', observeDefaults: false });
  let previewLoadedPath = null;
  let previewQueue = Promise.resolve();
  const previewCache = new Map();
  const previewCacheFiles = new Map();
  const previewDir = path.join(app.getPath('temp'), 'hybrid-player-thumbs');
  const pausedFrameDir = path.join(app.getPath('temp'), 'hybrid-player-paused-frames');
  const pausedFrameFiles = [];
  const PAUSED_FRAME_MAX_FILES = 12;
  const MAX_INLINE_PREVIEW_BYTES = 12 * 1024 * 1024;
  const NETWORK_MEDIA_PROTOCOLS = new Set(['http:', 'https:', 'rtsp:', 'rtmp:', 'rtmps:', 'srt:']);
  const LOCAL_MEDIA_EXTENSIONS = new Set([
    '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v', '.wmv', '.ts', '.m2ts', '.mts',
    '.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff', '.alac',
    '.m3u8', '.mpd'
  ]);
  const LOCAL_SUBTITLE_EXTENSIONS = new Set([
    '.srt', '.ass', '.ssa', '.vtt', '.sub', '.idx', '.sup'
  ]);

  if (!fs.existsSync(previewDir)) {
    fs.mkdirSync(previewDir, { recursive: true });
  }
  if (!fs.existsSync(pausedFrameDir)) {
    fs.mkdirSync(pausedFrameDir, { recursive: true });
  }

  const waitForMpvReady = (instance, timeoutMs = 4000) => new Promise((resolve, reject) => {
    if (instance.ready) {
      resolve(true);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('preview mpv not ready'));
    }, timeoutMs);

    const onReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };

    instance.once('ready', onReady);
  });

  const ensurePreviewProcess = async () => {
    if (!previewMpv.process) {
      previewMpv.spawn(null, {
        attachWindow: false,
        hwdec: 'auto-safe',
        screenshotDir: previewDir,
      });
    }
    await waitForMpvReady(previewMpv);
  };

  previewMpv.on('error', (err) => {
    console.warn('[mpv preview error]', err?.message || err);
  });

  if (win && !win.isDestroyed()) {
    win.on('closed', () => {
      try {
        previewMpv.destroy();
      } catch {}
      for (const filePath of previewCacheFiles.values()) {
        fs.unlink(filePath, () => {});
      }
      previewCache.clear();
      previewCacheFiles.clear();
      fs.rm(previewDir, { recursive: true, force: true }, () => {});
    });
  }

  const queuePreview = (task) => {
    previewQueue = previewQueue.then(task, task);
    return previewQueue;
  };

  const cacheSet = (key, value, filePath = null) => {
    previewCache.set(key, value);
    if (filePath) {
      previewCacheFiles.set(key, filePath);
    }
    if (previewCache.size > 180) {
      const oldest = previewCache.keys().next().value;
      previewCache.delete(oldest);
      const staleFile = previewCacheFiles.get(oldest);
      previewCacheFiles.delete(oldest);
      if (staleFile) {
        fs.unlink(staleFile, () => {});
      }
    }
  };

  const waitForReady = (timeoutMs = 5000) => new Promise((resolve, reject) => {
    if (mpv.ready) {
      resolve(true);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('mpv not ready'));
    }, timeoutMs);

    const onReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };

    mpv.once('ready', onReady);
  });

  const withReady = async (action, fallback = null) => {
    try {
      await waitForReady();
      return await action();
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('not ready') || msg.includes('not connected')) {
        return fallback;
      }
      throw err;
    }
  };

  const rendererGetPropertyAllowlist = new Set([
    'time-pos',
    'drop-frame-count',
    'estimated-vf-fps',
    'video-bitrate',
    'video-codec',
    'demuxer-cache-state',
  ]);

  const rendererSetPropertyAllowlist = new Set([
    'vid',
    'ytdl-format',
    'af',
    'sub-font-size',
    'sub-font',
    'sub-color',
    'sub-back-color',
  ]);

  const seekFlagsAllowlist = new Set([
    'absolute',
    'absolute+exact',
    'relative',
    'absolute-percent',
    'absolute+keyframes',
  ]);

  const sanitizeMpvString = (value, maxLength = 4096) => {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (!text || text.length > maxLength || text.includes('\0')) return null;
    return text;
  };

  const isLikelyAbsoluteLocalPath = (source) => (
    path.isAbsolute(source) ||
    /^[a-zA-Z]:[\\/]/.test(source) ||
    /^\\\\[^\\]/.test(source)
  );

  const sanitizeLocalMediaPath = (source, { mustExist = false, allowedExtensions = null } = {}) => {
    try {
      const resolved = path.resolve(source);
      if (!resolved || resolved.includes('\0')) return null;
      if (allowedExtensions && !allowedExtensions.has(path.extname(resolved).toLowerCase())) return null;
      if (mustExist) {
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) return null;
      }
      return resolved;
    } catch {
      return null;
    }
  };

  const sanitizeMediaSource = (value, options = {}) => {
    const source = sanitizeMpvString(value, 8192);
    if (!source) return null;

    if (isLikelyAbsoluteLocalPath(source)) {
      return sanitizeLocalMediaPath(source, options);
    }

    try {
      const parsed = new URL(source);
      if (NETWORK_MEDIA_PROTOCOLS.has(parsed.protocol)) {
        return parsed.href;
      }
      if (parsed.protocol === 'file:') {
        return sanitizeLocalMediaPath(fileURLToPath(parsed), options);
      }
      return null;
    } catch {
      return null;
    }
  };

  const sanitizeNumber = (value, min, max, fallback = null) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  };

  const isPathInside = (childPath, parentPath) => {
    const child = path.resolve(childPath);
    const parent = path.resolve(parentPath);
    const relative = path.relative(parent, child);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  };

  const sanitizeMpvPropertyValue = (name, value) => {
    if (!rendererSetPropertyAllowlist.has(name)) return null;

    switch (name) {
      case 'vid':
        if (value === 'auto' || value === 'no') return value;
        return Number.isInteger(Number(value)) ? Number(value) : null;
      case 'ytdl-format':
        return sanitizeMpvString(value, 512);
      case 'af': {
        if (value === '') return '';
        const filter = sanitizeMpvString(value, 512);
        return /^lavfi=\[superequalizer=[0-9:.\-]+\]$/.test(filter || '') ? filter : null;
      }
      case 'sub-font-size':
        return sanitizeNumber(value, 8, 96, null);
      case 'sub-font':
        return sanitizeMpvString(value, 100);
      case 'sub-color':
      case 'sub-back-color':
        return /^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ? value : null;
      default:
        return null;
    }
  };

  const sanitizeRendererMpvCommand = (args) => {
    if (!Array.isArray(args) || args.length === 0) return null;
    const command = args[0];

    switch (command) {
      case 'loadfile': {
        const source = sanitizeMediaSource(args[1], {
          mustExist: true,
          allowedExtensions: LOCAL_MEDIA_EXTENSIONS,
        });
        const mode = args[2] === 'append' ? 'append' : 'replace';
        return source ? ['loadfile', source, mode] : null;
      }
      case 'seek': {
        const seconds = sanitizeNumber(args[1], 0, 30 * 24 * 60 * 60, null);
        const flags = seekFlagsAllowlist.has(args[2]) ? args[2] : 'absolute';
        return seconds === null ? null : ['seek', seconds, flags];
      }
      case 'add': {
        if (args[1] !== 'volume') return null;
        const delta = sanitizeNumber(args[2], -100, 100, null);
        return delta === null ? null : ['add', 'volume', delta];
      }
      case 'set_property': {
        const name = sanitizeMpvString(args[1], 80);
        const value = sanitizeMpvPropertyValue(name, args[2]);
        return value === null ? null : ['set_property', name, value];
      }
      default:
        return null;
    }
  };

  const sanitizeScreenshotMode = (mode) => (
    mode === 'subtitles' || mode === 'window' || mode === 'video' ? mode : 'video'
  );

  const getImageMimeType = (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    return 'image/png';
  };

  const buildScreenshotPayload = (filePath) => {
    const mimeType = getImageMimeType(filePath);
    const normalizedPath = path.resolve(filePath).replace(/\\/g, '/');
    const fileUrl = `local-file:///${encodeURI(normalizedPath)}`;
    return {
      filePath,
      mimeType,
      previewUrl: fileUrl,
    };
  };

  const buildInlinePreviewDataUrl = (filePath, mimeType) => {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_INLINE_PREVIEW_BYTES) return null;
      const raw = fs.readFileSync(filePath);
      if (!raw || raw.length === 0) return null;
      return `data:${mimeType};base64,${raw.toString('base64')}`;
    } catch {
      return null;
    }
  };

  const emitScreenshotReady = (payload) => {
    if (!win || win.isDestroyed()) return;
    // Trigger preview at the exact command ACK boundary from mpv.
    win.webContents.send('screenshot-ready', payload);
  };

  const captureScreenshotWithAck = async (mode, debugMeta = null) => {
    const filePath = await mpv.screenshot(mode || 'video');
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Screenshot path is invalid');
    }

    const payload = buildScreenshotPayload(filePath);
    emitScreenshotReady(payload);
    return payload;
  };

  const capturePausedFrameSilent = async (mode = 'video') => {
    const stamp = Date.now();
    const nonce = crypto.randomBytes(8).toString('hex');
    const framePath = path.join(pausedFrameDir, `paused-frame-${stamp}-${nonce}.jpg`);
    await mpv.command('screenshot-to-file', framePath, mode || 'video');
    if (!fs.existsSync(framePath)) {
      throw new Error('Paused frame capture failed');
    }

    pausedFrameFiles.push(framePath);
    while (pausedFrameFiles.length > PAUSED_FRAME_MAX_FILES) {
      const stale = pausedFrameFiles.shift();
      if (!stale) continue;
      fs.unlink(stale, () => {});
    }

    const payload = buildScreenshotPayload(framePath);
    const previewDataUrl = buildInlinePreviewDataUrl(framePath, payload.mimeType);
    if (previewDataUrl) {
      payload.previewDataUrl = previewDataUrl;
    }
    return payload;
  };

  const getPropSafe = async (name) => {
    try {
      return await withReady(() => mpv.getProperty(name), null);
    } catch {
      return null;
    }
  };

  const logPlaybackSnapshot = async (source, extra = {}) => {
    const [
      pathValue,
      timePos,
      duration,
      paused,
      vid,
      aid,
      videoParams,
      voConfigured,
      windowId,
      currentVo,
      hwdecCurrent,
      videoOutParams,
      displayFps,
      containerFps,
    ] = await Promise.all([
      getPropSafe('path'),
      getPropSafe('time-pos'),
      getPropSafe('duration'),
      getPropSafe('pause'),
      getPropSafe('vid'),
      getPropSafe('aid'),
      getPropSafe('video-params'),
      getPropSafe('vo-configured'),
      getPropSafe('window-id'),
      getPropSafe('current-vo'),
      getPropSafe('hwdec-current'),
      getPropSafe('video-out-params'),
      getPropSafe('display-fps'),
      getPropSafe('container-fps'),
    ]);

    const width = Number(videoParams?.w || videoParams?.dw || 0);
    const height = Number(videoParams?.h || videoParams?.dh || 0);
    const hasVideoParams = width > 0 && height > 0;
    const payload = {
      source,
      path: typeof pathValue === 'string' ? pathValue : null,
      timePos: Number(timePos || 0).toFixed(3),
      duration: Number(duration || 0).toFixed(3),
      paused: !!paused,
      vid,
      aid,
      voConfigured,
      videoSize: hasVideoParams ? `${width}x${height}` : null,
      windowId: windowId ?? null,
      currentVo: currentVo ?? null,
      hwdecCurrent: hwdecCurrent ?? null,
      videoOutSize:
        Number(videoOutParams?.w || 0) > 0 && Number(videoOutParams?.h || 0) > 0
          ? `${Number(videoOutParams.w)}x${Number(videoOutParams.h)}`
          : null,
      displayFps: displayFps ?? null,
      containerFps: containerFps ?? null,
      ...extra,
    };

    playdbg('snapshot', payload);

    if (PLAYBACK_DEBUG && Number(timePos || 0) > 0.8 && !hasVideoParams) {
      console.error('[PLAYDBG][mpv-bridge] warning: time advancing but video params missing', payload);
    }

    if (Number(timePos || 0) > 0.8 && hasVideoParams && voConfigured === true) {
      playdbg('surface-check', {
        source,
        note: 'decode_and_vo_ok__if_screen_is_black_issue_is_likely_window_composition_or_z_order',
        windowId: windowId ?? null,
        currentVo: currentVo ?? null,
      });
    }
  };

  // Helper – relay property changes to the renderer
  mpv.on('property-change', (name, value) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('mpv:property-change', name, value);
    }
  });

  mpv.on('file-loaded', () => {
    ytdbg('mpv event file-loaded');
    if (win && !win.isDestroyed()) {
      win.webContents.send('mpv:event', 'file-loaded');
    }
    void logPlaybackSnapshot('event:file-loaded');
  });

  mpv.on('end-file', (endFileInfo) => {
    ytdbg('mpv event end-file', endFileInfo);
    if (win && !win.isDestroyed()) {
      win.webContents.send('mpv:event', 'end-file', endFileInfo);
    }
  });

  mpv.on('seek', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('mpv:event', 'seek');
    }
  });

  mpv.on('playback-restart', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('mpv:event', 'playback-restart');
    }
    void logPlaybackSnapshot('event:playback-restart');
  });

  mpv.on('ready', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('mpv:event', 'ready');
    }
  });

  mpv.on('error', (err) => {
    console.error('[mpv error]', err.message);
    if (win && !win.isDestroyed()) {
      win.webContents.send('mpv:event', 'error', err.message);
    }
  });

  // ── Relay input from mpv VO surface back to Electron ──
  // When the native mpv child window has OS focus, keyboard/mouse
  // events go to mpv.  Our input.conf maps them to script-message
  // commands which arrive here as client-message events.
  let _clickTimer = null;

  mpv.on('client-message', (args) => {
    const cmd = args[0];
    if (!cmd) return;
    fsdbg('client-message received', { cmd, args, fullscreen: getTrackedFullscreen() });

    if (getUiLocked() && cmd !== 'hybrid-unlock-ui') {
      if (win && !win.isDestroyed()) {
        win.focus();
        win.webContents.focus();
      }
      return;
    }

    switch (cmd) {
      case 'hybrid-unlock-ui':
        if (win && !win.isDestroyed()) {
          win.webContents.send('mpv:event', 'unlock-request');
        }
        break;

      /* ── Fullscreen ─────────────────────────────────── */
      case 'hybrid-toggle-fullscreen':
        if (win && !win.isDestroyed()) {
          const next = !getTrackedFullscreen();
          fsdbg('action toggle fullscreen', { from: getTrackedFullscreen(), to: next });
          setTrackedFullscreen(next);
          fsdbg('action toggle fullscreen done', { to: next });
        }
        break;

      case 'hybrid-exit-fullscreen':
        if (win && !win.isDestroyed() && getTrackedFullscreen()) {
          fsdbg('action exit fullscreen');
          setTrackedFullscreen(false);
          fsdbg('action exit fullscreen done', { to: false });
        }
        break;

      /* ── Play / Pause ───────────────────────────────── */
      case 'hybrid-toggle-play':
        if (mpv.ready) mpv.togglePause();
        break;

      /* ── Mouse click (debounced to avoid double-fire on dblclick) */
      case 'hybrid-mouse-click':
        fsdbg('action mouse click');
        if (_clickTimer) clearTimeout(_clickTimer);
        _clickTimer = setTimeout(() => {
          if (mpv.ready) mpv.togglePause();
          _clickTimer = null;
        }, 250);
        break;

      case 'hybrid-mouse-dblclick':
        fsdbg('action mouse dblclick', { from: getTrackedFullscreen() });
        // Cancel the pending single-click play toggle
        if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
        if (win && !win.isDestroyed()) {
          const next = !getTrackedFullscreen();
          setTrackedFullscreen(next);
          fsdbg('action mouse dblclick done', { to: next });
        }
        break;

      /* ── Seek ───────────────────────────────────────── */
      case 'hybrid-seek-back-5':
        if (mpv.ready) {
          mpv.seekRelative(-5);
          if (win && !win.isDestroyed()) {
            win.webContents.send('mpv:event', 'skip-osd', { seconds: -5 });
          }
        }
        break;
      case 'hybrid-seek-forward-5':
        if (mpv.ready) {
          mpv.seekRelative(5);
          if (win && !win.isDestroyed()) {
            win.webContents.send('mpv:event', 'skip-osd', { seconds: 5 });
          }
        }
        break;

      case 'hybrid-volume-up':
        if (mpv.ready) {
          mpv.command('add', 'volume', 5);
        }
        break;

      case 'hybrid-volume-down':
        if (mpv.ready) {
          mpv.command('add', 'volume', -5);
        }
        break;

      /* ── Mute ───────────────────────────────────────── */
      case 'hybrid-toggle-mute':
        if (mpv.ready) {
          mpv.getProperty('mute').then(m => mpv.setMute(!m)).catch(() => {});
        }
        break;
    }

    // After handling mpv-relayed input, pull keyboard focus back to
    // the Electron/Chromium layer so subsequent keydown events reach
    // the renderer's document listeners.
    if (win && !win.isDestroyed()) {
      fsdbg('focus restore to browser window');
      win.focus();
      win.webContents.focus();
    }
  });

  // ── Generic command passthrough ────────────────────────
  ipcMain.handle('mpv:command', async (_, ...args) => {
    const cleanArgs = sanitizeRendererMpvCommand(args);
    if (!cleanArgs) return null;
    return withReady(() => mpv.command(...cleanArgs), null);
  });

  ipcMain.handle('mpv:set-property', async (_, name, value) => {
    const cleanName = sanitizeMpvString(name, 80);
    const cleanValue = sanitizeMpvPropertyValue(cleanName, value);
    if (cleanValue === null) return false;
    return withReady(() => mpv.setProperty(cleanName, cleanValue), false);
  });

  ipcMain.handle('mpv:get-property', async (_, name) => {
    const cleanName = sanitizeMpvString(name, 80);
    if (!cleanName || !rendererGetPropertyAllowlist.has(cleanName)) return null;
    try {
      return await withReady(() => mpv.getProperty(cleanName), null);
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('property unavailable')) {
        ytdbg('mpv:get-property unavailable', { name: cleanName });
        return null;
      }
      throw err;
    }
  });

  // ── File loading ───────────────────────────────────────
  ipcMain.handle('mpv:load-file', async (_, filePath) => {
    const cleanFilePath = sanitizeMediaSource(filePath, {
      mustExist: true,
      allowedExtensions: LOCAL_MEDIA_EXTENSIONS,
    });
    if (!cleanFilePath) return false;
    playdbg('load-file request', { filePath: cleanFilePath });
    await waitForReady(7000);
    const result = await mpv.loadFile(cleanFilePath);
    playdbg('load-file command sent', { filePath: cleanFilePath, result });
    setTimeout(() => { void logPlaybackSnapshot('probe:1s', { filePath: cleanFilePath }); }, 1000);
    setTimeout(() => { void logPlaybackSnapshot('probe:3s', { filePath: cleanFilePath }); }, 3000);
    return result;
  });

  // ── Playback ───────────────────────────────────────────
  ipcMain.handle('mpv:play', async () => withReady(() => mpv.play(), false));
  ipcMain.handle('mpv:pause', async () => withReady(() => mpv.pause(), false));
  ipcMain.handle('mpv:toggle-pause', async () => withReady(() => mpv.togglePause(), false));
  ipcMain.handle('mpv:stop', async () => withReady(() => mpv.stop(), false));
  ipcMain.handle('mpv:seek', async (_, time, flags) => {
    const safeTime = sanitizeNumber(time, 0, 30 * 24 * 60 * 60, null);
    const safeFlags = seekFlagsAllowlist.has(flags) ? flags : 'absolute';
    if (safeTime === null) return false;
    return withReady(() => mpv.seek(safeTime, safeFlags), false);
  });
  ipcMain.handle('mpv:seek-relative', async (_, sec) => {
    const safeSeconds = sanitizeNumber(sec, -24 * 60 * 60, 24 * 60 * 60, null);
    return safeSeconds === null ? false : withReady(() => mpv.seekRelative(safeSeconds), false);
  });
  ipcMain.handle('mpv:seek-percent', async (_, pct) => {
    const safePercent = sanitizeNumber(pct, 0, 100, null);
    return safePercent === null ? false : withReady(() => mpv.seekPercent(safePercent), false);
  });

  // ── Volume / speed ─────────────────────────────────────
  ipcMain.handle('mpv:set-volume', async (_, v) => {
    const safeVolume = sanitizeNumber(v, 0, 100, null);
    return safeVolume === null ? false : withReady(() => mpv.setVolume(safeVolume), false);
  });
  ipcMain.handle('mpv:set-mute', async (_, m) => withReady(() => mpv.setMute(!!m), false));
  ipcMain.handle('mpv:set-speed', async (_, s) => {
    const safeSpeed = sanitizeNumber(s, 0.1, 16, null);
    return safeSpeed === null ? false : withReady(() => mpv.setSpeed(safeSpeed), false);
  });

  // ── Subtitles ──────────────────────────────────────────
  ipcMain.handle('mpv:set-sub', async (_, id) => {
    const safeId = Number.isInteger(Number(id)) ? Number(id) : null;
    return safeId === null ? false : withReady(() => mpv.setSub(safeId), false);
  });
  ipcMain.handle('mpv:set-sub-delay', async (_, sec) => {
    const safeDelay = sanitizeNumber(sec, -600, 600, null);
    return safeDelay === null ? false : withReady(() => mpv.setSubDelay(safeDelay), false);
  });
  ipcMain.handle('mpv:set-sub-visibility', async (_, vis) => withReady(() => mpv.setSubVisibility(vis), false));
  ipcMain.handle('mpv:add-sub-file', async (_, p) => {
    const subtitlePath = sanitizeMediaSource(p, {
      mustExist: true,
      allowedExtensions: LOCAL_SUBTITLE_EXTENSIONS,
    });
    return subtitlePath ? withReady(() => mpv.addSubFile(subtitlePath), false) : false;
  });

  // ── Audio tracks ───────────────────────────────────────
  ipcMain.handle('mpv:set-audio', async (_, id) => {
    const safeId = Number.isInteger(Number(id)) ? Number(id) : null;
    return safeId === null ? false : withReady(() => mpv.setAudio(safeId), false);
  });

  // ── Chapters ───────────────────────────────────────────
  ipcMain.handle('mpv:set-chapter', async (_, idx) => {
    const safeIndex = Number.isInteger(Number(idx)) ? Number(idx) : null;
    return safeIndex === null ? false : withReady(() => mpv.setChapter(safeIndex), false);
  });

  // ── Frame stepping ─────────────────────────────────────
  ipcMain.handle('mpv:frame-step', async () => withReady(() => mpv.frameStep(), false));
  ipcMain.handle('mpv:frame-back-step', async () => withReady(() => mpv.frameBackStep(), false));

  // ── A-B loop ───────────────────────────────────────────
  ipcMain.handle('mpv:set-ab-loop-a', async (_, t) => {
    const safeTime = sanitizeNumber(t, 0, 30 * 24 * 60 * 60, null);
    return safeTime === null ? false : withReady(() => mpv.setABLoopA(safeTime), false);
  });
  ipcMain.handle('mpv:set-ab-loop-b', async (_, t) => {
    const safeTime = sanitizeNumber(t, 0, 30 * 24 * 60 * 60, null);
    return safeTime === null ? false : withReady(() => mpv.setABLoopB(safeTime), false);
  });
  ipcMain.handle('mpv:clear-ab-loop', async () => withReady(() => mpv.clearABLoop(), false));

  // ── Screenshot ─────────────────────────────────────────
  ipcMain.handle('mpv:screenshot-fast', async (_, mode, debugMeta) => {
    return withReady(() => captureScreenshotWithAck(sanitizeScreenshotMode(mode), debugMeta), null);
  });

  ipcMain.handle('mpv:screenshot', async (_, mode, debugMeta) => {
    return withReady(() => captureScreenshotWithAck(sanitizeScreenshotMode(mode), debugMeta), null);
  });

  ipcMain.handle('mpv:capture-paused-frame', async (_, mode) => {
    return withReady(() => capturePausedFrameSilent(sanitizeScreenshotMode(mode)), null);
  });

  ipcMain.handle('mpv:screenshot-open-folder', async () => {
    const dir = await withReady(() => mpv.getProperty('screenshot-directory'), null);
    const screenshotRoot = path.join(app.getPath('userData'), 'screenshots');
    if (typeof dir === 'string' && dir && fs.existsSync(dir) && isPathInside(dir, screenshotRoot)) {
      shell.openPath(dir);
    }
    return true;
  });

  // ── Thumbnail capture for seek-bar hover preview ──────
  ipcMain.handle('mpv:capture-thumbnail', async (_, time) => {
    return withReady(async () => {
      const mediaPath = mpv.filePath;
      if (!mediaPath) {
        seekdbg('skip: no media loaded');
        return null;
      }

      const safeTime = Math.max(0, Number(time) || 0);
      const rounded = Math.round(safeTime * 2) / 2;
      const cacheKey = `${mediaPath}|${rounded}`;
      seekdbg('request', { requested: safeTime, rounded });
      const cached = previewCache.get(cacheKey);
      if (cached) {
        seekdbg('cache hit', { rounded });
        return cached;
      }

      return queuePreview(async () => {
        const queuedCached = previewCache.get(cacheKey);
        if (queuedCached) {
          seekdbg('queue cache hit', { rounded });
          return queuedCached;
        }

        await ensurePreviewProcess();
        seekdbg('preview process ready');

        if (previewLoadedPath !== mediaPath) {
          seekdbg('loading preview media');
          await previewMpv.loadFile(mediaPath);
          await previewMpv.pause();
          previewLoadedPath = mediaPath;
        }

        await previewMpv.command('seek', rounded, 'absolute+keyframes');
        await new Promise((resolve) => setTimeout(resolve, 15));

        const safeName = crypto.createHash('sha1').update(cacheKey).digest('hex');
        const thumbPath = path.join(previewDir, `${safeName}.jpg`);
        seekdbg('thumb path', { rounded, thumbPath });

        if (!fs.existsSync(thumbPath)) {
          seekdbg('capture file', { rounded });
          await previewMpv.command('screenshot-to-file', thumbPath, 'video');
        } else {
          seekdbg('reuse file', { rounded });
        }

        const fileData = fs.readFileSync(thumbPath);
        const dataUrl = `data:image/jpeg;base64,${fileData.toString('base64')}`;
        const payload = { dataUrl, time: rounded };
        cacheSet(cacheKey, payload, thumbPath);
        seekdbg('done', { rounded, bytes: fileData.length });
        return payload;
      });
    }, null);
  });

  // ── Status query ───────────────────────────────────────
  ipcMain.handle('mpv:is-ready', async () => mpv.ready);
}

module.exports = { setupMpvIpc };
