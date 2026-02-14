/**
 * Hybrid Player - Thumbnail Preview Module (mpv backend)
 * Captures frames via mpv screenshot-to-file for seek-bar hover previews.
 * Uses debouncing to avoid flooding mpv with capture requests.
 */

class HybridThumbnails {
  constructor(player) {
    this.player = player;
    this.imgEl = document.getElementById('hoverThumbImg');
    this._debounceTimer = null;
    this._lastRequestedTime = -1;
    this._debounceMs = 120;
    this._pending = false;
    this._requestToken = 0;
    this._queuedCapture = null;   // stores latest request while one is in-flight
  }

  /**
   * Called from controls.js on progress bar mousemove.
   * @param {number} time  - target timestamp in seconds
   * @param {number} percent - 0-100 position on bar
   */
  generatePreview(time, percent) {
    if (!this.imgEl || !this.player.duration) return;

    // Skip if time hasn't meaningfully changed (within 0.25s of last request)
    if (Math.abs(time - this._lastRequestedTime) < 0.25) return;

    this._lastRequestedTime = time;

    const token = ++this._requestToken;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._capture(time, token), this._debounceMs);
  }

  async _capture(time, token) {
    // If a capture is already in-flight, queue this one to retry when it finishes
    if (this._pending) {
      this._queuedCapture = { time, token };
      console.debug('[thumbnails] queued capture for', time.toFixed(2), '(pending)');
      return;
    }
    this._pending = true;

    try {
      console.debug('[thumbnails] capturing at', time.toFixed(2));
      const result = await window.hybridAPI.mpv.captureThumbnail(time);

      // Only apply if this token is still the latest
      if (token !== this._requestToken) {
        console.debug('[thumbnails] stale token, discarding result');
        return;
      }
      if (result && result.dataUrl) {
        this.imgEl.src = result.dataUrl;
        console.debug('[thumbnails] image updated for time', time.toFixed(2));
      }
    } catch (err) {
      console.debug('[thumbnails] capture failed:', err.message);
    } finally {
      this._pending = false;

      // If a newer capture was queued while we were busy, fire it now
      if (this._queuedCapture) {
        const queued = this._queuedCapture;
        this._queuedCapture = null;
        // Only run if its token is still the latest
        if (queued.token === this._requestToken) {
          console.debug('[thumbnails] draining queued capture for', queued.time.toFixed(2));
          this._capture(queued.time, queued.token);
        }
      }
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
  }
}

window.HybridThumbnails = HybridThumbnails;
