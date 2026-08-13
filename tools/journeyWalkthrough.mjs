/**
 * Rides the authored Milestone 4 journey end to end and photographs it.
 *
 * This is the presentation counterpart to the exploration unit tests. Those
 * prove the state machine is correct; this proves a player can actually get
 * through the arc using nothing but the interface, and produces the frames that
 * show what they see while doing it.
 *
 * Everything here goes through the same input buffer the keyboard writes into.
 * The horse is never teleported and no discovery is ever completed by calling
 * into the simulation: a beat that cannot be reached by riding to it and
 * pressing a key is recorded as a failure, because that is what it would be for
 * the player.
 *
 * Usage: pnpm journey:walkthrough [baseUrl]
 */
import { chromium } from "@playwright/test";
import { automationUrl } from "./automationUrl.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

const OUTPUT_DIR = path.resolve("docs/evidence/milestone-4");

/**
 * Where the compiled 0.4.0 world puts the story scenes.
 *
 * These are read back out of the manifest at run time and only used to steer;
 * the constants below are the expected values, and a mismatch is reported rather
 * than silently ridden around. An earlier version of this file hard-coded three
 * points that had collapsed within seven metres of each other, and every frame
 * it produced was of the same patch of ground.
 */
const EXPECTED_SCENES = {
  "first-herd-trace": { x: -58.3, z: 103.2 },
  "spring-resting-hollow": { x: 27.7, z: 146.2 },
  "first-overlook": { x: 89.7, z: 90.2 },
  "plain-wildlife-crossing": { x: 58.1, z: -0.8 },
};
/** Two scenes closer than this are not separate places to a player. */
const MINIMUM_SCENE_SEPARATION_METRES = 40;
const VIEWPORT = { width: 1600, height: 900 };
const RUN_BUDGET_MS = Number(process.env.WINDHOOF_RUN_BUDGET_MS ?? 900_000);

const beats = [];
const failures = [];
/** The compiled scene geometry this run actually rode, filled in at boot. */
let layout = null;
const consoleErrors = [];
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
  await walkthrough(baseUrl);

  const report = {
    viewport: VIEWPORT,
    layout,
    beats,
    failures,
    consoleErrors,
  };
  await writeFile(
    path.join(OUTPUT_DIR, "walkthrough.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(`\n${beats.length} beats captured, ${failures.length} failed`);
  for (const failure of failures) console.log(`  ! ${failure.beat}: ${failure.reason}`);
  console.log(`console errors: ${consoleErrors.length}`);
  for (const error of consoleErrors) console.log(`  ! ${error}`);
  if (failures.length > 0 || consoleErrors.length > 0) process.exitCode = 1;
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

async function walkthrough(baseUrl) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));

  const lab = {
    state: () => page.evaluate(() => window.__windhoofLab.state()),
    move: (x, y) => page.evaluate(([a, b]) => window.__windhoofLab.setMove(a, b), [x, y]),
    gallop: (on) => page.evaluate((v) => window.__windhoofLab.setGallop(v), on),
    press: (action) => page.evaluate((a) => window.__windhoofLab.press(a), action),
    yaw: (value) => page.evaluate((v) => window.__windhoofLab.setCameraYaw(v), value),
    command: (command) => page.evaluate((c) => window.__windhoofLab.command(c), command),
  };
  const wait = (seconds) => page.waitForTimeout(seconds * 1000);

  // Counted in the page before any application code runs. Muting is a promise
  // the automation makes, and this is what proves it was kept rather than
  // assumed.
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

  const boot = async () => {
    await page.goto(automationUrl(baseUrl), { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__windhoofLab?.ready === true, null, {
      timeout: 120_000,
    });
    await page.waitForSelector("html[data-windhoof='running']");
    // The focus scrim is a click target, not part of the journey; it would sit
    // over every frame otherwise.
    await page.addStyleTag({ content: ".wh-focus { display: none !important; }" });
    await wait(0.6);
  };

  /** Everything the interface is showing, read from the DOM rather than assumed. */
  const chrome = () =>
    page.evaluate(() => {
      const visible = (selector) => {
        const node = document.querySelector(selector);
        return node instanceof HTMLElement && node.dataset.visible === "true";
      };
      const text = (selector) =>
        document.querySelector(selector)?.textContent?.trim() ?? null;
      return {
        goalVisible: visible(".wh-goal"),
        goalText: text(".wh-goal-text"),
        promptVisible: visible(".wh-prompt"),
        promptText: text(".wh-prompt-text"),
        discoveryVisible: visible(".wh-discovery"),
        discoveryName: text(".wh-discovery-name"),
        discoveryBody: text(".wh-discovery-body"),
        bearingVisible: visible(".wh-bearing"),
        bearingDistance: text(".wh-bearing-distance"),
        saveVisible: visible(".wh-save"),
        noticeVisible: visible(".wh-notice"),
        noticeText: text(".wh-notice"),
        storageVisible: visible(".wh-storage"),
        storageTitle: text(".wh-storage-title"),
        storageReason: text(".wh-storage-reason"),
        storageActions: [...document.querySelectorAll(".wh-storage-actions .wh-button")]
          .filter((button) => !button.hidden)
          .map((button) => button.textContent?.trim() ?? ""),
        journeySummary: text(".wh-journey-summary"),
        journeyItems: [...document.querySelectorAll(".wh-journey-item")].map((item) => ({
          name: item.querySelector(".wh-journey-item-name")?.textContent?.trim() ?? "",
          state: item.dataset.state ?? "",
        })),
      };
    });

  async function capture(name, note, expectation) {
    const state = await lab.state();
    const ui = await chrome();
    const audioContexts = await page.evaluate(() => window.__audioContexts ?? []);
    if (audioContexts.length > 0 || state.audioContextCreated || state.audioRunning) {
      failures.push({ beat: name, reason: "the muted build reached for audio" });
    }
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`) });
    const problem = expectation ? expectation({ state, ui }) : null;
    beats.push({
      name,
      note,
      screenshot: `${name}.png`,
      position: {
        x: Number(state.position.x.toFixed(1)),
        z: Number(state.position.z.toFixed(1)),
      },
      regionId: state.regionId ?? null,
      journey: state.journey ?? null,
      audio: {
        muted: state.audioMuted,
        contextsConstructed: audioContexts.length,
        contextCreated: state.audioContextCreated,
        running: state.audioRunning,
      },
      ui,
      ok: problem === null,
      problem,
    });
    if (problem) failures.push({ beat: name, reason: problem });
    console.log(
      `${name.padEnd(30)} ${problem ? `FAIL ${problem}` : "ok"}  ` +
        `pos=(${state.position.x.toFixed(0)},${state.position.z.toFixed(0)}) ` +
        `region=${state.regionId ?? "-"}`,
    );
    return { state, ui };
  }

  /** Steers by camera and legs, measuring progress in world coordinates only. */
  async function rideTo(targetX, targetZ, options = {}) {
    const { within = 8, timeout = 90, pace = 1 } = options;
    const deadline = Date.now() + timeout * 1000;
    const NO_PROGRESS_MS = 6000;
    let closest = Infinity;
    let lastProgressAt = Date.now();
    let recoveries = 0;

    await lab.move(0, pace);
    while (Date.now() < deadline && !outOfTime()) {
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
      } else if (Date.now() - lastProgressAt > NO_PROGRESS_MS) {
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
      await lab.move(0, remaining > 20 ? pace : pace * 0.45);
      await lab.yaw(Math.atan2(dx, dz));
      await wait(0.1);
    }
    await halt();
    return { arrived: false, remaining: closest, reason: outOfTime() ? "budget" : "timeout" };
  }

  /**
   * Comes to a genuine stop.
   *
   * The contextual offer requires the horse to be standing on its own last safe
   * pose, which is a real gameplay rule and not something to work around: a
   * player who wants to look at something has to actually stop at it.
   */
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

  /**
   * Turns the camera to look at something, so a frame shows the place.
   *
   * The chase camera trails whatever heading the horse arrived on, which for a
   * ride that ends by walking onto a discovery means photographing the horse's
   * back and the ground it just crossed. A player would look around; this is
   * that, and it moves nothing but the camera.
   */
  async function lookAt(x, z) {
    const state = await lab.state();
    await lab.yaw(Math.atan2(x - state.position.x, z - state.position.z));
    await wait(0.9);
  }

  /**
   * Finds a spot at a discovery where the horse can actually be offered it.
   *
   * The offer is only made when the horse is standing on its own last safe
   * pose, and that pose stops updating while it is pressed against something.
   * Inside the fernwood the trace is ringed with trunks, so arriving within the
   * visit radius is not the same as arriving somewhere you can stand - the
   * first run stopped a few metres out, wedged, and was never offered anything.
   *
   * A player would take a step and try again, so that is what this does: step
   * off in a different direction, come back in, and stop. It never presses the
   * key on the player's behalf and never moves the horse anywhere it could not
   * ride, so a failure here stays a real failure.
   */
  async function settleAt(id, x, z) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const state = await lab.state();
      if (state.journey?.interactionId === id) return true;
      // Approach from a different bearing each time, ending a couple of metres
      // short of the centre so the stop itself is on open ground.
      const bearing = attempt * (Math.PI * 2 / 5) + 0.4;
      const standoff = 6;
      await rideTo(x + Math.sin(bearing) * standoff, z + Math.cos(bearing) * standoff, {
        within: 2.5,
        timeout: 40,
        pace: 0.6,
      });
      await rideTo(x, z, { within: 2, timeout: 40, pace: 0.5 });
    }
    return (await lab.state()).journey?.interactionId === id;
  }

  // ---------------------------------------------------------------- beats --

  await boot();

  /**
   * The compiled truth about where the scenes are.
   *
   * Steering is done from this rather than from the constants above, so the
   * walkthrough always rides the world that is actually built. The separation
   * check is the thing that would have caught the collapsed layout: three story
   * beats within a few metres of each other are one place wearing three names.
   */
  const scenes = await page.evaluate(() => ({
    manifestHash: window.__windhoofLab.state().manifestHash,
    discoveries: Object.fromEntries(
      window.__windhoofLab.scenes().map((scene) => [
        scene.id,
        {
          x: Number(scene.position.x.toFixed(1)),
          z: Number(scene.position.z.toFixed(1)),
          visitRadiusMeters: scene.visitRadiusMeters,
          mandatory: scene.mandatory,
        },
      ]),
    ),
  }));

  const at = (id) => {
    const scene = scenes.discoveries[id];
    if (!scene) throw new Error(`the compiled world has no ${id}`);
    return scene;
  };

  layout = { manifestHash: scenes.manifestHash, scenes: scenes.discoveries, separations: [] };
  const mandatoryIds = Object.keys(scenes.discoveries).filter(
    (id) => scenes.discoveries[id].mandatory,
  );
  for (let i = 0; i < mandatoryIds.length; i += 1) {
    for (let j = i + 1; j < mandatoryIds.length; j += 1) {
      const a = at(mandatoryIds[i]);
      const b = at(mandatoryIds[j]);
      const metres = Number(Math.hypot(a.x - b.x, a.z - b.z).toFixed(1));
      layout.separations.push({ from: mandatoryIds[i], to: mandatoryIds[j], metres });
      if (metres < MINIMUM_SCENE_SEPARATION_METRES) {
        failures.push({
          beat: "layout",
          reason: `${mandatoryIds[i]} and ${mandatoryIds[j]} are only ${metres} m apart`,
        });
      }
      // A scene inside another scene's visit radius is not a separate beat: the
      // player would complete one by standing at the other.
      if (metres <= Math.max(a.visitRadiusMeters, b.visitRadiusMeters)) {
        failures.push({
          beat: "layout",
          reason: `${mandatoryIds[i]} sits inside ${mandatoryIds[j]}'s visit radius`,
        });
      }
    }
  }
  for (const [id, expectedScene] of Object.entries(EXPECTED_SCENES)) {
    const actual = scenes.discoveries[id];
    if (!actual) continue;
    const drift = Math.hypot(actual.x - expectedScene.x, actual.z - expectedScene.z);
    if (drift > 2) {
      failures.push({
        beat: "layout",
        reason: `${id} is at (${actual.x}, ${actual.z}), expected near (${expectedScene.x}, ${expectedScene.z})`,
      });
    }
  }
  console.log(`layout ${scenes.manifestHash}`);
  for (const gap of layout.separations) {
    console.log(`  ${gap.from} <-> ${gap.to}  ${gap.metres} m`);
  }
  await capture("01-arrival", "A fresh island. The journey line points inland.", ({ state, ui }) => {
    if (state.journey?.startKind !== "fresh") return `expected a fresh start, got ${state.journey?.startKind}`;
    if (!ui.goalVisible) return "no journey line at the start";
    if (state.journey.known.length !== 0) return "something was already known";
    if (ui.promptVisible) return "an interaction was offered with nothing to interact with";
    return null;
  });

  // The optional wildlife crossing sits on the plain on the way inland, and is
  // found simply by riding past it. It is captured where it actually happens.
  const crossingAt = at("plain-wildlife-crossing");
  const toCrossing = await rideTo(crossingAt.x, crossingAt.z, { within: 16, timeout: 180 });
  if (!toCrossing.arrived) failures.push({ beat: "ride-to-crossing", reason: toCrossing.reason });
  await capture("02-crossing", "Animals crossing the plain.", ({ state }) => {
    const crossing = state.journey?.known.find((entry) => entry.id === "plain-wildlife-crossing");
    return crossing ? null : "the crossing was ridden through unnoticed";
  });

  // The crossing is journey order 15 and the herd trace is 10, so finding it
  // first is a genuine sequence break. The interface must show it as found
  // without either hiding it or promoting it to "the next thing".
  await capture("02b-sequence-break", "Found out of order, and handled as such.", ({ state, ui }) => {
    const known = state.journey?.known ?? [];
    if (!known.some((entry) => entry.id === "plain-wildlife-crossing")) {
      return "the out-of-order discovery was not recorded";
    }
    if (known.some((entry) => entry.id === "first-herd-trace")) {
      return "an earlier discovery leaked before it was found";
    }
    // Guidance still points at the call, not at the thing just stumbled on.
    if (state.journey?.objectiveKind !== "journey-event") {
      return `objective became ${state.journey?.objectiveKind}`;
    }
    if (ui.journeyItems.length !== 1) {
      return `the journey listed ${ui.journeyItems.length} places, exposing hidden ones`;
    }
    return null;
  });

  // The herd answers only from within earshot, so the first act is a ride
  // inland - which is the arc's own shape, not a workaround.
  const toCall = await rideTo(10, 40, { within: 12, timeout: 180 });
  if (!toCall.arrived) failures.push({ beat: "ride-inland", reason: toCall.reason });
  await capture("03-inland", "At the edge of the fernwood, within earshot.");

  await lab.press("callPressed");
  await wait(0.4);
  await capture("04-call", "The call goes out, and nothing answers yet.", ({ state, ui }) => {
    if (state.journey?.known.some((entry) => entry.id === "first-herd-trace")) {
      return "the answer arrived instantly, with no delay to feel";
    }
    return ui.noticeVisible ? null : "the call itself was not acknowledged";
  });

  // The answer is deliberately late. Waited for by the herd trace specifically,
  // because other discoveries can and do complete on the ride in - which is
  // exactly the false positive this replaced.
  const answered = await page
    .waitForFunction(
      () =>
        window.__windhoofLab
          .state()
          .journey?.known.some((entry) => entry.id === "first-herd-trace") === true,
      null,
      { timeout: 25_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!answered) failures.push({ beat: "call-answer", reason: "nothing answered the call" });
  // A frame for the interface to catch up with the world; the player sees the
  // answer a moment after the world decides it.
  await wait(1.5);
  await capture("05-answer", "The answer, and the bearing it came from.", ({ state, ui }) => {
    if (!answered) return "no answer arrived";
    if (!ui.bearingVisible) return "the answer gave no visible direction";
    const revealed = (state.journey?.known ?? []).filter((entry) =>
      entry.id === "first-herd-trace" || entry.id === "spring-resting-hollow");
    if (revealed.length < 2) return `the answer revealed ${revealed.length} places, expected 2`;
    return null;
  });

  // --- the herd trace ---
  // Roughly ninety metres of riding from the call spot, and another ninety from
  // here to the spring. The legs are long enough that the timeouts have to
  // allow for a horse that has to go around trees.
  const traceAt = at("first-herd-trace");
  const springAt0 = at("spring-resting-hollow");
  const toTrace = await rideTo(traceAt.x, traceAt.z, { within: 8, timeout: 300 });
  if (!toTrace.arrived) failures.push({ beat: "ride-to-trace", reason: toTrace.reason });
  const traceOffered = await settleAt("first-herd-trace", traceAt.x, traceAt.z);
  // Looking down the prints, which run on towards the spring.
  await lookAt(springAt0.x, springAt0.z);
  await capture("06-trace-approach", "Standing at the trodden ground.", ({ ui }) =>
    ui.promptVisible && traceOffered ? null : "no contextual offer at the trace",
  );

  await lab.press("interactPressed");
  await wait(0.6);
  await capture("07-trace-found", "Looking closer at the trace.", ({ state, ui }) => {
    const trace = state.journey?.known.find((entry) => entry.id === "first-herd-trace");
    if (trace?.state !== "completed") return `trace is ${trace?.state ?? "unknown"}`;
    if (!ui.discoveryVisible) return "no discovery moment was shown";
    return null;
  });

  // --- the spring ---
  const springAt = springAt0;
  const toSpring = await rideTo(springAt.x, springAt.z, { within: 8, timeout: 300 });
  if (!toSpring.arrived) failures.push({ beat: "ride-to-spring", reason: toSpring.reason });
  const springOffered = await settleAt("spring-resting-hollow", springAt.x, springAt.z);
  await lookAt(springAt.x, springAt.z);
  await capture("08-spring", "The resting hollow.", ({ ui }) =>
    ui.promptVisible && springOffered ? null : "no contextual offer at the spring",
  );
  await lab.press("interactPressed");
  await wait(0.8);
  await capture("09-rest", "Resting at the spring, and the island remembering.", ({ state }) => {
    const known = state.journey?.known ?? [];
    const spring = known.find((entry) => entry.id === "spring-resting-hollow");
    if (spring?.state !== "completed") return `spring is ${spring?.state ?? "unknown"}`;
    // The overlook is a separate place, eighty-eight metres away and over a
    // rise. Resting in the hollow must not reach it. When the three scenes had
    // collapsed on top of each other this passed by accident, and the arc was
    // over the moment the player stopped for water.
    const overlook = known.find((entry) => entry.id === "first-overlook");
    if (overlook && (overlook.state === "visited" || overlook.state === "completed")) {
      return `resting at the spring ${overlook.state} the overlook`;
    }
    if (state.journey?.complete) return "the journey ended at the spring";
    return null;
  });

  // Autosave is asynchronous, so it is waited for rather than assumed.
  const saved = await page
    .waitForFunction(
      () => window.__windhoofLab.state().journey?.persistenceStatus === "saved",
      null,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!saved) failures.push({ beat: "autosave", reason: "the ride was never saved" });

  // --- the overlook ---
  const overlookAt = at("first-overlook");
  const toOverlook = await rideTo(overlookAt.x, overlookAt.z, { within: 10, timeout: 300 });
  if (!toOverlook.arrived) failures.push({ beat: "ride-to-overlook", reason: toOverlook.reason });
  // Completion is by lingering, so standing still is the interaction - but the
  // count only runs while the horse is settled on safe ground, same as the
  // contextual offer. So it stands, and moves to a better spot if the ridge is
  // not letting it stand.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await wait(4);
    const state = await lab.state();
    if (state.journey?.complete) break;
    const bearing = attempt * (Math.PI * 2 / 5) + 1.1;
    await rideTo(overlookAt.x + Math.sin(bearing) * 5, overlookAt.z + Math.cos(bearing) * 5, {
      within: 2.5,
      timeout: 40,
      pace: 0.6,
    });
  }
  // Facing back down the island, over the ground the ride came through, because
  // that is what the ending claims to be showing.
  await lookAt((traceAt.x + springAt.x) / 2, (traceAt.z + springAt.z) / 2);
  await capture("10-overlook", "The overlook, and the end of the arc.", ({ state, ui }) => {
    if (!state.journey?.complete) return "the journey did not complete";
    if (!ui.discoveryVisible) return "the ending was not shown";
    return null;
  });

  // --- pause, and the journey on demand ---
  await lab.command({ type: "Pause" });
  await wait(0.6);
  await capture("11-pause", "The pause surface, holding the journey so far.", ({ ui }) =>
    ui.journeyItems.length >= 3 ? null : `pause listed ${ui.journeyItems.length} places`,
  );
  await lab.command({ type: "Resume" });
  await wait(0.4);

  await lab.command({ type: "ResetToSafeGround" });
  await wait(1.2);
  await capture("12-reset", "Returned to safe ground, journey intact.", ({ state }) =>
    state.journey?.complete ? null : "the reset lost the journey",
  );

  // --- resuming ---
  const beforeReload = await lab.state();
  await boot();
  await capture("13-resume", "The island remembers.", ({ state, ui }) => {
    if (state.journey?.startKind !== "resumed") return `start was ${state.journey?.startKind}`;
    if ((state.journey?.completedMandatory ?? 0) < 1) {
      return "nothing was restored from the save";
    }
    if (!ui.noticeVisible) return "the resume was not announced";
    return null;
  });
  beats.at(-1).restoredFrom = {
    completedBefore: beforeReload.journey?.completedMandatory ?? null,
  };

  // --- a save this island can no longer use ---
  // Written straight into the store the game reads, so the production
  // compatibility rules decide the outcome exactly as they would in the wild.
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("windhoof", 1);
      open.addEventListener("success", () => {
        const database = open.result;
        const transaction = database.transaction("game-saves", "readwrite");
        transaction.objectStore("game-saves").put(
          {
            saveVersion: 1,
            // The same island, from a build whose terrain no longer matches:
            // the case that will actually happen to a player as the world keeps
            // being authored. Everything but the manifest hash is genuine, so
            // the production compatibility rules make the real decision.
            worldId: "windhoof-vertical-slice",
            worldSeed: 483921,
            generatorVersion: "0.2.0",
            manifestHash: "fnv1a64-0000000000000000",
            lastSafePose: { position: { x: 0, y: 8, z: 0 }, yaw: 0 },
            discoveryStates: {},
            playTimeTicks: 4000,
          },
          "primary-v1",
        );
        transaction.addEventListener("complete", () => resolve(), { once: true });
        transaction.addEventListener("error", () => reject(transaction.error), { once: true });
      });
      open.addEventListener("error", () => reject(open.error), { once: true });
    });
  });

  await boot();
  await capture("14-quarantined", "A ride this island can no longer use, kept rather than erased.", ({ state, ui }) => {
    if (state.journey?.startKind !== "quarantined") return `start was ${state.journey?.startKind}`;
    if ((state.journey?.known.length ?? 0) > 0) return "an unusable ride leaked progress";
    if (state.journey?.persistenceWritesEnabled !== false) {
      return "the stored ride was at risk of being overwritten";
    }
    if (!ui.storageVisible) return "the player was not told";
    if (!ui.storageActions.some((label) => /begin a new ride/i.test(label))) {
      return "no way to accept and carry on";
    }
    if (ui.saveVisible) return "claimed to have saved before the player agreed";
    return null;
  });

  // Accepting is the only thing that authorises a write. Everything before this
  // point has left the stored ride untouched.
  await page.locator('.wh-storage-actions .wh-button[data-variant="primary"]').click();
  await page
    .waitForFunction(
      () => window.__windhoofLab.state().journey?.persistenceWritesEnabled === true,
      null,
      { timeout: 25_000 },
    )
    .catch(() => failures.push({ beat: "15-accepted", reason: "the new ride was never authorised" }));
  await wait(0.8);
  await capture("15-accepted", "Begun again, and remembered from here.", ({ state, ui }) => {
    if (state.journey?.persistenceWritesEnabled !== true) return "writes are still disabled";
    if (ui.storageVisible) return "the question is still on screen";
    if (!/begun again/i.test(ui.noticeText ?? "")) return `notice said: ${ui.noticeText}`;
    return null;
  });

  await context.close();
}
