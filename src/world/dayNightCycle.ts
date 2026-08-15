import { Color, Vector3 } from "three";

/**
 * The island's day: one clock that everything with a colour reads from.
 *
 * The world had a single fixed afternoon. However good the ground under it, a
 * place whose light never changes reads as a diorama under a lamp - the one
 * thing every real landscape does, all day, every day, is move its light. This
 * module owns that movement: the sun's arc, the colours of the sky at each
 * height of that arc, the moon that takes over at night, and the fog that has
 * to agree with all of it.
 *
 * It deliberately owns NO Three.js objects. It is a pure function from elapsed
 * seconds to a lighting state, and the scene applies that state to the lights,
 * dome, sea and fog it already owns. That keeps the cycle testable without a
 * renderer and keeps every consumer reading the same instant - a sky at dusk
 * over a sea still lit for noon is worse than either alone.
 *
 * Times are expressed as a fraction of one full day, phase zero at sunrise.
 * The night is compressed - a real 50/50 split means half of every play
 * session is dark, and dark is an accent, not half the game - so noon falls at
 * 0.36, sunset at 0.72, and the depth of night at 0.86.
 */

/** Seconds of real time for one full day and night. */
export const DAY_CYCLE_SECONDS = 900;

/** Fraction of the cycle that is night. Kept short: night is an accent. */
const NIGHT_FRACTION = 0.28;

/** Where in the day a session begins: mid-morning, the island's best light. */
export const DAY_CYCLE_START = 0.12;

export interface DayNightState {
  /** 0-1 through the whole cycle, phase zero at sunrise. */
  readonly phase: number;
  /** Unit vector TOWARDS the dominant light - the sun by day, moon by night. */
  readonly lightDirection: Vector3;
  readonly lightColor: Color;
  readonly lightIntensity: number;
  /** Hemisphere fill. */
  readonly skyFill: Color;
  readonly groundFill: Color;
  readonly fillIntensity: number;
  /** Sky dome bands. */
  readonly zenith: Color;
  readonly horizon: Color;
  readonly sunGlow: Color;
  /** Where the visible sun disc is, even when it is under the horizon. */
  readonly sunDirection: Vector3;
  /** 0 in daylight, 1 at full night. Drives stars, moon and the sea's dark. */
  readonly night: number;
  readonly fogColor: Color;
}

/** A colour ramp: sorted stops, sampled with linear blending. */
type Ramp = ReadonlyArray<readonly [at: number, color: Color]>;

function sampleRamp(ramp: Ramp, at: number, out: Color): Color {
  const first = ramp[0]!;
  const last = ramp[ramp.length - 1]!;
  if (at <= first[0]) return out.copy(first[1]);
  if (at >= last[0]) return out.copy(last[1]);
  for (let index = 0; index < ramp.length - 1; index += 1) {
    const a = ramp[index]!;
    const b = ramp[index + 1]!;
    if (at >= a[0] && at <= b[0]) {
      const t = (at - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return out.copy(a[1]).lerp(b[1], t);
    }
  }
  return out.copy(last[1]);
}

/**
 * Every ramp below is keyed on sun ELEVATION (sine of its altitude), not on
 * clock time: the colours of a sunset belong to where the sun is, and keying
 * them on elevation makes dawn and dusk automatically mirror each other.
 */

/** The sun itself: white overhead, amber low, ember at the horizon. */
const SUN_RAMP: Ramp = [
  [-0.06, new Color("#7a3a18")],
  [0.02, new Color("#c96a2a")],
  [0.14, new Color("#e8a95c")],
  [0.35, new Color("#ffe8c4")],
  [1.0, new Color("#fff4e0")],
];

/** Zenith: deep night blue, through dusk indigo, to daytime blue. */
const ZENITH_RAMP: Ramp = [
  [-0.32, new Color("#0a1024")],
  [-0.12, new Color("#131c38")],
  [0.0, new Color("#3a4470")],
  [0.12, new Color("#5a7ba6")],
  [0.4, new Color("#7aa3c8")],
  [1.0, new Color("#82aed0")],
];

/** Horizon band: where all the drama is. */
const HORIZON_RAMP: Ramp = [
  [-0.32, new Color("#131a2c")],
  [-0.1, new Color("#2c2c48")],
  [0.0, new Color("#b0563a")],
  [0.06, new Color("#d98d54")],
  [0.16, new Color("#e6c9a0")],
  [0.4, new Color("#cfe0e8")],
  [1.0, new Color("#d8e6ea")],
];

/** Fog agrees with the horizon, a step dimmer so silhouettes stay readable. */
const FOG_RAMP: Ramp = [
  [-0.32, new Color("#10141f")],
  [-0.1, new Color("#232638")],
  [0.0, new Color("#8a5a44")],
  [0.08, new Color("#b08a68")],
  [0.2, new Color("#b8c4bd")],
  [1.0, new Color("#c2cdc4")],
];

/** Hemisphere sky fill: cool daylight, blue moonlight. */
const SKY_FILL_RAMP: Ramp = [
  [-0.32, new Color("#1c2740")],
  [-0.06, new Color("#2c3a55")],
  [0.06, new Color("#8a7d6a")],
  [0.2, new Color("#9db3c8")],
  [1.0, new Color("#a8bdd0")],
];

/** Hemisphere ground bounce: what the grass throws back up. */
const GROUND_FILL_RAMP: Ramp = [
  [-0.32, new Color("#0e1410")],
  [-0.06, new Color("#1a2018")],
  [0.06, new Color("#5a4a34")],
  [0.2, new Color("#5f6b4a")],
  [1.0, new Color("#66744f")],
];

const MOONLIGHT = new Color("#8fa5c8");

/** East and north of the sun's plane, so the arc crosses the whole sky. */
const EAST = new Vector3(1, 0, 0);
const NORTH_LEAN = 0.32;

export class DayNightCycle {
  private readonly state: {
    phase: number;
    lightDirection: Vector3;
    lightColor: Color;
    lightIntensity: number;
    skyFill: Color;
    groundFill: Color;
    fillIntensity: number;
    zenith: Color;
    horizon: Color;
    sunGlow: Color;
    sunDirection: Vector3;
    night: number;
    fogColor: Color;
  } = {
    phase: 0,
    lightDirection: new Vector3(0, 1, 0),
    lightColor: new Color(),
    lightIntensity: 1,
    skyFill: new Color(),
    groundFill: new Color(),
    fillIntensity: 1,
    zenith: new Color(),
    horizon: new Color(),
    sunGlow: new Color(),
    sunDirection: new Vector3(0, 1, 0),
    night: 0,
    fogColor: new Color(),
  };

  public constructor(
    private readonly cycleSeconds = DAY_CYCLE_SECONDS,
    private readonly startPhase = DAY_CYCLE_START,
  ) {}

  /**
   * The lighting state at a moment. Returns one shared, reused object: callers
   * copy what they keep, which every Three.js `copy()` call does anyway.
   */
  public at(elapsedSeconds: number): DayNightState {
    const s = this.state;
    s.phase = (this.startPhase + elapsedSeconds / this.cycleSeconds) % 1;

    // The sun spends `1 - NIGHT_FRACTION` of the cycle above the horizon.
    // Its altitude angle runs 0..pi across the day and 0..-pi across the
    // (compressed) night, so elevation is continuous at both horizons.
    const day = 1 - NIGHT_FRACTION;
    const altitude =
      s.phase < day
        ? (s.phase / day) * Math.PI
        : -((s.phase - day) / NIGHT_FRACTION) * Math.PI;
    const elevation = Math.sin(altitude);
    const along = -Math.cos(altitude);

    // The sun's track: rises in the east, arcs through south, sets in the west.
    s.sunDirection
      .copy(EAST)
      .multiplyScalar(along)
      .add(new Vector3(0, elevation, NORTH_LEAN * (1 - Math.abs(elevation) * 0.5)))
      .normalize();

    // Night comes on through civil twilight, not at the instant of sunset.
    s.night = smoothstep(0.04, -0.14, elevation);

    // The working light is the sun by day and the moon by night. The moon is
    // placed opposite the sun along the same track, so it rises as the sun
    // sets and the shadows swing rather than snap.
    if (s.night < 0.995) {
      sampleRamp(SUN_RAMP, elevation, s.lightColor);
    }
    if (s.night > 0.5) {
      s.lightDirection.copy(s.sunDirection).multiplyScalar(-1);
      s.lightDirection.y = Math.max(0.25, Math.abs(s.lightDirection.y));
      s.lightDirection.normalize();
      s.lightColor.lerp(MOONLIGHT, smoothstep(0.5, 0.9, s.night));
    } else {
      s.lightDirection.copy(s.sunDirection);
      if (s.lightDirection.y < 0.08) {
        // Hold the light just above the horizon while the disc dips: a
        // shadow-casting light aimed level or upward turns the terrain into
        // one long artifact.
        s.lightDirection.y = 0.08;
        s.lightDirection.normalize();
      }
    }
    // Daylight strength, dimming through dusk to moonlight.
    const dayStrength = 2.05 * smoothstep(-0.08, 0.16, elevation);
    // The moonlight floor is a playability number, not an astronomy one: the
    // island must stay readable enough to ride at the depth of night.
    s.lightIntensity = Math.max(0.52, dayStrength);

    sampleRamp(ZENITH_RAMP, elevation, s.zenith);
    sampleRamp(HORIZON_RAMP, elevation, s.horizon);
    sampleRamp(FOG_RAMP, elevation, s.fogColor);
    sampleRamp(SKY_FILL_RAMP, elevation, s.skyFill);
    sampleRamp(GROUND_FILL_RAMP, elevation, s.groundFill);
    s.sunGlow.copy(s.lightColor);
    s.fillIntensity = 0.95 + 1.65 * smoothstep(-0.12, 0.2, elevation);

    return s;
  }
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
