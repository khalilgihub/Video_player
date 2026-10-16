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
const { LibmpvContext } = require('./libmpv-koffi');

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
    this.options = options;
    /** @type {import('child_process').ChildProcess|null} */
    this.process = null;
    /** @type {net.Socket|null} */
    this.socket = null;
    /** @type {import('./libmpv-koffi').LibmpvContext|null} */
    this._libmpv = null;
    this.inProcess = false;

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
        this._libmpv = new LibmpvContext(libmpvPath);

        if (opts.attachWindow !== false && hwnd) {
          this._libmpv.setOptionString('wid', hwnd);
          this._libmpv.setOptionString('vo', 'gpu');
          this._libmpv.setOptionString('hwdec', opts.hwdec || (process.platform === 'win32' ? 'd3d11va' : 'auto-safe'));
        } else if (opts.attachWindow === false) {
          this._libmpv.setOptionString('force-window', 'no');
          this._libmpv.setOptionString('mute', 'yes');
          this._libmpv.setOptionString('pause', 'yes');
          this._libmpv.setOptionString('audio', 'no');
          this._libmpv.setOptionString('vo', 'null');
        } else {
          throw new Error('libmpv in-process failed: missing valid HWND for embedded --wid rendering');
        }

        this._libmpv.setOptionString('keepaspect-window', 'no');
        this._libmpv.setOptionString('auto-window-resize', 'no');
        this._libmpv.setOptionString('osc', 'no');
        this._libmpv.setOptionString('osd-bar', 'no');
        this._libmpv.setOptionString('osd-level', '0');
        this._libmpv.setOptionString('idle', 'yes');
        this._libmpv.setOptionString('keep-open', 'yes');
        this._libmpv.setOptionString('msg-level', 'all=warn');
        this._libmpv.setOptionString('ytdl', 'yes');
        this._libmpv.setOptionString('sub-auto', 'fuzzy');
        this._libmpv.setOptionString('sub-file-paths', 'subs:subtitles');
        this._libmpv.setOptionString('sub-fix-timing', 'no');
        this._libmpv.setOptionString('demuxer-mkv-subtitle-preroll', 'yes');
        this._libmpv.setOptionString('sub-ass-use-video-data', 'all');
        this._libmpv.setOptionString('sub-ass-override', 'scale');
        this._libmpv.setOptionString('screenshot-directory', screenshotDir);
        this._libmpv.setOptionString('screenshot-template', 'hybrid-player-%tY-%tm-%td-%tH-%tM-%tS');
        this._libmpv.setOptionString('screenshot-format', this._screenshotFormat);
        this._libmpv.setOptionString('screenshot-jpeg-quality', '92');
        this._libmpv.setOptionString('screenshot-webp-quality', '92');
        this._libmpv.setOptionString('screenshot-webp-compression', '0');
        this._libmpv.setOptionString('screenshot-webp-lossless', 'no');
        this._libmpv.setOptionString('cache', 'yes');
        this._libmpv.setOptionString('demuxer-max-bytes', '150MiB');
        this._libmpv.setOptionString('demuxer-max-back-bytes', '50MiB');
        this._libmpv.setOptionString('input-default-bindings', 'no');
        this._libmpv.setOptionString('input-conf', inputConfPath);
        this._libmpv.setOptionString('cursor-autohide', 'no');
        this._libmpv.setOptionString('hr-seek', 'yes');
        this._libmpv.setOptionString('hr-seek-framedrop', 'yes');

        if (ytDlpPath) {
          const normalizedYtDlpPath = ytDlpPath.replace(/\\/g, '/');
          this._libmpv.setOptionString('script-opts', `ytdl_hook-ytdl_path=${normalizedYtDlpPath}`);
        }

        const formatYtdlOptionValue = (val) => {
          const str = String(val || '');
          return str.includes(',') ? `[${str}]` : str;
        };
        const ytdlRawOptions = [];
        if (opts.enableYtdlRawOptions === true) {
          if (opts.ytdlUserAgent) {
            ytdlRawOptions.push(`user-agent=${formatYtdlOptionValue(opts.ytdlUserAgent)}`);
          }
          if (cookiesPath && fs.existsSync(cookiesPath)) {
            ytdlRawOptions.push(`cookies=${formatYtdlOptionValue(cookiesPath)}`);
          }
          if (ytdlRawOptions.length > 0) {
            this._libmpv.setOptionString('ytdl-raw-options', ytdlRawOptions.join(','));
          }
        }

        const initRes = this._libmpv.initialize();
        if (initRes < 0) {
          throw new Error(`mpv_initialize failed with error code ${initRes}`);
        }

        this.inProcess = true;
        this.ready = true;
        this.process = { pid: process.pid, inProcess: true, killed: false, kill: () => this.destroy() };

        // Relay events from in-process context
        this._libmpv.on('property-change', (name, value, id) => {
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

    const args = [
      '--idle=yes',
      '--keep-open=yes',
      '--no-terminal',
      '--msg-level=all=warn',
      '--no-osc',
      '--no-osd-bar',
      '--osd-level=0',
      `--input-ipc-server=${this.pipeName}`,
      `--hwdec=${opts.hwdec || (process.platform === 'win32' ? 'd3d11va' : 'auto-safe')}`,
      '--vo=gpu',
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
      '--screenshot-webp-quality=92',
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
    ];

    if (ytDlpPath) {
      const normalizedYtDlpPath = ytDlpPath.replace(/\\/g, '/');
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
      if (opts.ytdlUserAgent) {
        ytdlRawOptions.push(`user-agent=${formatYtdlOptionValue(opts.ytdlUserAgent)}`);
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
    setTimeout(() => this._connectSocket(), 300);
  }

  _handleProcessTermination(code) {
    if (this._terminationEmitted) return;
    this._terminationEmitted = true;
    if (code !== 0 && code !== null) {
      mpverr('mpv exited with code', code);
    }
    this.ready = false;
    this.socket = null;
    this.process = null;
    this.emit('exit', code);
  }

  // ─── IPC Socket ────────────────────────────────────────
  _connectSocket(retries = 10) {
    const sock = net.createConnection(this.pipeName);

    sock.on('connect', () => {
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
      if (retries > 0) {
        setTimeout(() => this._connectSocket(retries - 1), 200);
      } else {
        this.emit('error', new Error('Could not connect to mpv IPC pipe: ' + err.message));
      }
    });

    sock.on('close', () => {
      this.socket = null;
      this.ready = false;
    });
  }

  _onData(chunk) {
    this._recvBuf += chunk.toString('utf-8');
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
    if (this.inProcess && this._libmpv) {
      if (args[0] === 'get_property') {
        return this.getProperty(args[1]);
      }
      if (args[0] === 'set_property') {
        return this.setProperty(args[1], args[2]);
      }
      if (args[0] === 'observe_property') {
        return this.observeProperty(args[2]);
      }
      try {
        const res = this._libmpv.command(...args);
        if (res < 0) {
          return Promise.reject(new Error(`mpv command failed: ${args[0]}`));
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
        const payload = JSON.stringify({ command: args, request_id: id }) + '\n';
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
    return this.command('loadfile', filePath, 'replace').then(() => true);
  }

  play()  { return this.setProperty('pause', false); }
  pause() { return this.setProperty('pause', true);  }

  async togglePause() {
    const paused = !!(await this.getProperty('pause'));
    const nextPaused = !paused;
    await this.setProperty('pause', nextPaused);
    return nextPaused;
  }

  stop() {
    return this.command('stop');
  }

  seek(seconds, flags = 'absolute') {
    return this.command('seek', seconds, flags);
  }

  seekRelative(seconds) {
    return this.command('seek', seconds, 'relative');
  }

  seekPercent(pct) {
    return this.command('seek', pct, 'absolute-percent');
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
    const dir = await this.getEffectiveScreenshotDir();
    const fmt = this._screenshotFormat || await this.getProperty('screenshot-format').catch(() => 'jpg');

    // Dedicated burst subfolder per session
    const burstFolder = `burst_${sessionId}`;
    const burstDirPath = path.join(dir || '.', burstFolder);
    if (!fs.existsSync(burstDirPath)) {
      fs.mkdirSync(burstDirPath, { recursive: true });
    }

    const seqPadded = String(seqNum).padStart(5, '0');
    const fileName = `frame-${seqPadded}.${fmt}`;
    const expectedPath = path.join(burstDirPath, fileName);

    await this.command('screenshot-to-file', expectedPath, mode);
    return { framePath: expectedPath, fileName, burstFolder, seqNum };
  }

  /**
   * Finalizes a burst session:
   * - If total frames >= 20: keeps files organized inside dedicated burst subfolder.
   * - If total frames < 20: moves files into main screenshots folder and cleans up subfolder.
   * @param {string} sessionId
   * @param {number} totalCount
   */
  async finalizeBurstSession(sessionId, totalCount) {
    const dir = await this.getEffectiveScreenshotDir();
    const burstFolder = `burst_${sessionId}`;
    const burstDirPath = path.join(dir || '.', burstFolder);

    if (!fs.existsSync(burstDirPath)) {
      return { inSubfolder: false, count: 0, folderName: '' };
    }

    const files = fs.readdirSync(burstDirPath);
    const count = Number.isInteger(Number(totalCount)) && Number(totalCount) > 0 ? Number(totalCount) : files.length;

    // If fewer than 20 frames, keep in main screenshots folder
    if (count < 20) {
      for (const file of files) {
        const srcPath = path.join(burstDirPath, file);
        const destName = `hybrid-burst-${sessionId}_${file}`;
        const destPath = path.join(dir || '.', destName);
        try {
          fs.renameSync(srcPath, destPath);
        } catch (e) {
          try {
            fs.copyFileSync(srcPath, destPath);
            fs.unlinkSync(srcPath);
          } catch (_) {}
        }
      }
      try {
        fs.rmdirSync(burstDirPath);
      } catch (_) {}

      return { inSubfolder: false, count, folderName: '' };
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
        this.setProperty('screenshot-webp-quality', 92).catch(() => {});
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
    if (this.inProcess && this._libmpv) {
      try {
        this._libmpv.destroy();
      } catch {}
      this._libmpv = null;
      this.inProcess = false;
      this.process = null;
    } else {
      if (this.socket) {
        try { this.command('quit').catch(() => {}); } catch {}
        try { this.socket.end(); } catch {}
        this.socket = null;
      }
      if (this.process && !this.process.inProcess) {
        const pid = this.process.pid;
        if (process.platform === 'win32' && pid) {
          try {
            require('child_process').execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
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
