import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  IcosahedronGeometry,
  Matrix4,
} from "three";
import { mergeGeometries } from "../render/geometryUtils";

/**
 * Trees, as one mesh each.
 *
 * A tree is a trunk and a canopy in two different colours, which normally means
 * two materials and two draw calls. Baking both colours into vertex colours
 * instead means a whole tree is a single instanced mesh: one draw call per
 * species per chunk for an entire forest, and - the reason that matters here -
 * one vertex shader, so the same wind that moves the grass can bend a tree by
 * its own height without the trunk and the canopy shearing apart.
 *
 * Instance colour then multiplies the lot, which is what varies one tree from
 * the next. It tints trunk and leaf together, so it is used for the difference
 * between a tree in the sun and a tree in the hollow rather than for repainting
 * either.
 *
 * Everything is flat shaded and built from a handful of facets, on purpose:
 * this is the same island as the terrain and the rocks, and a smooth canopy in
 * the middle of it reads as an import.
 */

export type TreeSpecies =
  | "broadleaf"
  | "pine"
  | "scrub"
  | "birch"
  | "willow"
  | "deadwood";

export interface TreeShapeOptions {
  readonly trunk: Color;
  readonly canopyLight: Color;
  readonly canopyDark: Color;
}

/**
 * One tree, authored with its root at the origin and a height of about one
 * metre, so an instance's scale is its height in metres.
 */
export function createTreeGeometry(
  species: TreeSpecies,
  options: TreeShapeOptions,
  variant = 0,
): BufferGeometry {
  const parts: Array<{ geometry: BufferGeometry; matrix?: Matrix4 }> = [];
  const random = seeded(variant * 977 + species.length * 31);

  const paint = (geometry: BufferGeometry, top: Color, bottom: Color): BufferGeometry => {
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    if (source !== geometry) geometry.dispose();
    const position = source.getAttribute("position");
    // Vertical gradient inside each mass. Canopies are lit from above and a
    // single flat green is what makes stylised foliage read as a plastic blob.
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let index = 0; index < position.count; index += 1) {
      minimum = Math.min(minimum, position.getY(index));
      maximum = Math.max(maximum, position.getY(index));
    }
    const span = Math.max(0.0001, maximum - minimum);
    const colors = new Float32Array(position.count * 3);
    const mixed = new Color();
    for (let index = 0; index < position.count; index += 1) {
      const t = (position.getY(index) - minimum) / span;
      mixed.copy(bottom).lerp(top, t * t * (3 - 2 * t));
      colors[index * 3] = mixed.r;
      colors[index * 3 + 1] = mixed.g;
      colors[index * 3 + 2] = mixed.b;
    }
    source.setAttribute("color", new BufferAttribute(colors, 3));
    return source;
  };

  if (species === "deadwood") {
    // A bare forked trunk. Nothing reads "this wood is old" faster than one
    // tree in thirty with no leaves on it, and it costs a dozen triangles.
    parts.push({
      geometry: paint(
        new CylinderGeometry(0.03, 0.075, 0.78, 5, 1),
        options.trunk,
        options.trunk.clone().multiplyScalar(0.55),
      ),
      matrix: new Matrix4().makeTranslation(0, 0.39, 0),
    });
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2 + random() * 1.2;
      const length = 0.2 + random() * 0.16;
      parts.push({
        geometry: paint(
          new CylinderGeometry(0.012, 0.03, length, 4, 1),
          options.trunk,
          options.trunk.clone().multiplyScalar(0.6),
        ),
        matrix: new Matrix4()
          .makeTranslation(0, 0.6 + index * 0.08, 0)
          .multiply(new Matrix4().makeRotationY(angle))
          .multiply(new Matrix4().makeRotationZ(0.6 + random() * 0.4))
          .multiply(new Matrix4().makeTranslation(0, length * 0.5, 0)),
      });
    }
    return finish(parts);
  }

  if (species === "scrub") {
    // No trunk worth drawing: a bush is canopy sitting on the ground.
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2 + random() * 1.4;
      const spread = 0.28 + random() * 0.22;
      parts.push({
        geometry: paint(
          new IcosahedronGeometry(0.42, 0),
          options.canopyLight,
          options.canopyDark,
        ),
        matrix: new Matrix4()
          .makeTranslation(
            Math.cos(angle) * spread,
            0.3 + random() * 0.22,
            Math.sin(angle) * spread,
          )
          .multiply(new Matrix4().makeScale(1, 0.72 + random() * 0.3, 1)),
      });
    }
    return finish(parts);
  }

  // --- trunk ---------------------------------------------------------------
  // Five sided and tapered. A round trunk is the single most obvious smooth
  // surface a stylised forest can have, because the player rides right past it.
  const trunkHeight =
    species === "pine" ? 0.52 : species === "birch" ? 0.66 : species === "willow" ? 0.3 : 0.46;
  const trunkTop =
    species === "pine" ? 0.028 : species === "birch" ? 0.022 : species === "willow" ? 0.06 : 0.036;
  const trunkBottom =
    species === "pine" ? 0.055 : species === "birch" ? 0.038 : species === "willow" ? 0.11 : 0.075;
  parts.push({
    geometry: paint(
      new CylinderGeometry(trunkTop, trunkBottom, trunkHeight, 5, 1),
      options.trunk,
      options.trunk.clone().multiplyScalar(0.62),
    ),
    matrix: new Matrix4().makeTranslation(0, trunkHeight * 0.5, 0),
  });

  if (species === "pine") {
    // Stacked skirts, narrowing upwards. Three is enough for the silhouette and
    // the gaps between them are what make it read as a conifer rather than a
    // green cone on a stick.
    const skirts = 4;
    for (let index = 0; index < skirts; index += 1) {
      const t = index / (skirts - 1);
      const y = 0.34 + t * 0.56;
      const radius = 0.3 * (1 - t * 0.72);
      const height = 0.34 * (1 - t * 0.4);
      parts.push({
        geometry: paint(
          new ConeGeometry(radius, height, 6, 1),
          options.canopyLight,
          options.canopyDark,
        ),
        matrix: new Matrix4()
          .makeTranslation(0, y + height * 0.4, 0)
          .multiply(new Matrix4().makeRotationY(random() * Math.PI)),
      });
    }
    return finish(parts);
  }

  if (species === "birch") {
    // Slim and high: a birch is mostly trunk, with a light crown carried well
    // above everything around it. Reads as a different tree from thirty metres
    // purely on proportion, which is the cheapest variety there is.
    for (let index = 0; index < 3; index += 1) {
      const angle = (index / 3) * Math.PI * 2 + random() * 1.1;
      const spread = index === 0 ? 0 : 0.1 + random() * 0.08;
      parts.push({
        geometry: paint(
          new IcosahedronGeometry(index === 0 ? 0.2 : 0.15, 0),
          options.canopyLight,
          options.canopyDark,
        ),
        matrix: new Matrix4()
          .makeTranslation(
            Math.cos(angle) * spread,
            0.72 + random() * 0.16,
            Math.sin(angle) * spread,
          )
          .multiply(new Matrix4().makeScale(1, 1.25, 1)),
      });
    }
    return finish(parts);
  }

  if (species === "willow") {
    // Low, wide and heavy: a crown that spreads further than the tree is tall,
    // sitting on a short thick bole. The shape a river bank has.
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2 + random() * 0.8;
      const spread = index === 0 ? 0 : 0.26 + random() * 0.14;
      parts.push({
        geometry: paint(
          new IcosahedronGeometry(index === 0 ? 0.34 : 0.24, 0),
          options.canopyLight,
          options.canopyDark,
        ),
        matrix: new Matrix4()
          .makeTranslation(
            Math.cos(angle) * spread,
            0.4 + random() * 0.14,
            Math.sin(angle) * spread,
          )
          .multiply(new Matrix4().makeScale(1.3, 0.66, 1.3)),
      });
    }
    return finish(parts);
  }

  // --- broadleaf canopy ----------------------------------------------------
  // Overlapping faceted masses rather than one ball, so the outline is broken
  // and the tree has a lit side and a shaded side of its own.
  const clumps = 4 + Math.floor(random() * 2);
  for (let index = 0; index < clumps; index += 1) {
    const angle = (index / clumps) * Math.PI * 2 + random() * 0.9;
    const spread = index === 0 ? 0 : 0.16 + random() * 0.14;
    const rise = index === 0 ? 0.66 : 0.52 + random() * 0.24;
    const size = index === 0 ? 0.32 : 0.2 + random() * 0.11;
    parts.push({
      geometry: paint(
        new IcosahedronGeometry(size, 0),
        options.canopyLight,
        options.canopyDark,
      ),
      matrix: new Matrix4()
        .makeTranslation(Math.cos(angle) * spread, rise, Math.sin(angle) * spread)
        .multiply(new Matrix4().makeRotationY(random() * Math.PI))
        // Canopies are wider than they are deep; a sphere reads as a lollipop.
        .multiply(new Matrix4().makeScale(1.15, 0.82, 1.15)),
    });
  }

  return finish(parts);
}

function finish(
  parts: Array<{ geometry: BufferGeometry; matrix?: Matrix4 }>,
): BufferGeometry {
  const merged = mergeGeometries(parts);
  for (const part of parts) part.geometry.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Deterministic sequence, so a species always builds the same tree. */
function seeded(seed: number): () => number {
  let state = (seed | 0) + 0x6d2b79f5;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
  };
}
