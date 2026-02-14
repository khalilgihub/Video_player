/**
 * Hybrid Player - Application Entry Point
 * Initializes all modules and orchestrates the player
 */

const YT_DEBUG = true;
function ytdbg(...args) {
  if (!YT_DEBUG) return;
  console.log('[YTDBG][renderer]', ...args);
}

const VIDEO_DEBUG = true;
function viddbg(...args) {
  if (!VIDEO_DEBUG) return;
  console.log('[VIDDBG][renderer]', ...args);
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
  }

  async init() {
    console.log('🎬 Hybrid Player initializing...');
    
    try {
      // Initialize core player
      this.player = new HybridPlayer();
      
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
      
      // Load saved EQ
      await this.equalizerModule.loadSavedSettings();
      
      // Load recent files for welcome screen
      await this._loadRecentFiles();
      
      // Start sidebar as collapsed
      document.getElementById('sidebarPlaylist').classList.add('collapsed');
      
      // Stats update interval
      this._statsInterval = setInterval(() => {
        const stats = document.getElementById('statsOverlay');
        if (!stats.hidden) {
          this.controlsModule.updateStats();
        }
      }, 1000);

      // Listen for window state changes
      window.hybridAPI.window.onStateChanged((state) => {
        document.body.classList.add('fs-transition');
        if (this._fsTransitionTimer) clearTimeout(this._fsTransitionTimer);
        this._fsTransitionTimer = setTimeout(() => {
          document.body.classList.remove('fs-transition');
          this._fsTransitionTimer = null;
        }, 280);

        if (state === 'fullscreen') {
          document.body.classList.add('is-fullscreen');
        } else {
          document.body.classList.remove('is-fullscreen');
        }

        const fsEnter = document.querySelector('.icon-fullscreen-enter');
        const fsExit = document.querySelector('.icon-fullscreen-exit');
        if (state === 'fullscreen') {
          fsEnter.style.display = 'none';
          fsExit.style.display = 'block';
        } else {
          fsEnter.style.display = 'block';
          fsExit.style.display = 'none';
        }
      });

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

      window.hybridAPI.mpv.onEvent((event) => {
        viddbg('mpv:event', { event, pending: this._loadSpinnerPending });

        if (event === 'seek') {
          this._setNetworkLoading(true);
          return;
        }

        if (event === 'playback-restart') {
          this._completeVideoLoadSpinner();
          return;
        }

        if (event === 'file-loaded') {
          this._setVideoCurtain(false);
          this._setNetworkLoading(false);
          return;
        }

        if (event === 'end-file' || event === 'error') {
          this._loadSpinnerPending = false;
          this._setNetworkLoading(false);
          this._setVideoCurtain(false);
        }
      });

      window.hybridAPI.mpv.onPropertyChange((name, value) => {
        if (name === 'time-pos' && Number(value) > 0) {
          this._setVideoCurtain(false);
        }

        if (name === 'paused-for-cache') {
          this._setNetworkLoading(!!value);
          return;
        }

        if (name === 'seeking') {
          this._setNetworkLoading(!!value);
        }
      });

      console.log('✅ Hybrid Player ready!');
    } catch (err) {
      console.error('Failed to initialize:', err);
    }
  }

  async _loadRecentFiles() {
    try {
      const recent = await window.hybridAPI.history.getRecent(5);
      const container = document.getElementById('recentFiles');
      if (!container || !recent || recent.length === 0) return;
      
      container.innerHTML = '<h4>Recently Played</h4>';
      recent.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'recent-item';
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          <span>${item.name}</span>
        `;
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

  async openFiles(filePaths) {
    if (!filePaths || filePaths.length === 0) return;
    
    // Add all to playlist
    this.playlistModule.addFiles(filePaths);
    
    // If not already playing, play first file
    if (this.playlistModule.currentIndex === -1 || this.playlistModule.items.length === filePaths.length) {
      this.playlistModule.playIndex(0);
    }
  }

  async promptOpenFile() {
    const filePath = await window.hybridAPI.dialog.openFile();
    if (filePath) {
      this.openFiles([filePath]);
    }
  }

  async promptOpenFolder() {
    const paths = await window.hybridAPI.dialog.openFolder();
    if (Array.isArray(paths) && paths.length > 0) {
      this.openFiles(paths);
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
          await this._loadMediaReplaceAppend(payload);
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
    await window.hybridAPI.mpv.command('loadfile', filePathOrUrl, 'replace');
    this._syncUiAfterDirectLoad(filePathOrUrl);
  }

  async _loadMediaReplaceAppend(paths) {
    this._closeSettingsModal();
    this._beginVideoLoadSpinner();
    const clean = paths.filter((p) => typeof p === 'string' && p.trim());
    if (clean.length === 0) return;

    await window.hybridAPI.mpv.command('loadfile', clean[0], 'replace');
    for (let i = 1; i < clean.length; i++) {
      await window.hybridAPI.mpv.command('loadfile', clean[i], 'append');
    }

    this._syncUiAfterDirectLoad(clean[0]);
    window.HybridToast?.show(`Loaded ${clean.length} item(s)`);
  }

  _syncUiAfterDirectLoad(filePathOrUrl) {
    this.player.currentFilePath = filePathOrUrl;
    this.player.welcomeScreen?.classList.add('hidden');

    const isUrl = /^https?:\/\//i.test(filePathOrUrl) || /^rtsp:\/\//i.test(filePathOrUrl);
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
    const cs = window.getComputedStyle(curtain);
    viddbg('curtain', {
      visible,
      className: curtain.className,
      opacity: cs.opacity,
      display: cs.display,
      zIndex: cs.zIndex,
    });
  }

  _beginVideoLoadSpinner() {
    if (this._loadSpinnerFailSafeTimer) {
      clearTimeout(this._loadSpinnerFailSafeTimer);
      this._loadSpinnerFailSafeTimer = null;
    }

    this._loadSpinnerPending = true;
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
    const value = typeof url === 'string' ? url.trim() : '';
    return /(?:youtube\.com|youtu\.be)/i.test(value);
  }

  _mapQualityLabel(height) {
    if (height === 4320) return '8K';
    if (height === 2160) return '4K';
    if (height === 1440) return '1440p (HD)';
    return `${height}p`;
  }

  _renderNetworkQualityMenu(heights, selected = 'auto') {
    return;
  }

  _renderControlBarQualityMenu(heights, selected = 'auto') {
    const wrap = document.getElementById('youtubeQualityControl');
    const btn = document.getElementById('btnYoutubeQuality');
    const list = document.getElementById('youtubeQualityList');
    const dropdown = document.getElementById('youtubeQualityDropdown');
    if (!wrap || !btn || !list || !dropdown) return;

    list.innerHTML = '';
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
      const secureApi = window.api || null;
      const heights = secureApi
        ? await secureApi.getYoutubeQualities(key)
        : await window.hybridAPI.youtube.getQualityHeights(key);

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
      const url = input.value.trim();
      if (!url) return;

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

    const secureApi = window.api || null;

    openFileBtn?.addEventListener('click', async () => {
      const filePath = secureApi
        ? await secureApi.openFile()
        : await window.hybridAPI.dialog.openFile();

      if (filePath) {
        await this._loadMediaReplace(filePath);
      }
    });

    openMultipleBtn?.addEventListener('click', async () => {
      const paths = secureApi
        ? await secureApi.openMultipleFiles()
        : await window.hybridAPI.dialog.openMultiple();

      if (Array.isArray(paths) && paths.length > 0) {
        await this._loadMediaReplaceAppend(paths);
      }
    });

    openFolderBtn?.addEventListener('click', async () => {
      const paths = secureApi
        ? await secureApi.openFolder()
        : await window.hybridAPI.dialog.openFolder();

      if (Array.isArray(paths) && paths.length > 0) {
        await this._loadMediaReplaceAppend(paths);
      } else {
        window.HybridToast?.show('No media files found in folder');
      }
    });

    openStreamBtn?.addEventListener('click', () => {
      this._showNetworkStreamModal();
    });

    quitBtn?.addEventListener('click', async () => {
      if (secureApi) {
        await secureApi.quitPlayer();
      } else {
        await window.hybridAPI.window.close();
      }
    });
  }
}

// ─── Bootstrap ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  window.HybridApp = new HybridApp();
  await window.HybridApp.init();
});
