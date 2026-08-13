import { beforeAll, describe, expect, it } from "vitest";
import firstIslandJson from "../../docs/contracts/world-spec.first-island.json";
import verticalSliceJson from "../../docs/contracts/world-spec.example.json";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import { validateWorldSpec } from "../../src/game/world/compiler/validateWorldSpec";
import type {
  WorldManifest,
  WorldSpecV3,
  WorldSpecV4,
} from "../../src/game/world/compiler/worldTypes";

const firstIsland = firstIslandJson as unknown as WorldSpecV4;
const verticalSlice = verticalSliceJson as unknown as WorldSpecV3;

describe("first-island compiler contract", () => {
  let slice: WorldManifest;
  let manifest: WorldManifest;

  beforeAll(() => {
    slice = compileWorld(verticalSlice);
    manifest = compileWorld(firstIsland);
  }, 30_000);

  it("keeps the frozen schema-v3 manifest while compiling the authored v4 plan", () => {
    const second = compileWorld(firstIsland);

    expect(slice.manifestHash).toBe("fnv1a64-75ef4f476903558d");
    expect(manifest).toEqual(second);
    expect(manifest.schemaVersion).toBe(4);
    expect(manifest.generatorVersion).toBe("0.5.0");
    expect(manifest.topology).toEqual(firstIsland.topology);
    expect(manifest.regions).toHaveLength(5);
    expect(manifest.chunks).toHaveLength(64);
    expect(manifest.discoveries.filter((discovery) => discovery.mandatory)).toHaveLength(5);
  }, 30_000);

  it("compiles the coastal cycle, safe highland approaches, and expressive shortcuts exactly", () => {
    expect(manifest.routes.filter((route) => route.role === "coastal-loop")).toHaveLength(4);
    expect(manifest.routes.filter((route) => route.kind === "safe" && route.mandatory)).toHaveLength(6);
    expect(manifest.routes.filter((route) => route.role === "interior-shortcut")).toHaveLength(4);
    expect(manifest.routes.every((route) => route.waypoints.length >= 2)).toBe(true);
    expect(manifest.routes.every((route) => route.waypoints.slice(1).every((point, index) => {
      const previous = route.waypoints[index];
      return previous ? Math.hypot(point.x - previous.x, point.z - previous.z) <= 16.01 : false;
    }))).toBe(true);
  });

  it("compiles five separated regional traces and a high final pasture", () => {
    const traces = manifest.discoveries.filter((discovery) => discovery.mandatory);
    expect(new Set(traces.map((trace) => trace.regionId)).size).toBe(5);
    const finalTrace = traces.find((trace) => trace.id === "blackstone-living-herd");
    expect(finalTrace?.progression.prerequisiteIds).toHaveLength(4);
    expect(finalTrace?.position.y).toBeGreaterThanOrEqual(45);
    for (let leftIndex = 0; leftIndex < traces.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < traces.length; rightIndex += 1) {
        const left = traces[leftIndex];
        const right = traces[rightIndex];
        if (!left || !right) continue;
        expect(Math.hypot(left.position.x - right.position.x, left.position.z - right.position.z))
          .toBeGreaterThanOrEqual(80);
      }
    }
  });

  it("rejects topology, route-role, cue, resting, and final-prerequisite mutations", () => {
    const missingCoastalEdge: WorldSpecV4 = {
      ...firstIsland,
      requiredConnections: firstIsland.requiredConnections.filter(
        (connection) => connection.id !== "river-saltwind-coastal",
      ),
    };
    expect(validateWorldSpec(missingCoastalEdge).some((issue) =>
      issue.message.includes("safe coastal edge"))).toBe(true);

    const badShortcut: WorldSpecV4 = {
      ...firstIsland,
      requiredConnections: firstIsland.requiredConnections.map((connection) =>
        connection.id === "fernwood-blackstone-ridge"
          ? { ...connection, mandatory: true }
          : connection),
    };
    expect(validateWorldSpec(badShortcut).some((issue) =>
      issue.message.includes("interior-shortcut"))).toBe(true);

    const duplicateCue: WorldSpecV4 = {
      ...firstIsland,
      discoveries: firstIsland.discoveries.map((discovery) =>
        discovery.id === "storm-beach-hoofprints"
          ? { ...discovery, signals: discovery.signals.map((signal) => ({ ...signal, kind: "tracks" as const })) }
          : discovery),
    };
    expect(validateWorldSpec(duplicateCue).some((issue) =>
      issue.message.includes("distinct cue"))).toBe(true);

    const tooFewRests: WorldSpecV4 = {
      ...firstIsland,
      discoveries: firstIsland.discoveries.filter(
        (discovery) => discovery.id !== "longgrass-resting-hollow",
      ),
    };
    expect(validateWorldSpec(tooFewRests).some((issue) =>
      issue.message.includes("two optional resting hollows"))).toBe(true);

    const brokenFinal: WorldSpecV4 = {
      ...firstIsland,
      discoveries: firstIsland.discoveries.map((discovery) =>
        discovery.id === "blackstone-living-herd"
          ? { ...discovery, progression: { ...discovery.progression, prerequisiteIds: [] } }
          : discovery),
    };
    expect(validateWorldSpec(brokenFinal).some((issue) =>
      issue.message.includes("other four traces"))).toBe(true);
  });
});
