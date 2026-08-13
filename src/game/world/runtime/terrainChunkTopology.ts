import type { TerrainChunk } from "../compiler/worldTypes";

export interface TerrainChunkTopology {
  readonly chunkId: string;
  readonly stableId: string;
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  /** Deterministic checksum used to prove render and physics retained one topology. */
  readonly fingerprint: string;
}

/**
 * The single canonical terrain topology for one generated chunk.
 *
 * Three.js may retain these arrays in BufferAttributes and Rapier may copy them
 * into WASM, but neither subsystem is allowed to independently reconstruct the
 * mesh. That keeps diagonal choice, vertex order, and chunk seams identical.
 */
export function buildTerrainChunkTopology(chunk: TerrainChunk): TerrainChunkTopology {
  const count = chunk.samplesPerEdge;
  const positions = new Float32Array(count * count * 3);
  for (let z = 0; z < count; z += 1) {
    for (let x = 0; x < count; x += 1) {
      const sample = z * count + x;
      positions[sample * 3] = chunk.originX + x * chunk.sampleSpacingMeters;
      positions[sample * 3 + 1] = chunk.heights[sample] ?? 0;
      positions[sample * 3 + 2] = chunk.originZ + z * chunk.sampleSpacingMeters;
    }
  }

  const indices = new Uint32Array((count - 1) * (count - 1) * 6);
  let cursor = 0;
  for (let z = 0; z < count - 1; z += 1) {
    for (let x = 0; x < count - 1; x += 1) {
      const a = z * count + x;
      const b = a + 1;
      const c = a + count;
      const d = c + 1;
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  return {
    chunkId: chunk.id,
    stableId: chunk.stableId,
    positions,
    indices,
    fingerprint: topologyFingerprint(positions, indices),
  };
}

function topologyFingerprint(positions: Float32Array, indices: Uint32Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  const positionBytes = new Uint8Array(
    positions.buffer,
    positions.byteOffset,
    positions.byteLength,
  );
  const indexBytes = new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength);
  for (const bytes of [positionBytes, indexBytes]) {
    for (const byte of bytes) {
      hash ^= BigInt(byte);
      hash = (hash * prime) & mask;
    }
  }
  return `fnv1a64-${hash.toString(16).padStart(16, "0")}`;
}
