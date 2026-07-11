/**
 * Hybrid Player - Settings Module
 * Manages the settings panel and preferences persistence
 */

// Default options for each background effect
const BG_DEFAULTS = Object.freeze({
  dither: { speed: 0.05, frequency: 3, amplitude: 0.3, color: '#808080', bgColor: '#000000', pixelSize: 1, colorNum: 4 },
  particles: { count: 300, speed: 0.1, spread: 10, color: '#ffffff', size: 100, alpha: false },
  faulty: { glitch: 1, scanlines: 0.7, flicker: 1, aberration: 0, curvature: 0.1, tint: '#A7EF9E', brightness: 0.8 },
  dotgrid: { dotSize: 2, gap: 14, baseColor: '#5227FF', activeColor: '#5227FF', proximity: 150, shockRadius: 250, bgColor: '#000000' },
  pixelblast: { pixelSize: 6, density: 1.0, scale: 2.0, color: '#B497CF', shapeType: 'diamond' },
  gridmotion: { gradientColor: '#000000', speed: 1.0, maxMove: 300, customPictures: [] },
});

// Preset options for each quality level
const BG_QUALITY_PRESETS = Object.freeze({
  low: {
    dither: { speed: 0.05, frequency: 2.55, amplitude: 0.26, color: '#808080', bgColor: '#000000', pixelSize: 4, colorNum: 4 },
    particles: { count: 135, speed: 0.09, spread: 9, color: '#ffffff', size: 85, alpha: false },
    faulty: { glitch: 0.65, scanlines: 0.46, flicker: 0.65, aberration: 0, curvature: 0.08, tint: '#A7EF9E', brightness: 0.8 },
    dotgrid: { dotSize: 4, gap: 30, baseColor: '#5227FF', activeColor: '#5227FF', proximity: 98, shockRadius: 175, bgColor: '#000000' },
    pixelblast: { pixelSize: 10, density: 0.7, scale: 1.5, color: '#B497CF', shapeType: 'diamond' },
    gridmotion: { gradientColor: '#000000', speed: 0.5, maxMove: 150, customPictures: [] },
  },
  medium: {
    dither: { speed: 0.05, frequency: 2.85, amplitude: 0.29, color: '#808080', bgColor: '#000000', pixelSize: 3, colorNum: 4 },
    particles: { count: 210, speed: 0.1, spread: 10, color: '#ffffff', size: 95, alpha: false },
    faulty: { glitch: 0.85, scanlines: 0.6, flicker: 0.85, aberration: 0, curvature: 0.09, tint: '#A7EF9E', brightness: 0.8 },
    dotgrid: { dotSize: 2, gap: 20, baseColor: '#5227FF', activeColor: '#5227FF', proximity: 123, shockRadius: 213, bgColor: '#000000' },
    pixelblast: { pixelSize: 6, density: 1.0, scale: 2.0, color: '#B497CF', shapeType: 'diamond' },
    gridmotion: { gradientColor: '#000000', speed: 1.0, maxMove: 300, customPictures: [] },
  },
  high: {
    dither: { speed: 0.05, frequency: 3, amplitude: 0.3, color: '#808080', bgColor: '#000000', pixelSize: 1, colorNum: 4 },
    particles: { count: 300, speed: 0.1, spread: 10, color: '#ffffff', size: 100, alpha: false },
    faulty: { glitch: 1, scanlines: 0.7, flicker: 1, aberration: 0, curvature: 0.1, tint: '#A7EF9E', brightness: 0.8 },
    dotgrid: { dotSize: 2, gap: 14, baseColor: '#5227FF', activeColor: '#5227FF', proximity: 150, shockRadius: 250, bgColor: '#000000' },
    pixelblast: { pixelSize: 3, density: 1.3, scale: 2.5, color: '#B497CF', shapeType: 'diamond' },
    gridmotion: { gradientColor: '#000000', speed: 1.5, maxMove: 450, customPictures: [] },
  },
});

// Map of UI input IDs → { bgKey, optKey, type, parse }
const BG_CONTROLS = [
  // Dither
  { id: 'bgDitherSpeed', bg: 'dither', opt: 'speed', type: 'range', parse: parseFloat },
  { id: 'bgDitherFrequency', bg: 'dither', opt: 'frequency', type: 'range', parse: parseFloat },
  { id: 'bgDitherAmplitude', bg: 'dither', opt: 'amplitude', type: 'range', parse: parseFloat },
  { id: 'bgDitherColor', bg: 'dither', opt: 'color', type: 'color' },
  { id: 'bgDitherBgColor', bg: 'dither', opt: 'bgColor', type: 'color' },
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
  { id: 'bgDotgridBgColor', bg: 'dotgrid', opt: 'bgColor', type: 'color' },
  { id: 'bgDotgridProximity', bg: 'dotgrid', opt: 'proximity', type: 'range', parse: parseInt },
  { id: 'bgDotgridShockRadius', bg: 'dotgrid', opt: 'shockRadius', type: 'range', parse: parseInt },
  // Pixel Blast
  { id: 'bgPixelblastPixelSize', bg: 'pixelblast', opt: 'pixelSize', type: 'range', parse: parseInt },
  { id: 'bgPixelblastDensity', bg: 'pixelblast', opt: 'density', type: 'range', parse: parseFloat },
  { id: 'bgPixelblastScale', bg: 'pixelblast', opt: 'scale', type: 'range', parse: parseFloat },
  { id: 'bgPixelblastColor', bg: 'pixelblast', opt: 'color', type: 'color' },
  { id: 'bgPixelblastShapeType', bg: 'pixelblast', opt: 'shapeType', type: 'select' },
  // Grid Motion
  { id: 'bgGridmotionSpeed', bg: 'gridmotion', opt: 'speed', type: 'range', parse: parseFloat },
  { id: 'bgGridmotionMaxMove', bg: 'gridmotion', opt: 'maxMove', type: 'range', parse: parseInt },
  { id: 'bgGridmotionGradientColor', bg: 'gridmotion', opt: 'gradientColor', type: 'color' },
];

const WELCOME_QUALITY_LEVELS = Object.freeze(['low', 'medium', 'high', 'custom']);
const WELCOME_QUALITY_DEFAULT = 'medium';
const WELCOME_BACKGROUNDS = Object.freeze(['none', 'dither', 'particles', 'faulty', 'dotgrid', 'pixelblast', 'gridmotion']);

// Display labels for the background meta strip. Tag = short name, desc = one-liner.
const BG_LABELS = Object.freeze({
  dither: { tag: 'Dither', desc: 'Animated bayer dither' },
  particles: { tag: 'Particles', desc: 'Drifting particle field' },
  faulty: { tag: 'Faulty Terminal', desc: 'CRT glitch & scanlines' },
  dotgrid: { tag: 'Dot Grid', desc: 'Reactive dot lattice' },
  pixelblast: { tag: 'Pixel Blast', desc: 'Interactive diamond pixel blast' },
  gridmotion: { tag: 'Grid Motion', desc: 'Interactive gliding item lattice' },
  none: { tag: 'Default', desc: 'Pure black backdrop' },
});

function resizeGridmotionImage(file, maxDim = 400) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve('');
      img.src = e.target.result;
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

class HybridSettings {
  constructor(player) {
    this.player = player;
    this.hasExplicitMotionProfile = false;
    this.welcomeQuality = WELCOME_QUALITY_DEFAULT;
    this.prefersReducedMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    this.activeModal = null;
    this.previousFocus = null;

    // Dynamically load pixelBlast module
    import('./pixelBlast.js').catch((err) => {
      console.error('[Settings] Failed to import pixelBlast.js:', err);
    });

    // Dynamically load gridMotion module
    import('./gridMotion.js').catch((err) => {
      console.error('[Settings] Failed to import gridMotion.js:', err);
    });

    // Dynamically inject Pixel Blast option in welcome background selector
    const bgSelect = document.getElementById('welcomeBackgroundSelect');
    if (bgSelect && !Array.from(bgSelect.options).some(o => o.value === 'pixelblast')) {
      const opt = document.createElement('option');
      opt.value = 'pixelblast';
      opt.textContent = 'Pixel Blast';
      const noneOpt = Array.from(bgSelect.options).find(o => o.value === 'none');
      if (noneOpt) {
        bgSelect.insertBefore(opt, noneOpt);
      } else {
        bgSelect.appendChild(opt);
      }
    }

    // Dynamically inject Grid Motion option in welcome background selector
    if (bgSelect && !Array.from(bgSelect.options).some(o => o.value === 'gridmotion')) {
      const opt = document.createElement('option');
      opt.value = 'gridmotion';
      opt.textContent = 'Grid Motion';
      const noneOpt = Array.from(bgSelect.options).find(o => o.value === 'none');
      if (noneOpt) {
        bgSelect.insertBefore(opt, noneOpt);
      } else {
        bgSelect.appendChild(opt);
      }
    }

    // Dynamically inject Pixel Blast settings UI panel inside settings body
    const settingsBody = document.querySelector('.bg-settings-body');
    if (settingsBody && !settingsBody.querySelector('[data-bg="pixelblast"]')) {
      const group = document.createElement('div');
      group.className = 'bg-settings-group';
      group.dataset.bg = 'pixelblast';
      group.innerHTML = `
        <div class="bg-group-head">
          <span class="bg-group-tag">Pixel Blast</span>
          <button type="button" class="bg-reset" data-reset-bg="pixelblast">Reset</button>
        </div>
        <section class="bg-subsection">
          <h5>Density</h5>
          <div class="bg-setting-row">
            <label for="bgPixelblastPixelSize">Pixel Size</label>
            <input type="range" id="bgPixelblastPixelSize" min="1" max="16" step="1" value="6">
            <span class="bg-setting-value">6</span>
          </div>
          <div class="bg-setting-row">
            <label for="bgPixelblastDensity">Density</label>
            <input type="range" id="bgPixelblastDensity" min="0.1" max="2.0" step="0.05" value="1.0">
            <span class="bg-setting-value">1.0</span>
          </div>
          <div class="bg-setting-row">
            <label for="bgPixelblastScale">Scale</label>
            <input type="range" id="bgPixelblastScale" min="0.5" max="5.0" step="0.1" value="2.0">
            <span class="bg-setting-value">2.0</span>
          </div>
        </section>
        <section class="bg-subsection">
          <h5>Render</h5>
          <div class="bg-setting-row">
            <label for="bgPixelblastShapeType" class="bg-row-label">Shape</label>
            <select id="bgPixelblastShapeType" class="bg-setting-select" aria-label="Shape type">
              <option value="square">Square</option>
              <option value="circle">Circle</option>
              <option value="triangle">Triangle</option>
              <option value="diamond" selected>Diamond</option>
            </select>
          </div>
          <div class="bg-setting-row">
            <label for="bgPixelblastColor">Color</label>
            <div class="bg-color-control">
              <input type="color" id="bgPixelblastColor" value="#B497CF" class="bg-color-input">
              <span class="bg-color-hex" data-for="bgPixelblastColor">#B497CF</span>
            </div>
          </div>
        </section>
      `;
      const noneGroup = settingsBody.querySelector('.bg-settings-group[data-bg="none"]');
      if (noneGroup) {
        settingsBody.insertBefore(group, noneGroup);
      } else {
        settingsBody.appendChild(group);
      }
    }

    // Dynamically inject Grid Motion settings UI panel inside settings body
    if (settingsBody && !settingsBody.querySelector('[data-bg="gridmotion"]')) {
      const group = document.createElement('div');
      group.className = 'bg-settings-group';
      group.dataset.bg = 'gridmotion';
      group.innerHTML = `
        <div class="bg-group-head">
          <span class="bg-group-tag">Grid Motion</span>
          <button type="button" class="bg-reset" data-reset-bg="gridmotion">Reset</button>
        </div>
        <section class="bg-subsection">
          <h5>Motion</h5>
          <div class="bg-setting-row">
            <label for="bgGridmotionSpeed">Speed</label>
            <input type="range" id="bgGridmotionSpeed" min="0.1" max="3.0" step="0.1" value="1.0">
            <span class="bg-setting-value">1.0</span>
          </div>
          <div class="bg-setting-row">
            <label for="bgGridmotionMaxMove">Max Distance</label>
            <input type="range" id="bgGridmotionMaxMove" min="50" max="600" step="10" value="300">
            <span class="bg-setting-value">300</span>
          </div>
        </section>
        <section class="bg-subsection">
          <h5>Render</h5>
          <div class="bg-setting-row">
            <label for="bgGridmotionGradientColor">Background Color</label>
            <div class="bg-color-control">
              <input type="color" id="bgGridmotionGradientColor" value="#000000" class="bg-color-input">
              <span class="bg-color-hex" data-for="bgGridmotionGradientColor">#000000</span>
            </div>
          </div>
          <div class="bg-setting-row">
            <label>Grid Pictures</label>
            <div class="bg-image-uploader-control">
              <input type="file" id="bgGridmotionFileInput" accept="image/*" multiple style="display: none;">
              <button type="button" id="bgGridmotionSelectBtn" class="bg-settings-btn">Add Images...</button>
              <button type="button" id="bgGridmotionClearBtn" class="bg-settings-btn bg-danger-btn" style="display: none;">Clear All</button>
            </div>
          </div>
          <div id="bgGridmotionThumbnails" class="bg-thumbnails-grid"></div>
        </section>
      `;
      const noneGroup = settingsBody.querySelector('.bg-settings-group[data-bg="none"]');
      if (noneGroup) {
        settingsBody.insertBefore(group, noneGroup);
      } else {
        settingsBody.appendChild(group);
      }
    }

    const existingStyle = document.getElementById('gridmotionSettingsStyle');
    if (existingStyle) {
      existingStyle.remove();
    }

    const style = document.createElement('style');
    style.id = 'gridmotionSettingsStyle';
    style.textContent = `
        .bg-image-uploader-control {
          display: flex;
          align-items: center;
          gap: 8px;
          flex: 1;
          justify-content: flex-end;
        }
        .bg-settings-btn {
          background: var(--accent-dim, rgba(255, 255, 255, 0.1));
          border: 1px solid var(--accent, rgba(255, 255, 255, 0.2));
          color: #fff;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
          font-family: inherit;
          transition: background-color 0.2s, border-color 0.2s;
        }
        .bg-settings-btn:hover {
          background: var(--accent, rgba(255, 255, 255, 0.2));
          border-color: var(--accent-hover, #fff);
        }
        .bg-settings-btn.bg-danger-btn {
          background: rgba(220, 53, 69, 0.15);
          border: 1px solid rgba(220, 53, 69, 0.35);
        }
        .bg-settings-btn.bg-danger-btn:hover {
          background: rgba(220, 53, 69, 0.3);
          border-color: #ff5f6d;
        }
        .bg-thumbnails-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 6px;
          width: 100%;
          max-height: 120px;
          overflow-y: auto;
          padding-right: 4px;
          margin-top: 4px;
          margin-bottom: 8px;
        }
        .bg-thumbnail-item {
          position: relative;
          aspect-ratio: 1;
          border-radius: 4px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: #222;
        }
        .bg-thumbnail-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .bg-thumbnail-remove {
          position: absolute;
          top: 2px;
          right: 2px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: rgba(220, 53, 69, 0.85);
          color: #fff;
          border: none;
          font-size: 10px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          transition: background-color 0.2s;
        }
        .bg-thumbnail-remove:hover {
          background: rgba(220, 53, 69, 1);
        }
      `;
    document.head.appendChild(style);

    // Live background options state
    this._bgOpts = {};
    for (const [key, val] of Object.entries(BG_DEFAULTS)) {
      this._bgOpts[key] = { ...val };
    }

    // Dynamically inject Dither background color setting row
    const ditherColorInput = document.getElementById('bgDitherColor');
    if (ditherColorInput && !document.getElementById('bgDitherBgColor')) {
      const ditherColorRow = ditherColorInput.closest('.bg-setting-row');
      if (ditherColorRow) {
        const bgRow = document.createElement('div');
        bgRow.className = 'bg-setting-row';
        bgRow.innerHTML = `
          <label for="bgDitherBgColor">Background Color</label>
          <div class="bg-color-control">
            <input type="color" id="bgDitherBgColor" value="#000000" class="bg-color-input">
            <span class="bg-color-hex" data-for="bgDitherBgColor">#000000</span>
          </div>
        `;
        ditherColorRow.parentNode.insertBefore(bgRow, ditherColorRow.nextSibling);
      }
    }

    // Dynamically inject Dot Grid background color setting row
    const dotgridActiveColorInput = document.getElementById('bgDotgridActiveColor');
    if (dotgridActiveColorInput && !document.getElementById('bgDotgridBgColor')) {
      const dotgridActiveColorRow = dotgridActiveColorInput.closest('.bg-setting-row');
      if (dotgridActiveColorRow) {
        const bgRow = document.createElement('div');
        bgRow.className = 'bg-setting-row';
        bgRow.innerHTML = `
          <label for="bgDotgridBgColor">Background Color</label>
          <div class="bg-color-control">
            <input type="color" id="bgDotgridBgColor" value="#000000" class="bg-color-input">
            <span class="bg-color-hex" data-for="bgDotgridBgColor">#000000</span>
          </div>
        `;
        dotgridActiveColorRow.parentNode.insertBefore(bgRow, dotgridActiveColorRow.nextSibling);
      }
    }

    this._bindCloseModals();
    this._bindSettings();
    this._bindBgSettings();
    this._bindQualityRadios();
    this._bindBgResets();
    this._initCustomBackgroundSelect();
    this.loadPreferences();

    if (this.prefersReducedMotion?.addEventListener) {
      this.prefersReducedMotion.addEventListener('change', () => {
        if (this.hasExplicitMotionProfile) return;
        const fallbackProfile = this._resolveMotionProfile(null);
        this._applyMotionProfile(fallbackProfile, { persist: false });
      });
    }
  }

  _getModalOverlays() {
    return Array.from(document.querySelectorAll('.modal-overlay'));
  }

  _getFocusableElements(container) {
    if (!container) return [];
    const selector = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    return Array.from(container.querySelectorAll(selector))
      .filter((el) => {
        if (!(el instanceof HTMLElement)) return false;
        if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
  }

  _setPageInert(activeModal) {
    Array.from(document.body.children).forEach((child) => {
      if (!(child instanceof HTMLElement)) return;
      const shouldInert = !!activeModal &&
        child !== activeModal &&
        !child.classList.contains('modal-overlay') &&
        child.id !== 'toastContainer';

      if (shouldInert) {
        child.inert = true;
        child.setAttribute('aria-hidden', 'true');
        child.dataset.hybridModalInert = 'true';
      } else if (child.dataset.hybridModalInert === 'true') {
        child.inert = false;
        child.removeAttribute('aria-hidden');
        delete child.dataset.hybridModalInert;
      }
    });
  }

  _activateModal(modal) {
    if (!(modal instanceof HTMLElement) || modal.hidden) return;
    if (!this.activeModal) {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    this.activeModal = modal;
    this._setPageInert(modal);

    requestAnimationFrame(() => {
      if (modal.hidden) return;
      const focusable = this._getFocusableElements(modal);
      const preferred = modal.querySelector('[data-initial-focus], [autofocus]');
      const focusTarget = focusable.includes(preferred) ? preferred : focusable[0] || modal;
      focusTarget.focus({ preventScroll: true });
    });
  }

  _deactivateModal(modal) {
    if (this.activeModal !== modal) return;
    const nextActive = this._getModalOverlays().find((overlay) => !overlay.hidden && overlay !== modal);
    if (nextActive) {
      this.activeModal = null;
      this._activateModal(nextActive);
      return;
    }

    this.activeModal = null;
    this._setPageInert(null);
    const restoreTarget = this.previousFocus;
    this.previousFocus = null;
    if (restoreTarget?.isConnected) {
      restoreTarget.focus({ preventScroll: true });
    }
  }

  _closeModal(modal) {
    if (modal instanceof HTMLElement) {
      modal.hidden = true;
    }
  }

  _trapModalFocus(event, modal) {
    const focusable = this._getFocusableElements(modal);
    if (focusable.length === 0) {
      event.preventDefault();
      modal.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!modal.contains(active)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
      return;
    }

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  _bindCloseModals() {
    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      const observer = new MutationObserver(() => {
        if (overlay.hidden) {
          this._deactivateModal(overlay);
          if (overlay.id === 'bgSettingsModal') {
            const gearBtn = document.getElementById('bgSettingsToggle');
            if (gearBtn) {
              gearBtn.classList.remove('active');
              gearBtn.setAttribute('aria-expanded', 'false');
            }
          }
        } else {
          this._activateModal(overlay);
          if (overlay.id === 'bgSettingsModal') {
            const gearBtn = document.getElementById('bgSettingsToggle');
            if (gearBtn) {
              gearBtn.classList.add('active');
              gearBtn.setAttribute('aria-expanded', 'true');
            }
          }
        }
      });
      observer.observe(overlay, { attributes: true, attributeFilter: ['hidden'] });

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this._closeModal(overlay);
        }
      });
    });

    // Close buttons
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.closeModal;
        const modal = document.getElementById(modalId);
        this._closeModal(modal);
      });
    });

    document.addEventListener('keydown', (e) => {
      const activeModal = this.activeModal || this._getModalOverlays().find((m) => !m.hidden);
      if (!activeModal) return;

      if (e.key === 'Escape') {
        this._closeModal(activeModal);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (e.key === 'Tab') {
        this._trapModalFocus(e, activeModal);
      }
    }, true);
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

    // Welcome background quality — now a segmented radio group (see _bindQualityRadios).
    // Legacy select is removed from the DOM; this handler is a no-op safety net.
  }

  _bindBgSettings() {
    // Trigger button toggles the panel (popover in the controls bar)
    const gearBtn = document.getElementById('bgSettingsToggle');
    const panel = document.getElementById('bgSettingsModal');
    const wrapper = document.getElementById('bgSettingsControl');

    const closePanel = () => {
      if (panel.hidden) return;
      panel.hidden = true;
      gearBtn.classList.remove('active');
      gearBtn.setAttribute('aria-expanded', 'false');
      wrapper?.classList.remove('bg-panel-open');
    };

    if (gearBtn && panel) {
      gearBtn.addEventListener('click', (e) => {
        // stopPropagation so the document outside-click listener (below)
        // doesn't immediately re-close the panel on the same click.
        e.stopPropagation();
        const isOpen = !panel.hidden;
        panel.hidden = isOpen;
        gearBtn.classList.toggle('active', !isOpen);
        gearBtn.setAttribute('aria-expanded', String(!isOpen));
        wrapper?.classList.toggle('bg-panel-open', !isOpen);

        if (!isOpen) {
          const bgSelect = document.getElementById('welcomeBackgroundSelect');
          this._showBgSettingsGroupFor(bgSelect?.value || 'dither');
        }
      });

      // Outside-click dismissal. Keep clicks inside the modal alive so sliders,
      // color inputs, and selects do not close the settings panel mid-edit.
      document.addEventListener('click', (e) => {
        const target = e.target;
        if (!wrapper?.contains(target) && !panel.contains(target)) {
          closePanel();
        }
      });

      // Escape-to-close for keyboard accessibility
      panel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          closePanel();
          gearBtn.focus();
        }
      });
      gearBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePanel();
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
        this._updateValueSpan(el, this._getControlDisplayValue(ctrl));
      }

      const eventName = (ctrl.type === 'checkbox' || ctrl.type === 'select') ? 'change' : 'input';
      el.addEventListener(eventName, () => {
        let value;
        if (ctrl.type === 'checkbox') {
          value = el.checked;
        } else if (ctrl.type === 'color') {
          value = el.value;
          const hexLabel = document.querySelector(`.bg-color-hex[data-for="${ctrl.id}"]`);
          if (hexLabel) hexLabel.textContent = value;
        } else if (ctrl.type === 'select') {
          value = el.value;
        } else {
          value = ctrl.parse ? ctrl.parse(el.value) : el.value;
          this._updateValueSpan(el, this._formatRangeDisplayValue(ctrl, value));
        }

        const switchingToCustom = this.welcomeQuality !== 'custom';
        if (switchingToCustom) {
          // Promote current preset-adjusted values into raw values so controls
          // don't jump when quality state flips to custom.
          this._captureAllEffectiveBgOpts();
        }

        this._bgOpts[ctrl.bg][ctrl.opt] = value;

        // Any manual background tweak exits quality presets and becomes custom.
        if (switchingToCustom) {
          this._applyWelcomeQuality('custom', {
            persist: true,
            reapply: false,
            syncInputs: true,
          });
        }

        // Debounce the apply for range/color inputs (recreating the effect is expensive)
        clearTimeout(this._bgDebounceTimers[ctrl.bg]);
        this._bgDebounceTimers[ctrl.bg] = setTimeout(() => {
          this._applyBgOpts(ctrl.bg, { persist: true });
        }, ctrl.type === 'checkbox' ? 0 : 250);
      });
    }

    // Custom uploader bindings for Grid Motion custom pictures
    const fileInput = document.getElementById('bgGridmotionFileInput');
    const selectBtn = document.getElementById('bgGridmotionSelectBtn');
    const clearBtn = document.getElementById('bgGridmotionClearBtn');

    if (selectBtn && fileInput) {
      selectBtn.addEventListener('click', () => {
        fileInput.click();
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const resizePromises = files.map(file => resizeGridmotionImage(file));
        const dataUrls = await Promise.all(resizePromises);
        const validUrls = dataUrls.filter(url => !!url);

        if (validUrls.length === 0) return;

        const switchingToCustom = this.welcomeQuality !== 'custom';
        if (switchingToCustom) {
          this._captureAllEffectiveBgOpts();
        }

        const currentPics = Array.isArray(this._bgOpts.gridmotion.customPictures)
          ? this._bgOpts.gridmotion.customPictures
          : [];
        this._bgOpts.gridmotion.customPictures = [...currentPics, ...validUrls];

        if (switchingToCustom) {
          this._applyWelcomeQuality('custom', {
            persist: true,
            reapply: false,
            syncInputs: true,
          });
        } else {
          this._refreshBgControls({ syncInputValues: false });
        }

        this._applyBgOpts('gridmotion', { persist: true });
        fileInput.value = '';
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const switchingToCustom = this.welcomeQuality !== 'custom';
        if (switchingToCustom) {
          this._captureAllEffectiveBgOpts();
        }

        this._bgOpts.gridmotion.customPictures = [];

        if (switchingToCustom) {
          this._applyWelcomeQuality('custom', {
            persist: true,
            reapply: false,
            syncInputs: true,
          });
        } else {
          this._refreshBgControls({ syncInputValues: false });
        }

        this._applyBgOpts('gridmotion', { persist: true });
      });
    }
  }

  _updateValueSpan(inputEl, displayValue = null) {
    const span = inputEl.parentElement?.querySelector('.bg-setting-value');
    if (!span) return;
    if (displayValue !== null && displayValue !== undefined) {
      span.textContent = String(displayValue);
      this._setRangeFill(inputEl);
      return;
    }
    span.textContent = inputEl.value;
    this._setRangeFill(inputEl);
  }

  // Drive the accent-filled slider track. Computes how far along [min,max]
  // the value sits and exposes it as a --fill percentage on the input's
  // nearest .bg-settings-panel ancestor (the CSS reads --bgp-fill there).
  // No-op for non-range inputs (color/checkbox) — those lack min/max.
  _setRangeFill(inputEl) {
    if (inputEl.type !== 'range') return;
    const min = Number(inputEl.min);
    const max = Number(inputEl.max);
    const val = Number(inputEl.value);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return;
    const pct = Math.min(100, Math.max(0, ((val - min) / (max - min)) * 100));
    inputEl.style.setProperty('--bgp-fill', `${pct}%`);
    inputEl.style.setProperty('--fill', `${pct}%`);
  }

  _formatRangeDisplayValue(ctrl, value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '';
    if (ctrl.parse === parseInt) {
      return String(Math.round(n));
    }
    return String(Math.round(n * 100) / 100);
  }

  _getEffectiveBgOpts(bg) {
    const quality = this.welcomeQuality;
    if (quality === 'custom') {
      return { ...BG_DEFAULTS[bg], ...this._bgOpts[bg] };
    }
    return { ...BG_QUALITY_PRESETS[quality]?.[bg] };
  }

  _getControlDisplayValue(ctrl) {
    const effectiveOpts = this._getEffectiveBgOpts(ctrl.bg);
    const value = effectiveOpts?.[ctrl.opt];
    return this._formatRangeDisplayValue(ctrl, value);
  }

  _captureAllEffectiveBgOpts() {
    for (const bgKey of Object.keys(BG_DEFAULTS)) {
      this._bgOpts[bgKey] = this._getEffectiveBgOpts(bgKey);
    }
  }

  _refreshBgControls({ syncInputValues = false } = {}) {
    document.querySelectorAll('.bg-reset').forEach((btn) => {
      btn.disabled = false;
    });

    for (const ctrl of BG_CONTROLS) {
      const el = document.getElementById(ctrl.id);
      if (!el) continue;

      el.disabled = false;

      const effectiveOpts = this._getEffectiveBgOpts(ctrl.bg);
      const effectiveValue = effectiveOpts?.[ctrl.opt];

      if (syncInputValues) {
        if (ctrl.type === 'checkbox') {
          if (effectiveValue !== undefined) el.checked = !!effectiveValue;
        } else if (ctrl.type === 'color') {
          if (typeof effectiveValue === 'string') {
            el.value = effectiveValue;
            const hexLabel = document.querySelector(`.bg-color-hex[data-for="${ctrl.id}"]`);
            if (hexLabel) hexLabel.textContent = effectiveValue;
          }
        } else if (ctrl.type === 'select') {
          if (effectiveValue !== undefined) el.value = effectiveValue;
        } else if (effectiveValue !== undefined && effectiveValue !== null) {
          const numeric = Number(effectiveValue);
          if (Number.isFinite(numeric)) {
            el.value = ctrl.parse === parseInt
              ? String(Math.round(numeric))
              : String(Math.round(numeric * 100) / 100);
          }
        }
      }

      if (ctrl.type === 'range') {
        this._updateValueSpan(el, this._formatRangeDisplayValue(ctrl, effectiveValue));
      }
    }
    this._updateGridmotionUploaderUI();
  }

  _updateGridmotionUploaderUI() {
    const fileInput = document.getElementById('bgGridmotionFileInput');
    const clearBtn = document.getElementById('bgGridmotionClearBtn');
    const thumbGrid = document.getElementById('bgGridmotionThumbnails');
    if (!clearBtn || !thumbGrid) return;

    const opts = this._getEffectiveBgOpts('gridmotion');
    const customPics = opts?.customPictures || [];

    if (customPics.length > 0) {
      clearBtn.style.display = 'inline-block';
    } else {
      clearBtn.style.display = 'none';
      if (fileInput) fileInput.value = '';
    }

    thumbGrid.innerHTML = '';
    customPics.forEach((pic, index) => {
      const item = document.createElement('div');
      item.className = 'bg-thumbnail-item';

      const img = document.createElement('img');
      img.className = 'bg-thumbnail-img';
      img.src = pic;
      item.appendChild(img);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'bg-thumbnail-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = 'Remove image';
      removeBtn.addEventListener('click', () => {
        const switchingToCustom = this.welcomeQuality !== 'custom';
        if (switchingToCustom) {
          this._captureAllEffectiveBgOpts();
        }

        if (Array.isArray(this._bgOpts.gridmotion.customPictures)) {
          this._bgOpts.gridmotion.customPictures = this._bgOpts.gridmotion.customPictures.filter((_, i) => i !== index);
        }

        if (switchingToCustom) {
          this._applyWelcomeQuality('custom', {
            persist: true,
            reapply: false,
            syncInputs: true,
          });
        } else {
          this._refreshBgControls({ syncInputValues: false });
        }

        this._applyBgOpts('gridmotion', { persist: true });
      });
      item.appendChild(removeBtn);

      thumbGrid.appendChild(item);
    });
  }

  _showBgSettingsGroupFor(bg) {
    document.querySelectorAll('.bg-settings-group').forEach(g => {
      g.classList.toggle('active', g.dataset.bg === bg);
    });
  }

  _initCustomBackgroundSelect() {
    const nativeSelect = document.getElementById('welcomeBackgroundSelect');
    if (!nativeSelect) return;

    // Check if custom select is already initialized to prevent duplicate rendering
    if (document.getElementById('welcomeBackgroundSelectContainer')) return;

    // Create container
    const container = document.createElement('div');
    container.id = 'welcomeBackgroundSelectContainer';
    container.className = 'custom-select-container';

    // Create trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', nativeSelect.getAttribute('aria-label') || 'Background effect');
    
    const triggerValue = document.createElement('span');
    triggerValue.className = 'custom-select-value';
    const triggerArrow = document.createElement('span');
    triggerArrow.className = 'custom-select-arrow';
    
    trigger.appendChild(triggerValue);
    trigger.appendChild(triggerArrow);
    container.appendChild(trigger);

    // Create dropdown menu container
    const dropdown = document.createElement('div');
    dropdown.className = 'custom-select-dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdown.hidden = true;
    container.appendChild(dropdown);

    // Populate custom select options from native select options
    const rebuildOptions = () => {
      dropdown.innerHTML = '';
      const activeValue = nativeSelect.value;
      
      Array.from(nativeSelect.options).forEach((opt) => {
        const optionEl = document.createElement('div');
        optionEl.className = 'custom-select-option';
        optionEl.dataset.value = opt.value;
        optionEl.setAttribute('role', 'option');
        optionEl.setAttribute('tabindex', '-1');
        optionEl.textContent = opt.textContent;

        if (opt.value === activeValue) {
          optionEl.classList.add('active');
          optionEl.setAttribute('aria-selected', 'true');
          triggerValue.textContent = opt.textContent;

          // Add clean active checkmark indicator
          const checkIcon = document.createElement('span');
          checkIcon.className = 'custom-select-option-check';
          checkIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
          optionEl.appendChild(checkIcon);
        } else {
          optionEl.setAttribute('aria-selected', 'false');
        }

        // Selection by click
        optionEl.addEventListener('click', (e) => {
          e.stopPropagation();
          selectOption(opt.value);
        });

        dropdown.appendChild(optionEl);
      });
    };

    const selectOption = (val) => {
      nativeSelect.value = val;
      nativeSelect.dispatchEvent(new Event('change'));
      closeDropdown();
      trigger.focus();
    };

    const openDropdown = () => {
      rebuildOptions();
      dropdown.hidden = false;
      container.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      
      // Focus currently selected option or the first one
      const activeOption = dropdown.querySelector('.custom-select-option.active');
      if (activeOption) {
        activeOption.focus();
      } else {
        const first = dropdown.querySelector('.custom-select-option');
        if (first) first.focus();
      }
    };

    const closeDropdown = () => {
      dropdown.hidden = true;
      container.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    };

    // Click on trigger opens/closes dropdown
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.hidden) {
        openDropdown();
      } else {
        closeDropdown();
      }
    });

    // Close dropdown on click outside
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        closeDropdown();
      }
    });

    // Handle trigger keydown
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDropdown();
      }
    });

    // Handle dropdown keyboard navigation
    container.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      if (!activeEl || !activeEl.classList.contains('custom-select-option')) return;

      const options = Array.from(dropdown.querySelectorAll('.custom-select-option'));
      const currentIndex = options.indexOf(activeEl);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = options[currentIndex + 1] || options[0];
        next?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = options[currentIndex - 1] || options[options.length - 1];
        prev?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const val = activeEl.dataset.value;
        if (val !== undefined) {
          selectOption(val);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeDropdown();
        trigger.focus();
      } else if (e.key === 'Tab') {
        closeDropdown();
      }
    });

    // Insert custom select container in the DOM right after the native select
    nativeSelect.parentNode.insertBefore(container, nativeSelect.nextSibling);

    // Initialize display values
    rebuildOptions();
  }

  _syncCustomBackgroundSelect(value) {
    const trigger = document.querySelector('#welcomeBackgroundSelectContainer .custom-select-trigger');
    const triggerVal = trigger?.querySelector('.custom-select-value');
    if (!triggerVal) return;

    const nativeSelect = document.getElementById('welcomeBackgroundSelect');
    if (!nativeSelect) return;

    const opt = Array.from(nativeSelect.options).find(o => o.value === value);
    if (opt) {
      triggerVal.textContent = opt.textContent;
    }

    // Synchronize active checkmark indicator in dropdown options
    const dropdown = document.querySelector('#welcomeBackgroundSelectContainer .custom-select-dropdown');
    if (dropdown) {
      dropdown.querySelectorAll('.custom-select-option').forEach(optionEl => {
        const isMatched = (optionEl.dataset.value === value);
        optionEl.classList.toggle('active', isMatched);
        optionEl.setAttribute('aria-selected', String(isMatched));

        let checkIcon = optionEl.querySelector('.custom-select-option-check');
        if (isMatched && !checkIcon) {
          checkIcon = document.createElement('span');
          checkIcon.className = 'custom-select-option-check';
          checkIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
          optionEl.appendChild(checkIcon);
        } else if (!isMatched && checkIcon) {
          checkIcon.remove();
        }
      });
    }
  }

  _updateMountBackgrounds() {
    const activeBg = document.getElementById('welcomeBackgroundSelect')?.value || 'dither';

    const dotgridMount = document.getElementById('dotGridMount');
    if (dotgridMount) {
      const active = (activeBg === 'dotgrid');
      const dotgridOpts = this._getEffectiveBgOpts('dotgrid');
      dotgridMount.style.backgroundColor = active ? (dotgridOpts.bgColor || '#000000') : '';
    }
  }

  async _applyBgOpts(bg, { persist = true } = {}) {
    const rawOpts = { ...this._bgOpts[bg] };
    const opts = this._getEffectiveBgOpts(bg);
    const stateKey = `bgOpts_${bg}`;

    if (bg === 'dotgrid') {
      this._updateMountBackgrounds();
    }

    window.__hybridWelcomeEffectsState = {
      ...(window.__hybridWelcomeEffectsState || {}),
      [stateKey]: opts,
    };

    window.dispatchEvent(new CustomEvent('hybrid:welcome-settings-changed', {
      detail: { [stateKey]: opts },
    }));

    if (persist) {
      await window.hybridAPI.db.setPreference(stateKey, JSON.stringify(rawOpts));
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
      const welcomeBackground = WELCOME_BACKGROUNDS.includes(prefs.welcomeBackground)
        ? prefs.welcomeBackground
        : 'dither';
      await this._applyWelcomeBackground(welcomeBackground, { persist: false });
      if (prefs.welcomeBackground === undefined) {
        await window.hybridAPI.db.setPreference('welcomeBackground', welcomeBackground);
      }

      // Welcome background quality
      const welcomeQuality = this._resolveWelcomeQuality(prefs.welcomeQuality);
      await this._applyWelcomeQuality(welcomeQuality, { persist: false, reapply: false });
      if (prefs.welcomeQuality === undefined) {
        await window.hybridAPI.db.setPreference('welcomeQuality', welcomeQuality);
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
            if (ctrl.type === 'range') this._updateValueSpan(el, this._getControlDisplayValue(ctrl));
          }
        }
        // Push opts into state
        await this._applyBgOpts(bgKey, { persist: false });
      }

      this._refreshBgControls({ syncInputValues: true });

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

  _resolveWelcomeQuality(value) {
    if (WELCOME_QUALITY_LEVELS.includes(value)) {
      return value;
    }
    return WELCOME_QUALITY_DEFAULT;
  }

  _clamp(value, min, max) {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
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
    const value = WELCOME_BACKGROUNDS.includes(background) ? background : 'dither';
    this._setValue('welcomeBackgroundSelect', value);
    document.body.dataset.welcomeBackground = value;
    this._syncBgMeta(value);

    const subtitleMap = {
      dither: 'Dither Waves · animated bayer dither',
      particles: 'Particles · drifting particle field',
      faulty: 'Faulty Terminal · CRT glitch & scanlines',
      dotgrid: 'Dot Grid · reactive dot lattice',
      pixelblast: 'Pixel Blast · interactive diamond pixel blast',
      gridmotion: 'Grid Motion · interactive gliding item lattice',
      none: 'Default · pure black backdrop',
    };

    const subtitleEl = document.getElementById('bgModalSubtitle');
    if (subtitleEl) {
      subtitleEl.textContent = subtitleMap[value] || subtitleMap.dither;
    }

    this._updateMountBackgrounds();

    this._emitWelcomeSettings({
      welcomeBackground: value,
    });

    if (persist) {
      await window.hybridAPI.db.setPreference('welcomeBackground', value);
    }
    this._syncCustomBackgroundSelect(value);
  }

  // Update the meta strip (tag + description) under the modal header.
  _syncBgMeta(bg) {
    const label = BG_LABELS[bg] || BG_LABELS.dither;
    const tagEl = document.getElementById('bgMetaTag');
    const descEl = document.getElementById('bgMetaDesc');
    if (tagEl) tagEl.textContent = label.tag;
    if (descEl) descEl.textContent = label.desc;
  }

  // Quality segmented control — reflect the resolved quality on the radio
  // inputs and toggle the derived "Custom" indicator.
  _syncQualityRadios(value) {
    const radios = document.querySelectorAll('input[name="welcomeQuality"]');
    radios.forEach((r) => {
      r.checked = r.value === value;
    });
    const customPill = document.getElementById('bgQualityCustom');
    if (customPill) {
      customPill.classList.toggle('is-active', value === 'custom');
      customPill.setAttribute('aria-hidden', value === 'custom' ? 'false' : 'true');
    }
  }

  // Wire the segmented quality radios. Changing a preset re-applies that
  // quality level; the "Custom" pill is now clickable.
  _bindQualityRadios() {
    const container = document.querySelector('.bg-quality-pills');
    if (!container) return;
    container.addEventListener('change', (e) => {
      const radio = e.target;
      if (radio.name !== 'welcomeQuality') return;
      this._applyWelcomeQuality(radio.value, { persist: true });
    });

    const customPill = document.getElementById('bgQualityCustom');
    if (customPill) {
      customPill.addEventListener('click', () => {
        this._applyWelcomeQuality('custom', { persist: true });
      });
    }
  }

  // Per-effect reset buttons: restore defaults for that background, then
  // refresh inputs and re-apply so the live preview snaps back instantly.
  _bindBgResets() {
    document.querySelectorAll('.bg-reset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const bg = btn.dataset.resetBg;
        if (!bg || !BG_DEFAULTS[bg]) return;
        this._bgOpts[bg] = { ...BG_DEFAULTS[bg] };

        if (this.welcomeQuality !== 'custom') {
          this._applyWelcomeQuality('custom', {
            persist: true,
            reapply: false,
            syncInputs: false,
          });
        }

        this._refreshBgControls({ syncInputValues: true });
        this._applyBgOpts(bg, { persist: true });
        this._syncColorHexLabels(bg);
      });
    });
  }

  // Keep the visible hex labels next to color swatches in sync.
  _syncColorHexLabels(bg) {
    for (const ctrl of BG_CONTROLS) {
      if (ctrl.bg !== bg || ctrl.type !== 'color') continue;
      const input = document.getElementById(ctrl.id);
      const hexLabel = document.querySelector(`.bg-color-hex[data-for="${ctrl.id}"]`);
      if (input && hexLabel) hexLabel.textContent = input.value;
    }
  }

  async _applyWelcomeQuality(quality, { persist = true, reapply = true, syncInputs = true } = {}) {
    const prevQuality = this.welcomeQuality;
    const value = this._resolveWelcomeQuality(quality);
    this.welcomeQuality = value;
    this._syncQualityRadios(value);
    document.body.dataset.welcomeQuality = value;
    this._emitWelcomeSettings({
      welcomeQuality: value,
    });

    if (value === 'custom' && prevQuality !== 'custom' && persist) {
      for (const bgKey of Object.keys(BG_DEFAULTS)) {
        if (prevQuality && prevQuality !== 'custom') {
          this._bgOpts[bgKey] = { ...BG_QUALITY_PRESETS[prevQuality][bgKey], ...this._bgOpts[bgKey] };
        }
      }
    }

    if (reapply) {
      for (const bgKey of Object.keys(BG_DEFAULTS)) {
        await this._applyBgOpts(bgKey, { persist: false });
      }
    }

    this._refreshBgControls({ syncInputValues: syncInputs });

    if (persist) {
      await window.hybridAPI.db.setPreference('welcomeQuality', value);
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
