export type AutosaveReason =
  | "major-discovery"
  | "resting-hollow"
  | "periodic-safe-ground";

export type PersistenceStatus =
  | "unavailable"
  | "loading"
  | "ready"
  | "saving"
  | "saved"
  | "error"
  | "incompatible";

export interface PersistenceSnapshot {
  readonly status: PersistenceStatus;
  readonly lastSavedTick: number | null;
}
