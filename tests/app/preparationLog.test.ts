import { describe, expect, it } from "vitest";
import { createPreparationLog } from "../../src/app/preparationLog";

/**
 * The store behind the main-thread stall gate.
 *
 * What matters is that it is fixed-size and that being fixed-size cannot lose
 * the one number the gate is read for.
 */

function busyFor(milliseconds: number): void {
  const until = performance.now() + milliseconds;
  while (performance.now() < until) {
    // Deliberate spin: the log measures wall time, so the work has to take it.
  }
}

describe("preparation log", () => {
  it("returns each job's own result and records it by name", () => {
    const log = createPreparationLog();
    const value = log.run("field-samples", () => 41 + 1);

    expect(value).toBe(42);
    expect(log.jobs()).toHaveLength(1);
    expect(log.jobs()[0]?.name).toBe("field-samples");
    expect(log.snapshot().jobCount).toBe(1);
  });

  it("names the longest job and measures roughly how long it took", () => {
    const log = createPreparationLog();
    log.run("quick", () => busyFor(1));
    log.run("slow", () => busyFor(25));
    log.run("quick-again", () => busyFor(1));

    const snapshot = log.snapshot();
    expect(snapshot.longestName).toBe("slow");
    expect(snapshot.longestMilliseconds).toBeGreaterThanOrEqual(20);
    expect(snapshot.totalMilliseconds).toBeGreaterThanOrEqual(snapshot.longestMilliseconds);
  });

  it("keeps a fixed window but never forgets the maximum", () => {
    const log = createPreparationLog(4);
    log.run("the-expensive-one", () => busyFor(20));
    for (let index = 0; index < 8; index += 1) log.run(`filler-${index}`, () => undefined);

    // The expensive job has long since been overwritten in the window...
    const held = log.jobs();
    expect(held).toHaveLength(4);
    expect(held.map((job) => job.name)).not.toContain("the-expensive-one");
    expect(held[0]?.name).toBe("filler-4");

    // ...and is still the answer the gate is checked against.
    const snapshot = log.snapshot();
    expect(snapshot.jobCount).toBe(9);
    expect(snapshot.longestName).toBe("the-expensive-one");
    expect(snapshot.longestMilliseconds).toBeGreaterThanOrEqual(15);
  });

  it("still records a job that threw, because a slow failure is still a stall", () => {
    const log = createPreparationLog();
    expect(() =>
      log.run("doomed", () => {
        busyFor(5);
        throw new Error("no topology");
      }),
    ).toThrow(/no topology/);

    expect(log.snapshot().jobCount).toBe(1);
    expect(log.snapshot().longestName).toBe("doomed");
  });
});
