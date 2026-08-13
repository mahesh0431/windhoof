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
  safePoseMaximumSpeed: 1,
  inputDeadZone: 0.12,
});

