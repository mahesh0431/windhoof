import { expect, test, type Page } from "@playwright/test";

/**
 * Player-facing browser checks for the Horse Lab.
 *
 * These exercise the interface and the presentation seam: onboarding restraint,
 * pause behaviour, settings, diagnostics, and the chase camera's behaviour
 * against real world geometry. Simulation correctness is covered separately by
 * the fixed-step harness and the unit suites.
 */

const consoleErrorsByPage = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  consoleErrorsByPage.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  // Each test gets a fresh browser context, so stored preferences start empty
  // without needing to be cleared on every navigation.
});

async function boot(page: Page): Promise<void> {
  // The Horse Lab is no longer the default world. It stays reachable at
  // `?stage=lab` because Milestone 1's blind subjective gate is defined against
  // that fixed plot, and these checks are the automated half of the same
  // evidence: they have to keep testing the plot they were written for.
  // Automated runs are always muted, alongside whatever else the URL carries.
  await page.goto("/?stage=lab&mute=1");
  await page.waitForFunction(() => window.__longrideLab?.ready === true, null, {
    timeout: 45_000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-longride", "running");
}

function expectNoConsoleErrors(page: Page): void {
  expect(consoleErrorsByPage.get(page) ?? []).toEqual([]);
}

test("boots into a rendered riding view with a restrained interface", async ({ page }) => {
  await boot(page);

  // The canvas is real and has been sized to the window.
  const canvasSize = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return { width: canvas?.clientWidth ?? 0, height: canvas?.clientHeight ?? 0 };
  });
  expect(canvasSize.width).toBeGreaterThan(300);
  expect(canvasSize.height).toBeGreaterThan(200);

  // The loading panel gives way to the world.
  await expect(page.locator(".lr-loading")).toHaveCount(0, { timeout: 15_000 });

  // Nothing heavyweight is on screen during ordinary riding: no pause dialog,
  // no diagnostics, and only the low-opacity gait strip.
  await expect(page.locator(".lr-pause")).toHaveAttribute("data-visible", "false");
  await expect(page.locator(".lr-diagnostics")).toBeHidden();
  await expect(page.locator(".lr-gait")).toBeVisible();

  expectNoConsoleErrors(page);
});

test("prompts for pointer focus and teaches movement before anything else", async ({
  page,
}) => {
  await boot(page);

  // Without pointer lock the player is told how to get it.
  await expect(page.locator(".lr-focus")).toHaveAttribute("data-visible", "true", {
    timeout: 10_000,
  });

  // The first thing said is how to move, and only after a beat of silence.
  const hint = page.locator(".lr-hint");
  await expect(hint).toHaveAttribute("data-visible", "true", { timeout: 10_000 });
  await expect(hint).toHaveText(/W A S D/);

  expectNoConsoleErrors(page);
});

test("the focus prompt is keyboard-reachable and stops dimming the view once riding", async ({
  page,
}) => {
  await boot(page);

  const prompt = page.locator(".lr-focus");
  await expect(prompt).toHaveAttribute("data-visible", "true", { timeout: 10_000 });

  // It is a real button, so a keyboard player can reach and activate it.
  expect(await prompt.evaluate((node) => node.tagName)).toBe("BUTTON");
  await expect(prompt).toHaveAttribute("data-compact", "false");
  expect(await prompt.evaluate((node) => (node as HTMLElement).tabIndex)).toBe(0);

  // A keyboard-only player never clicks. Once they are moving, the full-screen
  // scrim must give way rather than dimming their whole session.
  await page.evaluate(() => window.__longrideLab!.setMove(0, 1));
  await page.waitForFunction(() => window.__longrideLab!.state().speed > 1, null, {
    timeout: 10_000,
  });
  await expect(prompt).toHaveAttribute("data-compact", "true");

  const box = await prompt.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box).not.toBeNull();
  // The compact form is a corner pill, not a full-screen surface.
  expect(box!.width).toBeLessThan(viewport.width * 0.5);
  expect(box!.height).toBeLessThan(viewport.height * 0.25);

  expectNoConsoleErrors(page);
});

test("important state changes are announced, not only drawn", async ({ page }) => {
  await boot(page);

  await expect(page.locator(".lr-notice")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator(".lr-notice")).toHaveAttribute("role", "status");
  await expect(page.locator(".lr-hint")).toHaveAttribute("aria-live", "polite");

  // The gait strip repeats something the player already feels; announcing every
  // change would drown out the messages that matter.
  await expect(page.locator(".lr-gait")).toHaveAttribute("aria-hidden", "true");

  expectNoConsoleErrors(page);
});

test("leaving the window pauses instead of riding on unattended", async ({ page }) => {
  await boot(page);

  await page.evaluate(() => {
    window.__longrideLab!.setMove(0, 1);
    window.__longrideLab!.setGallop(true);
  });
  await page.waitForFunction(() => window.__longrideLab!.state().speed > 5, null, {
    timeout: 15_000,
  });

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => window.__longrideLab!.state().mode)).toBe("paused");
  await expect(page.locator(".lr-pause")).toHaveAttribute("data-visible", "true");

  expectNoConsoleErrors(page);
});

test("reaches every gait and keeps the horse on readable ground", async ({ page }) => {
  await boot(page);

  await page.evaluate(() => {
    window.__longrideLab!.setMove(0, 1);
    window.__longrideLab!.setGallop(true);
  });

  // The gait label flips to "gallop" a little above canter speed, so wait for
  // the speed itself rather than for the label.
  await page.waitForFunction(() => window.__longrideLab!.state().speed > 15, null, {
    timeout: 25_000,
  });

  const state = await page.evaluate(() => window.__longrideLab!.state());
  expect(state.gait).toBe("gallop");
  expect(state.grounded).toBe(true);
  expect(Number.isFinite(state.position.y)).toBe(true);

  // The gait strip reports what the simulation reports.
  await expect(page.locator(".lr-gait-name")).toHaveText("gallop");

  expectNoConsoleErrors(page);
});

test("cannot gallop off the edge of the stage", async ({ page }) => {
  test.setTimeout(90_000);
  await boot(page);

  // Ride straight out to sea for as long as it takes to reach the boundary.
  await page.evaluate(() => {
    window.__longrideLab!.setCameraYaw(0);
    window.__longrideLab!.setMove(0, 1);
    window.__longrideLab!.setGallop(true);
  });

  // First prove the horse entered a real gallop, then wait for collision to
  // reduce actual locomotion to rest. The capsule stops the root slightly
  // inside the ring, so a guessed radial threshold is less robust than the
  // player-visible outcome.
  await page.waitForFunction(() => window.__longrideLab!.state().speed > 12, null, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => window.__longrideLab!.state().speed < 1, null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(3000);

  const state = await page.evaluate(() => window.__longrideLab!.state());
  const radius = Math.hypot(state.position.x, state.position.z);

  // Held by the boundary, still standing on ground, not falling forever.
  expect(radius).toBeLessThan(108);
  expect(state.grounded).toBe(true);
  expect(state.position.y).toBeGreaterThan(-4);
  // Collision must also stop locomotion state. A horse animating at full
  // gallop against an invisible wall reads as swimming through the ocean.
  expect(state.speed).toBeLessThan(1);

  // Recovery at the boundary must return to an inland anchor, not save the
  // stopped beach pose and merely display a reassuring toast.
  await page.evaluate(() => {
    window.__longrideLab!.setMove(0, 0);
    window.__longrideLab!.setGallop(false);
    window.__longrideLab!.press("resetPressed");
  });
  await page.waitForTimeout(250);
  const reset = await page.evaluate(() => window.__longrideLab!.state());
  expect(Math.hypot(reset.position.x, reset.position.z)).toBeLessThan(94);
  expect(reset.speed).toBe(0);

  // Reach the boundary once more to verify ordinary steering recovery too.
  await page.evaluate(() => {
    window.__longrideLab!.setCameraYaw(0);
    window.__longrideLab!.setMove(0, 1);
    window.__longrideLab!.setGallop(true);
  });
  await page.waitForFunction(() => window.__longrideLab!.state().speed > 12, null, {
    timeout: 20_000,
  });
  await page.waitForFunction(() => window.__longrideLab!.state().speed < 1, null, {
    timeout: 30_000,
  });
  const secondBoundary = await page.evaluate(() => window.__longrideLab!.state());
  const secondRadius = Math.hypot(secondBoundary.position.x, secondBoundary.position.z);

  // Turning back toward the island must release the boundary without forcing
  // the player to use the recovery command.
  await page.evaluate(() => {
    // A pure lateral input turns along the coast even when mouse-look is not
    // available (keyboard-only and automated play remain recoverable).
    window.__longrideLab!.setMove(1, 0);
    window.__longrideLab!.setGallop(false);
  });
  await page.waitForFunction(() => window.__longrideLab!.state().speed > 2, null, {
    timeout: 8000,
  });
  await page.waitForFunction(
    (startingRadius) => {
      const position = window.__longrideLab!.state().position;
      return Math.hypot(position.x, position.z) < startingRadius - 0.5;
    },
    secondRadius,
    { timeout: 8000 },
  );
  const recovered = await page.evaluate(() => window.__longrideLab!.state());
  expect(Math.hypot(recovered.position.x, recovered.position.z)).toBeLessThan(
    secondRadius - 0.5,
  );

  expectNoConsoleErrors(page);
});

test("the chase camera pulls in for obstruction and recovers afterwards", async ({
  page,
}) => {
  // This one rides the horse the length of the stage and then sweeps the
  // camera all the way around, so it needs real time.
  test.setTimeout(150_000);
  await boot(page);

  const observed = await page.evaluate(async () => {
    const lab = window.__longrideLab!;
    const sleep = (ms: number) =>
      new Promise((resolve) => window.setTimeout(resolve, ms));

    let sawObstruction = false;
    let minimum = Infinity;
    let maximum = 0;
    let jammedAgainstHorse = false;

    const sample = () => {
      const state = lab.state();
      minimum = Math.min(minimum, state.cameraDistance);
      maximum = Math.max(maximum, state.cameraDistance);
      if (state.cameraObstructed) sawObstruction = true;
      // Below the arm's floor would mean the camera is inside the horse.
      if (state.cameraDistance < 1.5) jammedAgainstHorse = true;
      return state;
    };

    // Gallop straight up the corridor: over the ford, onto the plateau, off its
    // steep north face, and out into the shallows. The plateau face and the
    // stage boundary both put geometry behind the horse.
    lab.setCameraYaw(0);
    lab.setMove(0, 1);
    lab.setGallop(true);

    for (let step = 0; step < 170; step += 1) {
      await sleep(100);
      const state = sample();
      if (Math.hypot(state.position.x, state.position.z) > 105) break;
    }

    // Then stand still and look all the way round.
    lab.setMove(0, 0);
    lab.setGallop(false);
    await sleep(1200);

    for (let step = 0; step < 28; step += 1) {
      lab.setCameraYaw((step / 28) * Math.PI * 2);
      await sleep(130);
      sample();
    }

    return { sawObstruction, minimum, maximum, jammedAgainstHorse };
  });

  // Something came between the camera and the horse, and was handled...
  expect(observed.sawObstruction).toBe(true);
  // ...without ever jamming the camera inside the horse...
  expect(observed.jammedAgainstHorse).toBe(false);
  expect(observed.minimum).toBeGreaterThanOrEqual(1.5);
  // ...and the arm returned to a normal length once the line was clear.
  expect(observed.maximum).toBeGreaterThan(5);

  expectNoConsoleErrors(page);
});

test("pause opens a modal surface, releases the mouse, and stops camera input", async ({
  page,
}) => {
  await boot(page);
  await page.waitForTimeout(600);

  await page.keyboard.press("Escape");
  await expect(page.locator(".lr-pause")).toHaveAttribute("data-visible", "true", {
    timeout: 5000,
  });

  const paused = await page.evaluate(() => window.__longrideLab!.state().mode);
  expect(paused).toBe("paused");

  // The mouse is not captured underneath the modal surface.
  expect(await page.evaluate(() => document.pointerLockElement !== null)).toBe(false);

  // Camera input is inert while paused: the yaw the horse steers by must not move.
  const before = await page.evaluate(() => window.__longrideLab!.cameraYaw());
  await page.mouse.move(200, 200);
  await page.mouse.move(900, 500);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => window.__longrideLab!.cameraYaw());
  expect(after).toBeCloseTo(before, 6);

  // No onboarding chatter while paused.
  await expect(page.locator(".lr-hint")).toHaveAttribute("data-visible", "false");

  await page.locator(".lr-button", { hasText: "Resume" }).click();
  await expect(page.locator(".lr-pause")).toHaveAttribute("data-visible", "false");
  expect(await page.evaluate(() => window.__longrideLab!.state().mode)).not.toBe("paused");

  expectNoConsoleErrors(page);
});

test("returning to safe ground from the pause menu is unmistakable", async ({ page }) => {
  await boot(page);

  await page.evaluate(() => {
    window.__longrideLab!.setMove(0, 1);
    window.__longrideLab!.setGallop(true);
  });
  await page.waitForFunction(
    () => window.__longrideLab!.state().position.z > -55,
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    window.__longrideLab!.setMove(0, 0);
    window.__longrideLab!.setGallop(false);
  });

  await page.keyboard.press("Escape");
  await expect(page.locator(".lr-pause")).toHaveAttribute("data-visible", "true");
  await page.locator(".lr-button", { hasText: "Return to safe ground" }).click();

  // The player is told, in words, that the reset happened.
  await expect(page.locator(".lr-notice")).toHaveAttribute("data-visible", "true", {
    timeout: 4000,
  });
  await expect(page.locator(".lr-notice")).toHaveText(/safe ground/i);

  const state = await page.evaluate(() => window.__longrideLab!.state());
  expect(state.speed).toBeLessThan(0.5);
  expect(state.grounded).toBe(true);

  expectNoConsoleErrors(page);
});

test("the pause dialog keeps keyboard focus inside itself", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".lr-pause")).toHaveAttribute("data-visible", "true");

  // Opening the dialog puts focus on the primary action.
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Resume");

  // Tabbing right around the dialog must never land on the page behind it.
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      () => document.querySelector(".lr-panel")?.contains(document.activeElement) ?? false,
    );
    expect(inside, `focus escaped the dialog after ${step + 1} tabs`).toBe(true);
  }

  // And backwards.
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("Shift+Tab");
    const inside = await page.evaluate(
      () => document.querySelector(".lr-panel")?.contains(document.activeElement) ?? false,
    );
    expect(inside).toBe(true);
  }

  expectNoConsoleErrors(page);
});

test("the pause surface keeps its primary action reachable on a short window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 520 });
  await boot(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".lr-pause")).toHaveAttribute("data-visible", "true");

  const resume = page.locator(".lr-button", { hasText: "Resume" });
  await expect(resume).toBeInViewport();

  // The settings list is the part that overflows, and it must be scrollable
  // rather than simply cut off.
  const scrollable = await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>(".lr-panel-scroll");
    if (!node) return null;
    return { scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
  });
  expect(scrollable).not.toBeNull();
  expect(scrollable!.scrollHeight).toBeGreaterThan(scrollable!.clientHeight);

  // The panel itself must not overflow the window.
  const panel = await page.locator(".lr-panel").boundingBox();
  expect(panel!.height).toBeLessThanOrEqual(520);

  expectNoConsoleErrors(page);
});

test("settings change presentation immediately and persist across a reload", async ({
  page,
}) => {
  await boot(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".lr-pause")).toHaveAttribute("data-visible", "true");

  // Reduced motion is a real accessibility control, not decoration.
  await page.locator("#lr-reducedMotion").check();
  await expect(page.locator(".lr-ui")).toHaveAttribute("data-reduced-motion", "true");

  await page.locator("#lr-textScale").fill("1.35");
  await page.locator("#lr-textScale").dispatchEvent("input");
  await expect(page.locator(".lr-ui")).toHaveAttribute("style", /--lr-text-scale: 1.35/);

  await page.locator("#lr-gaitIndicator").selectOption("off");
  await page.locator(".lr-button", { hasText: "Resume" }).click();
  await expect(page.locator(".lr-gait")).toBeHidden();

  const stored = await page.evaluate(() =>
    window.localStorage.getItem("longride.presentation.v1"),
  );
  expect(stored).toContain('"reducedMotion":true');

  await boot(page);
  await expect(page.locator(".lr-ui")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.locator(".lr-gait")).toBeHidden();

  expectNoConsoleErrors(page);
});

test("diagnostics stay out of the way until asked for", async ({ page }) => {
  await boot(page);
  await expect(page.locator(".lr-diagnostics")).toBeHidden();

  await page.keyboard.press("F3");
  await expect(page.locator(".lr-diagnostics")).toBeVisible();
  await expect(page.locator(".lr-diagnostics")).toContainText("draw calls");

  // The overlay reports live values, not placeholders.
  const rows = await page.locator(".lr-diagnostics-row").allTextContents();
  expect(rows.some((row) => /fps\d/.test(row.replace(/\s/g, "")))).toBe(true);

  await page.keyboard.press("F3");
  await expect(page.locator(".lr-diagnostics")).toBeHidden();

  expectNoConsoleErrors(page);
});

test("the controls list is discoverable from the pause surface", async ({ page }) => {
  await boot(page);
  await page.keyboard.press("Escape");
  await page.locator(".lr-tab", { hasText: "Controls" }).click();

  const controls = page.locator(".lr-keys");
  await expect(controls).toBeVisible();
  for (const key of ["W A S D", "Shift", "Space", "Esc", "R", "C"]) {
    await expect(controls).toContainText(key);
  }

  expectNoConsoleErrors(page);
});

test("stays inside the milestone's draw-call and triangle budgets", async ({ page }) => {
  await boot(page);

  await page.evaluate(() => {
    window.__longrideLab!.setMove(0, 1);
    window.__longrideLab!.setGallop(true);
  });
  await page.waitForTimeout(4000);

  const state = await page.evaluate(() => window.__longrideLab!.state());
  expect(state.drawCalls).toBeLessThan(200);
  expect(state.triangles).toBeLessThan(750_000);

  expectNoConsoleErrors(page);
});

/**
 * Embodiment checks.
 *
 * The first blind playtest failed the milestone with the horse reading as a
 * rigid generic avatar. The animator is covered in depth by the unit suite;
 * what these add is that the motion survives the trip through the real build —
 * the rig is wired to the controller, and the terrain answers the hooves.
 */
test("moves as a body at gallop, not as a model on a rail", async ({ page }) => {
  await boot(page);

  await page.evaluate(() => {
    window.__longrideLab!.setCameraYaw(0);
    window.__longrideLab!.setMove(0, 1);
    window.__longrideLab!.setGallop(true);
  });
  await page.waitForFunction(() => window.__longrideLab!.state().speed > 15, null, {
    timeout: 25_000,
  });

  // Sample across several strides. At 16 m/s a stride is roughly 0.43 s.
  const samples: Array<{ height: number; spine: number }> = [];
  for (let frame = 0; frame < 90; frame += 1) {
    samples.push(
      await page.evaluate(() => {
        const state = window.__longrideLab!.state();
        return { height: state.rigBodyHeight, spine: state.rigSpineFlex };
      }),
    );
    await page.waitForTimeout(16);
  }

  const heights = samples.map((sample) => sample.height);
  const spines = samples.map((sample) => sample.spine);
  const travel = Math.max(...heights) - Math.min(...heights);
  const flex = Math.max(...spines) - Math.min(...spines);

  // The horse must visibly leave and meet the ground, and its back must work.
  expect(travel).toBeGreaterThan(0.15);
  expect(flex).toBeGreaterThan(0.1);

  expectNoConsoleErrors(page);
});

test("standing still is still, and the horse settles when it stops", async ({ page }) => {
  await boot(page);
  await page.waitForTimeout(2500);

  const samples: number[] = [];
  for (let frame = 0; frame < 40; frame += 1) {
    samples.push(await page.evaluate(() => window.__longrideLab!.state().rigBodyHeight));
    await page.waitForTimeout(25);
  }

  // Only breathing. A standing horse that bobs like a walking one is the other
  // half of looking wrong.
  expect(Math.max(...samples) - Math.min(...samples)).toBeLessThan(0.05);

  expectNoConsoleErrors(page);
});

test("the ground answers the hooves and the debris clears again", async ({ page }) => {
  await boot(page);

  await page.evaluate(() => {
    window.__longrideLab!.setCameraYaw(0);
    window.__longrideLab!.setMove(0, 1);
    window.__longrideLab!.setGallop(true);
  });

  await page.waitForFunction(() => window.__longrideLab!.state().debrisLive > 0, null, {
    timeout: 25_000,
  });

  // Stop, and the debris must die rather than accumulate for the session.
  await page.evaluate(() => {
    window.__longrideLab!.setMove(0, 0);
    window.__longrideLab!.setGallop(false);
  });
  await page.waitForFunction(() => window.__longrideLab!.state().debrisLive === 0, null, {
    timeout: 15_000,
  });

  expectNoConsoleErrors(page);
});
