import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  NormalBlending,
  Points,
  ShaderMaterial,
} from "three";
import type { WorldSurface } from "../../game/contracts/worldSurface";
import { PALETTE } from "../palette";

/**
 * Ground debris thrown up by the hooves.
 *
 * A horse that leaves no mark on the ground reads as a model sliding over a
 * texture, which is half of what the first blind playtest called a rigid
 * generic avatar. This is the cheapest honest fix: the terrain answers back.
 *
 * Everything lives in one pooled Points object, so the whole effect costs a
 * single draw call regardless of how hard the horse is working, and the pool
 * is fixed-size so a long gallop cannot grow allocation over time.
 */

const CAPACITY = 220;

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aLife;
  attribute vec3 aColor;
  uniform float uPixelsPerMetre;
  varying float vLife;
  varying vec3 vColor;
  void main() {
    vLife = aLife;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // aSize is a diameter in metres, projected properly. An earlier version
    // used an arbitrary constant instead, which made a single grain of sand
    // seven metres away draw eight hundred pixels wide and fill the screen
    // with a beige wall. The clamp keeps that class of mistake cheap.
    float metres = aSize * (1.0 + (1.0 - aLife) * 0.9);
    gl_PointSize = clamp(
      metres * uPixelsPerMetre / max(-mvPosition.z, 0.5),
      1.0,
      80.0
    );
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vLife;
  varying vec3 vColor;
  void main() {
    if (vLife <= 0.0) discard;
    vec2 offset = gl_PointCoord - vec2(0.5);
    float radius = dot(offset, offset);
    if (radius > 0.25) discard;
    float edge = 1.0 - smoothstep(0.06, 0.25, radius);
    float fadeIn = smoothstep(1.0, 0.86, vLife);
    gl_FragColor = vec4(vColor, edge * vLife * fadeIn * 0.85);
  }
`;

export interface HoofContacts {
  readonly points: Points;
  /**
   * Spawns debris at a hoof strike. `weight` is the animator's footfall weight
   * and `speed` the horse's resolved ground speed.
   */
  strike(
    x: number,
    y: number,
    z: number,
    surface: WorldSurface,
    /** True when the hoof lands at or below the water line. */
    submerged: boolean,
    weight: number,
    speed: number,
    forwardX: number,
    forwardZ: number,
  ): void;
  /**
   * `pixelsPerMetre` is the renderer's vertical projection scale, so debris
   * keeps its real size across resolutions and field-of-view changes.
   */
  update(deltaSeconds: number, pixelsPerMetre: number): void;
  /** Particles currently alive. Diagnostics and browser checks only. */
  liveCount(): number;
  dispose(): void;
}

interface SurfaceStyle {
  readonly color: Color;
  readonly count: number;
  /** Particle diameter in metres. */
  readonly size: number;
  readonly life: number;
  readonly rise: number;
  readonly gravity: number;
}

/**
 * Per-surface behaviour. Dry sand hangs and drifts, water is thrown hard and
 * dies fast, and turf is heavy and barely leaves the ground. Reading the
 * surface from the debris alone is the point.
 */
const SURFACE_STYLES: Record<WorldSurface, SurfaceStyle> = {
  grass: {
    color: new Color("#6f7d43"),
    count: 3,
    size: 0.05,
    life: 0.5,
    rise: 1.5,
    gravity: 7.5,
  },
  sand: {
    color: PALETTE.sandDry.clone().lerp(new Color("#ffffff"), 0.12),
    count: 6,
    size: 0.1,
    life: 0.95,
    rise: 1.7,
    gravity: 2.6,
  },
  rock: {
    color: PALETTE.rockLight.clone().lerp(new Color("#ffffff"), 0.2),
    count: 3,
    size: 0.06,
    life: 0.6,
    rise: 1.9,
    gravity: 6.5,
  },
  streambed: {
    // Damp earth, not standing water: the stream bed is rendered as a dark cut
    // in the ground, and throwing white foam off dry-looking dirt would read
    // as a bug rather than as a crossing.
    color: PALETTE.streambed.clone().lerp(new Color("#ffffff"), 0.18),
    count: 4,
    size: 0.07,
    life: 0.65,
    rise: 2.1,
    gravity: 7,
  },
};

/**
 * Used wherever the hoof lands at or below the water line, whichever surface
 * the world runtime classifies underneath. The shore shelf and the ford are
 * both wet ground over sand and streambed respectively, and both should throw
 * water.
 */
const WATER_STYLE: SurfaceStyle = {
  color: PALETTE.foam.clone(),
  count: 8,
  size: 0.09,
  life: 0.5,
  rise: 3.1,
  gravity: 9.5,
};

export function createHoofContacts(): HoofContacts {
  const positions = new Float32Array(CAPACITY * 3);
  const colors = new Float32Array(CAPACITY * 3);
  const sizes = new Float32Array(CAPACITY);
  const lives = new Float32Array(CAPACITY);
  const velocities = new Float32Array(CAPACITY * 3);
  const decay = new Float32Array(CAPACITY);
  const gravity = new Float32Array(CAPACITY);

  const geometry = new BufferGeometry();
  const positionAttribute = new BufferAttribute(positions, 3);
  const colorAttribute = new BufferAttribute(colors, 3);
  const sizeAttribute = new BufferAttribute(sizes, 1);
  const lifeAttribute = new BufferAttribute(lives, 1);
  positionAttribute.setUsage(DynamicDrawUsage);
  lifeAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("aColor", colorAttribute);
  geometry.setAttribute("aSize", sizeAttribute);
  geometry.setAttribute("aLife", lifeAttribute);

  const material = new ShaderMaterial({
    uniforms: { uPixelsPerMetre: { value: 750 } },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
  });

  const points = new Points(geometry, material);
  points.name = "hoof-contacts";
  points.frustumCulled = false;
  // Drawn after the world so debris reads in front of the grass it came from.
  points.renderOrder = 5;

  let cursor = 0;
  let live = 0;

  function spawn(
    x: number,
    y: number,
    z: number,
    style: SurfaceStyle,
    energy: number,
    forwardX: number,
    forwardZ: number,
  ): void {
    const index = cursor;
    cursor = (cursor + 1) % CAPACITY;
    if (lives[index]! <= 0) live += 1;

    // Deterministic jitter from the ring cursor. No Math.random, so a replay of
    // the same run produces the same debris.
    const a = Math.sin(index * 12.9898) * 43758.5453;
    const b = Math.sin(index * 78.233) * 12345.6789;
    const c = Math.sin(index * 39.425) * 24634.6345;
    const jitterX = (a - Math.floor(a)) * 2 - 1;
    const jitterZ = (b - Math.floor(b)) * 2 - 1;
    const jitterUp = c - Math.floor(c);

    positions[index * 3] = x + jitterX * 0.22;
    positions[index * 3 + 1] = y + 0.05;
    positions[index * 3 + 2] = z + jitterZ * 0.22;

    // Debris is kicked backwards along travel, which is the direction that
    // makes a gallop read as a gallop rather than as a smoke machine.
    const kick = energy * (0.9 + jitterUp * 0.7);
    velocities[index * 3] = -forwardX * kick + jitterX * 0.8;
    velocities[index * 3 + 1] = style.rise * (0.55 + jitterUp * 0.75) * energy;
    velocities[index * 3 + 2] = -forwardZ * kick + jitterZ * 0.8;

    colors[index * 3] = style.color.r;
    colors[index * 3 + 1] = style.color.g;
    colors[index * 3 + 2] = style.color.b;

    sizes[index] = style.size * (0.6 + jitterUp * 0.7);
    lives[index] = 1;
    decay[index] = 1 / style.life;
    gravity[index] = style.gravity;
  }

  return {
    points,

    strike(x, y, z, surface, submerged, weight, speed, forwardX, forwardZ) {
      const style = submerged ? WATER_STYLE : SURFACE_STYLES[surface];
      const energy = Math.min(1.3, 0.25 + weight * 0.5 + (speed / 16) * 0.75);
      // A walking horse should barely disturb dry grass; a gallop should tear
      // it up. Scaling the count as well as the energy is what separates them.
      const count = Math.max(1, Math.round(style.count * (0.35 + energy * 0.85)));
      for (let index = 0; index < count; index += 1) {
        spawn(x, y, z, style, energy, forwardX, forwardZ);
      }
    },

    update(deltaSeconds, pixelsPerMetre) {
      material.uniforms.uPixelsPerMetre!.value = pixelsPerMetre;
      if (live === 0) {
        points.visible = false;
        return;
      }
      points.visible = true;
      const dt = Math.min(0.1, Math.max(0, deltaSeconds));
      let remaining = 0;

      for (let index = 0; index < CAPACITY; index += 1) {
        const life = lives[index]!;
        if (life <= 0) continue;

        const next = life - decay[index]! * dt;
        if (next <= 0) {
          lives[index] = 0;
          continue;
        }
        lives[index] = next;
        remaining += 1;

        velocities[index * 3 + 1] = velocities[index * 3 + 1]! - gravity[index]! * dt;
        // Air drag, so debris slows as it rises instead of flying flat.
        const drag = Math.max(0, 1 - 2.4 * dt);
        velocities[index * 3] = velocities[index * 3]! * drag;
        velocities[index * 3 + 2] = velocities[index * 3 + 2]! * drag;

        positions[index * 3] = positions[index * 3]! + velocities[index * 3]! * dt;
        positions[index * 3 + 1] =
          positions[index * 3 + 1]! + velocities[index * 3 + 1]! * dt;
        positions[index * 3 + 2] =
          positions[index * 3 + 2]! + velocities[index * 3 + 2]! * dt;
      }

      live = remaining;
      positionAttribute.needsUpdate = true;
      colorAttribute.needsUpdate = true;
      sizeAttribute.needsUpdate = true;
      lifeAttribute.needsUpdate = true;
    },

    liveCount() {
      return live;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
