import {
  BufferAttribute,
  BufferGeometry,
  IcosahedronGeometry,
  Vector3,
} from "three";

/**
 * Stone, as faceted mass rather than as primitives.
 *
 * The island's landmarks are the shapes a rider navigates by - a split sea
 * stack, a ruined arch, a broken black ridge - and they were built from
 * `BoxGeometry` and `CylinderGeometry`. At a hundred metres that is fine,
 * because a silhouette is a silhouette. At twenty metres it is a grey cube
 * standing in a meadow, and it was the least convincing thing on the island by
 * a distance.
 *
 * These builders keep the silhouette the landmark was authored for and replace
 * the surface: corners pushed out of true, faces broken into planes that catch
 * the sun differently, and a light-over-dark gradient baked into vertex colours
 * so a mass has a top and a bottom even when the sun is behind it.
 *
 * Nothing here is random at runtime. Every displacement comes from the seed it
 * is given, so the same landmark is the same rock on every machine.
 */

/** Deterministic sequence, so a rock is always the same rock. */
function seeded(seed: number): () => number {
  let state = (seed | 0) + 0x9e3779b9;
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1);
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61);
    return ((state ^ (state >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Shades a geometry from its own height: lighter on top, darker underneath.
 *
 * Stone in daylight is lit from above and dusty on its upper faces, and on a
 * flat-shaded model this is most of what separates rock from a grey solid.
 */
function shadeByHeight(geometry: BufferGeometry, floor = 0.55): BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  if (source !== geometry) geometry.dispose();
  const position = source.getAttribute("position");
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let index = 0; index < position.count; index += 1) {
    minimum = Math.min(minimum, position.getY(index));
    maximum = Math.max(maximum, position.getY(index));
  }
  const span = Math.max(0.0001, maximum - minimum);
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const t = (position.getY(index) - minimum) / span;
    const tone = floor + (1 - floor) * (t * t * (3 - 2 * t));
    colors[index * 3] = tone;
    colors[index * 3 + 1] = tone;
    colors[index * 3 + 2] = tone;
  }
  source.setAttribute("color", new BufferAttribute(colors, 3));
  source.computeVertexNormals();
  source.computeBoundingSphere();
  return source;
}

/**
 * A boulder: an icosahedron knocked out of true.
 *
 * `detail` 0 gives twenty faces, which is a rock; 1 gives eighty, which is a
 * rock worth walking up to. `jagged` is how far a vertex may travel, as a
 * fraction of the radius.
 */
export function createRockGeometry(
  seed: number,
  options: {
    readonly detail?: 0 | 1;
    readonly jagged?: number;
    /** Squashes the rock, so a boulder can be a slab without a second builder. */
    readonly flatten?: number;
  } = {},
): BufferGeometry {
  const random = seeded(seed);
  const geometry = new IcosahedronGeometry(1, options.detail ?? 0);
  const jagged = options.jagged ?? 0.3;
  const position = geometry.getAttribute("position") as BufferAttribute;
  const vertex = new Vector3();

  // Displace by position rather than by vertex index, so vertices that share a
  // corner move together and the rock stays closed.
  const seen = new Map<string, number>();
  for (let index = 0; index < position.count; index += 1) {
    vertex.fromBufferAttribute(position, index);
    const key = `${vertex.x.toFixed(3)},${vertex.y.toFixed(3)},${vertex.z.toFixed(3)}`;
    let push = seen.get(key);
    if (push === undefined) {
      push = 1 - random() * jagged;
      seen.set(key, push);
    }
    vertex.multiplyScalar(push);
    vertex.y *= 1 - (options.flatten ?? 0);
    position.setXYZ(index, vertex.x, vertex.y, vertex.z);
  }
  position.needsUpdate = true;

  return shadeByHeight(geometry, 0.52);
}

/**
 * A hewn block: a box with its corners pushed off true.
 *
 * For the built landmarks - piers, spans, bridge slabs - where the shape should
 * still read as something someone cut, but not as something extruded.
 */
export function createSlabGeometry(
  width: number,
  height: number,
  depth: number,
  seed: number,
  jagged = 0.09,
): BufferGeometry {
  const random = seeded(seed);
  const half = { x: width * 0.5, y: height * 0.5, z: depth * 0.5 };

  // Eight corners, each nudged, then six quads wound outwards.
  const corners: Vector3[] = [];
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const sx of [-1, 1]) {
        corners.push(
          new Vector3(
            sx * half.x * (1 - random() * jagged),
            sy * half.y * (1 - random() * jagged * 0.5),
            sz * half.z * (1 - random() * jagged),
          ),
        );
      }
    }
  }

  const index = (sx: number, sy: number, sz: number): Vector3 =>
    corners[(sy > 0 ? 4 : 0) + (sz > 0 ? 2 : 0) + (sx > 0 ? 1 : 0)] as Vector3;

  const positions: number[] = [];
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3): void => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    positions.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  };

  quad(index(-1, 1, -1), index(-1, 1, 1), index(1, 1, 1), index(1, 1, -1)); // top
  quad(index(-1, -1, -1), index(1, -1, -1), index(1, -1, 1), index(-1, -1, 1)); // bottom
  quad(index(-1, -1, 1), index(1, -1, 1), index(1, 1, 1), index(-1, 1, 1)); // +z
  quad(index(1, -1, -1), index(-1, -1, -1), index(-1, 1, -1), index(1, 1, -1)); // -z
  quad(index(1, -1, 1), index(1, -1, -1), index(1, 1, -1), index(1, 1, 1)); // +x
  quad(index(-1, -1, -1), index(-1, -1, 1), index(-1, 1, 1), index(-1, 1, -1)); // -x

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  return shadeByHeight(geometry, 0.6);
}

/**
 * A standing column: a stack of irregular rings, narrowing and drifting.
 *
 * Sea stacks, beacons and basalt teeth are all this shape. A cylinder is not:
 * it is the same circle all the way up, which is the one thing weathered stone
 * never is.
 */
export function createSpireGeometry(
  baseRadius: number,
  topRadius: number,
  height: number,
  seed: number,
  options: { readonly sides?: number; readonly rings?: number; readonly drift?: number } = {},
): BufferGeometry {
  const random = seeded(seed);
  const sides = options.sides ?? 7;
  const rings = options.rings ?? 5;
  const drift = options.drift ?? 0.16;

  const levels: Vector3[][] = [];
  let offsetX = 0;
  let offsetZ = 0;
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const y = -height * 0.5 + t * height;
    const radius = baseRadius + (topRadius - baseRadius) * t;
    // The column wanders as it rises, which is what stops a stack reading as a
    // pillar someone stood up straight.
    offsetX += (random() - 0.5) * drift * baseRadius;
    offsetZ += (random() - 0.5) * drift * baseRadius;
    const points: Vector3[] = [];
    for (let side = 0; side < sides; side += 1) {
      const angle = (side / sides) * Math.PI * 2 + t * 0.35;
      const wobble = 1 - random() * 0.22;
      points.push(
        new Vector3(
          offsetX + Math.cos(angle) * radius * wobble,
          y,
          offsetZ + Math.sin(angle) * radius * wobble,
        ),
      );
    }
    levels.push(points);
  }

  const positions: number[] = [];
  const push = (point: Vector3): void => {
    positions.push(point.x, point.y, point.z);
  };
  for (let ring = 0; ring < rings; ring += 1) {
    const lower = levels[ring] as Vector3[];
    const upper = levels[ring + 1] as Vector3[];
    for (let side = 0; side < sides; side += 1) {
      const next = (side + 1) % sides;
      push(lower[side] as Vector3);
      push(upper[side] as Vector3);
      push(upper[next] as Vector3);
      push(lower[side] as Vector3);
      push(upper[next] as Vector3);
      push(lower[next] as Vector3);
    }
  }
  // Caps, so a broken column has a broken top rather than a hole.
  const capFan = (points: Vector3[], up: boolean): void => {
    const centre = new Vector3();
    for (const point of points) centre.add(point);
    centre.divideScalar(points.length);
    for (let side = 0; side < points.length; side += 1) {
      const next = (side + 1) % points.length;
      push(centre);
      push(points[up ? next : side] as Vector3);
      push(points[up ? side : next] as Vector3);
    }
  };
  capFan(levels[0] as Vector3[], false);
  capFan(levels[rings] as Vector3[], true);

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  return shadeByHeight(geometry, 0.5);
}
