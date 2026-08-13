# Milestone 3 evidence — continuous traversal

Date: 2026-08-13  
Status: frozen vertical-slice baseline

## Outcome

The 512 metre, 4 x 4 chunk vertical slice remains fully resident and can be
crossed at full gallop without reaching absent physics. Rendering and Rapier
consume one canonical terrain topology per chunk, resource ownership is
reference counted, and startup work is split into named bounded jobs.

This milestone deliberately does not introduce streaming rings. The milestone
contract permits full-world activation for the small slice, and the measured
resident world is comfortably inside the active render and heap budgets.
Streaming remains a policy to introduce when the complete 1,024 metre island
or measured content growth makes it necessary.

## Canonical terrain and readiness

- `TerrainChunkTopology` is the single position/index representation for a
  generated chunk and carries a deterministic fingerprint.
- `IslandChunkRepository` prepares records in canonical row-major order and
  models `requested -> prepared -> active -> cooldown -> disposed`.
- Rapier retains the repository's exact topology object. Three borrows the same
  typed arrays by identity and derives only render-owned normals and colours.
- Riding starts only when all 16 chunks are active with exactly 16 physics and
  16 render retains.
- A three-second velocity lookahead plus one-chunk safety ring proves predicted
  physics readiness. In full-resident mode every predicted chunk must be ready.

The identity and lifecycle contracts are covered in
`tests/generation/islandChunkRepository.test.ts` and
`tests/render/islandSceneLifecycle.test.ts`.

## Repeated traversal and disposal

`tests/generation/generatedTraversal.test.ts` runs five complete
Coast -> Longgrass -> Fernwood -> Longgrass -> Coast circuits with the actual
horse controller and Rapier resolver. More than 900 simulation ticks remain
above 12 m/s. Every tick reports an empty missing-physics set, collider counts
stay fixed, and repository counters equal their pre-circuit baseline.

After traversal, render and physics releases return both retain totals to zero.
The repository lifecycle suite additionally completes 20 prepare/retain/release
/dispose cycles without an accumulated retain. Scene lifecycle tests repeat
construction and disposal and prove that the repository refuses premature
disposal while a consumer still owns a chunk.

## Main-thread preparation

The retained 1080p profile is
`docs/evidence/island/profile/stall-budget.json`.

- 30 named jobs
- 142.5 ms total interruptible realization work
- 38.1 ms slowest job: `collision-world`
- 16.6 ms slowest presentation-owned job: `terrain-family-weights`
- no job above the 50 ms stall ceiling
- a browser frame is yielded after each job

World compilation remains in a one-shot worker and is outside the main-thread
job log. First-frame shader compilation and Rapier WASM initialization are also
not misreported as chunk work.

## Active target-device budget

A stable real-Chrome run on the project M4 Mac at 1920 x 1080 sampled 360
frames after warmup:

- display refresh: 50 Hz
- median frame: 20.0 ms / 50 fps
- p95 frame: 20.8 ms
- conservative controller-plus-Rapier p95: 0.4 ms
- maximum draw calls: 124
- maximum submitted triangles: 406,451
- JavaScript heap: 60.5 MB
- mute flag active; no game `AudioContext` created

The machine's connected display is a 50 Hz LG ULTRAWIDE, so 50 fps is the
hardware presentation ceiling for that target-device run rather than a missed
60 Hz frame. The submitted-work profile independently records median 113 / peak
125 draw calls and median 341,774 / peak 406,451 triangles, below the
architecture's 200 steady / 300 peak draw and 750k normal / 1.2M peak triangle
budgets. The retained SwiftShader fps field is diagnostic only and is not used
as a desktop performance claim.

## Exit gate

| Requirement | Evidence | Result |
|---|---|---|
| Full-speed circuits cannot reach absent physics | Five Rapier circuits with predictive readiness every tick | Pass |
| Chunk boundaries are visually and physically continuous | Shared-border compiler gates plus one canonical topology consumed by render and physics | Pass |
| No preparation task exceeds the stall budget | 30-job browser profile; maximum 38.1 ms | Pass |
| Repeated circuits return resources near baseline | Fixed collider/repository counts, zero final retains, repeated scene/repository disposal | Pass |
| Target desktop sustains the active frame budget | Real Chrome at the 50 Hz target-device ceiling; p95 20.8 ms and physics upper bound 0.4 ms | Pass |

## Honest limits carried forward

- The small slice is full resident; it does not prove near/middle/far streaming
  policy for the later 1,024 metre island.
- Browser heap is measured at the active resident baseline, while deterministic
  lifecycle tests provide the repeated-cycle leak gate. Milestone 5 must repeat
  the longer complete-island journey in intended browsers.
- Primitive ground-cover silhouettes and sea moire are presentation limitations,
  not traversal/runtime blockers, and remain Claude-owned refinement items.
- Live feel and first-player comprehensibility are not inferred from automation;
  they remain user playtest gates for Milestone 4.

