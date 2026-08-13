# Milestones and gates

Progress is gate-based. A milestone is complete when the player-visible result
passes its evidence criteria, not when its features merely exist.

Milestone order and world-production order are complementary. Horse Lab proves
the game embodiment first. Island work then follows the canonical WorldClaw
adaptation: structured plan, global terrain, selective regional realization,
and render-inspect-refine. See
[WORLDCLAW_WEB_METHOD.md](WORLDCLAW_WEB_METHOD.md).

## Milestone 1 - Horse Lab

### Outcome

A horse can be controlled on simple test terrain in third person, and movement
is enjoyable without island content or objectives.

### Scope

- Fixed-step simulation
- Kinematic horse controller and simplified collider
- Idle, walk, trot, canter, and gallop states
- Acceleration, braking, speed-sensitive turning, slopes, and grounding
- Jump, landing, stumble, and safe reset behavior
- Chase camera and obstruction handling
- Input action abstraction
- Basic diagnostics and recorded-input test support

Placeholder visuals and audio are acceptable until controller state is stable.
Claude asset work should not force controller mechanics to match a model.

### Exit gate

- A blind tester enjoys ten uninterrupted minutes on simple terrain.
- The tester describes the controller as horse-like rather than human-like.
- Gallop feels satisfying on open ground.
- Turning, braking, slopes, jump, and landing are understandable.
- Camera obstruction does not frequently clip or disorient.
- The horse can recover from ordinary collision and stuck cases.
- Fixed-step recorded input produces expected state snapshots.

If this fails, do not build the island.

## Milestone 2 - Deterministic island compiler

### Outcome

A source WorldSpec compiles into a stable vertical-slice island foundation.

### Scope

- WorldSpec validation
- Seeded random streams and versioning
- Coastline and terrain height field
- Identical shared chunk borders
- Coast, plain, and forest-edge region masks
- Spawn, one required route, one resting hollow, and one overlook
- Traversability analysis
- Stable IDs and manifest hash

### Exit gate

- The same input produces the same manifest hash.
- 100 test seeds contain no NaNs, terrain seams, unsafe spawns, or disconnected
  required endpoints.
- Horse Lab traversal works on generated slopes and obstacles.
- The slice contains a safe route and an optional more expressive route.
- No generated output needs hand editing to pass.

## Milestone 3 - Continuous traversal

### Outcome

The horse can move through the vertical-slice world at full gallop without
terrain holes, physics gaps, stalls, or accumulating resources.

### Scope

- Chunk lifecycle and repository
- Predictive preparation based on speed and direction
- Terrain views and Rapier colliders from shared data
- Reference-counted resources and explicit disposal
- Instanced repeated content
- Debug metrics and repeated-circuit performance scenario

For the small slice, full-world activation may remain the simplest passing
solution. Streaming complexity is justified only by measured need.

### Exit gate

- Full-speed circuits cannot reach absent physics.
- Chunk boundaries are visually and physically continuous.
- No main-thread preparation task exceeds the agreed stall budget.
- Repeated circuits return resource and memory counts near baseline.
- The target desktop browser sustains the active frame budget.

## Milestone 4 - Exploration vertical slice

### Outcome

A new player completes a coherent 10-15 minute journey from storm beach to
overlook through movement and environmental cues.

### Scope

- Coast, longgrass opening, and small Fernwood edge
- First uninterrupted gallop
- Stream/log jump
- Call-and-response event
- Spring and resting hollow
- One herd trace
- One wildlife encounter
- Overlook conclusion
- Discovery state machine and autosave boundary
- Typed UI snapshot/event/command contracts
- Claude-owned UI, visual presentation, and milestone assets

### Exit gate

- A blind player finds the herd trace without developer intervention.
- The player forms a direction from landscape and sound.
- Every important destination has two usable cues.
- The call response and discovery completion are unmistakable.
- Jump and slope frustration is rare.
- The player can pause, resume, reset safely, and retain completed progress.
- UI and visual presentation do not dominate the riding view.

## Milestone 5 - First island and release hardening

### Outcome

One continuously explorable island supports the complete isolation-to-belonging
journey and stable free roam afterward.

### Scope

- Add and validate River Hollow and Blackstone Crown region by region
- Five unique major herd traces
- Outer coastal loop and interior shortcuts
- Final high-pasture resolution and continued free roam
- Versioned persistence and manifest compatibility
- Browser context-loss handling
- Accessibility and settings outcomes
- Asset provenance and license completion
- Performance, memory, and browser hardening

### Exit gate

- Mandatory discoveries are reachable in intended target browsers.
- A player completes a 15-30 minute first journey without developer help.
- Save/reload resumes from a safe compatible state.
- Incompatible saves are handled explicitly.
- Repeated island circuits show no sustained memory growth.
- Target browser journeys produce no console errors or unhandled promises.
- All shipped assets have clear provenance and usage rights.
- The experience resolves belonging while preserving free exploration.

## Ideas deliberately parked

- Dynamic day/night cycle
- Complex weather
- Swimming
- Herd NPC simulation
- Multiplayer
- Mobile controls
- Full-island live procedural generation
- Additional islands

Parked means unavailable to current milestone scope, not secretly in progress.
