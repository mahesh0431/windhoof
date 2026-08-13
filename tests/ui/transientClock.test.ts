import { describe, expect, it } from "vitest";
import { createTransientClock } from "../../src/ui/transientClock";

describe("transient clock", () => {
  it("starts at zero and measures real elapsed time", () => {
    const clock = createTransientClock();
    // The first call is only a baseline, whatever the page uptime happens to be.
    expect(clock.advance(120_000, false)).toBe(0);
    expect(clock.advance(120_500, false)).toBeCloseTo(0.5, 6);
    expect(clock.advance(122_000, false)).toBeCloseTo(2, 6);
  });

  /**
   * The regression this exists for.
   *
   * On a slow renderer the app's simulation clock advances by at most 100 ms per
   * frame however long the frame really took, so a five-second title timed
   * against it outlived fifteen real seconds. Timed against this clock, five
   * real seconds is five real seconds no matter how few frames happened.
   */
  it("keeps real time when frames are far slower than the simulation step", () => {
    const clock = createTransientClock();
    const PLACE_SECONDS = 5;
    let now = 0;
    clock.advance(now, false);

    // Four frames per second: every frame is 250 ms of wall time, which the
    // simulation clock would have counted as 100 ms.
    let seconds = 0;
    let frames = 0;
    const deadline = PLACE_SECONDS;
    while (seconds < deadline && frames < 1000) {
      now += 250;
      seconds = clock.advance(now, false);
      frames += 1;
    }

    expect(frames).toBe(20);
    expect(now / 1000).toBeCloseTo(5, 6);
  });

  it("does not count paused time", () => {
    const clock = createTransientClock();
    clock.advance(0, false);
    expect(clock.advance(2_000, false)).toBeCloseTo(2, 6);

    // Ten minutes paused.
    expect(clock.advance(602_000, true)).toBeCloseTo(2, 6);

    // And it picks up exactly where it left off, so a title interrupted by a
    // pause still has the rest of its life left when the player comes back.
    expect(clock.advance(603_000, false)).toBeCloseTo(3, 6);
  });

  it("expires transients immediately after a long hidden tab", () => {
    const clock = createTransientClock();
    clock.advance(0, false);
    const placeUntil = clock.advance(100, false) + 5;

    // requestAnimationFrame does not fire in a hidden tab, so the next frame
    // arrives minutes later as one enormous delta. That must expire the title,
    // not stretch it.
    expect(clock.advance(600_000, false)).toBeGreaterThan(placeUntil);
  });

  /**
   * `performance.now()` is monotonic, so neither of these should ever happen.
   * What matters is that if one did, the interface degrades to "this transient
   * expires a little early or late" rather than to "this transient is stuck on
   * screen" — which is the failure being fixed.
   */
  it("never goes backwards, and resyncs after a bad timestamp", () => {
    const clock = createTransientClock();
    clock.advance(1_000, false);
    expect(clock.advance(1_500, false)).toBeCloseTo(0.5, 6);

    // A backwards jump credits no time at all.
    expect(clock.advance(900, false)).toBeCloseTo(0.5, 6);
    // A non-finite reading is ignored outright and does not disturb the baseline.
    expect(clock.advance(Number.NaN, false)).toBeCloseTo(0.5, 6);

    // Afterwards the clock resyncs to the new timeline and keeps counting
    // forward from there, rather than crediting the rewound span twice.
    const afterResync = clock.advance(1_000, false);
    expect(afterResync).toBeGreaterThanOrEqual(0.5);
    expect(afterResync).toBeLessThan(0.7);
    expect(clock.advance(2_000, false)).toBeCloseTo(afterResync + 1, 6);
  });
});
