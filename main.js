import * as THREE from "./vendor/three.module.js";

const canvas = document.getElementById("c");
const hint = document.getElementById("hint");

const xSegs = 32;
const ySegs = 22;
const restDistance = 11;
const clothWidth = restDistance * xSegs;
const clothHeight = restDistance * ySegs;

const DAMPING = 0.028;
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
    particles.push(
      new Particle(
        u * restDistance - clothWidth * 0.5,
        clothHeight * 0.5 - v * restDistance,
        0
      )
    );
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

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x000000, 0.0015);

const camera = new THREE.PerspectiveCamera(
  28,
  window.innerWidth / window.innerHeight,
  1,
  5000
);

scene.add(new THREE.AmbientLight(0x0a0a0a, 0.55));

const key = new THREE.DirectionalLight(0xffffff, 0.35);
key.position.set(160, 240, 360);
scene.add(key);

const fill = new THREE.DirectionalLight(0xffffff, 0.12);
fill.position.set(-120, 40, 180);
scene.add(fill);

const geometry = new THREE.PlaneGeometry(clothWidth, clothHeight, xSegs, ySegs);

const texture = new THREE.TextureLoader().load("./assets/flag.png", (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
});
texture.colorSpace = THREE.SRGBColorSpace;

const material = new THREE.MeshStandardMaterial({
  map: texture,
  emissiveMap: texture,
  emissive: new THREE.Color(0xffffff),
  emissiveIntensity: 0.12,
  color: new THREE.Color(0x000000),
  roughness: 0.95,
  metalness: 0,
  side: THREE.DoubleSide
});

const cloth = new THREE.Mesh(geometry, material);
cloth.frustumCulled = false;
scene.add(cloth);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragHit = new THREE.Vector3();
const camDir = new THREE.Vector3();

let dragging = false;
let dragParticle = null;
let dragPos = new THREE.Vector3();

function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const x = event.touches ? event.touches[0].clientX : event.clientX;
  const y = event.touches ? event.touches[0].clientY : event.clientY;
  pointer.x = ((x - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((y - rect.top) / rect.height) * 2 + 1;
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

canvas.addEventListener("pointerdown", onPointerDown);
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("touchstart", (e) => { e.preventDefault(); onPointerDown(e); }, { passive: false });
window.addEventListener("touchmove", (e) => { if (dragging) { e.preventDefault(); onPointerMove(e); } }, { passive: false });
window.addEventListener("touchend", onPointerUp);

const wind = new THREE.Vector3();
const localWind = new THREE.Vector3();

function simulate(now) {
  const t = now * 0.001;

  wind.set(
    0.45 + Math.sin(t * 0.65) * 0.2,
    Math.cos(t * 0.85) * 0.1,
    0.35 + Math.sin(t * 1.15) * 0.45 + Math.cos(t * 0.35) * 0.15
  );
  wind.multiplyScalar(34);

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const nx = p.original.x / clothWidth;
    const ny = p.original.y / clothHeight;
    const gust = 0.55 + 0.45 * Math.sin(t * 1.8 + nx * 8 + ny * 4);
    localWind.copy(wind).multiplyScalar(gust);
    // ripple along free edge
    localWind.z += Math.sin(t * 2.4 + nx * 10) * 4 * (nx + 0.5);

    p.addForce(GRAVITY);
    p.addForce(localWind);
    p.integrate(TIMESTEP_SQ);
  }

  for (let pass = 0; pass < 5; pass++) {
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
  // PlaneGeometry vertex order matches our u-major, v-down grid
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i].position;
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

function onResize() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const portrait = h > w;

  camera.aspect = w / h;
  camera.fov = portrait ? 32 : 28;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);

  const vFov = THREE.MathUtils.degToRad(camera.fov);
  // Portrait: keep visible but smaller; desktop unchanged feel
  const margin = portrait ? 1.85 : 1.25;
  const fitH = ((clothHeight * 0.5) * margin) / Math.tan(vFov * 0.5);
  const hFov = 2 * Math.atan(Math.tan(vFov * 0.5) * camera.aspect);
  const fitW = ((clothWidth * 0.5) * margin) / Math.tan(hFov * 0.5);
  const dist = portrait ? fitH * 1.15 : Math.max(fitH, fitW);

  camera.position.set(portrait ? 0 : 18, portrait ? 0 : 8, dist);
  camera.lookAt(portrait ? 0 : 10, portrait ? 0 : -6, 0);
}

window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", () => setTimeout(onResize, 200));
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", onResize);
}
onResize();

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
setTimeout(() => hint.classList.add("hide"), 4500);
