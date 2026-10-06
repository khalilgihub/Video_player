/**
 * Hybrid Player - Mouse & Trackpad Gestures Module
 * 
 * Features:
 * 1. Scroll-Wheel Volume Control:
 *    - Scrolling vertically over the video surface adjusts volume smoothly in ±5% steps.
 * 2. Safe Exclusion Zones:
 *    - Progress bar, control bar buttons, and background settings panels are excluded to preserve native scrolling.
 */

class HybridGestures {
  constructor(player, controls) {
    this.player = player;
    this.controls = controls;
    this.container = document.getElementById('videoContainer');
    
    this._setupScrollGestures();
  }

  _setupScrollGestures() {
    // Scroll wheel on video: volume
    this.container.addEventListener('wheel', (e) => {
      // If UI is locked, ignore wheel gestures
      if (window.HybridApp?.isLocked || document.body.classList.contains('is-locked')) return;
      // If no media is loaded, ignore
      if (!this.player?.currentFilePath) return;
      // If modals or carousels are open, ignore
      if (this.player?.isScreenshotCarouselOpen?.() || this.player?.isCarouselOpen?.()) return;
      const hasOpenModal = Array.from(document.querySelectorAll('.modal-overlay:not([hidden])')).some(m => !m.classList.contains('modal-closing'));
      if (hasOpenModal) return;
      // If unlock overlay
      if (e.target.closest('#unlockOverlay') || e.target.closest('.unlock-overlay')) return;
      // If over progress bar, seek instead
      if (e.target.closest('.progress-bar-container') || e.target.closest('.controls-bar')) return;
      // Allow native scrolling in welcome background settings panel.
      if (e.target.closest('.bg-settings-panel') || e.target.closest('.welcome-bg-settings')) return;
      
      e.preventDefault();
      const vol = document.getElementById('volumeSlider');
      if (vol) {
        const delta = e.deltaY > 0 ? -5 : 5;
        vol.value = Math.max(0, Math.min(100, parseInt(vol.value) + delta));
        vol.dispatchEvent(new Event('input'));
      }
    }, { passive: false });
  }

}

window.HybridGestures = HybridGestures;
