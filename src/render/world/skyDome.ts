import {
  BackSide,
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
 * A three-band gradient with a warm sun bloom. The horizon band is what gives
 * a small plot of ground a believable sense of distance, and it is cheap enough
 * to leave post-processing switched off, which the performance gates require.
 */
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uHaze;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  varying vec3 vDirection;

  void main() {
    vec3 direction = normalize(vDirection);
    float elevation = clamp(direction.y, -1.0, 1.0);

    float horizonBlend = pow(clamp(1.0 - abs(elevation), 0.0, 1.0), 2.4);
    vec3 sky = mix(uZenith, uHorizon, horizonBlend);

    float sunAlignment = max(dot(direction, normalize(uSunDirection)), 0.0);
    sky = mix(sky, uHaze, pow(sunAlignment, 3.0) * 0.55 * horizonBlend);
    sky += uSunColor * pow(sunAlignment, 220.0) * 0.9;
    sky += uSunColor * pow(sunAlignment, 12.0) * 0.06;

    // Below the horizon fades towards the sea haze rather than going black.
    sky = mix(sky, uHorizon * 0.82, clamp(-elevation * 3.0, 0.0, 1.0));

    gl_FragColor = vec4(sky, 1.0);
  }
`;

export function createSkyDome(): Mesh {
  const material = new ShaderMaterial({
    uniforms: {
      uZenith: { value: PALETTE.skyZenith },
      uHorizon: { value: PALETTE.skyHorizon },
      uHaze: { value: PALETTE.skyHaze },
      uSunColor: { value: PALETTE.sunLight },
      uSunDirection: {
        value: new Vector3(SUN_DIRECTION.x, SUN_DIRECTION.y, SUN_DIRECTION.z),
      },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    side: BackSide,
    depthWrite: false,
    fog: false,
  });

  const dome = new Mesh(new SphereGeometry(900, 32, 20), material);
  dome.name = "sky-dome";
  dome.renderOrder = -1000;
  dome.frustumCulled = false;
  return dome;
}
