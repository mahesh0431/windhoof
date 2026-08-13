import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import { mergeGeometries } from "../render/geometryUtils";
import type { CompiledDiscovery, WorldManifest } from "../game/world/compiler/worldTypes";

/**
 * The five places the herd left something behind, as things you can see.
 *
 * The compiler decides where each trace is and what completes it. What it
 * cannot decide is what a player actually looks at, and a discovery with no
 * visible cause is not a discovery - it is an invisible circle on the ground
 * that fires when you cross it. The spec knows this and states two `signals`
 * for every mandatory trace, in the world's own terms: prints in wet sand, a
 * flattened circle, hair caught on bark, tracks in mud, silhouettes rising
 * through high grass.
 *
 * This realizes those sentences. Every scene follows the same three rules:
 *
 * - **Unique.** No two traces share a form. A player who has seen the
 *   flattened circle must not mistake the mud tracks for it.
 * - **Readable from riding distance.** Something in each scene is large enough
 *   or moves enough to be noticed at a canter, because a cue you can only see
 *   while standing on it is a trigger with decoration.
 * - **Present from the first frame.** Nothing pops in when a flag flips. A
 *   world that reveals its landmarks on unlock cannot be explored, only cleared.
 *
 * Nothing here reads discovery state, so nothing here can leak a discovery the
 * player has not found - including the living herd, which stands on the crown
 * from the first frame exactly as the real thing would.
 */

export interface TraceScenes {
  readonly group: Group;
  readonly elementCount: number;
  readonly triangleCount: number;
  /** Discoveries realized here, so the generic cue layer can stand off them. */
  readonly handledIds: ReadonlySet<string>;
  /**
   * The herd has noticed the player, at this point on the ground.
   *
   * This is the whole of the ending. Heads come up, the herd turns to face
   * where the horse is standing and closes a little of the distance, and then
   * they go back to grazing around them. Nothing takes the camera, nothing
   * stops the player riding away mid-way through, and calling it twice is
   * harmless - it re-aims rather than replays.
   */
  gather(x: number, z: number, elapsedSeconds: number): void;
  /** Drives the living cues: grazing herd, drifting seed heads, water. */
  update(elapsedSeconds: number): void;
  dispose(): void;
}

/** Horses in the living herd. Enough to be a herd, few enough to be free. */
const HERD_SIZE = 9;
/** Hoofprints in the storm-beach trail. */
const PRINT_COUNT = 34;
/** Seed heads leaning around the resting circle. */
const SEED_HEAD_COUNT = 90;
/**
 * How long the herd takes to notice, turn, and come in.
 *
 * Slow on purpose. Anything quick reads as a scripted beat firing; at this
 * length a player who is riding past when it starts sees it happen behind them
 * and can turn round, which is the difference between an event and a cutscene.
 */
const GATHER_SECONDS = 14;
/** How close they come. Near enough to be with, far enough to still be wild. */
const HERD_STANDOFF_METRES = 6;
/** Slightly over life size, so the herd reads across open highland. */
const HERD_SCALE = 1.35;

export function createTraceScenes(
  manifest: WorldManifest,
  heightAt: (x: number, z: number) => number,
): TraceScenes {
  const group = new Group();
  group.name = "trace-scenes";

  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const track = <T extends BufferGeometry>(geometry: T): T => {
    geometries.push(geometry);
    return geometry;
  };
  const trackMaterial = <T extends Material>(material: T): T => {
    materials.push(material);
    return material;
  };

  let elementCount = 0;
  let triangleCount = 0;
  const handled = new Set<string>();

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const pitch = new Quaternion();
  const scale = new Vector3();
  const axisY = new Vector3(0, 1, 0);
  const axisX = new Vector3(1, 0, 0);
  const axisZ = new Vector3(0, 0, 1);

  const find = (id: string): CompiledDiscovery | undefined => {
    const discovery = manifest.discoveries.find((entry) => entry.id === id);
    if (discovery) handled.add(discovery.id);
    return discovery;
  };

  /** Adds an instanced mesh and books its cost. */
  const addInstanced = (
    name: string,
    geometry: BufferGeometry,
    material: Material,
    count: number,
    trianglesEach: number,
  ): InstancedMesh => {
    const mesh = new InstancedMesh(geometry, material, count);
    mesh.name = name;
    group.add(mesh);
    elementCount += count;
    triangleCount += trianglesEach * count;
    return mesh;
  };

  const addMesh = (name: string, geometry: BufferGeometry, material: Material): Mesh => {
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    geometry.computeBoundingSphere();
    group.add(mesh);
    elementCount += 1;
    triangleCount += geometry.getAttribute("position").count / 3;
    return mesh;
  };

  // --- 1. Storm beach: hoofprints out of the sea --------------------------
  /**
   * A line of prints coming up out of the water and stopping.
   *
   * Direction is the whole cue. They walk inland, they are deepest and wettest
   * at the sea end, and they stop where the sand turns to grass - which says,
   * without a word, that something came ashore here and kept going.
   */
  const beach = find("storm-beach-hoofprints");
  if (beach) {
    const geometry = track(new CircleGeometry(1, 8));
    const material = trackMaterial(
      new MeshBasicMaterial({ color: "#3b3226", transparent: true, opacity: 0.68 }),
    );
    const mesh = addInstanced("trace-beach-prints", geometry, material, PRINT_COUNT, 8);
    // Aimed inland, away from the island edge the trace sits on.
    const inlandX = -beach.position.x;
    const inlandZ = -beach.position.z;
    const length = Math.hypot(inlandX, inlandZ) || 1;
    const dirX = inlandX / length;
    const dirZ = inlandZ / length;
    for (let index = 0; index < PRINT_COUNT; index += 1) {
      const along = (index / 2 - PRINT_COUNT / 3) * 1.8;
      const side = (index % 2 === 0 ? 0.5 : -0.5) + Math.sin(index * 1.7) * 0.16;
      const x = beach.position.x + dirX * along - dirZ * side;
      const z = beach.position.z + dirZ * along + dirX * side;
      position.set(x, heightAt(x, z) + 0.05, z);
      quaternion.setFromAxisAngle(axisX, -Math.PI / 2);
      // Larger and darker at the sea end, fading as the sand dries inland.
      const wetness = 1 - index / PRINT_COUNT;
      const size = 0.3 + wetness * 0.16;
      scale.set(size, size * 1.4, 1);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();

    // Storm wrack thrown up the beach with them, so the scene reads as after
    // weather rather than as a tidy trail.
    const wrackGeometry = track(new BoxGeometry(1, 0.28, 0.28));
    const wrackMaterial = trackMaterial(
      new MeshStandardMaterial({ color: "#4a4238", roughness: 0.96 }),
    );
    const wrack = addInstanced("trace-beach-wrack", wrackGeometry, wrackMaterial, 14, 12);
    for (let index = 0; index < 14; index += 1) {
      const angle = index * 2.399;
      const radius = 5 + (index % 5) * 3.5;
      const x = beach.position.x + Math.cos(angle) * radius;
      const z = beach.position.z + Math.sin(angle) * radius;
      position.set(x, heightAt(x, z) + 0.12, z);
      // Turned, then tipped a little out of flat. Storm wrack does not lie
      // squared up, and fourteen identical bars all level with the sand read
      // as dropped props rather than as anything the sea did.
      quaternion.setFromAxisAngle(axisY, angle * 1.7);
      pitch.setFromAxisAngle(axisZ, ((index % 5) - 2) * 0.09);
      quaternion.multiply(pitch);
      const long = 1.6 + (index % 3) * 1.4;
      scale.set(long, 0.7 + (index % 3) * 0.25, 0.8 + (index % 4) * 0.2);
      matrix.compose(position, quaternion, scale);
      wrack.setMatrixAt(index, matrix);
    }
    wrack.instanceMatrix.needsUpdate = true;
    wrack.computeBoundingSphere();
  }

  // --- 2. Longgrass: the flattened resting circle -------------------------
  /**
   * A ring of grass pressed flat, with the standing grass leaning into it.
   *
   * Read from above as a disc of bare, combed ground; read from the saddle as a
   * break in an otherwise unbroken plain. The leaning seed heads around its rim
   * are the moving half - they are the only thing on the plain that is visibly
   * pointing at something.
   */
  const circle = find("longgrass-resting-circle-trace");
  const seedHeads: Array<{
    mesh: InstancedMesh;
    stalks: ReadonlyArray<{ x: number; z: number; ground: number; angle: number }>;
  }> = [];
  if (circle) {
    const discGeometry = track(new CircleGeometry(11, 26));
    const discMaterial = trackMaterial(
      new MeshStandardMaterial({ color: "#8f8a52", roughness: 0.98 }),
    );
    const disc = addMesh("trace-resting-circle", discGeometry, discMaterial);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(
      circle.position.x,
      heightAt(circle.position.x, circle.position.z) + 0.07,
      circle.position.z,
    );
    disc.castShadow = false;

    // Bodies' worth of deeper press inside the ring, so it reads as animals
    // rather than as a mown lawn.
    const hollowGeometry = track(new CircleGeometry(1, 10));
    const hollowMaterial = trackMaterial(
      new MeshBasicMaterial({ color: "#6f6a3e", transparent: true, opacity: 0.55 }),
    );
    const hollows = addInstanced("trace-resting-beds", hollowGeometry, hollowMaterial, 7, 10);
    for (let index = 0; index < 7; index += 1) {
      const angle = (index / 7) * Math.PI * 2 + 0.4;
      const radius = 3 + (index % 3) * 2.2;
      const x = circle.position.x + Math.cos(angle) * radius;
      const z = circle.position.z + Math.sin(angle) * radius;
      position.set(x, heightAt(x, z) + 0.09, z);
      quaternion.setFromAxisAngle(axisX, -Math.PI / 2);
      scale.set(2.1, 1.3, 1);
      matrix.compose(position, quaternion, scale);
      hollows.setMatrixAt(index, matrix);
    }
    hollows.instanceMatrix.needsUpdate = true;
    hollows.computeBoundingSphere();

    // The ring of standing grass around the press, leaning into it.
    //
    // Deliberately far taller than the ground cover it stands in - 2.6 metres
    // against tufts of well under one - because the first version was the same
    // height as the plain's own grass and simply disappeared into it. A cue
    // that is the same size, colour and shape as the thing it has to be seen
    // against is not a cue. Height is what makes the ring read as a rim, and
    // the inward lean is what makes the rim point at something.
    const headGeometry = track(new ConeGeometry(0.13, 2.6, 4));
    const headMaterial = trackMaterial(
      new MeshStandardMaterial({ color: "#d8c979", roughness: 0.95 }),
    );
    const heads = addInstanced(
      "trace-resting-seedheads",
      headGeometry,
      headMaterial,
      SEED_HEAD_COUNT,
      4,
    );
    heads.frustumCulled = false;
    heads.castShadow = true;
    // Seated per stalk rather than off one sample at the centre. The plain is
    // not flat, and a ring hung off the middle height buries half of itself on
    // the up slope and stands on air on the down slope.
    const stalks = Array.from({ length: SEED_HEAD_COUNT }, (_, index) => {
      const angle = (index / SEED_HEAD_COUNT) * Math.PI * 2 + (index % 3) * 0.04;
      const radius = 11.6 + (index % 4) * 1.15;
      const x = circle.position.x + Math.cos(angle) * radius;
      const z = circle.position.z + Math.sin(angle) * radius;
      return { x, z, ground: heightAt(x, z), angle };
    });
    seedHeads.push({ mesh: heads, stalks });
  }

  // --- 3. Fernwood: hair caught on bark -----------------------------------
  /**
   * The smallest of the five, and the only one that needs the player to stop.
   *
   * A rubbing post cannot be seen from a hundred metres, so the scene is built
   * in two ranges: a leaning dead trunk with its bark worn pale, which reads
   * from a distance as the one bright vertical in a dark wood, and the hair
   * itself, which only resolves close up. Finding the post is the navigation;
   * finding the hair is the reward for stopping.
   */
  const hair = find("fernwood-caught-hair");
  if (hair) {
    const hairGround = heightAt(hair.position.x, hair.position.z);

    // The stand the post is in.
    //
    // The first version put a single pale trunk on open grass, which said
    // nothing about a wood: hair caught on bark needs bark around it, or the
    // whole scene reads as a plank in a field. These are the near half of the
    // cue - a ring of dark trunks that closes the space in and makes the one
    // rubbed trunk the thing in the middle of it.
    const standTrunk = track(new CylinderGeometry(0.28, 0.42, 8.5, 6));
    const standBark = trackMaterial(
      new MeshStandardMaterial({ color: "#3d3227", roughness: 0.97 }),
    );
    const stand = addInstanced("trace-fernwood-stand", standTrunk, standBark, 14, 24);
    stand.castShadow = true;
    const canopyGeometry = track(new ConeGeometry(3.4, 5.2, 6));
    const canopyMaterial = trackMaterial(
      new MeshStandardMaterial({ color: "#1e3a1c", roughness: 0.96 }),
    );
    const canopies = addInstanced("trace-fernwood-canopy", canopyGeometry, canopyMaterial, 14, 12);
    canopies.castShadow = true;
    for (let index = 0; index < 14; index += 1) {
      // Scattered on a golden angle at varying radius, so the stand reads as
      // trees rather than as a planted circle - and a gap is left at the
      // centre for the post.
      const angle = index * 2.399;
      const radius = 6 + (index % 5) * 2.4;
      const x = hair.position.x + Math.cos(angle) * radius;
      const z = hair.position.z + Math.sin(angle) * radius;
      const ground = heightAt(x, z);
      const lean = ((index % 3) - 1) * 0.05;
      const tall = 0.85 + (index % 4) * 0.16;

      position.set(x, ground + 4.25 * tall, z);
      quaternion.setFromAxisAngle(axisZ, lean);
      scale.set(1, tall, 1);
      matrix.compose(position, quaternion, scale);
      stand.setMatrixAt(index, matrix);

      position.set(x, ground + (8.5 * tall) - 1.4, z);
      quaternion.setFromAxisAngle(axisY, angle * 1.7);
      scale.set(tall, tall, tall);
      matrix.compose(position, quaternion, scale);
      canopies.setMatrixAt(index, matrix);
    }
    stand.instanceMatrix.needsUpdate = true;
    stand.computeBoundingSphere();
    canopies.instanceMatrix.needsUpdate = true;
    canopies.computeBoundingSphere();

    // The post itself: dark bark, so the worn band on it is the bright thing
    // rather than the whole trunk being bright and the band invisible against
    // it, which is what the first version did.
    const trunkGeometry = track(new CylinderGeometry(0.55, 0.8, 6.4, 8));
    const trunkMaterial = trackMaterial(
      new MeshStandardMaterial({ color: "#4a3b2c", roughness: 0.96 }),
    );
    const trunk = addMesh("trace-rubbing-post", trunkGeometry, trunkMaterial);
    trunk.position.set(hair.position.x, hairGround + 3, hair.position.z);
    trunk.rotation.z = 0.22;

    // The worn band, at the height a horse's shoulder actually reaches, and
    // standing proud of the trunk so it is a shape and not just a colour.
    const wornGeometry = track(new CylinderGeometry(0.78, 0.78, 1.1, 8));
    const wornMaterial = trackMaterial(
      new MeshStandardMaterial({ color: "#e6dcc4", roughness: 0.72 }),
    );
    const worn = addMesh("trace-rubbing-band", wornGeometry, wornMaterial);
    worn.position.set(hair.position.x + 0.32, hairGround + 1.5, hair.position.z);
    worn.rotation.z = 0.22;

    // The hair: a few dark strands caught on the worn band.
    const strandGeometry = track(new BoxGeometry(0.05, 0.7, 0.05));
    const strandMaterial = trackMaterial(
      new MeshBasicMaterial({ color: "#1a1109" }),
    );
    const strands = addInstanced("trace-caught-hair", strandGeometry, strandMaterial, 14, 12);
    for (let index = 0; index < 14; index += 1) {
      const angle = index * 1.31;
      // On the surface of the band, hanging down from it.
      const x = hair.position.x + 0.32 + Math.cos(angle) * 0.8;
      const z = hair.position.z + Math.sin(angle) * 0.8;
      position.set(x, hairGround + 1.42, z);
      quaternion.setFromAxisAngle(axisY, angle);
      scale.set(1, 0.7 + (index % 3) * 0.4, 1);
      matrix.compose(position, quaternion, scale);
      strands.setMatrixAt(index, matrix);
    }
    strands.instanceMatrix.needsUpdate = true;
    strands.computeBoundingSphere();
  }

  // --- 4. River hollow: tracks in the mud ---------------------------------
  /**
   * Prints crossing wet ground, and the wet ground itself.
   *
   * The mud is the long-range cue: a dark, wet, reflective patch against the
   * hollow's pale silver-green is visible across the valley, and the tracks
   * only resolve as you come down to it. They cross the mud rather than
   * following it, which says the herd was going somewhere rather than drinking.
   */
  const mud = find("river-spring-tracks");
  if (mud) {
    const mudGeometry = track(new CircleGeometry(9.5, 20));
    const mudMaterial = trackMaterial(
      new MeshStandardMaterial({ color: "#3a3730", roughness: 0.42, metalness: 0.05 }),
    );
    const patch = addMesh("trace-mud-patch", mudGeometry, mudMaterial);
    patch.rotation.x = -Math.PI / 2;
    patch.position.set(
      mud.position.x,
      heightAt(mud.position.x, mud.position.z) + 0.06,
      mud.position.z,
    );
    patch.castShadow = false;

    const printGeometry = track(new CircleGeometry(1, 7));
    const printMaterial = trackMaterial(
      new MeshBasicMaterial({ color: "#1d1a15", transparent: true, opacity: 0.8 }),
    );
    const prints = addInstanced("trace-mud-prints", printGeometry, printMaterial, 22, 7);
    for (let index = 0; index < 22; index += 1) {
      // A single crossing line, at an angle to the patch.
      const along = (index / 2 - 5.5) * 1.7;
      const side = index % 2 === 0 ? 0.45 : -0.45;
      const x = mud.position.x + along * 0.82 - side * 0.57;
      const z = mud.position.z + along * 0.57 + side * 0.82;
      position.set(x, heightAt(x, z) + 0.1, z);
      quaternion.setFromAxisAngle(axisX, -Math.PI / 2);
      scale.set(0.34, 0.46, 1);
      matrix.compose(position, quaternion, scale);
      prints.setMatrixAt(index, matrix);
    }
    prints.instanceMatrix.needsUpdate = true;
    prints.computeBoundingSphere();

    // Reeds around the wet ground, so the patch reads as spring rather than
    // as burnt grass.
    const reedGeometry = track(new ConeGeometry(0.06, 1.5, 4));
    const reedMaterial = trackMaterial(
      new MeshStandardMaterial({ color: "#6d8a63", roughness: 0.95 }),
    );
    const reeds = addInstanced("trace-mud-reeds", reedGeometry, reedMaterial, 46, 4);
    for (let index = 0; index < 46; index += 1) {
      const angle = index * 2.399;
      const radius = 9 + (index % 4) * 1.6;
      const x = mud.position.x + Math.cos(angle) * radius;
      const z = mud.position.z + Math.sin(angle) * radius;
      position.set(x, heightAt(x, z) + 0.75, z);
      quaternion.setFromAxisAngle(axisY, angle);
      scale.set(1, 0.7 + (index % 4) * 0.3, 1);
      matrix.compose(position, quaternion, scale);
      reeds.setMatrixAt(index, matrix);
    }
    reeds.instanceMatrix.needsUpdate = true;
    reeds.computeBoundingSphere();
  }

  // --- 5. Blackstone: the living herd -------------------------------------
  /**
   * Horses, standing and grazing in the high pasture.
   *
   * The only one of the five that is alive, and the only cue on the island that
   * is a *body* rather than a mark left by one. They stand in the saddle
   * between the two shards, they graze and shift where they stand, and they are
   * there from the first frame - so a player who climbs the crown early finds
   * them early, exactly as they would if this were a real hillside.
   *
   * They are silhouettes at range and recognisably horses close up, which is
   * the whole cue: the thing the player has been following the marks of for
   * twenty minutes is finally the thing itself.
   */
  const herd = find("blackstone-living-herd");
  const grazing: Array<{
    mesh: InstancedMesh;
    members: ReadonlyArray<{ x: number; z: number; ground: number; yaw: number; phase: number }>;
  }> = [];
  if (herd) {
    const bodyGeometry = track(createGrazingHorseGeometry());
    const bodyTriangles = bodyGeometry.getAttribute("position").count / 3;
    const bodyMaterial = trackMaterial(
      // White base: instance colour multiplies it, so the herd has coats.
      new MeshStandardMaterial({ color: "#ffffff", roughness: 0.9, metalness: 0 }),
    );
    const mesh = addInstanced(
      "trace-living-herd",
      bodyGeometry,
      bodyMaterial,
      HERD_SIZE,
      bodyTriangles,
    );
    mesh.castShadow = true;
    mesh.frustumCulled = false;

    const coats = [
      new Color("#6b4b31"),
      new Color("#7d5a3a"),
      new Color("#4a3527"),
      new Color("#8a6a45"),
      new Color("#3d2f24"),
    ];
    const members = Array.from({ length: HERD_SIZE }, (_, index) => {
      // A loose scatter rather than a ring: a herd at rest is not arranged.
      //
      // Tighter than the first version, which spread them over forty metres of
      // open hillside and read as nine separate animals rather than as a herd.
      // Proximity is most of what makes a group of animals one thing.
      const angle = index * 2.399;
      const radius = 3.5 + (index % 4) * 3.2;
      const x = herd.position.x + Math.cos(angle) * radius;
      const z = herd.position.z + Math.sin(angle) * radius * 0.8;
      mesh.setColorAt(index, coats[index % coats.length]!);
      return {
        x,
        z,
        ground: heightAt(x, z),
        yaw: angle * 1.7,
        phase: index * 0.83,
      };
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    grazing.push({ mesh, members });
  }

  // --- the two resting hollows and the two cuts ---------------------------
  /**
   * Quieter than the traces on purpose.
   *
   * These are optional, so they must be findable without competing with the
   * five that carry the story. A hollow gets a ring of sheltering stone; a cut
   * gets a line of worn ground. Both read as "something happens here" without
   * reading as "come here next".
   */
  for (const hollow of manifest.discoveries.filter((d) => d.type === "resting-hollow")) {
    const stoneGeometry = track(new SphereGeometry(1, 6, 4));
    const stoneMaterial = trackMaterial(
      new MeshStandardMaterial({ color: "#7f7a70", roughness: 0.95 }),
    );
    const stones = addInstanced(`hollow-stones-${hollow.id}`, stoneGeometry, stoneMaterial, 9, 24);
    for (let index = 0; index < 9; index += 1) {
      const angle = (index / 9) * Math.PI * 2 + 0.6;
      const radius = 7.5 + (index % 3) * 1.2;
      const x = hollow.position.x + Math.cos(angle) * radius;
      const z = hollow.position.z + Math.sin(angle) * radius;
      const size = 0.9 + (index % 4) * 0.35;
      position.set(x, heightAt(x, z) + size * 0.35, z);
      quaternion.setFromAxisAngle(axisY, angle * 2.1);
      scale.set(size * 1.3, size * 0.8, size);
      matrix.compose(position, quaternion, scale);
      stones.setMatrixAt(index, matrix);
    }
    stones.instanceMatrix.needsUpdate = true;
    stones.computeBoundingSphere();
  }

  for (const cut of manifest.discoveries.filter((d) => d.type === "shortcut")) {
    const wearGeometry = track(new CircleGeometry(1, 6));
    const wearMaterial = trackMaterial(
      new MeshBasicMaterial({ color: "#5a5040", transparent: true, opacity: 0.45 }),
    );
    const wear = addInstanced(`cut-wear-${cut.id}`, wearGeometry, wearMaterial, 20, 6);
    // Aimed inland, which is where every cut goes: they are the inside line.
    const towardX = -cut.position.x;
    const towardZ = -cut.position.z;
    const length = Math.hypot(towardX, towardZ) || 1;
    for (let index = 0; index < 20; index += 1) {
      const along = (index - 10) * 2.4;
      const x = cut.position.x + (towardX / length) * along;
      const z = cut.position.z + (towardZ / length) * along;
      position.set(x, heightAt(x, z) + 0.05, z);
      quaternion.setFromAxisAngle(axisX, -Math.PI / 2);
      scale.set(1.5, 2.6, 1);
      matrix.compose(position, quaternion, scale);
      wear.setMatrixAt(index, matrix);
    }
    wear.instanceMatrix.needsUpdate = true;
    wear.computeBoundingSphere();
  }

  let disposed = false;

  /**
   * Where the herd is looking, and since when.
   *
   * `at` is null until something is noticed, which is the state the whole
   * island spends its time in. It is deliberately not a large negative number:
   * the first version used -1000 as "never", and `elapsed - (-1000)` is a
   * thousand seconds of elapsed notice, so the herd spent every frame fully
   * alerted and walking towards `(0, 0)` - the world origin, four hundred
   * metres off the crown. A sentinel that is a valid value of the thing it
   * stands for is not a sentinel.
   *
   * The gather runs over `GATHER_SECONDS` and then holds: the herd keeps facing
   * the player and grazing near them rather than snapping back, because a herd
   * that forgets you the moment the caption fades is not an ending.
   */
  const notice: { at: number | null; x: number; z: number } = { at: null, x: 0, z: 0 };

  return {
    group,
    elementCount,
    triangleCount,
    handledIds: handled,

    gather(x, z, elapsedSeconds) {
      notice.at = elapsedSeconds;
      notice.x = x;
      notice.z = z;
    },

    update(elapsedSeconds) {
      if (disposed) return;

      // The ring of tall grass around the resting circle, leaning into it and
      // drifting in the wind. The lean is the cue; the drift is what makes the
      // lean read as grass rather than as a fence.
      for (const bank of seedHeads) {
        bank.stalks.forEach((stalk, index) => {
          const sway = Math.sin(elapsedSeconds * 0.8 + index * 0.35) * 0.12;
          position.set(stalk.x, stalk.ground + 1.15, stalk.z);
          // Turned to face the centre, then tipped over towards it.
          quaternion.setFromAxisAngle(axisY, -stalk.angle);
          pitch.setFromAxisAngle(axisX, 0.5 + sway);
          quaternion.multiply(pitch);
          scale.set(1, 1, 1);
          matrix.compose(position, quaternion, scale);
          bank.mesh.setMatrixAt(index, matrix);
        });
        bank.mesh.instanceMatrix.needsUpdate = true;
      }

      // How much the herd has noticed the player, from 0 to 1. It rises over
      // the gather and then stays up - they do not go back to ignoring you.
      const noticed =
        notice.at === null
          ? 0
          : Math.min(1, Math.max(0, (elapsedSeconds - notice.at) / GATHER_SECONDS));

      // The herd, grazing. Heads dip and lift on their own clocks and each
      // animal shifts a little where it stands, which is what separates a herd
      // from nine statues at this distance.
      //
      // Once they have noticed, the same three numbers bend rather than being
      // replaced: heads stop going down, the yaw turns towards the player, and
      // each animal walks a short way in. It is one continuous motion out of
      // grazing into attention, which is what stops the ending reading as a
      // state flip.
      for (const band of grazing) {
        band.members.forEach((member, index) => {
          const clock = elapsedSeconds * 0.35 + member.phase;
          const graze = Math.sin(clock);
          const shift = Math.sin(elapsedSeconds * 0.21 + member.phase * 1.7);

          // Each horse closes part of the distance, and stops short: they meet
          // the player, they do not converge on a point and stand in them.
          const toX = notice.x - member.x;
          const toZ = notice.z - member.z;
          const range = Math.hypot(toX, toZ) || 1;
          const approach =
            noticed > 0 ? Math.min(range - HERD_STANDOFF_METRES, range * 0.45) : 0;
          const step = Math.max(0, approach) * noticed;
          const x = member.x + shift * 0.8 + (toX / range) * step;
          const z = member.z + Math.cos(clock * 0.6) * 0.5 + (toZ / range) * step;

          position.set(x, heightAt(x, z), z);
          const facing = Math.atan2(toX, toZ);
          quaternion.setFromAxisAngle(
            axisY,
            angleTowards(member.yaw + shift * 0.25, facing, noticed),
          );
          // Nose down to the grass and back up, which is the whole animation -
          // until they are watching, and then the head simply stays up.
          pitch.setFromAxisAngle(axisX, Math.max(0, graze) * 0.34 * (1 - noticed));
          quaternion.multiply(pitch);
          // A shade larger than life. These have to read as horses - the same
          // animal the player is - from the far side of the crown, and at true
          // scale on an open highland they are specks.
          scale.set(HERD_SCALE, HERD_SCALE, HERD_SCALE);
          matrix.compose(position, quaternion, scale);
          band.mesh.setMatrixAt(index, matrix);
        });
        band.mesh.instanceMatrix.needsUpdate = true;
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const child of group.children) {
        if (child instanceof Mesh || child instanceof InstancedMesh) child.clear();
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}

/**
 * Turn `from` towards `to` by `amount`, the short way round.
 *
 * Interpolating raw angles takes the long way whenever the pair straddles ±π,
 * which would spin a horse most of a full turn to face something a few degrees
 * off its shoulder.
 */
function angleTowards(from: number, to: number, amount: number): number {
  const difference = ((to - from + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return from + difference * amount;
}

/**
 * One grazing horse, merged once and instanced across the herd.
 *
 * Larger and simpler than the crossing wildlife, because these have to read as
 * *horses* - the same animal the player is - from two hundred metres. The
 * silhouette does that work: a long barrel on four legs with a low neck and a
 * tail, at roughly the player's own proportions.
 */
function createGrazingHorseGeometry(): BufferGeometry {
  const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
  const scaled = (x: number, y: number, z: number) => new Matrix4().makeScale(x, y, z);
  const leg = (x: number, z: number) => ({
    geometry: new ConeGeometry(0.09, 1.05, 4),
    matrix: at(x, 0.52, z).multiply(new Matrix4().makeRotationX(Math.PI)),
  });

  return mergeGeometries([
    // Barrel. Narrower than it is long, so the animal has a side and a front.
    {
      geometry: new SphereGeometry(0.52, 7, 5),
      matrix: at(0, 1.16, 0).multiply(scaled(0.72, 0.8, 1.65)),
    },
    // Haunch and chest.
    { geometry: new SphereGeometry(0.44, 6, 5), matrix: at(0, 1.2, -0.6) },
    { geometry: new SphereGeometry(0.4, 6, 5), matrix: at(0, 1.16, 0.62) },
    // Neck, carried low and long: these animals are grazing, not watching.
    //
    // Length is what separates a horse from a sheep at this scale. The first
    // version had a 0.8 m neck on a 1.5 m barrel, which from any distance read
    // as a round body with a bump on the front.
    {
      geometry: new ConeGeometry(0.2, 1.25, 6),
      matrix: at(0, 1.0, 1.15).multiply(new Matrix4().makeRotationX(1.1)),
    },
    {
      geometry: new SphereGeometry(0.17, 6, 5),
      matrix: at(0, 0.62, 1.62).multiply(scaled(0.8, 0.8, 1.5)),
    },
    leg(-0.24, 0.46),
    leg(0.24, 0.46),
    leg(-0.24, -0.5),
    leg(0.24, -0.5),
    // Tail.
    {
      geometry: new ConeGeometry(0.1, 0.62, 4),
      matrix: at(0, 1.15, -1.02).multiply(new Matrix4().makeRotationX(-0.5)),
    },
  ]);
}
