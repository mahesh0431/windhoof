import {
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from "three";
import {
  applyGrassWind,
  createTuftGeometry,
  createWindUniforms,
  type WindUniforms,
} from "./grassBlades";
import type { WorldManifest } from "../game/world/compiler/worldTypes";
import type { IslandField } from "./islandField";
import { ROUTE_DISTANCE_CAP } from "./islandField";
import { regionStyleFor, scatterDensityFor, terrainFamilyFor, type TerrainFamily } from "./regionVisuals";

/**
 * Ground cover: the vegetation the regions are named after.
 *
 * The compiled placements are collision-bearing scenery - thickets and boulder
 * fields a horse is stopped by - and the compiler emits eighteen of them across
 * a 512-metre island. That is the right number of things to be stopped by and
 * nowhere near enough to tell a player what country they are in. A region called
 * "longgrass-opening" that renders as bare ground has not been realized, it has
 * been labelled.
 *
 * So this is the other half: dense, non-colliding tussocks, ferns and flower
 * heads placed straight off the manifest's own fields. Nothing here has a
 * collider, which is the art brief's rule - a horse rides through grass without
 * the world feeling sticky - and nothing here is authored per-location. Density
 * and character come from each region's authored `visualIntent`, position comes
 * from a hash of the manifest's own stable id and the sample coordinate, so the
 * same world grows the same grass on every machine and every reload.
 *
 * It also does the job no colour ramp could: it breaks the silhouette of the
 * graded route corridors. The compiler cuts those corridors as flat-topped
 * embankments with bare shoulders, and against bare ground they read as poured
 * concrete. Grass growing up the banks and right to the lip, with only the worn
 * line itself left bare, is what turns that shape back into a trail.
 */

export interface IslandGroundCover {
  readonly group: Group;
  readonly tuftCount: number;
  readonly triangleCount: number;
  /**
   * Shows only the cover buckets near the player.
   *
   * The frustum culler removes what is behind the camera and nothing else, so
   * on the 1,024-metre island every bucket in front of the horse was being
   * submitted - a million drawn triangles and two hundred draw calls, for grass
   * that is a sub-pixel smear past a couple of hundred metres. This is the
   * distance half of the same job, and it is exact rather than approximate: a
   * bucket is one terrain chunk, so the radius is measured to the chunk's own
   * centre and half-diagonal.
   */
  setFocus(x: number, z: number): void;
  /** Advances the wind. One uniform moves every tuft on the island. */
  setTime(seconds: number): void;
  dispose(): void;
}

/**
 * How far ground cover is drawn, in metres from the horse.
 *
 * Past this the tufts are smaller than a pixel and the terrain's own vertex
 * colouring carries the ground, so the fog this sits well inside of does the
 * rest.
 *
 * 260 is the value that was actually measured: 155 draw calls and 674k drawn
 * triangles, both inside the standing budgets. It was raised to 380 on a guess
 * that the boundary was visible, and that guess was never measured - the
 * inspection that would have measured it never finished, because more drawn
 * triangles under SwiftShader means fewer metres of ground covered per wall
 * clock second. Whether the boundary reads in motion is still an open question,
 * and it is recorded as one rather than answered by an unmeasured constant.
 */
/*
 * Trimmed from 260 when the near-grass window arrived: the far scatter no
 * longer has to carry the foreground, and the triangles it gives up here are
 * what pay for the carpet the player is standing in.
 */
const COVER_DRAW_RADIUS = 185;

/**
 * Terrain chunks per cover bucket.
 *
 * One bucket per chunk is the finest cull and, at two layers, also two draw
 * calls per chunk: on the full island that was fifty calls of grass alone and
 * it is what took the riding frame over its draw-call budget. Bucketing two
 * chunks together quarters the calls and pays for it in triangles, which is the
 * side of the budget that has room.
 */
const CHUNKS_PER_BUCKET = 2;

/**
 * Flower heads are a few centimetres across and gone from the frame well before
 * the grass they sit in is, so they stop being drawn long before it does.
 */
const FLOWER_DRAW_RADIUS = 85;

/** Metres between candidate tufts before jitter. */
const CELL_METRES = 3;
/**
 * A runaway guard, not a working limit.
 *
 * It has to sit well above what the vertical slice actually produces, because
 * hitting it stops the sweep part-way through and leaves everything north of
 * that point bare - which is exactly what happened at the first value tried.
 */
/**
 * Tuft ceiling for the 512-metre slice. Scaled by area for larger islands, so
 * a bigger world is not thinner ground - see `tuftCeiling`.
 */
const MAX_TUFTS_PER_SLICE = 320_000;

/**
 * Ground cover is instanced, so cost is triangles and matrix writes rather than
 * draw calls, and both scale with area. Growing the ceiling linearly with area
 * keeps density constant; the multiplier is held below linear past four times
 * the slice so a very large island cannot walk off the triangle budget.
 */
function tuftCeiling(sizeMeters: number): number {
  const areaRatio = (sizeMeters / 512) ** 2;
  return Math.round(MAX_TUFTS_PER_SLICE * Math.min(areaRatio, 3.2));
}

interface CoverStyle {
  /** Tufts attempted per cell, before the density multiplier. */
  readonly perCell: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly tints: readonly Color[];
  /** Chance a tuft also gets a pale head, for flowering ground. */
  readonly flowerChance: number;
}

const STYLES: Record<TerrainFamily, CoverStyle> = {
  // Marram on the dunes: sparse, low, wind-flattened, greyed off by salt.
  coastal: {
    perCell: 3,
    minHeight: 0.26,
    maxHeight: 0.52,
    minRadius: 0.07,
    maxRadius: 0.13,
    tints: [new Color("#9aa471"), new Color("#aab27f"), new Color("#87956a")],
    flowerChance: 0.03,
  },
  // The longgrass the region is named for: tall, gold-shot, and thick enough
  // that the gallop has something streaming past it.
  grassland: {
    perCell: 5,
    minHeight: 0.45,
    maxHeight: 0.95,
    minRadius: 0.1,
    maxRadius: 0.2,
    tints: [
      new Color("#a8b163"),
      new Color("#8da55c"),
      new Color("#c2bd6f"),
      new Color("#75903f"),
    ],
    flowerChance: 0.09,
  },
  // Fern under the canopy: lower, much wider, and far darker than anything on
  // the plain, so the treeline is a change of country and not just of props.
  woodland: {
    perCell: 5,
    minHeight: 0.34,
    maxHeight: 0.68,
    minRadius: 0.14,
    maxRadius: 0.26,
    tints: [new Color("#33512e"), new Color("#3f6136"), new Color("#284526")],
    flowerChance: 0.02,
  },
};

const FLOWER_TINTS: readonly Color[] = [
  new Color("#e8dfae"),
  new Color("#dcc98a"),
  new Color("#efe6c8"),
];

/** Deterministic 32-bit hash of three integers plus the world's own seed. */
function hash3(seed: number, x: number, z: number, salt: number): number {
  let value = (seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ Math.imul(salt, 0x27d4eb2d)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}

/**
 * What one instanced cover layer is made of.
 *
 * Blades and flower heads want opposite anchoring: a blade grows out of the
 * ground it is placed on, and a bud sits centred on the point it was given.
 */
interface CoverLayer {
  readonly name: string;
  readonly triangles: number;
  readonly flower: boolean;
}

interface Tuft {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
  readonly yaw: number;
  readonly lean: number;
  readonly tint: Color;
}

/**
 * Ground cover built as a sequence of bounded jobs.
 *
 * Sweeping twenty-nine thousand candidate cells and composing seventy thousand
 * instance matrices is one of the two largest pieces of world realization, and
 * as a single call it is a main-thread block the loading panel cannot paint
 * through. Split, it becomes a handful of jobs the app can run a frame apart:
 * `sweepBand` covers one horizontal strip of the island, `realizeLayer` builds
 * the instanced meshes for one layer, and neither has to know anything about
 * why it was divided that way.
 *
 * The division is by measurement, not by taste. Nothing about the result
 * changes: the same cells are swept in the same order with the same hashes, so
 * the same world grows the same grass whether it was built in one job or six.
 */
export interface GroundCoverBuild {
  readonly bandCount: number;
  readonly layerNames: readonly string[];
  sweepBand(band: number): void;
  realizeLayer(layer: number): void;
  finish(): IslandGroundCover;
}

/**
 * Horizontal strips per sweep job.
 *
 * Four kept each strip well inside the 50 ms preparation budget on the
 * sixteen-chunk slice. The work is proportional to area, so the count has to
 * grow with area or the same job on a four-times-larger island takes four times
 * as long - and the budget is a hard milestone gate, not a target. This formula
 * returns exactly four for the slice, so its recorded job list is unchanged.
 */
function sweepBandsFor(chunksPerEdge: number): number {
  return Math.max(4, Math.round((chunksPerEdge * chunksPerEdge) / 4));
}

export function createIslandGroundCover(
  manifest: WorldManifest,
  field: IslandField,
): IslandGroundCover {
  const build = beginIslandGroundCover(manifest, field);
  for (let band = 0; band < build.bandCount; band += 1) build.sweepBand(band);
  for (let layer = 0; layer < build.layerNames.length; layer += 1) build.realizeLayer(layer);
  return build.finish();
}

export function beginIslandGroundCover(
  manifest: WorldManifest,
  field: IslandField,
): GroundCoverBuild {
  const group = new Group();
  group.name = "island-ground-cover";

  const familyByRegionIndex = field.regionIds.map((id) => terrainFamilyFor(manifest, id));
  const densityByRegionIndex = field.regionIds.map((id) => scatterDensityFor(manifest, id));
  /**
   * Each region's cover, as its own material rather than its family's.
   *
   * The terrain ramp alone was not enough. Standing on Blackstone Crown the
   * frame is mostly ground cover, so a basalt crown carpeted in the same green
   * tufts as Longgrass Plain is still a green dome with a dark floor showing
   * through. Cover is what the player is actually looking at, so cover carries
   * the region: sparse dark heather on the crown, tall gold on the plain, wide
   * silver-green reed in the river hollow.
   *
   * Computed once per region: this is a five-entry table and the sweep visits
   * hundreds of thousands of cells.
   */
  const styleByRegionIndex = field.regionIds.map((id) => regionStyleFor(id));
  const tintsByRegionIndex = styleByRegionIndex.map((style) =>
    style.coverTints.map(([r, g, b]) => new Color(r, g, b)),
  );

  // Route half-width, so the bare worn line matches the corridor the compiler
  // actually graded rather than a width chosen by eye.
  const safeRouteHalfWidth = Math.max(
    3,
    ...manifest.routes
      .filter((route) => route.kind === "safe")
      .map((route) => route.widthMeters * 0.5),
  );

  const tufts: Tuft[] = [];
  const flowers: Tuft[] = [];
  const bucketMeshes: Array<{
    mesh: InstancedMesh;
    centreX: number;
    centreZ: number;
    /** Layers can reach different distances; a flower head is not a treeline. */
    radius: number;
  }> = [];
  const half = field.halfMeters;
  const chunksPerEdge = manifest.island.chunksPerEdge;
  const cells = Math.floor(field.sizeMeters / CELL_METRES);
  const sweepBands = sweepBandsFor(chunksPerEdge);
  const maxTufts = tuftCeiling(field.sizeMeters);

  const sweepBand = (band: number): void => {
    const fromZ = Math.floor((band * cells) / sweepBands);
    const toZ = Math.floor(((band + 1) * cells) / sweepBands);
    for (let cellZ = fromZ; cellZ < toZ && tufts.length < maxTufts; cellZ += 1) {
      for (let cellX = 0; cellX < cells && tufts.length < maxTufts; cellX += 1) {
        const baseX = -half + cellX * CELL_METRES;
        const baseZ = -half + cellZ * CELL_METRES;

        // One grid lookup decides the whole cell. Sampling per tuft would cost
        // four times as much for a difference of well under a metre.
        const sampleX = Math.min(
          field.gridSize - 1,
          Math.max(0, Math.round((baseX + half) / field.spacing)),
        );
        const sampleZ = Math.min(
          field.gridSize - 1,
          Math.max(0, Math.round((baseZ + half) / field.spacing)),
        );
        const sample = sampleZ * field.gridSize + sampleX;

        const shore = field.shoreDistance[sample] ?? 0;
        // Nothing grows below the tide line or out on the wet sand.
        if (shore < 5) continue;

        const slope = field.slopeDegrees[sample] ?? 0;
        // Grass climbs a bank a horse cannot. It stops at genuine rock, which is
        // the point: a bare face still reads as bare face.
        if (slope > 52) continue;

        const regionIndex = field.regionIndex[sample] ?? 0;
        const family = familyByRegionIndex[regionIndex] ?? "grassland";
        const style = STYLES[family];
        const regionStyle = styleByRegionIndex[regionIndex] ?? regionStyleFor("");
        const density = (densityByRegionIndex[regionIndex] ?? 0.5) * regionStyle.coverDensity;

        // The worn line stays bare. Everything either side of it does not, and
        // that contrast is what makes a graded corridor read as a trail.
        const routeDistance = field.routeDistance[sample] ?? ROUTE_DISTANCE_CAP;
        if (routeDistance < safeRouteHalfWidth * 0.5) continue;

        // Thin out on the steepest banks and on the strand, so the change is a
        // fading rather than a line.
        const slopeFalloff = slope > 34 ? 0.45 : 1;
        const shoreFalloff = shore < 16 ? 0.35 + (shore - 5) / 16 : 1;
        // Thinner than it was. This layer used to be the only cover there was
        // and had to read as ground on its own; now it is the middle distance
        // behind a carpet, and half of it is enough to keep the ground textured
        // out to the horizon for half the triangles.
        const attempts = Math.max(
          2,
          Math.round(style.perCell * (0.8 + density) * slopeFalloff * shoreFalloff * 1.5),
        );

        for (let index = 0; index < attempts; index += 1) {
          const noise = hash3(manifest.seed, cellX, cellZ, index);
          const a = (noise & 0xff) / 255;
          const b = ((noise >>> 8) & 0xff) / 255;
          const c = ((noise >>> 16) & 0xff) / 255;
          const d = ((noise >>> 24) & 0xff) / 255;

          const x = baseX + a * CELL_METRES;
          const z = baseZ + b * CELL_METRES;
          const y = field.heightAt(x, z);
          if (y <= field.seaLevel + 0.4) continue;

          const height =
            (style.minHeight + c * (style.maxHeight - style.minHeight)) * regionStyle.coverScale;
          const radius =
            (style.minRadius + d * (style.maxRadius - style.minRadius)) * regionStyle.coverScale;
          const palette = tintsByRegionIndex[regionIndex] ?? style.tints;
          const tint = palette[noise % palette.length] ?? style.tints[0];
          if (!tint) continue;

          tufts.push({
            x,
            y,
            z,
            radius,
            height,
            yaw: a * Math.PI * 2,
            // A slight lean, varied per tuft, so a field of them does not read as
            // a pin cushion of identical vertical spikes.
            lean: (c - 0.5) * 0.34,
            tint,
          });

          if (d < style.flowerChance) {
            flowers.push({
              x,
              y: y + height * 0.82,
              z,
              radius: radius * 0.42,
              height: height * 0.26,
              yaw: b * Math.PI * 2,
              lean: 0,
              tint: FLOWER_TINTS[noise % FLOWER_TINTS.length] ?? new Color("#e8dfae"),
            });
          }
        }
      }
    }
  };

  const geometries: BufferGeometry[] = [];
  const materials: MeshStandardMaterial[] = [];
  // Weaker than the near carpet: at this distance a large sway reads as the
  // whole ground plane shearing rather than as grass moving.
  const wind: WindUniforms = createWindUniforms(0.07, 0.045, 1, 2.4);
  let triangleCount = 0;

  /**
   * One instanced mesh per terrain chunk, not one per island.
   *
   * This is the difference between the cover being free and the cover being
   * unplayable. A single instanced mesh holding seventy thousand tufts has a
   * bounding volume the size of the island, so it never frustum-culls and every
   * frame pays for every tuft no matter which way the player is facing. Bucketed
   * by the compiler's own 128-metre chunks, the handful in front of the camera
   * are drawn and the rest are rejected by the culler before they cost anything.
   *
   * Measured on the vertical slice: 69,398 tufts, 212,836 triangles in total,
   * of which only the visible chunks are submitted.
   */
  const bucketSpan = manifest.island.chunkSizeMeters * CHUNKS_PER_BUCKET;
  const bucketsPerEdge = Math.max(1, Math.ceil(chunksPerEdge / CHUNKS_PER_BUCKET));
  const bucketOf = (tuft: Tuft): number => {
    const bucketX = Math.min(
      bucketsPerEdge - 1,
      Math.max(0, Math.floor((tuft.x + half) / bucketSpan)),
    );
    const bucketZ = Math.min(
      bucketsPerEdge - 1,
      Math.max(0, Math.floor((tuft.z + half) / bucketSpan)),
    );
    return bucketZ * bucketsPerEdge + bucketX;
  };

  const addLayer = (name: string, members: readonly Tuft[], layer: CoverLayer): void => {
    if (members.length === 0) return;
    // Three triangles either way. Spent on splayed blades rather than on a cone,
    // because a cone is the one silhouette at this budget that cannot read as a
    // plant. Flower heads keep the cone: a bud is a blob, and it is the one
    // thing on the ground that should not be blade-shaped.
    const geometry = layer.flower
      ? new ConeGeometry(1, 1, 4, 1, true)
      : createTuftGeometry({ blades: 3, width: 0.17, splay: 0.82, rootShade: 0.5 }, 1);
    geometries.push(geometry);
    // Instance colour multiplies the material colour, so the base stays white.
    const material = new MeshStandardMaterial({
      roughness: 0.94,
      metalness: 0,
      vertexColors: !layer.flower,
    });
    if (!layer.flower) {
      // A blade has no back: single-sided, half of every tuft is unlit black
      // whenever the sun is on the other side of it.
      material.side = DoubleSide;
      applyGrassWind(material, wind);
    }
    materials.push(material);

    const buckets = new Map<number, Tuft[]>();
    for (const tuft of members) {
      const key = bucketOf(tuft);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(tuft);
      else buckets.set(key, [tuft]);
    }

    const matrix = new Matrix4();
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    const axis = new Vector3();

    for (const [key, bucket] of buckets) {
      const mesh = new InstancedMesh(geometry, material, bucket.length);
      bucketMeshes.push({
        mesh,
        centreX: -half + ((key % bucketsPerEdge) + 0.5) * bucketSpan,
        centreZ: -half + (Math.floor(key / bucketsPerEdge) + 0.5) * bucketSpan,
        radius: layer.flower ? FLOWER_DRAW_RADIUS : COVER_DRAW_RADIUS,
      });
      mesh.name = `${name}-${key}`;
      // Ground cover receives shadow but does not cast: tens of thousands of
      // tussocks in the shadow pass costs a great deal and changes almost
      // nothing, since each is smaller than a shadow-map texel at this range.
      mesh.castShadow = false;
      mesh.receiveShadow = true;

      bucket.forEach((tuft, index) => {
        position.set(
          tuft.x,
          layer.flower ? tuft.y + tuft.height * 0.5 : tuft.y,
          tuft.z,
        );
        axis.set(Math.cos(tuft.yaw), 0, Math.sin(tuft.yaw)).normalize();
        quaternion.setFromAxisAngle(axis, tuft.lean);
        scale.set(
          tuft.radius,
          layer.flower ? tuft.height * 0.5 : tuft.height,
          tuft.radius,
        );
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
        mesh.setColorAt(index, tuft.tint);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Without this the mesh keeps the geometry's unit bounding sphere and the
      // culler makes the wrong call in both directions.
      mesh.computeBoundingSphere();
      triangleCount += layer.triangles * bucket.length;
      group.add(mesh);
    }
  };

  const layers: ReadonlyArray<CoverLayer & { readonly members: readonly Tuft[] }> = [
    { name: "island-tufts", members: tufts, triangles: 3, flower: false },
    { name: "island-flowers", members: flowers, triangles: 4, flower: true },
  ];

  return {
    bandCount: sweepBands,
    layerNames: layers.map((layer) => layer.name),
    sweepBand,
    realizeLayer(layer) {
      const entry = layers[layer];
      if (!entry) throw new Error(`No ground-cover layer ${layer}`);
      addLayer(entry.name, entry.members, entry);
    },
    finish() {
      const chunkHalfDiagonal = bucketSpan * Math.SQRT1_2;
      return {
        group,
        tuftCount: tufts.length + flowers.length,
        triangleCount,
        setFocus(x, z) {
          wind.parter.value.set(x, 0, z);
          for (const bucket of bucketMeshes) {
            const distance = Math.hypot(bucket.centreX - x, bucket.centreZ - z);
            bucket.mesh.visible = distance - chunkHalfDiagonal <= bucket.radius;
          }
        },
        setTime(seconds) {
          wind.time.value = seconds;
        },
        dispose() {
          for (const geometry of geometries) geometry.dispose();
          for (const material of materials) material.dispose();
        },
      };
    },
  };
}
