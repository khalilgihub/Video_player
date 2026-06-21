/**
 * Hybrid Player - Playlist Module
 * Manages playlist state, UI, and playback order
 */

class HybridPlaylist {
  constructor(player) {
    this.player = player;
    this.items = [];
    this.currentIndex = -1;
    this.shuffle = false;
    this.repeat = 'none'; // 'none', 'one', 'all'
    
    this.listEl = document.getElementById('playlistItems');
    this.countEl = document.getElementById('playlistCount');
    this.searchInput = document.getElementById('playlistSearch');
    this.shuffleBtn = document.getElementById('btnShufflePlaylist');
    this.repeatBtn = document.getElementById('btnRepeatPlaylist');
    
    this._bindEvents();
    this._syncModeButtons();
  }

  _bindEvents() {
    // Add files
    document.getElementById('btnAddToPlaylist')?.addEventListener('click', async () => {
      const filePath = await window.hybridAPI.dialog.openFile();
      if (filePath) {
        this.addFiles([filePath]);
      }
    });

    // Clear playlist
    document.getElementById('btnClearPlaylist')?.addEventListener('click', () => {
      this.clear();
    });

    this.shuffleBtn?.addEventListener('click', () => this.toggleShuffle());
    this.repeatBtn?.addEventListener('click', () => this.cycleRepeat());

    // Close sidebar
    document.getElementById('btnClosePlaylist')?.addEventListener('click', () => {
      document.getElementById('sidebarPlaylist').classList.add('collapsed');
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
    
    this.items.push(...newItems);
    this._renderList();
    
    // Auto-play first if requested and nothing currently selected.
    if (autoPlay && this.currentIndex === -1 && this.items.length > 0) {
      this.playIndex(0);
    }
    
    window.HybridToast?.show(`Added ${newItems.length} file(s)`);
  }

  replaceFiles(filePaths, { autoPlay = true } = {}) {
    this.items = this._createItems(filePaths);
    this.currentIndex = -1;
    this._renderList();

    if (autoPlay && this.items.length > 0) {
      this.playIndex(0);
    }

    window.HybridToast?.show(`Loaded ${this.items.length} file(s)`);
  }

  addFile(filePath) {
    this.addFiles([filePath], { autoPlay: true });
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
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
    if (this.shuffleBtn) {
      this.shuffleBtn.classList.toggle('active', this.shuffle);
      this.shuffleBtn.setAttribute('aria-pressed', String(this.shuffle));
      this.shuffleBtn.title = this.shuffle ? 'Shuffle On' : 'Shuffle';
    }

    if (this.repeatBtn) {
      const active = this.repeat !== 'none';
      const label = this.repeat === 'one' ? 'Repeat One' : (this.repeat === 'all' ? 'Repeat All' : 'Repeat Off');
      this.repeatBtn.classList.toggle('active', active);
      this.repeatBtn.dataset.repeat = this.repeat;
      this.repeatBtn.setAttribute('aria-pressed', String(active));
      this.repeatBtn.setAttribute('aria-label', label);
      this.repeatBtn.title = label;
    }
  }

  playIndex(index) {
    if (index < 0 || index >= this.items.length) return;
    this.currentIndex = index;
    this.player.loadFile(this.items[index].path);
    this._renderList();
  }

  playNext() {
    if (this.items.length === 0) return;
    
    if (this.repeat === 'one') {
      this.player.seek(0);
      window.hybridAPI.mpv.play();
      return;
    }

    let nextIndex;
    if (this.shuffle) {
      if (this.items.length === 1) {
        nextIndex = 0;
      } else {
        do {
          nextIndex = Math.floor(Math.random() * this.items.length);
        } while (nextIndex === this.currentIndex);
      }
    } else {
      nextIndex = this.currentIndex + 1;
    }

    if (nextIndex >= this.items.length) {
      if (this.repeat === 'all') {
        nextIndex = 0;
      } else {
        return; // End of playlist
      }
    }

    this.playIndex(nextIndex);
  }

  playPrevious() {
    if (this.items.length === 0) return;
    
    // If more than 3 seconds in, restart current
    if (this.player.currentTime > 3) {
      this.player.seek(0);
      return;
    }

    let prevIndex = this.currentIndex - 1;
    if (prevIndex < 0) {
      prevIndex = this.repeat === 'all' ? this.items.length - 1 : 0;
    }
    this.playIndex(prevIndex);
  }

  remove(index) {
    if (index < 0 || index >= this.items.length) return;
    this.items.splice(index, 1);

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
      this.player.currentFilePath = null;
      this.player.currentTime = 0;
      this.player.duration = 0;
      this.player.isPlaying = false;
    }

    const welcomeScreen = document.getElementById('welcomeScreen');
    const videoTitle = document.getElementById('videoTitle');
    const currentTime = document.getElementById('currentTime');
    const totalTime = document.getElementById('totalTime');

    welcomeScreen?.classList.remove('hidden');
    if (videoTitle) videoTitle.textContent = 'No media loaded';
    if (currentTime) currentTime.textContent = '0:00';
    if (totalTime) totalTime.textContent = '0:00';
  }

  _renderList(filter = '') {
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
        this.playIndex(parseInt(el.dataset.index));
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
      this._renderList();
    }
  }
}

window.HybridPlaylist = HybridPlaylist;
