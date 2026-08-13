import {
  NEUTRAL_HORSE_INPUT,
  type HorseInputFrame,
} from "../contracts/input";
import { clamp } from "../contracts/math";

export type HorseContinuousAction =
  | "gallopHeld";

export type HorseEdgeAction =
  | "jumpPressed"
  | "callPressed"
  | "interactPressed"
  | "resetPressed"
  | "pausePressed";

/**
 * Renderer-rate input enters here; the simulation consumes a stable snapshot.
 * Edge actions remain latched until a fixed tick has consumed them once.
 */
export class HorseInputBuffer {
  private moveX = 0;
  private moveY = 0;
  private cameraYaw = 0;
  private gallopHeld = false;
  private readonly edgeActions = new Set<HorseEdgeAction>();

  public setMove(x: number, y: number): void {
    this.moveX = clamp(Number.isFinite(x) ? x : 0, -1, 1);
    this.moveY = clamp(Number.isFinite(y) ? y : 0, -1, 1);
  }

  public setCameraYaw(yaw: number): void {
    this.cameraYaw = Number.isFinite(yaw) ? yaw : 0;
  }

  public setContinuous(action: HorseContinuousAction, active: boolean): void {
    if (action === "gallopHeld") this.gallopHeld = active;
  }

  public press(action: HorseEdgeAction): void {
    this.edgeActions.add(action);
  }

  public peek(): HorseInputFrame {
    return {
      ...NEUTRAL_HORSE_INPUT,
      moveX: this.moveX,
      moveY: this.moveY,
      cameraYaw: this.cameraYaw,
      gallopHeld: this.gallopHeld,
      jumpPressed: this.edgeActions.has("jumpPressed"),
      callPressed: this.edgeActions.has("callPressed"),
      interactPressed: this.edgeActions.has("interactPressed"),
      resetPressed: this.edgeActions.has("resetPressed"),
      pausePressed: this.edgeActions.has("pausePressed"),
    };
  }

  public consume(): HorseInputFrame {
    const frame = this.peek();
    this.edgeActions.clear();
    return frame;
  }

  public clear(): void {
    this.moveX = 0;
    this.moveY = 0;
    this.cameraYaw = 0;
    this.gallopHeld = false;
    this.edgeActions.clear();
  }
}

