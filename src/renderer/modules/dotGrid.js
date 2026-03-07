import { gsap } from 'gsap';
import { InertiaPlugin } from 'gsap/InertiaPlugin';

gsap.registerPlugin(InertiaPlugin);

const LOG_TAG = '[DotGrid]';

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
  dotSize: 5,
  gap: 10,
  baseColor: '#271E37',
  activeColor: '#5227FF',
  proximity: 120,
  speedTrigger: 100,
  shockRadius: 250,
  shockStrength: 5,
  maxSpeed: 5000,
  resistance: 750,
  returnDuration: 1.5,
});

let activeInstance = null;
let createPromise = null;
let destroyAfterCreate = false;
let lifecycleObserver = null;
let lifecycleBooted = false;
let welcomeSettingsListener = null;

export function initDotGrid(containerElement, customOptions = {}) {
  if (!(containerElement instanceof HTMLElement)) {
    throw new Error(`${LOG_TAG} initDotGrid requires a valid container HTMLElement.`);
  }

  const options = { ...DEFAULT_OPTIONS, ...customOptions };

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
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    lastTime: 0,
    lastX: 0,
    lastY: 0,
  };

  const baseRgb = hexToRgb(options.baseColor);
  const activeRgb = hexToRgb(options.activeColor);

  let destroyed = false;
  let rafId = 0;
  let resizeObserver = null;
  let usesWindowResizeFallback = false;
  let throttledMove = null;

  const circlePath = (() => {
    if (!window.Path2D) return null;
    const p = new window.Path2D();
    p.arc(0, 0, options.dotSize / 2, 0, Math.PI * 2);
    return p;
  })();

  const buildGrid = () => {
    if (destroyed) return;
    const { width, height } = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(dpr, dpr);

    const cols = Math.floor((width + options.gap) / (options.dotSize + options.gap));
    const rows = Math.floor((height + options.gap) / (options.dotSize + options.gap));
    const cell = options.dotSize + options.gap;

    const gridW = cell * cols - options.gap;
    const gridH = cell * rows - options.gap;

    const extraX = width - gridW;
    const extraY = height - gridH;

    const startX = extraX / 2 + options.dotSize / 2;
    const startY = extraY / 2 + options.dotSize / 2;

    dots.length = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cx = startX + x * cell;
        const cy = startY + y * cell;
        dots.push({ cx, cy, xOffset: 0, yOffset: 0, _inertiaApplied: false });
      }
    }
  };

  const proxSq = options.proximity * options.proximity;

  const draw = () => {
    if (destroyed) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      rafId = requestAnimationFrame(draw);
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const { x: px, y: py } = pointer;

    for (const dot of dots) {
      const ox = dot.cx + dot.xOffset;
      const oy = dot.cy + dot.yOffset;
      const dx = dot.cx - px;
      const dy = dot.cy - py;
      const dsq = dx * dx + dy * dy;

      let style = options.baseColor;
      if (dsq <= proxSq) {
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
        dot._inertiaApplied = true;
        gsap.killTweensOf(dot);
        const pushX = dot.cx - pr.x + vx * 0.005;
        const pushY = dot.cy - pr.y + vy * 0.005;
        gsap.to(dot, {
          inertia: { xOffset: pushX, yOffset: pushY, resistance: options.resistance },
          onComplete: () => {
            gsap.to(dot, {
              xOffset: 0,
              yOffset: 0,
              duration: options.returnDuration,
              ease: 'elastic.out(1,0.75)',
            });
            dot._inertiaApplied = false;
          },
        });
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
        dot._inertiaApplied = true;
        gsap.killTweensOf(dot);
        const falloff = Math.max(0, 1 - dist / options.shockRadius);
        const pushX = (dot.cx - cx) * options.shockStrength * falloff;
        const pushY = (dot.cy - cy) * options.shockStrength * falloff;
        gsap.to(dot, {
          inertia: { xOffset: pushX, yOffset: pushY, resistance: options.resistance },
          onComplete: () => {
            gsap.to(dot, {
              xOffset: 0,
              yOffset: 0,
              duration: options.returnDuration,
              ease: 'elastic.out(1,0.75)',
            });
            dot._inertiaApplied = false;
          },
        });
      }
    }
  };

  buildGrid();

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(buildGrid);
    resizeObserver.observe(wrap);
  } else {
    usesWindowResizeFallback = true;
    window.addEventListener('resize', buildGrid);
  }

  throttledMove = throttle(onMove, 50);
  window.addEventListener('mousemove', throttledMove, { passive: true });
  window.addEventListener('click', onClick);

  rafId = requestAnimationFrame(draw);

  console.log(`${LOG_TAG} init`, {
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

    console.log(`${LOG_TAG} destroy`, {
      rafStopped: true,
      resizeObserverDisconnected: true,
      listenersRemoved: true,
      tweensKilled: dots.length,
      canvasRemoved: !canvas.parentElement,
    });
  };

  return { destroy, canvas, wrap, section };
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
    const mapped = {};
    if (userOpts.dotSize !== undefined) mapped.dotSize = userOpts.dotSize;
    if (userOpts.gap !== undefined) mapped.gap = userOpts.gap;
    if (userOpts.baseColor !== undefined) mapped.baseColor = userOpts.baseColor;
    if (userOpts.activeColor !== undefined) mapped.activeColor = userOpts.activeColor;
    if (userOpts.proximity !== undefined) mapped.proximity = userOpts.proximity;
    if (userOpts.shockRadius !== undefined) mapped.shockRadius = userOpts.shockRadius;

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
    if (Object.prototype.hasOwnProperty.call(event.detail, 'bgOpts_dotgrid')) {
      destroyDotGrid();
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
