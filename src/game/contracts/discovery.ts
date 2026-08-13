export const DISCOVERY_STATE_ORDER = [
  "hidden",
  "revealed",
  "visited",
  "completed",
] as const;

export type DiscoveryState = (typeof DISCOVERY_STATE_ORDER)[number];

export type DiscoveryKind =
  | "herd-trace"
  | "resting-hollow"
  | "overlook"
  | "wildlife-event"
  | "human-structure"
  | "shortcut"
  | "environmental-event";

export interface KnownDiscoverySnapshot {
  readonly id: string;
  readonly kind: DiscoveryKind;
  readonly state: Exclude<DiscoveryState, "hidden">;
  readonly mandatory: boolean;
  readonly journeyOrder: number;
}

export interface ContextualInteraction {
  readonly discoveryId: string;
  readonly kind: "inspect" | "rest";
}

export interface ActiveObjective {
  readonly kind: "discovery" | "journey-event";
  readonly id: string;
}

export function discoveryStateRank(state: DiscoveryState): number {
  return DISCOVERY_STATE_ORDER.indexOf(state);
}

export function isKnownDiscoveryState(
  state: DiscoveryState,
): state is Exclude<DiscoveryState, "hidden"> {
  return state !== "hidden";
}
