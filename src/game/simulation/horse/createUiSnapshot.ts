import type { UiSnapshot } from "../../contracts/uiContract";
import type { HorseState } from "./horseState";
import type { HorseTuning } from "./horseTuning";
import { DEFAULT_HORSE_TUNING } from "./horseTuning";

export function createHorseLabUiSnapshot(
  state: HorseState,
  paused: boolean,
  tuning: HorseTuning = DEFAULT_HORSE_TUNING,
): UiSnapshot {
  return {
    mode: paused ? "paused" : state.condition === "stumbling" ? "recovering" : "playing",
    gait: state.gait,
    speedMetersPerSecond: state.speed,
    grounded: state.grounded,
    canJump:
      state.condition === "normal" &&
      !state.jumpConsumedSinceGrounded &&
      state.tick - state.lastGroundedTick <= tuning.coyoteTicks,
    canReset: true,
    controlContext: "horse-lab",
    objectiveId: null,
    worldId: null,
    currentRegionId: null,
    objective: null,
    knownDiscoveries: [],
    contextualInteraction: null,
    completedMandatoryDiscoveries: 0,
    totalMandatoryDiscoveries: 0,
    journeyComplete: false,
    persistence: { status: "unavailable", lastSavedTick: null },
  };
}
