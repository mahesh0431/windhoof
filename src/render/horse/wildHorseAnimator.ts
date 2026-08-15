import { MathUtils } from "three";
import type { HorseRig } from "./horseVisual";

/**
 * What a wild horse does when a rider comes too close.
 *
 * The island's horses are baked into instanced geometry and never move, which
 * is fine for a herd on a far hillside and wrong for one the player is standing
 * next to. Close in, a horse is the most reactive thing in the world: it watches
 * you, it decides how it feels about you, and if you keep coming it tells you to
 * back off in the only language it has.
 *
 * The sequence here is the real one, in order, because the warning is the point:
 * a horse that kicks without showing you it is about to is a trap, and a horse
 * that shows you and is ignored is a consequence. Both are fair; only the second
 * is interesting.
 *
 *   watching   - head up, ears forward, turns to face and keep you in view
 *   warning    - ears flat back, quarters swung towards you, tail wringing
 *   kicking    - gathers, then both hind legs go straight out behind
 *   settling   - back down, and it will not kick again for a few seconds
 *
 * This drives the same `HorseRig` the player's horse uses, so a wild horse is
 * never a different animal with different joints - it is the same model with a
 * different mind.
 */

export type WildHorseMood = "calm" | "watching" | "warning" | "kicking" | "settling";

/** Beyond this the horse ignores the player entirely. */
export const NOTICE_RADIUS = 11;
/** Inside this it stops watching and starts warning. */
const WARN_RADIUS = 5.2;
/** Inside this, and behind the horse, it kicks. */
const KICK_RADIUS = 3.4;
/** How long it must be left alone before it will kick again. */
const KICK_COOLDOWN_SECONDS = 4.5;
/** Half-angle of the arc behind the horse that a kick actually covers. */
const KICK_ARC = 1.15;
/** How far back the hooves reach at full extension. */
export const KICK_REACH = 3.1;

const WIND_UP_SECONDS = 0.22;
const STRIKE_SECONDS = 0.16;
const RECOVER_SECONDS = 0.5;
/** How far the horse tips onto its forehand at full extension, in radians. */
const KICK_PITCH = 0.38;

export interface WildHorseSense {
  /** Metres from the horse to the player. */
  readonly distance: number;
  /**
   * Where the player is relative to the way the horse is facing, in radians.
   * Zero is straight ahead; +/-pi is directly behind.
   */
  readonly bearing: number;
  readonly deltaSeconds: number;
}

export interface WildHorseStrike {
  /** True on the single frame the hooves connect. */
  readonly connected: boolean;
}

function damp(current: number, target: number, rate: number, dt: number): number {
  return MathUtils.lerp(current, target, 1 - Math.exp(-rate * dt));
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export class WildHorseAnimator {
  private mood: WildHorseMood = "calm";
  private phase = 0;
  private cooldown = 0;
  private breath = 0;
  private yaw = 0;
  private alarm = 0;
  private struck = false;

  /** The pose the horse holds when nothing is happening. */
  public constructor(
    private readonly restNeck: number,
    private readonly restHeadCarry: number,
    breathOffset = 0,
  ) {
    this.breath = breathOffset;
  }

  public get currentMood(): WildHorseMood {
    return this.mood;
  }

  /** Facing, in radians, so the caller can keep the instanced copy in step. */
  public get facing(): number {
    return this.yaw;
  }

  /**
   * Puts a rig straight into this animator's rest pose.
   *
   * A horse is promoted from the instanced herd at whatever distance it first
   * notices the player, and the instanced copy it replaces is baked in exactly
   * this pose. Without the snap the newly live horse visibly lifts its head from
   * the rig's default carriage to the pose it was already holding.
   */
  public pose(rig: HorseRig): void {
    rig.root.rotation.y = this.yaw;
    rig.neck.rotation.x = this.restNeck;
    rig.head.rotation.x = -this.restNeck + this.restHeadCarry;
    rig.body.position.y = 0;
    rig.body.rotation.x = 0;
    rig.spine.rotation.x = 0;
    rig.forehand.rotation.x = 0;
  }

  public reset(yaw: number): void {
    this.yaw = yaw;
    this.mood = "calm";
    this.phase = 0;
    this.cooldown = 0;
    this.alarm = 0;
    this.struck = false;
  }

  public update(rig: HorseRig, sense: WildHorseSense): WildHorseStrike {
    const dt = Math.max(0.0001, sense.deltaSeconds);
    this.breath += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.struck = false;

    this.advanceMood(sense, dt);
    this.driveYaw(sense, dt);
    this.drivePose(rig, dt);

    return { connected: this.struck };
  }

  private advanceMood(sense: WildHorseSense, dt: number): void {
    // How wound up the horse is. Everything in the pose reads off this rather
    // than off the mood directly, so the transitions are continuous even though
    // the states are not.
    const wantsAlarm =
      this.mood === "kicking" || this.mood === "warning"
        ? 1
        : this.mood === "watching"
          ? 0.45
          : 0;
    this.alarm = damp(this.alarm, wantsAlarm, 3.6, dt);

    switch (this.mood) {
      case "calm":
        if (sense.distance < NOTICE_RADIUS) this.mood = "watching";
        break;

      case "watching":
        if (sense.distance > NOTICE_RADIUS * 1.15) this.mood = "calm";
        else if (sense.distance < WARN_RADIUS) this.mood = "warning";
        break;

      case "warning": {
        if (sense.distance > WARN_RADIUS * 1.3) {
          this.mood = "watching";
          break;
        }
        // It only lands a kick on something behind it, so it only throws one
        // when there is something behind it to hit.
        const behind = Math.abs(wrap(sense.bearing + Math.PI)) < KICK_ARC;
        if (sense.distance < KICK_RADIUS && behind && this.cooldown <= 0) {
          this.mood = "kicking";
          this.phase = 0;
        }
        break;
      }

      case "kicking": {
        const previous = this.phase;
        this.phase += dt;
        const strikeAt = WIND_UP_SECONDS;
        // The hooves connect at the instant the legs reach full extension, not
        // for the whole of the animation.
        if (previous < strikeAt && this.phase >= strikeAt) {
          const behind = Math.abs(wrap(sense.bearing + Math.PI)) < KICK_ARC;
          this.struck = behind && sense.distance < KICK_REACH;
        }
        if (this.phase >= WIND_UP_SECONDS + STRIKE_SECONDS + RECOVER_SECONDS) {
          this.mood = "settling";
          this.cooldown = KICK_COOLDOWN_SECONDS;
          this.phase = 0;
        }
        break;
      }

      case "settling":
        if (this.cooldown <= 0) {
          this.mood = sense.distance < NOTICE_RADIUS ? "watching" : "calm";
        }
        break;
    }
  }

  private driveYaw(sense: WildHorseSense, dt: number): void {
    if (this.mood === "calm" || this.mood === "kicking") return;
    // Watching, it turns to look at you. Warning, it turns its quarters to you -
    // which is the whole tell, and the reason a player who reads it gets out of
    // the way and one who does not gets kicked.
    const wanted =
      this.mood === "warning" || this.mood === "settling"
        ? wrap(sense.bearing + Math.PI)
        : sense.bearing;
    this.yaw = wrap(this.yaw + wrap(wanted) * Math.min(1, dt * 1.9));
  }

  private drivePose(rig: HorseRig, dt: number): void {
    const alarm = this.alarm;
    const breathe = Math.sin(this.breath * 1.15) * 0.012;

    // Kick timing, as three separate normalised ramps so each phase can have
    // its own shape.
    const windUp =
      this.mood === "kicking"
        ? MathUtils.clamp(this.phase / WIND_UP_SECONDS, 0, 1)
        : 0;
    const strike =
      this.mood === "kicking"
        ? MathUtils.clamp((this.phase - WIND_UP_SECONDS) / STRIKE_SECONDS, 0, 1)
        : 0;
    const recover =
      this.mood === "kicking"
        ? MathUtils.clamp(
            (this.phase - WIND_UP_SECONDS - STRIKE_SECONDS) / RECOVER_SECONDS,
            0,
            1,
          )
        : 0;
    // Full at the moment of the strike, falling away through the recovery.
    // Clamped: the two ramps overlap, and unclamped their sum peaks at 1.35,
    // which drove every amplitude below a third past what it was tuned for.
    const lash = MathUtils.clamp((windUp * 0.35 + strike) * (1 - recover), 0, 1);

    rig.root.rotation.y = this.yaw;

    // The whole animal drops onto its forehand to throw its hind end up. This
    // is the part that reads at a distance; the legs are detail on top of it.
    //
    // The pitch turns the body about the rig's origin, which sits at hoof
    // level, so it swings the front feet down through the ground rather than
    // rocking the horse over them. The lift is what a pivot at the forefeet
    // would have done for free: 1.02 (1 - cos p) + 0.45 sin p, for a shoulder
    // 1.02 up and 0.45 forward of the origin. Both are damped at the same rate
    // so they cannot drift out of step mid-kick and dip a hoof under.
    const pitch = lash * KICK_PITCH;
    rig.body.position.y = damp(
      rig.body.position.y,
      breathe + 1.02 * (1 - Math.cos(pitch)) + 0.45 * Math.sin(pitch),
      14,
      dt,
    );
    rig.body.rotation.x = damp(rig.body.rotation.x, pitch, 14, dt);
    // Gathered under first, then flung open.
    rig.spine.rotation.x = damp(
      rig.spine.rotation.x,
      windUp * 0.3 * (1 - strike) - strike * (1 - recover) * 0.34,
      16,
      dt,
    );
    rig.forehand.rotation.x = damp(rig.forehand.rotation.x, lash * 0.12, 14, dt);

    // Head and neck: up and alert when watching, dropped and snaky when warning,
    // and thrown down as the hind end comes up.
    const neckTarget =
      this.restNeck * (1 - alarm) + 0.62 * alarm + lash * 0.38;
    rig.neck.rotation.x = damp(rig.neck.rotation.x, neckTarget, 6, dt);
    const carry = this.restHeadCarry * (1 - alarm) + 0.42 * alarm;
    rig.head.rotation.x = damp(
      rig.head.rotation.x,
      -rig.neck.rotation.x + carry - lash * 0.2,
      7,
      dt,
    );

    // Ears: forward and cupped towards you while it is only watching, flat back
    // against the neck the moment it means it.
    const pinned = MathUtils.clamp(alarm * 1.6 - 0.5, 0, 1);
    for (const [ear, side] of [
      [rig.earLeft, -1],
      [rig.earRight, 1],
    ] as const) {
      ear.rotation.x = damp(ear.rotation.x, -0.18 + pinned * 1.25, 9, dt);
      ear.rotation.z = damp(ear.rotation.z, side * (0.16 - pinned * 0.34), 9, dt);
    }

    // Tail: a hard wring when it is warning, clamped down over the kick itself.
    const wring = Math.sin(this.breath * 7.5) * 0.34 * alarm * (1 - lash);
    rig.tail.forEach((segment, index) => {
      segment.rotation.x = damp(
        segment.rotation.x,
        (index === 0 ? 0.2 : 0.16) + alarm * 0.3 + lash * 0.5,
        8,
        dt,
      );
      segment.rotation.z = damp(segment.rotation.z, wring * (1 + index * 0.25), 7, dt);
    });

    for (const leg of rig.legs) {
      if (leg.isFront) {
        // The front legs take the whole horse's weight and brace against it.
        leg.upper.rotation.x = damp(leg.upper.rotation.x, -lash * 0.3, 18, dt);
        leg.lower.rotation.x = damp(leg.lower.rotation.x, 0.06 + lash * 0.22, 18, dt);
        leg.hoof.rotation.x = damp(leg.hoof.rotation.x, -0.06 - lash * 0.16, 16, dt);
        continue;
      }
      // Hind legs: folded up under the belly through the wind-up, then snapped
      // out straight behind. A kick that does not fold first has no power in it
      // and reads as a horse lifting its legs rather than throwing them.
      const gather = windUp * (1 - strike);
      const extend = strike * (1 - recover);
      leg.upper.rotation.x = damp(
        leg.upper.rotation.x,
        0.3 * (1 - extend) - gather * 0.55 + extend * 1.15,
        22,
        dt,
      );
      leg.lower.rotation.x = damp(
        leg.lower.rotation.x,
        -0.535 * (1 - extend) - gather * 0.8 + extend * 0.42,
        22,
        dt,
      );
      leg.hoof.rotation.x = damp(leg.hoof.rotation.x, 0.3 - extend * 0.55, 20, dt);
    }
  }
}
