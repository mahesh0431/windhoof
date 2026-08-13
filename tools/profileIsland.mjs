/**
 * Render-budget profiler for the compiled island.
 *
 * Rides the compiler's own safe routes at full speed at a 1080p presentation
 * size, sampling the renderer's real per-frame counters the whole way, and
 * reports distributions rather than a single lucky reading. It also parks at the
 * worst case the island can produce - the high ground, looking back down the
 * whole slice with everything in frustum - because a steady-state number taken
 * on the beach proves nothing about the peak.
 *
 * What this can and cannot prove is worth being precise about. Draw calls and
 * submitted triangles are hardware independent, so the milestone's budget gates
 * are measured honestly here. Frames per second under headless SwiftShader are
 * not representative of a desktop GPU and are reported only as a relative
 * before/after signal on the same machine.
 *
 * Usage: pnpm profile:island [baseUrl]
 */
import { chromium } from "@playwright/test";
import { automationUrl } from "./automationUrl.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const OUTPUT_DIR = path.resolve("docs/evidence/island/profile");
/** 1080p presentation. Device pixel ratio is capped at 1.5 by the renderer. */
const VIEWPORT = { width: 1920, height: 1080 };
const RUN_BUDGET_MS = Number(process.env.WINDHOOF_RUN_BUDGET_MS ?? 300_000);
const LABEL = process.env.WINDHOOF_PROFILE_LABEL ?? "run";

const samples = [];
const consoleErrors = [];
const phases = [];
/** Named world-realization job timings, read once after boot. */
let preparationJobs = [];
let server;
let browser;

const runDeadline = Date.now() + RUN_BUDGET_MS;
const outOfTime = () => Date.now() > runDeadline;

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
  await profile(baseUrl);

  const report = summarise();
  await writeFile(
    path.join(OUTPUT_DIR, `${LABEL}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  print(report);
  if (consoleErrors.length > 0) process.exitCode = 1;
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

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index];
}

function summarise() {
  const of = (key) => samples.map((sample) => sample[key]).filter((v) => Number.isFinite(v));
  const draws = of("drawCalls");
  const tris = of("triangles");
  const fps = of("fps");
  return {
    label: LABEL,
    viewport: VIEWPORT,
    sampleCount: samples.length,
    manifestHash: samples[0]?.manifestHash ?? null,
    groundCoverTufts: samples[0]?.groundCoverTufts ?? null,
    groundCoverTriangles: samples[0]?.groundCoverTriangles ?? null,
    drawCalls: {
      median: percentile(draws, 0.5),
      p95: percentile(draws, 0.95),
      max: Math.max(0, ...draws),
    },
    triangles: {
      median: percentile(tris, 0.5),
      p95: percentile(tris, 0.95),
      max: Math.max(0, ...tris),
    },
    // SwiftShader only. Relative signal, not a desktop frame-rate claim.
    swiftshaderFps: {
      median: percentile(fps, 0.5),
      p05: percentile(fps, 0.05),
      min: Math.min(Infinity, ...fps),
    },
    // The milestone's main-thread stall gate. Rounded to a tenth of a
    // millisecond, which is finer than the 50 ms limit needs and coarse enough
    // that the file does not churn on noise.
    preparation: {
      jobCount: preparationJobs.length,
      longestMilliseconds: Number(
        Math.max(0, ...preparationJobs.map((job) => job.milliseconds)).toFixed(1),
      ),
      longestName:
        preparationJobs.reduce(
          (worst, job) => (!worst || job.milliseconds > worst.milliseconds ? job : worst),
          null,
        )?.name ?? null,
      totalMilliseconds: Number(
        preparationJobs.reduce((sum, job) => sum + job.milliseconds, 0).toFixed(1),
      ),
      jobs: preparationJobs.map((job) => ({
        name: job.name,
        milliseconds: Number(job.milliseconds.toFixed(1)),
      })),
    },
    phases,
    consoleErrors,
  };
}

function print(report) {
  console.log(`\n=== ${report.label} @ ${VIEWPORT.width}x${VIEWPORT.height} ===`);
  console.log(`samples            ${report.sampleCount}`);
  console.log(`manifest           ${report.manifestHash}`);
  console.log(
    `ground cover       ${report.groundCoverTufts} tufts / ${report.groundCoverTriangles} tris built`,
  );
  console.log(
    `draw calls         median ${report.drawCalls.median}  p95 ${report.drawCalls.p95}  max ${report.drawCalls.max}`,
  );
  console.log(
    `triangles          median ${report.triangles.median}  p95 ${report.triangles.p95}  max ${report.triangles.max}`,
  );
  console.log(
    `swiftshader fps    median ${report.swiftshaderFps.median.toFixed(1)}  p05 ${report.swiftshaderFps.p05.toFixed(1)}  min ${report.swiftshaderFps.min.toFixed(1)}`,
  );
  for (const phase of report.phases) {
    console.log(
      `  ${phase.name.padEnd(22)} draws ${String(phase.drawCalls).padStart(4)}  ` +
        `tris ${String(phase.triangles).padStart(7)}  region ${phase.regionId}`,
    );
  }
  const slowest = [...report.preparation.jobs]
    .sort((a, b) => b.milliseconds - a.milliseconds)
    .slice(0, 5);
  console.log(
    `preparation        ${report.preparation.jobCount} jobs  ` +
      `longest ${report.preparation.longestMilliseconds} ms (${report.preparation.longestName})  ` +
      `total ${report.preparation.totalMilliseconds} ms  ` +
      `[gate 50 ms: ${report.preparation.longestMilliseconds < 50 ? "pass" : "FAIL"}]`,
  );
  for (const job of slowest) {
    console.log(`  ${job.name.padEnd(24)} ${String(job.milliseconds).padStart(6)} ms`);
  }
  console.log(`console errors     ${report.consoleErrors.length}`);
  for (const error of report.consoleErrors) console.log(`  ! ${error}`);
}

async function profile(baseUrl) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.setDefaultTimeout(20_000);
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto(automationUrl(baseUrl), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__windhoofLab?.ready === true, null, {
    timeout: 90_000,
  });
  await page.addStyleTag({ content: ".wh-focus { display: none !important; }" });

  // Read before riding: these are boot-time measurements and the log is fixed
  // size, so there is nothing to gain by reading them late.
  preparationJobs = await page.evaluate(() => window.__windhoofLab.preparationJobs());

  const lab = {
    state: () => page.evaluate(() => window.__windhoofLab.state()),
    move: (x, y) => page.evaluate(([a, b]) => window.__windhoofLab.setMove(a, b), [x, y]),
    gallop: (v) => page.evaluate((value) => window.__windhoofLab.setGallop(value), v),
    yaw: (v) => page.evaluate((value) => window.__windhoofLab.setCameraYaw(value), v),
  };

  const plan = await page.evaluate(async () => {
    const { VERTICAL_SLICE_SPEC } = await import(
      /* @vite-ignore */ "/src/world/verticalSliceSpec.ts"
    );
    const { compileWorldAsync } = await import(
      /* @vite-ignore */ "/src/game/world/runtime/compileWorldAsync.ts"
    );
    const manifest = await compileWorldAsync(VERTICAL_SLICE_SPEC);
    return {
      routes: manifest.routes.map((route) => ({
        id: route.id,
        kind: route.kind,
        waypoints: route.waypoints.map((point) => ({ x: point.x, z: point.z })),
      })),
      regions: manifest.regions.map((region) => ({ id: region.id, anchor: region.anchor })),
    };
  });

  async function sample() {
    const state = await lab.state();
    samples.push(state);
    return state;
  }

  async function mark(name) {
    const state = await sample();
    phases.push({
      name,
      drawCalls: state.drawCalls,
      triangles: state.triangles,
      fps: Number((state.fps ?? 0).toFixed(1)),
      regionId: state.regionId,
      position: {
        x: Number(state.position.x.toFixed(1)),
        y: Number(state.position.y.toFixed(1)),
        z: Number(state.position.z.toFixed(1)),
      },
    });
    return state;
  }

  /** Rides towards a target, sampling every frame-ish, with a hard deadline. */
  async function rideTo(targetX, targetZ, options = {}) {
    const { within = 6, timeout = 25, pace = 1, gallop = true } = options;
    const deadline = Date.now() + timeout * 1000;
    let closest = Infinity;
    let lastProgress = Date.now();
    await lab.move(0, pace);
    while (Date.now() < deadline && !outOfTime()) {
      const state = await sample();
      const dx = targetX - state.position.x;
      const dz = targetZ - state.position.z;
      const remaining = Math.hypot(dx, dz);
      if (remaining <= within) return true;
      if (remaining < closest - 0.75) {
        closest = remaining;
        lastProgress = Date.now();
      } else if (Date.now() - lastProgress > 5000) {
        return false;
      }
      await lab.gallop(gallop && remaining > 30);
      await lab.yaw(Math.atan2(dx, dz));
      await page.waitForTimeout(100);
    }
    return false;
  }

  await page.waitForTimeout(1200);
  await mark("spawn-idle");

  // Full-speed traversal along the beach, which is the widest open ground the
  // horse can reach without committing to a corridor.
  await lab.yaw(Math.PI / 2);
  await lab.gallop(true);
  await lab.move(0, 1);
  for (let step = 0; step < 30 && !outOfTime(); step += 1) {
    await sample();
    await page.waitForTimeout(100);
  }
  await mark("coast-gallop");

  const coast = plan.routes.find((route) => route.id === "coast-to-plain-safe-route-safe");
  if (coast) {
    for (const waypoint of coast.waypoints) {
      if (outOfTime()) break;
      await rideTo(waypoint.x, waypoint.z, { within: 4, timeout: 18, pace: 0.7 });
    }
    await mark("plain-anchor");
  }

  const forest = plan.routes.find((route) => route.id === "plain-to-forest-safe-route-safe");
  if (forest) {
    for (const waypoint of forest.waypoints) {
      if (outOfTime()) break;
      await rideTo(waypoint.x, waypoint.z, { within: 4, timeout: 18, pace: 0.7 });
    }
    await mark("fernwood-anchor");
  }

  // Worst case: stand on the high ground and sweep the camera through a full
  // turn, so the whole island passes through the frustum. This is where the
  // peak budget is actually decided.
  await lab.gallop(false);
  await lab.move(0, 0);
  await page.waitForTimeout(600);
  let worst = null;
  const baseYaw = (await lab.state()).yaw;
  for (let step = 0; step < 24 && !outOfTime(); step += 1) {
    await lab.yaw(baseYaw + (step / 24) * Math.PI * 2);
    await page.waitForTimeout(220);
    const state = await sample();
    if (!worst || state.triangles > worst.triangles) worst = state;
  }
  if (worst) {
    phases.push({
      name: "overlook-sweep-peak",
      drawCalls: worst.drawCalls,
      triangles: worst.triangles,
      fps: Number((worst.fps ?? 0).toFixed(1)),
      regionId: worst.regionId,
      position: {
        x: Number(worst.position.x.toFixed(1)),
        y: Number(worst.position.y.toFixed(1)),
        z: Number(worst.position.z.toFixed(1)),
      },
    });
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${LABEL}-peak.png`) });

  await page.close();
}
