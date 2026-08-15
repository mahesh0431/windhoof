import { describe, expect, it } from "vitest";
import exampleJson from "../../docs/contracts/world-spec.example.json";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type { WorldSpec } from "../../src/game/world/compiler/worldTypes";
import { IslandChunkRepository } from "../../src/game/world/runtime/islandChunkRepository";
import { createIslandScene } from "../../src/world/islandScene";
import { createPreparationLog, type PreparationLog } from "../../src/app/preparationLog";

/**
 * Render/physics resource lifecycle for the compiled island.
 *
 * These run without a WebGL context on purpose. Everything being asserted is
 * about which objects the scene borrows and whether it gives them back, and none
 * of that needs a GPU — which means it can be checked on every commit rather
 * than only in the browser suite.
 */

const manifest = compileWorld(exampleJson as unknown as WorldSpec);

function preparedRepository(): IslandChunkRepository {
  const repository = new IslandChunkRepository(manifest);
  repository.prepareAllSync();
  return repository;
}

function sceneOn(repository: IslandChunkRepository, log?: PreparationLog) {
  return createIslandScene(manifest, {
    topology: (chunkId) => repository.topology(chunkId),
    retainRenderChunk: (chunkId) => repository.retain(chunkId, "render"),
    // Node has no frame to yield to, so a job here is only its timing.
    job: async (name, work) => (log ? log.run(name, work) : work()),
  });
}

describe("island scene resource lifecycle", () => {
  it("draws the exact canonical topology objects, never a rebuilt copy", async () => {
    const repository = preparedRepository();
    const scene = await sceneOn(repository);

    expect(scene.chunkMeshes).toHaveLength(manifest.chunks.length);
    for (const mesh of scene.chunkMeshes) {
      const topology = repository.topology(mesh.chunkId);
      // Object identity, not deep equality. An independently rebuilt buffer with
      // identical values would pass a value comparison and still be exactly the
      // second representation this contract exists to forbid.
      expect(mesh.positions).toBe(topology.positions);
      expect(mesh.indices).toBe(topology.indices);
      expect(mesh.topologyFingerprint).toBe(topology.fingerprint);
    }

    scene.dispose();
    repository.dispose();
  });

  it("takes exactly one render retain per chunk and returns all of them", async () => {
    const repository = preparedRepository();
    expect(repository.snapshot().renderRetains).toBe(0);

    const scene = await sceneOn(repository);
    const held = repository.snapshot();
    expect(scene.renderRetainCount).toBe(manifest.chunks.length);
    expect(held.renderRetains).toBe(manifest.chunks.length);
    expect(held.renderReadyChunks).toBe(manifest.chunks.length);

    scene.dispose();
    const released = repository.snapshot();
    expect(released.renderRetains).toBe(0);
    expect(released.renderReadyChunks).toBe(0);

    // Disposing twice must not double-release; the repository would throw on a
    // negative retain count, so this asserts idempotence rather than politeness.
    expect(() => scene.dispose()).not.toThrow();
    expect(repository.snapshot().renderRetains).toBe(0);
    repository.dispose();
  });

  it("lets the repository dispose cleanly only after the scene has released", async () => {
    const repository = preparedRepository();
    const scene = await sceneOn(repository);

    // The repository refuses to dispose while anything still holds a chunk,
    // which is what makes the app's disposal ordering enforceable.
    expect(() => repository.dispose()).toThrow(/disposed while retained/);

    scene.dispose();
    expect(() => repository.dispose()).not.toThrow();
  });

  it("survives repeated construct and dispose without accumulating retains", async () => {
    const repository = preparedRepository();
    for (let round = 0; round < 3; round += 1) {
      const scene = await sceneOn(repository);
      expect(repository.snapshot().renderRetains).toBe(manifest.chunks.length);
      scene.dispose();
      expect(repository.snapshot().renderRetains).toBe(0);
    }
    repository.dispose();
  });
});

describe("chunk preparation jobs", () => {
  it("prepares one bounded job per chunk with a yield between each", async () => {
    const repository = new IslandChunkRepository(manifest);
    let yields = 0;
    await repository.prepareAll({
      yieldBetweenChunks: async () => {
        yields += 1;
      },
    });

    const snapshot = repository.snapshot();
    expect(snapshot.preparedChunks).toBe(snapshot.totalChunks);
    expect(snapshot.requestedChunks).toBe(0);
    // One yield between chunks, so sixteen chunks means fifteen handovers. A
    // single burst would report zero and is the failure being guarded against.
    expect(yields).toBe(snapshot.totalChunks - 1);

    // No single job may be allowed to become the whole island. The bound is
    // generous against a loaded machine but far under the point at which one
    // chunk would visibly stall the loading presentation.
    expect(snapshot.longestPreparationMilliseconds).toBeLessThan(250);
    repository.dispose();
  });

  it("realizes the scene as named jobs, none of which is the whole island", async () => {
    const repository = preparedRepository();
    const log = createPreparationLog();
    const scene = await sceneOn(repository, log);

    const names = log.jobs().map((job) => job.name);
    // The two halves of the global field, the shared colouring prepass, one job
    // per chunk, the cover sweep in bands, the scenes, and the props. Naming
    // them is what makes a regression point at a job rather than at "startup".
    expect(names).toContain("field-samples");
    // The route sweep and the colouring blurs are handed back in bands sized
    // from the sample grid, so the count is a property of the island rather
    // than a constant: asserting a fixed number here would fail on any island
    // that is not this one, which is the opposite of what this guards.
    expect(names.filter((name) => name.startsWith("field-route-distance-")).length)
      .toBeGreaterThan(0);
    expect(names.filter((name) => name.startsWith("terrain-colouring-")).length)
      .toBeGreaterThan(0);
    for (const chunk of manifest.chunks) expect(names).toContain(`terrain-chunk-${chunk.id}`);
    expect(names.filter((name) => name.startsWith("ground-cover-sweep-"))).toHaveLength(4);
    expect(names).toContain("placements");
    expect(names).toContain("journey-markers");
    expect(names).toContain("region-landmarks");
    expect(names).toContain("sea");

    // The gate itself, measured here on native V8 rather than through a browser
    // trace. This is the floor: the Chromium check re-measures the same jobs in
    // the real build, where they are slower.
    const snapshot = log.snapshot();
    expect(snapshot.jobCount).toBe(names.length);
    expect(snapshot.longestMilliseconds).toBeLessThan(50);

    scene.dispose();
    repository.dispose();
  });

  it("cannot activate until both render and physics retains exist", async () => {
    const repository = preparedRepository();
    expect(() => repository.activateAll()).toThrow(/cannot activate without render and physics/);

    const scene = await sceneOn(repository);
    // Render alone is still not enough; physics is the other half.
    expect(() => repository.activateAll()).toThrow(/cannot activate without render and physics/);
    expect(repository.snapshot().activeChunks).toBe(0);

    scene.dispose();
    repository.dispose();
  });
});
