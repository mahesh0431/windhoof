import {
  Group,
  IcosahedronGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  type BufferGeometry,
} from "three";
import { mergeGeometries } from "../geometryUtils";
import { PALETTE } from "../palette";
import {
  earGeometry,
  hairLocks,
  loftAlongZ,
  loftDown,
  loftUp,
  paintUniform,
  type HairRib,
  type LoftRing,
} from "./horseGeometry";

/**
 * The horse, built in the browser from authored cross-sections.
 *
 * The art brief allows a reduced Milestone 1 set and forbids a Blender step, so
 * the model is procedural. It was first assembled from spheres, capsules, and
 * cylinders, which is the fastest way to get a horse-shaped thing on screen and
 * the surest way to get one that never looks right: smooth intersecting
 * primitives read as a balloon animal next to an island made entirely of flat
 * facets, and the silhouette is wrong in the exact places a horse is
 * recognisable - the slab-sided barrel, the wedge head, the jointed legs.
 *
 * This version is authored the way the island is. Every mass is a loft through
 * named cross-sections, every surface is flat shaded, and the proportions come
 * from a real 15-hand horse: withers at 1.55 m, a body far deeper than it is
 * wide, front legs set close together under a narrow chest, hind legs wider
 * under the widest part of the animal.
 *
 * The torso is deliberately NOT one rigid mesh. A horse's gallop is defined by
 * its back: the frame gathers and rounds as the hind legs swing under, then
 * lengthens and extends through suspension. A single welded body reads as a
 * crate on legs no matter how good the leg animation is, which is exactly the
 * failure the first blind playtest reported. The ribcage stays rigid, because
 * it is, and the two joints a horse actually bends at get their own pivots: the
 * shoulder sling in front and the lumbo-sacral coupling behind. Where those
 * masses overlap, the smaller one is authored strictly inside the larger, so
 * the surfaces cross behind the shoulder and at the loin - the two places a
 * real horse creases anyway.
 *
 * Every joint the animator needs is a named Object3D, so a sourced or generated
 * model can replace the geometry without touching the animation.
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
/**
 * Slightly below the shoulder: the hind limb stands with its gaskin leant back,
 * so it spans less height than the front leg does and would otherwise leave the
 * horse up on its hind toes.
 */
const HIP_Y = 0.986;
const UPPER_LENGTH = 0.42;
const LOWER_LENGTH = 0.36;
/** Fetlock to the ground: pastern plus hoof wall. */
const PASTERN_LENGTH = 0.1;
const HOOF_LENGTH = 0.135;

/** Shoulder sling, in body space. */
const FOREHAND_PIVOT = { x: 0, y: 1.24, z: 0.28 } as const;
/** Lumbo-sacral coupling, in body space. */
const SPINE_PIVOT = { x: 0, y: 1.26, z: -0.28 } as const;

/** Base of the neck, in body space. */
const NECK_BASE = { y: 1.36, z: 0.5 } as const;
const NECK_LENGTH = 0.74;

/**
 * How much darker the underside of a mass is, as a vertex-colour multiplier.
 *
 * A bay horse is genuinely countershaded, and on a flat-shaded body it is also
 * what keeps the barrel from going to a single flat value whenever the sun is
 * behind the horse. 0.3 lands the belly on roughly the palette's coat-shade
 * value, so the two colours still describe the same animal.
 */
const COUNTERSHADE = 0.3;

/**
 * How far facet tone wanders across the coat.
 *
 * Small on purpose. Past about eight percent the body stops reading as hair
 * over muscle and starts reading as camouflage.
 */
const DAPPLE = 0.055;

/**
 * Tone at the bottom of a coat-coloured limb, and at the top of a dark one.
 *
 * The legs change material at the knee and the hock, and a material change is a
 * hard ring unless both sides are brought towards each other first. The coat
 * darkens into the joint and the points are lifted back out of it, so the two
 * meet at close to the same rendered value and the black comes on as a gradient
 * the way it does on a real bay.
 */
const POINTS_BLEND_DOWN = 0.62;
const POINTS_BLEND_UP = 1.5;

export function createHorseRig(): HorseRig {
  const materials = {
    coat: new MeshStandardMaterial({
      color: PALETTE.coat,
      roughness: 0.78,
      metalness: 0,
      flatShading: true,
      vertexColors: true,
    }),
    points: new MeshStandardMaterial({
      color: PALETTE.points,
      roughness: 0.82,
      metalness: 0,
      flatShading: true,
      vertexColors: true,
    }),
    mane: new MeshStandardMaterial({
      color: PALETTE.mane,
      roughness: 0.86,
      metalness: 0,
      flatShading: true,
      vertexColors: true,
    }),
    hoof: new MeshStandardMaterial({
      color: PALETTE.hoof,
      roughness: 0.7,
      metalness: 0,
      flatShading: true,
      vertexColors: true,
    }),
    blaze: new MeshStandardMaterial({
      color: PALETTE.blaze,
      roughness: 0.8,
      metalness: 0,
      flatShading: true,
      vertexColors: true,
    }),
    muzzle: new MeshStandardMaterial({
      color: PALETTE.muzzle,
      roughness: 0.82,
      metalness: 0,
      flatShading: true,
      vertexColors: true,
    }),
  };

  const disposables: BufferGeometry[] = [];
  const track = <T extends BufferGeometry>(geometry: T): T => {
    disposables.push(geometry);
    return geometry;
  };

  /**
   * A mesh that casts and takes the sun.
   *
   * `shadow` is off for the few parts that sit inside another mass - eyes,
   * nostrils, the blaze, the forelock. They cannot change the outline the sun
   * sees, so drawing them again into the shadow map buys nothing but draw
   * calls, and the horse is already the most-drawn object in the scene.
   */
  const solid = (
    geometry: BufferGeometry,
    material: MeshStandardMaterial,
    shadow = true,
  ): Mesh => {
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    return mesh;
  };

  /**
   * Merges parts that share a joint and a material into one draw.
   *
   * Nothing here moves relative to anything else it is merged with, so the
   * split was only ever an authoring convenience - and the horse is the most
   * drawn object in the scene, counted twice because it casts shadows, and now
   * up to two more of them animate beside the player when the herd wakes up.
   */
  const fuse = (...parts: BufferGeometry[]): BufferGeometry => {
    const merged = mergeGeometries(
      parts.map((geometry) => ({ geometry, matrix: new Matrix4() })),
    );
    for (const part of parts) part.dispose();
    return merged;
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

  /**
   * Lofts a torso mass authored in body space inside a pivot's local space, so
   * every section below can be read against the same ground-up measurements.
   */
  const torso = (
    rings: readonly LoftRing[],
    pivot: { y: number; z: number } = { y: 0, z: 0 },
  ): BufferGeometry =>
    loftAlongZ(
      rings.map((ring) => ({
        ...ring,
        at: ring.at - pivot.z,
        centre: (ring.centre ?? 0) - pivot.y,
      })),
      // Fourteen facets round a section rather than ten. The torso is the
      // largest smooth-ish surface on the animal and at ten it had a visibly
      // flat belly and flat sides; the extra four are the cheapest quality the
      // model can buy, at about forty triangles a mass.
      { segments: 14, shade: COUNTERSHADE, dapple: DAPPLE },
    );

  // --- Ribcage -----------------------------------------------------------
  // Rigid on purpose: a horse's thorax does not bend. Slab-sided and far deeper
  // than it is wide, which is the single measurement that separates a horse
  // from a barrel on legs.
  //
  // The whole torso was a quarter longer than it should have been - point of
  // shoulder to point of buttock came to 1.28 times the height at the withers,
  // where a riding horse is close to square. That one number was doing more
  // damage to the silhouette than every surface detail on the model combined.
  const barrel = solid(
    track(
      torso([
        { at: 0.47, centre: 1.16, halfWidth: 0.245, up: 0.3, down: 0.315, squareness: 0.4, crest: 0.28 },
        { at: 0.26, centre: 1.16, halfWidth: 0.268, up: 0.285, down: 0.325, squareness: 0.4, crest: 0.24 },
        // Deepest at the girth, and the back dips a little behind the withers:
        // a topline that runs dead level from wither to croup is a table.
        { at: 0.03, centre: 1.17, halfWidth: 0.272, up: 0.265, down: 0.315, squareness: 0.4, crest: 0.2 },
        { at: -0.19, centre: 1.2, halfWidth: 0.258, up: 0.245, down: 0.29, squareness: 0.4, crest: 0.18 },
        // The flank tucks up and in ahead of the stifle. Without the tuck the
        // underline runs straight from chest to hock and the horse reads pregnant.
        { at: -0.35, centre: 1.25, halfWidth: 0.232, up: 0.215, down: 0.225, squareness: 0.38, crest: 0.16 },
      ]),
    ),
    materials.coat,
  );
  body.add(barrel);

  // --- Forequarters ------------------------------------------------------
  // Narrow prow at the breast opening out to the widest point of the standing
  // horse at the shoulder, with the withers rising as a crest above the back.
  const forequarters = solid(
    track(
      torso(
        [
          // The breast has to be wider than the front legs stand. Narrower, as
          // it was, and the forelegs come down outside the chest and the horse
          // reads bow-legged from directly in front - which is the angle the
          // player sees whenever another horse is walking towards them.
          { at: 0.78, centre: 1.14, halfWidth: 0.168, up: 0.175, down: 0.235, squareness: 0.38, keel: 0.3 },
          { at: 0.7, centre: 1.15, halfWidth: 0.208, up: 0.26, down: 0.29, squareness: 0.42, keel: 0.3 },
          // The withers run forward as a rising ridge rather than stopping in a
          // step: the crest of the neck has to leave the back somewhere, and a
          // hard edge there is the single most model-like thing on the horse.
          { at: 0.58, centre: 1.16, halfWidth: 0.238, up: 0.345, down: 0.315, squareness: 0.42, crest: 0.24, keel: 0.25 },
          // The summit of the withers, and the measurement the whole model is
          // scaled from: 1.16 + 0.395 is HORSE_WITHERS_HEIGHT.
          { at: 0.45, centre: 1.16, halfWidth: 0.265, up: 0.395, down: 0.33, squareness: 0.42, crest: 0.42, keel: 0.15 },
          { at: 0.27, centre: 1.17, halfWidth: 0.272, up: 0.35, down: 0.335, squareness: 0.45, crest: 0.36 },
          // From here back the mass shrinks strictly inside the ribcage, so the
          // shoulder joint never opens a seam however far the forehand rotates.
          { at: 0.14, centre: 1.19, halfWidth: 0.212, up: 0.255, down: 0.25, squareness: 0.45, crest: 0.3 },
          { at: 0.03, centre: 1.2, halfWidth: 0.15, up: 0.18, down: 0.18, squareness: 0.45 },
        ],
        FOREHAND_PIVOT,
      ),
    ),
    materials.coat,
  );
  forehand.add(forequarters);

  // --- Hindquarters ------------------------------------------------------
  // The engine. Widest across the hips, highest at the croup, and rounded off
  // behind: a horse seen from any angle at speed is mostly this shape.
  const hindquarters = solid(
    track(
      torso(
        [
          { at: -0.15, centre: 1.19, halfWidth: 0.195, up: 0.2, down: 0.235, squareness: 0.45 },
          { at: -0.28, centre: 1.21, halfWidth: 0.252, up: 0.245, down: 0.275, squareness: 0.45, crest: 0.12 },
          // Point of hip: the widest section on the animal, wider than the
          // ribcage, which is what stops the quarters reading as a tapered tail
          // end of the barrel.
          { at: -0.42, centre: 1.22, halfWidth: 0.298, up: 0.275, down: 0.3, squareness: 0.45, crest: 0.1 },
          // Croup, and deliberately below the withers.
          { at: -0.56, centre: 1.23, halfWidth: 0.305, up: 0.27, down: 0.325, squareness: 0.45, crest: 0.12 },
          { at: -0.7, centre: 1.22, halfWidth: 0.278, up: 0.235, down: 0.345, squareness: 0.45, crest: 0.16 },
          { at: -0.8, centre: 1.19, halfWidth: 0.215, up: 0.185, down: 0.3, squareness: 0.42, crest: 0.16 },
          { at: -0.86, centre: 1.16, halfWidth: 0.14, up: 0.14, down: 0.22, squareness: 0.4 },
        ],
        SPINE_PIVOT,
      ),
    ),
    materials.coat,
  );
  spine.add(hindquarters);

  // --- Neck and head -----------------------------------------------------
  const neck = new Group();
  neck.name = "horse-neck";
  neck.position.set(0, NECK_BASE.y - FOREHAND_PIVOT.y, NECK_BASE.z - FOREHAND_PIVOT.z);
  // Positive pitch leans the neck up and FORWARD out of the withers, which is
  // how a horse is built. The animator drives this value from here.
  neck.rotation.x = 0.7;
  forehand.add(neck);

  // Authored crest-and-throat rather than as a cone: `up` is the crest side,
  // `down` the throat, and the section is deep and narrow all the way up.
  const neckMesh = solid(
    track(
      loftUp(
        [
          // Reaching well down into the chest, so the throat runs into the
          // breast instead of stopping at a notch above it.
          { at: -0.18, halfWidth: 0.215, up: 0.28, down: 0.34, squareness: 0.42, crest: 0.14 },
          { at: 0.04, halfWidth: 0.195, up: 0.265, down: 0.275, squareness: 0.45, crest: 0.2 },
          { at: 0.24, halfWidth: 0.168, up: 0.245, down: 0.225, squareness: 0.48, crest: 0.24 },
          { at: 0.44, halfWidth: 0.14, up: 0.215, down: 0.185, squareness: 0.48, crest: 0.26 },
          { at: 0.61, halfWidth: 0.112, up: 0.165, down: 0.145, squareness: 0.45, crest: 0.28 },
          // The throatlatch has to stay nearly as deep as the jowl above it.
          // Tapered to a stalk - which is what this did - the head stops being
          // carried and starts being balanced on a pole, and the whole animal
          // reads as a giraffe however good the head itself is.
          { at: NECK_LENGTH, halfWidth: 0.09, up: 0.125, down: 0.12, squareness: 0.4 },
        ],
        { segments: 14, shade: COUNTERSHADE, dapple: DAPPLE },
      ),
    ),
    materials.coat,
  );
  neck.add(neckMesh);

  const head = new Group();
  head.name = "horse-head";
  head.position.set(0, NECK_LENGTH - 0.04, 0);
  // Nose down against the neck angle. A horse at rest carries its face near the
  // vertical with the poll as its highest point; level with the horizon is a
  // grazing pose, and holding it permanently was what made this model read as a
  // camel rather than a horse. The animator takes it back out with speed.
  head.rotation.x = -0.08;
  neck.add(head);

  // A horse is unmistakable from the side because of this profile: a deep round
  // jowl carried right at the back under the poll, a long straight nasal bone
  // falling away from it, and a blunt muzzle. Nothing else about the head
  // matters as much as the taper between those three - and the head is SHORT
  // for its depth, roughly two and a half jowls long, which is the measurement
  // that stops a muzzle turning into a snout.
  const skullGeometry = loftAlongZ(
        [
          { at: -0.19, centre: 0.1, halfWidth: 0.07, up: 0.085, down: 0.098, squareness: 0.35 },
          // The round of the jaw. Deepest and widest section on the head, and
          // the thing the eye reads as "horse" before the muzzle registers.
          { at: -0.1, centre: 0.082, halfWidth: 0.1, up: 0.108, down: 0.168, squareness: 0.45, keel: 0.16 },
          { at: 0.01, centre: 0.082, halfWidth: 0.108, up: 0.105, down: 0.19, squareness: 0.5, keel: 0.26 },
          // Ahead of the cheekbone the width falls away fast; the face is a
          // narrow blade from here forward.
          { at: 0.13, centre: 0.094, halfWidth: 0.085, up: 0.082, down: 0.148, squareness: 0.5, keel: 0.3 },
          { at: 0.25, centre: 0.1, halfWidth: 0.067, up: 0.057, down: 0.1, squareness: 0.45 },
          { at: 0.36, centre: 0.104, halfWidth: 0.059, up: 0.05, down: 0.076, squareness: 0.4 },
          { at: 0.44, centre: 0.102, halfWidth: 0.053, up: 0.044, down: 0.06, squareness: 0.35 },
        ],
        { segments: 12, shade: COUNTERSHADE * 0.7, dapple: DAPPLE * 0.6 },
  );

  // Soft dark muzzle, sitting proud of the skull's taper so it reads as its own
  // material rather than as a painted-on tip. Kept short: the dark on a bay is
  // the lips and the nostrils, not the whole front third of the face, and taken
  // any further back it reads as a horse that has been dipped in paint.
  const muzzle = solid(
    track(
      loftAlongZ(
        [
          { at: 0.418, centre: 0.102, halfWidth: 0.058, up: 0.049, down: 0.069, squareness: 0.4 },
          { at: 0.455, centre: 0.1, halfWidth: 0.055, up: 0.045, down: 0.062, squareness: 0.35 },
          { at: 0.49, centre: 0.096, halfWidth: 0.043, up: 0.035, down: 0.045, squareness: 0.3 },
        ],
        { segments: 12, shade: COUNTERSHADE * 0.5 },
      ),
    ),
    materials.muzzle,
  );
  head.add(muzzle);

  // Blaze: a narrow stripe lying along the nasal bone, sunk far enough into the
  // skull that only the marking shows. Sat proud of the surface it stops being
  // a marking and becomes a white plate strapped to the horse's face.
  const blaze = solid(
    track(
      loftAlongZ(
        // Every section is set so its top stands two or three millimetres proud
        // of the nasal bone directly under it. Any station where it does not,
        // the marking vanishes inside the skull and reappears further along,
        // and a blaze that comes and goes down the face reads as a scar.
        [
          { at: 0.0, centre: 0.155, halfWidth: 0.013, up: 0.036, down: 0.05, squareness: 0.5 },
          { at: 0.1, centre: 0.145, halfWidth: 0.023, up: 0.036, down: 0.05, squareness: 0.5 },
          { at: 0.22, centre: 0.128, halfWidth: 0.021, up: 0.036, down: 0.05, squareness: 0.5 },
          { at: 0.33, centre: 0.122, halfWidth: 0.017, up: 0.036, down: 0.05, squareness: 0.5 },
          { at: 0.4, centre: 0.118, halfWidth: 0.01, up: 0.032, down: 0.05, squareness: 0.5 },
        ],
        { segments: 8 },
      ),
    ),
    materials.blaze,
    false,
  );
  head.add(blaze);

  // Eyes sit on the widest part of the skull and look sideways, as a prey
  // animal's do. Set them forward like a predator's and the horse stops
  // reading as a horse.
  // The orbital rim first, then the eye standing proud of it.
  //
  // Both are fitted to the skull's actual surface at the eye's own height,
  // which is not the section's widest point: the superellipse has narrowed to
  // about 0.083 by the time it reaches y 0.155, and sizing these against the
  // 0.104 half-width at the centre line is what previously left a pair of
  // faceted lumps standing off the forehead.
  const browGeometry = mergeGeometries(
    ([-1, 1] as const).map((side) => ({
      geometry: paintUniform(new IcosahedronGeometry(0.04, 0), 1.06),
      matrix: new Matrix4()
        .makeTranslation(side * 0.078, 0.152, -0.045)
        .multiply(new Matrix4().makeScale(0.35, 0.8, 1.05)),
    })),
  );
  // The rim is part of the skull's surface and shares its material, so it is
  // part of the skull's draw too.
  head.add(solid(track(fuse(skullGeometry, browGeometry)), materials.coat));

  const eyeGeometry = mergeGeometries(
    ([-1, 1] as const).map((side) => ({
      geometry: paintUniform(new IcosahedronGeometry(0.025, 0)),
      matrix: new Matrix4()
        .makeTranslation(side * 0.086, 0.155, -0.045)
        .multiply(new Matrix4().makeScale(0.55, 1, 1.15)),
    })),
  );

  const nostrilGeometry = mergeGeometries(
    ([-1, 1] as const).map((side) => ({
      geometry: paintUniform(new IcosahedronGeometry(0.026, 0)),
      matrix: new Matrix4()
        .makeTranslation(side * 0.04, 0.096, 0.378)
        .multiply(new Matrix4().makeScale(0.6, 1, 1.1)),
    })),
  );
  head.add(solid(track(fuse(eyeGeometry, nostrilGeometry)), materials.points, false));

  // Ears: a curled leaf with a hollow in it, not a cone. See `earGeometry`.
  const ear = track(
    earGeometry({ height: 0.152, halfWidth: 0.044, cup: 0.031, thickness: 0.011 }),
  );
  const ears = ([-1, 1] as const).map((side) => {
    const pivot = new Group();
    pivot.name = side < 0 ? "horse-ear-left" : "horse-ear-right";
    // Set at the poll, which is the back-top corner of the skull. Ears further
    // forward sit on the forehead and read as a deer's.
    pivot.position.set(side * 0.058, 0.172, -0.145);
    const mesh = solid(ear, materials.coat);
    // Turned so each hollow faces forward and a little outwards - the pose a
    // horse holds when it is listening to something in front of it, and the one
    // the animator swings away from to pin the ears back.
    mesh.rotation.set(0, side * 0.46, side * -0.2);
    pivot.add(mesh);
    head.add(pivot);
    return pivot;
  });
  const earLeft = ears[0] as Group;
  const earRight = ears[1] as Group;

  // --- Mane --------------------------------------------------------------
  // A sheet with a ragged free edge, not a row of beads. Hair has a silhouette
  // and no volume worth modelling, so what matters is the outline it cuts
  // against the sky and how it lies over the crest.
  //
  // The pivot sits at the middle of the crest rather than at the base of the
  // neck: the animator swings this group to trail the mane at speed, and a
  // pivot down at the withers would drag the roots off the neck entirely.
  const mane = new Group();
  mane.name = "horse-mane";
  mane.position.set(0, 0.36, -0.2);
  neck.add(mane);

  /** Crest surface offset at a given height up the neck, in neck space. */
  const crestAt = (height: number): number => {
    const t = Math.min(1, Math.max(0, height / NECK_LENGTH));
    return -(0.26 - 0.17 * t);
  };

  // Every lock is aimed from a buried root to a tip measured OUT from the crest
  // at the height it falls to, rather than along a fixed direction. The neck is
  // carried at an angle and its crest recedes as it drops, so a fixed direction
  // either flies off the neck at the poll or sinks inside it at the withers -
  // both of which this model did before the stand-off was measured per lock.
  // Two sheets, because a mane is not symmetrical: it parts along the crest and
  // the bulk of it lies over on one side. Built as a single ridge of locks it
  // had no width at all, which is why it disappeared completely from the front
  // and from every quarter view - the two angles the player sees most.
  //
  // `lean` is how far out of the crest that sheet's locks are thrown: the small
  // one stays on the off side as a ridge, the big one falls down the near side
  // and is the mass the eye actually reads as hair.
  const MANE_RIBS = 13;
  const maneSheet = (lean: number, weight: number): HairRib[] => {
    const ribs: HairRib[] = [];
    for (let index = 0; index < MANE_RIBS; index += 1) {
      const t = index / (MANE_RIBS - 1);
      const height = 0.02 + t * 0.72;
      // Longest over the middle of the crest, shorter at the withers and at the
      // poll, with a per-lock stagger so the edge is cut rather than combed.
      const stagger = index % 2 === 0 ? 1 : 0.76;
      const fall = (0.19 + Math.sin(t * Math.PI) * 0.17) * stagger * weight;
      const standoff = (0.05 + Math.sin(t * Math.PI) * 0.05) * stagger * weight;
      const tipHeight = height - fall;
      ribs.push({
        root: [lean * 0.16, height, crestAt(height) + 0.045],
        tip: [
          lean * (0.6 + Math.sin(t * Math.PI) * 0.5) * (1 - t * 0.35),
          tipHeight,
          crestAt(tipHeight) - standoff,
        ],
        thickness: (0.026 + Math.sin(t * Math.PI) * 0.02) * weight,
      });
    }
    return ribs;
  };

  // Hair stays out of the shadow pass. A mane is a few centimetres of sheet and
  // the horse's own shadow is a solid silhouette without it; on the island the
  // horse is thirty-six meshes and every one of them is a draw call twice over.
  mane.add(
    solid(
      track(
        fuse(
          ...([
            [0.2, 1],
            [-0.075, 0.62],
          ] as const).map(([lean, weight]) =>
            shiftGeometry(
              hairLocks(maneSheet(lean, weight), { shade: 0.3, gap: 0.26 }),
              0,
              -0.36,
              0.2,
            ),
          ),
        ),
      ),
      materials.mane,
      false,
    ),
  );

  // The forelock grows between the ears and falls forward down the forehead,
  // so it hangs from the poll rather than from the middle of the face.
  const forelockRibs: HairRib[] = [
    { root: [-0.048, 0.185, -0.135], tip: [-0.062, 0.115, -0.005], thickness: 0.022 },
    { root: [0, 0.195, -0.14], tip: [0.004, 0.088, 0.035], thickness: 0.03 },
    { root: [0.048, 0.185, -0.135], tip: [0.062, 0.122, -0.012], thickness: 0.022 },
  ];
  head.add(
    solid(
      track(hairLocks(forelockRibs, { shade: 0.35, gap: 0.3 })),
      materials.mane,
      false,
    ),
  );

  // --- Tail --------------------------------------------------------------
  // Hung from the spine group, so a rounded back carries the dock with it.
  // Segment zero is the bony dock in coat colour with hair over it; the rest is
  // hair, falling in sheets that flare rather than tapering to a rope.
  const tailSegments: Group[] = [];
  let tailParent: Object3D = spine;
  for (let index = 0; index < 3; index += 1) {
    const segment = new Group();
    segment.name = `horse-tail-${index}`;
    if (index === 0) {
      // Sunk into the top of the croup rather than perched on it: set proud,
      // the dock's own loft shows as a flat plate lying on the rump.
      segment.position.set(0, 1.33 - SPINE_PIVOT.y, -0.79 - SPINE_PIVOT.z);
      segment.rotation.x = 0.5;
    } else {
      segment.position.set(0, -0.24, 0);
      // Each joint folds a little further under, so the tail describes a curve
      // instead of a straight rod hinged at the dock.
      segment.rotation.x = 0.3;
    }

    if (index === 0) {
      segment.add(
        solid(
          track(
            loftDown(
              [
                { at: -0.08, halfWidth: 0.058, up: 0.058, down: 0.062, squareness: 0.3 },
                { at: 0.08, halfWidth: 0.05, up: 0.05, down: 0.054, squareness: 0.3 },
                { at: 0.18, halfWidth: 0.042, up: 0.042, down: 0.046, squareness: 0.3 },
              ],
              { segments: 8, shade: COUNTERSHADE },
            ),
          ),
          materials.coat,
        ),
      );
    }

    // Three sheets fanned around the dock rather than two crossed at right
    // angles. A tail is a rope of hair with a real cross-section, and the
    // player sees it edge-on for minutes at a time from directly behind the
    // horse: two sheets leave two viewing angles where the whole tail collapses
    // to a plank, and one of those two angles is the chase camera's.
    // Narrow and short at the dock, widening down the chain. The hair at the
    // top of a tail is short and lies tight to the bone; given the full spread
    // there, the topmost sheet lies flat across the croup and reads as a saddle
    // flap strapped to the horse's rump.
    const spread = [0.55, 0.95, 1][index] ?? 1;
    const reach = [0.18, 0.34, 0.5][index] ?? 0.34;
    const plume = (width: number, drop: number, thickness: number): HairRib[] => {
      const ribs: HairRib[] = [];
      const RIBS = 5;
      for (let rib = 0; rib < RIBS; rib += 1) {
        const across = (rib / (RIBS - 1)) * 2 - 1;
        const edge = Math.abs(across);
        // Hair falls apart as it drops, and the strands are cut at different
        // lengths, so the hem is ragged rather than a curtain.
        const stagger = rib % 2 === 0 ? 1 : 0.88;
        ribs.push({
          root: [0, 0.03, across * width],
          // Only a little flare. Fanned hard the sheets separate into distinct
          // black flags with daylight between them instead of reading as one
          // rope of hair.
          tip: [0, -drop * stagger * (1 - edge * 0.12), across * width * (1.15 + edge * 0.5)],
          thickness: thickness * (1 - edge * 0.3),
        });
      }
      return ribs;
    };
    segment.add(
      solid(
        track(
          fuse(
            ...[0, Math.PI / 3, (Math.PI * 2) / 3].map((turn) =>
              hairLocks(plume(0.082 * spread, reach, 0.05 * spread), {
                gap: 0.2,
                shade: 0.42,
              }).rotateY(turn),
            ),
          ),
        ),
        materials.mane,
        false,
      ),
    );

    tailParent.add(segment);
    tailParent = segment;
    tailSegments.push(segment);
  }

  // --- Legs --------------------------------------------------------------
  // Authored front-to-back rather than as tubes: a forearm is broad and flat,
  // a cannon is a thin bone with the tendon standing off behind it, a hock is a
  // point that sticks out backwards. Those three facts are what make a leg read
  // as a leg at silhouette size.
  // The measurement that makes a leg read: a forearm is nearly twice the width
  // of the cannon under it. These lofts had a taper of about a third, which is
  // why every leg on the model was a pipe - there was no joint anywhere, only a
  // slow narrowing from body to hoof.
  const frontUpper = track(
    loftDown(
      [
        // Above the joint, buried in the chest, so shoulder rotation never
        // exposes the top of the bone.
        { at: -0.24, halfWidth: 0.082, up: 0.1, down: 0.15, squareness: 0.45 },
        // The point of the elbow, set well back against the girth.
        { at: -0.08, halfWidth: 0.093, up: 0.115, down: 0.168, squareness: 0.5 },
        // Top of the forearm: the widest, flattest part of the whole limb.
        { at: 0.06, halfWidth: 0.087, up: 0.1, down: 0.126, squareness: 0.5 },
        { at: 0.2, halfWidth: 0.067, up: 0.076, down: 0.086, squareness: 0.55 },
        { at: 0.32, halfWidth: 0.05, up: 0.052, down: 0.058, squareness: 0.6, tone: 0.86 },
        // The knee: a squared block wider and deeper than the cannon it sits
        // on, which is what puts a visible corner in the leg's outline.
        { at: UPPER_LENGTH - 0.05, halfWidth: 0.053, up: 0.056, down: 0.062, squareness: 0.75, tone: 0.72 },
        { at: UPPER_LENGTH, halfWidth: 0.046, up: 0.048, down: 0.05, squareness: 0.75, tone: POINTS_BLEND_DOWN },
      ],
      { segments: 8, shade: COUNTERSHADE, dapple: DAPPLE },
    ),
  );
  const frontLower = track(
    loftDown(
      [
        { at: -0.03, halfWidth: 0.047, up: 0.05, down: 0.058, squareness: 0.65, tone: POINTS_BLEND_UP },
        // Cannon: a thin flat bone with the flexor tendon standing off behind
        // it, so the section is far deeper than it is wide.
        { at: 0.06, halfWidth: 0.035, up: 0.032, down: 0.056, squareness: 0.65, tone: 1.16 },
        { at: 0.2, halfWidth: 0.032, up: 0.03, down: 0.05, squareness: 0.7 },
        { at: 0.3, halfWidth: 0.034, up: 0.032, down: 0.046, squareness: 0.65 },
        // Fetlock, swelling out again at the bottom.
        { at: LOWER_LENGTH, halfWidth: 0.047, up: 0.045, down: 0.052, squareness: 0.6 },
      ],
      { segments: 8, shade: COUNTERSHADE * 0.6 },
    ),
  );
  const hindUpper = track(
    loftDown(
      [
        { at: -0.22, halfWidth: 0.115, up: 0.115, down: 0.16, squareness: 0.5 },
        // Stifle, carried forward under the flank - the hind leg's mass is all
        // in its top half and all of it in front of the bone.
        { at: -0.04, halfWidth: 0.133, up: 0.128, down: 0.186, squareness: 0.55 },
        // Gaskin: deep from front to back, narrow across.
        { at: 0.1, halfWidth: 0.107, up: 0.088, down: 0.156, squareness: 0.55 },
        { at: 0.24, halfWidth: 0.077, up: 0.058, down: 0.116, squareness: 0.55 },
        { at: 0.34, halfWidth: 0.055, up: 0.042, down: 0.086, squareness: 0.6, tone: 0.78 },
        // The point of the hock: a hard corner standing well back of the bone,
        // and the single most recognisable joint on the animal.
        { at: UPPER_LENGTH, halfWidth: 0.048, up: 0.038, down: 0.09, squareness: 0.75, tone: POINTS_BLEND_DOWN },
      ],
      { segments: 8, shade: COUNTERSHADE, dapple: DAPPLE },
    ),
  );
  const hindLower = track(
    loftDown(
      [
        { at: -0.03, halfWidth: 0.046, up: 0.044, down: 0.072, squareness: 0.65, tone: POINTS_BLEND_UP },
        { at: 0.07, halfWidth: 0.034, up: 0.03, down: 0.053, squareness: 0.7, tone: 1.16 },
        { at: 0.22, halfWidth: 0.031, up: 0.028, down: 0.046, squareness: 0.7 },
        { at: 0.3, halfWidth: 0.033, up: 0.03, down: 0.044, squareness: 0.65 },
        { at: LOWER_LENGTH, halfWidth: 0.046, up: 0.043, down: 0.052, squareness: 0.6 },
      ],
      { segments: 8, shade: COUNTERSHADE * 0.6 },
    ),
  );
  const pastern = track(
    loftDown(
      [
        { at: -0.03, halfWidth: 0.047, up: 0.046, down: 0.056, squareness: 0.55 },
        { at: PASTERN_LENGTH, halfWidth: 0.04, up: 0.039, down: 0.041, squareness: 0.5 },
      ],
      { segments: 8, shade: COUNTERSHADE * 0.6 },
    ),
  );
  // A hoof is a truncated wedge that flares to the ground, with the front wall
  // sloping forward. Modelled as a cylinder it reads as a peg.
  //
  // The top ring is the coronet band: the pale live rim the horn grows out of,
  // and the line that separates hoof from leg on a real animal. Without it the
  // dark leg runs into the dark hoof and the foot has no top.
  const hoofGeometry = track(
    loftDown(
      [
        { at: PASTERN_LENGTH - 0.02, halfWidth: 0.05, up: 0.054, down: 0.046, squareness: 0.6, tone: 1.65 },
        { at: PASTERN_LENGTH + 0.005, halfWidth: 0.055, up: 0.06, down: 0.05, squareness: 0.62, tone: 1.2 },
        { at: PASTERN_LENGTH + 0.06, halfWidth: 0.064, up: 0.074, down: 0.056, squareness: 0.65 },
        { at: PASTERN_LENGTH + HOOF_LENGTH, halfWidth: 0.068, up: 0.08, down: 0.058, squareness: 0.7, tone: 0.88 },
      ],
      { segments: 8, shade: 0.2 },
    ),
  );

  const legDefinitions: ReadonlyArray<{
    id: HorseLegRig["id"];
    isFront: boolean;
    side: 1 | -1;
    x: number;
    y: number;
    z: number;
  }> = [
    { id: "frontLeft", isFront: true, side: -1, x: -0.152, y: SHOULDER_Y, z: 0.45 },
    { id: "frontRight", isFront: true, side: 1, x: 0.152, y: SHOULDER_Y, z: 0.45 },
    // Set wider than the front pair, because the widest part of a horse is its
    // hips and the hind legs hang under them.
    { id: "rearLeft", isFront: false, side: -1, x: -0.212, y: HIP_Y, z: -0.56 },
    { id: "rearRight", isFront: false, side: 1, x: 0.212, y: HIP_Y, z: -0.56 },
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
      definition.x - pivot.x,
      definition.y - pivot.y,
      definition.z - pivot.z,
    );
    upper.add(
      solid(definition.isFront ? frontUpper : hindUpper, materials.coat),
    );
    carrier.add(upper);

    // Standing stance: the gaskin leans back so the hock sits under the point
    // of the buttock. The animator holds the same angle and blends it out with
    // speed; this is the pose a rig has before anything animates it.
    if (!definition.isFront) upper.rotation.x = 0.3;

    const lower = new Group();
    lower.name = `horse-${definition.id}-lower`;
    lower.position.set(0, -UPPER_LENGTH, 0);
    // Hind legs carry the horse's signature hock angle at rest.
    lower.rotation.x = definition.isFront ? 0.06 : -0.535;
    lower.add(
      solid(definition.isFront ? frontLower : hindLower, materials.points),
    );
    upper.add(lower);

    const hoof = new Group();
    hoof.name = `horse-${definition.id}-hoof`;
    hoof.position.set(0, -LOWER_LENGTH, 0);
    hoof.rotation.x = definition.isFront ? -0.06 : 0.3;
    hoof.add(solid(pastern, materials.points));
    hoof.add(solid(hoofGeometry, materials.hoof));
    lower.add(hoof);

    return {
      id: definition.id,
      isFront: definition.isFront,
      side: definition.side,
      upper,
      lower,
      hoof,
    };
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

/** Moves authored points into a child group's space without a wrapper node. */
function shiftGeometry(
  geometry: BufferGeometry,
  x: number,
  y: number,
  z: number,
): BufferGeometry {
  geometry.translate(x, y, z);
  return geometry;
}

/** Kept for callers that want a rough silhouette blob rather than the full rig. */
export function createHorseProxy(): Mesh {
  return new Mesh(
    new IcosahedronGeometry(0.8, 1),
    new MeshStandardMaterial({ color: PALETTE.coat, flatShading: true }),
  );
}
