import "../ui/ui.css";
import { startLongride } from "./longrideApp";

const canvas = document.querySelector<HTMLCanvasElement>("#longride-canvas");
const uiHost = document.querySelector<HTMLElement>("#longride-ui");

if (!canvas || !uiHost) {
  throw new Error("Longride host elements are missing from the document");
}

startLongride(canvas, uiHost).catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  reportStartupFailure(uiHost, message);
});

/**
 * A browser game can fail to start for reasons the player can act on — no
 * WebGL 2, a blocked WebAssembly fetch, hardware acceleration switched off. A
 * blank canvas tells them none of that, so the failure is stated plainly.
 */
function reportStartupFailure(host: HTMLElement, message: string): void {
  document.documentElement.dataset.longride = "failed";
  console.error("[longride] startup failed", message);

  const existing = host.querySelector(".lr-loading");
  const panel = existing ?? document.createElement("div");
  if (!existing) {
    panel.className = "lr-loading";
    host.append(panel);
  }

  panel.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "lr-loading-inner";

  const title = document.createElement("h1");
  title.className = "lr-loading-title";
  title.textContent = "LONGRIDE";

  const note = document.createElement("div");
  note.className = "lr-loading-note";
  note.textContent = "Longride could not start";

  const detail = document.createElement("pre");
  detail.className = "lr-error";
  detail.textContent = message;

  inner.append(title, note, detail);
  panel.append(inner);
}
