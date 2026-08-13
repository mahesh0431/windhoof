import type { DiscoveryKind, DiscoveryState } from "../game/contracts/discovery";
import type { GraphicsStatus } from "../game/contracts/runtimeLifecycle";

/**
 * Every word the journey says to the player.
 *
 * Kept apart from the interface that shows it for two reasons. The obvious one
 * is that wording is easier to judge as a body of text than scattered through
 * DOM code. The other is that this layer must degrade: the compiler can emit a
 * discovery this file has never heard of, and the interface still has to say
 * something true about it rather than print an identifier at the player.
 *
 * The tone is the world bible's. The horse is a young animal alone on an
 * island, so the journey is described in things it can see and smell, never in
 * tasks, counters, or percentages.
 */

export interface DiscoveryText {
  /** What the place is called when it is named on screen. */
  readonly name: string;
  /** One line, present tense, said the moment the place is understood. */
  readonly found: string;
  /** The line that points the player at it while it is still ahead of them. */
  readonly objective: string;
}

const BY_ID: Readonly<Record<string, DiscoveryText>> = {
  // --- the five herd traces, in authored order -----------------------------
  //
  // Each one is a piece of the same sentence: the herd came through here, and
  // it went on. None of them says where, because none of them knows.
  "storm-beach-hoofprints": {
    name: "Hoofprints in the tide line",
    found: "Deep prints in the wet sand, filling slowly. They came ashore here too.",
    objective: "Read the prints along the tide line",
  },
  "longgrass-resting-circle-trace": {
    name: "The flattened circle",
    found: "A wide ring of grass pressed flat. The whole herd slept here, and not long ago.",
    objective: "Stand in the flattened grass a while",
  },
  "fernwood-caught-hair": {
    name: "Hair on the bark",
    found: "Dark hair caught at your own shoulder height. One of them stopped to rub here.",
    objective: "Find what the branches are holding",
  },
  "river-spring-tracks": {
    name: "Tracks in the mud",
    found: "Fresh prints crossing the wet mud. The hollow will carry a call a long way.",
    objective: "Call from the wet ground by the spring",
  },
  "blackstone-living-herd": {
    name: "The herd",
    found: "They are here. Not a trace of them - them, standing in the high grass.",
    objective: "Go up to the saddle",
  },

  // --- the two resting hollows ---------------------------------------------
  "longgrass-resting-hollow": {
    name: "The grass bowl",
    found: "A shallow bowl under a lone tree, out of the wind. Somewhere to stand a while.",
    objective: "Rest in the shelter of the lone tree",
  },
  "river-spring-hollow": {
    name: "The spring bank",
    found: "Clear water running out of the rock, and a sheltered bank beside it.",
    objective: "Rest on the bright bank",
  },

  // --- the two optional cuts -----------------------------------------------
  //
  // Named as knowledge, not as unlocks. Nothing about the ground changes; the
  // player simply now knows a way they did not know before.
  "fernwood-river-shortcut": {
    name: "The fern corridor",
    found: "A narrow line worn through the ferns. Something uses this to reach the water.",
    objective: "Follow the worn line through the ferns",
  },
  "longgrass-blackstone-shortcut": {
    name: "The inner ascent",
    found: "Hoof wear on the climb. There is a shorter way up than the long way round.",
    objective: "Take the worn climb inland",
  },
};

/**
 * Fallbacks by kind. Vaguer on purpose - a generic line that is true is better
 * than a specific line that might not be.
 */
const BY_KIND: Readonly<Record<DiscoveryKind, DiscoveryText>> = {
  "herd-trace": {
    name: "A trace of the herd",
    found: "Something of the herd passed here.",
    objective: "Follow the trace",
  },
  "resting-hollow": {
    name: "A resting place",
    found: "Somewhere to stand a while.",
    objective: "Find the resting place",
  },
  overlook: {
    name: "A high place",
    found: "The land opens out below.",
    objective: "Climb to the high ground",
  },
  "wildlife-event": {
    name: "Something moving",
    found: "The island is not empty.",
    objective: "See what moves out there",
  },
  "human-structure": {
    name: "Something built",
    found: "Someone shaped this, a long time ago.",
    objective: "Look at the shaped stone",
  },
  shortcut: {
    name: "A way through",
    found: "The ground opens a way you had not seen.",
    objective: "Find the way through",
  },
  "environmental-event": {
    name: "A change in the air",
    found: "The island shifts around you.",
    objective: "See what is changing",
  },
};

export function discoveryText(id: string, kind: DiscoveryKind): DiscoveryText {
  return BY_ID[id] ?? BY_KIND[kind];
}

/**
 * What the interaction prompt says.
 *
 * Named after what the horse does, not after the key. The key is shown beside
 * it, so the sentence does not have to carry it.
 */
export function interactionPrompt(kind: "inspect" | "rest", name: string): string {
  return kind === "rest" ? `Rest at ${lower(name)}` : `Look closer at ${lower(name)}`;
}

function lower(name: string): string {
  // "The spring" reads badly mid-sentence with a capital; a proper noun would,
  // but nothing here is one.
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/**
 * The line shown while a place is still ahead of the player.
 *
 * The opening of the journey is the one case with no discovery to point at: the
 * herd has not been heard from yet, and the only thing the player can do is
 * ride inland and call. Saying so plainly is the difference between a world
 * that is quiet and a world that appears broken.
 */
export const CALL_OBJECTIVE = "Ride inland, and find where the herd went";

/**
 * What the journey line says when the world has nothing to point at.
 *
 * This happens for real: everything currently known is done, and the next place
 * has not been noticed yet, so the simulation genuinely has no objective. The
 * honest answer is to say there is nowhere in particular to be - inventing a
 * direction here would be pointing at a discovery the player has not found,
 * which is the one thing the exploration design forbids.
 */
export const NO_OBJECTIVE = "Nothing calls to you just now. Ride, and see what you find";

/**
 * The line while traces are still being gathered.
 *
 * Deliberately a count of what is known rather than a direction to anywhere:
 * the first four traces have no prerequisites and may be found in any order, so
 * pointing at one of them would invent an order the world does not have. Saying
 * how much of the story the player is holding is true regardless of the order
 * they hold it in.
 */
export function tracesGathered(found: number, total: number): string {
  if (found === 0) return CALL_OBJECTIVE;
  // The last mandatory place is the herd itself, and it only opens once the
  // traces before it are held. At that point there is a real direction to give
  // and giving it is not a treadmill - it is the thing every trace was saying.
  if (found >= total - 1) return "Every trace leads up. Climb to the crown";
  return found === total - 2
    ? `${found} of ${total - 1} traces, and one still out there`
    : `${found} of ${total - 1} traces found - keep working round the island`;
}

/**
 * The last line the journey says, once, after the herd card has cleared.
 *
 * Its only job is to answer the question a completed objective raises: is it
 * over? The world does not end, nothing is locked, and the horse is standing
 * in it. Said once and withdrawn like every other goal line, because a
 * permanent "free roam" banner would be the game congratulating itself.
 */
export const FREE_ROAM = "Nowhere to be now. The island is yours to ride";

export const CALL_UNANSWERED = "Your call goes out. Nothing answers - yet.";
export const CALL_ANSWERED = "From above the treeline, many voices answer at once.";

/**
 * The end of the arc, and deliberately not the end of the game.
 *
 * The horse has been alone since the storm and is not alone any more; that is
 * the whole of it. No score, no summary, no "return to menu" - the player is
 * standing in a field with their herd and the island is still there. The second
 * line exists to say exactly that, because a completion card with nothing after
 * it reads as an ending screen even when nothing has been taken away.
 */
export const JOURNEY_COMPLETE_TITLE = "Not alone";
export const JOURNEY_COMPLETE_BODY =
  "You followed them the whole way round, and they were up here the whole time. Stay as long as you like - the island is still yours to ride.";

/**
 * Storage, in the player's terms.
 *
 * Two situations that look identical in the code are completely different to a
 * player, and must never be worded the same way:
 *
 * - A previous ride that this island can no longer use. The ride is still in
 *   the stable, untouched, and the game refuses to overwrite it until the
 *   player says so. That is a choice to offer, so it gets a button.
 * - A browser that will not give the game any storage at all. Nothing can fix
 *   that from in here, so offering an action would be a lie. It gets a plain
 *   statement and no button, and the ride continues unremembered.
 */
export const QUARANTINE_TITLE = "A ride this island no longer fits";
export const QUARANTINE_BODY =
  "Your previous ride is untouched, and nothing new will be written over it until you say so.";
export const QUARANTINE_ACTION = "Begin a new ride";
export const QUARANTINE_ACKNOWLEDGED = "Begun again. This ride will be remembered from here.";

export const UNAVAILABLE_TITLE = "This browser keeps no stable";
export const UNAVAILABLE_BODY =
  "Local storage is closed to the game here, so this ride cannot be remembered. Everything else works as it should.";

/**
 * What the game says when the browser takes the picture away.
 *
 * A lost WebGL context is the one failure the player experiences as the screen
 * going blank or freezing, and it is almost never their doing - a driver reset,
 * a laptop switching graphics chips, a browser reclaiming memory from a
 * background tab. So none of this is phrased as an error and none of it blames
 * anyone. It says what happened, what the game did about it, and what the
 * player can do, in that order.
 *
 * The one deliberate friction is `restored-paused`. When the browser hands the
 * context back the game could simply carry on, and it does not: the horse might
 * have been galloping at a cliff when the screen went, and dropping the player
 * back into a moving world they cannot see the last second of is how a recovery
 * becomes a fall. Nothing moves again until they say so.
 */
export const GRAPHICS_TEXT: Record<
  Exclude<GraphicsStatus, "ready">,
  { readonly title: string; readonly body: string; readonly action: string | null }
> = {
  "context-lost": {
    title: "The picture has gone",
    body: "The browser took the graphics back. Your ride is paused where it stood, and the island is waiting.",
    action: null,
  },
  restoring: {
    title: "Coming back",
    body: "The graphics are returning. Nothing has been lost.",
    action: null,
  },
  "restored-paused": {
    title: "Ready when you are",
    body: "The picture is back. The horse has not moved. Take the reins again when you have your bearings.",
    action: "Ride on",
  },
  failed: {
    title: "The picture could not be brought back",
    body: "This page cannot draw the island any more. Reloading starts it again from your last remembered point.",
    action: "Reload the island",
  },
};

export function stateVerb(state: DiscoveryState): string | null {
  switch (state) {
    case "revealed":
      return "somewhere ahead";
    case "visited":
      return "found";
    case "completed":
      return "known";
    default:
      return null;
  }
}
