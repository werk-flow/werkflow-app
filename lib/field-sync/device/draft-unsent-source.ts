'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatBerlin } from '@/lib/utils';
import { WORK_ARTIFACT_KIND_LABELS } from '@/lib/work-artifacts/types';
import {
  listDraftsInScopeOnDevice,
  type DraftScope,
  type ShownDrafts,
  type StoredDraft,
  type HeldUnreadableDraft,
} from './draft-store';
import { deleteShownDrafts, isPastUnsentLimit, pageHolder, sendDraftsBeforeSessionEnd } from './draft-sync';
import { readTodayOnDevice } from './today-store';
import {
  UnsentWorkBusyError,
  type UnsentReason,
  type UnsentScope,
  type UnsentSource,
  type UnsentWorkItem,
} from './unsent-work';

// The report drafts as the unsent work a session end asks about (decision record 0010, the
// amendment "a session end asks about report drafts"). Only registrations.ts loads this module, so
// what names a draft for the question (the session read, today's jobs on the phone, the labels)
// never joins the draft code a job page loads once it is idle; the sending and the deletion stay
// with the sender (draft-sync.ts), which holds the queue and the page's holder.

/**
 * The person whose drafts a session end asks about, and the organization when the flow leaves only
 * one: the page's holder, else the person of the browser's session. A switch without a page that
 * named the organization asks as a sign-out does, about every organization: more, never less.
 * Throws when the session cannot be read: the session then stays.
 */
async function sessionScope(scope: UnsentScope): Promise<DraftScope | null> {
  const page = pageHolder();
  if (page)
    return { userId: page.userId, organizationId: scope === 'organization' ? page.organizationId : null };
  const { data, error } = await createSupabaseBrowserClient().auth.getSession();
  if (error) throw error;
  return data.session ? { userId: data.session.user.id, organizationId: null } : null;
}

/**
 * The labels of the person's jobs of today that the phone holds, by job id; empty when it holds none,
 * and null when the phone could not read them.
 */
async function todaysJobLabels(userId: string): Promise<ReadonlyMap<string, string> | null> {
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
    // A draft without its job's name is still named by its title; the question says the names are missing.
    return null;
  }
}

/** The line the question shows when the phone could not read which jobs the drafts belong to. */
const JOBS_UNREAD_NOTE = 'Die Auftragsnamen konnten gerade nicht geladen werden.';

function detailLine(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(' · ');
}

/** What the question says of a readable draft: its title, state, kind, photos, last change and job. */
function draftEntry(
  draft: StoredDraft,
  jobs: ReadonlyMap<string, string> | null,
): { name: string; detail: string; reason: UnsentReason } {
  const photos = draft.photos.length;
  const reason = draftReason(draft);
  const state =
    reason === 'no_access'
      ? 'Kein Zugriff mehr, wird nicht gesendet'
      : reason === 'refused' || isPastUnsentLimit(draft)
        ? 'Nicht übertragen'
        : reason === 'incomplete'
          ? 'Unvollständig'
          : null;
  return {
    name: draft.title.trim() || 'Ohne Titel',
    reason,
    detail: detailLine([
      state,
      WORK_ARTIFACT_KIND_LABELS[draft.kind],
      photos === 0 ? null : `${photos} ${photos === 1 ? 'Foto' : 'Fotos'}`,
      `geändert ${formatBerlin(draft.updatedAt, 'dateTime')}`,
      jobs?.get(draft.jobId) ?? null,
    ]),
  };
}

/** Why the question's send left the draft: what keeps it from going, else the network. */
function draftReason(draft: StoredDraft): UnsentReason {
  if (draft.refusal?.kind === 'no_access') return 'no_access';
  if (draft.refusal !== null) return 'refused';
  return draft.ready ? 'waiting' : 'incomplete';
}

/** A shown draft's id: the draft and the state it was shown in, so a later change is asked about anew. */
const SHOWN_DRAFT = 'draft:';
const SHOWN_UNREADABLE = 'draft-unreadable:';

function shownDraftId(draft: StoredDraft): string {
  return `${SHOWN_DRAFT}${draft.id}:${draft.updatedAt}`;
}

/**
 * A stable text of a stored record: object keys in order, a photo by its size and type. Records come
 * from IndexedDB, so they hold only what structured cloning keeps.
 */
function stableText(value: unknown): string {
  if (value instanceof Blob) return `blob:${value.size}:${value.type}`;
  if (value instanceof Date) return `date:${value.getTime()}`;
  if (value instanceof Map) return `map:${stableText([...value])}`;
  if (value instanceof Set) return `set:${stableText([...value])}`;
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  if (typeof value === 'object' && value !== null)
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableText(entry)}`)
      .join(',')}}`;
  return typeof value === 'string' ? JSON.stringify(value) : `${typeof value}:${String(value)}`;
}

/**
 * The version of an unreadable record: a digest of all it holds (cyrb53), so any change of any field
 * is a new version. This version reads no change time from such a record, so its content is the token.
 */
function unreadableVersion(record: unknown): string {
  const text = stableText(record);
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
  return (4294967296 * (2097151 & second) + (first >>> 0)).toString(36);
}

/** The ids and the shown states among the ids with `prefix` (`<prefix><id>:<state>`). */
function shownStates(ids: readonly string[], prefix: string): ReadonlyMap<string, string> {
  const states = new Map<string, string>();
  for (const id of ids) {
    if (!id.startsWith(prefix)) continue;
    const shown = id.slice(prefix.length);
    const separator = shown.indexOf(':');
    if (separator > 0) states.set(shown.slice(0, separator), shown.slice(separator + 1));
  }
  return states;
}

/** The drafts among the ids a question showed; ids of other sources are ignored. */
function shownDrafts(ids: readonly string[]): ShownDrafts {
  const unreadable = shownStates(ids, SHOWN_UNREADABLE);
  return {
    drafts: shownStates(ids, SHOWN_DRAFT),
    unreadable: (draft) => unreadable.get(draft.id) === unreadableVersion(draft.record),
  };
}

function item(
  label: string,
  entries: readonly { id: string; name: string; detail: string; reason: UnsentReason }[],
): UnsentWorkItem {
  return {
    label,
    count: entries.length,
    ids: entries.map((entry) => entry.id),
    entries: entries.map(({ id, name, detail, reason }) => ({ id, name, detail, reason })),
  };
}

/** An unreadable record in the state it was shown: a later rewrite under its id is asked about anew. */
function unreadableEntry(draft: HeldUnreadableDraft, jobs: ReadonlyMap<string, string> | null) {
  return {
    id: `${SHOWN_UNREADABLE}${draft.id}:${unreadableVersion(draft.record)}`,
    name: 'Entwurf lässt sich nicht öffnen',
    reason: 'unreadable' as const,
    detail: detailLine(['Nicht lesbar', draft.jobId === null ? null : (jobs?.get(draft.jobId) ?? null)]),
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
    const items = [
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
    const [first, ...rest] = items;
    return jobs === null && first ? [{ ...first, note: JOBS_UNREAD_NOTE }, ...rest] : items;
  },
  async flush() {
    const person = await sessionScope('session');
    if (person) await sendDraftsBeforeSessionEnd(person);
  },
  async discard(scope, ids) {
    if (!ids.some((id) => id.startsWith(SHOWN_DRAFT) || id.startsWith(SHOWN_UNREADABLE))) return;
    const shown = shownDrafts(ids);
    const person = await sessionScope(scope);
    if (person && !(await deleteShownDrafts(person, shown))) throw new UnsentWorkBusyError();
  },
};
