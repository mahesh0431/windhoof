import { describe, expect, it } from "vitest";
import exampleJson from "../../docs/contracts/world-spec.example.json";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type { WorldManifest, WorldSpec } from "../../src/game/world/compiler/worldTypes";
import { IslandChunkRepository } from "../../src/game/world/runtime/islandChunkRepository";
import { traversalReadiness } from "../../src/game/world/runtime/traversalReadiness";
import { CompiledIslandWorld } from "../../src/physics/compiledIslandWorld";
import { initializeRapier } from "../../src/physics/rapierRuntime";

const manifest = compileWorld(exampleJson as unknown as WorldSpec);

async function fullyRetained(repository: IslandChunkRepository): Promise<Array<() => void>> {
  await repository.prepareAll();
  const releases: Array<() => void> = [];
  for (const chunkId of repository.chunkIds()) {
    releases.push(repository.retain(chunkId, "physics"));
    releases.push(repository.retain(chunkId, "render"));
  }
  repository.activateAll();
  return releases;
}

describe("full-world island chunk repository", () => {
  it("orders shuffled manifests canonically and prepares one stable topology per chunk", async () => {
    const shuffled = {
      ...manifest,
      chunks: [...manifest.chunks].reverse(),
    } as WorldManifest;
    const repository = new IslandChunkRepository(shuffled);
    let clock = 0;
    let yields = 0;
    await repository.prepareAll({
      now: () => (clock += 0.25),
      yieldBetweenChunks: async () => {
        yields += 1;
      },
    });

    expect(repository.chunkIds()).toEqual(manifest.chunks.map((chunk) => chunk.id));
    expect(yields).toBe(manifest.chunks.length - 1);
    expect(new Set(repository.chunkIds().map((id) => repository.topology(id).fingerprint)).size)
      .toBe(manifest.chunks.length);
    expect(repository.snapshot()).toMatchObject({
      totalChunks: 16,
      preparedChunks: 16,
      activeChunks: 0,
      longestPreparationMilliseconds: 0.25,
    });
  });

  it("requires both physics and render retains before activation", async () => {
    const repository = new IslandChunkRepository(manifest);
    await repository.prepareAll();
    const physicsReleases = repository.chunkIds().map((id) => repository.retain(id, "physics"));
    expect(() => repository.activateAll()).toThrow(/render and physics/);
    physicsReleases.forEach((release) => release());
    repository.dispose();
    expect(repository.snapshot()).toMatchObject({ disposedChunks: 16, physicsRetains: 0 });
  });

  it("gives Rapier the exact topology objects retained by the repository", async () => {
    await initializeRapier();
    const repository = new IslandChunkRepository(manifest);
    await repository.prepareAll();
    const island = new CompiledIslandWorld(manifest, repository);
    for (const chunkId of repository.chunkIds()) {
      expect(island.terrainTopology(chunkId)).toBe(repository.topology(chunkId));
    }
    expect(island.colliderCount()).toBe(
      manifest.chunks.length + manifest.placements.length + 1,
    );
    island.dispose();
    expect(repository.snapshot().physicsRetains).toBe(0);
    repository.dispose();
  });

  it("predicts a three-second gallop corridor and reports missing physics", async () => {
    const repository = new IslandChunkRepository(manifest);
    await repository.prepareAll();
    const releases = repository.chunkIds().flatMap((id) => [repository.retain(id, "physics")]);
    const ready = traversalReadiness(
      manifest,
      repository,
      manifest.spawn.position,
      { x: 0, y: 0, z: 16 },
    );
    expect(ready.predictedChunkIds.length).toBeGreaterThan(1);
    expect(ready.ready).toBe(true);

    releases[0]?.();
    const missing = traversalReadiness(
      manifest,
      repository,
      { x: -190, y: 0, z: -190 },
      { x: 0, y: 0, z: 16 },
    );
    expect(missing.ready).toBe(false);
    expect(missing.missingPhysicsChunkIds.length).toBeGreaterThan(0);
    releases.slice(1).forEach((release) => release());
    repository.dispose();
  });

  it("returns every retain and lifecycle count to zero across twenty cycles", async () => {
    for (let cycle = 0; cycle < 20; cycle += 1) {
      const repository = new IslandChunkRepository(manifest);
      const releases = await fullyRetained(repository);
      expect(repository.snapshot()).toMatchObject({
        activeChunks: 16,
        physicsRetains: 16,
        renderRetains: 16,
      });
      releases.forEach((release) => release());
      expect(repository.snapshot()).toMatchObject({
        cooldownChunks: 16,
        physicsRetains: 0,
        renderRetains: 0,
      });
      repository.dispose();
      expect(repository.snapshot().disposedChunks).toBe(16);
    }
  });
});
