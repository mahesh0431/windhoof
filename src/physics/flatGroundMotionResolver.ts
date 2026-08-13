import type { Vec3 } from "../game/contracts/math";
import type { HorseState } from "../game/simulation/horse/horseState";
import type { HorseMotionResolver, HorseMotionResult } from "./horseMotionResolver";

/** Deterministic test resolver. The production runtime uses the Rapier bridge. */
export class FlatGroundMotionResolver implements HorseMotionResolver {
  public constructor(private readonly groundHeight = 0) {}

  public resolve(
    state: HorseState,
    desiredTranslation: Vec3,
    fixedStepSeconds: number,
  ): HorseMotionResult {
    void fixedStepSeconds;
    const proposedY = state.position.y + desiredTranslation.y;
    const grounded = proposedY <= this.groundHeight;

    return {
      position: {
        x: state.position.x + desiredTranslation.x,
        y: grounded ? this.groundHeight : proposedY,
        z: state.position.z + desiredTranslation.z,
      },
      grounded,
      hitCeiling: false,
      blockedHorizontally: false,
      safeGround: grounded,
    };
  }
}
