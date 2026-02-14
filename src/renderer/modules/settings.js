/**
 * Hybrid Player - Settings Module
 * Manages the settings panel and preferences persistence
 */

class HybridSettings {
  constructor(player) {
    this.player = player;
    this._bindTabs();
    this._bindCloseModals();
    this._bindSettings();
    this.loadPreferences();
  }

  _bindTabs() {
    document.querySelectorAll('.settings-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        // Update tabs
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        // Update panes
        document.querySelectorAll('.settings-pane').forEach(p => p.classList.remove('active'));
        document.querySelector(`[data-pane="${target}"]`)?.classList.add('active');
      });
    });
  }

  _bindCloseModals() {
    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.hidden = true;
        }
      });
    });

    // Close buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.closeModal;
        const modal = document.getElementById(modalId);
        if (modal) modal.hidden = true;
      });
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay').forEach(m => {
          if (!m.hidden) {
            m.hidden = true;
            e.stopPropagation();
          }
        });
      }
    });
  }

  _bindSettings() {
    // Theme
    document.getElementById('settTheme')?.addEventListener('change', async (e) => {
      document.body.dataset.theme = e.target.value;
      await window.hybridAPI.db.setPreference('theme', e.target.value);
    });

    // Accent Color
    document.getElementById('settAccentColor')?.addEventListener('input', async (e) => {
      document.body.style.setProperty('--accent', e.target.value);
      document.body.style.setProperty('--accent-hover', this._lighten(e.target.value, 15));
      document.body.style.setProperty('--accent-dim', `${e.target.value}4D`);
      await window.hybridAPI.db.setPreference('accentColor', e.target.value);
    });

    // Auto Resume
    document.getElementById('settAutoResume')?.addEventListener('change', async (e) => {
      await window.hybridAPI.db.setPreference('autoResume', e.target.checked);
    });

    // Default Speed
    document.getElementById('settDefaultSpeed')?.addEventListener('change', async (e) => {
      await window.hybridAPI.db.setPreference('defaultSpeed', parseFloat(e.target.value));
    });

    // HW Acceleration
    document.getElementById('settHwAccel')?.addEventListener('change', async (e) => {
      await window.hybridAPI.db.setPreference('hwAccel', e.target.checked);
    });

    // Subtitle font
    document.getElementById('settSubFont')?.addEventListener('change', async (e) => {
      await window.hybridAPI.db.setPreference('subtitleFont', e.target.value);
    });

    // Subtitle size
    const settSubSize = document.getElementById('settSubSize');
    const settSubSizeVal = document.getElementById('settSubSizeVal');
    settSubSize?.addEventListener('input', async () => {
      settSubSizeVal.textContent = settSubSize.value + 'px';
      await window.hybridAPI.db.setPreference('subtitleSize', parseInt(settSubSize.value));
    });

    // Subtitle color
    document.getElementById('settSubColor')?.addEventListener('input', async (e) => {
      await window.hybridAPI.db.setPreference('subtitleColor', e.target.value);
    });

    // Volume normalization
    document.getElementById('settVolNorm')?.addEventListener('change', async (e) => {
      await window.hybridAPI.db.setPreference('volumeNormalization', e.target.checked);
    });

    // Cache size
    document.getElementById('settCacheSize')?.addEventListener('change', async (e) => {
      await window.hybridAPI.db.setPreference('cacheSize', parseInt(e.target.value));
    });

    // Debug logs
    document.getElementById('settDebugLogs')?.addEventListener('change', async (e) => {
      await window.hybridAPI.db.setPreference('debugLogs', e.target.checked);
    });
  }

  async loadPreferences() {
    try {
      const prefs = await window.hybridAPI.db.getAllPreferences();
      if (!prefs) return;

      // Apply theme
      if (prefs.theme) {
        document.body.dataset.theme = prefs.theme;
        const themeSelect = document.getElementById('settTheme');
        if (themeSelect) themeSelect.value = prefs.theme;
      }

      // Apply accent color
      if (prefs.accentColor) {
        document.body.style.setProperty('--accent', prefs.accentColor);
        document.body.style.setProperty('--accent-hover', this._lighten(prefs.accentColor, 15));
        document.body.style.setProperty('--accent-dim', `${prefs.accentColor}4D`);
        const colorInput = document.getElementById('settAccentColor');
        if (colorInput) colorInput.value = prefs.accentColor;
      }

      // Apply other settings to UI
      this._setChecked('settAutoResume', prefs.autoResume);
      this._setChecked('settHwAccel', prefs.hwAccel);
      this._setChecked('settVolNorm', prefs.volumeNormalization);
      this._setChecked('settDebugLogs', prefs.debugLogs);
      this._setValue('settDefaultSpeed', prefs.defaultSpeed);
      this._setValue('settSubFont', prefs.subtitleFont);
      this._setValue('settSubSize', prefs.subtitleSize);
      this._setValue('settSubColor', prefs.subtitleColor);
      this._setValue('settCacheSize', prefs.cacheSize);

      if (prefs.subtitleSize) {
        const sizeVal = document.getElementById('settSubSizeVal');
        if (sizeVal) sizeVal.textContent = prefs.subtitleSize + 'px';
      }

      // Apply volume
      if (prefs.volume !== undefined) {
        const volSlider = document.getElementById('volumeSlider');
        if (volSlider) {
          volSlider.value = Math.round(prefs.volume * 100);
          volSlider.dispatchEvent(new Event('input'));
        }
      }
    } catch (e) {
      console.error('Failed to load preferences:', e);
    }
  }

  _setChecked(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined) el.checked = !!value;
  }

  _setValue(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined) el.value = value;
  }

  _lighten(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, ((num >> 8) & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return `#${(1 << 24 | R << 16 | G << 8 | B).toString(16).slice(1)}`;
  }
}

window.HybridSettings = HybridSettings;
