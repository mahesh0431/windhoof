import type { HorseInputFrame } from "../../contracts/input";
import {
  approach,
  clamp,
  wrapRadians,
  type Pose,
  type Vec3,
} from "../../contracts/math";
import type { GameEvent } from "../../contracts/uiContract";
import type { HorseMotionResolver } from "../../../physics/horseMotionResolver";
import type { HorseGait, HorseState } from "./horseState";
import { DEFAULT_HORSE_TUNING, type HorseTuning } from "./horseTuning";

export interface HorseStepResult {
  readonly state: HorseState;
  readonly events: readonly GameEvent[];
}

function gaitForSpeed(speed: number, tuning: HorseTuning): HorseGait {
  if (speed < 0.15) return "idle";
  if (speed < midpoint(tuning.walkSpeed, tuning.trotSpeed)) return "walk";
  if (speed < midpoint(tuning.trotSpeed, tuning.canterSpeed)) return "trot";
  if (speed < midpoint(tuning.canterSpeed, tuning.gallopSpeed)) return "canter";
  return "gallop";
}

function midpoint(a: number, b: number): number {
  return (a + b) * 0.5;
}

function turnRateForSpeed(speed: number, tuning: HorseTuning): number {
  const ratio = clamp(speed / tuning.gallopSpeed, 0, 1);
  return tuning.walkTurnRate + (tuning.gallopTurnRate - tuning.walkTurnRate) * ratio;
}

function targetSpeedForInput(
  inputMagnitude: number,
  gallopHeld: boolean,
  tuning: HorseTuning,
): number {
  if (inputMagnitude < tuning.inputDeadZone) return 0;
  if (gallopHeld) return tuning.gallopSpeed * inputMagnitude;
  if (inputMagnitude < 0.38) return tuning.walkSpeed;
  if (inputMagnitude < 0.74) return tuning.trotSpeed;
  return tuning.canterSpeed;
}

function resetState(state: HorseState): HorseState {
  return {
    ...state,
    tick: state.tick + 1,
    position: { ...state.lastSafePose.position },
    yaw: state.lastSafePose.yaw,
    speed: 0,
    verticalVelocity: 0,
    gait: "idle",
    grounded: true,
    lastGroundedTick: state.tick + 1,
    airborneTicks: 0,
    jumpConsumedSinceGrounded: false,
    condition: "normal",
    recoveryTicksRemaining: 0,
  };
}

function safePose(position: Vec3, yaw: number): Pose {
  return { position: { ...position }, yaw };
}

/**
 * Loads the horse with velocity it did not ask for, and knocks it off balance.
 *
 * Called when something in the world connects: today that is a wild horse's
 * hind feet. The shove is stored, not applied - `stepHorse` feeds it through the
 * same translation Rapier resolves, so a kick can shove the player into a rock
 * but never through one, and cannot put them anywhere the horse could not have
 * walked itself.
 *
 * A shove also costs the horse its footing for a moment, which is what makes it
 * a consequence rather than a nudge: the animator already renders `stumbling`,
 * and the controller already refuses to steer, accelerate or jump while it
 * lasts.
 */
export function applyHorseShove(
  state: HorseState,
  shove: { readonly x: number; readonly z: number; readonly speed: number },
  tuning: HorseTuning = DEFAULT_HORSE_TUNING,
): HorseState {
  const length = Math.hypot(shove.x, shove.z);
  if (length < 1e-6 || shove.speed <= 0) return state;
  return {
    ...state,
    shoveX: (shove.x / length) * shove.speed,
    shoveZ: (shove.z / length) * shove.speed,
    condition: "stumbling",
    recoveryTicksRemaining: Math.max(
      state.recoveryTicksRemaining,
      tuning.shoveStumbleTicks,
    ),
  };
}

export function stepHorse(
  state: HorseState,
  input: HorseInputFrame,
  motionResolver: HorseMotionResolver,
  tuning: HorseTuning = DEFAULT_HORSE_TUNING,
): HorseStepResult {
  const events: GameEvent[] = [];

  if (input.resetPressed) {
    motionResolver.teleport?.(state.lastSafePose.position);
    return { state: resetState(state), events: [{ type: "HorseReset" }] };
  }

  const tick = state.tick + 1;
  const fixedStepSeconds = tuning.fixedStepSeconds;
  // Reins, not a joystick.
  //
  // This used to read the stick as a direction in camera space and turn the
  // horse to face it: press left and the horse ran ninety degrees left of
  // wherever the camera happened to point, press forward and it snapped back to
  // facing the camera again. That is how a twin-stick avatar moves, and a horse
  // is not one - it cannot strafe, and it does not change which way it is
  // pointing because you asked to go faster. Worse, the camera only swings in
  // behind above 2.5 m/s, so a turn from standstill spiralled: the horse kept
  // chasing a heading that kept moving.
  //
  // So the axes now mean what they mean on a horse. Forward is throttle, back
  // is rein-in, and left and right turn the animal on its own axis - including
  // on the spot, which is a thing a standing horse can do.
  const throttle = clamp(input.moveY, -1, 1);
  const steer = clamp(input.moveX, -1, 1);
  const inputMagnitude = clamp(throttle, 0, 1);
  const brakingInput = throttle < -tuning.inputDeadZone;
  const hasTravelIntent = inputMagnitude >= tuning.inputDeadZone;
  const recovering = state.recoveryTicksRemaining > 0;

  let yaw = state.yaw;
  if (!recovering && Math.abs(steer) > tuning.inputDeadZone) {
    // A standing horse turns more readily than a galloping one, and a galloping
    // one cannot pivot at all - which is what makes speed feel like commitment.
    const rate = turnRateForSpeed(state.speed, tuning);
    // Minus, not plus. Forward is (sin yaw, cos yaw) and the chase camera sits
    // behind the horse looking along it, which puts world +X on the player's
    // LEFT - so a rising yaw turns left on screen. The old camera-relative
    // steering had the same sign error, which is why pressing left has always
    // sent the horse right.
    yaw = wrapRadians(yaw - steer * rate * fixedStepSeconds);
  }

  const targetSpeed = recovering || brakingInput
    ? 0
    : targetSpeedForInput(inputMagnitude, input.gallopHeld, tuning);
  const acceleration = input.gallopHeld
    ? tuning.gallopAcceleration
    : tuning.acceleration;
  const speedRate = brakingInput
    ? tuning.braking
    : hasTravelIntent
      ? targetSpeed < state.speed
        ? tuning.braking
        : acceleration
      : tuning.coastingDeceleration;
  const intendedSpeed = approach(
    state.speed,
    targetSpeed,
    speedRate * fixedStepSeconds,
  );

  const mayUseCoyoteJump =
    !state.jumpConsumedSinceGrounded &&
    tick - state.lastGroundedTick <= tuning.coyoteTicks;
  const jumped = input.jumpPressed && mayUseCoyoteJump && !recovering;
  let verticalVelocity = jumped
    ? tuning.jumpVelocity
    : state.verticalVelocity - tuning.gravity * fixedStepSeconds;

  // Whatever the world is still pushing the horse with, bled off over about a
  // fifth of a second. It rides in the same translation as the horse's own
  // locomotion, so it is resolved against the terrain and every collider on it
  // rather than teleporting the player anywhere.
  const shoveDecay = Math.max(0, 1 - tuning.shoveDecay * fixedStepSeconds);
  const shoveX = Math.abs(state.shoveX) < 0.05 ? 0 : state.shoveX * shoveDecay;
  const shoveZ = Math.abs(state.shoveZ) < 0.05 ? 0 : state.shoveZ * shoveDecay;

  const desiredTranslation: Vec3 = {
    x: (Math.sin(yaw) * intendedSpeed + shoveX) * fixedStepSeconds,
    y: verticalVelocity * fixedStepSeconds,
    z: (Math.cos(yaw) * intendedSpeed + shoveZ) * fixedStepSeconds,
  };

  const wasGrounded = state.grounded;
  const downwardVelocityBeforeResolution = verticalVelocity;
  const motion = motionResolver.resolve(state, desiredTranslation, fixedStepSeconds);
  // A wall hit brakes locomotion instead of animating a gallop in place.
  // Physics classifies the contact explicitly; inferring it from one tick's
  // displacement falsely treated ordinary ground correction as blockage.
  const speed = motion.blockedHorizontally && hasTravelIntent
    ? approach(
        intendedSpeed,
        0,
        (tuning.braking + acceleration) * fixedStepSeconds,
      )
    : intendedSpeed;
  // Rapier can briefly lose ground contact over tiny numerical gaps. Requiring
  // two completed airborne ticks prevents a contact flicker from becoming a
  // player-facing landing while preserving coyote time.
  const landed = !wasGrounded && motion.grounded && state.airborneTicks >= 2;
  const hardLanding = landed && downwardVelocityBeforeResolution <= -tuning.hardLandingSpeed;

  if (motion.grounded && verticalVelocity < 0) verticalVelocity = 0;
  if (motion.hitCeiling && verticalVelocity > 0) verticalVelocity = 0;

  const recoveryTicksRemaining = hardLanding
    ? tuning.stumbleTicks
    : Math.max(0, state.recoveryTicksRemaining - 1);
  const condition = recoveryTicksRemaining > 0 ? "stumbling" : "normal";
  const gait = gaitForSpeed(speed, tuning);
  const lastGroundedTick = motion.grounded ? tick : state.lastGroundedTick;
  const airborneTicks = motion.grounded ? 0 : state.airborneTicks + 1;
  const jumpConsumedSinceGrounded = motion.grounded
    ? false
    : jumped || state.jumpConsumedSinceGrounded;
  const lastSafePose =
    motion.safeGround &&
    motion.grounded &&
    condition === "normal" &&
    shoveX === 0 &&
    shoveZ === 0 &&
    speed <= tuning.safePoseMaximumSpeed
      ? safePose(motion.position, yaw)
      : state.lastSafePose;

  if (jumped) events.push({ type: "HorseJumped" });
  if (landed) events.push({ type: "HorseLanded", hard: hardLanding });
  if (input.callPressed) events.push({ type: "HorseCalled" });
  if (gait !== state.gait) events.push({ type: "HorseGaitChanged", gait });

  return {
    state: {
      tick,
      position: motion.position,
      yaw,
      speed,
      verticalVelocity,
      gait,
      grounded: motion.grounded,
      lastGroundedTick,
      airborneTicks,
      jumpConsumedSinceGrounded,
      lastSafePose,
      condition,
      recoveryTicksRemaining,
      shoveX,
      shoveZ,
    },
    events,
  };
}
