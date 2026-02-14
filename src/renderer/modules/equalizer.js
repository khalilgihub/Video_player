/**
 * Hybrid Player - Audio Equalizer Module (mpv backend)
 * 10-band equalizer using mpv's lavfi/superequalizer audio filter.
 * The Web Audio API pipeline is no longer used since mpv handles audio.
 */

class HybridEqualizer {
  constructor(player) {
    this.player = player;

    // Current band gain values (dB)
    this.bands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    this.frequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

    this.presets = {
      'flat':         [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      'bass-boost':   [8, 6, 5, 3, 1, 0, 0, 0, 0, 0],
      'treble-boost': [0, 0, 0, 0, 0, 1, 3, 5, 6, 8],
      'vocal':        [-2, -1, 0, 3, 6, 6, 3, 0, -1, -2],
      'rock':         [5, 4, 2, 0, -1, -1, 0, 2, 4, 5],
      'pop':          [-1, 2, 4, 5, 3, 0, -1, -1, 2, 3],
      'jazz':         [4, 3, 1, 2, -1, -1, 0, 1, 3, 4],
      'classical':    [5, 4, 3, 2, -1, -1, 0, 2, 3, 5],
      'electronic':   [6, 5, 2, 0, -2, 0, 1, 3, 5, 6]
    };

    this.bandLabels = ['31Hz', '62Hz', '125Hz', '250Hz', '500Hz', '1K', '2K', '4K', '8K', '16K'];
    this._applyDebounceMs = 100;
    this._applyTimer = null;

    this._renderBands();
    this._bindEvents();
  }

  _renderBands() {
    const container = document.getElementById('equalizerBands');
    if (!container) return;

    container.innerHTML = this.bandLabels.map((label, i) => `
      <div class="eq-band">
        <span class="eq-band-value" id="eqVal${i}">0 dB</span>
        <div class="eq-slider-wrap">
          <input type="range" class="eq-slider" data-band="${i}"
                 min="-12" max="12" step="0.5" value="0"
                 aria-label="${label} equalizer band">
        </div>
        <span class="eq-band-label">${label}</span>
      </div>
    `).join('');
  }

  _bindEvents() {
    document.getElementById('equalizerBands')?.addEventListener('input', (e) => {
      if (e.target.classList.contains('eq-slider')) {
        const band = parseInt(e.target.dataset.band);
        const value = parseFloat(e.target.value);
        this.setBand(band, value, { immediate: false, persist: true });
        this._updateBandLabel(band, value);
        document.getElementById('eqPresetSelect').value = 'custom';
        window.hybridAPI.db.setPreference('equalizerPreset', 'custom');
      }
    });

    document.getElementById('equalizerBands')?.addEventListener('change', (e) => {
      if (e.target.classList.contains('eq-slider')) {
        const band = parseInt(e.target.dataset.band);
        const value = parseFloat(e.target.value);
        this.setBand(band, value, { immediate: true, persist: true });
      }
    });

    document.getElementById('eqPresetSelect')?.addEventListener('change', (e) => {
      const preset = e.target.value;
      if (this.presets[preset]) {
        this.applyPreset(preset);
      }
    });

    document.getElementById('eqReset')?.addEventListener('click', () => {
      this.applyPreset('flat', { immediate: true, savePreset: true });
      document.getElementById('eqPresetSelect').value = 'flat';
    });
  }

  setBand(index, gainDb, { immediate = false, persist = true } = {}) {
    if (index >= 0 && index < this.bands.length) {
      const normalized = Math.max(-12, Math.min(12, Number(gainDb) || 0));
      this.bands[index] = normalized;
      this._scheduleApply({ immediate, persist });
    }
  }

  getBand(index) {
    return this.bands[index] || 0;
  }

  applyPreset(presetName, { immediate = true, savePreset = true } = {}) {
    const values = this.presets[presetName];
    if (!values) return;

    this.bands = [...values];
    this._updateSliders(values);
    this._scheduleApply({ immediate, persist: true });

    if (savePreset) {
      window.hybridAPI.db.setPreference('equalizerPreset', presetName);
    }
    window.hybridAPI.db.setPreference('equalizerBands', [...values]);
  }

  _scheduleApply({ immediate = false, persist = true } = {}) {
    clearTimeout(this._applyTimer);

    if (immediate) {
      this._applyToMpv();
      if (persist) this._persistBands();
      return;
    }

    this._applyTimer = setTimeout(() => {
      this._applyToMpv();
      if (persist) this._persistBands();
      this._applyTimer = null;
    }, this._applyDebounceMs);
  }

  _persistBands() {
    window.hybridAPI.db.setPreference('equalizerBands', [...this.bands]);
  }

  /**
   * Build an mpv `af` (audio filter) string and push to mpv.
   * Uses the `equalizer` lavfi filter which takes 10 band gains.
   * The gains are in dB (-12 to +12).
   */
  _applyToMpv() {
    const allZero = this.bands.every(b => b === 0);
    if (allZero) {
      // Remove the filter entirely
      window.hybridAPI.mpv.setProperty('af', '').catch((err) => {
        console.error('[eq] failed to clear filter:', err?.message || err);
      });
      return;
    }

    // lavfi equalizer expects: 10 band-gains separated by colons
    // mpv's `superequalizer` filter:  af=lavfi=[superequalizer=<gains>]
    const gains = this.bands.map(g => g.toFixed(1)).join(':');
    const filterStr = `lavfi=[superequalizer=${gains}]`;
    window.hybridAPI.mpv.setProperty('af', filterStr).catch((err) => {
      console.error('[eq] failed to apply filter:', { filterStr, error: err?.message || err });
    });
  }

  _updateSliders(values) {
    const sliders = document.querySelectorAll('.eq-slider');
    sliders.forEach((slider, i) => {
      slider.value = values[i] || 0;
      this._updateBandLabel(i, values[i] || 0);
    });
  }

  _updateBandLabel(index, value) {
    const valEl = document.getElementById(`eqVal${index}`);
    if (!valEl) return;
    const v = Number(value) || 0;
    valEl.textContent = `${v > 0 ? '+' : ''}${v} dB`;
  }

  async loadSavedSettings() {
    try {
      const bands = await window.hybridAPI.db.getPreference('equalizerBands');
      const preset = await window.hybridAPI.db.getPreference('equalizerPreset');

      if (bands && Array.isArray(bands)) {
        this.bands = [...bands];
        this._updateSliders(bands);
        this._scheduleApply({ immediate: true, persist: false });
      }

      if (preset) {
        const select = document.getElementById('eqPresetSelect');
        if (select) select.value = preset;
      }
    } catch (e) {
      console.error('Failed to load EQ settings:', e);
    }
  }

  getCurrentValues() {
    return [...this.bands];
  }
}

window.HybridEqualizer = HybridEqualizer;
