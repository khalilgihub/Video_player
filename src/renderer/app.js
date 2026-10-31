/**
 * Hybrid Player - Application Entry Point
 * Initializes all modules and orchestrates the player
 */

const YT_DEBUG = false;
function ytdbg(...args) {
  if (!YT_DEBUG) return;
  console.log('[YTDBG][renderer]', ...args);
}

const VIDEO_DEBUG = false;
function viddbg(...args) {
  if (!VIDEO_DEBUG) return;
  console.log('[VIDDBG][renderer]', ...args);
}

const APP_BOOT_DEBUG = false;
function appdbg(...args) {
  if (!APP_BOOT_DEBUG) return;
  console.log('[APPDBG][renderer]', ...args);
}

const PERF_REPORT_DEBUG = false;
function perfdbg(...args) {
  if (!PERF_REPORT_DEBUG) return;
  console.info(...args);
}

class HybridPerfMonitorImpl {
  constructor({ sampleIntervalMs = 5000 } = {}) {
    this.sampleIntervalMs = sampleIntervalMs;
    this._running = false;
    this._rafId = 0;
    this._timerId = 0;
    this._lastRafTs = 0;
    this._scopeStats = new Map();
    this._scopeFrameMarks = new Map();
    this._recentFrameTimes = [];
    this._windowStartedAt = 0;
    this._lastActiveScope = 'player';
    this._reports = [];
    this._longTaskObserver = null;

    this._onRaf = this._onRaf.bind(this);
  }

  _resolveScope() {
    const welcome = document.getElementById('welcomeScreen');
    const welcomeVisible = !!welcome && !welcome.classList.contains('hidden');
    if (welcomeVisible) {
      const bg = document.body?.dataset?.welcomeBackground || 'dither';
      return `welcome:${bg}`;
    }
    return 'player';
  }

  _getScopeStats(scope) {
    if (!this._scopeStats.has(scope)) {
      this._scopeStats.set(scope, {
        frames: 0,
        frameTimeTotal: 0,
        frameTimeMax: 0,
        over16ms: 0,
        over33ms: 0,
        longTasks: 0,
        longTaskTotal: 0,
      });
    }
    return this._scopeStats.get(scope);
  }

  _onRaf(ts) {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(this._onRaf);
    if (!this._lastRafTs) {
      this._lastRafTs = ts;
      return;
    }

    const dt = ts - this._lastRafTs;
    this._lastRafTs = ts;
    if (!Number.isFinite(dt) || dt <= 0) return;

    const scope = this._resolveScope();
    this._lastActiveScope = scope;
    const stats = this._getScopeStats(scope);
    stats.frames += 1;
    stats.frameTimeTotal += dt;
    if (dt > stats.frameTimeMax) stats.frameTimeMax = dt;
    if (dt > 16.7) stats.over16ms += 1;
    if (dt > 33.3) stats.over33ms += 1;

    this._recentFrameTimes.push(dt);
    if (this._recentFrameTimes.length > 300) {
      this._recentFrameTimes.shift();
    }
  }

  markFrame(tag = 'frame') {
    if (!this._running) return;
    const scope = this._resolveScope();
    const key = `${scope}|${tag}`;
    this._scopeFrameMarks.set(key, (this._scopeFrameMarks.get(key) || 0) + 1);
  }

  _recordLongTask(duration) {
    const scope = this._lastActiveScope || this._resolveScope();
    const stats = this._getScopeStats(scope);
    stats.longTasks += 1;
    stats.longTaskTotal += duration;
  }

  _buildReport() {
    const now = performance.now();
    const elapsedMs = Math.max(1, now - this._windowStartedAt);
    const elapsedSec = elapsedMs / 1000;
    const scopes = [];

    for (const [scope, stats] of this._scopeStats.entries()) {
      if (stats.frames === 0 && stats.longTasks === 0) continue;
      const avgFrameMs = stats.frames > 0 ? stats.frameTimeTotal / stats.frames : 0;
      const fps = stats.frames / elapsedSec;
      scopes.push({
        scope,
        fps: Number(fps.toFixed(1)),
        avgFrameMs: Number(avgFrameMs.toFixed(2)),
        maxFrameMs: Number(stats.frameTimeMax.toFixed(2)),
        over16msPct: Number((stats.frames > 0 ? (stats.over16ms / stats.frames) * 100 : 0).toFixed(1)),
        over33msPct: Number((stats.frames > 0 ? (stats.over33ms / stats.frames) * 100 : 0).toFixed(1)),
        longTasks: stats.longTasks,
        longTaskMs: Number(stats.longTaskTotal.toFixed(1)),
      });
    }

    scopes.sort((a, b) => (b.over33msPct + b.longTasks * 2) - (a.over33msPct + a.longTasks * 2));

    let p95FrameMs = 0;
    if (this._recentFrameTimes.length > 0) {
      const sorted = [...this._recentFrameTimes].sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
      p95FrameMs = sorted[idx];
    }

    const frameMarks = Array.from(this._scopeFrameMarks.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([key, count]) => ({ key, count }));

    return {
      ts: Date.now(),
      windowMs: Math.round(elapsedMs),
      p95FrameMs: Number(p95FrameMs.toFixed(2)),
      scopes,
      frameMarks,
    };
  }

  flush({ force = false } = {}) {
    if (!this._running) return null;
    const elapsed = performance.now() - this._windowStartedAt;
    if (!force && elapsed < this.sampleIntervalMs - 50) return null;

    const report = this._buildReport();
    this._reports.push(report);
    if (this._reports.length > 120) this._reports.shift();

    perfdbg('[PERF][renderer] window report', {
      windowMs: report.windowMs,
      p95FrameMs: report.p95FrameMs,
      scopes: report.scopes,
    });

    window.__hybridPerfLastReport = report;
    window.__hybridPerfReports = this._reports;

    this._scopeStats.clear();
    this._scopeFrameMarks.clear();
    this._recentFrameTimes.length = 0;
    this._windowStartedAt = performance.now();
    return report;
  }

  getSnapshot() {
    return {
      running: this._running,
      reports: [...this._reports],
      latest: window.__hybridPerfLastReport || null,
    };
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastRafTs = 0;
    this._windowStartedAt = performance.now();
    this._rafId = requestAnimationFrame(this._onRaf);
    this._timerId = window.setInterval(() => this.flush(), this.sampleIntervalMs);

    if ('PerformanceObserver' in window) {
      try {
        this._longTaskObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            this._recordLongTask(entry.duration || 0);
          }
        });
        this._longTaskObserver.observe({ type: 'longtask', buffered: true });
      } catch (_) {
        this._longTaskObserver = null;
      }
    }
  }

  stop() {
    if (!this._running) return;
    this._running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    if (this._timerId) {
      clearInterval(this._timerId);
      this._timerId = 0;
    }
    if (this._longTaskObserver) {
      this._longTaskObserver.disconnect();
      this._longTaskObserver = null;
    }
  }
}

if (typeof window !== 'undefined' && !window.HybridPerfMonitor) {
  window.HybridPerfMonitor = new HybridPerfMonitorImpl();
}

class HybridApp {
  constructor() {
    this.player = null;
    this.controlsModule = null;
    this.playlistModule = null;
    this.subtitleModule = null;
    this.equalizerModule = null;
    this.settingsModule = null;
    this.shortcutModule = null;
    this.thumbnailModule = null;
    this.gestureModule = null;
    this.cursorManager = null;
    this.currentPlaybackType = 'local';
    this.currentStreamUrl = null;
    this.currentStreamQuality = 'auto';
    this.youtubeQualityHeights = [];
    this.currentYoutubeInfo = null;
    this._youtubeHeightsVideoId = null;
    // yt-dlp extraction results keyed by video ID (30-min TTL); failures are
    // not cached so a transient YouTube error retries on the next fetch.
    this.youtubeInfoCache = new Map();
    this.youtubeInfoInFlight = new Map();
    this.youtubeInfoCacheTtlMs = 30 * 60 * 1000;
    // Quality probe is deferred until playback has started so yt-dlp doesn't
    // compete with the first video segments for bandwidth.
    this._youtubeProbeTimer = null;
    this._youtubeProbeUrl = null;
    this._youtubePlaylistLoadId = 0;
    this._lastYoutubeLoadUrl = null;
    this._ytAutoRetryUsed = false;
    this._activeYoutubePlaylistId = null;
    this._lastFailedLoadUrl = null;
    this.youtubeQualityLookupTimer = null;
    this._loadSpinnerPending = false;
    this._loadSpinnerShownAt = 0;
    this._loadSpinnerFailSafeTimer = null;
    this._loadSpinnerCompleteTimer = null;
    
    this._statsInterval = null;
    this._fsTransitionTimer = null;
    this._windowVisualState = {
      isFullscreen: false,
      isMaximized: false,
    };
    this._welcomeObserver = null;
    this._lastWindowState = null;
    this.isLocked = false;
    this.isClipRecording = false;
    this.recordStartTime = null;
    this.recordSourcePath = null;
    this._clipRequestInFlight = false;
    this._playbackDiagLogged = false;
    this._isMpvPaused = false;
    this._pausedFrameOverlayEl = null;
    this._pausedFrameCaptureTimer = null;
    this._pausedFrameHeartbeatTimer = null;
    this._pausedFrameCaptureInFlight = false;
    this._pausedFrameLastCaptureAt = 0;
    this.perfMonitor = null;
  }

  async init() {
    appdbg('Hybrid Player initializing...');
    
    try {
      // Initialize core player
      this.player = new HybridPlayer();
      this.perfMonitor = window.HybridPerfMonitor || null;
      this.perfMonitor?.start?.();
      
      // Cursor manager (centralized cursor-hide logic)
      this.cursorManager = new CursorManager();

      // Initialize all modules
      this.controlsModule = new HybridControls(this.player);
      this.playlistModule = new HybridPlaylist(this.player);
      this.subtitleModule = new HybridSubtitles(this.player);
      this.audioModule    = new HybridAudio(this.player);
      this.equalizerModule = new HybridEqualizer(this.player);
      this.settingsModule = new HybridSettings(this.player);
      this.shortcutModule = new HybridShortcuts(this.player, this.controlsModule);
      this.thumbnailModule = new HybridThumbnails(this.player);
      this.gestureModule = new HybridGestures(this.player, this.controlsModule);
      this.player.onError = (data) => this._handlePlaybackError(data);
      this._setupSharedTextureVideo();
      
      // Load saved EQ
      await this.equalizerModule.loadSavedSettings();
      await this._showStartupDiagnostics();
      
      // Load recent files for welcome screen
      await this._loadRecentFiles();
      this._syncWelcomeActiveState();
      
      // Start sidebar as collapsed
      const sidebar = document.getElementById('sidebarPlaylist');
      if (sidebar && !sidebar.classList.contains('collapsed')) {
        appdbg('[LAYOUTDBG][renderer] sidebar not collapsed on init; forcing collapsed state');
      }
      sidebar?.classList.add('collapsed');
      document.body.classList.remove('playlist-open');

      // Stats update interval
      this._statsInterval = setInterval(() => {
        const stats = document.getElementById('statsOverlay');
        if (!stats.hidden) {
          this.controlsModule.updateStats();
        }
      }, 1000);

      const updateAppPresenceState = () => {
        const isVisible = document.visibilityState === 'visible';
        const isFocused = document.hasFocus();
        document.body.classList.toggle('app-unfocused', !(isVisible && isFocused));
      };

      const isTargetEditable = (target) => {
        return Boolean(
          target &&
          typeof target.closest === 'function' &&
          (target.tagName === 'INPUT' ||
           target.tagName === 'TEXTAREA' ||
           target.tagName === 'SELECT' ||
           target.isContentEditable ||
           target.closest('input, select, textarea, [contenteditable="true"]'))
        );
      };

      document.addEventListener('focusin', (e) => {
        if (isTargetEditable(e.target)) {
          window.hybridAPI?.window?.setEditingFocus?.(true);
        }
      }, true);

      document.addEventListener('focusout', (e) => {
        if (isTargetEditable(e.target)) {
          setTimeout(() => {
            if (!isTargetEditable(document.activeElement)) {
              window.hybridAPI?.window?.setEditingFocus?.(false);
            }
          }, 0);
        }
      }, true);

      const releaseColdStartState = () => {
        const body = document.body;
        if (!body.classList.contains('app-cold-start')) {
          updateAppPresenceState();
          return;
        }

        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            body.classList.remove('app-cold-start');
            updateAppPresenceState();
          });
        });
      };

      const applyWindowVisualClasses = () => {
        const isFs = !!this._windowVisualState.isFullscreen;
        const isMax = !isFs && !!this._windowVisualState.isMaximized;

        const bodyIsFs = document.body.classList.contains('is-fullscreen');
        const bodyIsMax = document.body.classList.contains('is-maximized');
        if (bodyIsFs === isFs && bodyIsMax === isMax) {
          return;
        }

        document.body.classList.toggle('is-fullscreen', isFs);
        document.body.classList.toggle('is-maximized', isMax);

        const btnMaximize = document.getElementById('btnMaximize');
        if (btnMaximize) {
          if (isFs) {
            btnMaximize.title = 'Exit Fullscreen (F / Esc)';
            btnMaximize.setAttribute('aria-label', 'Exit Fullscreen');
            btnMaximize.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 12 12">
                <rect x="1" y="1" width="10" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" />
                <line x1="6" y1="8" x2="6" y2="10.5" stroke="currentColor" stroke-width="1.2" />
                <line x1="3.5" y1="10.5" x2="8.5" y2="10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
              </svg>
            `;
          } else if (isMax) {
            btnMaximize.title = 'Restore Down';
            btnMaximize.setAttribute('aria-label', 'Restore window');
            btnMaximize.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M3.5 1.5h7v7" fill="none" stroke="currentColor" stroke-width="1.2" />
                <rect x="1.5" y="3.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" />
              </svg>
            `;
          } else {
            btnMaximize.title = 'Maximize (F11)';
            btnMaximize.setAttribute('aria-label', 'Maximize window');
            btnMaximize.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 12 12">
                <rect x="1" y="1" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3" />
              </svg>
            `;
          }
        }

        const fsEnter = document.querySelector('.icon-fullscreen-enter');
        const fsExit = document.querySelector('.icon-fullscreen-exit');
        if (fsEnter && fsExit) {
          fsEnter.style.display = isFs ? 'none' : 'block';
          fsExit.style.display = isFs ? 'block' : 'none';
        }

        this.cursorManager?.setFullscreen(isFs);
      };

      const applyFsTransition = () => {
        document.body.classList.add('fs-transition');
        if (this._fsTransitionTimer) clearTimeout(this._fsTransitionTimer);
        this._fsTransitionTimer = setTimeout(() => {
          document.body.classList.remove('fs-transition');
          this._fsTransitionTimer = null;
        }, 500);
      };

      const DWM_RENDERER_DIAG = false;

      const logDwmRendererSnapshot = (source, extra = {}) => {
        if (!DWM_RENDERER_DIAG) return;
        try {
          if (!window.hybridAPI?.debug?.appendLog) return;
          const bodyStyle = window.getComputedStyle(document.body);
          const topMaskStyle = window.getComputedStyle(document.body, '::before');
          const titlebar = document.getElementById('titlebar');
          const titlebarRect = titlebar ? titlebar.getBoundingClientRect() : null;
          const payload = {
            source,
            ts: Date.now(),
            hasFocus: document.hasFocus(),
            visibilityState: document.visibilityState,
            devicePixelRatio: window.devicePixelRatio,
            innerSize: { width: window.innerWidth, height: window.innerHeight },
            bodyBackground: bodyStyle.backgroundColor,
            bodyClasses: Array.from(document.body.classList),
            topMask: {
              top: topMaskStyle.getPropertyValue('top'),
              left: topMaskStyle.getPropertyValue('left'),
              width: topMaskStyle.getPropertyValue('width'),
              height: topMaskStyle.getPropertyValue('height'),
              backgroundColor: topMaskStyle.getPropertyValue('background-color'),
              zIndex: topMaskStyle.getPropertyValue('z-index'),
              pointerEvents: topMaskStyle.getPropertyValue('pointer-events'),
            },
            titlebarRect: titlebarRect
              ? {
                  x: Math.round(titlebarRect.x),
                  y: Math.round(titlebarRect.y),
                  width: Math.round(titlebarRect.width),
                  height: Math.round(titlebarRect.height),
                }
              : null,
            ...extra,
          };
          Promise.resolve(window.hybridAPI.debug.appendLog('dwm-renderer', payload)).catch(() => {});
        } catch (error) {
          console.error('[DWMDBG][renderer] snapshot failed', error);
        }
      };

      const scheduleRendererDwmProbe = (source) => {
        if (!DWM_RENDERER_DIAG) return;
        const probeDelays = [0, 16, 33, 66, 120, 220, 350, 600];
        for (const delayMs of probeDelays) {
          setTimeout(() => logDwmRendererSnapshot(`${source}+${delayMs}ms`), delayMs);
        }
      };

      window.hybridAPI.on('window-is-fullscreen', (flag) => {
        const nextFs = !!flag;
        const changed = this._windowVisualState.isFullscreen !== nextFs;
        this._windowVisualState.isFullscreen = nextFs;
        if (nextFs) this._windowVisualState.isMaximized = false;
        applyWindowVisualClasses();
        logDwmRendererSnapshot('ipc-window-is-fullscreen', { flag: nextFs });
        if (changed) {
          applyFsTransition();
          this.controlsModule?.revealChromeAfterWindowStateChange?.();
        }
      });

      window.hybridAPI.on('window-fullscreen-transition-start', () => {
        applyFsTransition();
      });

      window.hybridAPI.on('window-maximize-transition-start', () => {
        document.body.classList.add('max-transition');
      });

      window.hybridAPI.on('window-maximize-transition-end', () => {
        document.body.classList.remove('max-transition');
      });

      window.hybridAPI.on('window-bounds-animating', (isAnimating) => {
        window._isWindowBoundsAnimating = !!isAnimating;
        if (isAnimating) {
          document.body.classList.add('is-animating-bounds');
        } else {
          document.body.classList.remove('is-animating-bounds');
          window.dispatchEvent(new Event('resize'));
        }
      });

      window.addEventListener('offline', () => {
        if (this.currentPlaybackType === 'youtube' || this.currentPlaybackType === 'network') {
          this._setNetworkLoading(true);
          window.HybridToast?.show('Network disconnected. Playback paused.');
          if (this.player?.isPlaying) {
            this._pausedByOffline = true;
            this.player.pause?.();
          }
        }
      });

      window.addEventListener('online', () => {
        if (this.currentPlaybackType === 'youtube' || this.currentPlaybackType === 'network') {
          this._setNetworkLoading(false);
          window.HybridToast?.show('Network reconnected. Resuming...');
          if (this._pausedByOffline) {
            this._pausedByOffline = false;
            if (this.player && !this.player.isPlaying) {
              this.player.play?.();
            }
          }
        }
      });

      window.hybridAPI.on('window-is-maximized', (flag) => {
        const nextMax = !!flag;
        if (nextMax && this._windowVisualState.isFullscreen) return;
        this._windowVisualState.isMaximized = nextMax;
        if (nextMax) this._windowVisualState.isFullscreen = false;
        applyWindowVisualClasses();
        logDwmRendererSnapshot('ipc-window-is-maximized', { flag: nextMax });
      });

      // Backward-compatible state listener (existing main-process events).
      window.hybridAPI.window.onStateChanged((state) => {
        const wasFullscreen = this._lastWindowState === 'fullscreen';
        const nowFullscreen = state === 'fullscreen';
        this._lastWindowState = state;

        if (nowFullscreen) {
          this._windowVisualState.isFullscreen = true;
          this._windowVisualState.isMaximized = false;
        } else if (state === 'maximized') {
          this._windowVisualState.isFullscreen = false;
          this._windowVisualState.isMaximized = true;
        } else if (state === 'normal') {
          this._windowVisualState.isFullscreen = false;
          this._windowVisualState.isMaximized = false;
        }

        window.hybridAPI?.window?.logFullscreen?.('renderer:onStateChanged', {
          state,
          wasFullscreen,
          nowFullscreen,
          visualFullscreen: this._windowVisualState.isFullscreen,
          visualMaximized: this._windowVisualState.isMaximized,
        });

        applyWindowVisualClasses();
        logDwmRendererSnapshot('ipc-window-state-changed', { state });

        // Only run fullscreen transition animation for real fullscreen toggles.
        if (wasFullscreen !== nowFullscreen) {
          applyFsTransition();
          this.controlsModule?.revealChromeAfterWindowStateChange?.();
        }
      });
      if (typeof window.hybridAPI?.window?.isMaximized === 'function') {
        window.hybridAPI.window.isMaximized().then((isMax) => {
          if (isMax && !this._windowVisualState.isFullscreen) {
            this._windowVisualState.isMaximized = true;
            this._windowVisualState.isFullscreen = false;
            applyWindowVisualClasses();
          }
        }).catch(() => {});
      }

      window.addEventListener('blur', () => {
        updateAppPresenceState();
        scheduleRendererDwmProbe('window-blur');
        if (this._isMpvPaused) {
          this._schedulePausedFrameCapture('window-blur', { delayMs: 120, force: true });
        }
      });
      window.addEventListener('focus', () => {
        updateAppPresenceState();
        scheduleRendererDwmProbe('window-focus');
        if (this._isMpvPaused) {
          this._schedulePausedFrameCapture('window-focus', { delayMs: 80, force: true });
        }
      });
      document.addEventListener('visibilitychange', () => {
        updateAppPresenceState();
        scheduleRendererDwmProbe(`visibility-${document.visibilityState}`);
        if (document.visibilityState === 'visible' && this._isMpvPaused) {
          this._schedulePausedFrameCapture('visibility-visible', { delayMs: 120, force: true });
        }
      });
      window.addEventListener('contextmenu', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        const targetInfo = target
          ? {
              tag: target.tagName,
              id: target.id || null,
              className: String(target.className || '').slice(0, 180),
            }
          : null;
        scheduleRendererDwmProbe('contextmenu');
        logDwmRendererSnapshot('contextmenu', {
          client: { x: event.clientX, y: event.clientY },
          screen: { x: event.screenX, y: event.screenY },
          target: targetInfo,
        });
      });

      updateAppPresenceState();
      releaseColdStartState();

      // Listen for file open from args
      window.hybridAPI.on('open-file-from-args', (filePath) => {
        this.openFiles([filePath]);
      });

      // Query initial file from cold start launch arguments if not yet opened
      window.hybridAPI.app?.getInitialFile?.().then((initialPath) => {
        if (initialPath && !this.player?.currentFilePath) {
          this.openFiles([initialPath]);
        }
      }).catch((err) => {
        console.warn('[App] Failed to query initial file:', err);
      });

      // Native Media menu actions (main process -> renderer)
      window.hybridAPI.on('menu-action', async (action, payload) => {
        await this._handleMediaMenuAction(action, payload);
      });

      this._setupNetworkStreamModal();
      this._setupControlBarQualityMenu();
      this._setupSettingsQuickActions();

      window.hybridAPI.mpv.onEvent((event, data) => {
        if (this.currentPlaybackType !== 'youtube') return;
        if (event === 'file-loaded' || event === 'end-file' || event === 'playback-restart' || event === 'error') {
          ytdbg('mpv event', { event, data, currentStreamUrl: this.currentStreamUrl });
        }
      });

      window.hybridAPI.mpv.onEvent((event, data) => {
        if (event === 'skip-osd') {
          this.controlsModule?.showSkipIndicator(Number(data?.seconds) || 0);
          return;
        }

        if (event === 'unlock-request') {
          const unlockBinding = this.shortcutModule?.getBinding?.('unlock-ui') ?? 'Ctrl+KeyU';
          const toggleLockBinding = this.shortcutModule?.getBinding?.('toggle-lock') ?? '';
          if (unlockBinding === 'Ctrl+KeyU' || toggleLockBinding === 'Ctrl+KeyU') {
            this.setLocked(false);
          }
        }
      });

      window.hybridAPI.mpv.onEvent((event, data) => {
        viddbg('mpv:event', { event, pending: this._loadSpinnerPending });

        if (event === 'seek') {
          if (this.currentPlaybackType === 'youtube' || this.currentPlaybackType === 'network') {
            this._setNetworkLoading(true);
          }
          return;
        }

        if (event === 'playback-restart') {
          this._hasStartedPlaying = true;
          this._completeVideoLoadSpinner();
          this._debugRendererPlayback('event:playback-restart');
          this._forcePlaybackSurfaceVisible('playback-restart');
          return;
        }

        if (event === 'file-loaded') {
          // Keep the black curtain up: file-loaded fires when demuxing
          // finishes, BEFORE mpv has presented its first frame. Removing
          // it here would open the transparency leak window.
          this._setNetworkLoading(false);
          this._debugRendererPlayback('event:file-loaded');
          return;
        }

        if (event === 'end-file' || event === 'error') {
          if (event === 'end-file' && data?.reason === 'stop' && this._loadSpinnerPending) {
            viddbg('end-file ignored because new load is pending', { reason: data?.reason });
            return;
          }
          this._hasStartedPlaying = false;
          this._loadSpinnerPending = false;
          this._setNetworkLoading(false);
          this._setVideoCurtain(false);
          this._isMpvPaused = false;
          this._stopPausedFrameHeartbeat();
          this._hidePausedFrameOverlay(`event:${event}`);
          if (event === 'error' || (event === 'end-file' && (data?.reason === 'error' || data?.error))) {
            this.currentStreamUrl = null;
            this.currentPlaybackType = 'local';
            this.youtubeQualityHeights = [];
            this.currentYoutubeInfo = null;
            this._youtubeHeightsVideoId = null;
            this.currentStreamQuality = 'auto';
            this._cancelScheduledYoutubeProbe();
            this._renderControlBarQualityMenu([], 'auto');
          }
        }
      });

      window.hybridAPI.mpv.onPropertyChange((name, value) => {
        if (name === 'pause') {
          this._isMpvPaused = !!value;
          if (this._isMpvPaused) {
            this._startPausedFrameHeartbeat();
            this._schedulePausedFrameCapture('prop:pause=true', { delayMs: 120, force: true });
          } else {
            this._stopPausedFrameHeartbeat();
            this._hidePausedFrameOverlay('prop:pause=false');
          }
          return;
        }

        if (name === 'time-pos' && Number(value) > 0) {
          this._hasStartedPlaying = true;
          this._setVideoCurtain(false);
          if (!this._playbackDiagLogged && Number(value) >= 0.8) {
            this._playbackDiagLogged = true;
            this._debugRendererPlayback('prop:time-pos>=0.8', { timePos: Number(value).toFixed(3) });
            this._forcePlaybackSurfaceVisible('time-pos>=0.8');
          }
        }

        if (name === 'paused-for-cache') {
          this._setNetworkLoading(!!value);
          return;
        }

        if (name === 'seeking') {
          if (this.currentPlaybackType === 'youtube' || this.currentPlaybackType === 'network') {
            this._setNetworkLoading(!!value);
          }
          if (!value && this._isMpvPaused) {
            this._schedulePausedFrameCapture('prop:seeking=false', { delayMs: 140, force: true });
          }
        }
      });

      appdbg('Hybrid Player ready!');
    } catch (err) {
      document.body.classList.remove('app-cold-start');
      console.error('Failed to initialize:', err);
    }
  }

  _setupSharedTextureVideo() {
    const canvas = document.getElementById('videoCanvas');
    if (!canvas) return;
    canvas.style.display = 'none';
    canvas.style.visibility = 'hidden';
    const ctx = canvas.getContext('2d', { alpha: false });

    if (window.hybridTextures && typeof window.hybridTextures.onFrame === 'function') {
      window.hybridTextures.onFrame((frame) => {
        if (!frame) return;
        const w = frame.displayWidth || frame.codedWidth;
        const h = frame.displayHeight || frame.codedHeight;
        if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
          canvas.width = w;
          canvas.height = h;
        }
        if (ctx) {
          ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
        }
        if (canvas.style.display !== 'block') {
          canvas.style.display = 'block';
        }
        if (canvas.style.visibility !== 'visible') {
          canvas.style.visibility = 'visible';
        }
      });
      if (typeof window.hybridTextures.notifyReady === 'function') {
        window.hybridTextures.notifyReady();
      }
    }
  }

  async _loadRecentFiles() {
    try {
      const recent = await window.hybridAPI.history.getRecent(5);
      const container = document.getElementById('recentFiles');
      if (!container || !recent || recent.length === 0) return;

      const heading = document.createElement('h4');
      heading.textContent = 'Recently Played';
      container.replaceChildren(heading);
      recent.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'recent-item';
        btn.type = 'button';

        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('width', '16');
        icon.setAttribute('height', '16');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('fill', 'currentColor');
        icon.setAttribute('aria-hidden', 'true');
        const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        pathEl.setAttribute('d', 'M8 5v14l11-7z');
        icon.appendChild(pathEl);

        const label = document.createElement('span');
        label.textContent = item.name || 'Untitled';

        btn.append(icon, label);
        btn.addEventListener('click', () => {
          this.openFiles([item.path], { replacePlaylist: true, playFirst: true });
        });
        container.appendChild(btn);
      });
    } catch (e) {
      // Ignore
    }
  }

  // ─── Public Methods ────────────────────────────────────

  async _showStartupDiagnostics() {
    try {
      const diagnostics = await window.hybridAPI.app?.getStartupDiagnostics?.();
      if (!Array.isArray(diagnostics)) return;

      diagnostics.forEach((item) => {
        if (!item || typeof item !== 'object') return;
        const message = typeof item.message === 'string' && item.message.trim()
          ? item.message.trim()
          : 'Hybrid Player recovered from a startup issue.';
        window.HybridToast?.show(message);
        if (item.detail) {
          console.warn('[startup diagnostic]', item.code || item.level || 'diagnostic', item.detail);
        }
      });
    } catch (error) {
      console.warn('Failed to read startup diagnostics:', error);
    }
  }

  _handlePlaybackError(data) {
    // Other mpv-event handlers may have already reset currentPlaybackType /
    // currentStreamUrl by the time we run, so fall back to what was loading.
    const wasYoutube = this.currentPlaybackType === 'youtube' || !!this._lastYoutubeLoadUrl;
    const failedUrl = this.currentStreamUrl || (wasYoutube ? this._lastYoutubeLoadUrl : null);
    this._lastYoutubeLoadUrl = null;
    this._cancelVideoLoadSpinner?.();
    this._cancelScheduledYoutubeProbe();
    this.currentStreamUrl = null;
    this.currentPlaybackType = 'local';
    this.currentYoutubeInfo = null;
    this._youtubeHeightsVideoId = null;
    this.youtubeQualityHeights = [];
    this.currentStreamQuality = 'auto';
    this._renderControlBarQualityMenu([], 'auto');
    const wrap = document.getElementById('youtubeQualityControl');
    if (wrap) wrap.hidden = true;
    const dropdown = document.getElementById('youtubeQualityDropdown');
    if (dropdown) dropdown.hidden = true;
    this.resetToIdleState();
    const payload = data && typeof data === 'object' ? data : {};
    const candidateMsg = payload.message || payload.error || payload.file_error || (payload.reason === 'error' ? 'Stream or file failed to load' : payload.reason);
    const message = typeof candidateMsg === 'string' && candidateMsg.trim()
      ? candidateMsg.trim()
      : (typeof data === 'string' && data.trim() ? data.trim() : 'Stream or file failed to load');
    const prefix = payload.fatal ? 'Playback engine unavailable' : 'Playback error';

    if (wasYoutube && failedUrl) {
      this._lastFailedLoadUrl = failedUrl;

      // YouTube bot-gating is transient per request — one automatic retry
      // recovers most failures without user action. Anything after that
      // falls through to the manual error UI.
      if (!this._ytAutoRetryUsed && !payload.fatal) {
        this._ytAutoRetryUsed = true;
        window.HybridToast?.show('YouTube blocked the request — retrying automatically...', 3500);
        setTimeout(() => {
          if (this.currentPlaybackType !== 'local' || this.currentStreamUrl) return;
          this._loadMediaReplace(failedUrl).catch((err) => {
            ytdbg('auto-retry load failed', { failedUrl, error: String(err?.message || err) });
          });
        }, 1800);
        this._runYtdlpUpdateCheck();
        return;
      }

      const hint = /no audio or video data|sign in to confirm|bot|403/i.test(message)
        ? " YouTube's anti-bot check is likely blocking this request — use \"Sign in to YouTube\" in Settings → Streaming Engine to make access reliable."
        : '';
      window.HybridToast?.showError(`YouTube playback failed: ${message}.${hint}`, {
        actions: [
          {
            label: 'Retry',
            onClick: () => {
              const retryUrl = this._lastFailedLoadUrl;
              if (!retryUrl) return;
              window.HybridToast?.show('Retrying...');
              this._loadMediaReplace(retryUrl).catch((err) => {
                ytdbg('retry load failed', { retryUrl, error: String(err?.message || err) });
                window.HybridToast?.show('Retry failed');
              });
            },
          },
        ],
      });

      this._runYtdlpUpdateCheck();
    } else {
      window.HybridToast?.show(`${prefix}: ${message}`);
    }
  }

  _runYtdlpUpdateCheck() {
    window.hybridAPI?.ytdlp?.checkForUpdate?.().then((info) => {
      if (info?.available) {
        if (this.settingsModule?._handleYtdlpUpdateAvailable) {
          this.settingsModule._handleYtdlpUpdateAvailable(info, { suppressToast: true });
        }
        setTimeout(() => {
          window.HybridToast?.showUpdatePrompt(info, async () => {
            return await this.settingsModule?._performYtdlpUpdate?.({ fromNotification: true }) || await window.hybridAPI?.ytdlp?.update?.();
          });
        }, 1200);
      }
    }).catch(() => {});
  }

  async openFiles(filePaths, { replacePlaylist = false, playFirst = false } = {}) {
    const clean = Array.from(new Set((filePaths || []).filter((filePath) => typeof filePath === 'string' && filePath.trim())));
    if (clean.length === 0) return;

    this._closeSettingsModal();

    if (replacePlaylist) {
      this.playlistModule.replaceFiles(clean, { autoPlay: playFirst !== false });
      return;
    }

    const previousCount = this.playlistModule.items.length;
    const hadSelection = this.playlistModule.currentIndex >= 0;
    this.playlistModule.addFiles(clean, { autoPlay: false });

    // Start playback exactly once when requested, or when opening into an empty playlist.
    if (playFirst || (!hadSelection && previousCount === 0)) {
      const firstNewIndex = Math.min(previousCount, this.playlistModule.items.length - 1);
      this.playlistModule.playIndex(firstNewIndex);
    }
  }

  _syncWelcomeActiveState() {
    const welcomeScreen = document.getElementById('welcomeScreen');
    if (!welcomeScreen) return;

    const apply = () => {
      const isVisible = !welcomeScreen.classList.contains('hidden');
      document.body.classList.toggle('welcome-active', isVisible);
    };

    apply();

    if (!this._welcomeObserver) {
      this._welcomeObserver = new MutationObserver(apply);
      this._welcomeObserver.observe(welcomeScreen, {
        attributes: true,
        attributeFilter: ['class']
      });
    }
  }

  async promptOpenFile() {
    const filePath = await window.hybridAPI.dialog.openFile();
    if (filePath) {
      this.openFiles([filePath]);
    }
  }

  async promptOpenMultipleFiles() {
    const paths = await window.hybridAPI.dialog.openMultiple();
    if (Array.isArray(paths) && paths.length > 0) {
      this.openFiles(paths, { replacePlaylist: true, playFirst: true });
    }
  }

  async promptOpenFolder() {
    const paths = await window.hybridAPI.dialog.openFolder();
    if (Array.isArray(paths) && paths.length > 0) {
      this.openFiles(paths, { replacePlaylist: true, playFirst: true });
    } else {
      window.HybridToast?.show('No media files found in folder');
    }
  }

  async promptOpenUrl() {
    this._showNetworkStreamModal();
  }

  async _handleMediaMenuAction(action, payload) {
    switch (action) {
      case 'media-open-file':
        if (typeof payload === 'string' && payload.trim()) {
          await this._loadMediaReplace(payload.trim());
        }
        break;

      case 'media-open-multiple':
        if (Array.isArray(payload) && payload.length > 0) {
          await this._loadMediaReplaceAppend(payload);
        }
        break;

      case 'media-open-folder':
        if (Array.isArray(payload) && payload.length > 0) {
          await this.openFiles(payload, { replacePlaylist: true, playFirst: true });
        } else {
          window.HybridToast?.show('No media files found in selected folder');
        }
        break;

      case 'media-open-network-stream':
      case 'open-url':
        this._showNetworkStreamModal();
        break;

      default:
        break;
    }
  }

  async _loadMediaReplace(filePathOrUrl, { startAt = 0 } = {}) {
    // Recorded before anything can reset playback state: mpv end-file error
    // events and _handlePlaybackError race on currentPlaybackType.
    if (this._isYoutubeUrl(filePathOrUrl)) {
      this._lastYoutubeLoadUrl = filePathOrUrl;
      this._ytAutoRetryUsed = false;
    }
    this._closeSettingsModal();
    this._syncUiAfterDirectLoad(filePathOrUrl);
    this._beginVideoLoadSpinner();
    if (this.playlistModule && !this._isNetworkMediaUrl(filePathOrUrl)) {
      this.playlistModule.items = this.playlistModule._createItems([filePathOrUrl]);
      this.playlistModule.currentIndex = 0;
      this.playlistModule._playedShuffleIndices.clear();
      this.playlistModule._renderList();
    }
    await window.hybridAPI.mpv.setProperty('vid', 'auto');

    let effectiveStart = Number(startAt) || 0;
    if (!effectiveStart && this._isYoutubeUrl(filePathOrUrl)) {
      effectiveStart = await this._resolveYoutubeResumeStart(filePathOrUrl);
    }

    // This mpv build rejects per-load options on the loadfile command itself
    // (mpv_command returns INVALID_PARAMETER for both the flags form and the
    // positional options form), so the start position rides on the `start`
    // option instead: it is set before every load and applies to exactly the
    // next loaded file. '0' resets it to normal playback from the beginning.
    try {
      await window.hybridAPI.mpv.setProperty(
        'options/start',
        effectiveStart > 0 ? String(Math.min(effectiveStart, 30 * 24 * 60 * 60)) : '0'
      );
    } catch (err) {
      ytdbg('set options/start failed', { effectiveStart, error: String(err?.message || err) });
    }
    await window.hybridAPI.mpv.command('loadfile', filePathOrUrl, 'replace');
  }

  async _resolveYoutubeResumeStart(url) {
    try {
      const prefs = await window.hybridAPI.db.getAllPreferences();
      if (!prefs || !prefs.autoResume) return 0;
      const resumeTime = Number(await window.hybridAPI.resume.get(url)) || 0;
      if (resumeTime <= 5) return 0;
      window.HybridToast?.show(`Resuming from ${this._formatTimestamp(resumeTime)}`);
      return resumeTime;
    } catch {
      return 0;
    }
  }

  _formatTimestamp(totalSeconds) {
    const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  async _loadMediaReplaceAppend(paths) {
    this._closeSettingsModal();
    const clean = (paths || []).filter((p) => typeof p === 'string' && p.trim());
    if (clean.length === 0) return;

    this._syncUiAfterDirectLoad(clean[0]);
    this._beginVideoLoadSpinner();
    if (this.playlistModule) {
      this.playlistModule.items = this.playlistModule._createItems(clean);
      this.playlistModule.currentIndex = 0;
      this.playlistModule._playedShuffleIndices.clear();
      this.playlistModule._renderList();
    }
    await window.hybridAPI.mpv.setProperty('vid', 'auto');
    try {
      await window.hybridAPI.mpv.setProperty('options/start', '0');
    } catch {
      // Best-effort reset; a stale start option must not leak into this load.
    }
    await window.hybridAPI.mpv.command('loadfile', clean[0], 'replace');

    window.HybridToast?.show(`Loaded ${clean.length} item(s)`);
  }

  _syncUiAfterDirectLoad(filePathOrUrl) {
    this._isMpvPaused = false;
    this._stopPausedFrameHeartbeat();
    this._hidePausedFrameOverlay('sync-ui-after-load');
    this.controlsModule?.hidePlayPauseIndicator?.();
    this.audioModule?.setSyncOffset?.(0, { apply: false });
    if (this.isClipRecording && this.recordSourcePath && this.recordSourcePath !== filePathOrUrl) {
      this.cancelClipRecording('Clip recording stopped because the source changed');
    }

    if (this.player) {
      this.player._singleScreenshotStack = [];
      this.player._deletedScreenshotStack = [];
      this.player._sessionScreenshots = [];
      this.player.closeScreenshotCarousel?.();
      this.player.clearABLoop?.({ notify: false });
      this.player.currentTime = 0;
      this.player.duration = 0;
      this.player.currentFilePath = filePathOrUrl;
      this.player.isPlaying = true;
      this.player.onPlayStateChanged?.(true);
    }

    this._applyPlaybackSourceState(filePathOrUrl);
  }

  _applyPlaybackSourceState(filePathOrUrl) {
    const isUrl = this._isNetworkMediaUrl(filePathOrUrl);
    this.currentStreamUrl = isUrl ? filePathOrUrl : null;
    this.currentPlaybackType = this._isYoutubeUrl(filePathOrUrl)
      ? 'youtube'
      : (isUrl ? 'network' : 'local');
    this.player.currentPlaybackType = this.currentPlaybackType;

    if (this.currentPlaybackType === 'youtube') {
      this._setYoutubeLiveBadge(false);
      // Keep cached heights when they belong to the same video; otherwise
      // render just "Auto" now — the yt-dlp probe runs after playback has
      // started so it doesn't compete with the first video segments
      // (see _scheduleYoutubeProbe).
      const videoId = this._extractYoutubeId(filePathOrUrl);
      if (this._youtubeHeightsVideoId && this._youtubeHeightsVideoId !== videoId) {
        this.youtubeQualityHeights = [];
        this.currentStreamQuality = 'auto';
        this.currentYoutubeInfo = null;
        this._youtubeHeightsVideoId = null;
      }
      this._renderControlBarQualityMenu(this.youtubeQualityHeights, this.currentStreamQuality);
      this._scheduleYoutubeProbe(filePathOrUrl);
      this._populateYoutubePlaylist(filePathOrUrl).catch((err) => {
        ytdbg('youtube playlist populate failed', { error: String(err?.message || err) });
      });
    } else {
      this._cancelScheduledYoutubeProbe();
      this._setYoutubeLiveBadge(false);
      this._lastYoutubeLoadUrl = null;
      this.youtubeQualityHeights = [];
      this.currentStreamQuality = 'auto';
      this.currentYoutubeInfo = null;
      this._renderControlBarQualityMenu([], 'auto');
    }

    const titleText = isUrl
      ? 'Network Stream — Hybrid Player'
      : `${filePathOrUrl.split(/[/\\]/).pop()} — Hybrid Player`;
    const titleEl = document.getElementById('titlebarText');
    if (titleEl) titleEl.textContent = titleText;
  }

  _extractYoutubeId(url) {
    const normalized = this._isYoutubeUrl(url) ? this._normalizeNetworkMediaUrl(url) : null;
    if (!normalized) return null;
    try {
      const parsed = new URL(normalized);
      const host = parsed.hostname.toLowerCase();
      if (host === 'youtu.be') {
        return parsed.pathname.split('/').filter(Boolean)[0] || null;
      }
      const vParam = parsed.searchParams.get('v');
      if (vParam) return vParam;
      const segments = parsed.pathname.split('/').filter(Boolean);
      const markerIndex = segments.findIndex((seg) => ['embed', 'shorts', 'live', 'v'].includes(seg));
      if (markerIndex !== -1 && segments[markerIndex + 1]) {
        return segments[markerIndex + 1];
      }
      return null;
    } catch {
      return null;
    }
  }

  _extractYoutubePlaylistId(url) {
    const normalized = this._isYoutubeUrl(url) ? this._normalizeNetworkMediaUrl(url) : null;
    if (!normalized) return null;
    try {
      return new URL(normalized).searchParams.get('list') || null;
    } catch {
      return null;
    }
  }

  _setNetworkLoading(visible) {
    const spinner = document.getElementById('networkLoadingSpinner');
    if (!spinner) return;
    const isNetwork = this.currentPlaybackType === 'youtube' || this.currentPlaybackType === 'network';
    const shouldShow = !!visible && isNetwork;
    spinner.classList.toggle('hidden', !shouldShow);
    viddbg('spinner', { visible, shouldShow, className: spinner.className });
  }

  _setVideoCurtain(visible) {
    const curtain = document.getElementById('video-curtain');
    if (!curtain) return;
    if (visible) {
      curtain.style.opacity = '';
      curtain.style.pointerEvents = '';
      this._hidePausedFrameOverlay('curtain-visible');
    }
    curtain.classList.toggle('visible', !!visible);
    const cs = window.getComputedStyle(curtain);
    viddbg('curtain', {
      visible,
      className: curtain.className,
      opacity: cs.opacity,
      display: cs.display,
      zIndex: cs.zIndex,
    });
  }

  _debugRendererPlayback(source, extra = {}) {
    try {
      const curtain = document.getElementById('video-curtain');
      const spinner = document.getElementById('networkLoadingSpinner');
      const welcome = document.getElementById('welcomeScreen');
      const mpvContainer = document.getElementById('mpvContainer');
      const videoContainer = document.getElementById('videoContainer');

      const curtainStyle = curtain ? window.getComputedStyle(curtain) : null;
      const welcomeStyle = welcome ? window.getComputedStyle(welcome) : null;
      const mpvStyle = mpvContainer ? window.getComputedStyle(mpvContainer) : null;
      let topElementClass = null;
      let topElementTag = null;
      if (videoContainer) {
        const rect = videoContainer.getBoundingClientRect();
        const x = Math.round(rect.left + rect.width / 2);
        const y = Math.round(rect.top + rect.height / 2);
        const topEl = document.elementFromPoint(x, y);
        topElementClass = topEl?.className || null;
        topElementTag = topEl?.tagName || null;
      }
      const payload = {
        source,
        curtainVisibleClass: curtain?.classList.contains('visible') || false,
        curtainOpacity: curtainStyle?.opacity || null,
        curtainDisplay: curtainStyle?.display || null,
        spinnerHiddenClass: spinner?.classList.contains('hidden') || false,
        welcomeHiddenClass: welcome?.classList.contains('hidden') || false,
        welcomeOpacity: welcomeStyle?.opacity || null,
        bodyWelcomeActive: document.body.classList.contains('welcome-active'),
        mpvRect: mpvContainer
          ? {
              w: Math.round(mpvContainer.getBoundingClientRect().width),
              h: Math.round(mpvContainer.getBoundingClientRect().height),
            }
          : null,
        videoRect: videoContainer
          ? {
              w: Math.round(videoContainer.getBoundingClientRect().width),
              h: Math.round(videoContainer.getBoundingClientRect().height),
            }
          : null,
        mpvDisplay: mpvStyle?.display || null,
        mpvOpacity: mpvStyle?.opacity || null,
        mpvZIndex: mpvStyle?.zIndex || null,
        mpvPointerEvents: mpvStyle?.pointerEvents || null,
        topElementAtVideoCenter: {
          tag: topElementTag,
          className: topElementClass,
        },
        ...extra,
      };

      window.hybridAPI.debug.appendLog('renderer-playdbg', payload).catch(() => {});
    } catch {
      // ignore debug failures
    }
  }

  // ─── Playback Surface & Anti-Transparency First-Frame Handoff ──
  // CRITICAL ARCHITECTURE NOTE (DO NOT REMOVE / DO NOT ALTER HANDOFF TIMING):
  // Because the Electron window is transparent, this method coordinates the exact millisecond
  // when mpv presents its first decoded frame.
  // Removing #video-curtain and #welcomeScreen SIMULTANEOUSLY upon `playback-restart` prevents
  // the transparent background from briefly leaking the Windows desktop.
  _forcePlaybackSurfaceVisible(reason) {
    const curtain = document.getElementById('video-curtain');
    const spinner = document.getElementById('networkLoadingSpinner');
    const welcome = document.getElementById('welcomeScreen');

    if (curtain) {
      curtain.classList.remove('visible');
      curtain.style.opacity = '0';
      curtain.style.pointerEvents = 'none';
    }
    if (spinner) {
      spinner.classList.add('hidden');
    }
    if (welcome && this.player?.currentFilePath) {
      welcome.classList.add('hidden');
    }
    if (this._isMpvPaused) {
      this._schedulePausedFrameCapture(`force-visible:${reason}`, { delayMs: 90, force: true });
    }

    this._debugRendererPlayback(`force-visible:${reason}`);
  }

  _ensurePausedFrameOverlay() {
    if (this._pausedFrameOverlayEl && this._pausedFrameOverlayEl.isConnected) {
      return this._pausedFrameOverlayEl;
    }
    const videoContainer = document.getElementById('videoContainer');
    if (!videoContainer) return null;
    const overlay = document.createElement('img');
    overlay.className = 'paused-frame-overlay';
    overlay.alt = '';
    overlay.draggable = false;
    overlay.setAttribute('aria-hidden', 'true');
    videoContainer.appendChild(overlay);
    this._pausedFrameOverlayEl = overlay;
    return overlay;
  }

  _hidePausedFrameOverlay(reason = 'unknown') {
    if (this._pausedFrameCaptureTimer) {
      clearTimeout(this._pausedFrameCaptureTimer);
      this._pausedFrameCaptureTimer = null;
    }
    const overlay = this._pausedFrameOverlayEl;
    if (!overlay) return;
    overlay.classList.remove('visible');
    this._debugRendererPlayback('paused-frame-hidden', { reason });
  }

  _startPausedFrameHeartbeat() {
    // Repetitive screenshot polling removed to prevent disk and heap churn while idle.
  }

  _stopPausedFrameHeartbeat() {
    if (!this._pausedFrameHeartbeatTimer) return;
    clearInterval(this._pausedFrameHeartbeatTimer);
    this._pausedFrameHeartbeatTimer = null;
  }

  _schedulePausedFrameCapture(reason, { delayMs = 100, force = false } = {}) {
    if (this._pausedFrameCaptureTimer) {
      clearTimeout(this._pausedFrameCaptureTimer);
      this._pausedFrameCaptureTimer = null;
    }
    this._pausedFrameCaptureTimer = setTimeout(() => {
      this._pausedFrameCaptureTimer = null;
      this._capturePausedFrame(reason, { force });
    }, Math.max(0, delayMs));
  }

  async _capturePausedFrame(reason, { force = false } = {}) {
    if (!this._isMpvPaused) return;
    if (this._pausedFrameCaptureInFlight) return;
    const now = Date.now();
    if (!force && now - this._pausedFrameLastCaptureAt < 1200) return;
    if (!this.player?.currentFilePath) return;

    const overlay = this._ensurePausedFrameOverlay();
    if (!overlay) return;

    this._pausedFrameCaptureInFlight = true;
    try {
      const payload = await window.hybridAPI.mpv.capturePausedFrame?.('subtitles');
      const previewDataUrl = typeof payload?.previewDataUrl === 'string' ? payload.previewDataUrl.trim() : '';
      const previewUrl = typeof payload?.previewUrl === 'string' ? payload.previewUrl.trim() : '';
      if (!previewDataUrl && !previewUrl) return;
      overlay.src = previewDataUrl || `${previewUrl}${previewUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
      overlay.classList.add('visible');
      this._pausedFrameLastCaptureAt = Date.now();
      this._debugRendererPlayback('paused-frame-captured', {
        reason,
        previewUrl: previewDataUrl ? 'inline-data-url' : previewUrl,
      });
    } catch (error) {
      this._debugRendererPlayback('paused-frame-capture-failed', {
        reason,
        error: String(error?.message || error || 'unknown'),
      });
    } finally {
      this._pausedFrameCaptureInFlight = false;
    }
  }

  _beginVideoLoadSpinner() {
    if (this._loadSpinnerFailSafeTimer) {
      clearTimeout(this._loadSpinnerFailSafeTimer);
      this._loadSpinnerFailSafeTimer = null;
    }
    if (this._loadSpinnerCompleteTimer) {
      clearTimeout(this._loadSpinnerCompleteTimer);
      this._loadSpinnerCompleteTimer = null;
    }

    this._loadSpinnerPending = true;
    this._hasStartedPlaying = false;
    this._playbackDiagLogged = false;
    this._stopPausedFrameHeartbeat();
    this._hidePausedFrameOverlay('begin-load');
    this._loadSpinnerShownAt = Date.now();
    this._setVideoCurtain(true);
    this._setNetworkLoading(true);

    this._loadSpinnerFailSafeTimer = setTimeout(() => {
      if (!this._loadSpinnerPending) return;
      viddbg('failsafe triggered: force hide curtain/spinner');
      this._loadSpinnerPending = false;
      this._setNetworkLoading(false);
      this._setVideoCurtain(false);
      this._loadSpinnerFailSafeTimer = null;
    }, 8000);
  }

  _completeVideoLoadSpinner() {
    if (this._loadSpinnerFailSafeTimer) {
      clearTimeout(this._loadSpinnerFailSafeTimer);
      this._loadSpinnerFailSafeTimer = null;
    }
    if (this._loadSpinnerCompleteTimer) {
      clearTimeout(this._loadSpinnerCompleteTimer);
      this._loadSpinnerCompleteTimer = null;
    }

    if (!this._loadSpinnerPending) {
      this._setNetworkLoading(false);
      this._setVideoCurtain(false);
      return;
    }

    const elapsed = Date.now() - this._loadSpinnerShownAt;
    const minVisibleMs = 180;
    const delay = Math.max(0, minVisibleMs - elapsed);

    this._loadSpinnerCompleteTimer = setTimeout(() => {
      this._loadSpinnerCompleteTimer = null;
      if (!this._loadSpinnerPending) return;
      this._loadSpinnerPending = false;
      this._setNetworkLoading(false);
      this._setVideoCurtain(false);
    }, delay);
  }

  _cancelVideoLoadSpinner() {
    if (this._loadSpinnerFailSafeTimer) {
      clearTimeout(this._loadSpinnerFailSafeTimer);
      this._loadSpinnerFailSafeTimer = null;
    }
    if (this._loadSpinnerCompleteTimer) {
      clearTimeout(this._loadSpinnerCompleteTimer);
      this._loadSpinnerCompleteTimer = null;
    }
    this._loadSpinnerPending = false;
    this._setNetworkLoading(false);
    this._setVideoCurtain(false);
  }

  _closeSettingsModal() {
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal) {
      settingsModal.hidden = true;
    }
  }

  _isYoutubeUrl(url) {
    const normalized = this._normalizeNetworkMediaUrl(url);
    if (!normalized) return false;
    try {
      const host = new URL(normalized).hostname.toLowerCase();
      return [
        'youtube.com',
        'www.youtube.com',
        'm.youtube.com',
        'music.youtube.com',
        'youtu.be',
        'youtube-nocookie.com',
        'www.youtube-nocookie.com',
      ].includes(host);
    } catch {
      return false;
    }
  }

  _normalizeNetworkMediaUrl(url) {
    const value = typeof url === 'string' ? url.trim() : '';
    if (!value || value.length > 4096) return null;

    try {
      const parsed = new URL(value);
      const allowedProtocols = new Set(['http:', 'https:', 'rtsp:', 'rtmp:', 'rtmps:', 'srt:']);
      return allowedProtocols.has(parsed.protocol) ? parsed.href : null;
    } catch {
      return null;
    }
  }

  _isNetworkMediaUrl(url) {
    return !!this._normalizeNetworkMediaUrl(url);
  }

  _isPrivateNetworkUrl(url) {
    const normalized = this._normalizeNetworkMediaUrl(url);
    if (!normalized) return false;

    try {
      const host = new URL(normalized).hostname.toLowerCase().replace(/^\[|\]$/g, '');
      if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
      if (host === '::1' || host.startsWith('fe80:')) return true;
      if (host.includes(':') && (host.startsWith('fc') || host.startsWith('fd'))) return true;

      const parts = host.split('.').map((part) => Number(part));
      if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
      }

      const [a, b] = parts;
      return (
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168)
      );
    } catch {
      return false;
    }
  }

  _confirmPrivateNetworkStream(url) {
    if (!this._isPrivateNetworkUrl(url)) return true;
    return window.confirm('This stream points to a local or private network address. Open it only if you trust the source.');
  }

  _mapQualityLabel(height) {
    if (height === 'audio') return 'Audio only';
    const num = Number(height);
    if (!Number.isFinite(num) || num <= 0) return 'Auto';
    if (num >= 3200) return '8K';
    if (num >= 1800) return '4K';
    if (num >= 1200) return '1440p (HD)';
    if (num >= 900) return '1080p';
    if (num >= 576) return '720p';
    if (num >= 400) return '480p';
    if (num >= 300) return '360p';
    if (num >= 180) return '240p';
    return '144p';
  }

  _renderControlBarQualityMenu(heights, selected = 'auto') {
    const wrap = document.getElementById('youtubeQualityControl');
    const btn = document.getElementById('btnYoutubeQuality');
    const list = document.getElementById('youtubeQualityList');
    const dropdown = document.getElementById('youtubeQualityDropdown');
    if (!wrap || !btn || !list || !dropdown) return;

    list.replaceChildren();
    const options = ['auto', 'audio', ...heights];

    options.forEach((item) => {
      const value = item === 'auto' ? 'auto' : (item === 'audio' ? 'audio' : String(item));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quality-dropdown-item';
      button.dataset.quality = value;
      button.textContent = this._mapQualityLabel(item);
      if (String(selected) === value) {
        button.classList.add('active');
      }
      list.appendChild(button);
    });

    const selectedText = this._mapQualityLabel(selected);
    btn.textContent = selectedText;

    if (this.currentPlaybackType === 'youtube') {
      wrap.hidden = false;
    } else {
      wrap.hidden = true;
      dropdown.hidden = true;
    }
  }

  _youtubeInfoCacheKey(url) {
    return this._extractYoutubeId(url) || String(url || '').trim();
  }

  _readCachedYoutubeInfo(url) {
    const key = this._youtubeInfoCacheKey(url);
    const entry = this.youtubeInfoCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > this.youtubeInfoCacheTtlMs) {
      this.youtubeInfoCache.delete(key);
      return null;
    }
    return entry.info;
  }

  async _fetchYoutubeInfo(url) {
    const key = this._youtubeInfoCacheKey(url);
    if (!key) return null;

    const cached = this._readCachedYoutubeInfo(url);
    if (cached) {
      ytdbg('fetch info cache hit', { key, heights: cached.heights?.length || 0 });
      return cached;
    }

    if (this.youtubeInfoInFlight.has(key)) {
      ytdbg('fetch info join in-flight request', { key });
      return this.youtubeInfoInFlight.get(key);
    }

    const request = (async () => {
      try {
        ytdbg('fetch info start', { url, key });
        const info = await window.hybridAPI.youtube.getInfo(url);
        if (!info || !Array.isArray(info.heights)) return null;
        this.youtubeInfoCache.set(key, { info, fetchedAt: Date.now() });
        ytdbg('fetch info success', { key, heights: info.heights, title: info.title });
        return info;
      } catch {
        ytdbg('fetch info error');
        return null;
      } finally {
        this.youtubeInfoInFlight.delete(key);
      }
    })();

    this.youtubeInfoInFlight.set(key, request);
    return request;
  }

  async _fetchYoutubeQualityHeights(url) {
    const info = await this._fetchYoutubeInfo(url);
    return Array.isArray(info?.heights) ? info.heights : [];
  }

  _scheduleYoutubeProbe(url) {
    this._cancelScheduledYoutubeProbe();
    this._youtubeProbeUrl = url;
    // Let playback claim the network first; the probe feeds both the quality
    // menu and the title/LIVE metadata.
    this._youtubeProbeTimer = setTimeout(() => {
      this._youtubeProbeTimer = null;
      const target = this._youtubeProbeUrl;
      this._youtubeProbeUrl = null;
      if (!target || this.currentStreamUrl !== target || this.currentPlaybackType !== 'youtube') return;
      this._refreshYoutubeQualityUi(target).catch(() => {
        ytdbg('scheduled probe failed', { url: target });
      });
    }, 3500);
  }

  _cancelScheduledYoutubeProbe() {
    if (this._youtubeProbeTimer) {
      clearTimeout(this._youtubeProbeTimer);
      this._youtubeProbeTimer = null;
    }
    this._youtubeProbeUrl = null;
  }

  async _refreshYoutubeQualityUi(url) {
    if (!this._isYoutubeUrl(url)) {
      this.currentPlaybackType = 'local';
      this.youtubeQualityHeights = [];
      this.currentStreamQuality = 'auto';
      this._renderControlBarQualityMenu([], 'auto');
      return;
    }

    this.currentPlaybackType = 'youtube';
    const info = await this._fetchYoutubeInfo(url);
    if (this.currentStreamUrl !== url || this.currentPlaybackType !== 'youtube') {
      return;
    }
    const heights = Array.isArray(info?.heights) ? info.heights : [];
    this.youtubeQualityHeights = heights;
    this.currentYoutubeInfo = info || null;
    this._youtubeHeightsVideoId = info?.videoId || this._extractYoutubeId(url) || null;
    if (info) {
      this._applyYoutubeMetadata(info);
    }
    ytdbg('refresh quality UI', { url, heightsCount: heights.length, heights });
    const currentQuality = this.currentStreamQuality;
    const selected = currentQuality === 'audio' || heights.includes(Number(currentQuality))
      ? currentQuality
      : 'auto';
    this._renderControlBarQualityMenu(heights, selected);
  }

  _applyYoutubeMetadata(info) {
    if (!info) return;
    const titleEl = document.getElementById('titlebarText');
    if (titleEl) {
      const parts = [];
      if (info.title) parts.push(info.title);
      if (info.uploader) parts.push(info.uploader);
      if (parts.length > 0) {
        titleEl.textContent = `${parts.join(' — ')} — Hybrid Player`;
      }
    }
    this._setYoutubeLiveBadge(info.isLive === true);
  }

  _setYoutubeLiveBadge(visible) {
    const badge = document.getElementById('ytLiveBadge');
    if (badge) badge.hidden = !visible;
  }

  async _populateYoutubePlaylist(url) {
    const playlistId = this._extractYoutubePlaylistId(url);
    if (!playlistId) return;

    if (this._activeYoutubePlaylistId === playlistId
      && this.playlistModule?.items?.some((item) => this._extractYoutubeId(item.path) === this._extractYoutubeId(url))) {
      ytdbg('youtube playlist already populated', { playlistId });
      return;
    }

    const loadId = ++this._youtubePlaylistLoadId;
    ytdbg('youtube playlist fetch start', { playlistId, url });
    const playlist = await window.hybridAPI.youtube.getPlaylist(url);
    if (loadId !== this._youtubePlaylistLoadId || !playlist || !Array.isArray(playlist.entries)) return;
    if (this.currentPlaybackType !== 'youtube') return;

    const currentVideoId = this._extractYoutubeId(url);
    const items = playlist.entries.map((entry) => ({
      path: entry.url,
      name: entry.title || entry.id,
      duration: entry.duration || null,
    }));
    if (items.length === 0) return;

    // Keep the manually opened video in the queue even if yt-dlp's listing
    // doesn't include it (e.g. private/unlisted first entry).
    if (currentVideoId && !items.some((item) => this._extractYoutubeId(item.path) === currentVideoId)) {
      items.unshift({ path: url, name: currentVideoId, duration: null });
    }

    const currentIndex = currentVideoId
      ? items.findIndex((item) => this._extractYoutubeId(item.path) === currentVideoId)
      : -1;

    if (this.playlistModule) {
      this.playlistModule.items = items;
      this.playlistModule.currentIndex = currentIndex >= 0 ? currentIndex : 0;
      this.playlistModule._playedShuffleIndices.clear();
      this.playlistModule._renderList();
    }
    this._activeYoutubePlaylistId = playlistId;
    window.HybridToast?.show(`Loaded ${items.length} playlist item${items.length === 1 ? '' : 's'}`);
    ytdbg('youtube playlist populated', { playlistId, count: items.length, currentIndex });
  }

  _buildYtdlFormat(selectedHeight) {
    if (selectedHeight === 'audio') {
      return 'bestaudio/best';
    }
    if (!selectedHeight || selectedHeight === 'auto') {
      return 'bestvideo+bestaudio/best';
    }
    return `bestvideo[height<=?${selectedHeight}]+bestaudio/best`;
  }

  async _applyYoutubeQualityAndReload(selectedHeight, streamUrl) {
    const targetUrl = (typeof streamUrl === 'string' && streamUrl.trim())
      ? streamUrl.trim()
      : this.currentStreamUrl;
    if (!targetUrl) return;

    ytdbg('apply quality start', { selectedHeight, targetUrl });

    const isSwitchingCurrentStream = this.currentStreamUrl === targetUrl;
    let playbackTime = 0;
    if (isSwitchingCurrentStream) {
      try {
        playbackTime = Number(await window.hybridAPI.mpv.getProperty('time-pos')) || 0;
      } catch {
        playbackTime = 0;
      }
    }
    ytdbg('captured playback time', { playbackTime, isSwitchingCurrentStream });

    const format = this._buildYtdlFormat(selectedHeight);
    ytdbg('set ytdl-format', { format });
    await window.hybridAPI.mpv.setProperty('ytdl-format', format);
    ytdbg('reload stream', { targetUrl });
    // The position is carried on the `start` option (set inside
    // _loadMediaReplace right before loadfile), so mpv opens the stream
    // already at the right point — no post-load seek race.
    await this._loadMediaReplace(targetUrl, { startAt: playbackTime });

    if (this.currentStreamUrl !== targetUrl || this.currentPlaybackType !== 'youtube') {
      return;
    }
    this.currentStreamQuality = selectedHeight || 'auto';
    this._renderControlBarQualityMenu(this.youtubeQualityHeights, this.currentStreamQuality);
    ytdbg('apply quality done', { currentStreamQuality: this.currentStreamQuality });
  }

  _setupControlBarQualityMenu() {
    const wrap = document.getElementById('youtubeQualityControl');
    const button = document.getElementById('btnYoutubeQuality');
    const dropdown = document.getElementById('youtubeQualityDropdown');
    const list = document.getElementById('youtubeQualityList');
    if (!wrap || !button || !dropdown || !list) return;

    button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.currentPlaybackType !== 'youtube') return;
      // The probe is deferred until playback starts; if the user opens the
      // menu before it ran (or it found nothing), probe on demand now.
      if (this.youtubeQualityHeights.length === 0 && this.currentStreamUrl) {
        const url = this.currentStreamUrl;
        this._refreshYoutubeQualityUi(url).catch(() => {
          ytdbg('on-demand probe failed', { url });
        });
      }
      dropdown.hidden = !dropdown.hidden;
    });

    list.addEventListener('click', async (e) => {
      const target = e.target.closest('.quality-dropdown-item');
      if (!target) return;
      const raw = target.dataset.quality;
      const selected = raw === 'auto' ? 'auto' : (raw === 'audio' ? 'audio' : Number(raw));
        try {
          await this._applyYoutubeQualityAndReload(selected, this.currentStreamUrl);
          window.HybridToast?.show(`Quality: ${this._mapQualityLabel(selected)}`);
        } catch {
          window.HybridToast?.show('Failed to switch quality');
        }
        dropdown.hidden = true;
    });

    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) {
        dropdown.hidden = true;
      }
    });

    this._renderControlBarQualityMenu([], 'auto');
  }

  _setupNetworkStreamModal() {
    const modal = document.getElementById('networkStreamModal');
    const input = document.getElementById('networkStreamInput');
    const form = document.getElementById('networkStreamForm');
    const cancelBtn = document.getElementById('btnCancelNetworkStream');

    if (!modal || !input || !form || !cancelBtn) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = this._normalizeNetworkMediaUrl(input.value);
      if (!url) {
        window.HybridToast?.show('Enter a valid HTTP, RTSP, RTMP, or SRT URL');
        input.focus();
        return;
      }

      if (!this._confirmPrivateNetworkStream(url)) {
        input.focus();
        return;
      }

      this._closeNetworkStreamModal();
      input.value = '';
      window.HybridToast?.show('Opening stream...');

      this._closeSettingsModal();
      this._beginVideoLoadSpinner();

      ytdbg('network stream submit', { url, isYoutube: this._isYoutubeUrl(url) });

      if (this._isYoutubeUrl(url)) {
        const selected = this.currentStreamUrl === url ? this.currentStreamQuality : 'auto';
        try {
          await this._applyYoutubeQualityAndReload(selected, url);
        } catch {
          ytdbg('quality apply failed; fallback to auto', { url });
          try {
            await window.hybridAPI.mpv.setProperty('ytdl-format', this._buildYtdlFormat('auto'));
            await this._loadMediaReplace(url);
          } catch (err) {
            ytdbg('youtube load fallback failed', { url, error: err });
            this.resetToIdleState();
          }
        }
      } else {
        ytdbg('non-youtube stream load with auto format', { url });
        try {
          await window.hybridAPI.mpv.setProperty('ytdl-format', this._buildYtdlFormat('auto'));
          await this._loadMediaReplace(url);
        } catch (err) {
          ytdbg('non-youtube stream load failed', { url, error: err });
        }
      }
    });

    cancelBtn.addEventListener('click', () => {
      this._closeNetworkStreamModal();
    });
  }

  _closeNetworkStreamModal() {
    const modal = document.getElementById('networkStreamModal');
    if (!modal || modal.hidden || modal.classList.contains('modal-closing')) return;

    if (window.HybridApp?.settingsModule?._closeModal) {
      window.HybridApp.settingsModule._closeModal(modal);
      return;
    }

    modal.classList.add('modal-closing');
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      modal.removeEventListener('animationend', handleAnimEnd);
      modal.classList.remove('modal-closing');
      modal.hidden = true;
    };
    const handleAnimEnd = (e) => {
      if (e.target === modal || e.target.classList?.contains('modal-panel')) {
        finish();
      }
    };
    modal.addEventListener('animationend', handleAnimEnd);
    setTimeout(finish, 220);
  }

  _showNetworkStreamModal() {
    const modal = document.getElementById('networkStreamModal');
    const input = document.getElementById('networkStreamInput');
    if (!modal || !input) return;

    modal.classList.remove('modal-closing');
    if (this.currentStreamUrl) {
      input.value = this.currentStreamUrl;
    }

    modal.hidden = false;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  _setupSettingsQuickActions() {
    const openFileBtn = document.getElementById('settingsOpenFile');
    const openMultipleBtn = document.getElementById('settingsOpenMultiple');
    const openFolderBtn = document.getElementById('settingsOpenFolder');
    const openStreamBtn = document.getElementById('settingsOpenStream');
    const quitBtn = document.getElementById('settingsQuitPlayer');

    openFileBtn?.addEventListener('click', async () => {
      await this.promptOpenFile();
    });

    openMultipleBtn?.addEventListener('click', async () => {
      await this.promptOpenMultipleFiles();
    });

    openFolderBtn?.addEventListener('click', async () => {
      await this.promptOpenFolder();
    });

    openStreamBtn?.addEventListener('click', () => {
      const settingsModal = document.getElementById('settingsModal');
      if (settingsModal) {
        settingsModal.hidden = true;
        settingsModal.classList.remove('modal-closing');
      }
      this._showNetworkStreamModal();
    });

    quitBtn?.addEventListener('click', async () => {
      await window.hybridAPI.window.close();
    });
  }

  async setLocked(locked) {
    const nextState = !!locked;
    const wasLocked = !!this.isLocked;
    this.isLocked = nextState;
    document.body.classList.toggle('is-locked', nextState);
    this.controlsModule?.setLockState(nextState);

    if (nextState) {
      this.controlsModule?.closeAllModals();
      document.getElementById('sidebarPlaylist')?.classList.add('collapsed');
      const btnPlaylist = document.getElementById('btnPlaylist');
      if (btnPlaylist) {
        btnPlaylist.setAttribute('aria-expanded', 'false');
        btnPlaylist.classList.remove('active');
      }
      document.body.classList.remove('playlist-open');
      this.cursorManager?.resume();
      if (!wasLocked) {
        const rawCombo =
          this.shortcutModule?.getBinding?.('unlock-ui') ||
          this.shortcutModule?.getBinding?.('toggle-lock') ||
          '';
        const displayCombo = rawCombo
          ? this.shortcutModule?.formatComboCompact?.(rawCombo) || rawCombo
          : '';
        window.HybridToast?.show(
          displayCombo ? `Controls locked (${displayCombo} to unlock)` : 'Controls locked'
        );
      }
    } else {
      this.cursorManager?.resume();
      if (wasLocked) {
        window.HybridToast?.show('Controls unlocked');
      }
    }

    try {
      await window.hybridAPI.window.setUiLocked(nextState);
    } catch {
      // Best-effort sync for mpv-surface hotkey blocking.
    }

    return nextState;
  }

  toggleLock() {
    return this.setLocked(!this.isLocked);
  }

  _isClipEligiblePath(filePath) {
    const value = typeof filePath === 'string' ? filePath.trim() : '';
    return !!value && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value);
  }

  async toggleClipRecording() {
    if (this._clipRequestInFlight) return;

    if (this.isClipRecording) {
      await this.stopClipRecording();
      return;
    }

    await this.startClipRecording();
  }

  async startClipRecording() {
    const filePath = this.player?.currentFilePath;
    if (!this._isClipEligiblePath(filePath)) {
      window.HybridToast?.show('Clip recording only works for local files');
      return false;
    }

    const currentTime = Number(await window.hybridAPI.mpv.getProperty('time-pos')) || this.player.currentTime || 0;
    this.recordStartTime = Math.max(0, currentTime);
    this.recordSourcePath = filePath;
    this.isClipRecording = true;
    this.controlsModule?.setRecordingState(true, 'Recording started');
    window.HybridToast?.show('Recording started');
    return true;
  }

  async stopClipRecording() {
    if (!this.isClipRecording) return false;

    this._clipRequestInFlight = true;
    const sourcePath = this.recordSourcePath;

    try {
      if (!this._isClipEligiblePath(sourcePath)) {
        throw new Error('Clip recording only works for local files');
      }

      if (sourcePath !== this.player?.currentFilePath) {
        throw new Error('Clip recording stopped because the source changed');
      }

      const endTime = Number(await window.hybridAPI.mpv.getProperty('time-pos')) || this.player.currentTime || this.recordStartTime || 0;
      const safeEndTime = Math.max(this.recordStartTime || 0, endTime);
      const duration = safeEndTime - (this.recordStartTime || 0);

      this.isClipRecording = false;
      window.HybridToast?.show('Stop Recording');

      if (duration <= 0.2) {
        throw new Error('Clip duration is too short');
      }

      const result = await window.hybridAPI.media.clipSegment({
        filePath: sourcePath,
        startTime: this.recordStartTime,
        duration,
      });

      this.controlsModule?.setRecordingState(false, 'Stop Recording');
      const outputName = result?.outputPath ? result.outputPath.split(/[/\\]/).pop() : 'clip';
      window.HybridToast?.show(`Clip saved: ${outputName}`);
      return true;
    } catch (error) {
      this.controlsModule?.setRecordingState(false, 'Clip Failed');
      window.HybridToast?.show(error?.message || 'Clip export failed');
      return false;
    } finally {
      this.isClipRecording = false;
      this.recordStartTime = null;
      this.recordSourcePath = null;
      this._clipRequestInFlight = false;
    }
  }

  cancelClipRecording(message) {
    if (!this.isClipRecording) return;
    this.isClipRecording = false;
    this.recordStartTime = null;
    this.recordSourcePath = null;
    this.controlsModule?.setRecordingState(false, 'Clip Cancelled');
    if (message) {
      window.HybridToast?.show(message);
    }
  }

  handleMediaSourceChange(nextPath) {
    if (this.isClipRecording && this.recordSourcePath && this.recordSourcePath !== nextPath) {
      this.cancelClipRecording('Clip recording stopped because the source changed');
    }
    if (!nextPath) return;
    this._applyPlaybackSourceState(nextPath);
  }

  resetToIdleState() {
    this._cancelVideoLoadSpinner();
    const welcome = document.getElementById('welcomeScreen');
    if (welcome) {
      welcome.classList.remove('hidden');
    }
    document.body.classList.add('welcome-active');
    document.title = 'Hybrid Player';
    const titleEl = document.getElementById('titlebarText');
    if (titleEl) titleEl.textContent = 'Hybrid Player';

    const canvas = document.getElementById('videoCanvas');
    if (canvas) {
      canvas.style.display = 'none';
      canvas.style.visibility = 'hidden';
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    const curtain = document.getElementById('video-curtain');
    if (curtain) {
      curtain.classList.remove('visible');
      curtain.style.opacity = '0';
      curtain.style.pointerEvents = 'none';
    }

    const spinner = document.getElementById('networkLoadingSpinner');
    if (spinner) {
      spinner.classList.add('hidden');
    }

    if (this.player) {
      this.player.currentFilePath = null;
      this.player.currentTime = 0;
      this.player.duration = 0;
      this.player.isPlaying = false;
      this.player.isLive = false;
      this.player.isAudioOnly = false;
      this.player.onPlayStateChanged?.(false);
      this.player.onTimeUpdate?.(0, 0);
    }

    this.currentStreamUrl = null;
    this.currentPlaybackType = 'local';
    this.youtubeQualityHeights = [];
    this.currentYoutubeInfo = null;
    this._youtubeHeightsVideoId = null;
    this._cancelScheduledYoutubeProbe();
    this._setYoutubeLiveBadge(false);
    this.currentStreamQuality = 'auto';
    this._renderControlBarQualityMenu([], 'auto');
    const ytControl = document.getElementById('youtubeQualityControl');
    if (ytControl) ytControl.hidden = true;
    const ytDropdown = document.getElementById('youtubeQualityDropdown');
    if (ytDropdown) ytDropdown.hidden = true;
    this.controlsModule?.updateToolbarVisibility?.();
  }

  setAudioOnlyMode(isAudioOnly) {
    const audioOnly = Boolean(isAudioOnly);
    document.body.classList.toggle('audio-mode', audioOnly);
    document.body.classList.toggle('audio-visualizer-mode', audioOnly);

    if (audioOnly) {
      this._cancelVideoLoadSpinner();
      const curtain = document.getElementById('video-curtain');
      if (curtain) {
        curtain.classList.remove('visible');
        curtain.style.opacity = '0';
        curtain.style.pointerEvents = 'none';
      }
      const welcome = document.getElementById('welcomeScreen');
      if (welcome && this.player?.currentFilePath) {
        welcome.classList.add('hidden');
      }
    }
  }
}

// ─── Bootstrap ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  window.HybridApp = new HybridApp();
  await window.HybridApp.init();
});
