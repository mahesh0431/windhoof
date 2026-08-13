import type {
  GraphicsLifecycleEvent,
  GraphicsLifecycleSnapshot,
} from "../game/contracts/runtimeLifecycle";

export interface WebglRecoveryDependencies {
  pauseSimulation(): void;
  clearInput(): void;
  suspendAudio(): void | Promise<void>;
  releasePointer(): void;
  requestSafeSave(): void;
  resize(): void;
  smokeRender(): void | Promise<void>;
  onChange?(): void;
}

/**
 * Runtime-owned WebGL recovery. It never mutates simulation truth and never
 * resumes gameplay without a fresh player command.
 */
export class WebglRecoveryController {
  private status: GraphicsLifecycleSnapshot = { status: "ready", generation: 0 };
  private events: GraphicsLifecycleEvent[] = [];
  private disposed = false;

  public constructor(
    private readonly target: EventTarget,
    private readonly dependencies: WebglRecoveryDependencies,
  ) {
    target.addEventListener("webglcontextlost", this.onContextLost);
    target.addEventListener("webglcontextrestored", this.onContextRestored);
  }

  public snapshot(): GraphicsLifecycleSnapshot {
    return { ...this.status };
  }

  public consumeEvents(): readonly GraphicsLifecycleEvent[] {
    const current = this.events;
    this.events = [];
    return current;
  }

  /** Returns true only when an explicit resume is accepted after restoration. */
  public resume(): boolean {
    if (this.disposed || this.status.status !== "restored-paused") return false;
    this.status = { status: "ready", generation: this.status.generation };
    this.dependencies.onChange?.();
    return true;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener("webglcontextlost", this.onContextLost);
    this.target.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.events = [];
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.disposed || this.status.status === "context-lost") return;
    const generation = this.status.generation + 1;
    this.status = { status: "context-lost", generation };
    this.events.push({ type: "GraphicsContextLost", generation });
    this.dependencies.pauseSimulation();
    this.dependencies.clearInput();
    void Promise.resolve(this.dependencies.suspendAudio()).catch(() => undefined);
    this.dependencies.releasePointer();
    this.dependencies.requestSafeSave();
    this.dependencies.onChange?.();
  };

  private readonly onContextRestored = (): void => {
    if (this.disposed || this.status.status !== "context-lost") return;
    const generation = this.status.generation;
    this.status = { status: "restoring", generation };
    this.dependencies.onChange?.();
    void this.restore(generation);
  };

  private async restore(generation: number): Promise<void> {
    try {
      this.dependencies.resize();
      await this.dependencies.smokeRender();
      if (
        this.disposed ||
        this.status.generation !== generation ||
        this.status.status !== "restoring"
      ) return;
      this.status = { status: "restored-paused", generation };
      this.events.push({ type: "GraphicsContextRestored", generation });
    } catch {
      if (
        this.disposed ||
        this.status.generation !== generation ||
        this.status.status !== "restoring"
      ) return;
      this.status = {
        status: "failed",
        generation,
        failureCode: "restore-render-failed",
      };
      this.events.push({
        type: "GraphicsContextRecoveryFailed",
        generation,
        failureCode: "restore-render-failed",
      });
    }
    this.dependencies.onChange?.();
  }
}
