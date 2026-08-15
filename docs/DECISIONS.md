# Decisions and open questions

## Confirmed by the project owner

| Decision | Status | Note |
|---|---|---|
| Player character | Confirmed | The player is the horse; there is no rider. |
| Camera | Confirmed | Third-person view. |
| World | Confirmed | Explore an island using an open-world concept. |
| Runtime | Confirmed | Browser-native Three.js. |
| DCC dependency | Confirmed | Do not use Blender. |
| UI ownership | Confirmed | Claude Code owns all UI/UX work. |
| Asset ownership | Confirmed | Claude Code owns asset decisions and integration. |
| Claude autonomy | Confirmed | Supply product context and outcomes; do not prescribe its implementation. |
| Process | Confirmed | Prepare documentation first, then work deterministically in bounded loops. |
| World-production method | Confirmed | Follow WorldClaw's published global-to-regional, coarse-to-fine process, adapted to Three.js and browser inspection. |

## Design decisions now treated as canonical

These choices keep the current scope coherent. They may be changed by the
project owner, but implementation should not casually drift from them.

| Decision | Rationale |
|---|---|
| Movement is the primary product | A horse exploration game fails if galloping is not enjoyable. |
| No combat, crafting, loot, or survival meters | They distract from embodiment and exploration. |
| All basic gaits and jump available at start | Gallop is the fantasy, not an unlock. |
| Finite compact island | Density and route memory matter more than procedural size. |
| No mandatory minimap or GPS route | The island should communicate through landscape and sound. |
| No traditional death screen | Exploration should be adventurous but not punitive. |
| Kinematic gameplay controller | Stable, tunable horse movement is preferable to quadruped physics. |
| Deterministic WorldSpec -> WorldManifest compiler | Enables repeatability, validation, and safe iteration. |
| WebGL 2 first | WebGPU is an enhancement after foundation stability. |
| Simulation separated from physics, rendering, UI, and saves | Prevents architecture drift and preserves redesign freedom. |
| Gate Horse Lab before island production | Scenery cannot repair weak locomotion. |
| Region-by-region expansion | Prevents a large attractive but unplayable world. |

## Provisional defaults

These enable documentation and Milestone 1 without blocking. They require
explicit confirmation before release scope depends on them.

| Topic | Proposed default | Impact if changed |
|---|---|---|
| Narrative | Young horse separated from herd after a storm | Changes discoveries and emotional arc, not Horse Lab architecture. |
| Tone | Naturalistic with restrained magical realism | Changes audiovisual and story presentation. |
| Art mood | Stylized naturalism | Changes asset selection and performance planning. |
| Initial platform | Desktop browser, keyboard/mouse first | Changes input, UI, and performance targets. |
| Controller support | Important follow-up after action mapping stabilizes | Affects onboarding and testing. |
| Vertical slice | 400-500 metre journey, 10-15 minutes | Changes milestone content scope. |
| First island experiment | 1,024 x 1,024 metres, 15-30 minute journey | Changes chunk count, content cost, and streaming pressure. |
| Full ending | Find herd at high pasture, then continue free roam | Changes final progression only. |

## Questions for Mahesh

These are the only product questions currently worth interrupting progress for:

1. Should the world remain mostly naturalistic, or may the island respond with
   clearly supernatural moments?
2. Is the first release desktop-only, or is mobile browser support a hard
   requirement from the beginning?
3. Is keyboard/mouse enough for the first Horse Lab, or must gamepad ship in
   the same milestone?
4. Does the separated-herd journey fit, or should the game be pure free-form
   exploration without that emotional goal?

No implementation work has been authorized by this document alone.

## Decision-log format

Append durable changes using:

```text
Date:
Decision:
Reason:
Affected documents/contracts:
Approved by:
```

## Durable log

### 2026-08-12 - Milestone 1 player-facing foundation

All entries below were decided by Claude Code under its UI/UX, visual, and asset
ownership. None of them changes the player fantasy, mechanics, milestone scope,
or the WorldClaw-derived production order.

---

Date: 2026-08-12
Decision: The player-facing interface is plain TypeScript and DOM with a single
hand-written stylesheet; no UI framework is introduced.
Reason: The interface is small and must not allocate or re-render during a
gallop. Zero runtime dependencies also keeps the initial download far inside the
20 MB budget. The typed `UiSnapshot`/`GameEvent`/`GameCommand` boundary means
this choice can be reversed later without touching the simulation.
Affected documents/contracts: `src/ui/**`, no contract change.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-12
Decision: All Milestone 1 visual and audio assets are generated procedurally in
the browser at runtime. Nothing is downloaded, and no font, texture, model, or
audio file is added to the repository.
Reason: The art brief forbids a Blender dependency and requires honest
placeholder labelling and clear provenance. Generating everything from code
removes the entire licensing and redistribution question for this milestone
while still proving silhouette, scale, gait readability, and surface feedback.
Affected documents/contracts: `docs/ASSET_PROVENANCE.md`.
Approved by: Claude Code (asset ownership)

---

Date: 2026-08-12
Decision: The visual direction is stylized naturalism carried by one shared
palette, a fixed late-afternoon sun, and value contrast rather than saturation.
Ground surfaces are separated by lightness first, and rock is always darker than
grass.
Reason: Traversability has to survive motion, distance, and colour-vision
differences. Making unclimbable ground visibly darker is the single most
important thing the terrain can say, and an earlier lighter rock tone actively
inverted that signal.
Affected documents/contracts: `src/render/palette.ts`.
Approved by: Claude Code (visual ownership)

---

### 2026-08-13 - Deterministic compiler contract

Date: 2026-08-13
Decision: World compilation uses named independent random streams, global
coordinate sampling, millimetre-quantized numeric records, canonical FNV-1a
64-bit hashes, and separate semantic versus generated stable IDs.
Reason: The WorldClaw-style loop needs a globally coherent source of truth that
can be regenerated and compared before any regional visual work. Load order,
object enumeration, browser timing, and hand editing must not alter the world.
Affected documents/contracts: `src/game/world/compiler/*`,
`docs/contracts/world-spec.schema.json`, `docs/MILESTONE_2_EVIDENCE.md`.
Approved by: Codex (compiler ownership)

---

Date: 2026-08-13
Decision: `WorldSpec` carries global mood, atmosphere, lighting, and palette
anchors plus per-region terrain-family, silhouette, scatter-family, and density
intentions; exact visual composition and asset choices remain outside the
compiler.
Reason: The adapted WorldClaw process requires one structured plan shared by
global terrain and selective regional realization. Keeping these decisions only
in prose would make the manifest incomplete, while prescribing concrete assets
would violate Claude Code's player-facing visual ownership.
Affected documents/contracts: `docs/contracts/world-spec.schema.json`,
`docs/contracts/world-spec.example.json`,
`src/game/world/compiler/worldTypes.ts`.
Approved by: Codex (structured-plan ownership)

---

Date: 2026-08-13
Decision: Generated collision-bearing scatter is represented as explicit
placement records and is rejected from spawn, safe-route, and discovery
clearance zones before visual assets are selected.
Reason: Regional art can change without invalidating traversal. The global
compiler establishes where content may exist; Claude Code later decides how
those records should look within the frozen browser and provenance budgets.
Affected documents/contracts: `src/game/world/compiler/worldTypes.ts`,
`src/game/world/compiler/compileWorld.ts`.
Approved by: Codex (world and physics ownership)

---

Date: 2026-08-13
Decision: Region elevation ranges constrain natural deterministic anchor
heights; they are not platform target heights. Base lattice noise is smoothly
interpolated, and the outer coast has a broad authored falloff before the sea
boundary.
Reason: Browser inspection and blind riding exposed elevated causeway walls,
V-shaped recovery seams, and a steep north-shore face. All were real manifest
and collider geometry, not shading problems.
Affected documents/contracts: `src/game/world/compiler/compileWorld.ts`,
`tests/generation/*`, `docs/MILESTONE_2_EVIDENCE.md`.
Approved by: Codex (compiler and physics ownership)

---

Date: 2026-08-13
Decision: Recovery eligibility is a local footprint property, and the island
boundary separates horse collision from camera obstruction. Straight outward
intent stops at sea; ordinary steering preserves a coastal tangent with a
measured inward release; the invisible wall is excluded only from camera
sweeps.
Reason: A centre-point safety query saved a sharp seam as a recovery pose, and
the boundary could either trap diagonal keyboard input or collapse the chase
camera. Independent black-box tests reproduced both failures before the final
fix passed.
Affected documents/contracts: `src/physics/compiledIslandWorld.ts`,
`src/physics/rapierHorseMotionResolver.ts`, `src/app/islandApp.ts`,
`tests/generation/generatedTraversal.test.ts`.
Approved by: Codex (physics ownership)

---

Date: 2026-08-13
Decision: Short-lived player-facing chrome uses an unclamped, pause-aware real
presentation clock; gameplay onboarding continues to use simulation time.
Reason: Under slow software rendering a five-second place title could remain
visible for more than fifteen wall seconds because the simulation clock
correctly clamps long frames. Players experience UI transients in real time,
not in fixed-step progress.
Affected documents/contracts: `src/ui/transientClock.ts`,
`src/ui/longrideUi.ts`, `tests/ui/transientClock.test.ts`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-12
Decision: The Horse Lab stage is a hand-authored fixture in `src/stage/`, built
from one analytic terrain field plus independent prop records, and both the
Three.js mesh and the Rapier collider are derived from the same vertex buffer.
Reason: Milestone 2 introduces the deterministic world compiler, which Codex
owns; until then the lab still needs ground. Keeping it explicit and
single-sourced preserves the WorldClaw explicit-representation rule and means
the visible ground and the collidable ground cannot drift apart.
Affected documents/contracts: `src/stage/**`. Replaced by the WorldManifest at
Milestone 2.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-12
Decision: The stage is closed by shallow water and an invisible collision ring
at 112 metres, and the seabed stays continuous to the mesh edge.
Reason: Observed in the browser: a galloping player ran off the plot and fell
forever. A world with no boundary fails the milestone's recovery gate regardless
of how good the locomotion is. Water is the honest boundary for a game with no
swimming, and stopping the player only once they are visibly out in the sea
means the wall is reached after the reason for it is already obvious.
Affected documents/contracts: `src/stage/horseLabStage.ts`, `stageWorld.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-12
Decision: The stream's shallow ford sits on the gallop corridor and the deep,
jumpable trench is on both flanks.
Reason: Observed in the browser: a trench narrow enough to clear with a jump
necessarily has walls far steeper than the horse's 28-degree climb limit, so
with the deep section on the straight-ahead line the first gallop ended with the
horse permanently stuck in a ditch. This ordering gives the safe approach and
the skillful approach the world bible asks for, and the trench floor stays
continuous into the ford so a horse that does drop in can ride back out.
Affected documents/contracts: `src/stage/horseLabStage.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-12
Decision: Obstacle dimensions are derived from the shared horse tuning rather
than chosen by eye, and asserted in tests. The jumpable span must fit inside a
canter-speed jump arc with margin.
Reason: An obstacle sized by eye silently became gallop-only and punished a
player for riding carefully. Tying stage geometry to `DEFAULT_HORSE_TUNING` means
a future tuning change surfaces as a failing test instead of as an unplayable
stage.
Affected documents/contracts: `tests/stage/horseLabStage.test.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-12
Decision: The riding view shows only a low-opacity gait strip in the bottom
left, plus transient top-centre hints and acknowledgements. The gait strip fades
when settled by default and can be pinned or hidden. Nothing is drawn in the
centre or lower middle of the view during ordinary riding.
Reason: The experience brief lists "reads like a dashboard during ordinary
riding" as a failure condition, while Milestone 1 explicitly needs locomotion
feedback. A strip that brightens on a gait change and then recedes satisfies
both, and making it switchable settles the disagreement in the player's favour.
Affected documents/contracts: `src/ui/longrideUi.ts`, `src/ui/ui.css`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-12
Decision: Onboarding is a policy object that shows at most one hint at a time,
never in the first 1.6 seconds, never within 9 seconds of the last one, never
while paused, and never during a gallop.
Reason: "Onboarding interrupts the first gallop" is a named failure condition
and the first uninterrupted gallop is a presentation event. Keeping the policy
free of DOM makes each of those rules directly testable.
Affected documents/contracts: `src/ui/onboardingDirector.ts`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-12
Decision: Pausing releases pointer lock, and camera input is gated on both
pointer lock and playing mode.
Reason: "Camera input continues underneath a modal surface" is a named failure
condition. Both gates are asserted in the browser suite.
Affected documents/contracts: `src/app/longrideApp.ts`, `src/app/inputBindings.ts`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-12
Decision: The chase camera's spring arm pivots on the horse, uses look-ahead
only for the look target, and ignores sweep hits at zero distance.
Reason: Observed in the browser: pushing the pivot forward with velocity put the
sweep origin inside whatever the horse was about to reach, so every cast
reported an immediate penetration and the camera sat jammed against the horse's
rump for the entire ride. The horse's own kinematic body is also excluded from
the sweep for the same reason.
Affected documents/contracts: `src/render/camera/chaseCamera.ts`,
`src/stage/stageWorld.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-12
Decision: Fog begins at 180 metres, past the far side of the stage.
Reason: Observed in the browser: a fog range tuned for a kilometre-scale island
washed the middle of a 220-metre plot to near-white and removed the distant
silhouettes the player is meant to navigate by. Fog is for the sea and the
horizon, not for the playable ground.
Affected documents/contracts: `src/render/palette.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-12
Decision: Presentation preferences persist under their own `localStorage` key
and are never routed through the save adapter.
Reason: The architecture reserves saves for serializable simulation truth owned
by the simulation. Losing a preference costs the player a re-adjustment; mixing
it into game state costs a save-compatibility rule.
Affected documents/contracts: `src/ui/presentationSettings.ts`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-12
Decision: Reduced motion defaults to the operating system preference and damps
camera shake, field-of-view response, banking, and cosmetic secondary motion,
but never the gait animation itself.
Reason: Gait is information the player reads speed and effort from. Motion
comfort should remove decoration, not remove the signal.
Affected documents/contracts: `src/ui/presentationSettings.ts`,
`src/render/horse/horseGaitAnimator.ts`, `src/render/camera/chaseCamera.ts`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-12
Decision: The diagnostics overlay is off by default, toggled with F3 or from the
pause menu, and highlights values that breach the architecture's performance
gates.
Reason: Milestone 1 needs diagnostics, and the experience brief needs them out
of the riding view. Colouring breaches rather than listing raw numbers makes the
gates actionable during a playtest.
Affected documents/contracts: `src/ui/longrideUi.ts`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-12
Decision: A development-only `window.__longrideLab` harness writes into the same
input buffer the keyboard writes into, and `tools/inspectHorseLab.mjs` drives it
to capture canonical views into `docs/evidence/`.
Reason: This is the render-inspect-refine step of the WorldClaw method. A
screenshot of a game that never moved proves nothing, and the harness reaches
real gameplay states without creating a second path through the simulation. It
is not installed in a production build unless `?lab=1` is present.
Affected documents/contracts: `src/app/labHarness.ts`, `tools/inspectHorseLab.mjs`.
Approved by: Claude Code (UI ownership)

### 2026-08-13 - Accessibility and interaction pass

---

Date: 2026-08-13
Decision: `pnpm inspect` starts and stops its own Vite server on an ephemeral
port, and exits non-zero when the run produced console errors.
Reason: The documented command previously assumed a dev server was already
running on a fixed port, so it did not work from a clean checkout and would fail
or capture the wrong thing when that port was absent or occupied. Making it
self-contained also turns it into a real check rather than only a capture tool.
Affected documents/contracts: `tools/inspectHorseLab.mjs`, `README.md`.
Approved by: Claude Code (browser-facing validation ownership)

---

Date: 2026-08-13
Decision: The pointer-focus prompt has two forms. Before the player has moved it
is a centred invitation over a light scrim; once they are riding it becomes a
corner pill with no scrim. It is a real `<button>`, reachable and activatable
from the keyboard.
Reason: A keyboard-only player never clicks, so the full-screen scrim dimmed
their entire session with no way to dismiss it. The prompt is a nudge towards
mouse look, not a requirement, and it must not tax players who decline it. The
pill sits top left because the diagnostics overlay owns the top right and both
can be on screen during a playtest.
Affected documents/contracts: `src/ui/longrideUi.ts`, `src/ui/ui.css`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-13
Decision: Every interactive control gets a visible `:focus-visible` ring, the
pause dialog traps Tab by moving focus explicitly, and the hidden dialog is
`inert`.
Reason: The settings panel had no focus indicator at all, and Tab escaped a
surface that declares `aria-modal`. Focus is moved explicitly rather than by
detecting the ends of the list because browsers disagree about which controls
Tab visits — WebKit skips buttons and checkboxes by default, which leaked focus
out of the dialog after three tabs.
Affected documents/contracts: `src/ui/ui.css`, `src/ui/longrideUi.ts`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-13
Decision: `visibility` is switched with a zero-duration transition, delayed only
when hiding, rather than being animated.
Reason: Animating `visibility` left the pause dialog computed as hidden for the
first frames after it was shown, and `focus()` on a hidden element fails
silently. The dialog opened with focus still on `body`, so a keyboard player
landed in a modal with no focus in it. Layout is also flushed before focus moves,
so the fix does not depend on frame timing.
Affected documents/contracts: `src/ui/ui.css`, `src/ui/longrideUi.ts`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-13
Decision: The pause panel scrolls internally, with the title and primary actions
pinned above a masked scroll region. The overlay uses a definite grid row.
Reason: On a short window the whole overlay scrolled instead, which pushed
Resume off the top of the screen. The panel's percentage `max-height` also did
not constrain it, because a percentage against an auto-sized grid row is
indefinite and resolves to `none`; a `minmax(0, 1fr)` row makes it definite. The
bottom mask makes a cut-off list read as scrollable rather than as the end.
Affected documents/contracts: `src/ui/ui.css`, `src/ui/longrideUi.ts`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-13
Decision: Acknowledgements and hints are announced through polite live regions;
the gait strip is `aria-hidden`.
Reason: Important state changes must not be visual-only, and the experience
brief requires that sound is never the only way to understand something. The
gait strip repeats what the player already feels, and announcing every gait and
speed change would drown out the infrequent messages that matter.
Affected documents/contracts: `src/ui/longrideUi.ts`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-13
Decision: The canvas uses `role="application"` with a descriptive label rather
than `role="img"`.
Reason: `role="img"` describes an interactive 3D view as a static picture and
puts assistive technology into browse mode, where it intercepts the game's own
keys. `role="application"` passes keystrokes through, which is what a game
surface needs.
Affected documents/contracts: `index.html`.
Approved by: Claude Code (UI ownership)

---

Date: 2026-08-13
Decision: Leaving the window pauses the game, and the first keypress counts as
the gesture that starts audio.
Reason: Without the first, the horse keeps running behind a window the player is
not looking at and they return to a state they did not choose. Without the
second, a keyboard-only player had a permanently silent game, because audio was
only unlocked by clicking the canvas.
Affected documents/contracts: `src/app/longrideApp.ts`.
Approved by: Claude Code (UI ownership)

---

### 2026-08-13 - Embodiment pass after the first blind playtest

Date: 2026-08-13
Decision: The horse's torso is articulated at two joints - a shoulder sling
(`forehand`) and a lumbo-sacral coupling (`spine`) - with the ribcage between
them left rigid.
Reason: The first blind playtest failed Milestone 1 with the movement reading as
a rigid generic avatar. A single welded torso is the root of that: no amount of
leg animation reads as a horse when the frame carrying the mass never changes
shape. Two joints are the minimum that gives the gathering and lengthening a
gallop is actually made of, and they sit where a horse really bends.
Affected documents/contracts: `src/render/horse/horseVisual.ts`. The `HorseRig`
interface gains `forehand` and `spine`; a replacement model must expose the same
two joints.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-13
Decision: Body height at speed is driven by a narrow suspension pulse placed in
the window where no hoof is in stance, not by a larger sine.
Reason: A sine large enough to read as a gallop also lifts the horse while its
hooves are planted, which reads as floating. Deriving the window from the gait's
own footfall offsets keeps the rise and the airborne moment on the same frame.
`tests/render/horseAnimation.test.ts` recomputes the stance windows from the
offsets and fails if any pulse overlaps one; that test immediately caught the
trot, canter, and gallop offsets carrying invented footfall sequences, which
have been replaced with real ones.
Affected documents/contracts: `src/render/horse/horseGaitAnimator.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-13
Decision: Takeoff and landing are driven by one underdamped spring rather than
by a pose blend, and its compression is split between the body dropping and the
legs folding.
Reason: A landing that snaps back to the idle pose has no weight. An underdamped
spring gives a sink, one visible rebound, and a settle, and scaling the impulse
by the descent speed the horse actually carried makes a hop off a kerb and a
drop off the plateau look different. Putting all of the compression into the
body would push the hooves through the ground, so the legs absorb the rest.
Genuine pre-takeoff anticipation is not available: the jump is latched and
resolved inside one fixed tick, so there is no lead time to anticipate from. The
gather that reads as anticipation comes from the stride itself.
Affected documents/contracts: `src/render/horse/horseGaitAnimator.ts`,
`src/app/longrideApp.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-13
Decision: Hooves throw ground debris, from one pooled `Points` object, with the
style chosen by the world surface plus whether the hoof is at or below the water
line.
Reason: A horse that leaves no mark reads as a model sliding over a texture. One
pooled object keeps it to a single draw call and a fixed allocation. Surface
classification alone cannot decide the wet cases, because the shore shelf is
`sand` and the ford is `streambed` and both should throw water, so the water
line is consulted separately in the presentation layer rather than pushing a
presentation concern into the `WorldSurface` contract.
Affected documents/contracts: `src/render/horse/hoofContacts.ts`,
`src/app/longrideApp.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-13
Decision: Particle size is a diameter in metres, projected with the renderer's
own vertical scale, and clamped.
Reason: The first version multiplied by an arbitrary constant, which drew a
single grain of sand seven metres away eight hundred pixels wide. Two evidence
captures were a full-screen beige wall before browser inspection caught it.
Real units also keep debris the same physical size across window sizes and
field-of-view changes.
Affected documents/contracts: `src/render/horse/hoofContacts.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-13
Decision: The chase camera flattens towards the horizon as speed rises, from
0.20 rad at rest to 0.10 rad at gallop, and the field-of-view gain is eased
rather than squared.
Reason: Looking down at a galloping horse across an empty foreground filled most
of the frame with ground that nothing moved through, which is a large part of
why the first evidence pass read as a model being dragged. The arm length stays
inside the architecture's 6-7 metre band; only the angle changes.
Affected documents/contracts: `src/render/camera/chaseCamera.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-13
Decision: Mane and forelock locks hang from pivots on the crest instead of being
capsules rotated about their own centres.
Reason: A centred capsule sticks out equally both ways, so the mane read as a
dorsal fin standing off the neck. Browser inspection of the side-on gallop
capture is what made it obvious; it was invisible from behind.
Affected documents/contracts: `src/render/horse/horseVisual.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-13
Decision: Scatter props are kept off the centre of the whole ridden line, from
the spawn through the ford and up onto the plateau, not just the run-up to the
stream.
Reason: A scatter rock sat at (-1.5, 14.2), squarely on the plateau ramp. Now
that the controller reports resolved speed, riding into it reads as an idle
horse rather than as a gallop, and the inspection tour parked against it twice.
Hand-placed obstacles still sit just off the centre, because meeting one is the
point of the corridor.
Affected documents/contracts: `src/stage/horseLabStage.ts`,
`tests/stage/horseLabStage.test.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-13
Decision: The island scene borrows terrain geometry rather than owning it. Three
builds its `position` and `index` attributes directly over the canonical
`TerrainChunkTopology` arrays held by the repository, deriving only normals and
vertex colours, and takes exactly one render retain per chunk which it gives
back in `dispose`.
Reason: Rendering a second, independently rebuilt copy of the terrain is the
classic way for the ground the player sees to drift from the ground they collide
with; identity — not equality — is what makes that impossible. The retain is the
render half of the repository's activation contract, so borrowing and lifetime
are stated in one place instead of by convention.
Affected documents/contracts: `src/world/islandTerrainMesh.ts`,
`src/world/islandScene.ts`, `src/app/islandApp.ts`,
`tests/render/islandSceneLifecycle.test.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-13
Decision: Startup prepares chunks in bounded per-chunk jobs with a
`requestAnimationFrame` handover between them, and the app refuses to start the
frame loop unless all sixteen chunks are active with both a physics and a render
retain.
Reason: Preparing the island in one synchronous burst blocks the main thread
behind a loading panel that then cannot repaint, so the one moment the player is
already waiting is also the one moment nothing on screen is alive. The readiness
guard makes partial residency an invariant failure rather than a state to ride
through, since ground without a collider is not a state worth rendering.
Affected documents/contracts: `src/app/islandApp.ts`, `src/app/labHarness.ts`,
`tests/browser/islandExperience.spec.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-13
Decision: World realization is a sequence of named, timed, bounded jobs with a
frame handed back after each, and no app-owned job may exceed 50 ms. The global
field is built in two halves, the terrain colouring blurs are two jobs, terrain
is one job per chunk, and ground cover is swept in four bands and realized one
layer at a time. Durations are recorded in a fixed-size log and the count and
maximum are exposed through the diagnostic harness.
Reason: The whole scene used to realize in one 103 ms synchronous block, which
is a stall the loading panel cannot paint through - the one moment the player is
already waiting is the one moment nothing on screen is alive. The division is by
measurement rather than by taste: each job was split only after it was measured
above a third of the budget, and the log is what keeps that honest, because a
ceiling nobody can see is a ceiling nobody keeps.
Affected documents/contracts: `src/app/preparationLog.ts`,
`src/app/islandApp.ts`, `src/app/labHarness.ts`, `src/world/islandScene.ts`,
`src/world/islandField.ts`, `src/world/islandTerrainMesh.ts`,
`src/world/islandGroundCover.ts`, `tools/profileIsland.mjs`,
`tests/app/preparationLog.test.ts`, `tests/render/islandSceneLifecycle.test.ts`,
`tests/browser/islandExperience.spec.ts`.
Approved by: Claude Code (visual ownership)

---

Date: 2026-08-13
Decision: `?mute=1` is the canonical runtime mute flag. It is resolved once per
page in `resolveRuntimeFlags` and enforced in one place - `LongrideAudio.resume`
refuses to construct the `AudioContext` - and every repository-owned automated
browser, inspection, capture and profiling URL sets it.
Reason: Automation must be silent by construction, not by luck. Chromium's
`--mute-audio` process flag only covers the browser a harness happened to
launch: it does nothing for a URL printed in a failure report and reopened by
hand, and nothing for WebKit. Putting the guarantee in the URL makes it travel
with the link, and enforcing it at the context rather than at each sound means a
sound added later inherits it instead of having to remember it. Absent the flag,
audio behaves exactly as before.
Affected documents/contracts: `src/app/runtimeFlags.ts`,
`src/audio/longrideAudio.ts`, `src/app/islandApp.ts`, `src/app/horseLabApp.ts`,
`src/app/labHarness.ts`, `tools/automationUrl.mjs`, the four `tools/*.mjs`
entry points, and the four `tests/browser/*.spec.ts` entry URLs.
Approved by: Claude Code (audio and player-facing behaviour ownership)

---

Date: 2026-08-13
Decision: The 512 metre vertical slice uses the chunk lifecycle and predictive
readiness contracts while keeping all sixteen chunks resident. Near/middle/far
streaming rings are deferred until the 1,024 metre island or measured content
growth requires them.
Reason: Full residency passes the active target-device, heap, draw, triangle,
physics-readiness, and disposal gates. Adding unload hysteresis and partial
physics residency now would introduce failure modes without solving a measured
problem. The repository is the policy seam, so later streaming does not require
a second terrain representation.
Affected documents/contracts: `docs/MILESTONE_3_EVIDENCE.md`,
`src/game/world/runtime/islandChunkRepository.ts`,
`src/game/world/runtime/traversalReadiness.ts`.
Approved by: Codex (runtime and deterministic world ownership)

---

Date: 2026-08-13
Decision: Automated rides read discovery positions out of the running build
through `LabHarness.scenes()` rather than from coordinates written into the
harness, and the walkthrough fails before it rides if two mandatory story scenes
fall within 40 metres or inside each other's visit radius.
Reason: A previous layout collapsed three story beats within a few metres of
each other. The automation of the day rode it happily and photographed the same
patch of grass three times, so the evidence looked healthy while the journey did
not exist. Steering from the compiled world means a moved scene reroutes the
ride instead of silently invalidating it, and the separation assertion turns
"these are separate places" from an assumption into a checked precondition.
Affected documents/contracts: `src/app/labHarness.ts`, `src/app/islandApp.ts`,
`tools/journeyWalkthrough.mjs`, `docs/MILESTONE_4_EVIDENCE.md`.
Approved by: Claude Code (player-facing verification ownership)

---

Date: 2026-08-13
Decision: The discovery moment keeps its position across the lower middle of the
frame and gains a soft radial wash behind the text instead of being lifted clear
of the horse.
Reason: A drop shadow alone holds up over fernwood and fails over pale sand,
which is exactly where the last discovery of the arc is read. The wash has no
edge to notice, so the moment still reads as something the island said rather
than as a panel the interface opened. Moving the line up into the sky was tried
and reverted: it cleared the horse but stopped feeling like it came from the
ground.
Affected documents/contracts: `src/ui/ui.css`.
Approved by: Claude Code (player-facing UI ownership)

---

Date: 2026-08-13
Decision: The optional plain crossing is populated with a small merged
quadruped instanced six times, moving in a bounding gait, with per-instance coat
colour. It is not articulated.
Reason: The crossing is the only authored discovery with no built form and no
sound of its own, so motion is the entire cue, and it was standing in as bare
boxes that fell apart the moment a player looked at them. All six animals share
one instanced mesh, so their legs cannot move independently of their bodies - a
quadruped gliding on rigid legs is worse than no gait at all. Small animals
breaking from cover bound, which is a motion this rig can perform honestly, and
it keeps the whole herd at one draw call.
Affected documents/contracts: `src/world/journeyMarkers.ts`,
`docs/ASSET_PROVENANCE.md`.
Approved by: Claude Code (visual presentation and asset ownership)

---

Date: 2026-08-13
Decision: The journey goal line is offset above the gait strip rather than
sharing its corner, and the sea fades its surface detail with view distance,
dithers its haze ramp, and carries a wider surf ramp on a denser ring mesh.
Reason: The goal line and the gait strip were both anchored at the same
bottom-left position, so a wrapping line laid its second row across the speed
readout. On the water, three separate artefacts were reading as one: periodic
swell and surf aliasing at grazing angles, eight-bit quantisation banding along
the slow haze ramp, and the surf threshold landing on ring boundaries in the
shore attribute. Each is addressed at its own cause rather than by flattening
the water.
Affected documents/contracts: `src/ui/ui.css`,
`src/render/world/seaVisual.ts`.
Approved by: Claude Code (player-facing UI and visual presentation ownership)

---

Date: 2026-08-13
Decision: The first island is a separate WorldSpec v4 and generator `0.5.0`;
the frozen Milestone 4 slice stays on WorldSpec v3. Version 4 authors the
coastal cycle, central Blackstone highland, route roles/control points, and
broad terrain influences explicitly. The first island remains fully resident
until profiling proves otherwise.
Reason: Array order, IDs, and visual tags cannot carry executable world
topology. Mutating the slice would also invalidate its finished evidence and
save identity. An additive schema preserves that proof while applying the same
WorldClaw sequence at full-island scale: global plan, terrain, routes, regional
realization, inspect, refine.
Affected documents/contracts: `docs/contracts/world-spec.first-island.json`,
`docs/contracts/world-spec-v4.schema.json`,
`docs/contracts/MILESTONE_5_BACKEND_CONTRACT.md`,
`src/game/world/compiler/*`.
Approved by: Codex (deterministic world and simulation ownership)

---

Date: 2026-08-13
Decision: WebGL context loss pauses the authoritative game and requests a safe
save, while restoration reuses retained CPU resources and stops at an explicit
`restored-paused` gate. It never resumes simulation automatically.
Reason: Three.js can rebuild its internal GPU resources, but it cannot decide
whether horse physics, progression, input, audio, or saves should advance while
the canvas is unavailable. Keeping lifecycle truth separate from `GameEvent`
prevents renderer state from becoming gameplay truth and gives Claude a stable
presentation seam.
Affected documents/contracts: `src/game/contracts/runtimeLifecycle.ts`,
`src/app/webglRecovery.ts`, `src/app/inputBindings.ts`,
`src/audio/longrideAudio.ts`.
Approved by: Codex (runtime lifecycle ownership)

---

Date: 2026-08-13
Decision: Automated browser inspections are bounded by one hard wall clock for
the whole run, never by a per-step timeout, and every step prints where it is
and what it cost.
Reason: The five-region inspector allowed 420 seconds per region leg with no
global budget, so five legs permitted thirty-five minutes of silence. It sat for
seven minutes on the 535-metre Fernwood to River Hollow leg and had to be killed
from outside. Under SwiftShader the horse covers roughly two metres of ground per
wall-clock second, so legs are minutes even when they succeed - which is exactly
why silence is unreadable and a per-step budget is the wrong shape. Anything
unfinished when the clock expires is now named as unfinished rather than left to
a caller's timeout.
Affected documents/contracts: `tools/inspectFirstIsland.mjs`,
`docs/MILESTONE_5_EVIDENCE.md`.
Approved by: Claude Code (browser verification ownership)

---

Date: 2026-08-13
Decision: Ground cover draws only within 260 metres of the horse, and that
radius is the measured value rather than the one that looked safer.
Reason: The frustum culler only removes what is behind the camera, so on the
1,024-metre island every bucket in front of the horse was submitted - 211 draw
calls and 1.14 million drawn triangles. Bucketing by terrain chunk and hiding by
distance brought that to 143-161 draws and 626-812k triangles. The radius was
briefly raised to 380 on a guess that the boundary was visible in motion; that
guess was never measured, and raising it slowed the very inspection that would
have measured it. The open question is recorded in the evidence document rather
than settled by an unmeasured constant.
Affected documents/contracts: `src/world/islandGroundCover.ts`,
`src/world/islandScene.ts`, `docs/MILESTONE_5_EVIDENCE.md`.
Approved by: Claude Code (visual presentation ownership)

---

Date: 2026-08-13
Decision: A region states its own ground material - colour ramp, bare-rock slope
threshold, and cover density, scale and palette - instead of borrowing a terrain
family's and tinting it. Its authored silhouette is realized as built form at
its anchor, seated per piece on the ground beneath that piece.
Reason: The spec gives five regions and three terrain families, so River Hollow
rendered as Fernwood and Blackstone Crown as Longgrass Plain. Tinting towards a
per-region accent was tried first and measured: the accent data was exactly
right, and a fifty percent pull from grass green towards basalt, re-lit and
carpeted in green tufts, still reads as slightly darker grass. A crown of black
rock is not a shade of lawn. Colour alone also cannot make a dome a crown, which
is why the silhouettes exist: at four hundred metres through fog, an outline is
the only cue that survives.
Affected documents/contracts: `src/world/regionVisuals.ts`,
`src/world/regionLandmarks.ts`, `src/world/islandTerrainMesh.ts`,
`src/world/islandGroundCover.ts`, `docs/ASSET_PROVENANCE.md`.
Approved by: Claude Code (visual presentation and asset ownership)

---

Date: 2026-08-13
Decision: Each of the five mandatory herd traces gets its own environmental
scene, built from the `signals` the spec already authors, and the generic cue
layer is told which discoveries have been claimed so it stands off them.
Reason: The generic layer keys off discovery *type*, which was right for a slice
with one herd trace and wrong for an island with five: it stamped the identical
two rows of hoofprints and the identical circling flock on every one of them, so
five places that carry five different moments of the story rendered as one place
repeated. The spec had already written the fix - every mandatory trace names two
signals in the world's own terms - so the scenes realize those sentences rather
than inventing new ones. Nothing in the scene layer reads discovery state, so it
cannot reveal a place the player has not found, and everything is present from
the first frame: a world that pops its landmarks in on unlock can be cleared but
not explored.
Affected documents/contracts: `src/world/traceScenes.ts`,
`src/world/journeyMarkers.ts`, `src/world/islandScene.ts`,
`docs/ASSET_PROVENANCE.md`, `docs/MILESTONE_5_EVIDENCE.md`.
Approved by: Claude Code (visual presentation and asset ownership)

---

Date: 2026-08-13
Decision: The objective line names how many traces the player holds, not which
trace to go to next.
Reason: The first four traces carry no prerequisites and can be found in any
order. The simulation still has to choose a single objective and chooses by
journey order, so naming that objective would show the player an ordering the
world does not impose - and a player who then rode to a different trace would
appear to be doing it wrong. A count is true regardless of the order they are
found in. Once only the herd is left the line does give a direction, because by
then there genuinely is one.
Affected documents/contracts: `src/ui/journeyText.ts`, `src/ui/longrideUi.ts`.
Approved by: Claude Code (player-facing UI/UX ownership)

---

Date: 2026-08-13
Decision: A natively restored WebGL context stays paused until the player
presses Resume, and the recovery panel covers the screen rather than sitting in
a corner.
Reason: The browser handing the context back says it can draw again; it does not
say the player is ready. The horse may have been galloping at a cliff when the
screen went, and dropping someone back into a moving world they cannot see the
last second of is how a recovery becomes a fall. The full cover is honest for
the same reason: everything behind it is blank, frozen, or a frame that must not
be acted on, and covering it is what says "stopped" rather than "broken".
Affected documents/contracts: `src/app/islandApp.ts`, `src/ui/longrideUi.ts`,
`src/ui/journeyText.ts`, `src/ui/ui.css`.
Approved by: Claude Code (player-facing UI/UX ownership)

---

Date: 2026-08-13
Decision: Visual evidence for regions and scenes is taken by holding the camera
at a place, never by moving the horse, and is labelled as proving existence and
appearance only - never reachability.
Reason: The island is 1,024 metres across and under SwiftShader the horse covers
about two metres per second of wall clock, so riding to five regions and nine
scenes is an hour of automation and was the shape of the run that hung. Moving
the camera is bounded and cheap. The cost is that such a frame says nothing
about whether a player can get to what it shows, which is exactly why the
progression ride exists alongside it and why the two are never cited for each
other's claims. The seam can only move the camera, so it is structurally
incapable of writing simulation state.
Affected documents/contracts: `src/app/labHarness.ts`, `src/app/islandApp.ts`,
`tools/captureFirstIsland.mjs`, `tools/journeyFirstIsland.mjs`,
`docs/MILESTONE_5_EVIDENCE.md`.
Approved by: Claude Code (browser verification ownership)

---

Date: 2026-08-13
Decision: The horse is modelled as flat-shaded lofts through authored
cross-sections, with mane and tail as thin sheets, rather than as intersecting
smooth primitives.
Reason: The island is made entirely of flat facets - terrain, canopies, rocks -
and a horse built from smooth spheres, capsules, and cylinders read as an asset
borrowed from a different game standing in the middle of it. The shading
mismatch was only half of it: primitives also put the wrong shape in the places
a horse is actually recognised by, giving a barrel as wide as it was deep, legs
that were tubes with no knee or hock, a head with no jowl or nasal bone, and a
mane threaded on like beads. Cross-sections let those proportions be authored
and adjusted directly - a girth deeper than it is wide, a chest narrow enough
that the front legs stand close together, a hock that points backwards - and
flat shading then costs nothing because non-indexed loft geometry already has
one normal per triangle. The model came out cheaper than the one it replaced:
1,988 triangles and 36 draws against roughly 3,300 and 40.
Affected documents/contracts: `src/render/horse/horseVisual.ts`,
`src/render/horse/horseGeometry.ts`, `src/render/geometryUtils.ts`,
`docs/ASSET_PROVENANCE.md`.
Approved by: Claude Code (visual presentation and asset ownership)

---

Date: 2026-08-13
Decision: The horse gets its own inspection surface, photographed away from the
world by `tools/inspectHorse.mjs`, alongside the in-play tour.
Reason: The player looks at this one object for the entire game, and the chase
camera only ever shows it from behind, at one distance, in whatever pose the
ride happened to be in. Judging a model that way is how a mane can be entirely
buried inside a neck without anybody noticing. The contact sheet renders the
real rig with the real materials and the real stage lighting from six sides and
four gaits in a single frame, so a change can be judged on the change. It is
dev-only: the production build has one entry, and nothing in `src` imports it.
Affected documents/contracts: `tools/inspectHorse.mjs`,
`tools/horsePreview.html`, `tools/horsePreview.mjs`, `package.json`,
`docs/evidence/README.md`.
Approved by: Claude Code (browser verification ownership)

---

Date: 2026-08-13
Decision: Ground cover is two layers, not one: a dense carpet in a window that
follows the player, and a thinner island-wide scatter behind it. Both are
splayed blades rather than cones, and both are bent by a vertex-shader wind.
Reason: The island-wide layer has to hold every square metre of a 1,024-metre
island inside one instance ceiling, which caps it at about half a tuft per
square metre. That is right for the middle distance and nowhere near enough
underfoot, where the eye reads individual plants and the ground between them
reads as bare dirt. Raising the island-wide density is not the fix - the whole
island is built up front, so multiplying it costs hundreds of megabytes of
instance matrices for grass nobody is standing in. A window that regenerates
from a hash of its own cell gives the same grass in the same place every time
anyone stands there without any of it existing until they do. The shape change
cost nothing: three triangles as a cone is a pyramid and three triangles as
blades is a plant. The wind costs one uniform and is what stops the field
reading as a diorama.
Affected documents/contracts: `src/world/grassBlades.ts`,
`src/world/islandNearGrass.ts`, `src/world/islandGroundCover.ts`,
`src/world/islandScene.ts`.
Approved by: Claude Code (visual presentation ownership)

---

Date: 2026-08-13
Decision: The island grows about 2,500 scenery trees that carry no collision,
and the compiler's own collision-bearing placements draw the same tree geometry
rather than a stretched blob with a disc on top.
Reason: The compiler emits a couple of dozen placements across the island, which
is the right number of things to be stopped by and is not a forest, so a region
named Fernwood rendered as open ground. The same failure the ground cover was
written to fix, one scale up. What this does not do is give those trees
colliders: thousands of colliders is a change to the compiled world, the
compiler owns that world, and it is not a decision the render layer makes on its
own. The consequence is stated rather than hidden - a horse can ride through a
scenery trunk - and it is recorded in ASSET_PROVENANCE.md as the largest honesty
gap on the island. Trees are drawn in three storeys because a wood drawn from
one height range is one tree repeated, and the rare emergent standing a storey
clear of the canopy is what gives a wood a skyline.
Affected documents/contracts: `src/world/islandWoodland.ts`,
`src/world/treeShapes.ts`, `src/world/islandPlacements.ts`,
`docs/ASSET_PROVENANCE.md`.
Approved by: Claude Code (visual presentation ownership)

---

Date: 2026-08-13
Decision: The island's ground ramps move a long way towards green, the sun rises
from thirty degrees of elevation to forty, and the sky fill goes up by half.
Reason: The region ramps were authored dry - bleached coast, gold plain - and
that reads as pale and washed out the moment real grass is standing on it,
because dry cover on a dry ramp leaves neither anything to contrast against.
Every region keeps its own hue and its own value, so the plain is still the
brightest ground and the crown still the darkest and the two woodlands are still
warm against cool; they are simply now the colour of somewhere things grow. The
light changed for a harder reason: at thirty degrees every slope facing away
from the sun got almost no direct light, so a third of the island read as black
bands lying across the ground, and under a canopy the whole of Fernwood went to
silhouette. Forty degrees and a stronger fill keep the shadows long and readable
and keep the far side of a hill a hillside.
Affected documents/contracts: `src/world/regionVisuals.ts`,
`src/render/palette.ts`, `src/world/islandScene.ts`.
Approved by: Claude Code (visual presentation ownership)

---

Date: 2026-08-13
Decision: The riding render budget is raised from 200 draw calls and 750,000
triangles to 240 and 900,000, and the peak from 300 and 1,200,000 to 340 and
1,500,000.
Reason: The old numbers were set against an island of bare ground with a thin
scatter of cover on it, and a planted island does not fit inside them. Every
cheap way of making it fit was spent first: coarser cover buckets, a shorter
cover reach, three blades per tuft rather than four, flower heads dropped at
eighty-five metres, finer tree culling, and the horse's mane and tail taken out
of the shadow pass. What was left to give up was the vegetation itself, which is
the thing the budget exists to make room for. The gate is there to protect the
frame, so the frame is what was measured rather than argued about: riding at a
full gallop on hardware GL, 203 draws, 770,062 triangles, 120 frames per second,
worst frame 10.8 ms. The new ceilings sit above what was measured and well below
anything the frame budget would notice. If a target browser is later found that
this hurts, the fix is a distance-scaled cover density, not a thinner island.
Affected documents/contracts: `tests/browser/islandExperience.spec.ts`.
Approved by: Claude Code (visual presentation ownership), surfaced to the
project owner as a gate change rather than applied silently.

---

Date: 2026-08-14
Decision: The horse is remodelled against a real anatomical reference in nine
measured passes, and the largest single change is that the torso is shortened by
roughly a fifth. Point of shoulder to point of buttock now comes to about 1.05
times the height at the withers rather than 1.28.
Reason: Every earlier pass on this model had refined surfaces on a frame with the
wrong proportions, and no amount of jowl or hock detail fixes a horse that is a
quarter too long - it reads as a dachshund with a horse's head on it. With the
frame corrected the rest of the reference gap resolves into a short list, each
of which was rendered and judged before the next was started: the head carried
level with the horizon at every speed (a camel's pose, now nose-down at rest and
taken back out with speed); no jowl, and a poll set forward on the forehead; a
throatlatch tapered to a stalk far thinner than the jowl above it (a giraffe);
legs with a taper of about a third from forearm to cannon, so there was no
elbow, knee, gaskin or hock anywhere in the outline; a hind limb hung plumb off
the hip, which is the one thing a standing horse never does; a mane with no width
that vanished from the front and every quarter view; and a tail carried out
behind at rest and swung better than forty degrees off centre by its own idle
swish. Torso and neck sections went from ten facets round to fourteen, which is
the cheapest quality available here at about forty triangles a mass.
Consequence: 1,988 triangles and 36 draws become 2,640 and 40 for the player's
horse. The island's twenty-six wild horses bake the same rig, so they inherit all
of it; their two poses were brought onto the same head-carriage convention and
they now have contact-sheet coverage of their own, which they had never had.
Affected documents/contracts: `src/render/horse/horseVisual.ts`,
`src/render/horse/horseGaitAnimator.ts`, `src/world/islandWildlife.ts`,
`tools/horsePreview.mjs`, `tools/inspectHorse.mjs`,
`docs/evidence/horse/`.
Approved by: Claude Code (visual presentation ownership)

---

Date: 2026-08-14
Decision: A wild horse defends its own space. It watches a rider who comes
within eleven metres, turns its quarters onto one who comes within five and
pins its ears, and kicks one who crowds it inside three and a half - and the
kick moves the player. The herd also gets collision, which it never had.
Reason: Twenty-six horses that a player could ride straight through, standing
perfectly still while being walked into, were the least alive thing on an island
whose whole subject is animals. The sequence is deliberately the real one and
deliberately in that order: an animal that lashes out with no warning is a trap,
while one that warns and is ignored is a consequence, and only the second is
worth having. The tell is the horse swinging its hindquarters towards you, which
is also what puts the player in the arc - so reading it and heeding it are the
same action.
Consequence: The kick is delivered as a `ShoveHorse` command, and the shove is
carried in the horse's own state and added to the translation the motion
resolver already receives. That is the whole point: it is resolved by Rapier
against the terrain and every collider on it, so a kick can shove the player
into a rock but never through one, and can never place them anywhere the horse
could not have walked itself. A shoved pose is also refused as a safe-reset
pose while the shove lasts. There is no damage: the cost is a length of ground
and half a second of footing, the same as a bad landing.
The herd is instanced and static, so the horse nearest the player is promoted to
a real rig and animates; the rest stay matrices in a buffer, which is also
honest, because a horse thirty metres away would not react to a rider. Two live
rigs were tried and measured at a peak of 297 draw calls riding through a band
of horses, against a riding gate of 240 and a peak allowance of 340; one fits
inside the steady gate. It also costs almost nothing, because a player can only
crowd one horse at a time - in the measured ride the second live horse never got
past watching. The rig is sticky by two and a half metres so that standing
between two horses does not hand it back and forth every frame.
The same pass merged the rig's parts by joint and material where nothing moves
relative to anything else, taking the horse from 41 draws to 32; that applies to
the player's horse as much as to the wild ones.
Their colliders are upright cylinders rather than boxes along the animal,
because a live horse turns to face the player and then turns away from them, and
a static oriented box would be pointing the wrong way within a second.
Affected documents/contracts: `src/render/horse/wildHorseAnimator.ts`,
`src/world/islandWildlife.ts`, `src/world/islandScene.ts`,
`src/game/simulation/horse/horseController.ts`,
`src/game/simulation/horse/horseState.ts`,
`src/game/simulation/horse/horseTuning.ts`,
`src/game/contracts/uiContract.ts`, `src/app/islandApp.ts`,
`tests/simulation/wildHorseKick.test.ts`, `tools/inspectKick.mjs`.
Approved by: Claude Code (visual presentation ownership); the shove crosses into
simulation, so it is expressed as a command the simulation applies rather than
as the renderer moving the player.

---

Date: 2026-08-14
Decision: The horse's remaining detail is cut into geometry rather than painted
with a texture: ears become curled leaves with a hollow, mane and tail become
separated locks, the coat carries a per-facet tone wander, the coat-to-points
transition is graded across the knee and the hock, the eye gets an orbital rim,
and the hoof gets a coronet band.
Reason: An alpha-tested strand texture was the obvious way to do the hair and it
was rejected for a specific reason: the island's wild horses are baked down to a
single untextured material, so a texture would have given the player's horse
strands and left every other horse in the game with flags. Everything here bakes
with them instead. The dapple is the same argument applied to the coat - the
reference's textured horse differs from its untextured one mostly by not being
one flat value, and on a flat-shaded body the facets are already the unit of
variation, so scattering their tone by five percent buys most of that for
nothing and stays deterministic. Smooth shading, which is what the reference's
mid-poly panel actually shows, was deliberately not adopted: the entire island
is flat-shaded, and a smooth horse would read as an asset from another game.
Consequence: 2,640 triangles and 40 draws become 3,344 and 41.
Affected documents/contracts: `src/render/horse/horseGeometry.ts`,
`src/render/horse/horseVisual.ts`, `docs/evidence/horse/`.
Approved by: Claude Code (visual presentation ownership)

---

Date: 2026-08-14
Decision: Clump scenery gets collision, and the traversal tests that prove the
island is rideable are repaired and rewritten to assert contracts rather than
sizes.
Reason: Asked whether the physics was finished, the honest answer was no, in two
separate ways.

The first is collision coverage. The compiler gives every placement one collider
at the centre of its clump, and the scenery wood's trunks were given colliders
earlier - but the trees and boulders scattered *around* each clump were pure
decoration a horse rode straight through. A tree you can ride through standing
next to one you cannot is worse than either rule applied consistently. Trunks
now always collide; boulders collide once they are big enough that riding
through one would be the obvious thing wrong with the shot, and small stones are
deliberately left out because being stopped by a rock the size of a football is
worse than riding over it.

The second is that the proof was broken, and had been since the control model
changed. The traversal tests steer by setting `cameraYaw` at a target and
holding the throttle, which is how the original camera-absolute steering worked;
reins steering ignores `cameraYaw` entirely, so the horse drove in a straight
line until every waypoint timed out. They now share one `reinsTowards` helper,
so the next change to the control model breaks one thing loudly instead of
several quietly.

Three further tests were asserting the island's old size rather than any
contract: a staged-failure test injected its failure at `collision-terrain-03`
on an island that now has two terrain jobs, so the failure never fired and a
test about the failure path stopped exercising one; a job-name list described
eleven terrain batches where there are two; and "a high final pasture" was a
literal 45 metres, which after the island was halved vertically only recorded
how tall the island used to be. All three now assert the shape - stage names and
order, retains released, the pasture being the highest trace and high relative
to the island's own relief - and are size-independent.
Consequence: The frozen vertical-slice manifest hash is re-frozen from
`fnv1a64-75ef4f476903558d` to `fnv1a64-07b6248151245dd1`. It moved because
halving the island changed the terrain noise lattice, its amplitude, and the
derivation of summit relief, so every compiled height moved. The guard did its
job by refusing to pass quietly. Saved rides from before the halving no longer
match this island and are refused as `manifest-mismatch`, which the interface
already explains to the player.
Known gap, stated rather than hidden: the traversal tests build collision from
the compiled manifest only. Collision the renderer publishes - scenery trunks,
stone, clump scenery, wild horses - is added by the application, so the safe
routes are proven against compiler-authored collision and not against the full
set the player actually rides among.
Affected documents/contracts: `src/world/islandPlacements.ts`,
`src/world/islandScene.ts`, `src/app/islandApp.ts`,
`src/game/simulation/horse/horseSteering.ts`,
`tests/generation/generatedTraversal.test.ts`,
`tests/generation/firstIslandTraversal.test.ts`,
`tests/generation/firstIslandCompiler.test.ts`,
`tests/render/islandSceneLifecycle.test.ts`.
Approved by: Claude Code (visual presentation ownership); the re-frozen manifest
hash is surfaced rather than applied silently, because it invalidates saves.

---

Date: 2026-08-14
Decision: The horse's body no longer sinks through the ground it is standing on.
Reason: A sweep of the whole stride cycle - added to the horse preview because a
single screenshot cannot show this - found the model's lowest point below the
ground plane in every gait: 4.7 cm at a walk, 7.5 cm at a trot, 7.3 cm at a
gallop. On deep grass that passes for hooves in the sward. On rock, sand and
packed earth it is a horse wading through the terrain.

Two causes, both the same shape of mistake - a value that swings about zero when
zero is the floor.

The body bob was the larger. It oscillates about the horse's STANDING height, so
half of every stride was the body sinking below the height its own legs hold it
at, and with no inverse kinematics under the stance leg a sinking body takes the
planted hoof down with it. Offsetting the wave by one amplitude puts its trough
at standing height instead of below it; peak-to-trough is unchanged, so the rise
and fall the player reads is identical. The idle breathing bob had the same
defect and the same fix.

The second is that body pitch and bank turn about the rig's origin, which sits
at hoof level, so tilting swings whichever end is going down BELOW the ground
rather than rocking the horse over its own feet. The lift that a pivot at the
feet would have given for free is now added explicitly. It is computed from the
rotation the horse applies to ITSELF only - the ground conform is deliberately
excluded, because matching the slope underneath you is precisely the case where
the feet should follow the rotation. The same correction fixes a wild horse's
kick, which tipped 9.6 cm through the ground at full extension.
Consequence: Worst penetration across a full cycle is now 0.5 cm at idle, 2.4 cm
at a walk, 1.9 cm at a trot and 0.2 cm at a gallop. The remaining walk figure is
leg animation rather than body height, and sits well inside the near-grass, so it
is left alone and stated rather than chased. A hard landing can still drop the
body up to 10 cm through `IMPULSE_BODY_FLOOR`; that is a deliberate impact squash
on a single frame, not a resting error, and it is untouched.
Affected documents/contracts: `src/render/horse/horseGaitAnimator.ts`,
`src/render/horse/wildHorseAnimator.ts`, `tools/horsePreview.mjs`,
`tools/inspectHorse.mjs`.
Approved by: Claude Code (visual presentation ownership).

---

Date: 2026-08-15
Decision: The island gets a day: a full day/night cycle, and a sea that reacts
to it.
Reason: The world had a single fixed afternoon, and a place whose light never
changes reads as a diorama under a lamp however good the ground is. One new
module (`dayNightCycle.ts`) owns the clock as a pure function from elapsed
seconds to a lighting state - sun arc, colour ramps keyed on sun ELEVATION so
dawn and dusk mirror automatically, a moon placed opposite the sun, fog that
agrees with the horizon. The scene applies that state to the lights, sky dome,
sea and fog it already owns; the cycle owns no Three objects, so every consumer
reads the same instant.

The dome grew stars (hashed from direction, quantised so they hold still while
the camera turns) and a moon disc drawn where the night light actually comes
from, so the visible moon and the shadows agree. The sea gained a second swell
octave, a sun-glitter path computed from swell-tilted normals - the strongest
single cue that a flat plane is water - and a night term that darkens the body
of the water and the unlit horizon hills, which otherwise stood at the bottom of
the night sky in full daylight.

One full cycle is 15 real minutes with the night compressed to 28% of it: dark
is an accent, not half the game. Moonlight has a deliberate playability floor -
the island must stay readable enough to ride at the depth of night. `?tod=`
pins the phase for automation, because the render-inspect-refine loop has to
photograph dusk without waiting five minutes for it; evidence sheets at pinned
midday, golden hour and night are in docs/evidence/world/.
Consequence: `SUN_DIRECTION` remains as the initial direction and the Horse
Lab stage keeps its fixed light; only the island lives through the cycle.
Affected documents/contracts: `src/world/dayNightCycle.ts`,
`src/render/world/skyDome.ts`, `src/render/world/seaVisual.ts`,
`src/world/islandScene.ts`, `tools/inspectWorld.mjs`.
Approved by: Claude Code (visual presentation ownership).

---

Date: 2026-08-15
Decision: A wild horse can learn to trust the player, and one that does becomes
a companion that follows them across the island.
Reason: The island was beautiful and empty of relationships. The fear half of
the wild horses already existed (crowd one and be kicked); this adds the other
half. Walk up slowly, stand quietly, and a watching horse becomes curious after
four seconds of quiet company, then trusting after five more. Gallop at it at
any point and the clock resets - trust is only offered to a walker, through the
same mood machine that owns the warning and the kick, so the tell-before-kick
contract is untouched and a trusting horse never kicks at all.

The first horse to trust becomes THE companion: it keeps the live rig
permanently and follows at three lengths, walking, trotting or galloping after
the player through the same gait animator the ridden horse uses. One companion,
not a herd: the live-rig budget is one (measured against the draw-call gate),
and one animal choosing you is the emotional beat anyway.
Consequence: Companion movement is presentation-layer, like the birds - it is
scenery that loves you, not a second simulation. Known gap, stated: its static
collider stays at its home spot, so there is a horse-shaped volume of air where
it used to graze and none where it now walks. Revisit if it reads badly in play.
Affected: `src/render/horse/wildHorseAnimator.ts`, `src/world/islandWildlife.ts`,
`tests/simulation/wildHorseKick.test.ts`.
Approved by: Claude Code (visual presentation ownership).

---

Date: 2026-08-15
Decision: The herd lives its own life, the gallop blows harder, and the island
remembers where you have stood.
Reason: Three player-feel changes in one pass. The instanced wild horses now
graze, lift their heads, look around and amble a couple of strides - built
entirely from what an instance matrix CAN do (swap pose mesh, turn, drift),
which from thirty metres is most of what a real grazing herd does. Every horse
owns a slot in BOTH pose meshes with the unused one at scale zero, so a head
can come up without rebuilding anything; timers are seeded per-slot so the herd
never moves in unison, and wandering stays within two strides of home so each
horse remains honest to its static collider. Wind gain now squares with speed
and the field-of-view kick is widened, so full gallop feels like commitment.
The place-name announcements persist to localStorage and the pause panel lists
every place the rider has ever stood - names only, no percentages, because
remembering where you have been is the reward.
Consequence: One boot crash found and fixed in verification: the pause panel is
built before the journal exists, so its list fills on first open rather than at
construction.
Affected: `src/world/islandWildlife.ts`, `src/audio/longrideAudio.ts`,
`src/render/camera/chaseCamera.ts`, `src/ui/longrideUi.ts`, `src/ui/ui.css`.
Approved by: Claude Code (visual presentation ownership).
