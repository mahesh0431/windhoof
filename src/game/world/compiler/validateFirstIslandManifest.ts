import type {
  CompiledRoute,
  TerrainChunk,
  WorldManifest,
  WorldValidationIssue,
} from "./worldTypes";

interface GridAccess {
  readonly side: number;
  readonly spacing: number;
  readonly half: number;
  readonly sample: (gridX: number, gridZ: number) => {
    readonly chunk: TerrainChunk;
    readonly index: number;
  };
}

function createGridAccess(manifest: WorldManifest): GridAccess {
  const cellsPerChunk = manifest.island.terrainSamplesPerEdge - 1;
  const side = manifest.island.chunksPerEdge * cellsPerChunk + 1;
  const spacing = manifest.island.chunkSizeMeters / cellsPerChunk;
  const half = manifest.island.sizeMeters * 0.5;
  const chunks = new Map(
    manifest.chunks.map((chunk) => [`${chunk.chunkX},${chunk.chunkZ}`, chunk]),
  );
  return {
    side,
    spacing,
    half,
    sample: (gridX, gridZ) => {
      const chunkX = Math.min(
        manifest.island.chunksPerEdge - 1,
        Math.floor(gridX / cellsPerChunk),
      );
      const chunkZ = Math.min(
        manifest.island.chunksPerEdge - 1,
        Math.floor(gridZ / cellsPerChunk),
      );
      const chunk = chunks.get(`${chunkX},${chunkZ}`);
      if (!chunk) throw new Error(`Missing chunk ${chunkX},${chunkZ}`);
      const localX = gridX - chunkX * cellsPerChunk;
      const localZ = gridZ - chunkZ * cellsPerChunk;
      return { chunk, index: localZ * chunk.samplesPerEdge + localX };
    },
  };
}

function nearestGrid(access: GridAccess, x: number, z: number): readonly [number, number] {
  return [
    Math.min(access.side - 1, Math.max(0, Math.round((x + access.half) / access.spacing))),
    Math.min(access.side - 1, Math.max(0, Math.round((z + access.half) / access.spacing))),
  ];
}

function routeDistance(route: CompiledRoute, x: number, z: number): number {
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 1; index < route.waypoints.length; index += 1) {
    const from = route.waypoints[index - 1];
    const to = route.waypoints[index];
    if (!from || !to) continue;
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared <= 0 ? 0 : Math.min(
      1,
      Math.max(0, ((x - from.x) * dx + (z - from.z) * dz) / lengthSquared),
    );
    closest = Math.min(closest, Math.hypot(x - (from.x + dx * t), z - (from.z + dz * t)));
  }
  return closest;
}

/** Additional release-island invariants; schema-v3 manifests never enter here. */
export function validateFirstIslandManifest(
  manifest: WorldManifest,
): readonly WorldValidationIssue[] {
  const issues: WorldValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (manifest.schemaVersion !== 4 || !manifest.topology) {
    add("schemaVersion", "first-island validation requires schema version 4 topology");
    return issues;
  }

  const edgeKey = (left: string, right: string) => [left, right].sort().join("::");
  const loop = manifest.topology.coastalLoopRegionIds;
  for (let index = 0; index < loop.length; index += 1) {
    const from = loop[index];
    const to = loop[(index + 1) % loop.length];
    if (!from || !to) continue;
    const matches = manifest.routes.filter((route) => {
      if (route.role !== "coastal-loop" || route.kind !== "safe" || !route.mandatory) return false;
      const first = route.waypoints[0];
      const last = route.waypoints.at(-1);
      if (!first || !last) return false;
      const nearestRegion = (point: typeof first) => manifest.regions.reduce((best, region) =>
        Math.hypot(point.x - region.anchor.x, point.z - region.anchor.z) <
          Math.hypot(point.x - best.anchor.x, point.z - best.anchor.z)
          ? region
          : best);
      return edgeKey(nearestRegion(first).id, nearestRegion(last).id) === edgeKey(from, to);
    });
    if (matches.length !== 1) add("routes", `compiled coastal edge ${from} -> ${to} must occur once`);
  }

  const access = createGridAccess(manifest);
  const sampleAt = (x: number, z: number) => {
    const [gridX, gridZ] = nearestGrid(access, x, z);
    return access.sample(gridX, gridZ);
  };
  for (const route of manifest.routes) {
    let coastalSamples = 0;
    let coastalBandSamples = 0;
    routeSegments: for (let index = 1; index < route.waypoints.length; index += 1) {
      const from = route.waypoints[index - 1];
      const to = route.waypoints[index];
      if (!from || !to) continue;
      const distance = Math.hypot(to.x - from.x, to.z - from.z);
      const count = Math.max(1, Math.ceil(distance / 4));
      for (let step = 0; step <= count; step += 1) {
        const t = step / count;
        const { chunk, index: sampleIndex } = sampleAt(
          from.x + (to.x - from.x) * t,
          from.z + (to.z - from.z) * t,
        );
        const height = chunk.heights[sampleIndex];
        const slope = chunk.slopeDegrees[sampleIndex];
        if (
          height === undefined ||
          height <= manifest.island.seaLevelMeters + 0.15 ||
          chunk.traversable[sampleIndex] !== true ||
          slope === undefined ||
          slope > route.maximumSlopeDegrees
        ) {
          add(
            `routes.${route.id}`,
            `centreline is not horse-traversable near segment ${index} ` +
              `(height ${String(height)}, slope ${String(slope)}, traversable ${String(chunk.traversable[sampleIndex])})`,
          );
          break routeSegments;
        }
        if (route.role === "coastal-loop") {
          coastalSamples += 1;
          const shoreDistance = chunk.shoreDistanceMeters[sampleIndex];
          if (shoreDistance !== undefined && shoreDistance >= 0 && shoreDistance <= 190) {
            coastalBandSamples += 1;
          }
        }
      }
    }
    if (route.role === "coastal-loop" && coastalBandSamples < coastalSamples * 0.8) {
      add(`routes.${route.id}`, "coastal route leaves the authored shore-distance band");
    }
  }

  const mandatory = manifest.discoveries.filter((discovery) => discovery.mandatory);
  const safeRoutes = manifest.routes.filter((route) => route.kind === "safe" && route.mandatory);
  for (let leftIndex = 0; leftIndex < mandatory.length; leftIndex += 1) {
    const left = mandatory[leftIndex];
    if (!left) continue;
    if (Math.min(...safeRoutes.map((route) =>
      routeDistance(route, left.position.x, left.position.z))) > 120) {
      add(`discoveries.${left.id}`, "mandatory trace is too far from a safe approach");
    }
    for (let rightIndex = leftIndex + 1; rightIndex < mandatory.length; rightIndex += 1) {
      const right = mandatory[rightIndex];
      if (!right) continue;
      const minimum = Math.max(
        80,
        left.progression.visitRadiusMeters + right.progression.visitRadiusMeters + 32,
      );
      if (Math.hypot(left.position.x - right.position.x, left.position.z - right.position.z) < minimum) {
        add(`discoveries.${left.id}`, `first-island trace overlaps ${right.id}`);
      }
    }
  }
  const finalTrace = mandatory.find(
    (discovery) => discovery.regionId === manifest.topology?.centralHighlandRegionId,
  );
  if (finalTrace) {
    const earlierMaximum = Math.max(...mandatory
      .filter((discovery) => discovery.id !== finalTrace.id)
      .map((discovery) => discovery.position.y));
    // The rule is "the herd stands on the summit, visibly above everything the
    // player has already found". Twenty metres was that rule written as a
    // constant, and a constant is only right for the island it was measured on:
    // halve the island and a summit that is still a summit fails a rule about
    // summits. It is now a fraction of the island's own width, which is the
    // thing the number was always standing in for.
    const summitRelief = manifest.island.sizeMeters / 51.2;
    if (finalTrace.position.y < earlierMaximum + summitRelief) {
      add(
        `discoveries.${finalTrace.id}`,
        `final trace must stand ${summitRelief.toFixed(1)} metres above earlier traces`,
      );
    }
  }

  const total = access.side * access.side;
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const [spawnX, spawnZ] = nearestGrid(
    access,
    manifest.spawn.position.x,
    manifest.spawn.position.z,
  );
  const spawnIndex = spawnZ * access.side + spawnX;
  queue[tail++] = spawnIndex;
  visited[spawnIndex] = 1;
  while (head < tail) {
    const current = queue[head++];
    if (current === undefined) break;
    const x = current % access.side;
    const z = Math.floor(current / access.side);
    const neighbours: readonly (readonly [number, number])[] = [
      [x - 1, z],
      [x + 1, z],
      [x, z - 1],
      [x, z + 1],
    ];
    for (const [nextX, nextZ] of neighbours) {
      if (nextX < 0 || nextZ < 0 || nextX >= access.side || nextZ >= access.side) continue;
      const nextIndex = nextZ * access.side + nextX;
      if (visited[nextIndex] === 1) continue;
      const { chunk, index } = access.sample(nextX, nextZ);
      if (chunk.traversable[index] !== true) continue;
      visited[nextIndex] = 1;
      queue[tail++] = nextIndex;
    }
  }
  for (const discovery of mandatory) {
    const [gridX, gridZ] = nearestGrid(access, discovery.position.x, discovery.position.z);
    if (visited[gridZ * access.side + gridX] !== 1) {
      add(`discoveries.${discovery.id}`, "is not raster-reachable from spawn");
    }
  }

  return issues;
}

export function assertValidFirstIslandManifest(manifest: WorldManifest): void {
  const issues = validateFirstIslandManifest(manifest);
  if (issues.length === 0) return;
  throw new Error(
    `Invalid first-island manifest:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}`,
  );
}
