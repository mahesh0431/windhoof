import type { PersistenceSnapshot } from "../../contracts/save";
import type { UiSnapshot } from "../../contracts/uiContract";
import type { WorldManifest } from "../../world/compiler/worldTypes";
import { createHorseLabUiSnapshot } from "../horse/createUiSnapshot";
import type { HorseState } from "../horse/horseState";
import { DEFAULT_HORSE_TUNING, type HorseTuning } from "../horse/horseTuning";
import {
  createExplorationSnapshot,
  type ExplorationState,
} from "./explorationState";

export function createIslandUiSnapshot(
  horse: HorseState,
  exploration: ExplorationState,
  manifest: WorldManifest,
  currentRegionId: string,
  paused: boolean,
  persistence: PersistenceSnapshot,
  tuning: HorseTuning = DEFAULT_HORSE_TUNING,
): UiSnapshot {
  const horseSnapshot = createHorseLabUiSnapshot(horse, paused, tuning);
  const journey = createExplorationSnapshot(manifest, exploration, horse);
  return {
    ...horseSnapshot,
    controlContext: "island",
    objectiveId: journey.objective?.id ?? null,
    worldId: manifest.worldId,
    currentRegionId,
    objective: journey.objective,
    knownDiscoveries: journey.knownDiscoveries,
    contextualInteraction: journey.contextualInteraction,
    completedMandatoryDiscoveries: journey.completedMandatoryDiscoveries,
    totalMandatoryDiscoveries: journey.totalMandatoryDiscoveries,
    journeyComplete: journey.journeyComplete,
    persistence,
  };
}
