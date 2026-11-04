import * as THREE from "./vendor/three.module.js";

const canvas = document.getElementById("c");
const hint = document.getElementById("hint");

const xSegs = 30;
const ySegs = 20;
const restDistance = 12;
const clothWidth = restDistance * xSegs;
const clothHeight = restDistance * ySegs;

const DAMPING = 0.03;
const DRAG = 1 - DAMPING;
const MASS = 0.1;
const TIMESTEP_SQ = (18 / 1000) ** 2;
const GRAVITY = new THREE.Vector3(0, -24, 0).multiplyScalar(MASS);

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
    const z = Math.sin((u / xSegs) * Math.PI) * 16;
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
  for (let u = 0; u <= xSegs - 2; u++) link(idx(u, v), idx(u + 2, v), restDistance * 2);
}
for (let v = 0; v <= ySegs - 2; v++) {
  for (let u = 0; u <= xSegs; u++) link(idx(u, v), idx(u, v + 2), restDistance * 2);
}

const diff = new THREE.Vector3();
function satisfy(c) {
  diff.subVectors(c.p2.position, c.p1.position);
  const dist = diff.length();
  if (dist < 1e-6) return;
  diff.multiplyScalar((1 - c.distance / dist) * 0.5);
  c.p1.position.add(diff);
  c.p2.position.sub(diff);
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  powerPreference: "high-performance"
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x000000, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(30, 1, 1, 5000);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.8);
key.position.set(120, 180, 260);
scene.add(key);
const rim = new THREE.DirectionalLight(0x66ff66, 0.7);
rim.position.set(-160, 40, -120);
scene.add(rim);

const geometry = new THREE.PlaneGeometry(clothWidth, clothHeight, xSegs, ySegs);

const texture = new THREE.TextureLoader().load("./assets/flag.png", (tex) => {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.needsUpdate = true;
});
texture.colorSpace = THREE.SRGBColorSpace;

// Standard material = wider device support than Physical/sheen
const material = new THREE.MeshStandardMaterial({
  map: texture,
  emissiveMap: texture,
  emissive: new THREE.Color(0xffffff),
  emissiveIntensity: 0.85,
  color: new THREE.Color(0xffffff),
  roughness: 0.7,
  metalness: 0.05,
  side: THREE.DoubleSide
});

const cloth = new THREE.Mesh(geometry, material);
cloth.frustumCulled = false;
scene.add(cloth);

const pole = new THREE.Mesh(
  new THREE.CylinderGeometry(3.2, 3.8, clothHeight + 80, 16),
  new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.35 })
);
pole.position.set(-clothWidth * 0.5 - 2, 0, 0);
scene.add(pole);

const tip = new THREE.Mesh(
  new THREE.SphereGeometry(5.5, 16, 16),
  new THREE.MeshStandardMaterial({
    color: 0x111111,
    emissive: 0x224422,
    emissiveIntensity: 0.6,
    metalness: 0.9,
    roughness: 0.25
  })
);
tip.position.set(-clothWidth * 0.5 - 2, clothHeight * 0.5 + 42, 0);
scene.add(tip);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane();
const dragHit = new THREE.Vector3();
const camDir = new THREE.Vector3();
let dragging = false;
let dragParticle = null;
const dragPos = new THREE.Vector3();

function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const src = event.touches?.[0] || event;
  pointer.x = ((src.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
  pointer.y = -((src.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
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
  try {
    canvas.setPointerCapture?.(event.pointerId);
  } catch (_) {}
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
window.addEventListener("pointermove", onPointerMove, { passive: false });
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);

const wind = new THREE.Vector3();
const localWind = new THREE.Vector3();

function simulate(now) {
  const t = now * 0.001;
  wind.set(
    0.45 + Math.sin(t * 0.7) * 0.2,
    Math.cos(t * 0.9) * 0.1,
    0.4 + Math.sin(t * 1.2) * 0.45
  );
  wind.multiplyScalar(32);

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const nx = p.original.x / clothWidth;
    const gust = 0.55 + 0.45 * Math.sin(t * 1.7 + nx * 7);
    localWind.copy(wind).multiplyScalar(gust);
    localWind.z += Math.sin(t * 2.2 + nx * 9) * 4 * (nx + 0.5);
    p.addForce(GRAVITY);
    p.addForce(localWind);
    p.integrate(TIMESTEP_SQ);
  }

  for (let pass = 0; pass < 4; pass++) {
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

function onResize() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);

  // Classic fit that worked on desktop; extra margin on tall phones
  const tall = h > w;
  const margin = tall ? 1.45 : 1.25;
  const span = Math.max(clothWidth / camera.aspect, clothHeight) * margin;
  camera.position.set(0, 0, span / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)));
  camera.lookAt(0, 0, 0);
}

window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", () => setTimeout(onResize, 200));
onResize();

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const steps = now - last > 28 ? 2 : 1;
  last = now;
  for (let s = 0; s < steps; s++) simulate(now);
  updateGeometry();
  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
setTimeout(() => hint.classList.add("hide"), 4500);
