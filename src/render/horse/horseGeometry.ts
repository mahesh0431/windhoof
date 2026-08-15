import { BufferAttribute, BufferGeometry } from "three";

/**
 * Faceted body-building primitives.
 *
 * The world is flat-shaded facets: terrain, canopies, rocks. The horse was
 * assembled from smooth spheres and cylinders, so it read as a different game's
 * asset dropped into this one, and no amount of animation fixes a silhouette
 * made of intersecting balls. These builders exist so the horse is authored the
 * way the island is: as a small number of deliberate planes.
 *
 * Everything here is non-indexed, so `computeVertexNormals` produces one normal
 * per triangle and `flatShading` on the material has real facets to shade.
 */

/**
 * One cross-section of a lofted form.
 *
 * A horse is a stack of cross-sections, not a stack of spheres: deep and narrow
 * at the girth, wide and flat over the hips, a wedge at the muzzle. Authoring
 * the sections directly is what makes those proportions adjustable without
 * anything turning back into a barrel.
 */
export interface LoftRing {
  /** Position along the loft axis (+Z before any reorientation). */
  readonly at: number;
  /** Section centre, perpendicular to the axis. Lateral centre is always zero. */
  readonly centre?: number;
  /** Half the section's width. */
  readonly halfWidth: number;
  /** Centre to the top of the section. */
  readonly up: number;
  /** Centre to the bottom of the section. */
  readonly down: number;
  /** 0 is an ellipse, 1 is nearly a slab. Slab-sided reads as ribs and bone. */
  readonly squareness?: number;
  /** Narrows the top of the section: withers, croup, and the crest of a neck. */
  readonly crest?: number;
  /** Narrows the bottom: a chest keel or the edge of a jaw. */
  readonly keel?: number;
  /**
   * Brightness multiplier for this section, on top of the countershading.
   *
   * Lets a single loft carry a marking that runs along its axis rather than
   * around it: a coronet band at the top of a hoof, or a coat darkening into
   * the black points as it approaches the knee. Values above one lift a dark
   * material back towards the coat, which is how the two meet without a seam.
   */
  readonly tone?: number;
}

export interface LoftOptions {
  /** Facets around the section. Eight to ten reads as an animal, not a pipe. */
  readonly segments?: number;
  /**
   * How much darker the underside is, 0-1, written into vertex colours.
   *
   * Countershading is a real bay marking and it is also the cheapest way to
   * keep a flat-shaded body from flattening out when the sun is behind it.
   */
  readonly shade?: number;
  /**
   * How far each facet's tone may wander from its neighbours', 0-1.
   *
   * A real coat is not one value. On a flat-shaded body the facets are already
   * the natural unit of variation, so scattering their tone by a few percent
   * costs nothing and reads as hair over muscle rather than as painted plastic
   * - which is most of what separates the reference's textured horse from its
   * untextured one, without a texture.
   *
   * Deterministic: the wander comes from each facet's own position, so a horse
   * is dappled identically on every machine and every run.
   */
  readonly dapple?: number;
}

const DEFAULT_SEGMENTS = 10;

/**
 * Lofts a closed solid through the given sections along +Z, capped at both ends.
 *
 * Sections may be authored in any order; they are sorted along the axis.
 */
export function loftAlongZ(
  rings: readonly LoftRing[],
  options: LoftOptions = {},
): BufferGeometry {
  const segments = options.segments ?? DEFAULT_SEGMENTS;
  const shade = options.shade ?? 0;
  const ordered = [...rings].sort((a, b) => a.at - b.at);
  if (ordered.length < 2) {
    throw new Error("a loft needs at least two sections");
  }

  const positions: number[] = [];
  const colors: number[] = [];

  /** Cross-section outline, starting at the top and running through +X. */
  const outline = (ring: LoftRing): number[][] => {
    const exponent = 2 / (2 + 2 * (ring.squareness ?? 0));
    const centre = ring.centre ?? 0;
    const points: number[][] = [];
    for (let index = 0; index < segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const lateral =
        1 -
        (ring.crest ?? 0) * Math.max(0, cos) ** 2 -
        (ring.keel ?? 0) * Math.max(0, -cos) ** 2;
      const x =
        ring.halfWidth * Math.sign(sin) * Math.abs(sin) ** exponent * lateral;
      const y =
        centre +
        (cos >= 0 ? ring.up : ring.down) *
          Math.sign(cos) *
          Math.abs(cos) ** exponent;
      points.push([x, y, ring.at, shadeAt(cos, shade) * (ring.tone ?? 1)]);
    }
    return points;
  };

  const sections = ordered.map(outline);

  const push = (point: number[]): void => {
    positions.push(point[0] ?? 0, point[1] ?? 0, point[2] ?? 0);
    const tone = point[3] ?? 1;
    colors.push(tone, tone, tone);
  };

  // Side walls. Winding is chosen so the outward face is the lit one: with
  // sections ordered along +Z and the outline running top -> +X -> bottom, this
  // is the pair that puts the normal on the outside.
  for (let index = 0; index < sections.length - 1; index += 1) {
    const near = sections[index] as number[][];
    const far = sections[index + 1] as number[][];
    for (let step = 0; step < segments; step += 1) {
      const next = (step + 1) % segments;
      const a = near[step] as number[];
      const b = far[step] as number[];
      const c = far[next] as number[];
      const d = near[next] as number[];
      push(a);
      push(b);
      push(c);
      push(a);
      push(c);
      push(d);
    }
  }

  const cap = (section: number[][], front: boolean): void => {
    const at = section[0]?.[2] ?? 0;
    const capTone =
      section.reduce((sum, point) => sum + (point[3] ?? 1), 0) / section.length;
    const centre = [
      0,
      section.reduce((sum, point) => sum + (point[1] ?? 0), 0) / section.length,
      at,
      capTone * (1 - shade * 0.35),
    ];
    for (let step = 0; step < segments; step += 1) {
      const next = (step + 1) % segments;
      const a = section[step] as number[];
      const b = section[next] as number[];
      push(centre);
      push(front ? b : a);
      push(front ? a : b);
    }
  };

  cap(sections[0] as number[][], false);
  cap(sections[sections.length - 1] as number[][], true);

  return finish(positions, colors, options.dapple);
}

/**
 * The same loft hanging down the -Y axis, for limbs.
 *
 * `at` becomes depth below the joint and `up` becomes the front of the limb,
 * which is the way leg anatomy is naturally described: so much in front of the
 * bone, so much of tendon behind it.
 */
export function loftDown(
  rings: readonly LoftRing[],
  options: LoftOptions = {},
): BufferGeometry {
  return loftAlongZ(rings, options).rotateX(Math.PI / 2);
}

/**
 * The same loft rising up the +Y axis, for the neck.
 *
 * `at` becomes height above the base and `up` becomes the crest side, so a neck
 * is authored as crest-and-throat rather than as a cone.
 */
export function loftUp(
  rings: readonly LoftRing[],
  options: LoftOptions = {},
): BufferGeometry {
  return loftAlongZ(rings, options).rotateX(-Math.PI / 2);
}

/**
 * An ear: a curled leaf with a hollow in it.
 *
 * The ears were four-sided cones. They are the highest thing on the animal and
 * the first part of it to break a horizon, so they carry more of the silhouette
 * than their size suggests - and a cone is the one shape that reads as a
 * jackal's rather than a horse's, because the two things that make a horse's ear
 * are the cup and the way it narrows at the base before it widens again.
 *
 * Built as a grid rather than a loft: the section is not a closed ring but an
 * open arc with a front face, a back face, and a rim joining them.
 *
 * Grows along +Y with the cup opening towards +Z.
 */
export function earGeometry(options: {
  readonly height: number;
  readonly halfWidth: number;
  /** How deeply the leaf curls. Zero is a flat paddle. */
  readonly cup: number;
  readonly thickness: number;
  /** How much darker the hollow is than the outside. */
  readonly shade?: number;
} = { height: 0.15, halfWidth: 0.042, cup: 0.03, thickness: 0.011 }): BufferGeometry {
  const RINGS = 7;
  const COLUMNS = 6;
  const shade = options.shade ?? 0.45;

  /**
   * Width along the ear, as a fraction of the widest point.
   *
   * Pinched at the base, widest about a third of the way up, drawn to a point:
   * the profile of a real ear and nothing like the straight taper of a cone.
   */
  const profile = (t: number): number =>
    (1 - t * t) * (0.36 + 0.64 * Math.sin(Math.min(1, t * 3) * Math.PI * 0.5));

  const inner: number[][][] = [];
  const outer: number[][][] = [];
  for (let ring = 0; ring <= RINGS; ring += 1) {
    const t = ring / RINGS;
    const halfWidth = options.halfWidth * profile(t);
    const innerRow: number[][] = [];
    const outerRow: number[][] = [];
    for (let column = 0; column <= COLUMNS; column += 1) {
      const across = (column / COLUMNS) * 2 - 1;
      const arc = 1 - across * across;
      // The curl relaxes towards the tip, so the ear is a scoop at the base and
      // close to flat where it comes to a point.
      const depth = -options.cup * arc * (1 - t * 0.55);
      const shell = options.thickness * (1 - Math.abs(across) * 0.55) * (1 - t * 0.5);
      const x = across * halfWidth;
      const y = t * options.height;
      innerRow.push([x, y, depth, 1 - shade]);
      outerRow.push([x, y, depth + shell, 1]);
    }
    inner.push(innerRow);
    outer.push(outerRow);
  }

  const positions: number[] = [];
  const colors: number[] = [];
  const push = (point: number[]): void => {
    positions.push(point[0] ?? 0, point[1] ?? 0, point[2] ?? 0);
    const tone = point[3] ?? 1;
    colors.push(tone, tone, tone);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    push(a);
    push(b);
    push(c);
    push(a);
    push(c);
    push(d);
  };

  for (let ring = 0; ring < RINGS; ring += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const lowIn = inner[ring] as number[][];
      const highIn = inner[ring + 1] as number[][];
      const lowOut = outer[ring] as number[][];
      const highOut = outer[ring + 1] as number[][];
      // The hollow faces +Z, so its winding is the reverse of the back's.
      quad(
        lowIn[column] as number[],
        lowIn[column + 1] as number[],
        highIn[column + 1] as number[],
        highIn[column] as number[],
      );
      quad(
        lowOut[column] as number[],
        highOut[column] as number[],
        highOut[column + 1] as number[],
        lowOut[column + 1] as number[],
      );
    }
    // The rim down both edges, which is what stops the ear reading as paper.
    for (const [column, flip] of [
      [0, true],
      [COLUMNS, false],
    ] as const) {
      const lowIn = (inner[ring] as number[][])[column] as number[];
      const highIn = (inner[ring + 1] as number[][])[column] as number[];
      const lowOut = (outer[ring] as number[][])[column] as number[];
      const highOut = (outer[ring + 1] as number[][])[column] as number[];
      if (flip) quad(lowIn, highIn, highOut, lowOut);
      else quad(lowIn, lowOut, highOut, highIn);
    }
  }

  // Base cap, so the ear is closed where it enters the skull.
  const baseIn = inner[0] as number[][];
  const baseOut = outer[0] as number[][];
  for (let column = 0; column < COLUMNS; column += 1) {
    quad(
      baseIn[column] as number[],
      baseOut[column] as number[],
      baseOut[column + 1] as number[],
      baseIn[column + 1] as number[],
    );
  }

  return finish(positions, colors);
}

export interface HairRib {
  /** Where the strand leaves the body. */
  readonly root: readonly [number, number, number];
  /** Where it ends. Varying this between ribs is what makes the edge jagged. */
  readonly tip: readonly [number, number, number];
  /** Half the sheet's thickness at this rib. */
  readonly thickness: number;
}

/**
 * A mane or tail sheet: a thin faceted shell whose free edge is jagged.
 *
 * Hair was previously a row of capsules, which reads as beads threaded on a
 * neck from any angle where the beads separate. Real stylised manes are built
 * as sheets, because hair has a silhouette and no volume worth modelling.
 */
export function hairSheet(
  ribs: readonly HairRib[],
  options: { readonly shade?: number } = {},
): BufferGeometry {
  if (ribs.length < 2) throw new Error("a hair sheet needs at least two ribs");
  const shade = options.shade ?? 0;

  const positions: number[] = [];
  const colors: number[] = [];
  const push = (point: readonly number[], tone: number): void => {
    positions.push(point[0] ?? 0, point[1] ?? 0, point[2] ?? 0);
    colors.push(tone, tone, tone);
  };
  const quad = (
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    d: readonly number[],
    tone: number,
  ): void => {
    push(a, tone);
    push(b, tone);
    push(c, tone);
    push(a, tone);
    push(c, tone);
    push(d, tone);
  };
  const shift = (
    point: readonly [number, number, number],
    offset: number,
  ): number[] => [point[0] + offset, point[1], point[2]];

  const root = 1;
  const tip = 1 - shade;

  for (let index = 0; index < ribs.length - 1; index += 1) {
    const near = ribs[index] as HairRib;
    const far = ribs[index + 1] as HairRib;

    // Both faces, wound outwards, plus the free edge that joins them. The top
    // edge is left open: it always sits buried inside the neck or the dock.
    quad(
      shift(near.root, near.thickness),
      shift(near.tip, near.thickness),
      shift(far.tip, far.thickness),
      shift(far.root, far.thickness),
      root,
    );
    quad(
      shift(near.root, -near.thickness),
      shift(far.root, -far.thickness),
      shift(far.tip, -far.thickness),
      shift(near.tip, -near.thickness),
      root,
    );
    quad(
      shift(near.tip, near.thickness),
      shift(near.tip, -near.thickness),
      shift(far.tip, -far.thickness),
      shift(far.tip, far.thickness),
      tip,
    );
  }

  const first = ribs[0] as HairRib;
  const last = ribs[ribs.length - 1] as HairRib;
  quad(
    shift(first.root, -first.thickness),
    shift(first.tip, -first.thickness),
    shift(first.tip, first.thickness),
    shift(first.root, first.thickness),
    root,
  );
  quad(
    shift(last.root, last.thickness),
    shift(last.tip, last.thickness),
    shift(last.tip, -last.thickness),
    shift(last.root, -last.thickness),
    root,
  );

  return finish(positions, colors);
}

/**
 * The same ribs, cut into separate locks with daylight between them.
 *
 * A continuous sheet has one outline: whatever its free edge happens to be. Real
 * hair hangs in ropes that separate as they fall, and the gaps between them are
 * most of what reads as hair rather than as a flag - which is what the mane and
 * tail looked like at every distance.
 *
 * The alternative was an alpha-tested strand texture, and it was rejected: the
 * island's twenty-six wild horses are baked down to a single untextured
 * material, so a texture would have given the player's horse strands and left
 * every other horse in the game with flags. Cut into the geometry, the detail
 * bakes with them.
 *
 * `gap` is the fraction of each lock's width given up to the slots either side.
 */
export function hairLocks(
  ribs: readonly HairRib[],
  options: { readonly shade?: number; readonly gap?: number } = {},
): BufferGeometry {
  if (ribs.length < 2) throw new Error("hair locks need at least two ribs");
  const shade = options.shade ?? 0;
  const gap = options.gap ?? 0.22;

  const positions: number[] = [];
  const colors: number[] = [];
  const push = (point: readonly number[], tone: number): void => {
    positions.push(point[0] ?? 0, point[1] ?? 0, point[2] ?? 0);
    colors.push(tone, tone, tone);
  };
  const quad = (
    a: readonly number[],
    b: readonly number[],
    c: readonly number[],
    d: readonly number[],
    tone: number,
  ): void => {
    push(a, tone);
    push(b, tone);
    push(c, tone);
    push(a, tone);
    push(c, tone);
    push(d, tone);
  };

  const rootTone = 1;
  const tipTone = 1 - shade;
  const blend = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
    t: number,
    offset: number,
  ): number[] => [
    a[0] + (b[0] - a[0]) * t + offset,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];

  const low = gap * 0.5;
  const high = 1 - gap * 0.5;

  for (let index = 0; index < ribs.length - 1; index += 1) {
    const near = ribs[index] as HairRib;
    const far = ribs[index + 1] as HairRib;
    const thickness = (near.thickness + far.thickness) * 0.5;
    // Locks taper: a rope of hair is fattest where it leaves the body and
    // thinnest where it ends.
    const tipThickness = thickness * 0.42;

    const corners = (t: number): { root: number[][]; tip: number[][] } => ({
      root: [
        blend(near.root, far.root, t, thickness),
        blend(near.root, far.root, t, -thickness),
      ],
      tip: [
        blend(near.tip, far.tip, t, tipThickness),
        blend(near.tip, far.tip, t, -tipThickness),
      ],
    });
    const a = corners(low);
    const b = corners(high);

    // Both faces of the lock, its cut end, and the two slots' walls. The root
    // end is left open: it is always buried in the neck or the dock.
    quad(a.root[0] as number[], a.tip[0] as number[], b.tip[0] as number[], b.root[0] as number[], rootTone);
    quad(a.root[1] as number[], b.root[1] as number[], b.tip[1] as number[], a.tip[1] as number[], rootTone);
    quad(a.tip[0] as number[], a.tip[1] as number[], b.tip[1] as number[], b.tip[0] as number[], tipTone);
    quad(a.root[1] as number[], a.tip[1] as number[], a.tip[0] as number[], a.root[0] as number[], rootTone);
    quad(b.root[0] as number[], b.tip[0] as number[], b.tip[1] as number[], b.root[1] as number[], rootTone);
  }

  return finish(positions, colors);
}

/**
 * Gives a primitive the vertex colours the coat material expects.
 *
 * The coat shades itself through vertex colour, so a geometry joining it
 * without the attribute would render black rather than merely unshaded.
 */
export function paintUniform(geometry: BufferGeometry, tone = 1): BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry;
  if (source !== geometry) geometry.dispose();
  const count = source.getAttribute("position").count;
  const colors = new Float32Array(count * 3).fill(tone);
  source.setAttribute("color", new BufferAttribute(colors, 3));
  return source;
}

/** Full light on top, `shade` less underneath, eased so the flanks stay lit. */
function shadeAt(cos: number, shade: number): number {
  if (shade <= 0) return 1;
  const downness = Math.max(0, -cos);
  return 1 - shade * downness ** 1.35;
}

/**
 * Scatters facet tone by a hash of the facet's own centroid.
 *
 * Runs over whole triangles, not vertices: the material is flat shaded, so a
 * triangle already renders as one tone and varying its corners separately would
 * only be averaged back out.
 */
function applyDapple(colors: number[], positions: number[], amount: number): void {
  for (let triangle = 0; triangle * 9 < positions.length; triangle += 1) {
    const base = triangle * 9;
    const centroidX =
      ((positions[base] ?? 0) + (positions[base + 3] ?? 0) + (positions[base + 6] ?? 0)) / 3;
    const centroidY =
      ((positions[base + 1] ?? 0) + (positions[base + 4] ?? 0) + (positions[base + 7] ?? 0)) / 3;
    const centroidZ =
      ((positions[base + 2] ?? 0) + (positions[base + 5] ?? 0) + (positions[base + 8] ?? 0)) / 3;
    // Centimetre-scale quantisation, so neighbouring facets land on different
    // hashes rather than on the same one.
    const hashed = hashPoint(
      Math.round(centroidX * 100),
      Math.round(centroidY * 100),
      Math.round(centroidZ * 100),
    );
    const wander = 1 + (hashed - 0.5) * 2 * amount;
    for (let corner = 0; corner < 3; corner += 1) {
      const index = base + corner * 3;
      colors[index] = (colors[index] ?? 1) * wander;
      colors[index + 1] = (colors[index + 1] ?? 1) * wander;
      colors[index + 2] = (colors[index + 2] ?? 1) * wander;
    }
  }
}

/** Deterministic 0-1 hash of three integers. */
function hashPoint(x: number, y: number, z: number): number {
  let value =
    (Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ Math.imul(z, 0x27d4eb2d)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4_294_967_296;
}

function finish(
  positions: number[],
  colors: number[],
  dapple?: number,
): BufferGeometry {
  if (dapple && dapple > 0) applyDapple(colors, positions, dapple);
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new BufferAttribute(new Float32Array(positions), 3),
  );
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
