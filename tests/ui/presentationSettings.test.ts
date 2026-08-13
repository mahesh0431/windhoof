import { describe, expect, it } from "vitest";
import {
  clampSettings,
  defaultPresentationSettings,
  PresentationSettingsStore,
} from "../../src/ui/presentationSettings";

describe("presentation settings", () => {
  it("provides usable defaults without a browser", () => {
    const defaults = defaultPresentationSettings();
    expect(defaults.fieldOfView).toBeGreaterThan(50);
    expect(defaults.gaitIndicator).toBe("auto");
    expect(defaults.showDiagnostics).toBe(false);
  });

  it("clamps values that would break the camera", () => {
    const clamped = clampSettings({
      ...defaultPresentationSettings(),
      cameraSensitivity: 900,
      fieldOfView: -20,
      cameraFollowStrength: 0,
    });

    expect(clamped.cameraSensitivity).toBeLessThanOrEqual(2.5);
    expect(clamped.fieldOfView).toBeGreaterThanOrEqual(50);
    expect(clamped.cameraFollowStrength).toBeGreaterThanOrEqual(0.4);
  });

  it("repairs corrupted stored values instead of propagating NaN", () => {
    const clamped = clampSettings({
      ...defaultPresentationSettings(),
      textScale: Number.NaN,
      masterVolume: "loud" as unknown as number,
      gaitIndicator: "sideways" as never,
    });

    expect(Number.isFinite(clamped.textScale)).toBe(true);
    expect(Number.isFinite(clamped.masterVolume)).toBe(true);
    expect(clamped.gaitIndicator).toBe("auto");
  });

  it("notifies subscribers when a preference changes", () => {
    const store = new PresentationSettingsStore();
    const seen: number[] = [];
    const unsubscribe = store.subscribe((value) => seen.push(value.fieldOfView));

    store.update({ fieldOfView: 74 });
    expect(store.value.fieldOfView).toBe(74);
    expect(seen).toEqual([74]);

    unsubscribe();
    store.update({ fieldOfView: 60 });
    expect(seen).toEqual([74]);
  });

  it("survives a storage backend that is unavailable", () => {
    // Node has no localStorage, which is the same shape of failure as a browser
    // in private mode with storage blocked.
    expect(() => new PresentationSettingsStore().update({ textScale: 1.2 })).not.toThrow();
  });
});
