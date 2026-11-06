/**
 * Hybrid Player - mpv Process Manager
 * Spawns and manages the mpv child process with IPC socket communication.
 *
 * mpv is launched with --wid=<HWND> so it renders directly into the
 * Electron BrowserWindow's native handle.  All control goes through the
 * JSON-based IPC protocol over a Windows named pipe.
 */

const { spawn } = require('child_process');
const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const crypto = require('crypto');
const EventEmitter = require('events');
const { resolveMpvBinary, resolveYtDlpBinary, resolveLibMpv } = require('./binary-resolver');
const { resolveScreenshotSubfolder } = require('./media-folder-resolver');
const { LibmpvContext, koffi } = require('./libmpv-koffi');
const { dxBridgeManager } = require('./dx-bridge-wrapper');
const { YTDLP_EXTRACTOR_ARGS } = require('./youtube');

// Fullscreen/input trace logging.
const FS_DEBUG = false;
function fsdbg(...args) {
  if (!FS_DEBUG) return;
  console.log('[FSDBG][mpv-process]', ...args);
}

const MPV_LOG_DEBUG = false;
function mpverr(...args) {
  console.error('[MPV ERROR]', ...args);
}
function mpvlog(...args) {
  if (!MPV_LOG_DEBUG) return;
  console.log('[MPV LOG]', ...args);
}

// ── Pipe / socket path ──────────────────────────────────
let PIPE_COUNTER = 0;

function makePipeName(prefix = 'hybrid-mpv-ipc') {
  PIPE_COUNTER += 1;
  return `\\\\.\\pipe\\${prefix}-${process.pid}-${PIPE_COUNTER}`;
}

class MpvProcess extends EventEmitter {
  constructor(options = {}) {
    super();
    this.setMaxListeners(50);
    this.options = options;
    /** @type {import('child_process').ChildProcess|null} */
    this.process = null;
    /** @type {net.Socket|null} */
    this.socket = null;
    /** @type {import('./libmpv-koffi').LibmpvContext|null} */
    this._libmpv = null;
    this.inProcess = false;
    this._ownsDxBridge = false;

    // State
    this.ready = false;
    this.filePath = null;
    this._requestId = 0;
    this._pending = new Map();          // request_id → { resolve, reject, timer }
    this._observedProps = new Map();     // id → property name
    this._nextObsId = 1;
    this._recvBuf = '';                 // partial-line buffer
    this.pipeName = options.pipeName || makePipeName(options.pipePrefix || 'hybrid-mpv-ipc');
    this.observeDefaults = options.observeDefaults !== false;
    this._defaultScreenshotDir = options.defaultScreenshotDir || options.screenshotDir || '';
    this._screenshotDir = '';
    this._screenshotFormat = 'png';
    this._autoOrganizeScreenshots = options.autoOrganizeScreenshots !== false;
    this._inputConfDir = null;
    this.destroyed = false;
    this._reconnectTimer = null;
  }

  // ─── Resolve mpv binaries ──────────────────────────────
  static findBinary() {
    return resolveMpvBinary(process.resourcesPath, process.execPath, __dirname, {
      allowPathLookup: !app.isPackaged
    });
  }

  static findLibMpv() {
    return resolveLibMpv(process.resourcesPath, process.execPath, __dirname, {
      allowPathLookup: !app.isPackaged
    });
  }

  static findYtDlpBinary() {
    return resolveYtDlpBinary(process.resourcesPath, process.execPath, __dirname, {
      allowPathLookup: !app.isPackaged
    });
  }

  // ─── Spawn mpv ─────────────────────────────────────────
  /**
   * @param {Buffer} nativeHandle  - Buffer returned by win.getNativeWindowHandle()
   * @param {object} [opts]
    * @param {string} [opts.mpvPath]
    * @param {string} [opts.ytdlPath]
   * @param {string} [opts.screenshotDir]
   * @param {string} [opts.hwdec]           e.g. 'auto-safe'
   */
  spawn(nativeHandle, opts = {}) {
    if (this.process || this._libmpv) return;

    let hwnd = null;
    if (opts.attachWindow !== false && nativeHandle) {
      // Windows HWNDs from Electron are exposed as LE bytes.
      // In practice, mpv embedding is more reliable when we pass the legacy low 32-bit value.
      // (Some Electron/Windows combos expose non-zero upper bits that mpv rejects for --wid.)
      try {
        if (process.platform === 'win32') {
          if (nativeHandle.length >= 8 && typeof nativeHandle.readBigUInt64LE === 'function') {
            hwnd = nativeHandle.readBigUInt64LE(0).toString();
          } else if (nativeHandle.length >= 4 && typeof nativeHandle.readUInt32LE === 'function') {
            hwnd = String(nativeHandle.readUInt32LE(0));
          }
        } else {
          hwnd = parseInt(nativeHandle.toString('hex'), 16).toString();
        }
      } catch (error) {
        mpverr('failed to parse native window handle for --wid', error?.message || error);
        hwnd = null;
      }
    }

    const ytDlpPath = opts.ytdlPath || MpvProcess.findYtDlpBinary();
    const cookiesCandidates = [
      opts.cookiesPath,
      app?.getPath ? path.join(app.getPath('userData'), 'cookies.txt') : null,
      process.resourcesPath ? path.join(process.resourcesPath, 'cookies.txt') : null,
      process.execPath ? path.join(path.dirname(process.execPath), 'cookies.txt') : null,
      !app?.isPackaged ? path.join(__dirname, '../../cookies.txt') : null,
    ].filter((candidate) => candidate && !candidate.includes('app.asar'));
    const cookiesPath = cookiesCandidates.find((candidate) => fs.existsSync(candidate)) || cookiesCandidates[0] || '';
    const defaultUserAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
    const effectiveUserAgent = opts.userAgent || opts.ytdlUserAgent || defaultUserAgent;
    // Kept for refreshYtdlOptions(): re-apply ytdl-raw-options when cookies
    // are imported mid-session.
    this._ytDlpCookiePath = cookiesPath || '';
    this._ytDlpUserAgent = effectiveUserAgent;
    const fallbackScreenshotDir = (app?.isPackaged && app?.getPath)
      ? path.join(app.getPath('userData'), 'screenshots')
      : path.join(__dirname, '../../screenshots');
    const defaultScreenshotDir = opts.defaultScreenshotDir || opts.screenshotDir || fallbackScreenshotDir;
    const screenshotDir = opts.screenshotDir || defaultScreenshotDir;
    const screenshotFormat = String(opts.screenshotFormat || 'jpg').toLowerCase();

    // Ensure screenshot directory exists
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    this._defaultScreenshotDir = defaultScreenshotDir;
    this._screenshotDir = screenshotDir;
    this._screenshotFormat = screenshotFormat === 'jpeg' ? 'jpg' : screenshotFormat;

    const isMuteAudioRequested = Boolean(
      opts.muteAudio ||
      process.env.HYBRID_MUTE_AUDIO === '1' ||
      process.env.NODE_ENV === 'test' ||
      (Array.isArray(process.argv) && (process.argv.includes('--mute-audio') || process.argv.includes('--mpv-mute')))
    );
    this._isMuteAudioRequested = isMuteAudioRequested;

    // ── Generate input.conf that relays key/mouse to Electron via script-message ──
    const os = require('os');
    const inputConfDir = fs.mkdtempSync(path.join(os.tmpdir(), `hybrid-player-input-${process.pid}-`));
    this._inputConfDir = inputConfDir;
    const inputConfPath = path.join(inputConfDir, 'input.conf');
    const inputConfContent = [
      '# Hybrid Player – mpv input bindings',
      '# Relays input from mpv VO back to Electron main process',
      '',
      '# Keyboard (active when mpv native surface has OS focus)',
      'f    script-message hybrid-toggle-fullscreen',
      'F    script-message hybrid-toggle-fullscreen',
      'ESC  script-message hybrid-exit-fullscreen',
      'Escape script-message hybrid-exit-fullscreen',
      'SPACE script-message hybrid-toggle-play',
      'LEFT  script-message hybrid-seek-back-5',
      'RIGHT script-message hybrid-seek-forward-5',
      'UP    script-message hybrid-volume-up',
      'DOWN  script-message hybrid-volume-down',
      'm    script-message hybrid-toggle-mute',
      'a    script-message hybrid-cycle-audio',
      'A    script-message hybrid-cycle-audio',
      's    script-message hybrid-screenshot',
      'S    script-message hybrid-screenshot-png',
      'Ctrl+u script-message hybrid-unlock-ui',
      'Ctrl+U script-message hybrid-unlock-ui',
      '',
      '# Mouse',
      'MBTN_LEFT     script-message hybrid-mouse-click',
      'MBTN_LEFT_DBL script-message hybrid-mouse-dblclick',
      'MOUSE_BTN0    script-message hybrid-mouse-click',
      'MOUSE_BTN0_DBL script-message hybrid-mouse-dblclick',
      'MBTN_MID      script-message hybrid-mouse-mid',
      'MBTN_BACK     script-message hybrid-mouse-back',
      'MBTN_FORWARD  script-message hybrid-mouse-forward',
    ].join('\n');
    try { fs.writeFileSync(inputConfPath, inputConfContent, { encoding: 'utf-8' }); } catch {}
    fsdbg('input.conf written', { inputConfPath });

    // ── Attempt direct in-process libmpv via C-FFI (koffi) ──
    const libmpvPath = opts.libmpvPath || MpvProcess.findLibMpv();
    if (LibmpvContext.isAvailable() && libmpvPath && opts.forceProcess !== true) {
      try {
        fsdbg('Initializing libmpv-2.dll directly in-process via C-FFI (koffi)', { libmpvPath, hwnd });
        const configureLibmpvInstance = (ctx, allowDxBridge) => {
          const tryDxBridge = allowDxBridge && dxBridgeManager.isSupported() && opts.attachWindow !== false;
          if (tryDxBridge) {
            ctx.setOptionString('vo', 'libmpv');
            ctx.setOptionString('hwdec', 'd3d11va-zero-copy');
            ctx.setOptionString('hwdec-codecs', 'h264,h265,vp9,av1');
          } else if (opts.attachWindow !== false && hwnd) {
            ctx.setOptionString('wid', hwnd);
            ctx.setOptionString('vo', 'gpu');
            ctx.setOptionString('hwdec', opts.hwdec || (process.platform === 'win32' ? 'd3d11va' : 'auto-safe'));
          } else if (opts.attachWindow === false) {
            ctx.setOptionString('force-window', 'no');
            ctx.setOptionString('mute', 'yes');
            ctx.setOptionString('pause', 'yes');
            ctx.setOptionString('audio', 'no');
            ctx.setOptionString('vo', 'null');
          } else {
            throw new Error('libmpv in-process failed: missing valid HWND for embedded --wid rendering');
          }

          ctx.setOptionString('keepaspect-window', 'no');
          ctx.setOptionString('auto-window-resize', 'no');
          ctx.setOptionString('osc', 'no');
          ctx.setOptionString('osd-bar', 'no');
          ctx.setOptionString('osd-level', '0');
          ctx.setOptionString('idle', 'yes');
          ctx.setOptionString('keep-open', 'yes');
          ctx.setOptionString('msg-level', 'all=warn');
          ctx.setOptionString('ytdl', 'yes');
          ctx.setOptionString('sub-auto', 'fuzzy');
          ctx.setOptionString('sub-file-paths', 'subs:subtitles');
          ctx.setOptionString('sub-fix-timing', 'no');
          ctx.setOptionString('demuxer-mkv-subtitle-preroll', 'yes');
          ctx.setOptionString('sub-ass-use-video-data', 'all');
          ctx.setOptionString('sub-ass-override', 'scale');
          ctx.setOptionString('screenshot-directory', screenshotDir);
          ctx.setOptionString('screenshot-template', 'hybrid-player-%tY-%tm-%td-%tH-%tM-%tS');
          ctx.setOptionString('screenshot-format', this._screenshotFormat);
          ctx.setOptionString('screenshot-jpeg-quality', '92');
          ctx.setOptionString('screenshot-webp-quality', '80');
          ctx.setOptionString('screenshot-webp-compression', '0');
          ctx.setOptionString('screenshot-webp-lossless', 'no');
          ctx.setOptionString('cache', 'yes');
          ctx.setOptionString('demuxer-max-bytes', '150MiB');
          ctx.setOptionString('demuxer-max-back-bytes', '50MiB');
          ctx.setOptionString('input-default-bindings', 'no');
          ctx.setOptionString('input-conf', inputConfPath);
          ctx.setOptionString('cursor-autohide', 'no');
          ctx.setOptionString('hr-seek', 'yes');
          ctx.setOptionString('volume-max', '200');
          ctx.setOptionString('sub-codepage', 'auto');
          ctx.setOptionString('user-agent', effectiveUserAgent);
          if (isMuteAudioRequested) {
            ctx.setOptionString('ao', 'null');
          }

          if (ytDlpPath) {
            const normalizedYtDlpPath = ytDlpPath.replace(/\\/g, '/');
            ctx.setOptionString('script-opts', `ytdl_hook-ytdl_path=${normalizedYtDlpPath}`);
          }

          const formatYtdlOptionValue = (val) => {
            const str = String(val || '');
            return str.includes(',') ? `[${str}]` : str;
          };
          const ytdlRawOptions = [];
          if (opts.enableYtdlRawOptions === true) {
            if (YTDLP_EXTRACTOR_ARGS) {
              ytdlRawOptions.push(`extractor-args=${formatYtdlOptionValue(YTDLP_EXTRACTOR_ARGS)}`);
            }
            if (effectiveUserAgent) {
              ytdlRawOptions.push(`user-agent=${formatYtdlOptionValue(effectiveUserAgent)}`);
            }
            if (cookiesPath && fs.existsSync(cookiesPath)) {
              ytdlRawOptions.push(`cookies=${formatYtdlOptionValue(cookiesPath)}`);
            }
            if (ytdlRawOptions.length > 0) {
              ctx.setOptionString('ytdl-raw-options', ytdlRawOptions.join(','));
            }
          }

          const initRes = ctx.initialize();
          if (initRes < 0) {
            throw new Error(`mpv_initialize failed with error code ${initRes}`);
          }
          return tryDxBridge;
        };

        this._libmpv = new LibmpvContext(libmpvPath);
        const useDxBridge = configureLibmpvInstance(this._libmpv, true);

        if (useDxBridge) {
          const ptr = this._libmpv.getHandleAddress ? this._libmpv.getHandleAddress() : (koffi ? koffi.address(this._libmpv.handle) : 0n);
          let bridgeOk = false;
          try {
            bridgeOk = dxBridgeManager.init(ptr, 1280, 720);
          } catch (e) {
            console.warn('[mpv-process] dxBridgeManager.init error:', e?.message || e);
          }
          if (bridgeOk) {
            this._ownsDxBridge = true;
          } else {
            this._ownsDxBridge = false;
            try {
              if (dxBridgeManager.targetWindow && !dxBridgeManager.targetWindow.isDestroyed()) {
                dxBridgeManager.targetWindow.setBackgroundColor('#00000000');
              }
            } catch {}
            if (hwnd) {
              console.warn('[mpv-process] dxBridgeManager failed, recreating libmpv context with native window wid');
              try { this._libmpv.destroy(); } catch {}
              this._libmpv = new LibmpvContext(libmpvPath);
              configureLibmpvInstance(this._libmpv, false);
            } else {
              throw new Error('dxBridgeManager.init failed and no fallback HWND available');
            }
          }
        }

        this.inProcess = true;
        this.ready = true;
        this.process = { pid: process.pid, inProcess: true, killed: false, kill: () => this.destroy() };

        // Relay events from in-process context
        this._libmpv.on('property-change', (name, value, id) => {
          if (name === 'video-params' && value && typeof value === 'object') {
            const rot = Number(value.rotate) || 0;
            const isRotated = (rot % 180) !== 0;
            const rawW = value.dw || value.w || value.width;
            const rawH = value.dh || value.h || value.height;
            const w = isRotated ? rawH : rawW;
            const h = isRotated ? rawW : rawH;
            if (w && h && this._ownsDxBridge && dxBridgeManager.isSupported()) {
              dxBridgeManager.resize(w, h);
            }
          }
          this.emit('property-change', name, value, id);
        });
        this._libmpv.on('mpv-event', (ev) => {
          this.emit('mpv-event', ev);
        });
        this._libmpv.on('file-loaded', () => {
          this.emit('file-loaded');
        });
        this._libmpv.on('end-file', (info) => {
          this.emit('end-file', info);
        });
        this._libmpv.on('seek', () => {
          this.emit('seek');
        });
        this._libmpv.on('playback-restart', () => {
          this.emit('playback-restart');
        });
        this._libmpv.on('client-message', (args) => {
          this.emit('client-message', args);
        });
        this._libmpv.on('log-message', (msg) => {
          this.emit('log-message', msg);
        });
        this._libmpv.on('log', (text) => {
          this.emit('log', text);
        });
        this._libmpv.on('shutdown', () => {
          this.destroy();
        });
        this._libmpv.on('exit', (code) => {
          this.ready = false;
          this.process = null;
          this.emit('exit', code);
        });
        this._libmpv.on('error', (err) => {
          this.emit('error', err);
        });

        if (this.observeDefaults) {
          this._observeDefaults();
        }

        this.emit('ready');
        fsdbg('libmpv initialized directly in-process via C-FFI (koffi). No external child process.');
        return;
      } catch (err) {
        mpverr('In-process libmpv initialization failed; falling back to external mpv.exe process:', err?.message || err);
        if (this._ownsDxBridge) {
          this._ownsDxBridge = false;
          try { dxBridgeManager.destroy(); } catch {}
        }
        if (this._libmpv) {
          try { this._libmpv.destroy(); } catch {}
          this._libmpv = null;
        }
        this.inProcess = false;
      }
    }

    // ── External mpv.exe fallback path ──
    const mpvBin = opts.mpvPath || MpvProcess.findBinary();
    if (!mpvBin) {
      throw new Error('mpv binary not found');
    }

    const safeUserAgent = String(effectiveUserAgent || '').replace(/[\r\n,]/g, ' ').slice(0, 512);
    const args = [
      '--idle=yes',
      '--keep-open=yes',
      '--no-terminal',
      '--msg-level=all=warn',
      '--no-osc',
      '--no-osd-bar',
      '--osd-level=0',
      `--input-ipc-server=${this.pipeName}`,
      `--hwdec=${opts.hwdec || (process.platform === 'win32' ? 'd3d11va-zero-copy' : 'auto-safe')}`,
      opts.attachWindow === false ? '--vo=null' : '--vo=gpu',
      '--ytdl=yes',
      // Subtitle defaults & rock-solid multi-speaker synchronization
      '--sub-auto=fuzzy',
      '--sub-file-paths=subs:subtitles',
      '--sub-fix-timing=no',
      '--demuxer-mkv-subtitle-preroll=yes',
      '--sub-ass-use-video-data=all',
      '--sub-ass-override=scale',
      // Screenshot defaults
      `--screenshot-directory=${screenshotDir}`,
      '--screenshot-template=hybrid-player-%tY-%tm-%td-%tH-%tM-%tS',
      `--screenshot-format=${this._screenshotFormat}`,
      '--screenshot-jpeg-quality=92',
      '--screenshot-webp-quality=80',
      '--screenshot-webp-compression=0',
      '--screenshot-webp-lossless=no',
      // Cache settings
      '--cache=yes',
      '--demuxer-max-bytes=150MiB',
      '--demuxer-max-back-bytes=50MiB',
      // Input: disable defaults, use our input.conf that relays via script-message
      '--no-config',
      '--input-default-bindings=no',
      `--input-conf=${inputConfPath}`,
      '--cursor-autohide=no',
      // High-precision frame-accurate exact seeking
      '--hr-seek=yes',
      '--hr-seek-framedrop=yes',
      '--volume-max=200',
      '--sub-codepage=auto',
      `--user-agent=${safeUserAgent}`,
      ...(isMuteAudioRequested ? ['--ao=null'] : []),
    ];

    if (ytDlpPath) {
      const normalizedYtDlpPath = ytDlpPath.replace(/\\/g, '/').replace(/,/g, '\\,');
      args.push(`--script-opts=ytdl_hook-ytdl_path=${normalizedYtDlpPath}`);
      fsdbg('resolved yt-dlp path for mpv', { ytDlpPath, normalizedYtDlpPath });
    } else {
      fsdbg('yt-dlp path not resolved for mpv; relying on PATH lookup');
    }

    const formatYtdlOptionValue = (val) => {
      const str = String(val || '');
      return str.includes(',') ? `[${str}]` : str;
    };
    const ytdlRawOptions = [];
    if (opts.enableYtdlRawOptions === true) {
      if (YTDLP_EXTRACTOR_ARGS) {
        ytdlRawOptions.push(`extractor-args=${formatYtdlOptionValue(YTDLP_EXTRACTOR_ARGS)}`);
      }
      if (effectiveUserAgent) {
        ytdlRawOptions.push(`user-agent=${formatYtdlOptionValue(effectiveUserAgent)}`);
      }
      if (cookiesPath && fs.existsSync(cookiesPath)) {
        ytdlRawOptions.push(`cookies=${formatYtdlOptionValue(cookiesPath)}`);
        fsdbg('using cookies for ytdl', { cookiesPath });
      }

      if (ytdlRawOptions.length > 0) {
        args.push(`--ytdl-raw-options=${ytdlRawOptions.join(',')}`);
      }
    }

    // NOTE: Tried --background=color/--background-color, --d3d11-flip=no and
    // --force-window=immediate to fight the transparent load window. They
    // break frame presentation on this custom mpv build when embedding into
    // the transparent Chromium window (verified: video never shows). The DOM
    // video-curtain handles the load window instead.
    if (opts.attachWindow !== false && hwnd) {
      args.push(`--wid=${hwnd}`);
    } else if (opts.attachWindow !== false) {
      throw new Error('mpv spawn failed: missing valid HWND for embedded --wid rendering');
    } else {
      args.push('--force-window=no');
      args.push('--mute=yes');
      args.push('--pause=yes');
      args.push('--audio=no');
    }

    this.process = spawn(mpvBin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    fsdbg('mpv spawn args', args);

    this.process.stdout.on('data', (d) => {
      const text = d.toString();
      this.emit('stdout-log', text);
      this.emit('log', text);
      mpvlog(text.trim());
    });

    this.process.stderr.on('data', (d) => {
      const text = d.toString();
      this.emit('stderr-log', text);
      this.emit('log', text);
      mpverr(text.trim());
    });

    this._terminationEmitted = false;
    this.process.on('error', (err) => {
      mpverr('child process error', err?.message || err);
      this.emit('error', err);
      this._handleProcessTermination(null);
    });

    this.process.on('exit', (code) => {
      this._handleProcessTermination(code);
    });

    // Give mpv a moment to create the pipe, then connect
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    this._reconnectTimer = setTimeout(() => this._connectSocket(), 300);
  }

  _handleProcessTermination(code) {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._terminationEmitted) return;
    this._terminationEmitted = true;
    if (code !== 0 && code !== null) {
      mpverr('mpv exited with code', code);
    }
    this.ready = false;
    if (this._pending && typeof this._pending.forEach === 'function') {
      this._pending.forEach((p) => { try { clearTimeout(p.timer); p.reject(new Error('mpv terminated')); } catch {} });
      if (typeof this._pending.clear === 'function') this._pending.clear();
    }
    this.socket = null;
    this.process = null;
    this.emit('exit', code);
  }

  // ─── IPC Socket ────────────────────────────────────────
  _connectSocket(retries = 10) {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.destroyed || this._terminationEmitted || !this.process) return;

    const sock = net.createConnection(this.pipeName);

    sock.on('connect', () => {
      if (this.destroyed || this._terminationEmitted || !this.process) {
        try { sock.destroy(); } catch {}
        return;
      }
      this.socket = sock;
      this.ready = true;
      this._recvBuf = '';
      this.emit('ready');

      // Observe essential properties so we can relay them to the renderer
      if (this.observeDefaults) {
        this._observeDefaults();
      }
    });

    sock.on('data', (chunk) => this._onData(chunk));

    sock.on('error', (err) => {
      try { sock.destroy(); } catch {}
      if (this.destroyed || this._terminationEmitted || !this.process) return;
      if (retries > 0) {
        this._reconnectTimer = setTimeout(() => this._connectSocket(retries - 1), 200);
      } else {
        this.emit('error', new Error('Could not connect to mpv IPC pipe: ' + err.message));
      }
    });

    sock.on('close', () => {
      if (this.socket !== sock) return;
      this.socket = null;
      this.ready = false;
      if (this._pending && typeof this._pending.forEach === 'function') {
        this._pending.forEach((p) => { try { clearTimeout(p.timer); p.reject(new Error('mpv socket closed')); } catch {} });
        if (typeof this._pending.clear === 'function') this._pending.clear();
      }
    });
  }

  _onData(chunk) {
    const { StringDecoder } = require('string_decoder');
    if (!this._decoder) this._decoder = new StringDecoder('utf8');
    this._recvBuf += this._decoder.write(chunk);
    if (this._recvBuf.length > 1048576) this._recvBuf = this._recvBuf.slice(-8192);
    const lines = this._recvBuf.split('\n');
    this._recvBuf = lines.pop(); // keep incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        this._handleMessage(msg);
      } catch {
        // ignore malformed
      }
    }
  }

  _handleMessage(msg) {
    // Response to a command we sent
    if (msg.request_id !== undefined && msg.request_id > 0) {
      const p = this._pending.get(msg.request_id);
      if (p) {
        clearTimeout(p.timer);
        this._pending.delete(msg.request_id);
        if (msg.error === 'success') {
          p.resolve(msg.data);
        } else {
          p.reject(new Error(msg.error || 'mpv error'));
        }
      }
      return;
    }

    // Event
    if (msg.event) {
      this.emit('mpv-event', msg);

      switch (msg.event) {
        case 'log-message':
          this.emit('log-message', msg);
          if (this.listenerCount('log-message') === 0 && (msg.level === 'error' || msg.level === 'fatal' || msg.level === 'warn')) {
            mpverr(`[ipc:${msg.level}]`, msg.prefix || '', msg.text || '');
          } else {
            mpvlog(`[ipc:${msg.level || 'info'}]`, msg.prefix || '', msg.text || '');
          }
          break;
        case 'property-change':
          this.emit('property-change', msg.name, msg.data, msg.id);
          break;
        case 'file-loaded':
          this.emit('file-loaded');
          break;
        case 'end-file':
          this.emit('end-file', { reason: msg.reason, error: msg.error || null });
          break;
        case 'seek':
          this.emit('seek');
          break;
        case 'playback-restart':
          this.emit('playback-restart');
          break;
        case 'client-message':
          fsdbg('client-message event', msg.args || []);
          this.emit('client-message', msg.args || []);
          break;
      }
    }
  }

  // ─── Observe default properties ────────────────────────
  async _observeDefaults() {
    await this.command('request_log_messages', 'warn').catch(() => null);

    const props = [
      'time-pos',       // current playback time
      'duration',       // media duration
      'pause',          // paused state
      'volume',         // volume 0-100
      'mute',
      'speed',
      'eof-reached',
      'track-list',     // audio/sub tracks
      'chapter-list',
      'chapter',
      'media-title',
      'video-params',
      'demuxer-cache-state',
      'sub-delay',
      'sub-visibility',
      'estimated-vf-fps',
      'video-bitrate',
      'audio-bitrate',
      'drop-frame-count',
      'paused-for-cache',
      'seeking',
    ];
    for (const p of props) {
      await this.observeProperty(p);
    }
  }

  // ─── Public API ────────────────────────────────────────

  /**
   * Send a raw JSON command and get a promise for the result.
   * @param  {...any} args  mpv command arguments, e.g. ('loadfile', path)
   * @returns {Promise<any>}
   */
  command(...args) {
    const rawArgs = args[0] === 'async' ? args.slice(1) : args;
    if (this.inProcess && this._libmpv) {
      if (rawArgs[0] === 'get_property') {
        return this.getProperty(rawArgs[1]);
      }
      if (rawArgs[0] === 'set_property') {
        return this.setProperty(rawArgs[1], rawArgs[2]);
      }
      if (rawArgs[0] === 'observe_property') {
        return this.observeProperty(rawArgs[2]);
      }
      try {
        const asyncCommands = new Set(['loadfile', 'seek', 'screenshot-to-file', 'stop']);
        const cmdArgs = (args[0] === 'async' || asyncCommands.has(rawArgs[0]))
          ? ['async', ...rawArgs]
          : rawArgs;
        const res = this._libmpv.command(...cmdArgs);
        if (res < 0) {
          return Promise.reject(new Error(`mpv command failed: ${rawArgs[0]}`));
        }
        return Promise.resolve(null);
      } catch (err) {
        return Promise.reject(err);
      }
    }

    return new Promise((resolve, reject) => {
      const send = () => {
        if (!this.socket || !this.ready) {
          resolve(null);
          return;
        }

        const id = ++this._requestId;
        const timer = setTimeout(() => {
          this._pending.delete(id);
          reject(new Error('mpv command timed out'));
        }, 10000);

        this._pending.set(id, { resolve, reject, timer });
        const payload = JSON.stringify({ command: rawArgs, request_id: id }) + '\n';
        this.socket.write(payload);
      };

      if (this.socket && this.ready) {
        send();
        return;
      }

      let done = false;
      let onReady = null;
      const waitTimer = setTimeout(() => {
        if (done) return;
        done = true;
        if (onReady) {
          this.removeListener('ready', onReady);
        }
        resolve(null);
      }, 3000);

      onReady = () => {
        if (done) return;
        done = true;
        clearTimeout(waitTimer);
        this.removeListener('ready', onReady);
        send();
      };
      this.once('ready', onReady);
    });
  }

  /** Shorter helper for set_property */
  setProperty(name, value) {
    if (this.inProcess && this._libmpv) {
      try {
        const res = this._libmpv.setPropertyString(name, value);
        if (res < 0) {
          return Promise.reject(new Error(`mpv set_property failed: ${name}=${value}`));
        }
        return Promise.resolve(true);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return this.command('set_property', name, value);
  }

  /** Shorter helper for get_property */
  getProperty(name) {
    if (this.inProcess && this._libmpv) {
      try {
        const raw = this._libmpv.getPropertyString(name);
        if (raw === null || raw === undefined) return Promise.resolve(null);
        if (raw === 'yes') return Promise.resolve(true);
        if (raw === 'no') return Promise.resolve(false);
        const trimmed = String(raw).trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            return Promise.resolve(JSON.parse(trimmed));
          } catch {}
        }
        const num = Number(trimmed);
        if (!isNaN(num) && trimmed !== '' && !trimmed.includes(':')) {
          return Promise.resolve(num);
        }
        return Promise.resolve(raw);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return this.command('get_property', name);
  }

  /** Observe a property – mpv will push changes via events */
  async observeProperty(name) {
    const id = this._nextObsId++;
    this._observedProps.set(id, name);
    if (this.inProcess && this._libmpv) {
      try {
        this._libmpv.observeProperty(id, name, 1);
        return Promise.resolve(null);
      } catch (err) {
        return Promise.reject(err);
      }
    }
    return this.command('observe_property', id, name);
  }

  // ─── Convenience commands ──────────────────────────────

  loadFile(filePath) {
    this.filePath = filePath;
    // Reset the `start` option so a pending resume offset from a previous
    // load (set via options/start) cannot leak into this file.
    return this.setProperty('options/start', '0')
      .catch(() => {})
      .then(() => this.command('loadfile', filePath, 'replace'))
      .then(() => true);
  }

  /**
   * Re-apply ytdl-raw-options on the live instance after cookies.txt was
   * created or updated. ytdl_hook may read this option per file load, so
   * playback can pick cookies up without a restart; when it does not,
   * the next app start applies them regardless.
   */
  refreshYtdlOptions() {
    const formatValue = (val) => {
      const str = String(val || '');
      return str.includes(',') ? `[${str}]` : str;
    };
    const raw = [];
    if (YTDLP_EXTRACTOR_ARGS) {
      raw.push(`extractor-args=${formatValue(YTDLP_EXTRACTOR_ARGS)}`);
    }
    if (this._ytDlpUserAgent) {
      raw.push(`user-agent=${formatValue(this._ytDlpUserAgent)}`);
    }
    const cookiesPath = path.join(app.getPath('userData'), 'cookies.txt');
    if (cookiesPath && fs.existsSync(cookiesPath)) {
      raw.push(`cookies=${formatValue(cookiesPath)}`);
      this._ytDlpCookiePath = cookiesPath;
    } else {
      this._ytDlpCookiePath = null;
    }
    const value = raw.join(',');
    try {
      if (this.inProcess && this._libmpv) {
        const res = this._libmpv.setPropertyString('ytdl-raw-options', value);
        return Promise.resolve(res >= 0);
      }
      return this.command('set_property', 'ytdl-raw-options', value).then(() => true).catch(() => false);
    } catch (err) {
      mpverr('refreshYtdlOptions failed', err?.message || err);
      return Promise.resolve(false);
    }
  }

  play()  { return this.setProperty('pause', false); }
  pause() { return this.setProperty('pause', true);  }

  async togglePause() {
    // Atomic cycle avoids read-modify-write TOCTOU on rapid clicks.
    await this.command('cycle', 'pause');
    return this.getProperty('pause').catch(() => false);
  }

  stop() {
    return this.command('stop');
  }

  seek(seconds, flags = 'absolute+exact') {
    return this.command('seek', seconds, flags);
  }

  seekRelative(seconds) {
    return this.command('seek', seconds, 'relative+exact');
  }

  seekPercent(pct) {
    return this.command('seek', pct, 'absolute-percent+exact');
  }

  setVolume(vol)  { return this.setProperty('volume', vol); }
  setMute(muted)  { return this.setProperty('mute', !!muted); }
  setSpeed(speed) { return this.setProperty('speed', speed); }

  // ── Subtitle ───────────────────────────────────────────
  cycleSubtitles()  { return this.command('cycle', 'sub'); }
  setSub(trackId)   { return this.setProperty('sid', trackId); }
  setSubDelay(sec)  { return this.setProperty('sub-delay', sec); }
  setSubVisibility(vis) { return this.setProperty('sub-visibility', vis); }
  addSubFile(path)  { return this.command('sub-add', path, 'auto'); }

  // ── Audio tracks ───────────────────────────────────────
  cycleAudio() { return this.command('cycle', 'audio'); }
  setAudio(trackId) { return this.setProperty('aid', trackId); }
  setAudioDelay(sec) { return this.setProperty('audio-delay', sec); }

  // ── Chapters ───────────────────────────────────────────
  setChapter(idx) { return this.setProperty('chapter', idx); }
  nextChapter()   { return this.command('add', 'chapter', 1); }
  prevChapter()   { return this.command('add', 'chapter', -1); }

  // ── Frame stepping ─────────────────────────────────────
  frameStep()     { return this.command('frame-step'); }
  frameBackStep() { return this.command('frame-back-step'); }

  // ── A-B loop ───────────────────────────────────────────
  setABLoopA(time) { return this.setProperty('ab-loop-a', time); }
  setABLoopB(time) { return this.setProperty('ab-loop-b', time); }
  clearABLoop() {
    return Promise.all([
      this.setProperty('ab-loop-a', 'no'),
      this.setProperty('ab-loop-b', 'no'),
    ]);
  }

  setAutoOrganizeScreenshots(enabled) {
    this._autoOrganizeScreenshots = enabled !== false;
  }

  getAutoOrganizeScreenshots() {
    return this._autoOrganizeScreenshots !== false;
  }

  async getEffectiveScreenshotDir() {
    const baseDir = this._screenshotDir || await this.getProperty('screenshot-directory').catch(() => '');
    if (!this._autoOrganizeScreenshots) {
      return baseDir || '.';
    }

    try {
      const currentPath = await this.getProperty('path').catch(() => '');
      const mediaTitle = await this.getProperty('media-title').catch(() => '');
      const subfolder = resolveScreenshotSubfolder({ filePath: currentPath, mediaTitle });
      if (subfolder && typeof subfolder === 'string') {
        const fullDir = path.join(baseDir || '.', subfolder);
        if (!fs.existsSync(fullDir)) {
          fs.mkdirSync(fullDir, { recursive: true });
        }
        return fullDir;
      }
    } catch (_) {}

    return baseDir || '.';
  }

  // ── Screenshot ─────────────────────────────────────────
  /**
   * Take a single screenshot saved to the pre-configured directory with zero collisions.
   * @param {'video'|'subtitles'|'window'} mode
   * @returns {Promise<string>} the path mpv wrote to
   */
  async screenshot(mode = 'video', formatOverride = null) {
    const dir = await this.getEffectiveScreenshotDir();
    const validOverride = typeof formatOverride === 'string' && ['png', 'jpg', 'jpeg', 'webp'].includes(formatOverride.trim().toLowerCase())
      ? formatOverride.trim().toLowerCase()
      : null;
    const fmt = validOverride || this._screenshotFormat || await this.getProperty('screenshot-format').catch(() => 'jpg');

    // Zero-collision single screenshot filename (timestamp + ms + random nonce)
    const now = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const ms = pad(now.getMilliseconds(), 3);
    const nonce = crypto.randomBytes(3).toString('hex');
    const expectedName = `hybrid-player-${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${ms}-${nonce}.${fmt}`;
    const expectedPath = path.join(dir || '.', expectedName);

    const maybePath = await this.command('screenshot-to-file', expectedPath, mode);
    if (typeof maybePath === 'string' && maybePath.trim()) {
      return maybePath.trim();
    }
    return expectedPath;
  }

  /**
   * Capture a single frame in an ongoing burst session with sequential indexing inside a dedicated burst subfolder.
   * Guaranteed zero collision and numerical sorting.
   * @param {string} sessionId
   * @param {number} seqNum
   * @param {'video'|'subtitles'|'window'} mode
   */
  async screenshotBurstFrame(sessionId, seqNum, mode = 'video') {
    if (!this._burstSessions) {
      this._burstSessions = new Map();
    }

    let session = this._burstSessions.get(sessionId);
    if (!session) {
      const dir = await this.getEffectiveScreenshotDir();
      const fmt = this._screenshotFormat || await this.getProperty('screenshot-format').catch(() => 'jpg');

      // Dedicated burst subfolder per session
      const burstFolder = `burst_${sessionId}`;
      const burstDirPath = path.join(dir || '.', burstFolder);
      if (!fs.existsSync(burstDirPath)) {
        fs.mkdirSync(burstDirPath, { recursive: true });
      }

      session = { dir, burstFolder, burstDirPath, fmt };
      this._burstSessions.set(sessionId, session);
    }

    const seqPadded = String(seqNum).padStart(5, '0');
    const fileName = `frame-${seqPadded}.${session.fmt}`;
    const expectedPath = path.join(session.burstDirPath, fileName);

    // Non-blocking async screenshot: mpv offloads frame compression & disk write
    // so playback decoding and VO presentation are not stalled.
    await this.command('async', 'screenshot-to-file', expectedPath, mode);
    return { framePath: expectedPath, fileName, burstFolder: session.burstFolder, seqNum };
  }

  /**
   * Finalizes a burst session:
   * - If total frames >= 20: keeps files organized inside dedicated burst subfolder.
   * - If total frames < 20: moves files into main screenshots folder and cleans up subfolder.
   * @param {string} sessionId
   * @param {number} totalCount
   */
  async finalizeBurstSession(sessionId, totalCount) {
    const session = this._burstSessions?.get(sessionId);
    const dir = session?.dir || await this.getEffectiveScreenshotDir();
    const burstFolder = session?.burstFolder || `burst_${sessionId}`;
    const burstDirPath = session?.burstDirPath || path.join(dir || '.', burstFolder);

    if (this._burstSessions) {
      this._burstSessions.delete(sessionId);
    }

    if (!fs.existsSync(burstDirPath)) {
      return { inSubfolder: false, count: 0, folderName: '' };
    }

    // Ensure all target frames are written to disk, have non-zero size, and file locks released
    const targetCount = Number(totalCount) || 0;
    const startWait = Date.now();
    const waitTimeout = targetCount > 0 ? 2500 : 400;

    while (Date.now() - startWait < waitTimeout) {
      let files = [];
      try {
        files = fs.readdirSync(burstDirPath);
      } catch (_) {
        break;
      }
      if (files.length >= targetCount && files.length > 0) {
        let allReady = true;
        for (const file of files) {
          const fullPath = path.join(burstDirPath, file);
          try {
            const st = fs.statSync(fullPath);
            if (st.size === 0) {
              allReady = false;
              break;
            }
            // Check if file is unlocked on Windows (r+ mode checks write exclusivity)
            const fd = fs.openSync(fullPath, 'r+');
            fs.closeSync(fd);
          } catch (_) {
            allReady = false;
            break;
          }
        }
        if (allReady) break;
      }
      await new Promise(r => setTimeout(r, 25));
    }

    let files = [];
    try {
      files = fs.readdirSync(burstDirPath);
    } catch (_) {}

    const count = files.length;

    // If fewer than 20 frames, keep in main screenshots folder
    if (count < 20) {
      let movedCount = 0;
      for (const file of files) {
        const srcPath = path.join(burstDirPath, file);
        const destName = `hybrid-burst-${sessionId}_${file}`;
        const destPath = path.join(dir || '.', destName);
        let moved = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            fs.renameSync(srcPath, destPath);
            moved = true;
            break;
          } catch (e) {
            try {
              fs.copyFileSync(srcPath, destPath);
              fs.unlinkSync(srcPath);
              moved = true;
              break;
            } catch (_) {}
            await new Promise(r => setTimeout(r, 40));
          }
        }
        if (moved) movedCount++;
      }
      try {
        fs.rmdirSync(burstDirPath);
      } catch (_) {}

      return { inSubfolder: false, count: movedCount, folderName: '' };
    }

    return { inSubfolder: true, count, folderName: burstFolder };
  }

  /**
   * Fire-and-forget screenshot path for immediate UI response.
   * Returns the expected file path immediately while mpv writes asynchronously.
   * @param {'video'|'subtitles'|'window'} mode
   * @returns {Promise<string>}
   */
  async screenshotFast(mode = 'video') {
    const dir = await this.getEffectiveScreenshotDir();
    const fmt = this._screenshotFormat || await this.getProperty('screenshot-format').catch(() => 'jpg');

    const now = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const ms = pad(now.getMilliseconds(), 3);
    const nonce = crypto.randomBytes(3).toString('hex');
    const expectedName = `hybrid-player-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${ms}-${nonce}.${fmt}`;
    const expectedPath = path.join(dir || '.', expectedName);

    this.command('screenshot-to-file', expectedPath, mode).catch((error) => {
      mpverr('screenshotFast command failed', error?.message || error);
    });

    return expectedPath;
  }

  setScreenshotDir(dir) {
    const isReset = dir == null || (typeof dir === 'string' && !dir.trim());
    const cleanDir = isReset
      ? (this._defaultScreenshotDir || path.join(__dirname, '../../screenshots'))
      : (typeof dir === 'string' ? dir.trim() : '');
    if (cleanDir) {
      if (!fs.existsSync(cleanDir)) {
        try {
          fs.mkdirSync(cleanDir, { recursive: true });
        } catch (e) {
          mpverr('Failed to create screenshot directory:', e?.message || e);
        }
      }
      this._screenshotDir = cleanDir;
      this.setProperty('screenshot-directory', cleanDir).catch(() => {});
      return true;
    }
    return false;
  }

  getScreenshotDir() {
    return this._screenshotDir;
  }

  setScreenshotFormat(fmt) {
    if (typeof fmt === 'string' && fmt.trim()) {
      const cleanFmt = fmt.trim().toLowerCase() === 'jpeg' ? 'jpg' : fmt.trim().toLowerCase();
      this._screenshotFormat = cleanFmt;
      this.setProperty('screenshot-format', cleanFmt).catch(() => {});
      if (cleanFmt === 'webp') {
        this.setProperty('screenshot-webp-quality', 80).catch(() => {});
        this.setProperty('screenshot-webp-compression', 0).catch(() => {});
        this.setProperty('screenshot-webp-lossless', 'no').catch(() => {});
      }
      return true;
    }
    return false;
  }

  getScreenshotFormat() {
    return this._screenshotFormat;
  }

  // ─── Lifecycle ─────────────────────────────────────────
  destroy() {
    this.destroyed = true;
    if (this._burstSessions) {
      this._burstSessions.clear();
      this._burstSessions = null;
    }
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._ownsDxBridge) {
      this._ownsDxBridge = false;
      try {
        dxBridgeManager.destroy();
      } catch {}
    }
    if (this.inProcess && this._libmpv) {
      const ctx = this._libmpv;
      this._libmpv = null;
      this.inProcess = false;
      this.process = null;
      try {
        ctx.destroy();
      } catch {}
    } else {
      if (this.socket) {
        try { this.command('quit').catch(() => {}); } catch {}
        try { this.socket.end(); } catch {}
        this.socket = null;
      }
      if (this.process && !this.process.inProcess) {
        const pid = this.process.pid;
        if (process.platform === 'win32' && Number.isInteger(pid) && pid > 0) {
          try {
            require('child_process').execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
          } catch {}
        } else {
          try { this.process.kill('SIGTERM'); } catch {}
        }
        this.process = null;
      }
    }
    if (this._inputConfDir) {
      fs.rm(this._inputConfDir, { recursive: true, force: true }, () => {});
      this._inputConfDir = null;
    }
    this.ready = false;
    this._pending.forEach(p => {
      clearTimeout(p.timer);
      p.reject(new Error('mpv destroyed'));
    });
    this._pending.clear();
  }
}

module.exports = { MpvProcess, makePipeName };
