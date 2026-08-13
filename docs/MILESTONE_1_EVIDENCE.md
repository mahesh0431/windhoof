# Milestone 1 evidence - Horse Lab

Status: **COMPLETE - blind 10:42 playtest passed after refinement; targeted
recovery rerun passed**

Milestone 1 is not complete until a blind ten-minute movement test passes. This
file separates implemented and machine-verified evidence from the independent
blind tester's player-facing judgement.

## Blind playtest, 2026-08-13: failed

An independent blind playtest of 12 minutes 30 seconds of active control was
held and **Milestone 1 did not pass**. The verdict was that the motion read as a
rigid generic avatar rather than as a horse.

That is a subjective judgement about embodiment, and nothing in the automated
suites had contradicted it, because nothing in them was measuring it. The
evidence captures agreed with the tester once they were looked at properly: at
16 m/s the horse was travelling along a smooth line with 0.14 m of body
movement, a welded torso, no suspension, and no mark left on the ground.

A refinement pass was made in response (below) and then re-tested in a fresh
blind session.

## Blind playtest rerun, 2026-08-13: passed

The independent tester completed 642.2 seconds (10:42) on one uninterrupted
page using ordinary keyboard input. No reset was used during the clock. The
tester passed horse-like embodiment, satisfying gallop, turning/braking,
slopes, jump/landing clarity, camera follow, boundary containment, and ordinary
lateral recovery from the shore. The tester's summary was that the build no
longer felt like a rigid avatar sliding over terrain.

That run found two real simulation defects while preserving the subjective
pass: backward input did not always brake to idle, and a stopped shoreline pose
could become the last safe pose. Codex fixed both. Backward now always means
brake-to-idle, and the world owns a safety query that excludes shore/boundary
poses from recovery anchors. A targeted blind rerun then passed R recovery from
two different shoreline headings: both visibly relocated inland and immediately
reached 2.6 m/s after 0.5 seconds and canter after three seconds.

## Implemented foundation

### Simulation, physics, and contracts (Codex)

- Fixed 60 Hz simulation clock with bounded catch-up
- Renderer-rate input buffer with fixed-tick edge-action latching
- Immutable horse state and render snapshots
- Walk, trot, canter, and gallop speed states
- Acceleration, braking, speed-sensitive turning, and coasting
- Jump, coyote time, landing, hard-landing stumble, and safe reset rules
- Position-based kinematic Rapier capsule bridge
- Rapier autostep, ground snap, slope limits, obstacle collision, and disposal
- Render interpolation contract
- Typed `UiSnapshot`, `GameEvent`, and `GameCommand` boundary
- Recorded-input replay and quantized state diagnostics

### Player-facing build, visuals, and assets (Claude)

- Playable Three.js build at the repository root (`index.html` + `src/app/`)
- Horse Lab stage: one analytic terrain field plus independent prop records,
  with the Three.js mesh and the Rapier collider built from the same vertex
  buffer
- Stage features, each serving one exit-gate line: a 62 m open gallop run, a
  stream with a rideable ford on the corridor and a jumpable trench on the
  flanks, a plateau with a stumble-inducing north face, a tree grove for camera
  obstruction, an unclimbable bank, an overlook knoll, and a water boundary
- Procedural horse rig at real proportions with named joints, including an
  articulated torso: a shoulder sling and a lumbo-sacral coupling either side of
  a rigid ribcage, so the frame gathers and lengthens the way a horse's does
- Distance-driven gait animator using real footfall sequences for walk, trot,
  canter, and gallop, with each gait's suspension phase derived from its own
  stance windows, spinal flexion locked to that phase, an underdamped impulse
  spring for takeoff drive and landing absorption, and airborne and stumble poses
- Hoof contact debris: turf, sand, grit, and water thrown from the hoof's real
  position, in one pooled draw call
- Spring-arm chase camera with obstruction sweeps, bounded pitch, slow
  auto-alignment, look-ahead, and a speed-driven field of view
- Restrained riding interface: a fading gait strip, one-at-a-time contextual
  hints, transient state acknowledgements, and nothing in the centre or lower
  middle of the view
- Pause surface with settings and controls; pointer lock released on pause
- Accessibility controls: reduced motion, look sensitivity and inversion, field
  of view, camera follow strength, text scale, independent sound categories
- Keyboard-complete interface: visible focus rings, a focus-trapped and `inert`
  pause dialog, polite live regions for state changes, and a game that is fully
  playable without ever taking pointer lock
- Diagnostics overlay, off by default, highlighting performance-gate breaches
- Fully synthesised audio: per-surface hooves, wind, surf, breathing, whinny,
  and landings
- Self-hosting browser inspection tooling producing canonical views in
  [`docs/evidence/`](evidence/README.md); it starts its own server and exits
  non-zero on console errors, so it is a check as well as a capture run

## Automated evidence

```text
pnpm typecheck     # clean
pnpm lint          # clean
pnpm test          # 78 tests, 10 files
pnpm build         # ~1.26 MB gzipped total
pnpm test:browser  # 40 passed across Chromium and WebKit
pnpm inspect       # 22 canonical views, 0 console errors
```

`pnpm inspect` starts its own server, so all of these run from a clean checkout
with nothing else already running.

### What the unit suites assert

- Fixed-step timing, horse controller rules, input latching, and the Rapier
  bridge (pre-existing)
- Stage terrain is finite, deterministic, and continuous everywhere the horse
  can reach
- The gallop corridor is rideable and long enough for gallop to develop
- The stream's corridor crossing is shallow and rideable, and the flank trench
  fits inside a canter-speed jump arc with margin, derived from
  `DEFAULT_HORSE_TUNING` rather than chosen by eye
- The steep bank exceeds the climb limit and is classified as rock
- The plateau's north face produces an impact above the hard-landing threshold
- Props have stable unique IDs, sit inside the plot, and leave the spawn and the
  corridor clear
- Onboarding stays silent in the opening seconds, during a gallop, and while
  paused; shows one hint at a time; never repeats; and leaves a gap between hints
- Presentation settings clamp, repair corrupt values, and survive missing storage

### What the browser suite asserts, in Chromium and WebKit

- The build boots to a rendered riding view with no console errors
- The interface is restrained at rest: no dialog, no diagnostics, gait strip only
- Pointer focus is prompted and movement is taught first
- The focus prompt is a keyboard-reachable button, and it shrinks to a corner
  pill once the player is riding instead of dimming the view forever
- Important state changes are announced through live regions, and the gait strip
  is kept out of the accessibility tree
- Leaving the window pauses instead of riding on unattended
- The horse reaches full gallop speed on real terrain and stays grounded
- The horse cannot gallop off the edge of the stage
- The chase camera pulls in for obstruction, never jams inside the horse, and
  recovers to a normal arm length
- Pause opens a modal surface, releases pointer lock, and stops camera input
- The pause dialog keeps keyboard focus inside itself through 40 forward tabs
  and 12 backward ones
- The pause surface keeps Resume on screen at 1024x520, with the settings list
  genuinely scrollable rather than cut off
- Return to safe ground is acknowledged in words
- Settings apply immediately and persist across a reload
- Diagnostics stay hidden until asked for
- Draw calls stay under 200 and triangles under 750k at gallop
- At gallop the rig's body travels vertically and its back flexes, so the horse
  moves as a body rather than as a model on a rail
- Standing still is still: only breathing moves the body
- The hooves throw debris on real ground, and the debris clears again instead of
  accumulating for the session

Measured at 1600x900 in the inspection run: **82 draw calls, 67.7k triangles**.
The debris system adds one draw call and no triangles at rest.

## Defects found by browser inspection and fixed

Recorded because they are the substance of the render-inspect-refine loop, and
none of them was visible from unit tests or DOM assertions:

1. The camera sat jammed against the horse's rump for the entire ride: the
   obstruction sweep started inside the horse's own kinematic capsule, and later
   inside whatever the look-ahead pivot was about to reach.
2. A galloping player could run off the plot and fall forever.
3. The whole scene rendered as if in shadow: Three does not refresh a directional
   light's shadow projection when the frustum bounds are edited, so the light
   kept its default ten-metre box.
4. Fog tuned for a kilometre-scale island washed the middle of a 220-metre plot
   to near-white and removed the distant silhouettes used for orientation.
5. A 170-metre-wavelength terrain tint painted one pale swathe across the world
   that read as a fog bank sitting on the grass.
6. The stream trench's steep walls were classified as rock and painted lighter
   than the surrounding grass, so a hole in the ground read as a pale ridge.
7. Rock was lighter than grass, inverting the traversability signal.
8. The horse's neck leaned backward out of the withers and its tail tucked under
   at speed instead of streaming behind.
9. Tree trunks and logs rendered near-black: instanced colours multiply the
   material colour, and both were brown.
10. **The stream trench was a trap.** A trench narrow enough to clear with a jump
    necessarily has walls steeper than the 28-degree climb limit, so with the
    deep section on the gallop corridor the first gallop ended with the horse
    stuck in a ditch it could not ride out of. The ford now sits on the corridor
    and the trench is on the flanks.

### Second pass: accessibility and interaction

Found by re-auditing the running build with keyboard only, at a short window,
and with focus and live-region instrumentation:

11. **A keyboard-only player rode the whole game through a scrim.** The "click
    to look around" prompt dimmed the view and stayed up forever, because
    headless and keyboard-only sessions never take pointer lock. It now has a
    full form before the first ride and a small corner pill after it.
12. **Keyboard focus never entered the pause dialog.** Instrumenting
    `HTMLElement.prototype.focus` showed the call happening while
    `document.activeElement` stayed on `BODY`: animating `visibility` left the
    dialog computed as hidden, so the browser silently rejected the focus. Fixed
    with a zero-duration `visibility` transition, delayed only when hiding.
13. **Tab escaped the pause dialog in WebKit.** The trap detected first and last
    element by comparison, but WebKit omits buttons and checkboxes from the
    default tab order, so the edges never matched. The trap now always
    intercepts Tab and moves focus by index.
14. **The pause panel overflowed a short window.** A probe measured the panel at
    802 px in a 520 px viewport, pushing Resume off screen: a percentage
    `max-height` against an auto-sized grid row is indefinite and resolves to
    `none`. The row is now definite and the settings list scrolls internally.
15. **A regression I introduced myself:** styling `<noscript>` directly
    overrides the user-agent `display: none`, which would have shown the
    scripting-required fallback to every player. Styling moved to a wrapper
    inside the element.
16. The canvas was exposed as `role="img"`, describing the entire playable game
    as a picture. It is now `role="application"` with a descriptive label.
17. Gait, hint, and acknowledgement changes were invisible to a screen reader.
    They now go through polite live regions, and the decorative gait strip is
    hidden from the accessibility tree so it is not read twice.
18. Alt-tabbing away left the horse riding on unattended. Window blur now pauses.
19. A player who never clicked got silence: browsers hold the audio context
    suspended until a gesture. The first keypress now resumes it.
20. Two presentation slips: the speed readout used "M/S", and the compact focus
    pill sat under the diagnostics overlay.

### Second pass: embodiment, after the failed playtest

Found by re-auditing the running build and by looking properly at the captures
the previous pass had already produced:

21. **At 16 m/s the horse moved 0.14 m vertically and its torso was one welded
    mesh.** The gallop capture shows a model being carried along a smooth line.
    The torso now articulates at two joints and the body travels roughly 0.35 m
    through a stride, on a suspension pulse placed in the window where no hoof
    is in stance.
22. **The trot, canter, and gallop footfall offsets were not real sequences.**
    A test that recomputes the stance windows from the offsets found that the
    canter and gallop had no suspension window at all and the trot's overlapped
    a planted leg. All three were rebuilt from the real landing orders. This had
    been sitting behind a source comment claiming the sequences were correct.
23. **Rising pitched the horse's nose down and falling pitched it up.** The
    airborne pitch term carried the wrong sign, so every jump began as a
    nose-dive and ended nose-high.
24. **A single grain of sand drew eight hundred pixels wide.** The new debris
    system sized points with an arbitrary constant instead of real units, and
    two captures came back as a full-screen beige wall. Sizes are now diameters
    in metres, projected with the renderer's own scale and clamped.
25. **The mane read as a dorsal fin.** Each lock was a capsule rotated about its
    own centre, so it stood out equally both ways instead of falling along the
    crest. Invisible from behind; obvious the moment there was a side-on capture.
26. **A scatter rock sat on the plateau ramp at (-1.5, 14.2).** The inspection
    tour parked against it twice. The corridor keep-clear had stopped at z = 13
    and the test that guarded it had stopped at z = -14, so both missed it.
27. **The side-on capture put the camera inside a hillside** and cropped the
    horse's legs off. It now runs on the flattest long leg in the lab, and its
    shutter waits on the rig's own body height so the frame lands on the
    suspension phase rather than on a random point in the stride.

## Fixed in the simulation layer during this pass

**The horse could stall permanently on a gentle slope.** The inspection tour
parked the horse on the plateau ramp in two consecutive runs, at speed 0, on
ground whose steepest collider triangle is 21.9 degrees against a 28-degree
climb limit, with no prop within six metres. Browser probing showed it followed
arrivals at low speed or straight after a landing, and that once stalled the
horse could not restart.

Codex has since replaced displacement-inferred blockage with an explicit
physics signal for a wall-like contact opposing horizontal travel. Legal ground
and slopes no longer brake acceleration, while a true boundary still settles
the locomotion state instead of animating a gallop in place. Thirteen probe
approaches after the change climbed cleanly, the flat Rapier harness again
passes its distance gate, and all 40 browser checks now pass. Noted here because
the symptom is what the capture tour was failing on, not because there is
anything left to do.

## Gate result

Milestone 1 passes. The blind tester judged embodiment horse-like, gallop
satisfying, turning and braking readable, jumps and landings clear, and the
follow camera free of clipping or disorientation over the full ride. Automated
verification passes 80 unit/integration tests and 40 browser tests across
Chromium and WebKit.

Two qualifications remain outside the gate claim:

- Mouse free-look was not exercised because pointer lock is unavailable in the
  headless blind-test path. Programmatic camera obstruction and recovery are
  covered in both browsers, and the ten-minute follow-camera experience passed.
- Frame rate on target low-end hardware remains unmeasured. Headless capture
  draw calls and triangle counts are real; its SwiftShader frame rate is not.

## Known limitations inside the current build

- The horse's visual body is longer and wider than its 1.04 m diameter collision
  capsule, so at close range the nose or flank can visually overlap thin
  obstacles the capsule has correctly stopped short of.
- There is no foot inverse kinematics. The whole body conforms to the ground
  slope; individual hooves do not, and a leg swung to the extremes of a gallop
  stride cannot also reach the ground, so a hoof can hang slightly short of the
  surface at the ends of the swing.
- The Horse Lab stage is a hand-authored fixture, not compiler output. It is
  replaced by the WorldManifest at Milestone 2.
- No gamepad support. Keyboard and mouse only, per the provisional platform
  default in [DECISIONS.md](DECISIONS.md).

Milestone 1 is frozen at this evidence point. Milestone 2 may now begin with the
deterministic WorldSpec-to-WorldManifest island compiler.
