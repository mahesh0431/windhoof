/**
 * Horse inspection surface.
 *
 * Renders the real rig, with the real materials and the real stage lighting,
 * into one contact sheet of fixed views. The horse is the only thing a player
 * looks at for the entire game, and judging it from inside the chase camera
 * means judging it at one distance, one angle, and whatever pose the ride
 * happened to be in. This page exists so a model change can be seen from every
 * side and in every gait in a single frame.
 *
 * Dev-only: no application code imports it and the production build has one
 * entry, so nothing here ships.
 */
import * as THREE from "three";
import { HorseGaitAnimator } from "../src/render/horse/horseGaitAnimator.ts";
import { WildHorseAnimator } from "../src/render/horse/wildHorseAnimator.ts";
import { createHorseRig } from "../src/render/horse/horseVisual.ts";
import { PALETTE, SUN_DIRECTION } from "../src/render/palette.ts";

const canvas = document.getElementById("preview");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setPixelRatio(1);

const scene = new THREE.Scene();
scene.background = new THREE.Color("#93a686");

const sun = new THREE.DirectionalLight(PALETTE.sunLight, 2.2);
sun.position.set(SUN_DIRECTION.x * 30, SUN_DIRECTION.y * 30, SUN_DIRECTION.z * 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 90;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 34;
sun.shadow.camera.top = 14;
sun.shadow.camera.bottom = -14;
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

scene.add(new THREE.HemisphereLight(PALETTE.skyLight, PALETTE.bounceLight, 2.05));

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(120, 120),
  new THREE.MeshStandardMaterial({ color: PALETTE.grassMid, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

/** One rig per pose, spaced apart so every camera sees only its own subject. */
const subjects = [
  { name: "idle", x: 0, gait: "idle", speed: 0, seconds: 1.5 },
  { name: "walk", x: 8, gait: "walk", speed: 2.2, seconds: 2.5 },
  { name: "trot", x: 16, gait: "trot", speed: 7.4, seconds: 2.5 },
  { name: "gallop", x: 24, gait: "gallop", speed: 16, seconds: 2.5 },
].map((definition) => {
  const rig = createHorseRig();
  rig.root.position.x = definition.x;
  scene.add(rig.root);
  return { ...definition, rig, animator: new HorseGaitAnimator() };
});

/**
 * The island's wild horses, held in the two poses they are baked in.
 *
 * They are the same rig as the player's, flattened into static geometry at
 * build time, so they never pass through the animator and nothing else in the
 * project ever photographs them. There are twenty-six of them on the island
 * against the player's one, and until this they were the only horses in the
 * game that could silently drift out of step with the model.
 *
 * The angles must stay in step with `flattenHorse` in src/world/islandWildlife.
 */
// Set well off the +X axis the turnaround cameras all look along, so a wild
// horse never appears as a ghost standing behind the subject of another view.
const WILD_POSES = [
  { name: "wildStanding", x: 0, z: -26, neck: 0.45, carry: 0.62 },
  { name: "wildGrazing", x: 0, z: -40, neck: 1.85, carry: 1.35 },
];
for (const pose of WILD_POSES) {
  const rig = createHorseRig();
  rig.root.position.set(pose.x, 0, pose.z);
  rig.neck.rotation.x = pose.neck;
  rig.head.rotation.x = -pose.neck + pose.carry;
  scene.add(rig.root);
  subjects.push({ ...pose, rig, animator: null, speed: 0, seconds: 0 });
}

/**
 * A wild horse in the act of kicking, held at the frame the hooves connect.
 *
 * Driven by the real behaviour animator with a player standing where a player
 * who ignored the warning would be, rather than by a hand-set pose: what this
 * photographs is what the game does.
 */
{
  const rig = createHorseRig();
  rig.root.position.set(0, 0, -54);
  scene.add(rig.root);
  const behaviour = new WildHorseAnimator(0.45, 0.62);
  behaviour.reset(0);
  behaviour.pose(rig);
  const step = 1 / 120;
  // Crowd it until it throws one, then stop on the strike.
  for (let frame = 0; frame < 120 * 8; frame += 1) {
    const strike = behaviour.update(rig, {
      distance: 2.2,
      bearing: 0 - behaviour.facing,
      deltaSeconds: step,
    });
    if (strike.connected) break;
  }
  // The hooves connect at the start of the extension; a few more steps carries
  // the legs to where they actually reach.
  for (let frame = 0; frame < 14; frame += 1) {
    behaviour.update(rig, {
      distance: 2.2,
      bearing: 0 - behaviour.facing,
      deltaSeconds: step,
    });
  }
  subjects.push({ name: "kick", x: 0, z: -54, rig, animator: null, speed: 0, seconds: 0 });
}

const subjectByName = new Map(subjects.map((subject) => [subject.name, subject]));

function settle(subject, seconds) {
  // The wild poses are static by construction; there is nothing to settle.
  if (!subject.animator) return;
  const step = 1 / 60;
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    subject.animator.update(subject.rig, {
      speed: subject.speed,
      gait: subject.gait,
      grounded: true,
      verticalVelocity: 0,
      condition: "normal",
      yawRate: 0,
      acceleration: 0,
      groundPitch: 0,
      groundRoll: 0,
      deltaSeconds: step,
      reducedMotion: false,
    });
  }
}

for (const subject of subjects) settle(subject, subject.seconds);

/**
 * Views are named so a refinement pass can ask for one at full canvas size
 * rather than squinting at a sheet cell.
 *
 * The horse faces +Z, so +X is its left side and the profile camera lives
 * there. Offsets are metres from the subject's own root.
 */
const VIEWS = {
  profile: { subject: "idle", offset: [7.4, 1.1, 0.2], target: [0, 1.0, 0.2], fov: 32 },
  quarter: { subject: "idle", offset: [5.2, 2.2, 4.6], target: [0, 1.0, 0.15], fov: 32 },
  front: { subject: "idle", offset: [0.5, 1.5, 6.4], target: [0, 1.15, 0.5], fov: 30 },
  rear: { subject: "idle", offset: [-0.5, 1.7, -6], target: [0, 1.15, -0.5], fov: 30 },
  head: { subject: "idle", offset: [1.5, 2.05, 2.3], target: [0, 1.85, 1.2], fov: 32 },
  above: { subject: "idle", offset: [0.01, 7.6, 0.1], target: [0, 1, 0.1], fov: 32 },
  walk: { subject: "walk", offset: [7.4, 1.1, 0.2], target: [0, 1.0, 0.2], fov: 32 },
  trot: { subject: "trot", offset: [7.4, 1.1, 0.2], target: [0, 1.0, 0.2], fov: 32 },
  gallop: { subject: "gallop", offset: [7.4, 1.2, 0.2], target: [0, 1.05, 0.2], fov: 32 },
  gallopQuarter: {
    subject: "gallop",
    offset: [5.4, 2.4, 4.6],
    target: [0, 1.1, 0.2],
    fov: 32,
  },
  wildStanding: {
    subject: "wildStanding",
    offset: [6.8, 1.5, 2.6],
    target: [0, 1.05, 0.2],
    fov: 32,
  },
  wildGrazing: {
    subject: "wildGrazing",
    offset: [6.8, 1.5, 2.6],
    target: [0, 0.95, 0.3],
    fov: 32,
  },
  // Where the player is standing when it lands.
  //
  // The horse has turned its quarters onto them, so "behind the horse" and
  // "where the camera goes" are the same place, and it is the side the animal
  // is now facing away from.
  kick: {
    subject: "kick",
    offset: [3.4, 1.6, 6.8],
    target: [0, 1.05, 0.7],
    fov: 34,
  },
};

const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

function renderView(name, x, y, width, height) {
  const view = VIEWS[name];
  const subject = subjectByName.get(view.subject);
  const origin = subject.rig.root.position;

  // One subject at a time. Spacing them apart is not enough on its own: every
  // camera here looks along an axis, and any subject that happens to lie down
  // one of those axes turns up in the frame as a ghost horse standing behind
  // the one being photographed.
  for (const other of subjects) other.rig.root.visible = other === subject;

  camera.fov = view.fov;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  camera.position.set(
    origin.x + view.offset[0],
    origin.y + view.offset[1],
    origin.z + view.offset[2],
  );
  camera.lookAt(
    origin.x + view.target[0],
    origin.y + view.target[1],
    origin.z + view.target[2],
  );

  renderer.setViewport(x, y, width, height);
  renderer.setScissor(x, y, width, height);
  renderer.setScissorTest(true);
  renderer.render(scene, camera);
}

/** Lays the named views out in a grid, bottom-left origin like WebGL wants. */
function sheet(names, columns, cellWidth, cellHeight) {
  const rows = Math.ceil(names.length / columns);
  const width = columns * cellWidth;
  const height = rows * cellHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  renderer.setSize(width, height, false);

  renderer.setScissorTest(false);
  renderer.clear();
  names.forEach((name, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    renderView(
      name,
      column * cellWidth,
      height - (row + 1) * cellHeight,
      cellWidth,
      cellHeight,
    );
  });
  renderer.setScissorTest(false);
}

window.__horsePreview = {
  views: Object.keys(VIEWS),
  sheet,
  single(name, width, height) {
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    renderer.setSize(width, height, false);
    renderer.setScissorTest(false);
    renderer.clear();
    renderView(name, 0, 0, width, height);
    renderer.setScissorTest(false);
  },
  /** Advances one pose, so a gait can be photographed at several phases. */
  advance(subjectName, seconds) {
    settle(subjectByName.get(subjectName), seconds);
  },
  triangles: () => renderer.info.render.triangles,
  /**
   * Lowest point of a subject, in world metres.
   *
   * The ground is at zero, so this is the one number that says whether a pose
   * has driven the horse's feet through it - which a whole-body pitch about an
   * origin sitting at hoof level very easily can, and which no screenshot
   * without a contact shadow under it will show.
   */
  /**
   * Worst ground penetration across a whole gait cycle, in metres.
   *
   * One frame says nothing: the body bobs, pitches and rolls through the
   * stride, and whether a planted hoof goes under the ground depends on which
   * phase it is caught in. This walks the animator through several full cycles
   * and keeps the deepest point any part of the horse reached.
   */
  sweepLowest(name, seconds = 4, hz = 120) {
    const subject = subjectByName.get(name);
    if (!subject.animator) return this.lowest(name);
    const step = 1 / hz;
    const box = new THREE.Box3();
    let worst = Infinity;
    for (let elapsed = 0; elapsed < seconds; elapsed += step) {
      subject.animator.update(subject.rig, {
        speed: subject.speed,
        gait: subject.gait,
        grounded: true,
        verticalVelocity: 0,
        condition: "normal",
        yawRate: 0,
        acceleration: 0,
        groundPitch: 0,
        groundRoll: 0,
        deltaSeconds: step,
        reducedMotion: false,
      });
      subject.rig.root.updateMatrixWorld(true);
      worst = Math.min(worst, box.setFromObject(subject.rig.root).min.y);
    }
    return worst;
  },
  lowest(name) {
    const subject = subjectByName.get(name);
    subject.rig.root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(subject.rig.root).min.y;
  },
  /** What one horse costs, independent of how many the sheet has on screen. */
  model() {
    let triangles = 0;
    let meshes = 0;
    subjects[0].rig.root.traverse((object) => {
      if (!object.isMesh) return;
      meshes += 1;
      const position = object.geometry.getAttribute("position");
      triangles += (object.geometry.index?.count ?? position.count) / 3;
    });
    return { triangles, meshes };
  },
};

document.documentElement.dataset.horsePreview = "ready";
