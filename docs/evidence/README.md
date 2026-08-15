# Horse Lab visual evidence

Canonical views captured from the running build by `tools/inspectHorseLab.mjs`.
This is the render-inspect-refine step of the
[WorldClaw adaptation](../WORLDCLAW_WEB_METHOD.md): the tool drives the horse
into real gameplay states through the lab harness and screenshots the result,
because screenshots of a game that never moved prove nothing.

Regenerate with:

```text
pnpm inspect
```

It starts and stops its own Vite server on an ephemeral port, so it runs from a
clean checkout with nothing else already running. Pass a URL to point it at a
server you are already running instead: `pnpm inspect http://127.0.0.1:5173`.

`inspection.json` records the simulation state at each capture, plus any console
errors seen during the run. The command exits non-zero if the run produced any
console errors, so it is a check as well as a capture tool.

## Captures

| File | State |
|---|---|
| `01-spawn.png` | Opening frame; first onboarding hint |
| `02-diagnostics.png` | Diagnostics overlay with live values |
| `03-walk.png` | Walk |
| `04-trot.png` | Trot |
| `05-gallop.png` | Full gallop on the open corridor |
| `06-airborne.png` | Rising after a jump at gallop |
| `07-landed.png` | Back on the ground |
| `08-stream-approach.png` | Approaching the stream at gallop |
| `09-stream-jump.png` | Over the stream; deep trench visible on both flanks |
| `10-plateau.png` | On the raised plateau |
| `11-after-drop.png` | After the steep north face; camera pulled in |
| `12-grove-camera.png` | In the grove; camera obstruction handled |
| `13-overlook.png` | From the overlook knoll |
| `14-boundary.png` | Held at the stage boundary in the shallows |
| `15-idle.png` | Standing still |
| `16-horse-profile.png` | Horse silhouette from the side |
| `17-pause.png` | Pause and settings surface |
| `18-controls.png` | Controls list |
| `19-pause-narrow.png` | Pause surface at 1024x640; Resume stays pinned, settings scroll |
| `20-focus-pill.png` | Riding without pointer lock; the prompt recedes to a corner pill |
| `21-gallop-profile.png` | Full gallop from the side, on the suspension phase |
| `22-shore-splash.png` | Trotting the water line; hooves throw spray |

`21-gallop-profile.png` is the one capture that is deliberately not a chase
view. A camera sitting straight down the horse's back hides reach, suspension,
and the flexing back, which is exactly what the first blind playtest said was
missing, so the tour turns the camera ninety degrees and compensates with
steering so the horse holds its line and keeps galloping. Its shutter also waits
on the rig's own body height, so the frame lands on the suspension phase rather
than on a random point in a 0.43-second stride.

## Horse model sheets

`horse/` holds the model itself, photographed away from the world by
`tools/inspectHorse.mjs`:

```text
pnpm inspect:horse
```

| File | Contents |
|---|---|
| `horse/turnaround.png` | Profile, three-quarter, front, rear, head, and overhead, standing |
| `horse/gaits.png` | Walk, trot, gallop, and gallop three-quarter |

Both are single frames divided into viewports, so one screenshot covers the
whole subject. The tour above proves how the horse looks while being ridden;
these prove what it looks like, which the chase camera can never show because it
only ever sits behind the horse at one distance. Pass a view name
(`pnpm inspect:horse profile`) for that view alone at full frame, or `--views`
to list them. The run reports the model's own triangle and draw-call cost.

## Island vegetation sheets

`world/` holds the island's ground and vegetation, photographed by holding the
camera at each region's own anchor:

```text
pnpm inspect:world            eye level
pnpm inspect:world --close    knee height, for ground cover
pnpm inspect:world --wide     from above, for region shape and treeline
```

| File | Contents |
|---|---|
| `world/regions-eye.png` | All five regions from a rider's height |
| `world/regions-close.png` | All five from knee height, where cover is judged |
| `world/regions-wide.png` | All five from above, where a treeline is judged |

Same seam and the same limit as the region captures in `milestone-5`: this is
evidence that a place exists and looks the way it is claimed to, and never
evidence that a player can reach it. Each capture also reports its own draw
calls, drawn triangles and live near-grass blades, so a vegetation change can be
read against the budget it spends.

One honest caveat about `regions-eye.png`: the Fernwood camera stands inside a
closed canopy and its frame is nearly black. That is one unlucky bearing in a
dense wood rather than a rendering fault - `regions-wide.png` shows the same
wood lit - and it is left in rather than moved, because a wood a rider can be
blinded inside is worth knowing about.

## Rendering note

Captures are produced in headless Chromium with SwiftShader, so the frame rate
shown in the diagnostics overlay reflects software rasterisation, not the target
hardware. Draw calls, triangle counts, and all simulation values are real.

Headless Chromium also refuses pointer lock, so the capture run hides the
"click to look around" prompt for most frames; `20-focus-pill.png` deliberately
shows it. Its behaviour is verified in
`tests/browser/horseLabExperience.spec.ts`.
