'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatBerlin } from '@/lib/utils';
import { WORK_ARTIFACT_KIND_LABELS } from '@/lib/work-artifacts/types';
import {
  listDraftsInScopeOnDevice,
  type DraftScope,
  type ShownDrafts,
  type StoredDraft,
  type UnreadableDraft,
} from './draft-store';
import { deleteShownDrafts, isPastUnsentLimit, pageHolder, sendDraftsBeforeSessionEnd } from './draft-sync';
import { readTodayOnDevice } from './today-store';
import { UnsentWorkBusyError, type UnsentScope, type UnsentSource, type UnsentWorkItem } from './unsent-work';

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

function detailLine(parts: readonly (string | null)[]): string {
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
    detail: detailLine([
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

function item(
  label: string,
  entries: readonly { id: string; name: string; detail: string }[],
): UnsentWorkItem {
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
    detail: detailLine(['Nicht lesbar', draft.jobId === null ? null : (jobs.get(draft.jobId) ?? null)]),
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
    if (person) await sendDraftsBeforeSessionEnd(person);
  },
  async discard(scope, ids) {
    const shown = shownDrafts(ids);
    if (shown.drafts.size === 0 && shown.unreadable.size === 0) return;
    const person = await sessionScope(scope);
    if (person && !(await deleteShownDrafts(person, shown))) throw new UnsentWorkBusyError();
  },
};
