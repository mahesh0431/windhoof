import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { mergeGeometries } from "../render/geometryUtils";
import type { WorldManifest } from "../game/world/compiler/worldTypes";

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

export interface RegionLandmarks {
  readonly group: Group;
  readonly elementCount: number;
  readonly triangleCount: number;
  dispose(): void;
}

/** One built form, in region-local metres, with the material family to use. */
interface Piece {
  readonly geometry: BufferGeometry;
  readonly matrix: Matrix4;
  readonly material: "stone" | "darkStone" | "wood" | "foliage" | "water";
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
          geometry: new CylinderGeometry(3.4, 5.2, 26, 7),
          matrix: at(-46, 12, -18).multiply(tipped(0.07)),
          material: "stone",
        },
        {
          geometry: new CylinderGeometry(2.6, 4.4, 21, 7),
          matrix: at(-38, 9.5, -14).multiply(tipped(-0.1)),
          material: "stone",
        },
        // The beacon: a broken tower, taller than the stack and inland of it,
        // so the two never merge into one shape from the water.
        {
          geometry: new CylinderGeometry(2.2, 3.2, 17, 8),
          matrix: at(34, 8.5, 26),
          material: "stone",
        },
        {
          // Snapped top, tipped where it fell.
          geometry: new CylinderGeometry(1.9, 2.2, 6, 8),
          matrix: at(38.5, 3, 30).multiply(tipped(1.15)),
          material: "stone",
        },
        // Wind-bent trees, all leaning the same way, which is what makes them
        // read as wind rather than as bad modelling.
        ...[0, 1, 2].map((index) => ({
          geometry: new CylinderGeometry(0.5, 0.85, 9, 6),
          matrix: at(-6 + index * 13, 4.4, 40 + index * 6).multiply(tipped(0.34)),
          material: "wood" as const,
        })),
        ...[0, 1, 2].map((index) => ({
          geometry: new SphereGeometry(3.4, 7, 5),
          matrix: at(-9.4 + index * 13, 9.6, 40 + index * 6).multiply(scaled(1.3, 0.6, 1)),
          material: "foliage" as const,
        })),
      ];

    // "lone tree and stone ridge below the central crown"
    case "longgrass-plain":
      return [
        {
          geometry: new CylinderGeometry(0.9, 1.6, 13, 7),
          matrix: at(0, 6.5, 0),
          material: "wood",
        },
        {
          // One broad crown, the only vertical thing for a hundred metres.
          geometry: new SphereGeometry(8.5, 9, 6),
          matrix: at(0, 15, 0).multiply(scaled(1.15, 0.72, 1.15)),
          material: "foliage",
        },
        // The ridge: a low line of set stones running across the grain of the
        // plain, so a gallop meets it side-on and has to choose a way through.
        ...[0, 1, 2, 3, 4, 5].map((index) => ({
          geometry: new BoxGeometry(7, 3.4 + (index % 3) * 1.6, 4.5),
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
          geometry: new CylinderGeometry(1.1, 2.4, 19, 7),
          matrix: at(-4, 9.5, 6).multiply(tipped(0.09)),
          material: "wood",
        },
        {
          geometry: new CylinderGeometry(0.9, 2, 15, 7),
          matrix: at(2, 7.5, 8).multiply(tipped(-0.13)),
          material: "wood",
        },
        {
          geometry: new SphereGeometry(7, 8, 6),
          matrix: at(-5, 20, 5).multiply(scaled(1, 0.85, 1)),
          material: "foliage",
        },
        {
          geometry: new SphereGeometry(5.6, 8, 6),
          matrix: at(3.5, 16, 9).multiply(scaled(1, 0.85, 1)),
          material: "foliage",
        },
        // The arch: two piers and a span, the only straight line in the wood.
        {
          geometry: new BoxGeometry(3, 11, 3.4),
          matrix: at(-40, 5.5, -26),
          material: "stone",
        },
        {
          geometry: new BoxGeometry(3, 11, 3.4),
          matrix: at(-27, 5.5, -26),
          material: "stone",
        },
        {
          geometry: new BoxGeometry(16.5, 2.6, 3.4),
          matrix: at(-33.5, 12.2, -26),
          material: "stone",
        },
        {
          // Fallen keystone, so the arch reads as ruined rather than as built.
          geometry: new BoxGeometry(3.6, 2.4, 3),
          matrix: at(-22, 1.2, -22).multiply(spun(0.7)).multiply(tipped(0.4)),
          material: "stone",
        },
      ];

    // "waterfall notch, leaning stone bridge, and a bright spring"
    case "river-hollow":
      return [
        // The notch: two shoulders of rock with a bright fall between them.
        {
          geometry: new BoxGeometry(13, 22, 16),
          matrix: at(-19, 10, -30).multiply(spun(0.18)),
          material: "stone",
        },
        {
          geometry: new BoxGeometry(13, 20, 16),
          matrix: at(6, 9, -30).multiply(spun(-0.14)),
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
          geometry: new BoxGeometry(24, 1.8, 5),
          matrix: at(14, 5.6, 14).multiply(tipped(-0.11)),
          material: "stone",
        },
        {
          geometry: new BoxGeometry(3.4, 6, 5),
          matrix: at(4, 2.8, 14).multiply(tipped(0.09)),
          material: "stone",
        },
        {
          geometry: new BoxGeometry(3.4, 5, 5),
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
            geometry: new BoxGeometry(9 + (index % 3) * 4, height, 7),
            matrix: at(Math.cos(angle) * radius, height * 0.42, Math.sin(angle) * radius)
              .multiply(spun(-angle + (index % 2 ? 0.3 : -0.25)))
              .multiply(tipped(((index % 3) - 1) * 0.13)),
            material: "darkStone" as const,
          };
        }),
        // Two standing shards inside the ring, framing the saddle the herd
        // stands in. They are what the player walks between at the end.
        {
          geometry: new ConeGeometry(4.6, 20, 5),
          matrix: at(-19, 10, -2).multiply(tipped(0.1)),
          material: "darkStone",
        },
        {
          geometry: new ConeGeometry(4, 17, 5),
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
  darkStone: { color: "#2a2a2e", roughness: 0.86 },
  wood: { color: "#5a4632", roughness: 0.95 },
  foliage: { color: "#31502c", roughness: 0.93 },
  // Unlit-looking on purpose: a bright sheet is how falling water reads at the
  // distance this is meant to be seen from, and it needs no transparency pass.
  water: { color: "#cfe4e6", roughness: 0.4 },
} as const;

export function createRegionLandmarks(
  manifest: WorldManifest,
  heightAt: (x: number, z: number) => number,
): RegionLandmarks {
  const group = new Group();
  group.name = "region-landmarks";

  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
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
      matrix.setPosition(offset.x, offset.y + groundY, offset.z);
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
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
