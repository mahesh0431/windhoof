# Asset provenance register

Every external or generated asset must be registered before entering a release
build. Do not record credentials, private account data, or private generation
prompts containing sensitive information.

## Milestone 1 summary

**Nothing in this milestone is downloaded, licensed from a third party, or
redistributed.** Every visual and audio asset is generated procedurally in the
browser at runtime from code in this repository, using only `three` (MIT) and
the Web Audio API. There are no model files, texture files, audio files, or
font files in the project, and the interface uses system font stacks only.

This was a deliberate decision recorded in [DECISIONS.md](DECISIONS.md): it
removes the entire licensing and redistribution question for Milestone 1 while
still proving silhouette, scale, gait readability, and surface feedback.

All entries below are `approved-placeholder`. None is release quality, and each
is expected to be replaced before Milestone 5.

## Register

| Asset ID | Purpose | Source/tool | Creator/provider | Acquired/generated | License/terms | Attribution | Modifications | Source/reference | Review status |
|---|---|---|---|---|---|---|---|---|---|
| `horse-rig-placeholder` | Player horse: articulated torso (forehand, rigid ribcage, spine), neck, head, ears, mane, tail, four three-segment legs | Procedural Three.js primitives assembled in code | Claude Code, for this project | 2026-08-12 | Project-owned; same terms as the repository | None required | n/a - authored here | `src/render/horse/horseVisual.ts` | `approved-placeholder` |
| `horse-gait-animation` | Idle, walk, trot, canter, gallop, suspension, takeoff, landing, airborne, and stumble motion driven by controller state | Procedural animation; real quadruped footfall sequences, duty factors, spinal flexion, and an impulse spring | Claude Code, for this project | 2026-08-12, revised 2026-08-13 | Project-owned | None required | n/a - authored here | `src/render/horse/horseGaitAnimator.ts` | `approved-placeholder` |
| `stage-terrain` | Horse Lab ground: corridor, stream, plateau, knoll, bank, beach, seabed | Analytic height field, sampled into one shared vertex buffer | Claude Code, for this project | 2026-08-12 | Project-owned | None required | n/a - authored here | `src/stage/horseLabStage.ts`, `src/stage/stageTerrainMesh.ts` | `approved-placeholder` |
| `stage-props` | Rocks, boulders, logs, trees, and shrubs, instanced per family | Procedural Three.js primitives with deterministic vertex roughening | Claude Code, for this project | 2026-08-12 | Project-owned | None required | n/a - authored here | `src/render/world/propsVisual.ts` | `approved-placeholder` |
| `sky-dome-shader` | Three-band gradient sky with a warm sun bloom | Hand-written GLSL | Claude Code, for this project | 2026-08-12 | Project-owned | None required | n/a - authored here | `src/render/world/skyDome.ts` | `approved-placeholder` |
| `sea-and-distant-land` | Water surface with a shore-keyed surf band, plus hazed landforms on the horizon | Hand-written GLSL and procedural geometry | Claude Code, for this project | 2026-08-12 | Project-owned | None required | n/a - authored here | `src/render/world/seaVisual.ts` | `approved-placeholder` |
| `hoof-contact-debris` | Turf, sand, grit, and water thrown up where the hooves strike | Pooled Three.js `Points` with hand-written GLSL; deterministic jitter, no `Math.random` | Claude Code, for this project | 2026-08-13 | Project-owned | None required | n/a - authored here | `src/render/horse/hoofContacts.ts` | `approved-placeholder` |
| `windhoof-palette` | Shared colour system for terrain, vegetation, water, sky, and the horse | Authored colour values | Claude Code, for this project | 2026-08-12 | Project-owned | None required | n/a - authored here | `src/render/palette.ts` | `approved-placeholder` |
| `audio-hooves` | Per-surface hoof impacts, triggered by animator footfalls | Web Audio synthesis: filtered noise burst plus a low sine thump | Claude Code, for this project | 2026-08-12 | Project-owned; no sample material used | None required | n/a - authored here | `src/audio/windhoofAudio.ts` | `approved-placeholder` |
| `audio-ambience` | Wind bed that rises with speed, and a surf bed keyed to shore distance | Web Audio synthesis: looped generated noise through biquad filters | Claude Code, for this project | 2026-08-12 | Project-owned; no sample material used | None required | n/a - authored here | `src/audio/windhoofAudio.ts` | `approved-placeholder` |
| `audio-horse-voice` | Whinny on call, breathing keyed to effort, landing impacts | Web Audio synthesis: detuned oscillator pair with a pitch contour and vibrato tail | Claude Code, for this project | 2026-08-12 | Project-owned; no sample material used | None required | n/a - authored here | `src/audio/windhoofAudio.ts` | `approved-placeholder` |
| `region-materials` | Per-region ground colour ramp, bare-rock slope threshold, and ground-cover density/scale/palette for the five first-island regions | Authored colour and threshold values, blurred across region borders | Claude Code, for this project | 2026-08-13 | Project-owned | None required | n/a - authored here | `src/world/regionVisuals.ts`, `src/world/islandTerrainMesh.ts`, `src/world/islandGroundCover.ts` | `approved-placeholder` |
| `region-landmarks` | Authored silhouettes per region: split sea stack and broken beacon, lone tree and stone ridge, split cedar and ruined arch, waterfall notch and leaning bridge, broken black ridge | Procedural Three.js primitives merged per material family, seated per piece on sampled terrain | Claude Code, for this project | 2026-08-13 | Project-owned | None required | n/a - authored here | `src/world/regionLandmarks.ts` | `approved-placeholder` |
| `journey-markers` | Generic wayfinding cues for any compiled world: hoofprint trail at a herd trace, rising mist over a hollow the spec gives a water sound, circling flocks over overlooks and answering ground. Stands off any discovery `trace-scenes` has claimed, so the first island's five traces keep their own scenes | Procedural Three.js primitives, instanced per cue | Claude Code, for this project | 2026-08-13 | Project-owned | None required | n/a - authored here | `src/world/journeyMarkers.ts` | `approved-placeholder` |
| `crossing-wildlife` | Small four-legged animals for the optional plain crossing: barrel, haunch, chest, neck, head, ears, four tapered legs, raised tail, merged into one instanced geometry with per-instance coat colour | Procedural Three.js primitives merged via the in-repo `mergeGeometries` | Claude Code, for this project | 2026-08-13 | Project-owned | None required | n/a - authored here | `src/world/journeyMarkers.ts` | `approved-placeholder` |
| `trace-scenes` | The five herd-trace scenes: storm-beach hoofprint trail and wrack, flattened resting circle with its inward-leaning stalk ring, Fernwood rubbing post inside a conifer stand, river-hollow mud patch with crossing prints and reeds, plus stone rings at the hollows and worn ground at the cuts | Procedural Three.js primitives, instanced per element, seated per piece on sampled terrain | Claude Code, for this project | 2026-08-13 | Project-owned | None required | n/a - authored here | `src/world/traceScenes.ts` | `approved-placeholder` |
| `living-herd` | Nine grazing horses on the Blackstone summit saddle: barrel, haunch, chest, long low neck, head, four tapered legs and tail, merged into one instanced geometry with per-instance coat colour, and a grazing/notice motion | Procedural Three.js primitives merged via the in-repo `mergeGeometries` | Claude Code, for this project | 2026-08-13 | Project-owned | None required | n/a - authored here | `src/world/traceScenes.ts` | `approved-placeholder` |
| `ui-typography` | Interface type | System font stacks (`ui-serif`/Georgia for display, `system-ui` for body) | Operating system | 2026-08-12 | No font is embedded or redistributed | None required | n/a | `src/ui/ui.css` | `approved-placeholder` |

## Honest assessment of placeholder quality

Stated plainly, so nobody mistakes any of this for finished work:

- The horse reads convincingly as a horse in silhouette and gait, but it is
  assembled from primitives. Body seams are visible at close range and there is
  no skinning, muscle deformation, or coat detail.
- Gait footfall sequences and stride lengths are correct and distance-driven, so
  hooves do not slide. There is no inverse kinematics, so hooves do not
  individually conform to uneven ground; the whole body conforms to the slope
  instead. The same limitation shows in the stride: a leg swung far forward or
  back cannot also reach the ground, so at the extremes of a gallop a hoof can
  hang a little short of the surface.
- The torso articulates at two joints, which is enough for the frame to gather
  and lengthen, but the shells are overlapping primitives rather than a skinned
  mesh. It holds up in motion and at the ranges the chase camera uses; it would
  not survive a close static inspection.
- Hoof debris is flat round sprites with no texture and no collision. It reads
  as material thrown from the right place in the right direction, and nothing
  more than that.
- Trees, rocks, and shrubs are readable at speed but are clearly stylised
  primitives, not a vegetation family.
- The synthesised audio confirms rhythm, speed, surface, and contact. It sounds
  synthetic, and a real recording will be better.
- The crossing wildlife replaced bare boxes and now reads as animals in
  silhouette - legs under a raised head, bounding rather than gliding - but they
  are one merged shape with no articulation. They hold up in motion at the
  distances the crossing is seen from and would not survive a player walking up
  and standing next to one.
- No weather or environmental effects exist beyond the spring mist. They are out
  of the current milestone's scope.
- The region landmarks are large primitive forms - boxes, cylinders, cones and
  spheres - with flat colours and no texture. They do the one job a landmark has
  at four hundred metres, which is to be a recognisable outline, and they will
  not survive a player standing at the foot of one. The Blackstone ring in
  particular reads as monoliths rather than as broken rock.
- Region materials are colour and threshold values only. There is no rock
  texture, no scree, and no material variation within a region beyond slope.
- The trace scenes are legible at riding distance and thin close up. The
  hoofprints are flat unlit discs, the pressed circle is a flat disc with a hard
  edge, and the mud patch is the same. They read correctly as marks on ground
  from the saddle and would not survive a player lowering their head to one.
- The living herd reads as horses in silhouette at a hundred metres and as
  simplified shapes close to. They are one merged instanced geometry with no
  articulation: heads dip and lift and bodies turn and walk, but no leg moves
  independently of a body. They are also slightly over life size, because at
  true scale on open highland they read as specks.
- Nothing in the trace scenes is textured. Every surface is flat colour, in
  keeping with the rest of the island, and every one of them would need real
  material work before release.

## Rules for later milestones

- No asset with unclear usage or redistribution rights enters a release build.
- A sourced or generated model is rejected rather than rescued by runtime hacks.
- Every replacement must keep the same rig contract: the animator drives named
  `Object3D` joints, so new geometry can be swapped in without rewriting motion.

## Review states

- `candidate` - being evaluated; not release-approved
- `approved-placeholder` - acceptable only for internal prototype use
- `approved-release` - provenance and release rights reviewed
- `rejected` - unsuitable, unclear, incompatible, or over budget
