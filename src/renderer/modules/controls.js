/**
 * Hybrid Player - Controls Module (mpv backend)
 * Manages UI controls, progress bar, volume, and auto-hide behavior.
 * Cursor hiding is delegated to CursorManager.
 */

const CONTROLS_DEBUG = false;
function controlsdbg(...args) {
  if (CONTROLS_DEBUG) console.log(...args);
}

class HybridControls {
  constructor(player) {
    this.player = player;

    // Elements
    this.controlsWrapper   = document.getElementById('controlsWrapper');
    this.titlebar          = document.getElementById('titlebar');
    this.progressContainer = document.getElementById('progressContainer');
    this.progressFill      = document.getElementById('progressFill');
    this.progressBuffer    = document.getElementById('progressBuffer');
    this.progressHandle    = document.getElementById('progressHandle');
    this.chapterMarkers    = document.getElementById('chapterMarkers');
    this.currentTimeEl     = document.getElementById('currentTime');
    this.totalTimeEl       = document.getElementById('totalTime');
    this.volumeSlider      = document.getElementById('volumeSlider');
    this.volumeValue       = document.getElementById('volumeValue');
    this.speedLabel        = document.getElementById('speedLabel');
    this.skipIndicator     = document.getElementById('skip-indicator');
    this.lockButton        = document.getElementById('btnLock');
    this.unlockOverlay     = document.getElementById('unlockOverlay');
    this.recordingIndicator = document.getElementById('recordingIndicator');
    this.recordingIndicatorText = document.getElementById('recordingIndicatorText');

    // Play/Pause icons
    this.iconPlay  = document.querySelector('.icon-play');
    this.iconPause = document.querySelector('.icon-pause');

    // Volume icons
    this.iconVolHigh = document.querySelector('.icon-vol-high');
    this.iconVolLow  = document.querySelector('.icon-vol-low');
    this.iconVolMute = document.querySelector('.icon-vol-mute');

    // Fullscreen icons
    this.iconFsEnter = document.querySelector('.icon-fullscreen-enter');
    this.iconFsExit  = document.querySelector('.icon-fullscreen-exit');

    // State
    this.isDraggingProgress = false;
    this.hideTimeout        = null;
    this.controlsVisible    = true;
    this.currentVolume      = 1;
    this.skipIndicatorTimer = null;
    this.recordingIndicatorTimer = null;
    this._titlebarDragSession = null;
    this._hitTestSyncRaf = null;
    this._titlebarResizeObserver = null;

    // Loading spinner
    this.spinner = document.createElement('div');
    this.spinner.className = 'loading-spinner';
    document.getElementById('videoContainer').appendChild(this.spinner);

    this._bindControls();
    this._setupTitlebarDragRestore();
    this._setupHitTestExclusionsSync();
    this._setupAutoHide();
    this._setupProgressBar();
    this._setupVolumeControl();
    this._setupPlayerCallbacks();

    // Setup observer for welcomeScreen visibility to dynamically show/hide toolbar buttons
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (welcomeScreen) {
      const observer = new MutationObserver(() => {
        this.updateToolbarVisibility();
      });
      observer.observe(welcomeScreen, { attributes: true, attributeFilter: ['class'] });
    }
    this.updateToolbarVisibility();
  }

  _bindControls() {
    const shouldIgnoreFullscreenDblClick = (target) => {
      if (!target || !(target instanceof Element)) return false;
      return !!target.closest(
        '#controlsWrapper, .modal-overlay, .welcome-bg-settings, .welcome-recent, .recent-item, button, input, select, textarea, a, [role="button"]'
      );
    };

    const handleFullscreenDblClick = (e, source = 'unknown') => {
      if (shouldIgnoreFullscreenDblClick(e.target)) return;
      e.preventDefault();
      controlsdbg(`[FSDBG][renderer-controls] ${source} dblclick`);
      this.toggleFullscreen();
    };

    // Play/Pause
    document.getElementById('btnPlay').addEventListener('click', () => this.player.togglePlay());

    // Click video container to toggle play (mpv renders natively, not a <video> element)
    const mpvContainer = document.getElementById('mpvContainer');
    let clickTimeout = null;
    if (mpvContainer) {
      mpvContainer.addEventListener('click', (e) => {
        if (shouldIgnoreFullscreenDblClick(e.target)) return;
        if (clickTimeout) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
          return;
        }
        clickTimeout = setTimeout(() => {
          this.player.togglePlay();
          clickTimeout = null;
        }, 250);
      });
      mpvContainer.addEventListener('dblclick', (e) => {
        if (clickTimeout) {
          clearTimeout(clickTimeout);
          clickTimeout = null;
        }
        handleFullscreenDblClick(e, 'mpvContainer');
      });
    }

    // Welcome overlay covers mpv surface; bind dblclick here too.
    const welcomeScreen = document.getElementById('welcomeScreen');
    welcomeScreen?.addEventListener('dblclick', (e) => {
      if (clickTimeout) {
        clearTimeout(clickTimeout);
        clickTimeout = null;
      }
      handleFullscreenDblClick(e, 'welcomeScreen');
    });

    // Previous / Next
    document.getElementById('btnPrev').addEventListener('click', () => {
      window.HybridApp?.playlistModule?.playPrevious();
    });
    document.getElementById('btnNext').addEventListener('click', () => {
      window.HybridApp?.playlistModule?.playNext();
    });

    // Fullscreen
    document.getElementById('btnFullscreen').addEventListener('click', () => this.toggleFullscreen());

    // Screenshot
    document.getElementById('btnScreenshot').addEventListener('click', () => this.player.takeScreenshot());

    // A-B Loop
    document.getElementById('btnABLoop').addEventListener('click', () => {
      this.player.setABLoop();
      this._updateABLoopButton();
    });

    // Speed
    document.getElementById('btnSpeed').addEventListener('click', () => this.toggleModal('speedModal'));

    // Equalizer
    document.getElementById('btnEqualizer').addEventListener('click', () => this.toggleModal('equalizerModal'));

    // Subtitles
    document.getElementById('btnSubtitles').addEventListener('click', () => this.toggleModal('subtitleModal'));

    // Settings
    document.getElementById('btnSettings').addEventListener('click', () => this.toggleModal('settingsModal'));

    // Playlist
    document.getElementById('btnPlaylist').addEventListener('click', () => this.togglePlaylist());

    // Lock / Unlock
    this.lockButton?.addEventListener('click', () => window.HybridApp?.toggleLock());
    this.unlockOverlay?.addEventListener('click', () => window.HybridApp?.setLocked(false));

    // Speed buttons
    document.querySelectorAll('.speed-btn[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseFloat(btn.dataset.speed);
        this.player.setSpeed(speed);
        this._updateSpeedUI(speed);
      });
    });

    // Custom speed slider
    const customSpeedSlider = document.getElementById('customSpeedSlider');
    const customSpeedValue  = document.getElementById('customSpeedValue');
    if (customSpeedSlider) {
      customSpeedSlider.addEventListener('input', () => {
        const speed = parseFloat(customSpeedSlider.value);
        this.player.setSpeed(speed);
        customSpeedValue.textContent = speed.toFixed(2) + 'x';
        this._updateSpeedUI(speed);
      });
    }

    // Window controls
    document.getElementById('btnMinimize').addEventListener('click', async () => {
      controlsdbg('[WINCTRL][renderer] minimize click');
      try {
        await window.hybridAPI.window.minimize();
        controlsdbg('[WINCTRL][renderer] minimize invoke success');
      } catch (error) {
        console.error('[WINCTRL][renderer] minimize invoke failed', error);
      }
    });
    document.getElementById('btnMaximize').addEventListener('click', async () => {
      controlsdbg('[WINCTRL][renderer] toggle-maximize click');
      try {
        const maximized = await window.hybridAPI.window.toggleMaximize();
        controlsdbg('[WINCTRL][renderer] toggle-maximize invoke success', { maximized });
      } catch (error) {
        console.error('[WINCTRL][renderer] toggle-maximize invoke failed', error);
      }
    });
    document.getElementById('btnClose').addEventListener('click', async () => {
      controlsdbg('[WINCTRL][renderer] close click');
      try {
        this.player?.destroy?.();
        await window.hybridAPI.window.close();
        controlsdbg('[WINCTRL][renderer] close invoke success');
      } catch (error) {
        console.error('[WINCTRL][renderer] close invoke failed', error);
      }
    });

    // Volume button
    document.getElementById('btnVolume').addEventListener('click', () => {
      const muted = this.player.toggleMute();
      this._updateVolumeIcon(muted ? 0 : this.currentVolume);
    });

    // Open file button
    document.getElementById('btnOpenFile')?.addEventListener('click', async () => {
      const filePath = await window.hybridAPI.dialog.openFile();
      if (filePath) {
        window.HybridApp?.openFiles([filePath]);
      }
    });

    // Open link button (YouTube / network stream URL)
    document.getElementById('btnOpenLink')?.addEventListener('click', () => {
      window.HybridApp?.promptOpenUrl?.();
    });
  }

  _setupTitlebarDragRestore() {
    const dragSurface = this.titlebar?.querySelector('.titlebar-drag');
    if (!dragSurface || !window.hybridAPI?.window?.titlebarDragStart) return;

    this._titlebarDragSession = {
      active: false,
      framePending: false,
      lastPoint: null,
    };

    const flushMove = () => {
      if (!this._titlebarDragSession?.active) return;
      this._titlebarDragSession.framePending = false;
      const point = this._titlebarDragSession.lastPoint;
      if (!point) return;
      window.hybridAPI.window.titlebarDragMove(point).catch(() => {});
    };

    const onMouseMove = (event) => {
      if (!this._titlebarDragSession?.active) return;
      if ((event.buttons & 1) !== 1) {
        endDrag();
        return;
      }
      event.preventDefault();
      this._titlebarDragSession.lastPoint = {
        screenX: Math.round(event.screenX),
        screenY: Math.round(event.screenY),
      };
      if (this._titlebarDragSession.framePending) return;
      this._titlebarDragSession.framePending = true;
      window.requestAnimationFrame(flushMove);
    };

    const onMouseUp = () => {
      endDrag();
    };

    const endDrag = () => {
      if (!this._titlebarDragSession?.active) return;
      this._titlebarDragSession.active = false;
      this._titlebarDragSession.framePending = false;
      this._titlebarDragSession.lastPoint = null;
      window.removeEventListener('mousemove', onMouseMove, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.hybridAPI.window.titlebarDragEnd().catch(() => {});
    };

    dragSurface.addEventListener('mousedown', async (event) => {
      if (event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.titlebar-controls, .titlebar-btn, button, input, select, textarea, a, [role="button"]')) {
        return;
      }

      const response = await window.hybridAPI.window.titlebarDragStart({
        screenX: Math.round(event.screenX),
        screenY: Math.round(event.screenY),
      });

      if (!response?.handled) return;

      event.preventDefault();
      this._titlebarDragSession.active = true;
      this._titlebarDragSession.framePending = false;
      this._titlebarDragSession.lastPoint = {
        screenX: Math.round(event.screenX),
        screenY: Math.round(event.screenY),
      };

      window.addEventListener('mousemove', onMouseMove, true);
      window.addEventListener('mouseup', onMouseUp, true);
    });

    window.addEventListener('blur', endDrag);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        endDrag();
      }
    });
  }

  _setupHitTestExclusionsSync() {
    if (!window.hybridAPI?.window?.setHitTestExclusions) return;

    const pushExclusions = () => {
      const controls = this.titlebar?.querySelector('.titlebar-controls');
      const exclusions = [];

      if (controls) {
        const rect = controls.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          exclusions.push({
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }
      }

      window.hybridAPI.window.setHitTestExclusions(exclusions).catch(() => {});
    };

    const schedulePush = () => {
      if (this._hitTestSyncRaf != null) return;
      this._hitTestSyncRaf = window.requestAnimationFrame(() => {
        this._hitTestSyncRaf = null;
        pushExclusions();
      });
    };

    schedulePush();
    window.addEventListener('resize', schedulePush);
    window.hybridAPI.window.onStateChanged(() => schedulePush());

    if (typeof ResizeObserver === 'function' && this.titlebar) {
      this._titlebarResizeObserver = new ResizeObserver(() => schedulePush());
      this._titlebarResizeObserver.observe(this.titlebar);
    }
  }

  _setupPlayerCallbacks() {
    this.player.onPlayStateChanged = (playing) => {
      this.iconPlay.style.display  = playing ? 'none' : 'block';
      this.iconPause.style.display = playing ? 'block' : 'none';
      document.getElementById('btnPlay')?.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      // Update cursor manager
      window.HybridApp?.cursorManager?.setPlaying(playing);
    };

    this.player.onTimeUpdate = (currentTime, duration) => {
      if (!this.isDraggingProgress && duration > 0) {
        const percent = (currentTime / duration) * 100;
        this.progressFill.style.width = percent + '%';
        this.currentTimeEl.textContent = this.player.formatTime(currentTime);
      }
    };

    this.player.onMetadataLoaded = () => {
      this.totalTimeEl.textContent = this.player.formatTime(this.player.duration);
      this._updateSpeedUI(this.player.speed);
      this._renderChapterMarkers();
    };

    this.player.onBufferUpdate = (cacheState) => {
      // mpv demuxer-cache-state provides ranges; show first range
      if (cacheState && cacheState['cache-end'] != null && this.player.duration > 0) {
        const percent = (cacheState['cache-end'] / this.player.duration) * 100;
        this.progressBuffer.style.width = Math.min(percent, 100) + '%';
      }
    };

    this.player.onBuffering = (isBuffering) => {
      this.spinner.classList.toggle('active', isBuffering);
    };

    this.player.onVolumeChange = (volume) => {
      // volume from mpv is 0-100 scale
      const clamped = Math.max(0, Math.min(100, typeof volume === 'number' ? volume : 0));
      this.currentVolume = clamped / 100;                        // normalised 0-1
      this.volumeSlider.value = clamped;
      this.volumeValue.textContent = Math.round(clamped) + '%';
      this._updateVolumeIcon(this.player.muted ? 0 : this.currentVolume);
      this._updateVolumeSliderFill();
    };

    this.player.onEnded = () => {
      window.HybridApp?.playlistModule?.playNext();
    };

    this.player.onChapterListChanged = () => {
      this._renderChapterMarkers();
    };

    this.player.onChapterChanged = () => {
      this._syncActiveChapterMarker();
    };

    this.player.onFilesDropped = async (files) => {
      const resolved = await Promise.all(files.map(async (file) => {
        if (typeof file?.path === 'string' && file.path.trim()) {
          return file.path;
        }
        return window.hybridAPI.file.getPathForDroppedFile?.(file) || null;
      }));

      const paths = resolved.filter((filePath) => typeof filePath === 'string' && filePath.trim());
      if (paths.length === 0) {
        window.HybridToast?.show('Could not read dropped file path. Try Open File instead.');
        return;
      }

      window.HybridApp?.openFiles(paths);
    };
  }

  // ─── Auto-hide controls (cursor now handled by CursorManager) ──
  _setupAutoHide() {
    this._mouseOverControls = false;   // safe-zone flag
    this._isDragging = false;          // drag lock (progress + volume)

    const showControls = () => {
      this.controlsWrapper.classList.remove('hidden');
      this.titlebar.classList.remove('hidden');
      this.controlsVisible = true;
    };

    const hideControls = () => {
      // Never hide while hovering controls or during a drag
      if (this._mouseOverControls || this.isDraggingProgress || this._isDragging) return;
      if (this.player.isPlaying) {
        this.controlsWrapper.classList.add('hidden');
        this.titlebar.classList.add('hidden');
        this.controlsVisible = false;
      }
    };

    const resetHideTimer = () => {
      showControls();
      clearTimeout(this.hideTimeout);
      // Don't start the hide countdown while mouse is inside controls
      if (!this._mouseOverControls) {
        this.hideTimeout = setTimeout(hideControls, 2000);
      }
    };

    // Expose helpers so other modules (e.g. fullscreen transitions) can reveal chrome.
    this._showControlsNow = showControls;
    this._hideControlsNow = hideControls;
    this._resetControlsHideTimer = resetHideTimer;

    const videoContainer = document.getElementById('videoContainer');

    videoContainer.addEventListener('mousemove', (e) => {
      // Ignore events that bubble up from inside controls/titlebar
      if (e.target.closest('#controlsWrapper') || e.target.closest('#titlebar')) return;
      resetHideTimer();
    });

    videoContainer.addEventListener('mousedown', resetHideTimer);

    // ── Safe zone: controls wrapper ──
    this.controlsWrapper.addEventListener('mouseenter', () => {
      this._mouseOverControls = true;
      clearTimeout(this.hideTimeout);
      showControls();
    });

    this.controlsWrapper.addEventListener('mouseleave', () => {
      this._mouseOverControls = false;
      if (this.player.isPlaying && !this.isDraggingProgress && !this._isDragging) {
        this.hideTimeout = setTimeout(hideControls, 2000);
      }
    });

    // ── Safe zone: titlebar ──
    this.titlebar.addEventListener('mouseenter', () => {
      this._mouseOverControls = true;
      clearTimeout(this.hideTimeout);
      showControls();
    });

    this.titlebar.addEventListener('mouseleave', () => {
      this._mouseOverControls = false;
      if (this.player.isPlaying && !this.isDraggingProgress && !this._isDragging) {
        this.hideTimeout = setTimeout(hideControls, 2000);
      }
    });

    // ── Global mouseup: reset timer after any drag ends ──
    document.addEventListener('mouseup', () => {
      if (this._isDragging || this.isDraggingProgress) {
        // Let the specific mouseup handlers clear their flags first
        requestAnimationFrame(() => {
          if (!this._mouseOverControls && this.player.isPlaying) {
            clearTimeout(this.hideTimeout);
            this.hideTimeout = setTimeout(hideControls, 2000);
          }
        });
      }
    });
  }

  _setupProgressBar() {
    const container = this.progressContainer;

    const getPercent = (e) => {
      const rect = container.getBoundingClientRect();
      return Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    };

    container.addEventListener('mousedown', (e) => {
      this.isDraggingProgress = true;
      window.HybridApp?._setNetworkLoading(true);
      window.HybridApp?.thumbnailModule?.cancelPending?.();
      const percent = getPercent(e);
      this.progressFill.style.width = percent + '%';
      this.player.seekPercent(percent);
    });

    document.addEventListener('mousemove', (e) => {
      if (this.isDraggingProgress) {
        const percent = getPercent(e);
        this.progressFill.style.width = percent + '%';
        this.currentTimeEl.textContent = this.player.formatTime(this.player.duration * percent / 100);
      }
    });

    document.addEventListener('mouseup', (e) => {
      if (this.isDraggingProgress) {
        const percent = getPercent(e);
        this.player.seekPercent(percent);
        this.isDraggingProgress = false;
      }
    });

    // Hover preview
    container.addEventListener('mousemove', (e) => {
      if (!this.isDraggingProgress) {
        const percent = getPercent(e);
        const time = this.player.duration * percent / 100;
        const hoverThumb = document.getElementById('hoverThumb');
        const hoverTime  = document.getElementById('hoverThumbTime');

        hoverThumb.hidden = false;
        hoverThumb.style.left = `${percent}%`;
        hoverTime.textContent = this.player.formatTime(time);

        // Generate thumbnail preview
        window.HybridApp?.thumbnailModule?.generatePreview(time, percent);
      }
    });

    container.addEventListener('mouseleave', () => {
      document.getElementById('hoverThumb').hidden = true;
      window.HybridApp?.thumbnailModule?.cancelPending?.();
    });
  }

  _setupVolumeControl() {
    this.volumeContainer = document.getElementById('volumeContainer');
    this.btnVolume = document.getElementById('btnVolume');

    // Hide native slider from visual rendering
    if (this.volumeSlider) {
      this.volumeSlider.style.display = 'none';
    }

    // Create custom slider container and elements
    const customSlider = document.createElement('div');
    customSlider.id = 'customVolumeSlider';
    customSlider.className = 'custom-volume-slider';

    const customBar = document.createElement('div');
    customBar.className = 'custom-volume-bar';

    const customFill = document.createElement('div');
    customFill.id = 'customVolumeFill';
    customFill.className = 'custom-volume-fill';

    const customThumb = document.createElement('div');
    customThumb.id = 'customVolumeThumb';
    customThumb.className = 'custom-volume-thumb';

    customBar.appendChild(customFill);
    customSlider.appendChild(customBar);
    customSlider.appendChild(customThumb);

    const track = document.getElementById('volumeSliderTrack');
    if (track) {
      track.appendChild(customSlider);
    }

    // Elastic overflow state representation
    this.volumeElasticState = {
      overflow: 0,
      region: 'middle' // 'left', 'right', 'middle'
    };

    const MAX_OVERFLOW = 30; // Max pixels of visual stretch
    let springFrameId = null;
    let position = 0;
    let velocity = 0;
    const target = 0;
    const stiffness = 0.2; // snappiness
    const damping = 0.55;  // damping of the oscillation

    const timeDisplay = document.querySelector('.time-display');

    const updateSliderUI = () => {
      const overflow = this.volumeElasticState.overflow;
      const region = this.volumeElasticState.region;

      const rect = customSlider.getBoundingClientRect();
      const width = rect.width || 72;

      // Scale calculations for rubber banding
      const scaleX = 1 + (overflow / width);
      const scaleY = 1 - (overflow / MAX_OVERFLOW) * 0.2; // elastic thinning effect

      customSlider.style.transform = `scale(${scaleX}, ${scaleY})`;

      if (region === 'left') {
        customSlider.style.transformOrigin = 'right center';
        if (this.btnVolume) {
          this.btnVolume.style.transform = `translateX(${-overflow}px)`;
        }
        if (this.volumeValue) {
          this.volumeValue.style.transform = '';
        }
        if (timeDisplay) {
          timeDisplay.style.transform = '';
        }
      } else if (region === 'right') {
        customSlider.style.transformOrigin = 'left center';
        if (this.btnVolume) {
          this.btnVolume.style.transform = '';
        }
        if (this.volumeValue) {
          this.volumeValue.style.transform = `translateX(${overflow}px)`;
        }
        if (timeDisplay) {
          timeDisplay.style.transform = `translateX(${overflow}px)`;
        }
      } else {
        customSlider.style.transformOrigin = 'center center';
        if (this.btnVolume) {
          this.btnVolume.style.transform = '';
        }
        if (this.volumeValue) {
          this.volumeValue.style.transform = '';
        }
        if (timeDisplay) {
          timeDisplay.style.transform = '';
        }
      }
    };

    const startSpring = () => {
      if (springFrameId) cancelAnimationFrame(springFrameId);

      const tick = () => {
        if (this.isDraggingVolume) return;

        const force = (target - position) * stiffness;
        velocity = (velocity + force) * damping;
        position += velocity;

        this.volumeElasticState.overflow = position;
        updateSliderUI();

        if (Math.abs(position) > 0.05 || Math.abs(velocity) > 0.05) {
          springFrameId = requestAnimationFrame(tick);
        } else {
          this.volumeElasticState.overflow = 0;
          updateSliderUI();
          springFrameId = null;
        }
      };

      springFrameId = requestAnimationFrame(tick);
    };

    // Pointer events on the custom slider
    this.isDraggingVolume = false;

    customSlider.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      customSlider.setPointerCapture(e.pointerId);
      this.isDraggingVolume = true;
      this.volumeContainer.classList.add('expanded');

      if (springFrameId) {
        cancelAnimationFrame(springFrameId);
        springFrameId = null;
      }

      handleDrag(e);
    });

    const handleDrag = (e) => {
      const rect = customSlider.getBoundingClientRect();
      const left = rect.left;
      const right = rect.right;
      const width = rect.width || 72;
      const x = e.clientX;

      let overflowVal = 0;
      let region = 'middle';

      if (x < left) {
        region = 'left';
        const diff = left - x;
        // Natural exponential decay rubber-banding
        overflowVal = MAX_OVERFLOW * (1 - Math.exp(-diff / 30));
        position = overflowVal;

        if (this.volumeSlider.value !== '0') {
          this.volumeSlider.value = 0;
          this.volumeSlider.dispatchEvent(new Event('input'));
        }
      } else if (x > right) {
        region = 'right';
        const diff = x - right;
        // Natural exponential decay rubber-banding
        overflowVal = MAX_OVERFLOW * (1 - Math.exp(-diff / 30));
        position = overflowVal;

        if (this.volumeSlider.value !== '100') {
          this.volumeSlider.value = 100;
          this.volumeSlider.dispatchEvent(new Event('input'));
        }
      } else {
        region = 'middle';
        overflowVal = 0;
        position = 0;

        const pct = Math.round(((x - left) / width) * 100);
        this.volumeSlider.value = pct;
        this.volumeSlider.dispatchEvent(new Event('input'));
      }

      this.volumeElasticState.overflow = overflowVal;
      this.volumeElasticState.region = region;
      updateSliderUI();
    };

    customSlider.addEventListener('pointermove', (e) => {
      if (this.isDraggingVolume) {
        handleDrag(e);
      }
    });

    const endDrag = (e) => {
      if (this.isDraggingVolume) {
        this.isDraggingVolume = false;
        this.volumeContainer.classList.remove('expanded');
        try {
          customSlider.releasePointerCapture(e.pointerId);
        } catch (err) {}

        startSpring();
      }
    };

    customSlider.addEventListener('pointerup', endDrag);
    customSlider.addEventListener('pointercancel', endDrag);

    // Bind logic for settings synchronization and wheel scrolling on the native volume slider
    this.volumeSlider.addEventListener('input', () => {
      const value = parseInt(this.volumeSlider.value);          // 0-100
      this.currentVolume = value / 100;                         // normalised 0-1
      this.player.setVolume(this.currentVolume);
      this.volumeValue.textContent = value + '%';
      this._updateVolumeIcon(this.currentVolume);
      this._updateVolumeSliderFill();
    });

    this.volumeContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -5 : 5;
      const newVal = Math.max(0, Math.min(100, parseInt(this.volumeSlider.value) + delta));
      this.volumeSlider.value = newVal;
      this.volumeSlider.dispatchEvent(new Event('input'));
    });

    this._updateVolumeSliderFill();
  }

  _updateVolumeSliderFill() {
    const pct = this.volumeSlider.value;
    const customFill = document.getElementById('customVolumeFill');
    const customThumb = document.getElementById('customVolumeThumb');

    if (customFill) {
      customFill.style.width = `${pct}%`;
    }
    if (customThumb) {
      customThumb.style.left = `${pct}%`;
    }
  }

  _updateVolumeIcon(volume) {
    const muted = this.player.muted;
    this.iconVolHigh.style.display = (!muted && volume > 0.5) ? 'block' : 'none';
    this.iconVolLow.style.display  = (!muted && volume > 0 && volume <= 0.5) ? 'block' : 'none';
    this.iconVolMute.style.display = (muted || volume === 0) ? 'block' : 'none';
    document.getElementById('btnVolume')?.setAttribute('aria-label', (muted || volume === 0) ? 'Unmute' : 'Mute');
  }

  _updateSpeedUI(speed) {
    this.speedLabel.textContent = speed === 1 ? '1x' : speed.toFixed(2).replace(/\.?0+$/, '') + 'x';
    document.querySelectorAll('.speed-btn[data-speed]').forEach((button) => {
      const buttonSpeed = Number(button.dataset.speed);
      const isActive = Number.isFinite(buttonSpeed) && Math.abs(buttonSpeed - Number(speed)) < 0.001;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  _updateABLoopButton() {
    const btn = document.getElementById('btnABLoop');
    const isActive = this.player.abLoop.active || this.player.abLoop.a !== null;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }

  _renderChapterMarkers() {
    if (!this.chapterMarkers) return;
    this.chapterMarkers.replaceChildren();

    const duration = Number(this.player.duration) || 0;
    if (duration <= 0) return;

    const chapters = this.player.getChapters()
      .filter((chapter) => Number.isFinite(Number(chapter.time)) && chapter.time > 0 && chapter.time < duration);

    const fragment = document.createDocumentFragment();
    chapters.forEach((chapter) => {
      const marker = document.createElement('button');
      marker.type = 'button';
      marker.className = 'chapter-marker';
      marker.dataset.chapterIndex = String(chapter.index);
      marker.style.left = `${Math.min(100, Math.max(0, (chapter.time / duration) * 100))}%`;
      marker.title = `${chapter.title} - ${this.player.formatTime(chapter.time)}`;
      marker.setAttribute('aria-label', `Go to ${chapter.title}`);
      marker.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.player.goToChapter(chapter.index);
      });
      fragment.appendChild(marker);
    });

    this.chapterMarkers.appendChild(fragment);
    this._syncActiveChapterMarker();
  }

  _syncActiveChapterMarker() {
    if (!this.chapterMarkers) return;
    this.chapterMarkers.querySelectorAll('.chapter-marker').forEach((marker) => {
      marker.classList.toggle('active', Number(marker.dataset.chapterIndex) === Number(this.player.chapter));
    });
  }

  async toggleFullscreen() {
    controlsdbg('[FSDBG][renderer-controls] toggleFullscreen start');
    const current = await window.hybridAPI.window.isFullScreen();
    const isFs = await window.hybridAPI.window.fullscreen(!current);
    controlsdbg('[FSDBG][renderer-controls] toggleFullscreen done', { from: current, to: isFs });
    this.iconFsEnter.style.display = isFs ? 'none' : 'block';
    this.iconFsExit.style.display  = isFs ? 'block' : 'none';
    document.getElementById('btnFullscreen')?.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Fullscreen');
  }

  togglePlaylist() {
    const sidebar = document.getElementById('sidebarPlaylist');
    const willOpen = sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', !willOpen);
    const isOpen = willOpen;
    
    const btnPlaylist = document.getElementById('btnPlaylist');
    if (btnPlaylist) {
      btnPlaylist.setAttribute('aria-expanded', String(isOpen));
      btnPlaylist.classList.toggle('active', isOpen);
    }

    if (isOpen) {
      document.body.classList.add('playlist-open');
    } else {
      document.body.classList.remove('playlist-open');
    }
  }

  revealChromeAfterWindowStateChange() {
    if (typeof this._showControlsNow === 'function') {
      this._showControlsNow();
    } else {
      this.controlsWrapper?.classList.remove('hidden');
      this.titlebar?.classList.remove('hidden');
      this.controlsVisible = true;
    }

    if (this.player?.isPlaying) {
      if (typeof this._resetControlsHideTimer === 'function') {
        this._resetControlsHideTimer();
      }
    } else {
      clearTimeout(this.hideTimeout);
    }
  }

  showSkipIndicator(seconds) {
    if (!this.skipIndicator) return;

    const roundedSeconds = Math.abs(Math.round(Number(seconds) || 0));
    const isForward = Number(seconds) >= 0;
    const icon = isForward ? '⏩' : '⏪';
    const label = `${isForward ? '+' : '-'}${roundedSeconds}s`;

    const iconEl = document.createElement('span');
    iconEl.className = 'skip-indicator-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.textContent = icon;

    const labelEl = document.createElement('span');
    labelEl.className = 'skip-indicator-text';
    labelEl.textContent = label;

    this.skipIndicator.replaceChildren(iconEl, labelEl);

    clearTimeout(this.skipIndicatorTimer);
    this.skipIndicator.classList.remove('osd-hidden', 'osd-animate');

    // Restart the entrance animation without creating a new DOM node.
    void this.skipIndicator.offsetWidth;
    this.skipIndicator.classList.add('osd-animate');

    this.skipIndicatorTimer = setTimeout(() => {
      this.skipIndicator.classList.add('osd-hidden');
      this.skipIndicator.classList.remove('osd-animate');
    }, 900);
  }

  setLockState(locked) {
    const isLocked = !!locked;
    this.lockButton?.classList.toggle('active', isLocked);
    this.lockButton?.setAttribute('aria-pressed', String(isLocked));
    this.lockButton?.setAttribute('aria-label', isLocked ? 'Controls locked' : 'Lock controls');
    this.unlockOverlay?.classList.toggle('visible', isLocked);
    this.unlockOverlay?.setAttribute('aria-hidden', isLocked ? 'false' : 'true');
  }

  setRecordingState(isRecording, text) {
    if (!this.recordingIndicator || !this.recordingIndicatorText) return;

    clearTimeout(this.recordingIndicatorTimer);
    this.recordingIndicator.hidden = false;
    this.recordingIndicator.classList.toggle('active', !!isRecording);
    this.recordingIndicatorText.textContent = text;

    if (!isRecording) {
      this.recordingIndicatorTimer = setTimeout(() => {
        this.recordingIndicator.hidden = true;
      }, 1600);
    }
  }

  toggleModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.hidden = !modal.hidden;
  }

  closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.hidden = true);
  }

  // Update stats overlay (async – uses mpv property fetch)
  async updateStats() {
    const stats = await this.player.getStatsAsync();
    document.getElementById('statResolution').textContent = stats.resolution;
    document.getElementById('statBitrate').textContent    = stats.bitrate ?? '-';
    document.getElementById('statDropped').textContent    = stats.droppedFrames;
    document.getElementById('statFps').textContent        = stats.fps;
    document.getElementById('statCodec').textContent      = stats.codec ?? '-';
    document.getElementById('statSpeed').textContent      = stats.speed;
    document.getElementById('statBuffer').textContent     = stats.buffered ?? '-';
  }

  updateToolbarVisibility() {
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (!welcomeScreen) return;

    const noMediaLoaded = !welcomeScreen.classList.contains('hidden');

    const toggleButton = (id, show) => {
      const btn = document.getElementById(id);
      if (btn) {
        btn.style.display = show ? '' : 'none';
      }
    };

    toggleButton('bgSettingsToggle', noMediaLoaded);
    toggleButton('btnSpeed', !noMediaLoaded);
    toggleButton('btnEqualizer', !noMediaLoaded);
    toggleButton('btnSubtitles', !noMediaLoaded);
    toggleButton('btnABLoop', !noMediaLoaded);
    toggleButton('btnScreenshot', !noMediaLoaded);
    toggleButton('btnLock', !noMediaLoaded);
  }
}

window.HybridControls = HybridControls;
