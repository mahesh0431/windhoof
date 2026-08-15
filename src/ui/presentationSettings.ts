/**
 * Presentation preferences.
 *
 * These are deliberately NOT game state. The architecture reserves saves for
 * serializable simulation truth owned by the simulation layer, so these live
 * under their own localStorage key and never touch the save adapter. Losing
 * them costs the player nothing but a re-adjustment.
 */
export interface PresentationSettings {
  readonly cameraSensitivity: number;
  readonly invertLookY: boolean;
  readonly fieldOfView: number;
  readonly cameraFollowStrength: number;
  readonly reducedMotion: boolean;
  readonly masterVolume: number;
  readonly ambienceVolume: number;
  readonly horseVolume: number;
  readonly textScale: number;
  readonly showDiagnostics: boolean;
  readonly gaitIndicator: "auto" | "always" | "off";
}

const STORAGE_KEY = "longride.presentation.v1";

export function defaultPresentationSettings(): PresentationSettings {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return {
    cameraSensitivity: 1,
    invertLookY: false,
    fieldOfView: 62,
    cameraFollowStrength: 1,
    // Respect the operating system preference on first run rather than making
    // the player discover the setting after being made uncomfortable.
    reducedMotion: prefersReducedMotion,
    masterVolume: 0.7,
    ambienceVolume: 0.8,
    horseVolume: 0.9,
    textScale: 1,
    showDiagnostics: false,
    gaitIndicator: "auto",
  };
}

const NUMERIC_BOUNDS: Record<string, readonly [number, number]> = {
  cameraSensitivity: [0.25, 2.5],
  fieldOfView: [50, 82],
  cameraFollowStrength: [0.4, 1.8],
  masterVolume: [0, 1],
  ambienceVolume: [0, 1],
  horseVolume: [0, 1],
  textScale: [0.85, 1.5],
};

export function clampSettings(settings: PresentationSettings): PresentationSettings {
  const clamped: Record<string, unknown> = { ...settings };
  for (const [key, [minimum, maximum]] of Object.entries(NUMERIC_BOUNDS)) {
    const value = clamped[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      clamped[key] = defaultPresentationSettings()[key as keyof PresentationSettings];
      continue;
    }
    clamped[key] = Math.min(maximum, Math.max(minimum, value));
  }
  if (!["auto", "always", "off"].includes(String(clamped.gaitIndicator))) {
    clamped.gaitIndicator = "auto";
  }
  return clamped as unknown as PresentationSettings;
}

export function loadPresentationSettings(): PresentationSettings {
  const defaults = defaultPresentationSettings();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PresentationSettings>;
    return clampSettings({ ...defaults, ...parsed });
  } catch {
    return defaults;
  }
}

export function savePresentationSettings(settings: PresentationSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing or a full quota. Preferences stay live for the session.
  }
}

export class PresentationSettingsStore {
  private current: PresentationSettings;
  private readonly listeners = new Set<(settings: PresentationSettings) => void>();

  public constructor(initial: PresentationSettings = loadPresentationSettings()) {
    this.current = clampSettings(initial);
  }

  public get value(): PresentationSettings {
    return this.current;
  }

  public update(patch: Partial<PresentationSettings>): PresentationSettings {
    this.current = clampSettings({ ...this.current, ...patch });
    savePresentationSettings(this.current);
    for (const listener of this.listeners) listener(this.current);
    return this.current;
  }

  public subscribe(listener: (settings: PresentationSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
