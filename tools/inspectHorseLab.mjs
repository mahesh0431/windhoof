/**
 * Render-inspect-refine driver.
 *
 * Opens the real build in a real browser, drives the horse into representative
 * gameplay states through the lab harness, and writes canonical views to
 * docs/evidence. This is the Longride equivalent of the WorldClaw method's
 * render-and-inspect step: screenshots of a game that never moved prove nothing.
 *
 * It starts and stops its own Vite server, so it runs from a clean checkout
 * with nothing else already running. Pass a URL to point it at a server you are
 * already running instead.
 *
 * Usage: pnpm inspect [baseUrl]
 * Exits non-zero if the run produced console errors.
 */
import { chromium } from "@playwright/test";
import { automationUrl } from "./automationUrl.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const OUTPUT_DIR = path.resolve("docs/evidence");
const VIEWPORT = { width: 1600, height: 900 };
const NARROW_VIEWPORT = { width: 1024, height: 640 };

const consoleErrors = [];
const captures = [];

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
  await runTour(baseUrl);

  await writeFile(
    path.join(OUTPUT_DIR, "inspection.json"),
    `${JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        viewport: VIEWPORT,
        consoleErrors,
        captures,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\nconsole errors: ${consoleErrors.length}`);
  for (const error of consoleErrors) console.log(`  ! ${error}`);
  if (consoleErrors.length > 0) process.exitCode = 1;
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

  const url = `http://127.0.0.1:${address.port}`;
  console.log(`serving ${url}\n`);
  return url;
}

async function runTour(baseUrl) {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  const hiddenFocusPrompt = await boot(page, baseUrl);

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
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`) });
    captures.push({ name, note, state });
    const position = state.position;
    console.log(
      `${name.padEnd(24)} gait=${String(state.gait).padEnd(7)} ` +
        `speed=${state.speed.toFixed(1).padStart(5)} ` +
        `y=${position.y.toFixed(2).padStart(6)} ` +
        `pos=(${position.x.toFixed(0)},${position.z.toFixed(0)}) ` +
        `grounded=${state.grounded} cam=${state.cameraDistance.toFixed(2)}` +
        `${state.cameraObstructed ? " OBSTRUCTED" : ""} ` +
        `draws=${state.drawCalls} tris=${state.triangles}`,
    );
    return state;
  }

  /**
   * Steers towards a stage feature by aiming the camera at it, exactly the way
   * a player would. Movement stays camera-relative, so nothing here bypasses
   * the controller.
   */
  async function driveTo(targetX, targetZ, options = {}) {
    const { within = 8, timeout = 20, gallop = true, easeOff = true } = options;
    await lab.move(0, 1);
    const deadline = Date.now() + timeout * 1000;
    let last = null;

    while (Date.now() < deadline) {
      last = await lab.state();
      const dx = targetX - last.position.x;
      const dz = targetZ - last.position.z;
      const remaining = Math.hypot(dx, dz);
      if (remaining < within) break;
      // A galloping horse turns in a ~26 m circle, so approaching a small
      // target at full speed just orbits it. Ease off exactly as a player would.
      // Uphill and long-haul targets pass easeOff: false and keep their speed,
      // which is also what a player does: nobody slows down before a hill.
      await lab.gallop(gallop && (!easeOff || remaining > 40));
      await lab.move(0, !easeOff || remaining > 18 ? 1 : 0.5);
      await lab.yaw(Math.atan2(dx, dz));
      await wait(0.1);
    }

    return last;
  }

  // 1. Opening view, before the player has touched anything.
  await wait(1.9);
  await capture("01-spawn", "Opening frame with the first onboarding hint");

  // 2. Diagnostics presentation.
  await lab.settings({ showDiagnostics: true });
  await wait(0.6);
  await capture("02-diagnostics", "Diagnostics overlay");
  await lab.settings({ showDiagnostics: false });

  // 3. Walk, then trot.
  await lab.move(0, 0.3);
  await wait(1.9);
  await capture("03-walk", "Walking gait and terrain reading");

  // The pointer-focus prompt in its riding form. A keyboard-only player never
  // takes pointer lock, so this corner pill is what they live with; it must not
  // dim the view or sit under the diagnostics overlay.
  await hiddenFocusPrompt.evaluate((node) => node.remove());
  await wait(0.5);
  await capture("20-focus-pill", "Riding without pointer lock; prompt recedes to a pill");
  await page.addStyleTag({ content: ".lr-focus { display: none !important; }" });

  await lab.move(0, 0.6);
  await wait(2.2);
  await capture("04-trot", "Trot");

  // 4. Open gallop down the corridor.
  await lab.move(0, 1);
  await lab.gallop(true);
  await wait(2.6);
  await capture("05-gallop", "Full gallop on open ground");

  // 5. Jump on open ground, well before the stream. Waiting on the state rather
  // than a fixed delay is what lands this on a genuinely airborne frame.
  await lab.press("jumpPressed");
  await page.waitForFunction(
    () => window.__longrideLab.state().verticalVelocity > 3,
    null,
    { timeout: 4000 },
  );
  await capture("06-airborne", "Rising after a jump at gallop");
  await page.waitForFunction(() => window.__longrideLab.state().grounded === true, null, {
    timeout: 6000,
  });
  await capture("07-landed", "Back on the ground");

  // 6. The stream crossing.
  await page.waitForFunction(() => window.__longrideLab.state().position.z > -14, null, {
    timeout: 12_000,
  });
  await capture("08-stream-approach", "Approaching the stream at gallop");
  await lab.press("jumpPressed");
  await wait(0.45);
  await capture("09-stream-jump", "Over the stream; deep trench on both flanks");

  // 7. Onto the plateau and off its steep north face. The ramp is a 21-degree
  //    climb, so the horse carries speed onto it rather than easing off first.
  await driveTo(-6, 28, { within: 6, timeout: 20, easeOff: false });
  await capture("10-plateau", "On the raised plateau before the drop");
  await driveTo(-6, 44, { within: 6, timeout: 14 });
  await capture("11-after-drop", "After dropping off the steep north face");

  // 8. Into the grove, then look around from inside it. Standing among trunks
  // and turning is the case that actually exercises obstruction handling.
  await driveTo(45, 30, { within: 7, timeout: 40, gallop: false });
  await lab.move(0, 0);
  await wait(1.6);

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
      await capture("12-grove-camera", "Camera pulled in by a tree in the grove");
    }
  }
  if (!obstructed) {
    await capture("12-grove-camera", "In the grove, no obstruction registered");
  }
  console.log(
    `  grove: obstruction seen=${obstructed} minimum camera distance=${minimumDistance.toFixed(2)}`,
  );

  // 9. The overlook, for the long view over the plot.
  // The knoll is a hundred metres back across the plot, so this leg gets the
  // time to actually arrive rather than timing out somewhere on the way.
  await driveTo(-30, 50, { within: 16, timeout: 30, easeOff: false });
  await driveTo(-58, 58, { within: 10, timeout: 24, easeOff: false });
  await capture("13-overlook", "From the overlook knoll");

  // 10. Ride into the shallows and confirm the boundary holds.
  await driveTo(0, 130, { within: 4, timeout: 22 });
  await capture("14-boundary", "Stopped in the shallows at the stage boundary");

  // Then along the water line rather than into it. Standing still proves the
  // boundary holds; moving is what shows whether the wet ground answers the
  // hooves and whether the shore reads as an edge rather than as open ocean.
  await lab.gallop(false);
  const shoreYaw = (await lab.state()).yaw;
  for (let step = 0; step < 16; step += 1) {
    await lab.yaw(shoreYaw - Math.PI / 2);
    await lab.move(0, 0.7);
    await wait(0.1);
  }
  await capture("22-shore-splash", "Trotting the water line; hooves throw spray");

  // 11. Back onto grass down the open northern plain, which is the flattest
  //     long run in the lab. That matters: a side-on capture taken on sloping
  //     ground puts the camera inside the hillside and crops the horse's legs
  //     off, which is exactly what the first attempt at this shot produced.
  await driveTo(0, 62, { within: 12, timeout: 22, easeOff: false });

  // The stride, seen from the side. A chase view straight down the horse's
  // back hides everything the blind playtest called flat: reach, suspension,
  // and the flexing back. Steering compensates for the camera turn (move -1,0
  // means "left of camera", which is straight ahead once the camera is ninety
  // degrees round), so the horse holds its line and keeps galloping.
  //
  // The shutter waits for the suspension phase. A stride at 16 m/s lasts about
  // 0.43 s, so an untimed capture lands wherever it lands, and the frame that
  // proves the horse is a body rather than a rail is the one where it is off
  // the ground entirely.
  const gallopYaw = (await lab.state()).yaw;
  let framed = false;
  for (let step = 0; step < 60 && !framed; step += 1) {
    // Re-asserted each step because the camera slowly auto-aligns behind the
    // horse and would swing back before the shutter.
    await lab.yaw(gallopYaw + Math.PI / 2);
    await lab.move(-1, 0);
    await wait(0.03);
    if (step > 10) framed = (await lab.state()).rigBodyHeight > 0.14;
  }
  await capture(
    "21-gallop-profile",
    `Gallop stride from the side, suspension phase (framed=${framed})`,
  );

  // Settle on open grass rather than wherever the profile run happened to end;
  // the silhouette capture below should not be standing inside the grove.
  await lab.yaw(gallopYaw);
  await lab.move(0, 1);
  await driveTo(-14, 58, { within: 8, timeout: 18 });
  await lab.gallop(false);
  await lab.move(0, 0);
  await wait(3.4);
  await capture("15-idle", "Standing still");

  const standing = await lab.state();
  await lab.yaw(standing.yaw + Math.PI / 2);
  await wait(2.2);
  await capture("16-horse-profile", "Horse silhouette from the side");

  // 12. Pause surface.
  await lab.command({ type: "Pause" });
  await wait(0.9);
  await capture("17-pause", "Pause and settings surface");
  await page.evaluate(() => {
    document.querySelectorAll(".lr-tab")[1]?.click();
  });
  await wait(0.5);
  await capture("18-controls", "Controls list");

  // 13. The same pause surface on a smaller window, where a settings panel is
  // most likely to overflow or collapse badly.
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.evaluate(() => {
    document.querySelectorAll(".lr-tab")[0]?.click();
  });
  await wait(0.8);
  await capture("19-pause-narrow", `Pause surface at ${NARROW_VIEWPORT.width}px`);
  await page.setViewportSize(VIEWPORT);
  await lab.command({ type: "Resume" });

  await page.close();
}

async function boot(page, baseUrl) {
  await page.goto(automationUrl(baseUrl, { stage: "lab" }), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__longrideLab?.ready === true, null, {
    timeout: 45_000,
  });
  await page.waitForSelector("html[data-longride='running']");

  // Headless Chromium refuses pointer lock, so the "click to look around"
  // prompt would sit dimmed over every capture. Hiding it is a capture-only
  // concern; the prompt itself is covered by the Playwright suite and shown
  // deliberately in one capture below.
  const style = await page.addStyleTag({
    content: ".lr-focus { display: none !important; }",
  });
  await page.waitForTimeout(200);
  return style;
}
