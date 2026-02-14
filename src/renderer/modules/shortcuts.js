/**
 * Hybrid Player - Keyboard Shortcuts Module
 * Customizable keyboard shortcuts for all player actions
 */

class HybridShortcuts {
  constructor(player, controls) {
    this.player = player;
    this.controls = controls;
    
    this.defaults = {
      'Space': 'toggle-play',
      'KeyK': 'toggle-play',
      'ArrowLeft': 'seek-back-5',
      'ArrowRight': 'seek-forward-5',
      'KeyJ': 'seek-back-10',
      'KeyL': 'seek-forward-10',
      'ArrowUp': 'volume-up',
      'ArrowDown': 'volume-down',
      'KeyM': 'toggle-mute',
      'KeyF': 'toggle-fullscreen',
      'Escape': 'exit-fullscreen',
      'BracketRight': 'speed-up',
      'BracketLeft': 'speed-down',
      'Period': 'frame-forward',
      'Comma': 'frame-backward',
      'KeyI': 'toggle-stats',
      'KeyC': 'toggle-subtitles',
      'KeyN': 'next-track',
      'KeyP': 'previous-track',
      'KeyE': 'toggle-equalizer',
      'KeyT': 'toggle-time-format',
      'KeyS': 'screenshot',
      'Digit0': 'seek-0',
      'Digit1': 'seek-10',
      'Digit2': 'seek-20',
      'Digit3': 'seek-30',
      'Digit4': 'seek-40',
      'Digit5': 'seek-50',
      'Digit6': 'seek-60',
      'Digit7': 'seek-70',
      'Digit8': 'seek-80',
      'Digit9': 'seek-90',
    };

    this.shortcuts = { ...this.defaults };
    this._bindKeyboard();
    this._bindMenuActions();
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Don't intercept when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      // Check for modals
      const anyModalOpen = document.querySelector('.modal-overlay:not([hidden])');

      const code = e.code;
      const action = this.shortcuts[code];

      if (code === 'KeyF' || code === 'Escape') {
        console.log('[FSDBG][renderer-shortcuts] keydown', {
          code,
          key: e.key,
          action,
          modalOpen: !!document.querySelector('.modal-overlay:not([hidden])')
        });
      }
      
      if (!action) return;
      
      // Some actions should work even in modals
      if (action !== 'toggle-play' && action !== 'exit-fullscreen' && anyModalOpen) return;

      e.preventDefault();
      if (action === 'toggle-fullscreen' || action === 'exit-fullscreen') {
        console.log('[FSDBG][renderer-shortcuts] execute action', action);
      }
      this._executeAction(action, e);
    });
  }

  _bindMenuActions() {
    window.hybridAPI.on('menu-action', (action) => {
      this._executeAction(action);
    });
  }

  _executeAction(action, event) {
    const vol = document.getElementById('volumeSlider');
    
    switch (action) {
      case 'toggle-play':
        this.player.togglePlay();
        break;
      
      case 'stop':
        this.player.stop();
        break;
      
      case 'seek-back-5':
        this.player.seekRelative(-5);
        window.HybridToast?.show('⏪ -5s');
        break;
      
      case 'seek-forward-5':
        this.player.seekRelative(5);
        window.HybridToast?.show('⏩ +5s');
        break;
      
      case 'seek-back-10':
        this.player.seekRelative(-10);
        window.HybridToast?.show('⏪ -10s');
        break;
      
      case 'seek-forward-10':
        this.player.seekRelative(10);
        window.HybridToast?.show('⏩ +10s');
        break;
      
      case 'volume-up':
        if (vol) {
          vol.value = Math.min(300, parseInt(vol.value) + 5);
          vol.dispatchEvent(new Event('input'));
        }
        break;
      
      case 'volume-down':
        if (vol) {
          vol.value = Math.max(0, parseInt(vol.value) - 5);
          vol.dispatchEvent(new Event('input'));
        }
        break;
      
      case 'toggle-mute':
        this.player.toggleMute();
        window.HybridToast?.show(this.player.muted ? '🔇 Muted' : '🔊 Unmuted');
        break;
      
      case 'toggle-fullscreen':
        this.controls.toggleFullscreen();
        break;
      
      case 'exit-fullscreen':
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
      
      case 'toggle-playlist':
        this.controls.togglePlaylist();
        break;
      
      case 'open-file':
        window.HybridApp?.promptOpenFile();
        break;
      
      case 'open-folder':
        window.HybridApp?.promptOpenFolder();
        break;
      
      case 'show-shortcuts':
        window.HybridToast?.show('Keyboard shortcuts: Space=Play, F=Fullscreen, M=Mute, [/]=Speed');
        break;
      
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
