import RAPIER from "@dimforge/rapier3d-compat";

let initialization: Promise<void> | null = null;

export function initializeRapier(): Promise<void> {
  initialization ??= RAPIER.init();
  return initialization;
}

export { RAPIER };

