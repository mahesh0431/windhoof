import { Color } from "three";

/**
 * One palette for the whole build.
 *
 * Direction: stylized naturalism. Hues stay in a narrow, coherent band so the
 * island reads as one place rather than assorted asset packs; value contrast
 * does the readability work instead of saturation. Ground surfaces are
 * separated by lightness first so traversability survives motion blur, small
 * screens, and colour-vision differences.
 */
export const PALETTE = {
  // Ground surfaces, ordered light to dark within each family.
  grassDry: new Color("#a3ab60"),
  grassMid: new Color("#7d9a52"),
  grassRich: new Color("#4f6f3a"),
  grassShadow: new Color("#3b5730"),

  sandDry: new Color("#dccfa8"),
  sandWet: new Color("#a2957a"),

  // Rock is desaturated and clearly darker than grass: steep ground reads as
  // "not for hooves" at a glance, which is the one thing the terrain must say.
  // Both values sit below the grass family in luminance; an earlier lighter
  // grey made unclimbable banks read as bright, inviting ground.
  rockLight: new Color("#6f6a61"),
  rockDark: new Color("#4a463f"),

  // Darker and cooler than the surrounding grass. A pale streambed reads as a
  // path to follow; a dark damp one reads as a cut in the ground to jump.
  streambed: new Color("#5d5f4c"),

  water: new Color("#356f7d"),
  waterShallow: new Color("#5ba3a2"),
  foam: new Color("#dfeae6"),

  // Sky and atmosphere: late afternoon, low warm sun, long readable shadows.
  skyZenith: new Color("#3f74b8"),
  skyHorizon: new Color("#e4d6bd"),
  skyHaze: new Color("#f0d9ab"),
  // Golden hour: the sun is low and warm, and it is what gives a landscape
  // its hour. A neutral white sun renders the same island at noon forever.
  sunLight: new Color("#ffe0ab"),
  // Warmer and greener than the ground it stands for: this is light coming back
  // up off sunlit grass, and a grey-green bounce is what made shaded slopes
  // read as cold rather than as shaded.
  bounceLight: new Color("#9cb573"),
  skyLight: new Color("#a8c6e6"),
  fog: new Color("#d8d2c2"),

  // Vegetation.
  trunk: new Color("#7b6046"),
  trunkShade: new Color("#5c4632"),
  canopyLight: new Color("#7d9a4e"),
  canopyDark: new Color("#3f5c33"),
  shrub: new Color("#6d8747"),

  // The horse: a bay coat. Warm mid-value body against cool green and pale
  // sand keeps the silhouette separated from every surface in the lab.
  coat: new Color("#7a4a28"),
  coatShade: new Color("#5a341c"),
  points: new Color("#2b1d14"),
  mane: new Color("#231913"),
  hoof: new Color("#3a3129"),
  blaze: new Color("#d9cdb8"),
  muzzle: new Color("#4a3020"),
} as const;

/**
 * Sun direction, normalized, pointing from the world towards the sun.
 *
 * Raised from thirty degrees of elevation to about forty. Thirty gave the long
 * shadows the brief asks for and also gave every slope facing away from it
 * almost no direct light at all, so a third of the island read as black bands
 * lying across the ground rather than as hillside. Forty keeps the shadows long
 * and readable and keeps the far side of a hill a hillside.
 */
export const SUN_DIRECTION = Object.freeze({ x: -0.44, y: 0.66, z: -0.61 });

/**
 * Fog exists for the sea and the horizon, not for the playable ground.
 *
 * The lab plot is only about 220 metres across, so a fog range tuned for a
 * kilometre-scale island washed the middle distance to near-white and took
 * away exactly the distant silhouettes the player is supposed to navigate by.
 * Starting past the far side of the plot leaves the whole stage legible and
 * still gives the water and the distant land some aerial perspective.
 */
export const FOG_NEAR = 180;
export const FOG_FAR = 950;
