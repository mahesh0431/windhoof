import { Color } from "three";
import type { WorldManifest } from "../game/world/compiler/worldTypes";
import { PALETTE } from "../render/palette";

/**
 * The island's atmosphere, derived from the manifest's authored presentation.
 *
 * `presentation` carries four things: `mood`, `atmosphere`, `lighting` and a
 * list of `palette` anchors. Three of those are prose written for a human to
 * read, and they are honoured the way prose is honoured - by the render-layer
 * decisions already made against them (a low warm sun, a cool sky fill, long
 * readable shadows, restrained haze). Only `palette` is machine-usable, and only
 * because the anchors are named colours.
 *
 * So this file does exactly one mechanical thing: it builds the distance haze
 * out of the world's own recognised palette anchors, lifted towards the sky so
 * the horizon stays air rather than turning into a wall of averaged mud. A world
 * whose palette names storm-blue and wet-sand hazes differently from one that
 * names ember and ash, without anyone editing this file.
 *
 * Anchors the renderer does not recognise are ignored rather than guessed at. If
 * none are recognised the build falls back to the project fog colour, which is
 * the same result as before the palette existed.
 */

const PALETTE_ANCHORS: Readonly<Record<string, Color>> = {
  "storm-blue": new Color("#5b7c96"),
  "wet-sand": new Color("#a2957a"),
  "longgrass-gold": new Color("#bfae6d"),
  "fern-green": new Color("#4f7440"),
  "sunlit-stone": new Color("#b9ac95"),
  "sea-teal": new Color("#356f7d"),
  "pale-sky": new Color("#d6dee2"),
};

export interface IslandAtmosphere {
  /** Scene fog colour, and the colour the sea fades to at the horizon. */
  readonly haze: Color;
  /** Anchors that were recognised, for evidence and for documentation. */
  readonly recognisedAnchors: readonly string[];
}

export function islandAtmosphere(manifest: WorldManifest): IslandAtmosphere {
  const recognised = manifest.presentation.palette.filter(
    (name) => PALETTE_ANCHORS[name] !== undefined,
  );

  if (recognised.length === 0) {
    return { haze: PALETTE.fog.clone(), recognisedAnchors: [] };
  }

  const mean = new Color(0, 0, 0);
  for (const name of recognised) {
    const anchor = PALETTE_ANCHORS[name];
    if (!anchor) continue;
    mean.r += anchor.r;
    mean.g += anchor.g;
    mean.b += anchor.b;
  }
  mean.r /= recognised.length;
  mean.g /= recognised.length;
  mean.b /= recognised.length;

  // Mostly sky. Haze is air with a little of the land's colour suspended in it,
  // and anything more than that reads as a coloured filter over the whole game.
  const haze = PALETTE.skyHorizon.clone().lerp(mean, 0.34);
  return { haze, recognisedAnchors: recognised };
}
