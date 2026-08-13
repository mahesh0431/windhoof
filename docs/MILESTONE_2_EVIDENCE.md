# Milestone 2 evidence - deterministic island compiler

Status: **complete — compiler, browser realization, and blind traversal gate passed**

## WorldClaw-style pipeline implemented

The authored source is `WorldSpec`; the generated result is an immutable
`WorldManifest`. Compilation follows one direction:

1. Validate structured intent and references.
2. Create independent named random streams.
3. Lay out semantic regions, safe/expressive routes, discovery anchors, and
   exclusions globally.
4. Sample one global terrain function into row-major chunks.
5. Derive region, moisture, shore-distance, slope, and traversability fields.
6. Emit independently addressable placement records.
7. Quantize records, attach stable IDs, and hash canonical source/output data.

No generated chunk is hand edited. Detailed regional assets remain a later
selective realization pass, as required by the adapted WorldClaw method.

The structured plan now carries the approved global mood, atmosphere, lighting,
and palette anchors plus per-region terrain family, silhouette, scatter-family,
and density intentions. These are design constraints, not asset prescriptions:
Claude Code still owns the concrete visual composition and sourcing strategy.

## Determinism contract

- Seed is an unsigned 32-bit integer.
- Every generation concern uses a named random stream derived from world seed.
- Terrain is sampled in global coordinates; adjacent chunks request the exact
  same border coordinates.
- Generated numeric output is quantized before hashing.
- Hashing uses canonical key ordering and excludes `manifestHash` itself.
- Semantic authored IDs and generated stable IDs are separate.
- Reordering authored region, discovery, or connection arrays preserves the
  semantic stable-ID set; optional-route selection is by stable connection id,
  not array position.
- Compiler geometry avoids `Math.sin`/`Math.cos` so generation does not inherit
  the cross-runtime trigonometry caveat of physics replay.

## Automated exit evidence

The production example is a 512 m square, 4 x 4 chunk vertical slice with 65 x
65 samples per chunk. The generation suite compiles 100 distinct seeds under
the project-pinned Node 24.18.0 and pnpm 11.16.0 runtimes (`.mise.toml`) and
verifies for every seed:

- no non-finite terrain or transforms;
- exact shared-border equality;
- dry spawn and spawn slope within the authored limit;
- connected mandatory discovery regions;
- mandatory safe route plus an optional expressive route;
- every route segment within its authored slope envelope;
- collision-bearing scatter records outside safe-route clearance;
- correct row-major semantic-field lengths;
- unique stable IDs and a unique manifest hash.

Additional known-answer tests freeze the random stream and canonical hashing.
The same source compiles twice to deeply equal manifests and hashes.

Command:

```text
mise exec -- pnpm test:generation
```

Final result: 14 generation tests pass, including all 100 seeds, four real
Rapier traversal/recovery scenarios, a presentation-seam check proving
reassembled chunk heights and normals remain continuous, a recovery-footprint
test, a coastal-slope bound, and a camera query that excludes only the invisible
containment wall.

The traversal test builds the compiled chunk meshes and collision-bearing
scatter in Rapier, attaches the exact proven Horse Lab controller, and rides
every safe-route waypoint. Its first run correctly failed near the forest
endpoint: the mathematical centreline met the slope promise, but its usable
width did not. The compiler now creates a fully graded authored-width corridor
before blending back to surrounding terrain. The same end-to-end test then
passed without reset or hand editing.

The second Rapier scenario starts at full-speed approach distance from the
compiled island's sea boundary, proves the horse reaches gallop, stops grounded
on the dry generated shore shelf, and verifies reset returns to the inland safe
anchor rather than retaining the boundary pose.

Browser compilation runs in a one-shot module worker rather than holding the
render thread. Chromium and WebKit both compiled the 16-chunk production slice,
returned source and manifest hashes exactly equal to Node's compiler output,
and allowed repeated 10 ms main-thread heartbeats while generation was running
(2 browser checks passed).

## Browser realization and regional refinement

The default browser route now compiles the authored vertical-slice spec in a
worker and realizes that exact manifest as the visible and collidable island.
The Horse Lab remains available as a fixture, but it is not the default world.

The regional pass is driven by the manifest rather than screenshot-specific
placement:

- one global mesh reconstructed from the 16 shared-border chunks;
- terrain colour and material response from region, moisture, shore-distance,
  slope, traversability, and safe-route fields;
- collision-bearing regional clumps from explicit placement records;
- deterministic, non-colliding ground cover from each region's authored
  terrain family and scatter density;
- chunk-bounded instanced ground cover so off-camera chunks can be culled;
- region place names, atmosphere, sea, landmarks, and restrained riding UI.

Targeted current-build evidence for the natural trail, Longgrass, and Fernwood
is under `docs/evidence/island/spots/`. Independent black-box evidence is under
`docs/evidence/island/blackbox/`.

## Defects found by render-inspect-refine

The milestone did not pass on its first browser realization. The loop found and
fixed the following real defects:

1. Region elevation midpoints lifted safe routes 8.7-17 m above natural ground,
   producing 67-76 degree causeway walls. Region anchors now use the
   deterministic natural height clamped to the authored elevation envelope.
2. Nearest-cell 18 m lattice noise produced V-shaped seams capable of becoming
   recovery poses. Noise is now smooth-interpolated, and a recovery pose must
   pass a nine-point 1.5 m footprint check with bounded relief.
3. The north shore could trap ordinary diagonal steering. Outward motion still
   stops at sea, while genuine steering retains a tangential component and
   receives a measured inward release.
4. The outer coast could remain too steep and the invisible wall collapsed the
   chase camera. A broad deterministic coastal falloff keeps the outer 4-40 m
   band within 28 degrees, and camera sweeps ignore only the invisible boundary
   collider while horse collision remains unchanged.
5. Island transients used clamped simulation time and could overstay on a slow
   renderer. UI transients now use an unclamped, pause-aware presentation clock;
   gameplay onboarding intentionally remains on simulation time.
6. Ground cover originally submitted 69,398 tufts through two island-wide
   meshes. It is now split per terrain chunk for frustum culling.

## Final verification

Pinned runtime: Node 24.18.0 and pnpm 11.16.0.

```text
mise exec -- pnpm typecheck     PASS
mise exec -- pnpm lint          PASS
mise exec -- pnpm test          99/99 PASS (14 files)
mise exec -- pnpm test:generation 14/14 PASS (3 files)
mise exec -- pnpm test:browser  52/52 PASS (Chromium and WebKit)
mise exec -- pnpm build         PASS
```

The production build still reports the expected large-chunk warning: Rapier's
compatibility bundle is approximately 2.85 MB raw / 1.09 MB gzip. This is a
Milestone 3 loading/streaming optimization item, not a Milestone 2 correctness
failure.

Independent black-box traversal used ordinary browser key-down/key-up controls
and player-facing F3 diagnostics without source inspection:

- Saltwind Coast to Longgrass in 10 seconds and Fernwood in 20 seconds;
- exactly 300 seconds of active movement with one pause/resume and no reload;
- final state in Fernwood grounded at 8.55 m/s, camera 6.80 m, approximately
  50 fps / 20 ms;
- shoreline reset relocated to smooth inland ground and immediate W+D reached
  8.38 m/s;
- final north-boundary delta: W+D for 10 seconds reduced radius by 14.22 m,
  reached 8.38 m/s, stayed grounded, and retained a 6.80 m camera with no
  steep-face riding or clipping.

The five-minute run predates only the final coastal/camera delta; that exact
delta was then checked independently on the final frozen build. Compiler,
physics, unit, worker, and multi-browser suites were rerun on the final combined
state.

## Honest limitations carried forward

- The horse, vegetation, rocks, flowers, audio, and landmarks remain procedural
  prototype assets. Ground-cover tufts and flower heads are visibly primitive.
- The full 512 m slice is active at once. Chunk lifecycle, predictive loading,
  disposal, repeated-circuit memory stability, and target-GPU profiling belong
  to Milestone 3.
- Automated Chromium uses software WebGL and can advance simulation far slower
  than wall time. State-based assertions prevent that from being mistaken for a
  physics stall; independent testing observed approximately 50 fps on the
  available interactive browser.
