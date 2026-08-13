import { describe, expect, it } from "vitest";
import type { HorseGait } from "../../src/game/simulation/horse/horseState";
import {
  GAIT_PROFILES,
  HorseGaitAnimator,
  type HorseAnimationInput,
} from "../../src/render/horse/horseGaitAnimator";
import { createHorseRig, type HorseRig } from "../../src/render/horse/horseVisual";

/**
 * Embodiment tests.
 *
 * The first blind playtest failed Milestone 1 with the horse reading as a rigid
 * generic avatar. These assertions pin the properties that verdict was about,
 * so a later tuning pass cannot quietly flatten them back out again. They test
 * the shape of the motion, never a specific pose, because the numbers are meant
 * to stay tunable.
 */

const BASE: HorseAnimationInput = {
  speed: 0,
  gait: "idle",
  grounded: true,
  verticalVelocity: 0,
  condition: "normal",
  yawRate: 0,
  acceleration: 0,
  groundPitch: 0,
  groundRoll: 0,
  deltaSeconds: 1 / 60,
  reducedMotion: false,
};

interface RideSample {
  readonly bodyY: number;
  readonly spine: number;
  readonly forehand: number;
  readonly bodyPitch: number;
}

/** Runs a steady ride and reports one sample per frame. */
function ride(
  animator: HorseGaitAnimator,
  rig: HorseRig,
  overrides: Partial<HorseAnimationInput>,
  frames: number,
): RideSample[] {
  const samples: RideSample[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    animator.update(rig, { ...BASE, ...overrides });
    samples.push({
      bodyY: rig.body.position.y,
      spine: rig.spine.rotation.x,
      forehand: rig.forehand.rotation.x,
      bodyPitch: rig.body.rotation.x,
    });
  }
  return samples;
}

function range(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const meanA = a.reduce((sum, value) => sum + value, 0) / n;
  const meanB = b.reduce((sum, value) => sum + value, 0) / n;
  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let index = 0; index < n; index += 1) {
    const da = a[index]! - meanA;
    const db = b[index]! - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }
  return covariance / Math.sqrt(varianceA * varianceB);
}

/** Stance windows implied by a profile's offsets and duty factor. */
function stanceWindows(gait: HorseGait): Array<[number, number]> {
  const profile = GAIT_PROFILES[gait];
  return profile.offsets.map((offset) => {
    // A leg is in stance while (phase + offset) mod 1 < dutyFactor, so in
    // stride phase it starts at -offset and runs for dutyFactor.
    const start = ((-offset % 1) + 1) % 1;
    return [start, start + profile.dutyFactor] as [number, number];
  });
}

function overlaps(a: [number, number], b: [number, number]): boolean {
  // Both windows may run past 1; compare against the unwrapped copies too.
  for (const shift of [-1, 0, 1]) {
    if (a[0] < b[1] + shift && b[0] + shift < a[1]) return true;
  }
  return false;
}

describe("gait profiles", () => {
  it("places every suspension pulse in a window with no hoof on the ground", () => {
    for (const gait of ["trot", "canter", "gallop"] as const) {
      const profile = GAIT_PROFILES[gait];
      if (profile.lift === 0) continue;

      // The lift is defined in harmonic phase, so convert it back to stride
      // phase before comparing it against the stance windows.
      const width = profile.liftHalfWidth / profile.bobHarmonic;
      const windows = stanceWindows(gait);

      for (let harmonic = 0; harmonic < profile.bobHarmonic; harmonic += 1) {
        const centre = (profile.liftCentre + harmonic) / profile.bobHarmonic;
        const lift: [number, number] = [centre - width, centre + width];
        for (const [index, window] of windows.entries()) {
          expect(
            overlaps(lift, window),
            `${gait}: lift ${lift.map((v) => v.toFixed(2)).join("-")} overlaps ` +
              `stance ${index} ${window.map((v) => v.toFixed(2)).join("-")}`,
          ).toBe(false);
        }
      }
    }
  });

  it("gives faster gaits longer strides and less time on the ground", () => {
    const order: HorseGait[] = ["walk", "trot", "canter", "gallop"];
    for (let index = 1; index < order.length; index += 1) {
      const slower = GAIT_PROFILES[order[index - 1]!];
      const faster = GAIT_PROFILES[order[index]!];
      expect(faster.strideLength).toBeGreaterThan(slower.strideLength);
      expect(faster.dutyFactor).toBeLessThan(slower.dutyFactor);
    }
  });
});

describe("gallop embodiment", () => {
  it("lifts the whole horse clear of the ground once per stride", () => {
    const rig = createHorseRig();
    const animator = new HorseGaitAnimator();
    // Settle the profile blend before measuring.
    ride(animator, rig, { speed: 16, gait: "gallop" }, 120);
    const samples = ride(animator, rig, { speed: 16, gait: "gallop" }, 180);

    // A 16 m/s gallop should move the body through a substantial arc. The old
    // build travelled 0.14 m peak to trough, which is what read as a model
    // sliding along a rail.
    expect(range(samples.map((sample) => sample.bodyY))).toBeGreaterThan(0.28);
    const rig2 = createHorseRig();
    try {
      const idle = ride(new HorseGaitAnimator(), rig2, {}, 200);
      expect(range(idle.map((sample) => sample.bodyY))).toBeLessThan(0.05);
    } finally {
      rig2.dispose();
    }
    rig.dispose();
  });

  it("rounds the back as the horse rises and extends it at mid-stance", () => {
    const rig = createHorseRig();
    const animator = new HorseGaitAnimator();
    ride(animator, rig, { speed: 16, gait: "gallop" }, 120);
    const samples = ride(animator, rig, { speed: 16, gait: "gallop" }, 240);

    const bodyY = samples.map((sample) => sample.bodyY);
    const spine = samples.map((sample) => sample.spine);
    const forehand = samples.map((sample) => sample.forehand);

    // Highest and most gathered on the same frame: that is the shape a horse
    // makes at the top of a stride.
    expect(correlation(bodyY, spine)).toBeGreaterThan(0.75);
    // The forehand lifts as the back rounds, so it moves opposite in sign.
    expect(correlation(spine, forehand)).toBeLessThan(-0.9);
    // The articulation has to be visible, not a rounding error.
    expect(range(spine)).toBeGreaterThan(0.2);
    rig.dispose();
  });

  it("stops striding when the horse is held against something", () => {
    const rig = createHorseRig();
    const animator = new HorseGaitAnimator();
    ride(animator, rig, { speed: 16, gait: "gallop" }, 120);
    animator.consumeFootfalls();

    // The controller reports resolved speed, so a horse pinned against the
    // boundary reports zero however hard the player is pushing forward.
    const blocked = ride(animator, rig, { speed: 0, gait: "idle" }, 120);
    expect(animator.consumeFootfalls()).toHaveLength(0);
    expect(range(blocked.slice(60).map((sample) => sample.bodyY))).toBeLessThan(0.05);
    rig.dispose();
  });

  it("halves the vertical travel under reduced motion", () => {
    const full = createHorseRig();
    const reduced = createHorseRig();
    const settle = 120;
    ride(new HorseGaitAnimator(), full, { speed: 16, gait: "gallop" }, settle);

    const fullAnimator = new HorseGaitAnimator();
    const reducedAnimator = new HorseGaitAnimator();
    ride(fullAnimator, full, { speed: 16, gait: "gallop" }, settle);
    ride(reducedAnimator, reduced, { speed: 16, gait: "gallop", reducedMotion: true }, settle);

    const fullTravel = range(
      ride(fullAnimator, full, { speed: 16, gait: "gallop" }, 180).map((s) => s.bodyY),
    );
    const reducedTravel = range(
      ride(reducedAnimator, reduced, { speed: 16, gait: "gallop", reducedMotion: true }, 180).map(
        (s) => s.bodyY,
      ),
    );

    expect(reducedTravel).toBeLessThan(fullTravel * 0.6);
    full.dispose();
    reduced.dispose();
  });
});

describe("jump and landing", () => {
  it("pitches the nose up while rising and down while falling", () => {
    const rising = createHorseRig();
    const falling = createHorseRig();
    ride(new HorseGaitAnimator(), rising, {
      speed: 12,
      gait: "canter",
      grounded: false,
      verticalVelocity: 7,
    }, 40);
    ride(new HorseGaitAnimator(), falling, {
      speed: 12,
      gait: "canter",
      grounded: false,
      verticalVelocity: -7,
    }, 40);

    // Positive rotation.x pitches the front of the body down. The first build
    // had this inverted, so every jump began as a nose-dive.
    expect(rising.body.rotation.x).toBeLessThan(-0.05);
    expect(falling.body.rotation.x).toBeGreaterThan(0.05);
    rising.dispose();
    falling.dispose();
  });

  it("folds the front legs up on the way up and reaches with them on the way down", () => {
    const rising = createHorseRig();
    const falling = createHorseRig();
    ride(new HorseGaitAnimator(), rising, {
      speed: 12,
      gait: "canter",
      grounded: false,
      verticalVelocity: 7,
    }, 40);
    ride(new HorseGaitAnimator(), falling, {
      speed: 12,
      gait: "canter",
      grounded: false,
      verticalVelocity: -7,
    }, 40);

    const knee = (rig: HorseRig) =>
      rig.legs.find((leg) => leg.id === "frontLeft")!.lower.rotation.x;
    // Front knees bend backwards, so a tighter tuck is a more negative angle.
    expect(knee(rising)).toBeLessThan(knee(falling));
    rising.dispose();
    falling.dispose();
  });

  it("compresses on landing and rebounds before settling", () => {
    const rig = createHorseRig();
    const animator = new HorseGaitAnimator();
    ride(animator, rig, { speed: 9, gait: "canter" }, 60);

    animator.land(1);
    const trace: number[] = [];
    for (let frame = 0; frame < 90; frame += 1) {
      animator.update(rig, { ...BASE, speed: 9, gait: "canter" });
      trace.push(animator.impulseDisplacement);
    }

    const lowest = Math.min(...trace);
    const lowestIndex = trace.indexOf(lowest);
    const rebound = Math.max(...trace.slice(lowestIndex));

    expect(lowest).toBeLessThan(-0.1);
    // A single visible rebound, then settled. No rebound reads as a snap back
    // to the idle pose; a large one reads as a trampoline.
    expect(rebound).toBeGreaterThan(0.01);
    expect(rebound).toBeLessThan(-lowest * 0.6);
    expect(Math.abs(trace.at(-1)!)).toBeLessThan(0.01);
    rig.dispose();
  });

  it("scales the landing fold with the impact", () => {
    const soft = new HorseGaitAnimator();
    const hard = new HorseGaitAnimator();
    const softRig = createHorseRig();
    const hardRig = createHorseRig();
    soft.land(0.2);
    hard.land(1.2);

    let softLowest = 0;
    let hardLowest = 0;
    for (let frame = 0; frame < 60; frame += 1) {
      soft.update(softRig, { ...BASE, speed: 9, gait: "canter" });
      hard.update(hardRig, { ...BASE, speed: 9, gait: "canter" });
      softLowest = Math.min(softLowest, soft.impulseDisplacement);
      hardLowest = Math.min(hardLowest, hard.impulseDisplacement);
    }

    expect(hardLowest).toBeLessThan(softLowest * 3);
    softRig.dispose();
    hardRig.dispose();
  });

  it("extends the frame and lifts the forehand on takeoff", () => {
    const rig = createHorseRig();
    const animator = new HorseGaitAnimator();
    ride(animator, rig, { speed: 12, gait: "canter" }, 60);

    animator.takeOff(1);
    let peakExtension = 0;
    let liftedForehand = 0;
    for (let frame = 0; frame < 24; frame += 1) {
      animator.update(rig, {
        ...BASE,
        speed: 12,
        gait: "canter",
        grounded: false,
        verticalVelocity: 7,
      });
      peakExtension = Math.min(peakExtension, rig.spine.rotation.x);
      liftedForehand = Math.min(liftedForehand, rig.forehand.rotation.x);
    }

    // Negative spine extends the frame; negative forehand lifts the front end.
    expect(peakExtension).toBeLessThan(-0.15);
    expect(liftedForehand).toBeLessThan(-0.15);
    rig.dispose();
  });
});

describe("effort", () => {
  it("sits the horse down on its hocks when braking", () => {
    const braking = createHorseRig();
    const driving = createHorseRig();
    ride(new HorseGaitAnimator(), braking, {
      speed: 8,
      gait: "canter",
      acceleration: -9,
    }, 60);
    ride(new HorseGaitAnimator(), driving, {
      speed: 8,
      gait: "canter",
      acceleration: 5,
    }, 60);

    // Braking rounds the back (positive) and accelerating extends it.
    expect(braking.spine.rotation.x).toBeGreaterThan(driving.spine.rotation.x + 0.1);
    braking.dispose();
    driving.dispose();
  });
});
