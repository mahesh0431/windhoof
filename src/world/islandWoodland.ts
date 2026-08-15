import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from "three";
import type { WorldManifest } from "../game/world/compiler/worldTypes";
import {
  applyGrassWind,
  createWindUniforms,
  type WindUniforms,
} from "./grassBlades";
import { ROUTE_DISTANCE_CAP, type IslandField } from "./islandField";
import { createTreeGeometry, type TreeSpecies } from "./treeShapes";

/**
 * The island's woodland: every tree that is scenery rather than an obstacle.
 *
 * The compiler emits a couple of dozen collision-bearing placements across a
 * 1,024-metre island. That is the right number of things to be *stopped* by and
 * it is not a forest, so a region named Fernwood rendered as open ground with a
 * handful of thickets on it. Same failure the ground cover was written to fix,
 * one scale up: the region was labelled rather than realized.
 *
 * So this is the other half again. Trees placed straight off the manifest's own
 * fields, none of them carrying a collider, none authored per-location.
 * Position comes from a hash of the world seed and the cell, so the same island
 * grows the same wood on every machine and every reload.
 *
 * What it deliberately does not do is give those trees collision. Adding
 * thousands of colliders is a change to the compiled world, which the compiler
 * owns, and it is not a decision the render layer gets to make on its own. The
 * consequence is honest and stated: a horse can ride through a scenery trunk.
 */

/** A trunk the physics world can stand a cylinder on. */
export interface TreeTrunk {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
}

export interface IslandWoodland {
  readonly group: Group;
  readonly treeCount: number;
  readonly triangleCount: number;
  /**
   * Trunks solid enough to stop a horse.
   *
   * Bushes and saplings are deliberately absent: a horse pushes through scrub,
   * and a world where every twig is a wall is a world that feels sticky, which
   * the art brief rules out in as many words.
   */
  readonly trunks: readonly TreeTrunk[];
  setFocus(x: number, z: number): void;
  setTime(seconds: number): void;
  dispose(): void;
}

/**
 * How far trees are drawn.
 *
 * Further than the ground cover, because a tree is a silhouette on a ridge
 * rather than a texture underfoot, and losing the treeline half a kilometre out
 * is the one popping a player would actually see.
 */
const TREE_DRAW_RADIUS = 400;

/** Metres between candidate trees before jitter. */
const CELL_METRES = 6;

/**
 * Chunks per bucket edge.
 *
 * One bucket per chunk would be the finest cull, and at three species it would
 * also be three draw calls per chunk. Trees are large enough that a coarser
 * bucket costs almost nothing in over-draw and saves most of those calls.
 */
const CHUNKS_PER_BUCKET = 2;

interface TreeProfile {
  /** Chance a candidate cell grows something, 0-1. */
  readonly density: number;
  /** Relative share per species, in the order they are built. */
  readonly mix: Readonly<Record<TreeSpecies, number>>;
  readonly minHeight: number;
  readonly maxHeight: number;
  /** Multiplies the whole island's canopy palette for this region. */
  readonly tint: readonly [number, number, number];
}

/**
 * Storeys, not one height range.
 *
 * A wood whose trees are all drawn from one range is a wood of one tree
 * repeated, however much the range varies: everything ends up within a third of
 * everything else and the canopy reads as a hedge seen from above. Real
 * woodland is layered, and the layer that does most of the work is the rare
 * emergent - the one tree in ten that stands a storey clear of the rest and
 * gives the whole wood a skyline.
 */
const STOREYS: ReadonlyArray<{ readonly share: number; readonly scale: number }> = [
  // Emergents: half again as tall as the canopy around them.
  { share: 0.12, scale: 1.55 },
  // The canopy itself.
  { share: 0.46, scale: 1 },
  // Understorey and young growth, well below it.
  { share: 0.42, scale: 0.52 },
];

/**
 * What grows where.
 *
 * This is the render layer's reading of each region's authored intent, in the
 * same place and for the same reason as the ground-cover styles: the spec says
 * what a region *is*, and how many trees that means is a visual decision.
 */
const PROFILES: Readonly<Record<string, TreeProfile>> = {
  // Wind-stunted and salt-burned. Scrub only, and not much of it: the storm
  // beach has to stay open enough to read as a beach.
  "saltwind-coast": {
    // The player spawns here, and a storm beach with nothing standing on it is
    // the first thing they see. The strand itself stays open - the shore
    // falloff below clears the sand - so this is the wind-bent line of trees
    // behind the dunes rather than trees on the beach.
    density: 0.42,
    mix: { broadleaf: 0.24, pine: 0.12, scrub: 0.34, birch: 0.08, willow: 0.14, deadwood: 0.08 },
    minHeight: 2.6,
    maxHeight: 6.5,
    tint: [0.84, 0.9, 0.72],
  },
  // Gallop country. Lone standing trees and thickets at the margins, never
  // enough to close the ground: this is the one region whose whole job is to be
  // open, and filling it with trees would take the gallop away.
  "longgrass-plain": {
    density: 0.3,
    mix: { broadleaf: 0.4, pine: 0.05, scrub: 0.24, birch: 0.16, willow: 0.09, deadwood: 0.06 },
    minHeight: 4.5,
    maxHeight: 9,
    tint: [1, 1, 0.92],
  },
  // Closed canopy. The densest wood on the island, and the region the player is
  // meant to feel enclosed by.
  fernwood: {
    density: 0.85,
    mix: { broadleaf: 0.3, pine: 0.3, scrub: 0.1, birch: 0.18, willow: 0.04, deadwood: 0.08 },
    minHeight: 6,
    maxHeight: 12,
    tint: [0.78, 0.98, 0.76],
  },
  // Wet woodland, more open than Fernwood and bluer: the two have to be told
  // apart across a valley.
  "river-hollow": {
    density: 0.58,
    mix: { broadleaf: 0.3, pine: 0.1, scrub: 0.16, birch: 0.12, willow: 0.28, deadwood: 0.04 },
    minHeight: 4.5,
    maxHeight: 10,
    tint: [0.86, 1.04, 0.98],
  },
  // Above the treeline, near enough. A few wind-bent pines in the folds and
  // nothing else, so the crown stays a bare dark mass on the skyline.
  "blackstone-crown": {
    density: 0.14,
    mix: { broadleaf: 0.04, pine: 0.42, scrub: 0.3, birch: 0.04, willow: 0.02, deadwood: 0.18 },
    minHeight: 2.2,
    maxHeight: 5,
    tint: [0.72, 0.82, 0.72],
  },
};

const FALLBACK_PROFILE: TreeProfile = {
  density: 0.18,
  mix: { broadleaf: 0.4, pine: 0.2, scrub: 0.2, birch: 0.1, willow: 0.06, deadwood: 0.04 },
  minHeight: 3,
  maxHeight: 7,
  tint: [1, 1, 1],
};

interface Tree {
  readonly species: TreeSpecies;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly height: number;
  readonly yaw: number;
  readonly lean: number;
  readonly tint: Color;
}

export function createIslandWoodland(
  manifest: WorldManifest,
  field: IslandField,
): IslandWoodland {
  const group = new Group();
  group.name = "island-woodland";

  const wind: WindUniforms = createWindUniforms(0.22, 0.15, 0.32);
  const material = new MeshStandardMaterial({
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
    vertexColors: true,
  });
  applyGrassWind(material, wind);

  const geometries: Record<TreeSpecies, BufferGeometry> = {
    birch: createTreeGeometry(
      "birch",
      {
        trunk: new Color("#cfc7b4"),
        canopyLight: new Color("#a8c65c"),
        canopyDark: new Color("#4d7038"),
      },
      4,
    ),
    willow: createTreeGeometry(
      "willow",
      {
        trunk: new Color("#5f4b34"),
        canopyLight: new Color("#94b95e"),
        canopyDark: new Color("#3d6236"),
      },
      5,
    ),
    deadwood: createTreeGeometry(
      "deadwood",
      {
        trunk: new Color("#8a7d68"),
        canopyLight: new Color("#8a7d68"),
        canopyDark: new Color("#5d5344"),
      },
      6,
    ),
    broadleaf: createTreeGeometry(
      "broadleaf",
      {
        trunk: new Color("#6d5338"),
        canopyLight: new Color("#8cb14e"),
        canopyDark: new Color("#3b5c31"),
      },
      1,
    ),
    pine: createTreeGeometry(
      "pine",
      {
        trunk: new Color("#5a4630"),
        canopyLight: new Color("#568a45"),
        canopyDark: new Color("#2b4d26"),
      },
      2,
    ),
    scrub: createTreeGeometry(
      "scrub",
      {
        trunk: new Color("#6d5338"),
        canopyLight: new Color("#7d9a4a"),
        canopyDark: new Color("#3a5a2c"),
      },
      3,
    ),
  };

  const safeRouteHalfWidth = Math.max(
    3,
    ...manifest.routes
      .filter((route) => route.kind === "safe")
      .map((route) => route.widthMeters * 0.5),
  );

  const profileByRegion = field.regionIds.map(
    (id) => PROFILES[id] ?? FALLBACK_PROFILE,
  );

  // --- placement -----------------------------------------------------------
  const trees: Tree[] = [];
  const half = field.halfMeters;
  const cells = Math.floor(field.sizeMeters / CELL_METRES);
  const scratch = new Color();

  for (let cellZ = 0; cellZ < cells; cellZ += 1) {
    for (let cellX = 0; cellX < cells; cellX += 1) {
      const noise = hash3(manifest.seed, cellX, cellZ, 19);
      const a = (noise & 0xff) / 255;
      const b = ((noise >>> 8) & 0xff) / 255;
      const c = ((noise >>> 16) & 0xff) / 255;
      const d = ((noise >>> 24) & 0xff) / 255;

      const x = -half + (cellX + a) * CELL_METRES;
      const z = -half + (cellZ + b) * CELL_METRES;

      const sampleX = clampIndex(
        Math.round((x + half) / field.spacing),
        field.gridSize,
      );
      const sampleZ = clampIndex(
        Math.round((z + half) / field.spacing),
        field.gridSize,
      );
      const sample = sampleZ * field.gridSize + sampleX;

      // Nothing on the strand, on rock, or standing in the worn line. The route
      // clearance is wider than the grass's: riding a trail through a wood is
      // only a trail if the trees stand off it.
      const shore = field.shoreDistance[sample] ?? 0;
      if (shore < 9) continue;
      const slope = field.slopeDegrees[sample] ?? 0;
      if (slope > 34) continue;
      const routeDistance = field.routeDistance[sample] ?? ROUTE_DISTANCE_CAP;
      if (routeDistance < safeRouteHalfWidth + 3) continue;

      const regionIndex = field.regionIndex[sample] ?? 0;
      const profile = profileByRegion[regionIndex] ?? FALLBACK_PROFILE;
      if (c > profile.density) continue;

      const y = field.heightAt(x, z);
      if (y <= field.seaLevel + 1) continue;

      // Thin towards the shore and on the steeper ground, so a treeline fades
      // instead of ending on a line.
      const edgeFalloff = shore < 26 ? 0.25 + (shore - 9) / 24 : 1;
      if (d > edgeFalloff) continue;

      const species = pickSpecies(profile, (noise >>> 5) & 0xff);
      const storey = pickStorey(((noise >>> 13) & 0xff) / 255);
      const height =
        (profile.minHeight + a * (profile.maxHeight - profile.minHeight)) *
        storey.scale;
      // Scrub is a bush, not a small tree: it must not scale to nine metres
      // because the region it grew in has tall timber in it.
      const scaled =
        species === "scrub"
          ? Math.min(height, 2.6) * 0.55
          : species === "willow"
            ? height * 0.78
            : height;

      // Wide per-tree variation. A canopy palette this narrow is what makes a
      // procedural wood read as one tree stamped a thousand times; spreading it
      // costs nothing and is most of what "a lot of different trees" means.
      scratch.setRGB(
        profile.tint[0] * (0.72 + b * 0.5),
        profile.tint[1] * (0.76 + c * 0.42),
        profile.tint[2] * (0.7 + d * 0.44),
      );

      trees.push({
        species,
        x,
        y: y - 0.15,
        z,
        height: scaled,
        yaw: a * Math.PI * 2,
        // A slight lean off vertical. A wood of perfectly upright trees reads
        // as a plantation, and this one is supposed to be wild.
        lean: (b - 0.5) * 0.12,
        tint: scratch.clone(),
      });
    }
  }

  // --- instancing ----------------------------------------------------------
  const bucketSpan = manifest.island.chunkSizeMeters * CHUNKS_PER_BUCKET;
  const bucketsPerEdge = Math.max(
    1,
    Math.ceil(manifest.island.chunksPerEdge / CHUNKS_PER_BUCKET),
  );
  const buckets = new Map<string, Tree[]>();
  for (const tree of trees) {
    const bucketX = clampIndex(
      Math.floor((tree.x + half) / bucketSpan),
      bucketsPerEdge,
    );
    const bucketZ = clampIndex(
      Math.floor((tree.z + half) / bucketSpan),
      bucketsPerEdge,
    );
    const key = `${tree.species}:${bucketZ * bucketsPerEdge + bucketX}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(tree);
    else buckets.set(key, [tree]);
  }

  const meshes: Array<{ mesh: InstancedMesh; centreX: number; centreZ: number }> = [];
  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const axis = new Vector3();
  let triangleCount = 0;

  for (const [key, bucket] of buckets) {
    const [species, indexText] = key.split(":");
    const geometry = geometries[species as TreeSpecies];
    const bucketIndex = Number(indexText);
    if (!geometry || !Number.isFinite(bucketIndex)) continue;

    const mesh = new InstancedMesh(geometry, material, bucket.length);
    mesh.name = `woodland-${key}`;
    mesh.castShadow = true;
    // Trees stand in their own shade, and a canopy that does not take the sun
    // it is casting reads as cardboard.
    mesh.receiveShadow = true;

    bucket.forEach((tree, index) => {
      position.set(tree.x, tree.y, tree.z);
      axis.set(Math.cos(tree.yaw), 0, Math.sin(tree.yaw)).normalize();
      quaternion.setFromAxisAngle(axis, tree.lean);
      // Uniform scale: the wind offset is divided by it in the shader, so a
      // tree of any size sways by the same number of metres at its crown.
      scale.setScalar(tree.height);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, tree.tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();

    triangleCount +=
      (geometry.getAttribute("position").count / 3) * bucket.length;
    meshes.push({
      mesh,
      centreX: -half + ((bucketIndex % bucketsPerEdge) + 0.5) * bucketSpan,
      centreZ:
        -half + (Math.floor(bucketIndex / bucketsPerEdge) + 0.5) * bucketSpan,
    });
    group.add(mesh);
  }

  const bucketHalfDiagonal = bucketSpan * Math.SQRT1_2;

  // Only real boles. Scrub is ridden through, and anything under about two
  // metres is a sapling the horse would step over rather than into.
  const trunks: TreeTrunk[] = trees
    .filter((tree) => tree.species !== "scrub" && tree.height >= 2.4)
    .map((tree) => ({
      x: tree.x,
      z: tree.z,
      y: tree.y,
      // The authored trunk is roughly a fourteenth of the tree's height at the
      // base. Slightly under that, so the collider sits inside the wood the
      // player can see rather than in the air beside it.
      radius: Math.max(0.22, tree.height * 0.055),
      height: tree.height * 0.62,
    }));

  return {
    group,
    treeCount: trees.length,
    trunks,
    triangleCount,
    setFocus(x, z) {
      for (const entry of meshes) {
        const distance = Math.hypot(entry.centreX - x, entry.centreZ - z);
        entry.mesh.visible = distance - bucketHalfDiagonal <= TREE_DRAW_RADIUS;
      }
    },
    setTime(seconds) {
      wind.time.value = seconds;
    },
    dispose() {
      for (const geometry of Object.values(geometries)) geometry.dispose();
      material.dispose();
      for (const entry of meshes) entry.mesh.dispose();
    },
  };
}

function pickStorey(roll: number): (typeof STOREYS)[number] {
  let cursor = roll;
  for (const storey of STOREYS) {
    cursor -= storey.share;
    if (cursor <= 0) return storey;
  }
  return STOREYS[STOREYS.length - 1] ?? { share: 1, scale: 1 };
}

const SPECIES_ORDER: readonly TreeSpecies[] = [
  "broadleaf",
  "pine",
  "scrub",
  "birch",
  "willow",
  "deadwood",
];

function pickSpecies(profile: TreeProfile, roll: number): TreeSpecies {
  const total = SPECIES_ORDER.reduce((sum, species) => sum + profile.mix[species], 0);
  let cursor = (roll / 255) * (total || 1);
  for (const species of SPECIES_ORDER) {
    cursor -= profile.mix[species];
    if (cursor <= 0) return species;
  }
  return "broadleaf";
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
