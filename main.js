import * as THREE from "./vendor/three.module.js";

const canvas = document.getElementById("c");
const hint = document.getElementById("hint");
const errBox = document.getElementById("err");

function fail(msg) {
  errBox.hidden = false;
  errBox.textContent = msg;
  throw new Error(msg);
}

if (!canvas) fail("Canvas missing.");
if (!window.WebGLRenderingContext) fail("WebGL is not available on this device.");

const isMobile =
  window.matchMedia("(max-width: 900px), (pointer: coarse)").matches ||
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

const xSegs = isMobile ? 22 : 32;
const ySegs = isMobile ? 16 : 22;
const restDistance = isMobile ? 13 : 11;
const clothWidth = restDistance * xSegs;
const clothHeight = restDistance * ySegs;

const DAMPING = 0.03;
const DRAG = 1 - DAMPING;
const MASS = 0.1;
const TIMESTEP = 16 / 1000;
const TIMESTEP_SQ = TIMESTEP * TIMESTEP;
const GRAVITY = new THREE.Vector3(0, -22, 0).multiplyScalar(MASS);

const pinIndices = new Set();
for (let i = 0; i <= ySegs; i++) pinIndices.add(i * (xSegs + 1));

class Particle {
  constructor(x, y, z) {
    this.position = new THREE.Vector3(x, y, z);
    this.previous = new THREE.Vector3(x, y, z);
    this.original = new THREE.Vector3(x, y, z);
    this.a = new THREE.Vector3(0, 0, 0);
    this.invMass = 1 / MASS;
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
  }

  addForce(force) {
    this.a.addScaledVector(force, this.invMass);
  }

  integrate(timesq) {
    const vel = this.tmp.subVectors(this.position, this.previous).multiplyScalar(DRAG);
    const next = this.tmp2.copy(this.position).add(vel).addScaledVector(this.a, timesq);
    this.previous.copy(this.position);
    this.position.copy(next);
    this.a.set(0, 0, 0);
  }
}

function idx(u, v) {
  return u + v * (xSegs + 1);
}

const particles = [];
const constraints = [];

for (let v = 0; v <= ySegs; v++) {
  for (let u = 0; u <= xSegs; u++) {
    const x = u * restDistance - clothWidth * 0.5;
    const y = clothHeight * 0.5 - v * restDistance;
    // start already billowed so it isn't invisible black-on-black
    const z = Math.sin((u / xSegs) * Math.PI) * (18 + (isMobile ? 10 : 0));
    particles.push(new Particle(x, y, z));
  }
}

function link(a, b, dist) {
  constraints.push({ p1: particles[a], p2: particles[b], distance: dist });
}

for (let v = 0; v <= ySegs; v++) {
  for (let u = 0; u <= xSegs; u++) {
    if (u < xSegs) link(idx(u, v), idx(u + 1, v), restDistance);
    if (v < ySegs) link(idx(u, v), idx(u, v + 1), restDistance);
    if (u < xSegs && v < ySegs) {
      const d = restDistance * Math.SQRT2;
      link(idx(u, v), idx(u + 1, v + 1), d);
      link(idx(u + 1, v), idx(u, v + 1), d);
    }
  }
}

for (let v = 0; v <= ySegs; v++) {
  for (let u = 0; u <= xSegs - 2; u++) {
    link(idx(u, v), idx(u + 2, v), restDistance * 2);
  }
}
for (let v = 0; v <= ySegs - 2; v++) {
  for (let u = 0; u <= xSegs; u++) {
    link(idx(u, v), idx(u, v + 2), restDistance * 2);
  }
}

const diff = new THREE.Vector3();
function satisfy(c) {
  const { p1, p2, distance } = c;
  diff.subVectors(p2.position, p1.position);
  const dist = diff.length();
  if (dist < 1e-6) return;
  diff.multiplyScalar((1 - distance / dist) * 0.5);
  p1.position.add(diff);
  p2.position.sub(diff);
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isMobile,
    powerPreference: "high-performance",
    alpha: false
  });
} catch (e) {
  fail("Could not create WebGL context.");
}

renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.75 : 2));
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(32, 1, 1, 8000);

scene.add(new THREE.AmbientLight(0x202020, 1.6));

const key = new THREE.DirectionalLight(0xffffff, 1.7);
key.position.set(140, 220, 360);
scene.add(key);

const rim = new THREE.DirectionalLight(0x66ff66, 0.55);
rim.position.set(-140, 40, -180);
scene.add(rim);

const fill = new THREE.PointLight(0x274027, 70, 1200, 2);
fill.position.set(40, -20, 260);
scene.add(fill);

const geometry = new THREE.PlaneGeometry(clothWidth, clothHeight, xSegs, ySegs);

const texture = new THREE.TextureLoader().load(
  "./assets/flag.png",
  (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
  },
  undefined,
  () => fail("Failed to load flag texture.")
);
texture.colorSpace = THREE.SRGBColorSpace;

const material = new THREE.MeshPhysicalMaterial({
  map: texture,
  emissiveMap: texture,
  emissive: new THREE.Color(0x33ff33),
  emissiveIntensity: isMobile ? 0.95 : 0.7,
  color: new THREE.Color(0x050505),
  roughness: 0.78,
  metalness: 0.04,
  sheen: 1,
  sheenRoughness: 0.65,
  sheenColor: new THREE.Color(0x1a3a1a),
  side: THREE.DoubleSide
});

const cloth = new THREE.Mesh(geometry, material);
cloth.frustumCulled = false;
scene.add(cloth);

const pole = new THREE.Mesh(
  new THREE.CylinderGeometry(3.4, 4, clothHeight + 90, isMobile ? 12 : 20),
  new THREE.MeshStandardMaterial({
    color: 0x121212,
    roughness: 0.3,
    metalness: 0.9
  })
);
pole.position.set(-clothWidth * 0.5 - 1.5, -8, 0);
scene.add(pole);

const tip = new THREE.Mesh(
  new THREE.SphereGeometry(6, 16, 16),
  new THREE.MeshStandardMaterial({
    color: 0x0e120e,
    emissive: 0x1a331a,
    emissiveIntensity: 0.55,
    metalness: 0.95,
    roughness: 0.22
  })
);
tip.position.set(-clothWidth * 0.5 - 1.5, clothHeight * 0.5 + 48, 0);
scene.add(tip);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragHit = new THREE.Vector3();
const camDir = new THREE.Vector3();

let dragging = false;
let dragParticle = null;
const dragPos = new THREE.Vector3();

function viewportSize() {
  const vv = window.visualViewport;
  if (vv) return { w: Math.max(1, vv.width), h: Math.max(1, vv.height) };
  return {
    w: Math.max(1, window.innerWidth),
    h: Math.max(1, window.innerHeight)
  };
}

function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const src = event.touches && event.touches[0] ? event.touches[0] : event;
  const x = src.clientX;
  const y = src.clientY;
  pointer.x = ((x - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
  pointer.y = -((y - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
}

function nearestParticle(point) {
  let best = null;
  let bestDist = Infinity;
  for (let i = 0; i < particles.length; i++) {
    if (pinIndices.has(i)) continue;
    const d = particles[i].position.distanceToSquared(point);
    if (d < bestDist) {
      bestDist = d;
      best = particles[i];
    }
  }
  return best;
}

function onPointerDown(event) {
  event.preventDefault();
  if (event.target.setPointerCapture && event.pointerId != null) {
    try {
      event.target.setPointerCapture(event.pointerId);
    } catch (_) {}
  }
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(cloth);
  if (!hits.length) return;

  dragging = true;
  document.documentElement.classList.add("dragging");
  document.body.classList.add("dragging");
  camera.getWorldDirection(camDir);
  dragPlane.setFromNormalAndCoplanarPoint(camDir.clone().negate(), hits[0].point);
  dragParticle = nearestParticle(hits[0].point);
  dragPos.copy(hits[0].point);
  hint.classList.add("hide");
}

function onPointerMove(event) {
  if (!dragging || !dragParticle) return;
  event.preventDefault();
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  if (raycaster.ray.intersectPlane(dragPlane, dragHit)) {
    dragPos.copy(dragHit);
    dragParticle.position.copy(dragPos);
    dragParticle.previous.copy(dragPos);
  }
}

function onPointerUp() {
  dragging = false;
  dragParticle = null;
  document.documentElement.classList.remove("dragging");
  document.body.classList.remove("dragging");
}

canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
canvas.addEventListener("pointermove", onPointerMove, { passive: false });
canvas.addEventListener("pointerup", onPointerUp);
canvas.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("pointerleave", onPointerUp);

const wind = new THREE.Vector3();
const localWind = new THREE.Vector3();

function simulate(now) {
  const t = now * 0.001;
  const windScale = isMobile ? 42 : 34;

  wind.set(
    0.5 + Math.sin(t * 0.65) * 0.22,
    Math.cos(t * 0.85) * 0.12,
    0.45 + Math.sin(t * 1.15) * 0.5 + Math.cos(t * 0.35) * 0.18
  );
  wind.multiplyScalar(windScale);

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const nx = p.original.x / clothWidth;
    const ny = p.original.y / clothHeight;
    const gust = 0.55 + 0.45 * Math.sin(t * 1.8 + nx * 8 + ny * 4);
    localWind.copy(wind).multiplyScalar(gust);
    localWind.z += Math.sin(t * 2.4 + nx * 10) * 5 * (nx + 0.5);
    p.addForce(GRAVITY);
    p.addForce(localWind);
    p.integrate(TIMESTEP_SQ);
  }

  const passes = isMobile ? 4 : 5;
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < constraints.length; i++) satisfy(constraints[i]);

    for (const i of pinIndices) {
      const p = particles[i];
      p.position.copy(p.original);
      p.previous.copy(p.original);
    }

    if (dragging && dragParticle) {
      dragParticle.position.copy(dragPos);
      dragParticle.previous.copy(dragPos);
    }
  }
}

function updateGeometry() {
  const pos = geometry.attributes.position;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i].position;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function fitCamera() {
  const { w, h } = viewportSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  // Fit whole flag + pole in both portrait and landscape
  const margin = isMobile ? 1.22 : 1.18;
  const fitW = clothWidth + 40;
  const fitH = clothHeight + 70;
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const distH = (fitH * 0.5 * margin) / Math.tan(vFov * 0.5);
  const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * camera.aspect);
  const distW = (fitW * 0.5 * margin) / Math.tan(hFov * 0.5);
  const dist = Math.max(distH, distW);

  camera.position.set(8, 0, dist);
  camera.lookAt(8, -4, 0);
}

window.addEventListener("resize", fitCamera);
window.addEventListener("orientationchange", () => setTimeout(fitCamera, 150));
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", fitCamera);
  window.visualViewport.addEventListener("scroll", fitCamera);
}
fitCamera();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = now - last;
  last = now;
  const steps = dt > 28 ? 2 : 1;
  for (let s = 0; s < steps; s++) simulate(now);
  updateGeometry();
  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
setTimeout(() => hint.classList.add("hide"), 5000);
