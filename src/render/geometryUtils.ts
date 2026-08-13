import { BufferAttribute, BufferGeometry, Matrix4, Vector3 } from "three";

/**
 * Minimal non-indexed geometry merge. Three ships a fuller utility in its
 * examples directory; a local twenty-line version keeps the runtime dependency
 * surface at exactly `three` and avoids example-path resolution differences
 * between the dev server and the production build.
 */
export function mergeGeometries(
  parts: ReadonlyArray<{ geometry: BufferGeometry; matrix?: Matrix4 }>,
): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const normalMatrixScratch = new Matrix4();
  const vector = new Vector3();

  for (const part of parts) {
    const source = part.geometry.index
      ? part.geometry.toNonIndexed()
      : part.geometry;
    const position = source.getAttribute("position");
    const normal = source.getAttribute("normal");
    const matrix = part.matrix ?? new Matrix4();
    normalMatrixScratch.copy(matrix);
    normalMatrixScratch.setPosition(0, 0, 0);

    for (let index = 0; index < position.count; index += 1) {
      vector.fromBufferAttribute(position, index).applyMatrix4(matrix);
      positions.push(vector.x, vector.y, vector.z);

      vector.fromBufferAttribute(normal, index).applyMatrix4(normalMatrixScratch);
      vector.normalize();
      normals.push(vector.x, vector.y, vector.z);
    }

    if (source !== part.geometry) source.dispose();
  }

  const merged = new BufferGeometry();
  merged.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  merged.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  merged.computeBoundingSphere();
  return merged;
}

/** Pushes vertices around deterministically so primitives stop reading as primitives. */
export function roughenGeometry(
  geometry: BufferGeometry,
  amount: number,
  seed = 1,
): BufferGeometry {
  const position = geometry.getAttribute("position") as BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const noise = Math.sin((x * 12.9 + y * 78.2 + z * 37.7) * seed) * 43_758.5;
    const jitter = (noise - Math.floor(noise)) * 2 - 1;
    position.setXYZ(
      index,
      x * (1 + jitter * amount),
      y * (1 + jitter * amount * 0.6),
      z * (1 - jitter * amount),
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
