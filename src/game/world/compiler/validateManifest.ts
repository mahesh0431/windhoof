import type { TerrainChunk, WorldManifest, WorldValidationIssue } from "./worldTypes";

function sampleIndex(chunk: TerrainChunk, x: number, z: number): number {
  return z * chunk.samplesPerEdge + x;
}

function nearestManifestSample(
  manifest: WorldManifest,
  x: number,
  z: number,
): { readonly chunk: TerrainChunk; readonly index: number } {
  const half = manifest.island.sizeMeters * 0.5;
  const maximumChunk = manifest.island.chunksPerEdge - 1;
  const chunkX = Math.min(
    maximumChunk,
    Math.max(0, Math.floor((x + half) / manifest.island.chunkSizeMeters)),
  );
  const chunkZ = Math.min(
    maximumChunk,
    Math.max(0, Math.floor((z + half) / manifest.island.chunkSizeMeters)),
  );
  const chunk = manifest.chunks.find(
    (candidate) => candidate.chunkX === chunkX && candidate.chunkZ === chunkZ,
  );
  if (!chunk) throw new Error(`Missing chunk ${chunkX},${chunkZ}`);
  const localX = Math.round((x - chunk.originX) / chunk.sampleSpacingMeters);
  const localZ = Math.round((z - chunk.originZ) / chunk.sampleSpacingMeters);
  const index = sampleIndex(
    chunk,
    Math.min(chunk.samplesPerEdge - 1, Math.max(0, localX)),
    Math.min(chunk.samplesPerEdge - 1, Math.max(0, localZ)),
  );
  return { chunk, index };
}

export function sampleManifestHeight(manifest: WorldManifest, x: number, z: number): number {
  const { chunk, index } = nearestManifestSample(manifest, x, z);
  const height = chunk.heights[index];
  if (height === undefined) throw new Error(`Missing height at ${x},${z}`);
  return height;
}

export function validateManifest(manifest: WorldManifest): readonly WorldValidationIssue[] {
  const issues: WorldValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  const expectedSamples = manifest.island.terrainSamplesPerEdge ** 2;
  const ids = new Set<string>();

  const addressable = [
    ...manifest.regions,
    ...manifest.routes,
    ...manifest.discoveries,
    ...manifest.journeyEvents,
    ...manifest.placements,
    ...manifest.exclusions,
    ...manifest.chunks,
  ];
  for (const record of addressable) {
    if (ids.has(record.stableId)) add(record.stableId, "stable id must be globally unique");
    ids.add(record.stableId);
  }

  for (const [index, chunk] of manifest.chunks.entries()) {
    const path = `chunks[${index}]`;
    for (const [field, values] of Object.entries({
      heights: chunk.heights,
      regionMask: chunk.regionMask,
      moisture: chunk.moisture,
      shoreDistanceMeters: chunk.shoreDistanceMeters,
      slopeDegrees: chunk.slopeDegrees,
      traversable: chunk.traversable,
    })) {
      if (values.length !== expectedSamples) add(`${path}.${field}`, "has wrong sample count");
    }
    if (chunk.heights.some((height) => !Number.isFinite(height))) {
      add(`${path}.heights`, "contains a non-finite value");
    }
  }

  const byCoordinate = new Map(
    manifest.chunks.map((chunk) => [`${chunk.chunkX},${chunk.chunkZ}`, chunk]),
  );
  for (const chunk of manifest.chunks) {
    const east = byCoordinate.get(`${chunk.chunkX + 1},${chunk.chunkZ}`);
    if (east) {
      for (let row = 0; row < chunk.samplesPerEdge; row += 1) {
        const left = chunk.heights[sampleIndex(chunk, chunk.samplesPerEdge - 1, row)];
        const right = east.heights[sampleIndex(east, 0, row)];
        if (left !== right) add(chunk.id, `east seam differs at row ${row}`);
      }
    }
    const south = byCoordinate.get(`${chunk.chunkX},${chunk.chunkZ + 1}`);
    if (south) {
      for (let column = 0; column < chunk.samplesPerEdge; column += 1) {
        const top = chunk.heights[sampleIndex(chunk, column, chunk.samplesPerEdge - 1)];
        const bottom = south.heights[sampleIndex(south, column, 0)];
        if (top !== bottom) add(chunk.id, `south seam differs at column ${column}`);
      }
    }
  }

  const spawnHeight = sampleManifestHeight(
    manifest,
    manifest.spawn.position.x,
    manifest.spawn.position.z,
  );
  if (spawnHeight <= manifest.island.seaLevelMeters + 0.15) {
    add("spawn", "must be dry");
  }
  const step = manifest.island.chunkSizeMeters /
    (manifest.island.terrainSamplesPerEdge - 1);
  const slopes = [
    sampleManifestHeight(manifest, manifest.spawn.position.x + step, manifest.spawn.position.z),
    sampleManifestHeight(manifest, manifest.spawn.position.x - step, manifest.spawn.position.z),
    sampleManifestHeight(manifest, manifest.spawn.position.x, manifest.spawn.position.z + step),
    sampleManifestHeight(manifest, manifest.spawn.position.x, manifest.spawn.position.z - step),
  ].map((height) => (Math.atan(Math.abs(height - spawnHeight) / step) * 180) / Math.PI);
  if (Math.max(...slopes) > manifest.spawn.maximumSlopeDegrees) {
    add("spawn", "exceeds maximum slope");
  }

  const regionIds = new Set(manifest.regions.map((region) => region.id));
  const connected = new Map<string, Set<string>>();
  for (const region of regionIds) connected.set(region, new Set());
  for (const route of manifest.routes.filter((candidate) => candidate.mandatory)) {
    // Connection semantic ids are not guaranteed to encode region ids; locate
    // endpoints by the nearest compiled anchors instead.
    const first = route.waypoints[0];
    const last = route.waypoints.at(-1);
    if (!first || !last) {
      add(`routes.${route.id}`, "must have endpoints");
      continue;
    }
    const nearest = (point: typeof first) => manifest.regions.reduce((best, region) =>
      Math.hypot(point.x - region.anchor.x, point.z - region.anchor.z) <
      Math.hypot(point.x - best.anchor.x, point.z - best.anchor.z) ? region : best);
    const from = nearest(first).id;
    const to = nearest(last).id;
    connected.get(from)?.add(to);
    connected.get(to)?.add(from);
    for (let index = 1; index < route.waypoints.length; index += 1) {
      const a = route.waypoints[index - 1];
      const b = route.waypoints[index];
      if (!a || !b) continue;
      const horizontal = Math.hypot(b.x - a.x, b.z - a.z);
      const slope = (Math.atan2(Math.abs(b.y - a.y), horizontal) * 180) / Math.PI;
      if (slope > route.maximumSlopeDegrees) {
        add(`routes.${route.id}`, `segment ${index} exceeds maximum slope`);
      }
    }
  }
  const start = manifest.regions[0]?.id;
  const visited = new Set<string>();
  const queue = start ? [start] : [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    for (const neighbour of connected.get(current) ?? []) queue.push(neighbour);
  }
  for (const discovery of manifest.discoveries.filter((candidate) => candidate.mandatory)) {
    if (!visited.has(discovery.regionId)) {
      add(`discoveries.${discovery.id}`, "required endpoint is disconnected");
    }
    const { chunk, index } = nearestManifestSample(
      manifest,
      discovery.position.x,
      discovery.position.z,
    );
    const height = chunk.heights[index];
    const slope = chunk.slopeDegrees[index];
    const traversable = chunk.traversable[index];
    const sampledRegionId = chunk.regionMask[index];
    if (height === undefined || height <= manifest.island.seaLevelMeters + 0.15) {
      add(`discoveries.${discovery.id}`, "required trigger point must be dry");
    }
    if (traversable !== true) {
      add(`discoveries.${discovery.id}`, "required trigger point must be traversable");
    }
    if (sampledRegionId !== discovery.regionId) {
      add(`discoveries.${discovery.id}`, "required scene must land in its authored region");
    }
    const region = manifest.regions.find((candidate) => candidate.id === discovery.regionId);
    if (slope === undefined || (region && slope > region.maxSlopeDegrees)) {
      add(`discoveries.${discovery.id}`, "required trigger point exceeds region slope");
    }
    if (
      discovery.type === "overlook" &&
      region &&
      (height === undefined || height < region.elevationMeters[0] - 0.25)
    ) {
      add(`discoveries.${discovery.id}`, "overlook must remain on its region's high ground");
    }
    if (discovery.type === "resting-hollow" && (slope === undefined || slope > 18)) {
      add(`discoveries.${discovery.id}`, "resting hollow must provide gentle ground");
    }
    const half = manifest.island.sizeMeters * 0.5;
    if (Math.hypot(discovery.position.x, discovery.position.z) > half * 0.86) {
      add(`discoveries.${discovery.id}`, "required scene lies too close to island containment");
    }
  }
  const mandatoryDiscoveries = manifest.discoveries.filter(
    (candidate) => candidate.mandatory,
  );
  for (let leftIndex = 0; leftIndex < mandatoryDiscoveries.length; leftIndex += 1) {
    const left = mandatoryDiscoveries[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < mandatoryDiscoveries.length; rightIndex += 1) {
      const right = mandatoryDiscoveries[rightIndex];
      if (!right) continue;
      const distance = Math.hypot(
        left.position.x - right.position.x,
        left.position.z - right.position.z,
      );
      const minimumSceneDistance = Math.max(
        32,
        left.progression.visitRadiusMeters + right.progression.visitRadiusMeters + 16,
      );
      if (distance < minimumSceneDistance) {
        add(
          `discoveries.${left.id}`,
          `required scene overlaps ${right.id}; needs ${minimumSceneDistance} metres`,
        );
      }
    }
  }
  const discoveryIds = new Set(manifest.discoveries.map((discovery) => discovery.id));
  for (const event of manifest.journeyEvents) {
    if (!discoveryIds.has(event.anchorDiscoveryId)) {
      add(`journeyEvents.${event.id}`, "anchor discovery is missing");
    }
    for (const id of [
      ...event.prerequisiteDiscoveryIds,
      ...event.revealDiscoveryIds,
    ]) {
      if (!discoveryIds.has(id)) {
        add(`journeyEvents.${event.id}`, `references missing discovery ${id}`);
      }
    }
  }
  for (const placement of manifest.placements) {
    if (![placement.position.x, placement.position.y, placement.position.z].every(Number.isFinite)) {
      add(`placements.${placement.id}`, "contains a non-finite transform");
    }
    for (const route of manifest.routes.filter((candidate) => candidate.kind === "safe")) {
      for (const waypoint of route.waypoints) {
        const clearance = Math.hypot(
          placement.position.x - waypoint.x,
          placement.position.z - waypoint.z,
        );
        if (clearance < route.widthMeters * 0.5 + placement.collisionRadiusMeters) {
          add(`placements.${placement.id}`, `blocks safe route ${route.id}`);
          break;
        }
      }
    }
  }
  if (!manifest.routes.some((route) => route.kind === "safe" && route.mandatory)) {
    add("routes", "requires at least one mandatory safe route");
  }
  if (!manifest.routes.some((route) => route.kind === "expressive" && !route.mandatory)) {
    add("routes", "requires an optional expressive route");
  }
  return issues;
}

export function assertValidManifest(manifest: WorldManifest): void {
  const issues = validateManifest(manifest);
  if (issues.length === 0) return;
  throw new Error(
    `Invalid WorldManifest:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}`,
  );
}
