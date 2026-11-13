import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test';

import { z } from '@/lib/zod';
import {
  DRAFT_UNSENT_LIMIT_MS,
  changeDraftOnDevice,
  listDraftsOnDevice,
  type DraftHolder,
  type StoredDraft,
} from './draft-store';

// The report drafts as the unsent work a session end asks about (decision record 0010, the
// amendment "a session end asks about report drafts"), against the real device store
// (fake-indexeddb). The session read and the sync handler are stand-ins; every draft here is
// without photos, so no upload runs.

mock.module('@/lib/documents/upload-client', () => ({
  uploadDocumentDirect: () => Promise.reject(new Error('No draft of these tests has a photo.')),
}));
mock.module('@/lib/data/background-read-client', () => ({
  readInBackground: () => Promise.reject(new Error('No draft of these tests loses access by an upload.')),
}));

/** The person of the browser's session; an Error is a session that cannot be read. */
let sessionUserId: string | null | Error = null;
mock.module('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve(
          sessionUserId instanceof Error
            ? { data: { session: null }, error: sessionUserId }
            : {
                data: {
                  session:
                    sessionUserId === null ? null : { user: { id: sessionUserId }, access_token: 'token' },
                },
                error: null,
              },
        ),
    },
  }),
}));

const storage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
});

function isSenderModule(value: unknown): value is typeof import('./draft-sync') {
  return (
    typeof value === 'object' &&
    value !== null &&
    'draftUnsentSource' in value &&
    typeof value.draftUnsentSource === 'object' &&
    'startDraftSync' in value &&
    typeof value.startDraftSync === 'function'
  );
}

/** The sender as a tab of its own loads it: a fresh module with its own holder and queue. */
async function loadTab(name: string): Promise<typeof import('./draft-sync')> {
  const specifier = `./draft-sync?unsent-source=${name}`;
  const loaded: unknown = await import(specifier);
  if (!isSenderModule(loaded)) throw new Error('The tab did not load the sender.');
  return loaded;
}

const { draftUnsentSource, sendDraft, startDraftSync } = await loadTab('page');

const holder: DraftHolder = {
  userId: '9e000000-0000-4000-8000-000000000001',
  organizationId: '9e000000-0000-4000-8000-0000000000a1',
};
const otherPerson: DraftHolder = { ...holder, userId: '9e000000-0000-4000-8000-000000000002' };
const NOW = new Date('2026-11-09T08:00:00.000Z');
const DRAFT_ID = '9e000000-0000-4000-8000-000000000010';

function draft(overrides: Partial<StoredDraft> = {}): StoredDraft {
  return {
    ...holder,
    id: DRAFT_ID,
    revisionId: '9e000000-0000-4000-8000-000000000011',
    operationId: '9e000000-0000-4000-8000-000000000012',
    jobId: '9e000000-0000-4000-8000-000000000020',
    kind: 'work_report',
    visibility: 'internal_only',
    capturedAt: '2026-11-09T07:00:00.000Z',
    title: 'Heizung gewartet',
    content: { performedWork: 'Brenner gereinigt' },
    photos: [],
    ready: true,
    updatedAt: NOW.toISOString(),
    sealed: false,
    refusal: null,
    ...overrides,
  };
}

function save(entry: StoredDraft): Promise<StoredDraft | null> {
  return changeDraftOnDevice(entry, entry.id, () => entry);
}

function stored(owner: DraftHolder = holder): Promise<StoredDraft[]> {
  return listDraftsOnDevice(owner);
}

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('werkflow-drafts', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('drafts', { keyPath: 'id' });
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

/** Writes straight into the draft store: `record` undefined empties it. */
async function writeStore(record?: unknown): Promise<void> {
  const database = await openDraftDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction('drafts', 'readwrite');
    const store = transaction.objectStore('drafts');
    if (record === undefined) store.clear();
    else store.put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

/** Stores a record this version cannot read, as a later release would. */
function saveUnreadable(owner: DraftHolder, id: string): Promise<void> {
  return writeStore({ ...draft({ ...owner, id }), version: 99 });
}

async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 500; turn += 1) {
    if (condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('The condition never held.');
}

const sentSchema = z.object({
  operationId: z.string(),
  organizationId: z.string(),
  payload: z.object({ artifactId: z.string() }),
});
const sent: z.infer<typeof sentSchema>[] = [];
let handlerAnswers: Array<() => Response | Promise<Response>> = [];
const realFetch = globalThis.fetch;
const realWindow: unknown = Reflect.get(globalThis, 'window');

function results(outcome: string, code: string): () => Response {
  return () => Response.json({ results: [{ operationId: 'echo', outcome, code }] });
}

beforeEach(async () => {
  setSystemTime(NOW);
  storage.clear();
  sent.length = 0;
  handlerAnswers = [];
  sessionUserId = null;
  Object.assign(globalThis, {
    window: { addEventListener: () => undefined, removeEventListener: () => undefined },
    fetch: (_url: string, init: RequestInit) => {
      const body = z.object({ operations: z.array(sentSchema) }).parse(JSON.parse(String(init.body)));
      sent.push(...body.operations);
      const answer = handlerAnswers.shift();
      if (!answer) throw new Error('Unexpected request to the sync handler');
      return Promise.resolve(answer());
    },
  });
  // The job page names the holder; its first send finds nothing yet.
  await startDraftSync(holder).send();
});

afterEach(async () => {
  setSystemTime();
  Object.assign(globalThis, { window: realWindow });
  globalThis.fetch = realFetch;
  await writeStore();
});

describe('drafts as unsent work at a session end', () => {
  const NO_ACCESS_ID = '9e000000-0000-4000-8000-000000000040';
  const OTHER_ORGANIZATION_ID = '9e000000-0000-4000-8000-000000000041';
  const COLLEAGUE_ID = '9e000000-0000-4000-8000-000000000060';
  const UNREADABLE_ID = '9e000000-0000-4000-8000-000000000070';
  const otherOrganization: DraftHolder = {
    ...holder,
    organizationId: '9e000000-0000-4000-8000-0000000000a2',
  };

  async function storeEveryone(): Promise<void> {
    await save(
      draft({
        photos: [1, 2].map((index) => ({
          id: `9e000000-0000-4000-8000-00000000003${index}`,
          name: `foto-${index}.jpg`,
          blob: new Blob([`synthetic photo ${index}`], { type: 'image/jpeg' }),
          transferred: null,
          documentId: null,
        })),
      }),
    );
    await save(
      draft({ id: NO_ACCESS_ID, photos: [], refusal: { kind: 'no_access', at: NOW.toISOString() } }),
    );
    await save(
      draft({ ...otherOrganization, id: OTHER_ORGANIZATION_ID, photos: [], title: 'Anderer Betrieb' }),
    );
    await save(draft({ ...otherPerson, id: COLLEAGUE_ID, photos: [], title: 'Kollegin' }));
    await saveUnreadable(holder, UNREADABLE_ID);
  }

  test('the question names each draft by its title, kind, photos and last change, never its text; lost-access and unreadable ones apart', async () => {
    await storeEveryone();
    const items = await draftUnsentSource.summarize('organization');
    expect(items.map(({ label, count, ids }) => ({ label, count, ids }))).toEqual([
      { label: 'Berichtsentwürfe', count: 1, ids: [`draft:${DRAFT_ID}:${NOW.toISOString()}`] },
      {
        label: 'Berichtsentwürfe ohne Zugriff',
        count: 1,
        ids: [`draft:${NO_ACCESS_ID}:${NOW.toISOString()}`],
      },
      {
        label: 'Berichtsentwürfe, die diese App-Version nicht lesen kann',
        count: 1,
        ids: [`draft-unreadable:${UNREADABLE_ID}`],
      },
    ]);
    expect(items.map((item) => item.entries?.map(({ name, detail }) => ({ name, detail })))).toEqual([
      [{ name: 'Heizung gewartet', detail: 'Arbeitsbericht · 2 Fotos · geändert 09.11.2026, 09:00' }],
      [
        {
          name: 'Heizung gewartet',
          detail: 'Kein Zugriff mehr, wird nicht gesendet · Arbeitsbericht · geändert 09.11.2026, 09:00',
        },
      ],
      [{ name: 'Entwurf lässt sich nicht öffnen', detail: 'Nicht lesbar' }],
    ]);
    expect(JSON.stringify(items)).not.toContain('Brenner gereinigt');
  });

  test("a sign-out names the person's drafts of every organization, a switch only the one it leaves, and neither a colleague's", async () => {
    await storeEveryone();
    const names = async (scope: 'session' | 'organization') =>
      (await draftUnsentSource.summarize(scope)).flatMap((item) => item.ids);
    expect(await names('session')).toContain(`draft:${OTHER_ORGANIZATION_ID}:${NOW.toISOString()}`);
    expect(await names('organization')).not.toContain(`draft:${OTHER_ORGANIZATION_ID}:${NOW.toISOString()}`);
    for (const scope of ['session', 'organization'] as const)
      expect((await names(scope)).some((id) => id.includes(COLLEAGUE_ID))).toBe(false);
  });

  test("a tab whose page named nobody asks about the session person's drafts, and fails closed when the session cannot be read", async () => {
    await storeEveryone();
    const tab = await loadTab('without-holder');
    sessionUserId = holder.userId;
    const ids = (await tab.draftUnsentSource.summarize('organization')).flatMap((item) => item.ids);
    // Without a page that names the organization, a switch asks as a sign-out does: more, never less.
    expect(ids).toContain(`draft:${OTHER_ORGANIZATION_ID}:${NOW.toISOString()}`);
    expect(ids.some((id) => id.includes(COLLEAGUE_ID))).toBe(false);
    sessionUserId = otherPerson.userId;
    expect((await tab.draftUnsentSource.summarize('session')).flatMap((item) => item.ids)).toEqual([
      `draft:${COLLEAGUE_ID}:${NOW.toISOString()}`,
    ]);
    sessionUserId = null;
    expect(await tab.draftUnsentSource.summarize('session')).toEqual([]);
    sessionUserId = new Error('The session store did not answer.');
    expect(tab.draftUnsentSource.summarize('session')).rejects.toThrow('The session store did not answer.');
    sessionUserId = null;
  });

  test('„Verwerfen“ deletes only the drafts the question showed: one changed or written since stays and is asked about anew', async () => {
    await storeEveryone();
    const shown = await draftUnsentSource.summarize('session');
    const laterId = '9e000000-0000-4000-8000-000000000080';
    await save(draft({ id: laterId, photos: [], title: 'Danach geschrieben' }));
    const changedAt = new Date(NOW.getTime() + 60_000).toISOString();
    await changeDraftOnDevice(otherOrganization, OTHER_ORGANIZATION_ID, (current) =>
      current ? { ...current, title: 'Danach ergänzt', updatedAt: changedAt } : null,
    );

    await draftUnsentSource.discard(
      'session',
      shown.flatMap((item) => item.ids),
    );

    expect((await draftUnsentSource.summarize('session')).flatMap((item) => item.ids)).toEqual([
      `draft:${laterId}:${NOW.toISOString()}`,
      `draft:${OTHER_ORGANIZATION_ID}:${changedAt}`,
    ]);
    expect((await stored(otherPerson)).map((entry) => entry.id)).toEqual([COLLEAGUE_ID]);
  });

  test("a switch's discard never deletes a shown draft of another organization", async () => {
    await storeEveryone();
    const signOutIds = (await draftUnsentSource.summarize('session')).flatMap((item) => item.ids);
    await draftUnsentSource.discard('organization', signOutIds);
    expect((await stored(otherOrganization)).map((entry) => entry.id)).toEqual([OTHER_ORGANIZATION_ID]);
    expect(await stored()).toEqual([]);
  });

  test('a discard waits for a draft send in flight, so the person is never told a draft is gone that the server then gets', async () => {
    await save(draft({ photos: [] }));
    const shown = await draftUnsentSource.summarize('session');
    let answer = (): void => undefined;
    handlerAnswers = [
      () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(results('accepted', 'accepted')());
        }),
    ];
    const order: string[] = [];
    const sending = sendDraft(holder, DRAFT_ID).then((outcome) => order.push(`send ${outcome}`));
    await until(() => sent.length === 1);
    const discarding = draftUnsentSource
      .discard(
        'session',
        shown.flatMap((item) => item.ids),
      )
      .then(() => order.push('discarded'));
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual([]);
    answer();
    await Promise.all([sending, discarding]);
    expect(order).toEqual(['send sent', 'discarded']);
  });

  test('„Jetzt senden“ sends the person’s drafts, also one unchanged for seven days, and never a lost-access one', async () => {
    const old = new Date(NOW.getTime() - DRAFT_UNSENT_LIMIT_MS - 60_000).toISOString();
    await save(draft({ photos: [], updatedAt: old }));
    await save(
      draft({ id: NO_ACCESS_ID, photos: [], refusal: { kind: 'no_access', at: NOW.toISOString() } }),
    );
    handlerAnswers = [results('accepted', 'accepted')];

    await draftUnsentSource.flush();

    expect(sent.map((operation) => operation.payload.artifactId)).toEqual([DRAFT_ID]);
    expect((await stored()).map((entry) => entry.id)).toEqual([NO_ACCESS_ID]);
  });

  test("„Jetzt senden“ in a tab whose page named nobody sends the session person's drafts, and one the active organization refuses waits unsealed", async () => {
    await save(draft({ photos: [] }));
    await save(draft({ ...otherOrganization, id: OTHER_ORGANIZATION_ID, photos: [] }));
    await save(draft({ ...otherPerson, id: COLLEAGUE_ID, photos: [] }));
    const tab = await loadTab('flush-without-holder');
    sessionUserId = holder.userId;
    handlerAnswers = [results('accepted', 'accepted'), results('rejected', 'organization_mismatch')];

    await tab.draftUnsentSource.flush();
    sessionUserId = null;

    expect(sent.map((operation) => [operation.payload.artifactId, operation.organizationId])).toEqual([
      [DRAFT_ID, holder.organizationId],
      [OTHER_ORGANIZATION_ID, otherOrganization.organizationId],
    ]);
    expect(await stored()).toEqual([]);
    // Nothing of it was outstanding before this send, and the server wrote nothing: it can still change.
    expect((await stored(otherOrganization)).map((entry) => entry.sealed)).toEqual([false]);
    expect((await stored(otherPerson)).length).toBe(1);
  });

  test('a draft whose earlier attach was never answered stays sealed when another organization refuses its resend', async () => {
    await save(draft({ ...otherOrganization, id: OTHER_ORGANIZATION_ID, photos: [], sealed: true }));
    const tab = await loadTab('flush-sealed');
    sessionUserId = holder.userId;
    handlerAnswers = [results('rejected', 'organization_mismatch')];

    await tab.draftUnsentSource.flush();
    sessionUserId = null;

    expect((await stored(otherOrganization)).map((entry) => entry.sealed)).toEqual([true]);
  });
});
