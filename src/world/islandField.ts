import type { WorldManifest } from "../game/world/compiler/worldTypes";

/**
 * The manifest's chunked terrain, reassembled into one global sample grid.
 *
 * This exists for building geometry, and for nothing else. Runtime questions -
 * how high is the ground here, what surface is it, is it safe to respawn on -
 * are answered by `CompiledIslandWorld` and `sampleManifest`, which the world
 * runtime owns. Duplicating those here would give the renderer a second opinion
 * about the world, which is exactly the drift the single-vertex-buffer rule
 * exists to prevent.
 *
 * What it does add is the one thing a mesh needs and a point sampler cannot
 * give cheaply: continuity across chunk seams. Vertex normals computed per
 * chunk crease visibly at the borders, so they are computed against the whole
 * island instead. Chunk borders are duplicated in the manifest and verified
 * equal by the generation suite, so writing them twice into one cell is a no-op.
 */
export interface IslandField {
  readonly manifest: WorldManifest;
  readonly sizeMeters: number;
  readonly halfMeters: number;
  readonly seaLevel: number;
  readonly spacing: number;
  /** Samples per edge across the whole island, not per chunk. */
  readonly gridSize: number;
  readonly heights: Float32Array;
  readonly slopeDegrees: Float32Array;
  readonly moisture: Float32Array;
  /** Metres inland of the compiler's design shoreline; negative out to sea. */
  readonly shoreDistance: Float32Array;
  readonly traversable: Uint8Array;
  /** Index into `regionIds`, one per sample. */
  readonly regionIndex: Uint8Array;
  readonly regionIds: readonly string[];
  /**
   * Metres from the nearest mandatory safe-route centreline, capped at
   * `ROUTE_DISTANCE_CAP`. Drives the worn-path tint.
   */
  readonly routeDistance: Float32Array;

  /** Build-time bilinear read, used for vertex normals. */
  heightAt(x: number, z: number): number;
}

export const ROUTE_DISTANCE_CAP = 24;

/**
 * The field without its route distances, which is the expensive half.
 *
 * Reassembling the samples and sweeping every sample against every safe-route
 * segment are two unrelated pieces of work that happen to end up in the same
 * structure, and together they are one main-thread block big enough to matter at
 * startup. Keeping them separately callable lets the app run them as two bounded
 * jobs with a frame in between; `buildIslandField` still composes them for every
 * caller that does not care.
 */
export interface IslandSamples {
  readonly manifest: WorldManifest;
  readonly sizeMeters: number;
  readonly halfMeters: number;
  readonly spacing: number;
  readonly gridSize: number;
  readonly heights: Float32Array;
  readonly slopeDegrees: Float32Array;
  readonly moisture: Float32Array;
  readonly shoreDistance: Float32Array;
  readonly traversable: Uint8Array;
  readonly regionIndex: Uint8Array;
  readonly regionIds: readonly string[];
}

export function buildIslandField(manifest: WorldManifest): IslandField {
  const samples = buildIslandSamples(manifest);
  return assembleIslandField(samples, buildRouteDistanceField(samples));
}

export function buildIslandSamples(manifest: WorldManifest): IslandSamples {
  const sizeMeters = manifest.island.sizeMeters;
  const halfMeters = sizeMeters * 0.5;
  const spacing = manifest.island.chunkSizeMeters /
    (manifest.island.terrainSamplesPerEdge - 1);
  const cellsPerChunk = manifest.island.terrainSamplesPerEdge - 1;
  const gridSize = manifest.island.chunksPerEdge * cellsPerChunk + 1;
  const total = gridSize * gridSize;

  const heights = new Float32Array(total);
  const slopeDegrees = new Float32Array(total);
  const moisture = new Float32Array(total);
  const shoreDistance = new Float32Array(total);
  const traversable = new Uint8Array(total);
  const regionIndex = new Uint8Array(total);
  const regionIds = manifest.regions.map((region) => region.id);
  const regionLookup = new Map(regionIds.map((id, index) => [id, index]));

  for (const chunk of manifest.chunks) {
    const baseX = chunk.chunkX * cellsPerChunk;
    const baseZ = chunk.chunkZ * cellsPerChunk;
    for (let sampleZ = 0; sampleZ < chunk.samplesPerEdge; sampleZ += 1) {
      for (let sampleX = 0; sampleX < chunk.samplesPerEdge; sampleX += 1) {
        const globalX = baseX + sampleX;
        const globalZ = baseZ + sampleZ;
        if (globalX >= gridSize || globalZ >= gridSize) continue;
        const source = sampleZ * chunk.samplesPerEdge + sampleX;
        const targetIndex = globalZ * gridSize + globalX;
        heights[targetIndex] = chunk.heights[source] ?? 0;
        slopeDegrees[targetIndex] = chunk.slopeDegrees[source] ?? 0;
        moisture[targetIndex] = chunk.moisture[source] ?? 0;
        shoreDistance[targetIndex] = chunk.shoreDistanceMeters[source] ?? 0;
        traversable[targetIndex] = chunk.traversable[source] ? 1 : 0;
        regionIndex[targetIndex] = regionLookup.get(chunk.regionMask[source] ?? "") ?? 0;
      }
    }
  }

  return {
    manifest,
    sizeMeters,
    halfMeters,
    spacing,
    gridSize,
    heights,
    slopeDegrees,
    moisture,
    shoreDistance,
    traversable,
    regionIndex,
    regionIds,
  };
}

export function assembleIslandField(
  samples: IslandSamples,
  routeDistance: Float32Array,
): IslandField {
  const { manifest, halfMeters, spacing, gridSize, heights } = samples;

  const clampIndex = (gx: number, gz: number): number => {
    const cx = gx < 0 ? 0 : gx > gridSize - 1 ? gridSize - 1 : gx;
    const cz = gz < 0 ? 0 : gz > gridSize - 1 ? gridSize - 1 : gz;
    return cz * gridSize + cx;
  };

  return {
    manifest,
    sizeMeters: samples.sizeMeters,
    halfMeters,
    seaLevel: manifest.island.seaLevelMeters,
    spacing,
    gridSize,
    heights,
    slopeDegrees: samples.slopeDegrees,
    moisture: samples.moisture,
    shoreDistance: samples.shoreDistance,
    traversable: samples.traversable,
    regionIndex: samples.regionIndex,
    regionIds: samples.regionIds,
    routeDistance,

    heightAt(x, z) {
      const fx = (x + halfMeters) / spacing;
      const fz = (z + halfMeters) / spacing;
      const x0 = Math.floor(fx);
      const z0 = Math.floor(fz);
      const tx = fx - x0;
      const tz = fz - z0;
      const a = heights[clampIndex(x0, z0)] ?? 0;
      const b = heights[clampIndex(x0 + 1, z0)] ?? 0;
      const c = heights[clampIndex(x0, z0 + 1)] ?? 0;
      const d = heights[clampIndex(x0 + 1, z0 + 1)] ?? 0;
      const top = a + (b - a) * tx;
      const bottom = c + (d - c) * tx;
      return top + (bottom - top) * tz;
    },
  };
}

/**
 * Distance from every sample to the nearest mandatory safe route.
 *
 * Only safe routes count. The expressive route is the line a confident rider
 * chooses, not one the herd has already worn in, so tinting it as a path would
 * give away the shortcut the world bible wants players to find for themselves.
 */
export function buildRouteDistanceField(samples: IslandSamples): Float32Array {
  const build = beginRouteDistanceField(samples);
  for (let band = 0; band < build.bandCount; band += 1) build.sweepBand(band);
  return build.finish();
}

/**
 * The route-distance sweep, in bounded horizontal strips.
 *
 * Cost is samples times route segments, and both grow with the island: on the
 * 1,024-metre plan this is a 513 by 513 grid against every segment of six safe
 * routes, which as one job took over half a second on the main thread. That is
 * ten times the milestone's stall ceiling, and the ceiling is a gate rather
 * than a target, so the work is handed back in strips the caller can yield
 * between. The band count is derived from the grid so a bigger island buys more
 * strips rather than longer ones.
 */
export function beginRouteDistanceField(samples: IslandSamples): {
  readonly bandCount: number;
  sweepBand(band: number): void;
  finish(): Float32Array;
} {
  const { manifest, gridSize, spacing, halfMeters } = samples;
  const distances = new Float32Array(gridSize * gridSize).fill(ROUTE_DISTANCE_CAP);
  const segments: Array<{
    ax: number;
    az: number;
    dx: number;
    dz: number;
    lengthSquared: number;
  }> = [];

  for (const route of manifest.routes) {
    if (route.kind !== "safe") continue;
    for (let index = 1; index < route.waypoints.length; index += 1) {
      const from = route.waypoints[index - 1];
      const to = route.waypoints[index];
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared < 1e-6) continue;
      segments.push({ ax: from.x, az: from.z, dx, dz, lengthSquared });
    }
  }

  // Roughly sixteen thousand sample-rows of work per band on any island size.
  const bandCount = segments.length === 0
    ? 1
    : Math.max(1, Math.round((gridSize * gridSize * segments.length) / 900_000));

  return {
    bandCount,
    sweepBand(band) {
      if (segments.length === 0) return;
      const fromZ = Math.floor((band * gridSize) / bandCount);
      const toZ = Math.floor(((band + 1) * gridSize) / bandCount);
      for (let gz = fromZ; gz < toZ; gz += 1) {
        const z = -halfMeters + gz * spacing;
        for (let gx = 0; gx < gridSize; gx += 1) {
          const x = -halfMeters + gx * spacing;
          let best = ROUTE_DISTANCE_CAP;
          for (const segment of segments) {
            const t = Math.max(
              0,
              Math.min(
                1,
                ((x - segment.ax) * segment.dx + (z - segment.az) * segment.dz) /
                  segment.lengthSquared,
              ),
            );
            const px = segment.ax + segment.dx * t;
            const pz = segment.az + segment.dz * t;
            const distance = Math.hypot(x - px, z - pz);
            if (distance < best) best = distance;
          }
          distances[gz * gridSize + gx] = best;
        }
      }
    },
    finish: () => distances,
  };
}
