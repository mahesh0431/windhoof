# Milestone 4 backend contract

WorldSpec and compiled manifests use schema version 3. Version 3 carries the
executable journey rules introduced in version 2 and adds authored global-plan
region anchors plus authored discovery offsets. It is intentionally not
accepted as an older manifest.

Every region authors its island-local metre anchor, and every discovery authors
a metre offset from that anchor. JSON array order and seeded jitter therefore
cannot silently rearrange story geography. The
compiler derives elevation from the same deterministic terrain field, while
manifest validation rejects overlapping mandatory scenes and containment-edge
placements. An overlook must also remain at or above the authored region's
minimum high-ground elevation; a coastal shelf is not a valid overlook even if
it is dry and traversable. Seeded randomness may shape terrain and scatter, but
may never collapse the trace, spring, and overlook into one completion area.

This contract is the authoritative simulation/save seam for the exploration
vertical slice. It follows the WorldClaw-inspired workflow already adopted by
Windhoof:

```text
authored WorldSpec
  -> validated deterministic WorldManifest
  -> fixed-tick island simulation
  -> semantic snapshots and events
  -> Claude-owned audiovisual presentation
```

Presentation may interpret these semantics, but it must not infer or mutate
progression truth.

## Authored progression

Every discovery carries:

- a stable `journeyOrder` independent of JSON array order;
- prerequisite discovery IDs;
- an event or proximity reveal rule;
- a visit radius;
- a proximity, call, linger, inspect, or rest completion rule; and
- an explicit autosave decision.

Call-response events carry an anchor, trigger radius, fixed response delay,
prerequisites, and event-revealed discovery IDs. The compiler rejects missing
references, duplicate reveal ownership, non-event reveal targets, cycles,
invalid timing/radii, and invalid resting-hollow completion.

## Deterministic truth

`IslandSimulation` advances horse and exploration truth at 60 Hz. Renderer
frame partitioning does not affect progression. Edge actions remain latched
until an authoritative tick consumes them once.

Discovery state is monotonic:

```text
hidden -> revealed -> visited -> completed
```

Intermediate transitions are never skipped in the emitted event stream.
Passive transitions use stable discovery-ID ordering. Nearest contextual
interactions use distance with stable-ID tie breaking. Linger, rest, inspect,
and periodic saving require a normal, slow, safely grounded horse.

The authored vertical-slice arc is:

1. Answer the distant call inside its world-space trigger.
2. Receive the response after exactly 90 simulation ticks.
3. Follow the revealed first herd trace and resting hollow.
4. Inspect the trace and rest at the hollow.
5. Reach and linger at the overlook after its prerequisites complete.

The optional wildlife crossing may complete through proximity without blocking
the mandatory journey.

## Player-facing semantic seam

`UiSnapshot` exposes world/region identity, known discoveries only, active
objective semantics, contextual interaction, mandatory progress, journey
completion, and persistence status. Hidden discoveries are never published as
known places.

`GameEvent` exposes discovery transitions, answered calls, interactions, rest,
autosave requests, journey completion, and persistence status. Claude owns all
wording, layout, visual treatment, spatial/auditory cues, and accessibility
equivalents.

## Save boundary

`GameSaveV1` contains only:

- save/world/generator/manifest identity;
- the last validated safe pose;
- discovery states; and
- play-time ticks.

It never contains renderer or Rapier objects, chunk residency, camera or
animation state, PRNG cursors, or airborne velocity. Load compatibility is a
discriminated outcome: none, corrupt, unsupported version, wrong world,
generator mismatch, manifest mismatch, or compatible. A mismatch is never
silently applied.

An unsafe saved pose falls back to manifest spawn while compatible discovery
progress remains intact. A loaded horse always starts grounded, idle, and at
zero speed. IndexedDB is behind `SaveAdapter`; `AutosaveCoordinator` serializes
and coalesces writes so an older tick cannot overwrite a newer requested save.

Autosave reasons are:

- `major-discovery`;
- `resting-hollow`; and
- `periodic-safe-ground` after five minutes of safe grounded simulation time.

## Backend evidence

Focused tests cover compiler rule validation, deterministic manifest output,
monotonic transitions, exact delayed response timing, duplicate suppression,
safe contextual interaction, reusable resting hollows, overlook linger,
periodic autosave gating, hidden-discovery filtering, active-objective order,
render-frame partition equivalence, edge-action latching, save round trips,
every compatibility outcome, unsafe-pose fallback, adapter behavior, and async
write coalescing.

The player-facing browser evidence and honest subjective limitations belong in
the Milestone 4 evidence report produced by the persistent Claude session.
