import { Renderer, Camera, Geometry, Program, Mesh } from 'ogl';

const LOG_TAG = '[Particles]';

const defaultColors = ['#ffffff', '#ffffff', '#ffffff'];

const hexToRgb = hex => {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map(c => c + c)
      .join('');
  }
  const int = parseInt(hex, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  return [r, g, b];
};

const vertex = /* glsl */ `
  attribute vec3 position;
  attribute vec4 random;
  attribute vec3 color;
  
  uniform mat4 modelMatrix;
  uniform mat4 viewMatrix;
  uniform mat4 projectionMatrix;
  uniform float uTime;
  uniform float uSpread;
  uniform float uBaseSize;
  uniform float uSizeRandomness;
  
  varying vec4 vRandom;
  varying vec3 vColor;
  
  void main() {
    vRandom = random;
    vColor = color;
    
    vec3 pos = position * uSpread;
    pos.z *= 10.0;
    
    vec4 mPos = modelMatrix * vec4(pos, 1.0);
    float t = uTime;
    mPos.x += sin(t * random.z + 6.28 * random.w) * mix(0.1, 1.5, random.x);
    mPos.y += sin(t * random.y + 6.28 * random.x) * mix(0.1, 1.5, random.w);
    mPos.z += sin(t * random.w + 6.28 * random.y) * mix(0.1, 1.5, random.z);
    
    vec4 mvPos = viewMatrix * mPos;

    if (uSizeRandomness == 0.0) {
      gl_PointSize = uBaseSize;
    } else {
      gl_PointSize = (uBaseSize * (1.0 + uSizeRandomness * (random.x - 0.5))) / length(mvPos.xyz);
    }

    gl_Position = projectionMatrix * mvPos;
  }
`;

const fragment = /* glsl */ `
  precision highp float;
  
  uniform float uTime;
  uniform float uAlphaParticles;
  varying vec4 vRandom;
  varying vec3 vColor;
  
  void main() {
    vec2 uv = gl_PointCoord.xy;
    float d = length(uv - vec2(0.5));
    
    if(uAlphaParticles < 0.5) {
      if(d > 0.5) {
        discard;
      }
      gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), 1.0);
    } else {
      float circle = smoothstep(0.5, 0.4, d) * 0.8;
      gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), circle);
    }
  }
`;

const DEFAULT_OPTIONS = Object.freeze({
  particleCount: 300,
  particleSpread: 10,
  speed: 0.1,
  particleColors: ['#ffffff'],
  moveParticlesOnHover: true,
  particleHoverFactor: 1,
  alphaParticles: false,
  particleBaseSize: 100,
  sizeRandomness: 1,
  cameraDistance: 20,
  disableRotation: false,
  pixelRatio: null,
  pauseWhenUnfocused: true,
  mouseEventTarget: null,
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

function isAppInteractive() {
  return document.visibilityState === 'visible' && document.hasFocus();
}

function normalizePalette(colors) {
  if (!Array.isArray(colors) || colors.length === 0) return defaultColors;
  return colors.map((c) => String(c));
}

export function initParticles(containerElement, customOptions = {}) {
  if (!(containerElement instanceof HTMLElement)) {
    throw new Error(`${LOG_TAG} initParticles(container): containerElement must be an HTMLElement.`);
  }

  const options = { ...DEFAULT_OPTIONS, ...customOptions };
  if (!(typeof options.pixelRatio === 'number' && Number.isFinite(options.pixelRatio) && options.pixelRatio > 0)) {
    options.pixelRatio = getQualityDpr(getWelcomeQuality());
  }
  const mouseEventTarget = options.mouseEventTarget || containerElement;
  const mouse = { x: 0, y: 0 };
  let destroyed = false;
  let rafId = 0;
  let mouseMoveRafId = 0;
  let pendingMouseClient = null;

  const renderer = new Renderer({
    dpr: options.pixelRatio,
    depth: false,
    alpha: false,
  });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 1);
  containerElement.style.background = '#000';
  gl.canvas.style.position = 'absolute';
  gl.canvas.style.inset = '0';
  gl.canvas.style.width = '100%';
  gl.canvas.style.height = '100%';
  gl.canvas.style.display = 'block';
  gl.canvas.style.background = '#000000';
  containerElement.appendChild(gl.canvas);

  const camera = new Camera(gl, { fov: 15 });
  camera.position.set(0, 0, options.cameraDistance);

  const resize = () => {
    if (destroyed) return;
    const width = containerElement.clientWidth || 1;
    const height = containerElement.clientHeight || 1;
    renderer.setSize(width, height);
    camera.perspective({ aspect: gl.canvas.width / gl.canvas.height });
  };
  window.addEventListener('resize', resize, false);
  resize();

  const flushMouse = () => {
    mouseMoveRafId = 0;
    if (!pendingMouseClient || destroyed) return;
    const rect = containerElement.getBoundingClientRect();
    const x = ((pendingMouseClient.x - rect.left) / rect.width) * 2 - 1;
    const y = -(((pendingMouseClient.y - rect.top) / rect.height) * 2 - 1);
    mouse.x = x;
    mouse.y = y;
  };

  const handleMouseMove = e => {
    pendingMouseClient = { x: e.clientX, y: e.clientY };
    if (!mouseMoveRafId) {
      mouseMoveRafId = requestAnimationFrame(flushMouse);
    }
  };
  if (options.moveParticlesOnHover) {
    mouseEventTarget.addEventListener('mousemove', handleMouseMove);
  }

  const count = options.particleCount;
  const positions = new Float32Array(count * 3);
  const randoms = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const palette = normalizePalette(options.particleColors);

  for (let i = 0; i < count; i++) {
    let x;
    let y;
    let z;
    let len;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
      len = x * x + y * y + z * z;
    } while (len > 1 || len === 0);
    const r = Math.cbrt(Math.random());
    positions.set([x * r, y * r, z * r], i * 3);
    randoms.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    const col = hexToRgb(palette[Math.floor(Math.random() * palette.length)]);
    colors.set(col, i * 3);
  }

  const geometry = new Geometry(gl, {
    position: { size: 3, data: positions },
    random: { size: 4, data: randoms },
    color: { size: 3, data: colors },
  });

  const program = new Program(gl, {
    vertex,
    fragment,
    uniforms: {
      uTime: { value: 0 },
      uSpread: { value: options.particleSpread },
      uBaseSize: { value: options.particleBaseSize * options.pixelRatio },
      uSizeRandomness: { value: options.sizeRandomness },
      uAlphaParticles: { value: options.alphaParticles ? 1 : 0 },
    },
    transparent: true,
    depthTest: false,
  });

  const particles = new Mesh(gl, { mode: gl.POINTS, geometry, program });

  let lastTime = performance.now();
  let elapsed = 0;

  const update = t => {
    if (destroyed) return;
    rafId = requestAnimationFrame(update);
    if (options.pauseWhenUnfocused && !isAppInteractive()) return;

    const delta = t - lastTime;
    lastTime = t;
    elapsed += delta * options.speed;

    program.uniforms.uTime.value = elapsed * 0.001;
    program.uniforms.uSpread.value = options.particleSpread;
    program.uniforms.uBaseSize.value = options.particleBaseSize * options.pixelRatio;
    program.uniforms.uSizeRandomness.value = options.sizeRandomness;
    program.uniforms.uAlphaParticles.value = options.alphaParticles ? 1 : 0;

    if (options.moveParticlesOnHover) {
      particles.position.x = -mouse.x * options.particleHoverFactor;
      particles.position.y = -mouse.y * options.particleHoverFactor;
    } else {
      particles.position.x = 0;
      particles.position.y = 0;
    }

    if (!options.disableRotation) {
      particles.rotation.x = Math.sin(elapsed * 0.0002) * 0.1;
      particles.rotation.y = Math.cos(elapsed * 0.0005) * 0.15;
      particles.rotation.z += 0.01 * options.speed;
    }

    renderer.render({ scene: particles, camera });
    window.HybridPerfMonitor?.markFrame?.('effect:particles');
  };
  rafId = requestAnimationFrame(update);

  const applyOptions = (nextOptions = {}) => {
    if (!nextOptions || typeof nextOptions !== 'object' || destroyed) return true;

    const prevCount = options.particleCount;
    const prevPalette = normalizePalette(options.particleColors).join('|');
    const nextCount = nextOptions.particleCount ?? prevCount;
    const nextPalette = normalizePalette(nextOptions.particleColors ?? options.particleColors).join('|');
    const requiresRebuild = nextCount !== prevCount || nextPalette !== prevPalette;
    if (requiresRebuild) {
      return false;
    }

    const prevPixelRatio = options.pixelRatio;
    Object.assign(options, nextOptions);
    if (!(typeof options.pixelRatio === 'number' && Number.isFinite(options.pixelRatio) && options.pixelRatio > 0)) {
      options.pixelRatio = getQualityDpr(getWelcomeQuality());
    }
    if (prevPixelRatio !== options.pixelRatio) {
      renderer.dpr = options.pixelRatio;
      resize();
    }
    return true;
  };

  console.log(`${LOG_TAG} init`, {
    particleCount: count,
    pixelRatio: options.pixelRatio,
    canvasAttached: gl.canvas.parentElement === containerElement,
    context: gl.constructor?.name || 'WebGLRenderingContext',
  });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (mouseMoveRafId) {
      cancelAnimationFrame(mouseMoveRafId);
      mouseMoveRafId = 0;
    }

    window.removeEventListener('resize', resize, false);
    if (options.moveParticlesOnHover) {
      mouseEventTarget.removeEventListener('mousemove', handleMouseMove);
    }

    if (containerElement.contains(gl.canvas)) {
      containerElement.removeChild(gl.canvas);
    }
    containerElement.style.background = '';

    gl.getExtension('WEBGL_lose_context')?.loseContext();

    console.log(`${LOG_TAG} destroy`, {
      rafStopped: true,
      listenersRemoved: true,
      canvasRemoved: !gl.canvas.parentElement,
      contextLost: true,
    });
  };

  return {
    destroy,
    applyOptions,
    renderer,
    camera,
    geometry,
    program,
    particles,
  };
}

function ensureMount() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (!welcomeScreen) return null;

  let mount = document.getElementById('particlesMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'particlesMount';
    mount.className = 'particles-mount';
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

export async function createParticles(options = {}) {
  if (activeInstance) return activeInstance;
  if (createPromise) return createPromise;
  destroyAfterCreate = false;

  createPromise = (async () => {
    const mount = options.mount || ensureMount();
    if (!mount) throw new Error('Could not find #welcomeScreen to mount particles.');

    const instance = initParticles(mount, {
      ...options,
      mouseEventTarget:
        options.mouseEventTarget ||
        document.getElementById('welcomeScreen') ||
        window,
    });

    activeInstance = instance;
    if (destroyAfterCreate) {
      destroyAfterCreate = false;
      destroyParticles();
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

export function destroyParticles() {
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
  const shouldRunParticles = visible && background === 'particles';

  if (shouldRunParticles) {
    const userOpts = welcomeState.bgOpts_particles || {};
    const quality = getWelcomeQuality(welcomeState);
    const mapped = {};
    if (userOpts.count !== undefined) mapped.particleCount = userOpts.count;
    if (userOpts.speed !== undefined) mapped.speed = userOpts.speed;
    if (userOpts.spread !== undefined) mapped.particleSpread = userOpts.spread;
    if (userOpts.color !== undefined) mapped.particleColors = [userOpts.color];
    if (userOpts.size !== undefined) mapped.particleBaseSize = userOpts.size;
    if (userOpts.alpha !== undefined) mapped.alphaParticles = userOpts.alpha;
    mapped.pixelRatio = getQualityDpr(quality);
    mapped.pauseWhenUnfocused = true;

    if (activeInstance?.applyOptions) {
      const updatedInPlace = activeInstance.applyOptions(mapped);
      if (updatedInPlace) return;
      destroyParticles();
    }

    try {
      await createParticles(mapped);
    } catch (error) {
      console.error(`${LOG_TAG} failed to create instance`, error);
    }
    return;
  }

  destroyParticles();
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

  welcomeSettingsListener = event => {
    if (!event?.detail) return;
    if (Object.prototype.hasOwnProperty.call(event.detail, 'welcomeBackground')) {
      syncLifecycleState();
      return;
    }
    if (
      Object.prototype.hasOwnProperty.call(event.detail, 'bgOpts_particles') ||
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
    destroyParticles();
  });

  syncLifecycleState();
}

if (typeof window !== 'undefined') {
  window.HybridParticlesBg = {
    createParticles,
    destroyParticles,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLifecycle, { once: true });
  } else {
    bootLifecycle();
  }
}

export default initParticles;
