import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { mergeGeometries } from "../render/geometryUtils";
import type { WorldManifest } from "../game/world/compiler/worldTypes";
import { createTreeGeometry, type TreeSpecies } from "./treeShapes";
import {
  createRockGeometry,
  createSlabGeometry,
  createSpireGeometry,
} from "./rockShapes";

/**
 * The thing that tells a rider which country they are in from half a kilometre.
 *
 * Ground colour and cover carry a region underfoot, and they were not enough on
 * their own: a basalt crown rendered as dark ground is still a smooth dome, and
 * a dome is not a landmark. The spec knows this and says so - every region
 * carries a `visualIntent.silhouette`, and it names shapes rather than colours:
 * a split sea stack, a broken beacon, a lone tree, a ruined arch, a waterfall
 * notch, a leaning stone bridge, a broken black ridge.
 *
 * This realizes those sentences as built form at each region's own anchor. They
 * are deliberately large, few, and unlit-by-detail: their whole job is to be an
 * outline against sky or haze, which is the only cue that survives four hundred
 * metres of fog and a horse moving at eleven metres per second.
 *
 * These are landmarks, not discoveries. They are present from the first frame,
 * they never gate anything, and nothing in the simulation knows they exist - so
 * they cannot leak a discovery the player has not found. They are how a player
 * navigates without being given a marker to follow.
 */

/** A landmark mass solid enough to stop a horse. */
export interface LandmarkCollider {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly height: number;
}

export interface RegionLandmarks {
  readonly group: Group;
  readonly elementCount: number;
  readonly triangleCount: number;
  /**
   * Stone the player cannot ride through.
   *
   * Landmarks are the biggest things on the island and had no collision at all,
   * so a horse walked straight through a sea stack. Only stone is listed: the
   * lone tree and the water sheet stay passable, because a tree is already
   * handled by the woodland trunks and a waterfall is not a wall.
   */
  readonly colliders: readonly LandmarkCollider[];
  dispose(): void;
}

/** One built form, in region-local metres, with the material family to use. */
interface Piece {
  readonly geometry: BufferGeometry;
  readonly matrix: Matrix4;
  readonly material: "stone" | "darkStone" | "wood" | "foliage" | "water" | "tree";
}

/**
 * A landmark tree: the same tree the island's woodland grows, at landmark size.
 *
 * A lone tree that is meant to be the only vertical thing for a hundred metres
 * has to survive being ridden right up to, and it has to belong to the same
 * forest as everything around it.
 */
function landmarkTree(species: TreeSpecies, seed: number): BufferGeometry {
  return createTreeGeometry(
    species,
    {
      trunk: new Color("#6a5136"),
      canopyLight: new Color("#86ad4c"),
      canopyDark: new Color("#37552e"),
    },
    seed,
  );
}

const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
const scaled = (x: number, y: number, z: number) => new Matrix4().makeScale(x, y, z);
const spun = (radians: number) => new Matrix4().makeRotationY(radians);
const tipped = (radians: number) => new Matrix4().makeRotationZ(radians);

/**
 * Built form per region, keyed to the authored silhouette sentence.
 *
 * Coordinates are metres from the region anchor, and heights are chosen to clear
 * the ground cover and the tree line rather than to be architecturally plausible
 * - a sea stack that does not break the horizon is not a sea stack.
 */
function piecesFor(regionId: string): readonly Piece[] {
  switch (regionId) {
    // "split sea stack, wind-bent trees, and a broken beacon"
    case "saltwind-coast":
      return [
        // The stack, split: two leaning columns with daylight between them.
        {
          geometry: createSpireGeometry(5.2, 3.4, 26, 11, { sides: 7, rings: 6, drift: 0.22 }),
          matrix: at(-46, 12, -18).multiply(tipped(0.07)),
          material: "stone",
        },
        {
          geometry: createSpireGeometry(4.4, 2.6, 21, 12, { sides: 7, rings: 5, drift: 0.24 }),
          matrix: at(-38, 9.5, -14).multiply(tipped(-0.1)),
          material: "stone",
        },
        // The beacon: a broken tower, taller than the stack and inland of it,
        // so the two never merge into one shape from the water.
        {
          geometry: createSpireGeometry(3.2, 2.2, 17, 13, { sides: 8, rings: 5, drift: 0.1 }),
          matrix: at(34, 8.5, 26),
          material: "stone",
        },
        {
          // Snapped top, tipped where it fell.
          geometry: createSpireGeometry(2.2, 1.9, 6, 14, { sides: 8, rings: 3, drift: 0.14 }),
          matrix: at(38.5, 3, 30).multiply(tipped(1.15)),
          material: "stone",
        },
        // Wind-bent trees, all leaning the same way, which is what makes them
        // read as wind rather than as bad modelling.
        ...[0, 1, 2].map((index) => ({
          geometry: landmarkTree(index % 2 === 0 ? "broadleaf" : "birch", 70 + index),
          matrix: at(-6 + index * 13, 0, 40 + index * 6)
            .multiply(tipped(0.28))
            .multiply(scaled(11, 11, 11)),
          material: "tree" as const,
        })),
      ];

    // "lone tree and stone ridge below the central crown"
    case "longgrass-plain":
      return [
        {
          // One broad crown, the only vertical thing for a hundred metres.
          geometry: landmarkTree("broadleaf", 80),
          matrix: at(0, 0, 0).multiply(scaled(22, 22, 22)),
          material: "tree",
        },
        // The ridge: a low line of set stones running across the grain of the
        // plain, so a gallop meets it side-on and has to choose a way through.
        ...[0, 1, 2, 3, 4, 5].map((index) => ({
          geometry: createSlabGeometry(7, 3.4 + (index % 3) * 1.6, 4.5, 20 + index, 0.26),
          matrix: at(-52 + index * 19, 1.4 + (index % 3) * 0.8, -46 + (index % 2) * 5)
            .multiply(spun(0.2 * index)),
          material: "stone" as const,
        })),
      ];

    // "split cedar and ruined arch above a giant fern grove"
    case "fernwood":
      return [
        // The cedar, split by lightning: two trunks from one base.
        {
          geometry: landmarkTree("pine", 90),
          matrix: at(-4, 0, 6).multiply(tipped(0.07)).multiply(scaled(26, 26, 26)),
          material: "tree",
        },
        {
          geometry: landmarkTree("pine", 91),
          matrix: at(3, 0, 9).multiply(tipped(-0.1)).multiply(scaled(20, 20, 20)),
          material: "tree",
        },
        // The arch: two piers and a span, the only straight line in the wood.
        {
          geometry: createSlabGeometry(3, 11, 3.4, 31, 0.14),
          matrix: at(-40, 5.5, -26),
          material: "stone",
        },
        {
          geometry: createSlabGeometry(3, 11, 3.4, 31, 0.14),
          matrix: at(-27, 5.5, -26),
          material: "stone",
        },
        {
          geometry: createSlabGeometry(16.5, 2.6, 3.4, 33, 0.1),
          matrix: at(-33.5, 12.2, -26),
          material: "stone",
        },
        {
          // Fallen keystone, so the arch reads as ruined rather than as built.
          geometry: createSlabGeometry(3.6, 2.4, 3, 34, 0.3),
          matrix: at(-22, 1.2, -22).multiply(spun(0.7)).multiply(tipped(0.4)),
          material: "stone",
        },
      ];

    // "waterfall notch, leaning stone bridge, and a bright spring"
    case "river-hollow":
      return [
        // The notch: two shoulders of rock with a bright fall between them.
        {
          geometry: createRockGeometry(41, { detail: 1, jagged: 0.42 }),
          matrix: at(-19, 10, -30).multiply(spun(0.18)).multiply(scaled(7, 12, 8.5)),
          material: "stone",
        },
        {
          geometry: createRockGeometry(42, { detail: 1, jagged: 0.42 }),
          matrix: at(6, 9, -30).multiply(spun(-0.14)).multiply(scaled(7, 11, 8.5)),
          material: "stone",
        },
        {
          // The fall itself: a pale sheet, the brightest thing in the hollow.
          geometry: new BoxGeometry(9, 19, 1.6),
          matrix: at(-6.5, 9.5, -22.5),
          material: "water",
        },
        {
          // The pool it lands in.
          geometry: new CylinderGeometry(9, 9, 0.7, 12),
          matrix: at(-6.5, 0.4, -14),
          material: "water",
        },
        // The bridge: one slab and two piers, leaning, still standing.
        {
          geometry: createSlabGeometry(24, 1.8, 5, 43, 0.12),
          matrix: at(14, 5.6, 14).multiply(tipped(-0.11)),
          material: "stone",
        },
        {
          geometry: createSlabGeometry(3.4, 6, 5, 44, 0.2),
          matrix: at(4, 2.8, 14).multiply(tipped(0.09)),
          material: "stone",
        },
        {
          geometry: createSlabGeometry(3.4, 5, 5, 45, 0.2),
          matrix: at(24, 2.4, 14).multiply(tipped(-0.2)),
          material: "stone",
        },
      ];

    // "broken black ridge framing a windswept summit saddle"
    case "blackstone-crown":
      return [
        // The ridge: a broken line of basalt teeth around the summit, tallest
        // at the ends so the crown has a genuine profile from below instead of
        // a smooth curve. This is the whole reason a dome became a crown.
        // Two teeth are missing on the +Z side, and that gap is the summit
        // saddle the spec names - the way in, and the thing the herd stands
        // beyond. Without it the ring is a closed wall: a twenty-metre tooth
        // thirteen metres wide sat six metres from the approach and filled the
        // entire frame, so the end of the journey was a black slab with the
        // herd somewhere behind it.
        ...[0, 3, 4, 5, 6, 7].map((index) => {
          const angle = (index / 8) * Math.PI * 2 + 0.35;
          const radius = 52 + (index % 3) * 7;
          const height = 13 + (index % 4) * 7;
          return {
            // Broken teeth, not cut blocks. A slab still reads as something
            // quarried, and basalt that has been standing in weather since
            // before the horse existed should not.
            geometry: createRockGeometry(50 + index, { detail: 1, jagged: 0.5 }),
            matrix: at(Math.cos(angle) * radius, height * 0.42, Math.sin(angle) * radius)
              .multiply(spun(-angle + (index % 2 ? 0.3 : -0.25)))
              .multiply(tipped(((index % 3) - 1) * 0.13))
              .multiply(scaled((9 + (index % 3) * 4) * 0.5, height * 0.5, 3.5)),
            material: "darkStone" as const,
          };
        }),
        // Two standing shards inside the ring, framing the saddle the herd
        // stands in. They are what the player walks between at the end.
        {
          geometry: createSpireGeometry(4.6, 0.5, 20, 61, { sides: 5, rings: 5, drift: 0.2 }),
          matrix: at(-19, 10, -2).multiply(tipped(0.1)),
          material: "darkStone",
        },
        {
          geometry: createSpireGeometry(4, 0.4, 17, 62, { sides: 5, rings: 5, drift: 0.2 }),
          matrix: at(20, 8.5, 1).multiply(tipped(-0.12)),
          material: "darkStone",
        },
      ];

    default:
      return [];
  }
}

const MATERIALS = {
  stone: { color: "#8d8b84", roughness: 0.92 },
  // Basalt, not a silhouette. #2a2a2e is dark enough that in shade it has no
  // form at all, and a landmark with no form is a black shape in the way.
  darkStone: { color: "#4e4b52", roughness: 0.88 },
  wood: { color: "#5a4632", roughness: 0.95 },
  foliage: { color: "#31502c", roughness: 0.93 },
  // Unlit-looking on purpose: a bright sheet is how falling water reads at the
  // distance this is meant to be seen from, and it needs no transparency pass.
  water: { color: "#cfe4e6", roughness: 0.4 },
  // Trees carry trunk and canopy colour in their own vertices, so this family
  // must not tint them. A landmark tree used to be a sphere balanced on a
  // cylinder, which from any distance is a mushroom.
  tree: { color: "#ffffff", roughness: 0.93 },
} as const;

export function createRegionLandmarks(
  manifest: WorldManifest,
  heightAt: (x: number, z: number) => number,
): RegionLandmarks {
  const group = new Group();
  group.name = "region-landmarks";

  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const colliders: LandmarkCollider[] = [];
  let elementCount = 0;
  let triangleCount = 0;

  // One merged geometry per material family per region, so the whole island's
  // landmarks cost five materials and a handful of draw calls rather than one
  // per rock.
  for (const region of manifest.regions) {
    const pieces = piecesFor(region.id);
    if (pieces.length === 0) continue;
    const anchorX = region.anchorMeters.x;
    const anchorZ = region.anchorMeters.z;

    /**
     * Each piece seated on the ground beneath itself, not beneath the anchor.
     *
     * The first version offset the whole merged mesh by the anchor's height,
     * which is fine for a lone tree at the anchor and wrong for anything spread
     * out: Blackstone's ridge stands forty to sixty metres out from the summit,
     * where the crown has already fallen away, so the entire ring hung in the
     * air. Sampling per piece costs one grid lookup each - there are a few dozen
     * on the whole island - and is the difference between built form and props.
     */
    const seated = pieces.map((piece) => {
      const offset = new Vector3().setFromMatrixPosition(piece.matrix);
      const groundY = heightAt(anchorX + offset.x, anchorZ + offset.z);
      const matrix = piece.matrix.clone();
      // Rock is buried, not balanced.
      //
      // Seating a piece so its authored origin lands exactly on the ground
      // leaves an irregular mass touching the terrain at one point and floating
      // everywhere else - and on any slope at all, floating outright. Stone
      // sinks by a share of its own height so its foot is under the turf, which
      // is where a boulder that has been there ten thousand years would be.
      const buries = piece.material === "stone" || piece.material === "darkStone";
      let sink = 0;
      if (buries) {
        const size = new Vector3().setFromMatrixScale(piece.matrix);
        piece.geometry.computeBoundingBox();
        const box = piece.geometry.boundingBox;
        const height = box ? (box.max.y - box.min.y) * size.y : 1;
        sink = Math.min(3.5, Math.max(0.4, height * 0.22));
      }
      matrix.setPosition(offset.x, offset.y + groundY - sink, offset.z);

      if (buries) {
        // One upright cylinder per stone mass, sized from its own bounds. A
        // cylinder is the wrong shape for a leaning shard and the right shape
        // for the question a horse asks of it, which is only ever "can I be
        // here". Cheap, and there are a few dozen on the whole island.
        piece.geometry.computeBoundingBox();
        const box = piece.geometry.boundingBox;
        if (box) {
          const size = new Vector3().setFromMatrixScale(matrix);
          const halfWidth = Math.max(
            (box.max.x - box.min.x) * size.x,
            (box.max.z - box.min.z) * size.z,
          ) * 0.5;
          const height = (box.max.y - box.min.y) * size.y;
          const centre = new Vector3().setFromMatrixPosition(matrix);
          colliders.push({
            x: anchorX + centre.x,
            z: anchorZ + centre.z,
            // The mesh is authored around its own centre, so its foot is half a
            // height below where it was seated.
            y: centre.y - height * 0.5,
            // Pulled in a little: a horse brushing the edge of a boulder should
            // slide off it, not be stopped by air.
            radius: Math.max(0.6, halfWidth * 0.82),
            height,
          });
        }
      }
      return { ...piece, matrix };
    });

    const byMaterial = new Map<Piece["material"], Piece[]>();
    for (const piece of seated) {
      const bucket = byMaterial.get(piece.material);
      if (bucket) bucket.push(piece);
      else byMaterial.set(piece.material, [piece]);
    }

    for (const [family, bucket] of byMaterial) {
      const merged = mergeGeometries(
        bucket.map((piece) => ({ geometry: piece.geometry, matrix: piece.matrix })),
      );
      geometries.push(merged);
      const settings = MATERIALS[family];
      const material = new MeshStandardMaterial({
        color: settings.color,
        roughness: settings.roughness,
        metalness: 0,
        flatShading: true,
        vertexColors: true,
      });
      materials.push(material);

      const mesh = new Mesh(merged, material);
      mesh.name = `landmark-${region.id}-${family}`;
      mesh.position.set(anchorX, 0, anchorZ);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Merged per region, so the bounding sphere is a region-sized ball and the
      // culler makes a useful decision rather than a whole-island one.
      merged.computeBoundingSphere();
      group.add(mesh);

      elementCount += bucket.length;
      triangleCount += merged.getAttribute("position").count / 3;
    }

    for (const piece of pieces) piece.geometry.dispose();
  }

  let disposed = false;
  return {
    group,
    elementCount,
    triangleCount,
    colliders,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
