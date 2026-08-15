import { Vector2, type IUniform, type MeshStandardMaterial } from "three";

/**
 * Cloud shadows, dragged across the ground by the wind.
 *
 * The island's light never changed. One sun, one fill, both fixed, and the
 * result reads as a diorama under a lamp however good the ground under it is -
 * because the one thing every real landscape does, all the time, is change
 * brightness in patches as weather goes over it.
 *
 * This is the cheapest possible version of that and most of the benefit: two
 * layers of value noise sampled from world position, scrolled at different
 * speeds, multiplied into the ground's albedo. Nothing is simulated, nothing is
 * uploaded per frame beyond a clock, and there is no second render pass. It is
 * applied to the terrain alone: shadow on the ground is what the eye reads as
 * weather, and patching every vegetation material for the last few percent
 * would mean threading these uniforms through four more modules.
 */

export interface CloudUniforms {
  readonly time: IUniform<number>;
  /** Metres per second the cloud deck travels, per axis. */
  readonly drift: IUniform<Vector2>;
  /** Metres across one cloud. Bigger is a slower, broader sky. */
  readonly scale: IUniform<number>;
  /** How dark the deepest shade gets, 0-1. Zero disables the effect. */
  readonly depth: IUniform<number>;
}

export function createCloudUniforms(
  depth = 0.3,
  scale = 190,
  driftX = 3.4,
  driftZ = 2.1,
): CloudUniforms {
  return {
    time: { value: 0 },
    drift: { value: new Vector2(driftX, driftZ) },
    scale: { value: scale },
    depth: { value: depth },
  };
}

/**
 * Multiplies a material's albedo by the cloud deck above it.
 *
 * The world position has to be recovered in the fragment shader, and Three only
 * provides one for materials that asked for an environment map, so the vertex
 * stage passes its own.
 */
export function applyCloudShadows(
  material: MeshStandardMaterial,
  uniforms: CloudUniforms,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCloudTime = uniforms.time;
    shader.uniforms.uCloudDrift = uniforms.drift;
    shader.uniforms.uCloudScale = uniforms.scale;
    shader.uniforms.uCloudDepth = uniforms.depth;

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vCloudWorld;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    vCloudWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vCloudWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif
}`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vCloudWorld;
uniform float uCloudTime;
uniform vec2 uCloudDrift;
uniform float uCloudScale;
uniform float uCloudDepth;

float longrideCloudHash(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453123);
}

/** Smoothed value noise. Two octaves is enough for a cloud deck. */
float longrideCloudNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 fraction = fract(point);
  vec2 smoothed = fraction * fraction * (3.0 - 2.0 * fraction);
  float a = longrideCloudHash(cell);
  float b = longrideCloudHash(cell + vec2(1.0, 0.0));
  float c = longrideCloudHash(cell + vec2(0.0, 1.0));
  float d = longrideCloudHash(cell + vec2(1.0, 1.0));
  return mix(mix(a, b, smoothed.x), mix(c, d, smoothed.x), smoothed.y);
}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  if (uCloudDepth > 0.0) {
    vec2 cloudPoint = vCloudWorld.xz / uCloudScale + uCloudDrift * uCloudTime / uCloudScale;
    float cloud =
      longrideCloudNoise(cloudPoint) * 0.65 +
      longrideCloudNoise(cloudPoint * 2.7 + 11.3) * 0.35;
    // Most ground is in sun. Only the lower part of the range darkens, so the
    // deck reads as passing cloud rather than as a stain over everything.
    float shade = 1.0 - uCloudDepth * (1.0 - smoothstep(0.34, 0.68, cloud));
    diffuseColor.rgb *= shade;
  }
}`,
      );
  };
  material.customProgramCacheKey = () => "longride-cloud-shadows";
}
