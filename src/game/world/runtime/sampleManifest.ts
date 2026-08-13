import { clamp } from "../../contracts/math";
import type { TerrainChunk, WorldManifest } from "../compiler/worldTypes";

export interface ManifestSample {
  readonly height: number;
  readonly regionId: string;
  readonly moisture: number;
  readonly shoreDistanceMeters: number;
  readonly slopeDegrees: number;
  readonly traversable: boolean;
}

function chunkAt(manifest: WorldManifest, x: number, z: number): TerrainChunk {
  const half = manifest.island.sizeMeters * 0.5;
  const maximum = manifest.island.chunksPerEdge - 1;
  const chunkX = clamp(
    Math.floor((x + half) / manifest.island.chunkSizeMeters),
    0,
    maximum,
  );
  const chunkZ = clamp(
    Math.floor((z + half) / manifest.island.chunkSizeMeters),
    0,
    maximum,
  );
  const chunk = manifest.chunks.find(
    (candidate) => candidate.chunkX === chunkX && candidate.chunkZ === chunkZ,
  );
  if (!chunk) throw new Error(`Manifest has no chunk at ${chunkX},${chunkZ}`);
  return chunk;
}

function index(chunk: TerrainChunk, x: number, z: number): number {
  return z * chunk.samplesPerEdge + x;
}

export function sampleManifest(manifest: WorldManifest, x: number, z: number): ManifestSample {
  const chunk = chunkAt(manifest, x, z);
  const localX = clamp((x - chunk.originX) / chunk.sampleSpacingMeters, 0, chunk.samplesPerEdge - 1);
  const localZ = clamp((z - chunk.originZ) / chunk.sampleSpacingMeters, 0, chunk.samplesPerEdge - 1);
  const x0 = Math.floor(localX);
  const z0 = Math.floor(localZ);
  const x1 = Math.min(chunk.samplesPerEdge - 1, x0 + 1);
  const z1 = Math.min(chunk.samplesPerEdge - 1, z0 + 1);
  const tx = localX - x0;
  const tz = localZ - z0;
  const h00 = chunk.heights[index(chunk, x0, z0)];
  const h10 = chunk.heights[index(chunk, x1, z0)];
  const h01 = chunk.heights[index(chunk, x0, z1)];
  const h11 = chunk.heights[index(chunk, x1, z1)];
  if ([h00, h10, h01, h11].some((height) => height === undefined)) {
    throw new Error(`Manifest sample missing at ${x},${z}`);
  }
  const top = (h00 ?? 0) + ((h10 ?? 0) - (h00 ?? 0)) * tx;
  const bottom = (h01 ?? 0) + ((h11 ?? 0) - (h01 ?? 0)) * tx;
  const nearestX = Math.round(localX);
  const nearestZ = Math.round(localZ);
  const nearest = index(chunk, nearestX, nearestZ);
  const regionId = chunk.regionMask[nearest];
  const moisture = chunk.moisture[nearest];
  const shoreDistanceMeters = chunk.shoreDistanceMeters[nearest];
  const slopeDegrees = chunk.slopeDegrees[nearest];
  const traversable = chunk.traversable[nearest];
  if (
    regionId === undefined ||
    moisture === undefined ||
    shoreDistanceMeters === undefined ||
    slopeDegrees === undefined ||
    traversable === undefined
  ) {
    throw new Error(`Manifest semantic sample missing at ${x},${z}`);
  }
  return {
    height: top + (bottom - top) * tz,
    regionId,
    moisture,
    shoreDistanceMeters,
    slopeDegrees,
    traversable,
  };
}

