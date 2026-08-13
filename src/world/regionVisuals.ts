import type { WorldManifest } from "../game/world/compiler/worldTypes";

/**
 * The single place the renderer reads a region's authored visual intent.
 *
 * `WorldSpec` states each region's terrain family, silhouette, scatter families
 * and scatter density; the compiler carries them through to the manifest. Every
 * presentation module asks here rather than inferring intent from tags or ids,
 * so the renderer cannot end up holding a second opinion about what a region is
 * supposed to look like.
 *
 * What the spec deliberately does not state is colour, geometry or count. Those
 * are the concrete visual decisions this project leaves to the render layer, and
 * they live in the modules below.
 */

export type TerrainFamily = "coastal" | "grassland" | "woodland";

export type ElementKind = "rock" | "foliage" | "trunk";

/**
 * How one authored scatter-family name is realized as instanced geometry.
 *
 * `spread` and `rise` are fractions of the placement's own collision footprint,
 * so a clump always fills the cylinder the horse is actually stopped by rather
 * than a size chosen by eye.
 */
export interface ScatterArchetype {
  readonly kind: ElementKind;
  /** Relative share of a clump's elements. */
  readonly weight: number;
  readonly spread: number;
  readonly rise: number;
}

/**
 * Named scatter families from the authored spec.
 *
 * Names the renderer does not recognise fall back to the terrain family's own
 * mix, so a new WorldSpec never renders as nothing. Drift debris is realized as
 * low flat stone rather than as loose timber: the instanced primitive set here
 * has no lying-down form, and a short vertical trunk reads as a stump.
 */
const SCATTER_ARCHETYPES: Readonly<Record<string, ScatterArchetype>> = {
  "weathered-rock": { kind: "rock", weight: 1, spread: 0.3, rise: 0.5 },
  marram: { kind: "foliage", weight: 1.1, spread: 0.34, rise: 0.42 },
  "drift-debris": { kind: "rock", weight: 0.5, spread: 0.24, rise: 0.2 },
  longgrass: { kind: "foliage", weight: 1.4, spread: 0.42, rise: 0.5 },
  gorse: { kind: "foliage", weight: 1, spread: 0.38, rise: 0.7 },
  "field-boulder": { kind: "rock", weight: 0.7, spread: 0.34, rise: 0.78 },
  fern: { kind: "foliage", weight: 1.5, spread: 0.4, rise: 0.62 },
  sapling: { kind: "trunk", weight: 0.5, spread: 0.11, rise: 1.9 },
  "moss-rock": { kind: "rock", weight: 0.8, spread: 0.32, rise: 0.55 },
  "old-trunk": { kind: "trunk", weight: 0.35, spread: 0.17, rise: 2.6 },
};

const FALLBACK_MIX: Readonly<Record<TerrainFamily, readonly ScatterArchetype[]>> = {
  coastal: [
    { kind: "rock", weight: 1, spread: 0.3, rise: 0.5 },
    { kind: "foliage", weight: 1, spread: 0.34, rise: 0.42 },
  ],
  grassland: [
    { kind: "foliage", weight: 1.3, spread: 0.4, rise: 0.6 },
    { kind: "rock", weight: 0.7, spread: 0.34, rise: 0.75 },
  ],
  woodland: [
    { kind: "foliage", weight: 1.5, spread: 0.4, rise: 0.7 },
    { kind: "trunk", weight: 0.4, spread: 0.16, rise: 2.3 },
  ],
};

export function terrainFamilyFor(manifest: WorldManifest, regionId: string): TerrainFamily {
  const region = manifest.regions.find((candidate) => candidate.id === regionId);
  return region?.visualIntent.terrainFamily ?? "grassland";
}

/**
 * The archetype mix for a region, in authored order.
 *
 * Unrecognised names are dropped rather than guessed at; if that leaves nothing,
 * the terrain family's fallback mix is used.
 */
export function scatterMixFor(
  manifest: WorldManifest,
  regionId: string,
): readonly ScatterArchetype[] {
  const region = manifest.regions.find((candidate) => candidate.id === regionId);
  if (!region) return FALLBACK_MIX.grassland;
  const mix = region.visualIntent.scatterFamilies
    .map((name) => SCATTER_ARCHETYPES[name])
    .filter((archetype): archetype is ScatterArchetype => archetype !== undefined);
  return mix.length > 0 ? mix : FALLBACK_MIX[region.visualIntent.terrainFamily];
}

/**
 * Scatter density from the spec, as a multiplier on how many elements a clump
 * contains. The compiler already uses the same number to decide how many
 * placement records a region gets, so density reads twice: as how often you meet
 * scenery, and as how thick it is when you do.
 */
export function scatterDensityFor(manifest: WorldManifest, regionId: string): number {
  const region = manifest.regions.find((candidate) => candidate.id === regionId);
  return region?.visualIntent.scatterDensity ?? 0.5;
}

/**
 * A region's name as the player should see it.
 *
 * Derived from the authored id, so naming a region is naming a place and no
 * second list has to be kept in step.
 */
export function regionDisplayName(regionId: string): string {
  return regionId
    .split("-")
    .filter((part) => part.length > 0)
    .map((part) => (part[0] ?? "").toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * What a region is made of, as opposed to which family it belongs to.
 *
 * The spec gives five regions but only three terrain families, so River Hollow
 * and Fernwood are both `woodland` and Blackstone Crown and Longgrass Plain are
 * both `grassland`. The first attempt at fixing that tinted the family colour
 * towards a per-region accent. It worked exactly as written and still failed
 * the only test that matters: a fifty percent pull from grass green towards
 * basalt, re-lit and then covered in green tufts, reads as slightly darker
 * grass. A crown of black rock is not a shade of lawn.
 *
 * So a region now states its own ground material outright - the dry and rich
 * ends of its colour ramp, how readily bare rock breaks through, and what its
 * ground cover is - instead of borrowing a family's and nudging it. The family
 * is still what decides beach behaviour and the shape of the cover, because
 * those are genuinely family-level facts.
 *
 * The numbers here are the concrete visual decisions the spec deliberately
 * leaves to the render layer; the spec states intent, in `presentation.palette`
 * and each region's `visualIntent`, and this is that intent as material.
 */
export interface RegionStyle {
  /** Dry and rich ends of the ground ramp, walked by authored moisture. */
  readonly dry: readonly [number, number, number];
  readonly rich: readonly [number, number, number];
  /**
   * Where bare rock starts breaking through, in degrees of slope.
   *
   * Low on the crown so the highland is visibly rock with pasture caught in
   * its folds; high on the plain so a grass bank stays grass.
   */
  readonly rockFromDegrees: number;
  /** Multiplier on how many cover tufts a cell gets. */
  readonly coverDensity: number;
  /** Multiplier on tuft height and radius. */
  readonly coverScale: number;
  /** The cover palette for this region, replacing the family's. */
  readonly coverTints: readonly (readonly [number, number, number])[];
}

const REGION_STYLES: Readonly<Record<string, RegionStyle>> = {
  // Salt-scoured and bleached. Pale, cool, and low-contrast, so the storm coast
  // reads as somewhere weather happens to rather than somewhere that grows.
  "saltwind-coast": {
    dry: [0.66, 0.64, 0.53],
    rich: [0.45, 0.52, 0.38],
    rockFromDegrees: 22,
    coverDensity: 0.7,
    coverScale: 0.85,
    coverTints: [[0.58, 0.62, 0.44], [0.66, 0.68, 0.5], [0.5, 0.56, 0.4]],
  },
  // Dry gold, and the brightest ground on the island. This is the gallop
  // country, and it should be visible as such from the crown.
  "longgrass-plain": {
    dry: [0.76, 0.68, 0.34],
    rich: [0.53, 0.6, 0.24],
    rockFromDegrees: 26,
    coverDensity: 1.25,
    coverScale: 1.15,
    coverTints: [[0.72, 0.68, 0.32], [0.62, 0.64, 0.28], [0.82, 0.74, 0.42], [0.48, 0.56, 0.2]],
  },
  // Deep shade. The darkest living ground, and warm rather than blue, so it
  // separates from River Hollow at a distance.
  fernwood: {
    dry: [0.2, 0.26, 0.14],
    rich: [0.11, 0.2, 0.1],
    rockFromDegrees: 24,
    // The densest region on the island, and the one that broke the triangle
    // guide: a Fernwood view drew 799,860 against a 750k ceiling. Density comes
    // down and scale goes up, so the frame keeps the same closed, overgrown
    // reading from fewer, larger tufts rather than losing its floor.
    coverDensity: 0.92,
    coverScale: 1.3,
    coverTints: [[0.14, 0.28, 0.13], [0.18, 0.34, 0.16], [0.1, 0.22, 0.11]],
  },
  // Wet, silver-green and cold. Bright where Fernwood is dark, blue where
  // Fernwood is warm - the two woodlands have to be told apart across a valley.
  "river-hollow": {
    dry: [0.44, 0.55, 0.47],
    rich: [0.3, 0.48, 0.42],
    rockFromDegrees: 20,
    // Trimmed with Fernwood's, for the same reason: a river-hollow frame drew
    // 780,050 against the 750k guide. Fewer, wider clumps keep the wet, shaggy
    // read without paying for every blade of it.
    coverDensity: 0.92,
    coverScale: 1.15,
    coverTints: [[0.42, 0.6, 0.48], [0.52, 0.66, 0.54], [0.32, 0.5, 0.44]],
  },
  // Basalt, with high pasture caught in the folds. Rock breaks through early
  // and the ground itself is nearly black, so the crown is a dark mass on the
  // skyline from anywhere on the island.
  "blackstone-crown": {
    dry: [0.12, 0.12, 0.13],
    rich: [0.26, 0.34, 0.2],
    rockFromDegrees: 8,
    coverDensity: 0.45,
    coverScale: 0.8,
    coverTints: [[0.24, 0.3, 0.18], [0.3, 0.26, 0.24], [0.18, 0.22, 0.16]],
  },
};

/** Neutral grassland, so an unrecognised region still renders as somewhere. */
const FALLBACK_STYLE: RegionStyle = {
  dry: [0.55, 0.58, 0.34],
  rich: [0.34, 0.46, 0.24],
  rockFromDegrees: 22,
  coverDensity: 1,
  coverScale: 1,
  coverTints: [[0.6, 0.62, 0.36], [0.48, 0.56, 0.3]],
};

export function regionStyleFor(regionId: string): RegionStyle {
  return REGION_STYLES[regionId] ?? FALLBACK_STYLE;
}
