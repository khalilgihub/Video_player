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

    // Resume-save debounce
    this._lastResumeSaveSecond = -1;
    this._resumeSaveInFlight   = false;
    this._screenshotPreviewHideTimer = null;
    this._screenshotPreviewRemoveTimer = null;
    this._lastEndedMediaKey = null;
    this._lastEndedAt = 0;
    this._playbackSessionId = 0;
    this._lastEndedSessionId = -1;
    this._resumeSeekTimer = null;

    // Burst Screenshot State
    this._isBurstCapturing = false;
    this._burstFrameCount = 0;
    this._burstSessionId = '';
    this._burstCaptureTimer = null;
    this._burstInFlight = false;
    this._singleScreenshotStack = [];
    this._deletedScreenshotStack = [];
    this._sessionScreenshots = [];
    this._carouselIndex = 0;
    this._carouselEl = null;
    this._screenshotNoticeTimer = null;

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

    this._trackListListeners = new Set();

    this._setupMpvListeners();
    this._setupDragAndDrop();
    this._setupScreenshotListeners();
  }

  addTrackListListener(fn) {
    if (typeof fn === 'function') {
      this._trackListListeners.add(fn);
      if (this.trackList && this.trackList.length > 0) {
        try { fn(this.trackList); } catch (_) {}
      }
    }
  }

  removeTrackListListener(fn) {
    this._trackListListeners.delete(fn);
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
          for (const listener of this._trackListListeners) {
            try { listener(this.trackList); } catch (e) { console.error('Track list listener error:', e); }
          }
          this._updateSubsDubsButtonUI?.();
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
          window.HybridApp?.subtitleModule?.setSyncOffset?.(this.subDelay, { apply: false, persist: false });
          break;

        case 'sub-visibility':
          this.subVisible = !!value;
          break;

        case 'eof-reached':
          if (value) {
            this._handlePlaybackEnded('eof-reached');
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
            this._handlePlaybackEnded('end-file');
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

    const dropContent = document.createElement('div');
    dropContent.className = 'drop-overlay-content';

    const dropIcon = document.createElement('div');
    dropIcon.className = 'drop-overlay-icon';
    dropIcon.setAttribute('aria-hidden', 'true');
    dropIcon.textContent = '📂';

    const dropText = document.createElement('p');
    dropText.textContent = 'Drop media file to play';

    dropContent.append(dropIcon, dropText);
    dropOverlay.appendChild(dropContent);
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
    if (this.currentFilePath && sec > 5 && !this._isNearEnd() && sec - this._lastResumeSaveSecond >= 5) {
      this._autoSaveResume();
    }
  }

  async _autoSaveResume({ force = false } = {}) {
    if (!this.currentFilePath || this.currentTime <= 5) return;
    if (this._isNearEnd()) return;
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

  _isNearEnd(thresholdSeconds = 2) {
    return Number.isFinite(this.duration) &&
      this.duration > 0 &&
      Number.isFinite(this.currentTime) &&
      this.currentTime >= Math.max(0, this.duration - thresholdSeconds);
  }

  async _clearResumePosition() {
    if (!this.currentFilePath) return;
    try {
      await window.hybridAPI.resume.clear?.(this.currentFilePath);
    } catch (error) {
      console.warn('Failed to clear resume position:', error);
    }
  }

  _handlePlaybackEnded(source = 'unknown') {
    const currentSession = this._playbackSessionId;
    const mediaKey = this.currentFilePath || this.currentFile || 'unknown';
    const now = Date.now();
    if (this._lastEndedSessionId === currentSession || (this._lastEndedMediaKey === mediaKey && now - this._lastEndedAt < 1500)) {
      return;
    }

    this._lastEndedSessionId = currentSession;
    this._lastEndedMediaKey = mediaKey;
    this._lastEndedAt = now;
    this.isPlaying = false;
    this._clearResumePosition();
    this.onPlayStateChanged?.(false);
    this.onEnded?.({ source, mediaKey, sessionId: currentSession });
  }

  async _loadRememberedSubtitleDelay(filePath) {
    if (!filePath || !window.hybridAPI?.subtitleDelay?.get) return;
    try {
      const savedDelayMs = Number(await window.hybridAPI.subtitleDelay.get(filePath));
      if (!Number.isFinite(savedDelayMs)) return;
      this.subDelay = savedDelayMs / 1000;
      await window.hybridAPI.mpv.setSubDelay(this.subDelay);
      window.HybridApp?.subtitleModule?.setSyncOffset?.(this.subDelay, { apply: false, persist: false });
    } catch (error) {
      console.warn('Failed to restore subtitle delay:', error);
    }
  }

  // ═══════════════════════════════════════════════════════
  // PUBLIC API  (matches old HybridPlayer interface)
  // ═══════════════════════════════════════════════════════

  async loadFile(filePath) {
    const previousFilePath = this.currentFilePath;
    const sessionId = ++this._playbackSessionId;
    if (this._resumeSeekTimer) {
      clearTimeout(this._resumeSeekTimer);
      this._resumeSeekTimer = null;
    }
    try {
      const settingsModal = document.getElementById('settingsModal');
      if (settingsModal) settingsModal.hidden = true;
      window.HybridApp?._beginVideoLoadSpinner?.();
      window.HybridApp?.handleMediaSourceChange?.(filePath);

      this._lastResumeSaveSecond = -1;
      this._resumeSaveInFlight   = false;
      this._lastEndedMediaKey = null;
      this._lastEndedAt = 0;
      this._singleScreenshotStack = [];
      this._deletedScreenshotStack = [];
      this._sessionScreenshots = [];
      this.closeScreenshotCarousel?.();
      this.currentFilePath = filePath;

      // Ensure video track selection isn't left disabled by previous media state.
      await window.hybridAPI.mpv.setProperty('vid', 'auto');

      // Tell mpv to load
      const loadResult = await window.hybridAPI.mpv.loadFile(filePath);
      if (loadResult === false || loadResult == null) {
        throw new Error('Playback engine is not ready yet. Please try again.');
      }
      await window.hybridAPI.mpv.play();

      // Title bar
      const fileName = filePath.split(/[/\\]/).pop();
      document.getElementById('titlebarText').textContent = fileName + ' — Hybrid Player';

      // Resume position
      try {
        const prefs = await window.hybridAPI.db.getAllPreferences();
        if (prefs.autoResume) {
          const resumeTime = await window.hybridAPI.resume.get(filePath);
          if (resumeTime > 5) {
            // Small delay so mpv loads first
            this._resumeSeekTimer = setTimeout(() => {
              if (this._playbackSessionId === sessionId && this.currentFilePath === filePath) {
                window.hybridAPI.mpv.seek(resumeTime, 'absolute');
                window.HybridToast?.show(`Resuming from ${this.formatTime(resumeTime)}`);
              }
              this._resumeSeekTimer = null;
            }, 500);
          }
        }
      } catch (error) {
        console.warn('Failed to restore resume position:', error);
      }

      // Saved speed
      try {
        const savedSpeed = await window.hybridAPI.speed.get(filePath);
        if (savedSpeed) {
          window.hybridAPI.mpv.setSpeed(savedSpeed);
        }
      } catch (error) {
        console.warn('Failed to restore playback speed:', error);
      }

      await this._loadRememberedSubtitleDelay(filePath);

      // History
      try {
        await window.hybridAPI.history.add({
          path: filePath,
          name: fileName,
          duration: 0,
          timestamp: Date.now()
        });
      } catch (error) {
        console.warn('Playback started, but history could not be saved:', error);
      }

      // CRITICAL ARCHITECTURE NOTE (DO NOT REMOVE / DO NOT HIDE WELCOME SCREEN HERE):
      // Do NOT call `this.welcomeScreen.classList.add('hidden')` synchronously inside loadFile().
      // In Electron with a transparent window, mpv takes ~100-300ms to demux and present its first video frame.
      // Hiding the welcome screen prematurely here exposes the transparent Chromium buffer, causing a 0.01s
      // transparency flash of the Windows desktop beneath the player.
      // The welcome screen and video-curtain are safely hidden simultaneously upon first frame presentation
      // via `window.HybridApp._forcePlaybackSurfaceVisible('playback-restart')` in app.js.
      // mpv auto-plays after loadfile by default
      this.isPlaying = true;
      this.onPlayStateChanged?.(true);
      return true;
    } catch (err) {
      this.currentFilePath = previousFilePath;
      window.HybridApp?._cancelVideoLoadSpinner?.();
      console.error('Failed to load file:', err);
      window.HybridToast?.show('Failed to load: ' + filePath.split(/[/\\]/).pop());
      return false;
    }
  }

  loadUrl(url) {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) settingsModal.hidden = true;
    window.HybridApp?._beginVideoLoadSpinner?.();
    window.HybridApp?.handleMediaSourceChange?.(url);

    this.currentFilePath = url;
    this._lastEndedMediaKey = null;
    this._lastEndedAt = 0;
    this._singleScreenshotStack = [];
    this._deletedScreenshotStack = [];
    this._sessionScreenshots = [];
    this.closeScreenshotCarousel?.();
    document.getElementById('titlebarText').textContent = 'Network Stream — Hybrid Player';
    // Do NOT hide welcomeScreen synchronously here (prevents 0.01s transparency flash)
    this.isPlaying = true;
    this.onPlayStateChanged?.(true);
    window.hybridAPI.mpv.setProperty('vid', 'auto');
    window.hybridAPI.mpv.loadFile(url);
  }

  _setupScreenshotListeners() {
    window.hybridAPI.on('screenshot-ready', (payload) => {
      this._recordSingleScreenshot(payload);
      this._showScreenshotPreview(payload);
    });
  }

  togglePlay() {
    this.isPlaying = !this.isPlaying;
    this.onPlayStateChanged?.(this.isPlaying);
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
    // value: 0–1 or 0–100 → mpv volume 0–100
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return;
    const target = numeric > 1 ? numeric : numeric * 100;
    const clamped = Math.max(0, Math.min(100, Math.round(target)));
    this.volume = clamped;
    window.hybridAPI.mpv.setVolume(clamped);
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
      window.hybridAPI.speed.save(this.currentFilePath, clamped)?.catch?.(() => {});
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

  _recordSingleScreenshot(payload) {
    if (!payload || typeof payload !== 'object') return;
    const filePath = typeof payload.filePath === 'string' ? payload.filePath.trim() : '';
    if (!filePath) return;

    if (!this._singleScreenshotStack) this._singleScreenshotStack = [];
    if (!this._singleScreenshotStack.includes(filePath)) {
      this._singleScreenshotStack.push(filePath);
    }

    if (!this._sessionScreenshots) this._sessionScreenshots = [];
    const fileName = payload.fileName || filePath.split(/[/\\]/).pop();
    const existingIndex = this._sessionScreenshots.findIndex((s) => s.filePath === filePath);

    const mimeType = typeof payload.mimeType === 'string' && payload.mimeType ? payload.mimeType : 'image/png';
    const rawBase64 = typeof payload.base64Data === 'string'
      ? payload.base64Data
      : (typeof payload.base64 === 'string' ? payload.base64 : '');
    const cleanedBase64 = rawBase64.trim().replace(/^data:[^;]+;base64,/, '');
    const previewDataUrl = typeof payload.previewDataUrl === 'string' ? payload.previewDataUrl.trim() : '';
    const imageSource = (previewDataUrl.startsWith('data:image/') ? previewDataUrl : '')
      || (cleanedBase64 ? `data:${mimeType};base64,${cleanedBase64}` : '')
      || (typeof payload.previewUrl === 'string' ? payload.previewUrl.trim() : '');

    const item = {
      filePath,
      fileName,
      previewDataUrl: imageSource,
      previewUrl: payload.previewUrl || '',
      timestamp: Date.now(),
      timePos: this.currentTime || 0,
    };

    if (existingIndex >= 0) {
      this._sessionScreenshots[existingIndex] = item;
    } else {
      this._sessionScreenshots.push(item);
    }
  }

  // ── Screenshot ─────────────────────────────────────────
  async takeScreenshot(format = 'png') {
    console.log('[SCREENSHOT][renderer] takeScreenshot invoked');
    try {
      const payload = await window.hybridAPI?.mpv?.screenshot('video');
      console.log('[SCREENSHOT][renderer] mpv.screenshot returned payload:', payload);
      this._recordSingleScreenshot(payload);
      window.HybridToast?.show('📸 Screenshot saved');
      if (payload && typeof payload === 'object') {
        this._showScreenshotPreview(payload);
      }
    } catch (err) {
      console.error('[SCREENSHOT][renderer] Screenshot failed:', err);
      window.HybridToast?.show('Screenshot failed');
    }
  }

  async deleteLatestScreenshot() {
    if (!this._singleScreenshotStack || this._singleScreenshotStack.length === 0) {
      this._showScreenshotNotice('No screenshots to delete', '🗑️');
      const msg = '⚠️ No recent screenshots to delete';
      window.HybridToast?.show(msg);
      return;
    }

    const targetPath = this._singleScreenshotStack.pop();
    if (!targetPath) {
      this._showScreenshotNotice('No screenshots to delete', '🗑️');
      const msg = '⚠️ No recent screenshots to delete';
      window.HybridToast?.show(msg);
      return;
    }

    if (this._sessionScreenshots) {
      this._sessionScreenshots = this._sessionScreenshots.filter((s) => s.filePath !== targetPath);
      if (this.isScreenshotCarouselOpen?.()) {
        if (this._sessionScreenshots.length === 0) {
          this.closeScreenshotCarousel();
        } else {
          this._carouselIndex = Math.min(this._carouselIndex, this._sessionScreenshots.length - 1);
          this._updateCarouselContent();
        }
      }
    }

    try {
      const result = await window.hybridAPI?.mpv?.deleteScreenshot?.(targetPath);
      if (result?.success) {
        const fileName = result.fileName || targetPath.split(/[/\\]/).pop();

        // Push to undo stack for Z recovery
        if (!this._deletedScreenshotStack) this._deletedScreenshotStack = [];
        this._deletedScreenshotStack.push({
          originalPath: targetPath,
          tempPath: result.tempPath,
          fileName,
          previewDataUrl: result.previewDataUrl,
        });

        // Show delete animation directly on the screenshot preview card with badge
        this._showScreenshotPreview({
          filePath: targetPath,
          fileName,
          previewDataUrl: result.previewDataUrl,
          badgeText: 'Deleted',
          badgeType: 'deleted',
          isDeleting: true,
        });

        window.HybridToast?.show(`🗑️ Deleted screenshot: ${fileName}`);
      } else {
        const errMsg = 'Failed to delete screenshot';
        window.HybridToast?.show(errMsg);
      }
    } catch (err) {
      console.error('Failed to delete screenshot:', err);
      const errMsg = 'Failed to delete screenshot';
      window.HybridToast?.show(errMsg);
    }
  }

  async restoreLatestScreenshot() {
    if (!this._deletedScreenshotStack || this._deletedScreenshotStack.length === 0) {
      this._showScreenshotNotice('No screenshots to restore', '↩️');
      const msg = '⚠️ No deleted screenshots to restore';
      window.HybridToast?.show(msg);
      return;
    }

    const stagedItem = this._deletedScreenshotStack.pop();
    if (!stagedItem) {
      this._showScreenshotNotice('No screenshots to restore', '↩️');
      const msg = '⚠️ No deleted screenshots to restore';
      window.HybridToast?.show(msg);
      return;
    }

    try {
      const result = await window.hybridAPI?.mpv?.restoreScreenshot?.(stagedItem);
      if (result?.success) {
        const fileName = result.fileName || stagedItem.originalPath.split(/[/\\]/).pop();

        // Push restored screenshot back to singleScreenshotStack so D can delete it again
        if (!this._singleScreenshotStack) this._singleScreenshotStack = [];
        this._singleScreenshotStack.push(result.filePath);

        if (!this._sessionScreenshots) this._sessionScreenshots = [];
        this._sessionScreenshots.push({
          filePath: result.filePath,
          fileName,
          previewDataUrl: result.previewDataUrl || stagedItem.previewDataUrl || '',
          previewUrl: `local-file:///${encodeURI(result.filePath.replace(/\\/g, '/'))}`,
          timestamp: Date.now(),
        });

        if (this.isScreenshotCarouselOpen?.()) {
          this._carouselIndex = this._sessionScreenshots.length - 1;
          this._updateCarouselContent();
        }

        // Show restored screenshot card with 'Restored' badge
        this._showScreenshotPreview({
          filePath: result.filePath,
          fileName,
          previewDataUrl: result.previewDataUrl || stagedItem.previewDataUrl,
          badgeText: 'Restored',
          badgeType: 'restored',
        });

        window.HybridToast?.show(`✓ Restored screenshot: ${fileName}`);
      } else {
        const errMsg = 'Failed to restore screenshot';
        window.HybridToast?.show(errMsg);
      }
    } catch (err) {
      console.error('Failed to restore screenshot:', err);
      const errMsg = 'Failed to restore screenshot';
      window.HybridToast?.show(errMsg);
    }
  }

  // ── Burst Screenshot Stream ────────────────────────────
  startBurstCapture() {
    if (this._isBurstCapturing) return;
    this._isBurstCapturing = true;
    this._burstFrameCount = 0;
    this._burstInFlight = false;

    const now = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    const nonce = Math.random().toString(36).substring(2, 6);
    this._burstSessionId = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}_${nonce}`;

    window.HybridApp?.controlsModule?.setRecordingState(true, '📸 Burst capturing frames: 0');

    // Video FPS pacing (default to ~24 fps = 41ms interval)
    const fps = Number(this.videoParams?.fps) || 24;
    const intervalMs = Math.max(16, Math.floor(1000 / fps));

    this._burstCaptureTimer = setInterval(async () => {
      if (!this._isBurstCapturing) return;
      if (this._burstInFlight) return; // Strict 1-by-1 in-flight handshake: 0 queue backlog!

      this._burstInFlight = true;
      this._burstFrameCount += 1;
      const count = this._burstFrameCount;

      try {
        await window.hybridAPI?.mpv?.screenshotBurstFrame(this._burstSessionId, count, 'video');
        if (this._isBurstCapturing) {
          const timeStr = this.formatTime ? this.formatTime(this.currentTime) : '';
          const ptsPart = timeStr ? ` (${timeStr})` : '';
          window.HybridApp?.controlsModule?.setRecordingState(true, `📸 Burst capturing: ${count} frames${ptsPart}`);
        }
      } catch (err) {
        console.error('Burst frame capture failed:', err);
      } finally {
        this._burstInFlight = false;
      }
    }, intervalMs);
  }

  async stopBurstCapture() {
    if (!this._isBurstCapturing) return;
    this._isBurstCapturing = false;

    if (this._burstCaptureTimer) {
      clearInterval(this._burstCaptureTimer);
      this._burstCaptureTimer = null;
    }

    const total = this._burstFrameCount;
    window.HybridApp?.controlsModule?.setRecordingState(false, `✓ Saved ${total} frames`);
    if (total > 0) {
      const result = await window.hybridAPI?.mpv?.finalizeBurstSession(this._burstSessionId, total);
      if (result?.inSubfolder && result?.folderName) {
        window.HybridToast?.show(`📸 Saved ${total} frames to folder: ${result.folderName}`);
      } else {
        window.HybridToast?.show(`📸 Saved ${total} frames to Screenshots`);
      }
    }
  }

  _showScreenshotPreview(payload) {
    const existingNotice = document.getElementById('screenshotNotice');
    if (existingNotice) {
      existingNotice.style.display = 'none';
      if (this._screenshotNoticeTimer) {
        clearTimeout(this._screenshotNoticeTimer);
        this._screenshotNoticeTimer = null;
      }
    }

    const screenshot = (payload && typeof payload === 'object') ? payload : {};
    const filePath = typeof screenshot.filePath === 'string' ? screenshot.filePath : '';
    const previewUrl = typeof screenshot.previewUrl === 'string' ? screenshot.previewUrl.trim() : '';
    const mimeType = typeof screenshot.mimeType === 'string' && screenshot.mimeType
      ? screenshot.mimeType
      : 'image/png';
    const rawBase64 = typeof screenshot.base64Data === 'string'
      ? screenshot.base64Data
      : (typeof screenshot.base64 === 'string' ? screenshot.base64 : '');
    const cleanedBase64 = rawBase64.trim().replace(/^data:[^;]+;base64,/, '');
    const previewDataUrl = typeof screenshot.previewDataUrl === 'string'
      ? screenshot.previewDataUrl.trim()
      : '';
    const imageSource = (previewDataUrl.startsWith('data:image/') ? previewDataUrl : '')
      || (cleanedBase64 ? `data:${mimeType};base64,${cleanedBase64}` : '')
      || previewUrl;

    console.log('[SCREENSHOT][renderer] _showScreenshotPreview invoked:', {
      filePath,
      hasDataUrl: !!previewDataUrl,
      dataUrlLength: previewDataUrl?.length || 0,
      previewUrl,
    });

    if (!imageSource) {
      console.warn('[SCREENSHOT][renderer] Screenshot preview payload invalid:', payload);
      return;
    }

    let preview = document.getElementById('screenshotPreview');
    if (!preview) {
      preview = document.createElement('div');
      preview.id = 'screenshotPreview';
      preview.className = 'screenshot-preview';
      preview.title = 'Click to open screenshot folder';

      const badgeEl = document.createElement('div');
      badgeEl.className = 'screenshot-preview-badge';
      badgeEl.style.display = 'none';
      preview.appendChild(badgeEl);

      const imageEl = document.createElement('img');
      imageEl.alt = 'Screenshot preview';
      preview.appendChild(imageEl);
      preview.addEventListener('click', () => {
        window.hybridAPI?.mpv?.screenshotOpenFolder?.();
      });
      document.body.appendChild(preview);
    }

    let badge = preview.querySelector('.screenshot-preview-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'screenshot-preview-badge';
      preview.insertBefore(badge, preview.firstChild);
    }

    if (screenshot.badgeText) {
      badge.textContent = screenshot.badgeText;
      badge.className = `screenshot-preview-badge ${screenshot.badgeType || ''}`;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }

    const image = preview.querySelector('img');
    if (image) {
      image.onload = () => {
        console.log('[SCREENSHOT][renderer] Screenshot preview image loaded successfully in DOM');
      };
      image.onerror = (err) => {
        console.error('[SCREENSHOT][renderer] Screenshot preview image load error:', err);
        if (imageSource !== previewUrl && previewUrl) {
          const sep = previewUrl.includes('?') ? '&' : '?';
          image.src = `${previewUrl}${sep}cb=${Date.now()}`;
        }
      };
      const separator = imageSource.includes('?') ? '&' : '?';
      image.src = imageSource.startsWith('data:') ? imageSource : `${imageSource}${separator}cb=${Date.now()}`;
    }

    preview.classList.remove('hiding', 'deleting', 'restoring');

    if (screenshot.isDeleting) {
      preview.classList.add('deleting');
      clearTimeout(this._screenshotPreviewHideTimer);
      clearTimeout(this._screenshotPreviewRemoveTimer);
      this._screenshotPreviewHideTimer = setTimeout(() => {
        preview.classList.add('hiding');
        this._screenshotPreviewRemoveTimer = setTimeout(() => {
          if (preview.parentNode) {
            preview.parentNode.removeChild(preview);
          }
        }, 300);
      }, 450);
      return;
    }

    if (screenshot.badgeType === 'restored') {
      preview.classList.add('restoring');
    }

    clearTimeout(this._screenshotPreviewHideTimer);
    clearTimeout(this._screenshotPreviewRemoveTimer);
    this._screenshotPreviewHideTimer = setTimeout(() => {
      preview.classList.add('hiding');
      this._screenshotPreviewRemoveTimer = setTimeout(() => {
        if (preview.parentNode) {
          preview.parentNode.removeChild(preview);
        }
      }, 300);
    }, 1800);
  }

  _showScreenshotNotice(message, icon = '') {
    let notice = document.getElementById('screenshotNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'screenshotNotice';
      notice.className = 'screenshot-notice';
      document.body.appendChild(notice);
    }

    if (this._screenshotNoticeTimer) {
      clearTimeout(this._screenshotNoticeTimer);
      this._screenshotNoticeTimer = null;
    }

    const iconHtml = icon ? `<span class="screenshot-notice-icon">${icon}</span>` : '';
    notice.innerHTML = `${iconHtml}<span class="screenshot-notice-text">${message}</span>`;
    notice.classList.remove('hiding');
    notice.style.display = 'inline-flex';

    this._screenshotNoticeTimer = setTimeout(() => {
      notice.classList.add('hiding');
      setTimeout(() => {
        if (notice.classList.contains('hiding')) {
          notice.style.display = 'none';
        }
      }, 250);
    }, 1800);
  }

  // ── Screenshot Carousel (Ctrl + D / Ctrl + Z) ───────────
  isScreenshotCarouselOpen() {
    return !!this._carouselEl &&
      document.body.contains(this._carouselEl) &&
      !this._carouselEl.classList.contains('hiding') &&
      !this._carouselEl.classList.contains('deleting') &&
      !this._carouselEl.classList.contains('restoring');
  }

  getCarouselMode() {
    return this._carouselMode || 'delete';
  }

  openScreenshotCarousel() {
    if (!this._sessionScreenshots || this._sessionScreenshots.length === 0) {
      this._showScreenshotNotice('No screenshots to delete', '🗑️');
      window.HybridToast?.show('⚠️ No session screenshots to delete');
      return;
    }

    const existingNotice = document.getElementById('screenshotNotice');
    if (existingNotice) {
      existingNotice.style.display = 'none';
      if (this._screenshotNoticeTimer) {
        clearTimeout(this._screenshotNoticeTimer);
        this._screenshotNoticeTimer = null;
      }
    }

    this._carouselMode = 'delete';
    // Default to the newest screenshot in the session
    this._carouselIndex = this._sessionScreenshots.length - 1;
    this._renderCarouselUI();
    window.hybridAPI?.window?.setPreventExitFullscreen?.(true);
  }

  openRestoreCarousel() {
    if (!this._deletedScreenshotStack || this._deletedScreenshotStack.length === 0) {
      this._showScreenshotNotice('No screenshots to restore', '↩️');
      window.HybridToast?.show('⚠️ No deleted screenshots to restore');
      return;
    }

    const existingNotice = document.getElementById('screenshotNotice');
    if (existingNotice) {
      existingNotice.style.display = 'none';
      if (this._screenshotNoticeTimer) {
        clearTimeout(this._screenshotNoticeTimer);
        this._screenshotNoticeTimer = null;
      }
    }

    this._carouselMode = 'restore';
    // Default to the newest deleted screenshot in the undo stack
    this._carouselIndex = this._deletedScreenshotStack.length - 1;
    this._renderCarouselUI();
    window.hybridAPI?.window?.setPreventExitFullscreen?.(true);
  }

  closeScreenshotCarousel() {
    window.hybridAPI?.window?.setPreventExitFullscreen?.(false);
    if (this._carouselEl) {
      const el = this._carouselEl;
      this._carouselEl = null;
      el.classList.add('hiding');
      setTimeout(() => {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      }, 250);
    }
  }

  toggleScreenshotCarousel() {
    if (this.isScreenshotCarouselOpen()) {
      if (this._carouselMode === 'delete') {
        this.closeScreenshotCarousel();
      } else {
        this.closeScreenshotCarousel();
        this.openScreenshotCarousel();
      }
    } else {
      this.openScreenshotCarousel();
    }
  }

  toggleRestoreCarousel() {
    if (this.isScreenshotCarouselOpen()) {
      if (this._carouselMode === 'restore') {
        this.closeScreenshotCarousel();
      } else {
        this.closeScreenshotCarousel();
        this.openRestoreCarousel();
      }
    } else {
      this.openRestoreCarousel();
    }
  }

  navigateScreenshotCarousel(direction) {
    if (!this.isScreenshotCarouselOpen()) return;
    const items = this._carouselMode === 'restore' ? this._deletedScreenshotStack : this._sessionScreenshots;
    if (!items?.length) return;
    const len = items.length;
    this._carouselIndex = (this._carouselIndex + direction + len) % len;
    this._updateCarouselContent();
  }

  async deleteSelectedCarouselScreenshot() {
    if (!this.isScreenshotCarouselOpen()) return;
    if (!this._sessionScreenshots || this._sessionScreenshots.length === 0) {
      this.closeScreenshotCarousel();
      return;
    }

    const selected = this._sessionScreenshots[this._carouselIndex];
    if (!selected || !selected.filePath) {
      this.closeScreenshotCarousel();
      return;
    }

    const targetPath = selected.filePath;
    const fileName = selected.fileName || targetPath.split(/[/\\]/).pop();
    const carousel = this._carouselEl;

    // Immediately mark carousel as inactive for input/open checks (Choice C: Immediate Close)
    this._carouselEl = null;
    window.hybridAPI?.window?.setPreventExitFullscreen?.(false);

    if (carousel) {
      // 1. Instantly hide interactive overlays so only image + badge participate in the delete animation
      const overlays = carousel.querySelectorAll('.carousel-nav-btn, .carousel-close-btn');
      overlays.forEach((el) => { el.style.display = 'none'; });

      // 2. Set badge to exact same red 'Deleted' badge styling as pressing D
      const badge = carousel.querySelector('.screenshot-preview-badge');
      if (badge) {
        badge.textContent = 'Deleted';
        badge.className = 'screenshot-preview-badge deleted';
        badge.style.display = 'inline-flex';
      }

      // 3. Add deleting class to trigger previewDeletePop animation and red glow
      carousel.classList.add('deleting');

      // Schedule removal after animation completes (450ms)
      setTimeout(() => {
        carousel.classList.add('hiding');
        setTimeout(() => {
          if (carousel.parentNode) {
            carousel.parentNode.removeChild(carousel);
          }
        }, 200);
      }, 450);
    }

    try {
      const result = await window.hybridAPI?.mpv?.deleteScreenshot?.(targetPath);
      if (result?.success) {
        // Remove from session screenshots
        this._sessionScreenshots = this._sessionScreenshots.filter((s) => s.filePath !== targetPath);

        // Remove from single screenshot stack
        if (this._singleScreenshotStack) {
          this._singleScreenshotStack = this._singleScreenshotStack.filter((p) => p !== targetPath);
        }

        // Push to undo stack for Z recovery
        if (!this._deletedScreenshotStack) this._deletedScreenshotStack = [];
        this._deletedScreenshotStack.push({
          originalPath: targetPath,
          tempPath: result.tempPath,
          fileName,
          previewDataUrl: result.previewDataUrl || selected.previewDataUrl,
        });

        window.HybridToast?.show(`🗑️ Deleted screenshot: ${fileName}`);
      } else {
        window.HybridToast?.show('Failed to delete screenshot');
      }
    } catch (err) {
      console.error('Failed to delete carousel screenshot:', err);
      window.HybridToast?.show('Failed to delete screenshot');
    }
  }

  async restoreSelectedCarouselScreenshot() {
    if (!this.isScreenshotCarouselOpen()) return;
    if (!this._deletedScreenshotStack || this._deletedScreenshotStack.length === 0) {
      this.closeScreenshotCarousel();
      return;
    }

    const stagedItem = this._deletedScreenshotStack[this._carouselIndex];
    if (!stagedItem) {
      this.closeScreenshotCarousel();
      return;
    }

    // Remove from undo stack at this specific index
    this._deletedScreenshotStack.splice(this._carouselIndex, 1);

    const fileName = stagedItem.fileName || stagedItem.originalPath?.split(/[/\\]/).pop() || 'screenshot.png';
    const carousel = this._carouselEl;

    // Immediately mark carousel as inactive for input/open checks
    this._carouselEl = null;
    window.hybridAPI?.window?.setPreventExitFullscreen?.(false);

    if (carousel) {
      // 1. Instantly hide interactive overlays so only image + badge participate in the restore animation
      const overlays = carousel.querySelectorAll('.carousel-nav-btn, .carousel-close-btn');
      overlays.forEach((el) => { el.style.display = 'none'; });

      // 2. Set badge to green 'Restored' badge styling matching Z
      const badge = carousel.querySelector('.screenshot-preview-badge');
      if (badge) {
        badge.textContent = 'Restored';
        badge.className = 'screenshot-preview-badge restored';
        badge.style.display = 'inline-flex';
      }

      // 3. Add restoring class to trigger previewRestorePop animation and green glow
      carousel.classList.add('restoring');

      // Schedule removal after animation completes (400ms)
      setTimeout(() => {
        carousel.classList.add('hiding');
        setTimeout(() => {
          if (carousel.parentNode) {
            carousel.parentNode.removeChild(carousel);
          }
        }, 200);
      }, 400);
    }

    try {
      const result = await window.hybridAPI?.mpv?.restoreScreenshot?.(stagedItem);
      if (result?.success) {
        const restoredFileName = result.fileName || fileName;

        // Push restored screenshot back to singleScreenshotStack so D can delete it again
        if (!this._singleScreenshotStack) this._singleScreenshotStack = [];
        this._singleScreenshotStack.push(result.filePath);

        // Push back to sessionScreenshots so it shows in Ctrl + D carousel
        if (!this._sessionScreenshots) this._sessionScreenshots = [];
        this._sessionScreenshots.push({
          filePath: result.filePath,
          fileName: restoredFileName,
          previewDataUrl: result.previewDataUrl || stagedItem.previewDataUrl || '',
          previewUrl: `local-file:///${encodeURI(result.filePath.replace(/\\/g, '/'))}`,
          timestamp: Date.now(),
        });

        window.HybridToast?.show(`✓ Restored screenshot: ${restoredFileName}`);
      } else {
        window.HybridToast?.show('Failed to restore screenshot');
      }
    } catch (err) {
      console.error('Failed to restore carousel screenshot:', err);
      window.HybridToast?.show('Failed to restore screenshot');
    }
  }

  _renderCarouselUI() {
    // If ordinary preview card is active, hide it to prevent visual collision
    const oldPreview = document.getElementById('screenshotPreview');
    if (oldPreview && oldPreview.parentNode) {
      oldPreview.parentNode.removeChild(oldPreview);
    }

    // Clean up any stale carousel DOM element to prevent animation timeout collisions
    const existing = document.getElementById('screenshotCarousel');
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }

    const carousel = document.createElement('div');
    carousel.id = 'screenshotCarousel';
    carousel.className = 'screenshot-preview carousel-mode';

    // Status badge (top-left inside card)
    const badge = document.createElement('div');
    badge.className = 'screenshot-preview-badge carousel-counter';
    carousel.appendChild(badge);

    // Close button (top-right inside card)
    const closeBtn = document.createElement('button');
    closeBtn.className = 'carousel-close-btn';
    closeBtn.title = 'Close (Esc)';
    closeBtn.innerHTML = '✕';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeScreenshotCarousel();
    });
    carousel.appendChild(closeBtn);

    // Image container
    const imgWrapper = document.createElement('div');
    imgWrapper.className = 'carousel-img-wrapper';

    const prevBtn = document.createElement('button');
    prevBtn.className = 'carousel-nav-btn prev';
    prevBtn.title = 'Previous (←)';
    prevBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
    prevBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.navigateScreenshotCarousel(-1);
    });
    imgWrapper.appendChild(prevBtn);

    const img = document.createElement('img');
    img.alt = 'Screenshot preview';
    imgWrapper.appendChild(img);

    const nextBtn = document.createElement('button');
    nextBtn.className = 'carousel-nav-btn next';
    nextBtn.title = 'Next (→)';
    nextBtn.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
    nextBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.navigateScreenshotCarousel(1);
    });
    imgWrapper.appendChild(nextBtn);

    carousel.appendChild(imgWrapper);

    // Filename span for accessibility / title
    const filename = document.createElement('span');
    filename.className = 'carousel-filename';
    filename.style.display = 'none';
    carousel.appendChild(filename);

    document.body.appendChild(carousel);

    this._carouselEl = carousel;
    this._carouselEl.classList.remove('hiding', 'deleting', 'restoring');
    // Ensure overlays are visible if re-opening
    const overlays = this._carouselEl.querySelectorAll('.carousel-nav-btn, .carousel-close-btn');
    overlays.forEach((el) => { el.style.display = ''; });

    this._updateCarouselContent();
  }

  _updateCarouselContent() {
    if (!this._carouselEl) return;
    const items = this._carouselMode === 'restore' ? this._deletedScreenshotStack : this._sessionScreenshots;
    if (!items?.length) return;
    const current = items[this._carouselIndex];
    if (!current) return;

    const counter = this._carouselEl.querySelector('.carousel-counter');
    if (counter) {
      counter.textContent = `${this._carouselIndex + 1} / ${items.length}`;
    }

    const img = this._carouselEl.querySelector('img');
    if (img) {
      img.onerror = () => {
        const fallbackPath = current.filePath || current.tempPath || current.originalPath;
        if (fallbackPath) {
          const normalized = fallbackPath.replace(/\\/g, '/');
          img.src = `local-file:///${encodeURI(normalized)}?cb=${Date.now()}`;
        }
      };
      const src = current.previewDataUrl || current.previewUrl || '';
      img.src = src;
    }

    const filename = this._carouselEl.querySelector('.carousel-filename');
    if (filename) {
      filename.textContent = current.fileName || '';
      filename.title = current.fileName || '';
    }
  }

  // ── Audio & Subtitle Pairing (Subs / Dubs) ──────────────
  formatLanguageName(lang) {
    if (!lang) return '';
    const map = {
      'ja': 'Japanese', 'jpn': 'Japanese', 'japanese': 'Japanese',
      'en': 'English', 'eng': 'English', 'english': 'English',
      'es': 'Spanish', 'spa': 'Spanish', 'spanish': 'Spanish',
      'fr': 'French', 'fra': 'French', 'fre': 'French', 'french': 'French',
      'de': 'German', 'ger': 'German', 'deu': 'German', 'german': 'German',
      'zh': 'Chinese', 'chi': 'Chinese', 'zho': 'Chinese', 'chinese': 'Chinese',
      'ko': 'Korean', 'kor': 'Korean', 'korean': 'Korean',
      'pt': 'Portuguese', 'por': 'Portuguese', 'portuguese': 'Portuguese',
      'it': 'Italian', 'ita': 'Italian', 'italian': 'Italian',
      'ru': 'Russian', 'rus': 'Russian', 'russian': 'Russian',
    };
    const key = String(lang).toLowerCase().trim();
    return map[key] || lang;
  }

  setAudioTrack(trackId) {
    const id = parseInt(trackId, 10);
    if (!Number.isFinite(id)) return;
    window.hybridAPI.mpv.setAudio(id);
    const audioTracks = (this.trackList || []).filter(t => t.type === 'audio');
    const track = audioTracks.find(t => t.id === id);
    if (track) {
      const lang = this.formatLanguageName(track.lang);
      const title = track.title ? ` (${track.title})` : '';
      const label = lang ? `${lang}${title}` : (track.title || `Track ${track.id}`);
      window.HybridToast?.show(`Voice: ${label}`);
    }
  }

  _isJapaneseTrack(t) {
    if (!t) return false;
    const lang = String(t.lang || '').toLowerCase();
    const title = String(t.title || '').toLowerCase();
    return lang === 'ja' || lang === 'jpn' || lang === 'japanese' ||
           title.includes('japanese') || title.includes('jpn') || title.includes('jap');
  }

  _isEnglishTrack(t) {
    if (!t) return false;
    const lang = String(t.lang || '').toLowerCase();
    const title = String(t.title || '').toLowerCase();
    return lang === 'en' || lang === 'eng' || lang === 'english' ||
           title.includes('english') || title.includes('eng') || title.includes('dub');
  }

  _isSignsOrSongsSub(t) {
    if (!t) return false;
    const title = String(t.title || '').toLowerCase();
    return title.includes('sign') || title.includes('song') || title.includes('forced');
  }

  _updateSubsDubsButtonUI() {
    const btn = document.getElementById('btnAudioTrack');
    if (!btn) return;
    const audioTracks = (this.trackList || []).filter(t => t.type === 'audio');
    const currentAudio = audioTracks.find(t => t.selected) || audioTracks[0];
    if (currentAudio && this._isEnglishTrack(currentAudio)) {
      btn.title = 'Current: Dubs (Click for Subs) (A)';
      btn.setAttribute('aria-label', 'Current: Dubs (Click for Subs)');
    } else if (currentAudio && this._isJapaneseTrack(currentAudio)) {
      btn.title = 'Current: Subs (Click for Dubs) (A)';
      btn.setAttribute('aria-label', 'Current: Subs (Click for Dubs)');
    } else {
      btn.title = 'Subs / Dubs Switcher (A)';
      btn.setAttribute('aria-label', 'Subs / Dubs Switcher');
    }
  }

  toggleSubsDubs() {
    const audioTracks = (this.trackList || []).filter(t => t.type === 'audio');
    const subTracks = (this.trackList || []).filter(t => t.type === 'sub');

    // Case 1: Dual/Multi-Audio tracks available (Anime Dual-Audio)
    if (audioTracks.length >= 2) {
      const currentAudio = audioTracks.find(t => t.selected) || audioTracks[0];
      const japTrack = audioTracks.find(t => this._isJapaneseTrack(t));
      const engTrack = audioTracks.find(t => this._isEnglishTrack(t));

      let targetAudio = null;
      let targetMode = ''; // 'subs' or 'dubs'

      if (japTrack && engTrack) {
        // Classic Anime Dual-Audio (Japanese + English)
        if (currentAudio.id === japTrack.id) {
          // Switch from Subs (JP) -> Dubs (EN)
          targetAudio = engTrack;
          targetMode = 'dubs';
        } else {
          // Switch from Dubs (EN) -> Subs (JP)
          targetAudio = japTrack;
          targetMode = 'subs';
        }
      } else {
        // Generic multi-audio fallback: cycle to next audio track
        const currentIndex = audioTracks.findIndex(t => t.selected);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % audioTracks.length : 0;
        targetAudio = audioTracks[nextIndex];
        targetMode = (nextIndex === 0) ? 'subs' : 'dubs';
      }

      // Apply target audio track in mpv
      window.hybridAPI.mpv.setAudio(targetAudio.id);
      audioTracks.forEach(t => { t.selected = (t.id === targetAudio.id); });

      if (targetMode === 'dubs' || this._isEnglishTrack(targetAudio)) {
        // DUBS MODE: English voice -> Check if there's a signs/songs track, else turn off dialogue subs
        const signsSub = subTracks.find(t => this._isSignsOrSongsSub(t));
        if (signsSub) {
          window.hybridAPI.mpv.setSub(signsSub.id);
          window.hybridAPI.mpv.setSubVisibility(true);
          this.subVisible = true;
          window.HybridToast?.show('Dubs: English Voice [Signs & Songs Subs]');
        } else {
          window.hybridAPI.mpv.setSubVisibility(false);
          this.subVisible = false;
          window.HybridToast?.show('Dubs: English Voice [Subtitles Off]');
        }
      } else {
        // SUBS MODE: Japanese voice -> Enable full English subtitles
        const fullSub = subTracks.find(t => this._isEnglishTrack(t) && !this._isSignsOrSongsSub(t)) ||
                        subTracks.find(t => !this._isSignsOrSongsSub(t)) ||
                        subTracks[0];
        if (fullSub) {
          window.hybridAPI.mpv.setSub(fullSub.id);
          window.hybridAPI.mpv.setSubVisibility(true);
          this.subVisible = true;
          const subName = fullSub.title || this.formatLanguageName(fullSub.lang) || 'English';
          window.HybridToast?.show(`Subs: Japanese Voice [${subName} Subtitles On]`);
        } else {
          window.hybridAPI.mpv.setSubVisibility(true);
          this.subVisible = true;
          window.HybridToast?.show('Subs: Japanese Voice [Subtitles On]');
        }
      }

      this._updateSubsDubsButtonUI();
      return targetMode;
    }

    // Case 2: Only 1 audio track, but subtitles exist -> Toggle subtitles ON / OFF
    if (subTracks.length > 0) {
      const nextSubVis = !this.subVisible;
      window.hybridAPI.mpv.setSubVisibility(nextSubVis);
      this.subVisible = nextSubVis;
      window.HybridToast?.show(nextSubVis ? 'Subtitles On (Subs)' : 'Subtitles Off');
      this._updateSubsDubsButtonUI();
      return nextSubVis ? 'subs' : 'dubs';
    }

    window.HybridToast?.show('No alternate audio or subtitle tracks found');
    return null;
  }

  cycleAudioTrack() {
    return this.toggleSubsDubs();
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
    const selectedVideoTrack = (this.trackList || []).find((track) => track.type === 'video' && track.selected);
    return {
      resolution: vp.w && vp.h ? `${vp.w}x${vp.h}` : '-',
      droppedFrames: '-',   // updated async below
      totalFrames: '-',
      fps: vp.fps || '-',
      speed: `${this.speed}x`,
      buffered: '-',
      duration: this.formatTime(this.duration),
      codec: selectedVideoTrack?.codec || vp.codec || '-',
      bitrate: '-'
    };
  }

  /** Async stats fetch for values that require get_property */
  async getStatsAsync() {
    const base = this.getStats();
    try {
      const [dropped, fps, vBitrate, videoCodec, cacheState] = await Promise.all([
        window.hybridAPI.mpv.getProperty('drop-frame-count').catch(() => '-'),
        window.hybridAPI.mpv.getProperty('estimated-vf-fps').catch(() => base.fps),
        window.hybridAPI.mpv.getProperty('video-bitrate').catch(() => null),
        window.hybridAPI.mpv.getProperty('video-codec').catch(() => null),
        window.hybridAPI.mpv.getProperty('demuxer-cache-state').catch(() => null),
      ]);
      base.droppedFrames = dropped;
      base.fps = typeof fps === 'number' ? fps.toFixed(1) : fps;
      base.bitrate = vBitrate ? `${(vBitrate / 1000).toFixed(0)} kbps` : '-';
      base.codec = videoCodec || base.codec || '-';
      if (cacheState && cacheState['cache-end'] != null && Number.isFinite(Number(cacheState['cache-end']))) {
        const secondsAhead = Math.max(0, Number(cacheState['cache-end']) - (Number(this.currentTime) || 0));
        base.buffered = `${secondsAhead.toFixed(1)}s`;
      }
    } catch { /* ignore */ }
    return base;
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
    if (this._resumeSeekTimer) {
      clearTimeout(this._resumeSeekTimer);
      this._resumeSeekTimer = null;
    }
    if (this.currentFilePath && this.currentTime > 5 && !this._isNearEnd()) {
      window.hybridAPI.resume.save(this.currentFilePath, this.currentTime);
    }
  }
}

// Export globally
window.HybridPlayer = HybridPlayer;
