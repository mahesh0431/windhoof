import type { GameEvent, UiSnapshot } from "../game/contracts/uiContract";

export interface OnboardingObservation {
  readonly elapsedSeconds: number;
  readonly snapshot: UiSnapshot;
  readonly events: readonly GameEvent[];
  readonly pointerLocked: boolean;
  readonly gallopHeld: boolean;
}

export interface OnboardingHint {
  readonly id: string;
  readonly text: string;
}

interface HintDefinition {
  readonly id: string;
  readonly text: string;
  /** Lower runs first when several become eligible on the same frame. */
  readonly order: number;
  ready(state: OnboardingState, observation: OnboardingObservation): boolean;
}

interface OnboardingState {
  hasMoved: boolean;
  hasLooked: boolean;
  hasReachedTrot: boolean;
  hasGalloped: boolean;
  hasJumped: boolean;
  hasStumbled: boolean;
  hasCalled: boolean;
  hasReset: boolean;
  hasPaused: boolean;
  movingSeconds: number;
}

const HINT_DURATION = 6.5;
const MINIMUM_GAP = 9;
const OPENING_QUIET = 1.6;

/**
 * Decides what, if anything, to teach the player next.
 *
 * The rules encode the experience brief's onboarding constraints directly:
 * the opening is playable within seconds, explanations follow the player's own
 * actions, only one thing is ever said at a time, and nothing is ever said
 * during the first gallop. Kept free of DOM so the policy can be unit-tested.
 */
export class OnboardingDirector {
  private readonly state: OnboardingState = {
    hasMoved: false,
    hasLooked: false,
    hasReachedTrot: false,
    hasGalloped: false,
    hasJumped: false,
    hasStumbled: false,
    hasCalled: false,
    hasReset: false,
    hasPaused: false,
    movingSeconds: 0,
  };

  private readonly delivered = new Set<string>();
  private active: OnboardingHint | null = null;
  private activeUntil = 0;
  private nextEligibleAt = OPENING_QUIET;
  private lastElapsed = 0;

  private readonly hints: readonly HintDefinition[] = [
    {
      id: "move",
      text: "W A S D to move",
      order: 0,
      ready: (state) => !state.hasMoved,
    },
    {
      id: "look",
      text: "Move the mouse to look around",
      order: 1,
      ready: (state, observation) =>
        state.hasMoved && observation.pointerLocked && !state.hasLooked,
    },
    {
      id: "gallop",
      text: "Hold Shift to gallop",
      order: 2,
      ready: (state) => state.hasReachedTrot && !state.hasGalloped,
    },
    {
      id: "jump",
      text: "Space to jump",
      order: 3,
      ready: (state) => state.movingSeconds > 16 && !state.hasJumped,
    },
    {
      id: "recover",
      text: "R returns you to safe ground",
      order: 4,
      // Offered exactly when it becomes relevant: after a stumble or a fall.
      ready: (state) => state.hasStumbled && !state.hasReset,
    },
    {
      id: "pause",
      text: "Esc to pause",
      order: 5,
      ready: (state, observation) =>
        observation.elapsedSeconds > 50 && !state.hasPaused,
    },
    {
      id: "call",
      text: "C to call out",
      order: 6,
      ready: (state, observation) =>
        observation.elapsedSeconds > 75 && !state.hasCalled,
    },
  ];

  public update(observation: OnboardingObservation): OnboardingHint | null {
    const { elapsedSeconds, snapshot } = observation;
    const delta = Math.max(0, elapsedSeconds - this.lastElapsed);
    this.lastElapsed = elapsedSeconds;

    this.observe(observation, delta);

    if (snapshot.mode === "paused" || snapshot.mode === "loading") {
      this.active = null;
      return null;
    }

    if (this.active && elapsedSeconds < this.activeUntil) {
      return this.active;
    }
    this.active = null;

    // Never talk over the player's first gallop. This is the moment the whole
    // product exists for; an interface message during it is a failure.
    if (observation.gallopHeld && snapshot.speedMetersPerSecond > 8) {
      this.nextEligibleAt = Math.max(this.nextEligibleAt, elapsedSeconds + 2.5);
      return null;
    }

    if (elapsedSeconds < this.nextEligibleAt) return null;

    const candidates = this.hints
      .filter((hint) => !this.delivered.has(hint.id))
      .filter((hint) => hint.ready(this.state, observation))
      .sort((left, right) => left.order - right.order);

    const next = candidates[0];
    if (!next) return null;

    this.delivered.add(next.id);
    this.active = { id: next.id, text: next.text };
    this.activeUntil = elapsedSeconds + HINT_DURATION;
    this.nextEligibleAt = elapsedSeconds + HINT_DURATION + MINIMUM_GAP;
    return this.active;
  }

  /** Exposed for the controls panel, so it can show what is still unlearned. */
  public get progress(): Readonly<OnboardingState> {
    return this.state;
  }

  private observe(observation: OnboardingObservation, delta: number): void {
    const { snapshot, events } = observation;

    if (snapshot.speedMetersPerSecond > 0.4) {
      this.state.hasMoved = true;
      this.state.movingSeconds += delta;
    }
    if (observation.pointerLocked && this.state.movingSeconds > 3) {
      this.state.hasLooked = true;
    }
    if (snapshot.gait === "trot" || snapshot.gait === "canter") {
      this.state.hasReachedTrot = true;
    }
    if (snapshot.gait === "gallop") this.state.hasGalloped = true;
    if (snapshot.mode === "recovering") this.state.hasStumbled = true;

    for (const event of events) {
      if (event.type === "HorseJumped") this.state.hasJumped = true;
      if (event.type === "HorseCalled") this.state.hasCalled = true;
      if (event.type === "HorseReset") this.state.hasReset = true;
      if (event.type === "PauseChanged" && event.paused) this.state.hasPaused = true;
      if (event.type === "HorseLanded" && event.hard) this.state.hasStumbled = true;
    }
  }
}
