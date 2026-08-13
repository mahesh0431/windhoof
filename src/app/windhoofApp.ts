import { startHorseLab } from "./horseLabApp";
import { startIsland } from "./islandApp";

export interface WindhoofApp {
  dispose(): void;
}

export type WindhoofStage = "island" | "lab";

/**
 * Which world to boot.
 *
 * The island is the game. The Horse Lab is the fixed, unchanging test plot the
 * horse's movement was proven on, and it stays reachable at `?stage=lab` for
 * exactly that reason: Milestone 1's blind subjective gate is defined against
 * that plot, and moving it onto new terrain would quietly invalidate the
 * comparison the gate exists to make.
 */
export function resolveStage(search: string): WindhoofStage {
  const stage = new URLSearchParams(search).get("stage");
  return stage === "lab" || stage === "horse-lab" ? "lab" : "island";
}

export async function startWindhoof(
  canvas: HTMLCanvasElement,
  uiHost: HTMLElement,
): Promise<WindhoofApp> {
  const stage = resolveStage(typeof location === "undefined" ? "" : location.search);
  document.documentElement.dataset.windhoofStage = stage;
  return stage === "lab" ? startHorseLab(canvas, uiHost) : startIsland(canvas, uiHost);
}
