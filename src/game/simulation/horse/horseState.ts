import type { Pose, Vec3 } from "../../contracts/math";

export type HorseGait = "idle" | "walk" | "trot" | "canter" | "gallop";
export type HorseCondition = "normal" | "stumbling";

export interface HorseState {
  readonly tick: number;
  readonly position: Vec3;
  readonly yaw: number;
  readonly speed: number;
  readonly verticalVelocity: number;
  readonly gait: HorseGait;
  readonly grounded: boolean;
  readonly lastGroundedTick: number;
  readonly airborneTicks: number;
  readonly jumpConsumedSinceGrounded: boolean;
  readonly lastSafePose: Pose;
  readonly condition: HorseCondition;
  readonly recoveryTicksRemaining: number;
  /**
   * Velocity the horse is carrying that it did not ask for, in metres a second.
   *
   * Kept in the state rather than applied as a one-off displacement so it
   * decays over several ticks and, more importantly, so it goes through the
   * same `desiredTranslation` the horse's own locomotion does. A shove is
   * resolved by Rapier against the terrain and every collider on it, which
   * means being kicked can never push the player through a rock, off a cliff
   * they were standing clear of, or into a tree.
   */
  readonly shoveX: number;
  readonly shoveZ: number;
}

export function createInitialHorseState(pose: Pose): HorseState {
  return {
    tick: 0,
    position: { ...pose.position },
    yaw: pose.yaw,
    speed: 0,
    verticalVelocity: 0,
    gait: "idle",
    grounded: true,
    lastGroundedTick: 0,
    airborneTicks: 0,
    jumpConsumedSinceGrounded: false,
    lastSafePose: {
      position: { ...pose.position },
      yaw: pose.yaw,
    },
    condition: "normal",
    recoveryTicksRemaining: 0,
    shoveX: 0,
    shoveZ: 0,
  };
}
