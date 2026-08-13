# Player experience brief

This document communicates the desired player-facing experience without
prescribing a layout, component tree, styling system, or implementation
technique. Claude Code owns those decisions.

## What the player should feel

- They are inhabiting a horse, not moving a human-shaped avatar.
- The horizon and terrain invite movement.
- Speed feels joyful and physical.
- Slowing down reveals information that galloping can miss.
- The island is understandable through form, sound, movement, and memory.
- Discoveries feel found rather than delivered by a checklist.
- The journey becomes warmer and more connected over time.

## What the player should understand

Without reading a manual, a first-session player should understand:

- How to steer, change pace, look, jump, call, and recover from being stuck
- Which ground is inviting, difficult, or unsafe
- That distant calls and environmental cues can be followed
- When a discovery has meaningfully changed state
- Where they can safely rest or resume
- How to pause, change settings, and leave without losing progress

## Presentation principles

- The island and horse remain the center of attention.
- Ordinary movement protects the center and lower-middle of the view.
- Information appears when relevant and recedes when understood.
- Mystery comes from the landscape, not obscured rules.
- Feedback may be subtle, but important state changes cannot be ambiguous.
- Menus should feel related to the natural, physical experience rather than a
  generic application dashboard.
- Strong motion is reserved for meaningful state changes and never competes
  with galloping or camera movement.

## Navigation philosophy

The default journey does not require a persistent minimap, floating waypoint,
or GPS route. Landscape, audio, tracks, wildlife, and sightlines are the
primary navigation language.

Accessibility or player preference may justify optional orientation aids.
Those aids must preserve the underlying environmental route design rather than
compensate for an unreadable island.

## Information needs

The experience must support these player needs; Claude decides how:

- Start or continue a journey
- Learn controls progressively
- Receive contextual interaction and discovery feedback
- Recognize a distant-call response
- Pause camera/game input safely
- Review known places or progress when desired
- Adjust camera, audio, controls, motion, and accessibility preferences
- Return to safe ground
- Understand save/resume status

The normal riding view should not expose every informational surface at once.

## First-session experience

The opening should become playable within seconds. The beach and horse
movement carry onboarding. Explanations should follow the player's action and
context rather than front-load a large controls panel.

The first uninterrupted gallop is a presentation event: camera, sound,
animation, environment, and any interface response should support freedom
without overwhelming it.

The first answered call is the clearest statement of purpose. A blind player
must notice that something responded and form an idea of where it came from,
without being forced to read exposition.

## Accessibility outcomes

The final experience should be capable of supporting:

- Remappable actions
- Keyboard/mouse and gamepad mappings
- Camera sensitivity and inversion
- Field-of-view control within safe camera bounds
- Reduced non-essential motion
- Adjustable camera follow strength
- Independent sound categories
- Visual equivalents for important audio cues
- Legible text scaling and contrast
- Optional orientation assistance

Exact support is milestone-scoped and recorded once target platforms are
confirmed.

## UX failure conditions

- The screen reads like a dashboard during ordinary riding.
- The player looks at interface markers instead of the island.
- Camera input continues underneath a modal surface.
- The first discovery completes without clear feedback.
- Sound is the only way to understand mandatory information.
- Onboarding interrupts the first gallop.
- Visual polish hides unclear traversability.

