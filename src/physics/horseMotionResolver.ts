import type { Vec3 } from "../game/contracts/math";
import type { HorseState } from "../game/simulation/horse/horseState";

export interface HorseMotionResult {
  readonly position: Vec3;
  readonly grounded: boolean;
  readonly hitCeiling: boolean;
  /** A wall-like contact opposing requested horizontal travel. */
  readonly blockedHorizontally: boolean;
  readonly safeGround: boolean;
}

/** Physics owns collision correction, never horse intent or gait rules. */
export interface HorseMotionResolver {
  resolve(
    state: HorseState,
    desiredTranslation: Vec3,
    fixedStepSeconds: number,
  ): HorseMotionResult;
  teleport?(position: Vec3): void;
}
