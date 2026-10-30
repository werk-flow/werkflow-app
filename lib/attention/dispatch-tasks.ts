import 'server-only';

// P1-12: dispatch attention behind the attention Server Actions in
// `./actions`. Items are projections over the owning dispatch rows; deciding
// happens through the dispatch actions, never here.

import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { ActionContext } from '@/lib/org/action-context';
import type { Tables } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { readPendingDispatchRecipients } from '@/lib/attention/pending-sets';
import { logError } from '@/lib/logging';
import {
  deriveRecipientState,
  isAcknowledgementPending,
  latestAcknowledgementByRecipient,
  type AcknowledgementFact as DispatchAcknowledgementFact,
} from '@/lib/dispatch/derivation';
import type { OwnEmployeeRecordRead } from './own-record';
import { recordDisplayNames } from './task-labels';
import type { AttentionTask } from './types';

type DispatchJobSource = Pick<Tables<'planning_dispatches'>, 'job_id' | 'occurrence_id'>;
type DispatchRow = Pick<
  Tables<'planning_dispatches'>,
  'id' | 'occurrence_id' | 'job_id' | 'current_revision_id'
>;

/** The job a dispatch or revision names, directly or through its occurrence. */
function dispatchJobId(
  source: DispatchJobSource | undefined,
  occurrenceJobIds: ReadonlyMap<string, string | null>,
): string | null {
  return (
    source?.job_id ?? (source?.occurrence_id ? (occurrenceJobIds.get(source.occurrence_id) ?? null) : null)
  );
}

function dispatchJobTitle(job: Pick<Tables<'jobs'>, 'title' | 'description'> | null | undefined): string {
  return job?.title.trim() || job?.description?.trim() || 'Auftrag';
}

export async function deriveDispatchAcknowledgementTasks(
  context: ActionContext,
  ownRecord: OwnEmployeeRecordRead,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  const admin = createSupabaseAdminClient();
  const { data: record, error: recordError } = await ownRecord;
  if (recordError) {
    logError('Failed to load own record for dispatch tasks', recordError);
    return { tasks: [], failed: true };
  }
  if (!record) return { tasks: [], failed: false };

  // Only the viewer's unacknowledged current-revision rows (never their history), then what they reference.
  const recipients = await readPendingDispatchRecipients(admin, context.orgId, record.id);
  if (recipients.error) {
    logError('Failed to load dispatch recipients for tasks', recipients.error);
    return { tasks: [], failed: true };
  }
  const myRecipients = recipients.data;
  if (!myRecipients.length) return { tasks: [], failed: false };
  const myDispatchIds = [...new Set(myRecipients.map((row) => row.dispatch_id))];
  const myRevisionIds = new Set(myRecipients.map((row) => row.revision_id));

  const { data: dispatches, error: dispatchError } = await readInBatches(myDispatchIds, (batch) =>
    admin
      .from('planning_dispatches')
      .select('id, occurrence_id, job_id, current_revision_id')
      .eq('organization_id', context.orgId)
      .eq('status', 'active')
      .in('id', [...batch]),
  );
  if (dispatchError) {
    logError('Failed to load dispatches for tasks', dispatchError);
    return { tasks: [], failed: true };
  }
  const currentRevisionIds = (dispatches ?? []).flatMap((dispatch) =>
    dispatch.current_revision_id && myRevisionIds.has(dispatch.current_revision_id)
      ? [dispatch.current_revision_id]
      : [],
  );
  if (!currentRevisionIds.length) return { tasks: [], failed: false };

  const facts = await readAcknowledgementFacts(admin, context.orgId, record.id, currentRevisionIds);
  if (!facts) return { tasks: [], failed: true };
  return { tasks: toAcknowledgementTasks(dispatches ?? [], facts, record.id), failed: false };
}

/** The viewer's acknowledgements, the revisions and the jobs of the pending dispatches; null when a read failed. */
async function readAcknowledgementFacts(
  admin: AdminClient,
  organizationId: string,
  recordId: string,
  currentRevisionIds: string[],
) {
  const [acksResult, revisionsResult] = await Promise.all([
    readInBatches(currentRevisionIds, (batch) =>
      admin
        .from('planning_dispatch_acknowledgements')
        .select('id, revision_id, employee_record_id, state, reason, challenge_resolved_at, created_at')
        .eq('organization_id', organizationId)
        .eq('employee_record_id', recordId)
        .in('revision_id', [...batch]),
    ),
    readInBatches(currentRevisionIds, (batch) =>
      admin
        .from('planning_dispatch_revisions')
        .select(
          'id, dispatch_id, revision_number, occurrence_id, job_id, planned_start_at, planned_start_date',
        )
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
  ]);
  if (acksResult.error || revisionsResult.error) {
    logError('Failed to load dispatch task facts', acksResult.error ?? revisionsResult.error);
    return null;
  }
  const revisionById = new Map((revisionsResult.data ?? []).map((row) => [row.id, row]));

  const occurrenceIds = [...revisionById.values()].flatMap((row) =>
    row.occurrence_id ? [row.occurrence_id] : [],
  );
  const occurrencesResult = await readInBatches(occurrenceIds, (batch) =>
    admin
      .from('planning_occurrences')
      .select('id, job_id')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (occurrencesResult.error) {
    logError('Failed to load dispatch occurrences', occurrencesResult.error);
    return null;
  }
  const occurrenceJobIds = new Map((occurrencesResult.data ?? []).map((row) => [row.id, row.job_id]));
  const jobIds = [
    ...new Set([
      ...[...revisionById.values()].flatMap((row) => (row.job_id ? [row.job_id] : [])),
      ...[...occurrenceJobIds.values()].filter((id): id is string => Boolean(id)),
    ]),
  ];
  const jobsResult = await readInBatches(jobIds, (batch) =>
    admin
      .from('jobs')
      .select('id, title, description, job_number')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (jobsResult.error) {
    logError('Failed to load dispatch jobs', jobsResult.error);
    return null;
  }
  return {
    acks: acksResult.data ?? [],
    revisionById,
    occurrenceJobIds,
    jobs: new Map((jobsResult.data ?? []).map((job) => [job.id, job])),
  };
}

function toAcknowledgementTasks(
  dispatches: DispatchRow[],
  {
    acks,
    revisionById,
    occurrenceJobIds,
    jobs,
  }: NonNullable<Awaited<ReturnType<typeof readAcknowledgementFacts>>>,
  recordId: string,
): AttentionTask[] {
  // Shared derivation rules (identical to every dispatch surface).
  const ackFactsByRevision = new Map<string, DispatchAcknowledgementFact[]>();
  for (const row of acks) {
    const list = ackFactsByRevision.get(row.revision_id) ?? [];
    list.push({
      id: row.id,
      employeeRecordId: row.employee_record_id,
      state: row.state,
      reason: row.reason,
      challengeResolvedAt: row.challenge_resolved_at,
      createdAt: row.created_at,
    });
    ackFactsByRevision.set(row.revision_id, list);
  }

  const tasks: AttentionTask[] = [];
  for (const dispatch of dispatches) {
    const revision = dispatch.current_revision_id
      ? revisionById.get(dispatch.current_revision_id)
      : undefined;
    if (!revision) continue;
    const latest =
      latestAcknowledgementByRecipient(ackFactsByRevision.get(revision.id) ?? []).get(recordId) ?? null;
    const state = deriveRecipientState({ hasLogin: true, latest });
    if (!isAcknowledgementPending(state)) continue;
    const jobId = dispatchJobId(revision, occurrenceJobIds);
    if (!jobId) continue;
    const job = jobs.get(jobId);
    tasks.push({
      sourceType: 'dispatch_acknowledgement',
      sourceId: dispatch.id,
      jobId,
      jobNumber: job?.job_number ?? null,
      jobTitle: dispatchJobTitle(job),
      revisionNumber: revision.revision_number,
      startAt: revision.planned_start_at,
      startDate: revision.planned_start_date,
      stateVersion: revision.id,
    });
  }
  return tasks;
}

export async function deriveDispatchChallengeTasks(
  context: ActionContext,
): Promise<{ tasks: AttentionTask[]; failed: boolean }> {
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { tasks: [], failed: false };
  }
  const admin = createSupabaseAdminClient();
  // Open challenges are the scarce signal — load them first, then only their
  // dispatches; the organization's total dispatch volume never matters here.
  const { data: openChallenges, error: challengeError } = await readCompleteRows(
    (from, to) =>
      admin
        .from('planning_dispatch_acknowledgements')
        .select('id, dispatch_id, revision_id, employee_record_id, reason, created_at')
        .eq('organization_id', context.orgId)
        .eq('state', 'challenged')
        .is('challenge_resolved_at', null)
        .order('created_at', { ascending: true })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (challengeError) {
    logError('Failed to load open dispatch challenges', challengeError);
    return { tasks: [], failed: true };
  }
  if (!openChallenges.length) return { tasks: [], failed: false };

  const challengeDispatchIds = [...new Set(openChallenges.map((challenge) => challenge.dispatch_id))];
  const { data: dispatches, error: dispatchError } = await readInBatches(challengeDispatchIds, (batch) =>
    admin
      .from('planning_dispatches')
      .select('id, occurrence_id, job_id, current_revision_id')
      .eq('organization_id', context.orgId)
      .eq('status', 'active')
      .in('id', [...batch]),
  );
  if (dispatchError) {
    logError('Failed to load dispatches for challenges', dispatchError);
    return { tasks: [], failed: true };
  }
  const currentRevisionByDispatch = new Map(
    (dispatches ?? []).map((dispatch) => [dispatch.id, dispatch.current_revision_id]),
  );
  // Only challenges on the CURRENT revision of an active dispatch are open
  // manager work; superseded ones were already resolved transactionally.
  const challenges = openChallenges.filter(
    (challenge) => currentRevisionByDispatch.get(challenge.dispatch_id) === challenge.revision_id,
  );
  if (!challenges.length) return { tasks: [], failed: false };

  const nameByRecordId = await readChallengerNames(admin, context.orgId, challenges);
  if (!nameByRecordId) return { tasks: [], failed: true };

  // Resolve the challenged dispatch's job title for context.
  const dispatchById = new Map((dispatches ?? []).map((dispatch) => [dispatch.id, dispatch]));
  const jobFacts = await readChallengeJobs(admin, context.orgId, challenges, dispatchById);
  if (!jobFacts) return { tasks: [], failed: true };

  const tasks: AttentionTask[] = challenges.map((challenge) => {
    const jobId = dispatchJobId(dispatchById.get(challenge.dispatch_id), jobFacts.occurrenceJobIds);
    const job = jobId ? jobFacts.jobs.get(jobId) : null;
    return {
      sourceType: 'dispatch_challenge_open',
      // The challenge row is the item identity: two concurrent challenges on
      // one dispatch must stay two distinct manager tasks after deduplication.
      sourceId: challenge.id,
      personName: nameByRecordId.get(challenge.employee_record_id) ?? 'Unbenannt',
      reason: challenge.reason ?? '',
      jobTitle: dispatchJobTitle(job),
      acknowledgementId: challenge.id,
      stateVersion: challenge.id,
    };
  });
  return { tasks, failed: false };
}

/** The display name of each challenging employee record; null when a read failed. */
async function readChallengerNames(
  admin: AdminClient,
  organizationId: string,
  challenges: Array<{ employee_record_id: string }>,
): Promise<Map<string, string> | null> {
  const recordIds = [...new Set(challenges.map((challenge) => challenge.employee_record_id))];
  const recordsResult = await readInBatches(recordIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (recordsResult.error) {
    logError('Failed to load challenge records', recordsResult.error);
    return null;
  }
  const userIds = (recordsResult.data ?? []).flatMap((row) => (row.user_id ? [row.user_id] : []));
  const profilesResult = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logError('Failed to load challenge profiles', profilesResult.error);
    return null;
  }
  return recordDisplayNames(recordsResult.data ?? [], profilesResult.data ?? []);
}

/** The jobs of the challenged dispatches, directly or through their occurrence; null when a read failed. */
async function readChallengeJobs(
  admin: AdminClient,
  organizationId: string,
  challenges: Array<{ dispatch_id: string }>,
  dispatchById: ReadonlyMap<string, DispatchRow>,
) {
  const occurrenceIds = [
    ...new Set(
      challenges.flatMap((challenge) => {
        const dispatch = dispatchById.get(challenge.dispatch_id);
        return dispatch?.occurrence_id ? [dispatch.occurrence_id] : [];
      }),
    ),
  ];
  const occurrencesResult = await readInBatches(occurrenceIds, (batch) =>
    admin
      .from('planning_occurrences')
      .select('id, job_id')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (occurrencesResult.error) {
    logError('Failed to load challenge occurrences', occurrencesResult.error);
    return null;
  }
  const occurrenceJobIds = new Map((occurrencesResult.data ?? []).map((row) => [row.id, row.job_id]));
  const jobIds = [
    ...new Set(
      challenges.flatMap((challenge) => {
        const jobId = dispatchJobId(dispatchById.get(challenge.dispatch_id), occurrenceJobIds);
        return jobId ? [jobId] : [];
      }),
    ),
  ];
  const jobsResult = await readInBatches(jobIds, (batch) =>
    admin
      .from('jobs')
      .select('id, title, description')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (jobsResult.error) {
    logError('Failed to load challenge jobs', jobsResult.error);
    return null;
  }
  return { occurrenceJobIds, jobs: new Map((jobsResult.data ?? []).map((job) => [job.id, job])) };
}
