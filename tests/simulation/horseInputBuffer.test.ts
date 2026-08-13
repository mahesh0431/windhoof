import { describe, expect, it } from "vitest";
import { HorseInputBuffer } from "../../src/game/input/horseInputBuffer";

describe("HorseInputBuffer", () => {
  it("clamps continuous input and keeps held state between consumes", () => {
    const buffer = new HorseInputBuffer();
    buffer.setMove(4, -3);
    buffer.setCameraYaw(Math.PI / 2);
    buffer.setContinuous("gallopHeld", true);

    expect(buffer.consume()).toMatchObject({
      moveX: 1,
      moveY: -1,
      cameraYaw: Math.PI / 2,
      gallopHeld: true,
    });
    expect(buffer.consume().gallopHeld).toBe(true);
  });

  it("latches edge actions exactly until they are consumed", () => {
    const buffer = new HorseInputBuffer();
    buffer.press("jumpPressed");
    buffer.press("callPressed");

    expect(buffer.peek()).toMatchObject({ jumpPressed: true, callPressed: true });
    expect(buffer.peek()).toMatchObject({ jumpPressed: true, callPressed: true });
    expect(buffer.consume()).toMatchObject({ jumpPressed: true, callPressed: true });
    expect(buffer.consume()).toMatchObject({ jumpPressed: false, callPressed: false });
  });

  it("normalizes non-finite physical input", () => {
    const buffer = new HorseInputBuffer();
    buffer.setMove(Number.NaN, Number.POSITIVE_INFINITY);
    buffer.setCameraYaw(Number.NEGATIVE_INFINITY);

    expect(buffer.consume()).toMatchObject({ moveX: 0, moveY: 0, cameraYaw: 0 });
  });
});

