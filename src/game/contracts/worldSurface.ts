export type WorldSurface = "grass" | "sand" | "rock" | "streambed";

/**
 * Runtime query shared by temporary stages and compiled worlds.
 *
 * Audio and visual effects may consume the answer, but the world runtime owns
 * classification. This keeps presentation independent of whichever terrain
 * source produced the current world.
 */
export interface WorldSurfaceQuery {
  surfaceAt(x: number, z: number): WorldSurface;
}

/** World-owned rule for poses that are suitable recovery/save anchors. */
export interface WorldSafetyQuery {
  isSafeGround(x: number, z: number): boolean;
}
