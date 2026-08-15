/**
 * Rides the first island's herd traces for real, under a hard budget.
 *
 * This is the other half of the evidence and the half that cannot be faked by
 * moving a camera. `captureFirstIsland.mjs` proves each place exists and looks
 * right; this proves the progression chain actually runs when a horse walks
 * into it - hidden becomes revealed, revealed becomes visited, visited becomes
 * complete, and the interface says something true at each step.
 *
 * It is deliberately not a full five-trace tour. Under SwiftShader the horse
 * covers roughly two metres of wall clock per second, and the five traces are
 * spread over a kilometre: riding all of them is half an hour of automation and
 * exactly the unbounded traversal that had to be killed once already. So this
 * rides outward from spawn, nearest trace first, and stops when the budget runs
 * out - reporting precisely which traces it reached and which it did not.
 *
 * A partial run is a real result and is reported as one. What it must never do
 * is claim the traces it never got to.
 *
 * Usage:
 *   node tools/journeyFirstIsland.mjs [baseUrl]
 */
import { chromium } from "@playwright/test";
import { automationUrl } from "./automationUrl.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const OUTPUT_DIR = path.resolve("docs/evidence/milestone-5");
const VIEWPORT = { width: 1600, height: 900 };

/** Hard wall clock for the whole ride, browser launch included. */
const RUN_BUDGET_MS = Number(process.env.LONGRIDE_JOURNEY_BUDGET_MS ?? 420_000);
/**
 * How much budget a leg must have left before it is worth starting.
 *
 * Setting off on a three-hundred-metre leg with forty seconds left produces a
 * run that ends mid-field with nothing to show. Better to stop and say so.
 */
const LEG_FLOOR_MS = 70_000;
/**
 * How long to stand on a trace before deciding the world is not going to
 * resolve it. Comfortably over the longest authored linger.
 */
const SETTLE_MS = Number(process.env.LONGRIDE_JOURNEY_SETTLE_MS ?? 12_000);

const runDeadline = Date.now() + RUN_BUDGET_MS;
const outOfTime = () => Date.now() > runDeadline;
const remainingSeconds = () => Math.max(0, Math.round((runDeadline - Date.now()) / 1000));

const consoleErrors = [];
const findings = [];
const beats = [];
const reached = [];
const notReached = [];
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
  const report = await ride(baseUrl);
  await writeFile(
    path.join(OUTPUT_DIR, "journey-first-island.json"),
    `${JSON.stringify({ ...report, beats, reached, notReached, findings, consoleErrors }, null, 2)}\n`,
  );
  console.log("");
  for (const line of report.summary) console.log(line);
  console.log(`console errors: ${consoleErrors.length}`);
  for (const error of consoleErrors) console.log(`  ! ${error}`);
  for (const finding of findings) console.log(`  ! ${finding}`);
  if (findings.length > 0 || consoleErrors.length > 0) process.exitCode = 1;
} finally {
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

async function ride(baseUrl) {
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
    scenes: () => page.evaluate(() => window.__longrideLab.scenes?.() ?? []),
    move: (x, y) => page.evaluate(([a, b]) => window.__longrideLab.setMove(a, b), [x, y]),
    gallop: (on) => page.evaluate((v) => window.__longrideLab.setGallop(v), on),
    press: (action) => page.evaluate((a) => window.__longrideLab.press(a), action),
    yaw: (value) => page.evaluate((v) => window.__longrideLab.setCameraYaw(v), value),
  };
  const wait = (seconds) => page.waitForTimeout(seconds * 1000);
  const shoot = async (label) => {
    await page.screenshot({ path: path.join(OUTPUT_DIR, `journey-${label}.png`) });
    console.log(`  frame journey-${label}.png`);
  };

  await page.goto(automationUrl(baseUrl), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__longrideLab?.ready === true, null, {
    timeout: 240_000,
  });
  await page.waitForSelector("html[data-longride='running']");
  await page.addStyleTag({ content: ".lr-focus { display: none !important; }" });
  await wait(1.5);

  const spawn = await lab.state();
  console.log(`spawned in ${spawn.regionId}  ${remainingSeconds()}s of budget`);
  await shoot("00-spawn");

  // Steered from the compiled manifest, never from coordinates copied into this
  // file. A trace the compiler moves must reroute the ride rather than silently
  // invalidate the evidence, which is what happened the last time a route was
  // hard-coded here.
  const traces = (await lab.scenes())
    .filter((scene) => scene.kind === "herd-trace" && scene.mandatory)
    .map((scene) => ({
      ...scene,
      fromSpawn: Math.hypot(
        scene.position.x - spawn.position.x,
        scene.position.z - spawn.position.z,
      ),
    }))
    .sort((a, b) => a.fromSpawn - b.fromSpawn);

  if (traces.length === 0) findings.push("the manifest exposed no mandatory herd traces");
  console.log(`${traces.length} mandatory traces, nearest first:`);
  for (const trace of traces) console.log(`  ${trace.id.padEnd(34)} ${trace.fromSpawn.toFixed(0)} m from spawn`);

  for (const [index, trace] of traces.entries()) {
    const label = `${String(index + 1).padStart(2, "0")}-${trace.id}`;
    const budgetLeft = runDeadline - Date.now();
    if (budgetLeft < LEG_FLOOR_MS) {
      notReached.push(trace.id);
      console.log(`\n${label}  NOT ATTEMPTED - ${Math.round(budgetLeft / 1000)}s left, under the leg floor`);
      continue;
    }

    const from = await lab.state();
    const metres = Math.hypot(
      trace.position.x - from.position.x,
      trace.position.z - from.position.z,
    );
    console.log(`\n${label}  riding ${metres.toFixed(0)} m  (${remainingSeconds()}s of budget)`);
    const legStarted = Date.now();
    const arrival = await rideTo(trace.position.x, trace.position.z, trace.visitRadiusMeters * 0.8);
    const legSeconds = Math.round((Date.now() - legStarted) / 1000);

    if (!arrival.arrived) {
      notReached.push(trace.id);
      findings.push(
        `could not ride to ${trace.id}: ${arrival.reason}, ${arrival.remaining.toFixed(0)} m short after ${legSeconds}s`,
      );
      console.log(`${label}  STOPPED (${arrival.reason}) ${arrival.remaining.toFixed(0)} m short in ${legSeconds}s`);
      continue;
    }

    // Standing on it, and standing still.
    //
    // Every completion the spec authors needs the horse to stop: `linger`
    // counts ticks in place, and `interact` is only offered once the horse is
    // settled on safe ground, which takes a moment after a gallop. An earlier
    // version waited 1.5 seconds, found no offer, and recorded both traces as
    // merely visited - a false negative produced entirely by impatience.
    const settled = await settleAndComplete(trace);
    if (settled.known === null) {
      findings.push(`${trace.id}: arrived but the discovery is still hidden`);
    }
    const offered = settled.offered;
    await shoot(label);

    const after = settled.state;
    const finalState = settled.known?.state ?? "hidden";
    reached.push(trace.id);
    beats.push({
      id: trace.id,
      label,
      legSeconds,
      legMetres: Number(metres.toFixed(0)),
      completionKind: trace.completion?.kind ?? null,
      offeredInteraction: offered,
      calledOut: settled.called,
      state: finalState,
      completedMandatory: after.journey?.completedMandatory ?? null,
      totalMandatory: after.journey?.totalMandatory ?? null,
      objectiveId: after.journey?.objectiveId ?? null,
      standing: {
        x: Number(after.position.x.toFixed(1)),
        z: Number(after.position.z.toFixed(1)),
      },
      regionId: after.regionId,
    });
    console.log(
      `${label}  arrived in ${legSeconds}s, state=${finalState}, ${after.journey?.completedMandatory}/${after.journey?.totalMandatory} mandatory`,
    );
  }

  for (const trace of traces) {
    if (!reached.includes(trace.id) && !notReached.includes(trace.id)) notReached.push(trace.id);
  }

  const audioContexts = await page.evaluate(() => window.__audioContexts ?? []);
  const unhandled = await page.evaluate(() => window.__unhandled ?? []);
  if (audioContexts.length > 0) findings.push("the muted build reached for audio");
  if (unhandled.length > 0) findings.push(`unhandled rejections: ${unhandled.join("; ")}`);

  const end = await lab.state();
  await context.close();

  return {
    budgetSeconds: Math.round(RUN_BUDGET_MS / 1000),
    manifestHash: spawn.manifestHash,
    tracesTotal: traces.length,
    tracesReached: reached.length,
    audio: { muted: spawn.audioMuted, contextsConstructed: audioContexts.length },
    unhandled,
    completedMandatory: end.journey?.completedMandatory ?? null,
    totalMandatory: end.journey?.totalMandatory ?? null,
    journeyComplete: end.journey?.complete ?? null,
    summary: [
      `manifest ${spawn.manifestHash}`,
      `traces ridden to: ${reached.length}/${traces.length}`,
      reached.length > 0 ? `  reached: ${reached.join(", ")}` : "  reached: none",
      notReached.length > 0 ? `  not reached: ${notReached.join(", ")}` : "  not reached: none",
      `mandatory complete ${end.journey?.completedMandatory}/${end.journey?.totalMandatory}`,
      `audio contexts ${audioContexts.length}`,
    ],
  };

  /**
   * Rides towards a point, bounded by the run's own wall clock.
   *
   * No per-leg timeout, on purpose: per-leg budgets multiply into hours of
   * permitted silence, which is how the first island inspection came to sit for
   * seven minutes with nothing printed.
   */
  async function rideTo(targetX, targetZ, within) {
    let closest = Infinity;
    let lastProgressAt = Date.now();
    let recoveries = 0;
    let announcedAt = Date.now();
    await lab.move(0, 1);
    while (!outOfTime()) {
      const state = await lab.state();
      const dx = targetX - state.position.x;
      const dz = targetZ - state.position.z;
      const remaining = Math.hypot(dx, dz);
      if (remaining <= within) {
        await halt();
        return { arrived: true, remaining };
      }
      if (Date.now() - announcedAt > 20_000) {
        announcedAt = Date.now();
        console.log(`    ${remaining.toFixed(0)} m to go, ${remainingSeconds()}s of budget`);
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
        // Backed into something. Turn away, run, then come at it off-angle.
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

  /**
   * Stands still on a trace until the world resolves it, or the wait is up.
   *
   * Polls rather than sleeping a fixed time, so a fast completion costs a
   * second and a slow one is still caught. Returns what actually happened,
   * including "nothing did" - which is a result, not a failure to be retried
   * into submission.
   */
  async function settleAndComplete(trace) {
    const until = Math.min(Date.now() + SETTLE_MS, runDeadline);
    let offered = false;
    let called = false;
    let known = null;
    while (Date.now() < until) {
      const state = await lab.state();
      known = state.journey?.known?.find((entry) => entry.id === trace.id) ?? null;
      if (known?.state === "completed") break;
      if (state.journey?.interactionId === trace.id) {
        offered = true;
        await lab.press("interactPressed");
        await wait(1);
        continue;
      }
      // A trace the world finishes by calling needs the call made. Standing on
      // it silently for a minute would finish nothing and prove nothing.
      if (trace.completion?.kind === "call" && !called) {
        called = true;
        await lab.press("callPressed");
        await wait(1.5);
        continue;
      }
      // Lingering just takes time on the spot, so this loop is the completion.
      await wait(0.5);
    }
    // One last look after everything has settled. Reading the state on the same
    // tick as the last action caught a linger completing a fraction later and
    // recorded it as unfinished, which understated a chain that was working.
    await wait(1.2);
    const settled = await lab.state();
    return {
      offered,
      called,
      known: settled.journey?.known?.find((entry) => entry.id === trace.id) ?? known,
      state: settled,
    };
  }

  async function halt() {
    await lab.gallop(false);
    await lab.move(0, 0);
    await wait(0.6);
  }
}
