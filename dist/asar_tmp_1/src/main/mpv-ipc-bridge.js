/**
 * Hybrid Player - mpv IPC Bridge (Main Process)
 * Registers ipcMain handlers that forward commands from the renderer
 * to the MpvProcess singleton, and pushes mpv events back.
 */

const { ipcMain, shell, app } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { MpvProcess } = require('./mpv-process');

// TEMP DEBUG: fullscreen/input tracing
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
  const previewDir = path.join(app.getPath('temp'), 'hybrid-player-thumbs');
  const pausedFrameDir = path.join(app.getPath('temp'), 'hybrid-player-paused-frames');
  const pausedFrameFiles = [];
  const PAUSED_FRAME_MAX_FILES = 12;

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
    });
  }

  const queuePreview = (task) => {
    previewQueue = previewQueue.then(task, task);
    return previewQueue;
  };

  const cacheSet = (key, value) => {
    previewCache.set(key, value);
    if (previewCache.size > 180) {
      const oldest = previewCache.keys().next().value;
      previewCache.delete(oldest);
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

  const getImageMimeType = (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    return 'image/png';
  };

  const buildScreenshotPayload = (filePath) => {
    const mimeType = getImageMimeType(filePath);
    const normalizedPath = path.resolve(filePath).replace(/\\/g, '/');
    const fileUrl = `file:///${encodeURI(normalizedPath)}`;
    return {
      filePath,
      mimeType,
      previewUrl: fileUrl,
    };
  };

  const buildInlinePreviewDataUrl = (filePath, mimeType) => {
    try {
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
    const nonce = Math.floor(Math.random() * 1e9);
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
    return withReady(() => mpv.command(...args), null);
  });

  ipcMain.handle('mpv:set-property', async (_, name, value) => {
    return withReady(() => mpv.setProperty(name, value), false);
  });

  ipcMain.handle('mpv:get-property', async (_, name) => {
    try {
      return await withReady(() => mpv.getProperty(name), null);
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes('property unavailable')) {
        ytdbg('mpv:get-property unavailable', { name });
        return null;
      }
      throw err;
    }
  });

  // ── File loading ───────────────────────────────────────
  ipcMain.handle('mpv:load-file', async (_, filePath) => {
    playdbg('load-file request', { filePath });
    await waitForReady(7000);
    const result = await mpv.loadFile(filePath);
    playdbg('load-file command sent', { filePath, result });
    setTimeout(() => { void logPlaybackSnapshot('probe:1s', { filePath }); }, 1000);
    setTimeout(() => { void logPlaybackSnapshot('probe:3s', { filePath }); }, 3000);
    return result;
  });

  // ── Playback ───────────────────────────────────────────
  ipcMain.handle('mpv:play', async () => withReady(() => mpv.play(), false));
  ipcMain.handle('mpv:pause', async () => withReady(() => mpv.pause(), false));
  ipcMain.handle('mpv:toggle-pause', async () => withReady(() => mpv.togglePause(), false));
  ipcMain.handle('mpv:stop', async () => withReady(() => mpv.stop(), false));
  ipcMain.handle('mpv:seek', async (_, time, flags) => withReady(() => mpv.seek(time, flags), false));
  ipcMain.handle('mpv:seek-relative', async (_, sec) => withReady(() => mpv.seekRelative(sec), false));
  ipcMain.handle('mpv:seek-percent', async (_, pct) => withReady(() => mpv.seekPercent(pct), false));

  // ── Volume / speed ─────────────────────────────────────
  ipcMain.handle('mpv:set-volume', async (_, v) => withReady(() => mpv.setVolume(v), false));
  ipcMain.handle('mpv:set-mute', async (_, m) => withReady(() => mpv.setMute(m), false));
  ipcMain.handle('mpv:set-speed', async (_, s) => withReady(() => mpv.setSpeed(s), false));

  // ── Subtitles ──────────────────────────────────────────
  ipcMain.handle('mpv:set-sub', async (_, id) => withReady(() => mpv.setSub(id), false));
  ipcMain.handle('mpv:set-sub-delay', async (_, sec) => withReady(() => mpv.setSubDelay(sec), false));
  ipcMain.handle('mpv:set-sub-visibility', async (_, vis) => withReady(() => mpv.setSubVisibility(vis), false));
  ipcMain.handle('mpv:add-sub-file', async (_, p) => withReady(() => mpv.addSubFile(p), false));

  // ── Audio tracks ───────────────────────────────────────
  ipcMain.handle('mpv:set-audio', async (_, id) => withReady(() => mpv.setAudio(id), false));

  // ── Chapters ───────────────────────────────────────────
  ipcMain.handle('mpv:set-chapter', async (_, idx) => withReady(() => mpv.setChapter(idx), false));

  // ── Frame stepping ─────────────────────────────────────
  ipcMain.handle('mpv:frame-step', async () => withReady(() => mpv.frameStep(), false));
  ipcMain.handle('mpv:frame-back-step', async () => withReady(() => mpv.frameBackStep(), false));

  // ── A-B loop ───────────────────────────────────────────
  ipcMain.handle('mpv:set-ab-loop-a', async (_, t) => withReady(() => mpv.setABLoopA(t), false));
  ipcMain.handle('mpv:set-ab-loop-b', async (_, t) => withReady(() => mpv.setABLoopB(t), false));
  ipcMain.handle('mpv:clear-ab-loop', async () => withReady(() => mpv.clearABLoop(), false));

  // ── Screenshot ─────────────────────────────────────────
  ipcMain.handle('mpv:screenshot-fast', async (_, mode, debugMeta) => {
    return withReady(() => captureScreenshotWithAck(mode, debugMeta), null);
  });

  ipcMain.handle('mpv:screenshot', async (_, mode, debugMeta) => {
    return withReady(() => captureScreenshotWithAck(mode, debugMeta), null);
  });

  ipcMain.handle('mpv:capture-paused-frame', async (_, mode) => {
    return withReady(() => capturePausedFrameSilent(mode || 'video'), null);
  });

  ipcMain.handle('mpv:screenshot-open-folder', async () => {
    const dir = await withReady(() => mpv.getProperty('screenshot-directory'), null);
    if (typeof dir === 'string' && dir && fs.existsSync(dir)) {
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
        cacheSet(cacheKey, payload);
        seekdbg('done', { rounded, bytes: fileData.length });
        return payload;
      });
    }, null);
  });

  // ── Status query ───────────────────────────────────────
  ipcMain.handle('mpv:is-ready', async () => mpv.ready);
}

module.exports = { setupMpvIpc };
