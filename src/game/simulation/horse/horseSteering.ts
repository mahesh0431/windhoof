import { NEUTRAL_HORSE_INPUT, type HorseInputFrame } from "../../contracts/input";
import { clamp, wrapRadians } from "../../contracts/math";
import type { HorseState } from "./horseState";

/**
 * Reins that steer a horse towards a point on the ground.
 *
 * The horse is driven by reins, not by a joystick: `moveY` is throttle and
 * `moveX` turns the animal on its own axis. Nothing about the input says where
 * to go, so anything that is not a player holding the keys - an automated
 * traversal test, an inspection ride - has to close the heading loop itself.
 *
 * This exists because the traversal tests did not. They were written against
 * the original camera-absolute steering, where setting `cameraYaw` at a target
 * and holding `moveY` was enough to make the horse go there, and they kept
 * compiling and kept failing silently afterwards: the controller simply ignores
 * `cameraYaw` now, so the horse drove in a straight line until the waypoint
 * timed out. One shared helper rather than a copy per driver, so the next change
 * to the control model breaks one thing loudly instead of several quietly.
 */

export interface SteerToOptions {
  /**
   * Distance at which to start slowing, in metres.
   *
   * A horse at a gallop cannot pivot - that is the point of the control model -
   * so a driver that holds full throttle into a waypoint orbits it forever.
   */
  readonly slowWithin?: number;
  /** Distance beyond which to ask for a gallop. */
  readonly gallopBeyond?: number;
  /**
   * How hard to pull on the rein per radian of heading error.
   *
   * Above about two this oscillates, because the turn rate is already capped by
   * speed inside the controller.
   */
  readonly gain?: number;
}

/**
 * Heading error, in radians: positive means the target is to the horse's right
 * of its current heading.
 */
export function headingErrorTo(
  state: HorseState,
  targetX: number,
  targetZ: number,
): number {
  const wanted = Math.atan2(targetX - state.position.x, targetZ - state.position.z);
  return wrapRadians(wanted - state.yaw);
}

/**
 * One input frame that carries the horse towards a point.
 *
 * The sign is the whole subtlety. Forward is `(sin yaw, cos yaw)` and the
 * controller applies `yaw -= steer * rate * dt`, so a positive heading error -
 * a target to the right - needs a negative `moveX`. Getting this backwards
 * produces a horse that turns smoothly away from wherever it is asked to go,
 * which is exactly what the original control bug looked like.
 */
export function reinsTowards(
  state: HorseState,
  targetX: number,
  targetZ: number,
  options: SteerToOptions = {},
): HorseInputFrame {
  const slowWithin = options.slowWithin ?? 12;
  const gallopBeyond = options.gallopBeyond ?? 26;
  const gain = options.gain ?? 1.6;

  const distance = Math.hypot(targetX - state.position.x, targetZ - state.position.z);
  const error = headingErrorTo(state, targetX, targetZ);

  // Facing well away from the target, turn on the spot rather than driving a
  // long arc back. A standing horse turns fastest, and it is the only way to
  // recover a heading once the animal is committed.
  const facingAway = Math.abs(error) > 1.15;
  const throttle = facingAway
    ? 0
    : distance < slowWithin
      ? 0.45
      : 1;

  return {
    ...NEUTRAL_HORSE_INPUT,
    moveX: clamp(-error * gain, -1, 1),
    moveY: throttle,
    gallopHeld: !facingAway && distance > gallopBeyond && Math.abs(error) < 0.3,
  };
}
