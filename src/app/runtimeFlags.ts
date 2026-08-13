/**
 * Runtime flags read from the page URL.
 *
 * These are switches for automation, not player settings: player-facing choices
 * live in `PresentationSettingsStore` and persist. A flag here is decided once
 * for the lifetime of the page and never changes under the app, which is what
 * makes it something a test can rely on.
 */
export interface RuntimeFlags {
  /**
   * Guarantees the page makes no sound at all.
   *
   * Automated runs open dozens of pages on machines that may be shared, and a
   * headless browser flag only silences the process the harness happens to have
   * launched - it does nothing for a page opened by hand to reproduce a failure,
   * and nothing for whatever runs the suite next. Deciding it inside the app
   * instead means the guarantee travels with the URL.
   */
  readonly muted: boolean;
}

export interface UrlParts {
  readonly search: string;
  readonly hash: string;
}

/** The canonical form. `?mute=1` is what every automated entry point uses. */
export const MUTE_PARAM = "mute";

const TRUTHY = new Set(["", "1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

/**
 * Reads one flag out of a URL, tolerating the ways a URL actually gets written.
 *
 * The parameter is looked for in the query string and then in any query inside
 * the fragment, because `#/somewhere?mute=1` is a shape people produce by
 * accident and a mute flag that silently does nothing is worse than no flag. A
 * bare `?mute` counts as on; `?mute=0` is an explicit off, so a URL can turn the
 * flag back off without having to be rewritten.
 */
function readFlag(parts: UrlParts, name: string): boolean {
  for (const source of [parts.search, queryWithinHash(parts.hash)]) {
    if (!source) continue;
    const value = new URLSearchParams(source).get(name);
    if (value === null) continue;
    const normalised = value.trim().toLowerCase();
    if (FALSY.has(normalised)) return false;
    if (TRUTHY.has(normalised)) return true;
  }
  return false;
}

function queryWithinHash(hash: string): string {
  const start = hash.indexOf("?");
  return start === -1 ? "" : hash.slice(start + 1);
}

export function resolveRuntimeFlags(parts: UrlParts = currentUrlParts()): RuntimeFlags {
  return { muted: readFlag(parts, MUTE_PARAM) };
}

function currentUrlParts(): UrlParts {
  if (typeof location === "undefined") return { search: "", hash: "" };
  return { search: location.search, hash: location.hash };
}
