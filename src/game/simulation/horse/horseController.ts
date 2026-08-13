import type { HorseInputFrame } from "../../contracts/input";
import {
  approach,
  clamp,
  moveAngleTowards,
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
  const rawMagnitude = Math.hypot(input.moveX, input.moveY);
  const inputMagnitude = clamp(rawMagnitude, 0, 1);
  const brakingInput = input.moveY < -tuning.inputDeadZone;
  const hasTravelIntent = inputMagnitude >= tuning.inputDeadZone && !brakingInput;
  const recovering = state.recoveryTicksRemaining > 0;

  let yaw = state.yaw;
  if (hasTravelIntent && !recovering) {
    const localDirection = Math.atan2(input.moveX, input.moveY);
    const desiredYaw = input.cameraYaw + localDirection;
    yaw = moveAngleTowards(
      yaw,
      desiredYaw,
      turnRateForSpeed(state.speed, tuning) * fixedStepSeconds,
    );
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

  const desiredTranslation: Vec3 = {
    x: Math.sin(yaw) * intendedSpeed * fixedStepSeconds,
    y: verticalVelocity * fixedStepSeconds,
    z: Math.cos(yaw) * intendedSpeed * fixedStepSeconds,
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
    },
    events,
  };
}
