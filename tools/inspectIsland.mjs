/**
 * Render-inspect-refine driver for the compiled island.
 *
 * Opens the real build in a real browser, rides the compiler's own safe routes
 * to the compiler's own discovery anchors, and writes canonical views to
 * docs/evidence/island. Every destination is read out of the manifest rather
 * than typed in here, so the tour cannot drift away from the world it is
 * inspecting when the spec or the seed changes.
 *
 * It starts and stops its own Vite server, so it runs from a clean checkout
 * with nothing else already running. Pass a URL to point it at a server you are
 * already running instead.
 *
 * Usage: pnpm inspect:island [baseUrl]
 * Exits non-zero if the run produced console errors.
 */
import { chromium } from "@playwright/test";
import { automationUrl } from "./automationUrl.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

/**
 * Targeted mode. `--spots` rides exactly the same route with the same driver and
 * captures only the three frames a presentation change needs to be judged on,
 * so a visual iteration costs one leg of driving instead of the whole tour. It
 * never renders anything the full tour would not.
 */
const SPOTS_ONLY = process.argv.includes("--spots");
/**
 * `--only=09,10` captures just those frames. Navigation still happens the same
 * way - the horse rides there - but nothing else is written, so re-checking one
 * refinement does not mean regenerating frames that were already judged.
 */
const ONLY = (process.argv.find((argument) => argument.startsWith("--only=")) ?? "")
  .slice("--only=".length)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

/**
 * A wall-clock ceiling on the whole run.
 *
 * A capture tool that can hang is a capture tool that eats an afternoon. This
 * one cannot: when the budget is gone it writes whatever it has, says what it
 * did not reach, and exits non-zero.
 */
const RUN_BUDGET_MS = Number(process.env.LONGRIDE_RUN_BUDGET_MS ?? 300_000);
const runDeadline = Date.now() + RUN_BUDGET_MS;
const outOfTime = () => Date.now() > runDeadline;
const OUTPUT_DIR = path.resolve(SPOTS_ONLY ? "docs/evidence/island/spots" : "docs/evidence/island");
const VIEWPORT = { width: 1600, height: 900 };

const consoleErrors = [];
const captures = [];
/** Places the horse was held motionless at speed. Reported, never hidden. */
const stalls = [];
/** Targets the horse could not actually reach. Reported, never papered over. */
const failures = [];

let server;
let browser;
let plan = null;

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
  await runTour(baseUrl);

  await writeFile(
    path.join(OUTPUT_DIR, "inspection.json"),
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        viewport: VIEWPORT,
        manifestHash: plan?.manifestHash ?? null,
        stalls,
        failures,
        consoleErrors,
        captures,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\nunreached targets: ${failures.length}`);
  for (const failure of failures) {
    console.log(
      `  x ${failure.target}: ${failure.reason}, still ${failure.remainingMetres} m away ` +
        `at (${failure.at.x}, ${failure.at.y}, ${failure.at.z}) in ${failure.regionId}`,
    );
  }
  console.log(`stalls: ${stalls.length}`);
  for (const stall of stalls) console.log(`  ~ held at (${stall.x}, ${stall.y}, ${stall.z}) in ${stall.regionId} at ${stall.speed} m/s`);
  console.log(`console errors: ${consoleErrors.length}`);
  for (const error of consoleErrors) console.log(`  ! ${error}`);
  if (consoleErrors.length > 0 || failures.length > 0) process.exitCode = 1;
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
  if (!address || typeof address === "string") {
    throw new Error("Vite did not report a usable address");
  }

  const url = `http://127.0.0.1:${address.port}`;
  console.log(`serving ${url}\n`);
  return url;
}

async function runTour(baseUrl) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  // No single browser call may block the run indefinitely.
  page.setDefaultTimeout(20_000);
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto(automationUrl(baseUrl), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__longrideLab?.ready === true, null, {
    timeout: 90_000,
  });
  await page.waitForSelector("html[data-longride='running']");

  const lab = {
    state: () => page.evaluate(() => window.__longrideLab.state()),
    move: (x, y) =>
      page.evaluate(([mx, my]) => window.__longrideLab.setMove(mx, my), [x, y]),
    gallop: (on) => page.evaluate((v) => window.__longrideLab.setGallop(v), on),
    press: (action) => page.evaluate((a) => window.__longrideLab.press(a), action),
    yaw: (value) => page.evaluate((v) => window.__longrideLab.setCameraYaw(v), value),
    command: (command) => page.evaluate((c) => window.__longrideLab.command(c), command),
    settings: (patch) => page.evaluate((p) => window.__longrideLab.setSettings(p), patch),
  };

  const wait = (seconds) => page.waitForTimeout(seconds * 1000);

  async function capture(name, note) {
    const state = await lab.state();
    if (ONLY.length > 0 && !ONLY.some((entry) => name.startsWith(entry))) return state;
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`) });
    captures.push({ name, note, state });
    const position = state.position;
    console.log(
      `${name.padEnd(26)} ${String(state.regionId ?? "-").padEnd(18)} ` +
        `gait=${String(state.gait).padEnd(7)} ` +
        `speed=${state.speed.toFixed(1).padStart(5)} ` +
        `pos=(${position.x.toFixed(0)},${position.y.toFixed(1)},${position.z.toFixed(0)}) ` +
        `grounded=${state.grounded} cam=${state.cameraDistance.toFixed(2)}` +
        `${state.cameraObstructed ? " OBSTRUCTED" : ""} ` +
        `draws=${state.drawCalls} tris=${state.triangles}`,
    );
    return state;
  }

  /**
   * Steers towards a world position the way a player does: camera, then legs.
   *
   * Arrival and progress are both measured in world coordinates, never in
   * elapsed time or in how many waypoints have been ticked off, because the only
   * question that matters is whether the horse is actually getting closer. Three
   * things end a leg and all of them are decisions rather than hangs: arriving,
   * running out of the leg's own time budget, or making no measurable headway
   * for long enough that pushing further is pointless. The result says which.
   */
  async function driveTo(targetX, targetZ, options = {}) {
    const {
      within = 8,
      timeout = 30,
      gallop = true,
      easeOff = true,
      pace = 1,
      label = `${targetX.toFixed(0)},${targetZ.toFixed(0)}`,
    } = options;

    const legDeadline = Date.now() + timeout * 1000;
    const NO_PROGRESS_MS = 4500;
    const PROGRESS_EPSILON = 0.75;

    await lab.move(0, pace);
    let closest = Infinity;
    let lastProgressAt = Date.now();
    let recoveries = 0;
    let last = await lab.state();

    while (Date.now() < legDeadline && !outOfTime()) {
      last = await lab.state();
      const dx = targetX - last.position.x;
      const dz = targetZ - last.position.z;
      const remaining = Math.hypot(dx, dz);

      if (remaining <= within) {
        return { arrived: true, reason: "arrived", remaining, label, state: last };
      }

      if (remaining < closest - PROGRESS_EPSILON) {
        closest = remaining;
        lastProgressAt = Date.now();
      } else if (Date.now() - lastProgressAt > NO_PROGRESS_MS) {
        recoveries += 1;
        stalls.push({
          label,
          x: Number(last.position.x.toFixed(2)),
          y: Number(last.position.y.toFixed(2)),
          z: Number(last.position.z.toFixed(2)),
          remaining: Number(remaining.toFixed(2)),
          speed: Number(last.speed.toFixed(1)),
          regionId: last.regionId,
        });
        if (recoveries > 2) {
          return { arrived: false, reason: "no-progress", remaining, label, state: last };
        }
        // Back off, then cut across the obstruction rather than straight back
        // into it, which is what actually gets a horse off ground it cannot
        // climb. Two attempts, then this leg is honestly a failure.
        await lab.gallop(false);
        await lab.yaw(Math.atan2(-dx, -dz));
        await lab.move(0, 1);
        await wait(0.8);
        await lab.yaw(Math.atan2(dx, dz) + (recoveries % 2 === 0 ? -1 : 1) * (Math.PI / 2));
        await wait(1.1);
        lastProgressAt = Date.now();
        continue;
      }

      await lab.gallop(gallop && (!easeOff || remaining > 40));
      await lab.move(0, !easeOff || remaining > 18 ? pace : pace * 0.5);
      await lab.yaw(Math.atan2(dx, dz));
      await wait(0.1);
    }

    const dx = targetX - last.position.x;
    const dz = targetZ - last.position.z;
    return {
      arrived: false,
      reason: outOfTime() ? "run-budget" : "timeout",
      remaining: Math.hypot(dx, dz),
      label,
      state: last,
    };
  }

  /**
   * Rides a compiled route waypoint by waypoint, which is what it is for.
   *
   * A waypoint that cannot be reached is recorded and skipped rather than
   * retried forever: the next waypoint is often reachable from where the horse
   * actually is, and a route that genuinely cannot be ridden shows up as a run
   * of failures instead of as a tool that never returns.
   */
  async function driveRoute(waypoints, options = {}) {
    let last = null;
    for (const [index, waypoint] of waypoints.entries()) {
      if (outOfTime()) break;
      const result = await driveTo(waypoint.x, waypoint.z, {
        within: 3,
        timeout: 22,
        gallop: false,
        easeOff: false,
        pace: 0.55,
        label: `waypoint ${index}`,
        ...options,
      });
      if (!result.arrived) {
        failures.push({
          target: `${options.routeId ?? "route"} waypoint ${index}`,
          reason: result.reason,
          remainingMetres: Number(result.remaining.toFixed(1)),
          at: {
            x: Number(result.state.position.x.toFixed(1)),
            y: Number(result.state.position.y.toFixed(1)),
            z: Number(result.state.position.z.toFixed(1)),
          },
          regionId: result.state.regionId,
        });
      }
      last = result.state;
    }
    return last;
  }

  // The tour's destinations come from the manifest, not from this file. The
  // compiler is the only thing that knows where it put the world.
  plan = await page.evaluate(async () => {
    const { VERTICAL_SLICE_SPEC } = await import(
      /* @vite-ignore */ "/src/world/verticalSliceSpec.ts"
    );
    const { compileWorldAsync } = await import(
      /* @vite-ignore */ "/src/game/world/runtime/compileWorldAsync.ts"
    );
    const manifest = await compileWorldAsync(VERTICAL_SLICE_SPEC);
    return {
      manifestHash: manifest.manifestHash,
      spawn: manifest.spawn,
      regions: manifest.regions.map((region) => ({ id: region.id, anchor: region.anchor })),
      routes: manifest.routes.map((route) => ({
        id: route.id,
        kind: route.kind,
        waypoints: route.waypoints.map((point) => ({ x: point.x, z: point.z })),
      })),
      discoveries: manifest.discoveries.map((discovery) => ({
        id: discovery.id,
        type: discovery.type,
        position: discovery.position,
      })),
      placements: manifest.placements.map((placement) => ({
        regionId: placement.regionId,
        position: placement.position,
        radius: placement.collisionRadiusMeters,
      })),
    };
  });
  console.log(`manifest ${plan.manifestHash}\n`);

  const route = (id) => plan.routes.find((candidate) => candidate.id === id);
  const discovery = (id) => plan.discoveries.find((candidate) => candidate.id === id);
  const nearestScatter = (regionId, fromX, fromZ) =>
    plan.placements
      .filter((placement) => placement.regionId === regionId)
      .sort(
        (left, right) =>
          Math.hypot(left.position.x - fromX, left.position.z - fromZ) -
          Math.hypot(right.position.x - fromX, right.position.z - fromZ),
      )[0];


  /*
   * Tour order follows the island's own connectivity, not a wish list.
   *
   * The compiler grades a corridor along each safe route and forces the terrain
   * to each region's anchor height. Between them the ground is left at its
   * procedural height, which is many metres lower, so the graded ground is
   * effectively a raised causeway with shoulders far steeper than a horse can
   * climb. That makes the routes the only way inland, and it makes them one-way
   * once you leave them: everything that happens off a corridor has to happen
   * before the tour commits to riding it.
   */

  // 1. The opening frame: the storm beach, and the world naming itself.
  await wait(1.4);
  if (!SPOTS_ONLY) await capture("01-arrival", "Opening frame on the storm beach; the place names itself");

  // Headless Chromium refuses pointer lock, so the focus prompt would otherwise
  // dim every remaining capture. It is covered by the Playwright suite.
  await page.addStyleTag({ content: ".lr-focus { display: none !important; }" });

  const spawnState = await lab.state();

  // 2. Turn to the water and read the shoreline. The sea is outward from the
  //    island centre, so the camera faces away from the origin, not towards it.
  await lab.yaw(Math.atan2(spawnState.position.x, spawnState.position.z));
  await wait(1.6);
  if (!SPOTS_ONLY) await capture("02-shoreline", "Facing the sea from the coast: wet sand, surf band, haze");

  // 3. Out to the water's edge, where the boundary holds the horse on the
  //    compiled dry shelf. The coast excursions are captures, not navigation:
  //    the routes start at the spawn anchor either way, so a spot run skips
  //    them and spends its budget on actually getting inland.
  if (!SPOTS_ONLY) await driveTo(spawnState.position.x * 2.2, -250, { within: 3, timeout: 40, easeOff: false });
  await lab.gallop(false);
  await lab.move(0, 0);
  await wait(2.4);
  if (!SPOTS_ONLY) await capture("03-boundary", "Held at the sea boundary on the compiled dry shelf");

  // 4. Coastal scatter at riding height.
  const coastClump = nearestScatter("saltwind-coast", spawnState.position.x, spawnState.position.z);
  if (coastClump && !SPOTS_ONLY) {
    await driveTo(coastClump.position.x, coastClump.position.z, {
      within: coastClump.radius + 6,
      timeout: 34,
      gallop: false,
    });
    await lab.move(0, 0);
    await wait(1.2);
    if (!SPOTS_ONLY) await capture("04-coast-scatter", "Weathered rock and marram filling a coastal footprint");
  }

  // 5. The open gallop, taken along the storm beach. The coast is the widest
  //    ground the horse can reach without committing to a corridor.
  if (!SPOTS_ONLY) {
    await lab.yaw(Math.PI / 2);
    await lab.gallop(true);
    await lab.move(0, 1);
    await wait(3.4);
  }
  if (!SPOTS_ONLY) await capture("05-gallop", "Full gallop along the storm beach");

  // 6. The stride from the side, shuttered on the suspension phase. This is the
  //    Horse Lab embodiment arriving intact on compiled ground.
  if (!SPOTS_ONLY) {
    const gallopYaw = (await lab.state()).yaw;
    let framed = false;
    for (let step = 0; step < 70 && !framed; step += 1) {
      await lab.yaw(gallopYaw + Math.PI / 2);
      await lab.move(-1, 0);
      await wait(0.03);
      if (step > 10) framed = (await lab.state()).rigBodyHeight > 0.14;
    }
    await capture(
      "06-gallop-profile",
      `Gallop stride from the side, suspension phase (framed=${framed})`,
    );
  }

  // 7. Back to the start of the coast route and up it. This is the committing
  //    leg: from here on the corridor is the world.
  const coastRoute = route("coast-to-plain-safe-route-safe");
  if (coastRoute) {
    await driveRoute(coastRoute.waypoints.slice(0, 1), { within: 4, timeout: 40, pace: 1, routeId: "coast" });
    const half = Math.ceil(coastRoute.waypoints.length / 2);
    await driveRoute(coastRoute.waypoints.slice(1, half), { routeId: "coast" });
    await capture("07-safe-route", "On the worn safe route climbing off the coast");
    await driveRoute(coastRoute.waypoints.slice(half), { routeId: "coast" });
  }

  // 8. The longgrass opening from the height the route climbs to.
  await lab.move(0, 0);
  await wait(1.6);
  const plainAnchor = plan.regions.find((region) => region.id === "longgrass-opening");
  const plainClump = plainAnchor
    ? nearestScatter("longgrass-opening", plainAnchor.anchor.x, plainAnchor.anchor.z)
    : null;
  if (plainClump) {
    const at = await lab.state();
    await lab.yaw(
      Math.atan2(plainClump.position.x - at.position.x, plainClump.position.z - at.position.z),
    );
    await wait(1.6);
  }
  await capture("08-longgrass", "The longgrass opening and its boulder rhythms, from the route");

  // 9. On up the fernwood route from the same anchor the coast route ends at.
  const forestRoute = route("plain-to-forest-safe-route-safe");
  if (forestRoute) {
    await driveRoute(forestRoute.waypoints.slice(0, 1), { within: 4, timeout: 40, routeId: "fernwood" });
    await driveRoute(forestRoute.waypoints.slice(1, -4), { routeId: "fernwood" });
    await capture("09-fernwood-approach", "The fern edge rising ahead of the plain");
    await driveRoute(forestRoute.waypoints.slice(-4), { routeId: "fernwood" });
  }

  // 10. Standing in the fernwood and turning, which is what exercises the
  //     camera against real scenery.
  await lab.move(0, 0);
  await wait(1.4);
  let obstructed = false;
  let minimumDistance = Infinity;
  const standingYaw = (await lab.state()).yaw;
  for (let step = 0; step < 24; step += 1) {
    await lab.yaw(standingYaw + (step / 24) * Math.PI * 2);
    await wait(0.22);
    const state = await lab.state();
    minimumDistance = Math.min(minimumDistance, state.cameraDistance);
    if (state.cameraObstructed && !obstructed) {
      obstructed = true;
      await capture("10-fernwood", "Fernwood: camera pulled in by scenery");
    }
  }
  if (!obstructed) {
    await capture("10-fernwood", "Fernwood ground cover and canopy");
  }
  console.log(
    `  fernwood: obstruction seen=${obstructed} minimum camera distance=${minimumDistance.toFixed(2)}`,
  );

  // 11-14. The three mandatory discoveries, as built silhouettes.
  const overlook = discovery("first-overlook");
  if (overlook) {
    await driveTo(overlook.position.x, overlook.position.z, {
      within: 8,
      timeout: 30,
      gallop: false,
      pace: 0.6,
    });
    await lab.move(0, 0);
    await wait(1.4);
    if (!SPOTS_ONLY) await capture("11-overlook", "The overlook cairn on the fernwood ridge");
    const at = await lab.state();
    await lab.yaw(Math.atan2(-at.position.x, -at.position.z));
    await wait(1.8);
    if (!SPOTS_ONLY) await capture("12-long-view", "The long view back down the island from the overlook");
  }

  const spring = discovery("spring-resting-hollow");
  if (spring) {
    await driveTo(spring.position.x, spring.position.z, {
      within: 5,
      timeout: 24,
      gallop: false,
      pace: 0.5,
    });
    await lab.move(0, 0);
    await wait(1.4);
    if (!SPOTS_ONLY) await capture("13-spring", "The spring: still water ringed with stone");
  }

  const trace = discovery("first-herd-trace");
  if (trace) {
    await driveTo(trace.position.x, trace.position.z, {
      within: 4,
      timeout: 24,
      gallop: false,
      pace: 0.5,
    });
    await lab.move(0, 0);
    await wait(1.4);
    if (!SPOTS_ONLY) await capture("14-herd-trace", "Where the herd rested: the debris they left");
  }

  // 15. Diagnostics, showing the island's real budget numbers.
  await lab.settings({ showDiagnostics: true });
  await wait(0.7);
  if (!SPOTS_ONLY) await capture("15-diagnostics", "Diagnostics overlay on compiled ground");
  await lab.settings({ showDiagnostics: false });

  // 16. Standing still, and the silhouette from the side.
  await wait(2.6);
  if (!SPOTS_ONLY) await capture("16-idle", "Standing still");
  const standing = await lab.state();
  await lab.yaw(standing.yaw + Math.PI / 2);
  await wait(2.2);
  if (!SPOTS_ONLY) await capture("17-profile", "Horse silhouette against compiled terrain");

  // 17. Pause surface, unchanged from the proven build.
  await lab.command({ type: "Pause" });
  await wait(0.9);
  if (!SPOTS_ONLY) await capture("18-pause", "Pause and settings surface");
  await lab.command({ type: "Resume" });

  await page.close();
}
