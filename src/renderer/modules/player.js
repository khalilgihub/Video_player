/**
 * Hybrid Player - Core Player Module (mpv backend)
 * All playback is driven by mpv via IPC.  The HTML  <video> element is removed;
 * mpv renders directly into the window through --wid.
 *
 * This module mirrors the old HybridPlayer public API so that controls,
 * shortcuts, gestures, playlist etc. keep working with zero changes to
 * their call-sites.
 */

class HybridPlayer {
  constructor() {
    this.videoContainer = document.getElementById('videoContainer');
    this.welcomeScreen  = document.getElementById('welcomeScreen');

    // ── Observed state (pushed from mpv via property-change) ──
    this.currentTime  = 0;
    this.duration     = 0;
    this.isPlaying    = false;
    this.volume       = 100;
    this.speed        = 1;
    this.muted        = false;
    this.trackList    = [];
    this.chapterList  = [];
    this.chapter      = -1;
    this.videoParams  = null;
    this.subDelay     = 0;
    this.subVisible   = true;

    // Per-file state
    this.currentFile     = null;
    this.currentFilePath = null;

    // A-B loop (UI state – the actual loop runs inside mpv)
    this.abLoop = { a: null, b: null, active: false };

    // Sleep timer
    this.sleepTimer   = null;
    this.sleepTimeout = null;

    // Resume-save debounce
    this._lastResumeSaveSecond = -1;
    this._resumeSaveInFlight   = false;

    // ── Callback hooks (same signature as old player) ───
    /** @type {Function|null} */ this.onPlayStateChanged = null;
    /** @type {Function|null} */ this.onTimeUpdate       = null;
    /** @type {Function|null} */ this.onMetadataLoaded   = null;
    /** @type {Function|null} */ this.onBufferUpdate      = null;
    /** @type {Function|null} */ this.onBuffering         = null;
    /** @type {Function|null} */ this.onVolumeChange      = null;
    /** @type {Function|null} */ this.onEnded             = null;
    /** @type {Function|null} */ this.onError             = null;
    /** @type {Function|null} */ this.onFilesDropped      = null;
    /** @type {Function|null} */ this.onTrackListChanged  = null;
    /** @type {Function|null} */ this.onChapterListChanged = null;
    /** @type {Function|null} */ this.onChapterChanged     = null;

    this._setupMpvListeners();
    this._setupDragAndDrop();
  }

  // ─── mpv event listeners ───────────────────────────────
  _setupMpvListeners() {
    // Property changes pushed by mpv → main → preload → here
    window.hybridAPI.mpv.onPropertyChange((name, value) => {
      switch (name) {
        case 'time-pos':
          if (value != null) {
            this.currentTime = value;
            this.onTimeUpdate?.(this.currentTime, this.duration);
            this._maybeSaveResume();
          }
          break;

        case 'duration':
          if (value != null) {
            this.duration = value;
            this.onMetadataLoaded?.();
          }
          break;

        case 'pause':
          this.isPlaying = !value;
          this.onPlayStateChanged?.(this.isPlaying);
          break;

        case 'volume':
          this.volume = value;
          this.onVolumeChange?.(value);
          break;

        case 'mute':
          this.muted = value;
          this.onVolumeChange?.(this.muted ? 0 : this.volume);
          break;

        case 'speed':
          this.speed = value;
          break;

        case 'track-list':
          this.trackList = value || [];
          this.onTrackListChanged?.(this.trackList);
          break;

        case 'chapter-list':
          this.chapterList = value || [];
          this.onChapterListChanged?.(this.chapterList);
          break;

        case 'chapter':
          this.chapter = value;
          this.onChapterChanged?.(value);
          break;

        case 'video-params':
          this.videoParams = value;
          break;

        case 'sub-delay':
          this.subDelay = value ?? 0;
          break;

        case 'sub-visibility':
          this.subVisible = !!value;
          break;

        case 'eof-reached':
          if (value) {
            this.isPlaying = false;
            this._autoSaveResume({ force: true });
            this.onPlayStateChanged?.(false);
            this.onEnded?.();
          }
          break;

        case 'demuxer-cache-state':
          this.onBufferUpdate?.(value);
          break;
      }
    });

    // mpv discrete events
    window.hybridAPI.mpv.onEvent((event, data) => {
      switch (event) {
        case 'file-loaded':
          this.onMetadataLoaded?.();
          break;
        case 'end-file':
          if (data === 'eof' || data?.reason === 'eof') {
            this.isPlaying = false;
            this._autoSaveResume({ force: true });
            this.onPlayStateChanged?.(false);
            this.onEnded?.();
          }
          break;
        case 'error':
          console.error('mpv error:', data);
          this.onError?.(data);
          break;
      }
    });
  }

  // ─── Drag & Drop ───────────────────────────────────────
  _setupDragAndDrop() {
    const dropOverlay = document.createElement('div');
    dropOverlay.className = 'drop-overlay';
    dropOverlay.innerHTML = '<div class="drop-overlay-content"><div class="drop-overlay-icon">📂</div><p>Drop media file to play</p></div>';
    document.body.appendChild(dropOverlay);

    let dragCounter = 0;

    document.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; dropOverlay.classList.add('active'); });
    document.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter === 0) dropOverlay.classList.remove('active'); });
    document.addEventListener('dragover',  (e) => { e.preventDefault(); });

    document.addEventListener('drop', (e) => {
      e.preventDefault();
      dragCounter = 0;
      dropOverlay.classList.remove('active');
      const files = Array.from(e.dataTransfer?.files || []);

      if (files.length === 0 && e.dataTransfer?.items) {
        for (const item of Array.from(e.dataTransfer.items)) {
          if (item.kind !== 'file') continue;
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        this.onFilesDropped?.(files);
      }
    });
  }

  // ─── Resume-save debounce ──────────────────────────────
  _maybeSaveResume() {
    const sec = Math.floor(this.currentTime);
    if (this.currentFilePath && sec > 5 && sec - this._lastResumeSaveSecond >= 5) {
      this._autoSaveResume();
    }
  }

  async _autoSaveResume({ force = false } = {}) {
    if (!this.currentFilePath || this.currentTime <= 5) return;
    if (this._resumeSaveInFlight) return;
    const sec = Math.floor(this.currentTime);
    if (!force && sec - this._lastResumeSaveSecond < 5) return;

    this._lastResumeSaveSecond = sec;
    this._resumeSaveInFlight   = true;
    try {
      await window.hybridAPI.resume.save(this.currentFilePath, this.currentTime);
    } finally {
      this._resumeSaveInFlight = false;
    }
  }

  // ═══════════════════════════════════════════════════════
  // PUBLIC API  (matches old HybridPlayer interface)
  // ═══════════════════════════════════════════════════════

  async loadFile(filePath) {
    try {
      const settingsModal = document.getElementById('settingsModal');
      if (settingsModal) settingsModal.hidden = true;
      window.HybridApp?._beginVideoLoadSpinner?.();

      this._lastResumeSaveSecond = -1;
      this._resumeSaveInFlight   = false;
      this.currentFilePath = filePath;

      // Tell mpv to load
      await window.hybridAPI.mpv.loadFile(filePath);

      // Hide welcome screen
      this.welcomeScreen.classList.add('hidden');

      // Title bar
      const fileName = filePath.split(/[/\\]/).pop();
      document.getElementById('titlebarText').textContent = fileName + ' — Hybrid Player';

      // Resume position
      const prefs = await window.hybridAPI.db.getAllPreferences();
      if (prefs.autoResume) {
        const resumeTime = await window.hybridAPI.resume.get(filePath);
        if (resumeTime > 5) {
          // Small delay so mpv loads first
          setTimeout(() => {
            window.hybridAPI.mpv.seek(resumeTime, 'absolute');
            window.HybridToast?.show(`Resuming from ${this.formatTime(resumeTime)}`);
          }, 500);
        }
      }

      // Saved speed
      const savedSpeed = await window.hybridAPI.speed.get(filePath);
      if (savedSpeed) {
        window.hybridAPI.mpv.setSpeed(savedSpeed);
      }

      // History
      await window.hybridAPI.history.add({
        path: filePath,
        name: fileName,
        duration: 0,
        timestamp: Date.now()
      });

      // mpv auto-plays after loadfile by default
    } catch (err) {
      console.error('Failed to load file:', err);
      window.HybridToast?.show('Failed to load: ' + filePath.split(/[/\\]/).pop());
    }
  }

  loadUrl(url) {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.hidden = true;
    window.HybridApp?._beginVideoLoadSpinner?.();

    this.currentFilePath = url;
    this.welcomeScreen.classList.add('hidden');
    document.getElementById('titlebarText').textContent = 'Network Stream — Hybrid Player';
    window.hybridAPI.mpv.loadFile(url);
  }

  togglePlay() {
    window.hybridAPI.mpv.togglePause();
  }

  stop() {
    window.hybridAPI.mpv.stop();
    this.isPlaying = false;
  }

  seek(time) {
    if (!isNaN(time) && isFinite(time)) {
      window.HybridApp?._setNetworkLoading(true);
      window.hybridAPI.mpv.seek(Math.max(0, Math.min(time, this.duration)), 'absolute');
    }
  }

  seekRelative(seconds) {
    window.HybridApp?._setNetworkLoading(true);
    window.hybridAPI.mpv.seekRelative(seconds);
  }

  seekPercent(percent) {
    window.HybridApp?._setNetworkLoading(true);
    window.hybridAPI.mpv.seekPercent(percent);
  }

  // ── Volume ─────────────────────────────────────────────
  setVolume(value) {
    // value: 0–1 → mpv volume 0–100
    window.hybridAPI.mpv.setVolume(Math.round(value * 100));
  }

  getEffectiveVolume() {
    return this.muted ? 0 : this.volume / 100;
  }

  toggleMute() {
    this.muted = !this.muted;
    window.hybridAPI.mpv.setMute(this.muted);
    return this.muted;
  }

  // ── Speed ──────────────────────────────────────────────
  setSpeed(speed) {
    const clamped = Math.max(0.1, Math.min(speed, 16));
    window.hybridAPI.mpv.setSpeed(clamped);
    if (this.currentFilePath) {
      window.hybridAPI.speed.save(this.currentFilePath, clamped);
    }
  }

  getSpeed() {
    return this.speed;
  }

  // ── Frame stepping ─────────────────────────────────────
  frameForward()  { window.hybridAPI.mpv.pause(); window.hybridAPI.mpv.frameStep();     }
  frameBackward() { window.hybridAPI.mpv.pause(); window.hybridAPI.mpv.frameBackStep(); }

  // ── A-B Loop ───────────────────────────────────────────
  setABLoop() {
    if (this.abLoop.a === null) {
      this.abLoop.a = this.currentTime;
      window.hybridAPI.mpv.setABLoopA(this.currentTime);
      window.HybridToast?.show(`Loop A: ${this.formatTime(this.abLoop.a)}`);
    } else if (this.abLoop.b === null) {
      this.abLoop.b = this.currentTime;
      this.abLoop.active = true;
      window.hybridAPI.mpv.setABLoopB(this.currentTime);
      window.HybridToast?.show('Loop A-B active');
      document.getElementById('abLoopIndicator').hidden = false;
    } else {
      this.clearABLoop();
    }
    return this.abLoop;
  }

  clearABLoop() {
    this.abLoop = { a: null, b: null, active: false };
    window.hybridAPI.mpv.clearABLoop();
    document.getElementById('abLoopIndicator').hidden = true;
    window.HybridToast?.show('Loop cleared');
  }

  // ── Screenshot ─────────────────────────────────────────
  async takeScreenshot(format = 'png') {
    try {
      const savedPath = await window.hybridAPI.mpv.screenshot('video');
      if (savedPath) {
        // Show preview overlay in the renderer
        this._showScreenshotPreview(savedPath);
        window.HybridToast?.show('Screenshot saved');
      }
    } catch (err) {
      console.error('Screenshot failed:', err);
      window.HybridToast?.show('Screenshot failed');
    }
  }

  _showScreenshotPreview(filePath) {
    // Remove previous preview if still visible
    const old = document.getElementById('screenshotPreview');
    if (old) old.remove();

    const preview = document.createElement('div');
    preview.id = 'screenshotPreview';
    preview.className = 'screenshot-preview';
    preview.innerHTML = `
      <img src="file://${filePath.replace(/\\/g, '/')}" alt="screenshot">
      <span class="screenshot-preview-label">Screenshot saved – click to open folder</span>
    `;
    preview.addEventListener('click', () => {
      window.hybridAPI.mpv.screenshotOpenFolder();
    });

    this.videoContainer.appendChild(preview);

    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      preview.classList.add('hiding');
      setTimeout(() => preview.remove(), 300);
    }, 3000);
  }

  // ── Subtitle helpers ───────────────────────────────────
  /** Load external subtitle file through mpv */
  async loadExternalSubtitle(filePath) {
    await window.hybridAPI.mpv.addSubFile(filePath);
    window.HybridToast?.show('Subtitle loaded: ' + filePath.split(/[/\\]/).pop());
  }

  // ── Stats ──────────────────────────────────────────────
  getStats() {
    const vp = this.videoParams || {};
    return {
      resolution: vp.w && vp.h ? `${vp.w}x${vp.h}` : '-',
      droppedFrames: '-',   // updated async below
      totalFrames: '-',
      fps: vp.fps || '-',
      speed: `${this.speed}x`,
      buffered: '-',
      duration: this.formatTime(this.duration)
    };
  }

  /** Async stats fetch for values that require get_property */
  async getStatsAsync() {
    const base = this.getStats();
    try {
      const [dropped, fps, vBitrate] = await Promise.all([
        window.hybridAPI.mpv.getProperty('drop-frame-count').catch(() => '-'),
        window.hybridAPI.mpv.getProperty('estimated-vf-fps').catch(() => base.fps),
        window.hybridAPI.mpv.getProperty('video-bitrate').catch(() => null),
      ]);
      base.droppedFrames = dropped;
      base.fps = typeof fps === 'number' ? fps.toFixed(1) : fps;
      base.bitrate = vBitrate ? `${(vBitrate / 1000).toFixed(0)} kbps` : '-';
    } catch { /* ignore */ }
    return base;
  }

  // ── Sleep timer ────────────────────────────────────────
  setSleepTimer(minutes) {
    this.clearSleepTimer();
    if (minutes <= 0) return;
    this.sleepTimer = minutes;
    this.sleepTimeout = setTimeout(() => {
      window.hybridAPI.mpv.pause();
      window.HybridToast?.show('Sleep timer: playback paused');
      this.sleepTimer = null;
    }, minutes * 60 * 1000);
    window.HybridToast?.show(`Sleep timer: ${minutes} minutes`);
  }

  clearSleepTimer() {
    if (this.sleepTimeout) {
      clearTimeout(this.sleepTimeout);
      this.sleepTimeout = null;
      this.sleepTimer = null;
    }
  }

  // ── Audio tracks ───────────────────────────────────────
  getAudioTracks() {
    return this.trackList
      .filter(t => t.type === 'audio')
      .map((t, i) => ({
        index: i,
        id: t.id,
        label: t.title || t.lang || `Track ${i + 1}`,
        language: t.lang,
        enabled: t.selected
      }));
  }

  setAudioTrack(id) {
    window.hybridAPI.mpv.setAudio(id);
  }

  // ── Subtitle tracks ────────────────────────────────────
  getSubtitleTracks() {
    return this.trackList
      .filter(t => t.type === 'sub')
      .map((t, i) => ({
        index: i,
        id: t.id,
        label: t.title || t.lang || `Sub ${i + 1}`,
        language: t.lang,
        enabled: t.selected,
        external: t.external || false
      }));
  }

  setSubtitleTrack(id) {
    window.hybridAPI.mpv.setSub(id);
  }

  // ── Chapter helpers ────────────────────────────────────
  getChapters() {
    return (this.chapterList || []).map((c, i) => ({
      index: i,
      title: c.title || `Chapter ${i + 1}`,
      time: c.time
    }));
  }

  goToChapter(index) {
    window.hybridAPI.mpv.setChapter(index);
  }

  // ── Utilities ──────────────────────────────────────────
  formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '0:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  destroy() {
    this.clearSleepTimer();
    if (this.currentFilePath && this.currentTime > 5) {
      window.hybridAPI.resume.save(this.currentFilePath, this.currentTime);
    }
  }
}

// Export globally
window.HybridPlayer = HybridPlayer;
