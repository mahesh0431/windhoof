import {
  NEUTRAL_HORSE_INPUT,
  type HorseInputFrame,
} from "../contracts/input";

type EdgeAction =
  | "jumpPressed"
  | "callPressed"
  | "interactPressed"
  | "resetPressed";

const EDGE_ACTIONS: readonly EdgeAction[] = [
  "jumpPressed",
  "callPressed",
  "interactPressed",
  "resetPressed",
];

/** Keeps render-frame edge actions alive until one authoritative tick consumes them. */
export class SimulationInputLatch {
  private continuous: HorseInputFrame = NEUTRAL_HORSE_INPUT;
  private readonly pending = new Set<EdgeAction>();

  public capture(input: HorseInputFrame): void {
    this.continuous = {
      ...input,
      jumpPressed: false,
      callPressed: false,
      interactPressed: false,
      resetPressed: false,
      pausePressed: false,
    };
    for (const action of EDGE_ACTIONS) {
      if (input[action]) this.pending.add(action);
    }
  }

  public consumeStep(): HorseInputFrame {
    const input = {
      ...this.continuous,
      jumpPressed: this.pending.has("jumpPressed"),
      callPressed: this.pending.has("callPressed"),
      interactPressed: this.pending.has("interactPressed"),
      resetPressed: this.pending.has("resetPressed"),
    };
    this.pending.clear();
    return input;
  }

  /** Discards both held controls and one-shot actions at a context boundary. */
  public clear(): void {
    this.continuous = NEUTRAL_HORSE_INPUT;
    this.pending.clear();
  }
}
