import {
  DISCOVERY_STATE_ORDER,
  discoveryStateRank,
  type DiscoveryState,
} from "../../contracts/discovery";
import type { HorseInputFrame } from "../../contracts/input";
import type { AutosaveReason } from "../../contracts/save";
import type { GameEvent } from "../../contracts/uiContract";
import type {
  CompiledDiscovery,
  CompiledJourneyEvent,
  WorldManifest,
} from "../../world/compiler/worldTypes";
import type { HorseState } from "../horse/horseState";
import {
  isHorseSafelyGrounded,
  type ExplorationState,
} from "./explorationState";

export const PERIODIC_AUTOSAVE_TICKS = 60 * 60 * 5;

export interface ExplorationStepResult {
  readonly state: ExplorationState;
  readonly events: readonly GameEvent[];
}

function distanceToHorse(discovery: CompiledDiscovery, horse: HorseState): number {
  return Math.hypot(
    discovery.position.x - horse.position.x,
    discovery.position.z - horse.position.z,
  );
}

function eventDistance(event: CompiledJourneyEvent, horse: HorseState): number {
  return Math.hypot(
    event.position.x - horse.position.x,
    event.position.z - horse.position.z,
  );
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

export function stepExploration(
  manifest: WorldManifest,
  current: ExplorationState,
  horse: HorseState,
  input: HorseInputFrame,
): ExplorationStepResult {
  const tick = horse.tick;
  const playTimeTicks = current.playTimeTicks + 1;
  // Eligibility is frozen at tick start. Transitions emitted on this tick may
  // unlock a dependent discovery only on the next authoritative tick.
  const eligibilityStates = current.discoveryStates;
  const states: Record<string, DiscoveryState> = { ...current.discoveryStates };
  const lingerTicks: Record<string, number> = { ...current.lingerTicks };
  const pendingResponseTicks: Record<string, number> = {
    ...current.pendingResponseTicks,
  };
  const events: GameEvent[] = [];
  let lastPeriodicAutosaveTick = current.lastPeriodicAutosaveTick;
  let journeyCompleted = current.journeyCompleted;

  const orderedDiscoveries = [...manifest.discoveries].sort((left, right) =>
    left.stableId.localeCompare(right.stableId));

  const transition = (discovery: CompiledDiscovery, target: DiscoveryState): void => {
    let previous = states[discovery.id] ?? "hidden";
    const targetRank = discoveryStateRank(target);
    if (targetRank <= discoveryStateRank(previous)) return;
    for (let rank = discoveryStateRank(previous) + 1; rank <= targetRank; rank += 1) {
      const state = DISCOVERY_STATE_ORDER[rank];
      if (!state) continue;
      states[discovery.id] = state;
      events.push({
        type: "DiscoveryStateChanged",
        tick,
        discoveryId: discovery.id,
        previousState: previous,
        state,
      });
      previous = state;
    }
  };

  const requestAutosave = (
    reason: AutosaveReason,
    discoveryId?: string,
  ): void => {
    const event: GameEvent = discoveryId
      ? { type: "AutosaveRequested", tick, reason, discoveryId }
      : { type: "AutosaveRequested", tick, reason };
    events.push(event);
    lastPeriodicAutosaveTick = playTimeTicks;
  };

  const complete = (discovery: CompiledDiscovery, autosave = true): void => {
    if (states[discovery.id] === "completed") return;
    transition(discovery, "completed");
    if (!autosave || !discovery.progression.autosave) return;
    requestAutosave(
      discovery.type === "resting-hollow" ? "resting-hollow" : "major-discovery",
      discovery.id,
    );
  };

  // Discovery and visit are physical facts and therefore support sequence
  // breaking. Prerequisites guide completion, not what the player can find.
  for (const discovery of orderedDiscoveries) {
    const distance = distanceToHorse(discovery, horse);
    const reveal = discovery.progression.reveal;
    if (
      (states[discovery.id] ?? "hidden") === "hidden" &&
      reveal.kind === "proximity" &&
      distance <= reveal.radiusMeters
    ) {
      transition(discovery, "revealed");
    }
    if (
      discoveryStateRank(states[discovery.id] ?? "hidden") >=
        discoveryStateRank("revealed") &&
      states[discovery.id] !== "completed" &&
      distance <= discovery.progression.visitRadiusMeters
    ) {
      transition(discovery, "visited");
    }
    if (states[discovery.id] !== "visited") {
      lingerTicks[discovery.id] = 0;
      continue;
    }
    if (!prerequisitesComplete(discovery, eligibilityStates)) {
      lingerTicks[discovery.id] = 0;
      continue;
    }
    const completion = discovery.progression.completion;
    if (completion.kind === "proximity") {
      complete(discovery);
    } else if (completion.kind === "linger") {
      if (
        distance <= discovery.progression.visitRadiusMeters &&
        isHorseSafelyGrounded(horse)
      ) {
        lingerTicks[discovery.id] = (lingerTicks[discovery.id] ?? 0) + 1;
        if ((lingerTicks[discovery.id] ?? 0) >= completion.ticks) {
          complete(discovery);
        }
      } else {
        lingerTicks[discovery.id] = 0;
      }
    }
  }

  // Responses already scheduled by a previous call resolve on their exact tick.
  for (const event of [...manifest.journeyEvents].sort((left, right) =>
    left.stableId.localeCompare(right.stableId))) {
    const dueTick = pendingResponseTicks[event.id];
    if (dueTick === undefined || dueTick > tick) continue;
    const revealedDiscoveryIds: string[] = [];
    const targets = event.revealDiscoveryIds
      .map((id) => manifest.discoveries.find((candidate) => candidate.id === id))
      .filter((discovery): discovery is CompiledDiscovery => discovery !== undefined)
      .sort((left, right) => left.stableId.localeCompare(right.stableId));
    for (const discovery of targets) {
      if (states[discovery.id] !== "hidden") continue;
      transition(discovery, "revealed");
      revealedDiscoveryIds.push(discovery.id);
    }
    delete pendingResponseTicks[event.id];
    events.push({
      type: "CallAnswered",
      tick,
      eventId: event.id,
      sourceDiscoveryId: event.anchorDiscoveryId,
      position: { ...event.position },
      revealedDiscoveryIds,
    });
  }

  if (input.callPressed) {
    const answer = manifest.journeyEvents
      .filter((event) =>
        pendingResponseTicks[event.id] === undefined &&
        eventPrerequisitesComplete(event, eligibilityStates) &&
        event.revealDiscoveryIds.some((id) => states[id] === "hidden") &&
        eventDistance(event, horse) <= event.triggerRadiusMeters)
      .map((event) => ({ event, distance: eventDistance(event, horse) }))
      .sort((left, right) =>
        left.distance - right.distance || left.event.stableId.localeCompare(right.event.stableId))[0]
      ?.event;
    if (answer) pendingResponseTicks[answer.id] = tick + answer.responseDelayTicks;

    const callCompletion = orderedDiscoveries
      .filter((discovery) =>
        states[discovery.id] === "visited" &&
        prerequisitesComplete(discovery, eligibilityStates) &&
        discovery.progression.completion.kind === "call" &&
        distanceToHorse(discovery, horse) <= discovery.progression.visitRadiusMeters)
      .map((discovery) => ({ discovery, distance: distanceToHorse(discovery, horse) }))
      .sort((left, right) =>
        left.distance - right.distance ||
        left.discovery.stableId.localeCompare(right.discovery.stableId))[0]
      ?.discovery;
    if (callCompletion) complete(callCompletion);
  }

  if (input.interactPressed && isHorseSafelyGrounded(horse)) {
    const interaction = orderedDiscoveries
      .filter((discovery) => {
        if (discovery.progression.completion.kind !== "interact") return false;
        if (!prerequisitesComplete(discovery, eligibilityStates)) return false;
        const state = states[discovery.id] ?? "hidden";
        const reusableRest =
          state === "completed" && discovery.progression.completion.interaction === "rest";
        return (state === "visited" || reusableRest) &&
          distanceToHorse(discovery, horse) <= discovery.progression.visitRadiusMeters;
      })
      .map((discovery) => ({ discovery, distance: distanceToHorse(discovery, horse) }))
      .sort((left, right) =>
        left.distance - right.distance ||
        left.discovery.stableId.localeCompare(right.discovery.stableId))[0]
      ?.discovery;

    if (interaction && interaction.progression.completion.kind === "interact") {
      const interactionKind = interaction.progression.completion.interaction;
      events.push({
        type: "InteractionPerformed",
        tick,
        discoveryId: interaction.id,
        interaction: interactionKind,
      });
      const wasCompleted = states[interaction.id] === "completed";
      if (interactionKind === "rest") {
        if (!wasCompleted) complete(interaction, false);
        events.push({
          type: "RestCompleted",
          tick,
          discoveryId: interaction.id,
          safePose: {
            position: { ...horse.lastSafePose.position },
            yaw: horse.lastSafePose.yaw,
          },
        });
        if (interaction.progression.autosave) {
          requestAutosave("resting-hollow", interaction.id);
        }
      } else if (!wasCompleted) {
        complete(interaction);
      }
    }
  }

  const mandatoryComplete = manifest.discoveries
    .filter((discovery) => discovery.mandatory)
    .every((discovery) => states[discovery.id] === "completed");
  if (mandatoryComplete && !journeyCompleted) {
    journeyCompleted = true;
    events.push({ type: "JourneyCompleted", tick });
  }

  if (
    playTimeTicks - lastPeriodicAutosaveTick >= PERIODIC_AUTOSAVE_TICKS &&
    isHorseSafelyGrounded(horse)
  ) {
    requestAutosave("periodic-safe-ground");
  }

  return {
    state: {
      playTimeTicks,
      discoveryStates: states,
      lingerTicks,
      pendingResponseTicks,
      lastPeriodicAutosaveTick,
      journeyCompleted,
    },
    events,
  };
}
