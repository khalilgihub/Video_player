/**
 * Hybrid Player - Controls Module (mpv backend)
 * Manages UI controls, progress bar, volume, and auto-hide behavior.
 * Cursor hiding is delegated to CursorManager.
 */

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
    this.currentTimeEl     = document.getElementById('currentTime');
    this.totalTimeEl       = document.getElementById('totalTime');
    this.volumeSlider      = document.getElementById('volumeSlider');
    this.volumeValue       = document.getElementById('volumeValue');
    this.speedLabel        = document.getElementById('speedLabel');

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

    // Loading spinner
    this.spinner = document.createElement('div');
    this.spinner.className = 'loading-spinner';
    document.getElementById('videoContainer').appendChild(this.spinner);

    this._bindControls();
    this._setupAutoHide();
    this._setupProgressBar();
    this._setupVolumeControl();
    this._setupPlayerCallbacks();
  }

  _bindControls() {
    // Play/Pause
    document.getElementById('btnPlay').addEventListener('click', () => this.player.togglePlay());

    // Click video container to toggle play (mpv renders natively, not a <video> element)
    const mpvContainer = document.getElementById('mpvContainer');
    if (mpvContainer) {
      mpvContainer.addEventListener('click', () => this.player.togglePlay());
      mpvContainer.addEventListener('dblclick', (e) => {
        e.preventDefault();
        console.log('[FSDBG][renderer-controls] mpvContainer dblclick');
        this.toggleFullscreen();
      });
    }

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

    // Speed buttons
    document.querySelectorAll('.speed-btn[data-speed]').forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseFloat(btn.dataset.speed);
        this.player.setSpeed(speed);
        this._updateSpeedUI(speed);
        document.querySelectorAll('.speed-btn[data-speed]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
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

    // Sleep timer buttons
    document.querySelectorAll('[data-sleep]').forEach(btn => {
      btn.addEventListener('click', () => {
        const minutes = parseInt(btn.dataset.sleep);
        this.player.setSleepTimer(minutes);
        this.closeAllModals();
      });
    });

    // Window controls
    document.getElementById('btnMinimize').addEventListener('click', () => window.hybridAPI.window.minimize());
    document.getElementById('btnMaximize').addEventListener('click', () => window.hybridAPI.window.maximize());
    document.getElementById('btnClose').addEventListener('click', () => {
      this.player.destroy();
      window.hybridAPI.window.close();
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
  }

  _setupPlayerCallbacks() {
    this.player.onPlayStateChanged = (playing) => {
      this.iconPlay.style.display  = playing ? 'none' : 'block';
      this.iconPause.style.display = playing ? 'block' : 'none';
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
        this.hideTimeout = setTimeout(hideControls, 3000);
      }
    };

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

    // Slider input → set mpv volume (0-100 direct mapping)
    this.volumeSlider.addEventListener('input', () => {
      const value = parseInt(this.volumeSlider.value);          // 0-100
      this.currentVolume = value / 100;                         // normalised 0-1
      this.player.setVolume(this.currentVolume);
      this.volumeValue.textContent = value + '%';
      this._updateVolumeIcon(this.currentVolume);
      this._updateVolumeSliderFill();
    });

    // Keep expanded while interacting
    this.volumeSlider.addEventListener('mousedown', () => this.volumeContainer.classList.add('expanded'));
    document.addEventListener('mouseup', () => this.volumeContainer.classList.remove('expanded'));

    // Scroll wheel on entire volume container (button + track area)
    this.volumeContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -5 : 5;
      const newVal = Math.max(0, Math.min(100, parseInt(this.volumeSlider.value) + delta));
      this.volumeSlider.value = newVal;
      this.volumeSlider.dispatchEvent(new Event('input'));
    });

    // Initialise slider fill
    this._updateVolumeSliderFill();
  }

  /** Sync CSS gradient fill on the horizontal volume slider */
  _updateVolumeSliderFill() {
    const pct = this.volumeSlider.value;
    this.volumeSlider.style.background =
      `linear-gradient(to right, #fff ${pct}%, rgba(255,255,255,0.25) ${pct}%)`;
  }

  _updateVolumeIcon(volume) {
    const muted = this.player.muted;
    this.iconVolHigh.style.display = (!muted && volume > 0.5) ? 'block' : 'none';
    this.iconVolLow.style.display  = (!muted && volume > 0 && volume <= 0.5) ? 'block' : 'none';
    this.iconVolMute.style.display = (muted || volume === 0) ? 'block' : 'none';
  }

  _updateSpeedUI(speed) {
    this.speedLabel.textContent = speed === 1 ? '1x' : speed.toFixed(2).replace(/\.?0+$/, '') + 'x';
  }

  _updateABLoopButton() {
    const btn = document.getElementById('btnABLoop');
    btn.classList.toggle('active', this.player.abLoop.active || this.player.abLoop.a !== null);
  }

  async toggleFullscreen() {
    console.log('[FSDBG][renderer-controls] toggleFullscreen start');
    const current = await window.hybridAPI.window.isFullScreen();
    const isFs = await window.hybridAPI.window.fullscreen(!current);
    console.log('[FSDBG][renderer-controls] toggleFullscreen done', { from: current, to: isFs });
    this.iconFsEnter.style.display = isFs ? 'none' : 'block';
    this.iconFsExit.style.display  = isFs ? 'block' : 'none';
  }

  togglePlaylist() {
    const sidebar = document.getElementById('sidebarPlaylist');
    sidebar.classList.toggle('collapsed');
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
    document.getElementById('statDropped').textContent    = stats.droppedFrames;
    document.getElementById('statFps').textContent        = stats.fps;
    document.getElementById('statSpeed').textContent      = stats.speed;
    document.getElementById('statBuffer').textContent     = stats.bitrate ?? '-';
  }
}

window.HybridControls = HybridControls;
