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
  customPictures: [],
  dpr: null,
  pauseWhenUnfocused: true,
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
      gap: 1.25rem;
      flex: none;
      position: relative;
      width: 140vw;
      height: 140vh;
      display: grid;
      grid-template-rows: repeat(4, 1fr);
      grid-template-columns: 100%;
      transform: rotate(-12deg);
      transform-origin: center center;
      z-index: 2;
    }
    .grid-motion-row {
      display: grid;
      gap: 1.25rem;
      grid-template-columns: repeat(7, 1fr);
      will-change: transform;
    }
    .grid-motion-item {
      position: relative;
      overflow: hidden;
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
      position: absolute;
      inset: 0;
      opacity: 0.85;
      transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s;
    }
    .grid-motion-item-inner:hover .grid-motion-item-img {
      transform: scale(1.06);
      opacity: 1.0;
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

  // Build 4 rows with 7 columns each
  for (let r = 0; r < 4; r++) {
    const row = document.createElement('div');
    row.className = 'grid-motion-row';
    container.appendChild(row);
    rowElements.push(row);

    for (let c = 0; c < 7; c++) {
      const itemIndex = r * 7 + c;
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
      cardElements.push({ inner, imgDiv, textDiv, index: itemIndex });
    }
  }

  let mouseX = window.innerWidth / 2;
  let destroyed = false;

  const updateCardContents = () => {
    const hasPics = Array.isArray(options.customPictures) && options.customPictures.length > 0;
    cardElements.forEach(({ inner, imgDiv, textDiv, index }) => {
      if (hasPics) {
        const pic = options.customPictures[index % options.customPictures.length];
        imgDiv.style.backgroundImage = `url(${pic})`;
        imgDiv.style.display = 'block';
        textDiv.textContent = '';
        inner.style.background = '#111';
      } else {
        imgDiv.style.backgroundImage = '';
        imgDiv.style.display = 'none';
        textDiv.textContent = CARD_TEXTS[index % CARD_TEXTS.length];
        inner.style.background = DEFAULT_GRADIENTS[index % DEFAULT_GRADIENTS.length];
      }
    });
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
    if (options.pauseWhenUnfocused && !isAppInteractive()) return;

    const maxMoveAmount = options.maxMove;
    const baseDuration = 0.8 / options.speed;
    const inertiaFactors = [0.6, 0.4, 0.3, 0.2];

    rowElements.forEach((row, index) => {
      const direction = index % 2 === 0 ? 1 : -1;
      const moveAmount = ((mouseX / window.innerWidth) * maxMoveAmount - maxMoveAmount / 2) * direction;

      gsap.to(row, {
        x: moveAmount,
        duration: baseDuration + inertiaFactors[index % inertiaFactors.length],
        ease: 'power3.out',
        overwrite: 'auto',
      });
    });
  };

  const removeAnimationLoop = gsap.ticker.add(updateMotion);

  const updateOptions = (nextOptions = {}) => {
    if (!nextOptions || typeof nextOptions !== 'object' || destroyed) return;
    const prevPicturesJson = JSON.stringify(options.customPictures);
    const prevGradient = options.gradientColor;

    Object.assign(options, nextOptions);

    if (prevPicturesJson !== JSON.stringify(options.customPictures)) {
      updateCardContents();
    }
    if (prevGradient !== options.gradientColor) {
      applyGradient();
    }
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;

    removeAnimationLoop();
    window.removeEventListener('mousemove', handleMouseMove);

    rowElements.forEach(row => gsap.killTweensOf(row));

    if (section.parentElement === containerElement) {
      containerElement.removeChild(section);
    }
    gridMotiondbg(`${LOG_TAG} destroyed`);
  };

  return { destroy, updateOptions };
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

export function destroyGridMotion() {
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
    const userOpts = welcomeState.bgOpts_gridmotion || {};
    const quality = getWelcomeQuality(welcomeState);
    const mapped = {};
    if (userOpts.gradientColor !== undefined) mapped.gradientColor = userOpts.gradientColor;
    if (userOpts.speed !== undefined) mapped.speed = userOpts.speed;
    if (userOpts.maxMove !== undefined) mapped.maxMove = userOpts.maxMove;
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

  destroyGridMotion();
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
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLifecycle, { once: true });
  } else {
    bootLifecycle();
  }
}

export default initGridMotion;
