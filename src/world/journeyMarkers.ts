import {
  CircleGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from "three";
import type { WorldManifest } from "../game/world/compiler/worldTypes";

/**
 * The living half of the journey: the cues a player can actually navigate by.
 *
 * The compiled placements already put built form at each discovery - a cairn, a
 * spring, scattered stones. Silhouettes alone are not enough to find anything
 * with. Standing still, they are indistinguishable from the scatter that is
 * everywhere else on the island, and the authored signals the world spec names
 * are mostly things that *move* or *sound*: water you can hear, birds lifting,
 * animals crossing the grass, late light on the ridge.
 *
 * So this layer adds motion and ground marking, and it is built to a rule: every
 * destination that matters gets at least two cues that work from different
 * distances - one silhouette or ground mark readable from close in, and one
 * moving cue readable from far off. A player who cannot hear the game must lose
 * nothing, which means no cue here may be audio-only.
 *
 * Everything is present from the first frame whether or not the discovery has
 * been revealed. A world that pops its landmarks in when a flag flips is a world
 * that cannot be explored, only unlocked.
 */

export interface JourneyMarkers {
  readonly group: Group;
  readonly elementCount: number;
  readonly triangleCount: number;
  /** A call was answered from here: birds lift in that direction. */
  answer(x: number, z: number, elapsedSeconds: number): void;
  update(elapsedSeconds: number): void;
  dispose(): void;
}

const TRACK_COUNT = 26;
const MIST_COUNT = 16;

export interface JourneyMarkerOptions {
  /**
   * Discoveries that already have a scene of their own and must not also be
   * given the generic treatment below.
   *
   * The first island has five herd traces, and the generic cue set would stamp
   * the same two rows of hoofprints and the same circling flock on every one of
   * them - five places that are supposed to feel like five different places,
   * rendered identically. `traceScenes` builds those five individually, so it
   * names them here and this layer leaves them alone. Anything it does not
   * claim - including the whole Milestone 4 slice - still gets the generic
   * cues, which is what keeps that world renderable from the same source.
   */
  readonly skipDiscoveryIds?: ReadonlySet<string>;
}

export function createJourneyMarkers(
  manifest: WorldManifest,
  heightAt: (x: number, z: number) => number,
  options: JourneyMarkerOptions = {},
): JourneyMarkers {
  const group = new Group();
  group.name = "journey-markers";

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

  const matrix = new Matrix4();
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const axisY = new Vector3(0, 1, 0);

  const claimed = options.skipDiscoveryIds ?? new Set<string>();
  const byType = (type: string) =>
    manifest.discoveries.filter(
      (discovery) => discovery.type === type && !claimed.has(discovery.id),
    );

  // --- hoofprints ---------------------------------------------------------
  /**
   * The herd trace, as tracks on the ground.
   *
   * Two rows of prints, walking pace apart, aimed from the trace towards the
   * spring. Direction is the point: a player who finds the prints has also been
   * told, without a word, where whatever made them went.
   */
  const hoofprints = byType("herd-trace").flatMap((trace) => {
    const spring = byType("resting-hollow")[0];
    const towardX = (spring?.position.x ?? trace.position.x) - trace.position.x;
    const towardZ = (spring?.position.z ?? trace.position.z + 1) - trace.position.z;
    const length = Math.hypot(towardX, towardZ) || 1;
    const dirX = towardX / length;
    const dirZ = towardZ / length;
    // Perpendicular, for the left and right files of a walking animal.
    const sideX = -dirZ;
    const sideZ = dirX;

    const prints: Array<{ x: number; z: number; yaw: number; scale: number }> = [];
    for (let index = 0; index < TRACK_COUNT; index += 1) {
      // Weighted forward: a few prints arrive at the trace and the rest lead
      // away towards the spring, ninety-odd metres off. Centring the trail read
      // as a herd milling on the spot instead of passing through.
      const along = (index / 2 - TRACK_COUNT / 8) * 1.5;
      const side = (index % 2 === 0 ? 0.42 : -0.42) + Math.sin(index * 2.3) * 0.12;
      prints.push({
        x: trace.position.x + dirX * along + sideX * side,
        z: trace.position.z + dirZ * along + sideZ * side,
        yaw: Math.atan2(dirX, dirZ),
        scale: 0.34 + (index % 3) * 0.04,
      });
    }
    return prints;
  });

  if (hoofprints.length > 0) {
    // Flat discs laid just above the ground. Unlit and dark, so they read as
    // pressed earth rather than as objects sitting on the grass.
    const geometry = track(new CircleGeometry(1, 7));
    const material = trackMaterial(
      new MeshBasicMaterial({ color: "#4a3f2e", transparent: true, opacity: 0.55 }),
    );
    const mesh = new InstancedMesh(geometry, material, hoofprints.length);
    mesh.name = "journey-hoofprints";
    for (const [index, print] of hoofprints.entries()) {
      position.set(print.x, heightAt(print.x, print.z) + 0.045, print.z);
      quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
      scale.set(print.scale, print.scale * 1.35, 1);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    elementCount += hoofprints.length;
    triangleCount += 7 * hoofprints.length;
  }

  // --- spring mist --------------------------------------------------------
  /**
   * Rising mist over the resting hollow.
   *
   * The spec's cue for the spring is a sound - running water audible from the
   * forest approach - and this is its visual equal. Slow vertical drift is
   * visible against dark fernwood from much further away than still water is,
   * which is what makes it a wayfinding cue rather than decoration.
   */
  // Only the hollows the world says have running water. The first island has
  // two: a spring under a waterfall notch, and a dry grass bowl on the plain.
  // Mist off the dry one would be a lie the player can see, so the sound signal
  // the spec already writes decides it rather than a hand-kept list.
  const springs = byType("resting-hollow").filter((hollow) =>
    hollow.signals.some((signal) => signal.kind === "sound"),
  );
  const mist: Array<{ mesh: InstancedMesh; x: number; z: number; ground: number }> = [];
  for (const spring of springs) {
    const geometry = track(new SphereGeometry(1, 7, 5));
    const material = trackMaterial(
      new MeshBasicMaterial({
        color: "#dfe9ea",
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
    );
    const mesh = new InstancedMesh(geometry, material, MIST_COUNT);
    mesh.name = `journey-mist-${spring.id}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    group.add(mesh);
    mist.push({
      mesh,
      x: spring.position.x,
      z: spring.position.z,
      ground: heightAt(spring.position.x, spring.position.z),
    });
    elementCount += MIST_COUNT;
    triangleCount += 7 * 5 * 2 * MIST_COUNT;
  }

  // The journey's birds and its one line of crossing animals used to be built
  // here. Both were props for a story this island no longer tells: two flocks
  // over two authored points, and six animals shuttling along a fixed line.
  // What lives on the island now lives there because it lives there, scattered
  // across the whole of it - see islandWildlife.ts.

  const disposed = { value: false };

  return {
    group,
    elementCount,
    triangleCount,

    answer() {
      // Nothing lifts on cue any more. The birds that used to burst out of
      // the trees when a call was answered belonged to the journey; the flocks
      // on the island now fly their own circuits and are not listening.
    },

    update(elapsedSeconds) {
      if (disposed.value) return;

      for (const bank of mist) {
        for (let index = 0; index < MIST_COUNT; index += 1) {
          // Each puff runs its own slow rise and fades out near the top, so the
          // column never reads as a fixed object.
          const phase = (elapsedSeconds * 0.13 + index / MIST_COUNT) % 1;
          const angle = index * 2.399 + elapsedSeconds * 0.05;
          // Held close to the water and low. An earlier version rose four
          // metres on two-metre puffs, which from the far side of the hollow
          // read as translucent panels standing in the sky rather than as
          // anything coming off a pool.
          const spread = 0.7 + phase * 1.5;
          position.set(
            bank.x + Math.cos(angle) * spread,
            bank.ground + 0.25 + phase * 1.5,
            bank.z + Math.sin(angle) * spread,
          );
          const size = (0.34 + phase * 0.5) * (1 - phase * 0.55);
          quaternion.setFromAxisAngle(axisY, angle);
          scale.set(size, size * 0.55, size);
          matrix.compose(position, quaternion, scale);
          bank.mesh.setMatrixAt(index, matrix);
        }
        bank.mesh.instanceMatrix.needsUpdate = true;
      }

    },

    dispose() {
      if (disposed.value) return;
      disposed.value = true;
      for (const child of group.children) {
        if (child instanceof Mesh || child instanceof InstancedMesh) child.clear();
      }
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}


