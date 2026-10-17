/**
 * Hybrid Player - Keyboard Shortcuts Module
 * 
 * Features & Keybindings:
 * - Playback: Space / K (Play/Pause), [ / ] (Speed down/up), , / . (Frame back/forward)
 * - Seeking: Left / Right Arrow (±5s), J / L (±10s), 0–9 (Jump to 0%–90%)
 * - Audio: Up / Down Arrow (Volume ±5%), M (Mute/Unmute), E (Equalizer modal)
 * - View & Chrome: F / Double-Click (Toggle Fullscreen), Escape (Exit Fullscreen), I (Stats for Nerds), B (Background settings)
 * - Track Selection: N / P (Next/Previous track), C (Toggle subtitles), S (Take screenshot)
 * - Input Safety: Ignores hotkeys when typing in text inputs, textareas, or select dropdowns.
 */

const FS_DEBUG = false;
function fsdbg(...args) {
  if (!FS_DEBUG) return;
  console.log('[FSDBG][renderer-shortcuts]', ...args);
}

const SHORTCUT_CATALOG = Object.freeze([
  // Screenshots & Recording
  { id: 'screenshot', action: 'screenshot', label: 'Take Screenshot (Hold for Burst)', category: 'Screenshots & Recording', defaultCombo: 'KeyS' },
  { id: 'screenshot-png', action: 'screenshot-png', label: 'Take Screenshot (PNG)', category: 'Screenshots & Recording', defaultCombo: 'Shift+KeyS' },
  { id: 'delete-latest-screenshot', action: 'delete-latest-screenshot', label: 'Delete Latest Screenshot', category: 'Screenshots & Recording', defaultCombo: 'KeyD' },
  { id: 'restore-latest-screenshot', action: 'restore-latest-screenshot', label: 'Restore Latest Screenshot', category: 'Screenshots & Recording', defaultCombo: 'KeyZ' },
  { id: 'toggle-screenshot-carousel', action: 'toggle-screenshot-carousel', label: 'Delete Selected Screenshot', category: 'Screenshots & Recording', defaultCombo: 'Ctrl+KeyD' },
  { id: 'toggle-restore-carousel', action: 'toggle-restore-carousel', label: 'Restore Selected Screenshot', category: 'Screenshots & Recording', defaultCombo: 'Ctrl+KeyZ' },
  { id: 'toggle-recording', action: 'toggle-recording', label: 'Record Video Clip', category: 'Screenshots & Recording', defaultCombo: 'Ctrl+KeyS' },

  // Playback
  { id: 'toggle-play', action: 'toggle-play', label: 'Play / Pause', category: 'Playback', defaultCombo: 'Space' },
  { id: 'toggle-play-alt', action: 'toggle-play', label: 'Play / Pause (Secondary)', category: 'Playback', defaultCombo: 'KeyK' },
  { id: 'stop', action: 'stop', label: 'Stop Playback', category: 'Playback', defaultCombo: '' },
  { id: 'previous-track', action: 'previous-track', label: 'Previous Track', category: 'Playback', defaultCombo: 'KeyP' },
  { id: 'next-track', action: 'next-track', label: 'Next Track', category: 'Playback', defaultCombo: 'KeyN' },
  { id: 'speed-down', action: 'speed-down', label: 'Decrease Speed (-0.25x)', category: 'Playback', defaultCombo: 'BracketLeft' },
  { id: 'speed-up', action: 'speed-up', label: 'Increase Speed (+0.25x)', category: 'Playback', defaultCombo: 'BracketRight' },
  { id: 'frame-backward', action: 'frame-backward', label: 'Previous Frame', category: 'Playback', defaultCombo: 'Comma' },
  { id: 'frame-forward', action: 'frame-forward', label: 'Next Frame', category: 'Playback', defaultCombo: 'Period' },
  { id: 'toggle-repeat', action: 'toggle-repeat', label: 'Cycle Repeat Mode', category: 'Playback', defaultCombo: 'KeyL' },
  { id: 'toggle-ab-loop', action: 'toggle-ab-loop', label: 'A-B Loop (Set A / Set B / Clear)', category: 'Playback', defaultCombo: 'KeyR' },

  // Seeking & Navigation
  { id: 'seek-back-5', action: 'seek-back-5', label: 'Seek Backward', category: 'Seeking & Navigation', defaultCombo: 'ArrowLeft' },
  { id: 'seek-forward-5', action: 'seek-forward-5', label: 'Seek Forward', category: 'Seeking & Navigation', defaultCombo: 'ArrowRight' },
  { id: 'seek-0', action: 'seek-0', label: 'Jump to 0%', category: 'Seeking & Navigation', defaultCombo: 'Digit0' },
  { id: 'seek-10', action: 'seek-10', label: 'Jump to 10%', category: 'Seeking & Navigation', defaultCombo: 'Digit1' },
  { id: 'seek-20', action: 'seek-20', label: 'Jump to 20%', category: 'Seeking & Navigation', defaultCombo: 'Digit2' },
  { id: 'seek-30', action: 'seek-30', label: 'Jump to 30%', category: 'Seeking & Navigation', defaultCombo: 'Digit3' },
  { id: 'seek-40', action: 'seek-40', label: 'Jump to 40%', category: 'Seeking & Navigation', defaultCombo: 'Digit4' },
  { id: 'seek-50', action: 'seek-50', label: 'Jump to 50%', category: 'Seeking & Navigation', defaultCombo: 'Digit5' },
  { id: 'seek-60', action: 'seek-60', label: 'Jump to 60%', category: 'Seeking & Navigation', defaultCombo: 'Digit6' },
  { id: 'seek-70', action: 'seek-70', label: 'Jump to 70%', category: 'Seeking & Navigation', defaultCombo: 'Digit7' },
  { id: 'seek-80', action: 'seek-80', label: 'Jump to 80%', category: 'Seeking & Navigation', defaultCombo: 'Digit8' },
  { id: 'seek-90', action: 'seek-90', label: 'Jump to 90%', category: 'Seeking & Navigation', defaultCombo: 'Digit9' },

  // Audio & Subtitles
  { id: 'volume-up', action: 'volume-up', label: 'Volume Up (+5%)', category: 'Audio & Subtitles', defaultCombo: 'ArrowUp' },
  { id: 'volume-down', action: 'volume-down', label: 'Volume Down (-5%)', category: 'Audio & Subtitles', defaultCombo: 'ArrowDown' },
  { id: 'toggle-mute', action: 'toggle-mute', label: 'Mute / Unmute', category: 'Audio & Subtitles', defaultCombo: 'KeyM' },
  { id: 'cycle-audio', action: 'cycle-audio', label: 'Cycle Audio Track (Subs / Dubs)', category: 'Audio & Subtitles', defaultCombo: 'KeyA' },
  { id: 'toggle-equalizer', action: 'toggle-equalizer', label: 'Audio Equalizer', category: 'Audio & Subtitles', defaultCombo: 'KeyE' },
  { id: 'toggle-subtitles', action: 'toggle-subtitles', label: 'Subtitles Panel', category: 'Audio & Subtitles', defaultCombo: 'KeyC' },
  { id: 'sub-delay-down', action: 'sub-delay-down', label: 'Subtitle Delay -0.1s', category: 'Audio & Subtitles', defaultCombo: 'KeyG' },
  { id: 'sub-delay-up', action: 'sub-delay-up', label: 'Subtitle Delay +0.1s', category: 'Audio & Subtitles', defaultCombo: 'KeyH' },

  // View & Interface
  { id: 'toggle-fullscreen', action: 'toggle-fullscreen', label: 'Toggle Fullscreen', category: 'View & Interface', defaultCombo: 'KeyF' },
  { id: 'exit-fullscreen', action: 'exit-fullscreen', label: 'Exit Fullscreen', category: 'View & Interface', defaultCombo: 'Escape' },
  { id: 'toggle-playlist', action: 'toggle-playlist', label: 'Toggle Playlist Sidebar', category: 'View & Interface', defaultCombo: 'Ctrl+KeyL' },
  { id: 'toggle-stats', action: 'toggle-stats', label: 'Stats for Nerds', category: 'View & Interface', defaultCombo: 'KeyI' },
  { id: 'toggle-time-format', action: 'toggle-time-format', label: 'Toggle Time Format', category: 'View & Interface', defaultCombo: 'KeyT' },
  { id: 'toggle-bg-settings', action: 'toggle-bg-settings', label: 'Welcome Background Settings', category: 'View & Interface', defaultCombo: 'KeyB' },
  { id: 'unlock-ui', action: 'unlock-ui', label: 'Unlock Controls (When Locked)', category: 'View & Interface', defaultCombo: 'Ctrl+KeyU' },
  { id: 'toggle-lock', action: 'toggle-lock', label: 'Lock / Unlock Controls', category: 'View & Interface', defaultCombo: '' },

  // File & Application
  { id: 'open-file', action: 'open-file', label: 'Open File', category: 'File & Application', defaultCombo: 'Ctrl+KeyO' },
  { id: 'open-multiple-files', action: 'open-multiple-files', label: 'Open Multiple Files', category: 'File & Application', defaultCombo: 'Ctrl+Shift+KeyO' },
  { id: 'open-folder', action: 'open-folder', label: 'Open Folder', category: 'File & Application', defaultCombo: 'Ctrl+KeyF' },
  { id: 'open-network-stream', action: 'open-network-stream', label: 'Open Network Stream / URL', category: 'File & Application', defaultCombo: 'Ctrl+KeyN' },
  { id: 'toggle-settings', action: 'toggle-settings', label: 'Open Settings', category: 'File & Application', defaultCombo: 'Ctrl+Comma' },
  { id: 'quit', action: 'quit', label: 'Quit Player', category: 'File & Application', defaultCombo: 'Ctrl+KeyQ' },
]);

const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight',
  'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight',
  'OSLeft', 'OSRight',
]);

const CODE_DISPLAY_LABELS = Object.freeze({
  Space: 'Space',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Del',
  Insert: 'Ins',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
});

class HybridShortcuts {
  constructor(player, controls) {
    this.player = player;
    this.controls = controls;
    this.catalog = SHORTCUT_CATALOG;

    // Default combo -> action map (preserves legacy this.defaults structure)
    this.defaults = {};
    this.defaultBindings = {};
    for (const item of SHORTCUT_CATALOG) {
      this.defaultBindings[item.id] = item.defaultCombo;
      if (item.defaultCombo) {
        this.defaults[item.defaultCombo] = item.action;
      }
    }

    // Active actionId -> combo string map
    this.bindings = { ...this.defaultBindings };
    // Active combo -> action map (preserves legacy this.shortcuts structure)
    this.shortcuts = { ...this.defaults };
    this._customOverrides = {};
    this.screenshotMouseButton = 3; // Default: Mouse 4 (Back button)

    this._keySHoldTimer = null;
    this._keySPressed = false;
    this._activeScreenshotCode = null;
    this._mouse4HoldTimer = null;
    this._mouse4Pressed = false;

    this._bindKeyboard();
    this._bindMouse();
    this._bindMenuActions();
    this._loadSavedShortcutsFromDb();
  }

  async _loadSavedShortcutsFromDb() {
    try {
      const [saved, savedMouseBtn] = await Promise.all([
        window.hybridAPI?.db?.getPreference?.('customShortcuts').catch(() => null),
        window.hybridAPI?.db?.getPreference?.('screenshotMouseButton').catch(() => null),
      ]);
      if ( [-1, 1, 3, 4].includes(Number(savedMouseBtn)) ) {
        this.screenshotMouseButton = Number(savedMouseBtn);
      }
      if (saved && typeof saved === 'object') {
        this.applyCustomShortcuts(saved, { persist: false });
      } else {
        this.updateTooltips();
      }
    } catch (_) {
      this.updateTooltips();
    }
  }

  getScreenshotMouseButton() {
    return [-1, 1, 3, 4].includes(Number(this.screenshotMouseButton)) ? Number(this.screenshotMouseButton) : 3;
  }

  async setScreenshotMouseButton(button, { persist = true } = {}) {
    const num = [-1, 1, 3, 4].includes(Number(button)) ? Number(button) : 3;
    this.screenshotMouseButton = num;
    if (persist) {
      try {
        await window.hybridAPI?.db?.setPreference?.('screenshotMouseButton', num);
      } catch (err) {
        console.warn('Failed to persist screenshotMouseButton:', err);
      }
    }
    return num;
  }

  getCatalog() {
    return this.catalog;
  }

  getBinding(actionId) {
    if (Object.prototype.hasOwnProperty.call(this.bindings, actionId)) {
      return this.bindings[actionId] || '';
    }
    return '';
  }

  getDefaultBinding(actionId) {
    return this.defaultBindings[actionId] || '';
  }

  getCustomOverrides() {
    const overrides = {};
    for (const item of this.catalog) {
      const current = this.bindings[item.id] ?? '';
      const def = this.defaultBindings[item.id] ?? '';
      if (current !== def) {
        overrides[item.id] = current;
      }
    }
    return overrides;
  }

  normalizeKeyToken(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return '';
    const token = rawToken.trim();
    if (!token) return '';

    if (/^Key[A-Z]$/.test(token) || /^Digit[0-9]$/.test(token) || /^Numpad[0-9]$/.test(token) || /^F([1-9]|1[0-2])$/.test(token)) {
      return token;
    }
    if (/^[a-zA-Z]$/.test(token)) {
      return `Key${token.toUpperCase()}`;
    }
    if (/^[0-9]$/.test(token)) {
      return `Digit${token}`;
    }

    const lower = token.toLowerCase();
    const aliases = {
      space: 'Space',
      spacebar: 'Space',
      esc: 'Escape',
      escape: 'Escape',
      enter: 'Enter',
      return: 'Enter',
      tab: 'Tab',
      backspace: 'Backspace',
      delete: 'Delete',
      del: 'Delete',
      insert: 'Insert',
      ins: 'Insert',
      home: 'Home',
      end: 'End',
      pageup: 'PageUp',
      pgup: 'PageUp',
      pagedown: 'PageDown',
      pgdn: 'PageDown',
      arrowleft: 'ArrowLeft',
      left: 'ArrowLeft',
      arrowright: 'ArrowRight',
      right: 'ArrowRight',
      arrowup: 'ArrowUp',
      up: 'ArrowUp',
      arrowdown: 'ArrowDown',
      down: 'ArrowDown',
      '[': 'BracketLeft',
      bracketleft: 'BracketLeft',
      ']': 'BracketRight',
      bracketright: 'BracketRight',
      ',': 'Comma',
      comma: 'Comma',
      '.': 'Period',
      period: 'Period',
      '/': 'Slash',
      slash: 'Slash',
      '\\': 'Backslash',
      backslash: 'Backslash',
      ';': 'Semicolon',
      semicolon: 'Semicolon',
      "'": 'Quote',
      quote: 'Quote',
      '`': 'Backquote',
      backquote: 'Backquote',
      '-': 'Minus',
      minus: 'Minus',
      '=': 'Equal',
      equal: 'Equal',
    };

    if (aliases[lower]) return aliases[lower];
    if (/^key[a-z]$/.test(lower)) return `Key${lower.slice(3).toUpperCase()}`;
    if (/^digit[0-9]$/.test(lower)) return `Digit${lower.slice(5)}`;
    if (/^f([1-9]|1[0-2])$/.test(lower)) return lower.toUpperCase();
    return token;
  }

  normalizeCombo(rawCombo) {
    if (rawCombo === '' || rawCombo === null || rawCombo === undefined) return '';
    if (typeof rawCombo !== 'string') return '';
    const trimmed = rawCombo.trim();
    if (!trimmed) return '';

    const parts = trimmed.split('+').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return '';

    let ctrl = false;
    let alt = false;
    let shift = false;
    let keyCode = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const lower = part.toLowerCase();
      if (i < parts.length - 1) {
        if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'meta' || lower === 'command') {
          ctrl = true;
          continue;
        }
        if (lower === 'alt' || lower === 'option') {
          alt = true;
          continue;
        }
        if (lower === 'shift') {
          shift = true;
          continue;
        }
      }
      keyCode = this.normalizeKeyToken(part);
    }

    if (!keyCode || MODIFIER_CODES.has(keyCode)) return '';

    const prefix = [];
    if (ctrl) prefix.push('Ctrl');
    if (alt) prefix.push('Alt');
    if (shift) prefix.push('Shift');
    prefix.push(keyCode);
    return prefix.join('+');
  }

  eventToCombo(e) {
    if (!e) return null;
    const rawCode = e.code || this.normalizeKeyToken(e.key || '');
    if (!rawCode || MODIFIER_CODES.has(rawCode)) return null;

    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    parts.push(rawCode);
    return parts.join('+');
  }

  formatComboForDisplay(combo) {
    const normalized = this.normalizeCombo(combo);
    if (!normalized) return 'Unbound';

    const parts = normalized.split('+');
    return parts
      .map((part) => {
        if (part === 'Ctrl' || part === 'Alt' || part === 'Shift') return part;
        if (CODE_DISPLAY_LABELS[part]) return CODE_DISPLAY_LABELS[part];
        if (part.startsWith('Key') && part.length === 4) return part.slice(3);
        if (part.startsWith('Digit') && part.length === 6) return part.slice(5);
        if (part.startsWith('Numpad')) return `Num ${part.slice(6)}`;
        return part;
      })
      .join(' + ');
  }

  formatComboCompact(combo) {
    const normalized = this.normalizeCombo(combo);
    if (!normalized) return '';
    return this.formatComboForDisplay(normalized).replace(/\s+\+\s+/g, '+');
  }

  _rebuildLookupMaps() {
    const nextShortcuts = {};
    for (const item of this.catalog) {
      const combo = this.bindings[item.id];
      if (combo) {
        nextShortcuts[combo] = item.action;
      }
    }
    this.shortcuts = nextShortcuts;
    this._customOverrides = this.getCustomOverrides();
    this.updateTooltips();
    window.dispatchEvent(new CustomEvent('hybrid:shortcuts-changed', {
      detail: {
        bindings: { ...this.bindings },
        overrides: { ...this._customOverrides },
      },
    }));
  }

  applyCustomShortcuts(customMap, { persist = false } = {}) {
    this.bindings = { ...this.defaultBindings };
    if (customMap && typeof customMap === 'object') {
      for (const [actionId, rawCombo] of Object.entries(customMap)) {
        if (!Object.prototype.hasOwnProperty.call(this.bindings, actionId)) continue;
        const normalized = this.normalizeCombo(rawCombo);
        if (normalized) {
          // Clear any other action currently holding this combo
          for (const other of this.catalog) {
            if (other.id !== actionId && this.bindings[other.id] === normalized) {
              this.bindings[other.id] = '';
            }
          }
        }
        this.bindings[actionId] = normalized;
      }
    }
    this._rebuildLookupMaps();
    if (persist) {
      this._persistCustomShortcuts();
    }
    return { ...this.bindings };
  }

  async setShortcut(actionId, rawCombo, { persist = true } = {}) {
    const entry = this.catalog.find((item) => item.id === actionId);
    if (!entry) return { ok: false, error: 'Unknown shortcut action' };

    const combo = this.normalizeCombo(rawCombo);
    const previousCombo = this.bindings[actionId] || '';

    let displacedActionId = null;
    let displacedActionLabel = null;

    if (combo) {
      for (const item of this.catalog) {
        if (item.id !== actionId && this.bindings[item.id] === combo) {
          this.bindings[item.id] = '';
          displacedActionId = item.id;
          displacedActionLabel = item.label;
        }
      }
    }

    this.bindings[actionId] = combo;
    this._rebuildLookupMaps();

    if (persist) {
      await this._persistCustomShortcuts();
    }

    return {
      ok: true,
      actionId,
      label: entry.label,
      combo,
      displayCombo: this.formatComboForDisplay(combo),
      previousCombo,
      displacedActionId,
      displacedActionLabel,
    };
  }

  async resetShortcut(actionId, { persist = true } = {}) {
    const entry = this.catalog.find((item) => item.id === actionId);
    if (!entry) return { ok: false };
    return this.setShortcut(actionId, entry.defaultCombo, { persist });
  }

  async resetAllShortcuts({ persist = true } = {}) {
    this.bindings = { ...this.defaultBindings };
    this._rebuildLookupMaps();
    if (persist) {
      await this._persistCustomShortcuts();
    }
    return { ok: true, bindings: { ...this.bindings } };
  }

  async _persistCustomShortcuts() {
    try {
      const overrides = this.getCustomOverrides();
      await window.hybridAPI?.db?.setPreference?.('customShortcuts', overrides);
    } catch (err) {
      console.warn('Failed to persist custom shortcuts:', err);
    }
  }

  updateTooltips() {
    const setBtnTooltip = (id, label, actionId) => {
      const el = document.getElementById(id);
      if (!el) return;
      const keyText = this.formatComboCompact(this.getBinding(actionId));
      el.title = keyText ? `${label} (${keyText})` : label;
    };

    const isPlaying = !!this.player?.isPlaying;
    setBtnTooltip('btnPlay', isPlaying ? 'Pause' : 'Play', 'toggle-play');
    setBtnTooltip('btnPrev', 'Previous', 'previous-track');
    setBtnTooltip('btnNext', 'Next', 'next-track');
    setBtnTooltip('btnVolume', 'Volume', 'toggle-mute');
    setBtnTooltip('bgSettingsToggle', 'Background Settings', 'toggle-bg-settings');
    setBtnTooltip('btnEqualizer', 'Equalizer', 'toggle-equalizer');
    setBtnTooltip('btnAudioTrack', 'Subs / Dubs', 'cycle-audio');
    setBtnTooltip('btnSubtitles', 'Subtitles', 'toggle-subtitles');
    setBtnTooltip('btnPlaylist', 'Playlist', 'toggle-playlist');
    setBtnTooltip('btnABLoop', 'A-B Loop', 'toggle-ab-loop');
    setBtnTooltip('btnSettings', 'Settings', 'toggle-settings');
    setBtnTooltip('btnFullscreen', 'Fullscreen', 'toggle-fullscreen');
    setBtnTooltip('unlockOverlay', 'Unlock', 'unlock-ui');
    setBtnTooltip('btnLock', 'Lock Controls', 'toggle-lock');
  }

  _resolveActionForEvent(e) {
    if (!e || window.__hybridRecordingShortcut) return null;
    const combo = this.eventToCombo(e);
    if (!combo) return null;
    if (this.shortcuts[combo]) {
      return this.shortcuts[combo];
    }
    // Allow Shift+KeyF as an intuitive alias for toggle-fullscreen if not overridden
    if (combo === 'Shift+KeyF' && this.shortcuts['KeyF'] === 'toggle-fullscreen') {
      return 'toggle-fullscreen';
    }
    // Fallback for unmodified key lookup in case external code modified this.shortcuts[e.code]
    if (!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && e.code && this.shortcuts[e.code]) {
      return this.shortcuts[e.code];
    }
    return null;
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      if (window.__hybridRecordingShortcut) return;

      // Don't intercept when typing in inputs
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'SELECT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable ||
        e.target.closest?.('input, select, textarea, [contenteditable="true"]')
      ) {
        return;
      }

      // Check for modals
      const anyModalOpen = document.querySelector('.modal-overlay:not([hidden])');

      const code = e.code;
      const action = this._resolveActionForEvent(e);

      // Special handling when screenshot carousel is open
      if (this.player?.isScreenshotCarouselOpen?.()) {
        if (code === 'ArrowLeft') {
          e.preventDefault();
          e.stopPropagation();
          this.player.navigateScreenshotCarousel(-1);
          return;
        }
        if (code === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          this.player.navigateScreenshotCarousel(1);
          return;
        }
        if (code === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.player.closeScreenshotCarousel();
          return;
        }
        const carouselMode = this.player?.getCarouselMode?.() || 'delete';
        if (carouselMode === 'restore') {
          if (code === 'Enter' || action === 'restore-latest-screenshot') {
            e.preventDefault();
            e.stopPropagation();
            this.player.restoreSelectedCarouselScreenshot();
            return;
          }
        } else {
          if (code === 'Enter' || action === 'delete-latest-screenshot') {
            e.preventDefault();
            e.stopPropagation();
            this.player.deleteSelectedCarouselScreenshot();
            return;
          }
        }
      }

      if (code === 'KeyF' || code === 'Escape' || action === 'toggle-fullscreen' || action === 'exit-fullscreen') {
        fsdbg('keydown ' + JSON.stringify({
          code,
          key: e.key,
          action,
          modalOpen: !!document.querySelector('.modal-overlay:not([hidden])')
        }));
      }
      
      if (!action) return;

      const isLocked = !!window.HybridApp?.isLocked;
      if (
        isLocked &&
        action !== 'unlock-ui' &&
        action !== 'toggle-lock' &&
        action !== 'screenshot' &&
        action !== 'screenshot-png'
      ) {
        e.preventDefault();
        return;
      }
      
      // Some actions should work even in modals
      if (action !== 'toggle-play' && anyModalOpen) return;

      // Special handling for screenshot action (Hold-to-Burst frame capture vs Single Tap)
      if (action === 'screenshot') {
        e.preventDefault();
        if (!this._hasActiveMedia()) return;
        if (!e.repeat) {
          this._keySPressed = true;
          this._activeScreenshotCode = code;
          if (this._keySHoldTimer) clearTimeout(this._keySHoldTimer);
          this._keySHoldTimer = setTimeout(() => {
            if (this._keySPressed && !this.player._isBurstCapturing) {
              this.player.startBurstCapture();
            }
          }, 200);
        } else {
          if (!this.player._isBurstCapturing) {
            this.player.startBurstCapture();
          }
        }
        return;
      }

      if (action === 'screenshot-png') {
        e.preventDefault();
        if (!e.repeat) {
          this._executeAction(action, e);
        }
        return;
      }

      const repeatableActions = ['seek-back-5', 'seek-forward-5', 'volume-up', 'volume-down'];
      if (e.repeat && !repeatableActions.includes(action)) return;

      e.preventDefault();
      if (action === 'toggle-fullscreen' || action === 'exit-fullscreen') {
        fsdbg('execute action', action);
      }
      this._executeAction(action, e);
    });

    document.addEventListener('keyup', (e) => {
      if (window.__hybridRecordingShortcut) return;
      // Mirror the keydown guard: a key released while focus sits in an input
      // must not fire actions (e.g. typing "s" in the playlist search must not
      // take a screenshot). Also drop any pending hold-to-burst state.
      if (
        e.target.tagName === 'INPUT' ||
        e.target.tagName === 'SELECT' ||
        e.target.tagName === 'TEXTAREA' ||
        e.target.isContentEditable ||
        e.target.closest?.('input, select, textarea, [contenteditable="true"]')
      ) {
        if (this._keySHoldTimer) {
          clearTimeout(this._keySHoldTimer);
          this._keySHoldTimer = null;
        }
        this._keySPressed = false;
        this._activeScreenshotCode = null;
        return;
      }
      const releaseAction = this._resolveActionForEvent(e);
      if (
        (this._keySPressed && e.code && e.code === this._activeScreenshotCode) ||
        releaseAction === 'screenshot'
      ) {
        if (this._keySHoldTimer) {
          clearTimeout(this._keySHoldTimer);
          this._keySHoldTimer = null;
        }

        if (this.player._isBurstCapturing) {
          this.player.stopBurstCapture();
        } else if (this._keySPressed) {
          // Short tap (< 200ms) -> single screenshot
          this.player.takeScreenshot();
        }
        this._keySPressed = false;
        this._activeScreenshotCode = null;
      }
    });
  }

  _getModifiedShortcutAction(e) {
    return this._resolveActionForEvent(e);
  }

  _hasActiveMedia() {
    const welcome = document.getElementById('welcomeScreen');
    return !welcome || welcome.classList.contains('hidden') || !!this.player?.currentFilePath || (this.player?.trackList && this.player.trackList.length > 0) || !!window.HybridApp?._loadSpinnerPending;
  }

  _bindMouse() {
    const handleDown = (e) => {
      const targetBtn = this.getScreenshotMouseButton();
      if (targetBtn < 0 || e.button !== targetBtn) return;

      e.preventDefault();
      e.stopPropagation();

      // Don't intercept when typing in inputs or contenteditable
      if (
        e.target?.tagName === 'INPUT' ||
        e.target?.tagName === 'SELECT' ||
        e.target?.tagName === 'TEXTAREA' ||
        e.target?.isContentEditable ||
        e.target?.closest?.('input, select, textarea, [contenteditable="true"]')
      ) {
        return;
      }

      const anyModalOpen = document.querySelector('.modal-overlay:not([hidden])');
      if (anyModalOpen) return;

      if (!this._hasActiveMedia()) return;

      if (this.player?.isScreenshotCarouselOpen?.()) return;

      if (this._mouse4Pressed) return;
      this._mouse4Pressed = true;

      if (this._mouse4HoldTimer) clearTimeout(this._mouse4HoldTimer);
      this._mouse4HoldTimer = setTimeout(() => {
        if (this._mouse4Pressed && !this.player._isBurstCapturing) {
          this.player.startBurstCapture();
        }
      }, 200);
    };

    const handleUp = (e) => {
      const targetBtn = this.getScreenshotMouseButton();
      if (targetBtn < 0 || e.button !== targetBtn) return;

      e.preventDefault();
      e.stopPropagation();

      if (this._mouse4HoldTimer) {
        clearTimeout(this._mouse4HoldTimer);
        this._mouse4HoldTimer = null;
      }

      if (this.player._isBurstCapturing && this._mouse4Pressed) {
        this.player.stopBurstCapture();
      } else if (this._mouse4Pressed) {
        // Short tap (< 200ms) -> single screenshot
        this.player.takeScreenshot();
      }
      this._mouse4Pressed = false;
    };

    window.addEventListener('mousedown', handleDown, { capture: true });
    window.addEventListener('mouseup', handleUp, { capture: true });
    window.addEventListener('auxclick', (e) => {
      const targetBtn = this.getScreenshotMouseButton();
      if (targetBtn >= 0 && e.button === targetBtn) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { capture: true });

    window.addEventListener('blur', () => {
      if (this._keySHoldTimer) {
        clearTimeout(this._keySHoldTimer);
        this._keySHoldTimer = null;
      }
      if (this.player?._isBurstCapturing && this._keySPressed) {
        this.player.stopBurstCapture();
      }
      this._keySPressed = false;
      this._activeScreenshotCode = null;

      if (this._mouse4HoldTimer) {
        clearTimeout(this._mouse4HoldTimer);
        this._mouse4HoldTimer = null;
      }
      if (this.player?._isBurstCapturing && this._mouse4Pressed) {
        this.player.stopBurstCapture();
      }
      this._mouse4Pressed = false;
    });
  }

  _bindMenuActions() {
    window.hybridAPI.on('menu-action', (action) => {
      this._executeAction(action);
    });
  }

  handleAction(action, event) {
    return this._executeAction(action, event);
  }

  _executeAction(action, event) {
    const hasMedia = this._hasActiveMedia();

    const mediaRequiredActions = [
      'toggle-play',
      'cycle-audio',
      'stop',
      'seek-back-5',
      'seek-forward-5',
      'seek-0', 'seek-10', 'seek-20', 'seek-30', 'seek-40', 'seek-50', 'seek-60', 'seek-70', 'seek-80', 'seek-90',
      'speed-up',
      'speed-down',
      'frame-forward',
      'frame-backward',
      'toggle-stats',
      'toggle-subtitles',
      'sub-delay-down',
      'sub-delay-up',
      'screenshot',
      'screenshot-png',
      'delete-latest-screenshot',
      'restore-latest-screenshot',
      'toggle-time-format',
      'toggle-ab-loop',
      'toggle-lock',
    ];

    if (mediaRequiredActions.includes(action) && !hasMedia) {
      return;
    }

    switch (action) {
      case 'toggle-play':
        this.player.togglePlay();
        break;

      case 'cycle-audio':
        this.player.cycleAudioTrack();
        break;
      
      case 'stop':
        this.player.stop();
        break;
      
      case 'seek-back-5': {
        const step = window.HybridApp?.settingsModule?.getSeekStep?.() || 5;
        this.player.seekRelative(-step);
        this.controls.showSkipIndicator(-step);
        break;
      }
      
      case 'seek-forward-5': {
        const step = window.HybridApp?.settingsModule?.getSeekStep?.() || 5;
        this.player.seekRelative(step);
        this.controls.showSkipIndicator(step);
        break;
      }
      
      case 'volume-up': {
        window.hybridAPI.mpv.command('add', 'volume', 5);
        const nextUp = Math.min(100, Math.round((this.player.volume || 0) + 5));
        this.controls.showVolumeOsd(nextUp);
        break;
      }
      
      case 'volume-down': {
        window.hybridAPI.mpv.command('add', 'volume', -5);
        const nextDown = Math.max(0, Math.round((this.player.volume || 0) - 5));
        this.controls.showVolumeOsd(nextDown);
        break;
      }
      
      case 'toggle-mute':
        this.player.toggleMute();
        window.HybridToast?.show(this.player.muted ? '🔇 Muted' : '🔊 Unmuted');
        break;
      
      case 'toggle-fullscreen':
        window.hybridAPI?.window?.logFullscreen?.('renderer:shortcut:toggle-fullscreen');
        this.controls.toggleFullscreen();
        break;
      
      case 'exit-fullscreen':
        window.hybridAPI?.window?.logFullscreen?.('renderer:shortcut:exit-fullscreen');
        window.hybridAPI.window.fullscreen(false);
        break;
      
      case 'speed-up': {
        const newSpeed = Math.min(4, this.player.getSpeed() + 0.25);
        this.player.setSpeed(newSpeed);
        this.controls._updateSpeedUI(newSpeed);
        window.HybridToast?.show(`Speed: ${newSpeed}x`);
        break;
      }
      
      case 'speed-down': {
        const newSpeed2 = Math.max(0.25, this.player.getSpeed() - 0.25);
        this.player.setSpeed(newSpeed2);
        this.controls._updateSpeedUI(newSpeed2);
        window.HybridToast?.show(`Speed: ${newSpeed2}x`);
        break;
      }
      
      case 'frame-forward':
        this.player.frameForward();
        window.HybridToast?.show('Frame →');
        break;
      
      case 'frame-backward':
        this.player.frameBackward();
        window.HybridToast?.show('← Frame');
        break;
      
      case 'toggle-stats': {
        const stats = document.getElementById('statsOverlay');
        stats.hidden = !stats.hidden;
        break;
      }
      
      case 'toggle-subtitles':
        this.controls.toggleModal('subtitleModal');
        break;

      case 'sub-delay-down':
        window.HybridApp?.subtitleModule?.adjustSync(-0.1);
        break;

      case 'sub-delay-up':
        window.HybridApp?.subtitleModule?.adjustSync(0.1);
        break;
      
      case 'toggle-equalizer':
        this.controls.toggleModal('equalizerModal');
        break;
      
      case 'next-track':
      case 'next':
        window.HybridApp?.playlistModule?.playNext();
        break;
      
      case 'previous-track':
      case 'previous':
        window.HybridApp?.playlistModule?.playPrevious();
        break;
      
      case 'screenshot':
        this.player.takeScreenshot();
        break;

      case 'screenshot-png':
        this.player.takeScreenshot('png');
        break;

      case 'delete-latest-screenshot':
        this.player.deleteLatestScreenshot();
        break;

      case 'restore-latest-screenshot':
        this.player.restoreLatestScreenshot();
        break;

      case 'toggle-screenshot-carousel':
        this.player.toggleScreenshotCarousel();
        break;

      case 'toggle-restore-carousel':
        this.player.toggleRestoreCarousel();
        break;

      case 'toggle-recording':
        window.HybridApp?.toggleClipRecording();
        break;

      case 'unlock-ui':
        window.HybridApp?.setLocked(false);
        break;

      case 'toggle-lock':
        window.HybridApp?.toggleLock?.();
        break;
      
      case 'toggle-repeat':
        window.HybridApp?.playlistModule?.cycleRepeat() || this.player?.playlist?.cycleRepeat();
        break;

      case 'toggle-ab-loop':
        this.player.setABLoop();
        break;

      case 'toggle-time-format':
        this.controls.toggleTimeFormat?.();
        break;

      case 'toggle-playlist':
        this.controls.togglePlaylist();
        break;

      case 'toggle-bg-settings': {
        const welcomeScreen = document.getElementById('welcomeScreen');
        const isMediaActive = !welcomeScreen || welcomeScreen.classList.contains('hidden') || !!this.player?.currentFilePath || !!window.HybridApp?._loadSpinnerPending;
        if (!isMediaActive) {
          this.controls.toggleModal('bgSettingsModal');
        }
        break;
      }

      case 'toggle-settings':
        this.controls.toggleModal('settingsModal');
        break;
      
      case 'open-file':
        window.HybridApp?.promptOpenFile();
        break;

      case 'open-multiple-files':
        window.HybridApp?.promptOpenMultipleFiles();
        break;
      
      case 'open-folder':
        window.HybridApp?.promptOpenFolder();
        break;

      case 'open-network-stream':
        window.HybridApp?.promptOpenUrl();
        break;

      case 'quit':
        window.hybridAPI?.window?.close();
        break;
      
      case 'show-shortcuts': {
        const playKey = this.formatComboCompact(this.getBinding('toggle-play')) || 'Space';
        const fsKey = this.formatComboCompact(this.getBinding('toggle-fullscreen')) || 'F';
        const muteKey = this.formatComboCompact(this.getBinding('toggle-mute')) || 'M';
        const shotKey = this.formatComboCompact(this.getBinding('screenshot')) || 'S';
        window.HybridToast?.show(`Shortcuts: ${playKey}=Play, ${fsKey}=Fullscreen, ${muteKey}=Mute, ${shotKey}=Screenshot`);
        break;
      }
      
      case 'show-about':
        window.HybridToast?.show('Hybrid Player v1.0.0 — Next-gen media player');
        break;

      // Number keys for seeking to percentage
      default:
        if (action.startsWith('seek-')) {
          const pct = parseInt(action.split('-')[1]);
          this.player.seekPercent(pct);
        }
    }
  }
}

window.HybridShortcuts = HybridShortcuts;
