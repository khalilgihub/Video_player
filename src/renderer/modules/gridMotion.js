import { gsap } from 'gsap';

const LOG_TAG = '[GridMotion]';
const GRID_MOTION_DEBUG = false;

function gridMotiondbg(...args) {
  if (GRID_MOTION_DEBUG) console.log(...args);
}

const DEFAULT_OPTIONS = Object.freeze({
  gradientColor: '#000000',
  speed: 1.0,
  maxMove: 300,
  scale: 1.0,
  aspectRatio: '16:9',
  autoMove: false,
  customPictures: [],
  dpr: null,
  pauseWhenUnfocused: true,
});

const ASPECT_RATIO_MAP = Object.freeze({
  '16:9': '16 / 9',
  '1:1': '1 / 1',
  '3:4': '3 / 4',
  '4:3': '4 / 3',
  'auto': '1 / 1',
});

const DEFAULT_GRADIENTS = [
  'linear-gradient(135deg, #1f005c, #5b0060, #870060, #ac005c)',
  'linear-gradient(135deg, #0f0c1b, #170d2c, #240a36, #37063b)',
  'linear-gradient(135deg, #5f2c82, #49a09d)',
  'linear-gradient(135deg, #EC008C, #FC6767)',
  'linear-gradient(135deg, #24C6DC, #514A9D)',
  'linear-gradient(135deg, #00c6ff, #0072ff)',
  'linear-gradient(135deg, #f857a6, #ff5858)',
  'linear-gradient(135deg, #11998e, #38ef7d)',
  'linear-gradient(135deg, #FFAFBD, #ffc3a0)',
  'linear-gradient(135deg, #2193b0, #6dd5ed)',
  'linear-gradient(135deg, #ee9ca7, #ffdde1)',
  'linear-gradient(135deg, #de6262, #ffb88c)',
  'linear-gradient(135deg, #4568dc, #b06ab3)',
  'linear-gradient(135deg, #ff5e62, #ff9966)',
  'linear-gradient(135deg, #3a7bd5, #3a6073)',
  'linear-gradient(135deg, #4ca1af, #c4e0e5)',
  'linear-gradient(135deg, #f4c4f3, #fc67fa)',
  'linear-gradient(135deg, #00c3ff, #ffff1c)',
  'linear-gradient(135deg, #ff0844, #ffb199)',
  'linear-gradient(135deg, #f12711, #f5af19)',
  'linear-gradient(135deg, #a8c0ff, #3f2b96)',
  'linear-gradient(135deg, #396afc, #2948ff)',
  'linear-gradient(135deg, #8a2387, #e94057, #f27121)',
  'linear-gradient(135deg, #1e3c72, #2a5298)',
  'linear-gradient(135deg, #0575e6, #00f2fe)',
  'linear-gradient(135deg, #4b6cb7, #182848)',
  'linear-gradient(135deg, #d3cbb8, #6d6027)',
  'linear-gradient(135deg, #2c3e50, #bdc3c7)',
];

const CARD_TEXTS = [
  'HYBRID', 'PLAYER', 'ULTRA', '4K', 'HEVC', 'GSAP', 'MPV',
  'SMOOTH', 'EQUALIZER', 'AUDIO', 'FAST', 'CSS3', 'ELECTRON', 'SHADERS',
  'CHAMELEON', 'PLAYLIST', 'SUBTITLES', 'AESTHETIC', 'MOTION', 'CANVAS', 'DESKTOP',
  'STREAM', 'RENDER', 'DIAGNOSTICS', 'PRESETS', 'VOLUME', 'THEMES', 'CONTROLS'
];

let activeInstance = null;
let createPromise = null;
let destroyAfterCreate = false;
let lifecycleObserver = null;
let lifecycleBooted = false;
let welcomeSettingsListener = null;

function getWelcomeQuality(welcomeState = null) {
  const state = welcomeState || window.__hybridWelcomeEffectsState || {};
  const quality = state.welcomeQuality;
  if (quality === 'low' || quality === 'medium' || quality === 'high' || quality === 'custom') {
    return quality;
  }
  return 'medium';
}

function isAppInteractive() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function initGridMotion(containerElement, customOptions = {}) {
  if (!(containerElement instanceof HTMLElement)) {
    throw new Error(`${LOG_TAG} initGridMotion requires a valid container HTMLElement.`);
  }

  const options = { ...DEFAULT_OPTIONS, ...customOptions };

  const section = document.createElement('section');
  section.className = 'grid-motion-section';
  section.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;width:100%;position:relative;overflow:hidden;background:#000;';

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    .gridmotion-mount {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
      pointer-events: none;
      overflow: hidden;
    }
    .grid-motion-section {
      width: 100%;
      height: 100%;
      overflow: hidden;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
    }
    .grid-motion-container {
      gap: 0.5rem;
      flex: none;
      position: relative;
      width: 1600%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transform: rotate(-12deg) scale(1);
      transform-origin: center center;
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 2;
    }
    .grid-motion-row {
      display: grid;
      gap: 0.5rem;
      grid-template-columns: repeat(48, 1fr);
      width: 100%;
      will-change: transform;
    }
    .grid-motion-item {
      position: relative;
      overflow: hidden;
      width: 100%;
      aspect-ratio: var(--grid-card-aspect-ratio, 16 / 9);
    }
    .grid-motion-item-inner {
      position: relative;
      width: 100%;
      height: 100%;
      overflow: hidden;
      border-radius: 12px;
      background-color: #111;
      display: flex;
      align-items: center;
      justify-content: center;
      color: rgba(255, 255, 255, 0.85);
      font-size: clamp(10px, 1.3vw, 20px);
      font-weight: 700;
      letter-spacing: 0.05em;
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      transition: border-color 0.3s, transform 0.3s;
    }
    .grid-motion-item-img {
      width: 100%;
      height: 100%;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      position: absolute;
      inset: 0;
      opacity: 1.0;
      image-rendering: auto;
      transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), filter 0.3s ease;
    }
    .grid-motion-item-inner:hover .grid-motion-item-img {
      transform: scale(1.06);
      filter: brightness(1.08);
    }
    .grid-motion-item-content {
      padding: 1rem;
      text-align: center;
      z-index: 1;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
      font-family: inherit;
    }
  `;
  section.appendChild(styleEl);

  const container = document.createElement('div');
  container.className = 'grid-motion-container';
  section.appendChild(container);
  containerElement.appendChild(section);

  const rowElements = [];
  const cardElements = [];
  const NUM_ROWS = 10;
  const NUM_COLS = 48;

  // Build rows with NUM_COLS columns each
  for (let r = 0; r < NUM_ROWS; r++) {
    const row = document.createElement('div');
    row.className = 'grid-motion-row';
    container.appendChild(row);
    rowElements.push(row);

    for (let c = 0; c < NUM_COLS; c++) {
      const itemIndex = r * NUM_COLS + c;
      const item = document.createElement('div');
      item.className = 'grid-motion-item';

      const inner = document.createElement('div');
      inner.className = 'grid-motion-item-inner';

      const imgDiv = document.createElement('div');
      imgDiv.className = 'grid-motion-item-img';
      inner.appendChild(imgDiv);

      const textDiv = document.createElement('div');
      textDiv.className = 'grid-motion-item-content';
      inner.appendChild(textDiv);

      item.appendChild(inner);
      row.appendChild(item);
      cardElements.push({ inner, imgDiv, textDiv, index: itemIndex, rowIdx: r, colIdx: c });
    }
  }

  let mouseX = window.innerWidth / 2;
  let targetScrollOffset = 0;
  const rowScrollOffsets = new Array(NUM_ROWS).fill(0);
  let autoOffset = 0;
  let lastTime = performance.now();
  let destroyed = false;
  let cardPitch = 0;
  let loopWidth = 0;

  const applyScale = () => {
    const s = Math.max(0.35, Math.min(1.6, Number(options.scale) || 1.0));
    container.style.transform = `rotate(-12deg) scale(${s})`;
  };
  applyScale();

  const applyAspectRatio = () => {
    const ratioKey = options.aspectRatio || '16:9';
    const cssRatio = ASPECT_RATIO_MAP[ratioKey] || '16 / 9';
    container.style.setProperty('--grid-card-aspect-ratio', cssRatio);
  };
  applyAspectRatio();

  const measureLoop = () => {
    if (!rowElements[0] || !rowElements[0].children[1]) return;
    const c0 = rowElements[0].children[0];
    const c1 = rowElements[0].children[1];
    cardPitch = c1.offsetLeft - c0.offsetLeft;
    if (cardPitch <= 0) {
      cardPitch = container.clientWidth / NUM_COLS;
    }
    const hasPics = Array.isArray(options.customPictures) && options.customPictures.length > 0;
    const numPics = hasPics ? options.customPictures.length : 7;
    loopWidth = Math.max(1, numPics * cardPitch);
  };

  const isMainMount = containerElement.id === 'gridMotionMount' ||
                      containerElement.parentElement?.id === 'welcomeScreen' ||
                      containerElement.closest('#welcomeScreen');

  let persistScaleTimer = null;

  const handleWheel = (e) => {
    if (!isMainMount || destroyed) return;

    // Do not intercept scroll if cursor is inside a modal, settings panel, playlist, or dropdown
    if (e.target.closest('.modal-panel') ||
        e.target.closest('.modal-overlay') ||
        e.target.closest('#recentFiles') ||
        e.target.closest('.welcome-recent') ||
        e.target.closest('.bg-settings-panel') ||
        e.target.closest('.custom-select-dropdown')) {
      return;
    }

    const ws = document.getElementById('welcomeScreen');
    if (ws && ws.classList.contains('hidden')) return;

    e.preventDefault();

    let delta = -e.deltaY;
    if (e.deltaMode === 1) {
      delta *= 33;
    }

    // Ctrl + Wheel (or trackpad pinch-to-zoom) adjusts scale between 0.4 and 1.4
    if (e.ctrlKey) {
      const curScale = Number(options.scale) || 1.0;
      const zoomStep = delta > 0 ? 0.05 : -0.05;
      const newScale = Math.round(Math.max(0.4, Math.min(1.4, curScale + zoomStep)) * 100) / 100;
      if (newScale !== curScale) {
        options.scale = newScale;
        applyScale();

        // 1. Synchronize settings module (updates slider thumb, value text, and --bgp-fill)
        if (window.HybridApp?.settingsModule?.updateGridmotionScale) {
          window.HybridApp.settingsModule.updateGridmotionScale(newScale);
        } else {
          const scaleInput = document.getElementById('bgGridmotionScale');
          if (scaleInput) {
            scaleInput.value = String(newScale);
            const valSpan = scaleInput.parentElement?.querySelector('.bg-setting-value');
            if (valSpan) valSpan.textContent = String(newScale);
            const min = Number(scaleInput.min) || 0.4;
            const max = Number(scaleInput.max) || 1.4;
            const pct = Math.min(100, Math.max(0, ((newScale - min) / (max - min)) * 100));
            scaleInput.style.setProperty('--bgp-fill', `${pct}%`);
            scaleInput.style.setProperty('--fill', `${pct}%`);
          }
        }

        // 2. Persist to shared state and SQLite DB (debounced 300ms to avoid IPC spam with 30MB payload)
        window.__hybridWelcomeEffectsState = window.__hybridWelcomeEffectsState || {};
        const curOpts = window.__hybridWelcomeEffectsState.bgOpts_gridmotion || {};
        window.__hybridWelcomeEffectsState.bgOpts_gridmotion = { ...curOpts, scale: newScale };
        clearTimeout(persistScaleTimer);
        persistScaleTimer = setTimeout(() => {
          if (window.hybridAPI?.db?.setPreference) {
            const latestOpts = window.__hybridWelcomeEffectsState?.bgOpts_gridmotion || { ...curOpts, scale: newScale };
            window.hybridAPI.db.setPreference('bgOpts_gridmotion', JSON.stringify(latestOpts)).catch(() => {});
          }
        }, 300);
      }
      return;
    }

    // Scroll up (delta > 0) -> targetScrollOffset increases
    // Scroll down (delta < 0) -> targetScrollOffset decreases
    const speed = Math.max(0.1, Number(options.speed) || 1.0);
    const scrollStep = delta * (0.85 * speed);

    // Infinite scroll: no limit or boundary
    targetScrollOffset += scrollStep;
  };

  if (isMainMount) {
    window.addEventListener('wheel', handleWheel, { passive: false });
  }

  const handleResize = () => {
    measureLoop();
  };
  window.addEventListener('resize', handleResize, { passive: true });

  const updateCardContents = () => {
    const hasPics = Array.isArray(options.customPictures) && options.customPictures.length > 0;
    const numPics = hasPics ? options.customPictures.length : 7;
    cardElements.forEach(({ inner, imgDiv, textDiv, rowIdx, colIdx }) => {
      if (hasPics) {
        // Stagger rows slightly for visual variety
        const picIndex = (colIdx + rowIdx * 2) % numPics;
        const pic = options.customPictures[picIndex];
        imgDiv.style.backgroundImage = `url(${pic})`;
        imgDiv.style.display = 'block';
        textDiv.textContent = '';
        inner.style.background = '#111';
      } else {
        const textIdx = (colIdx + rowIdx * 3) % 7;
        imgDiv.style.backgroundImage = '';
        imgDiv.style.display = 'none';
        textDiv.textContent = CARD_TEXTS[textIdx % CARD_TEXTS.length];
        inner.style.background = DEFAULT_GRADIENTS[textIdx % DEFAULT_GRADIENTS.length];
      }
    });

    measureLoop();
  };

  updateCardContents();

  // Apply Radial Gradient Background
  const applyGradient = () => {
    section.style.background = `radial-gradient(circle, ${options.gradientColor} 0%, #000000 100%)`;
  };
  applyGradient();

  const handleMouseMove = (e) => {
    mouseX = e.clientX;
  };
  window.addEventListener('mousemove', handleMouseMove, { passive: true });

  const updateMotion = () => {
    if (destroyed) return;
    if (options.pauseWhenUnfocused && !isAppInteractive()) {
      lastTime = performance.now();
      return;
    }

    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    if (loopWidth <= 0) {
      measureLoop();
    }
    const lw = loopWidth > 0 ? loopWidth : 2000;

    const speedMultiplier = Math.max(0.1, Number(options.speed) || 1.0);

    // Automatic continuous glide if autoMove is enabled
    if (options.autoMove) {
      const autoSpeed = 42 * speedMultiplier; // pixels per second
      autoOffset += autoSpeed * dt;
    }

    const maxMoveAmount = options.maxMove || 300;
    const mouseDelta = (mouseX / window.innerWidth) * maxMoveAmount - maxMoveAmount / 2;
    const inertiaMultipliers = [1.2, 0.95, 0.8, 0.7, 1.1, 0.85];

    rowElements.forEach((row, index) => {
      // index % 2 === 0: Grid 1 (even rows) -> direction = 1
      // index % 2 === 1: Grid 2 (odd rows) -> direction = -1
      const direction = index % 2 === 0 ? 1 : -1;
      const factor = Math.min(1, dt * 8 * inertiaMultipliers[index % inertiaMultipliers.length]);
      rowScrollOffsets[index] += (targetScrollOffset - rowScrollOffsets[index]) * factor;

      const rawX = (rowScrollOffsets[index] + autoOffset + mouseDelta) * direction;

      // Mathematically seamless infinite wrap centered around 0
      const wrappedX = (((rawX + lw / 2) % lw) + lw) % lw - lw / 2;

      row.style.transform = `translate3d(${wrappedX}px, 0, 0)`;
    });
  };

  gsap.ticker.add(updateMotion);

  const resetScroll = () => {
    targetScrollOffset = 0;
    autoOffset = 0;
    for (let i = 0; i < rowScrollOffsets.length; i++) {
      rowScrollOffsets[i] = 0;
    }
  };

  const updateOptions = (nextOptions = {}) => {
    if (!nextOptions || typeof nextOptions !== 'object' || destroyed) return;
    const prevPicturesJson = JSON.stringify(options.customPictures);
    const prevGradient = options.gradientColor;
    const prevScale = options.scale;
    const prevAspectRatio = options.aspectRatio;

    Object.assign(options, nextOptions);

    if (prevPicturesJson !== JSON.stringify(options.customPictures)) {
      updateCardContents();
    }
    if (prevGradient !== options.gradientColor) {
      applyGradient();
    }
    if (prevScale !== options.scale) {
      applyScale();
    }
    if (prevAspectRatio !== options.aspectRatio) {
      applyAspectRatio();
      measureLoop();
    }
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;

    if (persistScaleTimer) {
      clearTimeout(persistScaleTimer);
      persistScaleTimer = null;
      if (window.hybridAPI?.db?.setPreference) {
        const latestOpts = window.__hybridWelcomeEffectsState?.bgOpts_gridmotion;
        if (latestOpts) {
          window.hybridAPI.db.setPreference('bgOpts_gridmotion', JSON.stringify(latestOpts)).catch(() => {});
        }
      }
    }

    gsap.ticker.remove(updateMotion);
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('resize', handleResize);
    if (isMainMount) {
      window.removeEventListener('wheel', handleWheel);
    }

    rowElements.forEach(row => gsap.killTweensOf(row));

    if (section.parentElement === containerElement) {
      containerElement.removeChild(section);
    }
    gridMotiondbg(`${LOG_TAG} destroyed`);
  };

  const getOptions = () => ({ ...options });

  return { destroy, updateOptions, resetScroll, getOptions };
}

function ensureMount() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (!welcomeScreen) return null;

  let mount = document.getElementById('gridMotionMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'gridMotionMount';
    mount.className = 'gridmotion-mount';
    mount.setAttribute('aria-hidden', 'true');
    welcomeScreen.prepend(mount);
  }

  return mount;
}

export async function createGridMotion(options = {}) {
  if (activeInstance) return activeInstance;
  if (createPromise) return createPromise;
  destroyAfterCreate = false;

  createPromise = (async () => {
    const mount = options.mount || ensureMount();
    if (!mount) throw new Error('Could not find #welcomeScreen to mount grid motion.');

    const instance = initGridMotion(mount, {
      ...options,
    });

    activeInstance = instance;
    if (destroyAfterCreate) {
      destroyAfterCreate = false;
      destroyGridMotion();
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

let teardownTimer = null;

export function destroyGridMotion() {
  if (teardownTimer) {
    clearTimeout(teardownTimer);
    teardownTimer = null;
  }
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
  const shouldRunGridMotion = visible && background === 'gridmotion';

  if (shouldRunGridMotion) {
    if (teardownTimer) {
      clearTimeout(teardownTimer);
      teardownTimer = null;
    }
    const userOpts = welcomeState.bgOpts_gridmotion || {};
    const quality = getWelcomeQuality(welcomeState);
    const mapped = {};
    if (userOpts.gradientColor !== undefined) mapped.gradientColor = userOpts.gradientColor;
    if (userOpts.speed !== undefined) mapped.speed = userOpts.speed;
    if (userOpts.maxMove !== undefined) mapped.maxMove = userOpts.maxMove;
    if (userOpts.scale !== undefined) mapped.scale = Number(userOpts.scale);
    if (userOpts.aspectRatio !== undefined) mapped.aspectRatio = userOpts.aspectRatio;
    if (userOpts.autoMove !== undefined) mapped.autoMove = Boolean(userOpts.autoMove);
    if (userOpts.customPictures !== undefined) mapped.customPictures = userOpts.customPictures;
    mapped.pauseWhenUnfocused = true;

    if (activeInstance?.updateOptions) {
      activeInstance.updateOptions(mapped);
      return;
    }

    try {
      await createGridMotion(mapped);
    } catch (error) {
      console.error(`${LOG_TAG} failed to create instance`, error);
    }
    return;
  }

  // Fade-out grace period for smooth crossfading
  if (!teardownTimer && activeInstance) {
    teardownTimer = setTimeout(() => {
      teardownTimer = null;
      const ws = document.getElementById('welcomeScreen');
      const isVisible = ws && !ws.classList.contains('hidden');
      const currentBg = window.__hybridWelcomeEffectsState?.welcomeBackground || 'dither';
      if (!isVisible || currentBg !== 'gridmotion') {
        destroyGridMotion();
      }
    }, 360);
  } else if (!activeInstance) {
    destroyGridMotion();
  }
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
      Object.prototype.hasOwnProperty.call(event.detail, 'bgOpts_gridmotion') ||
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
    destroyGridMotion();
  });

  syncLifecycleState();
}

if (typeof window !== 'undefined') {
  window.HybridGridMotion = {
    createGridMotion,
    destroyGridMotion,
    initGridMotion,
    resetScroll: () => activeInstance?.resetScroll?.(),
    setScale: (scale) => {
      if (!activeInstance) return;
      activeInstance.updateOptions({ scale });
    },
    setAspectRatio: (aspectRatio) => {
      if (!activeInstance) return;
      activeInstance.updateOptions({ aspectRatio });
    },
    updateOptions: (opts) => {
      if (!activeInstance) return;
      activeInstance.updateOptions(opts);
    },
    getOptions: () => activeInstance?.getOptions?.() || {},
    toggleAutoMove: () => {
      if (!activeInstance) return false;
      const cur = Boolean(activeInstance.getOptions?.().autoMove);
      activeInstance.updateOptions({ autoMove: !cur });
      return !cur;
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLifecycle, { once: true });
  } else {
    bootLifecycle();
  }
}

export default initGridMotion;
