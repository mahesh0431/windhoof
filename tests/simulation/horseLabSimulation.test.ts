import { describe, expect, it } from "vitest";
import { NEUTRAL_HORSE_INPUT } from "../../src/game/contracts/input";
import { HorseLabSimulation } from "../../src/game/simulation/horseLabSimulation";
import { FlatGroundMotionResolver } from "../../src/physics/flatGroundMotionResolver";

function createSimulation() {
  return new HorseLabSimulation(
    { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
    new FlatGroundMotionResolver(),
  );
}

describe("HorseLabSimulation", () => {
  it("publishes immutable render and UI state after fixed steps", () => {
    const simulation = createSimulation();
    const frame = simulation.advanceFrame(1 / 30, {
      ...NEUTRAL_HORSE_INPUT,
      moveY: 1,
    });

    expect(frame.timing.steps).toBe(2);
    expect(frame.horse.tick).toBe(2);
    expect(frame.horse.speed).toBeGreaterThan(0);
    expect(frame.ui.controlContext).toBe("horse-lab");
  });

  it("consumes edge actions after the first substep in a render frame", () => {
    const simulation = createSimulation();
    const frame = simulation.advanceFrame(1 / 20, {
      ...NEUTRAL_HORSE_INPUT,
      callPressed: true,
      jumpPressed: true,
    });

    expect(frame.timing.steps).toBe(3);
    expect(frame.events.filter((event) => event.type === "HorseCalled")).toHaveLength(1);
    expect(frame.events.filter((event) => event.type === "HorseJumped")).toHaveLength(1);
  });

  it("retains an edge action until a fixed tick actually consumes it", () => {
    const simulation = createSimulation();
    const early = simulation.advanceFrame(1 / 120, {
      ...NEUTRAL_HORSE_INPUT,
      callPressed: true,
    });
    expect(early.timing.steps).toBe(0);
    expect(early.events).toEqual([]);

    const consumed = simulation.advanceFrame(1 / 120, NEUTRAL_HORSE_INPUT);
    expect(consumed.timing.steps).toBe(1);
    expect(consumed.events).toContainEqual({ type: "HorseCalled" });
  });

  it("does not advance authoritative simulation while paused", () => {
    const simulation = createSimulation();
    simulation.command({ type: "Pause" });
    const before = simulation.authoritativeStateForDiagnostics();
    const frame = simulation.advanceFrame(1, {
      ...NEUTRAL_HORSE_INPUT,
      moveY: 1,
    });

    expect(frame.timing.steps).toBe(0);
    expect(frame.ui.mode).toBe("paused");
    expect(simulation.authoritativeStateForDiagnostics().tick).toBe(before.tick);
    expect(frame.events).toContainEqual({ type: "PauseChanged", paused: true });
  });

  it("resets through the command boundary and exposes one event", () => {
    const simulation = createSimulation();
    simulation.advanceFrame(1, {
      ...NEUTRAL_HORSE_INPUT,
      moveY: 1,
      gallopHeld: true,
    });
    const expectedSafePosition = {
      ...simulation.authoritativeStateForDiagnostics().lastSafePose.position,
    };

    simulation.command({ type: "ResetToSafeGround" });
    const snapshot = simulation.snapshot();

    expect(snapshot.horse.position).toEqual(expectedSafePosition);
    expect(snapshot.horse.speed).toBe(0);
    expect(snapshot.events).toEqual([{ type: "HorseReset" }]);
  });
});
