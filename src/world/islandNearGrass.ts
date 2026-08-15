import {
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from "three";
import type { WorldManifest } from "../game/world/compiler/worldTypes";
import {
  applyGrassWind,
  createTuftGeometry,
  createWindUniforms,
  type WindUniforms,
} from "./grassBlades";
import { ROUTE_DISTANCE_CAP, type IslandField } from "./islandField";
import { regionStyleFor, scatterDensityFor, terrainFamilyFor } from "./regionVisuals";

/**
 * The carpet the player is actually standing in.
 *
 * The island-wide cover layer is a scatter: it has to hold every square metre
 * of a 1,024-metre island inside one instance ceiling, so it can only ever be
 * about half a tuft per square metre. That is the right density for the middle
 * distance and it is nowhere near enough underfoot, where the eye reads
 * individual plants and bare ground between them reads as bare ground.
 *
 * Solving that by raising the island-wide density does not work: the ceiling
 * exists because the whole island is built up front, and multiplying it costs
 * hundreds of megabytes of instance matrices for grass nobody is standing in.
 *
 * So the near field is built the other way round. A small window of patches
 * follows the player, and a patch is refilled from a hash of its own cell the
 * moment it falls outside the window - the same grass grows in the same place
 * every time anyone stands there, without any of it existing until they do. The
 * window is about sixty metres, which is where an individual tuft stops being
 * resolvable and the scatter layer takes over.
 */

export interface IslandNearGrass {
  readonly group: Group;
  /** Patches in the window, whether or not they currently hold grass. */
  readonly patchCount: number;
  /** Blades in one full patch, so the cost is inspectable. */
  readonly patchCapacity: number;
  setFocus(x: number, z: number): void;
  setTime(seconds: number): void;
  /** Blades currently standing in the window, for diagnostics and budgets. */
  liveBlades(): number;
  /** Patches still waiting to be filled. Non-zero only just after a move. */
  pendingPatches(): number;
  dispose(): void;
}

/** Metres per patch. One patch is one instanced mesh and one cull decision. */
const PATCH_METRES = 18;
/**
 * Patches per edge of the window. Odd, so the player stands in the middle one.
 *
 * Three rather than five: a patch is a draw call, and twenty-five of them put
 * the island over its draw-call budget while riding. Nine larger patches cover
 * the same seventy metres for a third of the calls, and a patch being larger
 * costs only the grass at its corners being kept a little longer than it needs
 * to be.
 */
const PATCHES_PER_EDGE = 5;
/**
 * Candidate tufts per square metre, before the region's own density.
 *
 * Density and window size trade against each other at a fixed triangle budget,
 * and they are not worth the same. A hundred-metre window at 3.6 was a field
 * with bare ground showing between every sprig; a seventy-metre window at 8.5
 * costs about the same and is a carpet. The far scatter is what carries the
 * distance, and it always was - the near window only ever had to cover the
 * range where an eye resolves one plant from the next.
 */
const BASE_DENSITY = 11;
/**
 * Patches refilled per frame.
 *
 * At a gallop a whole row leaves the window every second and a half. Refilling
 * them in the frame that notices is a visible hitch; refilling two per frame
 * clears a row in well under the time it takes to cross the next patch.
 */
const REFILLS_PER_FRAME = 3;

interface Patch {
  readonly mesh: InstancedMesh;
  /** Cell coordinates, or null when the patch has never been filled. */
  cellX: number;
  cellZ: number;
  filled: boolean;
}

export function createIslandNearGrass(
  manifest: WorldManifest,
  field: IslandField,
): IslandNearGrass {
  const group = new Group();
  group.name = "island-near-grass";

  const capacity = Math.ceil(PATCH_METRES * PATCH_METRES * BASE_DENSITY * 1.6);

  // Four blades rather than three: this is the layer seen from two metres, and
  // the fourth blade is what stops a tuft reading as a triangle when the player
  // is standing over it.
  const geometry = createTuftGeometry(
    // Narrow. A blade whose base is a third of the clump's radius is a leaf: the
    // first pass made these and a field of them read as aloe, not grass.
    // Three blades, not four. At the size these are drawn a fourth blade is a
    // triangle nobody can resolve, and it is a quarter of the layer's cost.
    { blades: 3, width: 0.16, splay: 0.76, rootShade: 0.4 },
    3,
  );
  const wind: WindUniforms = createWindUniforms(0.1, 0.065, 1, 2.4);
  // Instance colour multiplies the material colour, so the base stays white.
  const material = new MeshStandardMaterial({
    roughness: 0.95,
    metalness: 0,
    // A blade has no back: without this, half of every tuft is unlit black
    // whenever the sun is on the other side of it.
    side: DoubleSide,
    vertexColors: true,
  });
  applyGrassWind(material, wind);

  const familyByRegion = field.regionIds.map((id) => terrainFamilyFor(manifest, id));
  const densityByRegion = field.regionIds.map((id) => scatterDensityFor(manifest, id));
  const styleByRegion = field.regionIds.map((id) => regionStyleFor(id));
  const tintsByRegion = styleByRegion.map((style) =>
    style.coverTints.map(([r, g, b]) => new Color(r, g, b)),
  );

  const safeRouteHalfWidth = Math.max(
    3,
    ...manifest.routes
      .filter((route) => route.kind === "safe")
      .map((route) => route.widthMeters * 0.5),
  );

  const patches: Patch[] = [];
  for (let index = 0; index < PATCHES_PER_EDGE * PATCHES_PER_EDGE; index += 1) {
    const mesh = new InstancedMesh(geometry, material, capacity);
    mesh.name = `near-grass-${index}`;
    // Same reasoning as the scatter layer: tens of thousands of blades in the
    // shadow pass costs a great deal and changes almost nothing.
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.visible = false;
    mesh.count = 0;
    group.add(mesh);
    patches.push({ mesh, cellX: Number.NaN, cellZ: Number.NaN, filled: false });
  }

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const axis = new Vector3();
  const pending: Patch[] = [];
  let wantedCellX = Number.NaN;
  let wantedCellZ = Number.NaN;
  let primed = false;

  /** Fills one patch from the deterministic hash of its own cell. */
  const fill = (patch: Patch): void => {
    const originX = patch.cellX * PATCH_METRES;
    const originZ = patch.cellZ * PATCH_METRES;
    let count = 0;

    // A jittered grid rather than free scatter: even coverage with no clumping,
    // for a fifth of the candidates a Poisson pass would need.
    const perEdge = Math.round(Math.sqrt(capacity / 1.6));
    const step = PATCH_METRES / perEdge;

    for (let row = 0; row < perEdge && count < capacity; row += 1) {
      for (let column = 0; column < perEdge && count < capacity; column += 1) {
        const noise = hash3(
          manifest.seed,
          patch.cellX * perEdge + column,
          patch.cellZ * perEdge + row,
          7,
        );
        const a = (noise & 0xff) / 255;
        const b = ((noise >>> 8) & 0xff) / 255;
        const c = ((noise >>> 16) & 0xff) / 255;
        const d = ((noise >>> 24) & 0xff) / 255;

        const x = originX + (column + a) * step;
        const z = originZ + (row + b) * step;

        const sampleX = clampIndex(
          Math.round((x + field.halfMeters) / field.spacing),
          field.gridSize,
        );
        const sampleZ = clampIndex(
          Math.round((z + field.halfMeters) / field.spacing),
          field.gridSize,
        );
        const sample = sampleZ * field.gridSize + sampleX;

        // Everything below is the scatter layer's own rule, applied per blade
        // rather than per three-metre cell: nothing below the tide line, nothing
        // on rock a horse could not climb, and nothing on the worn line itself.
        const shore = field.shoreDistance[sample] ?? 0;
        if (shore < 5) continue;
        const slope = field.slopeDegrees[sample] ?? 0;
        if (slope > 52) continue;
        const routeDistance = field.routeDistance[sample] ?? ROUTE_DISTANCE_CAP;
        if (routeDistance < safeRouteHalfWidth * 0.5) continue;

        const regionIndex = field.regionIndex[sample] ?? 0;
        const style = styleByRegion[regionIndex] ?? regionStyleFor("");
        // A floor under every region.
        //
        // Density used to be purely the region's own number, so the thinner
        // regions had visible bare ground between sprigs while the plain was a
        // carpet - and bare ground next to thick grass reads as a patchy lawn,
        // not as different country. The region still decides how much *more*
        // than the floor it gets.
        const density = Math.max(
          0.85,
          (densityByRegion[regionIndex] ?? 0.5) * style.coverDensity * 1.7,
        );
        // The density multiplier thins the grid rather than moving it, so a
        // sparse region is the same field with blades missing from it.
        if (c > density) continue;

        // Gentler thinning. Grass grows on a bank and right down to the dune
        // line; the old falloffs stripped both and left the edges of every
        // region looking scalped.
        const slopeFalloff = slope > 40 ? 0.72 : 1;
        const shoreFalloff = shore < 12 ? 0.55 + (shore - 5) / 16 : 1;
        if (d > slopeFalloff * shoreFalloff) continue;

        const y = field.heightAt(x, z);
        if (y <= field.seaLevel + 0.4) continue;

        const family = familyByRegion[regionIndex] ?? "grassland";
        const heightRange = family === "woodland" ? 0.46 : family === "coastal" ? 0.34 : 0.62;
        const height = (0.22 + b * heightRange) * style.coverScale;
        const radius = (0.085 + a * 0.085) * style.coverScale;

        const palette = tintsByRegion[regionIndex];
        const tint = palette?.[noise % palette.length];
        if (!tint) continue;

        position.set(x, y, z);
        axis.set(Math.cos(a * Math.PI * 2), 0, Math.sin(a * Math.PI * 2)).normalize();
        quaternion.setFromAxisAngle(axis, (c - 0.5) * 0.3);
        scale.set(radius, height, radius);
        matrix.compose(position, quaternion, scale);
        patch.mesh.setMatrixAt(count, matrix);
        patch.mesh.setColorAt(count, tint);
        count += 1;
      }
    }

    patch.mesh.count = count;
    patch.mesh.visible = count > 0;
    patch.mesh.instanceMatrix.needsUpdate = true;
    if (patch.mesh.instanceColor) patch.mesh.instanceColor.needsUpdate = true;
    // The instance matrices carry world positions, so the mesh itself never
    // moves; without a recomputed bound the culler tests the wrong volume.
    patch.mesh.computeBoundingSphere();
    patch.filled = true;
  };

  return {
    group,
    patchCount: patches.length,
    patchCapacity: capacity,

    setFocus(x, z) {
      // The focus is the horse, so it is also what the grass gets out of the
      // way of. Y is left where it is: parting is a ground-plane effect.
      wind.parter.value.set(x, 0, z);
      const centreX = Math.floor(x / PATCH_METRES);
      const centreZ = Math.floor(z / PATCH_METRES);
      const reach = (PATCHES_PER_EDGE - 1) / 2;

      if (centreX !== wantedCellX || centreZ !== wantedCellZ) {
        wantedCellX = centreX;
        wantedCellZ = centreZ;
        pending.length = 0;

        // Which cells the window wants, and which patches are not already on
        // one of them. A patch that is still inside the window keeps its grass:
        // riding a straight line refills one row, not the whole window.
        const wanted = new Set<string>();
        for (let row = -reach; row <= reach; row += 1) {
          for (let column = -reach; column <= reach; column += 1) {
            wanted.add(`${centreX + column},${centreZ + row}`);
          }
        }
        const spare: Patch[] = [];
        for (const patch of patches) {
          const key = `${patch.cellX},${patch.cellZ}`;
          if (patch.filled && wanted.has(key)) wanted.delete(key);
          else spare.push(patch);
        }

        // Nearest cells first, so the grass the player is standing in arrives
        // before the grass at the edge of the window.
        const order = [...wanted]
          .map((key) => {
            const [cellX, cellZ] = key.split(",").map(Number);
            return { cellX: cellX ?? 0, cellZ: cellZ ?? 0 };
          })
          .sort(
            (left, right) =>
              Math.hypot(left.cellX - centreX, left.cellZ - centreZ) -
              Math.hypot(right.cellX - centreX, right.cellZ - centreZ),
          );

        order.forEach((cell, index) => {
          const patch = spare[index];
          if (!patch) return;
          patch.cellX = cell.cellX;
          patch.cellZ = cell.cellZ;
          patch.filled = false;
          patch.mesh.visible = false;
          pending.push(patch);
        });
      }

      // The first call is the spawn, and a player who lands on bare ground that
      // grows in over the next second has seen the trick. Every later call is
      // amortised, because by then there is a world to hide the work behind.
      const budget = primed ? REFILLS_PER_FRAME : pending.length;
      primed = true;
      for (let index = 0; index < budget; index += 1) {
        const patch = pending.shift();
        if (!patch) break;
        fill(patch);
      }
    },

    setTime(seconds) {
      wind.time.value = seconds;
    },

    liveBlades() {
      let total = 0;
      for (const patch of patches) if (patch.mesh.visible) total += patch.mesh.count;
      return total;
    },

    pendingPatches() {
      return pending.length;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
      for (const patch of patches) patch.mesh.dispose();
    },
  };
}

function clampIndex(value: number, size: number): number {
  return Math.min(size - 1, Math.max(0, value));
}

/** Deterministic 32-bit hash of three integers plus the world's own seed. */
function hash3(seed: number, x: number, z: number, salt: number): number {
  let value =
    (seed ^ Math.imul(x, 0x1f123bb5) ^ Math.imul(z, 0x5f356495) ^ Math.imul(salt, 0x27d4eb2d)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return value >>> 0;
}
