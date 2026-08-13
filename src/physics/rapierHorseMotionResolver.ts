import type { Vec3 } from "../game/contracts/math";
import type { HorseState } from "../game/simulation/horse/horseState";
import type { HorseMotionResolver, HorseMotionResult } from "./horseMotionResolver";
import { RAPIER } from "./rapierRuntime";

export interface RapierHorseColliderOptions {
  readonly capsuleHalfHeight: number;
  readonly capsuleRadius: number;
  readonly controllerOffset: number;
  readonly autostepMaximumHeight: number;
  readonly autostepMinimumWidth: number;
  readonly snapToGroundDistance: number;
  readonly maximumClimbDegrees: number;
  readonly minimumSlideDegrees: number;
}

export const DEFAULT_RAPIER_HORSE_OPTIONS: RapierHorseColliderOptions = Object.freeze({
  capsuleHalfHeight: 0.78,
  capsuleRadius: 0.52,
  controllerOffset: 0.035,
  autostepMaximumHeight: 0.3,
  autostepMinimumWidth: 0.35,
  snapToGroundDistance: 0.25,
  maximumClimbDegrees: 28,
  minimumSlideDegrees: 32,
});

/**
 * Rapier body coordinates use the capsule centre. HorseState coordinates use
 * the visual root at hoof-ground level, so this bridge owns the Y offset.
 */
export class RapierHorseMotionResolver implements HorseMotionResolver {
  private readonly centreHeight: number;
  private disposed = false;

  public readonly body: RAPIER.RigidBody;
  public readonly collider: RAPIER.Collider;
  public readonly controller: RAPIER.KinematicCharacterController;

  public constructor(
    private readonly world: RAPIER.World,
    initialRootPosition: Vec3,
    options: RapierHorseColliderOptions = DEFAULT_RAPIER_HORSE_OPTIONS,
    private readonly isSafeGround: (position: Vec3) => boolean = () => true,
    private readonly constrainTranslation: (
      position: Vec3,
      desiredTranslation: Vec3,
    ) => Vec3 = (_position, desiredTranslation) => desiredTranslation,
    private readonly constrainResolvedPosition: (
      position: Vec3,
      desiredTranslation: Vec3,
      constrainedTranslation: Vec3,
      resolvedPosition: Vec3,
    ) => Vec3 = (_position, _desired, _constrained, resolved) => resolved,
  ) {
    this.centreHeight = options.capsuleHalfHeight + options.capsuleRadius;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        initialRootPosition.x,
        initialRootPosition.y + this.centreHeight,
        initialRootPosition.z,
      ),
    );
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(options.capsuleHalfHeight, options.capsuleRadius),
      this.body,
    );
    this.controller = world.createCharacterController(options.controllerOffset);
    this.controller.enableAutostep(
      options.autostepMaximumHeight,
      options.autostepMinimumWidth,
      false,
    );
    this.controller.enableSnapToGround(options.snapToGroundDistance);
    this.controller.setMaxSlopeClimbAngle(
      (options.maximumClimbDegrees * Math.PI) / 180,
    );
    this.controller.setMinSlopeSlideAngle(
      (options.minimumSlideDegrees * Math.PI) / 180,
    );
  }

  public resolve(
    state: HorseState,
    desiredTranslation: Vec3,
    fixedStepSeconds: number,
  ): HorseMotionResult {
    this.assertActive();
    this.synchronizeRoot(state.position);
    this.world.timestep = fixedStepSeconds;
    const constrainedTranslation = this.constrainTranslation(
      state.position,
      desiredTranslation,
    );
    this.controller.computeColliderMovement(this.collider, constrainedTranslation);

    const movement = this.controller.computedMovement();
    const currentCentre = this.body.translation();
    const unconstrainedRoot = {
      x: currentCentre.x + movement.x,
      y: currentCentre.y + movement.y - this.centreHeight,
      z: currentCentre.z + movement.z,
    };
    const constrainedRoot = this.constrainResolvedPosition(
      state.position,
      desiredTranslation,
      constrainedTranslation,
      unconstrainedRoot,
    );
    const nextCentre = this.rootToCentre(constrainedRoot);
    this.body.setNextKinematicTranslation(nextCentre);

    let hitCeiling = false;
    const requestedHorizontalLength = Math.hypot(
      desiredTranslation.x,
      desiredTranslation.z,
    );
    const horizontalLength = Math.hypot(
      constrainedTranslation.x,
      constrainedTranslation.z,
    );
    let blockedHorizontally = requestedHorizontalLength > 1e-6 && horizontalLength < 1e-6;
    for (let index = 0; index < this.controller.numComputedCollisions(); index += 1) {
      const collision = this.controller.computedCollision(index);
      if (collision && collision.normal1.y < -0.5 && desiredTranslation.y > 0) {
        hitCeiling = true;
      }
      if (collision && horizontalLength > 1e-6) {
        const opposition =
          -(
            collision.normal1.x * constrainedTranslation.x +
            collision.normal1.z * constrainedTranslation.z
          ) / horizontalLength;
        // Ground and legal slopes have a strongly upward normal. Only a
        // wall-like face opposing travel should brake locomotion state.
        if (collision.normal1.y < 0.7 && opposition > 0.2) {
          blockedHorizontally = true;
        }
      }
    }

    const grounded = this.controller.computedGrounded();
    this.world.step();
    const resolvedCentre = this.body.translation();

    const position = {
      x: resolvedCentre.x,
      y: resolvedCentre.y - this.centreHeight,
      z: resolvedCentre.z,
    };

    return {
      position,
      grounded,
      hitCeiling,
      blockedHorizontally,
      safeGround: grounded && !blockedHorizontally && this.isSafeGround(position),
    };
  }

  public teleport(position: Vec3): void {
    this.assertActive();
    const centre = this.rootToCentre(position);
    this.body.setTranslation(centre, true);
    this.body.setNextKinematicTranslation(centre);
    this.world.propagateModifiedBodyPositionsToColliders();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.world.removeCharacterController(this.controller);
    this.world.removeRigidBody(this.body);
    this.disposed = true;
  }

  private synchronizeRoot(position: Vec3): void {
    const centre = this.body.translation();
    const expected = this.rootToCentre(position);
    const difference =
      Math.abs(centre.x - expected.x) +
      Math.abs(centre.y - expected.y) +
      Math.abs(centre.z - expected.z);

    if (difference > 0.000_01) {
      this.body.setTranslation(expected, true);
      this.world.propagateModifiedBodyPositionsToColliders();
    }
  }

  private rootToCentre(position: Vec3): Vec3 {
    return {
      x: position.x,
      y: position.y + this.centreHeight,
      z: position.z,
    };
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("RapierHorseMotionResolver is disposed");
  }
}
