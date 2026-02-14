/**
 * Hybrid Player - Gesture Module
 * Handles mouse gestures and trackpad swipe for seeking/volume
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
      // If over progress bar, seek instead
      if (e.target.closest('.progress-bar-container') || e.target.closest('.controls-bar')) return;
      
      e.preventDefault();
      const vol = document.getElementById('volumeSlider');
      if (vol) {
        const delta = e.deltaY > 0 ? -5 : 5;
        vol.value = Math.max(0, Math.min(300, parseInt(vol.value) + delta));
        vol.dispatchEvent(new Event('input'));
      }
    }, { passive: false });
  }

}

window.HybridGestures = HybridGestures;
