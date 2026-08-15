/**
 * Stands on the overlook and photographs what a player would see from it.
 *
 * The overlook is the conclusion of the Milestone 4 arc, and the only one of
 * the authored discoveries whose payoff is a view rather than an object. That
 * makes it the one place where "the state machine says completed" is not
 * evidence of anything: a previous layout put it at 2.8 metres on the north
 * shore, where the discovery text promised the whole island below and the frame
 * showed a beach. The states were all correct.
 *
 * So this rides there and looks around, and reports the numbers that decide
 * whether it is high ground - standing height against the island, whether the
 * camera is fighting anything, which region the world thinks this is.
 *
 * Usage: node tools/inspectOverlook.mjs [baseUrl]
 */
import { chromium } from "@playwright/test";
import { automationUrl } from "./automationUrl.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const OUTPUT_DIR = path.resolve("docs/evidence/milestone-4");
const VIEWPORT = { width: 1600, height: 900 };

const consoleErrors = [];
let server;
let browser;

try {
  const explicitUrl = process.argv.slice(2).find((argument) => argument.startsWith("http"));
  const baseUrl = explicitUrl ?? (await startServer());
  browser = await chromium.launch({
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });
  await mkdir(OUTPUT_DIR, { recursive: true });
  const report = await inspect(baseUrl);
  await writeFile(
    path.join(OUTPUT_DIR, "overlook-inspection.json"),
    `${JSON.stringify({ ...report, consoleErrors }, null, 2)}\n`,
  );
  console.log(`\n${report.verdict.join("\n")}`);
  console.log(`console errors: ${consoleErrors.length}`);
  for (const error of consoleErrors) console.log(`  ! ${error}`);
  if (report.problems.length > 0 || consoleErrors.length > 0) process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
}

async function startServer() {
  server = await createServer({
    logLevel: "warn",
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("no vite address");
  const url = `http://127.0.0.1:${address.port}`;
  console.log(`serving ${url}\n`);
  return url;
}

async function inspect(baseUrl) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await context.addInitScript(() => {
    const created = [];
    window.__audioContexts = created;
    for (const name of ["AudioContext", "webkitAudioContext"]) {
      const original = window[name];
      if (typeof original !== "function") continue;
      const wrapper = function (...args) {
        created.push(name);
        return Reflect.construct(original, args, wrapper);
      };
      wrapper.prototype = original.prototype;
      window[name] = wrapper;
    }
  });

  const lab = {
    state: () => page.evaluate(() => window.__longrideLab.state()),
    scenes: () => page.evaluate(() => window.__longrideLab.scenes()),
    move: (x, y) => page.evaluate(([a, b]) => window.__longrideLab.setMove(a, b), [x, y]),
    gallop: (on) => page.evaluate((v) => window.__longrideLab.setGallop(v), on),
    yaw: (value) => page.evaluate((v) => window.__longrideLab.setCameraYaw(v), value),
    look: (dx, dy) => page.evaluate(([a, b]) => window.__longrideLab.look(a, b), [dx, dy]),
  };
  const wait = (seconds) => page.waitForTimeout(seconds * 1000);

  await page.goto(automationUrl(baseUrl), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__longrideLab?.ready === true, null, { timeout: 120_000 });
  await page.waitForSelector("html[data-longride='running']");
  await page.addStyleTag({ content: ".lr-focus { display: none !important; }" });
  await wait(0.8);

  const scenes = await lab.scenes();
  const overlook = scenes.find((scene) => scene.id === "first-overlook");
  if (!overlook) throw new Error("the compiled world has no first-overlook");

  const spawn = await lab.state();
  const problems = [];

  // --- ride there ---------------------------------------------------------
  const arrival = await rideTo(overlook.position.x, overlook.position.z, 10, 360);
  if (!arrival.arrived) problems.push(`could not ride to the overlook: ${arrival.reason}`);

  // --- what the world says about where we are -----------------------------
  const standing = await lab.state();

  /*
   * There is deliberately no automated "does this look like a summit" metric
   * here.
   *
   * The first version tried to measure it by reading the rendered pixels back
   * with `drawImage` on the WebGL canvas, which returns black unless the
   * context was created with `preserveDrawingBuffer` - so it scored every view
   * as zero percent open and failed a summit that was plainly a summit. A
   * measurement that can fail closed and silently is worse than no measurement,
   * because it invites you to trust it.
   *
   * The high-ground claim rests on two things that do not lie: the compiled
   * terrain, where the overlook's height can be compared against the island's
   * own distribution, and the two frames below, which a person looks at.
   */

  // --- the frames a player would actually get -----------------------------
  // Facing back down the island, over the ground the ride came through, which
  // is what the discovery text claims to be showing.
  await lab.yaw(Math.atan2(spawn.position.x - standing.position.x, spawn.position.z - standing.position.z));
  await wait(1.2);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "overlook-view-inland.png") });

  await lab.yaw(Math.atan2(-standing.position.x, -standing.position.z) + Math.PI);
  await wait(1.2);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "overlook-view-seaward.png") });

  const audioContexts = await page.evaluate(() => window.__audioContexts ?? []);
  if (audioContexts.length > 0 || standing.audioContextCreated || standing.audioRunning) {
    problems.push("the muted build reached for audio");
  }
  if (standing.regionId !== "fernwood-edge") {
    problems.push(`the overlook reports region ${standing.regionId}, expected fernwood-edge`);
  }
  if (!standing.grounded) problems.push("the horse is not grounded on the overlook");
  if (standing.cameraObstructed) problems.push("the chase camera is obstructed at the overlook");

  await context.close();

  const verdict = [
    `overlook (${overlook.position.x.toFixed(1)}, ${overlook.position.y.toFixed(1)}, ${overlook.position.z.toFixed(1)})`,
    `standing y=${standing.position.y.toFixed(1)} region=${standing.regionId} grounded=${standing.grounded} cameraObstructed=${standing.cameraObstructed}`,
    `audio contexts: ${audioContexts.length}`,
    problems.length === 0
      ? "VERDICT: grounding, region, camera and audio are clean; judge the view from the two frames"
      : `VERDICT: FAILED\n  ${problems.join("\n  ")}`,
  ];

  return {
    manifestHash: standing.manifestHash,
    overlook,
    standing: {
      position: standing.position,
      regionId: standing.regionId,
      grounded: standing.grounded,
      cameraDistance: standing.cameraDistance,
      cameraObstructed: standing.cameraObstructed,
    },
    audio: {
      muted: standing.audioMuted,
      contextsConstructed: audioContexts.length,
      contextCreated: standing.audioContextCreated,
      running: standing.audioRunning,
    },
    screenshots: ["overlook-view-inland.png", "overlook-view-seaward.png"],
    problems,
    verdict,
  };

  async function rideTo(targetX, targetZ, within, timeoutSeconds) {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let closest = Infinity;
    let lastProgressAt = Date.now();
    let recoveries = 0;
    await lab.move(0, 1);
    while (Date.now() < deadline) {
      const state = await lab.state();
      const dx = targetX - state.position.x;
      const dz = targetZ - state.position.z;
      const remaining = Math.hypot(dx, dz);
      if (remaining <= within) {
        await halt();
        return { arrived: true, remaining };
      }
      if (remaining < closest - 0.75) {
        closest = remaining;
        lastProgressAt = Date.now();
      } else if (Date.now() - lastProgressAt > 6000) {
        recoveries += 1;
        if (recoveries > 3) {
          await halt();
          return { arrived: false, remaining, reason: "no-progress" };
        }
        await lab.gallop(false);
        await lab.yaw(Math.atan2(-dx, -dz));
        await wait(0.9);
        await lab.yaw(Math.atan2(dx, dz) + (recoveries % 2 === 0 ? -1 : 1) * (Math.PI / 2));
        await wait(1.2);
        lastProgressAt = Date.now();
        continue;
      }
      await lab.gallop(remaining > 45);
      await lab.move(0, remaining > 20 ? 1 : 0.45);
      await lab.yaw(Math.atan2(dx, dz));
      await wait(0.1);
    }
    await halt();
    return { arrived: false, remaining: closest, reason: "timeout" };
  }

  async function halt() {
    await lab.gallop(false);
    await lab.move(0, 0);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const state = await lab.state();
      if (state.speed <= 0.2 && state.grounded) break;
      await wait(0.25);
    }
    await wait(1.2);
  }
}
