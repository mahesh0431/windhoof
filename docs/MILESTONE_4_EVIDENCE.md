# Milestone 4 evidence

What has been built and mechanically verified for the exploration journey, and
what has not.

**Status: implementation and automated browser evidence are ready. Milestone 4
is NOT complete.** The exit gate is subjective and human, and nothing in this
document or in the artifacts it links can stand in for it. See
[The pending gate](#the-pending-gate).

Two kinds of claim are kept apart on purpose:

- **Machine-checkable.** A rule the automation actually evaluated, on the
  current build, against the current world. Every one of these is backed by a
  named beat in `docs/evidence/milestone-4/walkthrough.json`.
- **Human-only.** Whether the island is *worth* riding: pacing, legibility to
  someone who has not read the code, whether the arc lands in ten to fifteen
  minutes. Automation can prove a route is walkable. It cannot prove it is
  worth walking, and it never rode this island without already knowing where
  everything was.

---

## The world under test

| | |
| --- | --- |
| Manifest hash | `fnv1a64-75ef4f476903558d` |
| Schema version | 3 |
| Generator | 0.4.0 |
| Spawn | `(13.6, 6.1, -163.8)`, Saltwind Coast |

Scene coordinates as compiled, read back out of the running build through
`LabHarness.scenes()` rather than copied into the harness:

| Discovery | Position (x, z) | Ground height | Region | Visit radius | Mandatory |
| --- | --- | --- | --- | --- | --- |
| `first-herd-trace` | `(-58.3, 103.2)` | 18.0 m | fernwood-edge | 11 m | yes |
| `spring-resting-hollow` | `(27.7, 146.2)` | 16.7 m | fernwood-edge | 12 m | yes |
| `first-overlook` | `(89.7, 90.2)` | 18.0 m | fernwood-edge | 14 m | yes |
| `plain-wildlife-crossing` | `(58.1, -0.8)` | 13.2 m | longgrass-opening | 24 m | no |

Separations between the three mandatory story scenes:

| Pair | Distance |
| --- | --- |
| spring ↔ overlook | 83.5 m |
| spring ↔ trace | 96.2 m |
| trace ↔ overlook | 148.6 m |

Every pair is more than five times the larger of the two visit radii, so no
scene can be reached, visited, or completed by standing at another. The
walkthrough asserts this before it rides anywhere and fails the run if any two
mandatory scenes fall within 40 m or inside each other's visit radius. That
check exists because an earlier layout had collapsed all three within a few
metres, and the automation of the day rode it happily and photographed the same
patch of grass three times.

### The overlook is on high ground

This is worth stating separately, because the previous world compiled it onto a
2.8 m shore shelf where the discovery text promised the whole island below and
the frame showed a beach — with every state transition correct.

Measured against the island's own height distribution:

```
first-overlook          h=18.0 m   higher neighbours within 90 m: 0 / 96
island land heights     p10=0.1  p50=3.1  p90=14.4  max=18.3   (n=1681)
```

It is level with the island's highest ground, and nothing within ninety metres
in any direction is higher than it. `overlook-view-inland.png` and
`overlook-view-seaward.png` show the land falling away on every bearing, the
sea past it on both flanks, and the authored cairn standing beside the horse.

---

## The fifteen-beat flow

One muted run, sixteen captures, `failures: []`, `consoleErrors: []`.

| Beat | What it proves | Frame |
| --- | --- | --- |
| `01-arrival` | Fresh start: nothing known, the opening line carries the whole instruction, no prompt or bearing offered because there is nothing to offer. | `01-arrival.png` |
| `02-crossing` | The optional crossing is found by riding through it. Moving animals, no interaction. | `02-crossing.png` |
| `02b-sequence-break` | Found out of authored order and handled as such: recorded, listed once, guidance still on the call. No hidden discovery leaked into the list. | `02b-sequence-break.png` |
| `03-inland` | Within earshot of the call event, still nothing revealed. | `03-inland.png` |
| `04-call` | The call goes out and is acknowledged as unanswered. The delay is real, not instant. | `04-call.png` |
| `05-answer` | The answer arrives later, reveals the trace and the spring, and gives a visible bearing plus a bird burst. | `05-answer.png` |
| `06-trace-approach` | Contextual inspect offered at the trace, on foot and standing still. | `06-trace-approach.png` |
| `07-trace-found` | Inspect completes the trace; discovery moment shown; save mark appears. | `07-trace-found.png` |
| `08-spring` | Contextual rest offered at the spring, 96 m from the trace and a separate approach. | `08-spring.png` |
| `09-rest` | Rest completes the spring **and does not touch the overlook**. | `09-rest.png` |
| — | Autosave awaited, not assumed: `persistenceStatus` reaches `saved`. | — |
| `10-overlook` | Linger completes the overlook; journey complete, 3/3 mandatory. | `10-overlook.png` |
| `11-pause` | Pause holds the full journey on demand: four places, all `KNOWN`. | `11-pause.png` |
| `12-reset` | Return to safe ground keeps the journey intact. | `12-reset.png` |
| `13-resume` | Reload restores everything: `startKind: resumed`, 4 of 4 known. | `13-resume.png` |
| `14-quarantined` | An unusable prior ride is kept, explained, and not overwritten. | `14-quarantined.png` |
| `15-accepted` | Only after `StartNewJourney` does anything claim to be saved. | `15-accepted.png` |

### Resting at the spring does not visit or complete the overlook

The scenes are 83.5 m apart and the overlook's visit radius is 14 m, so this
should be structurally impossible — but it was true by accident under an older
collapsed layout, and an accident that holds is not a guarantee. It is asserted
at the moment of the rest.

At `09-rest`, immediately after the rest completes:

```
known: first-herd-trace=completed, plain-wildlife-crossing=completed,
       spring-resting-hollow=completed
completedMandatory: 2 / 3      complete: false
```

`first-overlook` is **absent from `known` entirely** — still `hidden`, not
merely un-completed, so the rest did not even reveal it. The beat fails the run
if the overlook appears as `visited` or `completed`, or if the journey reports
itself complete here.

The frame says the same thing without reading any state: the goal line at
`09-rest` reads *"Nothing calls to you just now. Ride, and see what you find"*.
The world genuinely has nowhere to point, because the last place has not been
noticed yet — and it says so rather than naming a discovery the player has
never seen.

### Sequence breaking

The crossing is journey order 15; the herd trace is 10. Finding the crossing
first is a real sequence break, and at `02b` the interface:

- records it (`plain-wildlife-crossing=completed`),
- lists exactly one place — no hidden discovery is exposed by the list,
- leaves guidance pointing at the call, not at the thing just stumbled on.

Prerequisites gate *completion and guidance*, never reveal or visit.
Out-of-order discovery is presented as found, not promoted to "the next thing".

### The incompatible ride

`14-quarantined` seeds a genuine prior save — same island, older generator —
straight into the store the game reads, so the production compatibility rules
make the decision. Result:

- `startKind: quarantined`, `known: []`, `completedMandatory: 0` — nothing leaks
  from an unusable ride into this one.
- `persistenceWritesEnabled: false`, `persistenceStatus: incompatible`.
- The save mark is **not** shown. Nothing claims to have been saved.
- The player is told, in the world's terms, and offered a choice: *"Begin a new
  ride"* or *"Not yet"*. The panel avoids `error`, `failed`, and `corrupt`,
  because the world changed under the player and that is not a fault.

Clicking *Begin a new ride* emits `StartNewJourney`. Only then does
`persistenceWritesEnabled` become `true` and the save mark appear
(`15-accepted`).

Unavailable storage is a different situation and is worded and shaped
differently: no button, because nothing in the game can fix a browser that
refuses storage, and offering an action would be a lie. That path is covered by
`tests/browser/islandJourney.spec.ts` rather than by this walkthrough, since it
requires `indexedDB` to throw before any application code runs.

### Mute

Every page URL in the run goes through `tools/automationUrl.mjs`, which forces
`mute=1`. Proof is constructor-counting installed in the page before any
application code runs, plus the app's own view of its audio:

```
every beat: muted=true, contextsConstructed=0,
            contextCreated=false, running=false
```

Not one `AudioContext` was constructed across all sixteen captures. This does
not rely on Chromium's `--mute-audio`. The pause panel in `11-pause.png` shows
the Sound control greyed out, which is the same decision surfacing to the
player.

---

## Presentation changes in this pass

Three findings from the previous screenshot audit were fixed, and all three are
visible in the current frames.

**The crossing wildlife.** The optional crossing is the only authored discovery
with no built form and no sound of its own, so motion is the entire cue — and
it was standing in as bare untextured boxes. It is now a small quadruped built
from the same faceted primitives as the rest of the island, merged into one
geometry and instanced six times with varied coat colours, moving in a bounding
gait. Bounding rather than walking is deliberate: all six share one instanced
mesh, so legs cannot move independently of bodies, and a quadruped gliding on
rigid legs is worse than no gait at all. Roughly 240 triangles each, ~1.4k for
the herd, against a 750k budget. See `02-crossing.png`.

**The goal line.** It shared its exact anchor with the gait strip, so a wrapping
line — "Nothing calls to you just now. Ride, and see what you find" is the worst
of them — laid its second row across the speed readout. It now sits clear above
the strip. See `09-rest.png`, which is the frame the collision was found in.

**The sea.** Three separate artefacts were reading as one band of stripes:
periodic swell and surf aliasing at grazing angles, eight-bit quantisation along
the slow haze ramp, and the surf threshold landing on ring boundaries in the
per-vertex shore attribute. Each is addressed at its cause — detail fades with
view distance, the haze ramp is dithered, the surf ramp is wider, and the ring
count is up from 52 to 96. **Reduced, not eliminated**: the open horizon is now
clean, but faint horizontal banding survives in the mid-distance water on some
bearings.

The discovery card keeps the position that matches every captured frame. Lifting
it clear of the horse was trialled in an earlier pass and reverted.

---

## Evidence inventory

All under [`docs/evidence/milestone-4/`](evidence/milestone-4/):

| File | |
| --- | --- |
| [`walkthrough.json`](evidence/milestone-4/walkthrough.json) | Full machine record: layout, separations, per-beat position, journey state, UI state, audio state, failures, console errors |
| [`01-arrival.png`](evidence/milestone-4/01-arrival.png) … [`15-accepted.png`](evidence/milestone-4/15-accepted.png) | Sixteen frames, 1600×900, one per beat |
| [`overlook-view-inland.png`](evidence/milestone-4/overlook-view-inland.png), [`overlook-view-seaward.png`](evidence/milestone-4/overlook-view-seaward.png) | The overlook, looking back over the island and out to sea |
| [`overlook-inspection.json`](evidence/milestone-4/overlook-inspection.json) | The targeted overlook run. **Read the caveat below.** |

Reproduce with `pnpm journey:walkthrough` and `node tools/inspectOverlook.mjs`.
Each boots its own Vite server on an ephemeral port and closes it and the
browser on exit.

### Caveat on `overlook-inspection.json`

That file records a `FAILED` verdict, and the failure is in the probe, not in
the world. The inspection tried to score "does this read as a summit" by reading
the rendered pixels back with `drawImage` on the WebGL canvas — which returns
black unless the context was created with `preserveDrawingBuffer`. It therefore
scored every bearing as 0% open and failed a summit that is plainly a summit.

The artifact is kept rather than deleted, because deleting an inconvenient
result is not how this gets to be trustworthy. Its other fields are valid and
were the point: standing height 17.9 m, region `fernwood-edge`, `grounded:
true`, `cameraObstructed: false`, zero `AudioContext`s. The metric has since
been removed from `tools/inspectOverlook.mjs` — a measurement that fails closed
and silently is worse than no measurement, because it invites you to trust it.
The high-ground claim rests instead on the compiled elevation figures above and
on the two frames.

Note also that the two `overlook-view-*.png` frames were captured *before* the
sea ring-count and surf-ramp change in this pass; the beat frames in
`walkthrough.json` are from the final build.

---

## The pending gate

Everything above is mechanical. None of it is the milestone.

**Milestone 4 is not complete until Mahesh rides the island live and blind and
confirms the subjective exit gate.** Specifically:

- **Ten to fifteen minutes.** Nothing here measures this. The automation rides
  at full gallop on a straight line between coordinates it was handed; its
  timings are a property of the harness, not of the experience. Only a human
  ride can say what the arc feels like.
- **Blind discoverability.** Every destination has at least two cues and none is
  audio-only — hoofprints and debris at the trace, pool and mist at the spring,
  cairn and circling flock at the overlook, moving animals at the crossing,
  bearing chevron and bird burst on the answered call. That the cues *exist* is
  verified. That a player who has not read this file finds them is not, and
  cannot be: the walkthrough was told where everything was.
- **Whether the interface stays out of the way.** The journey is built as
  transient edge chrome with the full picture only in the pause panel. Whether
  that holds over a real ride, rather than over a scripted one, is a judgement.
- **Whether the arc lands.** Call, delay, answer, trace, spring, overlook. The
  states transition correctly. Whether they add up to a journey is the gate.

### Known limitations carried into that ride

- The crossing animals are one merged shape with no articulation. They read at
  the distances the crossing is seen from; they would not survive close
  inspection.
- Faint sea banding survives in mid-distance water on some bearings.
- The bearing caption is qualitative (`close` / `away` / `far off`) rather than a
  distance. Whether a lone word reads as direction-and-distance to someone
  seeing it for the first time is a question for the live ride.
- `02b-sequence-break.png` is near-identical to `02-crossing.png`; that beat's
  evidence is genuinely in the JSON state, not in a visually distinct frame.

Do not read "0 failures" as "Milestone 4 passed". It means the automation found
nothing wrong with what it knows how to check.
