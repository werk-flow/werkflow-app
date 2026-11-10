'use client';

// The wipe of the today snapshot a phone keeps (decision record 0010, "Device
// data"). Every sign-out and the organization switch import it statically: in
// a tab open across a deployment a lazy chunk can be gone, and a sign-out that
// waits for it never runs. So it imports nothing and stays small: the menu
// sign-out sits in a chunk every page loads at startup.

/** The IndexedDB database that holds the today snapshot, and nothing else. */
export const TODAY_DATABASE = 'werkflow-today';

/** The object store in `TODAY_DATABASE` that holds the snapshot record. */
export const TODAY_STORE = 'today';

/** The localStorage key every tab of the origin sees change on a wipe (its `storage` event included). */
export const TODAY_WIPE_KEY = 'werkflow:today-wiped';

/**
 * The person and organization (`userId:organizationId`) the latest start page in any tab
 * refreshes for. A tab left open on an older one refreshes nothing. A wipe removes it, so no
 * refresh saves again until a start page claims the device anew.
 */
export const TODAY_HOLDER_KEY = 'werkflow:today-holder';

let wipes = 0;

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
 * Empties the store in the transaction where the database opens, queued before the delete, so a
 * delete that fails or waits for another tab leaves no record. A device without the database gets
 * none: the open's upgrade is aborted.
 */
function emptyTodayStore(): void {
  const request = indexedDB.open(TODAY_DATABASE);
  request.onupgradeneeded = () => request.transaction?.abort();
  request.onsuccess = () => {
    const database = request.result;
    try {
      database.transaction(TODAY_STORE, 'readwrite').objectStore(TODAY_STORE).clear();
    } catch {
      // best-effort: the delete queued next, and the readers' wipe check, still keep the day from showing.
    }
    database.close();
  };
}

/**
 * Deletes the today snapshot. It resolves once the browser deleted it, or
 * queued the deletion behind a connection still open in another tab, which
 * closes itself on the version change. It never rejects: a browser without
 * IndexedDB holds no snapshot, and a sign-out must go on. A delete that fails
 * or stays blocked exposes nothing: the record is emptied first, and a reader
 * refuses a day saved before the latest wipe signal (today-store.ts).
 */
export function clearTodayOnDevice(): Promise<void> {
  wipes += 1;
  try {
    localStorage.setItem(TODAY_WIPE_KEY, `${Date.now()}-${wipes}`);
    localStorage.removeItem(TODAY_HOLDER_KEY);
  } catch {
    // best-effort: other tabs then learn of the wipe only from their next read, which finds no day.
  }
  return new Promise((resolve) => {
    try {
      emptyTodayStore();
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
