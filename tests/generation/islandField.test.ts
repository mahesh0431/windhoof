import { describe, expect, it } from "vitest";
import exampleJson from "../../docs/contracts/world-spec.example.json";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type { WorldSpec } from "../../src/game/world/compiler/worldTypes";
import { buildIslandField } from "../../src/world/islandField";
import { buildIslandChunkMeshes } from "../../src/world/islandTerrainMesh";
import { IslandChunkRepository } from "../../src/game/world/runtime/islandChunkRepository";

describe("compiled island presentation seam", () => {
  it("reassembles chunks without changing manifest samples or shared normals", () => {
    const manifest = compileWorld(exampleJson as unknown as WorldSpec);
    const field = buildIslandField(manifest);
    const repository = new IslandChunkRepository(manifest);
    repository.prepareAllSync();
    const meshes = buildIslandChunkMeshes(field, (chunkId) => repository.topology(chunkId));
    expect(meshes).toHaveLength(manifest.chunks.length);

    for (const chunk of manifest.chunks) {
      const mesh = meshes.find((candidate) => candidate.chunkId === chunk.id);
      expect(mesh).toBeDefined();
      for (let sample = 0; sample < chunk.heights.length; sample += 257) {
        expect(mesh?.positions[sample * 3 + 1]).toBeCloseTo(chunk.heights[sample] ?? 0, 5);
      }
    }

    const west = meshes.find((mesh) => mesh.chunkX === 0 && mesh.chunkZ === 0);
    const east = meshes.find((mesh) => mesh.chunkX === 1 && mesh.chunkZ === 0);
    expect(west).toBeDefined();
    expect(east).toBeDefined();
    const samples = manifest.island.terrainSamplesPerEdge;
    for (let row = 0; row < samples; row += 1) {
      const westIndex = (row * samples + samples - 1) * 3;
      const eastIndex = row * samples * 3;
      expect(west?.positions[westIndex + 1]).toBe(east?.positions[eastIndex + 1]);
      expect(west?.normals.slice(westIndex, westIndex + 3)).toEqual(
        east?.normals.slice(eastIndex, eastIndex + 3),
      );
    }
  });
});
