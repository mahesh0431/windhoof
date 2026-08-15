import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { STAGE_WATER_LEVEL, stageHeightAt } from "../../stage/horseLabStage";
import { PALETTE } from "../palette";

const WATER_VERTEX = /* glsl */ `
  attribute float aShore;
  varying float vShore;
  varying float vViewDepth;
  varying vec3 vWorldPosition;
  void main() {
    vShore = aShore;
    vWorldPosition = position;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewDepth = -viewPosition.z;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const WATER_FRAGMENT = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform vec3 uHaze;
  uniform float uHazeNear;
  uniform float uHazeFar;
  uniform float uTime;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uNight;
  uniform vec3 uCameraPosition;
  varying float vShore;
  varying float vViewDepth;
  varying vec3 vWorldPosition;

  void main() {
    vec3 color = mix(uDeep, uShallow, vShore);
    // Night pulls the whole body of the water down before anything is added
    // on top; moonlit sea is dark first and silvered second.
    color *= 1.0 - uNight * 0.72;

    // How much surface detail this pixel can honestly carry.
    //
    // Both the swell and the surf are periodic in world space, so once a pixel
    // covers more than a wave the pattern aliases: at the grazing angles the
    // horizon is made of, the two frequencies beat against the pixel grid and
    // stand up as fixed moire arcs across the whole sea. Fading the detail out
    // with distance is the cheap analytic version of a mip chain - the far
    // water settles to flat colour, which is what open water looks like from a
    // hilltop anyway.
    float detail = 1.0 - smoothstep(90.0, 400.0, vViewDepth);

    // Two swell octaves travelling on different headings: one long slow set
    // and a shorter chop across it. One octave reads as a repeating pattern;
    // two beating against each other read as water.
    float swell = sin(vWorldPosition.x * 0.09 + uTime * 0.7)
                * cos(vWorldPosition.z * 0.11 - uTime * 0.55);
    float chop = sin(vWorldPosition.x * 0.23 - vWorldPosition.z * 0.19 + uTime * 1.4)
               * sin(vWorldPosition.x * 0.17 + vWorldPosition.z * 0.27 - uTime * 1.1);
    color += (swell * 0.02 + chop * 0.011) * detail;

    // Sun glitter: the path of broken light running from the horizon towards
    // the viewer, the single strongest cue that a flat plane is water. The
    // surface normal is tilted by the swell derivatives, the view ray is
    // mirrored about it, and the sparkle is how nearly that mirror looks into
    // the sun - modulated by the chop so the path glitters rather than glows.
    vec3 toCamera = normalize(uCameraPosition - vWorldPosition);
    vec3 waterNormal = normalize(vec3(swell * 0.14 + chop * 0.08, 1.0, swell * 0.1 - chop * 0.07));
    vec3 mirrored = reflect(-toCamera, waterNormal);
    float glitterAlignment = max(dot(mirrored, normalize(uSunDirection)), 0.0);
    float sparkle = 0.55 + 0.45 * chop;
    float glitter = pow(glitterAlignment, 90.0) * sparkle * (1.0 - uNight * 0.55);
    color += uSunColor * glitter * 0.85;

    // A slow surf band where the sea meets the beach. The band itself survives
    // to distance because it marks the shoreline; only its modulation fades.
    // A wide ramp on purpose: a tight threshold turns any step in the shore
    // attribute into a visible edge on the water.
    float surf = smoothstep(0.5, 1.0, vShore)
               * (0.55 + 0.45 * detail
                       * sin(uTime * 1.3 + vWorldPosition.x * 0.16 + vWorldPosition.z * 0.13));
    color = mix(color, uFoam * (1.0 - uNight * 0.6), clamp(surf, 0.0, 1.0) * 0.5);

    // The water carries its own haze instead of scene fog, which it opts out of
    // so the surf band stays readable up close. Without this the open sea keeps
    // full saturation all the way to the far plane and meets the pale sky along
    // a hard teal edge that reads as a rendering seam rather than a horizon.
    color = mix(color, uHaze, smoothstep(uHazeNear, uHazeFar, vViewDepth));

    // A half-level of noise, to break up the eight-bit staircase.
    //
    // The haze ramp crawls across hundreds of pixels, so quantisation lands as
    // wide bands of flat colour following lines of constant depth - concentric
    // arcs, which read as rings on the water rather than as a gradient. Dither
    // costs one hash and pushes the error below the point where the eye can
    // organise it into edges.
    float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    color += (dither - 0.5) / 255.0;

    gl_FragColor = vec4(color, 0.9);
  }
`;

export interface SeaVisual {
  readonly group: Group;
  update(elapsedSeconds: number): void;
  /** Driven by the day/night cycle: sun for the glitter path, night to darken. */
  setLight(
    sunDirection: Vector3,
    sunColor: Color,
    night: number,
    cameraPosition: Vector3,
  ): void;
  /**
   * Releases the water surface and every distant-land hill.
   *
   * Three does not free GPU resources when a mesh leaves the scene graph, so a
   * scene that is torn down and rebuilt - which is what a stage switch or a
   * repeated construct/dispose check does - leaked one shader program, eight
   * geometries and two materials every time.
   */
  dispose(): void;
}

export interface SeaVisualOptions {
  /** Height of the water surface in world units. */
  readonly waterLevel?: number;
  /** Where the water mesh starts. Terrain above the surface hides the rest. */
  readonly innerRadius?: number;
  readonly outerRadius?: number;
  /** Sea-bed height, used to key the shallow tint and the surf band. */
  readonly bedHeightAt?: (x: number, z: number) => number;
  /** Distance of the hazed horizon landforms from the origin. */
  readonly distantLandScale?: number;
  /** View distances over which open water fades into the horizon haze. */
  readonly hazeNear?: number;
  readonly hazeFar?: number;
  /** Horizon haze colour. Defaults to the project fog. */
  readonly hazeColor?: Color;
}

/**
 * The sea is atmosphere and a boundary, not a swimming mechanic. It exists to
 * close the plot honestly and to give the horizon a stable line the player can
 * orient against.
 *
 * Everything about its extent is a parameter because the Horse Lab plot and the
 * compiled island are very different sizes, and a surf band tuned for one reads
 * as a smear at the other.
 */
export function createSeaVisual(options: SeaVisualOptions = {}): SeaVisual {
  const waterLevel = options.waterLevel ?? STAGE_WATER_LEVEL;
  const bedHeightAt = options.bedHeightAt ?? stageHeightAt;
  const group = new Group();
  group.name = "sea";

  const angular = 144;
  /*
   * Ring count drives how smoothly `aShore` interpolates, and `aShore` drives
   * the surf band. At 52 rings the shore attribute stepped hard enough between
   * neighbouring rings that the surf threshold landed on ring boundaries, and
   * the boundaries showed up as banded arcs on the water near the beach.
   */
  const rings = 96;
  const innerRadius = options.innerRadius ?? 84;
  const outerRadius = options.outerRadius ?? 720;

  const vertexCount = (rings + 1) * (angular + 1);
  const positions = new Float32Array(vertexCount * 3);
  const shore = new Float32Array(vertexCount);
  const indices = new Uint32Array(rings * angular * 6);

  for (let ring = 0; ring <= rings; ring += 1) {
    // Bias resolution towards the shoreline where the surf band lives.
    const t = ring / rings;
    const radius = innerRadius + (outerRadius - innerRadius) * Math.pow(t, 3.1);
    for (let step = 0; step <= angular; step += 1) {
      const angle = (step / angular) * Math.PI * 2;
      const index = ring * (angular + 1) + step;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      positions[index * 3] = x;
      positions[index * 3 + 1] = waterLevel;
      positions[index * 3 + 2] = z;

      const bedDepth = waterLevel - bedHeightAt(x, z);
      shore[index] = Math.min(1, Math.max(0, 1 - bedDepth / 2.6));
    }
  }

  let cursor = 0;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let step = 0; step < angular; step += 1) {
      const a = ring * (angular + 1) + step;
      const b = a + 1;
      const c = a + angular + 1;
      const d = c + 1;
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("aShore", new BufferAttribute(shore, 1));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  const material = new ShaderMaterial({
    uniforms: {
      uDeep: { value: PALETTE.water },
      uShallow: { value: PALETTE.waterShallow },
      uFoam: { value: PALETTE.foam },
      // Cloned: the palette is shared module state and a uniform must never be
      // able to write back into it.
      uHaze: { value: (options.hazeColor ?? PALETTE.fog).clone() },
      uHazeNear: { value: options.hazeNear ?? 320 },
      uHazeFar: { value: options.hazeFar ?? 1250 },
      uTime: { value: 0 },
      uSunDirection: { value: new Vector3(0.35, 0.66, 0.35) },
      uSunColor: { value: PALETTE.sunLight.clone() },
      uNight: { value: 0 },
      uCameraPosition: { value: new Vector3() },
    },
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    transparent: true,
    side: DoubleSide,
    fog: false,
  });

  const water = new Mesh(geometry, material);
  water.name = "sea-surface";
  water.frustumCulled = false;
  water.renderOrder = -10;
  group.add(water);
  const distantLand = createDistantLand(options.distantLandScale ?? 1, waterLevel);
  group.add(distantLand);
  // The horizon hills are unlit, so the cycle has to dim them by hand or they
  // stand at the bottom of the night sky as a band of full daylight.
  const distantLandDay = new Color();
  let distantLandMaterial: MeshBasicMaterial | null = null;
  for (const hill of distantLand.children) {
    if (hill instanceof Mesh && hill.material instanceof MeshBasicMaterial) {
      distantLandMaterial = hill.material;
      distantLandDay.copy(hill.material.color);
      break;
    }
  }

  let disposed = false;

  return {
    group,
    update(elapsedSeconds: number) {
      material.uniforms.uTime!.value = elapsedSeconds;
    },
    setLight(sunDirection, sunColor, night, cameraPosition) {
      (material.uniforms.uSunDirection!.value as Vector3).copy(sunDirection);
      (material.uniforms.uSunColor!.value as Color).copy(sunColor);
      material.uniforms.uNight!.value = night;
      (material.uniforms.uCameraPosition!.value as Vector3).copy(cameraPosition);
      if (distantLandMaterial) {
        distantLandMaterial.color
          .copy(distantLandDay)
          .multiplyScalar(1 - night * 0.82);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
      // The hills share one material but each owns its own geometry, so the
      // material must be disposed once and the geometries individually.
      let hillMaterial: MeshBasicMaterial | null = null;
      for (const hill of distantLand.children) {
        if (!(hill instanceof Mesh)) continue;
        hill.geometry.dispose();
        if (hill.material instanceof MeshBasicMaterial) hillMaterial = hill.material;
      }
      hillMaterial?.dispose();
      group.clear();
    },
  };
}

/**
 * A low ring of hazy landforms past the water. They sit beyond fog range with
 * fog disabled and a pre-hazed colour, which is cheaper than extending the fog
 * and gives the horizon the distant-silhouette cue the art brief asks for.
 */
function createDistantLand(scale: number, waterLevel: number): Group {
  const group = new Group();
  group.name = "distant-land";

  // Hazed towards a cool slate rather than towards the fog colour. Landforms
  // this far out should read as land seen through air, not as a bank of cloud.
  const hazed = new Color("#43596a").lerp(PALETTE.fog, 0.2);
  const material = new MeshBasicMaterial({ color: hazed, fog: false });

  const hills: ReadonlyArray<readonly [number, number, number, number]> = [
    // angle, distance, width, height
    [0.35, 620, 210, 27],
    [1.15, 700, 150, 18],
    [2.2, 580, 260, 36],
    [3.05, 660, 170, 20],
    [3.9, 610, 200, 31],
    [4.75, 720, 240, 23],
    [5.6, 640, 180, 26],
  ];

  for (const [angle, distance, width, height] of hills) {
    const geometry = new SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    const hill = new Mesh(geometry, material);
    hill.scale.set(width * scale, height * Math.sqrt(scale), width * 0.7 * scale);
    hill.position.set(
      Math.cos(angle) * distance * scale,
      waterLevel - 6,
      Math.sin(angle) * distance * scale,
    );
    hill.frustumCulled = false;
    group.add(hill);
  }

  return group;
}
