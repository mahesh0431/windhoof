import {
  Color,
  CircleGeometry,
  ConeGeometry,
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

/** Birds per flock. Enough to read as a flock, few enough to cost nothing. */
const FLOCK_SIZE = 14;
const TRACK_COUNT = 26;
const MIST_COUNT = 16;
const HERD_SIZE = 6;

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
  const pitch = new Quaternion();
  const axisY = new Vector3(0, 1, 0);
  const axisX = new Vector3(1, 0, 0);

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

  // --- overlook birds -----------------------------------------------------
  /**
   * A flock turning over the high ground.
   *
   * The overlook's authored cues are a silhouette and late light, both of which
   * are static and both of which are easy to miss against a treeline. Circling
   * birds are the one thing on this island that moves against the sky, so they
   * carry from anywhere with a view of the ridge - and they say "high ground"
   * without saying anything.
   */
  const flocks: Array<{
    mesh: InstancedMesh;
    x: number;
    z: number;
    height: number;
    radius: number;
    speed: number;
    /** Set when a call is answered from here: the flock scatters upward. */
    burstAt: number;
  }> = [];

  const birdGeometry = track(new ConeGeometry(0.32, 1.5, 3, 1, true));
  const birdMaterial = trackMaterial(
    new MeshBasicMaterial({ color: "#2b2f2c", transparent: true, opacity: 0.72 }),
  );

  const addFlock = (x: number, z: number, height: number, radius: number, speed: number) => {
    const mesh = new InstancedMesh(birdGeometry, birdMaterial, FLOCK_SIZE);
    mesh.name = "journey-flock";
    mesh.frustumCulled = false;
    group.add(mesh);
    flocks.push({ mesh, x, z, height, radius, speed, burstAt: -1000 });
    elementCount += FLOCK_SIZE;
    triangleCount += 3 * FLOCK_SIZE;
  };

  for (const overlook of byType("overlook")) {
    addFlock(
      overlook.position.x,
      overlook.position.z,
      heightAt(overlook.position.x, overlook.position.z) + 26,
      22,
      0.16,
    );
  }
  // A second flock over the herd trace, which is where an answering call comes
  // from. It rides low and slow until something startles it.
  for (const trace of byType("herd-trace")) {
    addFlock(
      trace.position.x,
      trace.position.z,
      heightAt(trace.position.x, trace.position.z) + 14,
      13,
      0.1,
    );
  }
  // And one over the high ground a call is answered from. This is the flock
  // `answer()` finds on the first island: the answer comes off the crown, so
  // the birds that lift have to be the crown's, not the nearest trace's.
  for (const answer of manifest.journeyEvents) {
    addFlock(
      answer.position.x,
      answer.position.z,
      heightAt(answer.position.x, answer.position.z) + 30,
      26,
      0.13,
    );
  }

  // --- wildlife crossing --------------------------------------------------
  /**
   * Animals crossing the plain.
   *
   * The only authored discovery with no built form at all, and the only one
   * whose cues are entirely motion: small animals crossing toward shelter, and
   * grass moving ahead of them. Without this the crossing is an invisible circle
   * on open ground, which is not a discovery, it is a trigger.
   *
   * They walk a fixed line back and forth rather than wandering: repeatable
   * motion is what lets a player see them from a distance, decide to go and
   * look, and still find something there when they arrive.
   */
  const crossings: Array<{
    mesh: InstancedMesh;
    x: number;
    z: number;
    dirX: number;
    dirZ: number;
    span: number;
  }> = [];

  const bodyGeometry = track(createCrossingAnimalGeometry());
  const bodyTriangles = bodyGeometry.getAttribute("position").count / 3;
  const bodyMaterial = trackMaterial(
    // White, because the per-instance colour multiplies it. A herd of six
    // identical clones reads as six copies of one object; a little variation in
    // coat is the cheapest thing that makes them read as animals.
    new MeshStandardMaterial({ color: "#ffffff", roughness: 0.92, metalness: 0 }),
  );
  const coats = [
    new Color("#8a6f4a"),
    new Color("#7a6242"),
    new Color("#9a7d55"),
    new Color("#6f5a3e"),
  ];

  for (const crossing of byType("wildlife-event")) {
    const mesh = new InstancedMesh(bodyGeometry, bodyMaterial, HERD_SIZE);
    mesh.name = `journey-wildlife-${crossing.id}`;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    for (let index = 0; index < HERD_SIZE; index += 1) {
      mesh.setColorAt(index, coats[index % coats.length]!);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    // Across the region rather than along it, so the line of travel cuts the
    // player's likely approach instead of running away from it.
    const angle = Math.atan2(crossing.position.x, crossing.position.z) + Math.PI / 2;
    crossings.push({
      mesh,
      x: crossing.position.x,
      z: crossing.position.z,
      dirX: Math.sin(angle),
      dirZ: Math.cos(angle),
      span: 26,
    });
    elementCount += HERD_SIZE;
    triangleCount += bodyTriangles * HERD_SIZE;
  }

  const disposed = { value: false };

  return {
    group,
    elementCount,
    triangleCount,

    answer(x, z, elapsedSeconds) {
      // Whichever flock is nearest the answering call is the one that lifts.
      let nearest: (typeof flocks)[number] | null = null;
      let best = Infinity;
      for (const flock of flocks) {
        const distance = Math.hypot(flock.x - x, flock.z - z);
        if (distance < best) {
          best = distance;
          nearest = flock;
        }
      }
      if (nearest) nearest.burstAt = elapsedSeconds;
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

      for (const flock of flocks) {
        const sinceBurst = elapsedSeconds - flock.burstAt;
        // A burst throws the flock up and outward, then it settles back over
        // about twelve seconds - long enough to be seen from across the plain.
        const burst = sinceBurst >= 0 && sinceBurst < 12 ? 1 - sinceBurst / 12 : 0;
        for (let index = 0; index < FLOCK_SIZE; index += 1) {
          const offset = index * 0.41;
          const angle = elapsedSeconds * flock.speed * (1 + burst * 2.5) + offset * Math.PI * 2;
          const radius = flock.radius * (0.55 + (index % 4) * 0.16) * (1 + burst * 0.9);
          const bob = Math.sin(elapsedSeconds * 1.7 + offset * 6) * 0.9;
          position.set(
            flock.x + Math.cos(angle) * radius,
            flock.height + bob + burst * 16 + (index % 5) * 1.4,
            flock.z + Math.sin(angle) * radius,
          );
          // Nose along the direction of travel, banked slightly into the turn.
          quaternion.setFromAxisAngle(axisY, -angle);
          scale.set(1, 1, 1);
          matrix.compose(position, quaternion, scale);
          flock.mesh.setMatrixAt(index, matrix);
        }
        flock.mesh.instanceMatrix.needsUpdate = true;
      }

      for (const crossing of crossings) {
        for (let index = 0; index < HERD_SIZE; index += 1) {
          // A slow shuttle along the line, strung out with a per-animal lag so
          // they move as a loose group rather than a rank.
          const phase = elapsedSeconds * 0.055 + index * 0.06;
          const along = Math.sin(phase * Math.PI) * crossing.span;
          const drift = ((index % 3) - 1) * 2.2;
          const x = crossing.x + crossing.dirX * along - crossing.dirZ * drift;
          const z = crossing.z + crossing.dirZ * along + crossing.dirX * drift;
          // A bounding hop rather than a walk cycle.
          //
          // All six animals share one instanced mesh, so their legs cannot move
          // independently of their bodies - and a quadruped gliding along on
          // rigid legs is worse than no gait at all. Small animals breaking from
          // cover bound, so the whole body leaves the ground together, which is
          // a motion this rig can actually perform honestly.
          const bound = Math.pow(
            Math.max(0, Math.sin(phase * Math.PI * 11 + index * 1.7)),
            1.6,
          );
          position.set(x, heightAt(x, z) + bound * 0.26, z);
          const facing = Math.cos(phase * Math.PI) >= 0 ? 0 : Math.PI;
          quaternion.setFromAxisAngle(axisY, Math.atan2(crossing.dirX, crossing.dirZ) + facing);
          // Nose up leaving the ground, down landing, which is what sells the
          // arc as weight rather than as a bobbing prop.
          pitch.setFromAxisAngle(
            axisX,
            Math.cos(phase * Math.PI * 11 + index * 1.7) * bound * 0.5,
          );
          quaternion.multiply(pitch);
          scale.set(1, 1, 1);
          matrix.compose(position, quaternion, scale);
          crossing.mesh.setMatrixAt(index, matrix);
        }
        crossing.mesh.instanceMatrix.needsUpdate = true;
        crossing.mesh.computeBoundingSphere();
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

/**
 * One small four-legged animal, built once and instanced six times.
 *
 * The crossing is the only authored discovery with no built form and no sound
 * of its own: motion is the entire cue. It was standing in as bare boxes, which
 * carried the movement but fell apart the moment a player looked straight at
 * them, and a discovery that dissolves on inspection is worse than one that is
 * merely hard to see.
 *
 * Built from the same faceted primitives as everything else on the island and
 * merged into a single geometry, so the whole herd stays one draw call. The
 * silhouette is doing all the work here - legs under a raised head, read at
 * fifty metres against grass - so the head is deliberately larger and higher
 * than an anatomist would put it.
 */
function createCrossingAnimalGeometry(): BufferGeometry {
  const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
  const scaled = (x: number, y: number, z: number) => new Matrix4().makeScale(x, y, z);
  /** A leg: a narrow cone, apex down, so it tapers to a foot. */
  const leg = (x: number, z: number) => ({
    geometry: new ConeGeometry(0.05, 0.44, 4),
    matrix: at(x, 0.22, z).multiply(new Matrix4().makeRotationX(Math.PI)),
  });
  /** An ear, laid back along the skull. */
  const ear = (x: number) => ({
    geometry: new ConeGeometry(0.035, 0.14, 4),
    matrix: at(x, 0.8, 0.46).multiply(new Matrix4().makeRotationX(-0.5)),
  });

  return mergeGeometries([
    {
      // Barrel.
      geometry: new SphereGeometry(0.26, 6, 4),
      matrix: at(0, 0.46, 0).multiply(scaled(0.78, 0.8, 1.45)),
    },
    {
      // Haunch, the heaviest mass and the one that reads from behind.
      geometry: new SphereGeometry(0.21, 6, 4),
      matrix: at(0, 0.48, -0.26).multiply(scaled(1, 1, 0.92)),
    },
    {
      // Chest.
      geometry: new SphereGeometry(0.18, 6, 4),
      matrix: at(0, 0.46, 0.27),
    },
    {
      // Neck, carried up rather than forward: an animal that has just been
      // startled is looking, not grazing.
      geometry: new ConeGeometry(0.1, 0.34, 5),
      matrix: at(0, 0.62, 0.35).multiply(new Matrix4().makeRotationX(0.75)),
    },
    {
      geometry: new SphereGeometry(0.11, 6, 4),
      matrix: at(0, 0.75, 0.47).multiply(scaled(0.85, 0.85, 1.25)),
    },
    ear(-0.06),
    ear(0.06),
    leg(-0.13, 0.24),
    leg(0.13, 0.24),
    leg(-0.13, -0.26),
    leg(0.13, -0.26),
    {
      // Tail, up. The white flash of a raised tail is how a real herd signals
      // alarm, and it is the one detail that reads at a distance.
      geometry: new ConeGeometry(0.05, 0.18, 4),
      matrix: at(0, 0.56, -0.44).multiply(new Matrix4().makeRotationX(-0.6)),
    },
  ]);
}
