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
      const nextSize = parseInt(fontSize.value, 10);
      if (Number.isFinite(nextSize)) {
        this.style.fontSize = Math.max(12, Math.min(96, nextSize));
      }
      fontSize.value = String(this.style.fontSize);
      if (fontSizeVal) fontSizeVal.textContent = fontSize.value + 'px';
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
      const value = parseInt(e.target.value, 10);
      this.style.bgOpacity = Number.isFinite(value) ? Math.max(0, Math.min(1, value / 100)) : this.style.bgOpacity;
      this._applyMpvStyle();
    });

    // "Off" button
    document.querySelector('[data-track="off"]')?.addEventListener('click', () => this.disable());
  }

  adjustSync(deltaMs) {
    const nextOffset = this.setSyncOffset(this.syncOffset + deltaMs);
    window.HybridToast?.show(`Subtitle sync: ${nextOffset > 0 ? '+' : ''}${nextOffset}ms`);
  }

  setSyncOffset(offsetMs, { apply = true, persist = true } = {}) {
    this.syncOffset = this._clampSyncOffset(offsetMs);
    const syncValue = document.getElementById('subSyncValue');
    if (syncValue) {
      syncValue.textContent = this.syncOffset + 'ms';
    }

    // Convert ms → seconds for mpv
    if (apply) {
      window.hybridAPI?.mpv?.setSubDelay?.(this.syncOffset / 1000);
    }

    if (persist && this.player.currentFilePath) {
      window.hybridAPI?.subtitleDelay?.save?.(this.player.currentFilePath, this.syncOffset);
    }

    return this.syncOffset;
  }

  disable() {
    window.hybridAPI.mpv.setSubVisibility(false);
    this.overlay.replaceChildren();
    this._updateTrackList(this.player.trackList);
  }

  enable() {
    window.hybridAPI.mpv.setSubVisibility(true);
  }

  /** Send subtitle appearance props to mpv */
  _applyMpvStyle() {
    window.hybridAPI.mpv.command('set_property', 'sub-font-size', this.style.fontSize);
    window.hybridAPI.mpv.command('set_property', 'sub-font', this.style.fontFamily);
    window.hybridAPI.mpv.command('set_property', 'sub-color', this._sanitizeHexColor(this.style.fontColor, '#ffffff'));
    window.hybridAPI.mpv.command('set_property', 'sub-back-color', this._colorWithAlpha(this.style.bgColor, this.style.bgOpacity));
  }

  _clampSyncOffset(offsetMs) {
    const value = Math.round(Number(offsetMs));
    if (!Number.isFinite(value)) return 0;
    return Math.max(-10 * 60 * 1000, Math.min(10 * 60 * 1000, value));
  }

  _sanitizeHexColor(value, fallback) {
    return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  }

  _colorWithAlpha(hexColor, opacity) {
    const color = this._sanitizeHexColor(hexColor, '#000000');
    const safeOpacity = Number.isFinite(Number(opacity)) ? Math.max(0, Math.min(1, Number(opacity))) : 0.6;
    const alpha = Math.round(safeOpacity * 255).toString(16).padStart(2, '0');
    return `#${alpha}${color.slice(1)}`;
  }

  /** Rebuild the subtitle track list in the UI from mpv track-list */
  _updateTrackList(trackList) {
    const container = document.getElementById('subtitleTracks');
    if (!container) return;

    const subTracks = (trackList || []).filter(t => t.type === 'sub');
    const isVisible = this.player.subVisible;

    const offButton = document.createElement('button');
    offButton.type = 'button';
    offButton.className = `subtitle-track-btn ${!isVisible ? 'active' : ''}`;
    offButton.dataset.track = 'off';
    offButton.setAttribute('aria-pressed', String(!isVisible));
    offButton.textContent = 'Off';

    const fragment = document.createDocumentFragment();
    fragment.appendChild(offButton);

    subTracks.forEach(t => {
      const label = t.title || t.lang || `Sub ${t.id}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `subtitle-track-btn ${t.selected && isVisible ? 'active' : ''}`;
      button.dataset.track = String(t.id);
      button.setAttribute('aria-pressed', String(!!(t.selected && isVisible)));
      button.textContent = `${label}${t.external ? ' (ext)' : ''}`;
      fragment.appendChild(button);
    });

    container.replaceChildren(fragment);

    // Bind
    offButton.addEventListener('click', () => this.disable());
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
