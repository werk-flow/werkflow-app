import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from 'bun:test';

import { z } from '@/lib/zod';
import {
  DRAFT_UNSENT_LIMIT_MS,
  changeDraftOnDevice,
  deleteDraftsOnDevice,
  listDraftsOnDevice,
  type DraftHolder,
  type StoredDraft,
} from './draft-store';

// The send of the report drafts a phone keeps (decision record 0010, the
// report draft amendment), against the real device store (fake-indexeddb).
// The upload path, the access reader and the sync handler are stand-ins that
// record what the device sent them.

type UploadCall = { name: string; jobId: string | null; category: string | undefined; transferred: unknown };
const uploads: UploadCall[] = [];
/** What the upload path answers, as far as the sender reads it. */
type UploadAnswer =
  | { status: 'saved'; saved: { id: string } | null }
  | { status: 'failed'; reason: string; transferred: unknown };
let uploadAnswers: Array<() => UploadAnswer> = [];
let accessAnswer: { success: true } | { success: false; error: string } = { success: true };
const accessReads: unknown[] = [];

function savedAs(id: string): UploadAnswer {
  return { status: 'saved', saved: { id } };
}

mock.module('@/lib/documents/upload-client', () => ({
  uploadDocumentDirect: (input: {
    file: File;
    target: { kind: string; jobId?: string };
    category?: string;
    transferred: unknown;
  }) => {
    const call = {
      name: input.file.name,
      jobId: input.target.jobId ?? null,
      category: input.category,
      transferred: input.transferred,
    };
    uploads.push(call);
    const answer = uploadAnswers.shift();
    if (!answer) throw new Error(`Unexpected upload of ${call.name}`);
    return Promise.resolve(answer());
  },
}));
mock.module('@/lib/data/background-read-client', () => ({
  readInBackground: (kind: string, input: unknown) => {
    accessReads.push([kind, input]);
    return Promise.resolve(accessAnswer);
  },
}));

const { draftUnsentSource, keepDraftOpen, sendDraft, sendDrafts, startDraftSync } = await import(
  './draft-sync'
);

const holder: DraftHolder = {
  userId: '9d000000-0000-4000-8000-000000000001',
  organizationId: '9d000000-0000-4000-8000-0000000000a1',
};
const otherPerson: DraftHolder = { ...holder, userId: '9d000000-0000-4000-8000-000000000002' };
/** The device clock of every test: the sender reads it for the seven-day limit and the send time. */
const NOW = new Date('2026-11-09T08:00:00.000Z');
const DRAFT_ID = '9d000000-0000-4000-8000-000000000010';
const JOB_ID = '9d000000-0000-4000-8000-000000000020';

function draft(overrides: Partial<StoredDraft> = {}): StoredDraft {
  return {
    ...holder,
    id: DRAFT_ID,
    revisionId: '9d000000-0000-4000-8000-000000000011',
    operationId: '9d000000-0000-4000-8000-000000000012',
    jobId: JOB_ID,
    kind: 'work_report',
    visibility: 'internal_only',
    capturedAt: '2026-11-09T07:00:00.000Z',
    title: 'Heizung gewartet',
    content: { performedWork: 'Brenner gereinigt' },
    photos: ['foto-1.jpg', 'foto-2.jpg'].map((name, index) => ({
      id: `9d000000-0000-4000-8000-00000000003${index + 1}`,
      name,
      blob: new Blob([`synthetic ${name}`], { type: 'image/jpeg' }),
      transferred: null,
      documentId: null,
    })),
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

async function stored(owner: DraftHolder = holder): Promise<StoredDraft[]> {
  return listDraftsOnDevice(owner);
}

const sentOperationSchema = z.object({
  operationId: z.string(),
  kind: z.string(),
  capturedAt: z.string(),
  sentAt: z.string(),
  organizationId: z.string(),
  payload: z.object({
    artifactId: z.string(),
    revisionId: z.string(),
    jobId: z.string(),
    photos: z.array(z.unknown()),
  }),
});
const sent: z.infer<typeof sentOperationSchema>[] = [];
let handlerAnswers: Array<() => Response | Promise<Response>> = [];
let onOnline: (() => void) | null = null;
const realFetch = globalThis.fetch;

function results(outcome: string, code: string): () => Response {
  return () => Response.json({ results: [{ operationId: 'echo', outcome, code }] });
}

beforeEach(() => {
  setSystemTime(NOW);
  uploads.length = 0;
  accessReads.length = 0;
  sent.length = 0;
  uploadAnswers = [];
  handlerAnswers = [];
  accessAnswer = { success: true };
  Object.assign(globalThis, {
    window: {
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'online') onOnline = listener;
      },
    },
    fetch: (url: string, init: RequestInit) => {
      expect(url).toBe('/api/field-sync/v1/operations');
      expect(init.method).toBe('POST');
      const body = z
        .object({ operations: z.array(sentOperationSchema) })
        .parse(JSON.parse(String(init.body)));
      sent.push(...body.operations);
      const answer = handlerAnswers.shift();
      if (!answer) throw new Error('Unexpected request to the sync handler');
      return Promise.resolve(answer());
    },
  });
});

afterEach(async () => {
  setSystemTime();
  globalThis.fetch = realFetch;
  for (const each of [holder, otherPerson]) await deleteDraftsOnDevice(each);
});

describe('a report draft is sent', () => {
  test('both photos go to storage first, then one operation attaches the draft and both documents, and the draft leaves the phone', async () => {
    await save(draft());
    uploadAnswers = [() => savedAs('doc-1'), () => savedAs('doc-2')];
    handlerAnswers = [results('accepted', 'accepted')];

    expect(await sendDraft(holder, DRAFT_ID)).toBe('sent');

    expect(uploads.map((call) => [call.name, call.jobId, call.category])).toEqual([
      ['foto-1.jpg', JOB_ID, 'photo'],
      ['foto-2.jpg', JOB_ID, 'photo'],
    ]);
    expect(sent.length).toBe(1);
    expect(sent[0]?.kind).toBe('work_artifact.draft');
    expect(sent[0]?.organizationId).toBe(holder.organizationId);
    expect(sent[0]?.payload.photos).toEqual([
      { linkId: '9d000000-0000-4000-8000-000000000031', documentId: 'doc-1' },
      { linkId: '9d000000-0000-4000-8000-000000000032', documentId: 'doc-2' },
    ]);
    expect(await stored()).toEqual([]);
  });

  test('a replayed attach creates one revision: the resend repeats the operation, the revision and the captured time, uploads nothing again, and the answer removes the draft', async () => {
    await save(draft());
    uploadAnswers = [() => savedAs('doc-1'), () => savedAs('doc-2')];
    // The first answer is lost on the way back.
    handlerAnswers = [
      () => Promise.reject(new TypeError('Failed to fetch')),
      results('replayed', 'replayed'),
    ];

    expect(await sendDraft(holder, DRAFT_ID)).toBe('waiting');
    const [waiting] = await stored();
    expect(waiting?.sealed).toBe(true);
    expect(await sendDraft(holder, DRAFT_ID)).toBe('sent');

    expect(uploads.length).toBe(2);
    expect(sent.length).toBe(2);
    const [first, second] = sent;
    expect(second?.operationId).toBe(first?.operationId ?? '');
    expect(second?.capturedAt).toBe(first?.capturedAt ?? '');
    expect(second?.payload).toEqual(first?.payload);
    expect(await stored()).toEqual([]);
  });

  test('an interrupted upload keeps its stored bytes, and the retry registers them instead of sending the photo again', async () => {
    await save(draft());
    const transferred = { documentId: 'doc-1', version: null, storagePath: 'org/doc-1/foto-1.jpg' };
    uploadAnswers = [() => ({ status: 'failed', reason: 'interrupted', transferred })];

    expect(await sendDraft(holder, DRAFT_ID)).toBe('waiting');
    expect(sent).toEqual([]);
    expect((await stored())[0]?.sealed).toBe(false);

    // The earlier try's lost answer had registered the photo: the retry is saved without a document.
    uploadAnswers = [() => ({ status: 'saved', saved: null }), () => savedAs('doc-2')];
    handlerAnswers = [results('accepted', 'accepted')];
    expect(await sendDraft(holder, DRAFT_ID)).toBe('sent');

    expect(uploads[1]?.transferred).toEqual(transferred);
    expect(sent[0]?.payload.photos).toEqual([
      { linkId: '9d000000-0000-4000-8000-000000000031', documentId: 'doc-1' },
      { linkId: '9d000000-0000-4000-8000-000000000032', documentId: 'doc-2' },
    ]);
  });
});

describe('lost access', () => {
  test('a removed assignment rejects the attach: the draft stays, marked, and is never sent again', async () => {
    await save(draft({ photos: [] }));
    handlerAnswers = [results('rejected', 'forbidden')];

    expect(await sendDraft(holder, DRAFT_ID)).toBe('no_access');
    const [kept] = await stored();
    expect(kept?.refusal?.kind).toBe('no_access');
    expect(kept?.sealed).toBe(false);

    startDraftSync(holder);
    await sendDrafts();
    expect(await sendDraft(holder, DRAFT_ID)).toBe('no_access');
    expect(sent.length).toBe(1);
    expect((await stored()).length).toBe(1);
  });

  test('a revoked membership refuses the whole request: the draft is marked the same way', async () => {
    await save(draft({ photos: [] }));
    handlerAnswers = [() => Response.json({ outcome: 'rejected', code: 'forbidden' }, { status: 403 })];

    expect(await sendDraft(holder, DRAFT_ID)).toBe('no_access');
    expect((await stored())[0]?.refusal?.kind).toBe('no_access');
  });

  test("a refused photo upload asks the server whether the job is still the person's: without access no photo and no draft is sent", async () => {
    await save(draft());
    uploadAnswers = [() => ({ status: 'failed', reason: 'refused', transferred: null })];
    accessAnswer = { success: false, error: 'not_authorized' };

    expect(await sendDraft(holder, DRAFT_ID)).toBe('no_access');

    expect(accessReads).toEqual([['work-artifacts', { targetType: 'job', targetId: JOB_ID }]]);
    expect(uploads.length).toBe(1);
    expect(sent).toEqual([]);
    expect((await stored())[0]?.refusal?.kind).toBe('no_access');
  });

  test('a refused photo upload with the job still accessible is a refusal the person can send again, and one that cannot be asked waits', async () => {
    await save(draft());
    uploadAnswers = [() => ({ status: 'failed', reason: 'refused', transferred: null })];
    accessAnswer = { success: false, error: 'background_read_failed' };
    expect(await sendDraft(holder, DRAFT_ID)).toBe('waiting');
    expect((await stored())[0]?.refusal).toBeNull();

    uploadAnswers = [() => ({ status: 'failed', reason: 'refused', transferred: null })];
    accessAnswer = { success: true };
    expect(await sendDraft(holder, DRAFT_ID)).toBe('refused');
    expect((await stored())[0]?.refusal?.kind).toBe('failed');
  });
});

describe('what is sent by itself', () => {
  test('a retry answer keeps the draft waiting and sealed; a session that needs a new sign-in is such an answer', async () => {
    await save(draft({ photos: [] }));
    handlerAnswers = [
      () => Response.json({ outcome: 'retry', code: 'unauthenticated' }, { status: 401 }),
      results('retry', 'unavailable'),
      () => new Response('<html>captive portal</html>', { status: 200 }),
    ];
    for (let attempt = 0; attempt < 3; attempt += 1)
      expect(await sendDraft(holder, DRAFT_ID)).toBe('waiting');
    const [kept] = await stored();
    expect(kept?.refusal).toBeNull();
    expect(kept?.sealed).toBe(true);
  });

  test('a rejected or conflicted draft is kept as refused, unsealed, and only the person sends it again', async () => {
    await save(draft({ photos: [] }));
    handlerAnswers = [results('conflict', 'version_conflict')];
    expect(await sendDraft(holder, DRAFT_ID)).toBe('refused');
    expect((await stored())[0]).toMatchObject({ sealed: false, refusal: { kind: 'failed' } });

    startDraftSync(holder);
    await sendDrafts();
    expect(sent.length).toBe(1);

    handlerAnswers = [results('accepted', 'accepted')];
    expect(await sendDraft(holder, DRAFT_ID)).toBe('sent');
  });

  test('an unknown outcome of a newer server is a retry for a server failure and a refusal otherwise', async () => {
    await save(draft({ photos: [] }));
    handlerAnswers = [() => Response.json({ outcome: 'postponed', code: 'later' }, { status: 503 })];
    expect(await sendDraft(holder, DRAFT_ID)).toBe('waiting');
    handlerAnswers = [results('postponed', 'later')];
    expect(await sendDraft(holder, DRAFT_ID)).toBe('refused');
  });

  test('a draft open in the editor, an incomplete one and one unchanged for more than seven days are not sent by themselves', async () => {
    const old = new Date(NOW.getTime() - DRAFT_UNSENT_LIMIT_MS - 60_000).toISOString();
    await save(draft({ photos: [] }));
    await save(draft({ id: '9d000000-0000-4000-8000-000000000040', photos: [], ready: false }));
    await save(draft({ id: '9d000000-0000-4000-8000-000000000050', photos: [], updatedAt: old }));
    const close = keepDraftOpen(DRAFT_ID);
    startDraftSync(holder);
    await sendDrafts();
    expect(sent).toEqual([]);

    // Closed, the complete recent draft goes; the person can still send the old one.
    close();
    handlerAnswers = [results('accepted', 'accepted'), results('accepted', 'accepted')];
    await sendDrafts();
    expect(sent.map((operation) => operation.payload.artifactId)).toEqual([DRAFT_ID]);
    expect(await sendDraft(holder, '9d000000-0000-4000-8000-000000000050')).toBe('sent');
    expect((await stored()).map((entry) => entry.id)).toEqual(['9d000000-0000-4000-8000-000000000040']);
  });

  test('without signal the pass tries once, not once per draft', async () => {
    await save(draft({ photos: [] }));
    await save(draft({ id: '9d000000-0000-4000-8000-000000000040', photos: [] }));
    const noSignal = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));
    // Two passes: the app start and one more trigger.
    handlerAnswers = [noSignal, noSignal];
    startDraftSync(holder);
    await sendDrafts();
    expect(sent.map((operation) => operation.payload.artifactId)).toEqual([DRAFT_ID, DRAFT_ID]);

    // The signal returns: the `online` event sends what waited.
    handlerAnswers = [results('replayed', 'replayed'), results('accepted', 'accepted')];
    onOnline?.();
    await sendDrafts();
    expect(await stored()).toEqual([]);
  });
});

describe('drafts as unsent work at sign-out', () => {
  test("the source names the holder's drafts, those without access apart, and discards only the holder's", async () => {
    await save(draft({ photos: [] }));
    await save(
      draft({
        id: '9d000000-0000-4000-8000-000000000040',
        photos: [],
        refusal: { kind: 'no_access', at: NOW.toISOString() },
      }),
    );
    await save(draft({ ...otherPerson, id: '9d000000-0000-4000-8000-000000000060', photos: [] }));
    startDraftSync(holder);
    await sendDrafts();

    expect(await draftUnsentSource.summarize()).toEqual([
      { label: 'Berichtsentwürfe', count: 1 },
      { label: 'Berichtsentwürfe ohne Zugriff', count: 1 },
    ]);
    await draftUnsentSource.discard();
    expect(await draftUnsentSource.summarize()).toEqual([]);
    expect((await stored(otherPerson)).length).toBe(1);
  });
});
