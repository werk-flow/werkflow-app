'use client';

import type { TransferredUpload } from '@/lib/documents/upload-client';
import { isJsonRecord } from '@/lib/supabase/json';
import {
  WORK_ARTIFACT_KINDS,
  type WorkArtifactContentInput,
  type WorkArtifactKind,
  type WorkArtifactVisibility,
} from '@/lib/work-artifacts/types';
import { z } from '@/lib/zod';
import { belongsTo, requestResult, runInStore, type DeviceHolder } from './device-store';
import { markDraftsOnDevice } from './draft-expiry';

// The web half of the report drafts a phone keeps (decision record 0010, the
// report draft amendment): one IndexedDB record per draft with its text and
// its photos, of one person in one organization. A draft is the person's
// unsent work, not a cache: the static wipe (today-wipe.ts) never touches this
// database, and a sign-out asks about it through the unsent-work seam. Every
// reader names the person and organization it reads for and gets nothing
// else. A native client replaces this module and keeps the same rules.

const DRAFT_DATABASE = 'werkflow-drafts';
const STORE = 'drafts';

/**
 * How long an unsent draft is sent automatically after the person last changed it. Later it shows
 * as „Nicht übertragen“ and goes only when the person deletes it.
 */
export const DRAFT_UNSENT_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How long a draft stays on the phone after the server refused it for lost access. It is never
 * sent again, and the phone deletes it after this time, whoever uses the phone then. Zero deletes
 * such a draft at once.
 */
export const DRAFT_NO_ACCESS_KEPT_MS = 7 * 24 * 60 * 60 * 1000;

/** The person and organization a draft belongs to. */
export type DraftHolder = DeviceHolder;

/**
 * Whose drafts a session end reads: one person's, in one organization, or in every organization
 * (`null`) before a sign-out, which ends them all (unsent-work.ts, UnsentScope).
 */
export type DraftScope = { userId: string; organizationId: string | null };

function inScope(record: DraftHolder, scope: DraftScope): boolean {
  return (
    record.userId === scope.userId &&
    (scope.organizationId === null || record.organizationId === scope.organizationId)
  );
}

export type DraftPhoto = {
  /** The id of the photo's link on the revision, created once on the device. */
  id: string;
  name: string;
  blob: Blob;
  /** The bytes an earlier try stored: a retry registers them instead of sending the photo again. */
  transferred: TransferredUpload | null;
  /** The job document the upload was saved as. */
  documentId: string | null;
};

/** Why the server did not take a draft: the person lost access to its job, or another refusal. */
export type DraftRefusal = { kind: 'no_access' | 'failed'; at: string };

export type StoredDraft = DraftHolder & {
  /** The id of the Arbeitsnachweis the draft becomes. */
  id: string;
  /** Created once with the draft: a resend repeats both, so the server writes one revision. */
  revisionId: string;
  operationId: string;
  jobId: string;
  kind: WorkArtifactKind;
  visibility: WorkArtifactVisibility;
  /** „Erfasst am“ as an ISO instant. */
  capturedAt: string;
  title: string;
  content: WorkArtifactContentInput;
  photos: DraftPhoto[];
  /** Whether the draft meets the rules of a saved draft; only such a draft is sent by itself. */
  ready: boolean;
  /** When the person last changed the draft: the operation's captured time. */
  updatedAt: string;
  /** An attach was sent whose answer never came: the draft may be on the server, so it no longer changes. */
  sealed: boolean;
  refusal: DraftRefusal | null;
};

const transferredSchema = z.object({
  documentId: z.string(),
  version: z.object({ versionNumber: z.number(), uploadId: z.string() }).nullable(),
  storagePath: z.string(),
});

/** The plain fields of a record of this version; the photo bytes and the content are narrowed below. */
const storedFieldsSchema = z.object({
  id: z.string(),
  userId: z.string(),
  organizationId: z.string(),
  revisionId: z.string(),
  operationId: z.string(),
  jobId: z.string(),
  kind: z.enum(WORK_ARTIFACT_KINDS),
  visibility: z.enum(['internal_only', 'customer_facing']),
  capturedAt: z.string(),
  title: z.string(),
  content: z.unknown(),
  photos: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      blob: z.unknown(),
      transferred: transferredSchema.nullable(),
      documentId: z.string().nullable(),
    }),
  ),
  ready: z.boolean(),
  updatedAt: z.string(),
  sealed: z.boolean(),
  refusal: z.object({ kind: z.enum(['no_access', 'failed']), at: z.string() }).nullable(),
});

/** The content is the editor's own state; the server checks it when the draft is sent. */
function isDraftContent(value: unknown): value is WorkArtifactContentInput {
  return isJsonRecord(value);
}

/**
 * The version of the records this code writes. A phone keeps a draft across releases, so every later
 * version reads every earlier one: a change of what a record holds raises this number and adds an
 * upgrade reader, and the records of each earlier version stay as golden fixtures
 * (draft-store.golden.test.ts). A record without a version is version 1, as werk-flow/werkflow-app#379 wrote it.
 */
const DRAFT_RECORD_VERSION = 1;

/** Whether this code reads the record's version; extra fields of the record are ignored. */
function isReadableVersion(record: unknown): boolean {
  return isJsonRecord(record) && (record.version ?? 1) === DRAFT_RECORD_VERSION;
}

/**
 * Whose draft a record is, and its job when the record names one this code reads. Every version
 * keeps the id and the holder as they are, so a record this code cannot read still shows to its
 * person, never to anyone else.
 */
const heldRecordSchema = z.object({
  id: z.string(),
  userId: z.string(),
  organizationId: z.string(),
  // Read leniently: a job reference this code does not know never hides the record from its person.
  jobId: z.unknown(),
});

/** A draft on the device that this version of the code cannot read: it is never sent, changed or deleted by itself. */
export type UnreadableDraft = { id: string; jobId: string | null };

/** The record as an unreadable draft in the scope, or null when it is readable or someone else's. */
function unreadableInScope(record: unknown, scope: DraftScope): UnreadableDraft | null {
  const held = heldRecordSchema.safeParse(record);
  if (!held.success || !inScope(held.data, scope) || storedDraft(record)) return null;
  const { id, jobId } = held.data;
  return { id, jobId: typeof jobId === 'string' ? jobId : null };
}

/** The record as a draft, or null when this version of the code cannot read it. */
function storedDraft(record: unknown): StoredDraft | null {
  // A record of a later version may hold fields this code would drop on a write: it stays as it is.
  if (!isReadableVersion(record)) return null;
  const fields = storedFieldsSchema.safeParse(record);
  if (!fields.success || !isDraftContent(fields.data.content)) return null;
  const photos: DraftPhoto[] = [];
  for (const photo of fields.data.photos) {
    if (!(photo.blob instanceof Blob)) return null;
    photos.push({ ...photo, blob: photo.blob });
  }
  return { ...fields.data, content: fields.data.content, photos };
}

/** Runs `run` in one transaction of the draft store and closes the connection, so nothing ever waits on it. */
async function inDraftStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const opening = indexedDB.open(DRAFT_DATABASE, 1);
  opening.onupgradeneeded = () => {
    opening.result.createObjectStore(STORE, { keyPath: 'id' });
  };
  const database = await requestResult(opening);
  try {
    return await runInStore(database, STORE, mode, run);
  } finally {
    database.close();
  }
}

/** Whether the phone no longer keeps a draft the server refused for lost access. */
function noAccessTimeOver(draft: StoredDraft, now: Date): boolean {
  return (
    draft.refusal?.kind === 'no_access' &&
    now.getTime() - Date.parse(draft.refusal.at) >= DRAFT_NO_ACCESS_KEPT_MS
  );
}

/**
 * Sets the device mark from what the store holds after this transaction, once it committed: an
 * aborted deletion leaves the mark as it was, so a draft never stays on the phone without it. A
 * transaction that left no draft removes the mark only after a fresh count still finds none: another
 * tab may have stored a draft, and set the mark, before this tab handled the commit.
 */
function markWhatRemains(store: IDBObjectStore): void {
  const counting = store.count();
  counting.addEventListener('success', () => {
    const remaining = counting.result;
    store.transaction.addEventListener('complete', () => {
      if (remaining > 0) markDraftsOnDevice(true);
      else void removeMarkIfStillEmpty();
    });
  });
}

/**
 * Removes the device mark when a fresh count finds no draft, inside that count's success handler:
 * the read transaction still keeps every writer out, so no tab can store a draft and set the mark
 * in between. A failed count keeps the mark.
 */
async function removeMarkIfStillEmpty(): Promise<void> {
  const counted = await inDraftStore('readonly', (store) => {
    const counting = store.count();
    counting.addEventListener('success', () => {
      if (counting.result === 0) markDraftsOnDevice(false);
    });
    return counting;
  }).catch(() => null);
  // A failed count is no reason to remove the mark: it stays, and the next sweep counts again.
  if (counted === null) return;
}

/** Deletes every draft among `records` whose time after a lost access is over, of any holder. */
function deleteExpired(store: IDBObjectStore, records: readonly unknown[], now: Date): void {
  for (const record of records) {
    const draft = storedDraft(record);
    if (draft && noAccessTimeOver(draft, now)) store.delete(draft.id);
  }
  markWhatRemains(store);
}

/**
 * Deletes every draft whose time after a lost access is over, of every holder, and nothing else:
 * no draft is read out, sent or changed. The start of any person's app runs it (draft-expiry.ts).
 */
export async function sweepExpiredDraftsOnDevice(now: Date = new Date()): Promise<void> {
  await inDraftStore('readwrite', (store) => {
    const request = store.getAll();
    request.addEventListener('success', () => deleteExpired(store, request.result, now));
    return request;
  });
}

/**
 * The holder's drafts, oldest change first. On the way, every draft whose time after a lost
 * access is over is deleted, also another person's: that person may never open this phone again.
 * Throws when IndexedDB itself fails: the caller shows that, never an empty list.
 */
export async function listDraftsOnDevice(
  holder: DraftHolder,
  now: Date = new Date(),
): Promise<StoredDraft[]> {
  return (await listDraftsInScopeOnDevice(holder, now)).drafts;
}

/**
 * The scope's drafts, oldest change first, and its records this version cannot read, read in one
 * transaction. Deletes every lost-access draft past its time on the way, as listDraftsOnDevice does.
 * Throws when IndexedDB itself fails: a session end then asks, it never answers that nothing waits.
 */
export async function listDraftsInScopeOnDevice(
  scope: DraftScope,
  now: Date = new Date(),
): Promise<{ drafts: StoredDraft[]; unreadable: UnreadableDraft[] }> {
  const records: unknown[] = await inDraftStore('readwrite', (store) => {
    const request = store.getAll();
    request.addEventListener('success', () => deleteExpired(store, request.result, now));
    return request;
  });
  const drafts = records
    .flatMap((record) => {
      const draft = storedDraft(record);
      return draft && inScope(draft, scope) && !noAccessTimeOver(draft, now) ? [draft] : [];
    })
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
  const unreadable = records.flatMap((record) => unreadableInScope(record, scope) ?? []);
  return { drafts, unreadable };
}

/**
 * The holder's records that this version of the code cannot read, such as a draft a later release
 * wrote before the app went back to this one. The person sees that they exist; they stay on the
 * device untouched and keep the device mark set. Throws when IndexedDB itself fails.
 */
export async function listUnreadableDraftsOnDevice(holder: DraftHolder): Promise<UnreadableDraft[]> {
  const records: unknown[] = await inDraftStore('readonly', (store) => store.getAll());
  return records.flatMap((record) => unreadableInScope(record, holder) ?? []);
}

/**
 * Changes one draft of the holder in a single transaction: `change` gets the stored draft, or
 * null when the holder has none under this id, and answers the draft to store, or null to delete
 * it. A read and its write never interleave with another tab's or the sender's. Returns what is
 * stored afterwards. A draft of another person or organization under the id is never read or
 * replaced: the change is refused as if the draft were sealed.
 */
export async function changeDraftOnDevice(
  holder: DraftHolder,
  id: string,
  change: (current: StoredDraft | null) => StoredDraft | null,
): Promise<StoredDraft | null> {
  let stored: StoredDraft | null = null;
  let refusedWrite: unknown = null;
  try {
    await inDraftStore('readwrite', (store) => {
      const request = store.get(id);
      request.addEventListener('success', () => {
        const current = storedDraft(request.result);
        // A record this version cannot read is never replaced or deleted: a later version may read it.
        if (request.result !== undefined && current === null) return;
        if (current && !belongsTo(current, holder)) return;
        const next = change(current);
        try {
          if (next === current) {
            stored = current;
          } else if (next === null) {
            store.delete(id);
            markWhatRemains(store);
          } else {
            // Before the write, so a tab that dies right after it still leaves the mark, and again once
            // it committed, after a sweep of another tab that counted no draft before this one.
            markDraftsOnDevice(true);
            store.transaction.addEventListener('complete', () => markDraftsOnDevice(true));
            store.put({ ...next, version: DRAFT_RECORD_VERSION });
            stored = next;
          }
        } catch (error) {
          // A write the browser refuses at once, such as on a full disk: nothing of the change stays.
          refusedWrite = error;
          store.transaction.abort();
        }
      });
      return request;
    });
  } catch (error) {
    // The browser's own reason, not the abort it caused: the caller tells a full disk from other failures.
    throw refusedWrite instanceof Error ? refusedWrite : error;
  }
  return stored;
}

/**
 * Deletes one record of the holder that this version cannot read, after the person confirmed it,
 * in one transaction. A readable draft, or a record of another person or organization, stays.
 * Answers whether it deleted the record.
 */
export async function deleteUnreadableDraftOnDevice(holder: DraftHolder, id: string): Promise<boolean> {
  let deleted = false;
  await inDraftStore('readwrite', (store) => {
    const request = store.get(id);
    request.addEventListener('success', () => {
      if (!unreadableInScope(request.result, holder)) return;
      store.delete(id);
      markWhatRemains(store);
      deleted = true;
    });
    return request;
  });
  return deleted;
}

/**
 * What a session end's question showed: each readable draft by its id with the last-change time it
 * was shown at, and the ids of the records this version could not read.
 */
export type ShownDrafts = {
  drafts: ReadonlyMap<string, string>;
  unreadable: ReadonlySet<string>;
};

/** The record's id when the question showed it as it is now, in the scope; otherwise null. */
function shownIdOf(record: unknown, scope: DraftScope, shown: ShownDrafts): string | null {
  const draft = storedDraft(record);
  if (draft) return inScope(draft, scope) && shown.drafts.get(draft.id) === draft.updatedAt ? draft.id : null;
  const unreadable = unreadableInScope(record, scope);
  return unreadable && shown.unreadable.has(unreadable.id) ? unreadable.id : null;
}

/**
 * Deletes the scope's drafts a session end's question showed, after the person confirmed the
 * discard, in one transaction. A draft changed since it was shown, one written since, and every
 * record outside the scope stay: the person never saw them.
 */
export async function deleteShownDraftsOnDevice(scope: DraftScope, shown: ShownDrafts): Promise<void> {
  await inDraftStore('readwrite', (store) => {
    const request = store.getAll();
    request.addEventListener('success', () => {
      for (const record of request.result) {
        const id = shownIdOf(record, scope, shown);
        if (id !== null) store.delete(id);
      }
      markWhatRemains(store);
    });
    return request;
  });
}
