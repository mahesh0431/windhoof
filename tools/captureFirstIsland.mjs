/**
 * Photographs every region and every herd-trace scene on the first island,
 * without riding to any of them.
 *
 * The island is 1,024 metres across and, under SwiftShader, the horse covers
 * roughly two metres per second of wall clock. Riding to five regions and nine
 * scenes is therefore an hour of automation on a good day, and on a bad one it
 * is the run that sat silently for seven minutes and had to be killed. So this
 * tool does not ride. It holds the camera at each place in turn through the
 * harness's `observe` seam and takes the picture.
 *
 * What that buys and what it costs, stated plainly:
 *
 * - It **is** evidence that a place exists in the current build and looks the
 *   way it is claimed to look. The scene graph, terrain, materials, cover and
 *   cues are all the real ones, drawn by the real renderer.
 * - It is **not** evidence that a player can get there, that the route reads,
 *   or that the journey paces. Nothing here may be cited for any of that.
 *   `journeyWalkthrough.mjs` is what rides.
 *
 * Bounding is the other half of the point. There is a hard budget for the whole
 * run and a hard budget for every single capture, every stage announces itself
 * before it starts, and anything unfinished is named in the report rather than
 * quietly omitted. A capture that hangs costs one timeout, not the run.
 *
 * Usage:
 *   node tools/captureFirstIsland.mjs [--only=regions|scenes|graphics] [baseUrl]
 */
import { chromium } from "@playwright/test";
import { automationUrl } from "./automationUrl.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const OUTPUT_DIR = path.resolve("docs/evidence/milestone-5");
const VIEWPORT = { width: 1600, height: 900 };

/** Hard wall clock for everything, browser launch included. */
const RUN_BUDGET_MS = Number(process.env.LONGRIDE_CAPTURE_BUDGET_MS ?? 420_000);
/**
 * Hard ceiling for one capture.
 *
 * The unit that can hang is a single `page.screenshot` or `evaluate` against a
 * renderer that has stopped answering, so that is the unit that gets a timeout.
 * A run-wide budget alone cannot tell a slow island from a dead one.
 */
const CAPTURE_BUDGET_MS = Number(process.env.LONGRIDE_CAPTURE_STEP_MS ?? 25_000);

/** Ground above this is land the horse could stand on rather than sea bed. */
const SHORE_METRES = 4;

const runDeadline = Date.now() + RUN_BUDGET_MS;
const outOfTime = () => Date.now() > runDeadline;
const remainingSeconds = () => Math.max(0, Math.round((runDeadline - Date.now()) / 1000));

const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").replace("--only=", "");
const wants = (stage) => ONLY.length === 0 || ONLY === stage;

const consoleErrors = [];
const findings = [];
const skipped = [];
const captures = [];
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
  const report = await capture(baseUrl);
  await writeFile(
    path.join(OUTPUT_DIR, "island-capture.json"),
    `${JSON.stringify({ ...report, captures, skipped, findings, consoleErrors }, null, 2)}\n`,
  );
  console.log("");
  for (const line of report.summary) console.log(line);
  console.log(`captured ${captures.length}, skipped ${skipped.length}`);
  console.log(`console errors: ${consoleErrors.length}`);
  for (const error of consoleErrors) console.log(`  ! ${error}`);
  for (const finding of findings) console.log(`  ! ${finding}`);
  if (findings.length > 0 || consoleErrors.length > 0) process.exitCode = 1;
} finally {
  // Both closes are attempted regardless of how the run ended, so a thrown
  // capture cannot leave a Chromium and a Vite server behind.
  await browser?.close().catch(() => undefined);
  await server?.close().catch(() => undefined);
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

/** Fails a single step loudly instead of letting it consume the whole budget. */
function withTimeout(promise, milliseconds, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${milliseconds}ms: ${what}`)),
        milliseconds,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function capture(baseUrl) {
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
    window.__unhandled = [];
    window.addEventListener("unhandledrejection", (event) => {
      window.__unhandled.push(String(event.reason));
    });
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
    regions: () => page.evaluate(() => window.__longrideLab.regions?.() ?? []),
    scenes: () => page.evaluate(() => window.__longrideLab.scenes?.() ?? []),
    jobs: () => page.evaluate(() => window.__longrideLab.preparationJobs()),
    heightAt: (x, z) =>
      page.evaluate(([a, b]) => window.__longrideLab.heightAt?.(a, b) ?? 0, [x, z]),
    observe: (from, lookAt) =>
      page.evaluate(([a, b]) => window.__longrideLab.observe?.(a, b), [from, lookAt]),
    release: () => page.evaluate(() => window.__longrideLab.release?.()),
    graphics: () =>
      page.evaluate(() => window.__longrideLab.graphics?.() ?? { status: "unknown" }),
    loseContext: () => page.evaluate(() => window.__longrideLab.loseGraphicsContext?.() ?? false),
    restoreContext: () =>
      page.evaluate(() => window.__longrideLab.restoreGraphicsContext?.() ?? false),
    resumeGraphics: () => page.evaluate(() => window.__longrideLab.resumeGraphics?.() ?? false),
  };
  const wait = (seconds) => page.waitForTimeout(seconds * 1000);

  stage("boot");
  const bootStarted = Date.now();
  await page.goto(automationUrl(baseUrl), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__longrideLab?.ready === true, null, {
    timeout: 240_000,
  });
  await page.waitForSelector("html[data-longride='running']");
  const bootMilliseconds = Date.now() - bootStarted;
  await page.addStyleTag({ content: ".lr-focus { display: none !important; }" });
  await wait(1);

  const boot = await lab.state();
  const jobs = [...(await lab.jobs())].sort((a, b) => b.milliseconds - a.milliseconds);
  const worst = jobs.slice(0, 10).map((job) => `${job.name} ${job.milliseconds.toFixed(1)}ms`);
  for (const job of jobs) {
    if (job.milliseconds > 50) {
      findings.push(
        `preparation job over the 50ms budget: ${job.name} ${job.milliseconds.toFixed(1)}ms`,
      );
    }
  }
  if (boot.chunks && boot.chunks.activeChunks !== boot.chunks.totalChunks) {
    findings.push(`only ${boot.chunks.activeChunks}/${boot.chunks.totalChunks} chunks active`);
  }
  console.log(
    `boot ${(bootMilliseconds / 1000).toFixed(1)}s  chunks ${boot.chunks?.activeChunks}/${boot.chunks?.totalChunks}  ${remainingSeconds()}s budget left`,
  );

  // Asked inside the page. A function cannot cross the `evaluate` boundary, so
  // returning it and testing the result out here always says "missing".
  if (!(await page.evaluate(() => typeof window.__longrideLab.observe === "function"))) {
    findings.push("the harness has no observe seam; nothing can be captured directly");
  }

  // --- the five regions ---------------------------------------------------
  // Seen from a rider's distance and a rider's height rather than from above.
  // A map view would prove the regions differ and prove nothing about whether
  // that difference is visible from the saddle, which is the only place the
  // player ever sees it from.
  const regions = await lab.regions();
  if (regions.length === 0) findings.push("the harness exposed no regions");
  if (wants("regions")) {
    stage(`regions (${regions.length})`);
    for (const [index, region] of regions.entries()) {
      const label = `region-${String(index + 1).padStart(2, "0")}-${region.id}`;
      // Two bearings, a third of a turn apart. A place that only reads from one
      // angle is a backdrop, not a place.
      for (const [suffix, bearing] of [["a", 0.7], ["b", 2.8]]) {
        await capturePoint(`${label}-${suffix}`, region.anchor.x, region.anchor.z, {
          bearing,
          distance: 85,
          eye: 14,
          aim: 6,
          subject: region.id,
          kind: "region",
        });
      }
    }
  }

  // --- every authored scene ------------------------------------------------
  // Driven from the compiled manifest rather than a copied list, so a scene the
  // compiler moves is photographed where it now is instead of where it was.
  const scenes = await lab.scenes();
  if (scenes.length === 0) findings.push("the harness exposed no scenes");
  if (wants("scenes")) {
    stage(`scenes (${scenes.length})`);
    for (const scene of scenes) {
      const label = `scene-${scene.id}`;
      // Two bearings, for the same reason the regions get two and for one more:
      // a single fixed bearing can put a hillside or a landmark between the
      // camera and the thing being photographed, and the first pass did exactly
      // that to the living herd. Two opposed views is the cheapest guarantee
      // that at least one of them sees the scene.
      //
      // The eye is well above a rider's - close enough to read the ground
      // detail, high enough to clear the intervening ground rather than be
      // buried in it, which the first pass also did.
      for (const [suffix, bearing] of [["a", 1.3], ["b", 3.4], ["c", 5.5]]) {
        await capturePoint(`${label}-${suffix}`, scene.position.x, scene.position.z, {
          bearing,
          // Close and near level, aimed at the height of a standing horse.
          // The previous 34 m at 13 m up looked steeply down and put the
          // subject in the far distance behind whatever the slope raised
          // between them.
          distance: 26,
          eye: 6,
          aim: 1.8,
          subject: scene.id,
          kind: scene.kind,
        });
      }
    }
  }

  await lab.release();

  // --- WebGL lifecycle -----------------------------------------------------
  // Driven through the browser's own `WEBGL_lose_context`, so what is exercised
  // is the path a driver reset takes rather than a simulation of one.
  let graphics = null;
  if (wants("graphics")) {
    stage("graphics lifecycle");
    graphics = await captureGraphicsLifecycle();
  }

  const audioContexts = await page.evaluate(() => window.__audioContexts ?? []);
  const unhandled = await page.evaluate(() => window.__unhandled ?? []);
  if (audioContexts.length > 0) findings.push("the muted build reached for audio");
  if (unhandled.length > 0) findings.push(`unhandled rejections: ${unhandled.join("; ")}`);

  const end = await lab.state();
  await context.close();

  if (skipped.length > 0) {
    findings.push(
      `not captured: ${skipped.join(", ")} (${Math.round(RUN_BUDGET_MS / 1000)}s run budget)`,
    );
  }

  return {
    budgetSeconds: Math.round(RUN_BUDGET_MS / 1000),
    captureBudgetSeconds: Math.round(CAPTURE_BUDGET_MS / 1000),
    manifestHash: boot.manifestHash,
    bootMilliseconds,
    chunks: boot.chunks,
    preparation: boot.preparation,
    worstJobs: worst,
    draws: { boot: boot.drawCalls, end: end.drawCalls },
    triangles: { boot: boot.triangles, end: end.triangles },
    groundCover: { tufts: boot.groundCoverTufts, triangles: boot.groundCoverTriangles },
    audio: { muted: boot.audioMuted, contextsConstructed: audioContexts.length },
    unhandled,
    graphics,
    summary: [
      `manifest ${boot.manifestHash}  boot ${(bootMilliseconds / 1000).toFixed(1)}s`,
      `chunks ${boot.chunks?.activeChunks}/${boot.chunks?.totalChunks}  jobs ${boot.preparation?.jobCount} worst ${boot.preparation?.longestName} ${boot.preparation?.longestMilliseconds?.toFixed(1)}ms`,
      `draws ${boot.drawCalls} -> ${end.drawCalls}   triangles ${boot.triangles} -> ${end.triangles}`,
      `ground cover ${boot.groundCoverTufts} tufts / ${boot.groundCoverTriangles} triangles`,
      `audio contexts ${audioContexts.length}`,
      ...worst.map((line) => `  job ${line}`),
    ],
  };

  function stage(name) {
    console.log(`\n== ${name}  (${remainingSeconds()}s of budget left)`);
  }

  /**
   * Finds a viewpoint that is standing on the island rather than on the sea.
   *
   * A fixed bearing near a coast puts the camera offshore, and an offshore
   * camera at forty metres looks straight down the length of the island and
   * draws far more of it than any frame a player will ever see. That is how the
   * Fernwood view came to be measured at 777,317 triangles against a 750k
   * guide: not because the region is expensive, but because the measurement was
   * taken from a vantage no horse can occupy.
   *
   * Scans round from the asked-for bearing and takes the first stance above the
   * water line, falling back to the original if the whole circle is sea.
   */
  async function standOnLand(x, z, bearing, distance) {
    let fallback = null;
    for (let step = 0; step < 8; step += 1) {
      const candidate = bearing + (step * Math.PI) / 4;
      const eyeX = x + Math.sin(candidate) * distance;
      const eyeZ = z + Math.cos(candidate) * distance;
      const eyeGround = await lab.heightAt(eyeX, eyeZ);
      const stance = { eyeX, eyeZ, eyeGround, bearing: candidate };
      fallback ??= stance;
      if (eyeGround > SHORE_METRES) return stance;
    }
    return fallback;
  }

  /**
   * Puts the camera on a point and photographs it.
   *
   * Every step is inside one timeout, and a failure is recorded and stepped
   * over rather than thrown: one unphotographable scene must not cost the other
   * thirteen. What was missed is named in the report.
   */
  async function capturePoint(label, x, z, options) {
    if (outOfTime()) {
      skipped.push(label);
      console.log(`  ${label.padEnd(44)} SKIPPED - out of run budget`);
      return;
    }
    const started = Date.now();
    let placement = null;
    try {
      await withTimeout(
        (async () => {
          const ground = await lab.heightAt(x, z);
          const { eyeX, eyeZ, eyeGround, bearing } = await standOnLand(
            x,
            z,
            options.bearing,
            options.distance,
          );
          const from = {
            // Seated on whatever ground the camera is actually over, so a
            // viewpoint on a hillside is not buried in it or floating above it.
            x: eyeX,
            y: Math.max(eyeGround, ground) + options.eye,
            z: eyeZ,
          };
          const lookAt = { x, y: ground + options.aim, z };
          // Recorded, because a capture that cannot say where it stood cannot
          // be debugged when the subject turns out not to be in the frame -
          // which is exactly what happened to the first herd capture.
          placement = {
            from: {
              x: Number(from.x.toFixed(1)),
              y: Number(from.y.toFixed(1)),
              z: Number(from.z.toFixed(1)),
            },
            lookAt: {
              x: Number(lookAt.x.toFixed(1)),
              y: Number(lookAt.y.toFixed(1)),
              z: Number(lookAt.z.toFixed(1)),
            },
            groundAtSubject: Number(ground.toFixed(1)),
            groundAtEye: Number(eyeGround.toFixed(1)),
            bearing: Number(bearing.toFixed(2)),
          };
          await lab.observe(from, lookAt);
          // Two settle frames: ground cover re-buckets around the new focus,
          // and photographing before it does gives an empty-looking island.
          await wait(1.4);
          await page.screenshot({ path: path.join(OUTPUT_DIR, `${label}.png`) });
        })(),
        CAPTURE_BUDGET_MS,
        label,
      );
      const state = await lab.state();
      captures.push({
        label,
        subject: options.subject,
        kind: options.kind,
        at: { x: Number(x.toFixed(1)), z: Number(z.toFixed(1)) },
        placement,
        seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
        drawCalls: state.drawCalls,
        triangles: state.triangles,
      });
      console.log(
        `  ${label.padEnd(44)} ${state.drawCalls} draws / ${state.triangles} tris  ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
      if (state.triangles > 750_000) {
        findings.push(`${label}: ${state.triangles} drawn triangles is over the 750k guide`);
      }
    } catch (error) {
      skipped.push(label);
      findings.push(`capture failed: ${label}: ${error.message}`);
      console.log(`  ${label.padEnd(44)} FAILED - ${error.message}`);
    }
  }

  /**
   * Loses the context on purpose and photographs each state it passes through.
   *
   * The assertion that matters is the last one: a native restore must land on
   * `restored-paused` and stay there. A browser handing the context back is the
   * browser saying it can draw again, not the player saying they are ready to
   * ride, and a game that resumes itself drops the player back into a moving
   * world they cannot see the last second of.
   */
  async function captureGraphicsLifecycle() {
    const seen = [];

    /**
     * Waits for one lifecycle state, and says what it actually saw if it does
     * not arrive. A bare timeout on a state machine tells you it stopped and
     * not where, which is the least useful half of the information.
     */
    async function reachStatus(want) {
      try {
        await page.waitForFunction(
          (target) => window.__longrideLab.graphics().status === target,
          want,
          { timeout: CAPTURE_BUDGET_MS, polling: 250 },
        );
      } catch {
        const actual = await lab.graphics();
        throw new Error(`expected ${want}, stuck at ${actual.status} (generation ${actual.generation})`);
      }
    }

    try {
      const before = await lab.graphics();
      seen.push(before.status);
      if (before.status !== "ready") findings.push(`graphics did not start ready: ${before.status}`);

      const lost = await withTimeout(lab.loseContext(), CAPTURE_BUDGET_MS, "lose context");
      if (!lost) {
        // Not a pass and not a failure: the extension is simply absent here.
        findings.push("WEBGL_lose_context is unavailable; recovery was NOT exercised");
        return { exercised: false, seen };
      }
      await reachStatus("context-lost");
      seen.push("context-lost");
      await wait(0.5);
      await page.screenshot({ path: path.join(OUTPUT_DIR, "graphics-1-lost.png") });

      const restoreAsked = await withTimeout(
        lab.restoreContext(),
        CAPTURE_BUDGET_MS,
        "restore context",
      );
      if (!restoreAsked) throw new Error("the build refused to ask for a restore");
      await reachStatus("restored-paused");
      seen.push("restored-paused");
      await wait(0.5);
      await page.screenshot({ path: path.join(OUTPUT_DIR, "graphics-2-restored-paused.png") });

      // The whole point of the state: it has to hold without a player.
      await wait(2);
      const held = await lab.graphics();
      if (held.status !== "restored-paused") {
        findings.push(`a restored context resumed itself: ${held.status}`);
      }

      // And it has to end when the player says so, through the button they see
      // rather than through the harness back door.
      await page.click(".lr-graphics .lr-button");
      await reachStatus("ready");
      seen.push("ready");
      await wait(1.2);
      await page.screenshot({ path: path.join(OUTPUT_DIR, "graphics-3-resumed.png") });

      const after = await lab.state();
      console.log(`  lifecycle ${seen.join(" -> ")}  frame ${after.frame}`);
      return { exercised: true, seen, resumedByPlayerButton: true, frameAfter: after.frame };
    } catch (error) {
      findings.push(`graphics lifecycle failed: ${error.message}`);
      return { exercised: false, seen, error: error.message };
    }
  }
}
