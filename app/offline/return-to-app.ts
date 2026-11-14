'use client';

// The way back from the offline page to the app. It asks the server for the
// app's manifest first: a HEAD request, which the service worker never
// answers, so only a reachable server answers it. Any answer means the page
// the person opened can load, so the page reloads that address and the
// browser shows the app in its place. No answer leaves the offline page as
// it is. A tap and the `online` event share one attempt.

/** What reaches the server: a small static file. Any HTTP answer counts, a redirect or refusal included. */
const PROBE_PATH = '/manifest.webmanifest';

/** A phone with a weak signal can keep a request open far longer; then the page says it has no signal. */
const PROBE_LIMIT_MS = 8_000;

let attempt: Promise<boolean> | null = null;

async function reachesServer(): Promise<boolean> {
  try {
    await fetch(PROBE_PATH, {
      method: 'HEAD',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_LIMIT_MS),
    });
    return true;
  } catch {
    // best-effort: no answer is the offline page's normal state, shown by its caller.
    return false;
  }
}

/**
 * Reloads the address the person opened once the server answers, and resolves false when it does
 * not. A reload never resolves: the page stays busy until the app replaces it.
 */
export function returnToApp(): Promise<boolean> {
  attempt ??= reachesServer().then((reached) => {
    if (!reached) {
      attempt = null;
      return false;
    }
    window.location.reload();
    return new Promise<boolean>(() => undefined);
  });
  return attempt;
}
