import type {
  ActiveObjective,
  ContextualInteraction,
  DiscoveryState,
  KnownDiscoverySnapshot,
} from "../../contracts/discovery";
import { isKnownDiscoveryState } from "../../contracts/discovery";
import type { HorseState } from "../horse/horseState";
import type {
  CompiledDiscovery,
  CompiledJourneyEvent,
  WorldManifest,
} from "../../world/compiler/worldTypes";

export interface ExplorationState {
  readonly playTimeTicks: number;
  readonly discoveryStates: Readonly<Record<string, DiscoveryState>>;
  readonly lingerTicks: Readonly<Record<string, number>>;
  readonly pendingResponseTicks: Readonly<Record<string, number>>;
  readonly lastPeriodicAutosaveTick: number;
  readonly journeyCompleted: boolean;
}

export interface ExplorationSnapshot {
  readonly playTimeTicks: number;
  readonly knownDiscoveries: readonly KnownDiscoverySnapshot[];
  readonly objective: ActiveObjective | null;
  readonly contextualInteraction: ContextualInteraction | null;
  readonly completedMandatoryDiscoveries: number;
  readonly totalMandatoryDiscoveries: number;
  readonly journeyComplete: boolean;
}

export function createExplorationState(
  manifest: WorldManifest,
  restored: Readonly<Record<string, DiscoveryState>> = {},
  playTimeTicks = 0,
): ExplorationState {
  const discoveryStates = Object.fromEntries(
    manifest.discoveries.map((discovery) => [
      discovery.id,
      restored[discovery.id] ?? "hidden",
    ]),
  );
  const journeyCompleted = manifest.discoveries
    .filter((discovery) => discovery.mandatory)
    .every((discovery) => discoveryStates[discovery.id] === "completed");

  return {
    playTimeTicks,
    discoveryStates,
    lingerTicks: {},
    pendingResponseTicks: {},
    lastPeriodicAutosaveTick: playTimeTicks,
    journeyCompleted,
  };
}

function prerequisitesComplete(
  discovery: CompiledDiscovery,
  states: Readonly<Record<string, DiscoveryState>>,
): boolean {
  return discovery.progression.prerequisiteIds.every(
    (id) => states[id] === "completed",
  );
}

function eventPrerequisitesComplete(
  event: CompiledJourneyEvent,
  states: Readonly<Record<string, DiscoveryState>>,
): boolean {
  return event.prerequisiteDiscoveryIds.every((id) => states[id] === "completed");
}

function horizontalDistance(
  left: { readonly x: number; readonly z: number },
  right: { readonly x: number; readonly z: number },
): number {
  return Math.hypot(left.x - right.x, left.z - right.z);
}

export function isHorseSafelyGrounded(horse: HorseState): boolean {
  const safe = horse.lastSafePose.position;
  return horse.grounded &&
    horse.condition === "normal" &&
    horse.speed <= 0.5 &&
    Math.abs(horse.position.x - safe.x) <= 0.001 &&
    Math.abs(horse.position.y - safe.y) <= 0.001 &&
    Math.abs(horse.position.z - safe.z) <= 0.001;
}

export function contextualInteractionFor(
  manifest: WorldManifest,
  state: ExplorationState,
  horse: HorseState,
): ContextualInteraction | null {
  if (!isHorseSafelyGrounded(horse)) return null;

  const candidates = manifest.discoveries
    .filter((discovery) => {
      const discoveryState = state.discoveryStates[discovery.id] ?? "hidden";
      if (discovery.progression.completion.kind !== "interact") return false;
      if (!prerequisitesComplete(discovery, state.discoveryStates)) return false;
      const reusableRest =
        discoveryState === "completed" &&
        discovery.progression.completion.interaction === "rest";
      if (discoveryState !== "visited" && !reusableRest) return false;
      return horizontalDistance(horse.position, discovery.position) <=
        discovery.progression.visitRadiusMeters;
    })
    .map((discovery) => ({
      discovery,
      distance: horizontalDistance(horse.position, discovery.position),
    }))
    .sort((left, right) =>
      left.distance - right.distance ||
      left.discovery.stableId.localeCompare(right.discovery.stableId));

  const nearest = candidates[0]?.discovery;
  if (!nearest || nearest.progression.completion.kind !== "interact") return null;
  return {
    discoveryId: nearest.id,
    kind: nearest.progression.completion.interaction,
  };
}

function activeObjectiveFor(
  manifest: WorldManifest,
  state: ExplorationState,
): ActiveObjective | null {
  const knownMandatory = manifest.discoveries
    .filter((discovery) =>
      discovery.mandatory &&
      state.discoveryStates[discovery.id] !== "hidden" &&
      state.discoveryStates[discovery.id] !== "completed" &&
      prerequisitesComplete(discovery, state.discoveryStates))
    .sort((left, right) =>
      left.journeyOrder - right.journeyOrder || left.stableId.localeCompare(right.stableId));
  const known = knownMandatory[0];
  if (known) return { kind: "discovery", id: known.id };

  const event = manifest.journeyEvents
    .filter((candidate) =>
      eventPrerequisitesComplete(candidate, state.discoveryStates) &&
      candidate.revealDiscoveryIds.some(
        (id) => state.discoveryStates[id] === "hidden",
      ))
    .sort((left, right) => left.stableId.localeCompare(right.stableId))[0];
  return event ? { kind: "journey-event", id: event.id } : null;
}

export function createExplorationSnapshot(
  manifest: WorldManifest,
  state: ExplorationState,
  horse: HorseState,
): ExplorationSnapshot {
  const knownDiscoveries = manifest.discoveries
    .filter((discovery) =>
      isKnownDiscoveryState(state.discoveryStates[discovery.id] ?? "hidden"))
    .map((discovery) => ({
      id: discovery.id,
      kind: discovery.type,
      state: state.discoveryStates[discovery.id] as Exclude<DiscoveryState, "hidden">,
      mandatory: discovery.mandatory,
      journeyOrder: discovery.journeyOrder,
    }))
    .sort((left, right) => left.journeyOrder - right.journeyOrder || left.id.localeCompare(right.id));
  const mandatory = manifest.discoveries.filter((discovery) => discovery.mandatory);
  const completedMandatoryDiscoveries = mandatory.filter(
    (discovery) => state.discoveryStates[discovery.id] === "completed",
  ).length;

  return {
    playTimeTicks: state.playTimeTicks,
    knownDiscoveries,
    objective: activeObjectiveFor(manifest, state),
    contextualInteraction: contextualInteractionFor(manifest, state, horse),
    completedMandatoryDiscoveries,
    totalMandatoryDiscoveries: mandatory.length,
    journeyComplete: state.journeyCompleted,
  };
}
