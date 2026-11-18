import * as THREE from "three";
import { OrbitControls } from "../vendor/OrbitControls.js";
import { RoomEnvironment } from "../vendor/RoomEnvironment.js";
import { Machine } from "./machine.js";
import { TweenManager } from "./tweens.js";
import { SelectionManager } from "./interactions.js";
import { SimulationController } from "./simulation.js";
import { UIController } from "./ui.js";

const canvas = document.getElementById("viewportCanvas");
const viewport = document.getElementById("viewport");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(viewport.clientWidth, viewport.clientHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02070d);
scene.fog = new THREE.FogExp2(0x02070d, 0.045);

const camera = new THREE.PerspectiveCamera(31, 1, 0.03, 20);
const defaultPosition = new THREE.Vector3(3, 2.1, 4.2);
camera.position.copy(defaultPosition);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.065;
controls.zoomSpeed = 0.8;
controls.rotateSpeed = 0.62;
controls.panSpeed = 0.52;
controls.minDistance = 0.24;
controls.maxDistance = 7;
controls.minPolarAngle = 0.05;
controls.maxPolarAngle = Math.PI * 0.94;
controls.screenSpacePanning = true;
controls.update();

const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();
const room = new RoomEnvironment();
const environmentTexture = pmrem.fromScene(room, 0.04).texture;
scene.environment = environmentTexture;
scene.environmentIntensity = 0.72;
room.dispose?.();
pmrem.dispose();

scene.add(new THREE.HemisphereLight(0x9ed5ff, 0x05080b, 1.45));

const keyLight = new THREE.DirectionalLight(0xe0f7ff, 3.1);
keyLight.position.set(2.8, 4.2, 3.2);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -2.6;
keyLight.shadow.camera.right = 2.6;
keyLight.shadow.camera.top = 2.6;
keyLight.shadow.camera.bottom = -2.6;
keyLight.shadow.camera.near = 0.5;
keyLight.shadow.camera.far = 9;
keyLight.shadow.bias = -0.0006;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x3c9dff, 2.4);
rimLight.position.set(-3.3, 2.2, -2.6);
scene.add(rimLight);

const frontFill = new THREE.PointLight(0x56cfff, 2.4, 5.5, 2);
frontFill.position.set(-1.8, 1.2, 2.4);
scene.add(frontFill);

const warmFill = new THREE.PointLight(0xffb15c, 0.8, 4, 2);
warmFill.position.set(2.2, 0.8, -1.4);
scene.add(warmFill);

const floorMaterial = new THREE.MeshStandardMaterial({
  color: 0x03090e,
  metalness: 0.48,
  roughness: 0.58,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), floorMaterial);
floor.name = "TechnicalFloor";
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.005;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(8, 80, 0x1a5f7a, 0x102d3c);
grid.name = "EngineeringGrid";
grid.position.y = 0.001;
grid.material.transparent = true;
grid.material.opacity = 0.36;
grid.material.depthWrite = false;
scene.add(grid);

const floorRing = new THREE.Mesh(
  new THREE.RingGeometry(1.26, 1.275, 96),
  new THREE.MeshBasicMaterial({
    color: 0x2b9dc6,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
);
floorRing.name = "EquipmentFootprint";
floorRing.rotation.x = -Math.PI / 2;
floorRing.position.y = 0.002;
scene.add(floorRing);

const tweens = new TweenManager();
const machine = new Machine(scene, tweens);

let ui;
const selection = new SelectionManager({
  machine,
  camera,
  renderer,
  controls,
  tweens,
  onChange: (currentSelection) => ui?.handleSelection(currentSelection),
});
selection.attach(canvas);

const simulation = new SimulationController(machine, tweens, (snapshot, reason) => {
  ui?.update(snapshot, reason);
});

function tweenCamera(position, target, duration = 700) {
  tweens.to(camera.position, { x: position.x, y: position.y, z: position.z }, duration, {
    channel: "camera",
    easing: "easeInOut",
  });
  tweens.to(controls.target, { x: target.x, y: target.y, z: target.z }, duration, {
    channel: "camera",
    easing: "easeInOut",
  });
}

function setView(viewName) {
  const views = {
    iso: {
      position: new THREE.Vector3(3, 2.1, 4.2),
      target: new THREE.Vector3(0, 1, 0),
      up: new THREE.Vector3(0, 1, 0),
    },
    front: {
      position: new THREE.Vector3(0, 1.2, 5.55),
      target: new THREE.Vector3(0, 1, 0),
      up: new THREE.Vector3(0, 1, 0),
    },
    side: {
      position: new THREE.Vector3(5.45, 1.2, 0.03),
      target: new THREE.Vector3(0, 1, 0),
      up: new THREE.Vector3(0, 1, 0),
    },
    top: {
      position: new THREE.Vector3(0.001, 4.7, 0.001),
      target: new THREE.Vector3(0, 0.85, 0),
      up: new THREE.Vector3(0, 0, -1),
    },
  };
  if (viewName === "reset") {
    viewName = "iso";
    selection.clearSelection({ resetFocus: false });
  }
  const preset = views[viewName] || views.iso;
  camera.up.copy(preset.up);
  tweenCamera(preset.position, preset.target);
}

ui = new UIController({
  machine,
  simulation,
  selection,
  tweens,
  onView: setView,
});

simulation.initialize();

function updateViewportSize() {
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  camera.aspect = width / height;
  camera.fov = camera.aspect < 0.78 ? 39 : camera.aspect < 1 ? 35 : 31;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);
}

const resizeObserver = new ResizeObserver(updateViewportSize);
resizeObserver.observe(viewport);
window.addEventListener("resize", updateViewportSize);
updateViewportSize();

const clock = new THREE.Clock();
let frameCount = 0;
let fpsAccumulator = 0;
let lastReadoutUpdate = 0;

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  tweens.update(delta);
  controls.update();
  machine.update(elapsed, delta);
  selection.update();
  renderer.render(scene, camera);

  frameCount += 1;
  fpsAccumulator += delta;
  if (elapsed - lastReadoutUpdate > 0.24) {
    const fps = Math.round(frameCount / Math.max(0.001, fpsAccumulator));
    document.getElementById("fpsText").textContent = `${fps} FPS`;
    document.getElementById("drawCallText").textContent = `${renderer.info.render.calls} CALLS`;
    const axis = machine.getAxisReadout();
    document.getElementById("readoutX").textContent = String(axis.x).padStart(4, "0");
    document.getElementById("readoutY").textContent = String(axis.y).padStart(4, "0");
    document.getElementById("readoutZ").textContent = String(axis.z).padStart(4, "0");
    frameCount = 0;
    fpsAccumulator = 0;
    lastReadoutUpdate = elapsed;
  }
}

animate();

const bootProgress = document.getElementById("bootProgress");
[35, 68, 92].forEach((progress, index) => {
  setTimeout(() => {
    if (bootProgress) bootProgress.textContent = `${progress}%`;
  }, 160 + index * 180);
});
setTimeout(() => {
  if (bootProgress) bootProgress.textContent = "100%";
  document.getElementById("bootLoader")?.classList.add("is-hidden");
}, 780);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) clock.getDelta();
});

window.digitalTwin = {
  THREE,
  scene,
  camera,
  renderer,
  controls,
  machine,
  selection,
  simulation,
  tweens,
  ui,
};
