import { NEUTRAL_HORSE_INPUT, type HorseInputFrame } from "../contracts/input";
import type { Pose } from "../contracts/math";
import type {
  HorseRenderState,
  InterpolatedHorseRenderState,
} from "../contracts/renderContract";
import type { GameCommand, GameEvent, UiSnapshot } from "../contracts/uiContract";
import type { HorseMotionResolver } from "../../physics/horseMotionResolver";
import { FixedStepClock, type FixedStepResult } from "./fixedStep";
import {
  createHorseRenderState,
  interpolateHorseRenderState,
} from "./horse/createRenderState";
import { createHorseLabUiSnapshot } from "./horse/createUiSnapshot";
import { stepHorse } from "./horse/horseController";
import { createInitialHorseState, type HorseState } from "./horse/horseState";
import { DEFAULT_HORSE_TUNING, type HorseTuning } from "./horse/horseTuning";
import { SimulationInputLatch } from "./inputLatch";

export interface HorseLabFrame {
  readonly horse: InterpolatedHorseRenderState;
  readonly ui: UiSnapshot;
  readonly events: readonly GameEvent[];
  readonly timing: FixedStepResult;
}

/**
 * Authoritative Horse Lab simulation boundary. Browser UI and Three.js consume
 * its immutable outputs and send commands/actions back through public methods.
 */
export class HorseLabSimulation {
  private state: HorseState;
  private previousRenderState: HorseRenderState;
  private currentRenderState: HorseRenderState;
  private readonly clock: FixedStepClock;
  private readonly inputLatch = new SimulationInputLatch();
  private readonly pendingEvents: GameEvent[] = [];
  private paused = false;

  public constructor(
    initialPose: Pose,
    private readonly motionResolver: HorseMotionResolver,
    private readonly tuning: HorseTuning = DEFAULT_HORSE_TUNING,
  ) {
    this.state = createInitialHorseState(initialPose);
    this.previousRenderState = createHorseRenderState(this.state);
    this.currentRenderState = this.previousRenderState;
    this.clock = new FixedStepClock({ stepSeconds: tuning.fixedStepSeconds });
  }

  public advanceFrame(frameSeconds: number, frameInput: HorseInputFrame): HorseLabFrame {
    const changedPauseState = frameInput.pausePressed;
    if (changedPauseState) {
      this.setPaused(!this.paused);
    }

    if (!this.paused && !changedPauseState) this.inputLatch.capture(frameInput);
    const timing = this.paused
      ? {
          steps: 0,
          interpolationAlpha: 1,
          droppedSeconds: 0,
        }
      : this.clock.advance(frameSeconds, () => {
          const stepInput = this.inputLatch.consumeStep();
          this.previousRenderState = this.currentRenderState;
          const result = stepHorse(
            this.state,
            stepInput,
            this.motionResolver,
            this.tuning,
          );
          this.state = result.state;
          this.currentRenderState = createHorseRenderState(this.state);
          this.pendingEvents.push(...result.events);
        });

    const events = this.drainEvents();
    return {
      horse: interpolateHorseRenderState(
        this.previousRenderState,
        this.currentRenderState,
        timing.interpolationAlpha,
      ),
      ui: createHorseLabUiSnapshot(this.state, this.paused, this.tuning),
      events,
      timing,
    };
  }

  public command(command: GameCommand): void {
    switch (command.type) {
      case "Pause":
        this.setPaused(true);
        break;
      case "Resume":
        this.setPaused(false);
        break;
      case "ResetToSafeGround":
        this.applyImmediateReset();
        break;
      case "StartNewJourney":
      case "SetCameraSensitivity":
      case "SetReducedMotion":
        // These commands belong to presentation settings, not simulation.
        break;
    }
  }

  public snapshot(): HorseLabFrame {
    const timing: FixedStepResult = {
      steps: 0,
      interpolationAlpha: 1,
      droppedSeconds: 0,
    };
    return {
      horse: interpolateHorseRenderState(
        this.currentRenderState,
        this.currentRenderState,
        1,
      ),
      ui: createHorseLabUiSnapshot(this.state, this.paused, this.tuning),
      events: this.drainEvents(),
      timing,
    };
  }

  public authoritativeStateForDiagnostics(): HorseState {
    return this.state;
  }

  private setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.clock.reset();
    this.inputLatch.clear();
    this.pendingEvents.push({ type: "PauseChanged", paused });
  }

  private applyImmediateReset(): void {
    this.inputLatch.clear();
    const result = stepHorse(
      this.state,
      { ...NEUTRAL_HORSE_INPUT, resetPressed: true },
      this.motionResolver,
      this.tuning,
    );
    this.state = result.state;
    this.previousRenderState = createHorseRenderState(this.state);
    this.currentRenderState = this.previousRenderState;
    this.pendingEvents.push(...result.events);
  }

  private drainEvents(): readonly GameEvent[] {
    const events = this.pendingEvents.slice();
    this.pendingEvents.length = 0;
    return events;
  }
}
