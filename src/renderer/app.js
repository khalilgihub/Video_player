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
    this.youtubeQualityCache = new Map();
    this.youtubeQualityInFlight = new Map();
    this.youtubeQualityLookupTimer = null;
    this._loadSpinnerPending = false;
    this._loadSpinnerShownAt = 0;
    this._loadSpinnerFailSafeTimer = null;
    
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
      this.equalizerModule = new HybridEqualizer(this.player);
      this.settingsModule = new HybridSettings(this.player);
      this.shortcutModule = new HybridShortcuts(this.player, this.controlsModule);
      this.thumbnailModule = new HybridThumbnails(this.player);
      this.gestureModule = new HybridGestures(this.player, this.controlsModule);
      this.player.onError = (data) => this._handlePlaybackError(data);
      
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
        document.body.classList.toggle('is-fullscreen', isFs);
        document.body.classList.toggle('is-maximized', isMax);

        const btnMaximize = document.getElementById('btnMaximize');
        if (btnMaximize) {
          if (isMax) {
            btnMaximize.title = 'Restore';
            btnMaximize.setAttribute('aria-label', 'Restore window');
            btnMaximize.innerHTML = `
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M3.5 1.5h7v7" fill="none" stroke="currentColor" stroke-width="1.2" />
                <rect x="1.5" y="3.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" />
              </svg>
            `;
          } else {
            btnMaximize.title = 'Maximize';
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
        }, 440);
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

      window.hybridAPI.on('window-is-maximized', (flag) => {
        const nextMax = !!flag;
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

        applyWindowVisualClasses();
        logDwmRendererSnapshot('ipc-window-state-changed', { state });

        // Only run fullscreen transition animation for real fullscreen toggles.
        if (wasFullscreen !== nowFullscreen) {
          applyFsTransition();
          this.controlsModule?.revealChromeAfterWindowStateChange?.();
        }
      });

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
          this.setLocked(false);
        }
      });

      window.hybridAPI.mpv.onEvent((event) => {
        viddbg('mpv:event', { event, pending: this._loadSpinnerPending });

        if (event === 'seek') {
          this._setNetworkLoading(true);
          return;
        }

        if (event === 'playback-restart') {
          this._completeVideoLoadSpinner();
          this._debugRendererPlayback('event:playback-restart');
          this._forcePlaybackSurfaceVisible('playback-restart');
          return;
        }

        if (event === 'file-loaded') {
          this._setVideoCurtain(false);
          this._setNetworkLoading(false);
          this._debugRendererPlayback('event:file-loaded');
          this._forcePlaybackSurfaceVisible('file-loaded');
          return;
        }

        if (event === 'end-file' || event === 'error') {
          this._loadSpinnerPending = false;
          this._setNetworkLoading(false);
          this._setVideoCurtain(false);
          this._isMpvPaused = false;
          this._stopPausedFrameHeartbeat();
          this._hidePausedFrameOverlay(`event:${event}`);
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
          this._setNetworkLoading(!!value);
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
          this.openFiles([item.path]);
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
    const payload = data && typeof data === 'object' ? data : {};
    const message = typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : String(data || 'Playback error');
    const prefix = payload.fatal ? 'Playback engine unavailable' : 'Playback error';
    window.HybridToast?.show(`${prefix}: ${message}`);
  }

  async openFiles(filePaths, { replacePlaylist = false, playFirst = false } = {}) {
    const clean = Array.from(new Set((filePaths || []).filter((filePath) => typeof filePath === 'string' && filePath.trim())));
    if (clean.length === 0) return;

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

  async _loadMediaReplace(filePathOrUrl) {
    this._closeSettingsModal();
    this._beginVideoLoadSpinner();
    await window.hybridAPI.mpv.setProperty('vid', 'auto');
    await window.hybridAPI.mpv.command('loadfile', filePathOrUrl, 'replace');
    this._syncUiAfterDirectLoad(filePathOrUrl);
  }

  async _loadMediaReplaceAppend(paths) {
    this._closeSettingsModal();
    this._beginVideoLoadSpinner();
    const clean = paths.filter((p) => typeof p === 'string' && p.trim());
    if (clean.length === 0) return;

    await window.hybridAPI.mpv.setProperty('vid', 'auto');
    await window.hybridAPI.mpv.command('loadfile', clean[0], 'replace');
    for (let i = 1; i < clean.length; i++) {
      await window.hybridAPI.mpv.command('loadfile', clean[i], 'append');
    }

    this._syncUiAfterDirectLoad(clean[0]);
    window.HybridToast?.show(`Loaded ${clean.length} item(s)`);
  }

  _syncUiAfterDirectLoad(filePathOrUrl) {
    this._isMpvPaused = false;
    this._stopPausedFrameHeartbeat();
    this._hidePausedFrameOverlay('sync-ui-after-load');
    if (this.isClipRecording && this.recordSourcePath && this.recordSourcePath !== filePathOrUrl) {
      this.cancelClipRecording('Clip recording stopped because the source changed');
    }

    this.player.currentFilePath = filePathOrUrl;
    this.player.welcomeScreen?.classList.add('hidden');

    const isUrl = this._isNetworkMediaUrl(filePathOrUrl);
    this.currentStreamUrl = isUrl ? filePathOrUrl : null;
    this.currentPlaybackType = this._isYoutubeUrl(filePathOrUrl) ? 'youtube' : 'local';

    if (this.currentPlaybackType === 'youtube') {
      this._refreshYoutubeQualityUi(filePathOrUrl).catch(() => {
        this._renderControlBarQualityMenu([], 'auto');
      });
    } else {
      this.youtubeQualityHeights = [];
      this.currentStreamQuality = 'auto';
      this._renderControlBarQualityMenu([], 'auto');
    }

    const titleText = isUrl
      ? 'Network Stream — Hybrid Player'
      : `${filePathOrUrl.split(/[/\\]/).pop()} — Hybrid Player`;
    const titleEl = document.getElementById('titlebarText');
    if (titleEl) titleEl.textContent = titleText;
  }

  _setNetworkLoading(visible) {
    const spinner = document.getElementById('networkLoadingSpinner');
    if (!spinner) return;
    spinner.classList.toggle('hidden', !visible);
    viddbg('spinner', { visible, className: spinner.className });
  }

  _setVideoCurtain(visible) {
    const curtain = document.getElementById('video-curtain');
    if (!curtain) return;
    curtain.classList.toggle('visible', !!visible);
    if (visible) {
      this._hidePausedFrameOverlay('curtain-visible');
    }
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
    if (welcome) {
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
    if (this._pausedFrameHeartbeatTimer) return;
    this._pausedFrameHeartbeatTimer = setInterval(() => {
      if (!this._isMpvPaused) return;
      if (document.visibilityState !== 'visible') return;
      this._schedulePausedFrameCapture('paused-heartbeat', { delayMs: 0, force: false });
    }, 4500);
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
      const payload = await window.hybridAPI.mpv.capturePausedFrame?.('video');
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

    this._loadSpinnerPending = true;
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

    if (!this._loadSpinnerPending) {
      this._setNetworkLoading(false);
      this._setVideoCurtain(false);
      return;
    }

    const elapsed = Date.now() - this._loadSpinnerShownAt;
    const minVisibleMs = 180;
    const delay = Math.max(0, minVisibleMs - elapsed);

    setTimeout(() => {
      this._loadSpinnerPending = false;
      this._setNetworkLoading(false);
      this._setVideoCurtain(false);
    }, delay);
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
      if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;

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
    if (height === 4320) return '8K';
    if (height === 2160) return '4K';
    if (height === 1440) return '1440p (HD)';
    return `${height}p`;
  }

  _renderControlBarQualityMenu(heights, selected = 'auto') {
    const wrap = document.getElementById('youtubeQualityControl');
    const btn = document.getElementById('btnYoutubeQuality');
    const list = document.getElementById('youtubeQualityList');
    const dropdown = document.getElementById('youtubeQualityDropdown');
    if (!wrap || !btn || !list || !dropdown) return;

    list.replaceChildren();
    const options = ['auto', ...heights];

    options.forEach((item) => {
      const value = item === 'auto' ? 'auto' : String(item);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quality-dropdown-item';
      button.dataset.quality = value;
      button.textContent = item === 'auto' ? 'Auto' : this._mapQualityLabel(Number(item));
      if (String(selected) === value) {
        button.classList.add('active');
      }
      list.appendChild(button);
    });

    const selectedText = selected === 'auto' ? 'Auto' : this._mapQualityLabel(Number(selected));
    btn.textContent = selectedText;

    if (this.currentPlaybackType === 'youtube') {
      wrap.hidden = false;
    } else {
      wrap.hidden = true;
      dropdown.hidden = true;
    }
  }

  async _fetchYoutubeQualityHeights(url) {
    const key = String(url || '').trim();
    if (!key) return [];

    if (this.youtubeQualityCache.has(key)) {
      const cached = this.youtubeQualityCache.get(key) || [];
      ytdbg('fetch qualities cache hit', { url: key, count: cached.length });
      return cached;
    }

    if (this.youtubeQualityInFlight.has(key)) {
      ytdbg('fetch qualities join in-flight request', { url: key });
      return this.youtubeQualityInFlight.get(key);
    }

    const request = (async () => {
    try {
      ytdbg('fetch qualities start', { url: key });
      const heights = await window.hybridAPI.youtube.getQualityHeights(key);

      if (!Array.isArray(heights)) return [];

      const clean = heights
        .map((height) => Number(height))
        .filter((height) => Number.isFinite(height) && height > 0)
        .map((height) => Math.round(height));

      const result = Array.from(new Set(clean)).sort((a, b) => b - a);
      ytdbg('fetch qualities success', { count: result.length, heights: result });
      this.youtubeQualityCache.set(key, result);
      return result;
    } catch {
      ytdbg('fetch qualities error');
      return [];
    } finally {
      this.youtubeQualityInFlight.delete(key);
    }
    })();

    this.youtubeQualityInFlight.set(key, request);
    return request;
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
    const heights = await this._fetchYoutubeQualityHeights(url);
    this.youtubeQualityHeights = heights;
    ytdbg('refresh quality UI', { url, heightsCount: heights.length, heights });
    const selected = heights.includes(Number(this.currentStreamQuality))
      ? this.currentStreamQuality
      : 'auto';
    this._renderControlBarQualityMenu(heights, selected);
  }

  _buildYtdlFormat(selectedHeight) {
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
    await this._loadMediaReplace(targetUrl);

    if (playbackTime > 1) {
      await new Promise((resolve) => setTimeout(resolve, 450));
      await window.hybridAPI.mpv.command('seek', playbackTime, 'absolute+exact');
      ytdbg('seek restored', { playbackTime });
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
      dropdown.hidden = !dropdown.hidden;
    });

    list.addEventListener('click', async (e) => {
      const target = e.target.closest('.quality-dropdown-item');
      if (!target) return;
      const selected = target.dataset.quality === 'auto' ? 'auto' : Number(target.dataset.quality);
        try {
          await this._applyYoutubeQualityAndReload(selected, this.currentStreamUrl);
          window.HybridToast?.show(selected === 'auto' ? 'Quality: Auto' : `Quality: ${this._mapQualityLabel(selected)}`);
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

      this._closeSettingsModal();
      this._beginVideoLoadSpinner();

      ytdbg('network stream submit', { url, isYoutube: this._isYoutubeUrl(url) });

      if (this._isYoutubeUrl(url)) {
        await this._refreshYoutubeQualityUi(url);
        const selected = this.currentStreamUrl === url ? this.currentStreamQuality : 'auto';
        try {
          await this._applyYoutubeQualityAndReload(selected, url);
        } catch {
          ytdbg('quality apply failed; fallback to auto', { url });
          await window.hybridAPI.mpv.setProperty('ytdl-format', this._buildYtdlFormat('auto'));
          await this._loadMediaReplace(url);
          window.HybridToast?.show('Opened stream with Auto quality');
        }
      } else {
        ytdbg('non-youtube stream load with auto format', { url });
        await window.hybridAPI.mpv.setProperty('ytdl-format', this._buildYtdlFormat('auto'));
        await this._loadMediaReplace(url);
      }

      modal.hidden = true;
      input.value = '';
      window.HybridToast?.show('Opened network stream');
    });

    cancelBtn.addEventListener('click', () => {
      modal.hidden = true;
    });
  }

  _showNetworkStreamModal() {
    const modal = document.getElementById('networkStreamModal');
    const input = document.getElementById('networkStreamInput');
    if (!modal || !input) return;

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
      this._showNetworkStreamModal();
    });

    quitBtn?.addEventListener('click', async () => {
      await window.hybridAPI.window.close();
    });
  }

  async setLocked(locked) {
    const nextState = !!locked;
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
      this.cursorManager?.show();
    } else {
      this.cursorManager?.resume();
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
      this.controlsModule?.setRecordingState(false, 'Stop Recording');
      window.HybridToast?.show('Stop Recording');

      if (duration <= 0.2) {
        throw new Error('Clip duration is too short');
      }

      const result = await window.hybridAPI.media.clipSegment({
        filePath: sourcePath,
        startTime: this.recordStartTime,
        duration,
      });

      const outputName = result?.outputPath ? result.outputPath.split(/[/\\]/).pop() : 'clip';
      window.HybridToast?.show(`Clip saved: ${outputName}`);
      return true;
    } catch (error) {
      this.controlsModule?.setRecordingState(false, 'Stop Recording');
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
    this.controlsModule?.setRecordingState(false, 'Stop Recording');
    if (message) {
      window.HybridToast?.show(message);
    }
  }

  handleMediaSourceChange(nextPath) {
    if (this.isClipRecording && this.recordSourcePath && this.recordSourcePath !== nextPath) {
      this.cancelClipRecording('Clip recording stopped because the source changed');
    }
  }
}

// ─── Bootstrap ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  window.HybridApp = new HybridApp();
  await window.HybridApp.init();
});
