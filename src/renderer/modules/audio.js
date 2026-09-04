/**
 * Hybrid Player - Audio & Voice Module
 * Manages audio track switching, anime Subs/Dubs presets, and audio sync delay.
 */

class HybridAudio {
  constructor(player) {
    this.player = player;
    this.syncOffset = 0; // ms

    this._bindEvents();

    // Re-render audio tracks whenever track-list updates
    if (typeof this.player.addTrackListListener === 'function') {
      this.player.addTrackListListener((trackList) => {
        this._updateTrackList(trackList);
      });
    } else {
      this.player.onTrackListChanged = (trackList) => {
        this._updateTrackList(trackList);
      };
    }
  }

  _bindEvents() {
    // Quick Anime Preset buttons
    document.getElementById('btnQuickSubs')?.addEventListener('click', () => {
      this.player.toggleSubsDubs();
      this._updateTrackList(this.player.trackList);
    });

    document.getElementById('btnQuickDubs')?.addEventListener('click', () => {
      this.player.toggleSubsDubs();
      this._updateTrackList(this.player.trackList);
    });

    // Audio Sync controls
    document.getElementById('audioSyncMinus')?.addEventListener('click', () => this.adjustSync(-100));
    document.getElementById('audioSyncPlus')?.addEventListener('click', () => this.adjustSync(100));
    document.getElementById('audioSyncReset')?.addEventListener('click', () => this.setSyncOffset(0));
  }

  adjustSync(deltaMs) {
    const nextOffset = this.setSyncOffset(this.syncOffset + deltaMs);
    window.HybridToast?.show(`Audio sync: ${nextOffset > 0 ? '+' : ''}${nextOffset}ms`);
  }

  setSyncOffset(offsetMs, { apply = true } = {}) {
    this.syncOffset = this._clampSyncOffset(offsetMs);
    const syncValue = document.getElementById('audioSyncValue');
    if (syncValue) {
      syncValue.textContent = `${this.syncOffset > 0 ? '+' : ''}${this.syncOffset}ms`;
    }

    if (apply && window.hybridAPI?.mpv?.setAudioDelay) {
      window.hybridAPI.mpv.setAudioDelay(this.syncOffset / 1000);
    }

    return this.syncOffset;
  }

  _clampSyncOffset(offsetMs) {
    const value = Math.round(Number(offsetMs));
    if (!Number.isFinite(value)) return 0;
    return Math.max(-10 * 60 * 1000, Math.min(10 * 60 * 1000, value));
  }

  /** Rebuild the audio track list in the UI from mpv track-list */
  _updateTrackList(trackList) {
    const container = document.getElementById('audioTracks');
    if (!container) return;

    const audioTracks = (trackList || []).filter(t => t.type === 'audio');
    const currentAudio = audioTracks.find(t => t.selected) || audioTracks[0];

    // Update Anime Preset Active States
    const isEng = currentAudio && this.player._isEnglishTrack(currentAudio);
    const isJap = currentAudio && this.player._isJapaneseTrack(currentAudio);

    const btnSubs = document.getElementById('btnQuickSubs');
    const btnDubs = document.getElementById('btnQuickDubs');
    if (btnSubs) {
      btnSubs.classList.toggle('active', !!isJap);
      btnSubs.setAttribute('aria-pressed', String(!!isJap));
    }
    if (btnDubs) {
      btnDubs.classList.toggle('active', !!isEng);
      btnDubs.setAttribute('aria-pressed', String(!!isEng));
    }

    // Build Audio Track Pills
    const fragment = document.createDocumentFragment();

    if (audioTracks.length === 0) {
      const emptySpan = document.createElement('span');
      emptySpan.className = 'empty-track-msg';
      emptySpan.textContent = 'No audio tracks found';
      fragment.appendChild(emptySpan);
    } else {
      audioTracks.forEach((t, index) => {
        const langName = this.player.formatLanguageName(t.lang);
        let label = '';
        if (t.title) {
          const lowerTitle = t.title.toLowerCase();
          const lowerLang = (langName || '').toLowerCase();
          if (langName && !lowerTitle.includes(lowerLang)) {
            label = `${langName} • ${t.title}`;
          } else {
            label = t.title;
          }
        } else if (langName) {
          label = langName;
        } else {
          label = `Track ${index + 1}`;
        }

        if (t.codec && !label.toLowerCase().includes(t.codec.toLowerCase())) {
          label += ` (${t.codec.toUpperCase()})`;
        }

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `subtitle-track-btn ${t.selected ? 'active' : ''}`;
        button.dataset.track = String(t.id);
        button.setAttribute('aria-pressed', String(!!t.selected));
        button.textContent = label;
        fragment.appendChild(button);
      });
    }

    container.replaceChildren(fragment);

    // Bind click events on track buttons
    container.querySelectorAll('[data-track]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.track, 10);
        this.player.setAudioTrack(id);
        audioTracks.forEach(t => { t.selected = (t.id === id); });
        this._updateTrackList(this.player.trackList);
      });
    });
  }
}

window.HybridAudio = HybridAudio;
