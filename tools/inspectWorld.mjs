/**
 * Render-inspect-refine driver for the island's ground and vegetation.
 *
 * The world is not a thing you can photograph the way a horse is: it has no
 * turntable and no single subject, and riding to five regions under SwiftShader
 * is an hour of automation. So this holds the camera at each region's own
 * anchor, at a rider's eye height, and takes the picture - the same `observe`
 * seam and the same limits recorded in DECISIONS.md: this is evidence that a
 * place exists and looks the way it is claimed to, and never evidence that a
 * player can get there.
 *
 * Every region lands in one contact sheet, because the whole question a
 * vegetation change has to answer is whether the five places still read as five
 * different countries, and that cannot be judged one screenshot at a time.
 *
 * Usage:
 *   node tools/inspectWorld.mjs             every region, eye level
 *   node tools/inspectWorld.mjs --close     knee height, for ground cover
 *   node tools/inspectWorld.mjs --wide      from above, for region shape
 */
import { chromium } from "@playwright/test";
import { automationUrl } from "./automationUrl.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const OUTPUT_DIR = path.resolve("docs/evidence/world");
const VIEWPORT = { width: 900, height: 560 };
const BOOT_BUDGET_MS = 300_000;

/**
 * Where the camera stands, per mode.
 *
 * `close` is the one that matters for ground cover: a tuft that reads at eye
 * level from twelve metres can still be a scattering of spikes underfoot, and
 * underfoot is where the player spends the whole game.
 */
const MODES = {
  eye: { distance: 15, eye: 2.4, aim: 1.2, bearing: 0.7, label: "eye level" },
  // Well off the anchor: a region's anchor sits on the safe route, the worn line
  // is deliberately bare, and a camera standing on it photographs the one strip
  // of the island that is supposed to have no grass on it.
  close: { distance: 17, eye: 1.3, aim: 0.7, bearing: 2.1, label: "knee height" },
  wide: { distance: 90, eye: 26, aim: 4, bearing: 0.7, label: "from above" },
};

/** `--tod=0.5` pins the time of day, so dusk and night can be photographed. */
const todArgument = process.argv.find((argument) => argument.startsWith("--tod="));
const timeOfDay = todArgument ? Number(todArgument.slice(6)) : null;

const mode = process.argv.includes("--close")
  ? "close"
  : process.argv.includes("--wide")
    ? "wide"
    : "eye";
const view = MODES[mode];

const consoleErrors = [];
let server;
let browser;

try {
  const explicitUrl = process.argv.find((argument) => argument.startsWith("http"));
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

  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  console.log("booting the island...");
  const started = Date.now();
  const pageUrl =
    timeOfDay === null
      ? automationUrl(baseUrl)
      : `${automationUrl(baseUrl)}&tod=${timeOfDay}`;
  await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__longrideLab?.ready === true, null, {
    timeout: BOOT_BUDGET_MS,
  });
  await page.waitForSelector("html[data-longride='running']");
  // The interface is not the subject here, and the focus prompt dims the view
  // it is covering.
  await page.addStyleTag({
    content: ".lr-focus, .lr-hint, .lr-journey, .lr-place { display: none !important; }",
  });
  await page.waitForTimeout(1200);
  console.log(`booted in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const regions = await page.evaluate(() => window.__longrideLab.regions?.() ?? []);
  if (regions.length === 0) throw new Error("the harness exposed no regions");

  const panels = [];
  for (const region of regions) {
    const image = await shoot(page, region.anchor.x, region.anchor.z);
    panels.push({ label: `${region.id} - ${view.label}`, image });
    console.log(`  ${region.id}`);
  }

  const suffix = timeOfDay === null ? "" : `-tod${timeOfDay}`;
  const file = path.join(OUTPUT_DIR, `regions-${mode}${suffix}.png`);
  await writeSheet(page, panels, file);
  console.log(`\n${path.relative(process.cwd(), file)}`);

  const state = await page.evaluate(() => window.__longrideLab.state());
  console.log(`draws=${state.drawCalls} tris=${state.triangles}`);
  await writeFile(
    path.join(OUTPUT_DIR, `regions-${mode}.json`),
    `${JSON.stringify({ mode, view, regions, drawCalls: state.drawCalls, triangles: state.triangles, consoleErrors }, null, 2)}\n`,
  );

  console.log(`console errors: ${consoleErrors.length}`);
  for (const error of consoleErrors) console.log(`  ! ${error}`);
  if (consoleErrors.length > 0) process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
}

/** Places the camera around a point and returns the frame as a data URL. */
async function shoot(page, x, z) {
  const from = {
    x: x + Math.sin(view.bearing) * view.distance,
    z: z + Math.cos(view.bearing) * view.distance,
  };
  const ground = await page.evaluate(
    ([a, b]) => window.__longrideLab.heightAt?.(a, b) ?? 0,
    [from.x, from.z],
  );
  const target = await page.evaluate(
    ([a, b]) => window.__longrideLab.heightAt?.(a, b) ?? 0,
    [x, z],
  );
  await page.evaluate(
    ([eye, look]) => window.__longrideLab.observe?.(eye, look),
    [
      { x: from.x, y: ground + view.eye, z: from.z },
      { x, y: target + view.aim, z },
    ],
  );
  // The camera move needs a frame to land, and a WebGL canvas does not keep its
  // drawing buffer, so the frame is taken by the browser rather than read back
  // out of the context.
  // Long enough for the near-grass window to refill around the new viewpoint.
  await page.waitForTimeout(1600);
  const png = await page.locator("#longride-canvas").screenshot();
  const state = await page.evaluate(() => window.__longrideLab.state());
  console.log(
    `      draws=${state.drawCalls} tris=${state.triangles} ` +
      `nearGrass=${state.nearGrassBlades} pending=${state.nearGrassPending}`,
  );
  return `data:image/png;base64,${png.toString("base64")}`;
}

/** Lays the frames out as one labelled sheet and screenshots it. */
async function writeSheet(page, panels, file) {
  const columns = panels.length <= 4 ? 2 : 2;
  await page.setContent(
    `<style>
      body { margin: 0; background: #14181a; font: 13px system-ui; color: #cfd6d2; }
      .grid { display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: 4px; }
      figure { margin: 0; position: relative; }
      img { display: block; width: 100%; }
      figcaption { position: absolute; left: 6px; bottom: 5px; padding: 2px 7px;
        background: #000a; border-radius: 4px; letter-spacing: .04em; }
    </style>
    <div class="grid">${panels
      .map((panel) => `<figure><img src="${panel.image}"><figcaption>${panel.label}</figcaption></figure>`)
      .join("")}</div>`,
  );
  await page.setViewportSize({ width: columns * VIEWPORT.width, height: 400 });
  await page.locator(".grid").screenshot({ path: file });
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
