import * as THREE from 'three';

const LOG_TAG = '[PixelBlast]';
const PIXEL_BLAST_DEBUG = false;

function pixelBlastdbg(...args) {
  if (PIXEL_BLAST_DEBUG) console.log(...args);
}

const DEFAULT_OPTIONS = Object.freeze({
  pixelSize: 6,
  density: 1.0,
  scale: 2.0,
  color: '#B497CF',
  shapeType: 'diamond',
  speed: 0.5,
  rippleSpeed: 0.3,
  rippleThickness: 0.1,
  rippleIntensityScale: 1.0,
  edgeFade: 0.5,
  dpr: null,
  pauseWhenUnfocused: true,
});

const MAX_CLICKS = 10;
const SHAPE_MAP = {
  square: 0,
  circle: 1,
  triangle: 2,
  diamond: 3,
};
const SHAPE_DIAMOND = 3; // React Bits diamond shape variant

const VERTEX_SRC = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const FRAGMENT_SRC = `
precision highp float;

uniform vec3  uColor;
uniform vec2  uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uScale;
uniform float uDensity;
uniform float uPixelJitter;
uniform int   uEnableRipples;
uniform float uRippleSpeed;
uniform float uRippleThickness;
uniform float uRippleIntensity;
uniform float uEdgeFade;
uniform int   uShapeType;

const int SHAPE_SQUARE   = 0;
const int SHAPE_CIRCLE   = 1;
const int SHAPE_TRIANGLE = 2;
const int SHAPE_DIAMOND  = 3;

const int   MAX_CLICKS = 10;

uniform vec2  uClickPos  [MAX_CLICKS];
uniform float uClickTimes[MAX_CLICKS];

out vec4 fragColor;

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2. + a.y * a.y * .75);
}
#define Bayer4(a) (Bayer2(.5*(a))*0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(.5*(a))*0.25 + Bayer2(a))

#define FBM_OCTAVES     5
#define FBM_LACUNARITY  1.25
#define FBM_GAIN        1.0

float hash11(float n){ return fract(sin(n)*43758.5453); }

float vnoise(vec3 p){
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n100 = hash11(dot(ip + vec3(1.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n010 = hash11(dot(ip + vec3(0.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n110 = hash11(dot(ip + vec3(1.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n001 = hash11(dot(ip + vec3(0.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n101 = hash11(dot(ip + vec3(1.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n011 = hash11(dot(ip + vec3(0.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  float n111 = hash11(dot(ip + vec3(1.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  vec3 w = fp*fp*fp*(fp*(fp*6.0-15.0)+10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0  = mix(x00, x10, w.y);
  float y1  = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(vec2 uv, float t){
  vec3 p = vec3(uv * uScale, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < FBM_OCTAVES; ++i){
    sum  += amp * vnoise(p * freq);
    freq *= FBM_LACUNARITY;
    amp  *= FBM_GAIN;
  }
  return sum * 0.5 + 0.5;
}

float maskCircle(vec2 p, float cov){
  float r = sqrt(cov) * .25;
  float d = length(p - 0.5) - r;
  float aa = 0.5 * fwidth(d);
  return cov * (1.0 - smoothstep(-aa, aa, d * 2.0));
}

float maskTriangle(vec2 p, vec2 id, float cov){
  bool flip = mod(id.x + id.y, 2.0) > 0.5;
  if (flip) p.x = 1.0 - p.x;
  float r = sqrt(cov);
  float d  = p.y - r*(1.0 - p.x);
  float aa = fwidth(d);
  return cov * clamp(0.5 - d/aa, 0.0, 1.0);
}

float maskDiamond(vec2 p, float cov){
  float r = sqrt(cov) * 0.564;
  return step(abs(p.x - 0.49) + abs(p.y - 0.49), r);
}

void main(){
  float pixelSize = uPixelSize;
  vec2 fragCoord = gl_FragCoord.xy - uResolution * .5;
  float aspectRatio = uResolution.x / uResolution.y;

  vec2 pixelId = floor(fragCoord / pixelSize);
  vec2 pixelUV = fract(fragCoord / pixelSize);

  float cellPixelSize = 8.0 * pixelSize;
  vec2 cellId = floor(fragCoord / cellPixelSize);
  vec2 cellCoord = cellId * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

  float base = fbm2(uv, uTime * 0.05);
  base = base * 0.5 - 0.65;

  float feed = base + (uDensity - 0.5) * 0.3;

  float speed     = uRippleSpeed;
  float thickness = uRippleThickness;
  const float dampT     = 1.0;
  const float dampR     = 10.0;

  if (uEnableRipples == 1) {
    for (int i = 0; i < MAX_CLICKS; ++i){
      vec2 pos = uClickPos[i];
      if (pos.x < 0.0) continue;
      float cellPixelSize = 8.0 * pixelSize;
      vec2 cuv = (((pos - uResolution * .5 - cellPixelSize * .5) / (uResolution))) * vec2(aspectRatio, 1.0);
      float t = max(uTime - uClickTimes[i], 0.0);
      float r = distance(uv, cuv);
      float waveR = speed * t;
      float ring  = exp(-pow((r - waveR) / thickness, 2.0));
      float atten = exp(-dampT * t) * exp(-dampR * r);
      feed = max(feed, ring * atten * uRippleIntensity);
    }
  }

  float bayer = Bayer8(fragCoord / uPixelSize) - 0.5;
  float bw = step(0.5, feed + bayer);

  float h = fract(sin(dot(floor(fragCoord / uPixelSize), vec2(127.1, 311.7))) * 43758.5453);
  float jitterScale = 1.0 + (h - 0.5) * uPixelJitter;
  float coverage = bw * jitterScale;
  float M;
  if      (uShapeType == SHAPE_CIRCLE)   M = maskCircle (pixelUV, coverage);
  else if (uShapeType == SHAPE_TRIANGLE) M = maskTriangle(pixelUV, pixelId, coverage);
  else if (uShapeType == SHAPE_DIAMOND)  M = maskDiamond(pixelUV, coverage);
  else                                   M = coverage;

  if (uEdgeFade > 0.0) {
    vec2 norm = gl_FragCoord.xy / uResolution;
    float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
    float fade = smoothstep(0.0, uEdgeFade, edge);
    M *= fade;
  }

  vec3 color = uColor;

  // sRGB gamma correction
  vec3 srgbColor = mix(
    color * 12.92,
    1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
    step(0.0031308, color)
  );

  fragColor = vec4(srgbColor, M);
}
`;

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

function isAppInteractive() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

export function initPixelBlast(containerElement, customOptions = {}) {
  if (!(containerElement instanceof HTMLElement)) {
    throw new Error(`${LOG_TAG} initPixelBlast requires a valid container HTMLElement.`);
  }

  const options = { ...DEFAULT_OPTIONS, ...customOptions };
  if (!(typeof options.dpr === 'number' && Number.isFinite(options.dpr) && options.dpr > 0)) {
    options.dpr = getQualityDpr(getWelcomeQuality());
  }

  const section = document.createElement('section');
  section.className = 'pixel-blast';
  section.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;width:100%;position:relative;overflow:hidden;';

  const wrap = document.createElement('div');
  wrap.className = 'pixel-blast__wrap';
  wrap.style.cssText = 'width:100%;height:100%;position:relative;';

  const canvas = document.createElement('canvas');
  canvas.className = 'pixel-blast__canvas';
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';

  wrap.appendChild(canvas);
  section.appendChild(wrap);
  containerElement.appendChild(section);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.setPixelRatio(options.dpr);
  renderer.setClearAlpha(0);

  const uniforms = {
    uResolution: { value: new THREE.Vector2(0, 0) },
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(options.color) },
    uClickPos: {
      value: Array.from({ length: MAX_CLICKS }, () => new THREE.Vector2(-1, -1)),
    },
    uClickTimes: { value: new Float32Array(MAX_CLICKS) },
    uShapeType: { value: SHAPE_MAP[options.shapeType] !== undefined ? SHAPE_MAP[options.shapeType] : SHAPE_DIAMOND },
    uPixelSize: { value: options.pixelSize * renderer.getPixelRatio() },
    uScale: { value: options.scale },
    uDensity: { value: options.density },
    uPixelJitter: { value: 0 },
    uEnableRipples: { value: 1 },
    uRippleSpeed: { value: options.rippleSpeed },
    uRippleThickness: { value: options.rippleThickness },
    uRippleIntensity: { value: options.rippleIntensityScale },
    uEdgeFade: { value: options.edgeFade },
  };

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SRC,
    fragmentShader: FRAGMENT_SRC,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    glslVersion: THREE.GLSL3,
  });

  const quadGeom = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeom, material);
  scene.add(quad);

  const clock = new THREE.Clock();
  const timeOffset = Math.random() * 1000;
  let destroyed = false;
  let rafId = 0;
  let clickIx = 0;
  let resizeObserver = null;
  let usesWindowResizeFallback = false;

  const buildLayout = () => {
    if (destroyed) return;
    const { width, height } = wrap.getBoundingClientRect();
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    renderer.setSize(w, h, false);
    uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
    uniforms.uPixelSize.value = options.pixelSize * renderer.getPixelRatio();
  };

  buildLayout();

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(buildLayout);
    resizeObserver.observe(wrap);
  } else {
    usesWindowResizeFallback = true;
    window.addEventListener('resize', buildLayout);
  }

  const mapToPixels = (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const fx = (e.clientX - rect.left) * scaleX;
    const fy = (rect.height - (e.clientY - rect.top)) * scaleY;
    return { fx, fy };
  };

  const onPointerDown = (e) => {
    if (destroyed) return;
    const { fx, fy } = mapToPixels(e);
    const ix = clickIx;
    uniforms.uClickPos.value[ix].set(fx, fy);
    uniforms.uClickTimes.value[ix] = uniforms.uTime.value;
    clickIx = (ix + 1) % MAX_CLICKS;
  };

  window.addEventListener('pointerdown', onPointerDown, { passive: true });

  const draw = () => {
    if (destroyed) return;
    if (options.pauseWhenUnfocused && !isAppInteractive()) {
      rafId = requestAnimationFrame(draw);
      return;
    }

    uniforms.uTime.value = timeOffset + clock.getElapsedTime() * options.speed;
    renderer.render(scene, camera);

    rafId = requestAnimationFrame(draw);
    window.HybridPerfMonitor?.markFrame?.('effect:pixelblast');
  };

  rafId = requestAnimationFrame(draw);

  const updateOptions = (nextOptions = {}) => {
    if (!nextOptions || typeof nextOptions !== 'object' || destroyed) return;
    const prevPixelSize = options.pixelSize;
    const prevDpr = options.dpr;
    const prevShape = options.shapeType;

    Object.assign(options, nextOptions);
    if (!(typeof options.dpr === 'number' && Number.isFinite(options.dpr) && options.dpr > 0)) {
      options.dpr = getQualityDpr(getWelcomeQuality());
    }

    if (prevDpr !== options.dpr) {
      renderer.setPixelRatio(options.dpr);
      buildLayout();
    } else if (prevPixelSize !== options.pixelSize) {
      uniforms.uPixelSize.value = options.pixelSize * renderer.getPixelRatio();
    }

    if (prevShape !== options.shapeType) {
      uniforms.uShapeType.value = SHAPE_MAP[options.shapeType] !== undefined ? SHAPE_MAP[options.shapeType] : SHAPE_DIAMOND;
    }

    uniforms.uColor.value.set(options.color);
    uniforms.uScale.value = options.scale;
    uniforms.uDensity.value = options.density;
  };

  pixelBlastdbg(`${LOG_TAG} init`, {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    dpr: renderer.getPixelRatio(),
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
      window.removeEventListener('resize', buildLayout);
      usesWindowResizeFallback = false;
    }

    window.removeEventListener('pointerdown', onPointerDown);

    quadGeom.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();

    if (canvas.parentElement) {
      canvas.parentElement.removeChild(canvas);
    }
    if (wrap.parentElement === section) {
      section.removeChild(wrap);
    }
    if (section.parentElement === containerElement) {
      containerElement.removeChild(section);
    }

    pixelBlastdbg(`${LOG_TAG} destroy`, {
      rafStopped: true,
      rendererDisposed: true,
    });
  };

  return { destroy, updateOptions, canvas, wrap, section };
}

function ensureMount() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (!welcomeScreen) return null;

  let mount = document.getElementById('pixelBlastMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'pixelBlastMount';
    mount.className = 'pixelblast-mount';
    mount.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:auto;';
    mount.setAttribute('aria-hidden', 'true');

    // Insert it at the back (first child) so it is behind other welcome elements
    welcomeScreen.prepend(mount);
  }

  return mount;
}

export async function createPixelBlast(options = {}) {
  if (activeInstance) return activeInstance;
  if (createPromise) return createPromise;
  destroyAfterCreate = false;

  createPromise = (async () => {
    const mount = options.mount || ensureMount();
    if (!mount) throw new Error('Could not find #welcomeScreen to mount pixel blast.');

    const instance = initPixelBlast(mount, {
      ...options,
    });

    activeInstance = instance;
    if (destroyAfterCreate) {
      destroyAfterCreate = false;
      destroyPixelBlast();
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

export function destroyPixelBlast() {
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
  const shouldRunPixelBlast = visible && background === 'pixelblast';

  if (shouldRunPixelBlast) {
    const userOpts = welcomeState.bgOpts_pixelblast || {};
    const quality = getWelcomeQuality(welcomeState);
    const mapped = {};
    if (userOpts.pixelSize !== undefined) mapped.pixelSize = userOpts.pixelSize;
    if (userOpts.density !== undefined) mapped.density = userOpts.density;
    if (userOpts.scale !== undefined) mapped.scale = userOpts.scale;
    if (userOpts.color !== undefined) mapped.color = userOpts.color;
    if (userOpts.shapeType !== undefined) mapped.shapeType = userOpts.shapeType;
    mapped.dpr = getQualityDpr(quality);
    mapped.pauseWhenUnfocused = true;

    if (activeInstance?.updateOptions) {
      activeInstance.updateOptions(mapped);
      return;
    }

    try {
      await createPixelBlast(mapped);
    } catch (error) {
      console.error(`${LOG_TAG} failed to create instance`, error);
    }
    return;
  }

  destroyPixelBlast();
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
      Object.prototype.hasOwnProperty.call(event.detail, 'bgOpts_pixelblast') ||
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
    destroyPixelBlast();
  });

  syncLifecycleState();
}

if (typeof window !== 'undefined') {
  window.HybridPixelBlast = {
    createPixelBlast,
    destroyPixelBlast,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLifecycle, { once: true });
  } else {
    bootLifecycle();
  }
}

export default initPixelBlast;
