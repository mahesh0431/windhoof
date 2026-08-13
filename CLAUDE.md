# Windhoof project context

Windhoof is a third-person browser game in which the player embodies a young
wild horse exploring an island after being separated from its herd.

## Read first

1. [Project vision](docs/PROJECT_VISION.md)
2. [Game design](docs/GAME_DESIGN.md)
3. [World bible](docs/WORLD_BIBLE.md)
4. [Player experience brief](docs/EXPERIENCE_BRIEF.md)
5. [Art and asset brief](docs/ART_ASSET_BRIEF.md)
6. [Technical architecture](docs/TECHNICAL_ARCHITECTURE.md)
7. [Milestones](docs/MILESTONES.md)
8. [WorldClaw web adaptation](docs/WORLDCLAW_WEB_METHOD.md)
9. [Decisions](docs/DECISIONS.md)

## Current milestone

[Milestone 1: Horse Lab](docs/MILESTONES.md#milestone-1---horse-lab)

## Ownership

Claude owns player-facing UI/UX, visual presentation, asset decisions, asset
sourcing or creation, and the integration of those concerns into the current
milestone.

The canonical player fantasy, game rules, world structure, architecture
boundaries, and milestone scope live in the linked documents. If a visual or
asset decision requires changing one of those product truths, surface the
conflict before changing it.

## Working principle

Use independent design and implementation judgment. The project deliberately
does not prescribe layouts, components, styling techniques, asset libraries,
or creation methods. Ask only when a choice would materially change product
identity, mechanics, scope, legal position, introduce a paid external service,
or create irreversible external work.

## Hard boundaries

- Browser-native Three.js; no Blender dependency.
- Preserve the WorldClaw-derived global-plan, global-terrain, regional-detail,
  render-inspect-refine production order.
- The player is the horse; no rider and no human-style interaction model.
- The world and movement remain visually dominant during ordinary play.
- No combat, crafting, loot, hunger, thirst, or visible stamina system.
- No asset with unclear provenance or redistribution rights.
- Do not add secrets, credentials, paid services, or publishing steps without
  explicit approval.
- Record durable visual or asset decisions in
  [DECISIONS.md](docs/DECISIONS.md).
- Record every external or generated asset in
  [ASSET_PROVENANCE.md](docs/ASSET_PROVENANCE.md).
