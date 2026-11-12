'use client';

import { readInBackground } from '@/lib/data/background-read-client';
import { uploadDocumentDirect, type UploadFailureReason } from '@/lib/documents/upload-client';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';
import {
  DRAFT_UNSENT_LIMIT_MS,
  changeDraftOnDevice,
  deleteDraftsOnDevice,
  listDraftsOnDevice,
  type DraftHolder,
  type DraftRefusal,
  type StoredDraft,
} from './draft-store';
import { TODAY_WIPE_KEY, todayWipeGeneration } from './today-wipe';

// Sends the report drafts a phone keeps (decision record 0010, the report
// draft amendment). Each photo goes to storage through the document upload
// path, which registers stored bytes on a retry instead of sending them again.
// Then one `work_artifact.draft` operation attaches the draft and its photos:
// a resend repeats the operation id, so the server writes one revision. The
// server's outcome decides what stays on the phone, never the device.

const OPERATIONS_PATH = '/api/field-sync/v1/operations';
/** The operation kind `lib/field-sync/work-artifact-draft.ts` accepts. */
const DRAFT_KIND = 'work_artifact.draft';

/** What a send left of one draft. */
export type DraftSendOutcome =
  /** The server holds the draft; the phone no longer does. */
  | 'sent'
  /** No answer yet: no signal, a server failure or a session that needs a new sign-in. The draft waits. */
  | 'waiting'
  /** The server refused it; the person decides what happens to it. */
  | 'refused'
  /** The person lost access to the job; the draft is never sent again. */
  | 'no_access'
  /** Nothing was sent: the draft is gone, open in the editor, incomplete or past its limit. */
  | 'skipped';

/** The photo upload running now: which draft, and how many of its photos storage already holds. */
export type DraftSendProgress = { draftId: string; uploaded: number; total: number };

/** Whether nobody sends the draft automatically any more: the person has not changed it for seven days. */
export function isPastUnsentLimit(draft: StoredDraft, now: Date = new Date()): boolean {
  return now.getTime() - Date.parse(draft.updatedAt) > DRAFT_UNSENT_LIMIT_MS;
}

let holder: DraftHolder | null = null;
/**
 * The wipe signal when the page named the holder (today-wipe.ts). Every sign-out and every sign-in
 * page writes a new one, so a tab whose session may now belong to someone else sends nothing more
 * until a page names its holder again.
 */
let holderGeneration: string | null = null;

/** Whether this tab may still send for the holder it was given: no sign-out or sign-in page came since. */
function stillHolder(): boolean {
  return holderGeneration !== null && todayWipeGeneration() === holderGeneration;
}
let progress: DraftSendProgress | null = null;
let listening = false;
/** One send at a time: two triggers never upload the same photo twice. */
let queue: Promise<unknown> = Promise.resolve();
const openInEditor = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Tells `listener` whenever a draft or the upload progress changed. Returns the unsubscribe. */
export function subscribeToDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function draftSendProgress(): DraftSendProgress | null {
  return progress;
}

/** Tells every list of this tab that the editor changed a draft on the device. */
export function draftChangedOnDevice(): void {
  notify();
}

/** Marks a draft as open in this tab's editor until the returned function runs: it is not sent by itself meanwhile. */
export function keepDraftOpen(draftId: string): () => void {
  openInEditor.add(draftId);
  return () => openInEditor.delete(draftId);
}

const verdictSchema = z.object({ outcome: z.string(), code: z.string() });
const answerSchema = z.union([z.object({ results: z.array(verdictSchema).length(1) }), verdictSchema]);

/** The server's verdict on the one operation sent, or null when no readable answer came. */
async function attach(draft: StoredDraft): Promise<{ outcome: string; code: string; status: number } | null> {
  try {
    const response = await fetch(OPERATIONS_PATH, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            operationId: draft.operationId,
            kind: DRAFT_KIND,
            capturedAt: draft.updatedAt,
            sentAt: new Date().toISOString(),
            organizationId: draft.organizationId,
            payload: {
              artifactId: draft.id,
              revisionId: draft.revisionId,
              authorId: draft.userId,
              jobId: draft.jobId,
              kind: draft.kind,
              visibility: draft.visibility,
              capturedAt: draft.capturedAt,
              title: draft.title,
              content: draft.content,
              photos: draft.photos.map((photo) => ({ linkId: photo.id, documentId: photo.documentId })),
            },
          },
        ],
      }),
    });
    const answer = answerSchema.safeParse(await response.json());
    if (!answer.success) return null;
    const verdict = 'results' in answer.data ? answer.data.results[0] : answer.data;
    return verdict ? { ...verdict, status: response.status } : null;
  } catch {
    // best-effort: without signal, or with a page that is no answer, the draft waits for the next send.
    return null;
  }
}

/**
 * Whether the server still lets the person see the job's Arbeitsnachweise. The upload path names
 * no reason for a refusal, so the reader of that list answers: it applies the same job access rule.
 * Null when it could not be asked.
 */
async function lostJobAccess(jobId: string): Promise<boolean | null> {
  const read = await readInBackground('work-artifacts', { targetType: 'job', targetId: jobId });
  if (read.success) return false;
  if (read.error === 'background_read_failed' || read.error === 'load_failed') return null;
  return read.error === 'not_authorized' || read.error === 'no_active_org' || read.error === 'not_a_member';
}

/** Upload failures another try can mend: no signal, a slow transfer, storage or the server failing for now. */
const WAITING_UPLOAD_REASONS: ReadonlySet<UploadFailureReason> = new Set([
  'interrupted',
  'timeout',
  'storage_refused',
  'not_saved',
]);

function refusedNow(kind: DraftRefusal['kind']): DraftRefusal {
  return { kind, at: new Date().toISOString() };
}

/** Uploads the photos storage does not hold yet. Returns null when all are saved, else what the draft is left as. */
async function uploadPhotos(owner: DraftHolder, draft: StoredDraft): Promise<DraftSendOutcome | null> {
  let uploaded = draft.photos.filter((photo) => photo.documentId !== null).length;
  for (const photo of draft.photos) {
    if (photo.documentId !== null) continue;
    if (!stillHolder()) return 'waiting';
    // A sign-out or a sign-in page in another tab during the transfer aborts it: the photo must not
    // be registered with the next person's session.
    const transfer = new AbortController();
    const abortOnWipe = (event: StorageEvent): void => {
      if (event.key === TODAY_WIPE_KEY || event.key === null) transfer.abort();
    };
    window.addEventListener('storage', abortOnWipe);
    progress = { draftId: draft.id, uploaded, total: draft.photos.length };
    notify();
    const result = await uploadDocumentDirect({
      file: new File([photo.blob], photo.name, { type: photo.blob.type }),
      target: { kind: 'job', jobId: draft.jobId },
      category: 'photo',
      transferred: photo.transferred,
      signal: transfer.signal,
    }).finally(() => window.removeEventListener('storage', abortOnWipe));
    if (!stillHolder()) return 'waiting';
    // A saved upload whose answer names no document was registered by an earlier try's lost answer.
    const documentId =
      result.status === 'saved' ? (result.saved?.id ?? photo.transferred?.documentId ?? null) : null;
    const transferred = result.status === 'failed' ? result.transferred : photo.transferred;
    const kept = await changeDraftOnDevice(owner, draft.id, (current) =>
      // A sealed draft may be on the server as it is: an upload that ends later never changes it.
      current && !current.sealed
        ? {
            ...current,
            photos: current.photos.map((entry) =>
              entry.id === photo.id ? { ...entry, documentId, transferred } : entry,
            ),
          }
        : current,
    );
    if (!kept || kept.sealed) return null;
    if (documentId !== null) {
      uploaded += 1;
      continue;
    }
    const reason = result.status === 'failed' ? result.reason : null;
    if (reason !== null && WAITING_UPLOAD_REASONS.has(reason)) return 'waiting';
    const lost = reason === 'refused' ? await lostJobAccess(draft.jobId) : false;
    if (lost === null) return 'waiting';
    await markRefused(owner, draft.id, lost ? 'no_access' : 'failed');
    return lost ? 'no_access' : 'refused';
  }
  return null;
}

async function markRefused(owner: DraftHolder, draftId: string, kind: DraftRefusal['kind']): Promise<void> {
  // A refusal is a known answer: the server holds nothing of it, so the draft may change again.
  await changeDraftOnDevice(owner, draftId, (current) =>
    current ? { ...current, sealed: false, refusal: refusedNow(kind) } : null,
  );
}

/** How often one send uploads photos another tab added meanwhile before it leaves the rest for the next send. */
const UPLOAD_PASSES = 3;

/**
 * Uploads the draft's photos and seals it, checked in the seal's own transaction: a photo another
 * tab added meanwhile is uploaded in the next pass, so a sealed draft always names every photo.
 * Answers the sealed draft, or what the draft is left as.
 */
async function uploadAndSeal(
  owner: DraftHolder,
  first: StoredDraft,
): Promise<StoredDraft | DraftSendOutcome> {
  let draft = first;
  for (let pass = 0; pass < UPLOAD_PASSES; pass += 1) {
    if (!stillHolder()) return 'waiting';
    const left = draft.sealed ? null : await uploadPhotos(owner, draft);
    if (left !== null) return left;
    if (!stillHolder()) return 'waiting';
    // Sealed before the request leaves: from here the server may hold the draft, whatever answer arrives.
    const current = await changeDraftOnDevice(owner, draft.id, (stored) =>
      stored && (stored.sealed || stored.photos.every((photo) => photo.documentId !== null))
        ? { ...stored, sealed: true, refusal: null }
        : stored,
    );
    if (!current) return 'skipped';
    if (current.sealed) return current;
    draft = current;
  }
  return 'waiting';
}

/** Sends one draft of the holder. `byPerson` is „Erneut senden“ or a save: it also sends a refused or old draft. */
async function sendOne(owner: DraftHolder, draftId: string, byPerson: boolean): Promise<DraftSendOutcome> {
  const draft = (await listDraftsOnDevice(owner)).find((entry) => entry.id === draftId);
  if (!draft) return 'skipped';
  if (draft.refusal?.kind === 'no_access') return 'no_access';
  if (!draft.ready) return 'skipped';
  if (!byPerson && (openInEditor.has(draftId) || draft.refusal !== null || isPastUnsentLimit(draft)))
    return 'skipped';
  const sealed = await uploadAndSeal(owner, draft);
  if (typeof sealed === 'string') return sealed;
  const verdict = await attach(sealed);
  if (verdict === null) return 'waiting';
  if (verdict.outcome === 'accepted' || verdict.outcome === 'replayed') {
    await changeDraftOnDevice(owner, draftId, () => null);
    return 'sent';
  }
  // An unknown outcome of a newer server is a retry for a server failure and a refusal otherwise.
  const retry =
    verdict.outcome === 'retry' ||
    (verdict.outcome !== 'rejected' && verdict.outcome !== 'conflict' && verdict.status >= 500);
  if (retry) return 'waiting';
  // The session's active organization moved on; the draft waits for its own, still sealed: an earlier
  // send may have arrived, and only a resend of the same content can learn that.
  if (verdict.outcome === 'rejected' && verdict.code === 'organization_mismatch') return 'waiting';
  const lost = verdict.outcome === 'rejected' && verdict.code === 'forbidden';
  await markRefused(owner, draftId, lost ? 'no_access' : 'failed');
  return lost ? 'no_access' : 'refused';
}

/**
 * Runs one send while no other tab of the phone sends: two tabs never upload the same photo twice
 * or attach different photos under one operation. A browser without the Web Locks API sends
 * within the tab only.
 */
function acrossTabs<T>(run: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? locks.request('werkflow-draft-send', run) : run();
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  const result = queue.then(() => acrossTabs(run));
  queue = result.catch((error: unknown) => {
    // A full or refused device store: the draft stays as it was, and the list shows its own read failure.
    logError('draft sync: send failed', error);
  });
  return result;
}

async function finishSend<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } finally {
    progress = null;
    notify();
  }
}

/**
 * Sends every draft of the holder that may go by itself: complete, not open in this tab's
 * editor, not refused and changed within the last seven days. It stops at the first draft that
 * gets no answer, so a phone without signal tries once, not once per draft.
 */
function sendDrafts(): Promise<void> {
  const owner = holder;
  if (!owner) return Promise.resolve();
  return enqueue(() =>
    finishSend(async () => {
      for (const draft of await listDraftsOnDevice(owner)) {
        if ((await sendOne(owner, draft.id, false)) === 'waiting') return;
      }
    }),
  );
}

/** Sends one draft now because the person asked: „Erneut senden“ or a save in the editor. */
export function sendDraft(owner: DraftHolder, draftId: string): Promise<DraftSendOutcome> {
  return enqueue(() => finishSend(() => sendOne(owner, draftId, true)));
}

/**
 * The drafts as unsent work, for the sign-out and the organization switch (decision record 0010,
 * "Device data"): they name what is left, send it or delete it. It answers for the holder
 * `startDraftSync` named; a tab that never named one holds no draft it could show.
 */
const draftUnsentSource = {
  name: 'report-drafts',
  async summarize(): Promise<{ label: string; count: number }[]> {
    if (!holder) return [];
    const drafts = await listDraftsOnDevice(holder);
    const withoutAccess = drafts.filter((draft) => draft.refusal?.kind === 'no_access').length;
    return [
      { label: 'Berichtsentwürfe', count: drafts.length - withoutAccess },
      { label: 'Berichtsentwürfe ohne Zugriff', count: withoutAccess },
    ].filter((item) => item.count > 0);
  },
  flush: sendDrafts,
  async discard(): Promise<void> {
    if (!holder) return;
    await deleteDraftsOnDevice(holder);
    notify();
  },
};

/**
 * Names the person and organization the drafts are sent for, sends now and again on every
 * `online`. It answers the sender and the unsent-work source of the drafts: once the sync runner
 * of the clock outbox is on `main` (werk-flow/werkflow-planning#319), that runner registers both
 * (`registerSender`, `registerUnsentSource`) and owns the triggers this function holds until then.
 */
export function startDraftSync(next: DraftHolder): {
  send: () => Promise<void>;
  unsentSource: typeof draftUnsentSource;
} {
  holder = next;
  holderGeneration = todayWipeGeneration();
  if (!listening) {
    listening = true;
    window.addEventListener('online', () => void sendDrafts());
  }
  void sendDrafts();
  return { send: sendDrafts, unsentSource: draftUnsentSource };
}
