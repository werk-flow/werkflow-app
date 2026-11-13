'use client';

import { readInBackground } from '@/lib/data/background-read-client';
import { uploadDocumentDirect, type UploadFailureReason } from '@/lib/documents/upload-client';
import { logError } from '@/lib/logging';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatBerlin } from '@/lib/utils';
import { WORK_ARTIFACT_KIND_LABELS } from '@/lib/work-artifacts/types';
import { z } from '@/lib/zod';
import {
  DRAFT_UNSENT_LIMIT_MS,
  changeDraftOnDevice,
  deleteShownDraftsOnDevice,
  listDraftsInScopeOnDevice,
  listDraftsOnDevice,
  type DraftHolder,
  type DraftRefusal,
  type DraftScope,
  type ShownDrafts,
  type StoredDraft,
  type UnreadableDraft,
} from './draft-store';
import { readTodayOnDevice } from './today-store';
import { TODAY_WIPE_KEY, todayWipeGeneration } from './today-wipe';
import type { UnsentScope, UnsentSource, UnsentWorkItem } from './unsent-work';
import { createListeners } from '@/lib/listeners';

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
  | 'skipped'
  /**
   * Nothing was sent: the save asked for one state of the draft, and another tab changed or sealed it
   * since. The saving form keeps its text.
   */
  | 'changed';

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

/**
 * A send's claim on the tab: the person it was queued for and the wipe signal of that moment. It
 * holds while no sign-out or sign-in page wrote a new signal and no page named another person. A
 * claim `byPage` comes from the page that named the holder; otherwise a session end made it for the
 * person its session read named, and it holds while no page of this tab names someone else.
 */
type SendClaim = { owner: DraftHolder; generation: string | null; byPage: boolean };

function claimFor(owner: DraftHolder): SendClaim {
  const named =
    holder !== null && holder.userId === owner.userId && holder.organizationId === owner.organizationId;
  return { owner, generation: named ? holderGeneration : null, byPage: true };
}

function stillHolder(claim: SendClaim): boolean {
  if (claim.generation === null || todayWipeGeneration() !== claim.generation) return false;
  if (!claim.byPage) return holder === null || holder.userId === claim.owner.userId;
  return (
    claim.generation === holderGeneration &&
    holder?.userId === claim.owner.userId &&
    holder.organizationId === claim.owner.organizationId
  );
}

/** The holder the page of this tab named, while no sign-out or sign-in page wrote a wipe signal since. */
function pageHolder(): DraftHolder | null {
  return holderGeneration === todayWipeGeneration() ? holder : null;
}

/** The photo transfer running now: a page that names another person aborts it. */
let activeTransfer: AbortController | null = null;
let progress: DraftSendProgress | null = null;
let listening = false;
/** One send at a time: two triggers never upload the same photo twice. */
let queue: Promise<unknown> = Promise.resolve();
/** Each open editor's guard per draft: a draft is open while any editor of it holds one. */
const openInEditor = new Map<string, Set<symbol>>();
const { subscribe, notify } = createListeners();

/** Tells `listener` whenever a draft or the upload progress changed. Returns the unsubscribe. */
export function subscribeToDrafts(listener: () => void): () => void {
  return subscribe(listener);
}

export function draftSendProgress(): DraftSendProgress | null {
  return progress;
}

/** Tells every list of this tab that the editor changed a draft on the device. */
export function draftChangedOnDevice(): void {
  notify();
}

/**
 * Marks a draft as open in one editor of this tab until the returned function runs: it is not sent
 * by itself meanwhile. Each editor holds its own guard, so a release that comes late, after the
 * draft was opened again, removes only its own.
 */
export function keepDraftOpen(draftId: string): () => void {
  const guard = Symbol(draftId);
  const guards = openInEditor.get(draftId) ?? new Set<symbol>();
  guards.add(guard);
  openInEditor.set(draftId, guards);
  return () => {
    guards.delete(guard);
    if (guards.size === 0 && openInEditor.get(draftId) === guards) openInEditor.delete(draftId);
  };
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
async function uploadPhotos(claim: SendClaim, draft: StoredDraft): Promise<DraftSendOutcome | null> {
  const { owner } = claim;
  let uploaded = draft.photos.filter((photo) => photo.documentId !== null).length;
  for (const photo of draft.photos) {
    if (photo.documentId !== null) continue;
    if (!stillHolder(claim)) return 'waiting';
    // A sign-out or a sign-in page in another tab during the transfer aborts it: the photo must not
    // be registered with the next person's session.
    const transfer = new AbortController();
    activeTransfer = transfer;
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
      expectedUploaderId: owner.userId,
    }).finally(() => {
      window.removeEventListener('storage', abortOnWipe);
      if (activeTransfer === transfer) activeTransfer = null;
    });
    if (!stillHolder(claim)) return 'waiting';
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
    // Another person's session: like every other stop of that kind, the draft waits for its author.
    if (reason === 'uploader_changed') return 'waiting';
    if (reason !== null && WAITING_UPLOAD_REASONS.has(reason)) return 'waiting';
    // The access read and the refusal speak for the author only while the tab is still theirs.
    if (!stillHolder(claim)) return 'waiting';
    const lost = reason === 'refused' ? await lostJobAccess(draft.jobId) : false;
    if (lost === null || !stillHolder(claim)) return 'waiting';
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
/** Whether the browser says it has no network: then nothing is sent, and no draft is sealed for nothing. */
function knownOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function uploadAndSeal(
  claim: SendClaim,
  first: StoredDraft,
  expected: string | null,
): Promise<{ sealed: StoredDraft; sealedHere: boolean } | DraftSendOutcome> {
  let draft = first;
  let changed = false;
  let sealedHere = false;
  for (let pass = 0; pass < UPLOAD_PASSES; pass += 1) {
    if (!stillHolder(claim) || knownOffline()) return 'waiting';
    const left = draft.sealed ? null : await uploadPhotos(claim, draft);
    if (left !== null) return left;
    if (!stillHolder(claim)) return 'waiting';
    // Sealed before the request leaves: from here the server may hold the draft, whatever answer arrives.
    const current = await changeDraftOnDevice(claim.owner, draft.id, (stored) => {
      // A save that decided on one state of the draft never seals another tab's.
      changed = expected !== null && stored !== null && stored.updatedAt !== expected;
      const seals =
        stored !== null &&
        !changed &&
        (stored.sealed || stored.photos.every((photo) => photo.documentId !== null));
      // Whether an attach of the draft may still be open from before: then only its answer unseals it.
      sealedHere = seals && !stored.sealed;
      return seals ? { ...stored, sealed: true, refusal: null } : stored;
    });
    if (!current) return 'skipped';
    if (changed) return 'changed';
    if (current.sealed) return { sealed: current, sealedHere };
    draft = current;
  }
  return 'waiting';
}

/**
 * Who asked for a send. `automatic`: a trigger, which sends only a draft that may go by itself.
 * `session_end`: „Jetzt senden“ before a session ends, which also sends a draft unchanged for seven
 * days. `person`: „Erneut senden“ or a save, which also sends a refused draft and one open in an editor.
 */
type SendPolicy = 'automatic' | 'session_end' | 'person';

/** Sends one draft of the holder under `policy`. */
async function sendOne(
  claim: SendClaim,
  draftId: string,
  policy: SendPolicy,
  expected: string | null = null,
): Promise<DraftSendOutcome> {
  const { owner } = claim;
  const draft = (await listDraftsOnDevice(owner)).find((entry) => entry.id === draftId);
  if (!draft) return 'skipped';
  if (expected !== null && draft.updatedAt !== expected) return 'changed';
  if (draft.refusal?.kind === 'no_access') return 'no_access';
  if (!draft.ready) return 'skipped';
  if (
    policy !== 'person' &&
    (openInEditor.has(draftId) ||
      draft.refusal !== null ||
      (policy === 'automatic' && isPastUnsentLimit(draft)))
  )
    return 'skipped';
  const prepared = await uploadAndSeal(claim, draft, expected);
  if (prepared === 'waiting' && expected !== null) {
    // A save that waits closes its form: only while the draft still holds what that save decided on.
    const now = (await listDraftsOnDevice(owner)).find((entry) => entry.id === draftId);
    if (now?.updatedAt !== expected) return 'changed';
  }
  if (typeof prepared === 'string') return prepared;
  const { sealed, sealedHere } = prepared;
  // The seal's transaction can outlast a sign-in elsewhere: the claim is checked again right before the request.
  if (!stillHolder(claim)) return 'waiting';
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
  // A refusal that came while the tab changed hands may answer another person's session: it says nothing about the author.
  if (retry || !stillHolder(claim)) return 'waiting';
  // The session's active organization is another one; the draft waits for its own. Still sealed when an
  // earlier attach may have arrived, since only a resend of the same content can learn that; unsealed
  // when this send sealed it, because the server refused this one before it wrote anything.
  if (verdict.outcome === 'rejected' && verdict.code === 'organization_mismatch') {
    if (sealedHere)
      await changeDraftOnDevice(owner, draftId, (current) =>
        current?.sealed && current.updatedAt === sealed.updatedAt ? { ...current, sealed: false } : current,
      );
    return 'waiting';
  }
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
  // `then` flattens the lock's answer: the DOM typing returns the callback's promise wrapped once more.
  return locks ? locks.request('werkflow-draft-send', run).then((result) => result) : run();
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
export function sendDrafts(): Promise<void> {
  const owner = holder;
  if (!owner) return Promise.resolve();
  return sendEach(claimFor(owner), 'automatic');
}

/** Sends the claim's drafts one after the other under `policy`, until one gets no answer. */
function sendEach(claim: SendClaim, policy: SendPolicy): Promise<void> {
  return enqueue(() =>
    finishSend(async () => {
      for (const draft of await listDraftsOnDevice(claim.owner)) {
        if ((await sendOne(claim, draft.id, policy)) === 'waiting') return;
      }
    }),
  );
}

/** Sends one draft now because the person asked: „Erneut senden“ or a save in the editor. */
export function sendDraft(
  owner: DraftHolder,
  draftId: string,
  /** The draft's last-change time the person's save decided on: another state is never sent. */
  expected: string | null = null,
): Promise<DraftSendOutcome> {
  const claim = claimFor(owner);
  return enqueue(() => finishSend(() => sendOne(claim, draftId, 'person', expected)));
}

/**
 * The person whose drafts a session end asks about, and the organization when the flow leaves only
 * one: the page's holder, else the person of the browser's session. A switch without a page that
 * named the organization asks as a sign-out does, about every organization: more, never less.
 * Throws when the session cannot be read: the session then stays.
 */
async function sessionScope(scope: UnsentScope): Promise<DraftScope | null> {
  const page = pageHolder();
  if (page) return { userId: page.userId, organizationId: scope === 'organization' ? page.organizationId : null };
  const { data, error } = await createSupabaseBrowserClient().auth.getSession();
  if (error) throw error;
  return data.session ? { userId: data.session.user.id, organizationId: null } : null;
}

/** The labels of the person's jobs of today that the phone holds, by job id; empty when it holds none. */
async function todaysJobLabels(userId: string): Promise<ReadonlyMap<string, string>> {
  try {
    const today = await readTodayOnDevice();
    if (!today || today.snapshot.userId !== userId) return new Map();
    return new Map(
      today.snapshot.assignments.map((job) => [
        job.jobId,
        job.jobNumber ? `${job.jobNumber} ${job.title}` : job.title,
      ]),
    );
  } catch {
    // best-effort: a draft without its job's name is still named by its title.
    return new Map();
  }
}

function joined(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(' · ');
}

/** What the question says of a readable draft: its title, state, kind, photos, last change and job. */
function draftEntry(draft: StoredDraft, jobs: ReadonlyMap<string, string>): { name: string; detail: string } {
  const photos = draft.photos.length;
  const state =
    draft.refusal?.kind === 'no_access'
      ? 'Kein Zugriff mehr, wird nicht gesendet'
      : draft.refusal !== null || isPastUnsentLimit(draft)
        ? 'Nicht übertragen'
        : draft.ready
          ? null
          : 'Unvollständig';
  return {
    name: draft.title.trim() || 'Ohne Titel',
    detail: joined([
      state,
      WORK_ARTIFACT_KIND_LABELS[draft.kind],
      photos === 0 ? null : `${photos} ${photos === 1 ? 'Foto' : 'Fotos'}`,
      `geändert ${formatBerlin(draft.updatedAt, 'dateTime')}`,
      jobs.get(draft.jobId) ?? null,
    ]),
  };
}

/** A shown draft's id: the draft and the state it was shown in, so a later change is asked about anew. */
const SHOWN_DRAFT = 'draft:';
const SHOWN_UNREADABLE = 'draft-unreadable:';

function shownDraftId(draft: StoredDraft): string {
  return `${SHOWN_DRAFT}${draft.id}:${draft.updatedAt}`;
}

/** The drafts among the ids a question showed; ids of other sources are ignored. */
function shownDrafts(ids: readonly string[]): ShownDrafts {
  const drafts = new Map<string, string>();
  const unreadable = new Set<string>();
  for (const id of ids) {
    if (id.startsWith(SHOWN_UNREADABLE)) unreadable.add(id.slice(SHOWN_UNREADABLE.length));
    if (!id.startsWith(SHOWN_DRAFT)) continue;
    const shown = id.slice(SHOWN_DRAFT.length);
    const separator = shown.indexOf(':');
    if (separator > 0) drafts.set(shown.slice(0, separator), shown.slice(separator + 1));
  }
  return { drafts, unreadable };
}

function item(label: string, entries: readonly { id: string; name: string; detail: string }[]): UnsentWorkItem {
  return {
    label,
    count: entries.length,
    ids: entries.map((entry) => entry.id),
    entries: entries.map(({ id, name, detail }) => ({ id, name, detail })),
  };
}

function unreadableEntry(draft: UnreadableDraft, jobs: ReadonlyMap<string, string>) {
  return {
    id: `${SHOWN_UNREADABLE}${draft.id}`,
    name: 'Entwurf lässt sich nicht öffnen',
    detail: joined(['Nicht lesbar', draft.jobId === null ? null : (jobs.get(draft.jobId) ?? null)]),
  };
}

/**
 * The drafts as unsent work (unsent-work.ts) for every session end (decision record 0010, the
 * amendment "a session end asks about report drafts"): the person's drafts in the flow's scope, each
 * named by what the person recognizes, never by its text. A lost-access draft is named apart and
 * never sent, and one this version cannot read is named as such.
 */
export const draftUnsentSource: UnsentSource = {
  name: 'report-drafts',
  async summarize(scope = 'session') {
    const person = await sessionScope(scope);
    if (!person) return [];
    const { drafts, unreadable } = await listDraftsInScopeOnDevice(person);
    if (drafts.length === 0 && unreadable.length === 0) return [];
    const jobs = await todaysJobLabels(person.userId);
    const named = drafts.map((draft) => ({ ...draftEntry(draft, jobs), id: shownDraftId(draft), draft }));
    return [
      item(
        'Berichtsentwürfe',
        named.filter(({ draft }) => draft.refusal?.kind !== 'no_access'),
      ),
      item(
        'Berichtsentwürfe ohne Zugriff',
        named.filter(({ draft }) => draft.refusal?.kind === 'no_access'),
      ),
      item(
        'Berichtsentwürfe, die diese App-Version nicht lesen kann',
        unreadable.map((draft) => unreadableEntry(draft, jobs)),
      ),
    ].filter((entry) => entry.count > 0);
  },
  async flush() {
    const person = await sessionScope('session');
    if (!person) return;
    const page = pageHolder();
    const { drafts } = await listDraftsInScopeOnDevice(person);
    // The page's organization first: it is the active one, whose drafts the server takes now.
    const organizations = [...new Set(drafts.map((draft) => draft.organizationId))].sort(
      (left, right) => Number(right === page?.organizationId) - Number(left === page?.organizationId),
    );
    for (const organizationId of organizations) {
      const owner = { userId: person.userId, organizationId };
      const named = page?.userId === owner.userId && page.organizationId === organizationId;
      await sendEach(
        named ? claimFor(owner) : { owner, generation: todayWipeGeneration(), byPage: false },
        'session_end',
      );
    }
  },
  async discard(scope, ids) {
    const shown = shownDrafts(ids);
    if (shown.drafts.size === 0 && shown.unreadable.size === 0) return;
    const person = await sessionScope(scope);
    if (!person) return;
    // After a send in flight, in this tab and every other: the server never gets a draft the person was told is gone.
    await enqueue(() => deleteShownDraftsOnDevice(person, shown));
    notify();
  },
};

/**
 * Names the person and organization the drafts are sent for, sends now and again on every
 * `online`, and answers the send. The sync runner and the unsent-work seam reach the drafts through
 * registrations.ts; a job page calls this, because the runner loads at the app start only for time.
 */
export function startDraftSync(next: DraftHolder): { send: () => Promise<void> } {
  if (holder && (holder.userId !== next.userId || holder.organizationId !== next.organizationId))
    activeTransfer?.abort();
  holder = next;
  holderGeneration = todayWipeGeneration();
  if (!listening) {
    listening = true;
    window.addEventListener('online', () => void sendDrafts());
  }
  void sendDrafts();
  return { send: sendDrafts };
}
