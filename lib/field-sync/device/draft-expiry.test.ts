import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';

import {
  DRAFT_NO_ACCESS_KEPT_MS,
  changeDraftOnDevice,
  deleteDraftsOnDevice,
  listDraftsOnDevice,
  type DraftHolder,
  type StoredDraft,
} from './draft-store';
import { DRAFTS_ON_DEVICE_KEY, sweepDraftsOfDevice } from './draft-expiry';

// The phone deletes a draft 7 days after a lost-access refusal whoever uses
// it next (decision record 0010, the report draft amendment): a device mark
// without a person says the phone holds drafts, and the start of any person's
// app (the `(auth)` landing page, a job page) runs the sweep for every holder.

const personA: DraftHolder = {
  userId: '9e000000-0000-4000-8000-000000000001',
  organizationId: '9e000000-0000-4000-8000-0000000000a1',
};
/** An office person who never opens a report dialog. */
const personB: DraftHolder = { ...personA, userId: '9e000000-0000-4000-8000-000000000002' };
const NOW = new Date('2026-11-12T08:00:00.000Z');
const EXPIRED_ID = '9e000000-0000-4000-8000-000000000010';
const LIVE_ID = '9e000000-0000-4000-8000-000000000020';

const storage = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  },
});

function draftOfA(id: string, overrides: Partial<StoredDraft> = {}): StoredDraft {
  return {
    ...personA,
    id,
    revisionId: `${id.slice(0, -2)}91`,
    operationId: `${id.slice(0, -2)}92`,
    jobId: '9e000000-0000-4000-8000-000000000030',
    kind: 'work_report',
    visibility: 'internal_only',
    capturedAt: '2026-11-01T07:00:00.000Z',
    title: 'Heizung gewartet',
    content: { performedWork: 'Brenner gereinigt' },
    photos: [
      {
        id: `${id.slice(0, -2)}93`,
        name: 'foto-1.jpg',
        blob: new Blob(['synthetic photo'], { type: 'image/jpeg' }),
        transferred: null,
        documentId: null,
      },
    ],
    ready: true,
    updatedAt: '2026-11-01T07:30:00.000Z',
    sealed: false,
    refusal: null,
    ...overrides,
  };
}

/** Every draft of the person, read at a time before any lost access ends, so the read deletes nothing. */
async function keptOf(holder: DraftHolder): Promise<string[]> {
  return (await listDraftsOnDevice(holder, new Date(0))).map((entry) => entry.id);
}

beforeEach(() => {
  setSystemTime(NOW);
  storage.clear();
});

afterEach(async () => {
  setSystemTime();
  for (const each of [personA, personB]) await deleteDraftsOnDevice(each);
});

describe('the end of a lost-access draft, whoever starts the app next', () => {
  test("B's app start deletes A's lost-access draft past seven days and leaves A's live draft and B's nothing", async () => {
    const lostAt = new Date(NOW.getTime() - DRAFT_NO_ACCESS_KEPT_MS).toISOString();
    const expired = draftOfA(EXPIRED_ID, { refusal: { kind: 'no_access', at: lostAt } });
    const live = draftOfA(LIVE_ID);
    await changeDraftOnDevice(personA, EXPIRED_ID, () => expired);
    await changeDraftOnDevice(personA, LIVE_ID, () => live);
    expect(storage.get(DRAFTS_ON_DEVICE_KEY)).toBe('1');

    // B lands on the sign-in page and starts the app; nothing of B opens a draft.
    await sweepDraftsOfDevice();

    expect(await keptOf(personA)).toEqual([LIVE_ID]);
    const [kept] = await listDraftsOnDevice(personA, new Date(0));
    expect(kept).toEqual(live);
    expect(await keptOf(personB)).toEqual([]);
    expect(storage.get(DRAFTS_ON_DEVICE_KEY)).toBe('1');
  });

  test('the mark goes when the device holds no draft, and without it the start reads no draft store', async () => {
    const lostAt = new Date(NOW.getTime() - DRAFT_NO_ACCESS_KEPT_MS).toISOString();
    await changeDraftOnDevice(personA, EXPIRED_ID, () =>
      draftOfA(EXPIRED_ID, { refusal: { kind: 'no_access', at: lostAt } }),
    );
    expect(storage.get(DRAFTS_ON_DEVICE_KEY)).toBe('1');
    await sweepDraftsOfDevice();
    expect(await keptOf(personA)).toEqual([]);
    expect(storage.has(DRAFTS_ON_DEVICE_KEY)).toBe(false);

    // A draft written while the mark was missing sets it again; deleting the last one removes it.
    await changeDraftOnDevice(personA, LIVE_ID, () => draftOfA(LIVE_ID));
    expect(storage.get(DRAFTS_ON_DEVICE_KEY)).toBe('1');
    await changeDraftOnDevice(personA, LIVE_ID, () => null);
    expect(storage.has(DRAFTS_ON_DEVICE_KEY)).toBe(false);
    expect(await sweepDraftsOfDevice()).toBe('no_drafts');
  });
});
