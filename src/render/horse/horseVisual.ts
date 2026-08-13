import {
  CapsuleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  SphereGeometry,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "../geometryUtils";
import { PALETTE } from "../palette";

/**
 * Placeholder horse, assembled procedurally from primitives in the browser.
 *
 * The art brief allows a reduced Milestone 1 set and forbids a Blender step, so
 * this rig exists to prove silhouette, scale, and gait readability rather than
 * to ship. It is built to real horse proportions (roughly 15 hands at the
 * withers) because the controller must be judged against a believable body,
 * and every joint the animator needs is a named Object3D so a sourced or
 * generated model can replace the geometry without touching the animation.
 *
 * The torso is deliberately NOT one rigid mesh. A horse's gallop is defined by
 * its back: the frame gathers and rounds as the hind legs swing under, then
 * lengthens and extends through suspension. A single welded body reads as a
 * crate on legs no matter how good the leg animation is, which is exactly the
 * failure the first blind playtest reported. The ribcage stays rigid, because
 * it is, and the two joints a horse actually bends at get their own pivots:
 * the shoulder sling in front and the lumbo-sacral coupling behind.
 *
 * Local space: origin at the hooves, +Z forward, +Y up.
 * Rotation sign: positive rotation.x pitches the front of a group DOWN.
 */
export interface HorseRig {
  readonly root: Group;
  /** Carries bob, pitch, roll, and ground conform. Everything below inherits it. */
  readonly body: Group;
  /**
   * Forequarters: chest, withers, neck, and both front legs. Rotating this
   * negatively lifts the front end, which is what a push-off and a rear look
   * like. Pivot sits at the shoulder sling.
   */
  readonly forehand: Group;
  /**
   * Hindquarters: croup, haunch, both hind legs, and the tail. Positive
   * rotation rounds the back (gathered, hocks under); negative extends it.
   * Pivot sits at the lumbo-sacral joint.
   */
  readonly spine: Group;
  readonly neck: Group;
  readonly head: Group;
  readonly earLeft: Group;
  readonly earRight: Group;
  readonly tail: readonly Group[];
  readonly mane: Group;
  readonly legs: readonly HorseLegRig[];
  dispose(): void;
}

export interface HorseLegRig {
  readonly id: "frontLeft" | "frontRight" | "rearLeft" | "rearRight";
  readonly isFront: boolean;
  /** Sign of the lateral offset; used for banking and stagger asymmetry. */
  readonly side: 1 | -1;
  readonly upper: Group;
  readonly lower: Group;
  readonly hoof: Group;
}

export const HORSE_WITHERS_HEIGHT = 1.55;
const SHOULDER_Y = 1.02;
const HIP_Y = 1.0;
const UPPER_LENGTH = 0.42;
const LOWER_LENGTH = 0.36;
const HOOF_LENGTH = 0.24;

/** Shoulder sling, in body space. */
const FOREHAND_PIVOT = { x: 0, y: 1.24, z: 0.34 } as const;
/** Lumbo-sacral coupling, in body space. */
const SPINE_PIVOT = { x: 0, y: 1.26, z: -0.34 } as const;

export function createHorseRig(): HorseRig {
  const materials = {
    coat: new MeshStandardMaterial({
      color: PALETTE.coat,
      roughness: 0.78,
      metalness: 0,
    }),
    shade: new MeshStandardMaterial({
      color: PALETTE.coatShade,
      roughness: 0.8,
      metalness: 0,
    }),
    points: new MeshStandardMaterial({
      color: PALETTE.points,
      roughness: 0.82,
      metalness: 0,
    }),
    mane: new MeshStandardMaterial({
      color: PALETTE.mane,
      roughness: 0.86,
      metalness: 0,
    }),
    hoof: new MeshStandardMaterial({
      color: PALETTE.hoof,
      roughness: 0.78,
      metalness: 0,
    }),
    blaze: new MeshStandardMaterial({
      color: PALETTE.blaze,
      roughness: 0.8,
      metalness: 0,
    }),
    muzzle: new MeshStandardMaterial({
      color: PALETTE.muzzle,
      roughness: 0.82,
      metalness: 0,
    }),
  };

  const disposables: BufferGeometry[] = [];
  const track = <T extends BufferGeometry>(geometry: T): T => {
    disposables.push(geometry);
    return geometry;
  };

  const root = new Group();
  root.name = "horse-root";

  const body = new Group();
  body.name = "horse-body";
  root.add(body);

  const forehand = new Group();
  forehand.name = "horse-forehand";
  forehand.position.set(FOREHAND_PIVOT.x, FOREHAND_PIVOT.y, FOREHAND_PIVOT.z);
  body.add(forehand);

  const spine = new Group();
  spine.name = "horse-spine";
  spine.position.set(SPINE_PIVOT.x, SPINE_PIVOT.y, SPINE_PIVOT.z);
  body.add(spine);

  /** Converts a body-space position into a pivot's local space. */
  const local = (
    pivot: { x: number; y: number; z: number },
    x: number,
    y: number,
    z: number,
  ): [number, number, number] => [x - pivot.x, y - pivot.y, z - pivot.z];

  // --- Ribcage -----------------------------------------------------------
  // Rigid on purpose: a horse's thorax does not bend. It is long enough at both
  // ends to stay inside the moving chest and haunch shells at full flexion, so
  // the articulation never opens a visible seam.
  const barrel = new Mesh(
    track(
      mergeGeometries([
        {
          geometry: new CapsuleGeometry(0.4, 0.72, 4, 12),
          matrix: new Matrix4()
            .makeTranslation(0, 1.24, -0.02)
            .multiply(new Matrix4().makeRotationX(Math.PI / 2))
            .multiply(new Matrix4().makeScale(0.86, 1, 1.06)),
        },
      ]),
    ),
    materials.coat,
  );
  barrel.castShadow = true;
  barrel.receiveShadow = true;
  body.add(barrel);

  // --- Forequarters ------------------------------------------------------
  const forequarters = new Mesh(
    track(
      mergeGeometries([
        {
          // Chest, deeper and wider at the front.
          geometry: new SphereGeometry(0.44, 14, 10),
          matrix: new Matrix4()
            .makeTranslation(...local(FOREHAND_PIVOT, 0, 1.2, 0.62))
            .multiply(new Matrix4().makeScale(0.82, 1.02, 0.9)),
        },
        {
          // Withers ridge.
          geometry: new SphereGeometry(0.26, 10, 8),
          matrix: new Matrix4()
            .makeTranslation(...local(FOREHAND_PIVOT, 0, 1.46, 0.44))
            .multiply(new Matrix4().makeScale(0.7, 0.7, 1.5)),
        },
        {
          // Shoulder mass, so the coupling with the ribcage stays filled while
          // the forehand rotates.
          geometry: new SphereGeometry(0.38, 12, 9),
          matrix: new Matrix4()
            .makeTranslation(...local(FOREHAND_PIVOT, 0, 1.24, 0.3))
            .multiply(new Matrix4().makeScale(0.88, 1, 0.85)),
        },
      ]),
    ),
    materials.coat,
  );
  forequarters.castShadow = true;
  forequarters.receiveShadow = true;
  forehand.add(forequarters);

  // --- Hindquarters ------------------------------------------------------
  const hindquarters = new Mesh(
    track(
      mergeGeometries([
        {
          geometry: new SphereGeometry(0.46, 14, 10),
          matrix: new Matrix4()
            .makeTranslation(...local(SPINE_PIVOT, 0, 1.24, -0.72))
            .multiply(new Matrix4().makeScale(0.88, 1.0, 0.94)),
        },
        {
          // Point of croup. A horse seen from behind at speed is mostly this
          // shape rising and falling, so it gets its own mass.
          geometry: new SphereGeometry(0.3, 12, 9),
          matrix: new Matrix4()
            .makeTranslation(...local(SPINE_PIVOT, 0, 1.4, -0.5))
            .multiply(new Matrix4().makeScale(0.82, 0.72, 1.25)),
        },
        {
          // Loin, filling forward to overlap the ribcage.
          geometry: new SphereGeometry(0.37, 12, 9),
          matrix: new Matrix4()
            .makeTranslation(...local(SPINE_PIVOT, 0, 1.26, -0.28))
            .multiply(new Matrix4().makeScale(0.86, 1, 0.9)),
        },
      ]),
    ),
    materials.coat,
  );
  hindquarters.castShadow = true;
  hindquarters.receiveShadow = true;
  spine.add(hindquarters);

  // --- Neck and head -----------------------------------------------------
  const neck = new Group();
  neck.name = "horse-neck";
  neck.position.set(...local(FOREHAND_PIVOT, 0, 1.4, 0.62));
  // Positive pitch leans the neck up and FORWARD out of the withers, which is
  // how a horse is built. The animator drives this value from here.
  neck.rotation.x = 0.7;
  forehand.add(neck);

  const neckMesh = new Mesh(
    track(
      mergeGeometries([
        {
          geometry: new CylinderGeometry(0.19, 0.31, 0.72, 10, 1),
          matrix: new Matrix4()
            .makeTranslation(0, 0.36, 0)
            .multiply(new Matrix4().makeScale(0.82, 1, 1)),
        },
      ]),
    ),
    materials.coat,
  );
  neckMesh.castShadow = true;
  neck.add(neckMesh);

  const head = new Group();
  head.name = "horse-head";
  head.position.set(0, 0.72, 0);
  head.rotation.x = -0.6; // level the head against the neck angle
  neck.add(head);

  const skull = new Mesh(
    track(
      mergeGeometries([
        {
          // Cheek and jaw.
          geometry: new SphereGeometry(0.17, 12, 9),
          matrix: new Matrix4()
            .makeTranslation(0, 0.06, 0.02)
            .multiply(new Matrix4().makeScale(0.82, 1.0, 1.05)),
        },
        {
          // Muzzle taper. A horse is unmistakable from the side because of
          // this long straight nasal bone, so it gets its own segment.
          geometry: new CylinderGeometry(0.105, 0.145, 0.44, 9, 1),
          matrix: new Matrix4()
            .makeTranslation(0, 0.12, 0.28)
            .multiply(new Matrix4().makeRotationX(Math.PI / 2))
            .multiply(new Matrix4().makeScale(0.86, 1, 1)),
        },
      ]),
    ),
    materials.coat,
  );
  skull.castShadow = true;
  head.add(skull);

  const nose = new Mesh(track(new SphereGeometry(0.115, 10, 8)), materials.muzzle);
  nose.position.set(0, 0.115, 0.48);
  nose.scale.set(0.88, 0.86, 0.8);
  head.add(nose);

  const blaze = new Mesh(track(new CapsuleGeometry(0.035, 0.3, 3, 6)), materials.blaze);
  blaze.position.set(0, 0.21, 0.26);
  blaze.rotation.x = Math.PI / 2 - 0.12;
  blaze.scale.set(1, 1, 0.4);
  head.add(blaze);

  const eyeGeometry = track(new SphereGeometry(0.036, 8, 6));
  for (const side of [-1, 1] as const) {
    const eye = new Mesh(eyeGeometry, materials.points);
    eye.position.set(side * 0.125, 0.13, 0.1);
    head.add(eye);
  }

  const earGeometry = track(new ConeGeometry(0.052, 0.17, 6, 1));
  const earLeft = new Group();
  earLeft.name = "horse-ear-left";
  earLeft.position.set(-0.09, 0.19, -0.06);
  const earLeftMesh = new Mesh(earGeometry, materials.coat);
  earLeftMesh.position.y = 0.085;
  earLeft.add(earLeftMesh);
  head.add(earLeft);

  const earRight = new Group();
  earRight.name = "horse-ear-right";
  earRight.position.set(0.09, 0.19, -0.06);
  const earRightMesh = new Mesh(earGeometry, materials.coat);
  earRightMesh.position.y = 0.085;
  earRight.add(earRightMesh);
  head.add(earRight);

  // --- Mane --------------------------------------------------------------
  const mane = new Group();
  mane.name = "horse-mane";
  neck.add(mane);

  // Overlapping locks laid along the crest. Spaced apart they read as a row of
  // beads; overlapped they read as one falling mane.
  //
  // Each lock hangs from a pivot on the crest rather than being a capsule
  // rotated about its own centre. Rotating the centre made every lock stick out
  // an equal distance both ways, so the mane read as a dorsal fin standing off
  // the neck instead of hair falling along it.
  const maneGeometry = track(new CapsuleGeometry(0.055, 0.26, 3, 6));
  for (let index = 0; index < 9; index += 1) {
    const t = index / 8;
    const lock = new Group();
    lock.position.set(0, 0.1 + t * 0.62, -0.17 - t * 0.02);
    // Falls down the crest and trails back; the animator adds more trail with
    // speed on top of this.
    lock.rotation.x = -1.05 - t * 0.35;
    const lockMesh = new Mesh(maneGeometry, materials.mane);
    lockMesh.position.y = -0.14;
    lockMesh.scale.set(1.4, 0.95 + (1 - t) * 0.45, 0.8);
    lock.add(lockMesh);
    mane.add(lock);
  }

  const forelock = new Group();
  forelock.position.set(0, 0.21, 0.04);
  forelock.rotation.x = -0.9;
  const forelockMesh = new Mesh(maneGeometry, materials.mane);
  forelockMesh.position.y = -0.09;
  forelockMesh.scale.set(1.1, 0.6, 0.55);
  forelock.add(forelockMesh);
  head.add(forelock);

  // --- Tail --------------------------------------------------------------
  // Hung from the spine group, so a rounded back carries the dock with it.
  const tailSegments: Group[] = [];
  const tailGeometry = track(new CapsuleGeometry(0.09, 0.22, 4, 8));
  let tailParent: Object3D = spine;
  for (let index = 0; index < 3; index += 1) {
    const segment = new Group();
    segment.name = `horse-tail-${index}`;
    if (index === 0) {
      segment.position.set(...local(SPINE_PIVOT, 0, 1.36, -1.08));
      segment.rotation.x = 0.85;
    } else {
      segment.position.set(0, -0.26, 0);
      segment.rotation.x = 0.18;
    }
    const mesh = new Mesh(tailGeometry, materials.mane);
    mesh.position.y = -0.13;
    mesh.scale.setScalar(1 - index * 0.16);
    mesh.castShadow = true;
    segment.add(mesh);
    tailParent.add(segment);
    tailParent = segment;
    tailSegments.push(segment);
  }

  // --- Legs --------------------------------------------------------------
  const upperGeometry = track(limbGeometry(0.13, 0.095, UPPER_LENGTH));
  const lowerGeometry = track(limbGeometry(0.085, 0.052, LOWER_LENGTH));
  const cannonGeometry = track(limbGeometry(0.05, 0.045, HOOF_LENGTH - 0.07));
  const hoofGeometry = track(new CylinderGeometry(0.075, 0.085, 0.09, 8, 1));

  const legDefinitions: ReadonlyArray<{
    id: HorseLegRig["id"];
    isFront: boolean;
    side: 1 | -1;
    x: number;
    y: number;
    z: number;
  }> = [
    { id: "frontLeft", isFront: true, side: -1, x: -0.24, y: SHOULDER_Y, z: 0.6 },
    { id: "frontRight", isFront: true, side: 1, x: 0.24, y: SHOULDER_Y, z: 0.6 },
    { id: "rearLeft", isFront: false, side: -1, x: -0.27, y: HIP_Y, z: -0.72 },
    { id: "rearRight", isFront: false, side: 1, x: 0.27, y: HIP_Y, z: -0.72 },
  ];

  const legs: HorseLegRig[] = legDefinitions.map((definition) => {
    // Front legs hang off the shoulder sling and hind legs off the coupling, so
    // spinal flexion swings the hips through the hind legs the way it does on a
    // real horse instead of leaving them planted under a moving body.
    const carrier = definition.isFront ? forehand : spine;
    const pivot = definition.isFront ? FOREHAND_PIVOT : SPINE_PIVOT;

    const upper = new Group();
    upper.name = `horse-${definition.id}-upper`;
    upper.position.set(
      ...local(pivot, definition.x, definition.y, definition.z),
    );
    const upperMesh = new Mesh(upperGeometry, materials.coat);
    upperMesh.castShadow = true;
    upper.add(upperMesh);
    carrier.add(upper);

    const lower = new Group();
    lower.name = `horse-${definition.id}-lower`;
    lower.position.set(0, -UPPER_LENGTH, 0);
    // Hind legs carry the horse's signature hock angle at rest.
    lower.rotation.x = definition.isFront ? 0.06 : -0.34;
    const lowerMesh = new Mesh(lowerGeometry, materials.points);
    lowerMesh.castShadow = true;
    lower.add(lowerMesh);
    upper.add(lower);

    const hoof = new Group();
    hoof.name = `horse-${definition.id}-hoof`;
    hoof.position.set(0, -LOWER_LENGTH, 0);
    hoof.rotation.x = definition.isFront ? -0.06 : 0.3;
    const cannonMesh = new Mesh(cannonGeometry, materials.points);
    cannonMesh.castShadow = true;
    hoof.add(cannonMesh);
    const hoofMesh = new Mesh(hoofGeometry, materials.hoof);
    hoofMesh.position.y = -(HOOF_LENGTH - 0.07) - 0.04;
    hoof.add(hoofMesh);
    lower.add(hoof);

    return { id: definition.id, isFront: definition.isFront, side: definition.side, upper, lower, hoof };
  });

  return {
    root,
    body,
    forehand,
    spine,
    neck,
    head,
    earLeft,
    earRight,
    tail: tailSegments,
    mane,
    legs,
    dispose() {
      for (const geometry of disposables) geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}

/** A tapered segment hanging from its pivot along -Y. */
function limbGeometry(top: number, bottom: number, length: number): BufferGeometry {
  const geometry = new CylinderGeometry(top, bottom, length, 8, 1);
  geometry.translate(0, -length / 2, 0);
  return geometry;
}

/** Kept for callers that want a rough silhouette blob rather than the full rig. */
export function createHorseProxy(): Mesh {
  return new Mesh(
    new IcosahedronGeometry(0.8, 1),
    new MeshStandardMaterial({ color: PALETTE.coat }),
  );
}
