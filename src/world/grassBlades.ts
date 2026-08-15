import {
  BufferAttribute,
  BufferGeometry,
  Vector2,
  Vector3,
  type IUniform,
  type MeshStandardMaterial,
} from "three";

/**
 * The shape and the motion of everything that grows on the ground.
 *
 * Ground cover used to be an open cone per tuft: three triangles, which is the
 * right budget, arranged as the one silhouette that never reads as a plant. At
 * a rider's height a field of them is a field of pale pyramids, and the first
 * close inspection of the island showed exactly that - tents scattered on bare
 * ground. The triangle count was never the problem. What the same three
 * triangles are spent on is.
 *
 * So a tuft is now blades: separate tapered triangles splaying from one root,
 * drawn double-sided so a blade is a blade from either side. Same cost, and it
 * reads as grass because a grass silhouette is what it is.
 *
 * Both halves of the cover - the near carpet and the far scatter - share this
 * file, because the one thing that would give the trick away is the moment the
 * near grass and the far grass disagree about what a plant looks like.
 */

export interface TuftShape {
  /** Blades per tuft. Three is the fewest that reads as a clump from any angle. */
  readonly blades: number;
  /** Blade half-width at the root, as a fraction of the instance radius. */
  readonly width: number;
  /** How far the tips splay from the root, as a fraction of the instance radius. */
  readonly splay: number;
  /**
   * How dark the root of a blade is, 0-1, written into vertex colours.
   *
   * Grass is darker where it is shaded by its own mass, and on flat-lit
   * stylised ground this is the difference between a carpet with depth in it
   * and a flat green sheet.
   */
  readonly rootShade: number;
}

/**
 * One tuft, authored with its root at the origin and its tips at y = 1.
 *
 * Instances scale it by (radius, height, radius), so height and spread are set
 * per tuft while the shape stays shared. `seed` varies the blade angles so a
 * field is not one silhouette repeated on a grid.
 */
export function createTuftGeometry(shape: TuftShape, seed = 1): BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];

  const push = (x: number, y: number, z: number, tone: number): void => {
    positions.push(x, y, z);
    colors.push(tone, tone, tone);
  };

  for (let blade = 0; blade < shape.blades; blade += 1) {
    // Deterministic per blade and per seed: the same tuft geometry every run,
    // and a different one per layer.
    const jitter = fract(Math.sin((blade + 1) * 12.9898 + seed * 78.233) * 43_758.5);
    const angle = ((blade + jitter * 0.6) / shape.blades) * Math.PI * 2;
    const lean = 0.55 + jitter * 0.75;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    // Perpendicular, so a blade is widest across its own direction of splay.
    const sideX = -dirZ * shape.width;
    const sideZ = dirX * shape.width;
    const rootX = dirX * shape.width * 0.5;
    const rootZ = dirZ * shape.width * 0.5;

    push(rootX - sideX, 0, rootZ - sideZ, shape.rootShade);
    push(rootX + sideX, 0, rootZ + sideZ, shape.rootShade);
    // Not quite full value at the tip: the ground tints are already pale and a
    // white-hot tip under this exposure reads as bleached rather than as lit.
    push(dirX * shape.splay * lean, 1, dirZ * shape.splay * lean, 0.94);
  }

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

export interface WindUniforms {
  readonly time: IUniform<number>;
  /** Metres of tip travel, per axis. */
  readonly wind: IUniform<Vector2>;
  /** Gust rate. Grass ripples; a tree the same size as a house does not. */
  readonly speed: IUniform<number>;
  /** Where the horse is standing, in world metres. */
  readonly parter: IUniform<Vector3>;
  /** How far the horse pushes grass aside, in metres. Zero disables it. */
  readonly partRadius: IUniform<number>;
}

export function createWindUniforms(
  strengthX = 0.11,
  strengthZ = 0.07,
  speed = 1,
  partRadius = 0,
): WindUniforms {
  return {
    time: { value: 0 },
    wind: { value: new Vector2(strengthX, strengthZ) },
    speed: { value: speed },
    parter: { value: new Vector3(0, -1000, 0) },
    partRadius: { value: partRadius },
  };
}

/**
 * Bends a material's instances at the tip, in the vertex shader.
 *
 * Wind is not decoration here. A still field of grass is the single clearest
 * signal that a world is a diorama, and it is the one that costs nothing to
 * fix: nothing is simulated, nothing is uploaded per frame, and the CPU never
 * touches an instance. Tens of thousands of tufts move for one uniform.
 *
 * The offset is divided by the instance's own scale because it is applied
 * before the instance matrix, and it is weighted by the square of the height so
 * a blade pivots at its root instead of sliding out of the ground.
 */
export function applyGrassWind(
  material: MeshStandardMaterial,
  uniforms: WindUniforms,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassTime = uniforms.time;
    shader.uniforms.uGrassWind = uniforms.wind;
    shader.uniforms.uGrassSpeed = uniforms.speed;
    shader.uniforms.uGrassParter = uniforms.parter;
    shader.uniforms.uGrassPartRadius = uniforms.partRadius;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uGrassTime;
uniform vec2 uGrassWind;
uniform float uGrassSpeed;
uniform vec3 uGrassParter;
uniform float uGrassPartRadius;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
    vec3 grassRoot = instanceMatrix[3].xyz;
    float grassScaleX = max(length(instanceMatrix[0].xyz), 0.0001);
    float grassScaleZ = max(length(instanceMatrix[2].xyz), 0.0001);
  #else
    vec3 grassRoot = vec3(0.0);
    float grassScaleX = 1.0;
    float grassScaleZ = 1.0;
  #endif
  float grassLean = transformed.y * transformed.y;
  float grassPhase = grassRoot.x * 0.13 + grassRoot.z * 0.11;
  // Two frequencies, so the field breathes in gusts rather than beating.
  float grassClock = uGrassTime * uGrassSpeed;
  float grassGust =
    sin(grassClock * 1.05 + grassPhase) * 0.68 +
    sin(grassClock * 2.37 + grassPhase * 1.63) * 0.32;
  transformed.x += uGrassWind.x * grassGust * grassLean / grassScaleX;
  transformed.z += uGrassWind.y * grassGust * grassLean / grassScaleZ;

  // Grass gets out of the way.
  //
  // A horse that gallops through a field without the field noticing is the
  // detail that gives the whole thing away, and it is almost free: one uniform,
  // no simulation, no per-instance work on the CPU. Blades lean away from the
  // horse and press down as it gets closer, hardest right under it.
  if (uGrassPartRadius > 0.0) {
    vec2 grassAway = grassRoot.xz - uGrassParter.xz;
    float grassNear = length(grassAway);
    float grassPart = 1.0 - smoothstep(0.0, uGrassPartRadius, grassNear);
    if (grassPart > 0.001) {
      vec2 grassPush = grassAway / max(grassNear, 0.001);
      transformed.x += grassPush.x * grassPart * 0.55 * grassLean / grassScaleX;
      transformed.z += grassPush.y * grassPart * 0.55 * grassLean / grassScaleZ;
      // Trodden as well as parted, or the blades sweep aside while staying
      // bolt upright, which reads as a force field rather than as weight.
      transformed.y *= 1.0 - grassPart * 0.45;
    }
  }
}`,
      );
  };
  // Without this, Three reuses a cached program compiled from the unmodified
  // shader for any other material with the same feature set, and the grass
  // silently stops moving.
  material.customProgramCacheKey = () => "longride-grass-wind";
}

function fract(value: number): number {
  return value - Math.floor(value);
}
