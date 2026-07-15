/**
 * Hybrid Player - Thumbnail Preview Module (mpv backend)
 * Captures frames via mpv screenshot-to-file for seek-bar hover previews.
 * Uses debouncing to avoid flooding mpv with capture requests.
 */

const THUMBNAILS_DEBUG = false;
function thumbdbg(...args) {
  if (THUMBNAILS_DEBUG) console.debug(...args);
}

class HybridThumbnails {
  constructor(player) {
    this.player = player;
    this.imgEl = document.getElementById('hoverThumbImg');
    this._debounceTimer = null;
    this._lastRequestedTime = -1;
    this._debounceMs = 30;
    this._pending = false;
    this._requestToken = 0;
    this._queuedCapture = null;   // stores latest request while one is in-flight
    this._mediaPath = null;
    this.thumbEl = this.imgEl?.closest('.progress-hover-thumb') || null;
  }

  /**
   * Called from controls.js on progress bar mousemove.
   * @param {number} time  - target timestamp in seconds
   * @param {number} percent - 0-100 position on bar
   */
  generatePreview(time, percent) {
    if (!this.imgEl || !this.player.duration) return;

    if (this._mediaPath !== this.player.currentFilePath) {
      this._mediaPath = this.player.currentFilePath;
      this.imgEl.removeAttribute('src');
      this.thumbEl?.classList.remove('has-frame');
    }

    // Skip if time hasn't meaningfully changed (within 0.1s of last request)
    if (Math.abs(time - this._lastRequestedTime) < 0.1) return;

    this._lastRequestedTime = time;
    this.thumbEl?.classList.add('is-loading');

    const token = ++this._requestToken;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._capture(time, token), this._debounceMs);
  }

  async _capture(time, token) {
    // If a capture is already in-flight, queue this one to retry when it finishes
    if (this._pending) {
      this._queuedCapture = { time, token };
      thumbdbg('[thumbnails] queued capture for', time.toFixed(2), '(pending)');
      return;
    }
    this._pending = true;

    try {
      thumbdbg('[thumbnails] capturing at', time.toFixed(2));
      const result = await window.hybridAPI.mpv.captureThumbnail(time);

      // Only apply if this token is still the latest
      if (token !== this._requestToken) {
        thumbdbg('[thumbnails] stale token, discarding result');
        return;
      }
      if (result && result.dataUrl) {
        const nextImage = new Image();
        nextImage.src = result.dataUrl;
        try {
          await nextImage.decode();
        } catch {
          // The loaded data URL can still be displayed when decode() is unavailable.
        }
        if (token !== this._requestToken) return;
        this.imgEl.src = nextImage.src;
        this.thumbEl?.classList.add('has-frame');
        thumbdbg('[thumbnails] image updated for time', time.toFixed(2));
      }
    } catch (err) {
      thumbdbg('[thumbnails] capture failed:', err.message);
    } finally {
      this._pending = false;

      // If a newer capture was queued while we were busy, fire it now
      if (this._queuedCapture) {
        const queued = this._queuedCapture;
        this._queuedCapture = null;
        // Only run if its token is still the latest
        if (queued.token === this._requestToken) {
          thumbdbg('[thumbnails] draining queued capture for', queued.time.toFixed(2));
          this._capture(queued.time, queued.token);
          return;
        }
      }
      if (token === this._requestToken) this.thumbEl?.classList.remove('is-loading');
    }
  }

  destroy() {
    clearTimeout(this._debounceTimer);
    this._queuedCapture = null;
  }

  cancelPending() {
    this._requestToken++;
    this._queuedCapture = null;
    clearTimeout(this._debounceTimer);
    this.thumbEl?.classList.remove('is-loading');
  }
}

window.HybridThumbnails = HybridThumbnails;
