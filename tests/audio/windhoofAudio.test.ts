import { afterEach, describe, expect, it } from "vitest";
import { WindhoofAudio } from "../../src/audio/windhoofAudio";
import type { AudioFrame } from "../../src/audio/windhoofAudio";

/**
 * Mute is enforced at one point - the context is never constructed - so what
 * these check is that the point holds under everything the game asks of audio.
 *
 * Node has no Web Audio, so `AudioContext` is stubbed. That is not a weakness
 * here: the assertion is precisely that the constructor is never reached, and a
 * stub that counts its own calls proves that better than a real one would.
 */

let constructions = 0;

class CountingAudioContext {
  public state = "suspended";
  public constructor() {
    constructions += 1;
  }
  public resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  public close(): Promise<void> {
    return Promise.resolve();
  }
}

function withStubbedAudioContext(): void {
  constructions = 0;
  (globalThis as { AudioContext?: unknown }).AudioContext = CountingAudioContext;
}

afterEach(() => {
  delete (globalThis as { AudioContext?: unknown }).AudioContext;
});

const frame: AudioFrame = {
  speed: 12,
  gait: "gallop",
  surface: "grass",
  grounded: true,
  shoreDistance: 4,
  deltaSeconds: 1 / 60,
};

describe("muted audio", () => {
  it("never constructs an audio context, however often it is resumed", async () => {
    withStubbedAudioContext();
    const audio = new WindhoofAudio({ muted: true });

    // Every path that reaches audio: startup, the first gesture, pointer lock,
    // resuming from pause, and the settings the pause panel writes.
    await audio.resume();
    await audio.resume();
    audio.setVolumes({ master: 1, ambience: 1, horse: 1 });
    await audio.resume();

    expect(audio.isMuted).toBe(true);
    expect(audio.hasContext).toBe(false);
    expect(audio.isRunning).toBe(false);
    expect(constructions).toBe(0);
  });

  it("stays silent through the sounds a ride actually triggers", async () => {
    withStubbedAudioContext();
    const audio = new WindhoofAudio({ muted: true });
    await audio.resume();

    // None of these may reach for a context, and none may throw for not having
    // one - a muted build has to survive the same call sequence as a loud one.
    expect(() => {
      audio.update(frame);
      audio.hoof(1, true, "grass");
      audio.hoof(0.6, false, "sand");
      audio.land(true);
      audio.whinny();
      audio.dispose();
    }).not.toThrow();

    expect(constructions).toBe(0);
  });

  it("is off by default, so ordinary play still builds its context", async () => {
    withStubbedAudioContext();
    const audio = new WindhoofAudio();

    expect(audio.isMuted).toBe(false);
    await audio.resume();

    // The stub cannot build the graph, so the class marks itself failed and
    // gives up quietly. What matters is that it tried: unmuted behaviour is
    // unchanged.
    expect(constructions).toBe(1);
  });
});
