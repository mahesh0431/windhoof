# Game design

## Premise

A storm separates a young wild horse from its herd. The horse wakes on the
Saltwind Coast of an unfamiliar island. Old hoofprints, resting circles, hair
caught on bark, distant calls, and glimpses across high ground suggest that the
herd passed through the island.

The first journey is about following those traces, learning the terrain, and
reaching the high pasture. The player is never required to read journals,
operate machines, accept human quests, or use tools.

This narrative spine is provisional but safe for the Horse Lab and vertical
slice. Its degree of magical realism remains an open product decision.

## Core verbs

- Walk, trot, canter, and gallop
- Steer, climb, descend, brake, and stop with visible weight
- Jump readable natural obstacles
- Whinny and listen for responses
- Contextually drink, graze, rest, or nuzzle a point of interest
- Observe the landscape and choose a route
- Return to safe ground when physically or technically stuck

The game does not need an ability hotbar. The primary input vocabulary is
movement, faster gait, jump, call/listen, contextual interaction, camera,
pause, and safe reset.

## Horse locomotion contract

Horse movement is the product, not a support system.

### Gaits

| Gait | Purpose | Desired feel |
|---|---|---|
| Idle | Observation and expression | Alive, attentive, never frozen |
| Walk | Precise inspection | Calm and deliberate |
| Trot | Everyday travel | Responsive, rhythmic |
| Canter | Comfortable traversal | Flowing and confident |
| Gallop | Open-land freedom | Fast, committed, exhilarating |

All gaits and the basic jump are available from the beginning. Locking gallop
behind progression would sabotage the fantasy.

### Movement rules

- Turn radius widens as speed increases.
- Acceleration and braking have readable weight.
- Uphill travel loses momentum; downhill travel requires control.
- Small surface clutter is handled automatically rather than jumped manually.
- Manual jumping is reserved for visually readable logs, ditches, streams, and
  low walls.
- Jump distance depends on approach speed.
- Air steering is minimal.
- Unsafe landings cause a stumble and recovery, not instant failure.
- Backward input initially acts as braking at speed.
- There is no visible stamina bar. Rough terrain, climbs, and turns naturally
  interrupt a gallop; open ground lets the player run.

Starting tuning values such as a 16 m/s gallop and a roughly 28-degree maximum
climb are experiments, not promises.

## Input actions

Physical controls map into these stable actions:

```text
moveX
moveY
lookX
lookY
gallopHeld
jumpPressed
callPressed
interactPressed
resetPressed
pausePressed
```

Keyboard and mouse are the first implementation target. The action layer must
remain suitable for gamepad support. Exact bindings and accessibility options
are finalized through playtesting and UI work, not embedded in game rules.

## Third-person camera contract

- Chase camera aimed near the horse's upper body
- User-controlled yaw and bounded pitch
- Slow auto-alignment after free-look ends
- Look-ahead in the movement direction
- A small, restrained widening at gallop
- Obstruction handling that moves inward quickly and returns outward smoothly
- No camera roll
- Camera motion supports speed without competing with locomotion or causing
  motion sickness

The camera is a presentation system. It converts player intent into a travel
direction but never owns authoritative horse state.

## Core exploration loop

1. **Notice** a silhouette, sound, trail, animal movement, or unusual landform.
2. **Choose** a route and gait.
3. **Traverse** a small physical challenge.
4. **Discover** a natural landmark, herd trace, environmental story, or view.
5. **Respond** by calling, resting, drinking, approaching, or remaining present.
6. **Receive a lead** through sound, movement, sightline, or a changed scene.
7. **Learn the island** by finding a shortcut, safe path, ford, or new route.

Important destinations are signalled in at least two ways, such as silhouette
plus sound or tracks plus moving birds.

## Progression

Progression is knowledge, confidence, and access rather than numbers.

- The player learns gait control and route selection.
- Resting hollows become safe reset and save locations.
- Herd traces strengthen the direction of the larger journey.
- Shortcuts turn unfamiliar ground into known territory.
- More demanding terrain rewards movement mastery.
- The island's soundscape and wildlife response can become warmer as the horse
  establishes a connection with it.

There are no arbitrary level gates. Sequence breaking is allowed when terrain
and implementation permit it.

### Discovery states

Every authored discovery uses a stable state:

```text
hidden -> revealed -> visited -> completed
```

Discovery categories:

- Major herd trace
- Resting hollow
- Overlook or natural spectacle
- Wildlife encounter
- Abandoned human structure
- Hidden route or shortcut
- Environmental event

Five major herd traces are a suitable complete-island arc. They must be unique
scenes, not repeated tokens.

## Emotional arc

1. **Isolation** - surf, wind, breath, and hoofbeats dominate.
2. **Curiosity** - tracks and an uncertain distant response appear.
3. **Confidence** - open land supports a full gallop and self-directed routes.
4. **Connection** - wildlife and herd evidence become stronger.
5. **Belonging** - the horse reaches the high pasture and finds the herd.

The ending leaves the island open. The player may remain with the herd or keep
roaming.

## Failure, recovery, and saving

There is no traditional death screen.

- A bad jump causes a stumble and recovery.
- A dangerous fall or deep-water incident fades and returns the horse to the
  last safe grounded pose or resting hollow.
- No discovery progress is lost.
- A dedicated return-to-safe-ground command handles stuck states.
- Autosave occurs after major discoveries, at resting hollows, and periodically
  while safely grounded.

## First 20-minute target journey

| Time | Experience |
|---|---|
| 0-2 min | Horse rises on a storm-washed beach; steering and camera are learned through movement. |
| 2-5 min | Tracks encourage walking and trotting along the shore. |
| 5-8 min | Dunes open into long grass for the first uninterrupted gallop. |
| 8-11 min | A fallen trunk and stream introduce jumping. |
| 11-14 min | A distant horse call prompts the player to answer. |
| 14-17 min | The response leads to a spring, resting hollow, and first herd trace. |
| 17-20 min | An overlook reveals the island regions, central highland, and a brief distant herd silhouette. |

The vertical slice may compress this into 10-15 minutes while preserving the
same emotional order.

## Explicit cuts

- Combat or predators as combat encounters
- Hunger, thirst, health, or visible stamina
- Crafting, gathering, loot, or inventory
- Collectible horseshoes or token grids
- Human-style dialogue and quest interactions
- Gallop as an unlock
- Precision jumping sequences
- Full-body physical simulation of four legs
- A huge generated island before movement and traversal work

