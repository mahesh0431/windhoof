import { NEUTRAL_HORSE_INPUT, type HorseInputFrame } from "../contracts/input";
import type { Pose } from "../contracts/math";
import type { PersistenceSnapshot } from "../contracts/save";
import type {
  HorseRenderState,
  InterpolatedHorseRenderState,
} from "../contracts/renderContract";
import type { GameCommand, GameEvent, UiSnapshot } from "../contracts/uiContract";
import type { HorseMotionResolver } from "../../physics/horseMotionResolver";
import { createGameSave, type GameSaveV1 } from "../save/saveSchema";
import type { WorldManifest } from "../world/compiler/worldTypes";
import { FixedStepClock, type FixedStepResult } from "./fixedStep";
import { createIslandUiSnapshot } from "./exploration/createIslandUiSnapshot";
import {
  createExplorationState,
  type ExplorationState,
} from "./exploration/explorationState";
import { stepExploration } from "./exploration/stepExploration";
import {
  createHorseRenderState,
  interpolateHorseRenderState,
} from "./horse/createRenderState";
import { applyHorseShove, stepHorse } from "./horse/horseController";
import { createInitialHorseState, type HorseState } from "./horse/horseState";
import { DEFAULT_HORSE_TUNING, type HorseTuning } from "./horse/horseTuning";
import { SimulationInputLatch } from "./inputLatch";

export interface IslandSimulationFrame {
  readonly horse: InterpolatedHorseRenderState;
  readonly ui: UiSnapshot;
  readonly events: readonly GameEvent[];
  readonly timing: FixedStepResult;
}

export interface IslandSimulationInitialState {
  readonly discoveryStates?: ExplorationState["discoveryStates"];
  readonly playTimeTicks?: number;
  readonly persistence?: PersistenceSnapshot;
}

export class IslandSimulation {
  private horseState: HorseState;
  private explorationState: ExplorationState;
  private previousRenderState: HorseRenderState;
  private currentRenderState: HorseRenderState;
  private readonly clock: FixedStepClock;
  private readonly inputLatch = new SimulationInputLatch();
  private readonly pendingEvents: GameEvent[] = [];
  private persistence: PersistenceSnapshot;
  private currentRegionId: string;
  private paused = false;

  public constructor(
    initialPose: Pose,
    private readonly motionResolver: HorseMotionResolver,
    private readonly manifest: WorldManifest,
    private readonly regionAt: (x: number, z: number) => string,
    initial: IslandSimulationInitialState = {},
    private readonly tuning: HorseTuning = DEFAULT_HORSE_TUNING,
  ) {
    this.horseState = createInitialHorseState(initialPose);
    this.explorationState = createExplorationState(
      manifest,
      initial.discoveryStates,
      initial.playTimeTicks,
    );
    this.previousRenderState = createHorseRenderState(this.horseState);
    this.currentRenderState = this.previousRenderState;
    this.clock = new FixedStepClock({ stepSeconds: tuning.fixedStepSeconds });
    this.persistence = initial.persistence ?? { status: "ready", lastSavedTick: null };
    this.currentRegionId = regionAt(initialPose.position.x, initialPose.position.z);
  }

  public advanceFrame(
    frameSeconds: number,
    frameInput: HorseInputFrame,
  ): IslandSimulationFrame {
    const changedPauseState = frameInput.pausePressed;
    if (changedPauseState) this.setPaused(!this.paused);
    if (!this.paused && !changedPauseState) this.inputLatch.capture(frameInput);

    const timing = this.paused
      ? { steps: 0, interpolationAlpha: 1, droppedSeconds: 0 }
      : this.clock.advance(frameSeconds, () => {
          this.stepOnce(this.inputLatch.consumeStep());
        });

    return this.frame(timing);
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
      case "ShoveHorse":
        // Refused while paused, and refused mid-reset: both are states where
        // the player is not in control of the horse, and neither should be able
        // to bank a shove that lands the moment they get it back.
        if (this.paused) break;
        this.horseState = applyHorseShove(this.horseState, command, this.tuning);
        this.pendingEvents.push({ type: "HorseShoved", speed: command.speed });
        break;
      case "StartNewJourney":
      case "SetCameraSensitivity":
      case "SetReducedMotion":
        break;
    }
  }

  public snapshot(): IslandSimulationFrame {
    return this.frame({ steps: 0, interpolationAlpha: 1, droppedSeconds: 0 });
  }

  public updatePersistence(snapshot: PersistenceSnapshot): void {
    if (
      snapshot.status === this.persistence.status &&
      snapshot.lastSavedTick === this.persistence.lastSavedTick
    ) return;
    this.persistence = snapshot;
    this.pendingEvents.push({
      type: "PersistenceStatusChanged",
      status: snapshot.status,
      savedTick: snapshot.lastSavedTick,
    });
  }

  public save(): GameSaveV1 {
    return createGameSave(this.manifest, this.horseState, this.explorationState);
  }

  public authoritativeStateForDiagnostics(): HorseState {
    return this.horseState;
  }

  public authoritativeExplorationForDiagnostics(): ExplorationState {
    return this.explorationState;
  }

  private frame(timing: FixedStepResult): IslandSimulationFrame {
    const events = this.pendingEvents.slice();
    this.pendingEvents.length = 0;
    return {
      horse: interpolateHorseRenderState(
        this.previousRenderState,
        this.currentRenderState,
        timing.interpolationAlpha,
      ),
      ui: createIslandUiSnapshot(
        this.horseState,
        this.explorationState,
        this.manifest,
        this.currentRegionId,
        this.paused,
        this.persistence,
        this.tuning,
      ),
      events,
      timing,
    };
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
    this.stepOnce({ ...NEUTRAL_HORSE_INPUT, resetPressed: true });
    this.currentRegionId = this.regionAt(
      this.horseState.position.x,
      this.horseState.position.z,
    );
    this.previousRenderState = this.currentRenderState;
  }

  /** The sole authoritative tick path for ordinary frames and immediate reset. */
  private stepOnce(input: HorseInputFrame): void {
    this.previousRenderState = this.currentRenderState;
    const horseResult = stepHorse(
      this.horseState,
      input,
      this.motionResolver,
      this.tuning,
    );
    this.horseState = horseResult.state;
    const explorationResult = stepExploration(
      this.manifest,
      this.explorationState,
      this.horseState,
      input,
    );
    this.explorationState = explorationResult.state;
    if (this.horseState.tick % 15 === 0) {
      this.currentRegionId = this.regionAt(
        this.horseState.position.x,
        this.horseState.position.z,
      );
    }
    this.currentRenderState = createHorseRenderState(this.horseState);
    this.pendingEvents.push(...horseResult.events, ...explorationResult.events);
  }
}
