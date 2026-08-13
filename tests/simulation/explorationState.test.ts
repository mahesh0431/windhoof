import { describe, expect, it } from "vitest";
import specJson from "../../docs/contracts/world-spec.example.json";
import { NEUTRAL_HORSE_INPUT, type HorseInputFrame } from "../../src/game/contracts/input";
import type { Pose } from "../../src/game/contracts/math";
import { FlatGroundMotionResolver } from "../../src/physics/flatGroundMotionResolver";
import {
  createExplorationSnapshot,
  createExplorationState,
  type ExplorationState,
} from "../../src/game/simulation/exploration/explorationState";
import {
  PERIODIC_AUTOSAVE_TICKS,
  stepExploration,
} from "../../src/game/simulation/exploration/stepExploration";
import type { HorseState } from "../../src/game/simulation/horse/horseState";
import { IslandSimulation } from "../../src/game/simulation/islandSimulation";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type { WorldSpec } from "../../src/game/world/compiler/worldTypes";

const manifest = compileWorld(specJson as unknown as WorldSpec);

function horseAt(
  position: { readonly x: number; readonly y: number; readonly z: number },
  tick: number,
  overrides: Partial<HorseState> = {},
): HorseState {
  return {
    tick,
    position: { ...position },
    yaw: 0,
    speed: 0,
    verticalVelocity: 0,
    gait: "idle",
    grounded: true,
    lastGroundedTick: tick,
    airborneTicks: 0,
    jumpConsumedSinceGrounded: false,
    lastSafePose: { position: { ...position }, yaw: 0 },
    condition: "normal",
    recoveryTicksRemaining: 0,
    ...overrides,
  };
}

function input(overrides: Partial<HorseInputFrame> = {}): HorseInputFrame {
  return { ...NEUTRAL_HORSE_INPUT, ...overrides };
}

function discovery(id: string) {
  const value = manifest.discoveries.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing fixture discovery ${id}`);
  return value;
}

function advancePure(
  state: ExplorationState,
  horse: HorseState,
  frameInput: HorseInputFrame = NEUTRAL_HORSE_INPUT,
) {
  return stepExploration(manifest, state, horse, frameInput);
}

describe("deterministic exploration state", () => {
  it("emits every monotonic transition once in stable order", () => {
    const wildlife = discovery("plain-wildlife-crossing");
    const result = advancePure(
      createExplorationState(manifest),
      horseAt(wildlife.position, 1),
    );
    const transitions = result.events.flatMap((event) =>
      event.type === "DiscoveryStateChanged" && event.discoveryId === wildlife.id
        ? [event.state]
        : []);
    expect(transitions).toEqual([
      "revealed",
      "visited",
      "completed",
    ]);
    expect(result.state.discoveryStates[wildlife.id]).toBe("completed");

    const repeated = advancePure(result.state, horseAt(wildlife.position, 2));
    expect(repeated.events.some((event) => event.type === "DiscoveryStateChanged")).toBe(false);
  });

  it("schedules one response only inside the authored zone and resolves on the exact tick", () => {
    const callEvent = manifest.journeyEvents[0];
    if (!callEvent) throw new Error("Missing call fixture");
    let state = createExplorationState(manifest);

    const outside = advancePure(
      state,
      horseAt({ x: callEvent.position.x + callEvent.triggerRadiusMeters + 1, y: 0, z: callEvent.position.z }, 1),
      input({ callPressed: true }),
    );
    expect(outside.state.pendingResponseTicks[callEvent.id]).toBeUndefined();
    state = outside.state;

    const calledAtTick = 2;
    const scheduled = advancePure(
      state,
      horseAt(callEvent.position, calledAtTick),
      input({ callPressed: true }),
    );
    expect(scheduled.state.pendingResponseTicks[callEvent.id]).toBe(
      calledAtTick + callEvent.responseDelayTicks,
    );
    state = scheduled.state;

    for (let tick = calledAtTick + 1; tick < calledAtTick + callEvent.responseDelayTicks; tick += 1) {
      const result = advancePure(state, horseAt(callEvent.position, tick));
      expect(result.events.some((event) => event.type === "CallAnswered")).toBe(false);
      state = result.state;
    }
    const dueTick = calledAtTick + callEvent.responseDelayTicks;
    const answered = advancePure(state, horseAt(callEvent.position, dueTick));
    const answer = answered.events.find((event) => event.type === "CallAnswered");
    expect(answer?.tick).toBe(dueTick);
    expect(answer?.revealedDiscoveryIds.slice().sort()).toEqual(
      callEvent.revealDiscoveryIds.slice().sort(),
    );

    const duplicate = advancePure(
      answered.state,
      horseAt(callEvent.position, dueTick + 1),
      input({ callPressed: true }),
    );
    expect(duplicate.state.pendingResponseTicks[callEvent.id]).toBeUndefined();
  });

  it("selects contextual interactions by distance and stable id and gates them on safety", () => {
    const trace = discovery("first-herd-trace");
    const visited = createExplorationState(manifest, {
      [trace.id]: "visited",
      "spring-resting-hollow": "revealed",
    });
    const unsafeHorse = horseAt(trace.position, 10, { speed: 1, gait: "walk" });
    expect(createExplorationSnapshot(manifest, visited, unsafeHorse).contextualInteraction).toBeNull();

    const safeHorse = horseAt(trace.position, 11);
    expect(createExplorationSnapshot(manifest, visited, safeHorse).contextualInteraction).toEqual({
      discoveryId: trace.id,
      kind: "inspect",
    });
    const completed = advancePure(visited, safeHorse, input({ interactPressed: true }));
    expect(completed.state.discoveryStates[trace.id]).toBe("completed");
    expect(completed.events).toContainEqual({
      type: "AutosaveRequested",
      tick: 11,
      reason: "major-discovery",
      discoveryId: trace.id,
    });
  });

  it("makes a completed resting hollow reusable without repeating its discovery transition", () => {
    const hollow = discovery("spring-resting-hollow");
    const horse = horseAt(hollow.position, 20);
    const first = advancePure(
      createExplorationState(manifest, { [hollow.id]: "visited" }),
      horse,
      input({ interactPressed: true }),
    );
    expect(first.state.discoveryStates[hollow.id]).toBe("completed");
    expect(first.events.some((event) => event.type === "RestCompleted")).toBe(true);
    expect(first.events.findIndex((event) => event.type === "RestCompleted")).toBeLessThan(
      first.events.findIndex((event) => event.type === "AutosaveRequested"),
    );

    const second = advancePure(
      first.state,
      horseAt(hollow.position, 21),
      input({ interactPressed: true }),
    );
    expect(second.events.some((event) => event.type === "DiscoveryStateChanged")).toBe(false);
    expect(second.events).toContainEqual({
      type: "AutosaveRequested",
      tick: 21,
      reason: "resting-hollow",
      discoveryId: hollow.id,
    });
  });

  it("completes the overlook only after the authored safe linger duration", () => {
    const overlook = discovery("first-overlook");
    let state = createExplorationState(manifest, {
      "first-herd-trace": "completed",
      "spring-resting-hollow": "completed",
    });
    const ticks = overlook.progression.completion.kind === "linger"
      ? overlook.progression.completion.ticks
      : 0;
    for (let tick = 1; tick < ticks; tick += 1) {
      state = advancePure(state, horseAt(overlook.position, tick)).state;
      expect(state.discoveryStates[overlook.id]).not.toBe("completed");
    }
    const final = advancePure(state, horseAt(overlook.position, ticks));
    expect(final.state.discoveryStates[overlook.id]).toBe("completed");
    expect(final.events.some((event) => event.type === "JourneyCompleted")).toBe(true);
  });

  it("allows physical sequence breaking but gates completion on tick-start prerequisites", () => {
    const overlook = discovery("first-overlook");
    const foundEarly = advancePure(
      createExplorationState(manifest),
      horseAt(overlook.position, 1),
    );
    expect(foundEarly.state.discoveryStates[overlook.id]).toBe("visited");
    expect(foundEarly.state.lingerTicks[overlook.id]).toBe(0);

    const prerequisite = discovery("plain-wildlife-crossing");
    const colocatedManifest = {
      ...manifest,
      discoveries: manifest.discoveries.map((candidate) => {
        if (candidate.id === prerequisite.id) {
          return {
            ...candidate,
            position: overlook.position,
            progression: {
              ...candidate.progression,
              completion: { kind: "proximity" as const },
            },
          };
        }
        if (candidate.id === overlook.id) {
          return {
            ...candidate,
            progression: {
              ...candidate.progression,
              prerequisiteIds: [prerequisite.id],
              completion: { kind: "proximity" as const },
            },
          };
        }
        return candidate;
      }),
    };
    const before = createExplorationState(colocatedManifest, {
      [prerequisite.id]: "visited",
      [overlook.id]: "visited",
    });
    const sameTick = stepExploration(
      colocatedManifest,
      before,
      horseAt(overlook.position, 2),
      NEUTRAL_HORSE_INPUT,
    );
    expect(sameTick.state.discoveryStates[prerequisite.id]).toBe("completed");
    expect(sameTick.state.discoveryStates[overlook.id]).toBe("visited");
    const nextTick = stepExploration(
      colocatedManifest,
      sameTick.state,
      horseAt(overlook.position, 3),
      NEUTRAL_HORSE_INPUT,
    );
    expect(nextTick.state.discoveryStates[overlook.id]).toBe("completed");
  });

  it("requests periodic autosave only when the horse is safely grounded", () => {
    const position = manifest.spawn.position;
    const due: ExplorationState = {
      ...createExplorationState(manifest),
      playTimeTicks: PERIODIC_AUTOSAVE_TICKS - 1,
      lastPeriodicAutosaveTick: 0,
    };
    const moving = advancePure(
      due,
      horseAt(position, 1, { speed: 1, gait: "walk" }),
    );
    expect(moving.events.some((event) => event.type === "AutosaveRequested")).toBe(false);
    const safe = advancePure(moving.state, horseAt(position, 2));
    expect(safe.events).toContainEqual({
      type: "AutosaveRequested",
      tick: 2,
      reason: "periodic-safe-ground",
    });
  });

  it("keeps hidden discoveries out of the UI seam and orders objectives by authored journey order", () => {
    const initial = createExplorationState(manifest);
    const snapshot = createExplorationSnapshot(
      manifest,
      initial,
      horseAt(manifest.spawn.position, 0),
    );
    expect(snapshot.knownDiscoveries).toEqual([]);
    expect(snapshot.objective).toEqual({
      kind: "journey-event",
      id: "first-answering-call",
    });

    const revealed = createExplorationState(manifest, {
      "first-herd-trace": "revealed",
      "spring-resting-hollow": "revealed",
    });
    expect(
      createExplorationSnapshot(manifest, revealed, horseAt(manifest.spawn.position, 0)).objective,
    ).toEqual({ kind: "discovery", id: "first-herd-trace" });
  });

  it("retains edge actions across a render frame with no fixed tick", () => {
    const callEvent = manifest.journeyEvents[0];
    if (!callEvent) throw new Error("Missing call fixture");
    const pose: Pose = { position: callEvent.position, yaw: 0 };
    const simulation = new IslandSimulation(
      pose,
      new FlatGroundMotionResolver(callEvent.position.y),
      manifest,
      () => "fernwood-edge",
    );
    const first = simulation.advanceFrame(1 / 120, input({ callPressed: true }));
    expect(first.timing.steps).toBe(0);
    const second = simulation.advanceFrame(1 / 120, NEUTRAL_HORSE_INPUT);
    expect(second.timing.steps).toBe(1);
    expect(
      simulation.authoritativeExplorationForDiagnostics().pendingResponseTicks[callEvent.id],
    ).toBe(1 + callEvent.responseDelayTicks);
  });

  it("discards queued gameplay edges across pause and advances reset as a whole tick", () => {
    const callEvent = manifest.journeyEvents[0];
    if (!callEvent) throw new Error("Missing call fixture");
    const simulation = new IslandSimulation(
      { position: callEvent.position, yaw: 0 },
      new FlatGroundMotionResolver(callEvent.position.y),
      manifest,
      () => "fernwood-edge",
    );
    simulation.advanceFrame(1 / 120, input({ callPressed: true }));
    simulation.command({ type: "Pause" });
    simulation.command({ type: "Resume" });
    simulation.advanceFrame(1 / 60, NEUTRAL_HORSE_INPUT);
    expect(
      simulation.authoritativeExplorationForDiagnostics().pendingResponseTicks[callEvent.id],
    ).toBeUndefined();

    simulation.advanceFrame(1 / 60, input({ callPressed: true }));
    for (let tick = 0; tick < callEvent.responseDelayTicks - 1; tick += 1) {
      simulation.advanceFrame(1 / 60, NEUTRAL_HORSE_INPUT);
    }
    const beforeReset = simulation.authoritativeExplorationForDiagnostics();
    simulation.command({ type: "ResetToSafeGround" });
    const reset = simulation.snapshot();
    const horseTick = simulation.authoritativeStateForDiagnostics().tick;
    const exploration = simulation.authoritativeExplorationForDiagnostics();
    expect(exploration.playTimeTicks).toBe(beforeReset.playTimeTicks + 1);
    expect(exploration.playTimeTicks).toBe(horseTick);
    expect(reset.events).toEqual(expect.arrayContaining([
      { type: "HorseReset" },
      expect.objectContaining({ type: "CallAnswered", tick: horseTick }),
    ]));
  });

  it("produces identical journey truth under different render-frame partitions", () => {
    const callEvent = manifest.journeyEvents[0];
    if (!callEvent) throw new Error("Missing call fixture");
    const run = (frames: readonly number[]) => {
      const simulation = new IslandSimulation(
        { position: callEvent.position, yaw: 0 },
        new FlatGroundMotionResolver(callEvent.position.y),
        manifest,
        () => "fernwood-edge",
      );
      const events: string[] = [];
      frames.forEach((seconds, index) => {
        const frame = simulation.advanceFrame(
          seconds,
          index === 0 ? input({ callPressed: true }) : NEUTRAL_HORSE_INPUT,
        );
        for (const event of frame.events) {
          if ("tick" in event) events.push(`${event.tick}:${event.type}`);
        }
      });
      return {
        tick: simulation.authoritativeStateForDiagnostics().tick,
        exploration: simulation.authoritativeExplorationForDiagnostics(),
        events,
      };
    };
    const sixtyFps = run(Array.from({ length: 120 }, () => 1 / 60));
    const thirtyFps = run(Array.from({ length: 60 }, () => 1 / 30));
    const mixed = run(
      Array.from({ length: 40 }, () => [1 / 120, 1 / 120, 1 / 30]).flat(),
    );
    expect(sixtyFps.tick).toBe(120);
    expect(thirtyFps).toEqual(sixtyFps);
    expect(mixed).toEqual(sixtyFps);
  });
});
