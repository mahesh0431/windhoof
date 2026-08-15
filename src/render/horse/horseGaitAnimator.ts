import { MathUtils } from "three";
import type { HorseCondition, HorseGait } from "../../game/simulation/horse/horseState";
import type { HorseLegRig, HorseRig } from "./horseVisual";

export interface HorseAnimationInput {
  readonly speed: number;
  readonly gait: HorseGait;
  readonly grounded: boolean;
  readonly verticalVelocity: number;
  readonly condition: HorseCondition;
  /** Radians per second, positive when turning right. */
  readonly yawRate: number;
  /** Metres per second squared along travel, positive when accelerating. */
  readonly acceleration: number;
  readonly groundPitch: number;
  readonly groundRoll: number;
  readonly deltaSeconds: number;
  readonly reducedMotion: boolean;
}

export interface Footfall {
  readonly leg: HorseLegRig["id"];
  readonly isFront: boolean;
  /** 0-1, how much weight the step carries. Drives hoof volume. */
  readonly weight: number;
}

interface GaitProfile {
  /** Metres covered per complete stride cycle. */
  readonly strideLength: number;
  /** Fraction of the cycle a hoof spends on the ground. */
  readonly dutyFactor: number;
  /** Peak fore/aft swing of the upper leg, radians. */
  readonly swingAmplitude: number;
  /** Hind legs sweep further than fore legs; this is how much further. */
  readonly hindSwingScale: number;
  /** How far past vertical the stance leg drives before lifting off. */
  readonly driveScale: number;
  /** Peak knee and hock flexion during swing, radians. */
  readonly flexAmplitude: number;
  /** Symmetric body rise and fall across the cycle, metres. */
  readonly bob: number;
  /**
   * Extra rise through the suspension phase, metres. This is the part that
   * makes a gallop look airborne rather than wheeled, so it is a separate,
   * narrow pulse rather than more amplitude on the sine.
   */
  readonly lift: number;
  /** Phase of the suspension phase, within one bob harmonic. */
  readonly liftCentre: number;
  /** Half-width of the suspension window, in cycle fractions. */
  readonly liftHalfWidth: number;
  /** Body pitch rocking, radians. */
  readonly pitch: number;
  /** Peak spinal rounding at the gathered phase, radians. */
  readonly spineFlex: number;
  /** Bob oscillations per stride. */
  readonly bobHarmonic: number;
  /** Per-leg phase offsets: front left, front right, rear left, rear right. */
  readonly offsets: readonly [number, number, number, number];
}

/**
 * Footfall sequences are the real ones. A lateral four-beat walk, a diagonal
 * two-beat trot, a three-beat canter, and a four-beat gallop, each with its
 * true suspension phase, are what a player reads as "horse" without being able
 * to say why, and getting them wrong is the single fastest way to make good
 * locomotion look wrong.
 *
 * A leg is in stance while `(stridePhase + offset) mod 1 < dutyFactor`, so its
 * hoof lands at `stridePhase = -offset`. The offsets below are derived from the
 * landing order, not chosen by ear:
 *
 *   walk    left hind, left fore, right hind, right fore   (lateral, no float)
 *   trot    left fore + right hind, then the other pair    (two floats)
 *   canter  right hind, left hind + right fore, left fore  (left lead, float)
 *   gallop  right hind, left hind, right fore, left fore   (left lead, float)
 *
 * `liftCentre` then names the window where no hoof is on the ground, and
 * `tests/render/horseAnimation.test.ts` recomputes the stance windows from the
 * offsets and fails if any suspension pulse fires while a leg is planted. That
 * test caught all three of the fast gaits carrying invented sequences.
 */
export const GAIT_PROFILES: Record<HorseGait, GaitProfile> = {
  idle: {
    strideLength: 1.7,
    dutyFactor: 0.68,
    swingAmplitude: 0.1,
    hindSwingScale: 1,
    driveScale: 0.85,
    flexAmplitude: 0.12,
    bob: 0.008,
    lift: 0,
    liftCentre: 0.25,
    liftHalfWidth: 0.1,
    pitch: 0.004,
    spineFlex: 0.006,
    bobHarmonic: 2,
    offsets: [0.75, 0.25, 0, 0.5],
  },
  walk: {
    strideLength: 1.72,
    dutyFactor: 0.63,
    swingAmplitude: 0.36,
    hindSwingScale: 0.95,
    driveScale: 0.9,
    flexAmplitude: 0.5,
    bob: 0.022,
    // A walk has no suspension phase at all: at least two hooves are always
    // down. Giving it a lift pulse would be the one thing that makes a walking
    // horse look like it is skipping.
    lift: 0,
    liftCentre: 0.9,
    liftHalfWidth: 0.08,
    pitch: 0.016,
    spineFlex: 0.022,
    bobHarmonic: 2,
    offsets: [0.75, 0.25, 0, 0.5],
  },
  trot: {
    strideLength: 2.85,
    dutyFactor: 0.4,
    swingAmplitude: 0.58,
    hindSwingScale: 1,
    driveScale: 0.95,
    flexAmplitude: 1,
    bob: 0.045,
    lift: 0.1,
    liftCentre: 0.9,
    liftHalfWidth: 0.085,
    pitch: 0.03,
    spineFlex: 0.045,
    bobHarmonic: 2,
    offsets: [0, 0.5, 0.5, 0],
  },
  canter: {
    strideLength: 4.8,
    dutyFactor: 0.38,
    swingAmplitude: 0.76,
    hindSwingScale: 1.12,
    driveScale: 1.05,
    flexAmplitude: 1.2,
    bob: 0.06,
    lift: 0.17,
    liftCentre: 0.92,
    liftHalfWidth: 0.07,
    pitch: 0.1,
    spineFlex: 0.1,
    bobHarmonic: 1,
    offsets: [0.54, 0.76, 0.76, 0],
  },
  gallop: {
    strideLength: 6.9,
    dutyFactor: 0.33,
    swingAmplitude: 0.98,
    hindSwingScale: 1.25,
    driveScale: 1.15,
    flexAmplitude: 1.5,
    bob: 0.055,
    lift: 0.24,
    liftCentre: 0.88,
    liftHalfWidth: 0.1,
    pitch: 0.14,
    spineFlex: 0.17,
    bobHarmonic: 1,
    offsets: [0.57, 0.7, 0.87, 0],
  },
};

/**
 * How far the gaskin is carried behind the vertical when the horse is standing.
 *
 * A standing horse does not hang its hind legs straight down off the hip: the
 * point of hock sits back under the point of buttock and the cannon comes
 * forward again to the fetlock, which is the zig-zag that reads as a hind leg
 * from any angle. With the gaskin plumb, as it was, the whole hind limb is one
 * straight post and the hock - the most recognisable joint on the animal -
 * never appears in the outline at all.
 *
 * It blends out with speed, because a moving horse's neutral is not a standing
 * one's, and biasing the swing backwards at a gallop would stop the hinds ever
 * reaching under the body.
 */
const HIND_STANCE = 0.3;
/** Chosen so the cannon keeps its own angle once the gaskin is leant back. */
const REST_HOCK = -0.535;
const REST_KNEE = 0.06;
const TAU = Math.PI * 2;

/**
 * Vertical impulse spring for takeoff drive and landing absorption.
 *
 * Underdamped on purpose: a horse landing at speed sinks, then rebounds once
 * before settling, and that single rebound is what separates "absorbed an
 * impact" from "snapped back to the idle pose".
 */
const IMPULSE_STIFFNESS = 190;
const IMPULSE_DAMPING = 10;
/** How much of the compression the body drops; the legs absorb the rest. */
const IMPULSE_BODY_SHARE = 0.45;
const IMPULSE_BODY_FLOOR = -0.1;

function damp(current: number, target: number, rate: number, dt: number): number {
  return MathUtils.damp(current, target, rate, dt);
}

/** Smooth bump, one at the centre and exactly zero with zero slope at the edges. */
function suspensionPulse(phase: number, centre: number, halfWidth: number): number {
  let distance = Math.abs(phase - centre);
  if (distance > 0.5) distance = 1 - distance;
  const u = distance / halfWidth;
  if (u >= 1) return 0;
  const k = 1 - u * u;
  return k * k;
}

/**
 * Drives the rig from controller truth only. It never reads or writes horse
 * position, gait selection, or grounding: animation is a consumer of the
 * simulation, never a second source of movement.
 */
export class HorseGaitAnimator {
  private phase = 0;
  private profile: GaitProfile = { ...GAIT_PROFILES.idle };
  private legPhase: [number, number, number, number] = [0, 0, 0, 0];
  private wasStance: [boolean, boolean, boolean, boolean] = [true, true, true, true];
  private airborneBlend = 0;
  private stumbleBlend = 0;
  private bank = 0;
  private lean = 0;
  private breath = 0;
  private idleTime = 0;
  private earFlickTimer = 2.4;
  private earFlick = 0;
  private tailSwing = 0;
  private maneLag = 0;
  private groundPitch = 0;
  private groundRoll = 0;
  /** Metres of vertical impulse displacement. Negative is compressed. */
  private compress = 0;
  private compressVelocity = 0;
  private forehandAngle = 0;
  private neckAngle = 0.7;
  private readonly footfalls: Footfall[] = [];

  /**
   * The horse has left the ground under its own power. Drives the push-off:
   * the frame extends, the forehand comes up, the hocks thrust back.
   */
  public takeOff(strength = 1): void {
    this.compressVelocity += MathUtils.clamp(strength, 0, 1.5) * 1.5;
  }

  /**
   * The horse has hit the ground. `strength` is the impact relative to the
   * hard-landing threshold, so an ordinary hop barely registers and a drop off
   * the plateau visibly folds the horse up.
   */
  public land(strength = 1): void {
    this.compressVelocity -= MathUtils.clamp(strength, 0, 1.5) * 2.6;
  }

  public update(rig: HorseRig, input: HorseAnimationInput): void {
    const dt = Math.min(0.1, Math.max(0, input.deltaSeconds));
    const target = GAIT_PROFILES[input.gait];
    const motionScale = input.reducedMotion ? 0.45 : 1;

    // Blend profile values instead of switching them, so a gait change reads as
    // a transition rather than a pop.
    this.profile = {
      strideLength: damp(this.profile.strideLength, target.strideLength, 6, dt),
      dutyFactor: damp(this.profile.dutyFactor, target.dutyFactor, 6, dt),
      swingAmplitude: damp(this.profile.swingAmplitude, target.swingAmplitude, 7, dt),
      hindSwingScale: damp(this.profile.hindSwingScale, target.hindSwingScale, 6, dt),
      driveScale: damp(this.profile.driveScale, target.driveScale, 6, dt),
      flexAmplitude: damp(this.profile.flexAmplitude, target.flexAmplitude, 7, dt),
      bob: damp(this.profile.bob, target.bob, 6, dt),
      lift: damp(this.profile.lift, target.lift, 6, dt),
      liftCentre: target.liftCentre,
      liftHalfWidth: damp(this.profile.liftHalfWidth, target.liftHalfWidth, 6, dt),
      pitch: damp(this.profile.pitch, target.pitch, 6, dt),
      spineFlex: damp(this.profile.spineFlex, target.spineFlex, 6, dt),
      bobHarmonic: damp(this.profile.bobHarmonic, target.bobHarmonic, 5, dt),
      offsets: target.offsets,
    };

    // Phase advances with distance travelled, never with wall time. This is
    // what stops hooves sliding across the ground at any speed, and it is why
    // a horse held against the boundary stops striding instead of running in
    // place: the controller reports the speed it actually resolved.
    const cyclesPerSecond = input.speed / Math.max(0.4, this.profile.strideLength);
    this.phase = (this.phase + cyclesPerSecond * dt) % 1;

    // Airborne blends in fast (the pose changes the instant the hooves leave)
    // and out slower, so the landing pose has time to read.
    this.airborneBlend = damp(this.airborneBlend, input.grounded ? 0 : 1, input.grounded ? 9 : 16, dt);
    this.stumbleBlend = damp(
      this.stumbleBlend,
      input.condition === "stumbling" ? 1 : 0,
      8,
      dt,
    );
    this.groundPitch = damp(this.groundPitch, input.groundPitch, 7, dt);
    this.groundRoll = damp(this.groundRoll, input.groundRoll, 7, dt);

    this.integrateImpulse(dt);

    const speedRatio = MathUtils.clamp(input.speed / 16, 0, 1);
    this.breath += dt * (1.1 + speedRatio * 3.4);
    this.idleTime = input.speed < 0.2 ? this.idleTime + dt : 0;

    // One phase space shared by the bob, the suspension pulse, and the spinal
    // flexion, so the horse is highest, most gathered, and fully off the ground
    // at the same instant instead of three effects sliding past each other.
    const harmonicPhase = (this.phase * this.profile.bobHarmonic) % 1;
    const suspension = suspensionPulse(
      harmonicPhase,
      this.profile.liftCentre,
      this.profile.liftHalfWidth,
    );
    // Zero at the suspension centre, so cos() peaks exactly where the horse is
    // airborne and troughs at mid-stance.
    const cycleAngle = (harmonicPhase - this.profile.liftCentre) * TAU;

    this.updateLegs(rig, input, dt, speedRatio);
    this.updateFrame(rig, input, dt, speedRatio, motionScale, suspension, cycleAngle);
    this.updateNeckAndHead(rig, input, dt, speedRatio, motionScale);
    this.updateTailAndMane(rig, input, dt, speedRatio, motionScale);
  }

  public consumeFootfalls(): readonly Footfall[] {
    const drained = this.footfalls.slice();
    this.footfalls.length = 0;
    return drained;
  }

  /** Diagnostics and tests: 0 at rest, negative compressed, positive extended. */
  public get impulseDisplacement(): number {
    return this.compress;
  }

  private integrateImpulse(dt: number): void {
    // Semi-implicit Euler. Stable at the frame rates this game runs at, and it
    // keeps the spring from gaining energy when a frame is long.
    const steps = Math.max(1, Math.ceil(dt / 0.01));
    const step = dt / steps;
    for (let index = 0; index < steps; index += 1) {
      this.compressVelocity +=
        (-IMPULSE_STIFFNESS * this.compress - IMPULSE_DAMPING * this.compressVelocity) *
        step;
      this.compress += this.compressVelocity * step;
    }
  }

  private updateLegs(
    rig: HorseRig,
    input: HorseAnimationInput,
    dt: number,
    speedRatio: number,
  ): void {
    const { dutyFactor, swingAmplitude, flexAmplitude, hindSwingScale, driveScale } =
      this.profile;
    const moving = MathUtils.clamp(input.speed / 1.2, 0, 1);
    const absorb = MathUtils.clamp(-this.compress / 0.18, 0, 1);
    const drive = MathUtils.clamp(this.compress / 0.12, 0, 1);
    // Braking swings the hind legs forward under the body so the horse visibly
    // sits down into the stop instead of gliding to a halt upright.
    const braking = MathUtils.clamp(-input.acceleration / 9, 0, 1);

    rig.legs.forEach((leg, index) => {
      const offset = this.profile.offsets[legOffsetIndex(leg.id)] ?? 0;
      const phase = (this.phase + offset) % 1;
      this.legPhase[index] = phase;

      const amplitude = swingAmplitude * (leg.isFront ? 1 : hindSwingScale);
      const inStance = phase < dutyFactor;
      let swing: number;
      let flex: number;

      if (inStance) {
        // Planted: the pivot rotates backwards at a constant rate so the hoof
        // holds still relative to the ground. Hind legs carry further past
        // vertical, which is where a gallop's propulsion visibly comes from.
        const t = phase / dutyFactor;
        const back = amplitude * driveScale * (leg.isFront ? 0.8 : 1.05);
        swing = MathUtils.lerp(amplitude, -back, t);
        flex = 0.08 + Math.sin(t * Math.PI) * 0.1;
      } else {
        const t = (phase - dutyFactor) / (1 - dutyFactor);
        const eased = t * t * (3 - 2 * t);
        const back = amplitude * driveScale * (leg.isFront ? 0.8 : 1.05);
        swing = MathUtils.lerp(-back, amplitude, eased);
        flex = Math.sin(t * Math.PI) * flexAmplitude;
      }

      if (inStance && !this.wasStance[index] && input.grounded && input.speed > 0.35) {
        this.footfalls.push({
          leg: leg.id,
          isFront: leg.isFront,
          weight: 0.35 + speedRatio * 0.65,
        });
      }
      this.wasStance[index] = inStance;

      // Airborne pose. Rising, the front legs fold tight under the chest and
      // the hocks trail out behind; falling, the fronts straighten and reach
      // for the ground and the hinds swing under to catch the weight.
      const reaching = MathUtils.clamp(-input.verticalVelocity / 6, 0, 1);
      const airSwing = leg.isFront
        ? MathUtils.lerp(0.95, 0.45, reaching)
        : MathUtils.lerp(-0.85, 0.5, reaching);
      const airFlex = leg.isFront
        ? MathUtils.lerp(1.9, 0.35, reaching)
        : MathUtils.lerp(0.9, 0.4, reaching);

      // Stumble: a fast irregular scramble that is unmistakable at a glance.
      const scramble = Math.sin(this.breath * 9 + index * 2.1) * 0.55;

      const groundSwing =
        swing * moving + (leg.isFront ? 0 : braking * 0.42) - drive * (leg.isFront ? 0.3 : -0.45);
      const finalSwing = MathUtils.lerp(
        MathUtils.lerp(groundSwing, airSwing, this.airborneBlend),
        scramble,
        this.stumbleBlend * 0.7,
      );
      const groundFlex = flex * moving + absorb * 0.55 + braking * 0.25;
      const finalFlex = MathUtils.lerp(
        MathUtils.lerp(groundFlex, airFlex, this.airborneBlend),
        0.9 + scramble * 0.4,
        this.stumbleBlend * 0.7,
      );

      const stance = leg.isFront ? 0 : HIND_STANCE * (1 - speedRatio);
      leg.upper.rotation.x = damp(leg.upper.rotation.x, finalSwing + stance, 26, dt);

      // Knees bend backwards, hocks bend forwards. Mixing these up is what
      // makes a quadruped read as a stretched dog.
      const jointRest = leg.isFront ? REST_KNEE : REST_HOCK + HIND_STANCE - stance;
      const jointTarget = leg.isFront
        ? jointRest - finalFlex
        : jointRest + finalFlex * 0.85;
      leg.lower.rotation.x = damp(leg.lower.rotation.x, jointTarget, 24, dt);

      const hoofTarget = leg.isFront
        ? -0.06 + finalFlex * 0.35
        : 0.3 - finalFlex * 0.3;
      leg.hoof.rotation.x = damp(leg.hoof.rotation.x, hoofTarget, 18, dt);
    });
  }

  /**
   * Body height, pitch, bank, and the two torso joints. These are what carry
   * the horse's mass, and getting them flat is what made the first build read
   * as a rigid model being dragged along a rail.
   */
  private updateFrame(
    rig: HorseRig,
    input: HorseAnimationInput,
    dt: number,
    speedRatio: number,
    motionScale: number,
    suspension: number,
    cycleAngle: number,
  ): void {
    const moving = MathUtils.clamp(input.speed / 1.2, 0, 1);
    const absorb = MathUtils.clamp(-this.compress / 0.18, 0, 1);
    const drive = MathUtils.clamp(this.compress / 0.12, 0, 1);
    const cycleWave = Math.cos(cycleAngle);

    // The bob swings about the horse's STANDING height, which means half of it
    // is the body sinking below the height its own legs hold it at - and with
    // no inverse kinematics under the stance leg, a body that sinks takes the
    // planted hoof down through the terrain with it. Measured across a full
    // stride that was the largest single term: 4.5 cm at a trot before the
    // tilt was even counted.
    //
    // Offsetting by one amplitude puts the trough at standing height instead of
    // below it. The rise and fall the player sees is unchanged - peak to trough
    // is still twice `bob` - the whole waveform simply sits on the ground the
    // horse is standing on rather than through it. A moving horse carrying
    // itself a little higher than a stationary one is also true.
    const gaitRise =
      (this.profile.lift * suspension + this.profile.bob * (cycleWave + 1)) * moving;
    // Offset for the same reason as the gait bob: a standing horse breathing
    // should rise off its own height, not sink through it.
    const breathBob = (Math.sin(this.breath * 1.3) + 1) * 0.012 * (1 - moving);
    // The legs absorb most of a landing; only part of it drops the body, and
    // that part is floored so the hooves never sink through the terrain.
    const impulseRise = Math.max(IMPULSE_BODY_FLOOR, this.compress * IMPULSE_BODY_SHARE);

    // Banking into a turn. A horse leans in; without this, fast turns look like
    // the model is sliding sideways on rails.
    const bankTarget = MathUtils.clamp(
      -input.yawRate * (0.22 + speedRatio * 0.5),
      -0.34,
      0.34,
    );
    this.bank = damp(this.bank, bankTarget, 6, dt);

    // Weight shift under acceleration and braking.
    const leanTarget = MathUtils.clamp(input.acceleration * 0.022, -0.16, 0.13);
    this.lean = damp(this.lean, leanTarget, 5, dt);

    // Pitch lags the rise by about a sixth of a cycle, so the nose comes up as
    // the horse leaves the ground rather than at the same instant.
    const gaitPitch = Math.sin(cycleAngle - 0.9) * this.profile.pitch * moving;
    // Rising must pitch the nose UP. The first build had this sign inverted,
    // which made every jump start as a nose-dive and end nose-high.
    const airPitch = -this.airborneBlend * MathUtils.clamp(
      input.verticalVelocity * 0.028,
      -0.2,
      0.22,
    );
    const stumblePitch = this.stumbleBlend * 0.3;

    // Split deliberately: `ride` is the horse tilting itself, `ground` is the
    // horse being tilted by the hill it is standing on. They add up to the same
    // rotation, but only the first needs its feet putting back.
    const ridePitch =
      (gaitPitch + this.lean) * motionScale + airPitch + stumblePitch;
    const rideRoll =
      this.bank * motionScale + this.stumbleBlend * Math.sin(this.breath * 6) * 0.12;

    rig.body.rotation.x = damp(
      rig.body.rotation.x,
      ridePitch + this.groundPitch,
      30,
      dt,
    );
    rig.body.rotation.z = damp(
      rig.body.rotation.z,
      rideRoll + this.groundRoll,
      12,
      dt,
    );
    rig.body.rotation.y = damp(
      rig.body.rotation.y,
      -this.bank * 0.25 * motionScale,
      10,
      dt,
    );

    // Assigned rather than damped. Every term feeding it is already smooth and
    // continuous, and a first-order lag here does nothing but flatten the
    // suspension pulse it exists to deliver: at gallop the pulse lasts about
    // 80 ms, which a 26-per-second damp would cut by nearly a third.
    //
    // The tilt term is what stops the hooves going through the terrain. Body
    // rotation turns about the rig's origin, and the origin sits at hoof level,
    // so pitching or banking swings whichever end is going down BELOW the
    // ground instead of rocking the horse over its own feet. Measured across a
    // full stride the worst point reached 7.5 cm under at a trot - on grass
    // that reads as hooves in the sward, on rock and sand it reads as a bug.
    //
    // Read from the rotation the horse applies to ITSELF only; the ground
    // conform is excluded on purpose, because matching the slope you are
    // standing on is exactly the case where the feet should follow.
    rig.body.position.y =
      (gaitRise + breathBob) * motionScale +
      impulseRise -
      this.airborneBlend * 0.04 +
      tiltLift(ridePitch, rideRoll) * (1 - this.airborneBlend);

    // --- Torso articulation ------------------------------------------------
    // Positive spine rounds the back and brings the hocks under; negative
    // extends the frame. The wave peaks with the suspension pulse, so the horse
    // is highest and most gathered on the same frame.
    const gaitFlex = this.profile.spineFlex * cycleWave * moving;
    // Accelerating extends the frame, braking rounds it hard: a horse stopping
    // sits down on its hocks, and that is the clearest braking cue there is.
    const effortFlex = -this.lean * 0.9;
    const airSpine = MathUtils.lerp(
      -0.14,
      0.16,
      MathUtils.clamp(-input.verticalVelocity / 6, 0, 1),
    );
    const spineTarget =
      (gaitFlex + effortFlex) * motionScale +
      this.airborneBlend * airSpine +
      absorb * 0.22 -
      drive * 0.26 +
      this.stumbleBlend * 0.18;
    rig.spine.rotation.x = damp(rig.spine.rotation.x, spineTarget, 45, dt);

    // The forehand lifts as the back rounds, which is the shape a horse makes
    // at the top of a stride and over a jump.
    const airForehand = MathUtils.lerp(
      -0.2,
      0.02,
      MathUtils.clamp(-input.verticalVelocity / 6, 0, 1),
    );
    this.forehandAngle = damp(
      this.forehandAngle,
      -(gaitFlex + effortFlex) * 0.55 * motionScale +
        this.airborneBlend * airForehand +
        absorb * 0.16 -
        drive * 0.3,
      35,
      dt,
    );
    rig.forehand.rotation.x = this.forehandAngle;
    // A little lateral flex through the barrel on hard turns.
    rig.spine.rotation.y = damp(rig.spine.rotation.y, this.bank * 0.4 * motionScale, 8, dt);
  }

  private updateNeckAndHead(
    rig: HorseRig,
    input: HorseAnimationInput,
    dt: number,
    speedRatio: number,
    motionScale: number,
  ): void {
    const absorb = MathUtils.clamp(-this.compress / 0.18, 0, 1);
    const drive = MathUtils.clamp(this.compress / 0.12, 0, 1);

    // Standing: head high and alert. Galloping: neck reaches forward and low,
    // pumping once per stride. This is the clearest single signal of effort.
    const restAngle = 0.7;
    const gallopAngle = 1.24;
    const targetNeck = MathUtils.lerp(restAngle, gallopAngle, speedRatio);
    const pump =
      Math.sin(this.phase * TAU * this.profile.bobHarmonic - 0.4) *
      (0.03 + speedRatio * 0.14) *
      motionScale;
    const idleNod = Math.sin(this.idleTime * 0.7) * 0.05 * MathUtils.clamp(this.idleTime, 0, 1);

    this.neckAngle = damp(
      this.neckAngle,
      targetNeck +
        pump +
        idleNod +
        this.stumbleBlend * 0.5 +
        this.airborneBlend * 0.12 +
        absorb * 0.28 -
        drive * 0.35,
      15,
      dt,
    );
    rig.neck.rotation.x = this.neckAngle;

    // How far the face is carried below the horizon, independent of neck angle
    // or how far the forehand has rotated.
    //
    // A standing horse holds its face near the vertical with the poll highest -
    // nose down by roughly a third of a right angle - and only reaches its head
    // out flat when it is going somewhere. Holding it level at every speed,
    // which is what this did, made the profile read as a camel: a long
    // horizontal head stuck on the end of a raised neck.
    const headCarry = 0.62 - speedRatio * 0.5;
    rig.head.rotation.x = damp(
      rig.head.rotation.x,
      -this.neckAngle - this.forehandAngle * 0.6 + headCarry - this.stumbleBlend * 0.5,
      10,
      dt,
    );
    rig.head.rotation.y = damp(
      rig.head.rotation.y,
      MathUtils.clamp(input.yawRate * 0.22, -0.3, 0.3),
      6,
      dt,
    );

    // Ears: forward and attentive at rest, pinned back into the wind at speed,
    // with occasional flicks so a standing horse never looks frozen.
    this.earFlickTimer -= dt;
    if (this.earFlickTimer <= 0) {
      this.earFlickTimer = 1.8 + Math.abs(Math.sin(this.breath * 3.7)) * 4;
      this.earFlick = 0.5;
    }
    this.earFlick = damp(this.earFlick, 0, 4, dt);

    const earBack = speedRatio * 0.5;
    rig.earLeft.rotation.x = damp(rig.earLeft.rotation.x, -0.18 + earBack, 8, dt);
    rig.earRight.rotation.x = damp(rig.earRight.rotation.x, -0.18 + earBack, 8, dt);
    rig.earLeft.rotation.z = damp(rig.earLeft.rotation.z, -0.16 - this.earFlick, 9, dt);
    rig.earRight.rotation.z = damp(rig.earRight.rotation.z, 0.16 + this.earFlick * 0.4, 9, dt);
  }

  private updateTailAndMane(
    rig: HorseRig,
    input: HorseAnimationInput,
    dt: number,
    speedRatio: number,
    motionScale: number,
  ): void {
    // Tail lifts and streams behind as speed builds, swishes when standing.
    this.tailSwing = damp(
      this.tailSwing,
      Math.sin(this.breath * (0.9 + speedRatio * 2)) * (0.07 - speedRatio * 0.03),
      5,
      dt,
    );

    // Larger pitch trails the tail further behind the horse, so speed streams
    // it out instead of tucking it under. At rest it hangs: a standing horse
    // carrying its tail out behind it reads as alarmed, permanently.
    // A relaxed horse's tail hangs close to plumb off the point of the croup;
    // it only leaves the quarters when the animal is moving or worried. Carried
    // out at rest, which is what this did, the tail reads as a stick nailed on
    // behind rather than as hair.
    const liftBase = 0.2 + speedRatio * 0.8;
    rig.tail.forEach((segment, index) => {
      const target =
        index === 0
          ? liftBase + this.airborneBlend * 0.12
          : 0.16 + speedRatio * 0.24 + this.airborneBlend * 0.1;
      segment.rotation.x = damp(segment.rotation.x, target, 7, dt);
      // Sideways sway compounds down the chain, so the growth per segment has
      // to stay small: at 0.6 the three joints summed to better than forty
      // degrees and a standing horse held its tail permanently out sideways,
      // clear of its own quarters.
      segment.rotation.z = damp(
        segment.rotation.z,
        this.tailSwing * (1 + index * 0.25) * motionScale,
        6,
        dt,
      );
    });

    // The mane swings about the middle of the crest, so the angle here is what
    // the hair trails by rather than what the whole sheet is dragged by. Kept
    // modest for that reason: past about a quarter radian the roots leave the
    // neck they are supposed to be growing out of.
    this.maneLag = damp(this.maneLag, speedRatio, 4, dt);
    rig.mane.rotation.x = damp(
      rig.mane.rotation.x,
      -this.maneLag * 0.26 * motionScale +
        Math.sin(this.breath * 2.4) * 0.03 * motionScale,
      8,
      dt,
    );
  }
}

/**
 * How far to raise a body tilted about an origin at hoof level, in metres.
 *
 * The lever arms are the rig's own: the shoulder sits 1.02 up and 0.45 forward
 * of the origin, the hip 0.99 up and 0.56 back, and the feet stand about 0.21
 * either side of the centre line. Which end goes down depends on the sign of
 * the pitch, so the forward arm is chosen accordingly.
 *
 * Exact for a single-axis tilt and close enough for the small combined angles a
 * gait produces; it is undoing a few centimetres, not solving a pose.
 */
function tiltLift(pitch: number, roll: number): number {
  const arm = pitch > 0 ? 0.45 : 0.56;
  return (
    1.02 * (1 - Math.cos(pitch)) +
    Math.abs(Math.sin(pitch)) * arm +
    1.0 * (1 - Math.cos(roll)) +
    Math.abs(Math.sin(roll)) * 0.21
  );
}

function legOffsetIndex(id: HorseLegRig["id"]): number {
  switch (id) {
    case "frontLeft":
      return 0;
    case "frontRight":
      return 1;
    case "rearLeft":
      return 2;
    case "rearRight":
      return 3;
  }
}
