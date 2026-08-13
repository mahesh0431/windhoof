import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { compileWorld } from "../../src/game/world/compiler/compileWorld";
import type { WorldSpec } from "../../src/game/world/compiler/worldTypes";

/**
 * Player-facing browser checks for the compiled island.
 *
 * These prove that the world the player actually rides is the world the
 * compiler produced — same manifest, same terrain, same regions — and that the
 * presentation layer built on top of it stays inside the milestone's budgets
 * and keeps the interface as restrained as it is in the Horse Lab. Compiler
 * correctness and traversal are covered by the generation suite; what these add
 * is the trip through the real build.
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

async function boot(page: Page): Promise<void> {
  // Automated runs are always muted; see `src/app/runtimeFlags.ts`.
  await page.goto("/?mute=1");
  await page.waitForFunction(() => window.__windhoofLab?.ready === true, null, {
    timeout: 60_000,
  });
  await expect(page.locator("html")).toHaveAttribute("data-windhoof", "running");
}

function expectNoConsoleErrors(page: Page): void {
  expect(consoleErrorsByPage.get(page) ?? []).toEqual([]);
}

test("boots into the compiled island, not the Horse Lab", async ({ page }) => {
  await boot(page);

  await expect(page.locator("html")).toHaveAttribute("data-windhoof-stage", "island");

  const canvasSize = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return { width: canvas?.clientWidth ?? 0, height: canvas?.clientHeight ?? 0 };
  });
  expect(canvasSize.width).toBeGreaterThan(300);
  expect(canvasSize.height).toBeGreaterThan(200);

  await expect(page.locator(".wh-loading")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".wh-pause")).toHaveAttribute("data-visible", "false");
  await expect(page.locator(".wh-diagnostics")).toBeHidden();
  await expect(page.locator(".wh-gait")).toBeVisible();

  expectNoConsoleErrors(page);
});

test("the island the player rides is the island the compiler produced", async ({ page }) => {
  await boot(page);

  const state = await page.evaluate(() => window.__windhoofLab!.state());

  // Same manifest, byte for byte, as the Node compiler produces from the same
  // authored spec. If the browser ever compiled a different world, everything
  // below it — collision, safety, the visible ground — would be a different
  // world too.
  expect(state.manifestHash).toBe(expected.manifestHash);
  expect(state.stage).toBe("island");

  // Sixteen chunks of 64 x 64 cells, two triangles each: the whole compiled
  // terrain is realized, not a visible subset of it.
  expect(state.terrainTriangles).toBe(131_072);
  expect(state.sceneryElements).toBeGreaterThan(60);

  // The horse starts where the compiler put it, in the region the spec names.
  expect(state.position.x).toBeCloseTo(expected.spawn.position.x, 1);
  expect(state.position.z).toBeCloseTo(expected.spawn.position.z, 1);
  expect(state.regionId).toBe("saltwind-coast");
  expect(state.grounded).toBe(true);

  expectNoConsoleErrors(page);
});

test("does not let the player ride until every chunk is active on both sides", async ({
  page,
}) => {
  await boot(page);

  // The harness is installed after the readiness guard, so reaching it at all
  // means the app did not start the frame loop on a partially resident island.
  // What the counters add is that the residency is the one the milestone
  // specifies — sixteen chunks, each held once by physics and once by render —
  // rather than merely non-zero.
  const state = await page.evaluate(() => window.__windhoofLab!.state());
  const chunks = state.chunks!;

  expect(chunks.totalChunks).toBe(expected.chunks.length);
  expect(chunks.activeChunks).toBe(chunks.totalChunks);
  expect(chunks.physicsReadyChunks).toBe(chunks.totalChunks);
  expect(chunks.renderReadyChunks).toBe(chunks.totalChunks);

  // Exactly one retain per consumer per chunk. A scene that retained twice would
  // still activate and still draw, and would then quietly outlive its release.
  expect(chunks.physicsRetains).toBe(chunks.totalChunks);
  expect(chunks.renderRetains).toBe(chunks.totalChunks);
  expect(state.renderRetainCount).toBe(chunks.totalChunks);

  // Preparation is per-chunk work with a frame handed back between jobs, so no
  // single job may grow into the whole island behind the loading panel.
  expect(chunks.longestPreparationMilliseconds).toBeLessThan(400);

  // And the loading presentation is genuinely gone by the time riding starts.
  await expect(page.locator(".wh-loading")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator(".wh-gait")).toBeVisible();

  expectNoConsoleErrors(page);
});

test("realizes the world without any single job stalling the main thread", async ({ page }) => {
  await boot(page);

  const jobs = await page.evaluate(() => window.__windhoofLab!.preparationJobs());
  const state = await page.evaluate(() => window.__windhoofLab!.state());
  const preparation = state.preparation!;

  // Every piece of world realization is a named job, so a stall has an author.
  expect(jobs.length).toBeGreaterThan(20);
  expect(preparation.jobCount).toBe(jobs.length);
  const names = jobs.map((job) => job.name);
  expect(names).toContain("field-samples");
  expect(names).toContain("terrain-family-weights");
  expect(names.filter((name) => name.startsWith("terrain-chunk-"))).toHaveLength(
    state.chunks!.totalChunks,
  );

  // The gate. Fifty milliseconds is the milestone's hard ceiling on a single
  // main-thread preparation job, and this is measured on the same JavaScript the
  // player runs. Software rendering does not enter into it: these jobs build
  // typed arrays and scene-graph objects and never touch the GPU, which is why
  // the budget is asserted here at its real value rather than at a padded one.
  const longest = jobs.reduce((worst, job) => (job.milliseconds > worst.milliseconds ? job : worst));
  expect(
    longest.milliseconds,
    `slowest preparation job: ${longest.name} at ${longest.milliseconds.toFixed(1)} ms`,
  ).toBeLessThan(50);
  expect(preparation.longestMilliseconds).toBeLessThan(50);

  // Splitting the work must not have turned one block into a longer parade of
  // them. The total is the same work, only interruptible.
  expect(preparation.totalMilliseconds).toBeLessThan(1_500);

  expectNoConsoleErrors(page);
});

test("stays silent under ?mute=1, through boot and through riding", async ({ page }) => {
  test.setTimeout(90_000);

  // Counted in the page, before any application code runs, by wrapping the
  // constructors themselves. This is the assertion that holds in every browser:
  // it does not ask the app what it did, it watches whether Web Audio was ever
  // reached for at all.
  await page.addInitScript(() => {
    const created: string[] = [];
    (window as unknown as { __audioContexts: string[] }).__audioContexts = created;
    for (const name of ["AudioContext", "webkitAudioContext"] as const) {
      const original = (window as unknown as Record<string, unknown>)[name];
      if (typeof original !== "function") continue;
      const wrapper = function (this: unknown, ...args: unknown[]) {
        created.push(name);
        return Reflect.construct(original as new (...a: unknown[]) => object, args, wrapper);
      };
      wrapper.prototype = (original as { prototype: object }).prototype;
      (window as unknown as Record<string, unknown>)[name] = wrapper;
    }
  });

  await boot(page);

  const booted = await page.evaluate(() => window.__windhoofLab!.state());
  expect(booted.audioMuted).toBe(true);
  expect(booted.audioContextCreated).toBe(false);
  expect(booted.audioRunning).toBe(false);

  // The gestures that are supposed to start audio: a click on the canvas, which
  // is what requests pointer lock and resumes, then a key press, then a pause
  // and resume through the interface, then a reset.
  await page.locator("canvas").click({ force: true });
  await page.keyboard.press("Space");
  await page.evaluate(() => {
    window.__windhoofLab!.command({ type: "Pause" });
    window.__windhoofLab!.command({ type: "Resume" });
    window.__windhoofLab!.command({ type: "ResetToSafeGround" });
  });

  // And a stretch of real riding, which is what produces hoof falls, breathing,
  // landings and the surf bed - the lazily created sources.
  await page.evaluate(() => {
    window.__windhoofLab!.setMove(0, 1);
    window.__windhoofLab!.setGallop(true);
  });
  await page.waitForFunction(() => window.__windhoofLab!.state().speed > 4, null, {
    timeout: 45_000,
  });
  await page.evaluate(() => {
    window.__windhoofLab!.press("jumpPressed");
    window.__windhoofLab!.press("callPressed");
  });
  await page.waitForTimeout(1500);

  const ridden = await page.evaluate(() => window.__windhoofLab!.state());
  expect(ridden.audioContextCreated).toBe(false);
  expect(ridden.audioRunning).toBe(false);
  expect(
    await page.evaluate(() => (window as unknown as { __audioContexts: string[] }).__audioContexts),
  ).toEqual([]);

  expectNoConsoleErrors(page);
});

test("names the place on arrival, once, and names the next one on the way in", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await boot(page);

  const place = page.locator(".wh-place");
  await expect(place).toHaveAttribute("data-visible", "true");
  await expect(page.locator(".wh-place-name")).toHaveText("Saltwind Coast");

  // It is a moment, not a caption: it goes away on its own and does not come
  // back for a place already named.
  //
  // Measured in real seconds on purpose. Transient chrome used to be timed
  // against the app's `elapsedSeconds`, which accumulates `clamp(delta, 0, 0.1)`
  // per frame so that a slow frame cannot teleport the horse. Under software
  // rendering that clock runs far behind wall time, and this five-second title
  // stayed on screen past fifteen real seconds — on the machine least able to
  // afford the distraction. The player reads captions in real seconds and cannot
  // see the frame rate, so the bound below is wall time, not simulation time.
  const shownAt = Date.now();
  await expect(place).toHaveAttribute("data-visible", "false", { timeout: 15_000 });
  const visibleSeconds = (Date.now() - shownAt) / 1000;
  expect(visibleSeconds).toBeGreaterThan(1.5);
  expect(visibleSeconds).toBeLessThan(9);

  // Ride inland off the storm beach. The safe route the compiler graded runs
  // this way, so the horse can actually get there.
  await page.evaluate(() => {
    window.__windhoofLab!.setCameraYaw(0);
    window.__windhoofLab!.setMove(0, 1);
    window.__windhoofLab!.setGallop(true);
  });

  await page.waitForFunction(
    () => window.__windhoofLab!.state().regionId === "longgrass-opening",
    null,
    { timeout: 60_000 },
  );

  await expect(page.locator(".wh-place-name")).toHaveText("Longgrass Opening");
  await expect(place).toHaveAttribute("data-visible", "true");

  expectNoConsoleErrors(page);
});

test("stays inside the milestone's draw-call and triangle budgets", async ({ page }) => {
  test.setTimeout(90_000);
  await boot(page);

  await page.evaluate(() => {
    window.__windhoofLab!.setCameraYaw(0);
    window.__windhoofLab!.setMove(0, 1);
    window.__windhoofLab!.setGallop(true);
  });
  // Software WebGL plus trace recording can advance the fixed-step simulation
  // much more slowly than wall time. Measure the requested riding state, then
  // inspect its render budget, instead of conflating startup speed with budget.
  await page.waitForFunction(() => window.__windhoofLab!.state().speed > 8, null, {
    timeout: 45_000,
  });

  const state = await page.evaluate(() => window.__windhoofLab!.state());
  expect(state.speed).toBeGreaterThan(8);
  expect(state.drawCalls).toBeLessThan(200);
  expect(state.triangles).toBeLessThan(750_000);

  // Steady state is only half the gate. The peak is decided when the whole
  // island is in frustum at once, which happens whenever the player stops on
  // high ground and looks around — so sweep the camera through a full turn and
  // hold the worst frame of it to the peak budget. A single sample taken while
  // facing inland from the beach proves nothing about that case.
  await page.evaluate(() => {
    window.__windhoofLab!.setMove(0, 0);
    window.__windhoofLab!.setGallop(false);
  });

  let peakDrawCalls = 0;
  let peakTriangles = 0;
  const baseYaw = await page.evaluate(() => window.__windhoofLab!.cameraYaw());
  for (let step = 0; step < 16; step += 1) {
    await page.evaluate((yaw) => window.__windhoofLab!.setCameraYaw(yaw), baseYaw + (step / 16) * Math.PI * 2);
    await page.waitForTimeout(180);
    const swept = await page.evaluate(() => window.__windhoofLab!.state());
    peakDrawCalls = Math.max(peakDrawCalls, swept.drawCalls);
    peakTriangles = Math.max(peakTriangles, swept.triangles);
  }

  expect(peakDrawCalls).toBeGreaterThan(0);
  expect(peakDrawCalls).toBeLessThan(300);
  expect(peakTriangles).toBeLessThan(1_200_000);

  expectNoConsoleErrors(page);
});

test("the sea is a boundary the horse is held at, not a hole it falls through", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await boot(page);

  // Straight out to sea from the storm beach.
  await page.evaluate(() => {
    window.__windhoofLab!.setCameraYaw(Math.PI);
    window.__windhoofLab!.setMove(0, 1);
    window.__windhoofLab!.setGallop(true);
  });

  await page.waitForFunction(() => window.__windhoofLab!.state().speed > 10, null, {
    timeout: 30_000,
  });
  await page.waitForFunction(() => window.__windhoofLab!.state().speed < 1, null, {
    timeout: 45_000,
  });
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => window.__windhoofLab!.state());
  const radius = Math.hypot(state.position.x, state.position.z);

  expect(radius).toBeLessThan(state.boundaryRadius ?? 0);
  expect(state.grounded).toBe(true);
  // The compiled shelf is dry: a stopped horse is standing, not submerged.
  expect(state.position.y).toBeGreaterThan(0);
  expect(state.speed).toBeLessThan(1);

  // And the world can put the player back somewhere sensible from there.
  await page.evaluate(() => {
    window.__windhoofLab!.setMove(0, 0);
    window.__windhoofLab!.setGallop(false);
    window.__windhoofLab!.command({ type: "ResetToSafeGround" });
  });
  await page.waitForTimeout(1200);

  const recovered = await page.evaluate(() => window.__windhoofLab!.state());
  expect(Math.hypot(recovered.position.x, recovered.position.z)).toBeLessThan(radius);
  expect(recovered.grounded).toBe(true);

  expectNoConsoleErrors(page);
});
