import { chromium } from "@playwright/test";
import { automationUrl } from "./automationUrl.mjs";
import { createServer } from "vite";

const server = await createServer({
  logLevel: "warn",
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await server.listen();
const { port } = server.httpServer.address();
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 800, height: 480 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(automationUrl(`http://127.0.0.1:${port}`), { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__windhoofLab?.ready === true, null, { timeout: 90_000 });

const target = { x: 10.31, z: 65.78 };

const info = await page.evaluate(async (p) => {
  const { VERTICAL_SLICE_SPEC } = await import("/src/world/verticalSliceSpec.ts");
  const { compileWorldAsync } = await import("/src/game/world/runtime/compileWorldAsync.ts");
  const { sampleManifest } = await import("/src/game/world/runtime/sampleManifest.ts");
  const m = await compileWorldAsync(VERTICAL_SLICE_SPEC);
  const rows = [];
  for (let dz = 8; dz >= -8; dz -= 2) {
    const row = [];
    for (let dx = -8; dx <= 8; dx += 2) {
      const s = sampleManifest(m, p.x + dx, p.z + dz);
      row.push(`${s.height.toFixed(1)}/${String(Math.round(s.slopeDegrees)).padStart(2)}${s.traversable ? " " : "X"}`);
    }
    rows.push(`z${(p.z + dz).toFixed(0).padStart(4)} ${row.join(" ")}`);
  }
  const near = m.placements
    .map((q) => ({
      id: q.id,
      d: Math.hypot(q.position.x - p.x, q.position.z - p.z),
      r: q.collisionRadiusMeters,
      s: q.scale,
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);
  const routes = m.routes.map((r) => ({
    id: r.id,
    near: Math.min(
      ...r.waypoints.map((w) => Math.hypot(w.x - p.x, w.z - p.z)),
    ).toFixed(1),
    width: r.widthMeters,
  }));
  return { rows, near, routes };
}, target);

console.log("height/slope grid, 2 m steps (X = not traversable), rows north to south:");
for (const row of info.rows) console.log("  " + row);
console.log("nearest placements:", JSON.stringify(info.near));
console.log("routes:", JSON.stringify(info.routes));

const lab = {
  state: () => page.evaluate(() => window.__windhoofLab.state()),
  move: (x, y) => page.evaluate(([a, b]) => window.__windhoofLab.setMove(a, b), [x, y]),
  gallop: (v) => page.evaluate((v2) => window.__windhoofLab.setGallop(v2), v),
  yaw: (v) => page.evaluate((v2) => window.__windhoofLab.setCameraYaw(v2), v),
};

async function driveTo(tx, tz, seconds, within = 5) {
  await lab.move(0, 1);
  await lab.gallop(true);
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const s = await lab.state();
    const dx = tx - s.position.x;
    const dz = tz - s.position.z;
    const remaining = Math.hypot(dx, dz);
    if (remaining < within) break;
    await lab.gallop(remaining > 40);
    await lab.move(0, remaining > 18 ? 1 : 0.5);
    await lab.yaw(Math.atan2(dx, dz));
    await page.waitForTimeout(120);
  }
  return lab.state();
}

const at = await driveTo(target.x, target.z, 70, 3);
console.log(
  "arrived",
  JSON.stringify({
    x: +at.position.x.toFixed(2),
    y: +at.position.y.toFixed(2),
    z: +at.position.z.toFixed(2),
    speed: +at.speed.toFixed(1),
  }),
);

for (let i = 0; i < 8; i += 1) {
  const yaw = (i / 8) * Math.PI * 2;
  await lab.yaw(yaw);
  await lab.move(0, 1);
  await lab.gallop(false);
  const before = await lab.state();
  await page.waitForTimeout(1600);
  const after = await lab.state();
  console.log(
    `yaw=${yaw.toFixed(2)} moved=${Math.hypot(after.position.x - before.position.x, after.position.z - before.position.z).toFixed(2)} speed=${after.speed.toFixed(1)} pos=(${after.position.x.toFixed(2)},${after.position.y.toFixed(2)},${after.position.z.toFixed(2)})`,
  );
}

await browser.close();
await server.close();
