import type { HorseGait } from "../game/simulation/horse/horseState";
import type { DiscoveryKind } from "../game/contracts/discovery";
import type { GameCommand, GameEvent, UiSnapshot } from "../game/contracts/uiContract";
import type {
  GraphicsLifecycleSnapshot,
  GraphicsStatus,
} from "../game/contracts/runtimeLifecycle";
import { attr, el, setText } from "./dom";
import {
  CALL_ANSWERED,
  CALL_OBJECTIVE,
  CALL_UNANSWERED,
  JOURNEY_COMPLETE_BODY,
  FREE_ROAM,
  GRAPHICS_TEXT,
  JOURNEY_COMPLETE_TITLE,
  tracesGathered,
  NO_OBJECTIVE,
  QUARANTINE_ACKNOWLEDGED,
  QUARANTINE_ACTION,
  QUARANTINE_BODY,
  QUARANTINE_TITLE,
  UNAVAILABLE_BODY,
  UNAVAILABLE_TITLE,
  discoveryText,
  interactionPrompt,
  stateVerb,
} from "./journeyText";
import { OnboardingDirector } from "./onboardingDirector";
import type { PresentationSettings, PresentationSettingsStore } from "./presentationSettings";
import { createTransientClock } from "./transientClock";

export interface DiagnosticsReadout {
  readonly fps: number;
  readonly frameMilliseconds: number;
  readonly simulationSteps: number;
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly cameraDistance: number;
  readonly cameraObstructed: boolean;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly geometries: number;
}

export interface LongrideUiFrame {
  readonly snapshot: UiSnapshot;
  readonly events: readonly GameEvent[];
  readonly elapsedSeconds: number;
  readonly pointerLocked: boolean;
  readonly gallopHeld: boolean;
  readonly diagnostics: DiagnosticsReadout;
  /**
   * The place the player is in, if the world has named places.
   *
   * The interface shows it once, the first time each name appears, and then
   * never again. The Horse Lab has no places and simply omits this.
   */
  readonly place?: string | null;
  /**
   * Where the player is looking from, so a direction can be pointed out.
   *
   * An answering call is a sound, and a sound the player cannot hear - muted,
   * deaf, or on a laptop in a quiet room - carries none of its meaning. Given
   * the viewer, the interface can turn the call's position into an on-screen
   * bearing, which is the visual equivalent of hearing which way it came from.
   */
  readonly viewer?: { readonly x: number; readonly z: number; readonly yaw: number };
}

export interface LongrideUiCallbacks {
  onCommand(command: GameCommand): void;
  onRequestFocus(): void;
  /**
   * The player has asked to take the reins again after a restored context.
   *
   * Separate from `onCommand` on purpose. Graphics recovery is a runtime
   * concern, not a simulation one - the simulation was never told the context
   * went - so resuming from it must not travel as a game command.
   */
  onResumeGraphics?(): void;
  /** Nothing can be recovered; the player has asked to start the page over. */
  onReloadPage?(): void;
}

/**
 * How this session began, told once.
 *
 * The player needs to know whether the island remembers them, and if it does
 * not, why. A save that no longer fits the world is not an error the player
 * caused and must not be presented as one.
 */
export interface JourneyStart {
  /**
   * - `fresh`: nothing stored, and the ride will be remembered.
   * - `resumed`: a stored ride was restored.
   * - `quarantined`: a stored ride exists that this island cannot use. It is
   *   kept, not deleted, and nothing is written until the player accepts. This
   *   is the only kind with an action attached.
   * - `unavailable`: the browser gives the game no storage at all. Nothing can
   *   be acknowledged away, so nothing is offered.
   */
  readonly kind: "fresh" | "resumed" | "quarantined" | "unavailable";
  /** Present for `quarantined`: why the stored ride could not be continued. */
  readonly reason?: string;
  readonly completedDiscoveries: number;
  readonly totalDiscoveries: number;
}

export interface LongrideUi {
  readonly root: HTMLElement;
  update(frame: LongrideUiFrame): void;
  /** Shows where graphics recovery has got to. Safe to call every frame. */
  setGraphicsStatus(snapshot: GraphicsLifecycleSnapshot): void;
  setJourneyStart(start: JourneyStart): void;
  setLoaded(): void;
  setFatalError(message: string): void;
  dispose(): void;
}

const GAITS: readonly HorseGait[] = ["idle", "walk", "trot", "canter", "gallop"];
const GAIT_EMPHASIS_SECONDS = 2.2;
const NOTICE_SECONDS = 2.6;
const RESET_FLASH_SECONDS = 0.75;
/**
 * Long enough to read at a gallop without looking away from the ground ahead,
 * short enough that arriving somewhere is a moment and not a caption.
 */
const PLACE_SECONDS = 5;

/** A found place is worth a moment. Long enough to read, short enough to ride through. */
const DISCOVERY_SECONDS = 5.5;
/** The journey line appears when it changes and then gets out of the way. */
const GOAL_SECONDS = 8;
/** How long the answering call keeps pointing. Long enough to turn and set off. */
const BEARING_SECONDS = 14;
const SAVE_SECONDS = 2.4;

const CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ["Move", "W A S D"],
  ["Gallop", "Shift"],
  ["Jump", "Space"],
  ["Call", "C"],
  ["Look closer, or rest", "E"],
  ["Return to safe ground", "R"],
  ["Look", "Mouse"],
  ["Pause", "Esc"],
  ["Diagnostics", "F3"],
];

/**
 * The whole player-facing interface.
 *
 * It reads `UiSnapshot` and `GameEvent` and sends `GameCommand`. It never
 * touches the Three.js scene, Rapier, or simulation internals, which is what
 * lets this file be rewritten wholesale without destabilising anything else.
 *
 * Implemented as plain DOM rather than a framework: the interface is small, it
 * must not allocate or re-render during a gallop, and a zero-dependency layer
 * keeps the initial download well inside the 20 MB budget.
 */
export function createLongrideUi(
  host: HTMLElement,
  settings: PresentationSettingsStore,
  callbacks: LongrideUiCallbacks,
): LongrideUi {
  const root = el("div", "lr-ui");
  root.dataset.mode = "loading";

  const vignette = el("div", "lr-vignette");
  vignette.setAttribute("aria-hidden", "true");

  // Hints are advisory; acknowledgements are state changes the player must not
  // miss. Both are announced politely so they are not sound-or-nothing.
  const hint = el("div", "lr-hint");
  hint.setAttribute("aria-live", "polite");
  const notice = el("div", "lr-notice");
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");

  // Arriving somewhere is worth naming once. It sits bottom-right with the
  // other resting-state chrome, out of the centre and lower-middle where the
  // horse and the ground ahead live.
  const place = el("div", "lr-place");
  place.setAttribute("role", "status");
  place.setAttribute("aria-live", "polite");
  const placeName = el("div", "lr-place-name");
  place.append(placeName);

  const controls = buildControlLegend();
  const gait = buildGaitStrip();
  const focus = buildFocusPrompt(callbacks);
  const diagnostics = buildDiagnostics();
  const journey = buildJourney();
  const storage = buildStorageNotice(callbacks, () => {
    awaitingNewJourney = true;
  });
  const graphics = buildGraphicsNotice(
    () => callbacks.onResumeGraphics?.(),
    () => callbacks.onReloadPage?.(),
  );
  const pause = buildPausePanel(settings, callbacks, journey.list, () => [...namedPlaces]);
  const loading = buildLoading();

  root.append(
    vignette,
    hint,
    notice,
    place,
    journey.goal,
    journey.bearing,
    journey.discovery,
    journey.prompt,
    journey.save,
    storage.element,
    gait.element,
    controls,
    diagnostics.element,
    focus.element,
    pause.element,
    loading.element,
    // Last, so it sits over everything including the pause panel. A lost
    // context outranks anything else the interface could be saying.
    graphics.element,
  );
  host.append(root);

  const onboarding = new OnboardingDirector();
  let emphasisUntil = 0;
  let noticeUntil = 0;
  let resetFlashUntil = 0;
  let placeUntil = 0;
  /**
   * Every place this player has ever stood, across sessions.
   *
   * A quiet journal, not a quest log: reaching a place adds its name here and
   * announces it once, and the pause panel lists what has been seen. Stored
   * beside the presentation settings because it is memory about the player,
   * not simulation truth - losing it costs a name fading in again.
   */
  const PLACES_KEY = "longride.places.v1";
  const namedPlaces = new Set<string>(
    (() => {
      try {
        const raw = localStorage.getItem(PLACES_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed)
          ? parsed.filter((entry): entry is string => typeof entry === "string")
          : [];
      } catch {
        return [];
      }
    })(),
  );
  const rememberPlace = (name: string): void => {
    namedPlaces.add(name);
    try {
      localStorage.setItem(PLACES_KEY, JSON.stringify([...namedPlaces]));
    } catch {
      // Private browsing forgets; the ride is unaffected.
    }
  };
  /**
   * Transient chrome is timed against real time, not against the app's
   * `elapsedSeconds`. That value is a simulation clock: it accumulates
   * `clamp(rawDelta, 0, 0.1)` per frame so a slow frame cannot teleport the
   * horse, which means on a slow renderer it runs well behind wall time and a
   * five-second title outlived fifteen real seconds. The player reads captions
   * in real seconds and cannot see the frame rate.
   *
   * Onboarding deliberately stays on `elapsedSeconds`: its rules are about how
   * long the player has been riding ("moving for sixteen seconds"), which is
   * gameplay progress rather than presentation timing.
   */
  const transientClock = createTransientClock();
  let lastGait: HorseGait = "idle";
  let loaded = false;
  let hasRidden = false;

  // --- journey presentation state ---
  let goalUntil = 0;
  /** When the free-roam line may appear; zero until the journey completes. */
  let freeRoamAt = 0;
  let lastGoalText: string | null = null;
  let discoveryUntil = 0;
  let saveUntil = 0;
  let bearingUntil = 0;
  let bearingTarget: { readonly x: number; readonly z: number } | null = null;
  let journeyStart: JourneyStart | null = null;
  /** True between accepting a quarantined ride and storage confirming it. */
  let awaitingNewJourney = false;
  let announcedComplete = false;
  /** Kind by discovery id, learned from snapshots, for events that carry only an id. */
  const discoveryKinds = new Map<string, DiscoveryKind>();

  const applySettings = (value: PresentationSettings) => {
    root.style.setProperty("--lr-text-scale", String(value.textScale));
    attr(root, "data-reduced-motion", value.reducedMotion);
    pause.sync(value);
  };
  const unsubscribe = settings.subscribe(applySettings);
  applySettings(settings.value);

  return {
    root,

    setGraphicsStatus(snapshot) {
      graphics.set(snapshot);
      // While the picture is gone the pause panel and the click-to-focus prompt
      // are both offering things that cannot be done, and both would sit under
      // a scrim inviting clicks that go nowhere.
      attr(root, "data-graphics", snapshot.status);
    },

    update(frame) {
      const { snapshot, events, elapsedSeconds, diagnostics: readout } = frame;
      const presentationSeconds = transientClock.advance(
        typeof performance === "undefined" ? elapsedSeconds * 1000 : performance.now(),
        snapshot.mode === "paused",
      );
      attr(root, "data-mode", snapshot.mode);

      // Remember what each known place is, so an event that carries only an id
      // can still be described in words.
      for (const known of snapshot.knownDiscoveries) discoveryKinds.set(known.id, known.kind);

      for (const event of events) {
        switch (event.type) {
          case "HorseGaitChanged":
            emphasisUntil = presentationSeconds + GAIT_EMPHASIS_SECONDS;
            lastGait = event.gait;
            break;
          case "HorseReset":
            showNotice("Back on safe ground");
            resetFlashUntil = presentationSeconds + RESET_FLASH_SECONDS;
            break;
          case "HorseLanded":
            if (event.hard) showNotice("A stumble — find your feet");
            break;
          case "HorseCalled":
            // Said before the world has decided whether anything answers, so it
            // describes the call and promises nothing.
            showNotice(CALL_UNANSWERED);
            break;
          case "CallAnswered":
            showNotice(CALL_ANSWERED);
            // The direction is the whole content of the cue. Keeping it on
            // screen long enough to turn towards is what makes it usable
            // without sound.
            bearingTarget = { x: event.position.x, z: event.position.z };
            bearingUntil = presentationSeconds + BEARING_SECONDS;
            break;
          case "DiscoveryStateChanged":
            // Only the moment a place is understood is worth interrupting for.
            // Revealed and visited are things the player is already looking at.
            if (event.state === "completed") {
              const text = discoveryText(
                event.discoveryId,
                discoveryKinds.get(event.discoveryId) ?? "herd-trace",
              );
              journey.showDiscovery(text.name, text.found);
              discoveryUntil = presentationSeconds + DISCOVERY_SECONDS;
            }
            break;
          case "RestCompleted":
            showNotice("You stand a while. The water is cold.");
            break;
          case "PersistenceStatusChanged":
            // "Remembered" is only ever shown for a write that actually landed.
            // A quarantined ride reports `ready` when the player accepts and
            // `saved` only once something has genuinely been written, so this
            // can never claim a save that has not happened.
            if (event.status === "saved") saveUntil = presentationSeconds + SAVE_SECONDS;
            if (event.status === "ready" && awaitingNewJourney) {
              awaitingNewJourney = false;
              showNotice(QUARANTINE_ACKNOWLEDGED);
            }
            if (event.status === "error") {
              awaitingNewJourney = false;
              showNotice("That could not be written down. This ride carries on unremembered.");
            }
            if (event.status === "unavailable") {
              awaitingNewJourney = false;
              showNotice(UNAVAILABLE_BODY);
            }
            break;
          default:
            break;
        }
      }

      if (snapshot.journeyComplete && !announcedComplete) {
        announcedComplete = true;
        journey.showDiscovery(JOURNEY_COMPLETE_TITLE, JOURNEY_COMPLETE_BODY);
        discoveryUntil = presentationSeconds + DISCOVERY_SECONDS * 1.6;
        // The free-roam line waits for the herd card to clear, so the two are
        // read one after the other instead of stacked on one frame.
        freeRoamAt = discoveryUntil;
      }

      function showNotice(text: string): void {
        setText(notice, text);
        noticeUntil = presentationSeconds + NOTICE_SECONDS;
      }

      // --- gait strip ---
      const preference = settings.value.gaitIndicator;
      gait.element.hidden = preference === "off";
      if (preference !== "off") {
        attr(gait.element, "data-persistent", preference === "always");
        attr(
          gait.element,
          "data-emphasis",
          presentationSeconds < emphasisUntil || snapshot.mode !== "playing",
        );
        gait.set(snapshot.gait, snapshot.speedMetersPerSecond);
      }

      // --- onboarding ---
      const currentHint = onboarding.update({
        elapsedSeconds,
        snapshot,
        events,
        pointerLocked: frame.pointerLocked,
        gallopHeld: frame.gallopHeld,
      });
      if (currentHint) setText(hint, currentHint.text);
      attr(hint, "data-visible", currentHint !== null);

      // --- transient notice ---
      attr(notice, "data-visible", presentationSeconds < noticeUntil);

      // --- place name ---
      // Announced once per place, ever. Riding back and forth across a border
      // must not turn the interface into a flickering caption track.
      const currentPlace = frame.place;
      if (currentPlace && !namedPlaces.has(currentPlace)) {
        rememberPlace(currentPlace);
        setText(placeName, currentPlace);
        placeUntil = presentationSeconds + PLACE_SECONDS;
      }
      attr(
        place,
        "data-visible",
        presentationSeconds < placeUntil && snapshot.mode !== "paused",
      );

      // --- the journey ---
      // One quiet line, shown when the goal changes and then withdrawn. A
      // permanent objective banner would turn riding into task-following, which
      // is the opposite of what this world is for; the pause panel keeps the
      // full picture for anyone who wants to check.
      const goalText = objectiveLine(snapshot);
      if (goalText !== lastGoalText) {
        lastGoalText = goalText;
        if (goalText) {
          journey.setGoal(goalText);
          goalUntil = Math.max(presentationSeconds, freeRoamAt) + GOAL_SECONDS;
        }
      }
      attr(
        journey.goal,
        "data-visible",
        goalText !== null &&
          snapshot.mode === "playing" &&
          presentationSeconds >= freeRoamAt &&
          presentationSeconds < goalUntil,
      );

      // A found place, held briefly.
      attr(
        journey.discovery,
        "data-visible",
        presentationSeconds < discoveryUntil && snapshot.mode !== "paused",
      );

      // The contextual offer. Present exactly while the world says it is, so the
      // player never presses E at nothing and never misses that they could.
      const interaction = snapshot.contextualInteraction;
      if (interaction) {
        const text = discoveryText(
          interaction.discoveryId,
          discoveryKinds.get(interaction.discoveryId) ?? "resting-hollow",
        );
        journey.setPrompt(interactionPrompt(interaction.kind, text.name));
      }
      attr(journey.prompt, "data-visible", interaction !== null && snapshot.mode === "playing");

      // Which way the answer came from.
      const viewer = frame.viewer;
      const bearingVisible =
        bearingTarget !== null &&
        viewer !== undefined &&
        presentationSeconds < bearingUntil &&
        snapshot.mode === "playing";
      if (bearingVisible && bearingTarget && viewer) {
        journey.setBearing(
          relativeBearing(viewer, bearingTarget),
          Math.hypot(bearingTarget.x - viewer.x, bearingTarget.z - viewer.z),
        );
      }
      attr(journey.bearing, "data-visible", bearingVisible);

      // The island remembering. Small, brief, and never in the way.
      attr(journey.save, "data-visible", presentationSeconds < saveUntil);

      journey.syncList(snapshot, journeyStart);

      // --- vignette ---
      const vignetteState =
        presentationSeconds < resetFlashUntil
          ? "reset"
          : snapshot.mode === "recovering"
            ? "stumble"
            : "none";
      attr(vignette, "data-state", vignetteState);

      // --- pointer focus prompt ---
      // Full-screen invitation until the player is under way; a corner pill
      // afterwards, so a keyboard-only session is never permanently dimmed.
      if (snapshot.speedMetersPerSecond > 0.4) hasRidden = true;
      focus.set(
        loaded &&
          !frame.pointerLocked &&
          snapshot.mode !== "paused" &&
          // The storage question is a decision the player has to answer, and the
          // focus prompt is a full-screen click target. Shown together, the
          // prompt swallows the click and the decision cannot be made at all.
          !storage.isVisible,
        hasRidden,
      );

      // --- pause ---
      pause.setVisible(snapshot.mode === "paused");

      // --- diagnostics ---
      diagnostics.element.hidden = !settings.value.showDiagnostics;
      if (settings.value.showDiagnostics) {
        diagnostics.set(readout, snapshot, lastGait);
      }
    },

    setJourneyStart(start) {
      journeyStart = start;
      loading.setJourneyStart(start);
    },

    setLoaded() {
      loaded = true;
      attr(loading.element, "data-done", true);
      window.setTimeout(() => loading.element.remove(), 900);
      // Said after the panel clears rather than on it, because a player who
      // pressed play is watching the world, not the loading text.
      const start = journeyStart;
      if (!start || start.kind === "fresh") return;

      // A ride that cannot be continued is a decision, not a caption. It gets a
      // surface the player has to answer, because until they do, nothing is
      // being written down - and saying that in a notice that fades after five
      // seconds would leave them believing they were being remembered.
      if (start.kind === "quarantined" || start.kind === "unavailable") {
        storage.show(start);
        return;
      }

      setText(
        notice,
        start.completedDiscoveries > 0
          ? `The island remembers you — ${start.completedDiscoveries} of ${start.totalDiscoveries} places known.`
          : "The island remembers you.",
      );
      noticeUntil = transientClock.advance(
        typeof performance === "undefined" ? 0 : performance.now(),
        false,
      ) + NOTICE_SECONDS * 2;
    },

    setFatalError(message: string) {
      loading.showError(message);
    },

    dispose() {
      unsubscribe();
      root.remove();
    },
  };
}

/* ----------------------------------------------------------------- parts -- */

/**
 * The one surface in the journey layer that asks the player something.
 *
 * It exists because of a rule in the save layer that is worth stating plainly:
 * a stored ride this island cannot use is kept, and nothing is written over it
 * until the player says so. Until they answer, this ride is not being
 * remembered - so the interface must not imply that it is, and must not let the
 * question fade away unanswered like an ordinary notice.
 *
 * When the browser simply has no storage there is nothing to decide, so the same
 * surface appears without an action and is dismissible. Offering "begin a new
 * ride" there would promise something that cannot happen.
 */
function buildStorageNotice(callbacks: LongrideUiCallbacks, onAccept: () => void) {
  const element = el("div", "lr-storage");
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-labelledby", "lr-storage-title");

  const panel = el("div", "lr-storage-panel");
  const title = el("h2", "lr-storage-title");
  title.id = "lr-storage-title";
  const body = el("p", "lr-storage-body");
  const reason = el("p", "lr-storage-reason");
  const actions = el("div", "lr-storage-actions");

  const accept = el("button", "lr-button", { type: "button" });
  accept.dataset.variant = "primary";
  const dismiss = el("button", "lr-button", { text: "Ride on", type: "button" });

  actions.append(accept, dismiss);
  panel.append(title, reason, body, actions);
  element.append(panel);

  let visible = false;
  const setVisible = (next: boolean) => {
    visible = next;
    attr(element, "data-visible", next);
    element.inert = !next;
  };
  setVisible(false);

  accept.addEventListener("click", () => {
    // The command may fail - storage can refuse a delete as easily as a write -
    // so nothing here claims success. The persistence status that comes back is
    // what the interface reports, and it reports it wherever it lands.
    onAccept();
    callbacks.onCommand({ type: "StartNewJourney" });
    setVisible(false);
  });
  dismiss.addEventListener("click", () => setVisible(false));

  return {
    element,
    get isVisible() {
      return visible;
    },
    show(start: JourneyStart) {
      const quarantined = start.kind === "quarantined";
      setText(title, quarantined ? QUARANTINE_TITLE : UNAVAILABLE_TITLE);
      setText(reason, quarantined ? (start.reason ?? "") : "");
      reason.hidden = !quarantined || !start.reason;
      setText(body, quarantined ? QUARANTINE_BODY : UNAVAILABLE_BODY);
      setText(accept, QUARANTINE_ACTION);
      accept.hidden = !quarantined;
      // With no action to take, "Ride on" is the whole of the answer.
      setText(dismiss, quarantined ? "Not yet" : "Ride on");
      setVisible(true);
      void element.offsetHeight;
      (quarantined ? accept : dismiss).focus({ preventScroll: true });
    },
    hide: () => setVisible(false),
  };
}

/**
 * The line that points at whatever is next.
 *
 * The opening of the journey has no discovery to name yet - the herd has not
 * answered - so the world would otherwise have nothing to say at the exact
 * moment a new player most needs a direction.
 */
function objectiveLine(snapshot: UiSnapshot): string | null {
  // Completion does not blank the line, it changes what it says. Blanking it
  // leaves the player with a goal that silently vanished and no statement
  // either way about whether the island is still open.
  if (snapshot.journeyComplete) return FREE_ROAM;
  const objective = snapshot.objective;
  // No objective is a real state, not a gap to paper over: everything known is
  // done and nothing new has been noticed yet. Saying so beats saying nothing,
  // which reads as the world having quietly broken.
  if (!objective) return NO_OBJECTIVE;
  if (objective.kind === "journey-event") return CALL_OBJECTIVE;
  const known = snapshot.knownDiscoveries.find((entry) => entry.id === objective.id);
  // A mandatory trace names how much of the story is held, not which trace to
  // go to next. The simulation has to pick one objective and it picks by
  // journey order, but the first four traces carry no prerequisites and can be
  // found in any order - so naming one of them would show the player an order
  // the world does not actually impose, and a player who then rides to a
  // different trace would appear to be doing it wrong. Once only the herd is
  // left, `tracesGathered` does give a direction, because by then there is a
  // real one.
  if (known?.mandatory && known.kind === "herd-trace") {
    return tracesGathered(
      snapshot.completedMandatoryDiscoveries,
      snapshot.totalMandatoryDiscoveries,
    );
  }
  return discoveryText(objective.id, known?.kind ?? "herd-trace").objective;
}

/**
 * The graphics-lifecycle surface: lost, restoring, restored, failed.
 *
 * Built as a scrim over everything rather than as another corner card. Every
 * state it shows is one where what is behind it is either blank, frozen, or a
 * frame the player must not act on, so covering it is honest - and the scrim is
 * what makes it obvious that the game has stopped rather than broken.
 *
 * It takes focus when it appears and gives it back when it goes, because
 * `restored-paused` has a button that is the only way back into the game and a
 * player on a keyboard must be able to reach it without a pointer.
 */
function buildGraphicsNotice(onResume: () => void, onReload: () => void) {
  const element = el("div", "lr-graphics");
  element.setAttribute("role", "alertdialog");
  element.setAttribute("aria-live", "assertive");
  element.setAttribute("aria-labelledby", "lr-graphics-title");

  const panel = el("div", "lr-graphics-panel");
  const title = el("h2", "lr-graphics-title");
  title.id = "lr-graphics-title";
  const body = el("p", "lr-graphics-body");
  const action = el("button", "lr-button", { type: "button" });
  action.dataset.variant = "primary";

  panel.append(title, body, action);
  element.append(panel);

  let status: GraphicsStatus = "ready";
  let handler: (() => void) | null = null;
  action.addEventListener("click", () => handler?.());

  const setVisible = (next: boolean) => {
    attr(element, "data-visible", next);
    element.inert = !next;
  };
  setVisible(false);

  return {
    element,
    get status() {
      return status;
    },
    set(next: GraphicsLifecycleSnapshot): void {
      if (next.status === status) return;
      const previous = status;
      status = next.status;
      if (next.status === "ready") {
        setVisible(false);
        handler = null;
        return;
      }
      const text = GRAPHICS_TEXT[next.status];
      setText(title, text.title);
      setText(body, text.body);
      attr(element, "data-status", next.status);
      // Only `restored-paused` and `failed` have anything to press. The other
      // two are waits, and a button that does nothing during a wait invites the
      // player to believe the wait is their fault for not pressing it.
      handler = next.status === "restored-paused" ? onResume : next.status === "failed" ? onReload : null;
      action.hidden = text.action === null;
      if (text.action !== null) setText(action, text.action);
      setVisible(true);
      // Focus only when there is somewhere to put it, and only on the frame the
      // state actually changes - re-focusing every frame would trap a screen
      // reader mid-sentence.
      if (text.action !== null && previous !== next.status) {
        void element.offsetHeight;
        action.focus({ preventScroll: true });
      }
    },
  };
}

/**
 * Bearing to a point, in degrees clockwise from where the player is facing.
 *
 * Zero is dead ahead. The interface only needs to place a mark around the edge
 * of the view, so this is deliberately a compass bearing rather than a
 * projection: a target behind the camera has no screen position, and the player
 * still needs to be told to turn around.
 */
function relativeBearing(
  viewer: { readonly x: number; readonly z: number; readonly yaw: number },
  target: { readonly x: number; readonly z: number },
): number {
  const heading = Math.atan2(target.x - viewer.x, target.z - viewer.z);
  const relative = heading - viewer.yaw;
  const degrees = (relative * 180) / Math.PI;
  return ((degrees + 180) % 360 + 360) % 360 - 180;
}

/**
 * Everything the journey shows: a goal line, a bearing, a found-place card, a
 * contextual offer, a save mark, and the list the pause panel borrows.
 *
 * All of it sits low or at the edges. The middle of the screen belongs to the
 * horse and the ground in front of it, and no part of this may cover either
 * while the player is riding.
 */
function buildJourney() {
  const goal = el("div", "lr-goal");
  goal.setAttribute("aria-live", "polite");
  const goalText = el("span", "lr-goal-text");
  goal.append(el("span", "lr-goal-mark", { text: "›" }), goalText);

  const bearing = el("div", "lr-bearing");
  bearing.setAttribute("aria-hidden", "true");
  // The caption rides with the mark rather than sitting at a fixed point on the
  // ring, so it can never drift over the horse - and it is counter-rotated in
  // CSS so it stays upright whichever way the mark is pointing.
  const bearingArrow = el("div", "lr-bearing-arrow");
  const bearingGlyph = el("div", "lr-bearing-glyph", { text: "▲" });
  const bearingDistance = el("div", "lr-bearing-distance");
  bearingArrow.append(bearingGlyph, bearingDistance);
  bearing.append(bearingArrow);

  const discovery = el("div", "lr-discovery");
  discovery.setAttribute("role", "status");
  discovery.setAttribute("aria-live", "polite");
  const discoveryName = el("div", "lr-discovery-name");
  const discoveryBody = el("div", "lr-discovery-body");
  discovery.append(discoveryName, discoveryBody);

  const prompt = el("div", "lr-prompt");
  prompt.setAttribute("role", "status");
  prompt.setAttribute("aria-live", "polite");
  const promptKey = el("kbd", "lr-prompt-key", { text: "E" });
  const promptText = el("span", "lr-prompt-text");
  prompt.append(promptKey, promptText);

  const save = el("div", "lr-save", { text: "Remembered" });
  save.setAttribute("role", "status");
  save.setAttribute("aria-live", "polite");

  // Lives inside the pause panel, so the full picture is available on demand
  // without ever being on screen while riding.
  const list = el("div", "lr-journey");
  const listSummary = el("p", "lr-journey-summary");
  const listItems = el("ul", "lr-journey-list");
  list.append(el("h3", "lr-journey-title", { text: "Your journey" }), listSummary, listItems);

  let listSignature = "";

  return {
    goal,
    bearing,
    discovery,
    prompt,
    save,
    list,

    setGoal(text: string) {
      setText(goalText, text);
    },

    setBearing(degrees: number, distanceMeters: number) {
      bearingArrow.style.setProperty("--lr-bearing", `${degrees.toFixed(1)}deg`);
      // Rounded hard: a precise distance would read as instrumentation, and a
      // horse does not know it is sixty-three metres away from anything.
      setText(
        bearingDistance,
        distanceMeters > 220 ? "far off" : distanceMeters > 60 ? "away" : "close",
      );
      attr(bearing, "data-behind", Math.abs(degrees) > 90);
    },

    showDiscovery(name: string, body: string) {
      setText(discoveryName, name);
      setText(discoveryBody, body);
    },

    setPrompt(text: string) {
      setText(promptText, text);
    },

    syncList(snapshot: UiSnapshot, start: JourneyStart | null) {
      const signature = `${snapshot.knownDiscoveries
        .map((entry) => `${entry.id}:${entry.state}`)
        .join("|")}/${snapshot.journeyComplete}/${start?.kind ?? ""}`;
      if (signature === listSignature) return;
      listSignature = signature;

      setText(
        listSummary,
        snapshot.journeyComplete
          ? "You have seen what this island had to show you."
          : snapshot.knownDiscoveries.length === 0
            ? "Nothing found yet. The island is bigger than it looks."
            : `${snapshot.completedMandatoryDiscoveries} of ${snapshot.totalMandatoryDiscoveries} places known.`,
      );

      listItems.replaceChildren();
      for (const entry of snapshot.knownDiscoveries) {
        const text = discoveryText(entry.id, entry.kind);
        const item = el("li", "lr-journey-item");
        item.dataset.state = entry.state;
        item.append(
          el("span", "lr-journey-item-name", { text: text.name }),
          el("span", "lr-journey-item-state", { text: stateVerb(entry.state) ?? "" }),
        );
        listItems.append(item);
      }
    },
  };
}

/**
 * The controls, always on screen.
 *
 * The onboarding hints teach one thing at a time and then get out of the way,
 * which is right for a first ride and useless afterwards: a player who comes
 * back tomorrow has no way to find out that Space jumps or that C calls, short
 * of opening the pause menu. This is the reference card - low contrast, small,
 * out at the edge, and never animated, so it can be read when it is wanted and
 * ignored when it is not.
 *
 * It is deliberately not a HUD element: nothing here changes at runtime, so it
 * costs one build and no per-frame work.
 */
function buildControlLegend(): HTMLElement {
  const element = el("aside", "lr-controls");
  element.setAttribute("aria-label", "Controls");
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["W A S D", "ride"],
    ["\u2190 \u2192", "turn"],
    ["Shift", "gallop"],
    ["Space", "jump"],
    ["C", "call"],
    ["E", "interact"],
    ["R", "reset"],
    ["Esc", "pause"],
  ];
  for (const [keys, action] of rows) {
    const row = el("div", "lr-controls-row");
    row.append(
      el("span", "lr-controls-key", { text: keys }),
      el("span", "lr-controls-action", { text: action }),
    );
    element.append(row);
  }
  return element;
}

function buildGaitStrip() {
  const element = el("div", "lr-gait");
  // Decorative reinforcement of something the player already feels. Announcing
  // every gait and speed change would drown out the acknowledgements that
  // actually matter.
  element.setAttribute("aria-hidden", "true");
  const ticks = el("div", "lr-gait-ticks");
  const nodes = GAITS.map((name, index) => {
    const tick = el("div", "lr-gait-tick");
    tick.style.height = `${0.45 + index * 0.26}rem`;
    tick.title = name;
    ticks.append(tick);
    return tick;
  });

  const label = el("div", "lr-gait-label");
  const gaitName = el("span", "lr-gait-name", { text: "idle" });
  const speed = el("span", "lr-gait-speed", { text: "0.0 m/s" });
  label.append(gaitName, speed);
  element.append(ticks, label);

  return {
    element,
    set(current: HorseGait, metersPerSecond: number) {
      const activeIndex = GAITS.indexOf(current);
      nodes.forEach((node, index) => {
        attr(node, "data-active", index === activeIndex);
        attr(node, "data-reached", index < activeIndex);
      });
      setText(gaitName, current);
      setText(speed, `${metersPerSecond.toFixed(1)} m/s`);
    },
  };
}

function buildFocusPrompt(callbacks: LongrideUiCallbacks) {
  // A real button, so it is reachable and activatable from the keyboard rather
  // than being a click-only surface.
  const element = el("button", "lr-focus", { type: "button" });
  const inner = el("div", "lr-focus-inner");
  inner.append(
    el("strong", undefined, { text: "Click to look around" }),
    el("span", undefined, { text: "W A S D to move  ·  Esc to pause" }),
  );
  element.append(inner);
  element.addEventListener("click", () => callbacks.onRequestFocus());

  return {
    element,
    set(visible: boolean, compact: boolean) {
      attr(element, "data-visible", visible);
      attr(element, "data-compact", compact);
      // The full-screen form is a scrim the player must be able to dismiss; the
      // corner pill should never steal focus from the game.
      element.tabIndex = visible && !compact ? 0 : -1;
    },
  };
}

function buildLoading() {
  const element = el("div", "lr-loading");
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  const inner = el("div", "lr-loading-inner");
  const note = el("div", "lr-loading-note", { text: "Preparing the island" });
  inner.append(
    el("h1", "lr-loading-title", { text: "LONGRIDE" }),
    note,
  );
  element.append(inner);
  return {
    element,
    /**
     * The loading panel is the only place a returning player is looking, so it
     * is where the island says whether it remembers them.
     */
    setJourneyStart(start: JourneyStart) {
      setText(
        note,
        start.kind === "resumed"
          ? "Returning to your island"
          : start.kind === "quarantined"
            ? "Setting out again"
            : "Preparing the island",
      );
    },
    showError(message: string) {
      element.dataset.done = "false";
      setText(note, "Could not start");
      const detail = el("pre", "lr-error", { text: message });
      inner.append(detail);
    },
  };
}

function buildDiagnostics() {
  const element = el("aside", "lr-diagnostics");
  element.hidden = true;
  element.append(el("div", "lr-diagnostics-title", { text: "Diagnostics" }));

  const rows = new Map<string, { row: HTMLElement; value: HTMLElement }>();
  const addRow = (key: string, label: string) => {
    const row = el("div", "lr-diagnostics-row");
    const value = el("span", undefined, { text: "-" });
    row.append(el("span", undefined, { text: label }), value);
    element.append(row);
    rows.set(key, { row, value });
  };

  for (const [key, label] of [
    ["fps", "fps"],
    ["frame", "frame ms"],
    ["steps", "sim steps"],
    ["tick", "tick"],
    ["gait", "gait"],
    ["speed", "speed m/s"],
    ["position", "position"],
    ["grounded", "grounded"],
    ["canJump", "can jump"],
    ["camera", "camera m"],
    ["draws", "draw calls"],
    ["triangles", "triangles"],
  ] as const) {
    addRow(key, label);
  }

  const set = (
    readout: DiagnosticsReadout,
    snapshot: UiSnapshot,
    gait: HorseGait,
  ) => {
    const write = (key: string, text: string, warn = false) => {
      const entry = rows.get(key);
      if (!entry) return;
      setText(entry.value, text);
      attr(entry.row, "data-warn", warn);
    };

    write("fps", readout.fps.toFixed(0), readout.fps < 55);
    write("frame", readout.frameMilliseconds.toFixed(2), readout.frameMilliseconds > 18);
    write("steps", String(readout.simulationSteps), readout.simulationSteps > 4);
    write("tick", String(readout.tick));
    write("gait", gait);
    write("speed", snapshot.speedMetersPerSecond.toFixed(2));
    write(
      "position",
      `${readout.x.toFixed(1)} ${readout.y.toFixed(2)} ${readout.z.toFixed(1)}`,
    );
    write("grounded", snapshot.grounded ? "yes" : "no", !snapshot.grounded);
    write("canJump", snapshot.canJump ? "yes" : "no");
    write(
      "camera",
      `${readout.cameraDistance.toFixed(2)}${readout.cameraObstructed ? " *" : ""}`,
      readout.cameraObstructed,
    );
    write("draws", String(readout.drawCalls), readout.drawCalls > 200);
    write(
      "triangles",
      readout.triangles > 1000
        ? `${(readout.triangles / 1000).toFixed(0)}k`
        : String(readout.triangles),
      readout.triangles > 750_000,
    );
  };

  return { element, set };
}

function buildPausePanel(
  settings: PresentationSettingsStore,
  callbacks: LongrideUiCallbacks,
  journeyList: HTMLElement,
  seenPlaces: () => readonly string[],
) {
  const element = el("div", "lr-pause");
  element.setAttribute("role", "dialog");
  element.setAttribute("aria-modal", "true");
  element.setAttribute("aria-labelledby", "lr-pause-title");

  const panel = el("div", "lr-panel");
  const title = el("h2", "lr-panel-title", { text: "Paused" });
  title.id = "lr-pause-title";
  panel.append(
    title,
    el("p", "lr-panel-subtitle", {
      text: "The field is still there. Take a moment.",
    }),
  );

  // The journal: every place this rider has stood, refreshed when the panel
  // opens. A list of names, deliberately nothing more - no percentages, no
  // checkmarks - because remembering where you have been is the reward.
  const placesTitle = el("h3", "lr-panel-section", { text: "Places you have stood" });
  const placesList = el("div", "lr-places");
  const refreshPlaces = (): void => {
    const seen = seenPlaces();
    placesList.textContent = "";
    if (seen.length === 0) {
      placesList.append(
        el("span", "lr-places-empty", { text: "Nowhere yet. Ride." }),
      );
      return;
    }
    for (const name of seen) {
      placesList.append(el("span", "lr-places-name", { text: name }));
    }
  };
  // Filled on first open, not here: the panel is built before the journal
  // exists, and the journal cannot exist first because it wants the panel's
  // own host. `setVisible` refreshes on every open.
  placesList.append(el("span", "lr-places-empty", { text: "Nowhere yet. Ride." }));
  panel.append(placesTitle, placesList);

  const actions = el("div", "lr-actions");
  const resume = el("button", "lr-button", { text: "Resume", type: "button" });
  resume.dataset.variant = "primary";
  resume.addEventListener("click", () => callbacks.onCommand({ type: "Resume" }));

  const recover = el("button", "lr-button", {
    text: "Return to safe ground",
    type: "button",
  });
  recover.addEventListener("click", () => {
    callbacks.onCommand({ type: "ResetToSafeGround" });
    callbacks.onCommand({ type: "Resume" });
  });

  actions.append(resume, recover);
  panel.append(actions);

  // The journey sits in the panel itself rather than behind a tab. Someone who
  // just pressed Escape mid-ride is far more likely to be asking "where was I?"
  // than "which key was that?", and an answer you have to go looking for is not
  // an answer at the moment it is wanted.
  panel.append(journeyList);

  const tabs = el("div", "lr-tabs");
  tabs.setAttribute("role", "tablist");
  const settingsPanel = el("div", "lr-tabpanel");
  settingsPanel.id = "lr-tabpanel-settings";
  settingsPanel.setAttribute("role", "tabpanel");
  const controlsPanel = el("div", "lr-tabpanel");
  controlsPanel.id = "lr-tabpanel-controls";
  controlsPanel.setAttribute("role", "tabpanel");
  controlsPanel.hidden = true;

  const tabButtons: HTMLButtonElement[] = [];

  const selectTab = (tab: HTMLButtonElement, target: HTMLElement) => {
    for (const other of tabButtons) {
      const isCurrent = other === tab;
      other.setAttribute("aria-selected", String(isCurrent));
      // Roving tabindex: the tablist is one stop, arrows move within it.
      other.tabIndex = isCurrent ? 0 : -1;
    }
    settingsPanel.hidden = target !== settingsPanel;
    controlsPanel.hidden = target !== controlsPanel;
  };

  const makeTab = (label: string, target: HTMLElement, selected: boolean) => {
    const tab = el("button", "lr-tab", { text: label, type: "button" });
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(selected));
    tab.setAttribute("aria-controls", target.id);
    tab.tabIndex = selected ? 0 : -1;
    tab.addEventListener("click", () => selectTab(tab, target));
    tabs.append(tab);
    tabButtons.push(tab);
    return tab;
  };

  makeTab("Settings", settingsPanel, true);
  makeTab("Controls", controlsPanel, false);

  tabs.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const active = tabButtons.indexOf(document.activeElement as HTMLButtonElement);
    if (active < 0) return;
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = (active + step + tabButtons.length) % tabButtons.length;
    const target = next === 0 ? settingsPanel : controlsPanel;
    selectTab(tabButtons[next]!, target);
    tabButtons[next]!.focus();
  });

  // Everything below the pinned header scrolls together, so a short window
  // never puts Resume out of reach.
  const scroll = el("div", "lr-panel-scroll");
  scroll.append(settingsPanel, controlsPanel);
  panel.append(tabs, scroll);

  const controlsList = el("dl", "lr-keys");
  for (const [action, key] of CONTROLS) {
    const row = el("div", "lr-key-row");
    row.append(el("dt", undefined, { text: action }), el("dd", undefined, { text: key }));
    controlsList.append(row);
  }
  controlsPanel.append(controlsList);

  const sync = buildSettingsFields(settingsPanel, settings, callbacks);

  element.append(panel);

  /**
   * Keeps Tab inside the dialog.
   *
   * Focus is moved explicitly rather than by letting the browser tab and only
   * intervening at the ends of the list. Browsers disagree about which controls
   * Tab visits — WebKit skips buttons and checkboxes by default — so an
   * edge-detecting trap leaks focus out of a surface that is meant to be modal.
   */
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;

    const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (node) => node.tabIndex >= 0 && node.offsetParent !== null,
    );
    if (focusable.length === 0) return;

    event.preventDefault();

    const active = document.activeElement as HTMLElement | null;
    const current = active ? focusable.indexOf(active) : -1;
    const step = event.shiftKey ? -1 : 1;
    const next =
      current < 0
        ? event.shiftKey
          ? focusable.length - 1
          : 0
        : (current + step + focusable.length) % focusable.length;

    focusable[next]?.focus();
  });

  return {
    element,
    sync,
    setVisible(visible: boolean) {
      const wasVisible = element.dataset.visible === "true";
      if (visible && !wasVisible) refreshPlaces();
      attr(element, "data-visible", visible);
      // `inert` keeps the hidden dialog out of the tab order entirely, rather
      // than relying on visibility alone.
      element.inert = !visible;

      if (visible && !wasVisible) {
        // Reading a layout property flushes the pending style change, so the
        // dialog is genuinely visible before focus moves. Focusing an element
        // that is still computed as hidden fails silently.
        void element.offsetHeight;
        resume.focus({ preventScroll: true });
      }
    },
  };
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function buildSettingsFields(
  container: HTMLElement,
  settings: PresentationSettingsStore,
  callbacks: LongrideUiCallbacks,
): (value: PresentationSettings) => void {
  const syncers: Array<(value: PresentationSettings) => void> = [];

  const addSlider = (
    key: "cameraSensitivity" | "fieldOfView" | "cameraFollowStrength" | "masterVolume" | "ambienceVolume" | "horseVolume" | "textScale",
    label: string,
    hintText: string,
    min: number,
    max: number,
    step: number,
    format: (value: number) => string,
  ) => {
    const field = el("div", "lr-field");
    const labelNode = el("label", "lr-field-label");
    labelNode.append(
      document.createTextNode(label),
      el("span", "lr-field-hint", { text: hintText }),
    );
    const input = el("input", undefined, { type: "range" });
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const value = el("span", "lr-field-value");
    labelNode.htmlFor = `lr-${key}`;
    input.id = `lr-${key}`;

    input.addEventListener("input", () => {
      const next = Number(input.value);
      settings.update({ [key]: next } as Partial<PresentationSettings>);
      if (key === "cameraSensitivity") {
        callbacks.onCommand({ type: "SetCameraSensitivity", value: next });
      }
    });

    field.append(labelNode, input, value);
    container.append(field);
    syncers.push((current) => {
      const numeric = current[key];
      input.value = String(numeric);
      setText(value, format(numeric));
    });
  };

  const addToggle = (
    key: "invertLookY" | "reducedMotion" | "showDiagnostics" | "postFx",
    label: string,
    hintText: string,
  ) => {
    const field = el("div", "lr-field");
    const labelNode = el("label", "lr-field-label");
    labelNode.append(
      document.createTextNode(label),
      el("span", "lr-field-hint", { text: hintText }),
    );
    const input = el("input", undefined, { type: "checkbox" });
    labelNode.htmlFor = `lr-${key}`;
    input.id = `lr-${key}`;
    input.addEventListener("change", () => {
      settings.update({ [key]: input.checked } as Partial<PresentationSettings>);
      if (key === "reducedMotion") {
        callbacks.onCommand({ type: "SetReducedMotion", enabled: input.checked });
      }
    });
    field.append(labelNode, input, el("span", "lr-field-value"));
    container.append(field);
    syncers.push((current) => {
      input.checked = current[key];
    });
  };

  addSlider(
    "cameraSensitivity",
    "Look sensitivity",
    "How far the camera turns with the mouse",
    0.25,
    2.5,
    0.05,
    (value) => `${value.toFixed(2)}×`,
  );
  addToggle("invertLookY", "Invert look", "Pull down to look up");
  addSlider(
    "fieldOfView",
    "Field of view",
    "Widens the view; speed adds a little more",
    50,
    82,
    1,
    (value) => `${value.toFixed(0)}°`,
  );
  addSlider(
    "cameraFollowStrength",
    "Camera follow",
    "Lower is looser and more cinematic",
    0.4,
    1.8,
    0.05,
    (value) => `${value.toFixed(2)}×`,
  );
  addToggle(
    "reducedMotion",
    "Reduced motion",
    "Softens camera shake, lean, and field-of-view change",
  );
  addToggle(
    "postFx",
    "Enhanced graphics",
    "Colour grade and vignette; turn off on slower machines",
  );

  const gaitField = el("div", "lr-field");
  const gaitLabel = el("label", "lr-field-label");
  gaitLabel.append(
    document.createTextNode("Gait indicator"),
    el("span", "lr-field-hint", { text: "Fades out on its own by default" }),
  );
  const gaitSelect = el("select");
  gaitLabel.htmlFor = "lr-gaitIndicator";
  gaitSelect.id = "lr-gaitIndicator";
  for (const [value, label] of [
    ["auto", "Fade when settled"],
    ["always", "Always visible"],
    ["off", "Hidden"],
  ] as const) {
    const option = el("option", undefined, { value, text: label });
    gaitSelect.append(option);
  }
  gaitSelect.addEventListener("change", () => {
    settings.update({
      gaitIndicator: gaitSelect.value as PresentationSettings["gaitIndicator"],
    });
  });
  gaitField.append(gaitLabel, gaitSelect, el("span", "lr-field-value"));
  container.append(gaitField);
  syncers.push((current) => {
    gaitSelect.value = current.gaitIndicator;
  });

  addSlider(
    "masterVolume",
    "Sound",
    "All audio is synthesised placeholder",
    0,
    1,
    0.05,
    (value) => `${Math.round(value * 100)}%`,
  );
  addSlider(
    "ambienceVolume",
    "Wind and surf",
    "",
    0,
    1,
    0.05,
    (value) => `${Math.round(value * 100)}%`,
  );
  addSlider(
    "horseVolume",
    "Hooves and breath",
    "",
    0,
    1,
    0.05,
    (value) => `${Math.round(value * 100)}%`,
  );
  addSlider(
    "textScale",
    "Text size",
    "",
    0.85,
    1.5,
    0.05,
    (value) => `${Math.round(value * 100)}%`,
  );
  addToggle("showDiagnostics", "Diagnostics overlay", "Also toggled with F3");

  return (value) => {
    for (const sync of syncers) sync(value);
  };
}
