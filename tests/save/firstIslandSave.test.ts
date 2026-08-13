import { beforeAll, describe, expect, it } from "vitest";
import firstIslandJson from "../../docs/contracts/world-spec.first-island.json";
import verticalSliceJson from "../../docs/contracts/world-spec.example.json";
import {
  createGameSave,
  inspectGameSave,
  restoreGameSave,
} from "../../src/game/save/saveSchema";
import { createExplorationState } from "../../src/game/simulation/exploration/explorationState";
import { createInitialHorseState } from "../../src/game/simulation/horse/horseState";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type {
  WorldManifest,
  WorldSpecV3,
  WorldSpecV4,
} from "../../src/game/world/compiler/worldTypes";

describe("first-island save compatibility", () => {
  let island: WorldManifest;
  let slice: WorldManifest;
  beforeAll(() => {
    island = compileWorld(firstIslandJson as unknown as WorldSpecV4);
    slice = compileWorld(verticalSliceJson as unknown as WorldSpecV3);
  }, 15_000);

  it("restores completed belonging truth and remains free-roam capable", () => {
    const completed = Object.fromEntries(
      island.discoveries.map((discovery) => [
        discovery.id,
        discovery.mandatory ? "completed" as const : "hidden" as const,
      ]),
    );
    const horse = createInitialHorseState({ position: island.spawn.position, yaw: island.spawn.yaw });
    const exploration = createExplorationState(island, completed, 54_000);
    expect(exploration.journeyCompleted).toBe(true);
    const save = createGameSave(island, horse, exploration);
    expect(inspectGameSave(save, island).status).toBe("compatible");
    const restored = restoreGameSave(save, island, () => true);
    expect(createExplorationState(
      island,
      restored.discoveryStates,
      restored.playTimeTicks,
    ).journeyCompleted).toBe(true);
  });

  it("falls back from an unsafe pose without losing five-trace progress", () => {
    const horse = createInitialHorseState({ position: island.spawn.position, yaw: island.spawn.yaw });
    const progress = createExplorationState(island, {
      "storm-beach-hoofprints": "completed",
      "longgrass-resting-circle-trace": "completed",
    });
    const save = {
      ...createGameSave(island, horse, progress),
      lastSafePose: { position: { x: 900, y: 900, z: 900 }, yaw: 0 },
    };
    const restored = restoreGameSave(save, island, () => false);
    expect(restored.poseSource).toBe("manifest-spawn");
    expect(restored.discoveryStates["storm-beach-hoofprints"]).toBe("completed");
    expect(restored.discoveryStates["longgrass-resting-circle-trace"]).toBe("completed");
  });

  it("quarantines the frozen slice and changed full-island identities explicitly", () => {
    const sliceHorse = createInitialHorseState({ position: slice.spawn.position, yaw: slice.spawn.yaw });
    const sliceSave = createGameSave(slice, sliceHorse, createExplorationState(slice));
    expect(inspectGameSave(sliceSave, island).status).toBe("wrong-world");

    const islandHorse = createInitialHorseState({ position: island.spawn.position, yaw: island.spawn.yaw });
    const islandSave = createGameSave(island, islandHorse, createExplorationState(island));
    expect(inspectGameSave({ ...islandSave, generatorVersion: "0.4.0" }, island).status)
      .toBe("generator-mismatch");
    expect(inspectGameSave({ ...islandSave, manifestHash: "old" }, island).status)
      .toBe("manifest-mismatch");
  });
});
