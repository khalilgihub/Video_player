/**
 * Hybrid Player - Cursor Manager
 * Centralized, single-responsibility cursor controller.
 *
 * RULES:
 *  1. Never touches document.body.style.cursor
 *  2. Uses a single CSS class on the video container
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
    this._idleTimer = null;

    // Bind mouse activity listeners to the container (NOT document.body)
    this.container.addEventListener('mousemove', this._onActivity.bind(this), { passive: true });
    this.container.addEventListener('mousedown', this._onActivity.bind(this), { passive: true });
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
  }

  _hideCursor() {
    this.container.classList.add('cursor-hidden');
  }

  _isModalOpen() {
    return !!document.querySelector('.modal-overlay:not([hidden])');
  }
}

window.CursorManager = CursorManager;
