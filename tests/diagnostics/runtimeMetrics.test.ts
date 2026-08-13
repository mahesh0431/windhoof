import { describe, expect, it } from "vitest";
import { RuntimeMetrics } from "../../src/diagnostics/runtimeMetrics";

describe("runtime metrics", () => {
  it("keeps bounded samples and reports p95 without retaining frame history forever", () => {
    const metrics = new RuntimeMetrics(20);
    for (let value = 1; value <= 100; value += 1) {
      metrics.sampleFrame(value);
      metrics.samplePhysics(value / 10);
    }
    const result = metrics.snapshot(123_456);
    expect(result.frameP95Milliseconds).toBe(99);
    expect(result.physicsP95Milliseconds).toBeCloseTo(9.9);
    expect(result.frameSamples).toBe(20);
    expect(result.physicsSamples).toBe(20);
    expect(result.browserHeapBytes).toBe(123_456);
  });

  it("ignores invalid samples", () => {
    const metrics = new RuntimeMetrics();
    metrics.sampleFrame(Number.NaN);
    metrics.samplePhysics(-1);
    expect(metrics.snapshot()).toMatchObject({
      frameP95Milliseconds: 0,
      physicsP95Milliseconds: 0,
      frameSamples: 0,
      physicsSamples: 0,
    });
  });
});
