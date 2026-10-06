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

class HybridShortcuts {
  constructor(player, controls) {
    this.player = player;
    this.controls = controls;
    
    this.defaults = {
      'Space': 'toggle-play',
      'KeyK': 'toggle-play',
      'ArrowLeft': 'seek-back-5',
      'ArrowRight': 'seek-forward-5',
      'ArrowUp': 'volume-up',
      'ArrowDown': 'volume-down',
      'KeyM': 'toggle-mute',
      'KeyU': 'unlock-ui',
      'KeyF': 'toggle-fullscreen',
      'Escape': 'exit-fullscreen',
      'BracketRight': 'speed-up',
      'BracketLeft': 'speed-down',
      'Period': 'frame-forward',
      'Comma': 'frame-backward',
      'KeyI': 'toggle-stats',
      'KeyC': 'toggle-subtitles',
      'KeyG': 'sub-delay-down',
      'KeyH': 'sub-delay-up',
      'KeyA': 'cycle-audio',
      'KeyN': 'next-track',
      'KeyP': 'previous-track',
      'KeyE': 'toggle-equalizer',
      'KeyL': 'toggle-repeat',
      'KeyR': 'toggle-ab-loop',
      'KeyT': 'toggle-time-format',
      'KeyS': 'screenshot',
      'KeyD': 'delete-latest-screenshot',
      'KeyZ': 'restore-latest-screenshot',
      'KeyB': 'toggle-bg-settings',
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
    this._keySHoldTimer = null;
    this._keySPressed = false;
    this._mouse4HoldTimer = null;
    this._mouse4Pressed = false;
    this._bindKeyboard();
    this._bindMouse();
    this._bindMenuActions();
  }

  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
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
          if (code === 'Enter' || (code === 'KeyZ' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            this.player.restoreSelectedCarouselScreenshot();
            return;
          }
        } else {
          if (code === 'Enter' || (code === 'KeyD' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
            e.preventDefault();
            e.stopPropagation();
            this.player.deleteSelectedCarouselScreenshot();
            return;
          }
        }
      }

      const action = this._getModifiedShortcutAction(e) || this.shortcuts[code];

      if (code === 'KeyF' || code === 'Escape') {
        console.log('[FSDBG][renderer-shortcuts] keydown', {
          code,
          key: e.key,
          action,
          modalOpen: !!document.querySelector('.modal-overlay:not([hidden])')
        });
      }
      
      if (!action) return;

      const isLocked = !!window.HybridApp?.isLocked;
      if (isLocked && action !== 'unlock-ui') {
        e.preventDefault();
        return;
      }
      
      // Some actions should work even in modals
      if (action !== 'toggle-play' && anyModalOpen) return;

      // Special handling for KeyS (Hold-to-Burst frame capture vs Single Tap)
      if (code === 'KeyS' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        if (!e.repeat) {
          this._keySPressed = true;
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

      e.preventDefault();
      if (action === 'toggle-fullscreen' || action === 'exit-fullscreen') {
        console.log('[FSDBG][renderer-shortcuts] execute action', action);
      }
      this._executeAction(action, e);
    });

    document.addEventListener('keyup', (e) => {
      if (e.code === 'KeyS') {
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
      }
    });
  }

  _getModifiedShortcutAction(e) {
    const isPrimaryModifier = e.ctrlKey || e.metaKey;
    if (!isPrimaryModifier || e.altKey) return null;

    if (e.shiftKey) {
      return e.code === 'KeyO' ? 'open-multiple-files' : null;
    }

    switch (e.code) {
      case 'KeyO':
        return 'open-file';
      case 'KeyF':
        return 'open-folder';
      case 'KeyN':
        return 'open-network-stream';
      case 'KeyL':
        return 'toggle-playlist';
      case 'Comma':
        return 'toggle-settings';
      case 'KeyS':
        return 'toggle-recording';
      case 'KeyZ':
        return 'toggle-restore-carousel';
      case 'KeyD':
        return 'toggle-screenshot-carousel';
      case 'KeyQ':
        return 'quit';
      default:
        return null;
    }
  }

  _hasActiveMedia() {
    const welcome = document.getElementById('welcomeScreen');
    return !welcome || welcome.classList.contains('hidden') || !!this.player?.currentFilePath || (this.player?.trackList && this.player.trackList.length > 0) || !!window.HybridApp?._loadSpinnerPending;
  }

  _bindMouse() {
    const handleDown = (e) => {
      // Mouse 4 corresponds to button === 3 (Back button)
      if (e.button !== 3) return;

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

      const isLocked = !!window.HybridApp?.isLocked || document.body.classList.contains('is-locked');
      if (isLocked) return;

      const anyModalOpen = document.querySelector('.modal-overlay:not([hidden])');
      if (anyModalOpen) return;

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
      if (e.button !== 3) return;

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
      if (e.button === 3) {
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
      'delete-latest-screenshot',
      'restore-latest-screenshot',
      'toggle-time-format',
      'toggle-ab-loop',
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
      
      case 'volume-up':
        window.hybridAPI.mpv.command('add', 'volume', 5);
        break;
      
      case 'volume-down':
        window.hybridAPI.mpv.command('add', 'volume', -5);
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
