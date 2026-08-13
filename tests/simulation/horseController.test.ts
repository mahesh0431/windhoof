import { describe, expect, it } from "vitest";
import { NEUTRAL_HORSE_INPUT, type HorseInputFrame } from "../../src/game/contracts/input";
import {
  createInitialHorseState,
  type HorseState,
} from "../../src/game/simulation/horse/horseState";
import { stepHorse } from "../../src/game/simulation/horse/horseController";
import { DEFAULT_HORSE_TUNING } from "../../src/game/simulation/horse/horseTuning";
import { quantizedHorseSnapshot, replayHorseInputs } from "../../src/diagnostics/replay";
import { FlatGroundMotionResolver } from "../../src/physics/flatGroundMotionResolver";
import type { HorseMotionResolver } from "../../src/physics/horseMotionResolver";

function initialState() {
  return createInitialHorseState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });
}

function repeatInput(input: HorseInputFrame, ticks: number): HorseInputFrame[] {
  return Array.from({ length: ticks }, () => input);
}

describe("horse controller", () => {
  it("accelerates through horse gaits and reaches gallop intent", () => {
    const input = { ...NEUTRAL_HORSE_INPUT, moveY: 1, gallopHeld: true };
    const result = replayHorseInputs(
      initialState(),
      repeatInput(input, 240),
      new FlatGroundMotionResolver(),
    );

    expect(result.gaitSequence).toContain("walk");
    expect(result.gaitSequence).toContain("trot");
    expect(result.gaitSequence).toContain("canter");
    expect(result.finalState.gait).toBe("gallop");
    expect(result.finalState.speed).toBeCloseTo(DEFAULT_HORSE_TUNING.gallopSpeed, 4);
  });

  it("stays in canter until speed crosses halfway to full gallop", () => {
    const resolver = new FlatGroundMotionResolver();
    const canterToGallop =
      (DEFAULT_HORSE_TUNING.canterSpeed + DEFAULT_HORSE_TUNING.gallopSpeed) / 2;
    const input = { ...NEUTRAL_HORSE_INPUT, moveY: 1, gallopHeld: true };

    const belowTransition = stepHorse(
      {
        ...initialState(),
        speed: canterToGallop - DEFAULT_HORSE_TUNING.gallopAcceleration / 60 - 0.01,
        gait: "canter",
      },
      input,
      resolver,
    ).state;
    const aboveTransition = stepHorse(
      {
        ...initialState(),
        speed: canterToGallop,
        gait: "canter",
      },
      input,
      resolver,
    ).state;

    expect(belowTransition.gait).toBe("canter");
    expect(aboveTransition.gait).toBe("gallop");
  });

  it("turns more slowly at gallop than at walking speed", () => {
    const resolver = new FlatGroundMotionResolver();
    const right = { ...NEUTRAL_HORSE_INPUT, moveX: 1, cameraYaw: 0 };
    const slow = stepHorse(
      { ...initialState(), speed: DEFAULT_HORSE_TUNING.walkSpeed, gait: "walk" },
      right,
      resolver,
    ).state;
    const fast = stepHorse(
      { ...initialState(), speed: DEFAULT_HORSE_TUNING.gallopSpeed, gait: "gallop" },
      { ...right, gallopHeld: true },
      resolver,
    ).state;

    expect(Math.abs(slow.yaw)).toBeGreaterThan(Math.abs(fast.yaw));
  });

  it("reports resolved motion rather than galloping in place against a wall", () => {
    const blocked: HorseMotionResolver = {
      resolve(state) {
        return {
          position: state.position,
          grounded: true,
          hitCeiling: false,
          blockedHorizontally: true,
          safeGround: true,
        };
      },
    };

    let result: HorseState = {
      ...initialState(),
      speed: DEFAULT_HORSE_TUNING.gallopSpeed,
      gait: "gallop" as const,
    };
    for (let tick = 0; tick < 120; tick += 1) {
      result = stepHorse(
        result,
        { ...NEUTRAL_HORSE_INPUT, moveY: 1, gallopHeld: true },
        blocked,
      ).state;
    }

    expect(result.speed).toBe(0);
    expect(result.gait).toBe("idle");
  });

  it("jumps once, becomes airborne, and lands", () => {
    const resolver = new FlatGroundMotionResolver();
    let state = initialState();
    const takeoff = stepHorse(
      state,
      { ...NEUTRAL_HORSE_INPUT, jumpPressed: true },
      resolver,
    );
    state = takeoff.state;

    expect(takeoff.events).toContainEqual({ type: "HorseJumped" });
    expect(state.grounded).toBe(false);
    expect(state.position.y).toBeGreaterThan(0);

    let landed = false;
    for (let tick = 0; tick < 180; tick += 1) {
      const result = stepHorse(state, NEUTRAL_HORSE_INPUT, resolver);
      state = result.state;
      if (result.events.some((event) => event.type === "HorseLanded")) {
        landed = true;
        break;
      }
    }

    expect(landed).toBe(true);
    expect(state.grounded).toBe(true);
    expect(state.position.y).toBe(0);
  });

  it("does not permit repeated airborne jumps", () => {
    const resolver = new FlatGroundMotionResolver();
    const first = stepHorse(
      initialState(),
      { ...NEUTRAL_HORSE_INPUT, jumpPressed: true },
      resolver,
    );
    const second = stepHorse(
      first.state,
      { ...NEUTRAL_HORSE_INPUT, jumpPressed: true },
      resolver,
    );

    expect(second.events).not.toContainEqual({ type: "HorseJumped" });
    expect(second.state.verticalVelocity).toBeLessThan(first.state.verticalVelocity);
  });

  it("allows a coyote jump but not after the grace window expires", () => {
    const resolver = new FlatGroundMotionResolver(-100);
    const recentlyAirborne = {
      ...initialState(),
      tick: 4,
      grounded: false,
      airborneTicks: 4,
      lastGroundedTick: 0,
    };
    const coyoteJump = stepHorse(
      recentlyAirborne,
      { ...NEUTRAL_HORSE_INPUT, jumpPressed: true },
      resolver,
    );
    const expired = stepHorse(
      { ...recentlyAirborne, tick: DEFAULT_HORSE_TUNING.coyoteTicks + 1 },
      { ...NEUTRAL_HORSE_INPUT, jumpPressed: true },
      resolver,
    );

    expect(coyoteJump.events).toContainEqual({ type: "HorseJumped" });
    expect(expired.events).not.toContainEqual({ type: "HorseJumped" });
  });

  it("turns a hard landing into a temporary stumble instead of failure", () => {
    const resolver = new FlatGroundMotionResolver();
    const originalSafePose = initialState().lastSafePose;
    let state: HorseState = {
      ...initialState(),
      position: { x: 0, y: 1, z: 0 },
      verticalVelocity: -12,
      grounded: false,
      airborneTicks: 30,
      jumpConsumedSinceGrounded: true,
    };
    let landingEvent = null;

    for (let tick = 0; tick < 30; tick += 1) {
      const result = stepHorse(state, NEUTRAL_HORSE_INPUT, resolver);
      state = result.state;
      landingEvent = result.events.find((event) => event.type === "HorseLanded") ?? null;
      if (landingEvent) break;
    }

    expect(landingEvent).toEqual({ type: "HorseLanded", hard: true });
    expect(state.condition).toBe("stumbling");
    expect(state.recoveryTicksRemaining).toBe(DEFAULT_HORSE_TUNING.stumbleTicks);
    expect(state.lastSafePose).toEqual(originalSafePose);
  });

  it("resets exactly to the last safe pose", () => {
    const safe = initialState();
    const displaced = {
      ...safe,
      position: { x: 100, y: -20, z: 80 },
      grounded: false,
      speed: 12,
      gait: "gallop" as const,
    };
    const result = stepHorse(
      displaced,
      { ...NEUTRAL_HORSE_INPUT, resetPressed: true },
      new FlatGroundMotionResolver(),
    );

    expect(result.state.position).toEqual(safe.lastSafePose.position);
    expect(result.state.speed).toBe(0);
    expect(result.state.grounded).toBe(true);
    expect(result.events).toContainEqual({ type: "HorseReset" });
  });

  it("uses backward input as a brake all the way to idle", () => {
    let state: HorseState = {
      ...initialState(),
      speed: DEFAULT_HORSE_TUNING.canterSpeed,
      gait: "canter" as const,
    };
    const resolver = new FlatGroundMotionResolver();

    for (let tick = 0; tick < 120; tick += 1) {
      state = stepHorse(
        state,
        { ...NEUTRAL_HORSE_INPUT, moveY: -1 },
        resolver,
      ).state;
    }

    expect(state.speed).toBe(0);
    expect(state.gait).toBe("idle");
  });

  it("replays the same recorded input into the same quantized state", () => {
    const inputs = [
      ...repeatInput({ ...NEUTRAL_HORSE_INPUT, moveY: 1 }, 90),
      ...repeatInput(
        { ...NEUTRAL_HORSE_INPUT, moveY: 1, moveX: 0.45, gallopHeld: true },
        120,
      ),
      { ...NEUTRAL_HORSE_INPUT, moveY: 1, jumpPressed: true },
      ...repeatInput({ ...NEUTRAL_HORSE_INPUT, moveY: 1 }, 120),
    ];
    const first = replayHorseInputs(
      initialState(),
      inputs,
      new FlatGroundMotionResolver(),
    );
    const second = replayHorseInputs(
      initialState(),
      inputs,
      new FlatGroundMotionResolver(),
    );

    expect(quantizedHorseSnapshot(first.finalState)).toBe(
      quantizedHorseSnapshot(second.finalState),
    );
  });
});
