const LOG_TAG = '[TextPressure]';
const TEXT_PRESSURE_DEBUG = false;

function textPressuredbg(...args) {
  if (TEXT_PRESSURE_DEBUG) console.log(...args);
}

const debounce = (func, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };
};

const dist = (a, b) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const getAttr = (distance, maxDist, minVal, maxVal) => {
  const val = maxVal - Math.abs((maxVal * distance) / maxDist);
  return Math.max(minVal, val + minVal);
};

const DEFAULT_OPTIONS = Object.freeze({
  text: 'HYBRID',
  minFontSize: 24,
  width: true,
  weight: true,
  italic: true,
  alpha: false,
  flex: true,
  stroke: false,
  textColor: '#FFFFFF',
  strokeColor: '#FF0000',
  bgColor: '#000000',
  pauseWhenUnfocused: true,
});

let activeInstance = null;
let createPromise = null;
let destroyAfterCreate = false;
let lifecycleObserver = null;
let lifecycleBooted = false;
let welcomeSettingsListener = null;

function isAppInteractive() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function initTextPressure(containerElement, customOptions = {}) {
  if (!(containerElement instanceof HTMLElement)) {
    throw new Error(`${LOG_TAG} initTextPressure requires a valid container HTMLElement.`);
  }

  let options = { ...DEFAULT_OPTIONS, ...customOptions };

  const section = document.createElement('section');
  section.className = 'textpressure-mount-inner';
  section.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;width:100%;position:relative;';

  const container = document.createElement('div');
  container.className = 'text-pressure-container';

  const titleEl = document.createElement('h1');
  titleEl.className = 'text-pressure-title';
  titleEl.style.fontFamily = 'Roboto Flex, sans-serif';

  container.appendChild(titleEl);
  section.appendChild(container);
  containerElement.appendChild(section);

  const spans = [];
  let chars = [];
  const mouse = { x: 0, y: 0 };
  const cursor = { x: 0, y: 0 };

  let destroyed = false;
  let rafId = 0;

  const buildText = () => {
    if (destroyed) return;
    titleEl.innerHTML = '';
    spans.length = 0;
    chars = options.text.split('');

    if (options.flex) {
      titleEl.classList.add('flex');
    } else {
      titleEl.classList.remove('flex');
    }

    if (options.stroke) {
      titleEl.classList.add('stroke');
    } else {
      titleEl.classList.remove('stroke');
    }

    chars.forEach((char) => {
      const span = document.createElement('span');
      span.setAttribute('data-char', char);
      span.textContent = char;
      span.style.color = options.stroke ? 'transparent' : options.textColor;
      if (options.stroke) {
        span.style.setProperty('--stroke-color', options.strokeColor);
      }
      titleEl.appendChild(span);
      spans.push(span);
    });

    resize();
  };

  const resize = () => {
    if (destroyed) return;
    const { width: containerW } = container.getBoundingClientRect();
    if (containerW <= 0) return;

    let fontSize = containerW / (chars.length / 2);
    fontSize = Math.max(fontSize, options.minFontSize);

    titleEl.style.fontSize = `${fontSize}px`;
    titleEl.style.lineHeight = '1';
  };

  const handleMouseMove = (e) => {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
  };

  const handleTouchMove = (e) => {
    if (e.touches.length > 0) {
      cursor.x = e.touches[0].clientX;
      cursor.y = e.touches[0].clientY;
    }
  };

  const animate = () => {
    if (destroyed) return;

    if (options.pauseWhenUnfocused && !isAppInteractive()) {
      rafId = requestAnimationFrame(animate);
      return;
    }

    // Trailing ease
    mouse.x += (cursor.x - mouse.x) / 15;
    mouse.y += (cursor.y - mouse.y) / 15;

    const titleRect = titleEl.getBoundingClientRect();
    const maxDist = Math.max(100, titleRect.width / 2);

    spans.forEach((span) => {
      if (!span) return;
      const rect = span.getBoundingClientRect();
      const charCenter = {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
      };

      const d = dist(mouse, charCenter);

      // Roboto Flex Axes: wght: 100-1000, wdth: 25-151, ital: 0-1
      const wdth = options.width ? Math.floor(getAttr(d, maxDist, 25, 126)) : 100;
      const wght = options.weight ? Math.floor(getAttr(d, maxDist, 100, 900)) : 400;
      const italVal = options.italic ? getAttr(d, maxDist, 0, 1).toFixed(2) : 0;
      const alphaVal = options.alpha ? getAttr(d, maxDist, 0.1, 0.9).toFixed(2) : 1;

      const newSettings = `'wght' ${wght}, 'wdth' ${wdth}, 'ital' ${italVal}`;
      if (span.style.fontVariationSettings !== newSettings) {
        span.style.fontVariationSettings = newSettings;
      }
      if (span.style.opacity !== alphaVal) {
        span.style.opacity = alphaVal;
      }
    });

    rafId = requestAnimationFrame(animate);
  };

  const updateOptions = (newOptions = {}) => {
    const textChanged = newOptions.text !== undefined && newOptions.text !== options.text;
    const layoutChanged = newOptions.flex !== undefined && newOptions.flex !== options.flex ||
                          newOptions.stroke !== undefined && newOptions.stroke !== options.stroke ||
                          newOptions.textColor !== undefined && newOptions.textColor !== options.textColor ||
                          newOptions.strokeColor !== undefined && newOptions.strokeColor !== options.strokeColor;

    options = { ...options, ...newOptions };

    if (textChanged || layoutChanged) {
      buildText();
    } else {
      resize();
    }
  };

  // Init positions
  const rect = containerElement.getBoundingClientRect();
  mouse.x = rect.left + rect.width / 2;
  mouse.y = rect.top + rect.height / 2;
  cursor.x = mouse.x;
  cursor.y = mouse.y;

  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('touchmove', handleTouchMove, { passive: true });

  const debouncedResize = debounce(resize, 100);
  window.addEventListener('resize', debouncedResize);

  buildText();
  animate();

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;

    cancelAnimationFrame(rafId);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('resize', debouncedResize);

    if (section.parentElement === containerElement) {
      containerElement.removeChild(section);
    }
  };

  return { destroy, updateOptions };
}

function ensureMount() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (!welcomeScreen) return null;

  let mount = document.getElementById('textPressureMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'textPressureMount';
    mount.className = 'textpressure-mount';
    mount.setAttribute('aria-hidden', 'true');

    welcomeScreen.prepend(mount);
  }

  return mount;
}

export async function createTextPressure(options = {}) {
  if (activeInstance) return activeInstance;
  if (createPromise) return createPromise;
  destroyAfterCreate = false;

  createPromise = (async () => {
    const mount = options.mount || ensureMount();
    if (!mount) throw new Error('Could not find #welcomeScreen to mount text pressure.');

    const instance = initTextPressure(mount, {
      ...options,
    });

    activeInstance = instance;
    if (destroyAfterCreate) {
      destroyAfterCreate = false;
      destroyTextPressure();
      return null;
    }

    return instance;
  })();

  try {
    return await createPromise;
  } finally {
    createPromise = null;
  }
}

export function destroyTextPressure() {
  if (!activeInstance) {
    if (createPromise) destroyAfterCreate = true;
    return;
  }
  activeInstance.destroy();
  activeInstance = null;
}

async function syncLifecycleState() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (!welcomeScreen) return;

  const visible = !welcomeScreen.classList.contains('hidden');
  const welcomeState = window.__hybridWelcomeEffectsState || {};
  const background = welcomeState.welcomeBackground || 'dither';
  const shouldRun = visible && background === 'pressure';

  if (shouldRun) {
    const userOpts = welcomeState.bgOpts_pressure || {};
    const mapped = {};
    if (userOpts.text !== undefined) mapped.text = userOpts.text;
    if (userOpts.minFontSize !== undefined) mapped.minFontSize = userOpts.minFontSize;
    if (userOpts.width !== undefined) mapped.width = userOpts.width;
    if (userOpts.weight !== undefined) mapped.weight = userOpts.weight;
    if (userOpts.italic !== undefined) mapped.italic = userOpts.italic;
    if (userOpts.alpha !== undefined) mapped.alpha = userOpts.alpha;
    if (userOpts.flex !== undefined) mapped.flex = userOpts.flex;
    if (userOpts.stroke !== undefined) mapped.stroke = userOpts.stroke;
    if (userOpts.textColor !== undefined) mapped.textColor = userOpts.textColor;
    if (userOpts.strokeColor !== undefined) mapped.strokeColor = userOpts.strokeColor;
    if (userOpts.bgColor !== undefined) mapped.bgColor = userOpts.bgColor;
    mapped.pauseWhenUnfocused = true;

    if (activeInstance?.updateOptions) {
      activeInstance.updateOptions(mapped);
      return;
    }

    try {
      await createTextPressure(mapped);
    } catch (error) {
      console.error(`${LOG_TAG} failed to create instance`, error);
    }
    return;
  }

  destroyTextPressure();
}

function bootLifecycle() {
  if (lifecycleBooted) return;
  lifecycleBooted = true;

  const welcomeScreen = document.getElementById('welcomeScreen');
  if (!welcomeScreen) {
    console.warn(`${LOG_TAG} #welcomeScreen not found; skipping auto-bootstrap.`);
    return;
  }

  lifecycleObserver = new MutationObserver(() => {
    syncLifecycleState();
  });
  lifecycleObserver.observe(welcomeScreen, {
    attributes: true,
    attributeFilter: ['class'],
  });

  welcomeSettingsListener = (event) => {
    if (!event?.detail) return;
    if (Object.prototype.hasOwnProperty.call(event.detail, 'welcomeBackground')) {
      syncLifecycleState();
      return;
    }
    if (
      Object.prototype.hasOwnProperty.call(event.detail, 'bgOpts_pressure') ||
      Object.prototype.hasOwnProperty.call(event.detail, 'welcomeQuality')
    ) {
      syncLifecycleState();
    }
  };
  window.addEventListener('hybrid:welcome-settings-changed', welcomeSettingsListener);

  window.addEventListener('beforeunload', () => {
    lifecycleObserver?.disconnect();
    lifecycleObserver = null;
    if (welcomeSettingsListener) {
      window.removeEventListener('hybrid:welcome-settings-changed', welcomeSettingsListener);
      welcomeSettingsListener = null;
    }
    destroyTextPressure();
  });

  syncLifecycleState();
}

if (typeof window !== 'undefined') {
  window.HybridTextPressure = {
    createTextPressure,
    destroyTextPressure,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLifecycle, { once: true });
  } else {
    bootLifecycle();
  }
}

export default initTextPressure;
