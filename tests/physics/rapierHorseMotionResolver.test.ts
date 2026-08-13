import { beforeAll, describe, expect, it } from "vitest";
import { createInitialHorseState } from "../../src/game/simulation/horse/horseState";
import { RapierHorseMotionResolver } from "../../src/physics/rapierHorseMotionResolver";
import { initializeRapier, RAPIER } from "../../src/physics/rapierRuntime";

beforeAll(async () => {
  await initializeRapier();
});

function createGroundedWorld() {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(25, 0.5, 25).setTranslation(0, -0.5, 0),
  );
  return world;
}

function addRamp(
  world: RAPIER.World,
  angleDegrees: number,
  lowEdgeZ = 2,
): void {
  const angle = (angleDegrees * Math.PI) / 180;
  const halfLength = 4;
  const halfThickness = 0.2;
  const centreY = halfLength * Math.sin(angle) - halfThickness * Math.cos(angle);
  const centreZ =
    lowEdgeZ + halfThickness * Math.sin(angle) + halfLength * Math.cos(angle);

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(3, halfThickness, halfLength)
      .setTranslation(0, centreY, centreZ)
      .setRotation({
        x: -Math.sin(angle / 2),
        y: 0,
        z: 0,
        w: Math.cos(angle / 2),
      }),
  );
}

function advanceResolver(
  resolver: RapierHorseMotionResolver,
  initialState: ReturnType<typeof createInitialHorseState>,
  ticks: number,
) {
  let state = initialState;
  for (let tick = 0; tick < ticks; tick += 1) {
    const result = resolver.resolve(state, { x: 0, y: -0.02, z: 0.1 }, 1 / 60);
    state = {
      ...state,
      tick: state.tick + 1,
      position: result.position,
      grounded: result.grounded,
    };
  }
  return state;
}

describe("RapierHorseMotionResolver", () => {
  it("keeps the horse root on the ground while moving horizontally", () => {
    const world = createGroundedWorld();
    world.step();
    const state = createInitialHorseState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    const resolver = new RapierHorseMotionResolver(world, state.position);

    const result = resolver.resolve(state, { x: 0, y: -0.01, z: 1 }, 1 / 60);

    expect(result.grounded).toBe(true);
    expect(result.blockedHorizontally).toBe(false);
    expect(result.position.y).toBeCloseTo(0, 3);
    expect(result.position.z).toBeCloseTo(1, 4);

    resolver.dispose();
    world.free();
  });

  it("prevents the horse capsule from crossing a solid obstacle", () => {
    const world = createGroundedWorld();
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(2, 2, 0.5).setTranslation(0, 2, 2),
    );
    world.step();
    const state = createInitialHorseState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    const resolver = new RapierHorseMotionResolver(world, state.position);

    const result = resolver.resolve(state, { x: 0, y: -0.01, z: 4 }, 1 / 60);

    expect(result.position.z).toBeLessThan(1.5);
    expect(result.blockedHorizontally).toBe(true);
    expect(result.safeGround).toBe(false);

    resolver.dispose();
    world.free();
  });

  it("uses the world's safety rule for recovery anchors", () => {
    const world = createGroundedWorld();
    world.step();
    const state = createInitialHorseState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    const resolver = new RapierHorseMotionResolver(
      world,
      state.position,
      undefined,
      (position) => position.z < 0.5,
    );

    const result = resolver.resolve(state, { x: 0, y: -0.01, z: 1 }, 1 / 60);

    expect(result.grounded).toBe(true);
    expect(result.safeGround).toBe(false);

    resolver.dispose();
    world.free();
  });

  it("climbs a traversable slope", () => {
    const world = createGroundedWorld();
    addRamp(world, 20);
    world.step();
    const state = createInitialHorseState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    const resolver = new RapierHorseMotionResolver(world, state.position);

    const result = advanceResolver(resolver, state, 100);

    expect(result.position.z).toBeGreaterThan(8);
    expect(result.position.y).toBeGreaterThan(1.5);

    resolver.dispose();
    world.free();
  });

  it("does not climb a slope above the configured limit", () => {
    const world = createGroundedWorld();
    addRamp(world, 45);
    world.step();
    const state = createInitialHorseState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    const resolver = new RapierHorseMotionResolver(world, state.position);

    const result = advanceResolver(resolver, state, 100);

    expect(result.position.z).toBeLessThan(3);
    expect(result.position.y).toBeLessThan(0.2);

    resolver.dispose();
    world.free();
  });
});
