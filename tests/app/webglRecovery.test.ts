import { describe, expect, it, vi } from "vitest";
import {
  WebglRecoveryController,
  type WebglRecoveryDependencies,
} from "../../src/app/webglRecovery";

function fixture(overrides: Partial<WebglRecoveryDependencies> = {}) {
  const target = new EventTarget();
  const dependencies: WebglRecoveryDependencies = {
    pauseSimulation: vi.fn(),
    clearInput: vi.fn(),
    suspendAudio: vi.fn(),
    releasePointer: vi.fn(),
    requestSafeSave: vi.fn(),
    resize: vi.fn(),
    smokeRender: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  };
  return { target, dependencies, controller: new WebglRecoveryController(target, dependencies) };
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe("WebGL recovery state machine", () => {
  it("pauses and snapshots exactly once for duplicate loss", () => {
    const { target, dependencies, controller } = fixture();
    const first = new Event("webglcontextlost", { cancelable: true });
    target.dispatchEvent(first);
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(first.defaultPrevented).toBe(true);
    expect(controller.snapshot()).toEqual({ status: "context-lost", generation: 1 });
    expect(dependencies.pauseSimulation).toHaveBeenCalledTimes(1);
    expect(dependencies.clearInput).toHaveBeenCalledTimes(1);
    expect(dependencies.suspendAudio).toHaveBeenCalledTimes(1);
    expect(dependencies.releasePointer).toHaveBeenCalledTimes(1);
    expect(dependencies.requestSafeSave).toHaveBeenCalledTimes(1);
    expect(controller.consumeEvents()).toEqual([
      { type: "GraphicsContextLost", generation: 1 },
    ]);
  });

  it("restores into a paused gate and requires explicit resume", async () => {
    const { target, dependencies, controller } = fixture();
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    target.dispatchEvent(new Event("webglcontextrestored"));
    expect(controller.snapshot()).toEqual({ status: "restoring", generation: 1 });
    expect(controller.resume()).toBe(false);
    await flush();
    expect(dependencies.resize).toHaveBeenCalledTimes(1);
    expect(dependencies.smokeRender).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toEqual({ status: "restored-paused", generation: 1 });
    expect(controller.resume()).toBe(true);
    expect(controller.snapshot()).toEqual({ status: "ready", generation: 1 });
  });

  it("stays paused with a stable failure code when the smoke render fails", async () => {
    const { target, controller } = fixture({
      smokeRender: vi.fn().mockRejectedValue(new Error("driver reset")),
    });
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    target.dispatchEvent(new Event("webglcontextrestored"));
    await flush();
    expect(controller.snapshot()).toEqual({
      status: "failed",
      generation: 1,
      failureCode: "restore-render-failed",
    });
    expect(controller.resume()).toBe(false);
    expect(controller.consumeEvents()).toContainEqual({
      type: "GraphicsContextRecoveryFailed",
      generation: 1,
      failureCode: "restore-render-failed",
    });
  });

  it("ignores stale restoration success after a second loss", async () => {
    let release: (() => void) | undefined;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { target, controller } = fixture({ smokeRender: () => delayed });
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    target.dispatchEvent(new Event("webglcontextrestored"));
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(controller.snapshot()).toEqual({ status: "context-lost", generation: 2 });
    release?.();
    await flush();
    expect(controller.snapshot()).toEqual({ status: "context-lost", generation: 2 });
  });

  it("detaches listeners and ignores late events after disposal", () => {
    const { target, dependencies, controller } = fixture();
    controller.dispose();
    target.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    expect(controller.snapshot()).toEqual({ status: "ready", generation: 0 });
    expect(dependencies.pauseSimulation).not.toHaveBeenCalled();
  });
});
