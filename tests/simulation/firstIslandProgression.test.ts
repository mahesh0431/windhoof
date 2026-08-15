import { beforeAll, describe, expect, it } from "vitest";
import firstIslandJson from "../../docs/contracts/world-spec.first-island.json";
import { NEUTRAL_HORSE_INPUT, type HorseInputFrame } from "../../src/game/contracts/input";
import {
  createExplorationState,
  type ExplorationState,
} from "../../src/game/simulation/exploration/explorationState";
import { stepExploration } from "../../src/game/simulation/exploration/stepExploration";
import type { HorseState } from "../../src/game/simulation/horse/horseState";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type {
  CompiledDiscovery,
  WorldManifest,
  WorldSpecV4,
} from "../../src/game/world/compiler/worldTypes";

const spec = firstIslandJson as unknown as WorldSpecV4;

function horseAt(discovery: CompiledDiscovery, tick: number): HorseState {
  return {
    tick,
    position: { ...discovery.position },
    yaw: 0,
    speed: 0,
    verticalVelocity: 0,
    gait: "idle",
    grounded: true,
    lastGroundedTick: tick,
    airborneTicks: 0,
    jumpConsumedSinceGrounded: false,
    lastSafePose: { position: { ...discovery.position }, yaw: 0 },
    condition: "normal",
    recoveryTicksRemaining: 0,
    shoveX: 0,
    shoveZ: 0,
  };
}

describe("first-island belonging progression", () => {
  let manifest: WorldManifest;
  beforeAll(() => {
    manifest = compileWorld(spec);
  }, 15_000);

  const input = (overrides: Partial<HorseInputFrame> = {}): HorseInputFrame => ({
    ...NEUTRAL_HORSE_INPUT,
    ...overrides,
  });
  const find = (id: string): CompiledDiscovery => {
    const discovery = manifest.discoveries.find((candidate) => candidate.id === id);
    if (!discovery) throw new Error(`Missing first-island discovery ${id}`);
    return discovery;
  };

  it("accepts the first four traces in any order, then reveals and completes the living herd once", () => {
    let state: ExplorationState = createExplorationState(manifest);
    let tick = 1;
    const completeImmediate = (id: string, action: Partial<HorseInputFrame>) => {
      const discovery = find(id);
      const result = stepExploration(manifest, state, horseAt(discovery, tick++), input(action));
      state = result.state;
      expect(state.discoveryStates[id]).toBe("completed");
    };

    completeImmediate("river-spring-tracks", { callPressed: true });
    completeImmediate("fernwood-caught-hair", { interactPressed: true });
    completeImmediate("storm-beach-hoofprints", { interactPressed: true });

    const restingCircle = find("longgrass-resting-circle-trace");
    const lingerTicks = restingCircle.progression.completion.kind === "linger"
      ? restingCircle.progression.completion.ticks
      : 0;
    for (let count = 0; count < lingerTicks; count += 1) {
      state = stepExploration(
        manifest,
        state,
        horseAt(restingCircle, tick++),
        NEUTRAL_HORSE_INPUT,
      ).state;
    }
    expect(state.discoveryStates[restingCircle.id]).toBe("completed");

    const finalTrace = find("blackstone-living-herd");
    expect(state.discoveryStates[finalTrace.id]).toBe("hidden");
    const callEvent = manifest.journeyEvents.find((event) => event.id === "high-pasture-answer");
    if (!callEvent) throw new Error("Missing high-pasture answer");
    const scheduledTick = tick++;
    state = stepExploration(
      manifest,
      state,
      horseAt(finalTrace, scheduledTick),
      input({ callPressed: true }),
    ).state;
    expect(state.pendingResponseTicks[callEvent.id]).toBe(
      scheduledTick + callEvent.responseDelayTicks,
    );

    let answerEvents = 0;
    while (tick <= scheduledTick + callEvent.responseDelayTicks) {
      const result = stepExploration(
        manifest,
        state,
        horseAt(finalTrace, tick++),
        NEUTRAL_HORSE_INPUT,
      );
      state = result.state;
      answerEvents += result.events.filter((event) => event.type === "CallAnswered").length;
    }
    expect(answerEvents).toBe(1);
    expect(state.discoveryStates[finalTrace.id]).toBe("revealed");

    const finalLinger = finalTrace.progression.completion.kind === "linger"
      ? finalTrace.progression.completion.ticks
      : 0;
    let journeyEvents = 0;
    for (let count = 0; count < finalLinger; count += 1) {
      const result = stepExploration(
        manifest,
        state,
        horseAt(finalTrace, tick++),
        NEUTRAL_HORSE_INPUT,
      );
      state = result.state;
      journeyEvents += result.events.filter((event) => event.type === "JourneyCompleted").length;
    }
    expect(state.discoveryStates[finalTrace.id]).toBe("completed");
    expect(state.journeyCompleted).toBe(true);
    expect(journeyEvents).toBe(1);

    const continued = stepExploration(
      manifest,
      state,
      horseAt(finalTrace, tick),
      NEUTRAL_HORSE_INPUT,
    );
    expect(continued.state.playTimeTicks).toBe(state.playTimeTicks + 1);
    expect(continued.events.some((event) => event.type === "JourneyCompleted")).toBe(false);
  });

  it("does not schedule the final answer before all four earlier traces complete", () => {
    const finalTrace = find("blackstone-living-herd");
    const event = manifest.journeyEvents.find((candidate) => candidate.id === "high-pasture-answer");
    if (!event) throw new Error("Missing high-pasture answer");
    const state = createExplorationState(manifest, {
      "storm-beach-hoofprints": "completed",
      "longgrass-resting-circle-trace": "completed",
      "fernwood-caught-hair": "completed",
    });
    const result = stepExploration(
      manifest,
      state,
      horseAt(finalTrace, 1),
      input({ callPressed: true }),
    );
    expect(result.state.pendingResponseTicks[event.id]).toBeUndefined();
    expect(result.state.discoveryStates[finalTrace.id]).toBe("hidden");
  });
});
