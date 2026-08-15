import { beforeAll, describe, expect, it } from "vitest";
import exampleJson from "../../docs/contracts/world-spec.example.json";
import { NEUTRAL_HORSE_INPUT } from "../../src/game/contracts/input";
import { stepHorse } from "../../src/game/simulation/horse/horseController";
import { reinsTowards } from "../../src/game/simulation/horse/horseSteering";
import { createInitialHorseState } from "../../src/game/simulation/horse/horseState";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type { WorldSpec } from "../../src/game/world/compiler/worldTypes";
import { IslandChunkRepository } from "../../src/game/world/runtime/islandChunkRepository";
import { traversalReadiness } from "../../src/game/world/runtime/traversalReadiness";
import {
  CompiledIslandWorld,
  compiledIslandBoundaryRadius,
} from "../../src/physics/compiledIslandWorld";
import { RapierHorseMotionResolver } from "../../src/physics/rapierHorseMotionResolver";
import { initializeRapier } from "../../src/physics/rapierRuntime";

beforeAll(async () => initializeRapier());

describe("generated island traversal", () => {
  it("completes repeated full-gallop circuits with every predicted collider active", {
    timeout: 30_000,
  }, () => {
    const manifest = compileWorld(exampleJson as unknown as WorldSpec);
    const repository = new IslandChunkRepository(manifest);
    repository.prepareAllSync();
    const renderReleases = repository.chunkIds().map((id) => repository.retain(id, "render"));
    const island = new CompiledIslandWorld(manifest, repository);
    repository.activateAll();
    const baseline = repository.snapshot();
    let state = createInitialHorseState({
      position: { ...manifest.spawn.position, y: manifest.spawn.position.y + 0.05 },
      yaw: manifest.spawn.yaw,
    });
    const resolver = new RapierHorseMotionResolver(
      island.world,
      state.position,
      undefined,
      (position) => island.isSafeGround(position.x, position.z),
      (position, desired) => island.constrainBoundaryTranslation(position, desired),
      (position, desired, constrained, resolved) =>
        island.constrainBoundaryPosition(position, desired, constrained, resolved),
    );
    const baselineColliders = island.colliderCount();
    const route = manifest.routes.find((candidate) => candidate.kind === "safe");
    expect(route).toBeDefined();
    const safeRoutes = manifest.routes.filter((candidate) => candidate.kind === "safe");
    const coast = safeRoutes[0];
    const forest = safeRoutes[1];
    expect(coast).toBeDefined();
    expect(forest).toBeDefined();
    const coastStart = coast?.waypoints[0];
    const plain = coast?.waypoints.at(-1);
    const fernwood = forest?.waypoints.at(-1);
    expect(coastStart).toBeDefined();
    expect(plain).toBeDefined();
    expect(fernwood).toBeDefined();
    const circuitTargets = [plain, fernwood, plain, coastStart].filter(
      (waypoint): waypoint is NonNullable<typeof waypoint> => waypoint !== undefined,
    );
    let gallopTicks = 0;

    for (let circuit = 0; circuit < 5; circuit += 1) {
      for (const waypoint of circuitTargets) {
        let reached = false;
        for (let tick = 0; tick < 1_800; tick += 1) {
          const dx = waypoint.x - state.position.x;
          const dz = waypoint.z - state.position.z;
          const distance = Math.hypot(dx, dz);
          if (distance < 4) {
            reached = true;
            break;
          }
          const readiness = traversalReadiness(
            manifest,
            repository,
            state.position,
            {
              x: Math.sin(state.yaw) * state.speed,
              y: 0,
              z: Math.cos(state.yaw) * state.speed,
            },
          );
          expect(readiness.missingPhysicsChunkIds).toEqual([]);
          state = stepHorse(
            state,
            // Long endpoint-to-endpoint legs are the actual streaming test:
            // they open to full gallop, then gather before the turn instead of
            // braking at every compiler subdivision.
            reinsTowards(state, waypoint.x, waypoint.z, {
              slowWithin: 18,
              gallopBeyond: 24,
            }),
            resolver,
          ).state;
          if (state.speed > 12) gallopTicks += 1;
        }
        expect(reached, `circuit ${circuit} failed at ${waypoint.x},${waypoint.z}`).toBe(true);
      }
    }

    expect(gallopTicks).toBeGreaterThan(900);
    expect(state.grounded).toBe(true);
    expect(island.colliderCount()).toBe(baselineColliders);
    expect(repository.snapshot()).toEqual(baseline);

    resolver.dispose();
    island.dispose();
    renderReleases.forEach((release) => release());
    expect(repository.snapshot()).toMatchObject({
      physicsRetains: 0,
      renderRetains: 0,
      cooldownChunks: 16,
    });
    repository.dispose();
  });

  it("rides the Horse Lab controller along every safe route past generated obstacles", {
    timeout: 30_000,
  }, () => {
    const manifest = compileWorld(exampleJson as unknown as WorldSpec);
    const island = new CompiledIslandWorld(manifest);
    let state = createInitialHorseState({
      position: { ...manifest.spawn.position, y: manifest.spawn.position.y + 0.05 },
      yaw: manifest.spawn.yaw,
    });
    const resolver = new RapierHorseMotionResolver(
      island.world,
      state.position,
      undefined,
      (position) => island.isSafeGround(position.x, position.z),
      (position, desired) => island.constrainBoundaryTranslation(position, desired),
      (position, desired, constrained, resolved) =>
        island.constrainBoundaryPosition(position, desired, constrained, resolved),
    );

    const safeRoutes = manifest.routes.filter((route) => route.kind === "safe");
    let reachedEndpoints = 0;
    for (const route of safeRoutes) {
      for (const waypoint of route.waypoints.slice(1)) {
        let reached = false;
        // Reins take longer than the camera-absolute steering this budget was
        // written for: a horse now has to turn onto a heading rather than
        // simply being pointed at one, and it cannot turn at all at a gallop.
        // The question here is whether the ground is rideable, not how fast.
        for (let tick = 0; tick < 900; tick += 1) {
          const dx = waypoint.x - state.position.x;
          const dz = waypoint.z - state.position.z;
          if (Math.hypot(dx, dz) < 2.5) {
            reached = true;
            break;
          }
          state = stepHorse(
            state,
            reinsTowards(state, waypoint.x, waypoint.z, { slowWithin: 8 }),
            resolver,
          ).state;
          expect(Number.isFinite(state.position.y)).toBe(true);
        }
        expect(
          reached,
          `failed to reach ${route.id} waypoint ${waypoint.x},${waypoint.z}; ` +
            `state=${state.position.x.toFixed(2)},${state.position.y.toFixed(2)},` +
            `${state.position.z.toFixed(2)} speed=${state.speed.toFixed(2)} ` +
            `grounded=${state.grounded}`,
        ).toBe(
          true,
        );
      }
      reachedEndpoints += 1;
    }

    expect(reachedEndpoints).toBe(safeRoutes.length);
    expect(state.grounded).toBe(true);

    resolver.dispose();
    island.dispose();
  });

  it("stops dry at the sea boundary and resets to a genuinely safe anchor", () => {
    const manifest = compileWorld(exampleJson as unknown as WorldSpec);
    const island = new CompiledIslandWorld(manifest);
    const initial = createInitialHorseState({
      position: { ...manifest.spawn.position, y: manifest.spawn.position.y + 0.05 },
      yaw: Math.PI,
    });
    const boundaryStartZ = -compiledIslandBoundaryRadius(manifest) + 30;
    let state = {
      ...initial,
      position: { x: 0, y: island.heightAt(0, boundaryStartZ) + 0.05, z: boundaryStartZ },
    };
    const resolver = new RapierHorseMotionResolver(
      island.world,
      state.position,
      undefined,
      (position) => island.isSafeGround(position.x, position.z),
      (position, desired) => island.constrainBoundaryTranslation(position, desired),
      (position, desired, constrained, resolved) =>
        island.constrainBoundaryPosition(position, desired, constrained, resolved),
    );

    let reachedGallop = false;
    for (let tick = 0; tick < 480; tick += 1) {
      state = stepHorse(
        state,
        { ...NEUTRAL_HORSE_INPUT, moveY: 1, cameraYaw: Math.PI, gallopHeld: true },
        resolver,
      ).state;
      reachedGallop ||= state.speed > 12;
    }

    expect(reachedGallop).toBe(true);
    expect(Math.hypot(state.position.x, state.position.z)).toBeLessThan(
      compiledIslandBoundaryRadius(manifest) + 1,
    );
    expect(state.position.y).toBeGreaterThan(manifest.island.seaLevelMeters - 0.1);
    expect(state.grounded).toBe(true);
    expect(
      state.speed,
      `boundary state=${state.position.x.toFixed(2)},${state.position.y.toFixed(2)},` +
        `${state.position.z.toFixed(2)}`,
    ).toBeLessThan(1);

    state = stepHorse(
      state,
      { ...NEUTRAL_HORSE_INPUT, resetPressed: true },
      resolver,
    ).state;
    expect(Math.hypot(state.position.x, state.position.z)).toBeLessThan(
      compiledIslandBoundaryRadius(manifest) - 20,
    );
    expect(state.speed).toBe(0);

    resolver.dispose();
    island.dispose();
  });

  it("never records a recovery pose on a sharp terrain seam", () => {
    const manifest = compileWorld(exampleJson as unknown as WorldSpec);
    const island = new CompiledIslandWorld(manifest);
    const radius = compiledIslandBoundaryRadius(manifest) - 24;
    const footprint = 1.5;
    const maximumRelief = Math.tan((18 * Math.PI) / 180) * footprint + 0.02;

    for (let z = -radius; z <= radius; z += 2) {
      for (let x = -radius; x <= radius; x += 2) {
        if (!island.isSafeGround(x, z)) continue;
        const centre = island.heightAt(x, z);
        for (const [dx, dz] of [
          [footprint, 0],
          [-footprint, 0],
          [0, footprint],
          [0, -footprint],
        ] as const) {
          expect(
            Math.abs(island.heightAt(x + dx, z + dz) - centre),
            `unsafe recovery footprint at ${x},${z}`,
          ).toBeLessThanOrEqual(maximumRelief);
        }
      }
    }

    island.dispose();
  });

  it("lets ordinary diagonal steering leave the north shoreline without reset", () => {
    const manifest = compileWorld(exampleJson as unknown as WorldSpec);
    const island = new CompiledIslandWorld(manifest);
    const startZ = compiledIslandBoundaryRadius(manifest) - 30;
    let state = createInitialHorseState({
      position: { x: 14, y: island.heightAt(14, startZ) + 0.05, z: startZ },
      yaw: 0,
    });
    const resolver = new RapierHorseMotionResolver(
      island.world,
      state.position,
      undefined,
      (position) => island.isSafeGround(position.x, position.z),
      (position, desired) => island.constrainBoundaryTranslation(position, desired),
      (position, desired, constrained, resolved) =>
        island.constrainBoundaryPosition(position, desired, constrained, resolved),
    );

    for (let tick = 0; tick < 480; tick += 1) {
      state = stepHorse(
        state,
        { ...NEUTRAL_HORSE_INPUT, moveY: 1, cameraYaw: 0, gallopHeld: true },
        resolver,
      ).state;
    }
    const stoppedRadius = Math.hypot(state.position.x, state.position.z);
    const stoppedPosition = { ...state.position };
    expect(state.speed).toBeLessThan(1);

    let steeringSpeed = 0;
    for (let tick = 0; tick < 300; tick += 1) {
      state = stepHorse(
        state,
        { ...NEUTRAL_HORSE_INPUT, moveX: 1, moveY: 1, cameraYaw: 0 },
        resolver,
      ).state;
      steeringSpeed = Math.max(steeringSpeed, state.speed);
    }
    expect(steeringSpeed).toBeGreaterThan(2);
    expect(Math.hypot(
      state.position.x - stoppedPosition.x,
      state.position.z - stoppedPosition.z,
    )).toBeGreaterThan(2);
    expect(Math.hypot(state.position.x, state.position.z)).toBeLessThan(
      stoppedRadius - 1,
    );

    resolver.dispose();
    island.dispose();
  });

  it("keeps the outer coast gentle and the invisible wall out of camera sweeps", () => {
    const manifest = compileWorld(exampleJson as unknown as WorldSpec);
    const island = new CompiledIslandWorld(manifest);
    const coastalSlopes = manifest.chunks.flatMap((chunk) =>
      chunk.slopeDegrees.filter(
        (_slope, index) => {
          const shore = chunk.shoreDistanceMeters[index];
          return shore !== undefined && shore >= 4 && shore <= 40;
        },
      ),
    );
    expect(Math.max(...coastalSlopes)).toBeLessThanOrEqual(28);

    const radius = compiledIslandBoundaryRadius(manifest);
    expect(
      island.sweep(
        { x: 0, y: manifest.island.seaLevelMeters + 3, z: radius - 2 },
        { x: 0, y: manifest.island.seaLevelMeters + 3, z: radius + 5 },
        0.3,
      ),
    ).toBeNull();

    island.dispose();
  });
});
