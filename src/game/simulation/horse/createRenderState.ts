import { wrapRadians } from "../../contracts/math";
import type {
  HorseRenderState,
  InterpolatedHorseRenderState,
} from "../../contracts/renderContract";
import type { HorseState } from "./horseState";

export function createHorseRenderState(state: HorseState): HorseRenderState {
  return {
    tick: state.tick,
    position: { ...state.position },
    yaw: state.yaw,
    speed: state.speed,
    verticalVelocity: state.verticalVelocity,
    gait: state.gait,
    grounded: state.grounded,
    condition: state.condition,
  };
}

export function interpolateHorseRenderState(
  previous: HorseRenderState,
  current: HorseRenderState,
  alpha: number,
): InterpolatedHorseRenderState {
  const safeAlpha = Math.min(1, Math.max(0, alpha));
  const yawDelta = wrapRadians(current.yaw - previous.yaw);

  return {
    tick: current.tick,
    position: {
      x: previous.position.x + (current.position.x - previous.position.x) * safeAlpha,
      y: previous.position.y + (current.position.y - previous.position.y) * safeAlpha,
      z: previous.position.z + (current.position.z - previous.position.z) * safeAlpha,
    },
    yaw: wrapRadians(previous.yaw + yawDelta * safeAlpha),
    speed: previous.speed + (current.speed - previous.speed) * safeAlpha,
    verticalVelocity:
      previous.verticalVelocity +
      (current.verticalVelocity - previous.verticalVelocity) * safeAlpha,
    gait: current.gait,
    grounded: current.grounded,
    condition: current.condition,
    interpolationAlpha: safeAlpha,
  };
}

