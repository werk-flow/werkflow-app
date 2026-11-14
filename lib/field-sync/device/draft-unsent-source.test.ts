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
import { TODAY_WIPE_KEY } from './today-wipe';

// The report drafts as the unsent work a session end asks about (decision record 0010, the
// amendment "a session end asks about report drafts"), against the real device store
// (fake-indexeddb). The session read, the photo upload, the job access read and the sync handler
// are stand-ins.

/** What the photo upload answers; null when a test expects none. */
let uploadAnswer: { status: 'failed'; reason: string; transferred: null } | null = null;
/** How many photo uploads started: each asks the server for an upload ticket first. */
let uploadsStarted = 0;
let accessReads = 0;
mock.module('@/lib/documents/upload-client', () => ({
  uploadDocumentDirect: () => {
    uploadsStarted += 1;
    return uploadAnswer
      ? Promise.resolve(uploadAnswer)
      : Promise.reject(new Error('Unexpected photo upload'));
  },
}));
mock.module('@/lib/data/background-read-client', () => ({
  readInBackground: () => {
    accessReads += 1;
    // The active organization's reader: another organization's job is out of its reach.
    return Promise.resolve({ success: false, error: 'not_authorized' });
  },
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

const { DRAFT_SEND_BUSY, sendDraft, startDraftSync, whileNoDraftSend } = await import('./draft-sync');
const { UnsentWorkBusyError } = await import('./unsent-work');
const { draftUnsentSource } = await import('./draft-unsent-source');

/**
 * Another tab's sign-out or sign-in page wrote the wipe signal: this tab's page no longer names
 * whose drafts it holds, as on a page that never named one, so a session end reads the session.
 */
function pageHoldsNobody(): void {
  storage.set(TODAY_WIPE_KEY, 'another-tab-wiped');
}

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
function saveUnreadable(owner: DraftHolder, id: string, overrides: Partial<StoredDraft> = {}): Promise<void> {
  return writeStore({ ...draft({ ...owner, id, ...overrides }), version: 99 });
}

/**
 * Fires the drafts' turn bound by hand while `run` waits for it: the code under test sets the one
 * timer, so a send that never answers holds the turn past it without a real wait.
 */
async function passTurnBound<T>(start: () => Promise<T>): Promise<T> {
  const realSetTimeout = globalThis.setTimeout;
  const wait: { end: (() => void) | null } = { end: null };
  Object.assign(globalThis, {
    setTimeout: (run: () => void) => {
      wait.end = run;
      return realSetTimeout(() => undefined, 0);
    },
  });
  try {
    const running = start();
    await until(() => wait.end !== null);
    wait.end?.();
    return await running;
  } finally {
    Object.assign(globalThis, { setTimeout: realSetTimeout });
  }
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
  uploadAnswer = null;
  uploadsStarted = 0;
  accessReads = 0;
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
        // The record's id and its version: a rewrite under the id is asked about anew.
        ids: [expect.stringMatching(new RegExp(`^draft-unreadable:${UNREADABLE_ID}:[0-9a-z]+$`))],
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

  test("a tab whose page names nobody now asks about the session person's drafts, and fails closed when the session cannot be read", async () => {
    await storeEveryone();
    pageHoldsNobody();
    sessionUserId = holder.userId;
    const ids = (await draftUnsentSource.summarize('organization')).flatMap((item) => item.ids);
    // Without a page that names the organization, a switch asks as a sign-out does: more, never less.
    expect(ids).toContain(`draft:${OTHER_ORGANIZATION_ID}:${NOW.toISOString()}`);
    expect(ids.some((id) => id.includes(COLLEAGUE_ID))).toBe(false);
    sessionUserId = otherPerson.userId;
    expect((await draftUnsentSource.summarize('session')).flatMap((item) => item.ids)).toEqual([
      `draft:${COLLEAGUE_ID}:${NOW.toISOString()}`,
    ]);
    sessionUserId = null;
    expect(await draftUnsentSource.summarize('session')).toEqual([]);
    sessionUserId = new Error('The session store did not answer.');
    expect(draftUnsentSource.summarize('session')).rejects.toThrow('The session store did not answer.');
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

  test("„Jetzt senden“ in a tab whose page names nobody now sends the session person's drafts, and one the active organization refuses waits unsealed", async () => {
    await save(draft({ photos: [] }));
    await save(draft({ ...otherOrganization, id: OTHER_ORGANIZATION_ID, photos: [] }));
    await save(draft({ ...otherPerson, id: COLLEAGUE_ID, photos: [] }));
    pageHoldsNobody();
    sessionUserId = holder.userId;
    handlerAnswers = [results('accepted', 'accepted'), results('rejected', 'organization_mismatch')];

    await draftUnsentSource.flush();
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
    pageHoldsNobody();
    sessionUserId = holder.userId;
    handlerAnswers = [results('rejected', 'organization_mismatch')];

    await draftUnsentSource.flush();
    sessionUserId = null;

    expect((await stored(otherOrganization)).map((entry) => entry.sealed)).toEqual([true]);
  });
  test('„Jetzt senden“ never marks a photo draft of an organization the page did not name as lost access when its upload is refused', async () => {
    const photoDraft = draft({
      ...otherOrganization,
      id: OTHER_ORGANIZATION_ID,
      photos: [
        {
          id: '9e000000-0000-4000-8000-000000000031',
          name: 'foto-1.jpg',
          blob: new Blob(['synthetic photo'], { type: 'image/jpeg' }),
          transferred: null,
          documentId: null,
        },
      ],
    });
    await save(photoDraft);
    sessionUserId = holder.userId;
    // The upload runs under the session's active organization, the page's, which refuses the other one's job.
    uploadAnswer = { status: 'failed', reason: 'refused', transferred: null };

    await draftUnsentSource.flush();

    expect(accessReads).toBe(0);
    expect(sent).toEqual([]);
    expect((await stored(otherOrganization)).map((entry) => [entry.refusal, entry.sealed])).toEqual([
      [null, false],
    ]);
  });

  test("„Jetzt senden“ sends the session person's drafts after another tab changed the person, though this tab's page named the earlier one", async () => {
    await save(draft({ ...otherPerson, id: COLLEAGUE_ID, photos: [] }));
    // Another tab signed the first person out and the colleague in; this tab's page still named the first.
    pageHoldsNobody();
    sessionUserId = otherPerson.userId;
    handlerAnswers = [results('accepted', 'accepted')];

    await draftUnsentSource.flush();

    expect(sent.map((operation) => operation.payload.artifactId)).toEqual([COLLEAGUE_ID]);
    expect(await stored(otherPerson)).toEqual([]);
  });
  test('a discard waits for an online save of a sealed draft in its turn, so the server never records a draft the person was told is gone', async () => {
    await save(draft({ sealed: true }));
    const shown = (await draftUnsentSource.summarize('session')).flatMap((item) => item.ids);
    let answerSave = (): void => undefined;
    const order: string[] = [];
    // Another tab's online save holds the drafts' turn until the server answers.
    const saving = whileNoDraftSend(
      () =>
        new Promise<void>((resolve) => {
          answerSave = resolve;
        }),
    ).then(() => order.push('save answered'));
    const discarding = draftUnsentSource.discard('session', shown).then(() => order.push('discarded'));
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(order).toEqual([]);
    expect((await stored()).length).toBe(1);
    answerSave();
    await Promise.all([saving, discarding]);
    expect(order).toEqual(['save answered', 'discarded']);
    expect(await stored()).toEqual([]);
  });

  test('a discard whose wait for a hanging online save ends deletes nothing and says a send is still running', async () => {
    await save(draft({ sealed: true }));
    const shown = (await draftUnsentSource.summarize('session')).flatMap((item) => item.ids);
    let answerSave = (): void => undefined;
    const saving = whileNoDraftSend(
      () =>
        new Promise<void>((resolve) => {
          answerSave = resolve;
        }),
    );
    // The discard's wait limit, fired by hand: a save in a dead spot never answers within it.
    const realSetTimeout = globalThis.setTimeout;
    const wait: { end: (() => void) | null } = { end: null };
    Object.assign(globalThis, {
      setTimeout: (run: () => void) => {
        wait.end = run;
        return realSetTimeout(() => undefined, 0);
      },
    });
    try {
      const discarding = draftUnsentSource.discard('session', shown);
      await until(() => wait.end !== null);
      wait.end?.();
      await expect(discarding).rejects.toBeInstanceOf(UnsentWorkBusyError);
    } finally {
      Object.assign(globalThis, { setTimeout: realSetTimeout });
    }
    answerSave();
    await saving;
    // The abandoned deletion never runs after the save answered: the person was told nothing went.
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    expect((await stored()).length).toBe(1);
  });

  test("an online save that does not get the drafts' turn within its bound answers busy, and its work never runs later", async () => {
    await save(draft({ photos: [] }));
    let answer = (): void => undefined;
    handlerAnswers = [
      () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(results('accepted', 'accepted')());
        }),
    ];
    // A send in a dead spot holds the turn: its request never answers within the bound.
    const sending = sendDraft(holder, DRAFT_ID);
    await until(() => sent.length === 1);
    let ran = false;

    const saved = await passTurnBound(() =>
      whileNoDraftSend(() => {
        ran = true;
        return Promise.resolve('saved');
      }),
    );

    expect(saved === DRAFT_SEND_BUSY).toBe(true);
    answer();
    expect(await sending).toBe('sent');
    // The queue moved past the abandoned save: a later turn runs, and the save's work never did.
    expect(await whileNoDraftSend(() => Promise.resolve('later'))).toBe('later');
    expect(ran).toBe(false);
  });

  test("a session replaced during one organization's send stops the later organizations before any photo upload", async () => {
    const photoDraft = draft({
      ...otherOrganization,
      id: OTHER_ORGANIZATION_ID,
      updatedAt: new Date(NOW.getTime() + 60_000).toISOString(),
      photos: [
        {
          id: '9e000000-0000-4000-8000-000000000031',
          name: 'foto-1.jpg',
          blob: new Blob(['synthetic photo'], { type: 'image/jpeg' }),
          transferred: null,
          documentId: null,
        },
      ],
    });
    await save(draft({ photos: [] }));
    await save(photoDraft);
    pageHoldsNobody();
    sessionUserId = holder.userId;
    // Another tab signs out and in while the first organization's draft is on its way.
    handlerAnswers = [
      () => {
        storage.set(TODAY_WIPE_KEY, 'replaced-session');
        return results('accepted', 'accepted')();
      },
    ];

    await draftUnsentSource.flush();
    sessionUserId = null;

    expect(sent.map((operation) => operation.payload.artifactId)).toEqual([DRAFT_ID]);
    expect(uploadsStarted).toBe(0);
    expect((await stored(otherOrganization)).map((entry) => entry.id)).toEqual([OTHER_ORGANIZATION_ID]);
  });

  test('„Verwerfen“ leaves an unreadable draft another tab rewrote under the same id after the question showed it, and deletes an unchanged one', async () => {
    const unchangedId = '9e000000-0000-4000-8000-000000000071';
    await saveUnreadable(holder, UNREADABLE_ID);
    await saveUnreadable(holder, unchangedId);
    const shown = (await draftUnsentSource.summarize('session')).flatMap((item) => item.ids);
    // A later release in another tab rewrites the record: only its job changes, which this version reads.
    await saveUnreadable(holder, UNREADABLE_ID, { jobId: '9e000000-0000-4000-8000-000000000021' });

    await draftUnsentSource.discard('session', shown);

    const left = await draftUnsentSource.summarize('session');
    expect(left.flatMap((item) => item.ids).map((id) => id.includes(UNREADABLE_ID))).toEqual([true]);
  });
});
