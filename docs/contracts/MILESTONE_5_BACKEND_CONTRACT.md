# Milestone 5 backend contract

Milestone 5 adds the first full island without mutating the frozen Milestone 4
vertical slice. The structured WorldClaw-inspired source of truth is:

```text
WorldSpec v4 global plan
  -> deterministic WorldManifest v4
  -> fixed-step horse and exploration simulation
  -> versioned save truth and runtime lifecycle truth
  -> Claude-owned audiovisual realization
```

## Compatibility boundary

- The Milestone 4 source and manifest stay on schema version 3.
- The first island uses schema version 4 and generator version `0.5.0`.
- The v3 compiler path is unchanged and retains manifest hash
  `fnv1a64-75ef4f476903558d`.
- `GameSaveV1` does not change. A slice save is a different `worldId`; a
  regenerated first island is rejected by generator or manifest identity.
- No scene graph, renderer, physics object, chunk residency, or PRNG cursor is
  persisted.

## Executable global plan

The first island is 1,024 by 1,024 metres, divided into 64 authored 128-metre
chunks with 2-metre terrain cells. It remains fully resident until measurement,
not anticipation, proves streaming is necessary.

The global plan has five anchored regions:

| Region | Anchor x,z | Terrain target | Purpose |
|---|---:|---:|---|
| Saltwind Coast | `0,-340` | 6 m | storm-beach opening and first tracks |
| Longgrass Plain | `310,-120` | 22 m | open gallop and resting-circle trace |
| Fernwood | `275,220` | 32 m | close control and caught-hair trace |
| River Hollow | `-260,220` | 14 m | fords, spring, call, and rest |
| Blackstone Crown | `0,80` | 68 m | central highland and living herd |

Saltwind, Longgrass, Fernwood, and River Hollow form one authored coastal
cycle. Blackstone is the central highland and has two mandatory safe approaches
plus an expressive Fernwood ridge approach. Four optional expressive cuts
shorten familiar return journeys. Authored `viaMeters` control points keep a
coastal edge from becoming an accidental chord through the island.

Schema v4 adds only the source truth v3 lacked:

- `topology.coastalLoopRegionIds` and `centralHighlandRegionId`;
- per-region target elevation and influence radius;
- per-connection safe/expressive kind, semantic role, and authored via points.

Regional terrain is blended from one immutable base field in stable-ID order.
Route corridors are the final terrain constraint so coastal falloff and scene
pads cannot cut through a safe route. All output remains quantized and hashed.

## Belonging progression

Exactly five discoveries are mandatory, one herd trace in each region:

1. Storm-beach hoofprints — inspect.
2. Longgrass resting circle — linger.
3. Fernwood caught hair — inspect.
4. River spring tracks — call.
5. Blackstone living herd — answering call, then linger.

The first four have no completion prerequisites and may be found in any order.
After all four complete, calling within the high-pasture response zone schedules
one deterministic answer after 120 fixed ticks and reveals the living herd.
The final linger emits `JourneyCompleted` once. Simulation continues in normal
free roam; there is no forced menu, teleport, input lock, or ending mode.

Two optional resting hollows remain reusable save/reset locations. Optional
shortcut discoveries record knowledge but never lock physical terrain.

## Compiler and manifest invariants

Source validation proves:

- the coastal loop contains unique known regions and excludes the highland;
- every consecutive loop pair has exactly one mandatory safe coastal edge;
- adjacency is symmetric and every connection joins adjacent distinct regions;
- the mandatory safe graph reaches every region from spawn;
- Blackstone has safe and expressive approaches;
- control points remain finite and inside containment;
- terrain targets lie inside authored elevation ranges;
- expressive shortcuts are optional and coastal routes are safe/mandatory;
- exactly five mandatory herd traces exist, one per region;
- the final trace requires exactly the preceding four and is event revealed;
- at least two optional resting hollows exist; and
- mandatory destinations carry at least two different cue kinds.

Compiled-manifest validation additionally proves:

- all v3 seam, ID, finite-value, spawn, slope, and collision invariants;
- the authored coastal cycle survives compilation exactly once;
- every route centreline is dry and horse-traversable;
- coastal routes remain inside the authored shore-distance band;
- every mandatory trace is raster-reachable from spawn;
- each mandatory trace lies within 120 metres of a safe approach;
- mandatory scenes remain at least 80 metres apart; and
- the living herd stands at least 20 metres above every earlier trace.

Narrative uniqueness and a 15–30 minute human journey are not machine claims.
They remain player-visible release gates.

## Graphics lifecycle seam

WebGL loss is runtime truth, not gameplay truth. A separate deterministic state
machine owns `ready`, `context-lost`, `restoring`, `restored-paused`, and
`failed` states plus a monotonically increasing recovery generation.

Loss pauses simulation, clears physical and latched input, suspends audio,
releases pointer lock, and requests one non-blocking safe save. Simulation,
physics, discoveries, animation time, and metrics do not advance while lost.
Restoration reuses the retained CPU scene and performs one smoke render. It
never resumes the horse automatically: an explicit player Resume is required.
A failed smoke render leaves the simulation paused and exposes only the stable
`restore-render-failed` code to presentation.

Claude owns the waiting, restored, Continue, and fatal/reload presentation. It
does not own graphics lifecycle truth.

## Provisional release assumptions

Implementation proceeds with desktop keyboard/mouse, desktop Chromium and
WebKit, restrained naturalistic mystery, and full residency. Before a final
release claim, Mahesh must still confirm the ending tone, target browser matrix,
mobile/gamepad/remapping scope, and whether the 1,024-metre journey actually
lands inside 15–30 minutes.
