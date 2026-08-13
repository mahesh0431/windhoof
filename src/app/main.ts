import "../ui/ui.css";
import { startWindhoof } from "./windhoofApp";

const canvas = document.querySelector<HTMLCanvasElement>("#windhoof-canvas");
const uiHost = document.querySelector<HTMLElement>("#windhoof-ui");

if (!canvas || !uiHost) {
  throw new Error("Windhoof host elements are missing from the document");
}

startWindhoof(canvas, uiHost).catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  reportStartupFailure(uiHost, message);
});

/**
 * A browser game can fail to start for reasons the player can act on — no
 * WebGL 2, a blocked WebAssembly fetch, hardware acceleration switched off. A
 * blank canvas tells them none of that, so the failure is stated plainly.
 */
function reportStartupFailure(host: HTMLElement, message: string): void {
  document.documentElement.dataset.windhoof = "failed";
  console.error("[windhoof] startup failed", message);

  const existing = host.querySelector(".wh-loading");
  const panel = existing ?? document.createElement("div");
  if (!existing) {
    panel.className = "wh-loading";
    host.append(panel);
  }

  panel.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "wh-loading-inner";

  const title = document.createElement("h1");
  title.className = "wh-loading-title";
  title.textContent = "WINDHOOF";

  const note = document.createElement("div");
  note.className = "wh-loading-note";
  note.textContent = "Windhoof could not start";

  const detail = document.createElement("pre");
  detail.className = "wh-error";
  detail.textContent = message;

  inner.append(title, note, detail);
  panel.append(inner);
}
