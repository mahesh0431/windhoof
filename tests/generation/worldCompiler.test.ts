import { describe, expect, it } from "vitest";
import exampleJson from "../../docs/contracts/world-spec.example.json";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import { manifestHash } from "../../src/game/world/compiler/manifestHash";
import { sampleManifest } from "../../src/game/world/runtime/sampleManifest";
import { SeededRandom } from "../../src/game/world/compiler/seededRandom";
import {
  validateWorldSpec,
} from "../../src/game/world/compiler/validateWorldSpec";
import type { WorldSpec } from "../../src/game/world/compiler/worldTypes";

const example = exampleJson as unknown as WorldSpec;

describe("deterministic island compiler", () => {
  it("keeps a known-answer random stream", () => {
    const random = new SeededRandom(123);
    expect(Array.from({ length: 4 }, () => random.next())).toEqual([
      0.7872516233474016,
      0.1785435655619949,
      0.49531551403924823,
      0.23136196262203157,
    ]);
  });

  it("hashes object keys canonically", () => {
    expect(manifestHash({ a: 1, b: { c: 2 } })).toBe(
      manifestHash({ b: { c: 2 }, a: 1 }),
    );
  });

  it("rejects invalid references and grid dimensions", () => {
    const invalid = {
      ...example,
      island: { ...example.island, sizeMeters: 500 },
      spawn: { ...example.spawn, regionId: "missing" },
    };
    const issues = validateWorldSpec(invalid);
    expect(issues.map((issue) => issue.path)).toContain("island");
    expect(issues.map((issue) => issue.path)).toContain("spawn.regionId");
  });

  it("produces exactly the same manifest and hash for the same source", () => {
    const first = compileWorld(example);
    const second = compileWorld(example);
    expect(second).toEqual(first);
    expect(first.manifestHash).toBe(second.manifestHash);
    expect(first.sourceSpecHash).toBe(manifestHash(example));
    expect(example.schemaVersion).toBe(3);
    expect(first.schemaVersion).toBe(3);
  });

  it("rejects the pre-journey schema version instead of misreading it", () => {
    const legacy = { ...example, schemaVersion: 2 } as unknown as WorldSpec;
    expect(validateWorldSpec(legacy)).toContainEqual({
      path: "schemaVersion",
      message: "must equal 3 or 4",
    });
  });

  it("keeps semantic stable ids independent of authored array order", () => {
    const baseline = compileWorld(example);
    const reordered = compileWorld({
      ...example,
      regions: [...example.regions].reverse(),
      discoveries: [...example.discoveries].reverse(),
      journeyEvents: [...example.journeyEvents].reverse(),
      requiredConnections: [...example.requiredConnections].reverse(),
    });
    const identities = (manifest: typeof baseline) => [
      ...manifest.regions,
      ...manifest.discoveries,
      ...manifest.journeyEvents,
      ...manifest.routes,
    ].map((record) => [record.id, record.stableId]).sort(([left], [right]) =>
      (left ?? "").localeCompare(right ?? ""));
    expect(identities(reordered)).toEqual(identities(baseline));
  });

  it("compiles explicit semantic fields and independently addressable records", () => {
    const manifest = compileWorld(example);
    const expectedSamples = example.island.terrainSamplesPerEdge ** 2;
    const firstChunk = manifest.chunks[0];
    expect(firstChunk?.heights).toHaveLength(expectedSamples);
    expect(firstChunk?.regionMask).toHaveLength(expectedSamples);
    expect(firstChunk?.moisture).toHaveLength(expectedSamples);
    expect(firstChunk?.shoreDistanceMeters).toHaveLength(expectedSamples);
    expect(firstChunk?.slopeDegrees).toHaveLength(expectedSamples);
    expect(firstChunk?.traversable).toHaveLength(expectedSamples);
    expect(manifest.placements).toHaveLength(
      example.regions.reduce(
        (total, region) => total + Math.max(2, Math.round(12 * region.visualIntent.scatterDensity)),
        0,
      ),
    );
    expect(manifest.exclusions.some((zone) => zone.reason === "spawn-clearance")).toBe(true);
    expect(new Set(manifest.placements.map((record) => record.stableId)).size).toBe(
      manifest.placements.length,
    );
    const answeringCall = manifest.journeyEvents.find(
      (event) => event.id === "first-answering-call",
    );
    const answerSource = manifest.discoveries.find(
      (discovery) => discovery.id === answeringCall?.anchorDiscoveryId,
    );
    expect(answeringCall?.responseDelayTicks).toBe(90);
    expect(answeringCall?.position).toEqual(answerSource?.position);

    const fernwood = manifest.regions.find((region) => region.id === "fernwood-edge");
    if (!fernwood) throw new Error("Missing fernwood fixture");
    for (const compiled of manifest.discoveries) {
      const authored = example.discoveries.find((candidate) => candidate.id === compiled.id);
      const region = manifest.regions.find((candidate) => candidate.id === compiled.regionId);
      if (!authored || !region) throw new Error(`Missing authored scene ${compiled.id}`);
      expect(compiled.position.x - region.anchor.x).toBeCloseTo(
        authored.offsetFromRegionAnchorMeters.x,
      );
      expect(compiled.position.z - region.anchor.z).toBeCloseTo(
        authored.offsetFromRegionAnchorMeters.z,
      );
    }
    const mandatory = manifest.discoveries.filter((discovery) => discovery.mandatory);
    for (let leftIndex = 0; leftIndex < mandatory.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < mandatory.length; rightIndex += 1) {
        const left = mandatory[leftIndex];
        const right = mandatory[rightIndex];
        if (!left || !right) continue;
        expect(Math.hypot(
          left.position.x - right.position.x,
          left.position.z - right.position.z,
        )).toBeGreaterThanOrEqual(80);
      }
    }
    const overlook = manifest.discoveries.find(
      (discovery) => discovery.id === "first-overlook",
    );
    expect(overlook?.position.y).toBeGreaterThanOrEqual(18);
    const overlookSample = overlook &&
      sampleManifest(manifest, overlook.position.x, overlook.position.z);
    expect(overlookSample && overlookSample.height).toBeGreaterThanOrEqual(17.75);
    expect(overlookSample && overlookSample.regionId).toBe("fernwood-edge");
  });

  it("rejects a manifest whose mandatory story scenes collapse together", () => {
    const collapsed = {
      ...example,
      discoveries: example.discoveries.map((discovery) =>
        discovery.mandatory
          ? { ...discovery, offsetFromRegionAnchorMeters: { x: 0, z: 0 } }
          : discovery),
    };
    expect(() => compileWorld(collapsed)).toThrow(/required scene overlaps/);
  });

  it("rejects a dry but low coastal shelf as an overlook", () => {
    const coastalOverlook = {
      ...example,
      discoveries: example.discoveries.map((discovery) =>
        discovery.id === "first-overlook"
          ? { ...discovery, offsetFromRegionAnchorMeters: { x: -28, z: 67 } }
          : discovery),
    };
    expect(() => compileWorld(coastalOverlook)).toThrow(/overlook must remain.*high ground/);
  });

  it("rejects invalid executable journey rules", () => {
    const invalidDelay = {
      ...example,
      journeyEvents: example.journeyEvents.map((event) => ({
        ...event,
        responseDelayTicks: 0,
      })),
    };
    expect(validateWorldSpec(invalidDelay).map((issue) => issue.path)).toContain(
      "journeyEvents[0].responseDelayTicks",
    );
    const invalidRevealTarget = {
      ...example,
      journeyEvents: example.journeyEvents.map((event) => ({
        ...event,
        revealDiscoveryIds: ["plain-wildlife-crossing"],
      })),
    };
    expect(validateWorldSpec(invalidRevealTarget).map((issue) => issue.path)).toContain(
      "journeyEvents[0].revealDiscoveryIds",
    );

    const hollow = example.discoveries.find(
      (discovery) => discovery.id === "spring-resting-hollow",
    );
    if (!hollow) throw new Error("Missing resting-hollow fixture");
    const invalidRest = {
      ...example,
      discoveries: example.discoveries.map((discovery) =>
        discovery.id === hollow.id
          ? {
              ...discovery,
              progression: {
                ...discovery.progression,
                completion: { kind: "interact" as const, interaction: "inspect" as const },
              },
            }
          : discovery),
    };
    expect(validateWorldSpec(invalidRest).map((issue) => issue.path)).toContain(
      "discoveries[0].progression.completion",
    );
  });

  it("blends safe routes into natural terrain without cliff-like shoulders", () => {
    const manifest = compileWorld(example);
    for (const route of manifest.routes.filter((candidate) => candidate.kind === "safe")) {
      for (let index = 1; index < route.waypoints.length; index += 1) {
        const from = route.waypoints[index - 1];
        const to = route.waypoints[index];
        if (!from || !to) continue;
        const dx = to.x - from.x;
        const dz = to.z - from.z;
        const length = Math.hypot(dx, dz);
        const normalX = -dz / length;
        const normalZ = dx / length;
        const centreX = (from.x + to.x) * 0.5;
        const centreZ = (from.z + to.z) * 0.5;
        const centreHeight = sampleManifest(manifest, centreX, centreZ).height;
        const shoulderDistance = route.widthMeters * 0.5 + 6;

        for (let offset = -shoulderDistance; offset <= shoulderDistance; offset += 2) {
          const sample = sampleManifest(
            manifest,
            centreX + normalX * offset,
            centreZ + normalZ * offset,
          );
          expect(
            sample.slopeDegrees,
            `${route.id} segment ${index - 1} shoulder ${offset.toFixed(1)}m`,
          ).toBeLessThanOrEqual(28);
        }

        for (const side of [-1, 1]) {
          const shoulder = sampleManifest(
            manifest,
            centreX + normalX * shoulderDistance * side,
            centreZ + normalZ * shoulderDistance * side,
          );
          expect(Math.abs(centreHeight - shoulder.height)).toBeLessThanOrEqual(4);
        }
      }
    }
  });

  it("passes the complete validation gate for 100 distinct seeds", { timeout: 30_000 }, () => {
    const hashes = new Set<string>();
    for (let seed = 0; seed < 100; seed += 1) {
      const manifest = compileWorld({ ...example, seed });
      for (const route of manifest.routes.filter((candidate) => candidate.kind === "safe")) {
        for (let index = 1; index < route.waypoints.length; index += 1) {
          const from = route.waypoints[index - 1];
          const to = route.waypoints[index];
          if (!from || !to) continue;
          const dx = to.x - from.x;
          const dz = to.z - from.z;
          const length = Math.hypot(dx, dz);
          const normalX = -dz / length;
          const normalZ = dx / length;
          const centreX = (from.x + to.x) * 0.5;
          const centreZ = (from.z + to.z) * 0.5;
          const centreHeight = sampleManifest(manifest, centreX, centreZ).height;
          const outerShoulder = route.widthMeters * 0.5 + 8;
          for (const side of [-1, 1]) {
            const shoulder = sampleManifest(
              manifest,
              centreX + normalX * outerShoulder * side,
              centreZ + normalZ * outerShoulder * side,
            );
            expect(
              Math.abs(centreHeight - shoulder.height),
              `seed ${seed} ${route.id} segment ${index - 1} side ${side}`,
            ).toBeLessThanOrEqual(4);
          }
        }
      }
      hashes.add(manifest.manifestHash);
    }
    expect(hashes.size).toBe(100);
  });
});
