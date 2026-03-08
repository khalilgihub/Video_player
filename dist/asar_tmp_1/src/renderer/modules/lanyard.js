import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as CANNON from 'cannon-es';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline';

const LOG_TAG = '[Lanyard]';

const DEFAULT_OPTIONS = Object.freeze({
  position: [0, 0, 40],
  gravity: [0, -30, 0],
  fov: 20,
  transparent: true,
  fixedTimeStep: 1 / 60,
  maxSubSteps: 4,
  minSpeed: 0,
  maxSpeed: 30,
  straightRenderSegments: 12,
  debug: true,
  anchorY: 6.8,
  attachYOffset: -0.18,
  attachInset: 0.04,
  lockVisualToPhysicsAttach: false,
  recenterModelToClip: true,
  visualAttachMode: 'clip',
  visualAttachYOffset: -0.01,
  visualAttachInset: 0,
  visualAttachNudge: 0,
  tipLength: 0.07,
  tipRadius: 0.01,
  tipColor: 0x0f0f10,
});

let activeInstance = null;
let createPromise = null;
let destroyAfterCreate = false;
let lifecycleObserver = null;
let lifecycleBooted = false;

function isMobileViewport() {
  return window.innerWidth < 768;
}

function resolveAsset(relativePath) {
  return new URL(relativePath, import.meta.url).href;
}

class VanillaLanyard {
  constructor(options) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    if (options.fixedTimeStep == null) {
      this.options.fixedTimeStep = isMobileViewport() ? 1 / 30 : 1 / 60;
    }
    this.mount = options.mount;

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.world = null;

    this.fixedBody = null;
    this.j1Body = null;
    this.j2Body = null;
    this.j3Body = null;
    this.cardBody = null;
    this.cardJoint = null;
    this.constraints = [];
    this.cardMass = 1.5;
    this.cardPivotLocal = new CANNON.Vec3(0, 1.5, 0);
    this.cardAttachWorld = new THREE.Vector3();
    this.cardVisualAttachLocal = new THREE.Vector3(0, 1.2, 0);
    this.cardVisualAttachWorld = new THREE.Vector3();
    this.cardPivotTmp = new CANNON.Vec3();

    this.cardAnchor = null;
    this.cardVisualRoot = null;
    this.cardMeshes = [];
    this.modelRecenteringDone = false;

    this.gltfLoader = new GLTFLoader();
    this.textureLoader = new THREE.TextureLoader();
    this.strapTexture = null;

    this.bandGeometry = null;
    this.bandMaterial = null;
    this.bandMesh = null;
    this.tipGeometry = null;
    this.tipMaterial = null;
    this.tipMesh = null;
    this.bandPoints = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ];
    this.straightBandPoints = [];
    this.curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    this.curve.curveType = 'chordal';
    this.curve.arcLengthDivisions = 32;

    this.j1Lerped = new THREE.Vector3();
    this.j2Lerped = new THREE.Vector3();
    this.lerpReady = false;

    this.pointerNdc = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.dragPlane = new THREE.Plane();
    this.dragPlaneNormal = new THREE.Vector3();
    this.dragOffset = new THREE.Vector3();
    this.dragPoint = new THREE.Vector3();
    this.dragTarget = new THREE.Vector3();
    this.isHovered = false;
    this.isDragging = false;

    this.tmpVecA = new THREE.Vector3();
    this.tmpVecB = new THREE.Vector3();
    this.tmpVecC = new THREE.Vector3();
    this.tmpVecD = new THREE.Vector3();
    this.tmpVecE = new THREE.Vector3();
    this.tmpVecF = new THREE.Vector3();
    this.tmpVecG = new THREE.Vector3();
    this.tmpQuat = new THREE.Quaternion();
    this.tmpEuler = new THREE.Euler();
    this.yAxis = new THREE.Vector3(0, 1, 0);

    this.rafId = 0;
    this.lastFrameTime = 0;
    this.lastDebugLogTime = 0;
    this.destroyed = false;

    this.disposedGeometries = new Set();
    this.disposedMaterials = new Set();
    this.disposedTextures = new Set();

    this.onResize = this.onResize.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onWindowBlur = this.onWindowBlur.bind(this);
    this.animate = this.animate.bind(this);
  }

  async init() {
    this.initRenderer();
    this.initScene();
    this.initPhysics();
    this.initBand();
    this.attachEvents();
    await this.loadAssets();
    this.onResize();

    this.lastFrameTime = performance.now();
    this.rafId = window.requestAnimationFrame(this.animate);
    console.log(`${LOG_TAG} initialized`);
    return this;
  }

  initRenderer() {
    if (!this.mount) {
      throw new Error('Lanyard mount element is missing.');
    }

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: this.options.transparent,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, this.options.transparent ? 0 : 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobileViewport() ? 1.5 : 2));
    this.renderer.domElement.classList.add('lanyard-canvas');
    this.mount.appendChild(this.renderer.domElement);
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.options.fov, 1, 0.1, 200);
    this.camera.position.fromArray(this.options.position);

    const ambient = new THREE.AmbientLight(0xffffff, Math.PI);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(-10, 0, 14);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xffffff, 1.2);
    fill.position.set(1, 1, 1);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 1.6);
    rim.position.set(-1, -1, 1);
    this.scene.add(rim);
  }

  initPhysics() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(...this.options.gravity),
      allowSleep: true,
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.solver.iterations = 12;
    this.world.solver.tolerance = 0.001;

    const segmentProps = {
      mass: 0.15,
      linearDamping: 0.9,
      angularDamping: 0.9,
      allowSleep: true,
      sleepSpeedLimit: 0.1,
      sleepTimeLimit: 0.3,
    };

    const segmentLength = 1;
    const anchorX = 0;
    const anchorY = Number(this.options.anchorY);
    const anchorZ = 0;

    this.fixedBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      position: new CANNON.Vec3(anchorX, anchorY, anchorZ),
    });

    this.j1Body = new CANNON.Body({
      ...segmentProps,
      position: new CANNON.Vec3(anchorX, anchorY - segmentLength, anchorZ),
    });
    this.j1Body.addShape(new CANNON.Sphere(0.1));

    this.j2Body = new CANNON.Body({
      ...segmentProps,
      position: new CANNON.Vec3(anchorX, anchorY - segmentLength * 2, anchorZ),
    });
    this.j2Body.addShape(new CANNON.Sphere(0.1));

    this.j3Body = new CANNON.Body({
      ...segmentProps,
      position: new CANNON.Vec3(anchorX, anchorY - segmentLength * 3, anchorZ),
    });
    this.j3Body.addShape(new CANNON.Sphere(0.1));

    this.cardBody = new CANNON.Body({
      mass: this.cardMass,
      position: new CANNON.Vec3(anchorX, anchorY - segmentLength * 4, anchorZ),
      linearDamping: 0.92,
      angularDamping: 0.9,
      allowSleep: true,
      sleepSpeedLimit: 0.05,
      sleepTimeLimit: 0.2,
    });
    this.cardBody.addShape(new CANNON.Box(new CANNON.Vec3(0.8, 1.125, 0.01)));

    this.world.addBody(this.fixedBody);
    this.world.addBody(this.j1Body);
    this.world.addBody(this.j2Body);
    this.world.addBody(this.j3Body);
    this.world.addBody(this.cardBody);

    this.constraints.push(this.makeDistanceConstraint(this.fixedBody, this.j1Body, segmentLength));
    this.constraints.push(this.makeDistanceConstraint(this.j1Body, this.j2Body, segmentLength));
    this.constraints.push(this.makeDistanceConstraint(this.j2Body, this.j3Body, segmentLength));

    this.cardJoint = new CANNON.PointToPointConstraint(
      this.j3Body,
      new CANNON.Vec3(0, 0, 0),
      this.cardBody,
      this.cardPivotLocal,
      1e6
    );
    this.cardJoint.collideConnected = false;
    this.constraints.push(this.cardJoint);

    for (const constraint of this.constraints) {
      this.world.addConstraint(constraint);
    }
  }

  makeDistanceConstraint(bodyA, bodyB, distance) {
    const constraint = new CANNON.DistanceConstraint(bodyA, bodyB, distance, 1e6);
    constraint.collideConnected = false;
    return constraint;
  }

  initBand() {
    this.bandGeometry = new MeshLineGeometry();
    this.bandMaterial = new MeshLineMaterial({
      color: new THREE.Color('white'),
      lineWidth: 1,
      depthTest: false,
      transparent: true,
      opacity: 1,
      resolution: new THREE.Vector2(1, 1),
      sizeAttenuation: 1,
      repeat: new THREE.Vector2(-4, 1),
      useMap: 0,
    });
    this.bandMesh = new THREE.Mesh(this.bandGeometry, this.bandMaterial);
    this.bandMesh.frustumCulled = false;
    this.scene.add(this.bandMesh);

    const tipLength = Math.max(0.02, Number(this.options.tipLength) || 0.16);
    const tipRadius = Math.max(0.005, Number(this.options.tipRadius) || 0.02);
    this.tipGeometry = new THREE.CylinderGeometry(tipRadius, tipRadius, tipLength, 10, 1, false);
    this.tipMaterial = new THREE.MeshStandardMaterial({
      color: Number(this.options.tipColor) || 0x111111,
      roughness: 0.9,
      metalness: 0.05,
    });
    this.tipMesh = new THREE.Mesh(this.tipGeometry, this.tipMaterial);
    this.tipMesh.frustumCulled = false;
    this.scene.add(this.tipMesh);

    const straightSegments = Math.max(2, Number(this.options.straightRenderSegments) || 12);
    this.straightBandPoints = Array.from({ length: straightSegments }, () => new THREE.Vector3());
  }

  async loadAssets() {
    const cardUrl = resolveAsset('../../../assets/card.glb');
    const strapUrl = resolveAsset('../../../assets/lanyard.png');

    console.log(`${LOG_TAG} Loading card.glb from: ${cardUrl}`);
    console.log(`${LOG_TAG} Loading lanyard texture from: ${strapUrl}`);

    let gltf;
    try {
      gltf = await this.gltfLoader.loadAsync(cardUrl);
      console.log(`${LOG_TAG} card.glb loaded successfully.`);
    } catch (error) {
      console.error(`${LOG_TAG} card.glb failed to load. Verify path, asar packaging, and file permissions.`, error);
      throw error;
    }

    try {
      this.strapTexture = await this.textureLoader.loadAsync(strapUrl);
      this.strapTexture.wrapS = THREE.RepeatWrapping;
      this.strapTexture.wrapT = THREE.RepeatWrapping;
      this.strapTexture.repeat.set(-4, 1);
      this.strapTexture.colorSpace = THREE.SRGBColorSpace;
      this.strapTexture.anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());

      this.bandMaterial.map = this.strapTexture;
      this.bandMaterial.useMap = 1;
      this.bandMaterial.needsUpdate = true;
      console.log(`${LOG_TAG} lanyard texture loaded successfully.`);
    } catch (error) {
      console.warn(`${LOG_TAG} lanyard texture failed to load. Rendering plain white strap instead.`, error);
    }

    this.cardAnchor = new THREE.Group();
    this.scene.add(this.cardAnchor);

    this.cardVisualRoot = gltf.scene;
    this.cardVisualRoot.scale.setScalar(2.25);
    this.cardVisualRoot.position.set(0, -1.2, -0.05);
    this.cardAnchor.add(this.cardVisualRoot);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();

    this.cardVisualRoot.traverse((node) => {
      if (!node.isMesh) return;

      const sourceMaterial = node.material;
      let nextMaterial = sourceMaterial;

      if (/card/i.test(node.name)) {
        nextMaterial = new THREE.MeshPhysicalMaterial({
          map: sourceMaterial?.map || null,
          clearcoat: isMobileViewport() ? 0 : 1,
          clearcoatRoughness: 0.15,
          roughness: 0.9,
          metalness: 0.8,
        });
        if (nextMaterial.map) {
          nextMaterial.map.anisotropy = Math.min(16, maxAniso);
          nextMaterial.map.colorSpace = THREE.SRGBColorSpace;
        }
      } else if (sourceMaterial?.clone) {
        nextMaterial = sourceMaterial.clone();
        if (/clip/i.test(node.name) && 'roughness' in nextMaterial) {
          nextMaterial.roughness = 0.3;
        }
        if (/clip|clamp/i.test(node.name)) {
          if ('color' in nextMaterial && nextMaterial.color?.setHex) nextMaterial.color.setHex(0x111214);
          if ('metalness' in nextMaterial) nextMaterial.metalness = 0.15;
          if ('roughness' in nextMaterial) nextMaterial.roughness = 0.85;
        }
      }

      node.material = nextMaterial;
      this.cardMeshes.push(node);
    });

    if (this.cardMeshes.length === 0) {
      throw new Error('card.glb loaded, but no meshes were found to render/raycast.');
    }

    this.updateCardAttachFromModel();
  }

  updateCardAttachFromModel() {
    if (!this.cardVisualRoot || !this.cardJoint) return;

    const clipMesh =
      this.cardVisualRoot.getObjectByName('clip') ||
      this.cardMeshes.find((mesh) => /clip|ring|hook/i.test(mesh.name));
    const clampMesh =
      this.cardVisualRoot.getObjectByName('clamp') ||
      this.cardMeshes.find((mesh) => /clamp|hook|ring/i.test(mesh.name));

    if (!clipMesh) {
      console.warn(`${LOG_TAG} clip mesh not found in GLB, using default card joint pivot (0, 1.5, 0).`);
      return;
    }

    let clipSource = this.getMeshTopCenterInCardLocal(clipMesh);
    let clampSource = this.getMeshTopCenterInCardLocal(clampMesh);
    if (!clipSource) {
      console.warn(`${LOG_TAG} attach source bounds missing, using default card joint pivot.`);
      return;
    }

    if (this.options.recenterModelToClip !== false && !this.modelRecenteringDone) {
      // Recenter GLB so clip/ring sits on body centerline, preventing tilted rest pose.
      this.cardVisualRoot.position.x -= clipSource.x;
      this.cardVisualRoot.position.z -= clipSource.z;
      this.cardVisualRoot.updateWorldMatrix(true, true);
      this.modelRecenteringDone = true;

      clipSource = this.getMeshTopCenterInCardLocal(clipMesh);
      clampSource = this.getMeshTopCenterInCardLocal(clampMesh);
    }

    const physicsSource = clipSource;
    const visualSource = this.pickBestVisualAttach(clipSource, clampSource);
    if (!physicsSource || !visualSource) {
      console.warn(`${LOG_TAG} attach source bounds missing, using default card joint pivot.`);
      return;
    }

    const attachYOffset = Number(this.options.attachYOffset) || 0;
    const attachInset = Number(this.options.attachInset) || 0;
    const visualAttachYOffset = Number(this.options.visualAttachYOffset) || 0;
    const visualAttachInset = Number(this.options.visualAttachInset) || 0;
    const visualAttachNudge = Number(this.options.visualAttachNudge) || 0;

    // Keep physics pivot centered to avoid card tilt at rest.
    const physicsAttach = new THREE.Vector3(0, physicsSource.y + attachYOffset - attachInset, 0);
    const visualAttach =
      this.options.lockVisualToPhysicsAttach === false
        ? new THREE.Vector3(
            visualSource.x,
            visualSource.y + visualAttachYOffset - visualAttachInset + visualAttachNudge,
            visualSource.z
          )
        : physicsAttach.clone();

    this.cardPivotLocal.set(physicsAttach.x, physicsAttach.y, physicsAttach.z);
    this.cardVisualAttachLocal.copy(visualAttach);
    this.rebindCardJoint();
    this.alignCardUnderJoint();

    console.log(`${LOG_TAG} card joint pivot set from GLB clip mesh:`, {
      physics: [
        Number(physicsAttach.x.toFixed(3)),
        Number(physicsAttach.y.toFixed(3)),
        Number(physicsAttach.z.toFixed(3)),
      ],
      visual: [
        Number(visualAttach.x.toFixed(3)),
        Number(visualAttach.y.toFixed(3)),
        Number(visualAttach.z.toFixed(3)),
      ],
      sourceMeshes: {
        physics: clipMesh?.name || 'clip',
        visual: visualSource === clampSource ? clampMesh?.name || 'clamp' : clipMesh?.name || 'clip',
      },
    });
  }

  pickBestVisualAttach(clipSource, clampSource) {
    if (this.options.visualAttachMode === 'clip') return clipSource || clampSource || null;
    if (this.options.visualAttachMode === 'clamp') return clampSource || clipSource || null;

    if (clipSource && !clampSource) return clipSource;
    if (clampSource && !clipSource) return clampSource;
    if (!clipSource && !clampSource) return null;

    // Prefer the candidate closest to the card's centerline to keep the strap visually attached.
    const clipCenterlineError = Math.abs(clipSource.x) + Math.abs(clipSource.z);
    const clampCenterlineError = Math.abs(clampSource.x) + Math.abs(clampSource.z);
    return clipCenterlineError <= clampCenterlineError ? clipSource : clampSource;
  }

  getMeshTopCenterInCardLocal(mesh) {
    if (!mesh?.geometry) return null;
    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox();
    }
    const box = mesh.geometry.boundingBox;
    if (!box || box.isEmpty()) return null;

    const center = new THREE.Vector3();
    box.getCenter(center);
    const topCenterLocalToMesh = new THREE.Vector3(center.x, box.max.y, center.z);

    mesh.updateWorldMatrix(true, false);
    const topCenterWorld = mesh.localToWorld(topCenterLocalToMesh.clone());
    return this.cardAnchor.worldToLocal(topCenterWorld.clone());
  }

  rebindCardJoint() {
    if (!this.world || !this.cardJoint || !this.j3Body || !this.cardBody) return;

    this.world.removeConstraint(this.cardJoint);
    this.constraints = this.constraints.filter((constraint) => constraint !== this.cardJoint);

    this.cardJoint = new CANNON.PointToPointConstraint(
      this.j3Body,
      new CANNON.Vec3(0, 0, 0),
      this.cardBody,
      this.cardPivotLocal,
      1e6
    );
    this.cardJoint.collideConnected = false;
    this.world.addConstraint(this.cardJoint);
    this.constraints.push(this.cardJoint);

    this.cardBody.wakeUp();
    this.j3Body.wakeUp();
  }

  alignCardUnderJoint() {
    if (!this.cardBody || !this.j3Body) return;
    // Start in a no-stress pose: card pivot sits exactly at j3.
    this.cardBody.quaternion.set(0, 0, 0, 1);
    this.cardBody.angularVelocity.set(0, 0, 0);
    this.cardBody.velocity.set(0, 0, 0);
    this.cardBody.position.set(
      this.j3Body.position.x - this.cardPivotLocal.x,
      this.j3Body.position.y - this.cardPivotLocal.y,
      this.j3Body.position.z - this.cardPivotLocal.z
    );
    this.cardBody.wakeUp();
    this.j3Body.wakeUp();
  }

  attachEvents() {
    window.addEventListener('resize', this.onResize);
    window.addEventListener('mousemove', this.onMouseMove, true);
    window.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.onWindowBlur);
  }

  detachEvents() {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('mousemove', this.onMouseMove, true);
    window.removeEventListener('mousedown', this.onMouseDown, true);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.onWindowBlur);
  }

  onResize() {
    if (!this.renderer || !this.camera || !this.mount) return;

    const width = Math.max(1, this.mount.clientWidth || window.innerWidth);
    const height = Math.max(1, this.mount.clientHeight || window.innerHeight);

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobileViewport() ? 1.5 : 2));
    this.renderer.setSize(width, height, false);

    if (this.bandMaterial?.uniforms?.resolution?.value) {
      this.bandMaterial.uniforms.resolution.value.set(width, height);
    }
  }

  onMouseMove(event) {
    this.updatePointer(event);

    if (this.isDragging) {
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) {
        this.dragTarget.copy(this.dragPoint).sub(this.dragOffset);
      }
      this.updateCursor();
      return;
    }

    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = this.raycaster.intersectObjects(this.cardMeshes, true).length > 0;
    if (hit !== this.isHovered) {
      this.isHovered = hit;
      this.updateCursor();
    }
  }

  onMouseDown(event) {
    if (event.button !== 0 || !this.cardMeshes.length) return;

    this.updatePointer(event);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hits = this.raycaster.intersectObjects(this.cardMeshes, true);
    if (hits.length === 0) return;

    const firstHit = hits[0];
    this.isDragging = true;
    this.isHovered = true;
    this.setCardKinematic(true);
    this.wakeBodies();

    this.dragOffset.copy(firstHit.point).sub(this.cardAnchor.position);
    this.dragTarget.copy(this.cardAnchor.position);
    this.camera.getWorldDirection(this.dragPlaneNormal);
    this.dragPlane.setFromNormalAndCoplanarPoint(this.dragPlaneNormal, firstHit.point);

    this.updateCursor();
    event.preventDefault();
  }

  onMouseUp() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.setCardKinematic(false);
    this.wakeBodies();
    this.updateCursor();
  }

  onWindowBlur() {
    this.onMouseUp();
  }

  updatePointer(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  updateCursor() {
    if (this.destroyed) return;
    if (this.isDragging) {
      document.body.style.cursor = 'grabbing';
      return;
    }
    document.body.style.cursor = this.isHovered ? 'grab' : 'auto';
  }

  setCardKinematic(enabled) {
    if (!this.cardBody) return;

    if (enabled && this.cardBody.type !== CANNON.Body.KINEMATIC) {
      this.cardBody.type = CANNON.Body.KINEMATIC;
      this.cardBody.mass = 0;
      this.cardBody.updateMassProperties();
      this.cardBody.velocity.set(0, 0, 0);
      this.cardBody.angularVelocity.set(0, 0, 0);
      this.cardBody.force.set(0, 0, 0);
      this.cardBody.torque.set(0, 0, 0);
      this.cardBody.wakeUp();
      return;
    }

    if (!enabled && this.cardBody.type !== CANNON.Body.DYNAMIC) {
      this.cardBody.type = CANNON.Body.DYNAMIC;
      this.cardBody.mass = this.cardMass;
      this.cardBody.updateMassProperties();
      this.cardBody.wakeUp();
    }
  }

  wakeBodies() {
    this.j1Body?.wakeUp();
    this.j2Body?.wakeUp();
    this.j3Body?.wakeUp();
    this.cardBody?.wakeUp();
  }

  animate(now) {
    if (this.destroyed) return;
    this.rafId = window.requestAnimationFrame(this.animate);

    const delta = Math.min(0.033, Math.max(0.001, (now - this.lastFrameTime) / 1000));
    this.lastFrameTime = now;

    if (this.isDragging) {
      this.cardBody.position.set(this.dragTarget.x, this.dragTarget.y, this.dragTarget.z);
      this.cardBody.velocity.set(0, 0, 0);
      this.cardBody.angularVelocity.set(0, 0, 0);
      this.wakeBodies();
    }

    this.world.step(this.options.fixedTimeStep, delta, this.options.maxSubSteps);
    this.applyCardAngularCorrection();
    this.syncVisuals(delta, now);
    this.renderer.render(this.scene, this.camera);
  }

  applyCardAngularCorrection() {
    if (!this.cardBody || this.cardBody.type !== CANNON.Body.DYNAMIC) return;
    this.tmpQuat.set(
      this.cardBody.quaternion.x,
      this.cardBody.quaternion.y,
      this.cardBody.quaternion.z,
      this.cardBody.quaternion.w
    );
    this.tmpEuler.setFromQuaternion(this.tmpQuat, 'XYZ');
    // Mild upright stabilization so the idle card hangs straight.
    this.cardBody.angularVelocity.x -= this.tmpEuler.x * 0.35;
    this.cardBody.angularVelocity.y -= this.tmpEuler.y * 0.25;
    this.cardBody.angularVelocity.z -= this.tmpEuler.z * 0.35;
  }

  syncVisuals(delta, now) {
    if (!this.cardAnchor) return;

    this.cardAnchor.position.set(this.cardBody.position.x, this.cardBody.position.y, this.cardBody.position.z);
    this.cardAnchor.quaternion.set(
      this.cardBody.quaternion.x,
      this.cardBody.quaternion.y,
      this.cardBody.quaternion.z,
      this.cardBody.quaternion.w
    );

    this.tmpVecA.set(this.j1Body.position.x, this.j1Body.position.y, this.j1Body.position.z);
    this.tmpVecB.set(this.j2Body.position.x, this.j2Body.position.y, this.j2Body.position.z);
    this.tmpVecC.set(this.j3Body.position.x, this.j3Body.position.y, this.j3Body.position.z);
    this.tmpVecD.set(this.fixedBody.position.x, this.fixedBody.position.y, this.fixedBody.position.z);
    this.cardBody.quaternion.vmult(this.cardPivotLocal, this.cardPivotTmp);
    this.cardAttachWorld.set(
      this.cardBody.position.x + this.cardPivotTmp.x,
      this.cardBody.position.y + this.cardPivotTmp.y,
      this.cardBody.position.z + this.cardPivotTmp.z
    );
    this.cardVisualAttachWorld
      .copy(this.cardVisualAttachLocal)
      .applyQuaternion(this.cardAnchor.quaternion)
      .add(this.cardAnchor.position);

    this.j1Lerped.copy(this.tmpVecA);
    this.j2Lerped.copy(this.tmpVecB);

    // Force a mathematically straight strap from top anchor to card clip.
    for (let i = 0; i < this.straightBandPoints.length; i++) {
      const t = i / (this.straightBandPoints.length - 1);
      this.straightBandPoints[i].lerpVectors(this.tmpVecD, this.cardVisualAttachWorld, t);
    }
    this.bandGeometry.setPoints(this.straightBandPoints);

    // Visual bridge to blend strap into the metal ring/clip with no visible gap.
    if (this.tipMesh) {
      const tipLength = Math.max(0.02, Number(this.options.tipLength) || 0.16);
      this.tmpVecG.copy(this.cardVisualAttachWorld).sub(this.tmpVecD);
      const dirLen = this.tmpVecG.length();
      if (dirLen > 1e-5) {
        this.tmpVecG.multiplyScalar(1 / dirLen);
        this.tipMesh.position.copy(this.cardVisualAttachWorld).addScaledVector(this.tmpVecG, tipLength * 0.18);
        this.tipMesh.quaternion.setFromUnitVectors(this.yAxis, this.tmpVecG);
        this.tipMesh.visible = true;
      } else {
        this.tipMesh.visible = false;
      }
    }

    this.debugPhysics(now);
  }

  debugPhysics(now) {
    if (!this.options.debug) return;
    if (now - this.lastDebugLogTime < 800) return;
    this.lastDebugLogTime = now;

    const fixed = this.tmpVecD;
    const j1 = this.tmpVecA;
    const j2 = this.tmpVecB;
    const j3 = this.tmpVecC;
    const attach = this.cardAttachWorld;
    const visualAttach = this.cardVisualAttachWorld;

    const len01 = fixed.distanceTo(j1);
    const len12 = j1.distanceTo(j2);
    const len23 = j2.distanceTo(j3);
    const len34 = j3.distanceTo(attach);

    const bend1 = this.angleBetween(fixed, j1, j2);
    const bend2 = this.angleBetween(j1, j2, j3);
    const bend3 = this.angleBetween(j2, j3, attach);
    const attachGap = attach.distanceTo(visualAttach);

    const cardPos = this.cardBody.position;
    const cardVel = this.cardBody.velocity;
    console.log(`${LOG_TAG} rope-debug`, {
      segments: {
        fixed_j1: Number(len01.toFixed(3)),
        j1_j2: Number(len12.toFixed(3)),
        j2_j3: Number(len23.toFixed(3)),
        j3_attach: Number(len34.toFixed(3)),
      },
      bendsDeg: {
        atJ1: Number(bend1.toFixed(2)),
        atJ2: Number(bend2.toFixed(2)),
        atJ3: Number(bend3.toFixed(2)),
      },
      card: {
        pos: [Number(cardPos.x.toFixed(3)), Number(cardPos.y.toFixed(3)), Number(cardPos.z.toFixed(3))],
        vel: [Number(cardVel.x.toFixed(3)), Number(cardVel.y.toFixed(3)), Number(cardVel.z.toFixed(3))],
      },
      anchor: [Number(fixed.x.toFixed(3)), Number(fixed.y.toFixed(3)), Number(fixed.z.toFixed(3))],
      attachPhysics: [Number(attach.x.toFixed(3)), Number(attach.y.toFixed(3)), Number(attach.z.toFixed(3))],
      attachVisual: [Number(visualAttach.x.toFixed(3)), Number(visualAttach.y.toFixed(3)), Number(visualAttach.z.toFixed(3))],
      attachGap: Number(attachGap.toFixed(3)),
    });
  }

  angleBetween(a, b, c) {
    const ab = this.tmpVecE.subVectors(a, b).normalize();
    const cb = this.tmpVecF.subVectors(c, b).normalize();
    const dot = THREE.MathUtils.clamp(ab.dot(cb), -1, 1);
    return THREE.MathUtils.radToDeg(Math.acos(dot));
  }

  disposeGeometry(geometry) {
    if (!geometry || this.disposedGeometries.has(geometry)) return;
    geometry.dispose();
    this.disposedGeometries.add(geometry);
  }

  disposeTexture(texture) {
    if (!texture || this.disposedTextures.has(texture)) return;
    texture.dispose();
    this.disposedTextures.add(texture);
  }

  disposeMaterial(material) {
    if (!material || this.disposedMaterials.has(material)) return;
    const textureKeys = [
      'map',
      'alphaMap',
      'aoMap',
      'bumpMap',
      'displacementMap',
      'emissiveMap',
      'envMap',
      'lightMap',
      'metalnessMap',
      'normalMap',
      'roughnessMap',
      'specularMap',
      'clearcoatMap',
      'clearcoatNormalMap',
      'clearcoatRoughnessMap',
      'transmissionMap',
    ];
    for (const key of textureKeys) {
      if (material[key]?.isTexture) {
        this.disposeTexture(material[key]);
      }
    }
    material.dispose();
    this.disposedMaterials.add(material);
  }

  disposeObject(root) {
    if (!root) return;
    root.traverse((node) => {
      if (!node.isMesh) return;
      if (node.geometry) this.disposeGeometry(node.geometry);
      if (Array.isArray(node.material)) {
        for (const material of node.material) this.disposeMaterial(material);
      } else {
        this.disposeMaterial(node.material);
      }
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }

    this.detachEvents();
    document.body.style.cursor = 'auto';

    if (this.world) {
      while (this.world.constraints.length > 0) {
        this.world.removeConstraint(this.world.constraints[0]);
      }
      while (this.world.bodies.length > 0) {
        this.world.removeBody(this.world.bodies[0]);
      }
    }

    this.disposeObject(this.cardAnchor);
    this.disposeGeometry(this.bandGeometry);
    this.disposeGeometry(this.tipGeometry);
    this.disposeMaterial(this.bandMaterial);
    this.disposeMaterial(this.tipMaterial);
    this.disposeTexture(this.strapTexture);

    if (this.cardAnchor) this.scene?.remove(this.cardAnchor);
    if (this.bandMesh) this.scene?.remove(this.bandMesh);
    if (this.tipMesh) this.scene?.remove(this.tipMesh);

    if (this.renderer) {
      this.renderer.renderLists.dispose();
      this.renderer.dispose();
      if (typeof this.renderer.forceContextLoss === 'function') {
        this.renderer.forceContextLoss();
      }
      const canvas = this.renderer.domElement;
      if (canvas?.parentNode) {
        canvas.parentNode.removeChild(canvas);
      }
    }

    this.scene?.clear();

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.world = null;
    this.cardMeshes.length = 0;

    console.log(`${LOG_TAG} destroyed and resources disposed.`);
  }
}

function ensureMount() {
  const welcomeScreen = document.getElementById('welcomeScreen');
  if (!welcomeScreen) return null;

  let mount = document.getElementById('lanyardMount');
  if (!mount) {
    mount = document.createElement('div');
    mount.id = 'lanyardMount';
    mount.className = 'lanyard-mount';
    mount.setAttribute('aria-hidden', 'true');
    welcomeScreen.prepend(mount);
  }
  return mount;
}

export async function createLanyard(options = {}) {
  if (activeInstance) return activeInstance;
  if (createPromise) return createPromise;
  destroyAfterCreate = false;

  createPromise = (async () => {
    const mount = options.mount || ensureMount();
    if (!mount) throw new Error('Could not find #welcomeScreen to mount lanyard.');

    const instance = new VanillaLanyard({ ...options, mount });
    try {
      await instance.init();
      activeInstance = instance;
      if (destroyAfterCreate) {
        destroyAfterCreate = false;
        destroyLanyard();
        return null;
      }
      return instance;
    } catch (error) {
      instance.destroy();
      throw error;
    } finally {
      createPromise = null;
    }
  })();

  return createPromise;
}

export function destroyLanyard() {
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
      await createLanyard();
    } catch (error) {
      console.error(`${LOG_TAG} failed to create instance`, error);
    }
    return;
  }
  destroyLanyard();
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
    destroyLanyard();
  });

  syncLifecycleState();
}

if (typeof window !== 'undefined') {
  window.HybridLanyard = {
    createLanyard,
    destroyLanyard,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLifecycle, { once: true });
  } else {
    bootLifecycle();
  }
}
