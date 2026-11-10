import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';

import type { FieldSyncToday } from '@/lib/field-sync/today-snapshot';
import { keepTodayFresh } from './today-refresh';
import { claimToday, refreshTodayOnDevice, type TodayHolder } from './today-sync';
import { readTodayOnDevice, saveTodayOnDevice } from './today-store';
import {
  TODAY_DATABASE,
  TODAY_HOLDER_KEY,
  TODAY_WIPE_KEY,
  clearTodayOnDevice,
  todayWipeGeneration,
} from './today-wipe';

/** localStorage, shared by every tab of an origin: the stand-in for another tab's wipe signal. */
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
globalThis.localStorage = new MemoryStorage();

/** How long a wipe waits for a delete that reports nothing (today-wipe.ts). */
const WIPE_WAIT_MS = 1_500;

/** What a sign-out in another tab does to this device: the shared signal and the deleted database. */
let otherTabWipes = 0;
async function wipeFromAnotherTab(): Promise<void> {
  otherTabWipes += 1;
  localStorage.setItem(TODAY_WIPE_KEY, `another-tab-${otherTabWipes}`);
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(TODAY_DATABASE);
    request.onsuccess = () => resolve();
  });
}

/** Lets queued tasks and IndexedDB events run until the condition holds; no clock is involved. */
async function until(condition: () => Promise<boolean> | boolean): Promise<void> {
  for (let turn = 0; turn < 500; turn += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('The condition never held.');
}

/** Lets every queued task and IndexedDB event run; no clock is involved. */
async function letQueuedWorkRun(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** A 200 whose body arrives only after `beforeBody` ran: a wipe that lands while the answer streams in. */
function slowBody(body: unknown, beforeBody: () => Promise<void>): Response {
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        await beforeBody();
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
}

// The phone keeps one snapshot of the current Berlin day for the signed-in
// person and organization (decision record 0010, "Device data"), in real
// IndexedDB semantics (fake-indexeddb).

const MORNING = new Date('2026-11-09T06:42:00.000Z'); // 07:42 in Berlin
const NEXT_DAY = new Date('2026-11-09T23:30:00.000Z'); // 00:30 on 10 November in Berlin
const holder: TodayHolder = {
  userId: '9a000000-0000-4000-8000-000000000001',
  organizationId: '9a000000-0000-4000-8000-0000000000a1',
};

function snapshot(overrides: Partial<FieldSyncToday> = {}): FieldSyncToday {
  return {
    version: 'v1',
    berlinDate: '2026-11-09',
    validUntil: '2026-11-09T23:00:00.000Z',
    ...holder,
    assignments: [
      {
        jobId: '9a000000-0000-4000-8000-000000000021',
        jobNumber: 'AUF-2026-21',
        title: 'Heizung tauschen',
        requestedOutcome: null,
        plannedWorkingMinutes: null,
        visits: [{ startAt: '2026-11-09T07:00:00.000Z', endAt: '2026-11-09T09:00:00.000Z' }],
        customerName: 'Familie Muster',
        customerPhone: null,
        siteName: 'Wohnhaus',
        siteAddress: 'Musterweg 1, 10115 Berlin',
        accessNotes: null,
        contactName: null,
        contactRole: null,
        contactPhone: null,
        project: null,
        instructions: [],
      },
    ],
    ...overrides,
  };
}

async function databaseNames(): Promise<string[]> {
  return (await indexedDB.databases()).flatMap((info) => (info.name ? [info.name] : []));
}

/** A fetch that answers once with the given response and records the request. */
function answer(response: Response | Error) {
  const requests: Request[] = [];
  const send = async (url: string, init: RequestInit): Promise<Response> => {
    requests.push(new Request(new URL(url, 'http://localhost'), init));
    if (response instanceof Error) throw response;
    return response;
  };
  return { send, requests };
}

// A start page claimed the device for this person and organization (keepTodayFresh).
beforeEach(() => {
  claimToday(holder);
});

afterEach(async () => {
  await clearTodayOnDevice();
  localStorage.clear();
});

describe('the today snapshot on the device', () => {
  test('a saved snapshot of today reads back with the time the server confirmed it', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    expect(await readTodayOnDevice(MORNING)).toEqual({
      snapshot: snapshot(),
      confirmedAt: MORNING.toISOString(),
      wipeGeneration: '',
    });
  });

  test('a sign-out empties the store: no snapshot and no database remain', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    await clearTodayOnDevice();
    expect(await databaseNames()).not.toContain(TODAY_DATABASE);
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test('a sign-out whose delete fails leaves no day to show, and the sign-out goes on', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    const realDelete = indexedDB.deleteDatabase.bind(indexedDB);
    indexedDB.deleteDatabase = () => {
      throw new DOMException('The browser refused the deletion.', 'UnknownError');
    };
    try {
      await clearTodayOnDevice();
    } finally {
      indexedDB.deleteDatabase = realDelete;
    }
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test('a wipe in another tab whose delete failed leaves a day this tab refuses to show', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    // The other tab signalled its wipe, and its delete never ran.
    localStorage.setItem(TODAY_WIPE_KEY, 'another-tab-failed-delete');
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test('a sign-out whose delete stays blocked leaves a day the store refuses, and the sign-out goes on', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    // The delete waits forever behind a connection another tab never closes: it is aimed at a held
    // stand-in database, so the snapshot's database stays exactly as a blocked delete leaves it.
    const held = `${TODAY_DATABASE}-held`;
    const opened = indexedDB.open(held);
    const blocker = await new Promise<IDBDatabase>((resolve) => {
      opened.onsuccess = () => resolve(opened.result);
    });
    const realDelete = indexedDB.deleteDatabase.bind(indexedDB);
    indexedDB.deleteDatabase = () => realDelete(held);
    try {
      await clearTodayOnDevice();
    } finally {
      indexedDB.deleteDatabase = realDelete;
    }
    expect(await databaseNames()).toContain(TODAY_DATABASE);
    expect(await readTodayOnDevice(MORNING)).toBeNull();
    blocker.close();
  });

  test('a second sign-out whose delete queues behind a blocked one and reports nothing still goes on', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    // Both deletes aim at a held stand-in database. The first is blocked by a connection another tab
    // never closes; the second queues behind it and gets no event of its own until the first ends.
    const held = `${TODAY_DATABASE}-held`;
    const opened = indexedDB.open(held);
    const blocker = await new Promise<IDBDatabase>((resolve) => {
      opened.onsuccess = () => resolve(opened.result);
    });
    const realDelete = indexedDB.deleteDatabase.bind(indexedDB);
    indexedDB.deleteDatabase = () => realDelete(held);
    try {
      await clearTodayOnDevice();
      jest.useFakeTimers();
      let signedOut = false;
      void clearTodayOnDevice().then(() => {
        signedOut = true;
      });
      jest.advanceTimersByTime(WIPE_WAIT_MS - 1);
      await until(() => true);
      expect(signedOut).toBe(false);
      jest.advanceTimersByTime(1);
      await until(() => signedOut);
    } finally {
      jest.useRealTimers();
      indexedDB.deleteDatabase = realDelete;
      blocker.close();
    }
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test('a wipe that lands right after a save passed its check leaves a day the store refuses', async () => {
    const saved = await saveTodayOnDevice(snapshot(), MORNING, () => {
      // The check passes; another tab's wipe signal lands before the record is stamped.
      localStorage.setItem(TODAY_WIPE_KEY, 'another-tab-sign-out');
      return true;
    });
    expect(saved).toBe(true);
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test('a sign-out whose signal cannot be written and whose delete fails leaves no day to show', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    const writeSignal = localStorage.setItem.bind(localStorage);
    const realDelete = indexedDB.deleteDatabase.bind(indexedDB);
    localStorage.setItem = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    indexedDB.deleteDatabase = () => {
      throw new DOMException('The browser refused the deletion.', 'UnknownError');
    };
    try {
      await clearTodayOnDevice();
    } finally {
      localStorage.setItem = writeSignal;
      indexedDB.deleteDatabase = realDelete;
    }
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test('a device whose wipe signal cannot be read shows no stored day', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    const readSignal = localStorage.getItem.bind(localStorage);
    localStorage.getItem = () => {
      throw new DOMException('The storage is not available.', 'SecurityError');
    };
    try {
      expect(await readTodayOnDevice(MORNING)).toBeNull();
    } finally {
      localStorage.getItem = readSignal;
    }
  });

  test('a day that has ended is dropped at its first read after Berlin midnight, not shown', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    expect(await readTodayOnDevice(NEXT_DAY)).toBeNull();
    // The record is gone, not merely hidden: an earlier clock still finds nothing.
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test("the day's rollover in one tab never deletes the new day another tab saves at the same time", async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    const nextDay = snapshot({ berlinDate: '2026-11-10', validUntil: '2026-11-10T23:00:00.000Z' });
    const [rolledOver] = await Promise.all([
      readTodayOnDevice(NEXT_DAY),
      saveTodayOnDevice(nextDay, NEXT_DAY),
    ]);
    expect(rolledOver).toBeNull();
    expect((await readTodayOnDevice(NEXT_DAY))?.snapshot.berlinDate).toBe('2026-11-10');
  });

  test('a record this version cannot read is dropped, never shown', async () => {
    await saveTodayOnDevice({ ...snapshot(), assignments: [] }, MORNING);
    const request = indexedDB.open(TODAY_DATABASE, 1);
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const written = database.transaction('today', 'readwrite');
    written.objectStore('today').put({ snapshot: { version: 'v0' }, confirmedAt: 'gestern' }, 'current');
    await new Promise((resolve) => {
      written.oncomplete = resolve;
    });
    database.close();
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });
});

describe('refreshing the today snapshot', () => {
  // The start page claims the device before it refreshes (keepTodayFresh).
  beforeEach(() => {
    claimToday(holder);
  });

  test('a new snapshot is saved; the request names the organization and passes the same-origin guard', async () => {
    const { send, requests } = answer(Response.json(snapshot()));
    expect(await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING })).toBe('saved');
    expect(new URL(requests[0]?.url ?? '').searchParams.get('organizationId')).toBe(holder.organizationId);
    expect(requests[0]?.headers.get('content-type')).toBe('application/json');
    expect(requests[0]?.headers.get('if-none-match')).toBeNull();
    expect((await readTodayOnDevice(MORNING))?.snapshot).toEqual(snapshot());
  });

  test('an unchanged day is confirmed by its version and moves the „Stand“', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    const later = new Date(MORNING.getTime() + 3_600_000);
    const { send, requests } = answer(new Response(null, { status: 304 }));
    expect(await refreshTodayOnDevice(holder, { fetch: send, now: () => later })).toBe('confirmed');
    expect(requests[0]?.headers.get('if-none-match')).toBe('"v1"');
    expect((await readTodayOnDevice(later))?.confirmedAt).toBe(later.toISOString());
  });

  test('without signal or with a failing server the stored day stays, with its old „Stand“', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    for (const response of [new TypeError('Failed to fetch'), new Response(null, { status: 503 })]) {
      const { send } = answer(response);
      expect(await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING })).toBe('kept');
      expect((await readTodayOnDevice(MORNING))?.confirmedAt).toBe(MORNING.toISOString());
    }
  });

  test('an answer that is not a readable day, such as a captive portal or a cut-off body, keeps the stored day', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    const cutOff = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"version":"v2","assign'));
          controller.error(new TypeError('network connection was lost'));
        },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
    const portal = new Response('<html><body>WLAN-Anmeldung</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    for (const response of [portal, cutOff]) {
      const { send } = answer(response);
      expect(await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING })).toBe('kept');
      expect((await readTodayOnDevice(MORNING))?.snapshot).toEqual(snapshot());
    }
  });

  test('a refused person or organization leaves nothing on the device', async () => {
    for (const code of ['forbidden', 'organization_mismatch']) {
      await saveTodayOnDevice(snapshot(), MORNING);
      claimToday(holder);
      const { send } = answer(Response.json({ outcome: 'rejected', code }, { status: 403 }));
      expect(await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING }), code).toBe('cleared');
      expect(await readTodayOnDevice(MORNING), code).toBeNull();
    }
  });

  test('the answer’s outcome decides, not its status: a retry, an invalid request or an unreadable refusal keeps the day', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    for (const response of [
      Response.json({ outcome: 'retry', code: 'unavailable' }, { status: 403 }),
      Response.json({ outcome: 'retry', code: 'unauthenticated' }, { status: 401 }),
      Response.json({ outcome: 'rejected', code: 'invalid' }, { status: 400 }),
      new Response('<html><body>Forbidden</body></html>', { status: 403 }),
    ]) {
      const { send } = answer(response);
      expect(
        await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING }),
        String(response.status),
      ).toBe('kept');
      expect((await readTodayOnDevice(MORNING))?.snapshot, String(response.status)).toEqual(snapshot());
    }
  });

  test("another person's day is deleted before this person's is fetched, and a snapshot for someone else is not saved", async () => {
    const otherPerson = { ...holder, userId: '9a000000-0000-4000-8000-000000000002' };
    await saveTodayOnDevice(snapshot(otherPerson), MORNING);
    const { send, requests } = answer(Response.json(snapshot(otherPerson)));
    expect(await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING })).toBe('kept');
    expect(requests[0]?.headers.get('if-none-match')).toBeNull();
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test('a wipe while the device reads its stored day wins: the refresh saves nothing', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    const { send } = answer(Response.json(snapshot({ version: 'v2' })));
    const refresh = refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING });
    const wiped = wipeFromAnotherTab();
    expect(await refresh).toBe('superseded');
    await wiped;
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test('an ended day in storage does not stop the new day from being saved', async () => {
    await saveTodayOnDevice(snapshot(), MORNING);
    const nextDay = snapshot({ berlinDate: '2026-11-10', validUntil: '2026-11-10T23:00:00.000Z' });
    const { send } = answer(Response.json(nextDay));
    expect(await refreshTodayOnDevice(holder, { fetch: send, now: () => NEXT_DAY })).toBe('saved');
    expect((await readTodayOnDevice(NEXT_DAY))?.snapshot.berlinDate).toBe('2026-11-10');
  });

  test("a tab left on an older organization neither deletes nor replaces the newer start page's day", async () => {
    const newer = { ...holder, organizationId: '9a000000-0000-4000-8000-0000000000b1' };
    localStorage.setItem(TODAY_HOLDER_KEY, `${newer.userId}:${newer.organizationId}`);
    await saveTodayOnDevice(snapshot(newer), MORNING);
    const { send, requests } = answer(
      Response.json({ outcome: 'rejected', code: 'organization_mismatch' }, { status: 403 }),
    );
    expect(await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING })).toBe('superseded');
    expect(requests).toEqual([]);
    expect((await readTodayOnDevice(MORNING))?.snapshot.organizationId).toBe(newer.organizationId);
  });

  test("a sign-out while the refresh removes another person's day ends the refresh: nothing is saved", async () => {
    const otherPerson = { ...holder, userId: '9a000000-0000-4000-8000-000000000002' };
    await saveTodayOnDevice(snapshot(otherPerson), MORNING);
    const realDeleteDatabase = indexedDB.deleteDatabase.bind(indexedDB);
    const realDelete = IDBObjectStore.prototype.delete;
    let signedOut: Promise<void> | null = null;
    // Whichever way the refresh removes the other day, the sign-out's wipe lands during that cleanup.
    const signOutOnce = (): void => {
      signedOut ??= clearTodayOnDevice();
    };
    indexedDB.deleteDatabase = (name: string) => {
      const request = realDeleteDatabase(name);
      signOutOnce();
      return request;
    };
    IDBObjectStore.prototype.delete = function remove(
      this: IDBObjectStore,
      query: IDBValidKey | IDBKeyRange,
    ) {
      const request = realDelete.call(this, query);
      signOutOnce();
      return request;
    };
    let outcome: string;
    try {
      const { send } = answer(Response.json(snapshot()));
      outcome = await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING });
      await signedOut;
      await letQueuedWorkRun();
    } finally {
      indexedDB.deleteDatabase = realDeleteDatabase;
      IDBObjectStore.prototype.delete = realDelete;
    }
    expect(outcome).toBe('superseded');
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test("a stale save deletes nothing of its own: only the other tab's wipe deletes, and that tab's newer day stays", async () => {
    const newer = { ...holder, organizationId: '9a000000-0000-4000-8000-0000000000b1' };
    const realPut = IDBObjectStore.prototype.put;
    const realDelete = indexedDB.deleteDatabase.bind(indexedDB);
    let deletions = 0;
    let newerSaved: Promise<boolean> | null = null;
    indexedDB.deleteDatabase = (name: string) => {
      deletions += 1;
      return realDelete(name);
    };
    // Right after this refresh queues its write, another tab switches the organization and saves its day.
    IDBObjectStore.prototype.put = function put(this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = realPut.call(this, value, key);
      newerSaved ??= wipeFromAnotherTab().then(() => {
        claimToday(newer);
        return saveTodayOnDevice(snapshot(newer), MORNING);
      });
      return request;
    };
    try {
      const { send } = answer(Response.json(snapshot()));
      await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING });
      await newerSaved;
      await letQueuedWorkRun();
    } finally {
      IDBObjectStore.prototype.put = realPut;
      indexedDB.deleteDatabase = realDelete;
    }
    // A cleanup by the stale refresh could land after the newer day and delete it.
    expect(deletions).toBe(1);
    expect((await readTodayOnDevice(MORNING))?.snapshot.organizationId).toBe(newer.organizationId);
  });

  test('a wipe while the answer streams in wins: its body is not saved', async () => {
    const { send } = answer(slowBody(snapshot(), clearTodayOnDevice));
    expect(await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING })).toBe('superseded');
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test("a sign-out in another tab wins over this tab's refresh: neither a new nor a confirmed day is saved", async () => {
    const { send } = answer(slowBody(snapshot(), wipeFromAnotherTab));
    expect(await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING })).toBe('superseded');
    expect(await readTodayOnDevice(MORNING)).toBeNull();
    await saveTodayOnDevice(snapshot(), MORNING);
    claimToday(holder);
    const confirm = async (): Promise<Response> => {
      await wipeFromAnotherTab();
      return new Response(null, { status: 304 });
    };
    expect(await refreshTodayOnDevice(holder, { fetch: confirm, now: () => MORNING })).toBe('superseded');
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test('a wipe while the request runs wins: its answer is not saved', async () => {
    const send = async (): Promise<Response> => {
      await clearTodayOnDevice();
      return Response.json(snapshot());
    };
    expect(await refreshTodayOnDevice(holder, { fetch: send, now: () => MORNING })).toBe('superseded');
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });
});

describe('keeping the day fresh while the app is open', () => {
  const otherOrganization = { ...holder, organizationId: '9a000000-0000-4000-8000-0000000000b1' };
  const requested: string[] = [];
  const realFetch = globalThis.fetch;

  function installBrowser(answerFor: (organizationId: string) => Promise<Response>): void {
    const listeners = { addEventListener: () => undefined };
    Object.assign(globalThis, {
      window: { ...listeners, matchMedia: () => ({ matches: false }) },
      fetch: async (url: string) => {
        const organizationId = new URL(url, 'http://localhost').searchParams.get('organizationId') ?? '';
        requested.push(organizationId);
        return answerFor(organizationId);
      },
    });
  }

  afterEach(() => {
    globalThis.fetch = realFetch;
    requested.length = 0;
  });

  test("an organization switch during a refresh still refreshes the new organization's day", async () => {
    let releaseFirst = (): void => undefined;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    installBrowser(async (organizationId) => {
      if (organizationId === holder.organizationId) await firstHeld;
      return Response.json(snapshot({ organizationId }));
    });
    const failures: unknown[] = [];
    keepTodayFresh(holder, (retry) => failures.push(retry), todayWipeGeneration());
    await until(() => requested.length === 1);
    await clearTodayOnDevice();
    keepTodayFresh(otherOrganization, (retry) => failures.push(retry), todayWipeGeneration());
    releaseFirst();
    await until(
      async () =>
        (await readTodayOnDevice(MORNING))?.snapshot.organizationId === otherOrganization.organizationId,
    );
    expect(requested).toEqual([holder.organizationId, otherOrganization.organizationId]);
    expect(failures).toEqual([]);
  });

  test('a sign-out while the start page loads the refresh code keeps that page from claiming or refreshing', async () => {
    installBrowser(async (organizationId) => Response.json(snapshot({ organizationId })));
    const generationAtStart = todayWipeGeneration();
    // The sign-out wipes, then waits for the session to end; meanwhile the import resolves.
    await clearTodayOnDevice();
    keepTodayFresh(holder, () => undefined, generationAtStart);
    await letQueuedWorkRun();
    expect(requested).toEqual([]);
    expect(localStorage.getItem(TODAY_HOLDER_KEY)).toBeNull();
    expect(await readTodayOnDevice(MORNING)).toBeNull();
  });

  test('a sign-out during a refresh leaves no day, even though the session still answered', async () => {
    let releaseFirst = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    installBrowser(async (organizationId) => {
      await held;
      return Response.json(snapshot({ organizationId }));
    });
    keepTodayFresh(holder, () => undefined, todayWipeGeneration());
    await until(() => requested.length === 1);
    // The sign-out wipes first and ends the session afterwards: the held answer still arrives.
    await clearTodayOnDevice();
    releaseFirst();
    await letQueuedWorkRun();
    expect(await readTodayOnDevice(MORNING)).toBeNull();
    expect(requested).toEqual([holder.organizationId]);
  });

  test('a captive portal answering the refresh shows no storage failure: the banner is for the device alone', async () => {
    installBrowser(
      async () =>
        new Response('<html><body>WLAN-Anmeldung</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    const failures: unknown[] = [];
    keepTodayFresh(holder, (retry) => failures.push(retry), todayWipeGeneration());
    await until(() => requested.length === 1);
    await letQueuedWorkRun();
    expect(failures).toEqual([]);
  });

  test('a day the device cannot store reaches the person with a retry, not only the log', async () => {
    installBrowser(async (organizationId) => Response.json(snapshot({ organizationId })));
    const realOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    const retries: Array<() => void> = [];
    try {
      keepTodayFresh(holder, (retry) => retries.push(retry), todayWipeGeneration());
      await until(() => retries.length === 1);
    } finally {
      indexedDB.open = realOpen;
    }
    retries[0]?.();
    await until(async () => (await readTodayOnDevice(MORNING))?.snapshot.version === 'v1');
  });
});
