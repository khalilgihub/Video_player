/**
 * Hybrid Player - Settings Module
 * Manages the settings panel and preferences persistence
 */

// Default options for each background effect
const BG_DEFAULTS = Object.freeze({
  dither: { speed: 0.05, frequency: 3, amplitude: 0.3, color: '#808080', pixelSize: 2, colorNum: 4 },
  particles: { count: 300, speed: 0.1, spread: 10, color: '#ffffff', size: 100, alpha: false },
  faulty: { glitch: 1, scanlines: 0.7, flicker: 1, aberration: 0, curvature: 0.1, tint: '#A7EF9E', brightness: 0.8 },
  dotgrid: { dotSize: 5, gap: 10, baseColor: '#271E37', activeColor: '#5227FF', proximity: 120, shockRadius: 250 },
  colorbends: { speed: 0.2, rotation: 0, scale: 1, frequency: 1, warp: 1, color1: '#ff5c7a', color2: '#8a5cff', color3: '#00ffd1' },
});

// Map of UI input IDs → { bgKey, optKey, type, parse }
const BG_CONTROLS = [
  // Dither
  { id: 'bgDitherSpeed', bg: 'dither', opt: 'speed', type: 'range', parse: parseFloat },
  { id: 'bgDitherFrequency', bg: 'dither', opt: 'frequency', type: 'range', parse: parseFloat },
  { id: 'bgDitherAmplitude', bg: 'dither', opt: 'amplitude', type: 'range', parse: parseFloat },
  { id: 'bgDitherColor', bg: 'dither', opt: 'color', type: 'color' },
  { id: 'bgDitherPixelSize', bg: 'dither', opt: 'pixelSize', type: 'range', parse: parseInt },
  { id: 'bgDitherColorNum', bg: 'dither', opt: 'colorNum', type: 'range', parse: parseInt },
  // Particles
  { id: 'bgParticlesCount', bg: 'particles', opt: 'count', type: 'range', parse: parseInt },
  { id: 'bgParticlesSpeed', bg: 'particles', opt: 'speed', type: 'range', parse: parseFloat },
  { id: 'bgParticlesSpread', bg: 'particles', opt: 'spread', type: 'range', parse: parseInt },
  { id: 'bgParticlesColor', bg: 'particles', opt: 'color', type: 'color' },
  { id: 'bgParticlesSize', bg: 'particles', opt: 'size', type: 'range', parse: parseInt },
  { id: 'bgParticlesAlpha', bg: 'particles', opt: 'alpha', type: 'checkbox' },
  // Faulty Terminal
  { id: 'bgFaultyGlitch', bg: 'faulty', opt: 'glitch', type: 'range', parse: parseFloat },
  { id: 'bgFaultyScanlines', bg: 'faulty', opt: 'scanlines', type: 'range', parse: parseFloat },
  { id: 'bgFaultyFlicker', bg: 'faulty', opt: 'flicker', type: 'range', parse: parseFloat },
  { id: 'bgFaultyAberration', bg: 'faulty', opt: 'aberration', type: 'range', parse: parseFloat },
  { id: 'bgFaultyCurvature', bg: 'faulty', opt: 'curvature', type: 'range', parse: parseFloat },
  { id: 'bgFaultyTint', bg: 'faulty', opt: 'tint', type: 'color' },
  { id: 'bgFaultyBrightness', bg: 'faulty', opt: 'brightness', type: 'range', parse: parseFloat },
  // Dot Grid
  { id: 'bgDotgridDotSize', bg: 'dotgrid', opt: 'dotSize', type: 'range', parse: parseInt },
  { id: 'bgDotgridGap', bg: 'dotgrid', opt: 'gap', type: 'range', parse: parseInt },
  { id: 'bgDotgridBaseColor', bg: 'dotgrid', opt: 'baseColor', type: 'color' },
  { id: 'bgDotgridActiveColor', bg: 'dotgrid', opt: 'activeColor', type: 'color' },
  { id: 'bgDotgridProximity', bg: 'dotgrid', opt: 'proximity', type: 'range', parse: parseInt },
  { id: 'bgDotgridShockRadius', bg: 'dotgrid', opt: 'shockRadius', type: 'range', parse: parseInt },
  // Color Bends
  { id: 'bgColorbendsSpeed', bg: 'colorbends', opt: 'speed', type: 'range', parse: parseFloat },
  { id: 'bgColorbendsRotation', bg: 'colorbends', opt: 'rotation', type: 'range', parse: parseInt },
  { id: 'bgColorbendsScale', bg: 'colorbends', opt: 'scale', type: 'range', parse: parseFloat },
  { id: 'bgColorbendsFrequency', bg: 'colorbends', opt: 'frequency', type: 'range', parse: parseFloat },
  { id: 'bgColorbendsWarp', bg: 'colorbends', opt: 'warp', type: 'range', parse: parseFloat },
  { id: 'bgColorbendsColor1', bg: 'colorbends', opt: 'color1', type: 'color' },
  { id: 'bgColorbendsColor2', bg: 'colorbends', opt: 'color2', type: 'color' },
  { id: 'bgColorbendsColor3', bg: 'colorbends', opt: 'color3', type: 'color' },
];

class HybridSettings {
  constructor(player) {
    this.player = player;
    this.hasExplicitMotionProfile = false;
    this.prefersReducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

    // Live background options state
    this._bgOpts = {};
    for (const [key, val] of Object.entries(BG_DEFAULTS)) {
      this._bgOpts[key] = { ...val };
    }

    this._bindCloseModals();
    this._bindSettings();
    this._bindBgSettings();
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
      this._showBgSettingsGroupFor(e.target.value);
    });

  }

  _bindBgSettings() {
    // Gear button toggles the panel
    const gearBtn = document.getElementById('bgSettingsToggle');
    const panel = document.getElementById('bgSettingsPanel');
    const wrapper = document.querySelector('.welcome-bg-settings');

    if (gearBtn && panel) {
      gearBtn.addEventListener('click', () => {
        const isOpen = !panel.hidden;
        panel.hidden = isOpen;
        gearBtn.classList.toggle('active', !isOpen);
        wrapper?.classList.toggle('bg-panel-open', !isOpen);

        if (!isOpen) {
          const bgSelect = document.getElementById('welcomeBackgroundSelect');
          this._showBgSettingsGroupFor(bgSelect?.value || 'dither');
        }
      });
    }

    // Debounce timers per background
    this._bgDebounceTimers = {};

    // Bind each control
    for (const ctrl of BG_CONTROLS) {
      const el = document.getElementById(ctrl.id);
      if (!el) continue;

      // Set initial value display for range inputs
      if (ctrl.type === 'range') {
        this._updateValueSpan(el);
      }

      const eventName = ctrl.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(eventName, () => {
        let value;
        if (ctrl.type === 'checkbox') {
          value = el.checked;
        } else if (ctrl.type === 'color') {
          value = el.value;
        } else {
          value = ctrl.parse ? ctrl.parse(el.value) : el.value;
          this._updateValueSpan(el);
        }

        this._bgOpts[ctrl.bg][ctrl.opt] = value;

        // Debounce the apply for range/color inputs (recreating the effect is expensive)
        clearTimeout(this._bgDebounceTimers[ctrl.bg]);
        this._bgDebounceTimers[ctrl.bg] = setTimeout(() => {
          this._applyBgOpts(ctrl.bg, { persist: true });
        }, ctrl.type === 'checkbox' ? 0 : 250);
      });
    }
  }

  _updateValueSpan(inputEl) {
    const span = inputEl.parentElement?.querySelector('.bg-setting-value');
    if (span) span.textContent = inputEl.value;
  }

  _showBgSettingsGroupFor(bg) {
    document.querySelectorAll('.bg-settings-group').forEach(g => {
      g.classList.toggle('active', g.dataset.bg === bg);
    });
  }

  async _applyBgOpts(bg, { persist = true } = {}) {
    const opts = { ...this._bgOpts[bg] };
    const stateKey = `bgOpts_${bg}`;

    window.__hybridWelcomeEffectsState = {
      ...(window.__hybridWelcomeEffectsState || {}),
      [stateKey]: opts,
    };

    window.dispatchEvent(new CustomEvent('hybrid:welcome-settings-changed', {
      detail: { [stateKey]: opts },
    }));

    if (persist) {
      await window.hybridAPI.db.setPreference(stateKey, JSON.stringify(opts));
    }
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
      const welcomeBackground = ['none', 'dither', 'particles', 'faulty', 'dotgrid', 'colorbends'].includes(prefs.welcomeBackground)
        ? prefs.welcomeBackground
        : 'dither';
      await this._applyWelcomeBackground(welcomeBackground, { persist: false });
      if (prefs.welcomeBackground === undefined) {
        await window.hybridAPI.db.setPreference('welcomeBackground', welcomeBackground);
      }

      // Load per-background options
      for (const bgKey of Object.keys(BG_DEFAULTS)) {
        const stateKey = `bgOpts_${bgKey}`;
        const raw = prefs[stateKey];
        if (raw) {
          try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            this._bgOpts[bgKey] = { ...BG_DEFAULTS[bgKey], ...parsed };
          } catch (_) { /* use defaults */ }
        }
        // Apply to UI controls
        for (const ctrl of BG_CONTROLS) {
          if (ctrl.bg !== bgKey) continue;
          const el = document.getElementById(ctrl.id);
          if (!el) continue;
          const val = this._bgOpts[bgKey][ctrl.opt];
          if (val === undefined) continue;
          if (ctrl.type === 'checkbox') {
            el.checked = !!val;
          } else {
            el.value = val;
            if (ctrl.type === 'range') this._updateValueSpan(el);
          }
        }
        // Push opts into state
        await this._applyBgOpts(bgKey, { persist: false });
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
    const value = ['none', 'dither', 'particles', 'faulty', 'dotgrid', 'colorbends'].includes(background) ? background : 'dither';
    this._setValue('welcomeBackgroundSelect', value);
    document.body.dataset.welcomeBackground = value;
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
