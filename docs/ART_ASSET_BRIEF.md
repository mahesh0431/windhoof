# Art and asset brief

This is an outcome brief for Claude Code. It defines coherence, readability,
and production constraints while leaving visual direction, sources, creation
methods, topology, animation workflow, and integration decisions to Claude.

## Recommended art mood

**Stylized naturalism:** credible horse proportions and movement, painterly
landscape shapes, heightened but coherent color, strong silhouettes, and
restrained detail.

The target is neither photorealism nor toy-like low-poly abstraction. The
world should survive motion, distance, and browser budgets better than a set of
high-detail assets designed only for still images.

This mood is provisional until the first Claude-led visual exploration, but it
is the default used by the design documents.

## Horse outcomes

- Horse silhouette reads clearly from the standard chase camera.
- Proportions feel like a horse, not a dog or human rig stretched into shape.
- Gait transitions preserve weight, momentum, and ground contact.
- Mane, tail, breathing, ears, and head motion reinforce state without noise.
- Materials remain legible across beach, grass, forest shade, and highland.
- The horse visual follows controller truth; animation never becomes the
  authoritative movement or collision source.

### Required animation family

Full target:

- Idle variations
- Walk
- Trot
- Canter
- Gallop
- Jump takeoff, airborne, and landing
- Hard stop and turning response
- Stumble and recovery
- Whinny/call
- Graze, drink, rest, and contextual nuzzle

Milestone 1 may begin with a reduced compatible set. All locomotion animations
must share a coherent skeleton, scale, orientation, and visual style.

## World outcomes

- Each region has a distinct silhouette, vegetation rhythm, terrain profile,
  atmosphere, and sound identity.
- Landmarks are recognizable from meaningful exploration distances.
- Traversable lines, obstacles, difficult slopes, and unsafe edges remain
  readable at gallop speed.
- Repeated content does not look like unrelated asset packs scattered together.
- Detail density supports route choice instead of hiding it.
- Distant forms establish orientation before close props become visible.

## Asset categories

- Player horse and compatible animation family
- Terrain surface language
- Region vegetation families
- Rocks, logs, banks, shallow-water edges, and horse-scale obstacles
- Landmark silhouettes
- Wildlife used for atmosphere and navigation cues
- Environmental effects
- Audio: hooves by surface/gait, breathing, wind, surf, water, vegetation,
  wildlife, and spatial horse calls

Claude decides the source or creation approach. No Blender step is required or
assumed.

## Browser and gameplay constraints

- Assets meet the active milestone's measured draw-call, triangle, texture,
  memory, and download budgets.
- Repeated world content supports instancing where appropriate.
- Collision uses explicit simplified runtime shapes rather than visual mesh
  complexity.
- Broken pivots, incompatible rigs, unclear licenses, extreme polygon counts,
  or incoherent materials are rejection reasons.
- A poor generated model is rejected or regenerated; runtime code should not
  accumulate hacks to rescue it.
- Placeholder quality is labelled honestly.

## Provenance

Every external or generated asset must be recorded in
[ASSET_PROVENANCE.md](ASSET_PROVENANCE.md), including:

- Asset ID and purpose
- Source or generation tool
- Creator/provider
- Date acquired/generated
- License and redistribution terms
- Required attribution
- Modifications
- Source URL or durable local reference
- Reviewer and approval state

No asset with unclear usage or redistribution rights enters a release build.

