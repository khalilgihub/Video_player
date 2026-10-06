/**
 * Hybrid Player - Playlist State Machine Module
 * 
 * Features:
 * 1. Queue Management:
 *    - Add files (appends to queue without disrupting active playback).
 *    - Replace files (clears queue and starts playback of first item).
 *    - Remove item / Clear playlist.
 * 2. Playback Sequencing:
 *    - Sequential: Next/Previous tracks.
 *    - Shuffle Mode: Tracks played indices via Set to prevent repetition until all items have played.
 *    - Repeat Modes:
 *      * 'none': Stops at end of playlist.
 *      * 'one': Loops current track indefinitely.
 *      * 'all': Wraps around from last track back to first.
 * 3. Search & Filtering:
 *    - Real-time playlist item filter by filename.
 */

class HybridPlaylist {
  constructor(player) {
    this.player = player;
    this.items = [];
    this.currentIndex = -1;
    this._playRequestId = 0;
    this.shuffle = false;
    this._playedShuffleIndices = new Set();
    this.repeat = 'none'; // 'none', 'one', 'all'
    
    this.listEl = document.getElementById('playlistItems');
    this.countEl = document.getElementById('playlistCount');
    this.searchInput = document.getElementById('playlistSearch');
    this.shuffleBtn = document.getElementById('btnShufflePlaylist');
    this.repeatBtn = document.getElementById('btnRepeatPlaylist');
    this.mainShuffleBtn = document.getElementById('btnShuffle');
    this.mainRepeatBtn = document.getElementById('btnRepeat');
    
    this._bindEvents();
    this._syncModeButtons();
  }

  _bindEvents() {
    // Add files
    document.getElementById('btnAddToPlaylist')?.addEventListener('click', async () => {
      const paths = await window.hybridAPI.dialog.openMultiple();
      if (Array.isArray(paths) && paths.length > 0) {
        this.addFiles(paths);
      }
    });

    // Clear playlist
    document.getElementById('btnClearPlaylist')?.addEventListener('click', () => {
      this.clear();
    });

    this.shuffleBtn?.addEventListener('click', () => this.toggleShuffle());
    this.repeatBtn?.addEventListener('click', () => this.cycleRepeat());
    this.mainShuffleBtn?.addEventListener('click', () => this.toggleShuffle());
    this.mainRepeatBtn?.addEventListener('click', () => this.cycleRepeat());

    // Close sidebar — route through controls.togglePlaylist() so the
    // `playlist-open` body class stays applied until the sidebar's close
    // animation finishes (prevents the controls from snapping back early).
    document.getElementById('btnClosePlaylist')?.addEventListener('click', () => {
      window.HybridApp?.controlsModule?.togglePlaylist();
    });

    // Search
    this.searchInput?.addEventListener('input', () => {
      this._renderList(this.searchInput.value);
    });
  }

  _createItems(filePaths) {
    return filePaths.map(fp => ({
      path: fp,
      name: fp.split(/[/\\]/).pop(),
      duration: null
    }));
  }

  addFiles(filePaths, { autoPlay = true } = {}) {
    const newItems = this._createItems(filePaths);
    this._playedShuffleIndices.clear();
    
    this.items.push(...newItems);
    this._renderList();
    
    // Auto-play first if requested and nothing currently selected.
    if (autoPlay && this.currentIndex === -1 && this.items.length > 0) {
      this.playIndex(0, { allowResume: this.items.length === 1 });
    }
    
    window.HybridToast?.show(`Added ${newItems.length} file(s)`);
  }

  replaceFiles(filePaths, { autoPlay = true } = {}) {
    this.items = this._createItems(filePaths);
    this.currentIndex = -1;
    this._playedShuffleIndices.clear();
    this._renderList();

    if (autoPlay && this.items.length > 0) {
      this.playIndex(0, { allowResume: this.items.length === 1 });
    }

    window.HybridToast?.show(`Loaded ${this.items.length} file(s)`);
  }

  addFile(filePath) {
    this.addFiles([filePath], { autoPlay: true });
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    this._playedShuffleIndices.clear();
    this._syncModeButtons();
    window.HybridToast?.show(this.shuffle ? 'Shuffle on' : 'Shuffle off');
    return this.shuffle;
  }

  cycleRepeat() {
    const next = this.repeat === 'none' ? 'all' : (this.repeat === 'all' ? 'one' : 'none');
    this.repeat = next;
    this._syncModeButtons();
    const label = next === 'all' ? 'Repeat all' : (next === 'one' ? 'Repeat one' : 'Repeat off');
    window.HybridToast?.show(label);
    return this.repeat;
  }

  _syncModeButtons() {
    const shuffleButtons = [
      this.shuffleBtn,
      this.mainShuffleBtn,
      document.getElementById('btnShuffle'),
    ].filter(Boolean);

    shuffleButtons.forEach(btn => {
      btn.classList.toggle('active', this.shuffle);
      btn.setAttribute('aria-pressed', String(this.shuffle));
      btn.title = this.shuffle ? 'Shuffle On' : 'Shuffle Off';
    });

    const active = this.repeat !== 'none';
    const label = this.repeat === 'one' ? 'Repeat One (L)' : (this.repeat === 'all' ? 'Repeat All (L)' : 'Repeat Off (L)');

    const repeatButtons = [
      this.repeatBtn,
      this.mainRepeatBtn,
      document.getElementById('btnRepeat'),
    ].filter(Boolean);

    repeatButtons.forEach(btn => {
      btn.classList.toggle('active', active);
      btn.dataset.repeat = this.repeat;
      btn.setAttribute('aria-pressed', String(active));
      btn.setAttribute('aria-label', label);
      btn.title = label;
      const onePath = btn.querySelector('.repeat-one-path');
      const infPath = btn.querySelector('.repeat-infinity-path');
      if (onePath && infPath) {
        if (this.repeat === 'one') {
          onePath.style.display = 'inline';
          infPath.style.display = 'none';
        } else {
          onePath.style.display = 'none';
          infPath.style.display = 'inline';
        }
      }
    });

    // Send mpv loop commands
    try {
      if (this.repeat === 'one') {
        window.hybridAPI?.mpv?.command?.('set_property', 'loop-file', 'inf');
        window.hybridAPI?.mpv?.command?.('set_property', 'loop-playlist', 'no');
      } else if (this.repeat === 'all') {
        window.hybridAPI?.mpv?.command?.('set_property', 'loop-file', 'no');
        window.hybridAPI?.mpv?.command?.('set_property', 'loop-playlist', 'inf');
      } else {
        window.hybridAPI?.mpv?.command?.('set_property', 'loop-file', 'no');
        window.hybridAPI?.mpv?.command?.('set_property', 'loop-playlist', 'no');
      }
    } catch (_) {}
  }

  async playIndex(index, { allowResume = (this.items.length === 1) } = {}) {
    if (index < 0 || index >= this.items.length) return;
    const filter = this.searchInput?.value || '';
    const requestId = ++this._playRequestId;
    this.currentIndex = index;
    this._playedShuffleIndices.add(index);
    this._renderList(filter);
    const loaded = await this.player.loadFile(this.items[index].path, { allowResume });
    if (!loaded && requestId === this._playRequestId) {
      this.currentIndex = -1;
      this._renderList(filter);
    }
    return loaded;
  }

  handleTrackEnded() {
    if (this.items.length === 0) return;
    if (this.repeat === 'one') {
      this.player.seek(0);
      window.hybridAPI.mpv.play();
      return;
    }
    this.playNext({ isAutoAdvance: true });
  }

  playNext({ isAutoAdvance = false } = {}) {
    if (this.items.length === 0) return;

    // If currentIndex is unset or out of sync with current playback, match from active file
    if (this.currentIndex === -1 && this.player.currentFilePath) {
      const matchIndex = this.items.findIndex(item => item.path === this.player.currentFilePath);
      if (matchIndex >= 0) {
        this.currentIndex = matchIndex;
      }
    }
    
    if (isAutoAdvance && this.repeat === 'one') {
      this.player.seek(0);
      window.hybridAPI.mpv.play();
      return;
    }

    let nextIndex;
    if (this.shuffle) {
      if (this.currentIndex >= 0) {
        this._playedShuffleIndices.add(this.currentIndex);
      }

      if (this._playedShuffleIndices.size >= this.items.length) {
        if (this.repeat === 'all') {
          this._playedShuffleIndices.clear();
        } else {
          this._playedShuffleIndices.clear();
          return; // End of playlist
        }
      }

      if (this.items.length === 1) {
        nextIndex = 0;
      } else {
        const unplayed = this.items
          .map((_, i) => i)
          .filter(i => !this._playedShuffleIndices.has(i));

        if (unplayed.length === 0) {
          if (this.repeat === 'all') {
            this._playedShuffleIndices.clear();
            nextIndex = Math.floor(Math.random() * this.items.length);
          } else {
            return; // End of playlist
          }
        } else {
          nextIndex = unplayed[Math.floor(Math.random() * unplayed.length)];
        }
      }
    } else {
      nextIndex = this.currentIndex + 1;
      if (nextIndex >= this.items.length) {
        if (this.repeat === 'all') {
          nextIndex = 0;
        } else {
          return; // End of playlist
        }
      }
    }

    this.playIndex(nextIndex, { allowResume: false });
  }

  playPrevious() {
    if (this.items.length === 0) return;

    // If currentIndex is unset or out of sync with current playback, match from active file
    if (this.currentIndex === -1 && this.player.currentFilePath) {
      const matchIndex = this.items.findIndex(item => item.path === this.player.currentFilePath);
      if (matchIndex >= 0) {
        this.currentIndex = matchIndex;
      }
    }
    
    // If more than 3 seconds in, restart current
    if (this.player.currentTime > 3) {
      this.player.seek(0);
      return;
    }

    let prevIndex = this.currentIndex - 1;
    if (prevIndex < 0) {
      if (this.repeat === 'all') {
        prevIndex = this.items.length - 1;
      } else {
        this.player.seek(0);
        return;
      }
    }
    this.playIndex(prevIndex, { allowResume: false });
  }

  next() {
    return this.playNext();
  }

  prev() {
    return this.playPrevious();
  }

  remove(index) {
    if (index < 0 || index >= this.items.length) return;
    this.items.splice(index, 1);
    this._playedShuffleIndices.clear();

    if (index < this.currentIndex) {
      this.currentIndex--;
      this._renderList(this.searchInput?.value || '');
      return;
    } else if (index === this.currentIndex) {
      this.currentIndex = -1;
      if (this.items.length > 0) {
        this.playIndex(Math.min(index, this.items.length - 1));
      } else {
        this._stopPlaylistPlayback();
        this._renderList(this.searchInput?.value || '');
      }
      return;
    }

    this._renderList(this.searchInput?.value || '');
  }

  clear() {
    this.items = [];
    this.currentIndex = -1;
    this._playedShuffleIndices.clear();
    this._stopPlaylistPlayback();
    this._renderList(this.searchInput?.value || '');
  }

  _stopPlaylistPlayback() {
    if (this.player?.stop) {
      this.player.stop();
    } else {
      window.hybridAPI?.mpv?.stop?.();
    }

    if (this.player) {
      this.player.clearABLoop?.({ notify: false });
      this.player.currentFilePath = null;
      this.player.currentTime = 0;
      this.player.duration = 0;
      this.player.isPlaying = false;
      this.player.onPlayStateChanged?.(false);
    }

    const welcomeScreen = document.getElementById('welcomeScreen');
    const titlebarText = document.getElementById('titlebarText');
    const currentTime = document.getElementById('currentTime');
    const totalTime = document.getElementById('totalTime');
    const progressFill = document.getElementById('progressFill');
    const progressBuffer = document.getElementById('progressBuffer');

    welcomeScreen?.classList.remove('hidden');
    if (titlebarText) titlebarText.textContent = 'No media loaded';
    document.title = 'Hybrid Player';
    if (currentTime) currentTime.textContent = '0:00';
    if (totalTime) totalTime.textContent = '0:00';
    if (progressFill) progressFill.style.width = '0%';
    if (progressBuffer) progressBuffer.style.width = '0%';

    window.HybridApp?.controlsModule?.updateToolbarVisibility?.();
  }

  _renderList(filter = (this.searchInput?.value || '')) {
    const lowerFilter = filter.trim().toLowerCase();
    
    if (this.items.length === 0) {
      this.listEl.replaceChildren(this._createEmptyState());
      this.countEl.textContent = '0 items';
      return;
    }

    const fragment = document.createDocumentFragment();
    let visibleCount = 0;
    this.items.forEach((item, i) => {
      if (lowerFilter && !item.name.toLowerCase().includes(lowerFilter)) return;
      visibleCount++;
      fragment.appendChild(this._createPlaylistItem(item, i));
    });

    if (visibleCount === 0) {
      this.listEl.replaceChildren(this._createEmptyState('No matches', 'Try a different search'));
    } else {
      this.listEl.replaceChildren(fragment);
    }

    const totalLabel = `${this.items.length} item${this.items.length !== 1 ? 's' : ''}`;
    this.countEl.textContent = lowerFilter ? `${visibleCount} of ${totalLabel}` : totalLabel;

    // Bind clicks
    this.listEl.querySelectorAll('.playlist-item').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.playlist-item-remove')) return;
        this.playIndex(parseInt(el.dataset.index), { allowResume: false });
      });
    });

    this.listEl.querySelectorAll('.playlist-item-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        this.remove(parseInt(btn.dataset.remove));
      });
    });

    // Scroll active into view
    const activeEl = this.listEl.querySelector('.playlist-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  _createEmptyState(titleText = 'Playlist is empty', hintText = 'Drop files or click + to add') {
    const wrapper = document.createElement('div');
    wrapper.className = 'playlist-empty';

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', '40');
    icon.setAttribute('height', '40');
    icon.setAttribute('fill', 'currentColor');
    icon.setAttribute('aria-hidden', 'true');

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z');
    icon.appendChild(pathEl);

    const title = document.createElement('p');
    title.textContent = titleText;

    const hint = document.createElement('p');
    hint.className = 'playlist-empty-hint';
    hint.textContent = hintText;

    wrapper.append(icon, title, hint);
    return wrapper;
  }

  _createPlaylistItem(item, index) {
    const el = document.createElement('div');
    el.className = `playlist-item${index === this.currentIndex ? ' active' : ''}`;
    el.dataset.index = String(index);

    const idx = document.createElement('span');
    idx.className = 'playlist-item-index';
    idx.textContent = index === this.currentIndex ? '▶' : String(index + 1);

    const info = document.createElement('div');
    info.className = 'playlist-item-info';

    const name = document.createElement('div');
    name.className = 'playlist-item-name';
    name.title = item.name;
    name.textContent = item.name;
    info.appendChild(name);

    const remove = document.createElement('button');
    remove.className = 'playlist-item-remove';
    remove.dataset.remove = String(index);
    remove.type = 'button';
    remove.title = 'Remove';
    remove.setAttribute('aria-label', `Remove ${item.name}`);
    remove.textContent = '✕';

    el.append(idx, info, remove);
    return el;
  }

  async save(name) {
    const playlist = {
      id: Date.now().toString(36),
      name: name,
      items: this.items.map(i => ({ path: i.path, name: i.name })),
      created: Date.now()
    };
    await window.hybridAPI.playlist.save(playlist);
    return playlist;
  }

  async loadSaved(id) {
    const playlists = await window.hybridAPI.playlist.getAll();
    const playlist = playlists.find(p => p.id === id);
    if (playlist) {
      this.items = playlist.items.map(i => ({ ...i, duration: null }));
      this.currentIndex = -1;
      this._playedShuffleIndices.clear();
      this._renderList();
    }
  }
}

window.HybridPlaylist = HybridPlaylist;
