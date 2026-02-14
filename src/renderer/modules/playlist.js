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
    
    this._bindEvents();
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

    // Close sidebar
    document.getElementById('btnClosePlaylist')?.addEventListener('click', () => {
      document.getElementById('sidebarPlaylist').classList.add('collapsed');
    });

    // Search
    this.searchInput?.addEventListener('input', () => {
      this._renderList(this.searchInput.value);
    });
  }

  addFiles(filePaths) {
    const newItems = filePaths.map(fp => ({
      path: fp,
      name: fp.split(/[/\\]/).pop(),
      duration: null
    }));
    
    this.items.push(...newItems);
    this._renderList();
    
    // Auto-play first if nothing playing
    if (this.currentIndex === -1 && this.items.length > 0) {
      this.playIndex(0);
    }
    
    window.HybridToast?.show(`Added ${newItems.length} file(s)`);
  }

  addFile(filePath) {
    this.addFiles([filePath]);
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
      nextIndex = Math.floor(Math.random() * this.items.length);
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
    } else if (index === this.currentIndex) {
      this.currentIndex = -1;
    }
    
    this._renderList();
  }

  clear() {
    this.items = [];
    this.currentIndex = -1;
    this._renderList();
  }

  _renderList(filter = '') {
    const lowerFilter = filter.toLowerCase();
    
    if (this.items.length === 0) {
      this.listEl.innerHTML = `
        <div class="playlist-empty">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
            <path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>
          </svg>
          <p>Playlist is empty</p>
          <p style="font-size:11px;margin-top:4px">Drop files or click + to add</p>
        </div>`;
      this.countEl.textContent = '0 items';
      return;
    }

    const html = this.items
      .map((item, i) => {
        if (lowerFilter && !item.name.toLowerCase().includes(lowerFilter)) return '';
        const active = i === this.currentIndex ? 'active' : '';
        return `
          <div class="playlist-item ${active}" data-index="${i}">
            <span class="playlist-item-index">${i === this.currentIndex ? '▶' : i + 1}</span>
            <div class="playlist-item-info">
              <div class="playlist-item-name" title="${item.name}">${item.name}</div>
            </div>
            <button class="playlist-item-remove" data-remove="${i}" title="Remove">✕</button>
          </div>`;
      })
      .join('');

    this.listEl.innerHTML = html;
    this.countEl.textContent = `${this.items.length} item${this.items.length !== 1 ? 's' : ''}`;

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
