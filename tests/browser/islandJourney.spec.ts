import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type { WorldSpec } from "../../src/game/world/compiler/worldTypes";

/**
 * How a Milestone 4 session presents itself before the player has ridden
 * anywhere: what the island says at the start, what it says when it remembers
 * them, and what it says when it cannot.
 *
 * The long ride through the authored arc - call, answer, trace, spring,
 * overlook - is covered by `pnpm journey:walkthrough`, which takes minutes
 * because it actually rides it. These are the checks worth running on every
 * change, so they set up state through the save store the game already reads and
 * never through a back door into the simulation.
 */

const exampleJson = JSON.parse(
  readFileSync(new URL("../../docs/contracts/world-spec.example.json", import.meta.url), "utf8"),
) as Record<string, unknown>;

const expected = compileWorld(exampleJson as unknown as WorldSpec);

const consoleErrorsByPage = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  consoleErrorsByPage.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
});

function expectNoConsoleErrors(page: Page): void {
  expect(consoleErrorsByPage.get(page) ?? []).toEqual([]);
}

/** Writes straight into the store the game reads, so production rules decide. */
async function seedSave(page: Page, save: unknown): Promise<void> {
  await page.evaluate(async (value) => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("longride", 1);
      open.addEventListener("upgradeneeded", () => {
        if (!open.result.objectStoreNames.contains("game-saves")) {
          open.result.createObjectStore("game-saves");
        }
      });
      open.addEventListener("success", () => {
        const transaction = open.result.transaction("game-saves", "readwrite");
        transaction.objectStore("game-saves").put(value, "primary-v1");
        transaction.addEventListener("complete", () => resolve(), { once: true });
        transaction.addEventListener("error", () => reject(transaction.error), { once: true });
      });
      open.addEventListener("error", () => reject(open.error), { once: true });
    });
  }, save);
}

async function boot(page: Page): Promise<void> {
  await page.goto("/?mute=1");
  await page.waitForFunction(() => window.__longrideLab?.ready === true, null, {
    timeout: 90_000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-longride", "running");
}

/** A save the island can use: two mandatory places already known. */
function compatibleSave() {
  return {
    saveVersion: 1,
    worldId: expected.worldId,
    worldSeed: expected.seed,
    generatorVersion: expected.generatorVersion,
    manifestHash: expected.manifestHash,
    lastSafePose: {
      position: { ...expected.spawn.position },
      yaw: expected.spawn.yaw,
    },
    discoveryStates: Object.fromEntries(
      expected.discoveries.map((discovery) => [
        discovery.id,
        discovery.id === "first-herd-trace" || discovery.id === "spring-resting-hollow"
          ? "completed"
          : "hidden",
      ]),
    ),
    playTimeTicks: 9_000,
  };
}

test("a first ride is pointed inland and offered nothing it cannot do", async ({ page }) => {
  await boot(page);

  const state = await page.evaluate(() => window.__longrideLab!.state());
  expect(state.journey?.startKind).toBe("fresh");
  expect(state.journey?.known).toEqual([]);
  expect(state.journey?.completedMandatory).toBe(0);
  expect(state.journey?.totalMandatory).toBe(3);

  // The opening has no discovery to name, so the line has to carry the whole
  // instruction: ride inland, then call. Without it a new player is standing on
  // a beach with no reason to go anywhere.
  const goal = page.locator(".lr-goal");
  await expect(goal).toHaveAttribute("data-visible", "true");
  await expect(page.locator(".lr-goal-text")).toHaveText(/call for the herd/i);

  // Nothing to interact with, so nothing is offered.
  await expect(page.locator(".lr-prompt")).toHaveAttribute("data-visible", "false");
  await expect(page.locator(".lr-discovery")).toHaveAttribute("data-visible", "false");
  await expect(page.locator(".lr-bearing")).toHaveAttribute("data-visible", "false");

  expectNoConsoleErrors(page);
});

test("the journey withdraws from the riding view rather than living on it", async ({ page }) => {
  await boot(page);

  // The opening line is a moment, not a banner. Riding for a while must leave
  // the view clear, which is the whole reason the journey is not a HUD.
  await page.evaluate(() => {
    window.__longrideLab!.setMove(0, 1);
    window.__longrideLab!.setGallop(true);
  });
  await page.waitForFunction(() => window.__longrideLab!.state().speed > 4, null, {
    timeout: 45_000,
  });
  await page.waitForTimeout(9_000);

  await expect(page.locator(".lr-goal")).toHaveAttribute("data-visible", "false");
  await expect(page.locator(".lr-prompt")).toHaveAttribute("data-visible", "false");

  // And it is still available on demand, where looking it up costs nothing.
  await page.evaluate(() => window.__longrideLab!.command({ type: "Pause" }));
  await expect(page.locator(".lr-pause")).toHaveAttribute("data-visible", "true");
  await expect(page.locator(".lr-journey-summary")).toBeVisible();

  expectNoConsoleErrors(page);
});

test("a remembered ride resumes where it was, and says so", async ({ page }) => {
  await boot(page);
  await seedSave(page, compatibleSave());
  await boot(page);

  const state = await page.evaluate(() => window.__longrideLab!.state());
  expect(state.journey?.startKind).toBe("resumed");
  expect(state.journey?.completedMandatory).toBe(2);
  expect(state.journey?.persistenceStatus).toBe("saved");
  // Restored progress must be known progress: a resumed player is not asked to
  // find the spring again.
  expect(state.journey?.known.map((entry) => entry.id).sort()).toEqual([
    "first-herd-trace",
    "spring-resting-hollow",
  ]);

  await expect(page.locator(".lr-notice")).toHaveAttribute("data-visible", "true");
  await expect(page.locator(".lr-notice")).toHaveText(/remembers you/i);

  // Both prerequisites are met, but the overlook has not been noticed yet, so
  // the world genuinely has nowhere to point. It says that rather than naming a
  // place the player has never seen - which would be handing them a discovery
  // instead of letting them find it.
  await expect(page.locator(".lr-goal-text")).toHaveText(/nothing calls to you/i);
  expect(state.journey?.objectiveId).toBeNull();

  expectNoConsoleErrors(page);
});

test("a ride this island cannot use is kept, explained, and only replaced on request", async ({
  page,
}) => {
  await boot(page);
  await seedSave(page, { ...compatibleSave(), manifestHash: "fnv1a64-0000000000000000" });
  await boot(page);

  const state = await page.evaluate(() => window.__longrideLab!.state());
  expect(state.journey?.startKind).toBe("quarantined");
  // An unusable ride must not leak progress into this one.
  expect(state.journey?.known).toEqual([]);
  expect(state.journey?.completedMandatory).toBe(0);
  // And nothing may be written until the player says so, or the stored ride
  // would be destroyed by the act of looking at the island.
  expect(state.journey?.persistenceWritesEnabled).toBe(false);
  expect(state.journey?.persistenceStatus).toBe("incompatible");

  const storage = page.locator(".lr-storage");
  await expect(storage).toHaveAttribute("data-visible", "true");
  await expect(page.locator(".lr-storage-reason")).toHaveText(/this island has changed/i);
  // The world changed under the player; the wording must not read as a fault or
  // as a crash, because it is neither.
  await expect(page.locator(".lr-storage-panel")).not.toHaveText(/error|failed|corrupt/i);
  // Nothing may claim to have been saved before the player has agreed to it.
  await expect(page.locator(".lr-save")).toHaveAttribute("data-visible", "false");

  const accept = page.locator(".lr-storage-actions .lr-button").first();
  await expect(accept).toHaveText(/begin a new ride/i);
  await accept.click();

  await page.waitForFunction(
    () => window.__longrideLab!.state().journey?.persistenceWritesEnabled === true,
    null,
    { timeout: 20_000 },
  );
  await expect(storage).toHaveAttribute("data-visible", "false");
  const accepted = await page.evaluate(() => window.__longrideLab!.state());
  expect(["ready", "saving", "saved"]).toContain(accepted.journey?.persistenceStatus);
  await expect(page.locator(".lr-notice")).toHaveText(/begun again/i);

  expectNoConsoleErrors(page);
});

test("a browser with no stable says so and offers nothing it cannot do", async ({ page }) => {
  // IndexedDB refused outright, which is what private modes and hardened
  // profiles actually do. This is not a state any button can fix.
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get: () => {
        throw new DOMException("denied", "SecurityError");
      },
    });
  });
  await boot(page);

  const state = await page.evaluate(() => window.__longrideLab!.state());
  expect(state.journey?.startKind).toBe("unavailable");
  expect(state.journey?.persistenceWritesEnabled).toBe(false);

  const storage = page.locator(".lr-storage");
  await expect(storage).toHaveAttribute("data-visible", "true");
  await expect(page.locator(".lr-storage-title")).toHaveText(/keeps no stable/i);
  // No acknowledgement is offered, because there is nothing to acknowledge:
  // the only reachable action is to carry on.
  const actions = page.locator(".lr-storage-actions .lr-button:visible");
  await expect(actions).toHaveCount(1);
  await expect(actions).toHaveText(/ride on/i);
  // Hidden rather than merely unstyled, so assistive technology does not offer
  // it either.
  await expect(page.locator('.lr-storage-actions .lr-button[data-variant="primary"]')).toBeHidden();

  // The ride itself is unaffected.
  expect(state.grounded).toBe(true);
  await actions.click();
  await expect(storage).toHaveAttribute("data-visible", "false");

  expectNoConsoleErrors(page);
});

test("nonsense in the save store is survivable", async ({ page }) => {
  await boot(page);
  await seedSave(page, { saveVersion: 1, worldId: 42, notASave: true });
  await boot(page);

  const state = await page.evaluate(() => window.__longrideLab!.state());
  expect(state.journey?.startKind).toBe("quarantined");
  expect(state.journey?.known).toEqual([]);
  expect(state.journey?.persistenceWritesEnabled).toBe(false);
  await expect(page.locator(".lr-storage-reason")).toHaveText(/could not be read/i);
  // Riding still works, which is the part that matters.
  expect(state.grounded).toBe(true);

  expectNoConsoleErrors(page);
});
