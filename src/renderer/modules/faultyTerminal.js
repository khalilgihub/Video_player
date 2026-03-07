import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';

const LOG_TAG = '[FaultyTerminal]';

const vertexShader = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragmentShader = `
precision mediump float;

varying vec2 vUv;

uniform float iTime;
uniform vec3  iResolution;
uniform float uScale;

uniform vec2  uGridMul;
uniform float uDigitSize;
uniform float uScanlineIntensity;
uniform float uGlitchAmount;
uniform float uFlickerAmount;
uniform float uNoiseAmp;
uniform float uChromaticAberration;
uniform float uDither;
uniform float uCurvature;
uniform vec3  uTint;
uniform vec2  uMouse;
uniform float uMouseStrength;
uniform float uUseMouse;
uniform float uPageLoadProgress;
uniform float uUsePageLoadAnimation;
uniform float uBrightness;

float time;

float hash21(vec2 p){
  p = fract(p * 234.56);
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}

float noise(vec2 p)
{
  return sin(p.x * 10.0) * sin(p.y * (3.0 + sin(time * 0.090909))) + 0.2; 
}

mat2 rotate(float angle)
{
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float fbm(vec2 p)
{
  p *= 1.1;
  float f = 0.0;
  float amp = 0.5 * uNoiseAmp;
  
  mat2 modify0 = rotate(time * 0.02);
  f += amp * noise(p);
  p = modify0 * p * 2.0;
  amp *= 0.454545;
  
  mat2 modify1 = rotate(time * 0.02);
  f += amp * noise(p);
  p = modify1 * p * 2.0;
  amp *= 0.454545;
  
  mat2 modify2 = rotate(time * 0.08);
  f += amp * noise(p);
  
  return f;
}

float pattern(vec2 p, out vec2 q, out vec2 r) {
  vec2 offset1 = vec2(1.0);
  vec2 offset0 = vec2(0.0);
  mat2 rot01 = rotate(0.1 * time);
  mat2 rot1 = rotate(0.1);
  
  q = vec2(fbm(p + offset1), fbm(rot01 * p + offset1));
  r = vec2(fbm(rot1 * q + offset0), fbm(q + offset0));
  return fbm(p + r);
}

float digit(vec2 p){
    vec2 grid = uGridMul * 15.0;
    vec2 s = floor(p * grid) / grid;
    p = p * grid;
    vec2 q, r;
    float intensity = pattern(s * 0.1, q, r) * 1.3 - 0.03;
    
    if(uUseMouse > 0.5){
        vec2 mouseWorld = uMouse * uScale;
        float distToMouse = distance(s, mouseWorld);
        float mouseInfluence = exp(-distToMouse * 8.0) * uMouseStrength * 10.0;
        intensity += mouseInfluence;
        
        float ripple = sin(distToMouse * 20.0 - iTime * 5.0) * 0.1 * mouseInfluence;
        intensity += ripple;
    }
    
    if(uUsePageLoadAnimation > 0.5){
        float cellRandom = fract(sin(dot(s, vec2(12.9898, 78.233))) * 43758.5453);
        float cellDelay = cellRandom * 0.8;
        float cellProgress = clamp((uPageLoadProgress - cellDelay) / 0.2, 0.0, 1.0);
        
        float fadeAlpha = smoothstep(0.0, 1.0, cellProgress);
        intensity *= fadeAlpha;
    }
    
    p = fract(p);
    p *= uDigitSize;
    
    float px5 = p.x * 5.0;
    float py5 = (1.0 - p.y) * 5.0;
    float x = fract(px5);
    float y = fract(py5);
    
    float i = floor(py5) - 2.0;
    float j = floor(px5) - 2.0;
    float n = i * i + j * j;
    float f = n * 0.0625;
    
    float isOn = step(0.1, intensity - f);
    float brightness = isOn * (0.2 + y * 0.8) * (0.75 + x * 0.25);
    
    return step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0) * brightness;
}

float onOff(float a, float b, float c)
{
  return step(c, sin(iTime + a * cos(iTime * b))) * uFlickerAmount;
}

float displace(vec2 look)
{
    float y = look.y - mod(iTime * 0.25, 1.0);
    float window = 1.0 / (1.0 + 50.0 * y * y);
    return sin(look.y * 20.0 + iTime) * 0.0125 * onOff(4.0, 2.0, 0.8) * (1.0 + cos(iTime * 60.0)) * window;
}

vec3 getColor(vec2 p){
    
    float bar = step(mod(p.y + time * 20.0, 1.0), 0.2) * 0.4 + 1.0;
    bar *= uScanlineIntensity;
    
    float displacement = displace(p);
    p.x += displacement;

    if (uGlitchAmount != 1.0) {
      float extra = displacement * (uGlitchAmount - 1.0);
      p.x += extra;
    }

    float middle = digit(p);
    
    const float off = 0.002;
    float sum = digit(p + vec2(-off, -off)) + digit(p + vec2(0.0, -off)) + digit(p + vec2(off, -off)) +
                digit(p + vec2(-off, 0.0)) + digit(p + vec2(0.0, 0.0)) + digit(p + vec2(off, 0.0)) +
                digit(p + vec2(-off, off)) + digit(p + vec2(0.0, off)) + digit(p + vec2(off, off));
    
    vec3 baseColor = vec3(0.9) * middle + sum * 0.1 * vec3(1.0) * bar;
    return baseColor;
}

vec2 barrel(vec2 uv){
  vec2 c = uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  c *= 1.0 + uCurvature * r2;
  return c * 0.5 + 0.5;
}

void main() {
    time = iTime * 0.333333;
    vec2 uv = vUv;

    if(uCurvature != 0.0){
      uv = barrel(uv);
    }
    
    vec2 p = uv * uScale;
    vec3 col = getColor(p);

    if(uChromaticAberration != 0.0){
      vec2 ca = vec2(uChromaticAberration) / iResolution.xy;
      col.r = getColor(p + ca).r;
      col.b = getColor(p - ca).b;
    }

    col *= uTint;
    col *= uBrightness;

    if(uDither > 0.0){
      float rnd = hash21(gl_FragCoord.xy);
      col += (rnd - 0.5) * (uDither * 0.003922);
    }

    gl_FragColor = vec4(col, 1.0);
}
`;

function hexToRgb(hex) {
  let h = String(hex || '#ffffff').replace('#', '').trim();
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(h, 16);
  if (!Number.isFinite(num)) return [1, 1, 1];
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

function getDitherValue(v) {
  return typeof v === 'boolean' ? (v ? 1 : 0) : v;
}

const DEFAULT_OPTIONS = Object.freeze({
  scale: 3,
  gridMul: [2, 1],
  digitSize: 1.2,
  timeScale: 0.5,
  pause: false,
  scanlineIntensity: 0.7,
  glitchAmount: 1,
  flickerAmount: 1,
  noiseAmp: 1,
  chromaticAberration: 0,
  dither: 0,
  curvature: 0.1,
  tint: '#A7EF9E',
  mouseReact: true,
  mouseStrength: 0.5,
  dpr: 1,
  pageLoadAnimation: true,
  brightness: 0.8,
  mouseEventTarget: null,
});

let activeInstance = null;
let createPromise = null;
let destroyAfterCreate = false;
let lifecycleObserver = null;
let lifecycleBooted = false;
let welcomeSettingsListener = null;

export function initFaultyTerminal(containerElement, customOptions = {}) {
  if (!(containerElement instanceof HTMLElement)) {
    throw new Error(`${LOG_TAG} initFaultyTerminal requires a valid container HTMLElement.`);
  }

  const options = { ...DEFAULT_OPTIONS, ...customOptions };
  if (customOptions.dpr == null) {
    const deviceDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    options.dpr = Math.min(deviceDpr, 2);
  }
  const mouseEventTarget = options.mouseEventTarget || containerElement;
  const tintVec = hexToRgb(options.tint);
  const ditherValue = getDitherValue(options.dither);

  const mouse = { x: 0.5, y: 0.5 };
  const smoothMouse = { x: 0.5, y: 0.5 };

  let rafId = 0;
  let destroyed = false;
  let frozenTime = 0;
  let loadAnimationStart = 0;
  let resizeObserver = null;

  const timeOffset = Math.random() * 100;
  const renderer = new Renderer({ dpr: options.dpr });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 1);

  const geometry = new Triangle(gl);
  const program = new Program(gl, {
    vertex: vertexShader,
    fragment: fragmentShader,
    uniforms: {
      iTime: { value: 0 },
      iResolution: { value: new Color(gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height) },
      uScale: { value: options.scale },
      uGridMul: { value: new Float32Array(options.gridMul) },
      uDigitSize: { value: options.digitSize },
      uScanlineIntensity: { value: options.scanlineIntensity },
      uGlitchAmount: { value: options.glitchAmount },
      uFlickerAmount: { value: options.flickerAmount },
      uNoiseAmp: { value: options.noiseAmp },
      uChromaticAberration: { value: options.chromaticAberration },
      uDither: { value: ditherValue },
      uCurvature: { value: options.curvature },
      uTint: { value: new Color(tintVec[0], tintVec[1], tintVec[2]) },
      uMouse: { value: new Float32Array([smoothMouse.x, smoothMouse.y]) },
      uMouseStrength: { value: options.mouseStrength },
      uUseMouse: { value: options.mouseReact ? 1 : 0 },
      uPageLoadProgress: { value: options.pageLoadAnimation ? 0 : 1 },
      uUsePageLoadAnimation: { value: options.pageLoadAnimation ? 1 : 0 },
      uBrightness: { value: options.brightness },
    },
  });

  const mesh = new Mesh(gl, { geometry, program });

  const handleMouseMove = (event) => {
    const rect = containerElement.getBoundingClientRect();
    const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
    const y = 1 - (event.clientY - rect.top) / Math.max(rect.height, 1);
    mouse.x = x;
    mouse.y = y;
  };

  const resize = () => {
    if (destroyed) return;
    const width = Math.max(1, containerElement.offsetWidth || containerElement.clientWidth || 1);
    const height = Math.max(1, containerElement.offsetHeight || containerElement.clientHeight || 1);

    renderer.setSize(width, height);
    program.uniforms.iResolution.value = new Color(
      gl.canvas.width,
      gl.canvas.height,
      gl.canvas.width / Math.max(gl.canvas.height, 1)
    );
  };

  const update = (t) => {
    if (destroyed) return;
    rafId = requestAnimationFrame(update);

    if (options.pageLoadAnimation && loadAnimationStart === 0) {
      loadAnimationStart = t;
    }

    if (!options.pause) {
      const elapsed = (t * 0.001 + timeOffset) * options.timeScale;
      program.uniforms.iTime.value = elapsed;
      frozenTime = elapsed;
    } else {
      program.uniforms.iTime.value = frozenTime;
    }

    if (options.pageLoadAnimation && loadAnimationStart > 0) {
      const animationDuration = 2000;
      const animationElapsed = t - loadAnimationStart;
      const progress = Math.min(animationElapsed / animationDuration, 1);
      program.uniforms.uPageLoadProgress.value = progress;
    }

    if (options.mouseReact) {
      const dampingFactor = 0.08;
      smoothMouse.x += (mouse.x - smoothMouse.x) * dampingFactor;
      smoothMouse.y += (mouse.y - smoothMouse.y) * dampingFactor;

      const mouseUniform = program.uniforms.uMouse.value;
      mouseUniform[0] = smoothMouse.x;
      mouseUniform[1] = smoothMouse.y;
    }

    renderer.render({ scene: mesh });
  };

  resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(containerElement);
  resize();

  if (options.mouseReact) {
    mouseEventTarget.addEventListener('mousemove', handleMouseMove);
  }

  containerElement.appendChild(gl.canvas);
  rafId = requestAnimationFrame(update);

  console.log(`${LOG_TAG} init`, {
    canvasWidth: gl.canvas.width,
    canvasHeight: gl.canvas.height,
    dpr: options.dpr,
    mouseReact: options.mouseReact,
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

    if (options.mouseReact) {
      mouseEventTarget.removeEventListener('mousemove', handleMouseMove);
    }

    if (gl.canvas.parentElement === containerElement) {
      containerElement.removeChild(gl.canvas);
    }

    gl.getExtension('WEBGL_lose_context')?.loseContext();

    loadAnimationStart = 0;

    console.log(`${LOG_TAG} destroy`, {
      rafStopped: true,
      resizeObserverDisconnected: true,
      mouseListenerRemoved: !!options.mouseReact,
      canvasRemoved: !gl.canvas.parentElement,
      contextLost: true,
    });
  };

  return {
    destroy,
    renderer,
    program,
    mesh,
    gl,
  };
}

function ensureMount() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (!welcomeScreen) return null;

  let mount = document.getElementById('faultyMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'faultyMount';
    mount.className = 'faulty-mount';
    mount.setAttribute('aria-hidden', 'true');

    const ditherMount = document.getElementById('ditherMount');
    if (ditherMount && ditherMount.parentNode === welcomeScreen) {
      welcomeScreen.insertBefore(mount, ditherMount);
    } else {
      welcomeScreen.prepend(mount);
    }
  }
  return mount;
}

export async function createFaultyTerminal(options = {}) {
  if (activeInstance) return activeInstance;
  if (createPromise) return createPromise;
  destroyAfterCreate = false;

  createPromise = (async () => {
    const mount = options.mount || ensureMount();
    if (!mount) throw new Error('Could not find #welcomeScreen to mount faulty terminal.');

    const welcomeScreen = document.getElementById('welcomeScreen');
    const instance = initFaultyTerminal(mount, {
      ...options,
      mouseEventTarget: options.mouseEventTarget || welcomeScreen || mount,
    });

    activeInstance = instance;
    if (destroyAfterCreate) {
      destroyAfterCreate = false;
      destroyFaultyTerminal();
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

export function destroyFaultyTerminal() {
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
  const shouldRunFaulty = visible && background === 'faulty';

  if (shouldRunFaulty) {
    try {
      await createFaultyTerminal();
    } catch (error) {
      console.error(`${LOG_TAG} failed to create instance`, error);
    }
    return;
  }
  destroyFaultyTerminal();
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
    if (!event?.detail || !Object.prototype.hasOwnProperty.call(event.detail, 'welcomeBackground')) return;
    syncLifecycleState();
  };
  window.addEventListener('hybrid:welcome-settings-changed', welcomeSettingsListener);

  window.addEventListener('beforeunload', () => {
    lifecycleObserver?.disconnect();
    lifecycleObserver = null;
    if (welcomeSettingsListener) {
      window.removeEventListener('hybrid:welcome-settings-changed', welcomeSettingsListener);
      welcomeSettingsListener = null;
    }
    destroyFaultyTerminal();
  });

  syncLifecycleState();
}

if (typeof window !== 'undefined') {
  window.HybridFaultyTerminal = {
    createFaultyTerminal,
    destroyFaultyTerminal,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLifecycle, { once: true });
  } else {
    bootLifecycle();
  }
}

export default initFaultyTerminal;
