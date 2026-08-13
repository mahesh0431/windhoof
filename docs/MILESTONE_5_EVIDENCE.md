# Milestone 5 evidence — first island

**Status: the player-facing layer is built and measured. The milestone is not
complete, and the gate it turns on has not been attempted.**

Everything below was produced by the current build. Where something was not
exercised, or was exercised and did not work, it says so and names the artifact
that shows it. Nothing here should be read as a milestone claim: Milestone 5
gates on a human 15–30 minute blind journey that nobody has ridden.

---

## The world under test

| | |
| --- | --- |
| Manifest hash | `fnv1a64-2eae5335cb5544fc` |
| Schema version | 4 |
| Generator | 0.5.0 |
| World id | `windhoof-first-island` |
| Size | 1,024 m, 64 chunks, fully resident |
| Spawn | `(0, 6, -340)`, Saltwind Coast |

The frozen Milestone 4 slice is untouched and still compiles to
`fnv1a64-75ef4f476903558d`.

---

## What the evidence is, and what it is not

Two tools, doing two different jobs, because one of them cannot do the other's.

**`tools/captureFirstIsland.mjs` — direct capture.** Holds the camera at a place
and photographs it. It proves a place exists in the current build and looks the
way it is claimed to look: real scene graph, real terrain, real materials, real
cues, real renderer. It proves **nothing** about whether a player can get there,
whether the route reads, or how long anything takes. It never moves the horse —
the seam it uses (`LabHarness.observe`) can only move the camera, so it is
structurally incapable of writing simulation state.

Why it exists: the island is 1,024 m across and under SwiftShader the horse
covers about two metres per second of wall clock. Riding to five regions and
nine scenes is an hour of automation, and the attempt that tried it is the one
that hung for seven minutes and was killed.

**`tools/journeyFirstIsland.mjs` — a real ride.** Drives the horse through the
same input buffer the keyboard writes to, and reads what the simulation says
happened. This is the only evidence here that bears on progression, and it is
deliberately partial — see [the ride](#the-ride).

Both are bounded by a hard run-wide wall clock, print every stage before it
starts, name whatever they did not finish, and close their browser and server in
a `finally`. Both go through `tools/automationUrl.mjs`, which forces `mute=1`.

---

## The five herd traces

`src/world/traceScenes.ts` realizes each mandatory trace's authored `signals` as
built form. Three rules: no two scenes share a shape, something in each is large
enough or moves enough to notice at a canter, and everything is present from the
first frame — nothing appears when a flag flips.

| Trace | Scene | Frame |
| --- | --- | --- |
| `storm-beach-hoofprints` | A line of prints out of the water, deepest and wettest at the sea end, stopping where the sand turns to grass. Storm wrack thrown up with them. | `scene-storm-beach-hoofprints-{a,b,c}.png` |
| `longgrass-resting-circle-trace` | A disc of pressed ground with body-sized deeper hollows, ringed by 2.6 m stalks all leaning inward. | `scene-longgrass-resting-circle-trace-{a,b,c}.png` |
| `fernwood-caught-hair` | A stand of dark conifers closing in a clearing, one trunk rubbed pale at shoulder height, dark strands caught on the worn band. | `scene-fernwood-caught-hair-{a,b,c}.png` |
| `river-spring-tracks` | A wet, dark mud patch — the long-range cue against the hollow's silver-green — with prints crossing rather than following it, and reeds around the edge. | `scene-river-spring-tracks-{a,b,c}.png` |
| `blackstone-living-herd` | Nine horses grazing in the summit saddle, varied coats, heads dipping on their own clocks. | `scene-blackstone-living-herd-{a,b,c}.png` |

The four optional discoveries get quieter treatments — a ring of sheltering
stone for each hollow, a line of worn ground for each cut — so they read as
"something happens here" without competing with the five that carry the story.

Two things this layer deliberately does not do: it never reads discovery state,
so it cannot leak a place the player has not found; and the generic cue layer
(`journeyMarkers.ts`) is told which discoveries this one has claimed, so the
five traces do not also get the identical stamped hoofprints that would have
made five different places look like one.

### Two scene bugs the evidence caught

Both were found by looking at frames, not by reasoning about code.

- **The herd had been walking to the world origin since boot.** "Not yet
  noticed" was encoded as `at: -1000`, and `elapsed - (-1000)` is a thousand
  seconds of elapsed notice, so the gather ran at full strength on frame one and
  the herd trekked towards `(0, 0)` — four hundred metres off the crown. Now
  `null`, which is not a valid value of the thing it stands for.
- **The end of the journey was a black slab.** The Blackstone landmark ring had
  no gap, so a twenty-metre tooth stood six metres from the approach and filled
  the frame with the herd somewhere behind it. Two teeth are now absent on the
  herd's side, which is the summit saddle the spec names and should always have
  been there.

## The living herd, and what happens after

When the last mandatory discovery completes, the herd notices where the horse is
actually standing: heads come up, they turn to face it, and they close part of
the distance over fourteen seconds, stopping six metres out. Then they go back
to grazing around the player.

Nothing takes the camera, nothing pauses, no input is blocked, and a player who
rides off halfway through simply rides off. The interface says
`"Not alone"` once, and when that card clears it says
`"Nowhere to be now. The island is yours to ride"` once, and then stops talking.

**Not captured in a frame.** The gather only fires on real completion of all
five mandatory discoveries, and the ride below reached three. The wiring is
`islandApp.ts` calling `scene.traces.gather` on the `journeyComplete` edge; the
resolution itself has not been photographed and is not claimed as shown.

## Player wording

`src/ui/journeyText.ts` carries the five-trace arc. The objective line for a
mandatory trace is a **count of what is held**, not a direction:

> `3 of 4 traces found - keep working round the island`

The first four traces have no prerequisites and can be found in any order. The
simulation still has to pick one objective and picks by journey order, so naming
it would show the player an order the world does not impose — and a player who
then rode to a different trace would appear to be doing it wrong. Once only the
herd is left the line does give a direction, because by then there is a real
one. The two shortcuts are named as knowledge ("The fern corridor"), never as
unlocks.

---

## WebGL recovery

`WebglRecoveryController` is wired to the canvas in `islandApp.ts`. On loss it
pauses through the same `Pause` command the player's own Escape key sends,
clears input, suspends audio, releases pointer lock and asks for a safe save. On
restore it resizes, draws one smoke frame, and stops.

Exercised through the browser's own `WEBGL_lose_context`, so what ran is the
path a driver reset takes:

```
ready -> context-lost -> restored-paused -> ready
```

| | |
| --- | --- |
| `graphics-1-lost.png` | "The picture has gone" over a scrim |
| `graphics-2-restored-paused.png` | "Ready when you are", with the resume button |
| `graphics-3-resumed.png` | Riding again |

The state that matters is `restored-paused`, and it was checked twice: it was
still `restored-paused` after two seconds of nobody doing anything, and it only
became `ready` when the harness **clicked the button a player would click**, not
through a back door. A browser handing the context back says it can draw again;
it does not say the player is ready to ride into a world they cannot see the
last second of.

Three bugs this found:

1. `getExtension` on a *lost* context returns null, so a restore looked up when
   it was needed could never find the one thing that could undo the loss. The
   extension is now taken once while the context is alive.
2. `.wh-ui` is transparent to the pointer and every interactive surface opts
   back in. The recovery panel did not, so **the only way out of a restored
   context was unclickable for a real player**, not just for automation.
3. The frame loop drew and stepped while the context was gone. It now holds.

---

## The ride

`node tools/journeyFirstIsland.mjs`, 600 s budget, steered from the compiled
manifest rather than from coordinates in the script. Full log in
`journey-first-island.json`.

| Trace | Completion | Leg | Result |
| --- | --- | ---: | --- |
| `storm-beach-hoofprints` | interact | 73 m / 38 s | **completed** — offer appeared, was taken |
| `longgrass-resting-circle-trace` | linger | 387 m / 181 s | **completed** — landed after the beat snapshot; counted in the 3/5 total |
| `blackstone-living-herd` | linger | 294 m attempted | **not reached** — stalled 103 m short |
| `river-spring-tracks` | call | 291 m / 123 s | **completed** — the call was made and answered |
| `fernwood-caught-hair` | interact | — | **not attempted** — 34 s of budget left, under the leg floor |

**3 of 5 mandatory discoveries completed on a real ride, and three of three
completion modes were exercised: interact, linger, and call.** Zero console
errors, zero unhandled rejections, zero `AudioContext`s.

### The Blackstone climb does not go

The ride stalled about a hundred metres short of the crown on **both** attempts,
gave up after four recovery manoeuvres, and reported `no-progress`. The last
twenty-second window before it quit covered five metres.

This is not diagnosed and is not written off. It is at minimum a limit of
straight-line steering against a steep face, and it may be a real gradient
problem on the one climb the whole journey ends with. Either way, **nothing in
this document may be read as evidence that a player can reach the herd.** The
scene is photographed; the route to it is not proven.

### What the ride does not show

It is not a blind playtest and cannot substitute for one. It was handed the
coordinates, it rides straight lines between them, and it says nothing about
whether the cues are findable without foreknowledge or whether the journey lands
inside 15–30 minutes.

---

## Budgets

### Preparation, per job

The 50 ms per-job stall ceiling holds. Worst app-owned job is
`ground-cover-island-tufts` at **27.0–33.3 ms** across runs; the banded
`field-route-distance-*` jobs sit at 9–10 ms each.

**The `collision-world` finding from the previous pass is gone, because the job
is gone.** Codex replaced the monolithic constructor with
`CompiledIslandWorld.createStaged`, which hands its work back in bounded pieces
through the same `runJob` seam as everything else. No staged collision job
appears in the worst-ten list of any run below, and none exceeds the ceiling.
The old 95–100 ms measurement described a constructor that no longer exists and
has been removed rather than carried forward.

Full per-job list: `island-capture.json` → `worstJobs`.

### Frames

| | |
| --- | --- |
| Boot | 6.7–6.9 s under SwiftShader, 64/64 chunks active |
| Steady draws | 178 |
| Ground cover | 223,923 tufts / 683,166 triangles island-wide |
| Worst measured frame | 716,442 drawn triangles (`scene-fernwood-caught-hair-a`) |

**All 37 captured frames are inside the 750k triangle guide.** Fernwood and
River Hollow cover density came down (1.35 → 0.92 and 1.10 → 0.92) with
compensating scale increases, so the closed, overgrown reading survives on fewer
and larger tufts.

One measurement was thrown out rather than fixed by thinning the island: a
Fernwood view at 777,317 triangles turned out to be taken from a camera standing
**offshore at sea level**, looking down the length of the island — a vantage no
horse can occupy. Region captures now scan round for a viewpoint above the water
line, and the same region measures 716k from land. The number was wrong because
the measurement was wrong, and thinning the island to satisfy it would have made
the game worse to fix nothing.

---

## Local verification

`pnpm typecheck` and `pnpm lint` are clean.

`pnpm test` is **169 of 169** on the final run.

One test is load-sensitive and worth naming rather than leaving as a surprise:
`tests/generation/firstIslandTraversal.test.ts > releases staged physics retains
when collision construction fails` failed on two earlier runs by exceeding
vitest's 5 s default while the rest of the suite ran alongside it, and passed
both in isolation (8.5 s for that file's two tests) and on the final full run.
Nothing about it is broken; it is simply close enough to the default timeout
that machine load decides the outcome. It is a Codex-owned test over Codex-owned
staging and has not been edited from this side.

---

## Evidence files

Under [`docs/evidence/milestone-5/`](evidence/milestone-5/):

| File | |
| --- | --- |
| `island-capture.json` | Direct-capture run: manifest identity, residency, per-job timings, per-frame draws and triangles, and the camera placement each frame was taken from |
| `journey-first-island.json` | The ride: per-leg distances and times, completion mode and final state per trace, and what was not reached |
| `region-0*-{a,b}.png` | Five regions, two land-based bearings each |
| `scene-*-{a,b,c}.png` | Nine scenes, three bearings each |
| `graphics-{1,2,3}-*.png` | The WebGL lifecycle |
| `journey-0*.png` | Frames from the real ride, at the traces it reached |
| `island-inspection.json` | Kept from the earlier ride-based tour, for the per-leg timings that diagnosed the hang. Superseded as evidence by `island-capture.json` |

Screenshots from builds older than the current one have been deleted rather than
relabelled. Milestone 4's evidence under `docs/evidence/milestone-4/` is
untouched and describes a different world at a different hash.

---

## Still open

| | |
| --- | --- |
| The Blackstone climb | The ride cannot get up it. Twice. Undiagnosed. |
| The living-herd resolution | Wired, not photographed — it needs all five completions and the ride got three |
| Terrain shading | The plain still shows hard-edged dark bands that read as terraces. Static profiling ruled out geometry: 2,402 distinct heights in 2,601 samples, largest 2 m rise 10.56 m at `(144, 6)`. Most likely the 30 m shadow volume. Undiagnosed. |
| River Hollow's landmark | The waterfall notch reads as flat grey panels at close range. Visible in `scene-river-spring-tracks-*.png` |
| The 15–30 minute blind journey | **Not attempted by anyone.** This is the gate. |

Beyond those, the backend contract lists release decisions that are Mahesh's and
are not affected by anything here: the ending tone, the target browser matrix,
mobile/gamepad/remapping scope, and whether the journey actually lands inside
15–30 minutes.
