import {
  CircleGeometry,
  Color,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from "three";
import type { WorldManifest } from "../game/world/compiler/worldTypes";
import { roughenGeometry } from "../render/geometryUtils";
import { PALETTE } from "../render/palette";
import {
  scatterDensityFor,
  scatterMixFor,
  terrainFamilyFor,
  type ScatterArchetype,
  type TerrainFamily,
} from "./regionVisuals";

/**
 * Scenery for a compiled island.
 *
 * The manifest describes each placement as a position, a yaw, a scale and a
 * collision radius, and the world runtime turns that into one cylinder collider
 * per placement. So the visual has to be a *clump* filling that footprint, not
 * a single object standing in the middle of it: a placement with a four-metre
 * collision radius and a two-metre height is a thicket or a boulder field, and
 * drawing one slim tree there would leave the player stopped by nothing.
 *
 * What a clump is made of comes from the region's authored `visualIntent` -
 * terrain family, scatter families and scatter density - rather than from tags
 * this file interprets for itself. Concrete geometry, colour and count remain
 * render-layer decisions, because the spec states intent and not assets.
 *
 * Every element position is derived from the placement's stable id. There is no
 * `Math.random` here: the same manifest produces the same scenery on every
 * machine and every reload, which is the whole point of compiling the world.
 */

export interface IslandPlacements {
  readonly group: Group;
  readonly drawCalls: number;
  /** Elements actually instanced, for budget evidence. */
  readonly elementCount: number;
  dispose(): void;
}

interface ClusterElement {
  readonly kind: "rock" | "foliage" | "trunk";
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
  readonly yaw: number;
  readonly tint: Color;
}

/** Deterministic 32-bit hash of a stable id, so scenery is reproducible. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Successive [0,1) values from one seed. Pure, and stable across runtimes. */
function makeSequence(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

const FOLIAGE_TINTS: Record<TerrainFamily, readonly Color[]> = {
  coastal: [new Color("#8e9a63"), new Color("#a3ab6e"), new Color("#798a55")],
  grassland: [new Color("#6f8f45"), new Color("#87a052"), new Color("#557539")],
  woodland: [new Color("#3f6136"), new Color("#4f7440"), new Color("#2f4a2c")],
};

const ROCK_TINTS: readonly Color[] = [
  PALETTE.rockLight,
  PALETTE.rockDark,
  new Color("#5d5850"),
];

/** Picks one archetype from the region's mix, by relative weight. */
function pickArchetype(
  mix: readonly ScatterArchetype[],
  roll: number,
): ScatterArchetype {
  const total = mix.reduce((sum, archetype) => sum + archetype.weight, 0);
  let cursor = roll * total;
  for (const archetype of mix) {
    cursor -= archetype.weight;
    if (cursor <= 0) return archetype;
  }
  return mix[mix.length - 1] ?? { kind: "foliage", weight: 1, spread: 0.4, rise: 0.6 };
}

/**
 * Builds one clump. Elements are laid across the disc inside the collision
 * radius so the silhouette matches the cylinder the horse will actually be
 * stopped by, with the mass thinning towards the rim so the clump reads as one
 * object rather than as a fairy ring.
 */
function clusterElements(
  seed: number,
  family: TerrainFamily,
  mix: readonly ScatterArchetype[],
  density: number,
  centreX: number,
  centreY: number,
  centreZ: number,
  radius: number,
  scale: number,
): ClusterElement[] {
  const next = makeSequence(seed);
  const elements: ClusterElement[] = [];
  const tints = FOLIAGE_TINTS[family];
  // Bigger footprints get more pieces, so a wide thicket does not read as one
  // stretched blob, and a denser region is visibly thicker rather than just
  // more frequent.
  const count = Math.max(3, Math.round(radius * (1.1 + density * 1.4)));
  const height = 1.7 + scale * 0.7;

  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2 + next() * 0.7;
    // Square root keeps the pieces spread across the disc instead of bunching
    // at the rim.
    const distance = Math.sqrt(next()) * radius * 0.78;
    const x = centreX + Math.cos(angle) * distance;
    const z = centreZ + Math.sin(angle) * distance;
    const falloff = 1 - (distance / Math.max(radius, 0.01)) * 0.45;
    const archetype = pickArchetype(mix, next());
    const spread = radius * archetype.spread * falloff;

    if (archetype.kind === "trunk") {
      // Trunks keep their full height wherever they stand: a half-height tree
      // at the edge of a thicket reads as a mistake, not as depth.
      const trunkHeight = height * archetype.rise * (0.85 + next() * 0.4);
      const trunkRadius = Math.max(0.15, spread);
      elements.push({
        kind: "trunk",
        x,
        y: centreY,
        z,
        radius: trunkRadius,
        height: trunkHeight,
        yaw: next() * Math.PI * 2,
        tint: next() > 0.5 ? new Color(PALETTE.trunk) : new Color(PALETTE.trunkShade),
      });
      // And a crown on top of it. A bare pole is not a tree; the first island
      // captures had the fernwood reading as a field of tent stakes.
      elements.push({
        kind: "foliage",
        x,
        y: centreY + trunkHeight * 0.52,
        z,
        radius: Math.max(0.9, trunkRadius * 5.4 + radius * 0.16),
        height: trunkHeight * 0.72,
        yaw: next() * Math.PI * 2,
        tint: tints[Math.floor(next() * tints.length)] ?? tints[0] ?? new Color("#4f7440"),
      });
      continue;
    }

    const rise = height * archetype.rise * falloff;
    elements.push(
      archetype.kind === "rock"
        ? rock(next, x, centreY, z, spread, rise)
        : foliage(next, tints, x, centreY, z, spread, rise),
    );
  }

  return elements;
}

function rock(
  next: () => number,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
): ClusterElement {
  return {
    kind: "rock",
    x,
    y,
    z,
    radius: Math.max(0.25, radius),
    height: Math.max(0.3, height),
    yaw: next() * Math.PI * 2,
    tint: ROCK_TINTS[Math.floor(next() * ROCK_TINTS.length)] ?? PALETTE.rockLight,
  };
}

function foliage(
  next: () => number,
  tints: readonly Color[],
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
): ClusterElement {
  return {
    kind: "foliage",
    x,
    y,
    z,
    radius: Math.max(0.3, radius),
    height: Math.max(0.4, height),
    yaw: next() * Math.PI * 2,
    tint: tints[Math.floor(next() * tints.length)] ?? tints[0] ?? new Color("#6f8f45"),
  };
}

/**
 * Landmarks for compiled discoveries.
 *
 * These are silhouettes and nothing else: no triggers, no logic, no state. The
 * exploration systems that give discoveries meaning are Milestone 4. What the
 * milestone needs now is that the places the compiler chose are visibly places,
 * so a rider crossing the island has somewhere to aim at.
 */
function discoveryElements(
  manifest: WorldManifest,
  heightAt: (x: number, z: number) => number,
): { elements: ClusterElement[]; pools: Array<{ x: number; y: number; z: number; radius: number }> } {
  const elements: ClusterElement[] = [];
  const pools: Array<{ x: number; y: number; z: number; radius: number }> = [];

  for (const discovery of manifest.discoveries) {
    const next = makeSequence(hashString(discovery.stableId));
    const { x, z } = discovery.position;
    const groundY = heightAt(x, z);

    switch (discovery.type) {
      case "overlook": {
        // A cairn. Stacked stone is the oldest "someone stood here" signal
        // there is, and it reads against sky from a long way off.
        let stackY = groundY;
        for (let index = 0; index < 5; index += 1) {
          const radius = 0.85 - index * 0.13;
          const height = 0.42 - index * 0.04;
          elements.push({
            kind: "rock",
            x: x + (next() - 0.5) * 0.22,
            y: stackY,
            z: z + (next() - 0.5) * 0.22,
            radius,
            height,
            yaw: next() * Math.PI * 2,
            tint: ROCK_TINTS[index % ROCK_TINTS.length] ?? PALETTE.rockLight,
          });
          stackY += height * 0.86;
        }
        break;
      }
      case "resting-hollow": {
        // A spring: still water ringed with stones, so the sound cue the spec
        // describes has something to come from.
        pools.push({ x, y: groundY + 0.06, z, radius: 2.6 });
        for (let index = 0; index < 9; index += 1) {
          const angle = (index / 9) * Math.PI * 2 + next() * 0.4;
          const distance = 2.7 + next() * 0.7;
          elements.push(
            rock(
              next,
              x + Math.cos(angle) * distance,
              groundY,
              z + Math.sin(angle) * distance,
              0.34 + next() * 0.28,
              0.3 + next() * 0.24,
            ),
          );
        }
        break;
      }
      case "herd-trace": {
        // Where a herd rested: flattened ground is not something this renderer
        // can show, so the trace is the debris they left around it.
        for (let index = 0; index < 7; index += 1) {
          const angle = next() * Math.PI * 2;
          const distance = next() * 4.4;
          elements.push(
            rock(
              next,
              x + Math.cos(angle) * distance,
              groundY,
              z + Math.sin(angle) * distance,
              0.2 + next() * 0.16,
              0.14 + next() * 0.12,
            ),
          );
        }
        break;
      }
      default:
        // Wildlife and environmental events have no built form to place.
        break;
    }
  }

  return { elements, pools };
}

export function createIslandPlacements(
  manifest: WorldManifest,
  heightAt: (x: number, z: number) => number,
): IslandPlacements {
  const group = new Group();
  group.name = "island-placements";

  const intentByRegion = new Map(
    manifest.regions.map(
      (region) =>
        [
          region.id,
          {
            family: terrainFamilyFor(manifest, region.id),
            mix: scatterMixFor(manifest, region.id),
            density: scatterDensityFor(manifest, region.id),
          },
        ] as const,
    ),
  );

  const elements: ClusterElement[] = [];
  for (const placement of manifest.placements) {
    const intent = intentByRegion.get(placement.regionId);
    elements.push(
      ...clusterElements(
        hashString(placement.stableId),
        intent?.family ?? "grassland",
        intent?.mix ?? scatterMixFor(manifest, placement.regionId),
        intent?.density ?? 0.5,
        placement.position.x,
        // Re-read the ground under each clump rather than trusting the record's
        // own y: the manifest quantizes it, and a clump floating four
        // centimetres above its shadow is visible at a standstill.
        heightAt(placement.position.x, placement.position.z),
        placement.position.z,
        placement.collisionRadiusMeters,
        placement.scale,
      ),
    );
  }

  const discovery = discoveryElements(manifest, heightAt);
  elements.push(...discovery.elements);

  const geometries: BufferGeometry[] = [];
  const materials: MeshStandardMaterial[] = [];

  const addFamily = (
    name: string,
    kind: ClusterElement["kind"],
    geometry: BufferGeometry,
    roughness: number,
  ): void => {
    const members = elements.filter((element) => element.kind === kind);
    if (members.length === 0) {
      geometry.dispose();
      return;
    }
    geometries.push(geometry);
    // Instance colour multiplies the material colour, so the base stays white.
    // A brown material with a brown instance colour renders near-black; that
    // cost the Horse Lab an inspection round to find.
    const material = new MeshStandardMaterial({ roughness, metalness: 0 });
    materials.push(material);

    const mesh = new InstancedMesh(geometry, material, members.length);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    const axis = new Vector3(0, 1, 0);

    members.forEach((element, index) => {
      position.set(element.x, element.y + element.height * 0.5, element.z);
      quaternion.setFromAxisAngle(axis, element.yaw);
      scale.set(element.radius, element.height * 0.5, element.radius);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, element.tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  };

  addFamily("island-rock", "rock", roughenGeometry(new IcosahedronGeometry(1, 1), 0.22), 0.95);
  addFamily("island-foliage", "foliage", roughenGeometry(new IcosahedronGeometry(1, 1), 0.16), 0.88);
  addFamily("island-trunk", "trunk", new IcosahedronGeometry(1, 1), 0.9);

  // Spring water. Flat, still, and darker than the sea, so it reads as fresh
  // water lying in a hollow rather than as a piece of coastline.
  if (discovery.pools.length > 0) {
    const poolGeometry = new CircleGeometry(1, 20);
    poolGeometry.rotateX(-Math.PI / 2);
    geometries.push(poolGeometry);
    const poolMaterial = new MeshStandardMaterial({
      color: new Color("#3b6b62"),
      roughness: 0.18,
      metalness: 0.05,
    });
    materials.push(poolMaterial);
    const pools = new InstancedMesh(poolGeometry, poolMaterial, discovery.pools.length);
    pools.name = "island-spring-pools";
    pools.receiveShadow = true;
    const matrix = new Matrix4();
    discovery.pools.forEach((pool, index) => {
      matrix.compose(
        new Vector3(pool.x, pool.y, pool.z),
        new Quaternion(),
        new Vector3(pool.radius, 1, pool.radius),
      );
      pools.setMatrixAt(index, matrix);
    });
    pools.instanceMatrix.needsUpdate = true;
    group.add(pools);
  }

  return {
    group,
    drawCalls: group.children.length,
    elementCount: elements.length + discovery.pools.length,
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
