import type { Vec3 } from "../../game/contracts/math";

/**
 * The chase camera needs to know whether the world is between it and the horse.
 * It asks through this interface rather than importing Rapier, so the camera
 * stays a pure presentation concern and can be tested against a stub.
 */
export interface CameraObstructionProbe {
  /**
   * Sweeps a small sphere from `from` towards `to`.
   *
   * @returns the unobstructed distance along the ray, or `null` when clear.
   */
  sweep(from: Vec3, to: Vec3, radius: number): number | null;
}

export const NULL_OBSTRUCTION_PROBE: CameraObstructionProbe = {
  sweep: () => null,
};
