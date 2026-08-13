/**
 * The URL every automated run opens.
 *
 * Automation is always muted. Chromium's `--mute-audio` process flag is not
 * enough on its own: it only covers the browser the harness launched, so it does
 * nothing for a page opened by hand from a printed URL to reproduce a failure,
 * and nothing at all for WebKit. Putting the guarantee in the URL means it
 * travels with the link.
 *
 * Composition is the whole point of having this in one place - the base URL may
 * already carry a port, a path, a query and a fragment, and `?mute=1` has to
 * survive all four.
 */
export function automationUrl(baseUrl, params = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("mute", "1");
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}
