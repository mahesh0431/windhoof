import { describe, expect, it } from "vitest";
import { createHorseRig } from "../../src/render/horse/horseVisual";
import {
  NOTICE_RADIUS,
  WildHorseAnimator,
} from "../../src/render/horse/wildHorseAnimator";
import {
  applyHorseShove,
  stepHorse,
} from "../../src/game/simulation/horse/horseController";
import { createInitialHorseState } from "../../src/game/simulation/horse/horseState";
import type { HorseMotionResolver } from "../../src/physics/horseMotionResolver";
import type { HorseInputFrame } from "../../src/game/contracts/input";

/**
 * A wild horse warns before it kicks, and a kick is resolved by physics.
 *
 * Both halves matter and they fail differently. The first is a design contract:
 * an animal that lashes out with no tell is a trap, so the sequence has to pass
 * through warning every time and the kick has to be refused to anything the
 * horse is facing. The second is a physics contract: a shove must arrive as
 * requested translation that Rapier resolves, never as a teleport, or being
 * kicked could put the player inside a rock or over an edge they were standing
 * clear of.
 */

const idleInput: HorseInputFrame = {
  moveX: 0,
  moveY: 0,
  cameraYaw: 0,
  gallopHeld: false,
  jumpPressed: false,
  callPressed: false,
  interactPressed: false,
  resetPressed: false,
  pausePressed: false,
};

/** Records what it was asked to do and grants it, so intent can be read back. */
function recordingResolver(): HorseMotionResolver & {
  readonly requests: { x: number; y: number; z: number }[];
  teleported: boolean;
} {
  const requests: { x: number; y: number; z: number }[] = [];
  let teleported = false;
  return {
    requests,
    get teleported() {
      return teleported;
    },
    resolve(state, desiredTranslation) {
      requests.push({ ...desiredTranslation });
      return {
        position: {
          x: state.position.x + desiredTranslation.x,
          y: state.position.y,
          z: state.position.z + desiredTranslation.z,
        },
        grounded: true,
        hitCeiling: false,
        blockedHorizontally: false,
        safeGround: true,
      };
    },
    teleport() {
      teleported = true;
    },
  };
}

/** Runs the animator for a while with the player held at one place. */
function hold(
  animator: WildHorseAnimator,
  rig: ReturnType<typeof createHorseRig>,
  distance: number,
  bearing: number,
  seconds: number,
): boolean {
  const step = 1 / 60;
  let struck = false;
  for (let elapsed = 0; elapsed < seconds; elapsed += step) {
    // The horse turns, so the bearing it perceives has to be recomputed against
    // its own heading each step rather than held fixed.
    const worldHeading = bearing + 0;
    const strike = animator.update(rig, {
      distance,
      bearing: worldHeading - animator.facing,
      deltaSeconds: step,
    });
    if (strike.connected) struck = true;
  }
  return struck;
}

describe("a wild horse defending its space", () => {
  it("ignores a rider who stays away", () => {
    const rig = createHorseRig();
    const animator = new WildHorseAnimator(0.45, 0.62);
    animator.reset(0);

    const struck = hold(animator, rig, NOTICE_RADIUS + 6, 0, 3);

    expect(animator.currentMood).toBe("calm");
    expect(struck).toBe(false);
    rig.dispose();
  });

  it("watches a rider who comes near, without warning them off", () => {
    const rig = createHorseRig();
    const animator = new WildHorseAnimator(0.45, 0.62);
    animator.reset(0);

    const struck = hold(animator, rig, 8, 0, 2);

    expect(animator.currentMood).toBe("watching");
    expect(struck).toBe(false);
    rig.dispose();
  });

  it("warns before it ever kicks", () => {
    const rig = createHorseRig();
    const animator = new WildHorseAnimator(0.45, 0.62);
    animator.reset(0);

    // Walked straight in from outside the notice radius to two metres.
    const moods: string[] = [];
    const step = 1 / 60;
    for (let frame = 0; frame < 400; frame += 1) {
      const distance = Math.max(2, NOTICE_RADIUS + 3 - frame * 0.04);
      animator.update(rig, {
        distance,
        bearing: 0 - animator.facing,
        deltaSeconds: step,
      });
      const mood = animator.currentMood;
      if (moods[moods.length - 1] !== mood) moods.push(mood);
    }

    expect(moods[0]).toBe("calm");
    expect(moods).toContain("watching");
    // The tell always precedes the kick: there is no path from calm or watching
    // straight into a strike.
    const kickAt = moods.indexOf("kicking");
    expect(kickAt).toBeGreaterThan(-1);
    expect(moods[kickAt - 1]).toBe("warning");
    rig.dispose();
  });

  it("kicks a rider who crowds it, and connects behind itself", () => {
    const rig = createHorseRig();
    const animator = new WildHorseAnimator(0.45, 0.62);
    animator.reset(0);

    const struck = hold(animator, rig, 2.2, 0, 6);

    expect(struck).toBe(true);
    rig.dispose();
  });

  it("will not kick something it cannot reach", () => {
    const rig = createHorseRig();
    const animator = new WildHorseAnimator(0.45, 0.62);
    animator.reset(0);

    // Inside the radius that makes it turn and warn, beyond the hooves' reach.
    const struck = hold(animator, rig, 4.4, 0, 6);

    expect(animator.currentMood).not.toBe("calm");
    expect(struck).toBe(false);
    rig.dispose();
  });

  it("does not kick again immediately", () => {
    const rig = createHorseRig();
    const animator = new WildHorseAnimator(0.45, 0.62);
    animator.reset(0);

    let strikes = 0;
    const step = 1 / 60;
    for (let frame = 0; frame < 60 * 6; frame += 1) {
      const strike = animator.update(rig, {
        distance: 2.2,
        bearing: 0 - animator.facing,
        deltaSeconds: step,
      });
      if (strike.connected) strikes += 1;
    }

    // Six seconds against a cooldown of four and a half: one kick, and at most
    // the beginning of a second.
    expect(strikes).toBeGreaterThanOrEqual(1);
    expect(strikes).toBeLessThanOrEqual(2);
    rig.dispose();
  });
});

describe("being kicked", () => {
  it("asks physics to move the horse rather than moving it", () => {
    const resolver = recordingResolver();
    let state = createInitialHorseState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });

    const before = { ...state.position };
    state = applyHorseShove(state, { x: 1, z: 0, speed: 7 });

    // Nothing has moved yet: a shove is stored intent, not a displacement.
    expect(state.position).toEqual(before);
    expect(resolver.teleported).toBe(false);

    stepHorse(state, idleInput, resolver);

    const first = resolver.requests[0];
    expect(first).toBeDefined();
    // The whole shove arrived as requested translation, which is the only path
    // that gets resolved against the terrain and every collider on it.
    expect(first!.x).toBeGreaterThan(0);
    expect(first!.z).toBeCloseTo(0, 6);
    expect(resolver.teleported).toBe(false);
  });

  it("throws the horse the way the kick pointed, then lets it go", () => {
    const resolver = recordingResolver();
    let state = createInitialHorseState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    state = applyHorseShove(state, { x: 0, z: -1, speed: 7 });

    for (let tick = 0; tick < 120; tick += 1) {
      state = stepHorse(state, idleInput, resolver).state;
    }

    expect(state.position.z).toBeLessThan(-0.4);
    // And it bleeds off rather than becoming a permanent drift.
    expect(state.shoveX).toBe(0);
    expect(state.shoveZ).toBe(0);
  });

  it("costs the rider their footing", () => {
    const resolver = recordingResolver();
    let state = createInitialHorseState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    state = applyHorseShove(state, { x: 1, z: 0, speed: 7 });

    expect(state.condition).toBe("stumbling");

    // Steering is refused while recovering, so a kick genuinely interrupts.
    const steering: HorseInputFrame = { ...idleInput, moveX: 1, moveY: 1 };
    const next = stepHorse(state, steering, resolver).state;
    expect(next.yaw).toBe(state.yaw);
    expect(next.condition).toBe("stumbling");
  });

  it("never banks a position it is still being thrown through", () => {
    const resolver = recordingResolver();
    let state = createInitialHorseState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    const safeBefore = { ...state.lastSafePose.position };
    state = applyHorseShove(state, { x: 1, z: 0, speed: 7 });

    // Mid-flight. Banking here would let a kick that shoved the player onto bad
    // ground make that ground their reset point.
    for (let tick = 0; tick < 15; tick += 1) {
      state = stepHorse(state, idleInput, resolver).state;
      expect(state.shoveX).toBeGreaterThan(0);
      expect(state.lastSafePose.position).toEqual(safeBefore);
    }
    expect(state.position.x).toBeGreaterThan(0.6);
  });

  it("ignores a kick with no direction in it", () => {
    let state = createInitialHorseState({ position: { x: 0, y: 0, z: 0 }, yaw: 0 });
    state = applyHorseShove(state, { x: 0, z: 0, speed: 7 });
    expect(state.condition).toBe("normal");
    expect(state.shoveX).toBe(0);
  });
});
