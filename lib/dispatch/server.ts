import 'server-only';

import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import {
  deriveRecipientState,
  latestAcknowledgementByRecipient,
  type AcknowledgementFact,
} from './derivation';
import type {
  DispatchRecipientDerivedState,
  DispatchRecipientView,
  DispatchView,
  EmployeeDispatchCard,
} from './types';

export type DispatchRow = Pick<
  Database['public']['Tables']['planning_dispatches']['Row'],
  'id' | 'organization_id' | 'occurrence_id' | 'job_id' | 'status' | 'current_revision_id'
>;

type AcknowledgementRow = Pick<
  Database['public']['Tables']['planning_dispatch_acknowledgements']['Row'],
  'id' | 'revision_id' | 'employee_record_id' | 'state' | 'reason' | 'challenge_resolved_at' | 'created_at'
>;

type ViewRevisionRow = Pick<
  Database['public']['Tables']['planning_dispatch_revisions']['Row'],
  'id' | 'revision_number' | 'change_kind' | 'occurrence_id' | 'dispatch_note' | 'created_at'
>;

export type EmployeeNameFacts = {
  displayName: string;
  hasLogin: boolean;
};

// Resolves display names and can-acknowledge state for employee records.
// "hasLogin" means the record is linked to a CURRENT active membership — an
// exited or never-linked record cannot acknowledge and shows the labeled
// "nicht möglich" state instead.
export async function loadEmployeeNameFacts(
  admin: AdminClient,
  orgId: string,
  employeeRecordIds: string[],
): Promise<Map<string, EmployeeNameFacts> | null> {
  const { data: records, error } = await readInBatches(employeeRecordIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (error) {
    logReadFailure('loadEmployeeNameFacts: employee records failed', error);
    return null;
  }
  const userIds = records.flatMap((record) => (record.user_id ? [record.user_id] : []));
  const [profilesResult, membersResult] = await Promise.all([
    readInBatches(userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...batch]),
    ),
    readInBatches(userIds, (batch) =>
      admin
        .from('organization_members')
        .select('user_id')
        .eq('organization_id', orgId)
        .in('user_id', [...batch]),
    ),
  ]);
  const namesError = profilesResult.error ?? membersResult.error;
  if (namesError) {
    logReadFailure('loadEmployeeNameFacts: profiles or memberships failed', namesError);
    return null;
  }
  const profileNames = new Map(
    profilesResult.data.map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ]),
  );
  const activeMemberIds = new Set(membersResult.data.map((member) => member.user_id));
  return new Map(
    records.map((record) => [
      record.id,
      {
        displayName:
          (record.user_id ? profileNames.get(record.user_id) : null) ||
          [record.first_name, record.last_name].filter(Boolean).join(' ') ||
          'Unbenannt',
        hasLogin: Boolean(record.user_id && activeMemberIds.has(record.user_id)),
      },
    ]),
  );
}

function toAcknowledgementFact(row: AcknowledgementRow): AcknowledgementFact {
  return {
    id: row.id,
    employeeRecordId: row.employee_record_id,
    state: row.state,
    reason: row.reason,
    challengeResolvedAt: row.challenge_resolved_at,
    createdAt: row.created_at,
  };
}

function toDispatchView(input: {
  dispatch: DispatchRow;
  revision: ViewRevisionRow;
  recipientIds: string[];
  acknowledgements: AcknowledgementFact[];
  nameFacts: Map<string, EmployeeNameFacts>;
}): DispatchView {
  const { dispatch, revision, nameFacts } = input;
  const latestByRecipient = latestAcknowledgementByRecipient(input.acknowledgements);
  const recipients: DispatchRecipientView[] = input.recipientIds.map((employeeRecordId) => {
    const facts = nameFacts.get(employeeRecordId);
    const latest = latestByRecipient.get(employeeRecordId) ?? null;
    const state = deriveRecipientState({
      hasLogin: facts?.hasLogin ?? false,
      latest,
    });
    return {
      employeeRecordId,
      displayName: facts?.displayName ?? 'Unbenannt',
      hasLogin: facts?.hasLogin ?? false,
      state,
      challengeReason: state === 'rueckfrage' ? (latest?.reason ?? null) : null,
      acknowledgementId: latest?.id ?? null,
    };
  });
  return {
    dispatchId: dispatch.id,
    status: dispatch.status,
    revisionId: revision.id,
    revisionNumber: revision.revision_number,
    changeKind: revision.change_kind,
    targetKind: revision.occurrence_id ? 'occurrence' : 'job',
    note: revision.dispatch_note,
    issuedAt: revision.created_at,
    recipients,
  };
}

function groupByRevision(
  recipients: Array<{ revision_id: string; employee_record_id: string }>,
  acknowledgements: AcknowledgementRow[],
): { recipientsByRevision: Map<string, string[]>; acksByRevision: Map<string, AcknowledgementFact[]> } {
  const recipientsByRevision = new Map<string, string[]>();
  for (const row of recipients) {
    const list = recipientsByRevision.get(row.revision_id) ?? [];
    list.push(row.employee_record_id);
    recipientsByRevision.set(row.revision_id, list);
  }
  const acksByRevision = new Map<string, AcknowledgementFact[]>();
  for (const row of acknowledgements) {
    const list = acksByRevision.get(row.revision_id) ?? [];
    list.push(toAcknowledgementFact(row));
    acksByRevision.set(row.revision_id, list);
  }
  return { recipientsByRevision, acksByRevision };
}

// Builds DispatchViews (current revision + derived recipient states) for a
// set of dispatch rows.
export async function loadDispatchViews(
  admin: AdminClient,
  orgId: string,
  dispatches: DispatchRow[],
): Promise<Map<string, DispatchView> | null> {
  const revisionIds = dispatches.flatMap((dispatch) =>
    dispatch.current_revision_id ? [dispatch.current_revision_id] : [],
  );
  if (revisionIds.length === 0) return new Map();
  // The revision list is organization-sized on the board (one per dispatched
  // occurrence of the window): id batches, and complete pages per batch.
  const [revisionsResult, recipientsResult, acksResult] = await Promise.all([
    readInBatches(revisionIds, (batch) =>
      admin
        .from('planning_dispatch_revisions')
        .select(
          'id, dispatch_id, revision_number, change_kind, occurrence_id, job_id, dispatch_note, created_at',
        )
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(revisionIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('planning_dispatch_recipients')
            .select('revision_id, employee_record_id')
            .eq('organization_id', orgId)
            .in('revision_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
    readInBatches(revisionIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('planning_dispatch_acknowledgements')
            .select('id, revision_id, employee_record_id, state, reason, challenge_resolved_at, created_at')
            .eq('organization_id', orgId)
            .in('revision_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  const viewsError = revisionsResult.error ?? recipientsResult.error ?? acksResult.error;
  if (viewsError) {
    logReadFailure('loadDispatchViews: revisions, recipients or acknowledgements failed', viewsError);
    return null;
  }

  const { recipientsByRevision, acksByRevision } = groupByRevision(recipientsResult.data, acksResult.data);
  const allRecipientIds = [...new Set(recipientsResult.data.map((row) => row.employee_record_id))];
  const nameFacts = await loadEmployeeNameFacts(admin, orgId, allRecipientIds);
  if (!nameFacts) return null;

  const revisionById = new Map(revisionsResult.data.map((row) => [row.id, row]));
  const views = new Map<string, DispatchView>();
  for (const dispatch of dispatches) {
    const revision = dispatch.current_revision_id
      ? revisionById.get(dispatch.current_revision_id)
      : undefined;
    if (!revision) continue;
    views.set(
      dispatch.id,
      toDispatchView({
        dispatch,
        revision,
        recipientIds: recipientsByRevision.get(revision.id) ?? [],
        acknowledgements: acksByRevision.get(revision.id) ?? [],
        nameFacts,
      }),
    );
  }
  return views;
}

/**
 * Recipient states of the active dispatches for a set of occurrences, derived
 * by the same rules as the Einsätze panel (P1-24a board cards). Occurrences
 * without an active dispatch are absent from the result.
 */
export async function loadOccurrenceDispatchStates(
  admin: AdminClient,
  orgId: string,
  occurrenceIds: readonly string[],
): Promise<Array<{
  occurrenceId: string;
  employeeRecordId: string;
  state: DispatchRecipientDerivedState;
}> | null> {
  if (occurrenceIds.length === 0) return [];
  const dispatchResult = await readInBatches(occurrenceIds, (batch) =>
    admin
      .from('planning_dispatches')
      .select('id, organization_id, occurrence_id, job_id, status, current_revision_id')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .in('occurrence_id', [...batch]),
  );
  if (dispatchResult.error) {
    logReadFailure('loadOccurrenceDispatchStates: dispatches failed', dispatchResult.error);
    return null;
  }
  const dispatches: DispatchRow[] = dispatchResult.data;
  const views = await loadDispatchViews(admin, orgId, dispatches);
  if (!views) return null;
  return dispatches.flatMap((dispatch) => {
    const view = views.get(dispatch.id);
    if (!view || !dispatch.occurrence_id) return [];
    const occurrenceId = dispatch.occurrence_id;
    return view.recipients.map((recipient) => ({
      occurrenceId,
      employeeRecordId: recipient.employeeRecordId,
      state: recipient.state,
    }));
  });
}

type CardRevisionRow = Pick<
  Database['public']['Tables']['planning_dispatch_revisions']['Row'],
  | 'id'
  | 'revision_number'
  | 'occurrence_id'
  | 'planned_start_at'
  | 'planned_end_at'
  | 'planned_start_date'
  | 'planned_end_date_exclusive'
  | 'location_text'
  | 'dispatch_note'
>;

// The active customer commitment window of a visit, as the dispatch reads use it.
export type CommitmentWindowRow = Pick<
  Database['public']['Tables']['planning_customer_commitments']['Row'],
  'occurrence_id' | 'committed_date' | 'window_start_time' | 'window_end_time'
>;

/** Logs a failed dispatch read under its reader's name and returns the reader's `null` failure. */
export function dispatchReadFailed(
  scope: string,
  read: string,
  error: { message: string; code?: string },
): null {
  logReadFailure(`${scope}: ${read} failed`, {
    code: error.code ?? 'unknown',
    message: error.message,
  });
  return null;
}

type OwnDispatchRevisions = {
  revisions: CardRevisionRow[];
  ownRevisionIds: Set<string>;
  acknowledgements: AcknowledgementRow[];
};

// The current revisions of the dispatches, the ones naming this employee
// record, and the record's acknowledgements on them.
async function loadOwnDispatchRevisions(
  admin: AdminClient,
  orgId: string,
  employeeRecordId: string,
  revisionIds: string[],
): Promise<OwnDispatchRevisions | null> {
  const [revisionsResult, myRecipientsResult, acksResult] = await Promise.all([
    readInBatches(revisionIds, (batch) =>
      admin
        .from('planning_dispatch_revisions')
        .select(
          'id, dispatch_id, revision_number, occurrence_id, job_id, planned_start_at, planned_end_at, planned_start_date, planned_end_date_exclusive, location_text, dispatch_note',
        )
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(revisionIds, (batch) =>
      admin
        .from('planning_dispatch_recipients')
        .select('revision_id, employee_record_id')
        .eq('organization_id', orgId)
        .eq('employee_record_id', employeeRecordId)
        .in('revision_id', [...batch]),
    ),
    readInBatches(revisionIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('planning_dispatch_acknowledgements')
            .select('id, revision_id, employee_record_id, state, reason, challenge_resolved_at, created_at')
            .eq('organization_id', orgId)
            .eq('employee_record_id', employeeRecordId)
            .in('revision_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  const revisionError = revisionsResult.error ?? myRecipientsResult.error ?? acksResult.error;
  if (revisionError) {
    return dispatchReadFailed(
      'loadEmployeeDispatchCards',
      'revisions, recipients or acknowledgements',
      revisionError,
    );
  }
  return {
    revisions: revisionsResult.data,
    ownRevisionIds: new Set(myRecipientsResult.data.map((row) => row.revision_id)),
    acknowledgements: acksResult.data,
  };
}

function toEmployeeDispatchCard(input: {
  dispatchId: string;
  revision: CardRevisionRow;
  acknowledgements: AcknowledgementRow[];
  employeeRecordId: string;
  commitment: CommitmentWindowRow | null;
}): EmployeeDispatchCard {
  const { revision, commitment } = input;
  const myAcks: AcknowledgementFact[] = input.acknowledgements
    .filter((row) => row.revision_id === revision.id)
    .map(toAcknowledgementFact);
  const latest = latestAcknowledgementByRecipient(myAcks).get(input.employeeRecordId) ?? null;
  const myState = deriveRecipientState({ hasLogin: true, latest });
  return {
    dispatchId: input.dispatchId,
    revisionNumber: revision.revision_number,
    targetKind: revision.occurrence_id ? 'occurrence' : 'job',
    startAt: revision.planned_start_at,
    endAt: revision.planned_end_at,
    startDate: revision.planned_start_date,
    endDateExclusive: revision.planned_end_date_exclusive,
    locationText: revision.location_text,
    note: revision.dispatch_note,
    committedToCustomer: commitment !== null,
    committedWindowText: commitment
      ? commitment.window_start_time && commitment.window_end_time
        ? `${commitment.committed_date}, ${commitment.window_start_time.slice(0, 5)}–${commitment.window_end_time.slice(0, 5)} Uhr`
        : commitment.committed_date
      : null,
    myState,
    myOpenChallengeReason: myState === 'rueckfrage' ? (latest?.reason ?? null) : null,
  };
}

// Normalized sort key: date-only cards count as start of day so they order
// correctly against timed cards; unscheduled dispatches sort last.
function dispatchCardSortKey(card: EmployeeDispatchCard): number {
  if (card.startAt) return new Date(card.startAt).getTime();
  if (card.startDate) return Date.parse(`${card.startDate}T00:00:00Z`);
  return Number.MAX_SAFE_INTEGER;
}

// The active customer commitments of the dispatched visits.
async function loadCardCommitments(
  admin: AdminClient,
  orgId: string,
  revisions: CardRevisionRow[],
): Promise<Map<string, CommitmentWindowRow> | null> {
  const dispatchOccurrenceIds = revisions.flatMap((row) => (row.occurrence_id ? [row.occurrence_id] : []));
  const commitmentsResult = await readInBatches(dispatchOccurrenceIds, (batch) =>
    admin
      .from('planning_customer_commitments')
      .select('occurrence_id, committed_date, window_start_time, window_end_time')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .in('occurrence_id', [...batch]),
  );
  if (commitmentsResult.error) {
    return dispatchReadFailed('loadEmployeeDispatchCards', 'commitments', commitmentsResult.error);
  }
  return new Map(commitmentsResult.data.map((row) => [row.occurrence_id, row]));
}

// One card per dispatch whose current revision names the employee record,
// in schedule order.
function toEmployeeDispatchCards(input: {
  dispatchRows: DispatchRow[];
  ownRevisions: OwnDispatchRevisions;
  commitmentByOccurrence: Map<string, CommitmentWindowRow>;
  employeeRecordId: string;
}): EmployeeDispatchCard[] {
  const { ownRevisions, commitmentByOccurrence } = input;
  const revisionById = new Map(ownRevisions.revisions.map((row) => [row.id, row]));
  const cards: EmployeeDispatchCard[] = [];
  for (const dispatchRow of input.dispatchRows) {
    const revision = dispatchRow.current_revision_id
      ? revisionById.get(dispatchRow.current_revision_id)
      : undefined;
    if (!revision || !ownRevisions.ownRevisionIds.has(revision.id)) continue;
    cards.push(
      toEmployeeDispatchCard({
        dispatchId: dispatchRow.id,
        revision,
        acknowledgements: ownRevisions.acknowledgements,
        employeeRecordId: input.employeeRecordId,
        commitment: revision.occurrence_id
          ? (commitmentByOccurrence.get(revision.occurrence_id) ?? null)
          : null,
      }),
    );
  }
  cards.sort((left, right) => dispatchCardSortKey(left) - dispatchCardSortKey(right));
  return cards;
}

export async function loadEmployeeDispatchCards(input: {
  orgId: string;
  userId: string;
  jobId: string;
}): Promise<EmployeeDispatchCard[] | null> {
  const admin = createSupabaseAdminClient();
  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', input.orgId)
    .eq('user_id', input.userId)
    .maybeSingle();
  if (recordError) return dispatchReadFailed('loadEmployeeDispatchCards', 'employee record', recordError);
  if (!record) return [];

  // A daily series over two years gives one job more than 700 visits: read
  // them in pages and look their dispatches up in id batches, never as one
  // id list inside the query string.
  const { data: jobOccurrences, error: occurrenceError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('planning_occurrences')
        .select('id')
        .eq('organization_id', input.orgId)
        .eq('job_id', input.jobId)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (occurrenceError)
    return dispatchReadFailed('loadEmployeeDispatchCards', 'job occurrences', occurrenceError);

  const dispatchSelect = 'id, organization_id, occurrence_id, job_id, status, current_revision_id';
  const [jobDispatchResult, occurrenceDispatchResult] = await Promise.all([
    admin
      .from('planning_dispatches')
      .select(dispatchSelect)
      .eq('organization_id', input.orgId)
      .eq('status', 'active')
      .eq('job_id', input.jobId),
    readInBatches(
      jobOccurrences.map((row) => row.id),
      (batch) =>
        admin
          .from('planning_dispatches')
          .select(dispatchSelect)
          .eq('organization_id', input.orgId)
          .eq('status', 'active')
          .in('occurrence_id', [...batch]),
    ),
  ]);
  const dispatchError = jobDispatchResult.error ?? occurrenceDispatchResult.error;
  if (dispatchError) return dispatchReadFailed('loadEmployeeDispatchCards', 'dispatches', dispatchError);
  const dispatchRows = [
    ...new Map(
      [...(jobDispatchResult.data ?? []), ...occurrenceDispatchResult.data].map((row) => [row.id, row]),
    ).values(),
  ];
  if (!dispatchRows.length) return [];

  const revisionIds = dispatchRows.flatMap((row) =>
    row.current_revision_id ? [row.current_revision_id] : [],
  );
  const ownRevisions = await loadOwnDispatchRevisions(admin, input.orgId, record.id, revisionIds);
  if (!ownRevisions) return null;

  const commitmentByOccurrence = await loadCardCommitments(admin, input.orgId, ownRevisions.revisions);
  if (!commitmentByOccurrence) return null;
  return toEmployeeDispatchCards({
    dispatchRows,
    ownRevisions,
    commitmentByOccurrence,
    employeeRecordId: record.id,
  });
}
