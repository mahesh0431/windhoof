/**
 * Rides the first island and photographs each of its five regions.
 *
 * This is the render-inspect-refine loop's eye. It is not gameplay evidence and
 * does not pretend to be: it rides to region anchors rather than through the
 * authored journey, and its job is to answer one question per region - does
 * this read as a different place than the one before it.
 *
 * Startup health comes along for free, because it is measured at the moment the
 * island becomes playable and there is no reason to boot twice for it.
 *
 * It is bounded by a hard wall clock and says where it is the whole time.
 *
 * The first version was not. It allowed seven minutes per region leg with no
 * global budget, so a run that met one difficult leg - Fernwood to River Hollow
 * is 535 metres straight through the central highland - could sit silently for
 * half an hour. Under SwiftShader the horse covers ground at wall-clock speed,
 * so a leg is minutes even when it is going well, and there is no way to tell
 * a slow leg from a stuck one without being told. Now there is: every leg
 * prints when it starts and what it cost, the whole run dies at
 * LONGRIDE_INSPECT_BUDGET_MS, and whatever was captured is written out with the
 * regions that were never reached named explicitly.
 *
 * Usage:
 *   node tools/inspectFirstIsland.mjs [--spawn-only] [--regions=a,b] [baseUrl]
 */
import { chromium } from "@playwright/test";
import { automationUrl } from "./automationUrl.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const OUTPUT_DIR = path.resolve("docs/evidence/milestone-5");
const VIEWPORT = { width: 1600, height: 900 };
const SPAWN_ONLY = process.argv.includes("--spawn-only");
const REGION_FILTER = (process.argv.find((a) => a.startsWith("--regions=")) ?? "")
  .replace("--regions=", "")
  .split(",")
  .filter((entry) => entry.length > 0);

/**
 * Hard wall clock for the entire run, browser launch included.
 *
 * Deliberately not per-leg: per-leg budgets are what allowed the silent
 * half-hour. Anything still unfinished when this expires is reported as
 * unfinished.
 */
const RUN_BUDGET_MS = Number(process.env.LONGRIDE_INSPECT_BUDGET_MS ?? 480_000);
const runDeadline = Date.now() + RUN_BUDGET_MS;
const outOfTime = () => Date.now() > runDeadline;
const remainingSeconds = () => Math.max(0, Math.round((runDeadline - Date.now()) / 1000));
const skipped = [];

const consoleErrors = [];
const findings = [];
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
    path.join(OUTPUT_DIR, "island-inspection.json"),
    `${JSON.stringify({ ...report, findings, consoleErrors }, null, 2)}\n`,
  );
  console.log("");
  for (const line of report.summary) console.log(line);
  console.log(`console errors: ${consoleErrors.length}`);
  for (const error of consoleErrors) console.log(`  ! ${error}`);
  for (const finding of findings) console.log(`  ! ${finding}`);
  if (findings.length > 0 || consoleErrors.length > 0) process.exitCode = 1;
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
    jobs: () => page.evaluate(() => window.__longrideLab.preparationJobs()),
    move: (x, y) => page.evaluate(([a, b]) => window.__longrideLab.setMove(a, b), [x, y]),
    gallop: (on) => page.evaluate((v) => window.__longrideLab.setGallop(v), on),
    yaw: (value) => page.evaluate((v) => window.__longrideLab.setCameraYaw(v), value),
  };
  const wait = (seconds) => page.waitForTimeout(seconds * 1000);

  const bootStarted = Date.now();
  await page.goto(automationUrl(baseUrl), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__longrideLab?.ready === true, null, { timeout: 240_000 });
  await page.waitForSelector("html[data-longride='running']");
  const bootMilliseconds = Date.now() - bootStarted;
  await page.addStyleTag({ content: ".lr-focus { display: none !important; }" });
  await wait(1);

  const boot = await lab.state();
  const jobs = [...(await lab.jobs())].sort((a, b) => b.milliseconds - a.milliseconds);
  const worst = jobs.slice(0, 8).map((job) => `${job.name} ${job.milliseconds.toFixed(1)}ms`);

  // The 50 ms per-job stall ceiling is a standing gate, and a four-times-larger
  // island is exactly the thing that would quietly break it.
  for (const job of jobs) {
    if (job.milliseconds > 50) findings.push(`preparation job over budget: ${job.name} ${job.milliseconds.toFixed(1)}ms`);
  }
  if (boot.chunks && boot.chunks.activeChunks !== boot.chunks.totalChunks) {
    findings.push(`only ${boot.chunks.activeChunks}/${boot.chunks.totalChunks} chunks active`);
  }

  const visits = [];
  const allRegions = await lab.regions();
  if (allRegions.length === 0) findings.push("the harness exposed no regions");
  // Filtered regions are visited in the order they were asked for, not in
  // manifest order: the caller is choosing the route, and a targeted capture of
  // two far-apart regions is minutes shorter one way round than the other.
  const regions = REGION_FILTER.length > 0
    ? REGION_FILTER.map((id) => allRegions.find((region) => region.id === id)).filter(Boolean)
    : allRegions;
  for (const id of REGION_FILTER) {
    if (!allRegions.some((region) => region.id === id)) findings.push(`no such region: ${id}`);
  }

  await settleAndShoot("00-spawn", boot.regionId ?? "spawn");

  if (!SPAWN_ONLY) {
    for (const [index, region] of regions.entries()) {
      const label = `${String(index + 1).padStart(2, "0")}-${region.id}`;
      if (outOfTime()) {
        skipped.push(region.id);
        console.log(`${label.padEnd(28)} SKIPPED - out of budget`);
        continue;
      }
      const legStarted = Date.now();
      const from = await lab.state();
      const legMetres = Math.hypot(region.anchor.x - from.position.x, region.anchor.z - from.position.z);
      console.log(
        `${label.padEnd(28)} riding ${legMetres.toFixed(0)} m, ${remainingSeconds()}s of budget left`,
      );
      const arrival = await rideTo(region.anchor.x, region.anchor.z, 40);
      const standing = await lab.state();
      const legSeconds = ((Date.now() - legStarted) / 1000).toFixed(0);
      if (!arrival.arrived) {
        findings.push(
          `could not ride to ${region.id}: ${arrival.reason} (${arrival.remaining.toFixed(0)} m short after ${legSeconds}s)`,
        );
      }
      console.log(
        `${label.padEnd(28)} ${arrival.arrived ? "arrived" : `STOPPED (${arrival.reason})`} in ${legSeconds}s`,
      );
      // Two frames per region: the place, and the place from the other side.
      // A region that only reads from one bearing is not a place yet.
      await settleAndShoot(label, region.id);
      await lab.yaw(Math.PI * 0.75);
      await wait(1.2);
      await page.screenshot({ path: path.join(OUTPUT_DIR, `${label}-b.png`) });
      visits.push({
        region: region.id,
        arrived: arrival.arrived,
        legSeconds: Number(legSeconds),
        legMetres: Number(legMetres.toFixed(0)),
        reason: arrival.reason ?? null,
        standing: {
          x: Number(standing.position.x.toFixed(1)),
          z: Number(standing.position.z.toFixed(1)),
          y: Number(standing.position.y.toFixed(1)),
        },
        reportedRegion: standing.regionId,
        drawCalls: standing.drawCalls,
        triangles: standing.triangles,
      });
      if (standing.regionId !== region.id && arrival.arrived) {
        findings.push(`standing on ${region.id}'s anchor reports region ${standing.regionId}`);
      }
    }
  }

  const audioContexts = await page.evaluate(() => window.__audioContexts ?? []);
  const unhandled = await page.evaluate(() => window.__unhandled ?? []);
  if (audioContexts.length > 0) findings.push("the muted build reached for audio");
  if (unhandled.length > 0) findings.push(`unhandled rejections: ${unhandled.join("; ")}`);

  const end = await lab.state();
  await context.close();

  if (skipped.length > 0) {
    findings.push(`never reached: ${skipped.join(", ")} (run budget of ${Math.round(RUN_BUDGET_MS / 1000)}s expired)`);
  }

  return {
    budgetSeconds: Math.round(RUN_BUDGET_MS / 1000),
    skipped,
    manifestHash: boot.manifestHash,
    bootMilliseconds,
    chunks: boot.chunks,
    preparation: boot.preparation,
    worstJobs: worst,
    draws: { boot: boot.drawCalls, end: end.drawCalls },
    triangles: { boot: boot.triangles, end: end.triangles },
    groundCover: {
      tufts: boot.groundCoverTufts,
      triangles: boot.groundCoverTriangles,
    },
    audio: { muted: boot.audioMuted, contextsConstructed: audioContexts.length },
    unhandled,
    visits,
    summary: [
      `manifest ${boot.manifestHash}  boot ${(bootMilliseconds / 1000).toFixed(1)}s`,
      `chunks ${boot.chunks?.activeChunks}/${boot.chunks?.totalChunks}  jobs ${boot.preparation?.jobCount} worst ${boot.preparation?.longestName} ${boot.preparation?.longestMilliseconds?.toFixed(1)}ms`,
      `draws ${boot.drawCalls} -> ${end.drawCalls}   triangles ${boot.triangles} -> ${end.triangles}`,
      `ground cover ${boot.groundCoverTufts} tufts / ${boot.groundCoverTriangles} triangles`,
      `audio contexts ${audioContexts.length}`,
      ...worst.map((line) => `  job ${line}`),
    ],
  };

  async function settleAndShoot(label, regionId) {
    await wait(1.2);
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${label}.png`) });
    console.log(`${label.padEnd(28)} region=${regionId}`);
  }

  /**
   * Rides towards a point, bounded by the run's own wall clock.
   *
   * There is deliberately no per-leg timeout argument any more. A per-leg
   * budget multiplies: five legs at seven minutes each is thirty-five minutes
   * of allowed silence, which is exactly how this tool came to sit for seven
   * minutes with nothing to show for it.
   */
  async function rideTo(targetX, targetZ, within) {
    const deadline = runDeadline;
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
      } else if (Date.now() - lastProgressAt > 7000) {
        recoveries += 1;
        if (recoveries > 4) {
          await halt();
          return { arrived: false, remaining, reason: "no-progress" };
        }
        await lab.gallop(false);
        await lab.yaw(Math.atan2(-dx, -dz));
        await wait(1);
        await lab.yaw(Math.atan2(dx, dz) + (recoveries % 2 === 0 ? -1 : 1) * (Math.PI / 2));
        await wait(1.4);
        lastProgressAt = Date.now();
        continue;
      }
      await lab.gallop(remaining > 60);
      await lab.move(0, remaining > 25 ? 1 : 0.5);
      await lab.yaw(Math.atan2(dx, dz));
      await wait(0.1);
    }
    await halt();
    return { arrived: false, remaining: closest, reason: "out-of-budget" };
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
