/**
 * Hybrid Player - mpv Process Manager
 * Spawns and manages the mpv child process with IPC socket communication.
 *
 * mpv is launched with --wid=<HWND> so it renders directly into the
 * Electron BrowserWindow's native handle.  All control goes through the
 * JSON-based IPC protocol over a Windows named pipe.
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const EventEmitter = require('events');

// TEMP DEBUG: fullscreen/input tracing
const FS_DEBUG = true;
function fsdbg(...args) {
  if (!FS_DEBUG) return;
  console.log('[FSDBG][mpv-process]', ...args);
}

const MPV_LOG_DEBUG = true;
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
    /** @type {import('child_process').ChildProcess|null} */
    this.process = null;
    /** @type {net.Socket|null} */
    this.socket = null;

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
  }

  // ─── Resolve mpv binary ────────────────────────────────
  static findBinary() {
    // 1. Bundled with app  (resources/mpv/mpv.exe)
    const bundled = path.join(
      process.resourcesPath || path.join(__dirname, '../../'),
      'mpv', 'mpv.exe'
    );
    if (fs.existsSync(bundled)) return bundled;

    // 2. Next to app exe
    const beside = path.join(path.dirname(process.execPath), 'mpv', 'mpv.exe');
    if (fs.existsSync(beside)) return beside;

    // 3. Project-local (development)
    const local = path.join(__dirname, '../../mpv/mpv.exe');
    if (fs.existsSync(local)) return local;

    // 4. Rely on PATH
    return 'mpv';
  }

  static findYtDlpBinary() {
    const localCandidates = [
      path.join(process.resourcesPath || path.join(__dirname, '../../'), 'mpv', 'yt-dlp.exe'),
      path.join(path.dirname(process.execPath), 'mpv', 'yt-dlp.exe'),
      path.join(__dirname, '../../mpv/yt-dlp.exe'),
      path.join(__dirname, '../../mpv/yt-dlp')
    ];

    for (const candidate of localCandidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    const locator = process.platform === 'win32' ? 'where' : 'which';
    const names = process.platform === 'win32' ? ['yt-dlp.exe', 'yt-dlp'] : ['yt-dlp'];

    for (const name of names) {
      try {
        const found = spawnSync(locator, [name], { windowsHide: true, encoding: 'utf8' });
        if (found.status === 0 && found.stdout) {
          const first = String(found.stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean);
          if (first) return first;
        }
      } catch {
      }
    }

    return null;
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
    if (this.process) return;

    let hwnd = null;
    if (opts.attachWindow !== false && nativeHandle) {
      // On Windows the native handle is a 4- or 8-byte LE integer
      hwnd = nativeHandle.readUInt32LE
        ? nativeHandle.readUInt32LE(0)
        : parseInt(nativeHandle.toString('hex'), 16);
    }

    const mpvBin = opts.mpvPath || MpvProcess.findBinary();
    const ytDlpPath = opts.ytdlPath || MpvProcess.findYtDlpBinary();
    const cookiesPath = opts.cookiesPath || path.join(__dirname, '../../cookies.txt');
    const defaultUserAgent =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
    const screenshotDir = opts.screenshotDir || path.join(__dirname, '../../screenshots');

    // Ensure screenshot directory exists
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }

    // ── Generate input.conf that relays key/mouse to Electron via script-message ──
    const os = require('os');
    const inputConfPath = path.join(os.tmpdir(), `hybrid-player-input-${process.pid}.conf`);
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
      'm    script-message hybrid-toggle-mute',
      '',
      '# Mouse',
      'MBTN_LEFT     script-message hybrid-mouse-click',
      'MBTN_LEFT_DBL script-message hybrid-mouse-dblclick',
      'MOUSE_BTN0    script-message hybrid-mouse-click',
      'MOUSE_BTN0_DBL script-message hybrid-mouse-dblclick',
    ].join('\n');
    try { fs.writeFileSync(inputConfPath, inputConfContent, 'utf-8'); } catch {}
    fsdbg('input.conf written', { inputConfPath });

    const args = [
      '--idle=yes',
      '--keep-open=yes',
      '--no-terminal',
      '--no-osc',
      '--no-osd-bar',
      '--osd-level=0',
      `--input-ipc-server=${this.pipeName}`,
      `--hwdec=${opts.hwdec || 'auto-safe'}`,
      '--vo=gpu',
      '--ytdl=yes',
      // Subtitle defaults
      '--sub-auto=fuzzy',
      '--sub-file-paths=subs:subtitles',
      // Screenshot defaults
      `--screenshot-directory=${screenshotDir}`,
      '--screenshot-template=hybrid-player-%tY-%tm-%td-%tH-%tM-%tS',
      '--screenshot-format=png',
      // Input: disable defaults, use our input.conf that relays via script-message
      '--no-config',
      '--input-default-bindings=no',
      `--input-conf=${inputConfPath}`,
      '--cursor-autohide=no',
    ];

    if (ytDlpPath) {
      const normalizedYtDlpPath = ytDlpPath.replace(/\\/g, '/');
      args.push(`--script-opts=ytdl_hook-ytdl_path=${normalizedYtDlpPath}`);
      fsdbg('resolved yt-dlp path for mpv', { ytDlpPath, normalizedYtDlpPath });
    } else {
      fsdbg('yt-dlp path not resolved for mpv; relying on PATH lookup');
    }

    const ytdlRawOptions = [];
    if (opts.enableYtdlRawOptions === true) {
      ytdlRawOptions.push(`user-agent=${opts.ytdlUserAgent || defaultUserAgent}`);
      if (fs.existsSync(cookiesPath)) {
        ytdlRawOptions.push(`cookies=${cookiesPath}`);
        fsdbg('using cookies for ytdl', { cookiesPath });
      }

      if (ytdlRawOptions.length > 0) {
        args.push(`--ytdl-raw-options=${ytdlRawOptions.join(',')}`);
      }
    }

    if (opts.attachWindow !== false) {
      args.push(`--wid=${hwnd}`);
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

    this.process.on('error', (err) => {
      mpverr('child process error', err?.message || err);
      this.emit('error', err);
      this.ready = false;
    });

    this.process.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        mpverr('mpv exited with code', code);
      }
      this.emit('exit', code);
      this.ready = false;
      this.socket = null;
      this.process = null;
    });

    // Give mpv a moment to create the pipe, then connect
    setTimeout(() => this._connectSocket(), 300);
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
          if (msg.level === 'error' || msg.level === 'fatal' || msg.level === 'warn') {
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
    await this.command('request_log_messages', 'debug').catch(() => null);

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
      const waitTimer = setTimeout(() => {
        if (done) return;
        done = true;
        resolve(null);
      }, 3000);

      this.once('ready', () => {
        if (done) return;
        done = true;
        clearTimeout(waitTimer);
        send();
      });
    });
  }

  /** Shorter helper for set_property */
  setProperty(name, value) {
    return this.command('set_property', name, value);
  }

  /** Shorter helper for get_property */
  getProperty(name) {
    return this.command('get_property', name);
  }

  /** Observe a property – mpv will push changes via events */
  async observeProperty(name) {
    const id = this._nextObsId++;
    this._observedProps.set(id, name);
    return this.command('observe_property', id, name);
  }

  // ─── Convenience commands ──────────────────────────────

  loadFile(filePath) {
    this.filePath = filePath;
    return this.command('loadfile', filePath, 'replace');
  }

  play()  { return this.setProperty('pause', false); }
  pause() { return this.setProperty('pause', true);  }

  async togglePause() {
    const paused = await this.getProperty('pause');
    return this.setProperty('pause', !paused);
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

  // ── Screenshot ─────────────────────────────────────────
  /**
   * Take a screenshot saved to the pre-configured directory.
   * @param {'video'|'subtitles'|'window'} mode
   * @returns {Promise<string>} the path mpv wrote to (obtained via filename property)
   */
  async screenshot(mode = 'video') {
    const dir = await this.getProperty('screenshot-directory').catch(() => '');
    const tmpl = await this.getProperty('screenshot-template').catch(() => 'hybrid-player-shot');
    const fmt  = await this.getProperty('screenshot-format').catch(() => 'png');

    // Build the expected filename (mpv expands %t* at capture time)
    const now = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const expectedName = `hybrid-player-${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.${fmt}`;
    const expectedPath = path.join(dir || '.', expectedName);

    await this.command('screenshot-to-file', expectedPath, mode);
    return expectedPath;
  }

  // ─── Lifecycle ─────────────────────────────────────────
  destroy() {
    if (this.socket) {
      try { this.command('quit').catch(() => {}); } catch {}
      this.socket.destroy();
      this.socket = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
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
