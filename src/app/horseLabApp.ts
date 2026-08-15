import { MathUtils, Vector3 } from "three";
import type { GameCommand } from "../game/contracts/uiContract";
import { DEFAULT_HORSE_TUNING } from "../game/simulation/horse/horseTuning";
import { HorseLabSimulation } from "../game/simulation/horseLabSimulation";
import { RapierHorseMotionResolver } from "../physics/rapierHorseMotionResolver";
import { initializeRapier } from "../physics/rapierRuntime";
import { ChaseCamera } from "../render/camera/chaseCamera";
import { HorseGaitAnimator } from "../render/horse/horseGaitAnimator";
import { createHoofContacts } from "../render/horse/hoofContacts";
import { createHorseRig } from "../render/horse/horseVisual";
import { createRenderer } from "../render/renderer";
import { createStageScene } from "../render/world/stageScene";
import {
  STAGE_SHORE_RADIUS,
  STAGE_SPAWN,
  STAGE_SPAWN_YAW,
  STAGE_WATER_LEVEL,
  stageHeightAt,
  stageNormalAt,
} from "../stage/horseLabStage";
import { StageWorld } from "../stage/stageWorld";
import { LongrideAudio } from "../audio/longrideAudio";
import { PresentationSettingsStore } from "../ui/presentationSettings";
import { createLongrideUi } from "../ui/longrideUi";
import { createInputBindings } from "./inputBindings";
import { installLabHarness } from "./labHarness";
import { resolveRuntimeFlags } from "./runtimeFlags";
import type { LongrideApp } from "./longrideApp";

/** Metres above the water line that still count as wet ground underfoot. */
const WET_GROUND_BAND = 0.35;

export async function startHorseLab(
  canvas: HTMLCanvasElement,
  uiHost: HTMLElement,
): Promise<LongrideApp> {
  const settings = new PresentationSettingsStore();

  const { renderer, camera, resize, dispose: disposeRenderer } = createRenderer(canvas);

  const ui = createLongrideUi(uiHost, settings, {
    onCommand: (command) => applyCommand(command),
    onRequestFocus: () => requestFocus(),
  });

  await initializeRapier();

  const stage = new StageWorld();
  const scene = createStageScene(stage);

  const spawnHeight = stageHeightAt(STAGE_SPAWN.x, STAGE_SPAWN.z);
  const spawn = { x: STAGE_SPAWN.x, y: spawnHeight + 0.05, z: STAGE_SPAWN.z };

  const resolver = new RapierHorseMotionResolver(
    stage.world,
    spawn,
    undefined,
    (position) => stage.isSafeGround(position.x, position.z),
  );
  const simulation = new HorseLabSimulation(
    { position: spawn, yaw: STAGE_SPAWN_YAW },
    resolver,
  );

  const rig = createHorseRig();
  rig.root.position.set(spawn.x, spawn.y, spawn.z);
  rig.root.rotation.y = STAGE_SPAWN_YAW;
  scene.scene.add(rig.root);

  const animator = new HorseGaitAnimator();
  const hoofContacts = createHoofContacts();
  scene.scene.add(hoofContacts.points);

  const chaseCamera = new ChaseCamera(camera, stage, stageHeightAt);
  chaseCamera.setYaw(STAGE_SPAWN_YAW);

  const flags = resolveRuntimeFlags();
  const audio = new LongrideAudio({ muted: flags.muted });
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
    simulation.command(command);
    if (command.type === "Resume") requestFocus();
    if (command.type === "SetCameraSensitivity") {
      chaseCamera.settings.sensitivity = command.value;
    }
    if (command.type === "SetReducedMotion") {
      chaseCamera.settings.reducedMotion = command.enabled;
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

  /**
   * Leaving the window pauses. Without this the horse keeps running behind a
   * window the player is no longer looking at, and they come back to a state
   * they did not choose.
   */
  const onWindowBlur = () => {
    if (currentMode === "playing" || currentMode === "recovering") {
      applyCommand({ type: "Pause" });
    }
  };

  /**
   * Browsers only allow audio to start from a user gesture. Tying that to the
   * canvas click alone left a keyboard-only player with a silent game, so the
   * first keypress counts too.
   */
  const onFirstGesture = () => {
    void audio.resume();
    window.removeEventListener("keydown", onFirstGesture);
  };

  canvas.addEventListener("click", requestFocus);
  window.addEventListener("resize", resize);
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("keydown", onFirstGesture);

  const hoofWorldPosition = new Vector3();

  /**
   * Throws debris from where the hoof actually is, not from under the horse's
   * centre. `getWorldPosition` refreshes the chain it needs, so this is the
   * current frame's pose rather than the previously rendered one.
   */
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
    const groundY = stageHeightAt(hoofWorldPosition.x, hoofWorldPosition.z);
    // The stage floors the shore shelf just above the water line and the ford
    // sits just below it, so a small band either side of that line is the wet
    // ground a horse actually splashes through. Surface classification alone
    // cannot tell that apart: the shore is sand and the ford is streambed.
    const submerged = groundY < STAGE_WATER_LEVEL + WET_GROUND_BAND;
    hoofContacts.strike(
      hoofWorldPosition.x,
      groundY,
      hoofWorldPosition.z,
      stage.surfaceAt(hoofWorldPosition.x, hoofWorldPosition.z),
      submerged,
      weight,
      speed,
      forwardX,
      forwardZ,
    );
  }

  let currentMode: string = "playing";
  let previousYaw = STAGE_SPAWN_YAW;
  let previousSpeed = 0;
  let previousVerticalVelocity = 0;
  let elapsedSeconds = 0;
  let lastFrameTime = performance.now();
  let smoothedFps = 60;
  let smoothedFrameMs = 16.7;
  let running = true;
  let frameCount = 0;

  // Prime one frame so the first painted image is the world, never an empty
  // canvas behind the loading panel.
  const initialFrame = simulation.snapshot();
  scene.update(0, spawn.x, spawn.y, spawn.z);
  chaseCamera.update(
    { ...spawn, yaw: STAGE_SPAWN_YAW, speed: 0, grounded: true },
    1 / 60,
  );
  renderer.render(scene.scene, camera);
  ui.update({
    snapshot: initialFrame.ui,
    events: [],
    elapsedSeconds: 0,
    pointerLocked: false,
    gallopHeld: false,
    diagnostics: emptyDiagnostics(),
  });
  ui.setLoaded();

  const harness = installLabHarness({
    bindings,
    camera: chaseCamera,
    settings,
    command: applyCommand,
    state: () => ({
      frame: frameCount,
      elapsedSeconds,
      mode: currentMode,
      ...simulation.authoritativeStateForDiagnostics(),
      cameraDistance: chaseCamera.currentDistance,
      cameraObstructed: chaseCamera.isObstructed,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      rigBodyHeight: rig.body.position.y,
      rigSpineFlex: rig.spine.rotation.x,
      debrisLive: hoofContacts.liveCount(),
      // Read-only proof of the mute contract: muted means this page will never
      // hold a running audio context, whatever it is asked to play.
      audioMuted: audio.isMuted,
      audioContextCreated: audio.hasContext,
      audioRunning: audio.isRunning,
    }),
  });

  function frame(now: number): void {
    if (!running) return;
    window.requestAnimationFrame(frame);

    const rawDelta = (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    const delta = MathUtils.clamp(rawDelta, 0, 0.1);
    elapsedSeconds += delta;
    frameCount += 1;

    smoothedFrameMs = MathUtils.lerp(smoothedFrameMs, rawDelta * 1000, 0.08);
    smoothedFps = MathUtils.lerp(smoothedFps, 1 / Math.max(rawDelta, 0.001), 0.08);

    bindings.buffer.setCameraYaw(chaseCamera.yaw);
    const input = bindings.buffer.consume();
    const result = simulation.advanceFrame(delta, input);
    const horse = result.horse;
    currentMode = result.ui.mode;

    // --- horse presentation -------------------------------------------------
    rig.root.position.set(horse.position.x, horse.position.y, horse.position.z);
    rig.root.rotation.y = horse.yaw;

    const yawRate = shortestAngle(horse.yaw - previousYaw) / Math.max(delta, 0.0001);
    const acceleration = (horse.speed - previousSpeed) / Math.max(delta, 0.0001);
    previousYaw = horse.yaw;
    previousSpeed = horse.speed;

    const normal = stageNormalAt(horse.position.x, horse.position.z);
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
      // Only conform to the slope while actually on it.
      groundPitch: horse.grounded ? groundPitch : 0,
      groundRoll: horse.grounded ? groundRoll : 0,
      deltaSeconds: delta,
      reducedMotion: settings.value.reducedMotion,
    });

    // --- audio and event feedback ------------------------------------------
    const surface = stage.surfaceAt(horse.position.x, horse.position.z);
    for (const footfall of animator.consumeFootfalls()) {
      audio.hoof(footfall.weight, footfall.isFront, surface);
      spawnHoofDebris(footfall.leg, footfall.weight, horse.speed, forwardX, forwardZ);
    }

    for (const event of result.events) {
      if (event.type === "HorseCalled") audio.whinny();
      if (event.type === "HorseJumped") {
        animator.takeOff(1);
      }
      if (event.type === "HorseLanded") {
        audio.land(event.hard);
        // Impact strength comes from the descent speed the horse actually
        // carried, so a hop off a kerb and a drop off the plateau do not fold
        // the horse up by the same amount.
        const impact = MathUtils.clamp(
          -previousVerticalVelocity / DEFAULT_HORSE_TUNING.hardLandingSpeed,
          0.18,
          1.3,
        );
        animator.land(impact);
        chaseCamera.impulse(event.hard ? 0.85 : 0.2);
        // All four hooves at once, so a landing kicks up visibly more than a
        // stride does.
        for (const leg of rig.legs) {
          spawnHoofDebris(leg.id, 0.55 + impact * 0.6, horse.speed, forwardX, forwardZ);
        }
      }
    }
    previousVerticalVelocity = horse.verticalVelocity;
    // Vertical projection scale in device pixels per metre at one metre, so
    // debris keeps its real size whatever the window size or field of view.
    hoofContacts.update(
      delta,
      renderer.domElement.height /
        (2 * Math.tan(MathUtils.degToRad(camera.fov) / 2)),
    );

    audio.update({
      speed: horse.speed,
      gait: horse.gait,
      surface,
      grounded: horse.grounded,
      shoreDistance:
        STAGE_SHORE_RADIUS - Math.hypot(horse.position.x, horse.position.z),
      deltaSeconds: delta,
    });

    // --- camera and scene ---------------------------------------------------
    const paused = result.ui.mode === "paused";
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
    renderer.render(scene.scene, camera);

    // --- interface ----------------------------------------------------------
    ui.update({
      snapshot: result.ui,
      events: result.events,
      elapsedSeconds,
      pointerLocked: document.pointerLockElement === canvas,
      gallopHeld: bindings.gallopHeld,
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

    // Pausing must also take the mouse back. Camera input continuing under a
    // modal surface is an explicit experience-brief failure.
    if (paused && document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }
  }

  window.requestAnimationFrame(frame);
  document.documentElement.dataset.longride = "running";

  return {
    dispose() {
      running = false;
      harness.dispose();
      unsubscribeSettings();
      bindings.detach();
      canvas.removeEventListener("click", requestFocus);
      window.removeEventListener("resize", resize);
      window.removeEventListener("blur", onWindowBlur);
      window.removeEventListener("keydown", onFirstGesture);
      ui.dispose();
      audio.dispose();
      hoofContacts.dispose();
      rig.dispose();
      scene.dispose();
      resolver.dispose();
      stage.dispose();
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
