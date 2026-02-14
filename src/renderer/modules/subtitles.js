/**
 * Hybrid Player - Subtitle Module (mpv backend)
 * Subtitle rendering, track switching, and sync are all handled by mpv.
 * This module provides the UI for subtitle panel controls and delegates
 * all subtitle operations to mpv through the IPC bridge.
 */

class HybridSubtitles {
  constructor(player) {
    this.player = player;
    this.overlay = document.getElementById('subtitleOverlay');

    // mpv handles rendering natively – overlay is kept for fallback / OSD only.
    this.syncOffset = 0;  // ms (UI state mirrors mpv sub-delay)

    // Style – sent to mpv via sub-xxx options
    this.style = {
      fontSize: 28,
      fontFamily: 'Segoe UI',
      fontColor: '#ffffff',
      bgColor: '#000000',
      bgOpacity: 0.6
    };

    this._bindEvents();

    // Re-render track list whenever player reports track-list change
    this.player.onTrackListChanged = (trackList) => {
      this._updateTrackList(trackList);
    };
  }

  _bindEvents() {
    // Load external subtitle via mpv
    document.getElementById('btnLoadSubtitle')?.addEventListener('click', async () => {
      const filePath = await window.hybridAPI.dialog.openSubtitle();
      if (filePath) {
        await this.player.loadExternalSubtitle(filePath);
        // Refresh track list from mpv after a short delay
        setTimeout(() => this._updateTrackList(this.player.trackList), 500);
      }
    });

    // Sync controls → mpv sub-delay
    document.getElementById('subSyncMinus')?.addEventListener('click', () => this.adjustSync(-100));
    document.getElementById('subSyncPlus')?.addEventListener('click',  () => this.adjustSync(100));

    // Appearance controls → mpv sub-font, sub-font-size etc.
    const fontSize    = document.getElementById('subFontSize');
    const fontSizeVal = document.getElementById('subFontSizeVal');
    fontSize?.addEventListener('input', () => {
      this.style.fontSize = parseInt(fontSize.value);
      fontSizeVal.textContent = fontSize.value + 'px';
      this._applyMpvStyle();
    });

    document.getElementById('subFontColor')?.addEventListener('input', (e) => {
      this.style.fontColor = e.target.value;
      this._applyMpvStyle();
    });

    document.getElementById('subBgColor')?.addEventListener('input', (e) => {
      this.style.bgColor = e.target.value;
      this._applyMpvStyle();
    });

    document.getElementById('subBgOpacity')?.addEventListener('input', (e) => {
      this.style.bgOpacity = parseInt(e.target.value) / 100;
      this._applyMpvStyle();
    });

    // "Off" button
    document.querySelector('[data-track="off"]')?.addEventListener('click', () => this.disable());
  }

  adjustSync(deltaMs) {
    this.syncOffset += deltaMs;
    document.getElementById('subSyncValue').textContent = this.syncOffset + 'ms';

    // Convert ms → seconds for mpv
    window.hybridAPI.mpv.setSubDelay(this.syncOffset / 1000);

    if (this.player.currentFilePath) {
      window.hybridAPI.subtitleDelay.save(this.player.currentFilePath, this.syncOffset);
    }
    window.HybridToast?.show(`Subtitle sync: ${this.syncOffset > 0 ? '+' : ''}${this.syncOffset}ms`);
  }

  disable() {
    window.hybridAPI.mpv.setSubVisibility(false);
    this.overlay.innerHTML = '';
    this._updateTrackList(this.player.trackList);
  }

  enable() {
    window.hybridAPI.mpv.setSubVisibility(true);
  }

  /** Send subtitle appearance props to mpv */
  _applyMpvStyle() {
    // mpv expects hex colour as &HBBGGRR (ASS style). We send as options.
    window.hybridAPI.mpv.command('set_property', 'sub-font-size', this.style.fontSize);
    window.hybridAPI.mpv.command('set_property', 'sub-font', this.style.fontFamily);
    // sub-color is in &HAABBGGRR format; for simplicity keep hex strings
    const fc = this.style.fontColor;
    window.hybridAPI.mpv.command('set_property', 'sub-color', fc);
  }

  /** Rebuild the subtitle track list in the UI from mpv track-list */
  _updateTrackList(trackList) {
    const container = document.getElementById('subtitleTracks');
    if (!container) return;

    const subTracks = (trackList || []).filter(t => t.type === 'sub');
    const isVisible = this.player.subVisible;

    let html = `<button class="subtitle-track-btn ${!isVisible ? 'active' : ''}" data-track="off">Off</button>`;

    subTracks.forEach(t => {
      const label = t.title || t.lang || `Sub ${t.id}`;
      const active = t.selected && isVisible ? 'active' : '';
      html += `<button class="subtitle-track-btn ${active}" data-track="${t.id}">${label}${t.external ? ' (ext)' : ''}</button>`;
    });

    container.innerHTML = html;

    // Bind
    container.querySelector('[data-track="off"]')?.addEventListener('click', () => this.disable());
    container.querySelectorAll('[data-track]:not([data-track="off"])').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.track);
        window.hybridAPI.mpv.setSub(id);
        this.enable();
        this._updateTrackList(this.player.trackList);
      });
    });
  }
}

window.HybridSubtitles = HybridSubtitles;
