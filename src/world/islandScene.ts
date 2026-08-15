import {
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3,
} from "three";
import type { WorldManifest } from "../game/world/compiler/worldTypes";
import type { TerrainChunkTopology } from "../game/world/runtime/terrainChunkTopology";
import { PALETTE, SUN_DIRECTION } from "../render/palette";
import { createSeaVisual, type SeaVisual } from "../render/world/seaVisual";
import { createSkyDome } from "../render/world/skyDome";
import { DayNightCycle } from "./dayNightCycle";
import {
  assembleIslandField,
  beginRouteDistanceField,
  buildIslandSamples,
  type IslandField,
} from "./islandField";
import { islandAtmosphere } from "./islandAtmosphere";
import { applyCloudShadows, createCloudUniforms } from "./cloudShadows";
import { beginIslandGroundCover } from "./islandGroundCover";
import { createIslandNearGrass, type IslandNearGrass } from "./islandNearGrass";
import { createIslandWoodland, type IslandWoodland } from "./islandWoodland";
import {
  createIslandWildlife,
  type IslandWildlife,
  type PlayerSense,
} from "./islandWildlife";
import {
  createIslandPlacements,
  type IslandPlacements,
} from "./islandPlacements";
import { createJourneyMarkers, type JourneyMarkers } from "./journeyMarkers";
import { createRegionLandmarks, type RegionLandmarks } from "./regionLandmarks";
import {
  beginTerrainColouring,
  buildIslandChunkMesh,
  type IslandChunkMesh,
} from "./islandTerrainMesh";

/**
 * Everything the scene needs from the chunk repository, and nothing more.
 *
 * The scene does not own the repository and must not outlive it: it borrows one
 * canonical topology per chunk and takes exactly one render retain for each,
 * which it gives back in `dispose`. Passing these in rather than importing the
 * repository keeps the ownership one-directional and makes the retain balance
 * testable without a physics world.
 */
export interface IslandSceneResources {
  /** The canonical topology already prepared and retained by physics. */
  topology(chunkId: string): TerrainChunkTopology;
  /** Takes one render retain. The returned release must be idempotent. */
  retainRenderChunk(chunkId: string): () => void;
  /**
   * Runs one named, bounded unit of realization work.
   *
   * The scene decides what the units are, because it is the only layer that
   * knows which piece of work is which. The caller decides what happens between
   * them - timing, yielding to the browser so the loading panel keeps painting -
   * because it is the only layer that knows there is a frame budget to keep.
   */
  job<T>(name: string, work: () => T): Promise<T>;
}

export interface IslandScene {
  readonly scene: Scene;
  readonly sun: DirectionalLight;
  readonly field: IslandField;
  readonly chunkMeshes: readonly IslandChunkMesh[];
  readonly terrainTriangles: number;
  /** Scenery elements instanced across all placements and discoveries. */
  readonly sceneryElements: number;
  /** The living journey cues: tracks, mist, flocks, wildlife. */
  readonly journey: JourneyMarkers;
  /** The five herd-trace scenes, and the herd itself. */
  /** Non-colliding ground-cover instances, and the triangles they cost. */
  /** The near-grass window, so its cost can be read from outside. */
  readonly nearGrass: IslandNearGrass;
  /** The scenery wood, so its cost can be read from outside. */
  readonly woodland: IslandWoodland;
  /** Wild horses and birds, so their count can be read from outside. */
  readonly wildlife: IslandWildlife;
  /** Clump scenery, including the trees and stone physics has to stop at. */
  readonly placements: IslandPlacements;
  /** The authored silhouettes, including the stone physics has to stop at. */
  readonly landmarks: RegionLandmarks;
  readonly groundCoverTufts: number;
  readonly groundCoverTriangles: number;
  /** Palette anchors from the manifest that the renderer recognised. */
  readonly recognisedAnchors: readonly string[];
  /** Render retains currently held, one per terrain chunk. */
  readonly renderRetainCount: number;
  /** Topology fingerprints actually drawn, keyed by chunk id. */
  readonly topologyFingerprints: ReadonlyMap<string, string>;
  /**
   * `focus` is what to draw around; `player` is where the horse actually is.
   *
   * They are the same thing during play and deliberately different under the
   * evidence observer, which parks the camera five hundred metres away while
   * the horse goes on simulating where it stands. Anything that reacts to the
   * player - the wild horses do - has to read the second, not the first.
   */
  update(
    elapsedSeconds: number,
    focusX: number,
    focusY: number,
    focusZ: number,
    player?: PlayerSense,
  ): void;
  dispose(): void;
}

/**
 * The shadow volume follows the horse rather than covering the island. A
 * 512-metre orthographic shadow camera at 2048 pixels would give roughly a
 * quarter-metre per texel, which loses the horse's legs entirely.
 */
const SHADOW_RADIUS = 30;

/**
 * Fog, sea extent and horizon haze, all keyed to the island's own size.
 *
 * Near has to sit beyond the far shore of whatever the player is standing on,
 * or the middle distance washes out and takes the silhouettes they navigate by
 * with it. Far is past the island's diagonal so the coastline stays legible
 * from high ground.
 *
 * These were fixed numbers tuned by eye for the 512-metre slice. On a
 * 1,024-metre island the same numbers fog out the far coast completely - the
 * diagonal alone is about 1,450 metres - so the whole point of standing on the
 * crown disappears into haze. Deriving them means one island can be twice the
 * size of another without a second set of magic numbers to keep in step.
 */
function atmosphericRanges(sizeMeters: number) {
  const diagonal = sizeMeters * Math.SQRT2;
  return {
    fogNear: sizeMeters * 0.47,
    fogFar: diagonal * 1.6,
    /** Water has to reach past the fog, or its rim shows as a line on the sea. */
    seaOuterRadius: diagonal * 2.1,
    hazeNear: sizeMeters * 0.74,
    hazeFar: diagonal * 1.72,
    /** Horizon landforms sit outside the water, scaled to it. */
    distantLandScale: (sizeMeters / 512) * 1.7,
  };
}

export async function createIslandScene(
  manifest: WorldManifest,
  resources: IslandSceneResources,
): Promise<IslandScene> {
  const atmosphere = islandAtmosphere(manifest);

  const ranges = atmosphericRanges(manifest.island.sizeMeters);

  const scene = new Scene();
  scene.fog = new Fog(atmosphere.haze, ranges.fogNear, ranges.fogFar);

  const sky = await resources.job("sky-dome", () => createSkyDome());
  scene.add(sky.mesh);

  // One clock for every colour in the world. The scene owns the lights, dome,
  // sea and fog; the cycle owns what they should look like right now.
  //
  // `?tod=0.5` pins the phase for automation: the render-inspect-refine loop
  // has to be able to photograph dusk without waiting five real minutes for
  // it. An automation switch rather than a player setting, like the rest of
  // the query flags, and absent means the day simply runs.
  const pinnedTimeOfDay = (() => {
    if (typeof location === "undefined") return null;
    const raw = new URLSearchParams(location.search).get("tod");
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? ((value % 1) + 1) % 1 : null;
  })();
  const dayNight =
    pinnedTimeOfDay === null
      ? new DayNightCycle()
      : new DayNightCycle(Number.MAX_SAFE_INTEGER, pinnedTimeOfDay);

  const sun = new DirectionalLight(PALETTE.sunLight, 2.05);
  sun.position.set(SUN_DIRECTION.x * 60, SUN_DIRECTION.y * 60, SUN_DIRECTION.z * 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -SHADOW_RADIUS;
  sun.shadow.camera.right = SHADOW_RADIUS;
  sun.shadow.camera.top = SHADOW_RADIUS;
  sun.shadow.camera.bottom = -SHADOW_RADIUS;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  // Three does not refresh the shadow projection when the frustum bounds are
  // edited, so without this the light keeps its default ten-metre box and
  // everything past the horse's feet renders as if it were in shadow.
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun);
  scene.add(sun.target);

  // Fill is what decides whether shade is a colour or a hole.
  //
  // It was cut to 1.25 to stop every ground family washing to the same pale
  // value, and that worked until there was a canopy overhead: under a wood, the
  // sun contributes nothing and 1.25 of cool sky over Fernwood's dark ground
  // rendered the whole region as a black silhouette. The reading it was
  // protecting is now carried by the region ramps and by the cover, which are
  // far better placed to carry it, so the fill can go back up to where shade
  // stays legible ground.
  const fill = new HemisphereLight(PALETTE.skyLight, PALETTE.bounceLight, 2.6);
  scene.add(fill);

  /** Reused each frame for the sea's glitter path; the eye rides near the focus. */
  const cameraProxy = new Vector3();

  // The global field, in two halves. Reassembling the compiled samples and
  // sweeping every sample against the safe routes are independent, and together
  // they are one block long enough to be felt.
  const samples = await resources.job("field-samples", () => buildIslandSamples(manifest));
  const routeSweep = beginRouteDistanceField(samples);
  for (let band = 0; band < routeSweep.bandCount; band += 1) {
    await resources.job(`field-route-distance-${band}`, () => routeSweep.sweepBand(band));
  }
  const routeDistance = routeSweep.finish();
  const field = assembleIslandField(samples, routeDistance);

  // Island-wide colouring inputs, computed once and read by every chunk. Split
  // into bands because these are blurs over the whole sample grid, and the grid
  // grows with the square of the island: as single jobs they sat on top of the
  // stall ceiling at 512 metres and well over it at 1,024.
  const colourSweep = beginTerrainColouring(field);
  for (let band = 0; band < colourSweep.bandCount; band += 1) {
    await resources.job(`terrain-colouring-${band}`, () => colourSweep.sweepBand(band));
  }
  const colouring = colourSweep.finish();

  // One material for all sixteen chunks. Colour is per-vertex, so the region
  // masks, moisture, slope and worn routes all arrive in the vertex buffer and
  // cost nothing extra to draw.
  const clouds = createCloudUniforms();
  const terrainMaterial = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  });
  applyCloudShadows(terrainMaterial, clouds);

  // One job per chunk: derived attributes, geometry, and the chunk's single
  // render retain, taken only once the geometry that depends on it exists. The
  // repository refuses to activate a chunk that lacks either a render or a
  // physics retain, so this is the render half of the activation contract rather
  // than bookkeeping for its own sake.
  const chunkMeshes: IslandChunkMesh[] = [];
  const releaseRenderRetains: Array<() => void> = [];
  const topologyFingerprints = new Map<string, string>();
  const geometries: BufferGeometry[] = [];
  let terrainTriangles = 0;

  for (let index = 0; index < manifest.chunks.length; index += 1) {
    const compiled = manifest.chunks[index];
    if (!compiled) continue;
    await resources.job(`terrain-chunk-${compiled.id}`, () => {
      const chunk = buildIslandChunkMesh(field, colouring, index, (chunkId) =>
        resources.topology(chunkId),
      );
      chunkMeshes.push(chunk);
      releaseRenderRetains.push(resources.retainRenderChunk(chunk.chunkId));
      topologyFingerprints.set(chunk.chunkId, chunk.topologyFingerprint);

      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(chunk.positions, 3));
      geometry.setAttribute("normal", new BufferAttribute(chunk.normals, 3));
      geometry.setAttribute("color", new BufferAttribute(chunk.colors, 3));
      geometry.setIndex(new BufferAttribute(chunk.indices, 1));
      geometry.computeBoundingSphere();
      geometries.push(geometry);
      terrainTriangles += chunk.triangleCount;

      const mesh = new Mesh(geometry, terrainMaterial);
      mesh.name = `terrain-${chunk.chunkId}`;
      mesh.receiveShadow = true;
      // Terrain casts too: without it a rise never darkens the ground behind it
      // and the island reads as flat lit cardboard from the overlook.
      mesh.castShadow = true;
      scene.add(mesh);
    });
  }

  const placements = await resources.job("placements", () =>
    createIslandPlacements(manifest, (x, z) => field.heightAt(x, z)),
  );
  scene.add(placements.group);

  // The five herd-trace scenes used to be built here, and the scripted herd
  // standing on the crown with them. They were the ending of a journey this
  // island no longer tells - nine merged horses waiting on a summit for a
  // player to arrive at them, plus the props marking the way. What lives here
  // now is scattered and unscripted: see islandWildlife.ts.

  const journey = await resources.job("journey-markers", () =>
    createJourneyMarkers(manifest, (x, z) => field.heightAt(x, z), {
      skipDiscoveryIds: new Set<string>(),
    }),
  );
  scene.add(journey.group);

  const cover = beginIslandGroundCover(manifest, field);
  for (let band = 0; band < cover.bandCount; band += 1) {
    await resources.job(`ground-cover-sweep-${band}`, () => cover.sweepBand(band));
  }
  for (let layer = 0; layer < cover.layerNames.length; layer += 1) {
    await resources.job(`ground-cover-${cover.layerNames[layer] ?? layer}`, () =>
      cover.realizeLayer(layer),
    );
  }
  const groundCover = cover.finish();
  scene.add(groundCover.group);

  // The carpet underfoot, built as a window that follows the player rather than
  // as more of the island-wide scatter. See islandNearGrass.ts for why those
  // have to be two different things.
  const nearGrass: IslandNearGrass = await resources.job("near-grass", () =>
    createIslandNearGrass(manifest, field),
  );
  scene.add(nearGrass.group);

  // The wood the regions are named after. Scenery, not obstacles: see
  // islandWoodland.ts for what that costs and why it is drawn that way.
  const woodland: IslandWoodland = await resources.job("woodland", () =>
    createIslandWoodland(manifest, field),
  );
  scene.add(woodland.group);

  // Wild horses and birds, scattered across the island rather than staged at
  // authored points. See islandWildlife.ts.
  const wildlife: IslandWildlife = await resources.job("wildlife", () =>
    createIslandWildlife(manifest, field),
  );
  scene.add(wildlife.group);

  // The authored silhouettes. Built after the field exists, because every one
  // of them has to be seated on the ground the compiler actually graded.
  const landmarks: RegionLandmarks = await resources.job("region-landmarks", () =>
    createRegionLandmarks(manifest, (x, z) => field.heightAt(x, z)),
  );
  scene.add(landmarks.group);

  const islandRadius = field.halfMeters * 0.9;
  const sea: SeaVisual = await resources.job("sea", () =>
    createSeaVisual({
      waterLevel: manifest.island.seaLevelMeters,
      // Start the water just inside the point the land drops to it, so the
      // shoreline is a meeting rather than a seam.
      innerRadius: islandRadius * 0.72,
      outerRadius: ranges.seaOuterRadius,
      bedHeightAt: (x, z) => field.heightAt(x, z),
      distantLandScale: ranges.distantLandScale,
      // Fully hazed well before the water mesh runs out, so the horizon is a
      // fade into sky and never a visible rim of geometry.
      hazeNear: ranges.hazeNear,
      hazeFar: ranges.hazeFar,
      hazeColor: atmosphere.haze,
    }),
  );
  scene.add(sea.group);

  let disposed = false;

  return {
    scene,
    sun,
    field,
    chunkMeshes,
    terrainTriangles,
    sceneryElements:
      placements.elementCount + journey.elementCount + landmarks.elementCount,
    journey,
    renderRetainCount: releaseRenderRetains.length,
    topologyFingerprints,
    nearGrass,
    woodland,
    wildlife,
    placements,
    landmarks,
    groundCoverTufts: groundCover.tuftCount,
    groundCoverTriangles: groundCover.triangleCount,
    recognisedAnchors: atmosphere.recognisedAnchors,

    update(elapsedSeconds, focusX, focusY, focusZ, player) {
      // The dome travels with the player; crossing 500 metres of ground must
      // not walk them towards the edge of the sky. The sea deliberately does
      // not: its surf band is baked per-vertex against the real sea bed, so
      // moving it would slide the foam off the actual shoreline.
      sky.mesh.position.set(focusX, 0, focusZ);

      // --- the time of day ------------------------------------------------
      const light = dayNight.at(elapsedSeconds);
      sun.color.copy(light.lightColor);
      sun.intensity = light.lightIntensity;
      fill.color.copy(light.skyFill);
      fill.groundColor.copy(light.groundFill);
      fill.intensity = light.fillIntensity;
      (scene.fog as Fog).color.copy(light.fogColor);
      sky.uniforms.uZenith.value.copy(light.zenith);
      sky.uniforms.uHorizon.value.copy(light.horizon);
      sky.uniforms.uHaze.value.copy(light.horizon).lerp(light.sunGlow, 0.5);
      sky.uniforms.uSunColor.value.copy(light.sunGlow);
      sky.uniforms.uSunDirection.value.copy(light.sunDirection);
      sky.uniforms.uNight.value = light.night;
      // The moon is the night's working light; the dome draws its disc where
      // the light actually comes from, so shadows and the visible moon agree.
      sky.uniforms.uMoonDirection.value.copy(light.lightDirection);
      sea.setLight(
        light.sunDirection,
        light.sunGlow,
        light.night,
        cameraProxy.set(focusX, focusY + 2, focusZ),
      );
      groundCover.setFocus(focusX, focusZ);
      groundCover.setTime(elapsedSeconds);
      clouds.time.value = elapsedSeconds;
      nearGrass.setFocus(focusX, focusZ);
      nearGrass.setTime(elapsedSeconds);
      woodland.setFocus(focusX, focusZ);
      woodland.setTime(elapsedSeconds);
      // Falls back to the focus point standing still, which is what priming the
      // scene before the first frame and the evidence observer both want: the
      // herd is posed, and nothing decides to kick anybody.
      wildlife.update(
        elapsedSeconds,
        player ?? { x: focusX, y: focusY, z: focusZ, speed: 0, deltaSeconds: 0 },
      );
      sea.update(elapsedSeconds);
      journey.update(elapsedSeconds);

      // Snap the shadow volume to whole shadow-map texels. Without this the
      // shadow edges crawl continuously while the player rides, which is far
      // more visible than the quarter-texel of positional error it costs.
      const texelSize = (SHADOW_RADIUS * 2) / 2048;
      const snappedX = Math.round(focusX / texelSize) * texelSize;
      const snappedZ = Math.round(focusZ / texelSize) * texelSize;
      sun.position.set(
        snappedX + light.lightDirection.x * 90,
        focusY + light.lightDirection.y * 90,
        snappedZ + light.lightDirection.z * 90,
      );
      sun.target.position.set(snappedX, focusY, snappedZ);
      sun.target.updateMatrixWorld();
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // Geometry and materials first, then the retains, so the repository can
      // never see a chunk released while a live BufferAttribute still points at
      // its topology arrays.
      for (const geometry of geometries) geometry.dispose();
      terrainMaterial.dispose();
      placements.dispose();
      journey.dispose();
      landmarks.dispose();
      groundCover.dispose();
      nearGrass.dispose();
      woodland.dispose();
      wildlife.dispose();
      sea.dispose();
      // The sky dome owns a SphereGeometry and a ShaderMaterial that nothing
      // else references; `createSkyDome` hands back a bare Mesh, so releasing
      // them is the caller's job and was previously not being done at all.
      sky.mesh.geometry.dispose();
      if (Array.isArray(sky.mesh.material)) for (const item of sky.mesh.material) item.dispose();
      else sky.mesh.material.dispose();
      scene.clear();
      for (const release of releaseRenderRetains) release();
      releaseRenderRetains.length = 0;
    },
  };
}
