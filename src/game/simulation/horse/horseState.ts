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
  };
}
