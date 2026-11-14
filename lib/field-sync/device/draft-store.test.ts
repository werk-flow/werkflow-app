import 'fake-indexeddb/auto';

import { afterEach, describe, expect, test } from 'bun:test';

import {
  DRAFT_NO_ACCESS_KEPT_MS,
  changeDraftOnDevice,
  deleteShownDraftsOnDevice,
  listDraftsInScopeOnDevice,
  listDraftsOnDevice,
  sweepExpiredDraftsOnDevice,
  type DraftHolder,
  type StoredDraft,
} from './draft-store';

// The phone keeps report drafts with their photos for one person in one
// organization (decision record 0010, the report draft amendment), in real
// IndexedDB semantics (fake-indexeddb).

const holder: DraftHolder = {
  userId: '9c000000-0000-4000-8000-000000000001',
  organizationId: '9c000000-0000-4000-8000-0000000000a1',
};
const otherPerson: DraftHolder = { ...holder, userId: '9c000000-0000-4000-8000-000000000002' };
const otherOrganization: DraftHolder = { ...holder, organizationId: '9c000000-0000-4000-8000-0000000000a2' };
const NOW = new Date('2026-11-09T08:00:00.000Z');

function draft(overrides: Partial<StoredDraft> = {}): StoredDraft {
  return {
    ...holder,
    id: '9c000000-0000-4000-8000-000000000010',
    revisionId: '9c000000-0000-4000-8000-000000000011',
    operationId: '9c000000-0000-4000-8000-000000000012',
    jobId: '9c000000-0000-4000-8000-000000000020',
    kind: 'work_report',
    visibility: 'internal_only',
    capturedAt: '2026-11-09T07:00:00.000Z',
    title: 'Heizung gewartet',
    content: { performedWork: 'Brenner gereinigt' },
    photos: [
      {
        id: '9c000000-0000-4000-8000-000000000031',
        name: 'foto-1.jpg',
        blob: new Blob(['synthetic photo one'], { type: 'image/jpeg' }),
        transferred: null,
        documentId: null,
      },
    ],
    ready: true,
    updatedAt: '2026-11-09T07:30:00.000Z',
    sealed: false,
    refusal: null,
    ...overrides,
  };
}

function save(entry: StoredDraft): Promise<StoredDraft | null> {
  return changeDraftOnDevice(entry, entry.id, () => entry);
}

/** Empties the draft store between tests, whoever's drafts it holds. */
async function clearDraftStore(): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open('werkflow-drafts', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('drafts', { keyPath: 'id' });
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

/** Stores a record this version cannot read, as a later release would, for `owner`. */
async function saveUnreadable(owner: DraftHolder, id: string): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open('werkflow-drafts', 1);
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put({ ...draft({ ...owner, id }), version: 99 });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

afterEach(clearDraftStore);

describe('report drafts on the device', () => {
  test('a draft and its photo survive a restart: a new connection reads the text and the bytes', async () => {
    await save(draft());
    const [stored] = await listDraftsOnDevice(holder, NOW);
    expect(stored?.title).toBe('Heizung gewartet');
    expect(stored?.content).toEqual({ performedWork: 'Brenner gereinigt' });
    expect(await stored?.photos[0]?.blob.text()).toBe('synthetic photo one');
    expect(stored?.photos[0]?.blob.type).toBe('image/jpeg');
  });

  test('a draft shows only to its person in its organization', async () => {
    await save(draft());
    expect(await listDraftsOnDevice(otherPerson, NOW)).toEqual([]);
    expect(await listDraftsOnDevice(otherOrganization, NOW)).toEqual([]);
    expect((await listDraftsOnDevice(holder, NOW)).length).toBe(1);
  });

  test("another person never reads, changes or deletes a draft, also under the draft's own id", async () => {
    await save(draft());
    let seen: StoredDraft | null | undefined;
    const answer = await changeDraftOnDevice(otherPerson, draft().id, (current) => {
      seen = current;
      return draft({ ...otherPerson, title: 'Überschrieben' });
    });
    expect(seen).toBeUndefined();
    expect(answer).toBeNull();
    await deleteShownDraftsOnDevice(
      { userId: otherPerson.userId, organizationId: null },
      { drafts: new Map([[draft().id, draft().updatedAt]]), unreadable: (entry) => entry.id === draft().id },
    );
    expect((await listDraftsOnDevice(holder, NOW)).map((entry) => entry.title)).toEqual(['Heizung gewartet']);
  });

  test('a change reads and writes in one transaction, and null deletes the draft', async () => {
    await save(draft());
    const changes = ['a', 'b', 'c'].map((suffix) =>
      changeDraftOnDevice(holder, draft().id, (current) =>
        current ? { ...current, title: `${current.title}${suffix}` } : null,
      ),
    );
    await Promise.all(changes);
    expect((await listDraftsOnDevice(holder, NOW))[0]?.title).toBe('Heizung gewartetabc');
    await changeDraftOnDevice(holder, draft().id, () => null);
    expect(await listDraftsOnDevice(holder, NOW)).toEqual([]);
  });

  test('a full disk rejects the write with the QuotaExceededError, and the stored draft stays', async () => {
    await save(draft());
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
    try {
      const failure = await changeDraftOnDevice(holder, draft().id, (current) =>
        current ? { ...current, title: 'Mit drittem Foto' } : null,
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(DOMException);
      expect(failure instanceof DOMException && failure.name).toBe('QuotaExceededError');
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    expect((await listDraftsOnDevice(holder, NOW))[0]?.title).toBe('Heizung gewartet');
  });

  test('a draft refused for lost access stays for seven days, then the phone deletes it, whoever reads', async () => {
    const refusedAt = '2026-11-09T07:45:00.000Z';
    await save(draft({ refusal: { kind: 'no_access', at: refusedAt } }));
    const justBefore = new Date(Date.parse(refusedAt) + DRAFT_NO_ACCESS_KEPT_MS - 1);
    expect((await listDraftsOnDevice(holder, justBefore)).map((entry) => entry.refusal?.kind)).toEqual([
      'no_access',
    ]);
    // Another person opens the phone after the time is over: the first person's draft goes.
    const after = new Date(Date.parse(refusedAt) + DRAFT_NO_ACCESS_KEPT_MS);
    expect(await listDraftsOnDevice(otherPerson, after)).toEqual([]);
    expect(await listDraftsOnDevice(holder, justBefore)).toEqual([]);
  });

  test('an unsent draft that is not refused for lost access is never deleted by time', async () => {
    await save(draft({ refusal: { kind: 'failed', at: '2026-11-09T07:45:00.000Z' } }));
    const muchLater = new Date('2027-03-01T00:00:00.000Z');
    expect((await listDraftsOnDevice(holder, muchLater)).length).toBe(1);
  });
});

describe('the drafts a session end asks about', () => {
  const otherJobDraft = draft({
    id: '9c000000-0000-4000-8000-000000000013',
    updatedAt: '2026-11-09T07:10:00.000Z',
  });
  const otherOrganizationDraft = draft({ ...otherOrganization, id: '9c000000-0000-4000-8000-000000000014' });
  const colleaguesDraft = draft({ ...otherPerson, id: '9c000000-0000-4000-8000-000000000015' });
  const unreadableId = '9c000000-0000-4000-8000-000000000016';
  const colleaguesUnreadableId = '9c000000-0000-4000-8000-000000000017';

  async function storeEveryone(): Promise<void> {
    for (const entry of [draft(), otherJobDraft, otherOrganizationDraft, colleaguesDraft]) await save(entry);
    await saveUnreadable(holder, unreadableId);
    await saveUnreadable(otherPerson, colleaguesUnreadableId);
  }

  test("a sign-out's listing holds the person's drafts of every organization, readable or not, and never a colleague's", async () => {
    await storeEveryone();
    const listed = await listDraftsInScopeOnDevice({ userId: holder.userId, organizationId: null }, NOW);
    expect(listed.drafts.map((entry) => entry.id)).toEqual([
      otherJobDraft.id,
      draft().id,
      otherOrganizationDraft.id,
    ]);
    expect(listed.unreadable.map(({ id, jobId }) => ({ id, jobId }))).toEqual([
      { id: unreadableId, jobId: draft().jobId },
    ]);
  });

  test("a switch's listing holds only the organization it leaves", async () => {
    await storeEveryone();
    const listed = await listDraftsInScopeOnDevice(holder, NOW);
    expect(listed.drafts.map((entry) => entry.id)).toEqual([otherJobDraft.id, draft().id]);
    expect(listed.unreadable.map((entry) => entry.id)).toEqual([unreadableId]);
    const elsewhere = await listDraftsInScopeOnDevice(otherOrganization, NOW);
    expect(elsewhere.drafts.map((entry) => entry.id)).toEqual([otherOrganizationDraft.id]);
    expect(elsewhere.unreadable).toEqual([]);
  });

  test('a discard deletes exactly the shown drafts in the state they were shown, and nothing else', async () => {
    await storeEveryone();
    // Changed after the question opened: the person never saw this text.
    await changeDraftOnDevice(holder, otherJobDraft.id, (current) =>
      current ? { ...current, title: 'Später ergänzt', updatedAt: '2026-11-09T07:50:00.000Z' } : null,
    );
    await deleteShownDraftsOnDevice(
      { userId: holder.userId, organizationId: null },
      {
        drafts: new Map([
          [draft().id, draft().updatedAt],
          [otherJobDraft.id, otherJobDraft.updatedAt],
          // A colleague's draft id among the shown ones is never the person's to delete.
          [colleaguesDraft.id, colleaguesDraft.updatedAt],
        ]),
        unreadable: (entry) => [unreadableId, colleaguesUnreadableId].includes(entry.id),
      },
    );
    const left = await listDraftsInScopeOnDevice({ userId: holder.userId, organizationId: null }, NOW);
    expect(left.drafts.map((entry) => [entry.id, entry.title])).toEqual([
      [otherOrganizationDraft.id, 'Heizung gewartet'],
      [otherJobDraft.id, 'Später ergänzt'],
    ]);
    expect(left.unreadable).toEqual([]);
    expect(
      (await listDraftsInScopeOnDevice({ userId: otherPerson.userId, organizationId: null }, NOW)).drafts,
    ).toEqual([colleaguesDraft]);
    const colleagues = await listDraftsInScopeOnDevice(otherPerson, NOW);
    expect(colleagues.unreadable.map((entry) => entry.id)).toEqual([colleaguesUnreadableId]);
  });

  test("a switch's discard never deletes a shown draft of another organization", async () => {
    await storeEveryone();
    await deleteShownDraftsOnDevice(holder, {
      drafts: new Map([[otherOrganizationDraft.id, otherOrganizationDraft.updatedAt]]),
      unreadable: () => false,
    });
    expect((await listDraftsInScopeOnDevice(otherOrganization, NOW)).drafts).toEqual([
      otherOrganizationDraft,
    ]);
  });
});

describe('the end of a lost-access draft, whoever starts the app next', () => {
  // The localStorage key without a person that says the phone may hold drafts (draft-expiry.ts).
  const DEVICE_MARK = 'werkflow:drafts-on-device';
  const storage = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  });
  const expiredId = '9c000000-0000-4000-8000-000000000060';

  test("the sweep deletes another person's lost-access draft past seven days and leaves every live draft", async () => {
    storage.clear();
    const lostAt = new Date(NOW.getTime() - DRAFT_NO_ACCESS_KEPT_MS).toISOString();
    await save(draft({ id: expiredId, refusal: { kind: 'no_access', at: lostAt } }));
    await save(draft());
    expect(storage.get(DEVICE_MARK)).toBe('1');

    await sweepExpiredDraftsOnDevice(NOW);

    expect(await listDraftsOnDevice(holder, new Date(0))).toEqual([draft()]);
    expect(await listDraftsOnDevice(otherPerson, new Date(0))).toEqual([]);
    expect(storage.get(DEVICE_MARK)).toBe('1');
  });

  test('the device mark is set with the first draft and goes with the last one', async () => {
    storage.clear();
    await save(draft());
    expect(storage.get(DEVICE_MARK)).toBe('1');
    await changeDraftOnDevice(holder, draft().id, () => null);
    // The mark goes once a fresh count after the commit finds no draft.
    for (let turn = 0; turn < 100 && storage.has(DEVICE_MARK); turn += 1)
      await new Promise((resolve) => setImmediate(resolve));
    expect(storage.has(DEVICE_MARK)).toBe(false);
  });
});

describe('the device mark follows only what the store committed', () => {
  /**
   * Runs a sweep of an expired draft while the commit handling of one of its transactions waits
   * until another tab stored a draft: the first transaction `pick` accepts. Answers the mark as it
   * stands right after, before any further read of the store counts again.
   */
  async function sweepWhileAnotherTabStores(pick: (transaction: IDBTransaction) => boolean) {
    const storage = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
    const lostAt = new Date(NOW.getTime() - DRAFT_NO_ACCESS_KEPT_MS).toISOString();
    await save(draft({ refusal: { kind: 'no_access', at: lostAt } }));
    const listen = IDBTransaction.prototype.addEventListener;
    const transact = IDBDatabase.prototype.transaction;
    let armed = true;
    let otherTab: Promise<unknown> | null = null;
    const delayed: Array<() => void> = [];
    /** Holds a commit handler of the picked transaction until another tab stored a draft. */
    const hold = (run: () => void): void => {
      delayed.push(run);
      otherTab ??= save(draft({ id: '9c000000-0000-4000-8000-000000000070' })).then(() => {
        for (const each of delayed) each();
      });
    };
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const transaction = transact.apply(this, args);
      // The first transaction `pick` accepts carries a flag: its commit handling waits.
      if (armed && pick(transaction)) {
        armed = false;
        Reflect.set(transaction, 'delayedCommit', true);
        let handler: ((event: Event) => void) | null = null;
        Object.defineProperty(transaction, 'oncomplete', {
          configurable: true,
          get: () => handler,
          set: (next: (event: Event) => void) => {
            handler = next;
            listen.call(transaction, 'complete', (event: Event) => hold(() => next.call(transaction, event)));
          },
        });
      }
      return transaction;
    };
    IDBTransaction.prototype.addEventListener = function (
      this: IDBTransaction,
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (
        type !== 'complete' ||
        typeof listener !== 'function' ||
        Reflect.get(this, 'delayedCommit') !== true
      )
        return listen.call(this, type, listener, options);
      return listen.call(this, type, (event: Event) => hold(() => listener(event)), options);
    };
    try {
      const sweeping = sweepExpiredDraftsOnDevice(NOW);
      for (let turn = 0; turn < 50 && otherTab === null; turn += 1)
        await new Promise((resolve) => setImmediate(resolve));
      await otherTab;
      await sweeping;
      for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    } finally {
      IDBTransaction.prototype.addEventListener = listen;
      IDBDatabase.prototype.transaction = transact;
    }
    return storage.get('werkflow:drafts-on-device');
  }

  test("a sweep whose complete handling runs only after another tab stored a draft keeps that tab's mark", async () => {
    expect(await sweepWhileAnotherTabStores((transaction) => transaction.mode === 'readwrite')).toBe('1');
    expect(await listDraftsOnDevice(holder, new Date(0))).toHaveLength(1);
  });

  test('a sweep removes the mark while its fresh count still keeps writers out, never after that count committed', async () => {
    const storage = new Map<string, string>();
    const transact = IDBDatabase.prototype.transaction;
    let freshCount: IDBTransaction | null = null;
    let freshCountCommitted = false;
    const removedAfterCommit: boolean[] = [];
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => {
          removedAfterCommit.push(freshCountCommitted);
          storage.delete(key);
        },
      },
    });
    const lostAt = new Date(NOW.getTime() - DRAFT_NO_ACCESS_KEPT_MS).toISOString();
    await save(draft({ refusal: { kind: 'no_access', at: lostAt } }));
    // Earlier tests' cleanup may still be counting: let it finish before anything is noted.
    for (let turn = 0; turn < 50; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    removedAfterCommit.length = 0;
    storage.set('werkflow:drafts-on-device', '1');
    // A read-only transaction after the sweep is its fresh count; note when that count commits.
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const transaction = transact.apply(this, args);
      if (freshCount === null && transaction.mode === 'readonly') {
        freshCount = transaction;
        transaction.addEventListener('complete', () => {
          freshCountCommitted = true;
        });
      }
      return transaction;
    };
    try {
      await sweepExpiredDraftsOnDevice(NOW);
      for (let turn = 0; turn < 50 && storage.has('werkflow:drafts-on-device'); turn += 1)
        await new Promise((resolve) => setImmediate(resolve));
    } finally {
      IDBDatabase.prototype.transaction = transact;
    }
    expect(storage.has('werkflow:drafts-on-device')).toBe(false);
    expect(removedAfterCommit).toEqual([false]);
  });

  test('a sweep whose transaction aborts after it deleted the last draft keeps the mark', async () => {
    const storage = new Map<string, string>();
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
    const lostAt = new Date(NOW.getTime() - DRAFT_NO_ACCESS_KEPT_MS).toISOString();
    await save(draft({ refusal: { kind: 'no_access', at: lostAt } }));
    expect(storage.get('werkflow:drafts-on-device')).toBe('1');

    // The transaction aborts after the sweep counted what remains: nothing was deleted.
    const count = IDBObjectStore.prototype.count;
    IDBObjectStore.prototype.count = function (this: IDBObjectStore, query?: IDBValidKey | IDBKeyRange) {
      const request = count.call(this, query);
      // After every success listener of the count ran, before the transaction commits.
      request.addEventListener('success', () => queueMicrotask(() => this.transaction.abort()));
      return request;
    };
    try {
      await sweepExpiredDraftsOnDevice(NOW).catch(() => 'aborted');
    } finally {
      IDBObjectStore.prototype.count = count;
    }
    // Read the mark before any further read of the store, which counts again.
    expect(storage.get('werkflow:drafts-on-device')).toBe('1');
    expect(await listDraftsOnDevice(holder, new Date(0))).toHaveLength(1);
  });
});
