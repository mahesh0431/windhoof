import type { Vec3 } from "../../contracts/math";
import type { DiscoveryKind } from "../../contracts/discovery";

interface WorldSpecBase {
  readonly generatorVersion: string;
  readonly worldId: string;
  readonly seed: number;
  readonly presentation: {
    readonly mood: string;
    readonly atmosphere: string;
    readonly lighting: string;
    readonly palette: readonly string[];
  };
  readonly island: {
    readonly sizeMeters: number;
    readonly seaLevelMeters: number;
    readonly chunkSizeMeters: number;
    readonly terrainSamplesPerEdge: number;
  };
  readonly spawn: {
    readonly regionId: string;
    readonly clearanceRadiusMeters: number;
    readonly maxSlopeDegrees: number;
  };
  readonly regions: readonly RegionSpec[];
  readonly requiredConnections: readonly ConnectionSpec[];
  readonly discoveries: readonly DiscoverySpec[];
  readonly journeyEvents: readonly JourneyEventSpec[];
}

/** Frozen vertical-slice source contract. */
export interface WorldSpecV3 extends WorldSpecBase {
  readonly schemaVersion: 3;
}

/** Full first-island source contract with an executable global plan. */
export interface WorldSpecV4 extends WorldSpecBase {
  readonly schemaVersion: 4;
  readonly topology: {
    readonly coastalLoopRegionIds: readonly string[];
    readonly centralHighlandRegionId: string;
  };
}

export type WorldSpec = WorldSpecV3 | WorldSpecV4;

export interface RegionSpec {
  readonly id: string;
  readonly role: string;
  /** Authored global-plan anchor in island-local metres. */
  readonly anchorMeters: {
    readonly x: number;
    readonly z: number;
  };
  readonly coverage: number;
  readonly elevationMeters: readonly [number, number];
  readonly moisture: readonly [number, number];
  readonly maxSlopeDegrees: number;
  readonly adjacentTo: readonly string[];
  readonly tags: readonly string[];
  readonly visualIntent: {
    readonly terrainFamily: "coastal" | "grassland" | "woodland";
    readonly silhouette: string;
    readonly scatterFamilies: readonly string[];
    readonly scatterDensity: number;
  };
  /** Required by schema v4; omitted by the frozen schema-v3 slice. */
  readonly terrainIntent?: {
    readonly anchorElevationMeters: number;
    readonly influenceRadiusMeters: number;
  };
}

export interface ConnectionSpec {
  readonly id: string;
  readonly fromRegionId: string;
  readonly toRegionId: string;
  readonly minimumWidthMeters: number;
  readonly maximumSlopeDegrees: number;
  readonly mandatory: boolean;
  /** Required by schema v4; v3 keeps its legacy generated-route policy. */
  readonly kind?: "safe" | "expressive";
  readonly role?: "coastal-loop" | "regional-link" | "interior-shortcut";
  readonly viaMeters?: readonly {
    readonly x: number;
    readonly z: number;
  }[];
}

export interface DiscoverySpec {
  readonly id: string;
  readonly type: DiscoveryKind;
  readonly regionId: string;
  /** Authored scene placement; deterministic seeds never collapse story beats. */
  readonly offsetFromRegionAnchorMeters: {
    readonly x: number;
    readonly z: number;
  };
  readonly mandatory: boolean;
  /** Stable narrative ordering; authored array order is never game logic. */
  readonly journeyOrder: number;
  readonly progression: {
    readonly prerequisiteIds: readonly string[];
    readonly reveal:
      | { readonly kind: "proximity"; readonly radiusMeters: number }
      | { readonly kind: "event" };
    readonly visitRadiusMeters: number;
    readonly completion:
      | { readonly kind: "proximity" }
      | { readonly kind: "interact"; readonly interaction: "inspect" | "rest" }
      | { readonly kind: "call" }
      | { readonly kind: "linger"; readonly ticks: number };
    readonly autosave: boolean;
  };
  readonly signals: readonly {
    readonly kind: "silhouette" | "sound" | "tracks" | "wildlife" | "light" | "motion";
    readonly description: string;
  }[];
}

export interface JourneyEventSpec {
  readonly id: string;
  readonly type: "call-response";
  readonly anchorDiscoveryId: string;
  readonly prerequisiteDiscoveryIds: readonly string[];
  readonly triggerRadiusMeters: number;
  readonly responseDelayTicks: number;
  readonly revealDiscoveryIds: readonly string[];
}

export interface CompiledRegion extends RegionSpec {
  readonly stableId: string;
  readonly anchor: Vec3;
}

export interface CompiledRoute {
  readonly id: string;
  readonly stableId: string;
  readonly connectionId: string;
  readonly kind: "safe" | "expressive";
  readonly widthMeters: number;
  readonly maximumSlopeDegrees: number;
  readonly mandatory: boolean;
  readonly role?: "coastal-loop" | "regional-link" | "interior-shortcut";
  readonly waypoints: readonly Vec3[];
}

export interface CompiledDiscovery extends DiscoverySpec {
  readonly stableId: string;
  readonly position: Vec3;
}

export interface CompiledJourneyEvent extends JourneyEventSpec {
  readonly stableId: string;
  readonly position: Vec3;
}

export interface TerrainChunk {
  readonly id: string;
  readonly stableId: string;
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly originX: number;
  readonly originZ: number;
  readonly sampleSpacingMeters: number;
  readonly samplesPerEdge: number;
  readonly heights: readonly number[];
  /** Row-major per-sample semantic fields, matching `heights`. */
  readonly regionMask: readonly string[];
  readonly moisture: readonly number[];
  readonly shoreDistanceMeters: readonly number[];
  readonly slopeDegrees: readonly number[];
  readonly traversable: readonly boolean[];
}

export interface CompiledPlacement {
  readonly id: string;
  readonly stableId: string;
  readonly regionId: string;
  readonly category: "scatter-zone" | "landmark-anchor";
  readonly position: Vec3;
  readonly yaw: number;
  readonly scale: number;
  readonly collisionRadiusMeters: number;
}

export interface ExclusionZone {
  readonly id: string;
  readonly stableId: string;
  readonly reason: "spawn-clearance" | "route-clearance" | "discovery-clearance";
  readonly centre: Vec3;
  readonly radiusMeters: number;
}

export interface WorldManifest {
  readonly schemaVersion: 3 | 4;
  readonly generatorVersion: string;
  readonly worldId: string;
  readonly seed: number;
  readonly presentation: WorldSpec["presentation"];
  readonly topology?: WorldSpecV4["topology"];
  readonly island: WorldSpec["island"] & { readonly chunksPerEdge: number };
  readonly spawn: {
    readonly position: Vec3;
    readonly yaw: number;
    readonly clearanceRadiusMeters: number;
    readonly maximumSlopeDegrees: number;
  };
  readonly regions: readonly CompiledRegion[];
  readonly routes: readonly CompiledRoute[];
  readonly discoveries: readonly CompiledDiscovery[];
  readonly journeyEvents: readonly CompiledJourneyEvent[];
  readonly placements: readonly CompiledPlacement[];
  readonly exclusions: readonly ExclusionZone[];
  readonly chunks: readonly TerrainChunk[];
  readonly sourceSpecHash: string;
  readonly manifestHash: string;
}

export interface WorldValidationIssue {
  readonly path: string;
  readonly message: string;
}
