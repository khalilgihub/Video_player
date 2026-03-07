/**
 * Hybrid Player - Settings Module
 * Manages the settings panel and preferences persistence
 */

class HybridSettings {
  constructor(player) {
    this.player = player;
    this.hasExplicitMotionProfile = false;
    this.prefersReducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

    this._bindCloseModals();
    this._bindSettings();
    this.loadPreferences();

    if (this.prefersReducedMotion?.addEventListener) {
      this.prefersReducedMotion.addEventListener('change', () => {
        if (this.hasExplicitMotionProfile) return;
        const fallbackProfile = this._resolveMotionProfile(null);
        this._applyMotionProfile(fallbackProfile, { persist: false });
      });
    }
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

    // Motion profile
    document.getElementById('settMotionProfile')?.addEventListener('change', async (e) => {
      this.hasExplicitMotionProfile = true;
      await this._applyMotionProfile(e.target.value, { persist: true });
    });

    // Brand fonts
    document.getElementById('settBrandFontEnabled')?.addEventListener('change', async (e) => {
      await this._applyBrandFontEnabled(e.target.checked, { persist: true });
    });

    // Welcome background (top-right selector on welcome screen)
    document.getElementById('welcomeBackgroundSelect')?.addEventListener('change', async (e) => {
      await this._applyWelcomeBackground(e.target.value, { persist: true });
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

      // Motion profile with reduced-motion fallback
      this.hasExplicitMotionProfile = prefs.motionProfile !== undefined && prefs.motionProfile !== null;
      const motionProfile = this._resolveMotionProfile(prefs.motionProfile);
      await this._applyMotionProfile(motionProfile, { persist: false });
      if (!this.hasExplicitMotionProfile) {
        await window.hybridAPI.db.setPreference('motionProfile', motionProfile);
      }

      // Brand fonts
      const brandFontEnabled = prefs.brandFontEnabled !== false;
      await this._applyBrandFontEnabled(brandFontEnabled, { persist: false });
      if (prefs.brandFontEnabled === undefined) {
        await window.hybridAPI.db.setPreference('brandFontEnabled', true);
      }

      // Welcome background effect
      const welcomeBackground = ['none', 'dither', 'particles', 'faulty', 'dotgrid'].includes(prefs.welcomeBackground)
        ? prefs.welcomeBackground
        : 'dither';
      await this._applyWelcomeBackground(welcomeBackground, { persist: false });
      if (prefs.welcomeBackground === undefined) {
        await window.hybridAPI.db.setPreference('welcomeBackground', welcomeBackground);
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

  _resolveMotionProfile(value) {
    if (value === 'reduced' || value === 'balanced' || value === 'showcase') {
      return value;
    }
    if (this.prefersReducedMotion?.matches) {
      return 'reduced';
    }
    return 'balanced';
  }

  async _applyMotionProfile(profile, { persist = true } = {}) {
    const resolved = this._resolveMotionProfile(profile);
    document.body.dataset.motionProfile = resolved;
    this._setValue('settMotionProfile', resolved);
    this._emitWelcomeSettings({
      motionProfile: resolved,
    });

    if (persist) {
      await window.hybridAPI.db.setPreference('motionProfile', resolved);
    }
  }

  async _applyBrandFontEnabled(enabled, { persist = true } = {}) {
    const value = !!enabled;
    document.body.classList.toggle('brand-font-disabled', !value);
    this._setChecked('settBrandFontEnabled', value);
    this._emitWelcomeSettings({
      brandFontEnabled: value,
    });

    if (persist) {
      await window.hybridAPI.db.setPreference('brandFontEnabled', value);
    }
  }

  async _applyWelcomeBackground(background, { persist = true } = {}) {
    const value = ['none', 'dither', 'particles', 'faulty', 'dotgrid'].includes(background) ? background : 'dither';
    this._setValue('welcomeBackgroundSelect', value);
    this._emitWelcomeSettings({
      welcomeBackground: value,
    });

    if (persist) {
      await window.hybridAPI.db.setPreference('welcomeBackground', value);
    }
  }

  _emitWelcomeSettings(detail) {
    window.__hybridWelcomeEffectsState = {
      ...(window.__hybridWelcomeEffectsState || {}),
      ...detail
    };
    window.dispatchEvent(new CustomEvent('hybrid:welcome-settings-changed', { detail }));
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
