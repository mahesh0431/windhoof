import { MathUtils, Vector3 } from "three";
import type { GameCommand } from "../game/contracts/uiContract";
import type { PersistenceSnapshot } from "../game/contracts/save";
import type { GraphicsLifecycleSnapshot } from "../game/contracts/runtimeLifecycle";
import { DEFAULT_HORSE_TUNING } from "../game/simulation/horse/horseTuning";
import { IslandSimulation } from "../game/simulation/islandSimulation";
import { AutosaveCoordinator } from "../game/save/autosaveCoordinator";
import { IndexedDbSaveAdapter } from "../game/save/indexedDbSaveAdapter";
import type { SaveAdapter } from "../game/save/saveAdapter";
import { inspectGameSave, restoreGameSave } from "../game/save/saveSchema";
import { compileWorldAsync } from "../game/world/runtime/compileWorldAsync";
import { IslandChunkRepository } from "../game/world/runtime/islandChunkRepository";
import { sampleManifest } from "../game/world/runtime/sampleManifest";
import type { WorldManifest } from "../game/world/compiler/worldTypes";
import {
  CompiledIslandWorld,
  compiledIslandBoundaryRadius,
} from "../physics/compiledIslandWorld";
import { RapierHorseMotionResolver } from "../physics/rapierHorseMotionResolver";
import { initializeRapier } from "../physics/rapierRuntime";
import { ChaseCamera } from "../render/camera/chaseCamera";
import { HorseGaitAnimator } from "../render/horse/horseGaitAnimator";
import { createHoofContacts } from "../render/horse/hoofContacts";
import { createHorseRig } from "../render/horse/horseVisual";
import { createRenderer } from "../render/renderer";
import { WindhoofAudio } from "../audio/windhoofAudio";
import { RuntimeMetrics } from "../diagnostics/runtimeMetrics";
import { PresentationSettingsStore } from "../ui/presentationSettings";
import { createWindhoofUi, type JourneyStart } from "../ui/windhoofUi";
import { createIslandScene } from "../world/islandScene";
import { regionDisplayName } from "../world/regionVisuals";
import { FIRST_ISLAND_SPEC } from "../world/firstIslandSpec";
import { createInputBindings } from "./inputBindings";
import { installLabHarness } from "./labHarness";
import { WebglRecoveryController } from "./webglRecovery";
import { resolveRuntimeFlags } from "./runtimeFlags";
import { createPreparationLog } from "./preparationLog";
import type { WindhoofApp } from "./windhoofApp";

/**
 * Why a stored ride could not be continued, said to the player.
 *
 * Each of these is a legitimate outcome of a world that is still being built,
 * not a failure: the island is regenerated deterministically from a spec, and
 * when the spec changes, the ground a saved pose stood on may not exist.
 */
const RESET_REASONS: Readonly<Record<string, string>> = {
  corrupt: "Your last ride could not be read.",
  "unsupported-version": "Your last ride came from a newer Windhoof.",
  "wrong-world": "Your last ride was on a different island.",
  "generator-mismatch": "This island has been remade since your last ride.",
  "manifest-mismatch": "This island has changed since your last ride.",
};

/**
 * The save store, or an honest stand-in for one.
 *
 * Reading `globalThis.indexedDB` is not always a safe property access: hardened
 * profiles and some private-browsing modes install a getter that throws outright
 * rather than returning undefined. Reaching for it unguarded takes the whole boot
 * down before the island has a chance to say that it simply cannot remember
 * anything - which is a state the game is perfectly able to run in.
 *
 * When there is nothing to talk to, this returns an adapter that refuses every
 * operation rather than a real one holding `undefined`. That is deliberate: the
 * real adapter defaults its factory from the same global, so handing it
 * `undefined` would evaluate that default and throw exactly the same way.
 */
function openSaveStore(): SaveAdapter {
  let factory: IDBFactory | undefined;
  try {
    factory = globalThis.indexedDB;
  } catch {
    factory = undefined;
  }
  if (factory) return new IndexedDbSaveAdapter(factory);
  return {
    read: () => Promise.reject(new Error("IndexedDB is unavailable")),
    write: () => Promise.reject(new Error("IndexedDB is unavailable")),
    remove: () => Promise.reject(new Error("IndexedDB is unavailable")),
    close: () => undefined,
  };
}

/** Metres above the water line that still count as wet ground underfoot. */
const WET_GROUND_BAND = 0.35;

/**
 * How often the world is asked what region the horse is standing in.
 *
 * Nearest-sample region lookup is cheap but not free, and a place name that
 * appears a twentieth of a second later than it could is not a thing anybody
 * can perceive.
 */
const REGION_POLL_SECONDS = 0.25;

/**
 * The compiled island.
 *
 * Everything authoritative here belongs to somebody else: the manifest comes
 * from the deterministic compiler, the collision world and the surface, safety
 * and boundary rules come from `CompiledIslandWorld`, and the horse is the same
 * fixed-step simulation and Rapier resolver that passed the Horse Lab. This file
 * is the presentation seam between them - scene, camera, animation, audio,
 * interface - and the horse's own embodiment is carried over unchanged, because
 * changing it would invalidate the thing it was proven against.
 */
export async function startIsland(
  canvas: HTMLCanvasElement,
  uiHost: HTMLElement,
): Promise<WindhoofApp> {
  const settings = new PresentationSettingsStore();
  const saveAdapter = openSaveStore();
  const storedSavePromise = saveAdapter.read().then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const, value: null }),
  );

  const { renderer, camera, resize, dispose: disposeRenderer } = createRenderer(canvas);

  /**
   * Assigned once the scene and simulation it drives actually exist.
   *
   * Declared here because the interface is built before them and has to be able
   * to call `resume()` on it. Nothing can reach that callback before the game
   * is running, so the gap is not observable.
   */
  let graphicsRecovery: WebglRecoveryController | null = null;
  /**
   * The lifecycle state, readable before the controller exists.
   *
   * Nothing can lose a context that has not been created yet, so "ready" is the
   * truthful answer during startup rather than a placeholder.
   */
  const graphicsStatus = (): GraphicsLifecycleSnapshot =>
    graphicsRecovery?.snapshot() ?? { status: "ready", generation: 0 };

  const ui = createWindhoofUi(uiHost, settings, {
    onCommand: (command) => applyCommand(command),
    onRequestFocus: () => requestFocus(),
    // The player taking the reins back after a restored context. The game
    // stays paused until this arrives - a native restore is the browser saying
    // it can draw again, not the player saying they are ready to ride.
    onResumeGraphics: () => {
      if (graphicsRecovery?.resume()) requestFocus();
    },
    onReloadPage: () => window.location.reload(),
  });

  // Compilation happens off the main thread, so the loading panel keeps
  // painting instead of freezing on the frame the player pressed enter.
  const [manifest] = await Promise.all([
    compileWorldAsync(FIRST_ISLAND_SPEC) as Promise<WorldManifest>,
    initializeRapier(),
  ]);

  /**
   * Hands the browser a frame between chunk preparation jobs.
   *
   * Preparing sixteen chunks in one synchronous burst is one long main-thread
   * block behind a loading panel that cannot repaint. Yielding on
   * `requestAnimationFrame` keeps each job bounded and lets the existing loading
   * presentation stay alive and painting for the whole of startup.
   */
  const yieldToBrowser = () =>
    new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });

  /**
   * One named, timed, bounded unit of realization work, followed by a frame.
   *
   * Milestone 3 puts a hard 50 ms ceiling on any single one of these. Timing
   * them by name is what makes that ceiling checkable from a browser test, and
   * yielding afterwards is what keeps the loading panel painting through the
   * whole of startup rather than only either side of it.
   */
  const preparation = createPreparationLog();
  const runtimeMetrics = new RuntimeMetrics();
  const runJob = async <T>(name: string, work: () => T): Promise<T> => {
    const value = preparation.run(name, work);
    await yieldToBrowser();
    return value;
  };

  // Prepare first, in bounded per-chunk jobs. Physics would otherwise prepare
  // the whole island synchronously inside its own constructor.
  performance.mark("windhoof:prepare-start");
  const repository = new IslandChunkRepository(manifest);
  await repository.prepareAll({ yieldBetweenChunks: yieldToBrowser });
  performance.mark("windhoof:prepare-end");

  // Boot phases are marked so a profiling pass can attribute the one
  // unavoidable main-thread block at startup to the layer that actually causes
  // it, instead of guessing. These are `performance` marks only: no behaviour
  // depends on them and they cost nothing at runtime.
  //
  // Order matters and is a contract, not a preference. Physics takes its retain
  // on every chunk first, the scene then takes exactly one render retain per
  // chunk against the same prepared topology, and only once both halves exist
  // can the repository activate anything.
  performance.mark("windhoof:collision-start");
  const world = await CompiledIslandWorld.createStaged(manifest, repository, runJob);
  performance.mark("windhoof:collision-end");
  performance.mark("windhoof:scene-start");
  const scene = await createIslandScene(manifest, {
    topology: (chunkId) => world.terrainTopology(chunkId),
    retainRenderChunk: (chunkId) => repository.retain(chunkId, "render"),
    job: runJob,
  });
  performance.mark("windhoof:scene-end");
  repository.activateAll();
  performance.measure("windhoof:prepare", "windhoof:prepare-start", "windhoof:prepare-end");
  performance.measure("windhoof:collision", "windhoof:collision-start", "windhoof:collision-end");
  performance.measure("windhoof:scene", "windhoof:scene-start", "windhoof:scene-end");

  // Riding does not begin until every chunk is active on both sides. Milestone 3
  // keeps the whole slice resident, so anything short of this is an invariant
  // failure rather than a state to render through, and starting the frame loop
  // anyway would put the horse on ground that may have no collider.
  const readiness = repository.snapshot();
  if (
    readiness.activeChunks !== readiness.totalChunks ||
    readiness.physicsReadyChunks !== readiness.totalChunks ||
    readiness.renderReadyChunks !== readiness.totalChunks
  ) {
    throw new Error(
      `Island refused to start: ${readiness.activeChunks}/${readiness.totalChunks} chunks active, ` +
        `${readiness.physicsReadyChunks} physics, ${readiness.renderReadyChunks} render`,
    );
  }

  const boundaryRadius = compiledIslandBoundaryRadius(manifest);
  const seaLevel = manifest.island.seaLevelMeters;
  const storedSave = await storedSavePromise;
  const compatibility = storedSave.ok
    ? inspectGameSave(storedSave.value, manifest)
    : { status: "none" as const };
  const restored = compatibility.status === "compatible"
    ? restoreGameSave(compatibility.save, manifest, (pose) =>
        Math.hypot(pose.position.x, pose.position.z) < boundaryRadius - 2 &&
        world.isSafeGround(pose.position.x, pose.position.z) &&
        Math.abs(world.heightAt(pose.position.x, pose.position.z) - pose.position.y) <= 1)
    : {
        pose: { position: { ...manifest.spawn.position }, yaw: manifest.spawn.yaw },
        poseSource: "manifest-spawn" as const,
        discoveryStates: {},
        playTimeTicks: 0,
      };
  const initialPersistence: PersistenceSnapshot = !storedSave.ok
    ? { status: "unavailable", lastSavedTick: null }
    : compatibility.status === "compatible"
    ? { status: "saved", lastSavedTick: compatibility.save.playTimeTicks }
    : compatibility.status === "none"
      ? { status: "ready", lastSavedTick: null }
      : compatibility.status === "corrupt"
        ? { status: "error", lastSavedTick: null }
        : { status: "incompatible", lastSavedTick: null };

  /**
   * What this session is, in the player's terms.
   *
   * The save layer answers precisely why a stored ride could not be continued;
   * collapsing that into "error" would be accurate to the code and useless to
   * the player. Nothing here is the player's fault, so nothing here is phrased
   * as though it were.
   */
  const totalDiscoveries = manifest.discoveries.length;
  const completedDiscoveries = Object.values(restored.discoveryStates).filter(
    (state) => state === "completed",
  ).length;
  const journeyStart: JourneyStart =
    // No storage at all is a different situation from a ride that no longer
    // fits, and the two must never be told to the player in the same words:
    // one of them has an answer and the other does not.
    !storedSave.ok
      ? { kind: "unavailable", completedDiscoveries: 0, totalDiscoveries }
      : compatibility.status === "compatible"
      ? { kind: "resumed", completedDiscoveries, totalDiscoveries }
      : compatibility.status === "none"
        ? { kind: "fresh", completedDiscoveries: 0, totalDiscoveries }
        : {
            kind: "quarantined",
            reason: RESET_REASONS[compatibility.status] ?? "This island has changed.",
            completedDiscoveries: 0,
            totalDiscoveries,
          };
  ui.setJourneyStart(journeyStart);

  const spawn = {
    x: restored.pose.position.x,
    // A hair above the compiled surface. The character controller snaps down,
    // so starting fractionally high is safe and starting fractionally low is a
    // penetration the first step has to resolve.
    y: restored.pose.position.y + 0.05,
    z: restored.pose.position.z,
  };
  const spawnYaw = restored.pose.yaw;

  const resolver = new RapierHorseMotionResolver(
    world.world,
    spawn,
    undefined,
    (position) => world.isSafeGround(position.x, position.z),
    (position, desired) => world.constrainBoundaryTranslation(position, desired),
    (position, desired, constrained, resolved) =>
      world.constrainBoundaryPosition(position, desired, constrained, resolved),
  );
  const simulation = new IslandSimulation(
    { position: spawn, yaw: spawnYaw },
    resolver,
    manifest,
    (x, z) => sampleManifest(manifest, x, z).regionId,
    {
      discoveryStates: restored.discoveryStates,
      playTimeTicks: restored.playTimeTicks,
      persistence: initialPersistence,
    },
  );
  const autosave = new AutosaveCoordinator(saveAdapter, (snapshot) => {
    simulation.updatePersistence(snapshot);
  });
  let persistenceWritesEnabled = storedSave.ok &&
    (compatibility.status === "none" || compatibility.status === "compatible");

  const rig = createHorseRig();
  rig.root.position.set(spawn.x, spawn.y, spawn.z);
  rig.root.rotation.y = spawnYaw;
  scene.scene.add(rig.root);

  const animator = new HorseGaitAnimator();
  const hoofContacts = createHoofContacts();
  scene.scene.add(hoofContacts.points);

  const chaseCamera = new ChaseCamera(camera, world, (x, z) => world.heightAt(x, z));
  chaseCamera.setYaw(spawnYaw);

  const flags = resolveRuntimeFlags();
  const audio = new WindhoofAudio({ muted: flags.muted });
  const bindings = createInputBindings(canvas, chaseCamera, {
    isRiding: () => currentMode === "playing" || currentMode === "recovering",
    isPointerLocked: () => document.pointerLockElement === canvas,
    onToggleDiagnostics: () =>
      settings.update({ showDiagnostics: !settings.value.showDiagnostics }),
    onLookActivity: () => {
      /* reserved for future look-driven cues */
    },
  });

  function applyCommand(command: GameCommand): void {
    if (command.type === "StartNewJourney") {
      void startNewJourneyPersistence();
      return;
    }
    simulation.command(command);
    if (command.type === "Resume") requestFocus();
    if (command.type === "SetCameraSensitivity") {
      chaseCamera.settings.sensitivity = command.value;
    }
    if (command.type === "SetReducedMotion") {
      chaseCamera.settings.reducedMotion = command.enabled;
    }
  }

  async function startNewJourneyPersistence(): Promise<void> {
    if (!storedSave.ok) {
      simulation.updatePersistence({ status: "unavailable", lastSavedTick: null });
      return;
    }
    try {
      await saveAdapter.remove();
      persistenceWritesEnabled = true;
      simulation.updatePersistence({ status: "ready", lastSavedTick: null });
      autosave.request(simulation.save());
    } catch {
      persistenceWritesEnabled = false;
      simulation.updatePersistence({ status: "error", lastSavedTick: null });
    }
  }

  function requestFocus(): void {
    void audio.resume();
    if (document.pointerLockElement === canvas) return;
    try {
      const request = canvas.requestPointerLock() as unknown;
      if (request instanceof Promise) request.catch(() => undefined);
    } catch {
      // Pointer lock can be refused right after Escape. The focus prompt stays
      // visible and the next click succeeds.
    }
  }

  const applySettings = () => {
    const value = settings.value;
    chaseCamera.settings.sensitivity = value.cameraSensitivity;
    chaseCamera.settings.invertLookY = value.invertLookY;
    chaseCamera.settings.baseFieldOfView = value.fieldOfView;
    chaseCamera.settings.followStrength = value.cameraFollowStrength;
    chaseCamera.settings.reducedMotion = value.reducedMotion;
    audio.setVolumes({
      master: value.masterVolume,
      ambience: value.ambienceVolume,
      horse: value.horseVolume,
    });
  };
  const unsubscribeSettings = settings.subscribe(applySettings);
  applySettings();

  const onWindowBlur = () => {
    if (currentMode === "playing" || currentMode === "recovering") {
      applyCommand({ type: "Pause" });
    }
  };

  const onFirstGesture = () => {
    void audio.resume();
    window.removeEventListener("keydown", onFirstGesture);
  };

  canvas.addEventListener("click", requestFocus);
  window.addEventListener("resize", resize);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("keydown", onFirstGesture);

  /**
   * Surface normal from the authoritative height sampler.
   *
   * The manifest carries slope but not orientation, and the horse has to lean
   * into the hill it is actually on. Reading the same sampler the collider was
   * built from means the pose and the ground cannot disagree.
   */
  const NORMAL_EPSILON = 1.2;
  function groundNormalAt(x: number, z: number): { x: number; y: number; z: number } {
    const nx = world.heightAt(x - NORMAL_EPSILON, z) - world.heightAt(x + NORMAL_EPSILON, z);
    const nz = world.heightAt(x, z - NORMAL_EPSILON) - world.heightAt(x, z + NORMAL_EPSILON);
    const ny = 2 * NORMAL_EPSILON;
    const length = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / length, y: ny / length, z: nz / length };
  }

  const hoofWorldPosition = new Vector3();

  function spawnHoofDebris(
    legId: string,
    weight: number,
    speed: number,
    forwardX: number,
    forwardZ: number,
  ): void {
    const leg = rig.legs.find((candidate) => candidate.id === legId);
    if (!leg) return;
    leg.hoof.getWorldPosition(hoofWorldPosition);
    const groundY = world.heightAt(hoofWorldPosition.x, hoofWorldPosition.z);
    // The compiler floors a narrow shelf just above the water line around the
    // island's containment ring, and the fernwood stream cuts below it, so a
    // band either side of sea level is the wet ground a horse splashes through.
    const submerged = groundY < seaLevel + WET_GROUND_BAND;
    hoofContacts.strike(
      hoofWorldPosition.x,
      groundY,
      hoofWorldPosition.z,
      world.surfaceAt(hoofWorldPosition.x, hoofWorldPosition.z),
      submerged,
      weight,
      speed,
      forwardX,
      forwardZ,
    );
  }

  let currentMode: string = "playing";
  let previousYaw = spawnYaw;
  let previousSpeed = 0;
  let previousVerticalVelocity = 0;
  let elapsedSeconds = 0;
  let lastFrameTime = performance.now();
  let smoothedFps = 60;
  let smoothedFrameMs = 16.7;
  let running = true;
  let frameCount = 0;
  let regionId = sampleManifest(manifest, spawn.x, spawn.z).regionId;
  let regionPollAt = 0;
  /**
   * A camera held somewhere other than behind the horse, for visual inspection.
   *
   * Null in every ordinary frame. When set, the chase camera stops driving and
   * the renderer draws from a fixed point - the only way to photograph five
   * regions and nine scenes on a 1,024-metre island without riding to each of
   * them, which under a software renderer is minutes per leg and the thing that
   * hung the inspector once already.
   *
   * It deliberately cannot move the horse. Moving the horse would mean writing
   * simulation state from the presentation layer, and every gameplay claim this
   * project makes rests on that never happening.
   */
  let observer: { position: Vector3; target: Vector3 } | null = null;

  // Prime one frame so the first painted image is the island, never an empty
  // canvas behind the loading panel.
  const initialFrame = simulation.snapshot();
  /** The most recent snapshot, so diagnostics can read it without a second source. */
  let latestSnapshot = initialFrame.ui;
  scene.update(0, spawn.x, spawn.y, spawn.z);
  chaseCamera.update({ ...spawn, yaw: spawnYaw, speed: 0, grounded: true }, 1 / 60);
  renderer.render(scene.scene, camera);
  ui.update({
    snapshot: initialFrame.ui,
    events: [],
    elapsedSeconds: 0,
    pointerLocked: false,
    gallopHeld: false,
    diagnostics: emptyDiagnostics(),
    place: regionDisplayName(regionId),
  });
  ui.setLoaded();

  /**
   * The browser taking the graphics away, handled rather than crashed on.
   *
   * A lost WebGL context is not an application error - a driver reset, a laptop
   * switching GPUs, or a background tab being reclaimed will all produce one on
   * a machine that is working perfectly - and the default browser behaviour is
   * a permanently dead canvas. The controller owns the state machine; this is
   * the wiring that gives it something real to pause, silence, and redraw.
   *
   * Everything it touches here is runtime presentation. Nothing in this block
   * writes simulation state: pausing goes through the same `Pause` command the
   * player's own Escape key sends, and the save it asks for is the autosave the
   * simulation already offers. The horse's position when the screen went is the
   * horse's position when it comes back.
   */
  graphicsRecovery = new WebglRecoveryController(canvas, {
    pauseSimulation: () => {
      if (currentMode === "playing") simulation.command({ type: "Pause" });
    },
    clearInput: () => bindings.clear(),
    suspendAudio: () => audio.suspend(),
    releasePointer: () => {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
    requestSafeSave: () => {
      // Best effort and deliberately quiet. If storage is refusing writes the
      // player is already being told so elsewhere, and a second failure notice
      // stacked on top of a blank screen helps nobody.
      if (persistenceWritesEnabled) autosave.request(simulation.save());
    },
    resize: () => resize(),
    // One frame, drawn on purpose, before the game is declared recoverable.
    // A restored context can still fail on first use, and finding that out
    // here turns a silent black screen into the `failed` state with a way out.
    smokeRender: () => renderer.render(scene.scene, camera),
    onChange: () => ui.setGraphicsStatus(graphicsStatus()),
  });
  ui.setGraphicsStatus(graphicsStatus());

  /**
   * The browser's own hook for taking the WebGL context away and giving it back.
   *
   * Absent on some drivers and in some headless configurations, which is why
   * every caller has to cope with null: an inspection that cannot exercise
   * recovery must say so rather than report a pass it never earned.
   *
   * Looked up once, while the context is alive, and kept. Asking a *lost*
   * context for an extension returns null, so a lookup deferred until it is
   * needed can never find the one thing that could give the context back -
   * which is exactly how the first attempt at this reached `context-lost` and
   * stayed there.
   */
  const loseContext: WEBGL_lose_context | null = renderer
    .getContext()
    .getExtension("WEBGL_lose_context");

  const harness = installLabHarness({
    bindings,
    camera: chaseCamera,
    settings,
    command: applyCommand,
    preparationJobs: () => preparation.jobs(),
    regions: () =>
      manifest.regions.map((region) => ({
        id: region.id,
        displayName: regionDisplayName(region.id),
        terrainFamily: region.visualIntent.terrainFamily,
        anchor: { x: region.anchorMeters.x, z: region.anchorMeters.z },
      })),
    // The inspection seam. Everything here either reads state or moves the
    // camera; none of it writes to the simulation, the world, or the save.
    observe: (from, lookAt) => {
      observer = {
        position: new Vector3(from.x, from.y, from.z),
        target: new Vector3(lookAt.x, lookAt.y, lookAt.z),
      };
    },
    release: () => {
      observer = null;
    },
    heightAt: (x, z) => world.heightAt(x, z),
    graphics: () => graphicsStatus(),
    loseGraphicsContext: () => {
      if (!loseContext) return false;
      loseContext.loseContext();
      return true;
    },
    restoreGraphicsContext: () => {
      if (!loseContext) return false;
      loseContext.restoreContext();
      return true;
    },
    resumeGraphics: () => graphicsRecovery?.resume() ?? false,
    scenes: () =>
      manifest.discoveries.map((discovery) => ({
        id: discovery.id,
        kind: discovery.type,
        mandatory: discovery.mandatory,
        visitRadiusMeters: discovery.progression.visitRadiusMeters,
        position: { ...discovery.position },
        completion: { ...discovery.progression.completion },
      })),
    state: () => ({
      frame: frameCount,
      elapsedSeconds,
      mode: currentMode,
      ...simulation.authoritativeStateForDiagnostics(),
      cameraDistance: chaseCamera.currentDistance,
      cameraObstructed: chaseCamera.isObstructed,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      // Frame timing, so a profiling pass can report what the renderer is
      // actually achieving instead of inferring it from wall-clock sampling.
      fps: smoothedFps,
      frameMilliseconds: smoothedFrameMs,
      geometries: renderer.info.memory.geometries,
      programs: renderer.info.programs?.length ?? 0,
      groundCoverTufts: scene.groundCoverTufts,
      groundCoverTriangles: scene.groundCoverTriangles,
      chunks: repository.snapshot(),
      renderRetainCount: scene.renderRetainCount,
      // Three scalars, so reading them every frame during a profile costs
      // nothing. The full per-job list is behind `preparationJobs()`.
      preparation: preparation.snapshot(),
      runtime: runtimeMetrics.snapshot(currentBrowserHeapBytes()),
      rigBodyHeight: rig.body.position.y,
      rigSpineFlex: rig.spine.rotation.x,
      debrisLive: hoofContacts.liveCount(),
      // Read-only proof of the mute contract: muted means this page will never
      // hold a running audio context, whatever it is asked to play.
      audioMuted: audio.isMuted,
      audioContextCreated: audio.hasContext,
      audioRunning: audio.isRunning,
      journey: {
        objectiveKind: latestSnapshot.objective?.kind ?? null,
        objectiveId: latestSnapshot.objective?.id ?? null,
        known: latestSnapshot.knownDiscoveries.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          state: entry.state,
        })),
        interactionId: latestSnapshot.contextualInteraction?.discoveryId ?? null,
        interactionKind: latestSnapshot.contextualInteraction?.kind ?? null,
        completedMandatory: latestSnapshot.completedMandatoryDiscoveries,
        totalMandatory: latestSnapshot.totalMandatoryDiscoveries,
        complete: latestSnapshot.journeyComplete,
        persistenceStatus: latestSnapshot.persistence.status,
        lastSavedTick: latestSnapshot.persistence.lastSavedTick,
        startKind: journeyStart.kind,
        persistenceWritesEnabled,
      },
      stage: "island",
      regionId,
      manifestHash: manifest.manifestHash,
      terrainTriangles: scene.terrainTriangles,
      sceneryElements: scene.sceneryElements,
      boundaryRadius,
    }),
  });

  function frame(now: number): void {
    if (!running) return;
    window.requestAnimationFrame(frame);

    // Nothing is stepped or drawn while the picture is gone, coming back, or
    // back but not yet handed over. The loop keeps turning so it is already
    // running on the frame the player presses resume, and the clock is carried
    // forward so that pause does not arrive as one enormous delta.
    if (graphicsStatus().status !== "ready") {
      lastFrameTime = now;
      return;
    }

    const rawDelta = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    const delta = MathUtils.clamp(rawDelta, 0, 0.1);
    elapsedSeconds += delta;
    frameCount += 1;

    smoothedFrameMs = MathUtils.lerp(smoothedFrameMs, rawDelta * 1000, 0.08);
    smoothedFps = MathUtils.lerp(smoothedFps, 1 / Math.max(rawDelta, 0.001), 0.08);
    runtimeMetrics.sampleFrame(rawDelta * 1000);

    bindings.buffer.setCameraYaw(chaseCamera.yaw);
    const input = bindings.buffer.consume();
    const physicsStartedAt = performance.now();
    const result = simulation.advanceFrame(delta, input);
    runtimeMetrics.samplePhysics(performance.now() - physicsStartedAt);
    for (const event of result.events) {
      if (event.type === "AutosaveRequested" && persistenceWritesEnabled) {
        autosave.request(simulation.save());
      }
    }
    const horse = result.horse;
    currentMode = result.ui.mode;

    // The end of the journey, told by the herd rather than by the interface.
    // They notice where the horse is actually standing and come to it; the
    // player keeps every control they had a moment ago and can ride off part
    // way through if they want to.
    if (result.ui.journeyComplete && !latestSnapshot.journeyComplete) {
      scene.traces.gather(horse.position.x, horse.position.z, elapsedSeconds);
    }
    latestSnapshot = result.ui;

    // --- horse presentation -------------------------------------------------
    rig.root.position.set(horse.position.x, horse.position.y, horse.position.z);
    rig.root.rotation.y = horse.yaw;

    const yawRate = shortestAngle(horse.yaw - previousYaw) / Math.max(delta, 0.0001);
    const acceleration = (horse.speed - previousSpeed) / Math.max(delta, 0.0001);
    previousYaw = horse.yaw;
    previousSpeed = horse.speed;

    const normal = groundNormalAt(horse.position.x, horse.position.z);
    const forwardX = Math.sin(horse.yaw);
    const forwardZ = Math.cos(horse.yaw);
    const groundPitch = Math.asin(
      MathUtils.clamp(normal.x * forwardX + normal.z * forwardZ, -1, 1),
    );
    const groundRoll = -Math.asin(
      MathUtils.clamp(normal.x * forwardZ - normal.z * forwardX, -1, 1),
    );

    animator.update(rig, {
      speed: horse.speed,
      gait: horse.gait,
      grounded: horse.grounded,
      verticalVelocity: horse.verticalVelocity,
      condition: horse.condition,
      yawRate,
      acceleration,
      groundPitch: horse.grounded ? groundPitch : 0,
      groundRoll: horse.grounded ? groundRoll : 0,
      deltaSeconds: delta,
      reducedMotion: settings.value.reducedMotion,
    });

    // --- audio and event feedback ------------------------------------------
    const surface = world.surfaceAt(horse.position.x, horse.position.z);
    for (const footfall of animator.consumeFootfalls()) {
      audio.hoof(footfall.weight, footfall.isFront, surface);
      spawnHoofDebris(footfall.leg, footfall.weight, horse.speed, forwardX, forwardZ);
    }

    for (const event of result.events) {
      if (event.type === "HorseCalled") audio.whinny();
      if (event.type === "CallAnswered") {
        // Two cues for one moment: a distant answer, and birds lifting off the
        // ground it came from. The second is what carries when there is no
        // sound, which is every automated run and any muted player.
        audio.answeringCall();
        scene.journey.answer(event.position.x, event.position.z, elapsedSeconds);
      }
      if (event.type === "RestCompleted") audio.restingBreath();
      if (event.type === "HorseJumped") {
        animator.takeOff(1);
      }
      if (event.type === "HorseLanded") {
        audio.land(event.hard);
        const impact = MathUtils.clamp(
          -previousVerticalVelocity / DEFAULT_HORSE_TUNING.hardLandingSpeed,
          0.18,
          1.3,
        );
        animator.land(impact);
        chaseCamera.impulse(event.hard ? 0.85 : 0.2);
        for (const leg of rig.legs) {
          spawnHoofDebris(leg.id, 0.55 + impact * 0.6, horse.speed, forwardX, forwardZ);
        }
      }
    }
    previousVerticalVelocity = horse.verticalVelocity;
    hoofContacts.update(
      delta,
      renderer.domElement.height / (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2)),
    );

    audio.update({
      speed: horse.speed,
      gait: horse.gait,
      surface,
      grounded: horse.grounded,
      // The island's readable edge is the same ring the world stops the horse
      // at, so the surf gets louder for the reason the player can see.
      shoreDistance:
        boundaryRadius - Math.hypot(horse.position.x, horse.position.z),
      deltaSeconds: delta,
    });

    // --- where the player is ------------------------------------------------
    if (elapsedSeconds >= regionPollAt) {
      regionPollAt = elapsedSeconds + REGION_POLL_SECONDS;
      regionId = sampleManifest(manifest, horse.position.x, horse.position.z).regionId;
    }

    // --- camera and scene ---------------------------------------------------
    const paused = result.ui.mode === "paused";
    if (observer) {
      // A held viewpoint for visual inspection. The horse is untouched and
      // still simulating wherever it stands; only the camera and the scene's
      // idea of what to draw around have moved, which is exactly what an
      // evidence capture of a place five hundred metres away needs and is the
      // most the presentation layer is entitled to do.
      camera.position.copy(observer.position);
      camera.lookAt(observer.target);
      camera.updateMatrixWorld();
      scene.update(
        elapsedSeconds,
        observer.position.x,
        observer.position.y,
        observer.position.z,
      );
    } else {
      if (!paused) {
        chaseCamera.update(
          {
            x: horse.position.x,
            y: horse.position.y,
            z: horse.position.z,
            yaw: horse.yaw,
            speed: horse.speed,
            grounded: horse.grounded,
          },
          delta,
        );
      }
      scene.update(elapsedSeconds, horse.position.x, horse.position.y, horse.position.z);
    }
    renderer.render(scene.scene, camera);

    // --- interface ----------------------------------------------------------
    ui.update({
      snapshot: result.ui,
      events: result.events,
      elapsedSeconds,
      pointerLocked: document.pointerLockElement === canvas,
      gallopHeld: bindings.gallopHeld,
      place: regionDisplayName(regionId),
      // Lets the interface turn the answering call's position into an on-screen
      // direction, which is the seeing equivalent of hearing where it came from.
      viewer: { x: horse.position.x, z: horse.position.z, yaw: chaseCamera.yaw },
      diagnostics: {
        fps: smoothedFps,
        frameMilliseconds: smoothedFrameMs,
        simulationSteps: result.timing.steps,
        tick: horse.tick,
        x: horse.position.x,
        y: horse.position.y,
        z: horse.position.z,
        cameraDistance: chaseCamera.currentDistance,
        cameraObstructed: chaseCamera.isObstructed,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
      },
    });

    if (paused && document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
  }

  window.requestAnimationFrame(frame);
  document.documentElement.dataset.windhoof = "running";

  return {
    dispose() {
      running = false;
      graphicsRecovery?.dispose();
      harness.dispose();
      unsubscribeSettings();
      bindings.detach();
      canvas.removeEventListener("click", requestFocus);
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("keydown", onFirstGesture);
      ui.dispose();
      audio.dispose();
      void autosave.flush().finally(() => saveAdapter.close?.());
      hoofContacts.dispose();
      rig.dispose();
      // Strict order. The scene gives back its render retains, the physics world
      // frees Rapier and gives back its physics retains, and only then can the
      // repository be disposed - it throws if any chunk is still retained, which
      // is exactly the check that makes this ordering enforceable rather than
      // merely intended.
      scene.dispose();
      resolver.dispose();
      world.dispose();
      repository.dispose();
      disposeRenderer();
    },
  };
}

function shortestAngle(angle: number): number {
  const twoPi = Math.PI * 2;
  return ((angle + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
}

function emptyDiagnostics() {
  return {
    fps: 0,
    frameMilliseconds: 0,
    simulationSteps: 0,
    tick: 0,
    x: 0,
    y: 0,
    z: 0,
    cameraDistance: 0,
    cameraObstructed: false,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
  };
}

function currentBrowserHeapBytes(): number | undefined {
  const memory = (performance as Performance & {
    readonly memory?: { readonly usedJSHeapSize?: number };
  }).memory;
  const bytes = memory?.usedJSHeapSize;
  return typeof bytes === "number" && Number.isFinite(bytes) ? bytes : undefined;
}
