import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshStandardMaterial,
} from "three";
import {
  STAGE_SHORE_RADIUS,
  stageHeightAt,
  stageStreamDepthAt,
} from "../../stage/horseLabStage";
import type { StageTerrainMesh } from "../../stage/stageTerrainMesh";
import { PALETTE } from "../palette";

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Tonal drift at two scales, both deliberately short.
 *
 * An earlier version used a 170-metre wavelength, which on a 220-metre plot is
 * not texture at all: it painted one pale swathe straight across the world that
 * read as a fog bank sitting on the grass. Keeping both scales well under the
 * size of the stage makes the same variation read as ground.
 */
function variation(x: number, z: number): number {
  const broad = Math.sin(x * 0.13 + 2.1) * Math.cos(z * 0.11 - 1.2);
  const fine = Math.sin(x * 0.37 + z * 0.19) * Math.cos(z * 0.29 - x * 0.11);
  return broad * 0.62 + fine * 0.38;
}

/**
 * Surface colour is derived from slope, height, and shore distance rather than
 * painted by hand, so the ground always tells the truth about itself: anything
 * the horse cannot climb turns rock-grey before the player reaches it.
 */
export function createTerrainVisual(terrain: StageTerrainMesh): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(terrain.positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(terrain.normals, 3));
  geometry.setIndex(new BufferAttribute(terrain.indices, 1));

  const vertexCount = terrain.positions.length / 3;
  const colors = new Float32Array(vertexCount * 3);
  const scratch = new Color();
  const scratchRock = new Color();

  for (let index = 0; index < vertexCount; index += 1) {
    const offset = index * 3;
    const x = terrain.positions[offset] ?? 0;
    const height = terrain.positions[offset + 1] ?? 0;
    const z = terrain.positions[offset + 2] ?? 0;
    const normalY = terrain.normals[offset + 1] ?? 1;
    const slopeDegrees = (Math.acos(Math.min(1, Math.max(-1, normalY))) * 180) / Math.PI;
    const radius = Math.hypot(x, z);
    const noise = variation(x, z);

    // Grass base: damp and rich in hollows, dry and pale on exposed rises.
    // Height leads; noise only breaks the banding. Letting noise dominate turns
    // elevation-driven colour into arbitrary patches.
    const dryness = smoothstep(0.8, 6.5, height + noise * 1.1);
    scratch.copy(PALETTE.grassRich).lerp(PALETTE.grassMid, smoothstep(-0.6, 1.8, height));
    scratch.lerp(PALETTE.grassDry, dryness * 0.8);
    scratch.lerp(PALETTE.grassShadow, smoothstep(0.2, -1.6, height) * 0.45);

    // Beach.
    const beach = smoothstep(STAGE_SHORE_RADIUS - 10, STAGE_SHORE_RADIUS + 8, radius);
    const wetness = smoothstep(0.6, -0.9, height);
    scratch.lerp(
      wetness > 0.5 ? PALETTE.sandWet : PALETTE.sandDry,
      beach * (0.55 + 0.45 * (1 - smoothstep(0.2, 2.6, height))),
    );

    // Rock takes over on steep ground: unclimbable slopes must never look
    // inviting. Blended rather than picked, so banks do not speckle.
    const rock = smoothstep(23, 33, slopeDegrees);
    scratchRock.copy(PALETTE.rockDark).lerp(PALETTE.rockLight, (noise + 1) * 0.5);
    scratch.lerp(scratchRock, rock * 0.92);

    // The stream trench is applied last and keyed off its own depth field.
    // Its walls are steep enough to classify as rock, and grey rock walls made
    // the cut read as a pale ridge instead of as a hole to jump. Damp silt is
    // both the truthful material and the one that reads as depth.
    const trench = Math.min(1, stageStreamDepthAt(x, z) / 1.6);
    scratch.lerp(PALETTE.streambed, trench * 0.9);

    // Cheap ambient occlusion for the trench: less light reaches the bottom of
    // a cut, and the darkening is what sells it as depth.
    scratch.offsetHSL(noise * 0.005, noise * 0.012, noise * 0.019 - trench * 0.07);

    colors[offset] = scratch.r;
    colors[offset + 1] = scratch.g;
    colors[offset + 2] = scratch.b;
  }

  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = "stage-terrain";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

/** Convenience for placing anything that should sit on the ground. */
export function groundHeight(x: number, z: number): number {
  return stageHeightAt(x, z);
}
