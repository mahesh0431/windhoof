import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  type BufferGeometry,
} from "three";
import type { PlacedProp } from "../../stage/stageWorld";
import { mergeGeometries, roughenGeometry } from "../geometryUtils";
import { PALETTE } from "../palette";

/**
 * Every repeated prop family is one instanced draw call. At the milestone's
 * prop count that keeps the whole scenery layer inside single-digit draw calls,
 * which leaves the frame budget to the horse and the terrain where it belongs.
 */
export function createPropsVisual(props: readonly PlacedProp[]): Group {
  const group = new Group();
  group.name = "stage-props";

  // Every family's colour comes from its per-instance tint. Instance colour
  // multiplies the material colour, so a material tinted brown and then given a
  // brown instance colour renders as near-black: leave the base white.
  const rockMaterial = new MeshStandardMaterial({ roughness: 0.94, metalness: 0 });
  const trunkMaterial = new MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
  const canopyMaterial = new MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
  const shrubMaterial = new MeshStandardMaterial({ roughness: 0.95, metalness: 0 });

  const rocks = props.filter((prop) => prop.kind === "rock");
  const boulders = props.filter((prop) => prop.kind === "boulder");
  const logs = props.filter((prop) => prop.kind === "log");
  const trees = props.filter((prop) => prop.kind === "tree");
  const shrubs = props.filter((prop) => prop.kind === "shrub");

  addFamily(group, rocks, rockGeometry(), rockMaterial, {
    baseScale: 0.62,
    lift: 0.22,
    tint: [PALETTE.rockDark, PALETTE.rockLight],
    castShadow: true,
  });

  addFamily(group, boulders, boulderGeometry(), rockMaterial.clone(), {
    baseScale: 1.5,
    lift: 0.95,
    tint: [PALETTE.rockDark, PALETTE.rockLight],
    castShadow: true,
  });

  addFamily(group, logs, logGeometry(), trunkMaterial, {
    baseScale: 1,
    lift: 0.42,
    tint: [PALETTE.trunkShade, PALETTE.trunk],
    castShadow: true,
  });

  addFamily(group, trees, trunkGeometry(), trunkMaterial.clone(), {
    baseScale: 1,
    lift: 0,
    tint: [PALETTE.trunkShade, PALETTE.trunk],
    castShadow: true,
  });

  addFamily(group, trees, canopyGeometry(), canopyMaterial, {
    baseScale: 1,
    lift: 0,
    tint: [PALETTE.canopyDark, PALETTE.canopyLight],
    castShadow: true,
  });

  addFamily(group, shrubs, shrubGeometry(), shrubMaterial, {
    baseScale: 1,
    lift: 0.1,
    tint: [PALETTE.canopyDark, PALETTE.shrub],
    castShadow: false,
  });

  return group;
}

interface FamilyOptions {
  readonly baseScale: number;
  readonly lift: number;
  readonly tint: readonly [Color, Color];
  readonly castShadow: boolean;
}

function addFamily(
  group: Group,
  props: readonly PlacedProp[],
  geometry: BufferGeometry,
  material: MeshStandardMaterial,
  options: FamilyOptions,
): void {
  if (props.length === 0) {
    geometry.dispose();
    return;
  }

  const mesh = new InstancedMesh(geometry, material, props.length);
  mesh.castShadow = options.castShadow;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const axis = new Vector3(0, 1, 0);
  const tint = new Color();

  props.forEach((prop, index) => {
    position.set(prop.x, prop.y + options.lift * prop.scale, prop.z);
    quaternion.setFromAxisAngle(axis, prop.yaw);
    const size = options.baseScale * prop.scale;
    scale.set(size, size * (0.85 + ((index * 37) % 11) * 0.03), size);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);

    const mix = ((index * 53) % 17) / 16;
    tint.copy(options.tint[0]).lerp(options.tint[1], mix);
    mesh.setColorAt(index, tint);
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  group.add(mesh);
}

function rockGeometry(): BufferGeometry {
  return roughenGeometry(new IcosahedronGeometry(1, 0), 0.3, 3.1);
}

function boulderGeometry(): BufferGeometry {
  return roughenGeometry(new IcosahedronGeometry(1, 1), 0.22, 7.7);
}

function logGeometry(): BufferGeometry {
  const log = new CylinderGeometry(0.4, 0.46, 3.5, 9, 1);
  const lay = new Matrix4().makeRotationZ(Math.PI / 2);
  return mergeGeometries([{ geometry: log, matrix: lay }]);
}

function trunkGeometry(): BufferGeometry {
  const trunk = new CylinderGeometry(0.17, 0.3, 5.6, 8, 1);
  const lift = new Matrix4().makeTranslation(0, 2.8, 0);
  const lean = new Matrix4().makeRotationZ(0.05);
  return mergeGeometries([{ geometry: trunk, matrix: lean.multiply(lift) }]);
}

/**
 * Canopies are three offset blobs rather than one sphere. The broken silhouette
 * is what makes a tree readable against the sky at gallop speed, and it gives
 * the camera obstruction probe something with an honest shape to find.
 */
function canopyGeometry(): BufferGeometry {
  const blob = () => roughenGeometry(new IcosahedronGeometry(1, 1), 0.16, 5.3);
  return mergeGeometries([
    {
      geometry: blob(),
      matrix: new Matrix4()
        .makeTranslation(0.1, 6.2, -0.15)
        .multiply(new Matrix4().makeScale(2.5, 1.7, 2.4)),
    },
    {
      geometry: blob(),
      matrix: new Matrix4()
        .makeTranslation(-1.5, 5.2, 0.9)
        .multiply(new Matrix4().makeScale(1.7, 1.25, 1.7)),
    },
    {
      geometry: blob(),
      matrix: new Matrix4()
        .makeTranslation(1.4, 5.5, 0.7)
        .multiply(new Matrix4().makeScale(1.5, 1.15, 1.5)),
    },
  ]);
}

function shrubGeometry(): BufferGeometry {
  const tuft = (x: number, z: number, height: number, radius: number) => ({
    geometry: new ConeGeometry(radius, height, 6, 1),
    matrix: new Matrix4().makeTranslation(x, height * 0.5, z),
  });
  return mergeGeometries([
    tuft(0, 0, 0.95, 0.45),
    tuft(0.38, 0.2, 0.7, 0.34),
    tuft(-0.32, -0.24, 0.62, 0.3),
    tuft(0.1, -0.4, 0.5, 0.26),
  ]);
}
