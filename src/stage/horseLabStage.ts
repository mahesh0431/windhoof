import type { Vec3 } from "../game/contracts/math";
import type { WorldSurface } from "../game/contracts/worldSurface";

/**
 * Horse Lab stage fixture.
 *
 * This is NOT the island compiler. Milestone 2 introduces the deterministic
 * WorldSpec -> WorldManifest pipeline that Codex owns; until then the Horse Lab
 * needs a small, deliberately hand-authored plot of ground so locomotion,
 * camera, and presentation can be judged.
 *
 * It still follows the WorldClaw-derived rule of explicit representation: the
 * terrain is one pure analytic field and every prop is an independent addressable
 * record. The visual mesh and the Rapier collision mesh are both derived from
 * this single description, so what the player sees and what the horse collides
 * with cannot drift apart.
 *
 * Each feature below exists to exercise one line of the Milestone 1 exit gate.
 */

/** @deprecated Use the world-runtime `WorldSurface` contract. */
export type StageSurface = WorldSurface;

export type StagePropKind =
  | "rock"
  | "boulder"
  | "log"
  | "tree"
  | "shrub"
  | "marker";

export interface StageProp {
  readonly id: string;
  readonly kind: StagePropKind;
  /** Ground position; Y is sampled from the terrain field at build time. */
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
  readonly scale: number;
  /** Why this instance exists, so later passes can move it without guessing. */
  readonly intent: string;
}

export interface StageFeature {
  readonly id: string;
  readonly label: string;
  readonly centre: { readonly x: number; readonly z: number };
  readonly gateLine: string;
}

export const STAGE_HALF_EXTENT = 128;
export const STAGE_CELL_SIZE = 2;
export const STAGE_WATER_LEVEL = -0.55;
export const STAGE_SHORE_RADIUS = 96;
export const STAGE_BEACH_RADIUS = 118;

/**
 * The horse is stopped on the wet shoreline, before its legs can become deeply
 * submerged. The lab has no swimming mechanic, so allowing the capsule farther
 * out creates the false impression that the ocean is traversable. The visible
 * surf remains the boundary cue; the collider prevents entry into open water.
 */
export const STAGE_BOUNDARY_RADIUS = 102;
/** Recovery anchors stay inland of the surf and invisible collision ring. */
export const STAGE_SAFE_GROUND_RADIUS = 92;

export const STAGE_SPAWN: Vec3 = Object.freeze({ x: 0, y: 0, z: -70 });
/** Forward is (sin yaw, cos yaw); yaw 0 faces +Z, straight down the gallop run. */
export const STAGE_SPAWN_YAW = 0;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Deterministic value noise. Seeded and pure so terrain is reproducible. */
function hash2(x: number, z: number): number {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43_758.545_312;
  return s - Math.floor(s);
}

function valueNoise(x: number, z: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi);
  const b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1);
  const d = hash2(xi + 1, zi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

/**
 * The stream runs east-west across the gallop corridor.
 *
 * The shallow ford sits directly on the corridor and the deep, jumpable trench
 * is out on both flanks. That ordering matters: a trench narrow enough to clear
 * with a jump necessarily has walls far steeper than the horse's climb limit,
 * so putting the deep section on the obvious straight-ahead line turned the
 * first gallop into a ditch the horse could not ride out of. Straight ahead is
 * now the safe approach and the jump is the skillful one, which is also the
 * arrangement the world bible asks for.
 *
 * The trench floor stays continuous into the ford, so a horse that does drop
 * into the deep section can always ride along it and back out.
 */
export function stageStreamDepthAt(x: number, z: number): number {
  return streamDepth(x, z);
}

function streamDepth(x: number, z: number): number {
  if (x < -46 || x > 44) return 0;

  const alongCentre = 4 + Math.sin((x + 46) * 0.045) * 2.4;
  const distance = Math.abs(z - alongCentre);

  const fordBlend = 1 - smoothstep(7, 19, Math.abs(x));
  const depth = 2.05 * (1 - fordBlend * 0.72);
  // The jumpable span is sized against the shared horse tuning: it has to fit
  // inside a canter-speed jump arc with margin, or the obstacle silently
  // becomes gallop-only and careful riding is punished for it.
  const halfWidth = 1.9 + fordBlend * 4.1;
  const wall = 1.4 + fordBlend * 3.6;

  const endFade = smoothstep(-46, -40, x) * (1 - smoothstep(40, 44, x));
  const profile = 1 - smoothstep(halfWidth, halfWidth + wall, distance);
  return depth * profile * endFade;
}

/**
 * A raised plateau north of the stream with one steep face and one safe ramp.
 * Dropping off the steep face lands hard enough to trigger the stumble state.
 */
function plateauHeight(x: number, z: number): number {
  const inX = smoothstep(-52, -42, x) * (1 - smoothstep(28, 40, x));
  // Steep north face at z = 34, gentle southern approach from the stream.
  const inZ = smoothstep(14, 24, z) * (1 - smoothstep(33.4, 35.2, z));
  return 2.85 * inX * inZ;
}

export function stageHeightAt(x: number, z: number): number {
  const radius = Math.hypot(x, z);

  // Broad gentle rolls. The gallop corridor near x = 0 is deliberately calmer.
  const corridorCalm = 0.28 + 0.72 * smoothstep(10, 34, Math.abs(x));
  let height =
    (Math.sin(x * 0.031 + 1.4) * 0.9 + Math.cos(z * 0.027 - 0.6) * 0.75) *
    corridorCalm;

  height += valueNoise(x * 0.055, z * 0.055) * 0.62 * corridorCalm;
  height += valueNoise(x * 0.19, z * 0.19) * 0.13;

  // Overlook knoll: rideable at roughly 15 degrees, gives orientation.
  const knoll = Math.hypot(x + 58, z - 58);
  height += 9.2 * (1 - smoothstep(0, 36, knoll));

  // Blackstone-style bank: flanks near 38 degrees, above the climb limit, so
  // it reads and behaves as terrain the horse should not attempt.
  const bank = Math.hypot((x - 66) * 0.85, (z + 22) * 1.35);
  height += 7.4 * (1 - smoothstep(0, 14, bank));

  height += plateauHeight(x, z);
  height -= streamDepth(x, z);

  // Coastal falloff into a beach and then a shallow shelf. The shelf stays
  // level out to the mesh edge instead of dropping away, so the ground under
  // the player is continuous everywhere the player can physically reach.
  const shore = smoothstep(STAGE_SHORE_RADIUS, STAGE_BEACH_RADIUS, radius);
  height = height * (1 - shore) - shore * 1.9;

  // The sea visual begins just inside the beach for a readable surf band, but
  // the playable side of the boundary must remain above that surface. Without
  // this floor, noise-created coastal hollows let the horse appear fully
  // submerged even though the outer collision ring was working.
  if (radius >= 84 && radius <= STAGE_BOUNDARY_RADIUS + 1) {
    height = Math.max(height, STAGE_WATER_LEVEL + 0.12);
  }

  return height;
}

export function stageNormalAt(x: number, z: number): Vec3 {
  const e = 0.6;
  const hL = stageHeightAt(x - e, z);
  const hR = stageHeightAt(x + e, z);
  const hD = stageHeightAt(x, z - e);
  const hU = stageHeightAt(x, z + e);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * e;
  const length = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / length, y: ny / length, z: nz / length };
}

export function stageSlopeDegrees(x: number, z: number): number {
  return (Math.acos(Math.min(1, Math.max(-1, stageNormalAt(x, z).y))) * 180) / Math.PI;
}

export function stageSurfaceAt(x: number, z: number): StageSurface {
  const height = stageHeightAt(x, z);
  const radius = Math.hypot(x, z);

  if (stageSlopeDegrees(x, z) > 30) return "rock";
  if (radius > STAGE_SHORE_RADIUS - 6 && height < 1.1) return "sand";
  if (streamDepth(x, z) > 0.55) return "streambed";
  return "grass";
}

/**
 * Props are independent records with stable IDs. Nothing here is baked into the
 * terrain, so any instance can be moved, replaced, or removed in a later pass.
 */
export const STAGE_PROPS: readonly StageProp[] = Object.freeze([
  // Camera obstruction: a tight grove the player will ride through.
  ...groveProps(),

  // Camera obstruction: a narrow rock gate on the western approach.
  {
    id: "gate-boulder-west",
    kind: "boulder",
    x: -32.5,
    z: -16,
    yaw: 0.4,
    scale: 1.35,
    intent: "Camera obstruction: narrow gate, left post",
  },
  {
    id: "gate-boulder-east",
    kind: "boulder",
    x: -27.4,
    z: -14.4,
    yaw: 2.1,
    scale: 1.2,
    intent: "Camera obstruction: narrow gate, right post",
  },

  // Ordinary collision and recovery cases along the gallop corridor.
  {
    id: "corridor-rock-a",
    kind: "rock",
    x: 6.4,
    z: -44,
    yaw: 0.8,
    scale: 1,
    intent: "Ordinary collision while galloping",
  },
  {
    id: "corridor-rock-b",
    kind: "rock",
    x: -7.8,
    z: -26,
    yaw: 2.6,
    scale: 0.78,
    intent: "Ordinary collision while galloping",
  },
  {
    id: "corridor-log",
    kind: "log",
    x: -1.5,
    z: -12,
    yaw: 1.52,
    scale: 1,
    intent: "Low jumpable obstacle before the stream",
  },
  {
    id: "plateau-log",
    kind: "log",
    x: 8,
    z: 26,
    yaw: 0.2,
    scale: 0.9,
    intent: "Jumpable obstacle on the plateau",
  },

  // Landmarks that give the small plot orientation from a distance.
  {
    id: "lone-tree",
    kind: "tree",
    x: -20,
    z: 44,
    yaw: 0.7,
    scale: 1.55,
    intent: "Longgrass-style lone tree landmark",
  },
  {
    id: "knoll-tree",
    kind: "tree",
    x: -54,
    z: 52,
    yaw: 2.2,
    scale: 1.15,
    intent: "Overlook silhouette",
  },
  {
    id: "ford-marker-west",
    kind: "shrub",
    x: -9.5,
    z: 1.5,
    yaw: 0,
    scale: 1.1,
    intent: "Bank vegetation flanking the safe ford on the corridor",
  },
  {
    id: "ford-marker-east",
    kind: "shrub",
    x: 10.5,
    z: 9,
    yaw: 1.1,
    scale: 1,
    intent: "Bank vegetation flanking the safe ford on the corridor",
  },
  ...scatterProps(),
]);

function groveProps(): StageProp[] {
  const props: StageProp[] = [];
  const centres: ReadonlyArray<readonly [number, number]> = [
    [42, 24],
    [47.5, 29],
    [39, 32],
    [51, 21],
    [45, 36],
    [55, 30],
    [36, 26],
    [50.5, 38.5],
    [58, 24],
    [41.5, 41],
    [33, 34],
    [56, 36],
  ];

  centres.forEach(([x, z], index) => {
    props.push({
      id: `grove-tree-${index}`,
      kind: "tree",
      x,
      z,
      yaw: (index * 1.37) % (Math.PI * 2),
      scale: 0.9 + ((index * 7) % 5) * 0.09,
      intent: "Fernwood-edge grove for camera obstruction and tight turning",
    });
  });

  return props;
}

/** Deterministic low-value scatter that gives the plain readable texture. */
function scatterProps(): StageProp[] {
  const props: StageProp[] = [];

  for (let index = 0; index < 46; index += 1) {
    const angle = hash2(index * 3.1, 7.7) * Math.PI * 2;
    const radius = 14 + hash2(index * 1.9, 2.3) * 78;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    // Keep the ridden line clear. The centre of the corridor runs the whole
    // length of the lab, from the spawn through the ford, up the plateau ramp
    // and onto its top, and scatter that lands on it now stops the horse dead:
    // the controller reports resolved speed, so riding into a boulder reads as
    // an idle horse rather than as a gallop. Hand-placed obstacles still sit
    // just off the centre, because meeting one is the point of the corridor.
    if (Math.abs(x) < 4.5 && z < 34) continue;
    if (Math.abs(x) < 9 && z < 6) continue;
    if (Math.abs(z - 4) < 9) continue;

    const roll = hash2(index * 5.3, 11.1);
    props.push({
      id: `scatter-${index}`,
      kind: roll > 0.62 ? "rock" : "shrub",
      x,
      z,
      yaw: hash2(index, 19.3) * Math.PI * 2,
      scale: 0.55 + hash2(index * 2.7, 4.1) * 0.6,
      intent: "Ground texture and scale reference at speed",
    });
  }

  return props;
}

/** Named features, so a later inspection pass can find and judge each one. */
export const STAGE_FEATURES: readonly StageFeature[] = Object.freeze([
  {
    id: "gallop-run",
    label: "Open gallop run",
    centre: { x: 0, z: -30 },
    gateLine: "Gallop feels satisfying on open ground",
  },
  {
    id: "stream",
    label: "Stream trench and ford",
    centre: { x: -8, z: 4 },
    gateLine: "Turning, braking, slopes, jump, and landing are understandable",
  },
  {
    id: "plateau-drop",
    label: "Plateau with steep north face",
    centre: { x: -6, z: 34 },
    gateLine: "Landing and stumble recovery are understandable",
  },
  {
    id: "grove",
    label: "Fernwood-edge grove",
    centre: { x: 46, z: 30 },
    gateLine: "Camera obstruction does not frequently clip or disorient",
  },
  {
    id: "steep-bank",
    label: "Unclimbable bank",
    centre: { x: 66, z: -22 },
    gateLine: "Difficult and unsafe ground stays readable",
  },
  {
    id: "overlook",
    label: "Overlook knoll",
    centre: { x: -58, z: 58 },
    gateLine: "Slopes are understandable",
  },
]);
