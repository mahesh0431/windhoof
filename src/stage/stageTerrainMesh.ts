import {
  STAGE_CELL_SIZE,
  STAGE_HALF_EXTENT,
  stageHeightAt,
  stageNormalAt,
} from "./horseLabStage";

export interface StageTerrainMesh {
  readonly segments: number;
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
  readonly triangleCount: number;
}

/**
 * One vertex buffer, two consumers: the Three.js terrain mesh and the Rapier
 * trimesh collider. Deriving both from the same samples is what stops the
 * visible ground and the collidable ground from drifting apart, which is the
 * failure the WorldClaw method's explicit-representation rule guards against.
 */
export function buildStageTerrainMesh(): StageTerrainMesh {
  const segments = (STAGE_HALF_EXTENT * 2) / STAGE_CELL_SIZE;
  const side = segments + 1;
  const vertexCount = side * side;

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(segments * segments * 6);

  for (let iz = 0; iz < side; iz += 1) {
    const z = -STAGE_HALF_EXTENT + iz * STAGE_CELL_SIZE;
    for (let ix = 0; ix < side; ix += 1) {
      const x = -STAGE_HALF_EXTENT + ix * STAGE_CELL_SIZE;
      const offset = (iz * side + ix) * 3;
      const height = stageHeightAt(x, z);
      const normal = stageNormalAt(x, z);

      positions[offset] = x;
      positions[offset + 1] = height;
      positions[offset + 2] = z;
      normals[offset] = normal.x;
      normals[offset + 1] = normal.y;
      normals[offset + 2] = normal.z;
    }
  }

  let cursor = 0;
  for (let iz = 0; iz < segments; iz += 1) {
    for (let ix = 0; ix < segments; ix += 1) {
      const a = iz * side + ix;
      const b = a + 1;
      const c = a + side;
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

  return {
    segments,
    positions,
    normals,
    indices,
    triangleCount: indices.length / 3,
  };
}
