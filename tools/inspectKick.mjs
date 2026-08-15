/**
 * End-to-end check that a wild horse defends its space.
 *
 * The unit tests prove the state machine and the shove in isolation; they say
 * nothing about whether the two are wired together in the running game, whether
 * a horse ever wakes up, or whether the player can even get close enough to be
 * kicked now that the herd has colliders. This rides the real build to a real
 * horse, crowds it, and records what actually happens.
 *
 * It steers by reading the herd back out of the harness rather than by driving
 * to a coordinate copied into this file: horse placement comes from the world
 * seed, and a copied coordinate goes stale silently the moment anything about
 * the island changes.
 *
 * Usage: pnpm inspect:kick [baseUrl]
 */
import { chromium } from "@playwright/test";
import { automationUrl } from "./automationUrl.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const OUTPUT_DIR = path.resolve("docs/evidence/horse");
const VIEWPORT = { width: 1280, height: 720 };
const BOOT_BUDGET_MS = 300_000;
/** Long enough to cross a few hundred metres of island at a gallop. */
const RIDE_BUDGET_MS = 420_000;

const consoleErrors = [];
let server;
let browser;

try {
  const baseUrl = process.argv[2] ?? (await startServer());
  browser = await chromium.launch({
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  await mkdir(OUTPUT_DIR, { recursive: true });

  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  /**
   * Waits for a running island, however many times the page reloads first.
   *
   * Vite discovers and optimises dependencies on a cold start and then forces a
   * full reload, which destroys the execution context out from under whatever
   * was mid-evaluate. Every call into the page has to survive that.
   */
  async function waitForIsland() {
    await page.waitForFunction(() => window.__longrideLab?.ready === true, null, {
      timeout: BOOT_BUDGET_MS,
    });
    await page.waitForSelector("html[data-longride='running']");
  }

  /** Reads harness state, riding out a reload rather than dying on one. */
  async function readState() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await page.evaluate(() =>
          window.__longrideLab ? window.__longrideLab.state() : null,
        );
      } catch {
        console.log("  page reloaded; waiting for the island again");
        await waitForIsland();
      }
    }
    return null;
  }

  /** Sets the reins, ignoring a reload that lands between frames. */
  async function drive(steer, throttle, gallop) {
    try {
      await page.evaluate(
        ([x, y, g]) => {
          window.__longrideLab?.setMove(x, y);
          window.__longrideLab?.setGallop(g);
        },
        [steer, throttle, gallop],
      );
    } catch {
      await waitForIsland();
    }
  }

  console.log("booting the island...");
  await page.goto(automationUrl(baseUrl), { waitUntil: "domcontentloaded" });
  await waitForIsland();
  // Let the optimiser's reload, if there is going to be one, happen here rather
  // than three minutes into a ride.
  await page.waitForTimeout(2500);
  await waitForIsland();

  const start = await readState();
  const herd = start.wildHorseReports ?? [];
  if (herd.length === 0) throw new Error("the island reported no wild horses");

  // Nearest horse to where the ride begins.
  const target = herd
    .map((horse) => ({
      ...horse,
      distance: Math.hypot(horse.x - start.position.x, horse.z - start.position.z),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  console.log(
    `herd of ${herd.length}; riding to the nearest at ` +
      `(${target.x.toFixed(0)}, ${target.z.toFixed(0)}), ` +
      `${target.distance.toFixed(0)}m away, ${target.grazing ? "grazing" : "standing"}`,
  );

  const observed = {
    moods: [],
    byHorse: {},
    shoved: false,
    liveSeen: false,
    maxDraws: 0,
  };
  let approachShot = false;

  const rideStartedAt = Date.now();
  let previousPosition = { ...start.position };
  let stalled = 0;
  let iteration = 0;

  while (Date.now() - rideStartedAt < RIDE_BUDGET_MS) {
    const state = await readState();
    if (!state) {
      console.log("  the harness never came back");
      break;
    }
    const dx = target.x - state.position.x;
    const dz = target.z - state.position.z;
    const distance = Math.hypot(dx, dz);
    iteration += 1;
    if (iteration % 25 === 0) {
      console.log(
        `  ${((Date.now() - rideStartedAt) / 1000).toFixed(0)}s  ` +
          `at (${state.position.x.toFixed(0)}, ${state.position.z.toFixed(0)})  ` +
          `${distance.toFixed(1)}m to go  speed=${state.speed.toFixed(1)}  ` +
          `gait=${state.gait}  fps=${(state.fps ?? 0).toFixed(1)}`,
      );
    }

    observed.maxDraws = Math.max(observed.maxDraws, state.drawCalls);
    // Moods are tracked per horse. Pooling them into one list interleaves two
    // animals in different states and reads as a single horse flapping between
    // them, which is a reporting artefact and not what the herd is doing.
    const live = (state.wildHorseReports ?? []).filter((horse) => horse.live);
    if (live.length > 0) observed.liveSeen = true;
    for (const horse of live) {
      const key = `${horse.x.toFixed(1)},${horse.z.toFixed(1)}`;
      if (!observed.byHorse[key]) observed.byHorse[key] = [];
      const trail = observed.byHorse[key];
      if (horse.mood && trail[trail.length - 1] !== horse.mood) {
        trail.push(horse.mood);
        if (!observed.moods.includes(horse.mood)) observed.moods.push(horse.mood);
        console.log(
          `  horse ${key}: ${horse.mood}  (rider ${distance.toFixed(1)}m from target)`,
        );
      }
    }
    if (state.condition === "stumbling" && distance < 8) observed.shoved = true;

    if (!approachShot && distance < 9) {
      approachShot = true;
      await page.screenshot({ path: path.join(OUTPUT_DIR, "kick-approach.png") });
    }

    // Reins steering: turn towards the bearing, then drive forward. Heading is
    // (sin yaw, cos yaw) and positive steer turns right, hence the sign.
    const wanted = Math.atan2(dx, dz);
    const error = Math.atan2(Math.sin(wanted - state.yaw), Math.cos(wanted - state.yaw));
    const steer = Math.max(-1, Math.min(1, -error * 1.6));
    // Close in, walk. A gallop into a horse just bounces off its collider.
    const throttle = distance > 30 ? 1 : distance > 6 ? 0.5 : 0.32;

    await drive(steer, throttle, distance > 40);

    // Once it is crowding the horse, hold still and let the horse decide.
    if (distance < 3.2) {
      await drive(0, 0.12, false);
      await page.waitForTimeout(700);
      const after = (await readState()) ?? state;
      if (after.condition === "stumbling") {
        observed.shoved = true;
        await page.screenshot({ path: path.join(OUTPUT_DIR, "kick-landed.png") });
        break;
      }
      if (observed.moods.includes("kicking") && !approachShot) {
        await page.screenshot({ path: path.join(OUTPUT_DIR, "kick-landed.png") });
      }
    }

    const moved = Math.hypot(
      state.position.x - previousPosition.x,
      state.position.z - previousPosition.z,
    );
    previousPosition = { ...state.position };
    stalled = moved < 0.05 && distance > 3.2 ? stalled + 1 : 0;
    if (stalled > 40) {
      console.log("  stuck on the way in; stopping");
      break;
    }
    await page.waitForTimeout(120);
  }

  await drive(0, 0, false);

  console.log("");
  console.log(`live rig promoted:   ${observed.liveSeen}`);
  console.log(`moods seen at all:    ${observed.moods.join(", ") || "(none)"}`);
  for (const [key, trail] of Object.entries(observed.byHorse)) {
    console.log(`  horse ${key}: ${trail.slice(0, 12).join(" -> ")}`);
  }
  console.log(`player was shoved:   ${observed.shoved}`);
  console.log(`peak draw calls:     ${observed.maxDraws}`);
  console.log(`console errors:      ${consoleErrors.length}`);
  for (const error of consoleErrors) console.log(`  ! ${error}`);

  await writeFile(
    path.join(OUTPUT_DIR, "kick-run.json"),
    `${JSON.stringify({ target, ...observed, consoleErrors }, null, 2)}\n`,
  );

  if (consoleErrors.length > 0) process.exitCode = 1;
  if (!observed.liveSeen) process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
}

/** Boots Vite in-process on an ephemeral port and returns its URL. */
async function startServer() {
  server = await createServer({
    logLevel: "warn",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") {
    throw new Error("Vite did not report a usable address");
  }
  return `http://127.0.0.1:${address.port}`;
}
