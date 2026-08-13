import { describe, expect, it } from "vitest";
import { FixedStepClock } from "../../src/game/simulation/fixedStep";

describe("FixedStepClock", () => {
  it("runs simulation at fixed intervals and retains interpolation time", () => {
    const clock = new FixedStepClock({ stepSeconds: 0.1 });
    let calls = 0;

    const first = clock.advance(0.25, () => {
      calls += 1;
    });
    const second = clock.advance(0.05, () => {
      calls += 1;
    });

    expect(first.steps).toBe(2);
    expect(first.interpolationAlpha).toBeCloseTo(0.5);
    expect(second.steps).toBe(1);
    expect(calls).toBe(3);
  });

  it("caps catch-up and reports dropped time", () => {
    const clock = new FixedStepClock({
      stepSeconds: 0.01,
      maximumFrameSeconds: 0.25,
      maximumSubsteps: 4,
    });
    let calls = 0;
    const result = clock.advance(1, () => {
      calls += 1;
    });

    expect(calls).toBe(4);
    expect(result.droppedSeconds).toBeGreaterThanOrEqual(0.2);
    expect(result.interpolationAlpha).toBeLessThan(1);
  });
});
