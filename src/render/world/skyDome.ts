import {
  BackSide,
  Color,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { PALETTE, SUN_DIRECTION } from "../palette";

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * A three-band gradient sky that knows what time it is.
 *
 * By day it is the same cheap dome as before: zenith, horizon and haze bands
 * with a warm bloom around the sun. As `uNight` rises the bands hand over to a
 * star field and a moon. The stars are hashed from direction alone - no
 * texture, no geometry - and quantised onto a grid so they hold still while
 * the camera turns. The moon is drawn along `uMoonDirection` with a lit disc
 * and a soft halo.
 *
 * Everything here stays cheap enough to leave post-processing off, which the
 * performance gates require.
 */
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform vec3 uMoonDirection;
  uniform float uNight;
  varying vec3 vDirection;

  float hash21(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float elevation = clamp(direction.y, -1.0, 1.0);

    float horizonBlend = pow(clamp(1.0 - abs(elevation), 0.0, 1.0), 2.4);
    vec3 sky = mix(uZenith, uHorizon, horizonBlend);

    // The sun: bloom while it is above the horizon, fading as night comes on.
    float dayGlow = 1.0 - uNight;
    float sunAlignment = max(dot(direction, normalize(uSunDirection)), 0.0);
    sky = mix(sky, uHaze, pow(sunAlignment, 3.0) * 0.55 * horizonBlend * dayGlow);
    sky += uSunColor * pow(sunAlignment, 220.0) * 0.9 * dayGlow;
    sky += uSunColor * pow(sunAlignment, 12.0) * 0.06 * dayGlow;

    // Stars. Directions are quantised onto a coarse grid; one cell in roughly
    // sixty gets a star, sized and brightened by a second hash. Twinkle would
    // need a clock and reads as noise at this scale, so they simply shine.
    if (uNight > 0.01 && elevation > 0.0) {
      vec2 cell = vec2(
        atan(direction.x, direction.z) * 40.0,
        asin(clamp(direction.y, -1.0, 1.0)) * 40.0
      );
      vec2 grid = floor(cell);
      float pick = hash21(grid);
      if (pick > 0.984) {
        vec2 centre = grid + 0.5 + (vec2(hash21(grid + 7.0), hash21(grid + 13.0)) - 0.5) * 0.6;
        float distance2 = dot(cell - centre, cell - centre);
        float star = exp(-distance2 * 18.0) * (0.35 + hash21(grid + 29.0) * 0.65);
        // Stars fade toward the horizon the way real ones do, into the air.
        sky += vec3(0.9, 0.94, 1.0) * star * uNight * smoothstep(0.0, 0.25, elevation);
      }
    }

    // The moon: a hard-edged lit disc with a soft halo, only at night.
    if (uNight > 0.01) {
      float moonAlignment = dot(direction, normalize(uMoonDirection));
      float disc = smoothstep(0.99955, 0.99985, moonAlignment);
      float halo = pow(max(moonAlignment, 0.0), 180.0) * 0.22;
      vec3 moonColor = vec3(0.86, 0.89, 0.94);
      sky += (moonColor * disc + moonColor * halo) * uNight;
    }

    // Below the horizon fades towards the sea haze rather than going black.
    sky = mix(sky, uHorizon * 0.82, clamp(-elevation * 3.0, 0.0, 1.0));

    gl_FragColor = vec4(sky, 1.0);
  }
`;

export interface SkyDome {
  readonly mesh: Mesh;
  /** All driven by the day/night cycle each frame; colours are copied in. */
  readonly uniforms: {
    readonly uZenith: { value: Color };
    readonly uHorizon: { value: Color };
    readonly uHaze: { value: Color };
    readonly uSunDirection: { value: Vector3 };
    readonly uSunColor: { value: Color };
    readonly uMoonDirection: { value: Vector3 };
    readonly uNight: { value: number };
  };
}

export function createSkyDome(): SkyDome {
  const uniforms = {
    uZenith: { value: PALETTE.skyZenith.clone() },
    uHorizon: { value: PALETTE.skyHorizon.clone() },
    uHaze: { value: PALETTE.skyHaze.clone() },
    uSunColor: { value: PALETTE.sunLight.clone() },
    uSunDirection: {
      value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z),
    },
    uMoonDirection: { value: new Vector3(0, 1, 0) },
    uNight: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });

  const mesh = new Mesh(new SphereGeometry(900, 32, 20), material);
  mesh.name = "sky-dome";
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}
