import { Color } from "three";
import type { IslandField } from "./islandField";
import { ROUTE_DISTANCE_CAP } from "./islandField";
import { PALETTE } from "../render/palette";
import { regionStyleFor, terrainFamilyFor, type TerrainFamily } from "./regionVisuals";
import type { TerrainChunkTopology } from "../game/world/runtime/terrainChunkTopology";

/**
 * One chunk of terrain, as a single vertex buffer.
 *
 * `positions` and `indices` are not built here. They are the exact arrays the
 * repository prepared and the physics world already retained, handed straight
 * through to the Three.js BufferGeometry. That is the WorldClaw
 * explicit-representation rule taken literally: what the player sees and what
 * the horse collides with cannot drift apart, because there is only one of them
 * and this layer is not permitted to make a second.
 *
 * What this layer does own is everything the collider has no opinion about -
 * vertex normals computed across chunk seams, and the authored region, moisture,
 * slope, shore and worn-route colouring.
 */
export interface IslandChunkMesh {
  readonly chunkId: string;
  readonly stableId: string;
  readonly chunkX: number;
  readonly chunkZ: number;
  /** The canonical topology arrays, by reference. Never copied, never rebuilt. */
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Proof of which topology object this mesh is drawing. */
  readonly topologyFingerprint: string;
  readonly normals: Float32Array;
  readonly colors: Float32Array;
  readonly triangleCount: number;
  /** Centre and radius in world space, for culling and for the shadow volume. */
  readonly centreX: number;
  readonly centreZ: number;
}

/**
 * Ground families.
 *
 * Which family a region gets is the compiler's decision, not this file's: the
 * `WorldSpec` states it as `visualIntent.terrainFamily` and the manifest carries
 * it through. An earlier version inferred it from the region's tags, which meant
 * the renderer held a second, silently divergent opinion about what a region
 * looked like. The concrete colours stay here, because the spec deliberately
 * names families and moods rather than hex values.
 */


/** A worn line through whatever ground it crosses: paler, drier, flatter. */
const WORN_PATH = new Color("#b0a87c");

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Short-wavelength dapple only.
 *
 * The Horse Lab taught this the expensive way: a long-wavelength ground tint
 * reads as a bank of fog lying on the grass rather than as texture. Anything
 * broad enough to notice as a shape is broad enough to be mistaken for one.
 */
function dapple(x: number, z: number): number {
  const a = Math.sin(x * 0.31 + z * 0.17);
  const b = Math.sin(x * 0.11 - z * 0.43 + 1.7);
  const c = Math.sin(x * 0.77 - z * 0.59 + 0.4);
  return (a * 0.46 + b * 0.32 + c * 0.22) * 0.5;
}

/**
 * How much this sample sits in a hollow rather than on a rise.
 *
 * Negative in dips, positive on crests. The compiled coast is nearly flat, and
 * with only a directional light and a hemisphere fill a nearly flat surface has
 * almost no shading to read, so half-metre undulations that are genuinely there
 * were invisible. This puts them back as value rather than inventing relief the
 * collider does not have.
 */
function hollow(field: IslandField, x: number, z: number): number {
  const e = field.spacing * 2;
  const average =
    (field.heightAt(x - e, z) +
      field.heightAt(x + e, z) +
      field.heightAt(x, z - e) +
      field.heightAt(x, z + e)) *
    0.25;
  return field.heightAt(x, z) - average;
}

/**
 * Per-sample blend weights across the three ground families.
 *
 * The manifest's region mask is a nearest-anchor decision, so it changes in one
 * step from one sample to the next. Colouring straight from it drew a hard line
 * across the island wherever two regions met, which read as a rendering seam
 * rather than as country changing. Blurring the one-hot family indicator over a
 * few samples turns that line into the gradual change it should be, without
 * touching the mask itself: collision, safety and audio still ask the world
 * which region they are in and still get one crisp answer.
 *
 * Separable, and run twice, so a 3-sample radius costs 12 taps per sample
 * rather than 49 and comes out smoother than one wider pass would.
 */
const FAMILY_ORDER: readonly TerrainFamily[] = ["coastal", "grassland", "woodland"];
const BLEND_RADIUS = 3;
const BLEND_PASSES = 2;

/**
 * Separable box blur over an interleaved per-sample channel array, in bands.
 *
 * One pass over the grid is independent per row, so a pass splits into strips
 * the caller can yield between. That matters because the cost is samples times
 * channels times taps times passes, and samples grow with the square of the
 * island: what fitted comfortably in one job on the 512-metre slice sits on top
 * of the 50 ms stall ceiling on a 1,024-metre one.
 *
 * Bands enumerate (pass, strip) pairs in order. A strip only ever writes its own
 * rows of the target and only ever reads the previous pass's source, so strips
 * within a pass are independent and the result is identical to the unbanded
 * version.
 */
function beginChannelBlur(
  values: Float32Array<ArrayBuffer>,
  channels: number,
  size: number,
): {
  readonly bandCount: number;
  sweepBand(band: number): void;
  finish(): Float32Array<ArrayBuffer>;
} {
  let source: Float32Array<ArrayBuffer> = values;
  let target: Float32Array<ArrayBuffer> = new Float32Array(values.length);
  const clamp = (value: number) => (value < 0 ? 0 : value > size - 1 ? size - 1 : value);
  const passes = BLEND_PASSES * 2;
  const taps = BLEND_RADIUS * 2 + 1;
  // About four million tap-channel operations per band on any island size.
  const stripsPerPass = Math.max(
    1,
    Math.round((size * size * channels * taps) / 4_000_000),
  );

  return {
    bandCount: passes * stripsPerPass,
    sweepBand(band) {
      const pass = Math.floor(band / stripsPerPass);
      const strip = band % stripsPerPass;
      const horizontal = pass % 2 === 0;
      const fromRow = Math.floor((strip * size) / stripsPerPass);
      const toRow = Math.floor(((strip + 1) * size) / stripsPerPass);

      for (let row = fromRow; row < toRow; row += 1) {
        for (let column = 0; column < size; column += 1) {
          const destination = (row * size + column) * channels;
          for (let channel = 0; channel < channels; channel += 1) {
            let sum = 0;
            for (let offset = -BLEND_RADIUS; offset <= BLEND_RADIUS; offset += 1) {
              const index = horizontal
                ? (row * size + clamp(column + offset)) * channels
                : (clamp(row + offset) * size + column) * channels;
              sum += source[index + channel] ?? 0;
            }
            target[destination + channel] = sum / taps;
          }
        }
      }

      // The last strip of a pass hands its result on as the next pass's source.
      if (strip === stripsPerPass - 1) {
        const swap = source;
        source = target;
        target = swap;
      }
    },
    finish: () => source,
  };
}

/**
 * Channel layout of the blurred colouring array.
 *
 * One array rather than three, because every one of these is the same
 * operation over the same grid and blurring them together costs one traversal
 * instead of three. Order is fixed and read back by the same names below.
 */
const FAMILY_CHANNELS = 3;
/** Dry rgb then rich rgb: the region's own ground ramp. */
const GROUND_CHANNELS = 6;
/** Slope in degrees at which bare rock starts, so it too crosses borders. */
const ROCK_CHANNELS = 1;
const MOISTURE_CHANNELS = 2;
const COLOURING_CHANNELS =
  FAMILY_CHANNELS + GROUND_CHANNELS + ROCK_CHANNELS + MOISTURE_CHANNELS;
const GROUND_OFFSET = FAMILY_CHANNELS;
const ROCK_OFFSET = GROUND_OFFSET + GROUND_CHANNELS;
const MOISTURE_OFFSET = ROCK_OFFSET + ROCK_CHANNELS;

/** Central difference across one cell, read from the whole-island grid. */
function fieldNormal(field: IslandField, x: number, z: number): {
  x: number;
  y: number;
  z: number;
} {
  const e = field.spacing;
  const nx = field.heightAt(x - e, z) - field.heightAt(x + e, z);
  const nz = field.heightAt(x, z - e) - field.heightAt(x, z + e);
  const ny = 2 * e;
  const length = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / length, y: ny / length, z: nz / length };
}

/**
 * The island-wide colouring inputs every chunk shares.
 *
 * All of this runs over the whole sample grid and none of it depends on which
 * chunk is being built, so it is computed once in bounded bands and then read
 * by sixty-four much smaller jobs. Folding it into the first chunk instead
 * would make that chunk many times the cost of the others, which is exactly the
 * uneven job the stall budget forbids.
 */
export interface TerrainColouring {
  readonly familyWeights: Float32Array;
  /** Interleaved dry rgb + rich rgb, per sample, blurred across borders. */
  readonly groundRamp: Float32Array;
  readonly rockFromDegrees: Float32Array;
  readonly moistureRange: Float32Array;
  readonly safeRouteHalfWidth: number;
}

/**
 * Family weights, region ground ramp, rock threshold and moisture bounds,
 * blurred together in one banded pass.
 *
 * Blurring the region material alongside the family weights is the point: all
 * of it is one-hot per region and all of it would otherwise draw a hard line
 * across the island wherever two regions meet. The mask itself is untouched -
 * collision, safety and audio still ask which region they are in and still get
 * one crisp answer.
 */
export function beginTerrainColouring(field: IslandField): {
  readonly bandCount: number;
  sweepBand(band: number): void;
  finish(): TerrainColouring;
} {
  const size = field.gridSize;
  const manifest = field.manifest;
  const familyByRegionIndex = field.regionIds.map((id) => terrainFamilyFor(manifest, id));
  const styleByRegionIndex = field.regionIds.map((id) => regionStyleFor(id));
  const moistureByRegionIndex = field.regionIds.map((id) => {
    const region = manifest.regions.find((candidate) => candidate.id === id);
    return region?.moisture ?? ([0.15, 0.85] as const);
  });

  const packed = new Float32Array(size * size * COLOURING_CHANNELS);
  for (let index = 0; index < size * size; index += 1) {
    const regionIndex = field.regionIndex[index] ?? 0;
    const family = familyByRegionIndex[regionIndex] ?? "grassland";
    const style = styleByRegionIndex[regionIndex] ?? regionStyleFor("");
    const moisture = moistureByRegionIndex[regionIndex] ?? ([0.15, 0.85] as const);
    const base = index * COLOURING_CHANNELS;
    packed[base + FAMILY_ORDER.indexOf(family)] = 1;
    for (let channel = 0; channel < 3; channel += 1) {
      packed[base + GROUND_OFFSET + channel] = style.dry[channel] ?? 0.5;
      packed[base + GROUND_OFFSET + 3 + channel] = style.rich[channel] ?? 0.4;
    }
    packed[base + ROCK_OFFSET] = style.rockFromDegrees;
    packed[base + MOISTURE_OFFSET] = moisture[0];
    packed[base + MOISTURE_OFFSET + 1] = moisture[1];
  }

  const blur = beginChannelBlur(packed, COLOURING_CHANNELS, size);

  return {
    bandCount: blur.bandCount,
    sweepBand: (band) => blur.sweepBand(band),
    finish() {
      const blurred = blur.finish();
      const familyWeights = new Float32Array(size * size * FAMILY_CHANNELS);
      const groundRamp = new Float32Array(size * size * GROUND_CHANNELS);
      const rockFromDegrees = new Float32Array(size * size);
      const moistureRange = new Float32Array(size * size * MOISTURE_CHANNELS);
      for (let index = 0; index < size * size; index += 1) {
        const base = index * COLOURING_CHANNELS;
        for (let channel = 0; channel < FAMILY_CHANNELS; channel += 1) {
          familyWeights[index * FAMILY_CHANNELS + channel] = blurred[base + channel] ?? 0;
        }
        for (let channel = 0; channel < GROUND_CHANNELS; channel += 1) {
          groundRamp[index * GROUND_CHANNELS + channel] =
            blurred[base + GROUND_OFFSET + channel] ?? 0.5;
        }
        rockFromDegrees[index] = blurred[base + ROCK_OFFSET] ?? 22;
        moistureRange[index * MOISTURE_CHANNELS] = blurred[base + MOISTURE_OFFSET] ?? 0.15;
        moistureRange[index * MOISTURE_CHANNELS + 1] = blurred[base + MOISTURE_OFFSET + 1] ?? 0.85;
      }
      return {
        familyWeights,
        groundRamp,
        rockFromDegrees,
        moistureRange,
        // Route half-width, so the worn tint matches the corridor the compiler
        // actually graded into the terrain instead of a width chosen by eye.
        safeRouteHalfWidth: Math.max(
          3,
          ...manifest.routes
            .filter((route) => route.kind === "safe")
            .map((route) => route.widthMeters * 0.5),
        ),
      };
    },
  };
}

export function prepareTerrainColouring(field: IslandField): TerrainColouring {
  const build = beginTerrainColouring(field);
  for (let band = 0; band < build.bandCount; band += 1) build.sweepBand(band);
  return build.finish();
}

export function buildIslandChunkMeshes(
  field: IslandField,
  topologyFor: (chunkId: string) => TerrainChunkTopology,
): readonly IslandChunkMesh[] {
  const colouring = prepareTerrainColouring(field);
  return field.manifest.chunks.map((_, index) =>
    buildIslandChunkMesh(field, colouring, index, topologyFor),
  );
}

/** One chunk's derived attributes. Sized to be one bounded preparation job. */
export function buildIslandChunkMesh(
  field: IslandField,
  colouring: TerrainColouring,
  chunkIndex: number,
  topologyFor: (chunkId: string) => TerrainChunkTopology,
): IslandChunkMesh {
  const { manifest } = field;
  const cellsPerChunk = manifest.island.terrainSamplesPerEdge - 1;
  const samples = manifest.island.terrainSamplesPerEdge;
  const { familyWeights, groundRamp, rockFromDegrees, moistureRange, safeRouteHalfWidth } =
    colouring;

  const scratch = new Color();
  const target = new Color();
  const dry = new Color();
  const rich = new Color();

  const chunk = manifest.chunks[chunkIndex];
  if (!chunk) throw new Error(`No compiled chunk at index ${chunkIndex}`);

  const topology = topologyFor(chunk.id);
  const vertexCount = samples * samples;
  if (topology.positions.length !== vertexCount * 3) {
    throw new Error(
      `Topology for ${chunk.id} has ${topology.positions.length} position floats, expected ${vertexCount * 3}`,
    );
  }
  // Derived attributes only. Positions and indices come from the repository.
  const normals = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);

  const baseX = chunk.chunkX * cellsPerChunk;
  const baseZ = chunk.chunkZ * cellsPerChunk;

  for (let sampleZ = 0; sampleZ < samples; sampleZ += 1) {
    for (let sampleX = 0; sampleX < samples; sampleX += 1) {
      const local = sampleZ * samples + sampleX;
      const globalX = Math.min(field.gridSize - 1, baseX + sampleX);
      const globalZ = Math.min(field.gridSize - 1, baseZ + sampleZ);
      const global = globalZ * field.gridSize + globalX;

      // Read the vertex position back out of the canonical topology rather
      // than recomputing it, so the colouring and the normals are keyed to the
      // exact ground the collider uses.
      const x = topology.positions[local * 3] ?? 0;
      const height = topology.positions[local * 3 + 1] ?? 0;
      const z = topology.positions[local * 3 + 2] ?? 0;

      const normal = fieldNormal(field, x, z);
      normals[local * 3] = normal.x;
      normals[local * 3 + 1] = normal.y;
      normals[local * 3 + 2] = normal.z;

      // --- colour ------------------------------------------------------
      const moisture = field.moisture[global] ?? 0.5;
      const slope = field.slopeDegrees[global] ?? 0;

      // 1. Base: this region's own ground ramp, walked by how wet it is here.
      //
      //    The ramp is per region rather than per family, because five regions
      //    share three families and a family palette makes two pairs of them
      //    the same place. Both ends are already blurred across region borders,
      //    so country changes gradually rather than at a mask edge.
      const rampBase = global * 6;
      dry.setRGB(
        groundRamp[rampBase] ?? 0.5,
        groundRamp[rampBase + 1] ?? 0.5,
        groundRamp[rampBase + 2] ?? 0.4,
      );
      rich.setRGB(
        groundRamp[rampBase + 3] ?? 0.35,
        groundRamp[rampBase + 4] ?? 0.45,
        groundRamp[rampBase + 5] ?? 0.25,
      );
      const moistureLow = moistureRange[global * 2] ?? 0.15;
      const moistureHigh = moistureRange[global * 2 + 1] ?? 0.85;
      target.copy(dry).lerp(
        rich,
        smoothstep(moistureLow, Math.max(moistureLow + 0.05, moistureHigh), moisture),
      );

      // 2. Dapple and hollow, both short so they read as ground rather than
      //    as weather lying on it.
      const relief = Math.max(-0.055, Math.min(0.055, hollow(field, x, z) * 0.07));
      target.offsetHSL(0, 0, dapple(x, z) * 0.085 + relief);

      // 3. Shore. Two signals, because either alone gets it wrong.
      //
      //    Height alone only paints ground actually at the waterline, and the
      //    compiled coast sits seven metres up behind a short drop, so the
      //    beach collapsed into a couple of invisible metres. Distance inland
      //    of the compiler's own design shoreline is the signal that makes a
      //    beach a beach, and the manifest carries it per sample. It reaches
      //    much further into a coastal region than anywhere else: a forest
      //    that happens to end at the sea gets a strand, not a dune field.
      const aboveSea = height - field.seaLevel;
      const shore = field.shoreDistance[global] ?? 100;
      const coastalWeight = familyWeights[global * 3] ?? 0;
      const beach = Math.max(
        1 - smoothstep(0.4, 4.5, aboveSea),
        (1 - smoothstep(4, 18 + 48 * coastalWeight, shore)) * (0.3 + 0.7 * coastalWeight),
      );
      if (beach > 0) {
        scratch
          .copy(PALETTE.sandWet)
          .lerp(PALETTE.sandDry, smoothstep(0, 3.2, aboveSea) * smoothstep(0, 9, shore));
        target.lerp(scratch, beach);
      }

      // 4. Slope. Rock is darker than every ground family on purpose: steep
      //    ground must read as "not for hooves" before the player tests it.
      //    The ramp is centred on the controller's own 28-degree climb limit.
      //    The threshold is the region's own: basalt breaks through a shallow
      //    fold on the crown, where a grass bank on the plain stays grass.
      const rockStart = rockFromDegrees[global] ?? 22;
      const rock = smoothstep(rockStart, rockStart + 11, slope);
      if (rock > 0) {
        scratch
          .copy(PALETTE.rockLight)
          .lerp(PALETTE.rockDark, smoothstep(rockStart + 7, rockStart + 19, slope));
        target.lerp(scratch, rock);
      }

      // 5. The worn line last, so it survives whatever it crosses. Applied
      //    only where the ground is walkable, so a safe route does not paint
      //    a path up a cliff it never actually climbs.
      //
      //    Deliberately much narrower than the corridor the compiler grades,
      //    and wandering: tinting the whole graded top made a route read as a
      //    poured causeway with square edges. A trail that covers half the
      //    flat ground and wanders inside it leaves grass on both shoulders,
      //    which is what tells the eye this is a worn line through a place
      //    rather than a built structure standing on it.
      const routeDistance = field.routeDistance[global] ?? ROUTE_DISTANCE_CAP;
      const wander = dapple(x * 0.55, z * 0.55) * 1.25;
      const trailInner = Math.max(0.5, safeRouteHalfWidth * 0.2 + wander);
      const worn = (1 - smoothstep(trailInner, trailInner + safeRouteHalfWidth * 0.55, routeDistance)) *
        (1 - rock) *
        (1 - beach);
      if (worn > 0) target.lerp(WORN_PATH, worn * 0.58);

      colors[local * 3] = target.r;
      colors[local * 3 + 1] = target.g;
      colors[local * 3 + 2] = target.b;
    }
  }

  return {
    chunkId: chunk.id,
    stableId: chunk.stableId,
    chunkX: chunk.chunkX,
    chunkZ: chunk.chunkZ,
    positions: topology.positions,
    indices: topology.indices,
    topologyFingerprint: topology.fingerprint,
    normals,
    colors,
    triangleCount: cellsPerChunk * cellsPerChunk * 2,
    centreX: chunk.originX + manifest.island.chunkSizeMeters * 0.5,
    centreZ: chunk.originZ + manifest.island.chunkSizeMeters * 0.5,
  };
}
