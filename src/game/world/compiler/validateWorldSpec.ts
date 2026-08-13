import type { WorldSpec, WorldValidationIssue } from "./worldTypes";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function validateWorldSpec(spec: WorldSpec): readonly WorldValidationIssue[] {
  const issues: WorldValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (spec.schemaVersion !== 3 && spec.schemaVersion !== 4) {
    add("schemaVersion", "must equal 3 or 4");
  }
  if (!spec.generatorVersion) add("generatorVersion", "must not be empty");
  if (!ID_PATTERN.test(spec.worldId)) add("worldId", "must be a lowercase stable id");
  if (!spec.presentation.mood || !spec.presentation.atmosphere || !spec.presentation.lighting) {
    add("presentation", "must define mood, atmosphere, and lighting intent");
  }
  if (spec.presentation.palette.length < 3) {
    add("presentation.palette", "must contain at least three global palette anchors");
  }
  if (!Number.isInteger(spec.seed) || spec.seed < 0 || spec.seed > 0xffff_ffff) {
    add("seed", "must be an unsigned 32-bit integer");
  }

  const island = spec.island;
  if (!Number.isInteger(island.sizeMeters) || island.sizeMeters < 128) {
    add("island.sizeMeters", "must be an integer of at least 128");
  }
  if (!Number.isInteger(island.chunkSizeMeters) || island.chunkSizeMeters < 32) {
    add("island.chunkSizeMeters", "must be an integer of at least 32");
  }
  if (island.sizeMeters % island.chunkSizeMeters !== 0) {
    add("island", "sizeMeters must be divisible by chunkSizeMeters");
  }
  if (!Number.isInteger(island.terrainSamplesPerEdge) || island.terrainSamplesPerEdge < 3) {
    add("island.terrainSamplesPerEdge", "must be an integer of at least 3");
  }
  if (!Number.isFinite(island.seaLevelMeters)) {
    add("island.seaLevelMeters", "must be finite");
  }

  if (spec.regions.length === 0) add("regions", "must contain at least one region");
  const regionIds = new Set<string>();
  let totalCoverage = 0;
  for (const [index, region] of spec.regions.entries()) {
    const path = `regions[${index}]`;
    if (!ID_PATTERN.test(region.id)) add(`${path}.id`, "must be a lowercase stable id");
    if (regionIds.has(region.id)) add(`${path}.id`, "must be unique");
    regionIds.add(region.id);
    totalCoverage += region.coverage;
    const anchor = region.anchorMeters;
    const maximumAnchorRadius = spec.island.sizeMeters * 0.4;
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.z)) {
      add(`${path}.anchorMeters`, "must contain finite coordinates");
    } else if (Math.hypot(anchor.x, anchor.z) > maximumAnchorRadius) {
      add(`${path}.anchorMeters`, "must remain inside the authored island interior");
    }
    if (!(region.coverage > 0 && region.coverage <= 1)) {
      add(`${path}.coverage`, "must be greater than zero and at most one");
    }
    if (region.elevationMeters[0] > region.elevationMeters[1]) {
      add(`${path}.elevationMeters`, "must be ordered minimum to maximum");
    }
    if (region.moisture[0] > region.moisture[1]) {
      add(`${path}.moisture`, "must be ordered minimum to maximum");
    }
    if (region.moisture.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
      add(`${path}.moisture`, "must contain finite normalized values");
    }
    if (!(region.visualIntent.scatterDensity >= 0 && region.visualIntent.scatterDensity <= 1)) {
      add(`${path}.visualIntent.scatterDensity`, "must be normalized from zero to one");
    }
    if (!region.visualIntent.silhouette || region.visualIntent.scatterFamilies.length === 0) {
      add(`${path}.visualIntent`, "must define silhouette and scatter-family intentions");
    }
    if (spec.schemaVersion === 4) {
      const intent = region.terrainIntent;
      if (!intent) {
        add(`${path}.terrainIntent`, "is required by schema version 4");
      } else {
        if (
          !Number.isFinite(intent.anchorElevationMeters) ||
          intent.anchorElevationMeters < region.elevationMeters[0] ||
          intent.anchorElevationMeters > region.elevationMeters[1]
        ) {
          add(`${path}.terrainIntent.anchorElevationMeters`, "must lie inside elevationMeters");
        }
        if (
          !Number.isFinite(intent.influenceRadiusMeters) ||
          intent.influenceRadiusMeters <= 0 ||
          intent.influenceRadiusMeters > spec.island.sizeMeters * 0.45
        ) {
          add(`${path}.terrainIntent.influenceRadiusMeters`, "must be positive and bounded");
        }
      }
    }
  }
  if (Math.abs(totalCoverage - 1) > 0.001) {
    add("regions", "coverage values must sum to one");
  }

  for (const [index, region] of spec.regions.entries()) {
    for (const adjacentId of region.adjacentTo) {
      const adjacent = spec.regions.find((candidate) => candidate.id === adjacentId);
      if (!adjacent) {
        add(`regions[${index}].adjacentTo`, `references unknown region ${adjacentId}`);
      } else if (!adjacent.adjacentTo.includes(region.id)) {
        add(`regions[${index}].adjacentTo`, `adjacency with ${adjacentId} must be symmetric`);
      }
    }
  }

  if (!regionIds.has(spec.spawn.regionId)) add("spawn.regionId", "must reference a region");
  const connectionIds = new Set<string>();
  for (const [index, connection] of spec.requiredConnections.entries()) {
    const path = `requiredConnections[${index}]`;
    if (!ID_PATTERN.test(connection.id)) add(`${path}.id`, "must be a lowercase stable id");
    if (connectionIds.has(connection.id)) add(`${path}.id`, "must be unique");
    connectionIds.add(connection.id);
    if (!regionIds.has(connection.fromRegionId)) add(`${path}.fromRegionId`, "unknown region");
    if (!regionIds.has(connection.toRegionId)) add(`${path}.toRegionId`, "unknown region");
    if (connection.fromRegionId === connection.toRegionId) {
      add(path, "must join two distinct regions");
    }
    if (!(connection.minimumWidthMeters > 0)) add(`${path}.minimumWidthMeters`, "must be positive");
    const fromRegion = spec.regions.find((region) => region.id === connection.fromRegionId);
    if (fromRegion && !fromRegion.adjacentTo.includes(connection.toRegionId)) {
      add(path, "must join mutually adjacent regions");
    }
    if (spec.schemaVersion === 4) {
      if (!connection.kind) add(`${path}.kind`, "is required by schema version 4");
      if (!connection.role) add(`${path}.role`, "is required by schema version 4");
      if (!connection.viaMeters) add(`${path}.viaMeters`, "is required by schema version 4");
      for (const [viaIndex, via] of (connection.viaMeters ?? []).entries()) {
        if (!Number.isFinite(via.x) || !Number.isFinite(via.z)) {
          add(`${path}.viaMeters[${viaIndex}]`, "must contain finite coordinates");
        } else if (Math.hypot(via.x, via.z) > spec.island.sizeMeters * 0.44) {
          add(`${path}.viaMeters[${viaIndex}]`, "must stay inside containment");
        }
      }
      if (connection.role === "coastal-loop" && (connection.kind !== "safe" || !connection.mandatory)) {
        add(path, "coastal-loop connections must be safe and mandatory");
      }
      if (
        connection.role === "interior-shortcut" &&
        (connection.kind !== "expressive" || connection.mandatory)
      ) {
        add(path, "interior-shortcut connections must be expressive and optional");
      }
    }
  }
  const discoveryIds = new Set<string>();
  const journeyOrders = new Set<number>();
  for (const [index, discovery] of spec.discoveries.entries()) {
    const path = `discoveries[${index}]`;
    if (!ID_PATTERN.test(discovery.id)) add(`${path}.id`, "must be a lowercase stable id");
    if (discoveryIds.has(discovery.id)) add(`${path}.id`, "must be unique");
    discoveryIds.add(discovery.id);
    if (!Number.isInteger(discovery.journeyOrder) || discovery.journeyOrder < 0) {
      add(`${path}.journeyOrder`, "must be a non-negative integer");
    }
    if (journeyOrders.has(discovery.journeyOrder)) {
      add(`${path}.journeyOrder`, "must be unique");
    }
    journeyOrders.add(discovery.journeyOrder);
    if (!regionIds.has(discovery.regionId)) add(`${path}.regionId`, "unknown region");
    const offset = discovery.offsetFromRegionAnchorMeters;
    if (!Number.isFinite(offset.x) || !Number.isFinite(offset.z)) {
      add(`${path}.offsetFromRegionAnchorMeters`, "must contain finite coordinates");
    } else if (Math.hypot(offset.x, offset.z) > spec.island.sizeMeters * 0.3) {
      add(`${path}.offsetFromRegionAnchorMeters`, "must remain within its authored region scene");
    }
    if (discovery.signals.length < 2) add(`${path}.signals`, "must contain at least two cues");
    if (spec.schemaVersion === 4 && discovery.mandatory) {
      const signalKinds = new Set(discovery.signals.map((signal) => signal.kind));
      if (signalKinds.size < 2) {
        add(`${path}.signals`, "mandatory scenes need two distinct cue kinds");
      }
    }
    if (!(discovery.progression.visitRadiusMeters > 0)) {
      add(`${path}.progression.visitRadiusMeters`, "must be positive");
    }
    if (
      discovery.progression.reveal.kind === "proximity" &&
      !(discovery.progression.reveal.radiusMeters >= discovery.progression.visitRadiusMeters)
    ) {
      add(`${path}.progression.reveal.radiusMeters`, "must include the visit radius");
    }
    if (
      discovery.progression.completion.kind === "linger" &&
      (!Number.isInteger(discovery.progression.completion.ticks) ||
        discovery.progression.completion.ticks < 1)
    ) {
      add(`${path}.progression.completion.ticks`, "must be a positive integer");
    }
    if (
      discovery.progression.completion.kind === "interact" &&
      discovery.progression.completion.interaction === "rest" &&
      discovery.type !== "resting-hollow"
    ) {
      add(`${path}.progression.completion.interaction`, "rest is reserved for resting hollows");
    }
    if (
      discovery.type === "resting-hollow" &&
      (discovery.progression.completion.kind !== "interact" ||
        discovery.progression.completion.interaction !== "rest")
    ) {
      add(`${path}.progression.completion`, "resting hollows must complete through rest interaction");
    }
  }

  const eventIds = new Set<string>();
  const eventRevealedIds = new Set<string>();
  for (const [index, event] of spec.journeyEvents.entries()) {
    const path = `journeyEvents[${index}]`;
    if (!ID_PATTERN.test(event.id)) add(`${path}.id`, "must be a lowercase stable id");
    if (eventIds.has(event.id)) add(`${path}.id`, "must be unique");
    eventIds.add(event.id);
    if (!discoveryIds.has(event.anchorDiscoveryId)) {
      add(`${path}.anchorDiscoveryId`, "unknown discovery");
    }
    if (!(event.triggerRadiusMeters > 0)) {
      add(`${path}.triggerRadiusMeters`, "must be positive");
    }
    if (!Number.isInteger(event.responseDelayTicks) || event.responseDelayTicks < 1) {
      add(`${path}.responseDelayTicks`, "must be a positive integer");
    }
    if (event.revealDiscoveryIds.length === 0) {
      add(`${path}.revealDiscoveryIds`, "must contain at least one discovery");
    }
    for (const id of event.prerequisiteDiscoveryIds) {
      if (!discoveryIds.has(id)) add(`${path}.prerequisiteDiscoveryIds`, `unknown discovery ${id}`);
    }
    for (const id of event.revealDiscoveryIds) {
      if (!discoveryIds.has(id)) add(`${path}.revealDiscoveryIds`, `unknown discovery ${id}`);
      const target = spec.discoveries.find((discovery) => discovery.id === id);
      if (target && target.progression.reveal.kind !== "event") {
        add(`${path}.revealDiscoveryIds`, `${id} must use event reveal progression`);
      }
      if (eventRevealedIds.has(id)) {
        add(`${path}.revealDiscoveryIds`, `${id} is already owned by another journey event`);
      }
      eventRevealedIds.add(id);
    }
  }

  for (const [index, discovery] of spec.discoveries.entries()) {
    const path = `discoveries[${index}].progression`;
    for (const id of discovery.progression.prerequisiteIds) {
      if (!discoveryIds.has(id)) add(`${path}.prerequisiteIds`, `unknown discovery ${id}`);
      if (id === discovery.id) add(`${path}.prerequisiteIds`, "cannot reference itself");
    }
    if (discovery.progression.reveal.kind === "event" && !eventRevealedIds.has(discovery.id)) {
      add(`${path}.reveal`, "event-revealed discovery has no revealing journey event");
    }
  }

  const prerequisites = new Map(
    spec.discoveries.map((discovery) => [discovery.id, discovery.progression.prerequisiteIds]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const prerequisite of prerequisites.get(id) ?? []) {
      if (visit(prerequisite)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of discoveryIds) {
    if (visit(id)) {
      add("discoveries", "progression prerequisites must not contain a cycle");
      break;
    }
  }

  if (spec.schemaVersion === 4) {
    const loop = spec.topology.coastalLoopRegionIds;
    if (new Set(loop).size !== loop.length || loop.length < 3) {
      add("topology.coastalLoopRegionIds", "must contain at least three unique regions");
    }
    for (const id of loop) {
      if (!regionIds.has(id)) add("topology.coastalLoopRegionIds", `references unknown region ${id}`);
    }
    if (!regionIds.has(spec.topology.centralHighlandRegionId)) {
      add("topology.centralHighlandRegionId", "must reference a region");
    }
    if (loop.includes(spec.topology.centralHighlandRegionId)) {
      add("topology.centralHighlandRegionId", "must not be part of the coastal loop");
    }

    const edgeKey = (left: string, right: string) => [left, right].sort().join("::");
    for (let index = 0; index < loop.length; index += 1) {
      const from = loop[index];
      const to = loop[(index + 1) % loop.length];
      if (!from || !to) continue;
      const matches = spec.requiredConnections.filter((connection) =>
        edgeKey(connection.fromRegionId, connection.toRegionId) === edgeKey(from, to) &&
        connection.role === "coastal-loop" &&
        connection.kind === "safe" &&
        connection.mandatory);
      if (matches.length !== 1) {
        add("topology.coastalLoopRegionIds", `requires exactly one safe coastal edge ${from} -> ${to}`);
      }
    }

    const safeNeighbours = new Map<string, Set<string>>(
      [...regionIds].map((id) => [id, new Set<string>()]),
    );
    for (const connection of spec.requiredConnections) {
      if (connection.kind !== "safe" || !connection.mandatory) continue;
      safeNeighbours.get(connection.fromRegionId)?.add(connection.toRegionId);
      safeNeighbours.get(connection.toRegionId)?.add(connection.fromRegionId);
    }
    const reachable = new Set<string>();
    const queue = [spec.spawn.regionId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || reachable.has(current)) continue;
      reachable.add(current);
      for (const neighbour of safeNeighbours.get(current) ?? []) queue.push(neighbour);
    }
    for (const id of regionIds) {
      if (!reachable.has(id)) add("requiredConnections", `safe graph cannot reach ${id} from spawn`);
    }
    const highland = spec.topology.centralHighlandRegionId;
    const highlandConnections = spec.requiredConnections.filter((connection) =>
      connection.fromRegionId === highland || connection.toRegionId === highland);
    if (!highlandConnections.some((connection) => connection.kind === "safe" && connection.mandatory)) {
      add("requiredConnections", "central highland needs a mandatory safe approach");
    }
    if (!highlandConnections.some((connection) => connection.kind === "expressive")) {
      add("requiredConnections", "central highland needs an expressive approach");
    }

    const mandatoryTraces = spec.discoveries.filter((discovery) => discovery.mandatory);
    if (mandatoryTraces.length !== 5 || mandatoryTraces.some((discovery) => discovery.type !== "herd-trace")) {
      add("discoveries", "schema version 4 requires exactly five mandatory herd traces");
    }
    const traceRegions = new Set(mandatoryTraces.map((discovery) => discovery.regionId));
    if (traceRegions.size !== 5 || [...regionIds].some((id) => !traceRegions.has(id))) {
      add("discoveries", "requires exactly one mandatory herd trace in every region");
    }
    const finalTrace = mandatoryTraces.find(
      (discovery) => discovery.regionId === spec.topology.centralHighlandRegionId,
    );
    const earlierTraceIds = mandatoryTraces
      .filter((discovery) => discovery.id !== finalTrace?.id)
      .map((discovery) => discovery.id)
      .sort();
    if (!finalTrace) {
      add("discoveries", "central highland must contain the final herd trace");
    } else {
      const prerequisites = [...finalTrace.progression.prerequisiteIds].sort();
      if (
        prerequisites.length !== earlierTraceIds.length ||
        prerequisites.some((id, index) => id !== earlierTraceIds[index])
      ) {
        add(`discoveries.${finalTrace.id}`, "final trace must require the other four traces");
      }
      if (finalTrace.progression.reveal.kind !== "event") {
        add(`discoveries.${finalTrace.id}`, "final trace must be event revealed");
      }
      if (finalTrace.progression.completion.kind !== "linger") {
        add(`discoveries.${finalTrace.id}`, "final trace must complete by linger");
      }
      const finalEvents = spec.journeyEvents.filter((event) =>
        event.revealDiscoveryIds.length === 1 && event.revealDiscoveryIds[0] === finalTrace.id);
      if (finalEvents.length !== 1) {
        add("journeyEvents", "exactly one call event must reveal the final trace");
      }
    }
    for (const trace of mandatoryTraces.filter((discovery) => discovery.id !== finalTrace?.id)) {
      if (trace.progression.prerequisiteIds.length !== 0) {
        add(`discoveries.${trace.id}`, "the first four traces must support sequence breaking");
      }
    }
    const restingHollows = spec.discoveries.filter(
      (discovery) => !discovery.mandatory && discovery.type === "resting-hollow",
    );
    if (restingHollows.length < 2) {
      add("discoveries", "schema version 4 requires at least two optional resting hollows");
    }
  }

  return issues;
}

export function assertValidWorldSpec(spec: WorldSpec): void {
  const issues = validateWorldSpec(spec);
  if (issues.length === 0) return;
  throw new Error(
    `Invalid WorldSpec:\n${issues.map((issue) => `- ${issue.path}: ${issue.message}`).join("\n")}`,
  );
}
