import type { Vec3 } from "../../contracts/math";
import type { WorldManifest } from "../compiler/worldTypes";
import type { IslandChunkRepository } from "./islandChunkRepository";

export interface TraversalReadiness {
  readonly ready: boolean;
  readonly predictedChunkIds: readonly string[];
  readonly missingPhysicsChunkIds: readonly string[];
}

const LOOK_AHEAD_SECONDS = 3;
const SAFETY_RING_CHUNKS = 1;

/**
 * Predicts the physics footprint reachable at the current horizontal velocity.
 * Milestone 3 keeps the entire slice resident, so a missing result is a hard
 * invariant failure and input is held before the horse can reach a hole.
 */
export function traversalReadiness(
  manifest: WorldManifest,
  repository: IslandChunkRepository,
  position: Vec3,
  velocity: Vec3,
): TraversalReadiness {
  const chunkSize = manifest.island.chunkSizeMeters;
  const half = manifest.island.sizeMeters * 0.5;
  const distance = Math.hypot(velocity.x, velocity.z) * LOOK_AHEAD_SECONDS;
  const steps = Math.max(1, Math.ceil(distance / (chunkSize * 0.5)));
  const ids = new Set<string>();

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = position.x + velocity.x * LOOK_AHEAD_SECONDS * t;
    const z = position.z + velocity.z * LOOK_AHEAD_SECONDS * t;
    const centreX = Math.floor((x + half) / chunkSize);
    const centreZ = Math.floor((z + half) / chunkSize);
    for (let dz = -SAFETY_RING_CHUNKS; dz <= SAFETY_RING_CHUNKS; dz += 1) {
      for (let dx = -SAFETY_RING_CHUNKS; dx <= SAFETY_RING_CHUNKS; dx += 1) {
        const chunk = repository.chunkAt(centreX + dx, centreZ + dz);
        if (chunk) ids.add(chunk.id);
      }
    }
  }

  const predictedChunkIds = [...ids].sort();
  const missingPhysicsChunkIds = predictedChunkIds.filter(
    (chunkId) => !repository.isPhysicsReady(chunkId),
  );
  return {
    ready: missingPhysicsChunkIds.length === 0,
    predictedChunkIds,
    missingPhysicsChunkIds,
  };
}
