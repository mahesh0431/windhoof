import {
  BufferAttribute,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  BufferGeometry,
} from "three";
import type { WorldManifest } from "../game/world/compiler/worldTypes";
import { mergeGeometries } from "../render/geometryUtils";
import { createHorseRig } from "../render/horse/horseVisual";
import {
  NOTICE_RADIUS,
  WildHorseAnimator,
  type WildHorseMood,
} from "../render/horse/wildHorseAnimator";
import { ROUTE_DISTANCE_CAP, type IslandField } from "./islandField";

/**
 * What else lives here.
 *
 * The island used to be populated by the journey: a scripted herd at the end of
 * it, small four-legged animals crossing one authored line, and cones standing
 * in for birds over two authored points. All three were props for a story, and
 * the story is gone - this is a place to ride around now, so what lives here
 * should be here because it lives here.
 *
 * Two things, both scattered rather than staged:
 *
 * - **Wild horses**, in ones and twos and threes, anywhere the ground is good.
 *   They are the same model the player is riding, merged flat into one
 *   instanced mesh, because the one animal a player will look hardest at is
 *   another of their own kind.
 * - **Birds**, in flocks that circle points all over the island rather than the
 *   two the journey cared about.
 */

/** Where a wild horse stands, for the physics layer to build a collider from. */
export interface WildHorseCollider {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
}

export interface IslandWildlife {
  readonly group: Group;
  readonly horseCount: number;
  readonly birdCount: number;
  readonly triangleCount: number;
  /** Published for physics to own; the renderer never creates a collider. */
  readonly horseColliders: readonly WildHorseCollider[];
  update(elapsedSeconds: number, player: PlayerSense): void;
  /**
   * Kicks that landed since the last call, and clears them.
   *
   * Pulled rather than pushed so the caller decides when a hit becomes a shove;
   * the renderer has no business applying force to the player.
   */
  consumeKicks(): readonly WildHorseKick[];
  /**
   * Where every horse is and what the awake ones are thinking.
   *
   * Inspection only: an automated ride has to be able to steer to a real horse
   * rather than to a coordinate copied into a script, and the behaviour is
   * otherwise invisible to everything outside this module.
   */
  describeHorses(): readonly WildHorseReport[];
  dispose(): void;
}

export interface WildHorseReport {
  readonly x: number;
  readonly z: number;
  readonly grazing: boolean;
  readonly live: boolean;
  readonly mood: WildHorseMood | null;
}

export interface PlayerSense {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly deltaSeconds: number;
}

export interface WildHorseKick {
  /** Unit vector from the horse to the player: the way the player is thrown. */
  readonly awayX: number;
  readonly awayZ: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Horses on the island, in total. */
const HORSE_TARGET = 26;

/**
 * How many horses may be animating at once.
 *
 * One. A live horse is the full rig - thirty-two meshes, counted twice because
 * it casts shadows - against a single draw for the whole instanced herd.
 *
 * Two was tried and measured: riding through a band of horses peaked at 297
 * draw calls, and the riding gate is 240 with a peak allowance of 340. One rig
 * fits inside the steady gate with room to spare; two does not. It also costs
 * almost nothing to watch, because the player can only crowd one horse at a
 * time - in the measured ride the second live horse never got past watching.
 */
const LIVE_HORSE_BUDGET = 1;

/**
 * How much closer a rival has to be before it takes the live rig, in metres.
 *
 * Without it, standing between two horses at nearly equal range hands the rig
 * back and forth every frame, and each handover re-poses a horse from scratch.
 */
const LIVE_HORSE_STICKINESS = 2.5;

/**
 * Radius and height of a wild horse's collider.
 *
 * Upright and round rather than a box along the animal: a live horse turns to
 * face the player and then turns its quarters to them, and a static oriented box
 * would be pointing the wrong way within a second of the player arriving. Round
 * is slightly generous at the nose and tail and always correct.
 */
const HORSE_COLLIDER_RADIUS = 0.62;
const HORSE_COLLIDER_HEIGHT = 1.7;
/** Flocks, and birds in each. */
const FLOCK_COUNT = 14;
const FLOCK_SIZE = 9;

const COATS: readonly string[] = [
  "#7a4a28",
  "#4b3324",
  "#8f6a3f",
  "#3a2c22",
  "#a08256",
  "#5d4030",
  "#c2b6a4",
  "#6b5847",
];

export function createIslandWildlife(
  manifest: WorldManifest,
  field: IslandField,
): IslandWildlife {
  const group = new Group();
  group.name = "island-wildlife";
  let triangleCount = 0;

  // --- horses --------------------------------------------------------------
  // The player's own rig, posed and then flattened into a single geometry with
  // every material's colour baked into its vertices. One draw call for the
  // whole population, and a wild horse is the same animal as the ridden one
  // rather than a cheaper impression of it.
  // Grazing reaches the neck down and forward and tips the face steeply toward
  // the ground; standing carries the neck up with the poll highest. The rig
  // pivots the neck from a fixed base, so the grazing pose is a head lowered to
  // the grass rather than a muzzle buried in it - taking the neck far enough
  // for that would swing it through the horse's own chest.
  const grazing = flattenHorse(1.85, 1.35);
  const standing = flattenHorse(0.45, 0.62);
  triangleCount +=
    grazing.getAttribute("position").count / 3 +
    standing.getAttribute("position").count / 3;

  const horseMaterial = new MeshStandardMaterial({
    roughness: 0.8,
    metalness: 0,
    flatShading: true,
    vertexColors: true,
  });

  const safeRouteHalfWidth = Math.max(
    3,
    ...manifest.routes
      .filter((route) => route.kind === "safe")
      .map((route) => route.widthMeters * 0.5),
  );

  /** Somewhere a horse would actually stand: open, gentle, off the tide line. */
  const goodGround = (x: number, z: number): boolean => {
    const sampleX = clampIndex(
      Math.round((x + field.halfMeters) / field.spacing),
      field.gridSize,
    );
    const sampleZ = clampIndex(
      Math.round((z + field.halfMeters) / field.spacing),
      field.gridSize,
    );
    const sample = sampleZ * field.gridSize + sampleX;
    if ((field.shoreDistance[sample] ?? 0) < 12) return false;
    if ((field.slopeDegrees[sample] ?? 90) > 18) return false;
    if ((field.routeDistance[sample] ?? ROUTE_DISTANCE_CAP) < safeRouteHalfWidth) return false;
    if (!(field.traversable[sample] ?? 0)) return false;
    return field.heightAt(x, z) > field.seaLevel + 1.5;
  };

  // Bands of two or three, the way horses actually stand. Positions come from
  // the world seed, so the same island is grazed in the same places every time.
  const placements: Array<{ x: number; z: number; grazing: boolean; coat: Color }> = [];
  let attempt = 0;
  while (placements.length < HORSE_TARGET && attempt < 4000) {
    const noise = hash3(manifest.seed, attempt, 0, 61);
    attempt += 1;
    const a = (noise & 0xffff) / 65535;
    const b = ((noise >>> 16) & 0xffff) / 65535;
    const bandX = (a - 0.5) * field.sizeMeters * 0.82;
    const bandZ = (b - 0.5) * field.sizeMeters * 0.82;
    if (!goodGround(bandX, bandZ)) continue;

    const band = 1 + (noise % 3);
    for (let index = 0; index < band && placements.length < HORSE_TARGET; index += 1) {
      const spread = hash3(manifest.seed, attempt, index, 62);
      const angle = ((spread & 0xff) / 255) * Math.PI * 2;
      const distance = 2 + (((spread >>> 8) & 0xff) / 255) * 7;
      const x = bandX + Math.cos(angle) * distance;
      const z = bandZ + Math.sin(angle) * distance;
      if (!goodGround(x, z)) continue;
      placements.push({
        x,
        z,
        // Most of a herd is eating at any moment; the ones that are not are
        // what make the group read as alive rather than as a diorama.
        grazing: ((spread >>> 16) & 0xff) / 255 < 0.62,
        coat: new Color(COATS[(spread >>> 24) % COATS.length] ?? COATS[0]!),
      });
    }
  }

  const grazingHorses = placements.filter((entry) => entry.grazing);
  const standingHorses = placements.filter((entry) => !entry.grazing);
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);

  /** One horse, whether it is currently a matrix in a buffer or a real rig. */
  interface WildHorse {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly scale: number;
    readonly coat: Color;
    readonly grazing: boolean;
    readonly mesh: InstancedMesh;
    readonly slot: number;
    /** Current facing. A live horse turns; the instance is written back to match. */
    yaw: number;
    live: LiveHorse | null;
  }

  const horses: WildHorse[] = [];

  const addHorses = (
    name: string,
    geometry: BufferGeometry,
    members: typeof placements,
  ): void => {
    if (members.length === 0) return;
    const mesh = new InstancedMesh(geometry, horseMaterial, members.length);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // A live horse turns and kicks well outside the bounds computed here, and
    // the herd never moves otherwise, so a stale sphere would pop it out of
    // view exactly when the player is closest to it.
    mesh.frustumCulled = false;
    members.forEach((entry, index) => {
      const yaw = (index * 2.399) % (Math.PI * 2);
      // Wild stock runs smaller than a ridden horse, and varying it stops the
      // population reading as one model stamped twenty-six times.
      const size = 0.88 + ((index * 37) % 23) / 100;
      const y = field.heightAt(entry.x, entry.z);
      position.set(entry.x, y, entry.z);
      quaternion.setFromAxisAngle(up, yaw);
      scale.setScalar(size);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, entry.coat);
      horses.push({
        x: entry.x,
        y,
        z: entry.z,
        scale: size,
        coat: entry.coat,
        grazing: entry.grazing,
        mesh,
        slot: index,
        yaw,
        live: null,
      });
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };

  addHorses("wild-horses-grazing", grazing, grazingHorses);
  addHorses("wild-horses-standing", standing, standingHorses);

  /** Writes a horse back into its instance buffer, or hides it entirely. */
  const writeInstance = (horse: WildHorse, visible: boolean): void => {
    position.set(horse.x, horse.y, horse.z);
    quaternion.setFromAxisAngle(up, horse.yaw);
    scale.setScalar(visible ? horse.scale : 0);
    matrix.compose(position, quaternion, scale);
    horse.mesh.setMatrixAt(horse.slot, matrix);
    horse.mesh.instanceMatrix.needsUpdate = true;
  };

  // --- the two horses that are allowed to be alive at once -------------------
  const liveHorses: LiveHorse[] = [];
  for (let index = 0; index < LIVE_HORSE_BUDGET; index += 1) {
    liveHorses.push(new LiveHorse(index));
  }

  const kicks: WildHorseKick[] = [];
  const horseColliders: WildHorseCollider[] = horses.map((horse) => ({
    x: horse.x,
    y: horse.y,
    z: horse.z,
    radius: HORSE_COLLIDER_RADIUS,
    height: HORSE_COLLIDER_HEIGHT,
  }));

  /** Nearest-first, but only horses close enough to have noticed anything. */
  const nearestHorses = (x: number, z: number): WildHorse[] =>
    horses
      .map((horse) => ({
        horse,
        distance: Math.hypot(horse.x - x, horse.z - z),
        // A horse that is already awake defends its slot, so a near-tie does
        // not thrash the rig between two animals.
        rank:
          Math.hypot(horse.x - x, horse.z - z) -
          (horse.live ? LIVE_HORSE_STICKINESS : 0),
      }))
      .filter((entry) => entry.distance < NOTICE_RADIUS)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, LIVE_HORSE_BUDGET)
      .map((entry) => entry.horse);

  const updateHorses = (player: PlayerSense): void => {
    const wanted = new Set(nearestHorses(player.x, player.z));

    // Anything that has walked out of range goes back to being a matrix, at
    // whatever heading it turned to while it was awake.
    for (const live of liveHorses) {
      const occupant = live.horse as WildHorse | null;
      if (!occupant || wanted.has(occupant)) continue;
      occupant.yaw = live.facing;
      occupant.live = null;
      live.release(group);
      writeInstance(occupant, true);
    }

    for (const horse of wanted) {
      if (horse.live) continue;
      const free = liveHorses.find((live) => live.horse === null);
      if (!free) continue;
      free.claim(group, horse, horse.grazing ? [1.85, 1.35] : [0.45, 0.62]);
      horse.live = free;
      writeInstance(horse, false);
    }

    for (const live of liveHorses) {
      const kick = live.update(player);
      if (kick) kicks.push(kick);
    }
  };

  // --- birds ---------------------------------------------------------------
  const birdGeometry = createBirdGeometry();
  triangleCount += (birdGeometry.getAttribute("position").count / 3) * FLOCK_COUNT * FLOCK_SIZE;
  const birdMaterial = new MeshStandardMaterial({
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
    vertexColors: true,
  });

  /**
   * A flock does two things at once: the birds circle their own centre, and
   * that centre drifts a long slow loop across the island. Flocks pinned to a
   * point are scenery; flocks that arrive over the ridge you are riding towards
   * and are gone by the time you get there are wildlife.
   */
  interface Flock {
    readonly mesh: InstancedMesh;
    /** Centre of the long roaming loop. */
    readonly homeX: number;
    readonly homeZ: number;
    /** How far the flock wanders from home, in metres. */
    readonly roam: number;
    /** Radians per second around the roaming loop. */
    readonly roamSpeed: number;
    readonly height: number;
    readonly radius: number;
    readonly speed: number;
    readonly phase: number;
  }
  const flocks: Flock[] = [];
  for (let index = 0; index < FLOCK_COUNT; index += 1) {
    const noise = hash3(manifest.seed, index, 3, 71);
    const a = (noise & 0xffff) / 65535;
    const b = ((noise >>> 16) & 0xffff) / 65535;
    const x = (a - 0.5) * field.sizeMeters * 0.7;
    const z = (b - 0.5) * field.sizeMeters * 0.7;
    const mesh = new InstancedMesh(birdGeometry, birdMaterial, FLOCK_SIZE);
    mesh.name = `island-flock-${index}`;
    // A flock is small and always moving; culling it by its own stale bounds
    // makes birds vanish when the camera turns.
    mesh.frustumCulled = false;
    group.add(mesh);
    flocks.push({
      mesh,
      homeX: x,
      homeZ: z,
      roam: field.sizeMeters * (0.18 + a * 0.22),
      // Slow. A full circuit takes minutes, so a flock is somewhere different
      // every time the player crosses the same ground.
      roamSpeed: 0.012 + b * 0.016,
      height: field.heightAt(x, z) + 30 + a * 26,
      radius: 18 + b * 26,
      speed: 0.22 + a * 0.2,
      phase: b * Math.PI * 2,
    });
  }

  return {
    group,
    horseCount: placements.length,
    birdCount: flocks.length * FLOCK_SIZE,
    triangleCount: Math.round(triangleCount),
    horseColliders,

    describeHorses() {
      return horses.map((horse) => ({
        x: horse.x,
        z: horse.z,
        grazing: horse.grazing,
        live: horse.live !== null,
        mood: horse.live?.mood ?? null,
      }));
    },

    consumeKicks() {
      if (kicks.length === 0) return [];
      const landed = kicks.slice();
      kicks.length = 0;
      return landed;
    },

    update(elapsedSeconds, player) {
      updateHorses(player);

      for (const flock of flocks) {
        // Where the flock is right now, on its long loop.
        const roamAngle = flock.phase + elapsedSeconds * flock.roamSpeed;
        const centreX = flock.homeX + Math.cos(roamAngle) * flock.roam;
        const centreZ = flock.homeZ + Math.sin(roamAngle * 0.8) * flock.roam;
        for (let index = 0; index < FLOCK_SIZE; index += 1) {
          // Each bird holds its own place on the ring, so the flock keeps its
          // shape while it turns instead of smearing into a circle of dots.
          const offset = (index / FLOCK_SIZE) * Math.PI * 2;
          const angle = flock.phase + elapsedSeconds * flock.speed + offset * 0.35;
          const radius = flock.radius * (0.75 + 0.25 * Math.sin(offset * 3 + flock.phase));
          const x = centreX + Math.cos(angle) * radius;
          const z = centreZ + Math.sin(angle) * radius;
          const bob = Math.sin(elapsedSeconds * 1.3 + offset * 2) * 2.2;
          position.set(x, flock.height + bob, z);
          // Facing along the tangent of its own circle, banked into the turn.
          quaternion.setFromAxisAngle(up, -angle + Math.PI * 0.5);
          // The flap: the wings are angled, so squashing the bird vertically
          // beats them. Cheaper than a morph and reads at the only distance a
          // bird is ever seen from here.
          const flap = 0.55 + 0.45 * Math.sin(elapsedSeconds * 7 + offset * 5);
          scale.set(1, flap, 1);
          matrix.compose(position, quaternion, scale);
          flock.mesh.setMatrixAt(index, matrix);
        }
        flock.mesh.instanceMatrix.needsUpdate = true;
      }
    },

    dispose() {
      grazing.dispose();
      standing.dispose();
      birdGeometry.dispose();
      horseMaterial.dispose();
      birdMaterial.dispose();
      for (const live of liveHorses) live.dispose();
      for (const child of group.children) {
        if (child instanceof InstancedMesh) child.dispose();
      }
    },
  };
}

/**
 * A wild horse promoted from a matrix in a buffer to a real, animating rig.
 *
 * The rig is built once and reused: it is claimed by whichever horse the player
 * has walked up to, tinted to that horse's coat, and released when they leave.
 * Building one per horse would be twenty-six rigs standing idle to serve the one
 * or two the player is ever near.
 *
 * The tint has to match the instanced path exactly or a horse would visibly
 * change colour at the moment it woke up. Instanced, a vertex renders as
 * `material colour x baked shade x instance colour`; here the same product is
 * reached by multiplying the coat into each material's own colour.
 */
class LiveHorse {
  private readonly rig = createHorseRig();
  private readonly materials: MeshStandardMaterial[] = [];
  private readonly baseColours: Color[] = [];
  private animator = new WildHorseAnimator(0.45, 0.62);
  public horse: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly scale: number;
    readonly coat: Color;
    yaw: number;
  } | null = null;

  public constructor(private readonly index: number) {
    this.rig.root.name = `wild-horse-live-${index}`;
    this.rig.root.visible = false;
    // A live horse is only ever a few metres from the camera and it moves well
    // outside whatever bounds it was built with.
    this.rig.root.traverse((object) => {
      object.frustumCulled = false;
    });
    const seen = new Set<MeshStandardMaterial>();
    this.rig.root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const material = object.material as MeshStandardMaterial;
      if (seen.has(material)) return;
      seen.add(material);
      this.materials.push(material);
      this.baseColours.push(material.color.clone());
    });
  }

  public get facing(): number {
    return this.animator.facing;
  }

  public get mood(): WildHorseMood {
    return this.animator.currentMood;
  }

  public claim(
    group: Group,
    horse: NonNullable<LiveHorse["horse"]>,
    pose: readonly [number, number],
  ): void {
    this.horse = horse;
    this.materials.forEach((material, index) => {
      material.color.copy(this.baseColours[index] as Color).multiply(horse.coat);
    });
    this.rig.root.position.set(horse.x, horse.y, horse.z);
    this.rig.root.scale.setScalar(horse.scale);
    this.rig.root.visible = true;
    this.animator = new WildHorseAnimator(pose[0], pose[1], this.index * 3.1);
    this.animator.reset(horse.yaw);
    this.animator.pose(this.rig);
    group.add(this.rig.root);
  }

  public release(group: Group): void {
    this.horse = null;
    this.rig.root.visible = false;
    group.remove(this.rig.root);
  }

  public update(player: PlayerSense): WildHorseKick | null {
    const horse = this.horse;
    if (!horse) return null;
    const toPlayerX = player.x - horse.x;
    const toPlayerZ = player.z - horse.z;
    const distance = Math.hypot(toPlayerX, toPlayerZ);
    // The rig faces +Z at yaw zero, so a bearing is the difference between the
    // heading to the player and the heading the horse is holding.
    const bearing = Math.atan2(toPlayerX, toPlayerZ) - this.animator.facing;

    const strike = this.animator.update(this.rig, {
      distance,
      bearing,
      deltaSeconds: player.deltaSeconds,
    });
    if (!strike.connected || distance < 0.001) return null;

    return {
      awayX: toPlayerX / distance,
      awayZ: toPlayerZ / distance,
      x: horse.x,
      y: horse.y,
      z: horse.z,
    };
  }

  public dispose(): void {
    this.rig.dispose();
  }
}

/**
 * The player's horse, posed and flattened into one geometry.
 *
 * Every mesh in the rig is baked at its world transform and its material colour
 * is multiplied into its vertex colours, so a rig of thirty-odd meshes across
 * six materials becomes a single instanced draw that still has a bay coat, dark
 * points, pale hooves and a black mane.
 */
function flattenHorse(neckAngle: number, headCarry: number): BufferGeometry {
  const rig = createHorseRig();
  rig.neck.rotation.x = neckAngle;
  // How far the face is carried below the horizon, independent of the neck's
  // own angle - the same convention the player's animator uses, so a wild horse
  // standing beside the player is holding its head the same way rather than
  // pointing its nose at the sky.
  rig.head.rotation.x = -neckAngle + headCarry;
  rig.root.updateMatrixWorld(true);

  const parts: Array<{ geometry: BufferGeometry; matrix: Matrix4 }> = [];
  rig.root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const source = object.geometry.index
      ? object.geometry.toNonIndexed()
      : object.geometry.clone();
    const material = object.material as MeshStandardMaterial;
    const count = source.getAttribute("position").count;
    const existing = source.getAttribute("color");
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const shade = existing ? existing.getX(index) : 1;
      colors[index * 3] = material.color.r * shade;
      colors[index * 3 + 1] = material.color.g * shade;
      colors[index * 3 + 2] = material.color.b * shade;
    }
    source.setAttribute("color", new BufferAttribute(colors, 3));
    parts.push({ geometry: source, matrix: object.matrixWorld.clone() });
  });

  const merged = mergeGeometries(parts);
  for (const part of parts) part.geometry.dispose();
  rig.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** A bird: a body and two swept wings, six triangles, seen only from below. */
function createBirdGeometry(): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const push = (x: number, y: number, z: number, tone: number): void => {
    positions.push(x, y, z);
    colors.push(tone * 0.24, tone * 0.25, tone * 0.24);
  };

  // Body: a thin wedge pointing along +Z.
  push(0, 0, 0.42, 1);
  push(-0.07, 0, -0.2, 0.8);
  push(0.07, 0, -0.2, 0.8);

  // Wings, angled up so a vertical squash reads as a downbeat.
  for (const side of [-1, 1] as const) {
    push(0, 0, 0.12, 1);
    push(side * 0.62, 0.2, -0.16, 0.7);
    push(side * 0.12, 0, -0.24, 0.85);
    push(0, 0, 0.12, 1);
    push(side * 0.12, 0, -0.24, 0.85);
    push(side * 0.62, 0.2, -0.16, 0.7);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function clampIndex(value: number, size: number): number {
  return Math.min(size - 1, Math.max(0, value));
}

/** Deterministic 32-bit hash of three integers plus the world's own seed. */
function hash3(seed: number, x: number, z: number, salt: number): number {
  let value =
    (seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ Math.imul(salt, 0x27d4eb2d)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}
