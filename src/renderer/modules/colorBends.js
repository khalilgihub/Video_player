import * as THREE from 'three';

const LOG_TAG = '[ColorBends]';
const MAX_COLORS = 8;
const COLOR_BENDS_DEBUG = false;

function colorBendsdbg(...args) {
  if (COLOR_BENDS_DEBUG) console.log(...args);
}

const frag = `
#define MAX_COLORS ${MAX_COLORS}
uniform vec2 uCanvas;
uniform float uTime;
uniform float uSpeed;
uniform vec2 uRot;
uniform int uColorCount;
uniform vec3 uColors[MAX_COLORS];
uniform int uTransparent;
uniform float uScale;
uniform float uFrequency;
uniform float uWarpStrength;
uniform vec2 uPointer; // in NDC [-1,1]
uniform float uMouseInfluence;
uniform float uParallax;
uniform float uNoise;
uniform int uIterations;
uniform float uIntensity;
uniform float uBandWidth;
varying vec2 vUv;

void main() {
  float t = uTime * uSpeed;
  vec2 p = vUv * 2.0 - 1.0;
  p += uPointer * uParallax * 0.1;
  vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
  float aspect = uCanvas.x / uCanvas.y;
  vec2 q = vec2(rp.x * aspect, rp.y);
  float invScale = 1.0 / max(uScale, 0.0001);
  q *= invScale;
  q /= 0.5 + 0.2 * dot(q, q);
  q += (uPointer - rp) * uMouseInfluence * 0.2;
  q += 0.2 * cos(t) - 7.56;

  vec3 col = vec3(0.0);
  float a = 1.0;

  if (uColorCount > 0) {
    vec3 sumCol = vec3(0.0);
    float cover = 0.0;
    for (int i = 0; i < MAX_COLORS; ++i) {
          if (i >= uColorCount) break;
          vec2 s = q - 0.05 * float(i);
          for (int j = 0; j < 5; j++) {
              if (j >= uIterations) break;
              vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
              s = s + (r - s) * uWarpStrength;
          }
          float m = length(s + sin(5.0 * s.y * uFrequency - 3.0 * t + float(i)) * 0.25);
          float w = 1.0 - exp(-6.0 / exp(6.0 * m));
          w = pow(clamp(w, 0.0, 1.0), uBandWidth);
          sumCol += uColors[i] * w;
          cover = max(cover, w);
    }
    col = sumCol;
    a = uTransparent > 0 ? cover : 1.0;
  } else {
      for (int k = 0; k < 3; ++k) {
          vec2 s = q - 0.05 * float(k);
          for (int j = 0; j < 5; j++) {
              if (j >= uIterations) break;
              vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
              s = s + (r - s) * uWarpStrength;
          }
          float m = length(s + sin(5.0 * s.y * uFrequency - 3.0 * t + float(k)) * 0.25);
          float w = 1.0 - exp(-6.0 / exp(6.0 * m));
          col[k] = pow(clamp(w, 0.0, 1.0), uBandWidth);
      }
      a = uTransparent > 0 ? max(max(col.r, col.g), col.b) : 1.0;
  }

  col *= uIntensity;

  if (uNoise > 0.0001) {
    float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
    col += (n - 0.5) * uNoise;
    col = clamp(col, 0.0, 1.0);
  }

  vec3 rgb = (uTransparent > 0) ? col * a : col;
  gl_FragColor = vec4(rgb, a);
}
`;

const vert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

const DEFAULT_OPTIONS = Object.freeze({
  rotation: 90,
  speed: 0.2,
  colors: [],
  transparent: true,
  autoRotate: 0,
  scale: 1,
  frequency: 1,
  warpStrength: 1,
  mouseInfluence: 1,
  parallax: 0.5,
  noise: 0.15,
  iterations: 1,
  intensity: 1.5,
  bandWidth: 6,
  dpr: null,
  pauseWhenUnfocused: true,
  pointerEventTarget: null,
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
  // Keep Color Bends at >=1.0 DPR to avoid shader artifacts/over-blur.
  if (quality === 'low') return Math.min(deviceDpr, 1.0);
  if (quality === 'medium') return Math.min(deviceDpr, 1.2);
  return Math.min(deviceDpr, 1.5);
}

function isAppInteractive() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

function toVec3(hex) {
  const h = String(hex || '').replace('#', '').trim();
  const v =
    h.length === 3
      ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
      : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return new THREE.Vector3((v[0] || 0) / 255, (v[1] || 0) / 255, (v[2] || 0) / 255);
}

function applyColorUniforms(material, colors) {
  const arr = (colors || []).filter(Boolean).slice(0, MAX_COLORS).map(toVec3);
  for (let i = 0; i < MAX_COLORS; i += 1) {
    const vec = material.uniforms.uColors.value[i];
    if (i < arr.length) vec.copy(arr[i]);
    else vec.set(0, 0, 0);
  }
  material.uniforms.uColorCount.value = arr.length;
}

function resolveDpr(customDpr) {
  if (typeof customDpr === 'number' && Number.isFinite(customDpr) && customDpr > 0) {
    return customDpr;
  }
  return Math.min(window.devicePixelRatio || 1, 2);
}

export function initColorBends(containerElement, customOptions = {}) {
  if (!(containerElement instanceof HTMLElement)) {
    throw new Error(`${LOG_TAG} initColorBends(container): containerElement must be an HTMLElement.`);
  }

  const options = { ...DEFAULT_OPTIONS, ...customOptions };
  if (!(typeof options.dpr === 'number' && Number.isFinite(options.dpr) && options.dpr > 0)) {
    options.dpr = getQualityDpr(getWelcomeQuality());
  }
  const pointerEventTarget = options.pointerEventTarget || containerElement;
  const dpr = resolveDpr(options.dpr);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);
  const uColorsArray = Array.from({ length: MAX_COLORS }, () => new THREE.Vector3(0, 0, 0));

  const material = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uCanvas: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uSpeed: { value: options.speed },
      uRot: { value: new THREE.Vector2(1, 0) },
      uColorCount: { value: 0 },
      uColors: { value: uColorsArray },
      uTransparent: { value: options.transparent ? 1 : 0 },
      uScale: { value: options.scale },
      uFrequency: { value: options.frequency },
      uWarpStrength: { value: options.warpStrength },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uMouseInfluence: { value: options.mouseInfluence },
      uParallax: { value: options.parallax },
      uNoise: { value: options.noise },
      uIterations: { value: options.iterations },
      uIntensity: { value: options.intensity },
      uBandWidth: { value: options.bandWidth },
    },
    premultipliedAlpha: true,
    transparent: true,
  });

  applyColorUniforms(material, options.colors);

  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    alpha: true,
  });

  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, options.transparent ? 0 : 1);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';

  containerElement.appendChild(renderer.domElement);

  const pointerTarget = new THREE.Vector2(0, 0);
  const pointerCurrent = new THREE.Vector2(0, 0);
  const pointerSmooth = 8;
  const timer = new THREE.Timer();

  let rafId = 0;
  let destroyed = false;
  let resizeObserver = null;
  let usingWindowResize = false;
  let pointerRafId = 0;
  let pendingPointerClient = null;

  const handleResize = () => {
    if (destroyed) return;
    const w = containerElement.clientWidth || 1;
    const h = containerElement.clientHeight || 1;
    renderer.setSize(w, h, false);
    material.uniforms.uCanvas.value.set(w, h);
  };

  const flushPointer = () => {
    pointerRafId = 0;
    if (!pendingPointerClient || destroyed) return;
    const rect = containerElement.getBoundingClientRect();
    const x = ((pendingPointerClient.x - rect.left) / (rect.width || 1)) * 2 - 1;
    const y = -(((pendingPointerClient.y - rect.top) / (rect.height || 1)) * 2 - 1);
    pointerTarget.set(x, y);
  };

  const handlePointerMove = (event) => {
    if (destroyed) return;
    pendingPointerClient = { x: event.clientX, y: event.clientY };
    if (!pointerRafId) {
      pointerRafId = requestAnimationFrame(flushPointer);
    }
  };

  const renderLoop = () => {
    if (destroyed) return;
    rafId = requestAnimationFrame(renderLoop);
    if (options.pauseWhenUnfocused && !isAppInteractive()) return;

    timer.update();
    const dt = timer.getDelta();
    const elapsed = timer.getElapsed();
    material.uniforms.uTime.value = elapsed;
    material.uniforms.uSpeed.value = options.speed;
    material.uniforms.uScale.value = options.scale;
    material.uniforms.uFrequency.value = options.frequency;
    material.uniforms.uWarpStrength.value = options.warpStrength;
    material.uniforms.uMouseInfluence.value = options.mouseInfluence;
    material.uniforms.uParallax.value = options.parallax;
    material.uniforms.uNoise.value = options.noise;
    material.uniforms.uIterations.value = options.iterations;
    material.uniforms.uIntensity.value = options.intensity;
    material.uniforms.uBandWidth.value = options.bandWidth;

    const deg = (options.rotation % 360) + options.autoRotate * elapsed;
    const rad = (deg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    material.uniforms.uRot.value.set(c, s);

    const amt = Math.min(1, dt * pointerSmooth);
    pointerCurrent.lerp(pointerTarget, amt);
    material.uniforms.uPointer.value.copy(pointerCurrent);

    renderer.render(scene, camera);
    window.HybridPerfMonitor?.markFrame?.('effect:colorbends');
  };

  handleResize();
  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerElement);
  } else {
    usingWindowResize = true;
    window.addEventListener('resize', handleResize);
  }
  pointerEventTarget.addEventListener('pointermove', handlePointerMove, { passive: true });

  colorBendsdbg(`${LOG_TAG} init`, {
    canvasAttached: renderer.domElement.parentElement === containerElement,
    dpr,
    uniformsReady: Object.keys(material.uniforms),
    colorCount: material.uniforms.uColorCount.value,
  });

  rafId = requestAnimationFrame(renderLoop);

  const updateOptions = (nextOptions = {}) => {
    if (!nextOptions || typeof nextOptions !== 'object' || destroyed) return;
    const prevDpr = options.dpr;
    const prevColors = Array.isArray(options.colors) ? options.colors.join('|') : '';
    Object.assign(options, nextOptions);
    if (!(typeof options.dpr === 'number' && Number.isFinite(options.dpr) && options.dpr > 0)) {
      options.dpr = getQualityDpr(getWelcomeQuality());
    }
    if (prevDpr !== options.dpr) {
      renderer.setPixelRatio(resolveDpr(options.dpr));
      handleResize();
    }

    material.uniforms.uTransparent.value = options.transparent ? 1 : 0;
    material.uniforms.uSpeed.value = options.speed;
    material.uniforms.uScale.value = options.scale;
    material.uniforms.uFrequency.value = options.frequency;
    material.uniforms.uWarpStrength.value = options.warpStrength;
    material.uniforms.uMouseInfluence.value = options.mouseInfluence;
    material.uniforms.uParallax.value = options.parallax;
    material.uniforms.uNoise.value = options.noise;
    material.uniforms.uIterations.value = options.iterations;
    material.uniforms.uIntensity.value = options.intensity;
    material.uniforms.uBandWidth.value = options.bandWidth;

    const nextColors = Array.isArray(options.colors) ? options.colors.join('|') : '';
    if (prevColors !== nextColors) {
      applyColorUniforms(material, options.colors);
    }
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (pointerRafId) {
      cancelAnimationFrame(pointerRafId);
      pointerRafId = 0;
    }

    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (usingWindowResize) {
      window.removeEventListener('resize', handleResize);
      usingWindowResize = false;
    }
    pointerEventTarget.removeEventListener('pointermove', handlePointerMove);

    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
    renderer.dispose();

    const canvas = renderer.domElement;
    if (canvas && canvas.parentElement === containerElement) {
      containerElement.removeChild(canvas);
    }
    renderer.forceContextLoss();

    colorBendsdbg(`${LOG_TAG} destroy`, {
      rafStopped: true,
      resizeObserverDisconnected: true,
      pointerListenerRemoved: true,
      geometryDisposed: true,
      materialDisposed: true,
      rendererDisposed: true,
      canvasRemoved: !canvas.parentElement,
      contextLost: true,
    });
  };

  return {
    destroy,
    updateOptions,
    renderer,
    scene,
    camera,
    mesh,
    material,
    geometry,
  };
}

function ensureMount() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (!welcomeScreen) return null;

  let mount = document.getElementById('colorBendsMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'colorBendsMount';
    mount.className = 'colorbends-mount';
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

export async function createColorBends(options = {}) {
  if (activeInstance) return activeInstance;
  if (createPromise) return createPromise;
  destroyAfterCreate = false;

  createPromise = (async () => {
    const mount = options.mount || ensureMount();
    if (!mount) throw new Error('Could not find #welcomeScreen to mount color bends.');

    const welcomeScreen = document.getElementById('welcomeScreen');
    const instance = initColorBends(mount, {
      colors: ['#ff5c7a', '#8a5cff', '#00ffd1'],
      rotation: 90,
      speed: 0.2,
      scale: 1,
      frequency: 1,
      warpStrength: 1,
      mouseInfluence: 1,
      parallax: 0.5,
      noise: 0.15,
      iterations: 1,
      intensity: 1.5,
      bandWidth: 6,
      transparent: true,
      autoRotate: 0,
      ...options,
      pointerEventTarget: options.pointerEventTarget || welcomeScreen || mount,
    });

    activeInstance = instance;
    if (destroyAfterCreate) {
      destroyAfterCreate = false;
      destroyColorBends();
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

export function destroyColorBends() {
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
  const shouldRunColorBends = visible && background === 'colorbends';

  if (shouldRunColorBends) {
    const userOpts = welcomeState.bgOpts_colorbends || {};
    const quality = getWelcomeQuality(welcomeState);
    const mapped = {};
    if (userOpts.speed !== undefined) mapped.speed = userOpts.speed;
    if (userOpts.rotation !== undefined) mapped.rotation = userOpts.rotation;
    if (userOpts.scale !== undefined) mapped.scale = userOpts.scale;
    if (userOpts.frequency !== undefined) mapped.frequency = userOpts.frequency;
    if (userOpts.warp !== undefined) mapped.warpStrength = userOpts.warp;
    if (userOpts.iterations !== undefined) mapped.iterations = userOpts.iterations;
    if (userOpts.intensity !== undefined) mapped.intensity = userOpts.intensity;
    if (userOpts.bandWidth !== undefined) mapped.bandWidth = userOpts.bandWidth;
    if (userOpts.noise !== undefined) mapped.noise = userOpts.noise;
    if (userOpts.parallax !== undefined) mapped.parallax = userOpts.parallax;
    if (userOpts.mouseInfluence !== undefined) mapped.mouseInfluence = userOpts.mouseInfluence;
    const colors = [];
    if (userOpts.color1) colors.push(userOpts.color1);
    if (userOpts.color2) colors.push(userOpts.color2);
    if (userOpts.color3) colors.push(userOpts.color3);
    if (colors.length > 0) mapped.colors = colors;
    mapped.dpr = getQualityDpr(quality);
    mapped.pauseWhenUnfocused = true;

    if (activeInstance?.updateOptions) {
      activeInstance.updateOptions(mapped);
      return;
    }

    try {
      await createColorBends(mapped);
    } catch (error) {
      console.error(`${LOG_TAG} failed to create instance`, error);
    }
    return;
  }

  destroyColorBends();
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
      Object.prototype.hasOwnProperty.call(event.detail, 'bgOpts_colorbends') ||
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
    destroyColorBends();
  });

  syncLifecycleState();
}

if (typeof window !== 'undefined') {
  window.HybridColorBends = {
    createColorBends,
    destroyColorBends,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLifecycle, { once: true });
  } else {
    bootLifecycle();
  }
}

export default initColorBends;
