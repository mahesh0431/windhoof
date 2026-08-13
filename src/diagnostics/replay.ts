import type { HorseInputFrame } from "../game/contracts/input";
import type { HorseState } from "../game/simulation/horse/horseState";
import type { HorseTuning } from "../game/simulation/horse/horseTuning";
import { DEFAULT_HORSE_TUNING } from "../game/simulation/horse/horseTuning";
import { stepHorse } from "../game/simulation/horse/horseController";
import type { HorseMotionResolver } from "../physics/horseMotionResolver";

export interface ReplayResult {
  readonly finalState: HorseState;
  readonly gaitSequence: readonly HorseState["gait"][];
}

export function replayHorseInputs(
  initialState: HorseState,
  inputs: readonly HorseInputFrame[],
  motionResolver: HorseMotionResolver,
  tuning: HorseTuning = DEFAULT_HORSE_TUNING,
): ReplayResult {
  const gaitSequence: HorseState["gait"][] = [];
  let state = initialState;

  for (const input of inputs) {
    state = stepHorse(state, input, motionResolver, tuning).state;
    gaitSequence.push(state.gait);
  }

  return { finalState: state, gaitSequence };
}

export function quantizedHorseSnapshot(state: HorseState): string {
  const quantize = (value: number): number => Math.round(value * 10_000) / 10_000;
  return JSON.stringify({
    tick: state.tick,
    position: {
      x: quantize(state.position.x),
      y: quantize(state.position.y),
      z: quantize(state.position.z),
    },
    yaw: quantize(state.yaw),
    speed: quantize(state.speed),
    verticalVelocity: quantize(state.verticalVelocity),
    gait: state.gait,
    grounded: state.grounded,
    condition: state.condition,
    recoveryTicksRemaining: state.recoveryTicksRemaining,
  });
}

