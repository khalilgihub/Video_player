/**
 * Hybrid Player - In-Process libmpv C-FFI Engine (koffi)
 * 
 * Loads libmpv-2.dll directly in-process via C-FFI (koffi):
 * - Eliminates external mpv.exe child process spawning.
 * - Eliminates the named pipe IPC socket overhead.
 * - Communicates with mpv directly in C memory with sub-millisecond execution.
 */

const EventEmitter = require('events');

let koffi = null;
try {
  koffi = require('koffi');
} catch (e) {
  // koffi native module not available
}

let cachedLib = null;
let cachedDllPath = null;
let cachedFuncs = null;
let cachedTypes = null;

function bindLibMpv(dllPath) {
  if (cachedLib && cachedDllPath === dllPath) {
    return { lib: cachedLib, funcs: cachedFuncs, types: cachedTypes };
  }

  if (!koffi) {
    throw new Error('Koffi C-FFI module is not available');
  }

  const lib = koffi.load(dllPath);

  const mpv_handle = koffi.pointer('mpv_handle', koffi.opaque());
  const mpv_event = koffi.struct('mpv_event', {
    event_id: 'int',
    error: 'int',
    reply_userdata: 'uint64',
    data: 'void *'
  });
  const mpv_event_property = koffi.struct('mpv_event_property', {
    name: 'str',
    format: 'int',
    data: 'void *'
  });
  const mpv_event_client_message = koffi.struct('mpv_event_client_message', {
    num_args: 'int',
    args: 'void *'
  });
  const mpv_event_end_file = koffi.struct('mpv_event_end_file', {
    reason: 'int',
    error: 'int',
    playlist_entry_id: 'int64',
    playlist_insert_id: 'int64',
    playlist_insert_num_entries: 'int'
  });
  const mpv_event_log_message = koffi.struct('mpv_event_log_message', {
    prefix: 'str',
    level: 'str',
    text: 'str',
    log_level: 'int'
  });

  const funcs = {
    create: lib.func('mpv_handle *mpv_create(void)'),
    initialize: lib.func('int mpv_initialize(mpv_handle *ctx)'),
    destroy: lib.func('void mpv_destroy(mpv_handle *ctx)'),
    terminate_destroy: lib.func('void mpv_terminate_destroy(mpv_handle *ctx)'),
    client_api_version: lib.func('unsigned long mpv_client_api_version(void)'),
    command: lib.func('int mpv_command(mpv_handle *ctx, const char **args)'),
    command_string: lib.func('int mpv_command_string(mpv_handle *ctx, const char *args)'),
    set_option_string: lib.func('int mpv_set_option_string(mpv_handle *ctx, const char *name, const char *data)'),
    set_property_string: lib.func('int mpv_set_property_string(mpv_handle *ctx, const char *name, const char *data)'),
    get_property_string: lib.func('void *mpv_get_property_string(mpv_handle *ctx, const char *name)'),
    free: lib.func('void mpv_free(void *data)'),
    observe_property: lib.func('int mpv_observe_property(mpv_handle *ctx, uint64_t reply_userdata, const char *name, int format)'),
    unobserve_property: lib.func('int mpv_unobserve_property(mpv_handle *ctx, uint64_t registered_reply_userdata)'),
    wait_event: lib.func('void *mpv_wait_event(mpv_handle *ctx, double timeout)'),
    event_name: lib.func('const char *mpv_event_name(int event_id)'),
    error_string: lib.func('const char *mpv_error_string(int error)'),
    wakeup: lib.func('void mpv_wakeup(mpv_handle *ctx)'),
  };

  const types = {
    mpv_handle,
    mpv_event,
    mpv_event_property,
    mpv_event_client_message,
    mpv_event_end_file,
    mpv_event_log_message,
  };

  cachedLib = lib;
  cachedDllPath = dllPath;
  cachedFuncs = funcs;
  cachedTypes = types;

  return { lib, funcs, types };
}

class LibmpvContext extends EventEmitter {
  constructor(dllPath) {
    super();
    this.dllPath = dllPath;
    const { funcs, types } = bindLibMpv(dllPath);
    this.funcs = funcs;
    this.types = types;
    this.handle = this.funcs.create();
    if (!this.handle) {
      throw new Error('mpv_create() failed to allocate context');
    }
    this._pollInterval = null;
    this.destroyed = false;
  }

  getHandleAddress() {
    if (!this.handle || !koffi) return 0n;
    return BigInt(koffi.address(this.handle));
  }

  static isAvailable() {
    return !!koffi;
  }

  setOptionString(name, val) {
    if (this.destroyed || !this.handle) return -1;
    return this.funcs.set_option_string(this.handle, String(name), String(val ?? ''));
  }

  initialize() {
    if (this.destroyed || !this.handle) return -1;
    const res = this.funcs.initialize(this.handle);
    if (res >= 0) {
      this.startEventLoop();
    }
    return res;
  }

  command(...args) {
    if (this.destroyed || !this.handle) return -1;
    const strArgs = args.map((a) => (a === null || a === undefined ? '' : String(a)));
    strArgs.push(null);
    return this.funcs.command(this.handle, strArgs);
  }

  commandString(cmdStr) {
    if (this.destroyed || !this.handle) return -1;
    return this.funcs.command_string(this.handle, String(cmdStr || ''));
  }

  setPropertyString(name, val) {
    if (this.destroyed || !this.handle) return -1;
    let s = '';
    if (typeof val === 'boolean') {
      s = val ? 'yes' : 'no';
    } else if (val !== null && val !== undefined) {
      s = String(val);
    }
    return this.funcs.set_property_string(this.handle, String(name), s);
  }

  getPropertyString(name) {
    if (this.destroyed || !this.handle) return null;
    const strPtr = this.funcs.get_property_string(this.handle, String(name));
    if (!strPtr) return null;
    try {
      if (typeof koffi.decode?.string === 'function') {
        return koffi.decode.string(strPtr);
      }
      return koffi.decode(strPtr, 'char', -1);
    } finally {
      this.funcs.free(strPtr);
    }
  }

  observeProperty(id, name, format = 1) {
    if (this.destroyed || !this.handle) return -1;
    return this.funcs.observe_property(this.handle, BigInt(id), String(name), format);
  }

  unobserveProperty(id) {
    if (this.destroyed || !this.handle) return -1;
    return this.funcs.unobserve_property(this.handle, BigInt(id));
  }

  startEventLoop(pollMs = 8) {
    if (this._pollInterval) return;
    this._pollInterval = setInterval(() => {
      this.pollEvents();
    }, pollMs);
  }

  pollEvents() {
    if (this.destroyed || !this.handle) return;
    try {
      while (true) {
        const evPtr = this.funcs.wait_event(this.handle, 0);
        if (!evPtr) break;
        const ev = koffi.decode(evPtr, this.types.mpv_event);
        if (!ev || ev.event_id === 0) break; // MPV_EVENT_NONE

        this._dispatchMpvEvent(ev);
      }
    } catch (err) {
      this.emit('error', err);
    }
  }

  _dispatchMpvEvent(ev) {
    const eventId = ev.event_id;
    const eventName = this.funcs.event_name(eventId) || 'unknown';

    switch (eventId) {
      case 22: { // MPV_EVENT_PROPERTY_CHANGE
        if (ev.data) {
          const prop = koffi.decode(ev.data, this.types.mpv_event_property);
          let rawVal = null;
          if (prop.data) {
            rawVal = koffi.decode(prop.data, 'str');
          }
          let parsedVal = rawVal;
          if (rawVal === 'yes') parsedVal = true;
          else if (rawVal === 'no') parsedVal = false;
          else if (rawVal !== null && rawVal !== undefined) {
            const trimmed = rawVal.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
                (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
              try {
                parsedVal = JSON.parse(trimmed);
              } catch {}
            } else {
              const num = Number(trimmed);
              if (!isNaN(num) && trimmed !== '' && !trimmed.includes(':')) {
                parsedVal = num;
              }
            }
          }
          this.emit('property-change', prop.name, parsedVal, Number(ev.reply_userdata));
          this.emit('mpv-event', {
            event: 'property-change',
            name: prop.name,
            data: parsedVal,
            id: Number(ev.reply_userdata),
          });
        }
        break;
      }

      case 8: // MPV_EVENT_FILE_LOADED
        this.emit('file-loaded');
        this.emit('mpv-event', { event: 'file-loaded' });
        break;

      case 7: { // MPV_EVENT_END_FILE
        let reason = 'eof';
        let errCode = null;
        if (ev.data) {
          const endFile = koffi.decode(ev.data, this.types.mpv_event_end_file);
          const reasonMap = { 0: 'eof', 2: 'stop', 3: 'quit', 4: 'error', 5: 'redirect' };
          reason = reasonMap[endFile.reason] || 'eof';
          errCode = endFile.error ? (this.funcs.error_string(endFile.error) || endFile.error) : null;
        }
        this.emit('end-file', { reason, error: errCode });
        this.emit('mpv-event', { event: 'end-file', reason, error: errCode });
        break;
      }

      case 20: // MPV_EVENT_SEEK
        this.emit('seek');
        this.emit('mpv-event', { event: 'seek' });
        break;

      case 21: // MPV_EVENT_PLAYBACK_RESTART
        this.emit('playback-restart');
        this.emit('mpv-event', { event: 'playback-restart' });
        break;

      case 16: { // MPV_EVENT_CLIENT_MESSAGE
        if (ev.data) {
          const cm = koffi.decode(ev.data, this.types.mpv_event_client_message);
          let args = [];
          if (cm.num_args > 0 && cm.args) {
            args = koffi.decode(cm.args, 'str', cm.num_args);
          }
          this.emit('client-message', args);
          this.emit('mpv-event', { event: 'client-message', args });
        }
        break;
      }

      case 2: { // MPV_EVENT_LOG_MESSAGE
        if (ev.data) {
          const lm = koffi.decode(ev.data, this.types.mpv_event_log_message);
          this.emit('log-message', lm);
          this.emit('log', `[${lm.level}] ${lm.prefix}: ${lm.text}`);
        }
        break;
      }

      case 1: // MPV_EVENT_SHUTDOWN
        this.emit('shutdown');
        this.destroy();
        break;

      default:
        this.emit('mpv-event', { event: eventName, id: eventId });
        break;
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
    if (this.handle) {
      try {
        this.funcs.destroy(this.handle);
      } catch {}
      this.handle = null;
    }
    this.emit('exit', 0);
  }
}

module.exports = {
  LibmpvContext,
  bindLibMpv,
  koffi,
};
