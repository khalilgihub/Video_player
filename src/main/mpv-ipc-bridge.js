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

const SCREENSHOT_DEBUG = false;
function screenshotdbg(...args) {
  if (!SCREENSHOT_DEBUG) return;
  console.log('[SCREENSHOT][main]', ...args);
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {import('./mpv-process').MpvProcess} mpv
 */
function setupMpvIpc(win, mpv, options = {}) {
  const registerHandler = (channel, handler) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, handler);
  };

  const getTrackedFullscreen = () => {
    if (!win || win.isDestroyed()) return false;
    if (typeof win.__hybridFullscreenState === 'boolean') {
      return win.__hybridFullscreenState;
    }
    return !!win.isFullScreen();
  };

  const setTrackedFullscreen = (state) => {
    if (!win || win.isDestroyed()) return;
    if (typeof options?.setTrackedFullscreen === 'function') {
      return options.setTrackedFullscreen(win, state, 'mpv-ipc-bridge');
    }
    if (typeof win.__hybridSetTrackedFullscreen === 'function') {
      return win.__hybridSetTrackedFullscreen(win, state, 'mpv-ipc-bridge');
    }
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
  const previewDir = path.join(app.getPath('temp'), `hybrid-player-thumbs-${process.pid}`);
  const pausedFrameDir = path.join(app.getPath('temp'), `hybrid-player-paused-frames-${process.pid}`);
  const pausedFrameFiles = [];
  const PAUSED_FRAME_MAX_FILES = 12;
  const MAX_INLINE_PREVIEW_BYTES = 12 * 1024 * 1024;
  const NETWORK_MEDIA_PROTOCOLS = new Set(['http:', 'https:', 'rtsp:', 'rtmp:', 'rtmps:', 'srt:']);
  const LOCAL_MEDIA_EXTENSIONS = new Set([
    '.mp4', '.mkv', '.avi', '.mov', '.webm', '.flv', '.m4v', '.wmv', '.mpg', '.mpeg', '.ts', '.m2ts', '.mts', '.vob', '.ogv', '.3gp',
    '.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.opus', '.aiff', '.alac',
    '.m3u', '.m3u8', '.pls', '.mpd',
    '.jpg', '.jpeg', '.png', '.webp'
  ]);
  const LOCAL_SUBTITLE_EXTENSIONS = new Set([
    '.srt', '.ass', '.ssa', '.vtt', '.sub', '.idx', '.sup', '.smi', '.rt'
  ]);

  if (!fs.existsSync(previewDir)) {
    fs.mkdirSync(previewDir, { recursive: true });
  }

  const waitForMpvReady = (instance, timeoutMs = 4000) => new Promise((resolve, reject) => {
    if (instance.ready) {
      resolve(true);
      return;
    }

    let settled = false;
    let onReady = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (onReady) instance.removeListener('ready', onReady);
      reject(new Error('preview mpv not ready'));
    }, timeoutMs);

    onReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(true);
    };

    instance.once('ready', onReady);
  });

  const waitForMpvEvent = (instance, eventName, timeoutMs = 4000) => new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      instance.removeListener(eventName, onEvent);
      reject(new Error(`preview mpv ${eventName} timeout`));
    }, timeoutMs);

    const onEvent = (...args) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(args);
    };

    instance.once(eventName, onEvent);
  });

  const ensurePreviewProcess = async () => {
    if (!previewMpv.process) {
      previewMpv.spawn(null, {
        attachWindow: false,
        forceProcess: true,
        hwdec: 'no',
        screenshotDir: previewDir,
      });
    }
    await waitForMpvReady(previewMpv);
  };

  let inFlightPreview = null;
  let nextPendingPreview = null;

  previewMpv.on('exit', () => {
    seekdbg('preview mpv process exited');
    previewLoadedPath = null;
    inFlightPreview = null;
    if (nextPendingPreview) {
      const pending = nextPendingPreview;
      nextPendingPreview = null;
      pending.resolve(null);
    }
  });

  previewMpv.on('error', (err) => {
    console.warn('[mpv preview error]', err?.message || err);
    previewLoadedPath = null;
  });

  const seekPreviewFrame = async (time) => {
    const frameReady = waitForMpvEvent(previewMpv, 'playback-restart', 1200).catch(() => null);
    await Promise.all([
      previewMpv.command('seek', time, 'absolute'),
      frameReady,
    ]);
  };

  const stagedUndoMap = new Map();

  if (win && !win.isDestroyed()) {
    win.on('closed', () => {
      try {
        previewMpv.destroy();
      } catch {}
      for (const filePath of previewCacheFiles.values()) {
        try { fs.unlinkSync(filePath); } catch {}
      }
      previewCache.clear();
      previewCacheFiles.clear();
      try { fs.rmSync(previewDir, { recursive: true, force: true }); } catch {}
      for (const frameFile of pausedFrameFiles) {
        try { fs.unlinkSync(frameFile); } catch {}
      }
      pausedFrameFiles.length = 0;
      try { fs.rmSync(pausedFrameDir, { recursive: true, force: true }); } catch {}
      for (const tempPath of stagedUndoMap.keys()) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
      stagedUndoMap.clear();
      try {
        const undoDir = path.join(app.getPath('temp'), `hybrid_screenshot_undo_${process.pid}`);
        fs.rmdirSync(undoDir);
      } catch {}
    });
  }

  const queuePreview = (task) => {
    if (!inFlightPreview) {
      inFlightPreview = (async () => {
        try {
          return await task();
        } finally {
          inFlightPreview = null;
          if (nextPendingPreview) {
            const next = nextPendingPreview;
            nextPendingPreview = null;
            queuePreview(next.task).then(next.resolve, next.reject);
          }
        }
      })();
      return inFlightPreview;
    }

    return new Promise((resolve, reject) => {
      if (nextPendingPreview) {
        nextPendingPreview.resolve(null);
      }
      nextPendingPreview = { task, resolve, reject };
    });
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
    let onReady = null;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (onReady) mpv.removeListener('ready', onReady);
      reject(new Error('mpv not ready'));
    }, timeoutMs);

    onReady = () => {
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
    'pause',
    'time-pos',
    'duration',
    'drop-frame-count',
    'estimated-vf-fps',
    'video-bitrate',
    'video-codec',
    'demuxer-cache-state',
    'sub-delay',
    'sub-visibility',
    'sub',
    'volume',
    'mute',
    'speed',
    'audio-delay',
    'aid',
    'vid',
    'track-list',
    'chapter-list',
    'chapter',
    'volume-max',
  ]);

  const rendererSetPropertyAllowlist = new Set([
    'vid',
    'ytdl-format',
    'af',
    'sub-font-size',
    'sub-font',
    'sub-color',
    'sub-back-color',
    'loop-file',
    'loop-playlist',
    'options/start',
  ]);

  const seekFlagsAllowlist = new Set([
    'absolute',
    'absolute+exact',
    'relative',
    'relative+exact',
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
      let resolved = path.resolve(source);
      if (!resolved || resolved.includes('\0')) return null;
      if (allowedExtensions && !allowedExtensions.has(path.extname(resolved).toLowerCase())) return null;
      if (process.platform === 'win32' && resolved.length >= 260 && !resolved.startsWith('\\\\?\\')) {
        resolved = `\\\\?\\${path.win32.normalize(resolved)}`;
      }
      if (mustExist) {
        const stat = fs.statSync(resolved);
        if (!stat.isFile() || stat.size === 0) return null;
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
      case 'loop-file':
      case 'loop-playlist':
        return (value === 'inf' || value === 'no' || value === 'force') ? value : null;
      case 'options/start': {
        // Start position applied to the next loaded file. '0' means normal
        // playback from the beginning; otherwise a bounded second offset.
        if (value === '0' || value === '') return '0';
        const seconds = Number(value);
        return Number.isFinite(seconds) && seconds > 0 && seconds <= 30 * 24 * 60 * 60
          ? String(seconds)
          : null;
      }
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

  const buildInlinePreviewDataUrl = async (filePath, mimeType, maxWaitMs = 500, { silent = false } = {}) => {
    const startTime = Date.now();
    let attempts = 0;
    while (Date.now() - startTime < maxWaitMs) {
      attempts++;
      try {
        if (fs.existsSync(filePath)) {
          const stat = fs.statSync(filePath);
          if (stat.isFile() && stat.size > 0 && stat.size <= MAX_INLINE_PREVIEW_BYTES) {
            const raw = fs.readFileSync(filePath);
            if (raw && raw.length > 0) {
              if (!silent) {
                console.log(`[SCREENSHOT][main] Generated inline preview base64 (${raw.length} bytes, took ${Date.now() - startTime}ms after ${attempts} checks)`);
              }
              return `data:${mimeType};base64,${raw.toString('base64')}`;
            }
          }
        }
      } catch (_) {
        // file writing in progress
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    if (!silent) {
      console.warn(`[SCREENSHOT][main] Timed out waiting for screenshot file at ${filePath} (${attempts} attempts)`);
    }
    return null;
  };

  const buildScreenshotPayload = async (filePath, { silent = false } = {}) => {
    const mimeType = getImageMimeType(filePath);
    const normalizedPath = path.resolve(filePath).replace(/\\/g, '/');
    const fileUrl = `local-file:///${encodeURI(normalizedPath).replace(/\?/g, '%3F').replace(/#/g, '%23')}`;
    const previewDataUrl = await buildInlinePreviewDataUrl(filePath, mimeType, 500, { silent });
    return {
      filePath,
      mimeType,
      previewUrl: fileUrl,
      previewDataUrl: previewDataUrl || undefined,
    };
  };

  const emitScreenshotReady = (payload) => {
    if (!win || win.isDestroyed()) return;
    console.log('[SCREENSHOT][main] Emitting screenshot-ready event with payload:', {
      filePath: payload.filePath,
      hasInlineData: !!payload.previewDataUrl,
      dataUrlLength: payload.previewDataUrl ? payload.previewDataUrl.length : 0,
      previewUrl: payload.previewUrl,
    });
    win.webContents.send('screenshot-ready', payload);
  };

  const captureScreenshotWithAck = async (mode, debugMeta = null) => {
    const rawFormat = typeof debugMeta === 'string'
      ? debugMeta
      : (typeof debugMeta?.format === 'string' ? debugMeta.format : null);
    const formatOverride = rawFormat && ['png', 'jpg', 'jpeg', 'webp'].includes(rawFormat.trim().toLowerCase())
      ? rawFormat.trim().toLowerCase()
      : null;
    console.log('[SCREENSHOT][main] Capture requested, mode:', mode, 'formatOverride:', formatOverride);
    const filePath = await mpv.screenshot(mode || 'video', formatOverride);
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('Screenshot path is invalid');
    }
    console.log('[SCREENSHOT][main] mpv screenshot written to:', filePath);

    const payload = await buildScreenshotPayload(filePath);
    if (formatOverride === 'png') {
      payload.badgeText = 'PNG';
    }
    emitScreenshotReady(payload);
    return payload;
  };

  const capturePausedFrameSilent = async (mode = 'subtitles') => {
    if (!fs.existsSync(pausedFrameDir)) {
      try { fs.mkdirSync(pausedFrameDir, { recursive: true }); } catch {}
    }
    const stamp = Date.now();
    const nonce = crypto.randomBytes(8).toString('hex');
    const framePath = path.join(pausedFrameDir, `pid-${process.pid}-paused-frame-${stamp}-${nonce}.jpg`);
    await mpv.command('screenshot-to-file', framePath, mode || 'subtitles');
    if (!fs.existsSync(framePath)) {
      throw new Error('Paused frame capture failed');
    }

    pausedFrameFiles.push(framePath);
    while (pausedFrameFiles.length > PAUSED_FRAME_MAX_FILES) {
      const stale = pausedFrameFiles.shift();
      if (!stale) continue;
      fs.unlink(stale, () => {});
    }

    const payload = await buildScreenshotPayload(framePath, { silent: true });
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

    const isAllowedWhileLocked =
      cmd === 'hybrid-unlock-ui' ||
      cmd === 'hybrid-screenshot' ||
      cmd === 'hybrid-screenshot-png' ||
      cmd === 'hybrid-mouse-mid' ||
      cmd === 'hybrid-mouse-back' ||
      cmd === 'hybrid-mouse-forward';

    if (getUiLocked() && !isAllowedWhileLocked) {
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

      case 'hybrid-screenshot':
        if (win && !win.isDestroyed() && mpv.filePath) {
          win.webContents.send('menu-action', 'screenshot');
        }
        break;

      case 'hybrid-screenshot-png':
        if (win && !win.isDestroyed() && mpv.filePath) {
          win.webContents.send('menu-action', 'screenshot-png');
        }
        break;

      case 'hybrid-mouse-mid':
      case 'hybrid-mouse-back':
      case 'hybrid-mouse-forward': {
        const btnMap = {
          'hybrid-mouse-mid': 1,
          'hybrid-mouse-back': 3,
          'hybrid-mouse-forward': 4,
        };
        const rawPref = global.__hybridDb?.preferences?.screenshotMouseButton;
        const targetBtn = rawPref !== undefined ? Number(rawPref) : 3;
        if (
          btnMap[cmd] === targetBtn &&
          win &&
          !win.isDestroyed() &&
          mpv.filePath
        ) {
          win.webContents.send('menu-action', 'screenshot');
        }
        break;
      }

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
        if (win && !win.isDestroyed()) {
          if (win.__hybridPreventExitFullscreen) {
            win.webContents.send('keyboard-escape');
            break;
          }
          if (getTrackedFullscreen()) {
            fsdbg('action exit fullscreen');
            setTrackedFullscreen(false);
            fsdbg('action exit fullscreen done', { to: false });
          } else {
            win.webContents.send('keyboard-escape');
          }
        }
        break;

      /* ── Play / Pause ───────────────────────────────── */
      case 'hybrid-toggle-play':
        if (mpv.ready) mpv.togglePause();
        break;

      /* ── Mouse click (instant when dblclick disabled, debounced when enabled) */
      case 'hybrid-mouse-click': {
        fsdbg('action mouse click');
        if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.focus();
        }
        const dblClickEnabled = global.__hybridDb?.preferences?.doubleClickFullscreen !== false;
        if (!dblClickEnabled) {
          if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
          if (mpv.ready) mpv.togglePause();
          break;
        }
        if (_clickTimer) clearTimeout(_clickTimer);
        _clickTimer = setTimeout(() => {
          if (mpv.ready) mpv.togglePause();
          _clickTimer = null;
        }, 160);
        break;
      }

      /* ── Audio Track / Voice Switcher ───────────────── */
      case 'hybrid-cycle-audio':
        if (win && !win.isDestroyed()) {
          win.webContents.send('menu-action', 'cycle-audio');
        }
        break;

      case 'hybrid-mouse-dblclick': {
        fsdbg('action mouse dblclick', { from: getTrackedFullscreen() });
        if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
          win.webContents.focus();
        }
        const dblClickEnabled = global.__hybridDb?.preferences?.doubleClickFullscreen !== false;
        if (!dblClickEnabled) {
          break;
        }
        // Cancel the pending single-click play toggle
        if (_clickTimer) { clearTimeout(_clickTimer); _clickTimer = null; }
        if (win && !win.isDestroyed()) {
          const next = !getTrackedFullscreen();
          setTrackedFullscreen(next);
          fsdbg('action mouse dblclick done', { to: next });
        }
        break;
      }

      /* ── Seek ───────────────────────────────────────── */
      case 'hybrid-seek-back-5':
        if (mpv.ready) {
          const step = Number(global.__hybridDb?.preferences?.seekStep) || 5;
          mpv.seekRelative(-step);
          if (win && !win.isDestroyed()) {
            win.webContents.send('mpv:event', 'skip-osd', { seconds: -step });
          }
        }
        break;
      case 'hybrid-seek-forward-5':
        if (mpv.ready) {
          const step = Number(global.__hybridDb?.preferences?.seekStep) || 5;
          mpv.seekRelative(step);
          if (win && !win.isDestroyed()) {
            win.webContents.send('mpv:event', 'skip-osd', { seconds: step });
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
  registerHandler('mpv:command', async (_, ...args) => {
    const cleanArgs = sanitizeRendererMpvCommand(args);
    if (!cleanArgs) return null;
    if (cleanArgs[0] === 'loadfile' && cleanArgs[2] === 'replace') {
      mpv.filePath = cleanArgs[1];
    }
    return withReady(() => mpv.command(...cleanArgs), null);
  });

  registerHandler('mpv:set-property', async (_, name, value) => {
    const cleanName = sanitizeMpvString(name, 80);
    const cleanValue = sanitizeMpvPropertyValue(cleanName, value);
    if (cleanValue === null) return false;
    return withReady(() => mpv.setProperty(cleanName, cleanValue), false);
  });

  registerHandler('mpv:get-property', async (_, name) => {
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
  registerHandler('mpv:load-file', async (_, filePath) => {
    if (typeof filePath === 'string' && isLikelyAbsoluteLocalPath(filePath)) {
      try {
        let resolved = path.resolve(filePath);
        if (process.platform === 'win32' && resolved.length >= 260 && !resolved.startsWith('\\\\?\\')) {
          resolved = `\\\\?\\${path.win32.normalize(resolved)}`;
        }
        if (fs.existsSync(resolved)) {
          const stat = fs.statSync(resolved);
          if (stat.isFile() && stat.size === 0) {
            return { success: false, error: 'empty_file' };
          }
        }
      } catch (_) {}
    }

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
    return result !== false;
  });

  // ── Playback ───────────────────────────────────────────
  registerHandler('mpv:play', async () => withReady(() => mpv.play(), false));
  registerHandler('mpv:pause', async () => withReady(() => mpv.pause(), false));
  registerHandler('mpv:toggle-pause', async () => withReady(() => mpv.togglePause(), false));
  registerHandler('mpv:stop', async () => withReady(() => mpv.stop(), false));
  registerHandler('mpv:seek', async (_, time, flags) => {
    const safeTime = sanitizeNumber(time, 0, 30 * 24 * 60 * 60, null);
    const safeFlags = seekFlagsAllowlist.has(flags) ? flags : 'absolute';
    if (safeTime === null) return false;
    return withReady(() => mpv.seek(safeTime, safeFlags), false);
  });
  registerHandler('mpv:seek-relative', async (_, sec) => {
    const safeSeconds = sanitizeNumber(sec, -24 * 60 * 60, 24 * 60 * 60, null);
    return safeSeconds === null ? false : withReady(() => mpv.seekRelative(safeSeconds), false);
  });
  registerHandler('mpv:seek-percent', async (_, pct) => {
    const safePercent = sanitizeNumber(pct, 0, 100, null);
    return safePercent === null ? false : withReady(() => mpv.seekPercent(safePercent), false);
  });

  // ── Volume / speed ─────────────────────────────────────
  registerHandler('mpv:set-volume', async (_, v) => {
    const safeVolume = sanitizeNumber(v, 0, 200, null);
    return safeVolume === null ? false : withReady(() => mpv.setVolume(safeVolume), false);
  });
  registerHandler('mpv:set-mute', async (_, m) => withReady(() => mpv.setMute(!!m), false));
  registerHandler('mpv:set-speed', async (_, s) => {
    const safeSpeed = sanitizeNumber(s, 0.1, 16, null);
    return safeSpeed === null ? false : withReady(() => mpv.setSpeed(safeSpeed), false);
  });

  // ── Subtitles ──────────────────────────────────────────
  registerHandler('mpv:set-sub', async (_, id) => {
    const safeId = Number.isInteger(Number(id)) ? Number(id) : null;
    return safeId === null ? false : withReady(() => mpv.setSub(safeId), false);
  });
  registerHandler('mpv:set-sub-delay', async (_, sec) => {
    const safeDelay = sanitizeNumber(sec, -600, 600, null);
    return safeDelay === null ? false : withReady(() => mpv.setSubDelay(safeDelay), false);
  });
  registerHandler('mpv:set-sub-visibility', async (_, vis) => withReady(() => mpv.setSubVisibility(vis), false));
  registerHandler('mpv:add-sub-file', async (_, p) => {
    const subtitlePath = sanitizeMediaSource(p, {
      mustExist: true,
      allowedExtensions: LOCAL_SUBTITLE_EXTENSIONS,
    });
    return subtitlePath ? withReady(() => mpv.addSubFile(subtitlePath), false) : false;
  });

  // ── Audio tracks ───────────────────────────────────────
  registerHandler('mpv:set-audio', async (_, id) => {
    const safeId = Number.isInteger(Number(id)) ? Number(id) : null;
    return safeId === null ? false : withReady(() => mpv.setAudio(safeId), false);
  });
  registerHandler('mpv:set-audio-delay', async (_, sec) => {
    const safeDelay = sanitizeNumber(sec, -600, 600, null);
    return safeDelay === null ? false : withReady(() => mpv.setAudioDelay(safeDelay), false);
  });

  // ── Chapters ───────────────────────────────────────────
  registerHandler('mpv:set-chapter', async (_, idx) => {
    const safeIndex = Number.isInteger(Number(idx)) ? Number(idx) : null;
    return safeIndex === null ? false : withReady(() => mpv.setChapter(safeIndex), false);
  });

  // ── Frame stepping ─────────────────────────────────────
  registerHandler('mpv:frame-step', async () => withReady(() => mpv.frameStep(), false));
  registerHandler('mpv:frame-back-step', async () => withReady(() => mpv.frameBackStep(), false));

  // ── A-B loop ───────────────────────────────────────────
  registerHandler('mpv:set-ab-loop-a', async (_, t) => {
    const safeTime = sanitizeNumber(t, 0, 30 * 24 * 60 * 60, null);
    return safeTime === null ? false : withReady(() => mpv.setABLoopA(safeTime), false);
  });
  registerHandler('mpv:set-ab-loop-b', async (_, t) => {
    const safeTime = sanitizeNumber(t, 0, 30 * 24 * 60 * 60, null);
    return safeTime === null ? false : withReady(() => mpv.setABLoopB(safeTime), false);
  });
  registerHandler('mpv:clear-ab-loop', async () => withReady(() => mpv.clearABLoop(), false));

  // ── Screenshot ─────────────────────────────────────────
  registerHandler('mpv:screenshot', async (_, mode, debugMeta) => {
    return withReady(() => captureScreenshotWithAck(sanitizeScreenshotMode(mode), debugMeta), null);
  });

  registerHandler('mpv:screenshot-burst-frame', async (_, sessionId, seqNum, mode) => {
    const safeSessionId = typeof sessionId === 'string' ? sessionId.replace(/[^a-zA-Z0-9_-]/g, '') : 'session';
    const safeSeq = Number.isInteger(Number(seqNum)) ? Number(seqNum) : 1;
    return withReady(() => mpv.screenshotBurstFrame(safeSessionId, safeSeq, sanitizeScreenshotMode(mode)), null);
  });

  registerHandler('mpv:finalize-burst-session', async (_, sessionId, totalCount) => {
    const safeSessionId = typeof sessionId === 'string' ? sessionId.replace(/[^a-zA-Z0-9_-]/g, '') : 'session';
    const safeCount = Number.isInteger(Number(totalCount)) ? Number(totalCount) : 0;
    return withReady(() => mpv.finalizeBurstSession(safeSessionId, safeCount), { inSubfolder: false, count: 0, folderName: '' });
  });

  registerHandler('mpv:capture-paused-frame', async (_, mode = 'subtitles') => {
    return withReady(() => capturePausedFrameSilent(sanitizeScreenshotMode(mode || 'subtitles')), null);
  });

  registerHandler('mpv:set-screenshot-dir', async (_, dir) => {
    if (dir == null || typeof dir === 'string') {
      return mpv.setScreenshotDir(typeof dir === 'string' ? dir.trim() : '');
    }
    return false;
  });

  registerHandler('mpv:get-screenshot-dir', async () => {
    return typeof mpv.getScreenshotDir === 'function' ? mpv.getScreenshotDir() : (mpv._screenshotDir || '');
  });

  registerHandler('mpv:set-screenshot-format', async (_, fmt) => {
    if (typeof fmt === 'string' && fmt.trim()) {
      return mpv.setScreenshotFormat(fmt.trim());
    }
    return false;
  });

  registerHandler('mpv:get-screenshot-format', async () => {
    return typeof mpv.getScreenshotFormat === 'function' ? mpv.getScreenshotFormat() : (mpv._screenshotFormat || 'jpg');
  });

  registerHandler('mpv:set-auto-organize-screenshots', async (_, enabled) => {
    if (typeof mpv.setAutoOrganizeScreenshots === 'function') {
      mpv.setAutoOrganizeScreenshots(enabled !== false);
      return true;
    }
    return false;
  });

  registerHandler('mpv:get-effective-screenshot-dir', async () => {
    if (typeof mpv.getEffectiveScreenshotDir === 'function') {
      return await mpv.getEffectiveScreenshotDir();
    }
    return typeof mpv.getScreenshotDir === 'function' ? mpv.getScreenshotDir() : (mpv._screenshotDir || '');
  });

  registerHandler('mpv:screenshot-open-folder', async () => {
    let dir = '';
    if (typeof mpv.getEffectiveScreenshotDir === 'function') {
      dir = await mpv.getEffectiveScreenshotDir();
    }
    if (!dir || !fs.existsSync(dir)) {
      dir = (typeof mpv.getScreenshotDir === 'function' ? mpv.getScreenshotDir() : mpv._screenshotDir)
        || await withReady(() => mpv.getProperty('screenshot-directory'), null);
    }
    if (typeof dir === 'string' && dir && fs.existsSync(dir)) {
      shell.openPath(dir);
      return true;
    }
    return false;
  });

  const getUndoDir = () => {
    const undoDir = path.join(app.getPath('temp'), `hybrid_screenshot_undo_${process.pid}`);
    if (!fs.existsSync(undoDir)) {
      try { fs.mkdirSync(undoDir, { recursive: true }); } catch {}
    }
    return undoDir;
  };

  const isSubPath = (parentDir, childPath) => {
    if (!parentDir || !childPath) return false;
    const rel = path.relative(path.resolve(parentDir), path.resolve(childPath));
    return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
  };

  const isAllowedScreenshotPath = async (targetPath) => {
    if (!targetPath || typeof targetPath !== 'string') return false;
    const ext = path.extname(targetPath).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      return false;
    }
    const cleanTarget = path.resolve(targetPath.trim());
    const tempBase = app.getPath('temp');
    const baseDir = typeof mpv.getScreenshotDir === 'function' ? mpv.getScreenshotDir() : mpv._screenshotDir;
    if (baseDir && isSubPath(baseDir, cleanTarget)) {
      return true;
    }
    const candidateDirs = [
      path.join(tempBase, `hybrid-player-thumbs-${process.pid}`),
      path.join(tempBase, 'hybrid-player-thumbs'),
      path.join(tempBase, `hybrid-player-paused-frames-${process.pid}`),
      path.join(tempBase, 'hybrid-player-paused-frames'),
      path.join(tempBase, `hybrid_screenshot_undo_${process.pid}`),
      path.join(tempBase, 'hybrid_screenshot_undo'),
    ];
    if (candidateDirs.some((dir) => isSubPath(dir, cleanTarget))) {
      return true;
    }
    if (typeof mpv.getEffectiveScreenshotDir === 'function') {
      try {
        const effectiveDir = await Promise.race([
          mpv.getEffectiveScreenshotDir(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 500))
        ]);
        if (effectiveDir && isSubPath(effectiveDir, cleanTarget)) {
          return true;
        }
      } catch {}
    }
    return false;
  };

  registerHandler('mpv:delete-screenshot', async (_, filePath) => {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'Invalid file path' };
    }

    const cleanPath = path.resolve(filePath.trim());

    if (!(await isAllowedScreenshotPath(cleanPath))) {
      return { success: false, error: 'Access denied: Path is outside screenshot directories or has invalid extension' };
    }

    if (!fs.existsSync(cleanPath)) {
      return { success: false, error: 'File does not exist' };
    }

    try {
      // Create thumbnail base64 data for visual in-card deletion animation
      let previewDataUrl = '';
      try {
        const stat = fs.statSync(cleanPath);
        if (stat.size <= MAX_INLINE_PREVIEW_BYTES) {
          const mimeType = getImageMimeType(cleanPath);
          const buffer = fs.readFileSync(cleanPath);
          previewDataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
        }
      } catch (_) {}

      // Move file to session undo staging folder so it can be restored on 'Z'
      const undoDir = getUndoDir();
      const fileName = path.basename(cleanPath);
      const tempPath = path.join(undoDir, `pid-${process.pid}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}_${fileName}`);

      try {
        fs.renameSync(cleanPath, tempPath);
      } catch (moveErr) {
        fs.copyFileSync(cleanPath, tempPath);
        fs.unlinkSync(cleanPath);
      }

      // Record staged item to prevent unauthorized restoration
      stagedUndoMap.set(tempPath, {
        originalPath: cleanPath,
        stagedAt: Date.now(),
      });

      screenshotdbg('Staged screenshot for undo:', cleanPath, '->', tempPath);
      return {
        success: true,
        filePath: cleanPath,
        tempPath,
        fileName,
        previewDataUrl,
      };
    } catch (err) {
      console.error('[SCREENSHOT][main] Failed to delete screenshot:', err);
      return { success: false, error: err.message };
    }
  });

  registerHandler('mpv:restore-screenshot', async (_, payload) => {
    const tempPath = payload?.tempPath ? path.resolve(String(payload.tempPath).trim()) : '';
    const originalPath = (payload?.originalPath || payload?.filePath)
      ? path.resolve(String(payload.originalPath || payload.filePath).trim())
      : '';
    if (!tempPath || !originalPath) {
      return { success: false, error: 'Missing tempPath or originalPath' };
    }

    const undoDir = getUndoDir();
    if (!isSubPath(undoDir, tempPath)) {
      return { success: false, error: 'Access denied: Staged file must reside within undo directory' };
    }

    const staged = stagedUndoMap.get(tempPath);
    if (!staged || staged.originalPath !== originalPath) {
      return { success: false, error: 'Access denied: Staged file does not match recorded deletion target' };
    }

    if (!(await isAllowedScreenshotPath(originalPath))) {
      return { success: false, error: 'Access denied: Restoration target is outside screenshot directories' };
    }

    if (!fs.existsSync(tempPath)) {
      return { success: false, error: 'Staged file does not exist' };
    }

    try {
      const parentDir = path.dirname(originalPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      try {
        fs.renameSync(tempPath, originalPath);
      } catch (moveErr) {
        fs.copyFileSync(tempPath, originalPath);
        fs.unlinkSync(tempPath);
      }

      stagedUndoMap.delete(tempPath);

      let previewDataUrl = '';
      try {
        const stat = fs.statSync(originalPath);
        if (stat.size <= MAX_INLINE_PREVIEW_BYTES) {
          const mimeType = getImageMimeType(originalPath);
          const buffer = fs.readFileSync(originalPath);
          previewDataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
        }
      } catch (_) {}

      screenshotdbg('Restored screenshot:', originalPath);
      return {
        success: true,
        filePath: originalPath,
        fileName: path.basename(originalPath),
        previewDataUrl,
      };
    } catch (err) {
      console.error('[SCREENSHOT][main] Failed to restore screenshot:', err);
      return { success: false, error: err.message };
    }
  });

  // ── Thumbnail capture for seek-bar hover preview ──────
  registerHandler('mpv:capture-thumbnail', async (_, time) => {
    return withReady(async () => {
      const mediaPath = mpv.filePath;
      if (!mediaPath) {
        seekdbg('skip: no media loaded');
        return null;
      }

      // Local media only for thumbnail preview
      if (!isLikelyAbsoluteLocalPath(mediaPath) || !fs.existsSync(mediaPath)) {
        seekdbg('skip: not a valid local media file');
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
          previewLoadedPath = null;
          const fileLoaded = waitForMpvEvent(previewMpv, 'file-loaded', 6000).catch(() => null);
          await Promise.all([previewMpv.loadFile(mediaPath), fileLoaded]);
          await previewMpv.pause().catch(() => {});
          previewLoadedPath = mediaPath;
        }

        await seekPreviewFrame(rounded);

        const safeName = crypto.createHash('sha1').update(cacheKey).digest('hex');
        const thumbPath = path.join(previewDir, `${safeName}.jpg`);
        seekdbg('thumb path', { rounded, thumbPath });

        if (!fs.existsSync(thumbPath)) {
          seekdbg('capture file', { rounded });
          await previewMpv.command('screenshot-to-file', thumbPath, 'video').catch(() => null);

          let retries = 15;
          while (!fs.existsSync(thumbPath) && retries-- > 0) {
            await new Promise((r) => setTimeout(r, 20));
          }
        } else {
          seekdbg('reuse file', { rounded });
        }

        if (!fs.existsSync(thumbPath)) {
          seekdbg('capture file missing after screenshot', { thumbPath });
          return null;
        }

        const fileData = fs.readFileSync(thumbPath);
        const dataUrl = `data:image/jpeg;base64,${fileData.toString('base64')}`;
        const payload = { dataUrl, time: rounded };
        cacheSet(cacheKey, payload, thumbPath);
        seekdbg('done', { rounded, bytes: fileData.length });
        return payload;
      }).catch((err) => {
        seekdbg('preview capture task failed', err?.message || err);
        return null;
      });
    }, null);
  });

  // ── Status query ───────────────────────────────────────
  registerHandler('mpv:is-ready', async () => mpv.ready);
}

module.exports = { setupMpvIpc };
