import { MathUtils, PerspectiveCamera, Vector3 } from "three";
import type { CameraObstructionProbe } from "./cameraObstruction";

export interface ChaseCameraSettings {
  /** Multiplier on raw pointer movement. */
  sensitivity: number;
  invertLookY: boolean;
  /** Field of view at rest, degrees. Speed adds to this. */
  baseFieldOfView: number;
  /** How hard the camera chases the horse. Lower is looser and more cinematic. */
  followStrength: number;
  reducedMotion: boolean;
}

export const DEFAULT_CAMERA_SETTINGS: ChaseCameraSettings = {
  sensitivity: 1,
  invertLookY: false,
  baseFieldOfView: 62,
  followStrength: 1,
  reducedMotion: false,
};

export interface ChaseCameraTarget {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly speed: number;
  readonly grounded: boolean;
}

const MIN_PITCH = -0.16;
const MAX_PITCH = 0.66;
const BASE_DISTANCE = 6.3;
const PIVOT_HEIGHT = 1.62;
/**
 * The camera flattens towards the horizon as the horse speeds up.
 *
 * Looking down at a galloping horse across an empty foreground was the single
 * biggest reason the first evidence pass read as "model being dragged": most
 * of the frame was ground with nothing in it, and the world barely moved
 * through shot. Riding closer to the ground plane puts terrain through the
 * frame instead.
 */
const RESTING_PITCH = 0.2;
const GALLOP_PITCH = 0.1;
const SWEEP_RADIUS = 0.32;
const AUTO_ALIGN_DELAY = 1.1;
/**
 * A sweep that reports contact at zero distance means the arm's own origin is
 * already inside geometry. Pulling the camera to minimum then hides the horse
 * for no reason, so those hits are ignored and the previous distance holds.
 */
const PENETRATION_EPSILON = 0.05;

/**
 * Spring-arm chase camera.
 *
 * Camera state is presentation only and is never saved or fed back into the
 * simulation, apart from the yaw the horse uses to interpret steering input.
 */
export class ChaseCamera {
  public readonly settings: ChaseCameraSettings = { ...DEFAULT_CAMERA_SETTINGS };

  private yawAngle = 0;
  private pitchAngle = RESTING_PITCH;
  private distance = BASE_DISTANCE;
  private obstructedDistance = BASE_DISTANCE;
  private fieldOfView = DEFAULT_CAMERA_SETTINGS.baseFieldOfView;
  private idleLookSeconds = 0;
  private shake = 0;
  private initialized = false;

  private readonly pivot = new Vector3();
  private readonly desired = new Vector3();
  private readonly smoothedPivot = new Vector3();
  private readonly lookTarget = new Vector3();

  public constructor(
    public readonly camera: PerspectiveCamera,
    private readonly obstruction: CameraObstructionProbe,
    private readonly groundHeightAt: (x: number, z: number) => number,
  ) {}

  /** Radians. The horse reads this to convert input into travel intent. */
  public get yaw(): number {
    return this.yawAngle;
  }

  public setYaw(yaw: number): void {
    this.yawAngle = yaw;
  }

  /** Raw pointer deltas in pixels. */
  public look(deltaX: number, deltaY: number): void {
    const scale = 0.0026 * this.settings.sensitivity;
    this.yawAngle -= deltaX * scale;
    const pitchDelta = deltaY * scale * (this.settings.invertLookY ? -1 : 1);
    this.pitchAngle = MathUtils.clamp(this.pitchAngle + pitchDelta, MIN_PITCH, MAX_PITCH);
    this.idleLookSeconds = 0;
  }

  /** Called on hard landings. Suppressed entirely when reduced motion is on. */
  public impulse(strength: number): void {
    if (this.settings.reducedMotion) return;
    this.shake = Math.min(1, this.shake + strength);
  }

  public update(target: ChaseCameraTarget, deltaSeconds: number): void {
    const dt = Math.min(0.1, Math.max(0.0001, deltaSeconds));
    const speedRatio = MathUtils.clamp(target.speed / 16, 0, 1);
    const motionScale = this.settings.reducedMotion ? 0.4 : 1;

    // Slow auto-alignment behind the horse once the player stops steering the
    // camera. Fast enough to help, slow enough that it never fights the mouse.
    this.idleLookSeconds += dt;
    const restingPitch = MathUtils.lerp(RESTING_PITCH, GALLOP_PITCH, speedRatio);
    // Follows from a walk, not from a canter.
    //
    // The old gate was 2.5 m/s, which is faster than a horse walks, so turning
    // at low speed left the camera pointing wherever it had been and the player
    // steering a horse they were watching side-on. Now that the reins turn the
    // animal rather than aiming it at the camera, the camera has to keep up.
    if (this.idleLookSeconds > AUTO_ALIGN_DELAY && target.speed > 0.4) {
      const align = (1.1 + speedRatio * 1.6) * dt;
      this.yawAngle = approachAngle(this.yawAngle, target.yaw, align);
      this.pitchAngle = MathUtils.damp(this.pitchAngle, restingPitch, 0.9, dt);
    }

    // The arm pivots on the horse itself. An earlier version pushed the pivot
    // forward with velocity, which put the sweep origin inside whatever the
    // horse was about to reach — a rising slope, a tree, the boundary — and
    // jammed the camera against the horse's rump at speed.
    this.pivot.set(target.x, target.y + PIVOT_HEIGHT, target.z);
    const lookAhead = speedRatio * 2.4 * motionScale;

    if (!this.initialized) {
      this.smoothedPivot.copy(this.pivot);
      this.initialized = true;
    } else {
      const follow = 6 * this.settings.followStrength;
      this.smoothedPivot.x = MathUtils.damp(this.smoothedPivot.x, this.pivot.x, follow, dt);
      this.smoothedPivot.z = MathUtils.damp(this.smoothedPivot.z, this.pivot.z, follow, dt);
      // Vertical follow is looser so jumps read as the horse leaving the ground
      // rather than the whole world moving down.
      this.smoothedPivot.y = MathUtils.damp(
        this.smoothedPivot.y,
        this.pivot.y,
        target.grounded ? follow * 0.7 : follow * 0.35,
        dt,
      );
    }

    // Kept inside the architecture's 6-7 metre band even at full gallop, so the
    // horse stays a readable size rather than shrinking into the landscape.
    const targetDistance = BASE_DISTANCE + speedRatio * 0.9;
    this.distance = MathUtils.damp(this.distance, targetDistance, 3, dt);

    const horizontal = Math.cos(this.pitchAngle) * this.distance;
    this.desired.set(
      this.smoothedPivot.x - Math.sin(this.yawAngle) * horizontal,
      this.smoothedPivot.y + Math.sin(this.pitchAngle) * this.distance,
      this.smoothedPivot.z - Math.cos(this.yawAngle) * horizontal,
    );

    // Obstruction: snap inwards immediately so the player never sees through a
    // tree trunk, then ease back out once the line is clear again.
    const clearance = this.obstruction.sweep(this.smoothedPivot, this.desired, SWEEP_RADIUS);
    const allowed =
      clearance === null || clearance < PENETRATION_EPSILON
        ? this.distance
        : Math.max(1.5, clearance - 0.12);
    this.obstructedDistance =
      allowed < this.obstructedDistance
        ? allowed
        : MathUtils.damp(this.obstructedDistance, allowed, 3.4, dt);

    const finalHorizontal = Math.cos(this.pitchAngle) * this.obstructedDistance;
    this.camera.position.set(
      this.smoothedPivot.x - Math.sin(this.yawAngle) * finalHorizontal,
      this.smoothedPivot.y + Math.sin(this.pitchAngle) * this.obstructedDistance,
      this.smoothedPivot.z - Math.cos(this.yawAngle) * finalHorizontal,
    );

    // Never let the camera drop through the ground or the sea surface.
    const floor = this.groundHeightAt(this.camera.position.x, this.camera.position.z) + 0.55;
    if (this.camera.position.y < floor) this.camera.position.y = floor;

    if (this.shake > 0.001) {
      this.shake = MathUtils.damp(this.shake, 0, 6, dt);
      const amount = this.shake * 0.09;
      this.camera.position.y += Math.sin(this.shake * 41) * amount;
      this.camera.position.x += Math.cos(this.shake * 37) * amount * 0.6;
    } else {
      this.shake = 0;
    }

    // Look-ahead lives on the look target, not the arm: the player sees where
    // they are going without the spring arm chasing a point in the scenery.
    this.lookTarget.set(
      this.smoothedPivot.x + Math.sin(target.yaw) * lookAhead,
      this.smoothedPivot.y + 0.1,
      this.smoothedPivot.z + Math.cos(target.yaw) * lookAhead,
    );
    this.camera.lookAt(this.lookTarget);

    // A speed-driven field of view change. Large enough to feel, small enough
    // that it never becomes the reason a player feels motion sick. The curve is
    // eased rather than squared so the widening starts at canter, where the
    // player first commits to speed, instead of only at the top of gallop.
    const fovCurve = speedRatio * speedRatio * (3 - 2 * speedRatio);
    const targetFov =
      this.settings.baseFieldOfView + fovCurve * 12 * motionScale;
    this.fieldOfView = MathUtils.damp(this.fieldOfView, targetFov, 2.6, dt);
    if (Math.abs(this.camera.fov - this.fieldOfView) > 0.01) {
      this.camera.fov = this.fieldOfView;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Diagnostics only. */
  public get currentDistance(): number {
    return this.obstructedDistance;
  }

  public get isObstructed(): boolean {
    return this.obstructedDistance < this.distance - 0.08;
  }
}

function approachAngle(current: number, target: number, maximumDelta: number): number {
  const twoPi = Math.PI * 2;
  let delta = ((target - current + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  delta = MathUtils.clamp(delta, -maximumDelta, maximumDelta);
  return current + delta;
}
