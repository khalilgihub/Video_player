import { gsap } from 'gsap';
import { InertiaPlugin } from 'gsap/InertiaPlugin.js';

gsap.registerPlugin(InertiaPlugin);

const LOG_TAG = '[DotGrid]';
const DOT_GRID_DEBUG = false;

function dotGriddbg(...args) {
  if (DOT_GRID_DEBUG) console.log(...args);
}

const throttle = (func, limit) => {
  let lastCall = 0;
  return function (...args) {
    const now = performance.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      func.apply(this, args);
    }
  };
};

function hexToRgb(hex) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

const DEFAULT_OPTIONS = Object.freeze({
  dotSize: 16,
  gap: 32,
  baseColor: '#5227FF',
  activeColor: '#5227FF',
  proximity: 150,
  speedTrigger: 100,
  shockRadius: 250,
  shockStrength: 5,
  maxSpeed: 5000,
  resistance: 750,
  returnDuration: 1.5,
  dpr: null,
  pointerThrottleMs: 50,
  pauseWhenUnfocused: true,
});

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

function getQualityDpr(quality) {
  const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  if (quality === 'low') return Math.min(deviceDpr, 0.8);
  if (quality === 'medium') return Math.min(deviceDpr, 1.0);
  return Math.min(deviceDpr, 1.4);
}

function getPointerThrottleMs(quality) {
  if (quality === 'low') return 72;
  if (quality === 'medium') return 56;
  return 42;
}

function isAppInteractive() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function initDotGrid(containerElement, customOptions = {}) {
  if (!(containerElement instanceof HTMLElement)) {
    throw new Error(`${LOG_TAG} initDotGrid requires a valid container HTMLElement.`);
  }

  const options = { ...DEFAULT_OPTIONS, ...customOptions };
  if (!(typeof options.dpr === 'number' && Number.isFinite(options.dpr) && options.dpr > 0)) {
    options.dpr = getQualityDpr(getWelcomeQuality());
  }

  const section = document.createElement('section');
  section.className = 'dot-grid';
  section.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;width:100%;position:relative;';

  const wrap = document.createElement('div');
  wrap.className = 'dot-grid__wrap';
  wrap.style.cssText = 'width:100%;height:100%;position:relative;';

  const canvas = document.createElement('canvas');
  canvas.className = 'dot-grid__canvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';

  wrap.appendChild(canvas);
  section.appendChild(wrap);
  containerElement.appendChild(section);

  const dots = [];
  const pointer = {
    x: Number.NaN,
    y: Number.NaN,
    vx: 0,
    vy: 0,
    speed: 0,
    lastTime: 0,
    lastX: 0,
    lastY: 0,
  };

  let baseRgb = hexToRgb(options.baseColor);
  let activeRgb = hexToRgb(options.activeColor);
  let proxSq = options.proximity * options.proximity;

  let destroyed = false;
  let rafId = 0;
  let resizeObserver = null;
  let usesWindowResizeFallback = false;
  let throttledMove = null;

  const createCirclePath = () => {
    if (!window.Path2D) return null;
    const p = new window.Path2D();
    p.arc(0, 0, options.dotSize / 2, 0, Math.PI * 2);
    return p;
  };
  let circlePath = createCirclePath();

  const buildGrid = () => {
    if (destroyed) return;
    for (const dot of dots) {
      gsap.killTweensOf(dot);
    }

    const { width: rawWidth, height: rawHeight } = wrap.getBoundingClientRect();
    const width = Math.max(0, rawWidth);
    const height = Math.max(0, rawHeight);
    const dpr = options.dpr || window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);

    dots.length = 0;
    if (width <= 0 || height <= 0) return;

    const cols = Math.max(1, Math.floor((width + options.gap) / (options.dotSize + options.gap)));
    const rows = Math.max(1, Math.floor((height + options.gap) / (options.dotSize + options.gap)));
    const cell = options.dotSize + options.gap;

    const gridW = cell * cols - options.gap;
    const gridH = cell * rows - options.gap;

    const extraX = width - gridW;
    const extraY = height - gridH;

    const startX = extraX / 2 + options.dotSize / 2;
    const startY = extraY / 2 + options.dotSize / 2;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cx = startX + x * cell;
        const cy = startY + y * cell;
        dots.push({ cx, cy, xOffset: 0, yOffset: 0, _inertiaApplied: false });
      }
    }
  };

  const draw = () => {
    if (destroyed) return;
    if (options.pauseWhenUnfocused && !isAppInteractive()) {
      rafId = requestAnimationFrame(draw);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      rafId = requestAnimationFrame(draw);
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { x: px, y: py } = pointer;
    const pointerActive = Number.isFinite(px) && Number.isFinite(py);

    for (const dot of dots) {
      const ox = dot.cx + dot.xOffset;
      const oy = dot.cy + dot.yOffset;
      const dx = dot.cx - px;
      const dy = dot.cy - py;
      const dsq = dx * dx + dy * dy;

      let style = options.baseColor;
      if (pointerActive && dsq <= proxSq) {
        const dist = Math.sqrt(dsq);
        const t = 1 - dist / options.proximity;
        const r = Math.round(baseRgb.r + (activeRgb.r - baseRgb.r) * t);
        const g = Math.round(baseRgb.g + (activeRgb.g - baseRgb.g) * t);
        const b = Math.round(baseRgb.b + (activeRgb.b - baseRgb.b) * t);
        style = `rgb(${r},${g},${b})`;
      }

      ctx.save();
      ctx.translate(ox, oy);
      ctx.fillStyle = style;
      if (circlePath) {
        ctx.fill(circlePath);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, options.dotSize / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    rafId = requestAnimationFrame(draw);
    window.HybridPerfMonitor?.markFrame?.('effect:dotgrid');
  };

  const animateDotDisplacement = (dot, xVelocity, yVelocity) => {
    if (destroyed) return;
    dot._inertiaApplied = true;
    gsap.killTweensOf(dot);

    gsap.to(dot, {
      inertia: { xOffset: xVelocity, yOffset: yVelocity, resistance: options.resistance },
      onComplete: () => {
        if (destroyed) return;
        gsap.to(dot, {
          xOffset: 0,
          yOffset: 0,
          duration: options.returnDuration,
          ease: 'elastic.out(1,0.75)',
          overwrite: true,
        });
        dot._inertiaApplied = false;
      },
    });
  };

  const onMove = (e) => {
    const now = performance.now();
    const pr = pointer;
    const dt = pr.lastTime ? now - pr.lastTime : 16;
    const dx = e.clientX - pr.lastX;
    const dy = e.clientY - pr.lastY;
    let vx = (dx / dt) * 1000;
    let vy = (dy / dt) * 1000;
    let speed = Math.hypot(vx, vy);

    if (speed > options.maxSpeed) {
      const scale = options.maxSpeed / speed;
      vx *= scale;
      vy *= scale;
      speed = options.maxSpeed;
    }

    pr.lastTime = now;
    pr.lastX = e.clientX;
    pr.lastY = e.clientY;
    pr.vx = vx;
    pr.vy = vy;
    pr.speed = speed;

    const rect = canvas.getBoundingClientRect();
    pr.x = e.clientX - rect.left;
    pr.y = e.clientY - rect.top;

    for (const dot of dots) {
      const dist = Math.hypot(dot.cx - pr.x, dot.cy - pr.y);
      if (speed > options.speedTrigger && dist < options.proximity && !dot._inertiaApplied) {
        const pushX = dot.cx - pr.x + vx * 0.005;
        const pushY = dot.cy - pr.y + vy * 0.005;
        animateDotDisplacement(dot, pushX, pushY);
      }
    }
  };

  const onClick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    for (const dot of dots) {
      const dist = Math.hypot(dot.cx - cx, dot.cy - cy);
      if (dist < options.shockRadius && !dot._inertiaApplied) {
        const falloff = Math.max(0, 1 - dist / options.shockRadius);
        const pushX = (dot.cx - cx) * options.shockStrength * falloff;
        const pushY = (dot.cy - cy) * options.shockStrength * falloff;
        animateDotDisplacement(dot, pushX, pushY);
      }
    }
  };

  const bindPointerMove = (throttleMs) => {
    if (throttledMove) {
      window.removeEventListener('mousemove', throttledMove);
    }
    throttledMove = throttle(onMove, throttleMs);
    window.addEventListener('mousemove', throttledMove, { passive: true });
  };

  const recomputeDerived = ({ rebuild = false } = {}) => {
    baseRgb = hexToRgb(options.baseColor);
    activeRgb = hexToRgb(options.activeColor);
    proxSq = options.proximity * options.proximity;
    circlePath = createCirclePath();
    if (rebuild) buildGrid();
  };

  buildGrid();

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(buildGrid);
    resizeObserver.observe(wrap);
  } else {
    usesWindowResizeFallback = true;
    window.addEventListener('resize', buildGrid);
  }

  bindPointerMove(options.pointerThrottleMs);
  window.addEventListener('click', onClick);

  rafId = requestAnimationFrame(draw);

  const updateOptions = (nextOptions = {}) => {
    if (!nextOptions || typeof nextOptions !== 'object' || destroyed) return;
    const prevDotSize = options.dotSize;
    const prevGap = options.gap;
    const prevDpr = options.dpr;
    const prevBase = options.baseColor;
    const prevActive = options.activeColor;
    const prevProx = options.proximity;
    const prevThrottle = options.pointerThrottleMs;

    Object.assign(options, nextOptions);
    if (!(typeof options.dpr === 'number' && Number.isFinite(options.dpr) && options.dpr > 0)) {
      options.dpr = getQualityDpr(getWelcomeQuality());
    }

    const needsRebuild = prevDotSize !== options.dotSize || prevGap !== options.gap || prevDpr !== options.dpr;
    if (prevBase !== options.baseColor || prevActive !== options.activeColor || prevProx !== options.proximity || needsRebuild) {
      recomputeDerived({ rebuild: needsRebuild });
    }
    if (prevThrottle !== options.pointerThrottleMs) {
      bindPointerMove(options.pointerThrottleMs);
    }
  };

  dotGriddbg(`${LOG_TAG} init`, {
    dots: dots.length,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    dpr: window.devicePixelRatio || 1,
  });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;

    cancelAnimationFrame(rafId);
    rafId = 0;

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (usesWindowResizeFallback) {
      window.removeEventListener('resize', buildGrid);
      usesWindowResizeFallback = false;
    }

    if (throttledMove) {
      window.removeEventListener('mousemove', throttledMove);
    }
    window.removeEventListener('click', onClick);

    for (const dot of dots) {
      gsap.killTweensOf(dot);
    }

    if (canvas.parentElement) {
      canvas.parentElement.removeChild(canvas);
    }
    if (wrap.parentElement === section) {
      section.removeChild(wrap);
    }
    if (section.parentElement === containerElement) {
      containerElement.removeChild(section);
    }

    dotGriddbg(`${LOG_TAG} destroy`, {
      rafStopped: true,
      resizeObserverDisconnected: true,
      listenersRemoved: true,
      tweensKilled: dots.length,
      canvasRemoved: !canvas.parentElement,
    });
  };

  return { destroy, updateOptions, canvas, wrap, section };
}

function ensureMount() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (!welcomeScreen) return null;

  let mount = document.getElementById('dotGridMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'dotGridMount';
    mount.className = 'dotgrid-mount';
    mount.setAttribute('aria-hidden', 'true');

    const lanyardMount = document.getElementById('lanyardMount');
    if (lanyardMount && lanyardMount.parentNode === welcomeScreen) {
      welcomeScreen.insertBefore(mount, lanyardMount);
    } else {
      welcomeScreen.prepend(mount);
    }
  }

  return mount;
}

export async function createDotGrid(options = {}) {
  if (activeInstance) return activeInstance;
  if (createPromise) return createPromise;
  destroyAfterCreate = false;

  createPromise = (async () => {
    const mount = options.mount || ensureMount();
    if (!mount) throw new Error('Could not find #welcomeScreen to mount dot grid.');

    const instance = initDotGrid(mount, {
      ...options,
    });

    activeInstance = instance;
    if (destroyAfterCreate) {
      destroyAfterCreate = false;
      destroyDotGrid();
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

export function destroyDotGrid() {
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
  const shouldRunDotGrid = visible && background === 'dotgrid';

  if (shouldRunDotGrid) {
    const userOpts = welcomeState.bgOpts_dotgrid || {};
    const quality = getWelcomeQuality(welcomeState);
    const mapped = {};
    if (userOpts.dotSize !== undefined) mapped.dotSize = userOpts.dotSize;
    if (userOpts.gap !== undefined) mapped.gap = userOpts.gap;
    if (userOpts.baseColor !== undefined) mapped.baseColor = userOpts.baseColor;
    if (userOpts.activeColor !== undefined) mapped.activeColor = userOpts.activeColor;
    if (userOpts.proximity !== undefined) mapped.proximity = userOpts.proximity;
    if (userOpts.shockRadius !== undefined) mapped.shockRadius = userOpts.shockRadius;
    mapped.dpr = getQualityDpr(quality);
    mapped.pointerThrottleMs = getPointerThrottleMs(quality);
    mapped.pauseWhenUnfocused = true;

    if (activeInstance?.updateOptions) {
      activeInstance.updateOptions(mapped);
      return;
    }

    try {
      await createDotGrid(mapped);
    } catch (error) {
      console.error(`${LOG_TAG} failed to create instance`, error);
    }
    return;
  }

  destroyDotGrid();
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
      Object.prototype.hasOwnProperty.call(event.detail, 'bgOpts_dotgrid') ||
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
    destroyDotGrid();
  });

  syncLifecycleState();
}

if (typeof window !== 'undefined') {
  window.HybridDotGrid = {
    createDotGrid,
    destroyDotGrid,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLifecycle, { once: true });
  } else {
    bootLifecycle();
  }
}

export default initDotGrid;
