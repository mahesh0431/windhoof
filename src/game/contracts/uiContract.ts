import type {
  ActiveObjective,
  ContextualInteraction,
  DiscoveryState,
  KnownDiscoverySnapshot,
} from "./discovery";
import type { Pose, Vec3 } from "./math";
import type { AutosaveReason, PersistenceSnapshot } from "./save";
import type { HorseGait } from "../simulation/horse/horseState";

export interface UiSnapshot {
  readonly mode: "loading" | "playing" | "paused" | "recovering";
  readonly gait: HorseGait;
  readonly speedMetersPerSecond: number;
  readonly grounded: boolean;
  readonly canJump: boolean;
  readonly canReset: boolean;
  readonly controlContext: "horse-lab" | "island";
  readonly objectiveId: string | null;
  readonly worldId: string | null;
  readonly currentRegionId: string | null;
  readonly objective: ActiveObjective | null;
  readonly knownDiscoveries: readonly KnownDiscoverySnapshot[];
  readonly contextualInteraction: ContextualInteraction | null;
  readonly completedMandatoryDiscoveries: number;
  readonly totalMandatoryDiscoveries: number;
  readonly journeyComplete: boolean;
  readonly persistence: PersistenceSnapshot;
}

export type GameEvent =
  | { readonly type: "HorseGaitChanged"; readonly gait: HorseGait }
  | { readonly type: "HorseJumped" }
  | { readonly type: "HorseLanded"; readonly hard: boolean }
  | { readonly type: "HorseCalled" }
  | { readonly type: "HorseReset" }
  | { readonly type: "PauseChanged"; readonly paused: boolean }
  | {
      readonly type: "DiscoveryStateChanged";
      readonly tick: number;
      readonly discoveryId: string;
      readonly previousState: DiscoveryState;
      readonly state: DiscoveryState;
    }
  | {
      readonly type: "CallAnswered";
      readonly tick: number;
      readonly eventId: string;
      readonly sourceDiscoveryId: string;
      readonly position: Vec3;
      readonly revealedDiscoveryIds: readonly string[];
    }
  | {
      readonly type: "InteractionPerformed";
      readonly tick: number;
      readonly discoveryId: string;
      readonly interaction: "inspect" | "rest";
    }
  | {
      readonly type: "RestCompleted";
      readonly tick: number;
      readonly discoveryId: string;
      readonly safePose: Pose;
    }
  | {
      readonly type: "AutosaveRequested";
      readonly tick: number;
      readonly reason: AutosaveReason;
      readonly discoveryId?: string;
    }
  | { readonly type: "JourneyCompleted"; readonly tick: number }
  | {
      readonly type: "PersistenceStatusChanged";
      readonly status: PersistenceSnapshot["status"];
      readonly savedTick: number | null;
    };

export type GameCommand =
  | { readonly type: "Resume" }
  | { readonly type: "Pause" }
  | { readonly type: "ResetToSafeGround" }
  | { readonly type: "StartNewJourney" }
  | { readonly type: "SetCameraSensitivity"; readonly value: number }
  | { readonly type: "SetReducedMotion"; readonly enabled: boolean };
