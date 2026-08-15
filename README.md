# Longride

Working title for a third-person browser exploration game in which the player
**is a young wild horse** roaming a compact open-world island.

The project is in **Milestone 5**, the first full island. Milestones 1 to 3 are
behind us: movement passed its blind playtest after an embodiment pass, the
deterministic compiler passed its blind traversal gate, and the 4 × 4 chunk
slice is a frozen, fully resident baseline. Milestone 4's implementation and
automated browser evidence are ready and waiting only on a blind
ten-to-fifteen-minute ride — see
[Milestone 4 evidence](docs/MILESTONE_4_EVIDENCE.md).

The playable build now runs the schema-v4 first island — 1,024 m, five regions,
fully resident, inside its startup and draw budgets. Each region carries its own
ground material and its authored landmark silhouette, each of the five herd
traces has an environmental scene built from the signals the spec names, and the
WebGL recovery lifecycle is wired to the canvas with its own player-facing
states.

**Milestone 5 is not complete.** A real ride completes three of the five
mandatory discoveries; it cannot climb to the fifth, and that is undiagnosed.
The 15–30 minute blind journey the milestone actually gates on has not been
attempted by anyone. What was measured, what was not, and what did not work is
recorded in [Milestone 5 evidence](docs/MILESTONE_5_EVIDENCE.md).

## Product promise

Running across the island should be enjoyable before the game gives the player
an objective. The horse is not a human avatar in a horse skin: speed, turning,
slopes, jumps, stopping, sound, and camera behavior must create a believable
sense of weight and freedom.

The first journey follows a horse separated from its herd after a storm. The
player explores through terrain, silhouettes, tracks, wind, wildlife, and
distant calls until the island changes from an unfamiliar place into home.

## Confirmed direction

- Browser-native Three.js game
- Third-person camera
- Player is the horse; there is no rider
- One finite, continuously explorable island
- No Blender or required DCC workflow
- No combat, crafting, loot, survival meters, or quest-marker clutter
- Deterministic world specifications and generation
- Claude Code owns player-facing UI/UX, visual presentation, and assets

## Five-stage build

1. **Horse Lab** - make movement and camera enjoyable on graybox terrain.
2. **Island compiler** - compile a seed and world specification into stable
   terrain, regions, routes, discoveries, and manifests.
3. **Continuous traversal** - add chunk activation, physics readiness,
   predictive streaming, and resource cleanup.
4. **Exploration slice** - connect movement to herd traces, calls, resting
   hollows, environmental storytelling, and progression.
5. **First island** - expand region by region, add persistence, then harden
   performance and browser behavior.

The exit criteria for each stage are defined in
[MILESTONES.md](docs/MILESTONES.md). We do not advance merely because a list of
features was implemented.

## Documentation map

- [Project vision](docs/PROJECT_VISION.md)
- [Game design](docs/GAME_DESIGN.md)
- [World bible](docs/WORLD_BIBLE.md)
- [Player experience brief](docs/EXPERIENCE_BRIEF.md)
- [Technical architecture](docs/TECHNICAL_ARCHITECTURE.md)
- [Deterministic world pipeline](docs/WORLD_PIPELINE.md)
- [WorldClaw web adaptation](docs/WORLDCLAW_WEB_METHOD.md)
- [Milestones and gates](docs/MILESTONES.md)
- [Art and asset brief](docs/ART_ASSET_BRIEF.md)
- [Decisions and open questions](docs/DECISIONS.md)
- [Claude Code handoff](docs/CLAUDE_CODE_HANDOFF.md)
- [Asset provenance](docs/ASSET_PROVENANCE.md)
- [World specification schema](docs/contracts/world-spec.schema.json)
- [Vertical-slice world example](docs/contracts/world-spec.example.json)
- [First-island specification](docs/contracts/world-spec.first-island.json)
- [First-island schema](docs/contracts/world-spec-v4.schema.json)
- [Milestone 5 backend contract](docs/contracts/MILESTONE_5_BACKEND_CONTRACT.md)
- [Playtest report template](docs/contracts/PLAYTEST_REPORT_TEMPLATE.md)
- [Milestone 1 evidence](docs/MILESTONE_1_EVIDENCE.md)
- [Milestone 2 evidence](docs/MILESTONE_2_EVIDENCE.md)
- [Milestone 3 evidence](docs/MILESTONE_3_EVIDENCE.md)
- [Milestone 4 evidence](docs/MILESTONE_4_EVIDENCE.md)
- [Milestone 5 evidence](docs/MILESTONE_5_EVIDENCE.md)

## Current gate

Milestone 5 gates on a **blind fifteen-to-thirty-minute journey** from the storm
beach to the living herd. The traces now have cues to navigate by and the herd
is there to arrive at, but the automated ride stalls about a hundred metres
short of the crown on the final climb — so the end of the journey is built and
photographed, and is not yet proven reachable. See
[Milestone 5 evidence](docs/MILESTONE_5_EVIDENCE.md) for the exact state.

Milestone 4 still gates on its own **blind ten-to-fifteen-minute ride**: a player who has
not read the code rides from the storm beach to the overlook, finds the trace,
the spring, and the high ground on their own cues, and comes away with a journey
rather than a checklist.

Everything that can be checked mechanically has been. One muted browser
walkthrough rides the whole arc on the current build with zero failures and zero
console errors, and the states, wording, save handling, and cue placement are
recorded frame by frame in
[Milestone 4 evidence](docs/MILESTONE_4_EVIDENCE.md). None of it measures how
long the ride takes or whether the island is discoverable without foreknowledge
— the automation was handed the coordinates. That is the part still waiting on a
person.

Island production follows the published WorldClaw pattern: structured planning,
global terrain first, selective regional realization, and repeated
render-inspect-refine loops. The adaptation is documented in
[WORLDCLAW_WEB_METHOD.md](docs/WORLDCLAW_WEB_METHOD.md).

## Running it

With Node 24 and pnpm:

```text
pnpm install
pnpm dev
```

Then open the printed URL and click once to take pointer lock.

| Action | Key |
|---|---|
| Move | `W` `A` `S` `D` |
| Gallop | `Shift` |
| Jump | `Space` |
| Inspect / interact | `E` |
| Call | `C` |
| Return to safe ground | `R` |
| Look | Mouse |
| Pause and settings | `Esc` |
| Diagnostics | `F3` |

## Public test build

- Play muted: <https://longride.mahesh-palavalli-tech.workers.dev/?mute=1>
- Releases: <https://github.com/mahesh0431/longride/releases>

The deployed build is currently a release candidate. Follow the authored road
up Blackstone rather than attempting the steep face directly, and report what
you experience during the ride; the blind 15-30 minute human gate is deliberately
not replaced by automated steering.

## Local verification

```text
pnpm typecheck
pnpm test
pnpm lint
pnpm test:first-island
pnpm test:browser
```

To regenerate the visual evidence in [`docs/evidence/`](docs/evidence/README.md):

```text
pnpm inspect
pnpm journey:walkthrough
node tools/inspectOverlook.mjs
pnpm island:capture
pnpm island:journey
```

The two first-island tools do different jobs and are not interchangeable.
`captureFirstIsland` holds the camera at each region and scene and photographs
it — it proves a place exists and looks right, and proves nothing about whether
a player can get there. `journeyFirstIsland` rides the horse through the real
input path and reads what the simulation says happened; it is the only one of
the two that bears on progression. Both are bounded by a hard wall clock, print
each stage as it starts, and name whatever they did not finish.

Each starts its own server, runs against a real browser, screenshots what it
finds, and exits non-zero on console errors or a failed expectation. All but
`island:capture` drive the horse through real gameplay; that one moves only the
camera and says so wherever its output is cited. Nothing needs to be running
first, and each mutes the game through the URL rather than through the browser
process.

None of these is a substitute for the blind ride each milestone actually gates
on. They check that the machine does what it says; they cannot tell you whether
the island is worth riding.
