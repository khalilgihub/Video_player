import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, Effect } from 'postprocessing';

const LOG_TAG = '[DitherWaves]';

const waveVertexShader = `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
}
`;

const waveFragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float waveSpeed;
uniform float waveFrequency;
uniform float waveAmplitude;
uniform vec3 waveColor;
uniform vec2 mousePos;
uniform int enableMouseInteraction;
uniform float mouseRadius;
uniform float mouseIntensity;

vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}

const int OCTAVES = 4;
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 1.0;
  float freq = waveFrequency;
  for (int i = 0; i < OCTAVES; i++) {
    value += amp * abs(cnoise(p));
    p *= freq;
    amp *= waveAmplitude;
  }
  return value;
}

float pattern(vec2 p) {
  vec2 p2 = p - time * waveSpeed;
  return fbm(p + fbm(p2)); 
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  uv -= 0.5;
  uv.x *= resolution.x / resolution.y;
  float f = pattern(uv);
  if (enableMouseInteraction == 1) {
    vec2 mouseNDC = (mousePos / resolution - 0.5) * vec2(1.0, -1.0);
    mouseNDC.x *= resolution.x / resolution.y;
    float dist = length(uv - mouseNDC);
    float effect = 1.0 - smoothstep(0.0, mouseRadius, dist);
    f -= mouseIntensity * effect;
  }
  vec3 col = mix(vec3(0.0), waveColor, f);
  gl_FragColor = vec4(col, 1.0);
}
`;

const ditherFragmentShader = `
precision highp float;
uniform float colorNum;
uniform float pixelSize;
const float bayerMatrix8x8[64] = float[64](
  0.0/64.0, 48.0/64.0, 12.0/64.0, 60.0/64.0,  3.0/64.0, 51.0/64.0, 15.0/64.0, 63.0/64.0,
  32.0/64.0,16.0/64.0, 44.0/64.0, 28.0/64.0, 35.0/64.0,19.0/64.0, 47.0/64.0, 31.0/64.0,
  8.0/64.0, 56.0/64.0,  4.0/64.0, 52.0/64.0, 11.0/64.0,59.0/64.0,  7.0/64.0, 55.0/64.0,
  40.0/64.0,24.0/64.0, 36.0/64.0, 20.0/64.0, 43.0/64.0,27.0/64.0, 39.0/64.0, 23.0/64.0,
  2.0/64.0, 50.0/64.0, 14.0/64.0, 62.0/64.0,  1.0/64.0,49.0/64.0, 13.0/64.0, 61.0/64.0,
  34.0/64.0,18.0/64.0, 46.0/64.0, 30.0/64.0, 33.0/64.0,17.0/64.0, 45.0/64.0, 29.0/64.0,
  10.0/64.0,58.0/64.0,  6.0/64.0, 54.0/64.0,  9.0/64.0,57.0/64.0,  5.0/64.0, 53.0/64.0,
  42.0/64.0,26.0/64.0, 38.0/64.0, 22.0/64.0, 41.0/64.0,25.0/64.0, 37.0/64.0, 21.0/64.0
);

vec3 dither(vec2 uv, vec3 color) {
  vec2 scaledCoord = floor(uv * resolution / pixelSize);
  int x = int(mod(scaledCoord.x, 8.0));
  int y = int(mod(scaledCoord.y, 8.0));
  float threshold = bayerMatrix8x8[y * 8 + x] - 0.25;
  float step = 1.0 / (colorNum - 1.0);
  color += threshold * step;
  float bias = 0.2;
  color = clamp(color - bias, 0.0, 1.0);
  return floor(color * (colorNum - 1.0) + 0.5) / (colorNum - 1.0);
}

void mainImage(in vec4 inputColor, in vec2 uv, out vec4 outputColor) {
  vec2 normalizedPixelSize = pixelSize / resolution;
  vec2 uvPixel = normalizedPixelSize * floor(uv / normalizedPixelSize);
  vec4 color = texture2D(inputBuffer, uvPixel);
  color.rgb = dither(uv, color.rgb);
  outputColor = color;
}
`;

class RetroEffectImpl extends Effect {
  constructor(colorNum = 4, pixelSize = 2) {
    const uniforms = new Map([
      ['colorNum', new THREE.Uniform(colorNum)],
      ['pixelSize', new THREE.Uniform(pixelSize)],
    ]);
    super('RetroEffect', ditherFragmentShader, { uniforms });
    this.uniforms = uniforms;
  }

  set colorNum(v) {
    this.uniforms.get('colorNum').value = v;
  }

  get colorNum() {
    return this.uniforms.get('colorNum').value;
  }

  set pixelSize(v) {
    this.uniforms.get('pixelSize').value = v;
  }

  get pixelSize() {
    return this.uniforms.get('pixelSize').value;
  }
}

const DEFAULT_OPTIONS = Object.freeze({
  waveSpeed: 0.05,
  waveFrequency: 3,
  waveAmplitude: 0.3,
  waveColor: [0.5, 0.5, 0.5],
  colorNum: 4,
  pixelSize: 2,
  disableAnimation: false,
  enableMouseInteraction: true,
  mouseRadius: 0.22,
  mouseIntensity: 0.35,
  cameraZ: 6,
  dpr: 1,
  antialias: true,
  preserveDrawingBuffer: true,
  mouseEventTarget: null,
});

let activeInstance = null;
let createPromise = null;
let destroyAfterCreate = false;
let lifecycleObserver = null;
let lifecycleBooted = false;

function getContainerSize(container) {
  const width = Math.max(1, container.clientWidth || 1);
  const height = Math.max(1, container.clientHeight || 1);
  return { width, height };
}

function getViewportAtZ0(camera) {
  const distance = Math.abs(camera.position.z);
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const height = 2 * Math.tan(verticalFov * 0.5) * distance;
  return { width: height * camera.aspect, height };
}

export function initDitherWaves(containerElement, customOptions = {}) {
  if (!(containerElement instanceof HTMLElement)) {
    throw new Error(`${LOG_TAG} initDitherWaves(container): containerElement must be an HTMLElement.`);
  }

  const options = { ...DEFAULT_OPTIONS, ...customOptions };
  const mouseEventTarget = options.mouseEventTarget || containerElement;
  let destroyed = false;
  let rafId = 0;

  const renderer = new THREE.WebGLRenderer({
    antialias: options.antialias,
    preserveDrawingBuffer: options.preserveDrawingBuffer,
    alpha: true,
  });
  renderer.setPixelRatio(options.dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 100);
  camera.position.set(0, 0, options.cameraZ);

  const waveUniforms = {
    time: new THREE.Uniform(0),
    resolution: new THREE.Uniform(new THREE.Vector2(1, 1)),
    waveSpeed: new THREE.Uniform(options.waveSpeed),
    waveFrequency: new THREE.Uniform(options.waveFrequency),
    waveAmplitude: new THREE.Uniform(options.waveAmplitude),
    waveColor: new THREE.Uniform(new THREE.Color(...options.waveColor)),
    mousePos: new THREE.Uniform(new THREE.Vector2(0, 0)),
    enableMouseInteraction: new THREE.Uniform(options.enableMouseInteraction ? 1 : 0),
    mouseRadius: new THREE.Uniform(options.mouseRadius),
    mouseIntensity: new THREE.Uniform(options.mouseIntensity),
  };

  const planeGeometry = new THREE.PlaneGeometry(1, 1);
  const planeMaterial = new THREE.ShaderMaterial({
    vertexShader: waveVertexShader,
    fragmentShader: waveFragmentShader,
    uniforms: waveUniforms,
  });
  const planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
  scene.add(planeMesh);

  const renderPass = new RenderPass(scene, camera);
  const retroEffect = new RetroEffectImpl(options.colorNum, options.pixelSize);
  const effectPass = new EffectPass(camera, retroEffect);
  const composer = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(effectPass);

  containerElement.appendChild(renderer.domElement);

  const clock = new THREE.Clock();
  const mouseN = new THREE.Vector2(0.5, 0.5);

  const updateSize = () => {
    if (destroyed) return;

    const { width, height } = getContainerSize(containerElement);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height, false);
    composer.setSize(width, height);

    const dpr = renderer.getPixelRatio();
    waveUniforms.resolution.value.set(Math.floor(width * dpr), Math.floor(height * dpr));

    const viewport = getViewportAtZ0(camera);
    planeMesh.scale.set(viewport.width, viewport.height, 1);
  };

  const onMouseMove = (event) => {
    if (!options.enableMouseInteraction || destroyed) return;
    const rect = containerElement.getBoundingClientRect();
    const nx = THREE.MathUtils.clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    const ny = THREE.MathUtils.clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    mouseN.set(nx, ny);

    const res = waveUniforms.resolution.value;
    waveUniforms.mousePos.value.set(mouseN.x * res.x, mouseN.y * res.y);
  };

  const onResize = () => updateSize();

  const renderLoop = () => {
    if (destroyed) return;
    rafId = window.requestAnimationFrame(renderLoop);

    if (!options.disableAnimation) {
      waveUniforms.time.value = clock.getElapsedTime();
    }

    waveUniforms.waveSpeed.value = options.waveSpeed;
    waveUniforms.waveFrequency.value = options.waveFrequency;
    waveUniforms.waveAmplitude.value = options.waveAmplitude;
    waveUniforms.waveColor.value.set(...options.waveColor);
    waveUniforms.enableMouseInteraction.value = options.enableMouseInteraction ? 1 : 0;
    waveUniforms.mouseRadius.value = options.mouseRadius;
    waveUniforms.mouseIntensity.value = options.mouseIntensity;

    retroEffect.colorNum = options.colorNum;
    retroEffect.pixelSize = options.pixelSize;

    composer.render();
  };

  updateSize();
  mouseEventTarget.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('resize', onResize);

  console.log(`${LOG_TAG} init`, {
    container: containerElement.id || '(no-id)',
    passes: composer.passes.map((pass) => pass.constructor.name),
    rendererSize: renderer.getSize(new THREE.Vector2()).toArray(),
  });

  rafId = window.requestAnimationFrame(renderLoop);

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;

    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }

    mouseEventTarget.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('resize', onResize);

    scene.remove(planeMesh);
    planeGeometry.dispose();
    planeMaterial.dispose();

    composer.dispose();
    renderer.dispose();

    const canvas = renderer.domElement;
    const gl = renderer.getContext();
    canvas.parentNode?.removeChild(canvas);
    gl.getExtension('WEBGL_lose_context')?.loseContext();

    console.log(`${LOG_TAG} destroy`, {
      canvasRemoved: !canvas.parentNode,
      passesDisposed: true,
      rendererDisposed: true,
      contextLost: true,
    });
  };

  return {
    destroy,
    renderer,
    scene,
    camera,
    composer,
  };
}

function ensureMount() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (!welcomeScreen) return null;

  let mount = document.getElementById('ditherMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'ditherMount';
    mount.className = 'dither-mount';
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

export async function createDitherWaves(options = {}) {
  if (activeInstance) return activeInstance;
  if (createPromise) return createPromise;
  destroyAfterCreate = false;

  createPromise = (async () => {
    const mount = options.mount || ensureMount();
    if (!mount) throw new Error('Could not find #welcomeScreen to mount dither waves.');

    const welcomeScreen = document.getElementById('welcomeScreen');
    const instance = initDitherWaves(mount, {
      ...options,
      mouseEventTarget: options.mouseEventTarget || welcomeScreen || mount,
    });

    activeInstance = instance;
    if (destroyAfterCreate) {
      destroyAfterCreate = false;
      destroyDitherWaves();
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

export function destroyDitherWaves() {
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
  if (visible) {
    try {
      await createDitherWaves();
    } catch (error) {
      console.error(`${LOG_TAG} failed to create instance`, error);
    }
    return;
  }
  destroyDitherWaves();
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

  window.addEventListener('beforeunload', () => {
    lifecycleObserver?.disconnect();
    lifecycleObserver = null;
    destroyDitherWaves();
  });

  syncLifecycleState();
}

if (typeof window !== 'undefined') {
  window.HybridDitherWaves = {
    createDitherWaves,
    destroyDitherWaves,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLifecycle, { once: true });
  } else {
    bootLifecycle();
  }
}
