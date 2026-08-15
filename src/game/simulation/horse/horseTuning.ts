export interface HorseTuning {
  readonly fixedStepSeconds: number;
  readonly walkSpeed: number;
  readonly trotSpeed: number;
  readonly canterSpeed: number;
  readonly gallopSpeed: number;
  readonly acceleration: number;
  readonly gallopAcceleration: number;
  readonly braking: number;
  readonly coastingDeceleration: number;
  readonly walkTurnRate: number;
  readonly gallopTurnRate: number;
  readonly jumpVelocity: number;
  readonly gravity: number;
  readonly coyoteTicks: number;
  readonly hardLandingSpeed: number;
  readonly stumbleTicks: number;
  /**
   * How fast an unasked-for shove bleeds away, as an exponential rate.
   *
   * A shove of `v` metres a second carries the horse about `v / shoveDecay`
   * metres in total, so this is really "how far a kick throws you" in disguise.
   * At 16 - the first number tried here - a seven metre a second kick moved the
   * horse thirty centimetres, which is not a kick, it is a nudge.
   */
  readonly shoveDecay: number;
  /** Ticks of stumbling a kick costs the player. */
  readonly shoveStumbleTicks: number;
  readonly safePoseMaximumSpeed: number;
  readonly inputDeadZone: number;
}

export const DEFAULT_HORSE_TUNING: HorseTuning = Object.freeze({
  fixedStepSeconds: 1 / 60,
  walkSpeed: 2.2,
  trotSpeed: 5,
  canterSpeed: 9,
  gallopSpeed: 16,
  acceleration: 5.2,
  gallopAcceleration: 4.2,
  braking: 9,
  coastingDeceleration: 3.4,
  walkTurnRate: 1.9,
  gallopTurnRate: 0.62,
  jumpVelocity: 7.2,
  gravity: 19,
  coyoteTicks: 6,
  hardLandingSpeed: 9.5,
  stumbleTicks: 36,
  shoveDecay: 4.5,
  shoveStumbleTicks: 30,
  safePoseMaximumSpeed: 1,
  inputDeadZone: 0.12,
});

