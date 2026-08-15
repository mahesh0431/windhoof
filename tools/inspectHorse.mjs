/**
 * Horse render-inspect-refine driver.
 *
 * Photographs the rig from every side and in every gait, away from the terrain
 * and the chase camera, so a model change can be judged on the model rather
 * than on whatever the ride happened to be doing. Companion to
 * tools/inspectHorseLab.mjs, which judges the same horse in play.
 *
 * Usage:
 *   pnpm inspect:horse                  both contact sheets
 *   pnpm inspect:horse profile          one named view, full frame
 *   pnpm inspect:horse --views          list the available view names
 *
 * Exits non-zero if the page reported a console error.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const OUTPUT_DIR = path.resolve("docs/evidence/horse");
const TURNAROUND = ["profile", "quarter", "front", "rear", "head", "above"];
const GAITS = ["walk", "trot", "gallop", "gallopQuarter"];
/** The island's twenty-six wild horses, in the two poses they are baked in. */
const WILD = ["wildStanding", "wildGrazing", "kick"];

const consoleErrors = [];
let server;
let browser;

try {
  const requested = process.argv[2];
  const baseUrl = await startServer();
  browser = await chromium.launch({
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--ignore-gpu-blocklist",
    ],
  });

  await mkdir(OUTPUT_DIR, { recursive: true });

  const page = await browser.newPage({
    viewport: { width: 1700, height: 1300 },
    deviceScaleFactor: 1,
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  await page.goto(`${baseUrl}/tools/horsePreview.html`, { waitUntil: "load" });
  await page.waitForSelector("html[data-horse-preview='ready']", { timeout: 30_000 });

  if (requested === "--views") {
    const views = await page.evaluate(() => window.__horsePreview.views);
    console.log(views.join("\n"));
  } else if (requested) {
    await capture(page, requested, () =>
      page.evaluate((name) => window.__horsePreview.single(name, 1100, 1100), requested),
    );
  } else {
    await capture(page, "turnaround", () =>
      page.evaluate((names) => window.__horsePreview.sheet(names, 3, 560, 600), TURNAROUND),
    );
    await capture(page, "gaits", () =>
      page.evaluate((names) => window.__horsePreview.sheet(names, 2, 800, 620), GAITS),
    );
    await capture(page, "wild", () =>
      page.evaluate((names) => window.__horsePreview.sheet(names, 3, 560, 620), WILD),
    );
  }

  console.log(`console errors: ${consoleErrors.length}`);
  for (const error of consoleErrors) console.log(`  ! ${error}`);
  if (consoleErrors.length > 0) process.exitCode = 1;
} finally {
  await browser?.close();
  await server?.close();
}

async function capture(page, name, draw) {
  await draw();
  const file = path.join(OUTPUT_DIR, `${name}.png`);
  await page.locator("#preview").screenshot({ path: file });
  const model = await page.evaluate(() => window.__horsePreview.model());
  console.log(
    `${name.padEnd(12)} ${path.relative(process.cwd(), file)}  ` +
      `model=${model.triangles} tris / ${model.meshes} draws`,
  );
  // Ground truth, literally: any pose whose lowest point is below zero has put
  // the horse's feet through the floor.
  for (const subject of ["idle", "walk", "trot", "gallop"]) {
    const low = await page.evaluate((s) => window.__horsePreview.sweepLowest(s), subject);
    const flag = low < -0.02 ? "  <-- through the ground" : "";
    console.log(`  ${subject.padEnd(14)} worst over a cycle=${low.toFixed(3)}${flag}`);
  }
  for (const subject of ["wildStanding", "wildGrazing", "kick"]) {
    const low = await page.evaluate((s) => window.__horsePreview.lowest(s), subject);
    const flag = low < -0.02 ? "  <-- through the ground" : "";
    console.log(`  ${subject.padEnd(14)} lowest=${low.toFixed(3)}${flag}`);
  }
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
