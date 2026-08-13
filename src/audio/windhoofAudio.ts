import type { HorseGait } from "../game/simulation/horse/horseState";
import type { WorldSurface } from "../game/contracts/worldSurface";

export interface AudioVolumes {
  readonly master: number;
  readonly ambience: number;
  readonly horse: number;
}

export interface AudioFrame {
  readonly speed: number;
  readonly gait: HorseGait;
  readonly surface: WorldSurface;
  readonly grounded: boolean;
  /** Metres from the shoreline; drives the surf bed. */
  readonly shoreDistance: number;
  readonly deltaSeconds: number;
}

/**
 * Every sound here is synthesised in the browser at runtime.
 *
 * Milestone 1 allows placeholder audio, and generating it removes an entire
 * class of provenance risk: there is no sample to license, attribute, or ship.
 * It is honestly a placeholder — a real hoof recording will sound better — but
 * it delivers what the milestone actually needs, which is rhythmic feedback
 * that confirms speed, gait, surface, and contact with the ground.
 */
export interface WindhoofAudioOptions {
  /**
   * Silences this instance for its whole lifetime.
   *
   * Enforced in exactly one place - `resume` refuses to construct the
   * `AudioContext` - because every sound below already requires a running
   * context before it will do anything. That is what makes the guarantee hold
   * for sources that do not exist yet: a hoof or a whinny added later inherits
   * it by construction rather than by remembering to check a flag.
   */
  readonly muted?: boolean;
}

export class WindhoofAudio {
  private readonly mutedByFlag: boolean;
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private horseGain: GainNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private surfGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private breathTimer = 0;
  private volumes: AudioVolumes = { master: 0.7, ambience: 0.8, horse: 0.9 };
  private failed = false;

  public constructor(options: WindhoofAudioOptions = {}) {
    this.mutedByFlag = options.muted === true;
  }

  public get isRunning(): boolean {
    return this.context?.state === "running";
  }

  /** True when this instance will never produce sound, whatever it is asked. */
  public get isMuted(): boolean {
    return this.mutedByFlag;
  }

  /** True once an `AudioContext` exists at all, muted or not. */
  public get hasContext(): boolean {
    return this.context !== null;
  }

  /** Must be called from a user gesture; browsers block audio before one. */
  public async resume(): Promise<void> {
    if (this.mutedByFlag || this.failed) return;
    try {
      this.context ??= new AudioContext();
      if (!this.master) this.build(this.context);
      if (this.context.state === "suspended") await this.context.resume();
    } catch {
      this.failed = true;
    }
  }

  /** Idempotently silence the graph while gameplay is not advancing. */
  public async suspend(): Promise<void> {
    if (!this.context || this.context.state !== "running") return;
    try {
      await this.context.suspend();
    } catch {
      // Context state is advisory during browser lifecycle changes. A rejected
      // suspend must never destabilise the authoritative simulation.
    }
  }

  public setVolumes(volumes: AudioVolumes): void {
    this.volumes = volumes;
    if (!this.context || !this.master || !this.ambienceGain || !this.horseGain) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(volumes.master, now, 0.08);
    this.ambienceGain.gain.setTargetAtTime(volumes.ambience, now, 0.08);
    this.horseGain.gain.setTargetAtTime(volumes.horse, now, 0.08);
  }

  public update(frame: AudioFrame): void {
    const context = this.context;
    if (!context || context.state !== "running") return;

    const now = context.currentTime;
    const speedRatio = Math.min(1, frame.speed / 16);

    // Wind rises with speed. This is the cheapest, strongest speed cue there is.
    if (this.windGain && this.windFilter) {
      this.windGain.gain.setTargetAtTime(0.035 + speedRatio * 0.2, now, 0.2);
      this.windFilter.frequency.setTargetAtTime(320 + speedRatio * 900, now, 0.25);
    }

    if (this.surfGain) {
      const proximity = Math.max(0, 1 - Math.max(0, frame.shoreDistance) / 70);
      this.surfGain.gain.setTargetAtTime(proximity * proximity * 0.16, now, 0.5);
    }

    // Breathing tracks effort, not wall time.
    const breathInterval =
      frame.gait === "gallop" ? 0.46 : frame.gait === "canter" ? 0.62 : frame.gait === "trot" ? 1.1 : 2.6;
    this.breathTimer -= frame.deltaSeconds;
    if (this.breathTimer <= 0) {
      this.breathTimer = breathInterval;
      this.breath(0.18 + speedRatio * 0.6);
    }
  }

  public hoof(weight: number, isFront: boolean, surface: WorldSurface): void {
    const context = this.context;
    if (!context || context.state !== "running" || !this.horseGain || !this.noiseBuffer) {
      return;
    }

    const now = context.currentTime;
    const profile = SURFACE_PROFILES[surface];
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(weight * profile.level, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.decay);
    gain.connect(this.horseGain);

    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = profile.frequency * (isFront ? 1.12 : 0.92);
    filter.Q.value = profile.q;
    filter.connect(gain);

    const noise = context.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.playbackRate.value = 0.85 + Math.random() * 0.3;
    noise.loop = true;
    noise.connect(filter);
    noise.start(now);
    noise.stop(now + profile.decay + 0.02);

    // A low body thump under the click gives the step weight.
    const thump = context.createOscillator();
    const thumpGain = context.createGain();
    thump.type = "sine";
    thump.frequency.setValueAtTime(profile.thump * (isFront ? 1.1 : 0.85), now);
    thump.frequency.exponentialRampToValueAtTime(profile.thump * 0.55, now + 0.09);
    thumpGain.gain.setValueAtTime(0, now);
    thumpGain.gain.linearRampToValueAtTime(weight * 0.22, now + 0.006);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    thump.connect(thumpGain);
    thumpGain.connect(this.horseGain);
    thump.start(now);
    thump.stop(now + 0.14);
  }

  public land(hard: boolean): void {
    const context = this.context;
    if (!context || context.state !== "running" || !this.horseGain) return;
    this.hoof(hard ? 1 : 0.7, true, "grass");

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(hard ? 90 : 130, now);
    oscillator.frequency.exponentialRampToValueAtTime(38, now + 0.24);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(hard ? 0.4 : 0.2, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    oscillator.connect(gain);
    gain.connect(this.horseGain);
    oscillator.start(now);
    oscillator.stop(now + 0.34);
  }

  /**
   * A whinny built from a detuned pair with a rising-then-breaking pitch
   * contour and a vibrato tail. Recognisably a horse call; plainly synthetic.
   */
  public whinny(): void {
    const context = this.context;
    if (!context || context.state !== "running" || !this.horseGain) return;

    const now = context.currentTime;
    const duration = 0.95;
    const output = context.createGain();
    output.gain.setValueAtTime(0, now);
    output.gain.linearRampToValueAtTime(0.32, now + 0.05);
    output.gain.setValueAtTime(0.32, now + 0.45);
    output.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    output.connect(this.horseGain);

    const formant = context.createBiquadFilter();
    formant.type = "bandpass";
    formant.frequency.setValueAtTime(900, now);
    formant.frequency.linearRampToValueAtTime(620, now + duration);
    formant.Q.value = 3.2;
    formant.connect(output);

    const vibrato = context.createOscillator();
    const vibratoGain = context.createGain();
    vibrato.frequency.setValueAtTime(6, now);
    vibrato.frequency.linearRampToValueAtTime(17, now + duration);
    vibratoGain.gain.setValueAtTime(6, now);
    vibratoGain.gain.linearRampToValueAtTime(34, now + duration);
    vibrato.connect(vibratoGain);
    vibrato.start(now);
    vibrato.stop(now + duration);

    for (const [type, detune, level] of [
      ["sawtooth", 0, 0.5],
      ["square", 7, 0.16],
    ] as const) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.detune.value = detune;
      oscillator.frequency.setValueAtTime(330, now);
      oscillator.frequency.linearRampToValueAtTime(420, now + 0.12);
      oscillator.frequency.linearRampToValueAtTime(300, now + 0.5);
      oscillator.frequency.linearRampToValueAtTime(210, now + duration);
      vibratoGain.connect(oscillator.frequency);
      gain.gain.value = level;
      oscillator.connect(gain);
      gain.connect(formant);
      oscillator.start(now);
      oscillator.stop(now + duration);
    }
  }

  /**
   * The herd answering, from somewhere out of sight.
   *
   * The same call shape as the horse's own, but pitched down, quieter, and run
   * through a low-pass, because distance takes the top off a sound before it
   * takes the volume. It has to be recognisable as the same kind of animal - it
   * is the only evidence the player has that they are not alone here.
   *
   * It is never the only cue for this moment: the interface points a bearing and
   * a flock lifts in the scene, so a muted or deaf player loses nothing.
   */
  public answeringCall(): void {
    const context = this.context;
    if (!context || context.state !== "running" || !this.horseGain) return;

    const now = context.currentTime;
    const duration = 1.25;
    const output = context.createGain();
    output.gain.setValueAtTime(0, now);
    output.gain.linearRampToValueAtTime(0.14, now + 0.18);
    output.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    output.connect(this.horseGain);

    // Distance, as a filter rather than as a volume. Turning it down alone
    // sounds like a quiet horse standing next to you.
    const air = context.createBiquadFilter();
    air.type = "lowpass";
    air.frequency.setValueAtTime(760, now);
    air.Q.value = 0.7;
    air.connect(output);

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(240, now);
    oscillator.frequency.linearRampToValueAtTime(290, now + 0.2);
    oscillator.frequency.linearRampToValueAtTime(196, now + duration);
    gain.gain.value = 0.5;
    oscillator.connect(gain);
    gain.connect(air);
    oscillator.start(now);
    oscillator.stop(now + duration);
  }

  /** A long breath out, for standing still somewhere safe. */
  public restingBreath(): void {
    this.breath(0.9);
  }

  public dispose(): void {
    void this.context?.close();
    this.context = null;
    this.master = null;
  }

  private breath(level: number): void {
    const context = this.context;
    if (!context || !this.horseGain || !this.noiseBuffer) return;

    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level * 0.08, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    gain.connect(this.horseGain);

    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 480 + level * 260;
    filter.Q.value = 1.1;
    filter.connect(gain);

    const noise = context.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    noise.playbackRate.value = 0.7;
    noise.connect(filter);
    noise.start(now);
    noise.stop(now + 0.33);
  }

  private build(context: AudioContext): void {
    this.noiseBuffer = createNoiseBuffer(context);

    this.master = context.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(context.destination);

    this.ambienceGain = context.createGain();
    this.ambienceGain.gain.value = this.volumes.ambience;
    this.ambienceGain.connect(this.master);

    this.horseGain = context.createGain();
    this.horseGain.gain.value = this.volumes.horse;
    this.horseGain.connect(this.master);

    // Wind bed.
    this.windGain = context.createGain();
    this.windGain.gain.value = 0.04;
    this.windGain.connect(this.ambienceGain);

    this.windFilter = context.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 380;
    this.windFilter.Q.value = 0.7;
    this.windFilter.connect(this.windGain);

    const wind = context.createBufferSource();
    wind.buffer = this.noiseBuffer;
    wind.loop = true;
    wind.connect(this.windFilter);
    wind.start();

    // Surf bed, audible only near the shore.
    this.surfGain = context.createGain();
    this.surfGain.gain.value = 0;
    this.surfGain.connect(this.ambienceGain);

    const surfFilter = context.createBiquadFilter();
    surfFilter.type = "lowpass";
    surfFilter.frequency.value = 520;
    surfFilter.connect(this.surfGain);

    const surf = context.createBufferSource();
    surf.buffer = this.noiseBuffer;
    surf.loop = true;
    surf.playbackRate.value = 0.45;
    surf.connect(surfFilter);
    surf.start();
  }
}

interface SurfaceProfile {
  readonly frequency: number;
  readonly q: number;
  readonly decay: number;
  readonly level: number;
  readonly thump: number;
}

/**
 * Surface changes the sound, which is how the player hears that the ground
 * under them has changed without having to look down.
 */
const SURFACE_PROFILES: Record<WorldSurface, SurfaceProfile> = {
  grass: { frequency: 900, q: 0.9, decay: 0.1, level: 0.16, thump: 150 },
  sand: { frequency: 620, q: 0.6, decay: 0.13, level: 0.13, thump: 120 },
  rock: { frequency: 2100, q: 2.4, decay: 0.07, level: 0.2, thump: 200 },
  streambed: { frequency: 1500, q: 1.4, decay: 0.16, level: 0.18, thump: 135 },
};

function createNoiseBuffer(context: AudioContext): AudioBuffer {
  const length = context.sampleRate * 2;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);

  // Lightly smoothed white noise. Cheaper than true pink noise and closer to
  // wind and hoof texture than a raw white spectrum.
  let previous = 0;
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    previous = previous * 0.82 + white * 0.18;
    data[index] = previous * 2.6;
  }

  return buffer;
}
