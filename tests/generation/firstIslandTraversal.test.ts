import { beforeAll, describe, expect, it } from "vitest";
import firstIslandJson from "../../docs/contracts/world-spec.first-island.json";
import { NEUTRAL_HORSE_INPUT } from "../../src/game/contracts/input";
import { stepHorse } from "../../src/game/simulation/horse/horseController";
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
      state = stepHorse(state, {
        ...NEUTRAL_HORSE_INPUT,
        moveY: distance < 10 && state.speed > 7 ? -1 : 1,
        cameraYaw: Math.atan2(dx, dz),
        gallopHeld: distance > 22,
      }, resolver).state;
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

    await expect(CompiledIslandWorld.createStaged(
      manifest,
      repository,
      async (name, work) => {
        if (name === "collision-terrain-03") throw new Error("synthetic build failure");
        return work();
      },
    )).rejects.toThrow("synthetic build failure");

    expect(repository.snapshot()).toMatchObject({
      physicsRetains: 0,
      renderRetains: 0,
      cooldownChunks: 24,
      preparedChunks: 40,
    });
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
    expect(jobNames).toEqual([
      "collision-terrain-00",
      "collision-terrain-01",
      "collision-terrain-02",
      "collision-terrain-03",
      "collision-terrain-04",
      "collision-terrain-05",
      "collision-terrain-06",
      "collision-terrain-07",
      "collision-placements",
      "collision-boundary",
      "collision-finalize",
    ]);
    repository.activateAll();

    expect(repository.snapshot()).toMatchObject({
      mode: "full-world",
      totalChunks: 64,
      activeChunks: 64,
      physicsRetains: 64,
      renderRetains: 64,
    });
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
    expect(repository.snapshot()).toMatchObject({
      physicsRetains: 0,
      renderRetains: 0,
      cooldownChunks: 64,
    });
    repository.dispose();
  });

});
