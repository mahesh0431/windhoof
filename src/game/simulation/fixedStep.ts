export interface FixedStepResult {
  readonly steps: number;
  readonly interpolationAlpha: number;
  readonly droppedSeconds: number;
}

export interface FixedStepOptions {
  readonly stepSeconds?: number;
  readonly maximumFrameSeconds?: number;
  readonly maximumSubsteps?: number;
}

/**
 * Keeps simulation time independent from render timing and prevents a stalled
 * tab from producing an unbounded catch-up spiral.
 */
export class FixedStepClock {
  private accumulatorSeconds = 0;
  private readonly stepSeconds: number;
  private readonly maximumFrameSeconds: number;
  private readonly maximumSubsteps: number;

  public constructor(options: FixedStepOptions = {}) {
    this.stepSeconds = options.stepSeconds ?? 1 / 60;
    this.maximumFrameSeconds = options.maximumFrameSeconds ?? 0.25;
    this.maximumSubsteps = options.maximumSubsteps ?? 8;

    if (this.stepSeconds <= 0) throw new Error("stepSeconds must be positive");
    if (this.maximumFrameSeconds <= 0) {
      throw new Error("maximumFrameSeconds must be positive");
    }
    if (!Number.isInteger(this.maximumSubsteps) || this.maximumSubsteps < 1) {
      throw new Error("maximumSubsteps must be a positive integer");
    }
  }

  public advance(frameSeconds: number, simulate: () => void): FixedStepResult {
    const clampedFrameSeconds = Math.min(
      Math.max(Number.isFinite(frameSeconds) ? frameSeconds : 0, 0),
      this.maximumFrameSeconds,
    );
    this.accumulatorSeconds += clampedFrameSeconds;

    let steps = 0;
    while (
      this.accumulatorSeconds + Number.EPSILON >= this.stepSeconds &&
      steps < this.maximumSubsteps
    ) {
      simulate();
      this.accumulatorSeconds -= this.stepSeconds;
      steps += 1;
    }

    let droppedSeconds = 0;
    if (this.accumulatorSeconds >= this.stepSeconds) {
      const retainedSeconds = this.accumulatorSeconds % this.stepSeconds;
      droppedSeconds = this.accumulatorSeconds - retainedSeconds;
      this.accumulatorSeconds = retainedSeconds;
    }

    return {
      steps,
      interpolationAlpha: this.accumulatorSeconds / this.stepSeconds,
      droppedSeconds,
    };
  }

  public reset(): void {
    this.accumulatorSeconds = 0;
  }
}

