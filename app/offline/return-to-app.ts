'use client';

// The way back from the offline page to the app. It asks the server for the
// app's manifest first: a HEAD request, which the service worker never
// answers, so only a reachable server answers it. Any answer means the page
// the person opened can load, so the page reloads that address and the
// browser shows the app in its place. No answer leaves the offline page as
// it is. A tap, the `online` event and the page's start share one attempt.

/** What reaches the server: a small static file. Any HTTP answer counts, a redirect or refusal included. */
export const PROBE_PATH = '/manifest.webmanifest';

/** A phone with a weak signal can keep a request open far longer; then the page says it has no signal. */
const PROBE_LIMIT_MS = 8_000;

/** When this page last reloaded itself, in this tab. */
const RELOADED_AT_KEY = 'werkflow:offline-reloaded-at';

/**
 * A reload that came back to the offline page (the server answered the check, the page did not
 * load) waits this long before the page's start tries again, so a flaky signal never reloads the
 * page in a loop. A tap and the `online` event still try at once.
 */
const START_PAUSE_MS = 30_000;

/**
 * A network the phone just reported can carry no request yet (Wi-Fi joined, no route), so a way
 * back the page starts on its own checks again after each of these pauses while the phone still
 * reports it.
 */
const SETTLE_PAUSES_MS = [1_000, 2_000, 4_000, 8_000];

let attempt: Promise<boolean> | null = null;
let settling: Promise<boolean> | null = null;

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
    try {
      sessionStorage.setItem(RELOADED_AT_KEY, String(Date.now()));
    } catch {
      // best-effort: without sessionStorage the page's start only tries while the phone reports a network.
    }
    window.location.reload();
    return new Promise<boolean>(() => undefined);
  });
  return attempt;
}

/**
 * The way back after `online`: `returnToApp`, again after each settle pause while the phone
 * reports a network. Resolves false once the checks are spent or the
 * network report is gone; the next `online` starts it anew.
 */
export function returnWhenReachable(): Promise<boolean> {
  settling ??= (async () => {
    try {
      if (await returnToApp()) return true;
      for (const pause of SETTLE_PAUSES_MS) {
        await new Promise((resume) => setTimeout(resume, pause));
        if (!navigator.onLine) return false;
        if (await returnToApp()) return true;
      }
      return false;
    } finally {
      settling = null;
    }
  })();
  return settling;
}

/**
 * Whether the page's start tries the way back: the signal may have returned before the page could
 * listen for `online`, as on a phone opened cold. Not when the phone reports no network, and not
 * right after a reload of this page that came back here.
 */
export function returnsOnStart(): boolean {
  if (!navigator.onLine) return false;
  try {
    const last = sessionStorage.getItem(RELOADED_AT_KEY);
    // The guard must be writable before the start may reload: rewritten at its full width, it throws
    // when the storage is full, where the reload's own write would fail and nothing would stop a loop.
    sessionStorage.setItem(RELOADED_AT_KEY, last ?? '0'.padStart(String(Date.now()).length, '0'));
    return Date.now() - Number(last ?? 0) >= START_PAUSE_MS;
  } catch {
    // best-effort: without a writable sessionStorage no loop guard can hold, so the start leaves it to the signal and a tap.
    return false;
  }
}
