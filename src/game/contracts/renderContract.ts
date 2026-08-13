import type { Vec3 } from "./math";
import type { HorseCondition, HorseGait } from "../simulation/horse/horseState";

export interface HorseRenderState {
  readonly tick: number;
  readonly position: Vec3;
  readonly yaw: number;
  readonly speed: number;
  readonly verticalVelocity: number;
  readonly gait: HorseGait;
  readonly grounded: boolean;
  readonly condition: HorseCondition;
}

export interface InterpolatedHorseRenderState extends HorseRenderState {
  readonly interpolationAlpha: number;
}

