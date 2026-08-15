import { NEUTRAL_HORSE_INPUT } from "../game/contracts/input";
import { HorseLabSimulation } from "../game/simulation/horseLabSimulation";
import { RapierHorseMotionResolver } from "../physics/rapierHorseMotionResolver";
import { initializeRapier, RAPIER } from "../physics/rapierRuntime";

export interface BrowserHorseLabHarnessResult {
  readonly tick: number;
  readonly finalZ: number;
  readonly finalY: number;
  readonly finalGait: string;
  readonly jumpEvents: number;
  readonly landingEvents: number;
  readonly hardLandingEvents: number;
  readonly resetEvents: number;
}

declare global {
  interface Window {
    __longrideHorseLabHarness?: BrowserHorseLabHarnessResult;
    __longrideHorseLabHarnessError?: string;
  }
}

async function runBrowserHarness(): Promise<void> {
  await initializeRapier();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(250, 0.5, 250).setTranslation(0, -0.5, 0),
  );
  world.step();

  const resolver = new RapierHorseMotionResolver(world, { x: 0, y: 0, z: 0 });
  const simulation = new HorseLabSimulation(
    { position: { x: 0, y: 0, z: 0 }, yaw: 0 },
    resolver,
  );

  let jumpEvents = 0;
  let landingEvents = 0;
  let hardLandingEvents = 0;
  let resetEvents = 0;

  for (let frame = 0; frame < 600; frame += 1) {
    const result = simulation.advanceFrame(1 / 60, {
      ...NEUTRAL_HORSE_INPUT,
      moveY: 1,
      gallopHeld: true,
      jumpPressed: frame === 240,
    });

    for (const event of result.events) {
      if (event.type === "HorseJumped") jumpEvents += 1;
      if (event.type === "HorseLanded") {
        landingEvents += 1;
        if (event.hard) hardLandingEvents += 1;
      }
      if (event.type === "HorseReset") resetEvents += 1;
    }
  }

  const state = simulation.authoritativeStateForDiagnostics();
  window.__longrideHorseLabHarness = {
    tick: state.tick,
    finalZ: state.position.z,
    finalY: state.position.y,
    finalGait: state.gait,
    jumpEvents,
    landingEvents,
    hardLandingEvents,
    resetEvents,
  };
  document.documentElement.dataset.harnessStatus = "passed";

  resolver.dispose();
  world.free();
}

runBrowserHarness().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  window.__longrideHorseLabHarnessError = message;
  document.documentElement.dataset.harnessStatus = "failed";
});

