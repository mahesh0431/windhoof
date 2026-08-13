import { describe, expect, it } from "vitest";
import specJson from "../../docs/contracts/world-spec.example.json";
import { AutosaveCoordinator } from "../../src/game/save/autosaveCoordinator";
import { MemorySaveAdapter } from "../../src/game/save/memorySaveAdapter";
import type { SaveAdapter } from "../../src/game/save/saveAdapter";
import {
  createGameSave,
  decodeGameSave,
  inspectGameSave,
  restoreGameSave,
  type GameSaveV1,
} from "../../src/game/save/saveSchema";
import { createExplorationState } from "../../src/game/simulation/exploration/explorationState";
import { createInitialHorseState } from "../../src/game/simulation/horse/horseState";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type { WorldSpec } from "../../src/game/world/compiler/worldTypes";

const manifest = compileWorld(specJson as unknown as WorldSpec);

function fixtureSave(playTimeTicks = 42): GameSaveV1 {
  const horse = createInitialHorseState({
    position: { ...manifest.spawn.position },
    yaw: manifest.spawn.yaw,
  });
  const exploration = createExplorationState(
    manifest,
    { "first-herd-trace": "completed" },
    playTimeTicks,
  );
  return createGameSave(manifest, horse, exploration);
}

describe("versioned game save", () => {
  it("round-trips only saveable simulation truth", () => {
    const save = fixtureSave();
    expect(decodeGameSave(structuredClone(save))).toEqual({ ok: true, save });
    expect(Object.keys(save).sort()).toEqual([
      "discoveryStates",
      "generatorVersion",
      "lastSafePose",
      "manifestHash",
      "playTimeTicks",
      "saveVersion",
      "worldId",
      "worldSeed",
    ]);
  });

  it("reports every incompatibility explicitly", () => {
    const save = fixtureSave();
    expect(inspectGameSave(null, manifest).status).toBe("none");
    expect(inspectGameSave({ ...save, saveVersion: 2 }, manifest).status).toBe(
      "unsupported-version",
    );
    expect(inspectGameSave({ ...save, playTimeTicks: -1 }, manifest).status).toBe("corrupt");
    expect(inspectGameSave({ ...save, worldId: "other" }, manifest).status).toBe("wrong-world");
    expect(inspectGameSave({ ...save, generatorVersion: "other" }, manifest).status).toBe(
      "generator-mismatch",
    );
    expect(inspectGameSave({ ...save, manifestHash: "other" }, manifest).status).toBe(
      "manifest-mismatch",
    );
    const missingDiscovery = { ...save.discoveryStates };
    delete missingDiscovery["first-overlook"];
    expect(
      inspectGameSave({ ...save, discoveryStates: missingDiscovery }, manifest).status,
    ).toBe("corrupt");
    expect(
      inspectGameSave({
        ...save,
        discoveryStates: {
          ...save.discoveryStates,
          "first-overlook": "completed",
          "spring-resting-hollow": "hidden",
        },
      }, manifest).status,
    ).toBe("corrupt");
    expect(inspectGameSave(save, manifest).status).toBe("compatible");
    expect(inspectGameSave({
      ...save,
      discoveryStates: {
        ...save.discoveryStates,
        "first-overlook": "visited",
        "spring-resting-hollow": "hidden",
      },
    }, manifest).status).toBe("compatible");
  });

  it("falls back to manifest spawn for an unsafe pose while preserving progress", () => {
    const save = {
      ...fixtureSave(),
      lastSafePose: { position: { x: 999, y: 999, z: 999 }, yaw: 1 },
    };
    const restored = restoreGameSave(save, manifest, () => false);
    expect(restored.poseSource).toBe("manifest-spawn");
    expect(restored.pose).toEqual({
      position: manifest.spawn.position,
      yaw: manifest.spawn.yaw,
    });
    expect(restored.discoveryStates["first-herd-trace"]).toBe("completed");
    expect(restored.playTimeTicks).toBe(save.playTimeTicks);
  });

  it("reads, writes, and removes through the memory adapter", async () => {
    const adapter = new MemorySaveAdapter();
    expect(await adapter.read()).toBeNull();
    const save = fixtureSave();
    await adapter.write(save);
    expect(await adapter.read()).toEqual(save);
    await adapter.remove();
    expect(await adapter.read()).toBeNull();
  });

  it("serializes and coalesces async writes so the newest tick wins", async () => {
    const writes: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const adapter: SaveAdapter = {
      read: async () => null,
      remove: async () => undefined,
      write: async (save) => {
        if (writes.length === 0) await firstBlocked;
        writes.push(save.playTimeTicks);
      },
    };
    const coordinator = new AutosaveCoordinator(adapter);
    coordinator.request(fixtureSave(10));
    coordinator.request(fixtureSave(20));
    coordinator.request(fixtureSave(30));
    coordinator.request(fixtureSave(5));
    releaseFirst?.();
    await coordinator.flush();
    expect(writes).toEqual([10, 30]);
    expect(coordinator.snapshot()).toEqual({ status: "saved", lastSavedTick: 30 });
  });

  it("retains the newest pending save when an older write fails", async () => {
    const attempts: number[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let first = true;
    const adapter: SaveAdapter = {
      read: async () => null,
      remove: async () => undefined,
      write: async (save) => {
        attempts.push(save.playTimeTicks);
        if (first) {
          first = false;
          await firstBlocked;
          throw new Error("storage unavailable");
        }
      },
    };
    const coordinator = new AutosaveCoordinator(adapter);
    coordinator.request(fixtureSave(10));
    coordinator.request(fixtureSave(20));
    releaseFirst?.();
    await coordinator.flush();
    expect(coordinator.snapshot()).toEqual({ status: "error", lastSavedTick: null });

    coordinator.retry();
    await coordinator.flush();
    expect(attempts).toEqual([10, 20]);
    expect(coordinator.snapshot()).toEqual({ status: "saved", lastSavedTick: 20 });
  });
});
