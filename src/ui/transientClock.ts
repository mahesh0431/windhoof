/**
 * Real-time clock for transient interface chrome.
 *
 * The app's `elapsedSeconds` is a simulation clock: every frame it accumulates
 * `clamp(rawDelta, 0, 0.1)`, because a frame that took half a second must not be
 * allowed to teleport the horse or jump the water animation. That clamp is
 * correct for simulation and wrong for the interface. On a slow renderer - and
 * headless SwiftShader is very slow - a frame can take far longer than 100 ms,
 * so the simulation clock runs at a fraction of wall time and a "five second"
 * title stayed on screen past fifteen real seconds.
 *
 * A player reads a title in real seconds. They have no idea the renderer is
 * behind, and a caption that overstays because the machine is struggling is
 * exactly the interface-as-dashboard failure the experience brief rules out. So
 * transient presentation is timed against `performance.now()` instead.
 *
 * Paused time does not count. Pausing three seconds into a five second title and
 * coming back ten minutes later should leave two seconds of title, not none: the
 * pause was not time the player spent reading.
 *
 * Kept free of the DOM and of `performance` itself so the policy can be tested
 * without a browser - the caller supplies the timestamp.
 */
export interface TransientClock {
  /**
   * Advances to `nowMilliseconds` and returns seconds of real, unpaused time
   * since the clock started. Monotonic and never negative.
   */
  advance(nowMilliseconds: number, paused: boolean): number;
}

export function createTransientClock(): TransientClock {
  let seconds = 0;
  let previous: number | null = null;

  return {
    advance(nowMilliseconds, paused) {
      if (!Number.isFinite(nowMilliseconds)) return seconds;

      // The first call only establishes a baseline. Without this the clock
      // would start at whatever the page's uptime happened to be.
      if (previous === null) {
        previous = nowMilliseconds;
        return seconds;
      }

      const delta = (nowMilliseconds - previous) / 1000;
      previous = nowMilliseconds;

      // Deliberately unclamped: a tab that was hidden for ten minutes should
      // come back with its transients already expired, not with a title still
      // sitting there waiting to be counted down at a hundred milliseconds a
      // frame. A clamp here would reintroduce the bug this exists to fix.
      if (paused || delta <= 0) return seconds;

      seconds += delta;
      return seconds;
    },
  };
}
