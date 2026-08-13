import { describe, expect, it } from "vitest";
import type { GameEvent, UiSnapshot } from "../../src/game/contracts/uiContract";
import { OnboardingDirector } from "../../src/ui/onboardingDirector";

function snapshot(overrides: Partial<UiSnapshot> = {}): UiSnapshot {
  return {
    mode: "playing",
    gait: "idle",
    speedMetersPerSecond: 0,
    grounded: true,
    canJump: true,
    canReset: true,
    controlContext: "horse-lab",
    objectiveId: null,
    worldId: null,
    currentRegionId: null,
    objective: null,
    knownDiscoveries: [],
    contextualInteraction: null,
    completedMandatoryDiscoveries: 0,
    totalMandatoryDiscoveries: 0,
    journeyComplete: false,
    persistence: { status: "unavailable", lastSavedTick: null },
    ...overrides,
  };
}

interface StepOptions {
  readonly snapshot?: Partial<UiSnapshot>;
  readonly events?: readonly GameEvent[];
  readonly pointerLocked?: boolean;
  readonly gallopHeld?: boolean;
}

/**
 * A simulated player session.
 *
 * It records hints that *start*, not every frame one is visible: a hint stays
 * on screen for several seconds after it is chosen, and the visible-frame count
 * would confuse "still showing" with "shown again". The displayed hint carries
 * across calls so splitting a session into phases does not fake a repeat.
 */
class Session {
  public readonly director = new OnboardingDirector();
  public readonly timeline: Array<{ id: string; at: number }> = [];
  private previous: string | null = null;

  public run(fromSeconds: number, toSeconds: number, options: StepOptions = {}): string[] {
    const started: string[] = [];

    for (let t = fromSeconds; t <= toSeconds; t += 0.25) {
      const hint = this.director.update({
        elapsedSeconds: t,
        snapshot: snapshot(options.snapshot),
        events: options.events ?? [],
        pointerLocked: options.pointerLocked ?? false,
        gallopHeld: options.gallopHeld ?? false,
      });
      const id = hint?.id ?? null;
      if (id && id !== this.previous) {
        started.push(id);
        this.timeline.push({ id, at: t });
      }
      this.previous = id;
    }

    return started;
  }
}

describe("onboarding director", () => {
  it("says nothing at all in the opening seconds", () => {
    expect(new Session().run(0, 1.4)).toEqual([]);
  });

  it("offers movement once the player has not moved", () => {
    expect(new Session().run(0, 3)).toEqual(["move"]);
  });

  it("never repeats a hint it has already given", () => {
    const session = new Session();
    session.run(0, 3);
    const later = session.run(3, 60, { snapshot: { speedMetersPerSecond: 0 } });
    expect(later).not.toContain("move");
  });

  it("shows at most one hint at a time", () => {
    const session = new Session();
    for (let t = 0; t <= 120; t += 0.25) {
      const hint = session.director.update({
        elapsedSeconds: t,
        snapshot: snapshot({ gait: "trot", speedMetersPerSecond: 5 }),
        events: [],
        pointerLocked: true,
        gallopHeld: false,
      });
      expect(hint === null || typeof hint.id === "string").toBe(true);
    }
  });

  it("stays silent during the first gallop", () => {
    const session = new Session();
    session.run(0, 10);

    const duringGallop = session.run(10, 50, {
      snapshot: { gait: "gallop", speedMetersPerSecond: 16 },
      gallopHeld: true,
    });
    expect(duringGallop).toEqual([]);
  });

  it("stays silent while paused", () => {
    expect(new Session().run(0, 30, { snapshot: { mode: "paused" } })).toEqual([]);
  });

  it("teaches gallop only after the player has found a faster gait", () => {
    const session = new Session();
    session.run(0, 3);
    const shown = session.run(3, 30, {
      snapshot: { gait: "trot", speedMetersPerSecond: 5 },
      pointerLocked: true,
    });
    expect(shown).toContain("gallop");
  });

  it("offers recovery only after something has gone wrong", () => {
    const quiet = new Session();
    expect(quiet.run(0, 45, { snapshot: { gait: "walk", speedMetersPerSecond: 2 } }))
      .not.toContain("recover");

    const stumbled = new Session();
    stumbled.run(0, 3);
    const shown = stumbled.run(3, 40, {
      snapshot: { mode: "recovering", gait: "walk", speedMetersPerSecond: 2 },
    });
    expect(shown).toContain("recover");
  });

  it("leaves a gap between hints rather than queueing them up", () => {
    const session = new Session();
    session.run(0, 130, {
      snapshot: { mode: "recovering", gait: "trot", speedMetersPerSecond: 5 },
      pointerLocked: true,
    });

    expect(session.timeline.length).toBeGreaterThan(2);
    for (let index = 1; index < session.timeline.length; index += 1) {
      const gap = session.timeline[index]!.at - session.timeline[index - 1]!.at;
      expect(gap).toBeGreaterThanOrEqual(9);
    }
  });

  it("records what the player has actually done", () => {
    const session = new Session();
    session.director.update({
      elapsedSeconds: 5,
      snapshot: snapshot({ gait: "gallop", speedMetersPerSecond: 16 }),
      events: [{ type: "HorseJumped" }, { type: "HorseCalled" }],
      pointerLocked: true,
      gallopHeld: true,
    });

    expect(session.director.progress.hasGalloped).toBe(true);
    expect(session.director.progress.hasJumped).toBe(true);
    expect(session.director.progress.hasCalled).toBe(true);
  });
});
