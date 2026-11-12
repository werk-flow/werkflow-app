'use client';

// The wipe of the today snapshot a phone keeps (decision record 0010, "Device
// data"). Every sign-out and the organization switch import it statically: in
// a tab open across a deployment a lazy chunk can be gone, and a sign-out that
// waits for it never runs. So it imports nothing and stays small: the menu
// sign-out sits in a chunk every page loads at startup.

/** The IndexedDB database that holds the today snapshot, and nothing else. */
export const TODAY_DATABASE = 'werkflow-today';

/** The localStorage key every tab of the origin sees change on a wipe (its `storage` event included). */
export const TODAY_WIPE_KEY = 'werkflow:today-wiped';

/**
 * The person and organization (`userId:organizationId`) the latest start page in any tab
 * refreshes for. A tab left open on an older one refreshes nothing. A wipe removes it, so no
 * refresh saves again until a start page claims the device anew.
 */
export const TODAY_HOLDER_KEY = 'werkflow:today-holder';

/**
 * One entry per session end that makes its last check for unsent work, owned by its flow and holding
 * the time it began: no tab keeps a clock action while one stands, so the check sees everything the
 * session leaves. The flow lifts only its own entry, on every exit (unsent-work-gate.ts); the wipe
 * that ends a session lifts them all, since its new signal keeps every older page from keeping.
 */
const SESSION_ENDING_PREFIX = 'werkflow:session-ending:';

/** How long an entry whose tab closed mid-check still blocks keeping. */
const SESSION_ENDING_MS = 10 * 60 * 1000;

let sessionEnds = 0;

/** The session-ending entries of every tab, as localStorage keys. */
function sessionEndingKeys(): string[] {
  return Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '').filter(
    (key) => key.startsWith(SESSION_ENDING_PREFIX),
  );
}

/** Puts up this flow's barrier and answers its id, which `endSessionEnd` takes. */
export function beginSessionEnd(): string {
  sessionEnds += 1;
  const flow = `${Date.now()}-${sessionEnds}-${Math.random().toString(36).slice(2)}`;
  try {
    localStorage.setItem(SESSION_ENDING_PREFIX + flow, String(Date.now()));
  } catch {
    // best-effort: without localStorage no tab can keep an action either.
  }
  return flow;
}

/** Lifts this flow's barrier, and no other flow's. */
export function endSessionEnd(flow: string): void {
  try {
    localStorage.removeItem(SESSION_ENDING_PREFIX + flow);
  } catch {
    // best-effort: the entry lapses after SESSION_ENDING_MS.
  }
}

/** Whether a session end in any tab of the origin is making its last check. */
function sessionEnding(): boolean {
  try {
    return sessionEndingKeys().some((key) => {
      const since = Number(localStorage.getItem(key));
      return since > 0 && Date.now() - since < SESSION_ENDING_MS;
    });
  } catch {
    return true;
  }
}

/**
 * Whether a page started under the wipe signal `pageSignal` may keep a new clock action now: the
 * signal is still the shared one, and no session end is making its last check. Every path that
 * keeps a new action asks this (unsent-mark.ts, time-outbox.ts); a take-in of an action kept before
 * does not, since that action was kept already.
 */
export function mayKeepUnder(pageSignal: string): boolean {
  return sharedWipeGeneration() === pageSignal && !sessionEnding();
}

let wipes = 0;

/** A delete queued behind one another tab blocks reports nothing until that one ends; a sign-out never waits on it. */
const WIPE_WAIT_MS = 1_500;

/**
 * Which wipe the device is at, across this tab and every other tab of the
 * origin: a refresh whose answer arrives after another wipe must not keep it.
 */
export function todayWipeGeneration(): string {
  try {
    return `${wipes}:${localStorage.getItem(TODAY_WIPE_KEY) ?? ''}`;
  } catch {
    // best-effort: without localStorage only this tab's wipes count.
    return `${wipes}:`;
  }
}

/**
 * The latest wipe signal any tab of the origin gave, or null when localStorage cannot be read:
 * then no reader can show that what it holds is from after the latest wipe, and none shows it.
 * The stored day (today-store.ts) and the clock's kept actions (unsent-mark.ts) both check it.
 */
export function sharedWipeGeneration(): string | null {
  try {
    return localStorage.getItem(TODAY_WIPE_KEY) ?? '';
  } catch {
    // Fails closed: a reader without the signal shows nothing.
    return null;
  }
}

/**
 * Deletes the today snapshot. It resolves once the browser deleted it, or
 * queued the deletion behind a connection still open in another tab, which
 * closes itself on the version change, and after `WIPE_WAIT_MS` at the
 * latest. It never rejects: a browser without IndexedDB holds no snapshot,
 * and a sign-out must go on. A delete that fails or stays blocked exposes
 * nothing: the store refuses a day saved before the latest wipe signal
 * (today-store.ts).
 */
export function clearTodayOnDevice(): Promise<void> {
  wipes += 1;
  try {
    // The claim goes first: a signal that cannot be written (a full quota) still leaves no reader a day.
    localStorage.removeItem(TODAY_HOLDER_KEY);
    localStorage.setItem(TODAY_WIPE_KEY, `${Date.now()}-${wipes}`);
    for (const key of sessionEndingKeys()) localStorage.removeItem(key);
  } catch {
    // best-effort: other tabs then learn of the wipe only from their next read, which finds no day.
  }
  return new Promise((resolve) => {
    setTimeout(resolve, WIPE_WAIT_MS);
    try {
      const request = indexedDB.deleteDatabase(TODAY_DATABASE);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      // best-effort: without IndexedDB (or where the browser refuses it) nothing was kept, and the sign-out goes on.
      resolve();
    }
  });
}
