/**
 * Hybrid Player - Cursor Manager
 * Centralized, single-responsibility cursor controller.
 *
 * RULES:
 *  1. Never touches document.body.style.cursor directly
 *  2. Uses CSS classes on the video container and, in fullscreen, document.body
 *  3. Hides cursor ONLY when:
 *       - Video is playing  (isPlaying === true)
 *       - Mouse is idle for IDLE_MS
 *       - No modal is open
 *  4. A single timer – no duplicate setTimeout / setInterval
 */

class CursorManager {
  static IDLE_MS = 2000;

  constructor(containerSelector = '#videoContainer') {
    /** @type {HTMLElement} */
    this.container = document.querySelector(containerSelector);
    if (!this.container) {
      console.warn('CursorManager: container not found');
      return;
    }

    // State
    this._isPlaying = false;
    this._isFullscreen = false;
    this._idleTimer = null;
    this._isMouseDown = false;

    // Bind mouse activity listeners to the container (NOT document.body)
    this.container.addEventListener('mousemove', this._onActivity.bind(this), { passive: true });

    // Track pointer/mouse down state globally to prevent hiding when dragging
    window.addEventListener('mousedown', () => {
      this._isMouseDown = true;
      this._onActivity();
    }, { passive: true });
    window.addEventListener('pointerdown', () => {
      this._isMouseDown = true;
      this._onActivity();
    }, { passive: true });

    // Track mouseup/pointerup globally to release pointer down state
    window.addEventListener('mouseup', () => {
      this._isMouseDown = false;
      this._onActivity();
    }, { passive: true });
    window.addEventListener('pointerup', () => {
      this._isMouseDown = false;
      this._onActivity();
    }, { passive: true });
    window.addEventListener('pointercancel', () => {
      this._isMouseDown = false;
      this._onActivity();
    }, { passive: true });
  }

  // ─── Public API ────────────────────────────────────────

  /** Call when play/pause state changes */
  setPlaying(playing) {
    this._isPlaying = playing;
    if (!playing) {
      this._showCursor();
      this._clearTimer();
    } else {
      this._resetTimer();
    }
  }

  /** Force-show cursor (e.g. when opening a modal) */
  show() {
    this._showCursor();
    this._clearTimer();
  }

  /** Re-evaluate after a modal is closed */
  resume() {
    if (this._isPlaying) {
      this._resetTimer();
    }
  }

  setFullscreen(isFullscreen) {
    this._isFullscreen = !!isFullscreen;
    if (!this._isFullscreen) {
      document.body.classList.remove('force-hide-cursor');
      return;
    }

    if (this._isPlaying && !this._isModalOpen()) {
      this._resetTimer();
    }
  }

  // ─── Internal ──────────────────────────────────────────

  _onActivity() {
    this._showCursor();
    if (this._isPlaying && !this._isModalOpen()) {
      this._resetTimer();
    }
  }

  _resetTimer() {
    this._clearTimer();
    this._idleTimer = setTimeout(() => {
      if (this._isPlaying && !this._isModalOpen()) {
        this._hideCursor();
      }
    }, CursorManager.IDLE_MS);
  }

  _clearTimer() {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  _showCursor() {
    this.container.classList.remove('cursor-hidden');
    document.body.classList.remove('force-hide-cursor');
  }

  _hideCursor() {
    if (this._isMouseDown) {
      this._resetTimer();
      return;
    }
    this.container.classList.add('cursor-hidden');
    if (this._isFullscreen) {
      document.body.classList.add('force-hide-cursor');
    }
  }

  _isModalOpen() {
    return !!document.querySelector('.modal-overlay:not([hidden])');
  }
}

window.CursorManager = CursorManager;
