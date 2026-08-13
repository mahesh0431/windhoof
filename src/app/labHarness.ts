import type { GameCommand } from "../game/contracts/uiContract";
import type { GraphicsLifecycleSnapshot } from "../game/contracts/runtimeLifecycle";
import type { HorseEdgeAction } from "../game/input/horseInputBuffer";
import type { ChaseCamera } from "../render/camera/chaseCamera";
import type { PresentationSettings, PresentationSettingsStore } from "../ui/presentationSettings";
import type { InputBindings } from "./inputBindings";
import type { PreparationJobRecord } from "./preparationLog";

export interface LabHarnessState {
  readonly frame: number;
  readonly elapsedSeconds: number;
  readonly mode: string;
  readonly tick: number;
  readonly speed: number;
  readonly gait: string;
  readonly grounded: boolean;
  readonly condition: string;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly cameraDistance: number;
  readonly cameraObstructed: boolean;
  readonly drawCalls: number;
  readonly triangles: number;
  /**
   * Presentation state, so browser checks can see whether the horse is
   * actually moving as a body rather than only whether the controller says so.
   */
  readonly rigBodyHeight: number;
  readonly rigSpineFlex: number;
  readonly debrisLive: number;
  /**
   * Audio state, so an automated run can prove it is silent rather than assume
   * it. `audioMuted` is the `?mute=1` decision; the other two are what actually
   * happened, which is the part worth checking.
   */
  readonly audioMuted: boolean;
  readonly audioContextCreated: boolean;
  readonly audioRunning: boolean;
  /**
   * Compiled-island fields. Absent in the Horse Lab, which has no manifest and
   * no named regions.
   */
  readonly stage?: string;
  readonly fps?: number;
  readonly frameMilliseconds?: number;
  readonly geometries?: number;
  readonly programs?: number;
  readonly groundCoverTufts?: number;
  readonly groundCoverTriangles?: number;
  /** Repository readiness and resource counters, for browser-observable checks. */
  readonly chunks?: {
    readonly totalChunks: number;
    readonly activeChunks: number;
    readonly physicsReadyChunks: number;
    readonly renderReadyChunks: number;
    readonly physicsRetains: number;
    readonly renderRetains: number;
    readonly longestPreparationMilliseconds: number;
  };
  readonly renderRetainCount?: number;
  /**
   * The exploration journey, as the player-facing layer sees it. Absent in the
   * Horse Lab, which has no discoveries.
   */
  readonly journey?: {
    readonly objectiveKind: string | null;
    readonly objectiveId: string | null;
    readonly known: readonly {
      readonly id: string;
      readonly kind: string;
      readonly state: string;
    }[];
    readonly interactionId: string | null;
    readonly interactionKind: string | null;
    readonly completedMandatory: number;
    readonly totalMandatory: number;
    readonly complete: boolean;
    readonly persistenceStatus: string;
    readonly lastSavedTick: number | null;
    readonly startKind: string;
    /** True while a quarantined ride is still waiting to be acknowledged. */
    readonly persistenceWritesEnabled: boolean;
  };
  /**
   * Named preparation-job timings, summarised. The milestone's main-thread
   * stall gate is checked against `longestMilliseconds`, and `longestName`
   * points a failure straight at the job that caused it.
   */
  readonly preparation?: {
    readonly jobCount: number;
    readonly longestMilliseconds: number;
    readonly longestName: string | null;
    readonly totalMilliseconds: number;
  };
  /** Fixed-capacity active-runtime timings; values warm over the latest 600 frames. */
  readonly runtime?: {
    readonly frameP95Milliseconds: number;
    readonly physicsP95Milliseconds: number;
    readonly frameSamples: number;
    readonly physicsSamples: number;
    readonly browserHeapBytes?: number;
  };
  readonly regionId?: string;
  readonly manifestHash?: string;
  readonly terrainTriangles?: number;
  readonly sceneryElements?: number;
  readonly boundaryRadius?: number;
}

export interface LabHarness {
  readonly ready: true;
  state(): LabHarnessState;
  setMove(x: number, y: number): void;
  setGallop(active: boolean): void;
  press(action: HorseEdgeAction): void;
  look(deltaX: number, deltaY: number): void;
  command(command: GameCommand): void;
  setSettings(patch: Partial<PresentationSettings>): void;
  cameraYaw(): number;
  setCameraYaw(yaw: number): void;
  /** Every retained preparation job, oldest first. Empty in the Horse Lab. */
  preparationJobs(): readonly PreparationJobRecord[];
  /**
   * Where the compiled world put its discoveries. Empty in the Horse Lab.
   *
   * This exists so automated rides can steer by the island that was actually
   * built. Coordinates copied into a script go stale silently: when the
   * compiler moved three story scenes, the walkthrough kept driving to the old
   * spot and kept photographing the same patch of grass. Reading the layout
   * back means a moved scene changes the route instead of invalidating it.
   */
  scenes(): readonly HarnessScene[];
  /** The compiled regions and their anchors. Empty in the Horse Lab. */
  regions(): readonly HarnessRegion[];
  /**
   * Holds the camera at a fixed point, looking at another.
   *
   * Purely a viewpoint: the horse keeps simulating wherever it is standing and
   * nothing in the world moves. This exists because the island is 1,024 metres
   * across and a software renderer covers about two metres of it per second of
   * wall clock, so riding to every region for a screenshot is a twenty-minute
   * automation run and was the shape of the one that hung.
   *
   * Evidence taken this way is a view of a real place in the real build, and it
   * is not evidence that a player can get there. Anything about reachability or
   * pacing still has to be ridden.
   */
  observe(
    from: { readonly x: number; readonly y: number; readonly z: number },
    lookAt: { readonly x: number; readonly y: number; readonly z: number },
  ): void;
  /** Gives the camera back to the horse. */
  release(): void;
  /** Ground height at a point, so a viewpoint can be placed above terrain. */
  heightAt(x: number, z: number): number;
  /** Where WebGL recovery has got to. */
  graphics(): GraphicsLifecycleSnapshot;
  /**
   * Takes the WebGL context away, or gives it back, through the browser's own
   * `WEBGL_lose_context` extension.
   *
   * This drives the real `webglcontextlost` and `webglcontextrestored` events
   * on the real canvas, so what it exercises is the path a driver reset takes
   * and not a simulated one. Returns false where the extension is unavailable,
   * so a check can report "not exercised" instead of quietly passing.
   */
  loseGraphicsContext(): boolean;
  restoreGraphicsContext(): boolean;
  /** The player-facing resume after a restored context. */
  resumeGraphics(): boolean;
}

export interface HarnessRegion {
  readonly id: string;
  readonly displayName: string;
  readonly terrainFamily: string;
  readonly anchor: { readonly x: number; readonly z: number };
}

export interface HarnessScene {
  readonly id: string;
  readonly kind: string;
  readonly mandatory: boolean;
  readonly visitRadiusMeters: number;
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  /**
   * How the world says this scene is finished.
   *
   * Exposed because an automated ride cannot otherwise know what to do when it
   * arrives, and guessing produces false failures: a ride that only ever tries
   * the interact key records a call-completed trace as unfinished when nothing
   * is wrong with it at all.
   */
  readonly completion: { readonly kind: string; readonly interaction?: string };
}

declare global {
  interface Window {
    __windhoofLab?: LabHarness;
  }
}

interface HarnessDependencies {
  readonly bindings: InputBindings;
  readonly camera: ChaseCamera;
  readonly settings: PresentationSettingsStore;
  command(command: GameCommand): void;
  state(): Record<string, unknown>;
  /** Absent in the Horse Lab, which realizes no world. */
  preparationJobs?(): readonly PreparationJobRecord[];
  /** Absent in the Horse Lab, which has no manifest. */
  scenes?(): readonly HarnessScene[];
  regions?(): readonly HarnessRegion[];
  observe?(
    from: { readonly x: number; readonly y: number; readonly z: number },
    lookAt: { readonly x: number; readonly y: number; readonly z: number },
  ): void;
  release?(): void;
  heightAt?(x: number, z: number): number;
  graphics?(): GraphicsLifecycleSnapshot;
  loseGraphicsContext?(): boolean;
  restoreGraphicsContext?(): boolean;
  resumeGraphics?(): boolean;
}

/**
 * Drives the running build from automated browser checks.
 *
 * Screenshots of a game that has never moved prove very little, so the visual
 * verification pass needs to put the horse into real states — mid-gallop, in
 * the air, behind a tree — and then look at the result. This is the seam that
 * makes that possible without a second code path through the simulation: it
 * writes into exactly the same input buffer the keyboard writes into.
 *
 * Only installed in a development build, or when `?lab=1` is present.
 */
export function installLabHarness(dependencies: HarnessDependencies): {
  dispose(): void;
} {
  const enabled =
    import.meta.env.DEV ||
    (typeof location !== "undefined" && location.search.includes("lab=1"));

  if (!enabled) return { dispose: () => undefined };

  const harness: LabHarness = {
    ready: true,
    state: () => dependencies.state() as unknown as LabHarnessState,
    setMove: (x, y) => dependencies.bindings.buffer.setMove(x, y),
    setGallop: (active) =>
      dependencies.bindings.buffer.setContinuous("gallopHeld", active),
    press: (action) => dependencies.bindings.buffer.press(action),
    look: (deltaX, deltaY) => dependencies.camera.look(deltaX, deltaY),
    command: (command) => dependencies.command(command),
    setSettings: (patch) => {
      dependencies.settings.update(patch);
    },
    cameraYaw: () => dependencies.camera.yaw,
    setCameraYaw: (yaw) => dependencies.camera.setYaw(yaw),
    preparationJobs: () => dependencies.preparationJobs?.() ?? [],
    scenes: () => dependencies.scenes?.() ?? [],
    regions: () => dependencies.regions?.() ?? [],
    observe: (from, lookAt) => dependencies.observe?.(from, lookAt),
    release: () => dependencies.release?.(),
    heightAt: (x, z) => dependencies.heightAt?.(x, z) ?? 0,
    graphics: () => dependencies.graphics?.() ?? { status: "ready", generation: 0 },
    loseGraphicsContext: () => dependencies.loseGraphicsContext?.() ?? false,
    restoreGraphicsContext: () => dependencies.restoreGraphicsContext?.() ?? false,
    resumeGraphics: () => dependencies.resumeGraphics?.() ?? false,
  };

  window.__windhoofLab = harness;

  return {
    dispose() {
      delete window.__windhoofLab;
    },
  };
}
