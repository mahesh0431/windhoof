import type { DiscoveryState } from "../contracts/discovery";
import type { Pose } from "../contracts/math";
import type { HorseState } from "../simulation/horse/horseState";
import type { ExplorationState } from "../simulation/exploration/explorationState";
import type { WorldManifest } from "../world/compiler/worldTypes";

export interface GameSaveV1 {
  readonly saveVersion: 1;
  readonly worldId: string;
  readonly worldSeed: number;
  readonly generatorVersion: string;
  readonly manifestHash: string;
  readonly lastSafePose: Pose;
  readonly discoveryStates: Readonly<Record<string, DiscoveryState>>;
  readonly playTimeTicks: number;
}

export type GameSaveDecodeResult =
  | { readonly ok: true; readonly save: GameSaveV1 }
  | { readonly ok: false; readonly reason: "corrupt" | "unsupported-version" };

export type GameSaveCompatibility =
  | { readonly status: "none" }
  | { readonly status: "corrupt" }
  | { readonly status: "unsupported-version" }
  | { readonly status: "wrong-world" }
  | { readonly status: "generator-mismatch" }
  | { readonly status: "manifest-mismatch" }
  | { readonly status: "compatible"; readonly save: GameSaveV1 };

export interface RestoredGameState {
  readonly pose: Pose;
  readonly poseSource: "saved-safe-pose" | "manifest-spawn";
  readonly discoveryStates: Readonly<Record<string, DiscoveryState>>;
  readonly playTimeTicks: number;
}

const DISCOVERY_STATES = new Set<DiscoveryState>([
  "hidden",
  "revealed",
  "visited",
  "completed",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validPose(value: unknown): value is Pose {
  if (!isRecord(value) || !isRecord(value.position)) return false;
  return finiteNumber(value.position.x) &&
    finiteNumber(value.position.y) &&
    finiteNumber(value.position.z) &&
    finiteNumber(value.yaw);
}

export function decodeGameSave(value: unknown): GameSaveDecodeResult {
  if (!isRecord(value)) return { ok: false, reason: "corrupt" };
  if (value.saveVersion !== 1) {
    return {
      ok: false,
      reason: finiteNumber(value.saveVersion) ? "unsupported-version" : "corrupt",
    };
  }
  if (
    typeof value.worldId !== "string" ||
    !Number.isSafeInteger(value.worldSeed) ||
    (value.worldSeed as number) < 0 ||
    (value.worldSeed as number) > 0xffff_ffff ||
    typeof value.generatorVersion !== "string" ||
    typeof value.manifestHash !== "string" ||
    !validPose(value.lastSafePose) ||
    !isRecord(value.discoveryStates) ||
    !Number.isSafeInteger(value.playTimeTicks) ||
    (value.playTimeTicks as number) < 0
  ) {
    return { ok: false, reason: "corrupt" };
  }
  for (const state of Object.values(value.discoveryStates)) {
    if (typeof state !== "string" || !DISCOVERY_STATES.has(state as DiscoveryState)) {
      return { ok: false, reason: "corrupt" };
    }
  }
  return {
    ok: true,
    save: {
      saveVersion: 1,
      worldId: value.worldId,
      worldSeed: value.worldSeed as number,
      generatorVersion: value.generatorVersion,
      manifestHash: value.manifestHash,
      lastSafePose: {
        position: { ...value.lastSafePose.position },
        yaw: value.lastSafePose.yaw,
      },
      discoveryStates: { ...value.discoveryStates } as Record<string, DiscoveryState>,
      playTimeTicks: value.playTimeTicks as number,
    },
  };
}

export function inspectGameSave(
  value: unknown,
  manifest: WorldManifest,
): GameSaveCompatibility {
  if (value === null || value === undefined) return { status: "none" };
  const decoded = decodeGameSave(value);
  if (!decoded.ok) return { status: decoded.reason };
  const save = decoded.save;
  if (save.worldId !== manifest.worldId || save.worldSeed !== manifest.seed) {
    return { status: "wrong-world" };
  }
  if (save.generatorVersion !== manifest.generatorVersion) {
    return { status: "generator-mismatch" };
  }
  if (save.manifestHash !== manifest.manifestHash) {
    return { status: "manifest-mismatch" };
  }
  const expectedDiscoveryIds = manifest.discoveries.map((discovery) => discovery.id).sort();
  const savedDiscoveryIds = Object.keys(save.discoveryStates).sort();
  if (
    expectedDiscoveryIds.length !== savedDiscoveryIds.length ||
    expectedDiscoveryIds.some((id, index) => id !== savedDiscoveryIds[index])
  ) {
    return { status: "corrupt" };
  }
  for (const discovery of manifest.discoveries) {
    const state = save.discoveryStates[discovery.id] ?? "hidden";
    if (
      state === "completed" &&
      discovery.progression.prerequisiteIds.some(
        (id) => save.discoveryStates[id] !== "completed",
      )
    ) {
      return { status: "corrupt" };
    }
  }
  return { status: "compatible", save };
}

export function restoreGameSave(
  save: GameSaveV1,
  manifest: WorldManifest,
  isSafePose: (pose: Pose) => boolean,
): RestoredGameState {
  const discoveryIds = new Set(manifest.discoveries.map((discovery) => discovery.id));
  const discoveryStates = Object.fromEntries(
    Object.entries(save.discoveryStates).filter(([id]) => discoveryIds.has(id)),
  ) as Record<string, DiscoveryState>;
  const savedPoseIsSafe = isSafePose(save.lastSafePose);
  return {
    pose: savedPoseIsSafe
      ? {
          position: { ...save.lastSafePose.position },
          yaw: save.lastSafePose.yaw,
        }
      : {
          position: { ...manifest.spawn.position },
          yaw: manifest.spawn.yaw,
        },
    poseSource: savedPoseIsSafe ? "saved-safe-pose" : "manifest-spawn",
    discoveryStates,
    playTimeTicks: save.playTimeTicks,
  };
}

export function createGameSave(
  manifest: WorldManifest,
  horse: HorseState,
  exploration: ExplorationState,
): GameSaveV1 {
  return {
    saveVersion: 1,
    worldId: manifest.worldId,
    worldSeed: manifest.seed,
    generatorVersion: manifest.generatorVersion,
    manifestHash: manifest.manifestHash,
    lastSafePose: {
      position: { ...horse.lastSafePose.position },
      yaw: horse.lastSafePose.yaw,
    },
    discoveryStates: { ...exploration.discoveryStates },
    playTimeTicks: exploration.playTimeTicks,
  };
}
