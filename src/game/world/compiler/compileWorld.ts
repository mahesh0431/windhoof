import { clamp, type Vec3 } from "../../contracts/math";
import { manifestHash } from "./manifestHash";
import { randomStream, stableSeed } from "./seededRandom";
import { assertValidManifest } from "./validateManifest";
import { assertValidFirstIslandManifest } from "./validateFirstIslandManifest";
import { assertValidWorldSpec } from "./validateWorldSpec";
import type {
  CompiledDiscovery,
  CompiledJourneyEvent,
  CompiledPlacement,
  CompiledRegion,
  CompiledRoute,
  ExclusionZone,
  TerrainChunk,
  WorldManifest,
  WorldSpec,
} from "./worldTypes";

interface Layout {
  readonly regions: readonly CompiledRegion[];
  readonly routes: readonly CompiledRoute[];
  readonly discoveries: readonly CompiledDiscovery[];
}

const quantize = (value: number, precision = 1000) =>
  Math.round(value * precision) / precision;

function stableId(spec: WorldSpec, stage: string, localId: string): string {
  const suffix = stableSeed(spec.seed, `${spec.generatorVersion}:${stage}:${localId}`)
    .toString(16)
    .padStart(8, "0");
  return `${spec.worldId}:${stage}:${localId}:${suffix}`;
}

function baseTerrainHeight(spec: WorldSpec, x: number, z: number): number {
  const half = spec.island.sizeMeters * 0.5;
  const islandRadius = half * 0.9;
  const radius = Math.hypot(x, z);
  const shore = clamp((islandRadius - radius) / (half * 0.15), 0, 1);
  const latticeX = (x + half) / 18;
  const latticeZ = (z + half) / 18;
  const x0 = Math.floor(latticeX);
  const z0 = Math.floor(latticeZ);
  const tx = latticeX - x0;
  const tz = latticeZ - z0;
  const smoothX = tx * tx * (3 - 2 * tx);
  const smoothZ = tz * tz * (3 - 2 * tz);
  const north = integerNoise(spec.seed, x0, z0 + 1) +
    (integerNoise(spec.seed, x0 + 1, z0 + 1) - integerNoise(spec.seed, x0, z0 + 1)) * smoothX;
  const south = integerNoise(spec.seed, x0, z0) +
    (integerNoise(spec.seed, x0 + 1, z0) - integerNoise(spec.seed, x0, z0)) * smoothX;
  const noise = south + (north - south) * smoothZ - 0.5;
  const northRise = ((z + half) / spec.island.sizeMeters) * 18;
  return spec.island.seaLevelMeters - 3 + shore * (7 + northRise + noise * 2.4);
}

function regionalTerrainHeight(
  spec: WorldSpec,
  regions: readonly CompiledRegion[],
  x: number,
  z: number,
): number {
  const base = baseTerrainHeight(spec, x, z);
  if (spec.schemaVersion === 3) return base;

  const influences = [...regions]
    .sort((left, right) => left.stableId.localeCompare(right.stableId))
    .map((region) => {
      const intent = region.terrainIntent;
      if (!intent) return null;
      const t = clamp(
        Math.hypot(x - region.anchor.x, z - region.anchor.z) / intent.influenceRadiusMeters,
        0,
        1,
      );
      const smooth = 1 - t * t * (3 - 2 * t);
      return { target: intent.anchorElevationMeters, weight: smooth * smooth };
    })
    .filter((influence): influence is { target: number; weight: number } =>
      influence !== null && influence.weight > 0);
  const totalWeight = influences.reduce((sum, influence) => sum + influence.weight, 0);
  if (totalWeight <= 0) return base;
  const target = influences.reduce(
    (sum, influence) => sum + influence.target * influence.weight,
    0,
  ) / totalWeight;
  return base + (target - base) * clamp(totalWeight, 0, 1);
}

function compileRegions(spec: WorldSpec): readonly CompiledRegion[] {
  return spec.regions.map((region) => {
    const { x, z } = region.anchorMeters;
    const naturalHeight = spec.schemaVersion === 4
      ? (region.terrainIntent?.anchorElevationMeters ?? baseTerrainHeight(spec, x, z))
      : baseTerrainHeight(spec, x, z);
    const y = clamp(naturalHeight, region.elevationMeters[0], region.elevationMeters[1]);
    return {
      ...region,
      stableId: stableId(spec, "region", region.id),
      // Elevation is a semantic constraint, not a platform target. Anchoring to
      // the natural field avoids lifting safe routes into steep-sided berms.
      anchor: { x: quantize(x), y: quantize(y), z: quantize(z) },
    };
  });
}

function authoredRouteWaypoints(
  from: Vec3,
  to: Vec3,
  viaMeters: readonly { readonly x: number; readonly z: number }[],
): readonly Vec3[] {
  const controls = [
    { x: from.x, z: from.z },
    ...viaMeters,
    { x: to.x, z: to.z },
  ];
  const segmentLengths = controls.slice(1).map((point, index) => {
    const previous = controls[index];
    return previous ? Math.hypot(point.x - previous.x, point.z - previous.z) : 0;
  });
  const totalLength = segmentLengths.reduce((sum, length) => sum + length, 0);
  const waypoints: Vec3[] = [];
  let traversed = 0;
  for (let segmentIndex = 1; segmentIndex < controls.length; segmentIndex += 1) {
    const start = controls[segmentIndex - 1];
    const end = controls[segmentIndex];
    const length = segmentLengths[segmentIndex - 1] ?? 0;
    if (!start || !end || length <= 0) continue;
    const count = Math.max(1, Math.ceil(length / 16));
    for (let step = segmentIndex === 1 ? 0 : 1; step <= count; step += 1) {
      const localT = step / count;
      const distance = traversed + length * localT;
      const routeT = totalLength <= 0 ? 0 : distance / totalLength;
      waypoints.push({
        x: quantize(start.x + (end.x - start.x) * localT),
        y: quantize(from.y + (to.y - from.y) * routeT),
        z: quantize(start.z + (end.z - start.z) * localT),
      });
    }
    traversed += length;
  }
  return waypoints;
}

function routeWaypoints(
  from: Vec3,
  to: Vec3,
  kind: "safe" | "expressive",
  seed: number,
): readonly Vec3[] {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  const segmentCount = Math.max(2, Math.ceil(distance / 16));
  const random = randomStream(seed, `route:${kind}`);
  const bend = kind === "safe" ? random.range(-5, 5) : random.range(12, 22);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const inverse = 1 / Math.max(distance, 0.001);
  const normalX = -dz * inverse;
  const normalZ = dx * inverse;
  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const t = index / segmentCount;
    const offset = 4 * t * (1 - t) * bend;
    return {
      x: quantize(from.x + dx * t + normalX * offset),
      y: quantize(from.y + (to.y - from.y) * t),
      z: quantize(from.z + dz * t + normalZ * offset),
    };
  });
}

function compileRoutes(
  spec: WorldSpec,
  regions: readonly CompiledRegion[],
): readonly CompiledRoute[] {
  const byId = new Map(regions.map((region) => [region.id, region]));
  const routes: CompiledRoute[] = [];
  if (spec.schemaVersion === 4) {
    for (const connection of spec.requiredConnections) {
      const from = byId.get(connection.fromRegionId);
      const to = byId.get(connection.toRegionId);
      if (!from || !to) throw new Error(`Connection ${connection.id} references an unknown region`);
      if (!connection.kind || !connection.role || !connection.viaMeters) {
        throw new Error(`Connection ${connection.id} is missing its schema-v4 route plan`);
      }
      routes.push({
        id: connection.id,
        stableId: stableId(spec, "route", connection.id),
        connectionId: connection.id,
        kind: connection.kind,
        role: connection.role,
        widthMeters: quantize(connection.minimumWidthMeters),
        maximumSlopeDegrees: connection.maximumSlopeDegrees,
        mandatory: connection.mandatory,
        waypoints: authoredRouteWaypoints(from.anchor, to.anchor, connection.viaMeters),
      });
    }
    return routes;
  }
  const expressiveConnectionId = [...spec.requiredConnections]
    .map((connection) => connection.id)
    .sort()[0];
  for (const connection of spec.requiredConnections) {
    const from = byId.get(connection.fromRegionId);
    const to = byId.get(connection.toRegionId);
    if (!from || !to) throw new Error(`Connection ${connection.id} references an unknown region`);
    const safeId = `${connection.id}-safe`;
    routes.push({
      id: safeId,
      stableId: stableId(spec, "route", safeId),
      connectionId: connection.id,
      kind: "safe",
      widthMeters: quantize(connection.minimumWidthMeters),
      maximumSlopeDegrees: connection.maximumSlopeDegrees,
      mandatory: connection.mandatory,
      waypoints: routeWaypoints(from.anchor, to.anchor, "safe", stableSeed(spec.seed, safeId)),
    });
    if (connection.id === expressiveConnectionId) {
      const expressiveId = `${connection.id}-expressive`;
      routes.push({
        id: expressiveId,
        stableId: stableId(spec, "route", expressiveId),
        connectionId: connection.id,
        kind: "expressive",
        widthMeters: quantize(Math.max(3, connection.minimumWidthMeters * 0.6)),
        maximumSlopeDegrees: Math.min(28, connection.maximumSlopeDegrees + 6),
        mandatory: false,
        waypoints: routeWaypoints(
          from.anchor,
          to.anchor,
          "expressive",
          stableSeed(spec.seed, expressiveId),
        ),
      });
    }
  }
  return routes;
}

function compileDiscoveries(
  spec: WorldSpec,
  regions: readonly CompiledRegion[],
): readonly CompiledDiscovery[] {
  const byId = new Map(regions.map((region) => [region.id, region]));
  return spec.discoveries.map((discovery) => {
    const region = byId.get(discovery.regionId);
    if (!region) throw new Error(`Discovery ${discovery.id} references an unknown region`);
    const x = region.anchor.x + discovery.offsetFromRegionAnchorMeters.x;
    const z = region.anchor.z + discovery.offsetFromRegionAnchorMeters.z;
    const y = clamp(
      regionalTerrainHeight(spec, regions, x, z),
      region.elevationMeters[0],
      region.elevationMeters[1],
    );
    return {
      ...discovery,
      stableId: stableId(spec, "discovery", discovery.id),
      position: {
        x: quantize(x),
        y: quantize(y),
        z: quantize(z),
      },
    };
  });
}

function compileJourneyEvents(
  spec: WorldSpec,
  discoveries: readonly CompiledDiscovery[],
): readonly CompiledJourneyEvent[] {
  const byId = new Map(discoveries.map((discovery) => [discovery.id, discovery]));
  return spec.journeyEvents.map((event) => {
    const anchor = byId.get(event.anchorDiscoveryId);
    if (!anchor) throw new Error(`Journey event ${event.id} references an unknown anchor`);
    return {
      ...event,
      stableId: stableId(spec, "journey-event", event.id),
      position: { ...anchor.position },
    };
  });
}

function compilePlacements(
  spec: WorldSpec,
  regions: readonly CompiledRegion[],
  routes: readonly CompiledRoute[],
  discoveries: readonly CompiledDiscovery[],
  spawn: Vec3,
): readonly CompiledPlacement[] {
  const half = spec.island.sizeMeters * 0.5;
  return regions.flatMap((region) => {
    const random = randomStream(spec.seed, `placements:${region.id}`);
    const placements: CompiledPlacement[] = [];
    const desiredCount = Math.max(2, Math.round(12 * region.visualIntent.scatterDensity));
    for (let attempt = 0; placements.length < desiredCount && attempt < 192; attempt += 1) {
      const radius = random.range(20, 48);
      const rawX = random.range(-1, 1);
      const rawZ = random.range(-1, 1);
      const scaleToEdge = radius / Math.max(Math.abs(rawX), Math.abs(rawZ), 0.01);
      const x = clamp(region.anchor.x + rawX * scaleToEdge, -half * 0.82, half * 0.82);
      const z = clamp(region.anchor.z + rawZ * scaleToEdge, -half * 0.82, half * 0.82);
      const route = closestRouteTarget(x, z, routes);
      const blocksRoute = route !== null && route.distance < route.width * 0.5 + 4;
      const blocksSpawn = Math.hypot(x - spawn.x, z - spawn.z) <
        spec.spawn.clearanceRadiusMeters + 4;
      const blocksDiscovery = discoveries.some((discovery) =>
        Math.hypot(x - discovery.position.x, z - discovery.position.z) < 9);
      if (blocksRoute || blocksSpawn || blocksDiscovery) continue;
      const index = placements.length;
      const id = `${region.id}-scatter-${index}`;
      placements.push({
        id,
        stableId: stableId(spec, "placement", id),
        regionId: region.id,
        category: "scatter-zone" as const,
        position: { x: quantize(x), y: 0, z: quantize(z) },
        yaw: quantize(random.range(-Math.PI, Math.PI), 10_000),
        scale: quantize(random.range(0.8, 1.25)),
        collisionRadiusMeters: quantize(random.range(1.5, 4)),
      });
    }
    if (placements.length !== desiredCount) {
      throw new Error(`Could not place collision-safe scatter records in ${region.id}`);
    }
    return placements;
  });
}

function compileExclusions(
  spec: WorldSpec,
  spawn: Vec3,
  routes: readonly CompiledRoute[],
  discoveries: readonly CompiledDiscovery[],
): readonly ExclusionZone[] {
  const zones: ExclusionZone[] = [
    {
      id: "spawn-clearance",
      stableId: stableId(spec, "exclusion", "spawn-clearance"),
      reason: "spawn-clearance",
      centre: spawn,
      radiusMeters: spec.spawn.clearanceRadiusMeters,
    },
  ];
  for (const route of routes.filter((candidate) => candidate.kind === "safe")) {
    for (let index = 0; index < route.waypoints.length; index += 2) {
      const centre = route.waypoints[index];
      if (!centre) continue;
      const id = `${route.id}-${index}`;
      zones.push({
        id,
        stableId: stableId(spec, "exclusion", id),
        reason: "route-clearance",
        centre,
        radiusMeters: route.widthMeters * 0.5,
      });
    }
  }
  for (const discovery of discoveries) {
    zones.push({
      id: discovery.id,
      stableId: stableId(spec, "exclusion", discovery.id),
      reason: "discovery-clearance",
      centre: discovery.position,
      radiusMeters: 5,
    });
  }
  return zones;
}

function closestRouteTarget(
  x: number,
  z: number,
  routes: readonly CompiledRoute[],
  includeExpressive = false,
): { distance: number; height: number; width: number } | null {
  let closest: { distance: number; height: number; width: number } | null = null;
  for (const route of routes) {
    if (!includeExpressive && route.kind !== "safe") continue;
    for (let index = 1; index < route.waypoints.length; index += 1) {
      const from = route.waypoints[index - 1];
      const to = route.waypoints[index];
      if (!from || !to) continue;
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const lengthSquared = dx * dx + dz * dz;
      const t = clamp(((x - from.x) * dx + (z - from.z) * dz) / lengthSquared, 0, 1);
      const px = from.x + dx * t;
      const pz = from.z + dz * t;
      const distance = Math.hypot(x - px, z - pz);
      if (!closest || distance < closest.distance) {
        closest = {
          distance,
          height: from.y + (to.y - from.y) * t,
          width: route.widthMeters,
        };
      }
    }
  }
  return closest;
}

function blendedRouteTerrainHeight(
  baseHeight: number,
  x: number,
  z: number,
  routes: readonly CompiledRoute[],
): number {
  const influences = [...routes]
    .sort((left, right) => left.stableId.localeCompare(right.stableId))
    .map((route) => {
      const closest = closestRouteTarget(x, z, [route], true);
      if (!closest) return null;
      const flatRadius = closest.width * 0.5;
      const blend = 1 - clamp((closest.distance - flatRadius) / 8, 0, 1);
      const smoothBlend = blend * blend * (3 - 2 * blend);
      if (smoothBlend <= 0) return null;
      return {
        height: closest.height,
        strength: smoothBlend,
        weight: smoothBlend * (route.kind === "safe" ? 4 : 1),
      };
    })
    .filter((influence): influence is {
      height: number;
      strength: number;
      weight: number;
    } => influence !== null);
  if (influences.length === 0) return baseHeight;
  const totalWeight = influences.reduce((sum, influence) => sum + influence.weight, 0);
  const target = influences.reduce(
    (sum, influence) => sum + influence.height * influence.weight,
    0,
  ) / totalWeight;
  const strength = Math.max(...influences.map((influence) => influence.strength));
  return baseHeight + (target - baseHeight) * strength;
}

function integerNoise(seed: number, x: number, z: number): number {
  let value = (seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffff_ffff;
}

function terrainHeight(spec: WorldSpec, layout: Layout, x: number, z: number): number {
  const radius = Math.hypot(x, z);
  let height = regionalTerrainHeight(spec, layout.regions, x, z);

  if (spec.schemaVersion === 3) {
    const route = closestRouteTarget(x, z, layout.routes);
    if (route) {
      const flatRadius = route.width * 0.5;
      const blend = 1 - clamp((route.distance - flatRadius) / 8, 0, 1);
      const smoothBlend = blend * blend * (3 - 2 * blend);
      height += (route.height - height) * smoothBlend;
    }
  }

  if (spec.schemaVersion === 3) {
    for (const region of layout.regions) {
      const distance = Math.hypot(x - region.anchor.x, z - region.anchor.z);
      const blend = 1 - clamp((distance - 8) / 12, 0, 1);
      height += (region.anchor.y - height) * blend * blend * (3 - 2 * blend);
    }
  }
  for (const discovery of layout.discoveries) {
    const distance = Math.hypot(x - discovery.position.x, z - discovery.position.z);
    const blend = 1 - clamp((distance - 5) / 6, 0, 1);
    height += (discovery.position.y - height) * blend * blend * (3 - 2 * blend);
  }
  // A broad coastal falloff turns inland relief into a beach before the
  // containment ring. Leaving the hill profile intact until the last few
  // metres produced a dark, near-vertical shore face that the horse could
  // traverse sideways while the chase camera collapsed against it.
  const coastStart = spec.island.sizeMeters * 0.28;
  const coastEnd = spec.island.sizeMeters * 0.43;
  const coastT = clamp((radius - coastStart) / (coastEnd - coastStart), 0, 1);
  height += (spec.island.seaLevelMeters + 0.12 - height) * coastT;
  // The sea is a readable boundary, not a swimming mechanic. Keep a narrow,
  // dry collision shelf under the invisible containment ring so a stopped
  // horse never appears submerged or falls down the procedural shoreline.
  const shelfStart = spec.island.sizeMeters * 0.4;
  const boundaryRadius = spec.island.sizeMeters * 0.44;
  if (radius >= shelfStart && radius <= boundaryRadius + 2) {
    height = Math.max(height, spec.island.seaLevelMeters + 0.12);
  }
  // On the full island the authored routes are the final terrain constraint:
  // neither coastal falloff nor discovery pads may cut a safe corridor after
  // it has been graded. The frozen v3 ordering above remains unchanged.
  if (spec.schemaVersion === 4) {
    height = blendedRouteTerrainHeight(height, x, z, layout.routes);
  }
  return quantize(height);
}

function dominantRegion(regions: readonly CompiledRegion[], x: number, z: number): CompiledRegion {
  let selected = regions[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const region of regions) {
    const candidate = Math.hypot(x - region.anchor.x, z - region.anchor.z) /
      Math.max(0.01, region.coverage);
    if (candidate < distance) {
      selected = region;
      distance = candidate;
    }
  }
  if (!selected) throw new Error("World requires at least one region");
  return selected;
}

function compileChunks(spec: WorldSpec, layout: Layout): readonly TerrainChunk[] {
  const chunksPerEdge = spec.island.sizeMeters / spec.island.chunkSizeMeters;
  const spacing = spec.island.chunkSizeMeters / (spec.island.terrainSamplesPerEdge - 1);
  const half = spec.island.sizeMeters * 0.5;
  const chunks: TerrainChunk[] = [];
  // Height and slope stencils share most coordinates across neighbouring
  // samples and chunks. Cache the pure deterministic result once per absolute
  // coordinate; this changes compiler cost, never compiled truth.
  const heightCache = new Map<string, number>();
  const heightAt = (x: number, z: number): number => {
    const key = `${quantize(x, 1_000_000)},${quantize(z, 1_000_000)}`;
    const cached = heightCache.get(key);
    if (cached !== undefined) return cached;
    const height = terrainHeight(spec, layout, x, z);
    heightCache.set(key, height);
    return height;
  };
  for (let chunkZ = 0; chunkZ < chunksPerEdge; chunkZ += 1) {
    for (let chunkX = 0; chunkX < chunksPerEdge; chunkX += 1) {
      const originX = -half + chunkX * spec.island.chunkSizeMeters;
      const originZ = -half + chunkZ * spec.island.chunkSizeMeters;
      const heights: number[] = [];
      const regionMask: string[] = [];
      const moisture: number[] = [];
      const shoreDistanceMeters: number[] = [];
      const slopeDegrees: number[] = [];
      const traversable: boolean[] = [];
      for (let sampleZ = 0; sampleZ < spec.island.terrainSamplesPerEdge; sampleZ += 1) {
        for (let sampleX = 0; sampleX < spec.island.terrainSamplesPerEdge; sampleX += 1) {
          const x = originX + sampleX * spacing;
          const z = originZ + sampleZ * spacing;
          const height = heightAt(x, z);
          const dx = heightAt(x + spacing, z) - heightAt(x - spacing, z);
          const dz = heightAt(x, z + spacing) - heightAt(x, z - spacing);
          const slope = quantize(
            (Math.atan(Math.hypot(dx, dz) / (spacing * 2)) * 180) / Math.PI,
          );
          const radius = Math.hypot(x, z);
          const shoreDistance = quantize(spec.island.sizeMeters * 0.45 - radius);
          heights.push(height);
          const region = dominantRegion(layout.regions, x, z);
          const wetness = integerNoise(
            spec.seed ^ 0xa5a5a5a5,
            Math.floor(x / 24),
            Math.floor(z / 24),
          );
          regionMask.push(region.id);
          moisture.push(quantize(
            region.moisture[0] + (region.moisture[1] - region.moisture[0]) * wetness,
          ));
          shoreDistanceMeters.push(shoreDistance);
          slopeDegrees.push(slope);
          traversable.push(height > spec.island.seaLevelMeters + 0.15 && slope <= 28);
        }
      }
      const id = `chunk-${chunkX}-${chunkZ}`;
      chunks.push({
        id,
        stableId: stableId(spec, "chunk", id),
        chunkX,
        chunkZ,
        originX: quantize(originX),
        originZ: quantize(originZ),
        sampleSpacingMeters: quantize(spacing),
        samplesPerEdge: spec.island.terrainSamplesPerEdge,
        heights,
        regionMask,
        moisture,
        shoreDistanceMeters,
        slopeDegrees,
        traversable,
      });
    }
  }
  return chunks;
}

export function compileWorld(spec: WorldSpec): WorldManifest {
  assertValidWorldSpec(spec);
  const regions = compileRegions(spec);
  const routes = compileRoutes(spec, regions);
  const discoveries = compileDiscoveries(spec, regions);
  const journeyEvents = compileJourneyEvents(spec, discoveries);
  const layout = { regions, routes, discoveries };
  const chunks = compileChunks(spec, layout);
  const spawnRegion = regions.find((region) => region.id === spec.spawn.regionId);
  if (!spawnRegion) throw new Error(`Unknown spawn region ${spec.spawn.regionId}`);
  const spawnPosition = {
    ...spawnRegion.anchor,
    y: terrainHeight(spec, layout, spawnRegion.anchor.x, spawnRegion.anchor.z),
  };
  const placements = compilePlacements(
    spec,
    regions,
    routes,
    discoveries,
    spawnPosition,
  ).map((placement) => ({
    ...placement,
    position: {
      ...placement.position,
      y: terrainHeight(spec, layout, placement.position.x, placement.position.z),
    },
  }));
  const exclusions = compileExclusions(spec, spawnPosition, routes, discoveries);
  const sourceSpecHash = manifestHash(spec);
  const withoutHash = {
    schemaVersion: spec.schemaVersion,
    generatorVersion: spec.generatorVersion,
    worldId: spec.worldId,
    seed: spec.seed,
    presentation: spec.presentation,
    ...(spec.schemaVersion === 4 ? { topology: spec.topology } : {}),
    island: {
      ...spec.island,
      chunksPerEdge: spec.island.sizeMeters / spec.island.chunkSizeMeters,
    },
    spawn: {
      position: spawnPosition,
      yaw: 0,
      clearanceRadiusMeters: spec.spawn.clearanceRadiusMeters,
      maximumSlopeDegrees: spec.spawn.maxSlopeDegrees,
    },
    regions,
    routes,
    discoveries,
    journeyEvents,
    placements,
    exclusions,
    chunks,
    sourceSpecHash,
  };
  const manifest = { ...withoutHash, manifestHash: manifestHash(withoutHash) };
  assertValidManifest(manifest);
  if (manifest.schemaVersion === 4) assertValidFirstIslandManifest(manifest);
  return manifest;
}
