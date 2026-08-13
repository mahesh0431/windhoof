import type { Vec3 } from "../game/contracts/math";
import type {
  WorldSafetyQuery,
  WorldSurface,
  WorldSurfaceQuery,
} from "../game/contracts/worldSurface";
import { RAPIER } from "../physics/rapierRuntime";
import type { CameraObstructionProbe } from "../render/camera/cameraObstruction";
import {
  STAGE_BOUNDARY_RADIUS,
  STAGE_PROPS,
  STAGE_SAFE_GROUND_RADIUS,
  stageHeightAt,
  stageSurfaceAt,
  type StageProp,
} from "./horseLabStage";
import { propCollisionShape } from "./stagePropShapes";
import { buildStageTerrainMesh, type StageTerrainMesh } from "./stageTerrainMesh";

export interface PlacedProp extends StageProp {
  readonly y: number;
}

/**
 * Builds the Rapier side of the Horse Lab stage and exposes the camera's
 * obstruction query. This is scenery assembly, not horse physics: the horse's
 * own collider and motion rules stay in `src/physics`, owned by the simulation.
 */
export class StageWorld
  implements CameraObstructionProbe, WorldSurfaceQuery, WorldSafetyQuery
{
  public readonly world: RAPIER.World;
  public readonly terrain: StageTerrainMesh;
  public readonly placedProps: readonly PlacedProp[];

  private readonly sweepShape: RAPIER.Ball;
  private disposed = false;

  public constructor() {
    this.world = new RAPIER.World({ x: 0, y: -19, z: 0 });
    this.terrain = buildStageTerrainMesh();
    this.sweepShape = new RAPIER.Ball(0.3);

    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(this.terrain.positions, this.terrain.indices),
    );

    this.createBoundaryWall();

    this.placedProps = STAGE_PROPS.map((prop) => ({
      ...prop,
      y: stageHeightAt(prop.x, prop.z),
    }));

    for (const prop of this.placedProps) {
      this.createPropCollider(prop);
    }

    this.world.step();
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

    // The sweep starts inside the horse's own capsule, so without excluding
    // kinematic bodies every cast reports an immediate penetration hit and the
    // camera sits permanently jammed against the horse's rump.
    const hit = this.world.castShape(
      from,
      IDENTITY_ROTATION,
      direction,
      shape,
      0,
      distance,
      true,
      RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
    );

    if (!hit) return null;
    return Math.min(distance, Math.max(0, hit.time_of_impact));
  }

  public surfaceAt(x: number, z: number): WorldSurface {
    return stageSurfaceAt(x, z);
  }

  public isSafeGround(x: number, z: number): boolean {
    return Math.hypot(x, z) <= STAGE_SAFE_GROUND_RADIUS;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.world.free();
  }

  /**
   * An inward-facing collision ring out in the shallows. It has no visual
   * counterpart on purpose: the sea itself is the readable boundary, and a
   * fence in the water would look like a mistake.
   */
  private createBoundaryWall(): void {
    const segments = 72;
    const bottom = -8;
    const top = 16;
    const vertices = new Float32Array(segments * 2 * 3);
    const indices = new Uint32Array(segments * 6);

    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      const x = Math.cos(angle) * STAGE_BOUNDARY_RADIUS;
      const z = Math.sin(angle) * STAGE_BOUNDARY_RADIUS;
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

    this.world.createCollider(RAPIER.ColliderDesc.trimesh(vertices, indices));
  }

  private createPropCollider(prop: PlacedProp): void {
    const shape = propCollisionShape(prop.kind, prop.scale);
    if (!shape) return;

    let descriptor: RAPIER.ColliderDesc;
    switch (shape.kind) {
      case "ball":
        descriptor = RAPIER.ColliderDesc.ball(shape.radius);
        break;
      case "cylinder":
        descriptor = RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
        break;
      case "box":
        descriptor = RAPIER.ColliderDesc.cuboid(
          shape.halfLength,
          shape.halfHeight,
          shape.radius,
        );
        break;
    }

    const halfYaw = prop.yaw * 0.5;
    this.world.createCollider(
      descriptor
        .setTranslation(prop.x, prop.y + shape.centreOffset, prop.z)
        .setRotation({
          x: 0,
          y: Math.sin(halfYaw),
          z: 0,
          w: Math.cos(halfYaw),
        }),
    );
  }
}

const IDENTITY_ROTATION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
