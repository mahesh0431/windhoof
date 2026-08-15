import type { Vec3 } from "../game/contracts/math";
import type {
  WorldSafetyQuery,
  WorldSurface,
  WorldSurfaceQuery,
} from "../game/contracts/worldSurface";
import type { WorldManifest } from "../game/world/compiler/worldTypes";
import { IslandChunkRepository } from "../game/world/runtime/islandChunkRepository";
import { sampleManifest } from "../game/world/runtime/sampleManifest";
import type { TerrainChunkTopology } from "../game/world/runtime/terrainChunkTopology";
import type { CameraObstructionProbe } from "../render/camera/cameraObstruction";
import { RAPIER } from "./rapierRuntime";

const IDENTITY_ROTATION = { x: 0, y: 0, z: 0, w: 1 };
const SAFE_GROUND_MAX_SLOPE_DEGREES = 18;
const SAFE_GROUND_FOOTPRINT_RADIUS_METERS = 1.5;
const SAFE_GROUND_MAX_RELIEF_METERS =
  Math.tan((SAFE_GROUND_MAX_SLOPE_DEGREES * Math.PI) / 180) *
  SAFE_GROUND_FOOTPRINT_RADIUS_METERS;
const SAFE_GROUND_OFFSETS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];
const TERRAIN_COLLIDERS_PER_BUILD_JOB = 8;

export type PhysicsBuildJob = <T>(name: string, work: () => T) => Promise<T>;

export function compiledIslandBoundaryRadius(manifest: WorldManifest): number {
  return manifest.island.sizeMeters * 0.44;
}

/** Full-world Milestone 2/3 runtime; chunk activation can wrap this later. */
export class CompiledIslandWorld
  implements CameraObstructionProbe, WorldSurfaceQuery, WorldSafetyQuery
{
  public readonly world = new RAPIER.World({ x: 0, y: -19, z: 0 });
  private readonly sweepShape = new RAPIER.Ball(0.3);
  private readonly repository: IslandChunkRepository;
  private readonly ownsRepository: boolean;
  private readonly releasePhysics: Array<() => void> = [];
  private readonly topologyByChunkId = new Map<string, TerrainChunkTopology>();
  private boundaryCollider: RAPIER.Collider | null = null;
  private disposed = false;

  /**
   * Builds the same full-resident collision world as the synchronous constructor,
   * but exposes canonical bounded jobs so the browser can paint between them.
   */
  public static async createStaged(
    manifest: WorldManifest,
    repository: IslandChunkRepository,
    job: PhysicsBuildJob,
  ): Promise<CompiledIslandWorld> {
    const island = new CompiledIslandWorld(manifest, repository, true);
    try {
      const chunkIds = repository.chunkIds();
      for (let offset = 0; offset < chunkIds.length; offset += TERRAIN_COLLIDERS_PER_BUILD_JOB) {
        const group = chunkIds.slice(offset, offset + TERRAIN_COLLIDERS_PER_BUILD_JOB);
        const groupIndex = Math.floor(offset / TERRAIN_COLLIDERS_PER_BUILD_JOB);
        await job(`collision-terrain-${groupIndex.toString().padStart(2, "0")}`, () => {
          island.createTerrainColliders(group);
        });
      }
      await job("collision-placements", () => island.createPlacementColliders());
      await job("collision-boundary", () => island.createBoundaryWall());
      await job("collision-finalize", () => island.world.step());
      return island;
    } catch (error) {
      island.dispose();
      throw error;
    }
  }

  public constructor(
    public readonly manifest: WorldManifest,
    repository?: IslandChunkRepository,
    deferColliderBuild = false,
  ) {
    this.ownsRepository = repository === undefined;
    this.repository = repository ?? new IslandChunkRepository(manifest);
    if (this.repository.manifest.manifestHash !== manifest.manifestHash) {
      throw new Error("Chunk repository manifest does not match physics manifest");
    }
    if (this.repository.snapshot().requestedChunks > 0) this.repository.prepareAllSync();

    if (!deferColliderBuild) {
      this.createTerrainColliders(this.repository.chunkIds());
      this.createPlacementColliders();
      this.createBoundaryWall();
      this.world.step();
    }
  }

  public heightAt(x: number, z: number): number {
    return sampleManifest(this.manifest, x, z).height;
  }

  public terrainTopology(chunkId: string): TerrainChunkTopology {
    const topology = this.topologyByChunkId.get(chunkId);
    if (!topology) throw new Error(`Physics has no topology for ${chunkId}`);
    return topology;
  }

  public colliderCount(): number {
    return this.world.colliders.len();
  }

  public surfaceAt(x: number, z: number): WorldSurface {
    const sample = sampleManifest(this.manifest, x, z);
    if (sample.shoreDistanceMeters < 12) return "sand";
    const region = this.manifest.regions.find((candidate) => candidate.id === sample.regionId);
    if (region?.tags.includes("stream")) return "streambed";
    if (sample.slopeDegrees > 23) return "rock";
    return "grass";
  }

  public isSafeGround(x: number, z: number): boolean {
    const centre = sampleManifest(this.manifest, x, z);
    for (const [offsetX, offsetZ] of SAFE_GROUND_OFFSETS) {
      const sample = sampleManifest(
        this.manifest,
        x + offsetX * SAFE_GROUND_FOOTPRINT_RADIUS_METERS,
        z + offsetZ * SAFE_GROUND_FOOTPRINT_RADIUS_METERS,
      );
      if (
        !sample.traversable ||
        sample.shoreDistanceMeters < 14 ||
        sample.slopeDegrees > SAFE_GROUND_MAX_SLOPE_DEGREES ||
        Math.abs(sample.height - centre.height) > SAFE_GROUND_MAX_RELIEF_METERS
      ) {
        return false;
      }
    }
    return !this.manifest.placements.some(
      (placement) =>
        Math.hypot(x - placement.position.x, z - placement.position.z) <
        placement.collisionRadiusMeters + 2,
    );
  }

  /**
   * Keeps outward intent stopped at the sea while preserving a meaningful
   * steering component along the coast. A vertical containment ring alone can
   * trap keyboard-only play: W+D keeps asking for a partly outward diagonal,
   * so collision rejects every step even after the horse visibly turns.
   */
  public constrainBoundaryTranslation(position: Vec3, desired: Vec3): Vec3 {
    const boundaryRadius = compiledIslandBoundaryRadius(this.manifest);
    const radius = Math.hypot(position.x, position.z);
    if (radius < boundaryRadius - 1.5 || radius < 1e-6) return desired;

    const horizontalLength = Math.hypot(desired.x, desired.z);
    if (horizontalLength < 1e-8) return desired;
    const normalX = position.x / radius;
    const normalZ = position.z / radius;
    const outward = desired.x * normalX + desired.z * normalZ;
    if (outward <= 0) return desired;

    const tangentX = desired.x - outward * normalX;
    const tangentZ = desired.z - outward * normalZ;
    const tangentLength = Math.hypot(tangentX, tangentZ);
    // Straight into the sea still stops. Once the player supplies a real turn,
    // retain full locomotion magnitude along the shoreline.
    if (tangentLength < horizontalLength * 0.15) {
      return { x: 0, y: desired.y, z: 0 };
    }

    // Bias the preserved tangent gently inland. A mathematically exact tangent
    // still hugs a faceted collider and keeps the chase camera compressed; a
    // thirty-degree inward deflection makes the same steering gesture visibly
    // release the shore without turning straight-ahead input into an escape.
    const inwardRatio = 0.5;
    const tangentScale = horizontalLength * Math.sqrt(1 - inwardRatio ** 2) /
      tangentLength;
    return {
      x: tangentX * tangentScale - normalX * horizontalLength * inwardRatio,
      y: desired.y,
      z: tangentZ * tangentScale - normalZ * horizontalLength * inwardRatio,
    };
  }

  /** Guarantees visible inward progress after Rapier resolves a steering step. */
  public constrainBoundaryPosition(
    position: Vec3,
    desired: Vec3,
    constrained: Vec3,
    resolved: Vec3,
  ): Vec3 {
    const boundaryRadius = compiledIslandBoundaryRadius(this.manifest);
    const radius = Math.hypot(position.x, position.z);
    if (radius < boundaryRadius - 3 || radius < 1e-6) return resolved;

    const horizontalLength = Math.hypot(desired.x, desired.z);
    const constrainedLength = Math.hypot(constrained.x, constrained.z);
    if (horizontalLength < 1e-8 || constrainedLength < 1e-8) return resolved;
    const normalX = position.x / radius;
    const normalZ = position.z / radius;
    const outward = desired.x * normalX + desired.z * normalZ;
    if (outward <= 0) return resolved;
    const tangentLength = Math.hypot(
      desired.x - outward * normalX,
      desired.z - outward * normalZ,
    );
    if (tangentLength < horizontalLength * 0.15) return resolved;

    const inwardStep = Math.min(0.05, constrainedLength * 0.5);
    const maximumRadius = radius - inwardStep;
    const resolvedRadius = Math.hypot(resolved.x, resolved.z);
    if (resolvedRadius <= maximumRadius || resolvedRadius < 1e-8) return resolved;
    const scale = maximumRadius / resolvedRadius;
    return { ...resolved, x: resolved.x * scale, z: resolved.z * scale };
  }

  public sweep(from: Vec3, to: Vec3, radius: number): number | null {
    if (this.disposed) return null;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance < 1e-4) return null;
    const direction = { x: dx / distance, y: dy / distance, z: dz / distance };
    const shape = radius === this.sweepShape.radius ? this.sweepShape : new RAPIER.Ball(radius);
    const hit = this.world.castShape(
      from,
      IDENTITY_ROTATION,
      direction,
      shape,
      0,
      distance,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
      undefined,
      undefined,
      undefined,
      (collider) => collider.handle !== this.boundaryCollider?.handle,
    );
    return hit ? Math.min(distance, Math.max(0, hit.time_of_impact)) : null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.free();
    for (const release of this.releasePhysics) release();
    this.releasePhysics.length = 0;
    if (this.ownsRepository) this.repository.dispose();
  }

  private createBoundaryWall(): void {
    const segments = 144;
    const radius = compiledIslandBoundaryRadius(this.manifest);
    const bottom = this.manifest.island.seaLevelMeters - 10;
    const top = this.manifest.island.seaLevelMeters + 24;
    const vertices = new Float32Array(segments * 2 * 3);
    const indices = new Uint32Array(segments * 6);
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      vertices[index * 6] = x;
      vertices[index * 6 + 1] = bottom;
      vertices[index * 6 + 2] = z;
      vertices[index * 6 + 3] = x;
      vertices[index * 6 + 4] = top;
      vertices[index * 6 + 5] = z;
    }
    for (let index = 0; index < segments; index += 1) {
      const next = (index + 1) % segments;
      const a = index * 2;
      const b = a + 1;
      const c = next * 2;
      const d = c + 1;
      indices[index * 6] = a;
      indices[index * 6 + 1] = b;
      indices[index * 6 + 2] = c;
      indices[index * 6 + 3] = b;
      indices[index * 6 + 4] = d;
      indices[index * 6 + 5] = c;
    }
    this.boundaryCollider = this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(vertices, indices),
    );
  }

  private createTerrainColliders(chunkIds: readonly string[]): void {
    for (const chunkId of chunkIds) {
      const topology = this.repository.topology(chunkId);
      this.topologyByChunkId.set(chunkId, topology);
      this.world.createCollider(
        RAPIER.ColliderDesc.trimesh(topology.positions, topology.indices),
      );
      this.releasePhysics.push(this.repository.retain(chunkId, "physics"));
    }
  }

  /**
   * Stands a static cylinder on each scenery trunk.
   *
   * The compiled world owns collision, and the compiler emits only the couple
   * of dozen placements it authored. The woodland the renderer grows on top of
   * that is thousands of trees, and a tree a horse rides through is the single
   * loudest way a world can tell a player it is not real. So the render layer
   * hands its trunks over and physics decides what to do with them: the
   * geometry stays the renderer's, the collision stays here, and nothing about
   * the compiled manifest changes.
   */
  public addSceneryColliders(
    trunks: readonly {
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly radius: number;
      readonly height: number;
    }[],
  ): number {
    for (const trunk of trunks) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(trunk.height * 0.5, trunk.radius).setTranslation(
          trunk.x,
          trunk.y + trunk.height * 0.5,
          trunk.z,
        ),
      );
    }
    return trunks.length;
  }

  private createPlacementColliders(): void {
    for (const placement of this.manifest.placements) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(
          Math.max(0.8, placement.scale),
          placement.collisionRadiusMeters,
        ).setTranslation(
          placement.position.x,
          placement.position.y + Math.max(0.8, placement.scale),
          placement.position.z,
        ),
      );
    }
  }
}
