import { beforeAll, describe, expect, it } from "vitest";
import firstIslandJson from "../../docs/contracts/world-spec.first-island.json";
import { stepHorse } from "../../src/game/simulation/horse/horseController";
import { reinsTowards } from "../../src/game/simulation/horse/horseSteering";
import {
  createInitialHorseState,
  type HorseState,
} from "../../src/game/simulation/horse/horseState";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type {
  CompiledRoute,
  WorldManifest,
  WorldSpecV4,
} from "../../src/game/world/compiler/worldTypes";
import { IslandChunkRepository } from "../../src/game/world/runtime/islandChunkRepository";
import { traversalReadiness } from "../../src/game/world/runtime/traversalReadiness";
import { CompiledIslandWorld } from "../../src/physics/compiledIslandWorld";
import { RapierHorseMotionResolver } from "../../src/physics/rapierHorseMotionResolver";
import { initializeRapier } from "../../src/physics/rapierRuntime";

const firstIsland = firstIslandJson as unknown as WorldSpecV4;

beforeAll(async () => initializeRapier());

function createResolver(
  island: CompiledIslandWorld,
  initial: HorseState,
): RapierHorseMotionResolver {
  return new RapierHorseMotionResolver(
    island.world,
    initial.position,
    undefined,
    (position) => island.isSafeGround(position.x, position.z),
    (position, desired) => island.constrainBoundaryTranslation(position, desired),
    (position, desired, constrained, resolved) =>
      island.constrainBoundaryPosition(position, desired, constrained, resolved),
  );
}

function rideRoute(
  manifest: WorldManifest,
  repository: IslandChunkRepository,
  resolver: RapierHorseMotionResolver,
  initial: HorseState,
  route: CompiledRoute,
): HorseState {
  let state = initial;
  for (const waypoint of route.waypoints.slice(1)) {
    let reached = false;
    for (let tick = 0; tick < 720; tick += 1) {
      const dx = waypoint.x - state.position.x;
      const dz = waypoint.z - state.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance < 3) {
        reached = true;
        break;
      }
      expect(traversalReadiness(manifest, repository, state.position, {
        x: Math.sin(state.yaw) * state.speed,
        y: 0,
        z: Math.cos(state.yaw) * state.speed,
      }).missingPhysicsChunkIds).toEqual([]);
      state = stepHorse(
        state,
        reinsTowards(state, waypoint.x, waypoint.z, {
          slowWithin: 10,
          gallopBeyond: 22,
        }),
        resolver,
      ).state;
      expect(Number.isFinite(state.position.y)).toBe(true);
    }
    expect(
      reached,
      `${route.id} failed at ${waypoint.x},${waypoint.z}; ` +
        `state=${state.position.x.toFixed(2)},${state.position.y.toFixed(2)},` +
        `${state.position.z.toFixed(2)} speed=${state.speed.toFixed(2)} ` +
        `grounded=${state.grounded}`,
    ).toBe(true);
  }
  return state;
}

describe("first-island physical traversal", () => {
  it("releases staged physics retains when collision construction fails", {
    timeout: 15_000,
  }, async () => {
    const manifest = compileWorld(firstIsland);
    const repository = new IslandChunkRepository(manifest);
    repository.prepareAllSync();

    // Fails at the placements stage, which runs after every terrain chunk has
    // been built and retained, so this is the point with the most to release.
    //
    // It is named rather than numbered on purpose. This used to fail the build
    // at `collision-terrain-03`, and when the island was halved there were only
    // two terrain jobs left - so the injected failure never fired, nothing
    // threw, and a test about the failure path stopped exercising one. Stage
    // names are a contract; how many terrain chunks an island has is not.
    await expect(CompiledIslandWorld.createStaged(
      manifest,
      repository,
      async (name, work) => {
        if (name === "collision-placements") throw new Error("synthetic build failure");
        return work();
      },
    )).rejects.toThrow("synthetic build failure");

    const snapshot = repository.snapshot();
    // The invariant that matters: a failed build leaves nothing retained, so
    // the repository can be torn down or rebuilt rather than leaking chunks.
    expect(snapshot).toMatchObject({ physicsRetains: 0, renderRetains: 0 });
    expect(snapshot.cooldownChunks).toBe(snapshot.totalChunks);
    expect(snapshot.activeChunks).toBe(0);
    repository.dispose();
  });

  it("rides two coastal circuits and both safe highland approaches with all chunks active", {
    timeout: 45_000,
  }, async () => {
    const manifest = compileWorld(firstIsland);
    const repository = new IslandChunkRepository(manifest);
    repository.prepareAllSync();
    const releaseRender = repository.chunkIds().map((id) => repository.retain(id, "render"));
    const jobNames: string[] = [];
    const island = await CompiledIslandWorld.createStaged(
      manifest,
      repository,
      async (name, work) => {
        jobNames.push(name);
        return work();
      },
    );
    // The staging contract is the ORDER and the NAMES, not the count: terrain
    // first, in numbered order from zero, then placements, then the boundary,
    // then finalize. How many terrain batches that takes is a property of how
    // big the island is, and pinning it here is what left this assertion
    // describing an island twice the size of the one being compiled.
    const terrainJobs = jobNames.filter((name) => name.startsWith("collision-terrain-"));
    expect(terrainJobs.length).toBeGreaterThan(0);
    expect(terrainJobs).toEqual(
      terrainJobs.map((_, index) => `collision-terrain-${String(index).padStart(2, "0")}`),
    );
    expect(jobNames.slice(terrainJobs.length)).toEqual([
      "collision-placements",
      "collision-boundary",
      "collision-finalize",
    ]);
    repository.activateAll();

    const built = repository.snapshot();
    expect(built).toMatchObject({ mode: "full-world" });
    // Every chunk active, and retained once by each side.
    expect(built.activeChunks).toBe(built.totalChunks);
    expect(built.physicsRetains).toBe(built.totalChunks);
    expect(built.renderRetains).toBe(built.totalChunks);
    const baselineColliders = island.colliderCount();
    const coastalRoutes = manifest.routes
      .filter((route) => route.role === "coastal-loop")
      .sort((left, right) => left.id.localeCompare(right.id));
    const coastalById = new Map(coastalRoutes.map((route) => [route.id, route]));
    const circuit = [
      "saltwind-longgrass-coastal",
      "longgrass-fernwood-coastal",
      "fernwood-river-coastal",
      "river-saltwind-coastal",
    ].map((id) => coastalById.get(id));
    expect(circuit.every((route): route is CompiledRoute => route !== undefined)).toBe(true);

    const firstRoute = circuit[0];
    if (!firstRoute) throw new Error("Missing first coastal route");
    const start = firstRoute.waypoints[0];
    if (!start) throw new Error("Coastal route has no start");
    let state = createInitialHorseState({
      position: { ...start, y: start.y + 0.05 },
      yaw: 0,
    });
    const coastalResolver = createResolver(island, state);
    for (let lap = 0; lap < 2; lap += 1) {
      for (const route of circuit) {
        if (!route) throw new Error("Missing coastal route");
        state = rideRoute(manifest, repository, coastalResolver, state, route);
      }
    }
    expect(state.grounded).toBe(true);
    coastalResolver.dispose();

    const approaches = manifest.routes.filter(
      (route) => route.kind === "safe" && route.role === "regional-link",
    );
    expect(approaches.map((route) => route.id).sort()).toEqual([
      "longgrass-blackstone-ascent",
      "river-blackstone-saddle",
    ]);
    for (const route of approaches) {
      const routeStart = route.waypoints[0];
      if (!routeStart) throw new Error(`${route.id} has no start`);
      const approachState = createInitialHorseState({
        position: { ...routeStart, y: routeStart.y + 0.05 },
        yaw: 0,
      });
      const resolver = createResolver(island, approachState);
      const result = rideRoute(manifest, repository, resolver, approachState, route);
      expect(result.grounded).toBe(true);
      resolver.dispose();
    }

    expect(island.colliderCount()).toBe(baselineColliders);
    island.dispose();
    releaseRender.forEach((release) => release());
    const tornDown = repository.snapshot();
    expect(tornDown).toMatchObject({ physicsRetains: 0, renderRetains: 0 });
    // Everything the ride retained has gone back, whatever the island's size.
    expect(tornDown.cooldownChunks).toBe(tornDown.totalChunks);
    repository.dispose();
  });

});
