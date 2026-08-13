import type { StagePropKind } from "./horseLabStage";

export interface PropCollisionShape {
  readonly kind: "ball" | "cylinder" | "box";
  /** Ball/cylinder radius, or box half-depth. */
  readonly radius: number;
  /** Cylinder half-height, or box half-height. Ignored for balls. */
  readonly halfHeight: number;
  /** Box half-length along the prop's local X axis. */
  readonly halfLength: number;
  /** Centre offset above the ground contact point. */
  readonly centreOffset: number;
}

export interface PropVisualShape {
  readonly height: number;
  readonly radius: number;
}

/**
 * Collision proxies are deliberately simpler than the visible prop, per the art
 * brief. Shrubs and markers have no collider at all: a horse should be able to
 * ride straight through grass tufts without the world feeling sticky.
 */
export function propCollisionShape(
  kind: StagePropKind,
  scale: number,
): PropCollisionShape | null {
  switch (kind) {
    case "rock":
      return {
        kind: "ball",
        radius: 0.62 * scale,
        halfHeight: 0,
        halfLength: 0,
        centreOffset: 0.34 * scale,
      };
    case "boulder":
      return {
        kind: "cylinder",
        radius: 1.55 * scale,
        halfHeight: 1.3 * scale,
        halfLength: 0,
        centreOffset: 1.15 * scale,
      };
    case "log":
      return {
        kind: "box",
        radius: 0.44 * scale,
        halfHeight: 0.44 * scale,
        halfLength: 1.75 * scale,
        centreOffset: 0.4 * scale,
      };
    case "tree":
      return {
        kind: "cylinder",
        radius: 0.38 * scale,
        halfHeight: 2.8 * scale,
        halfLength: 0,
        centreOffset: 2.6 * scale,
      };
    case "shrub":
    case "marker":
      return null;
  }
}

export function propVisualShape(
  kind: StagePropKind,
  scale: number,
): PropVisualShape {
  switch (kind) {
    case "rock":
      return { height: 0.8 * scale, radius: 0.7 * scale };
    case "boulder":
      return { height: 2.6 * scale, radius: 1.6 * scale };
    case "log":
      return { height: 0.9 * scale, radius: 1.8 * scale };
    case "tree":
      return { height: 7.4 * scale, radius: 2.6 * scale };
    case "shrub":
      return { height: 0.9 * scale, radius: 0.8 * scale };
    case "marker":
      return { height: 1.2 * scale, radius: 0.3 * scale };
  }
}
