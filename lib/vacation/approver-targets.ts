import 'server-only';
import type { AdminClient } from '@/lib/supabase/admin';
import { readCompleteRows, readInBatches, LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import type { Database } from '@/lib/supabase/database.types';
import { authorizeResponsibilityForTarget } from '@/lib/responsibilities/server';
import type { OrgRole } from '@/lib/roles';
import { loadPlannedAssignedJobs } from './server';
import type { VacationRequestRow } from './types';
import { logError } from '@/lib/logging';

// The approver queues' target context: who each request belongs to, whether
// the actor may decide for them, and the conflict reads of the pending queue.
// Callers resolve the actor's organization and user id first.

type RequestTargetMaps = {
  recordById: Map<
    string,
    {
      id: string;
      user_id: string | null;
      first_name: string | null;
      last_name: string | null;
    }
  >;
  roleByUserId: Map<string, OrgRole>;
  profileByUserId: Map<string, { id: string; first_name: string | null; last_name: string | null }>;
};

// Shared target-context loading for both approver queues: employee records,
// their memberships, and display profiles for a set of request record ids.
export async function loadRequestTargetMaps(
  admin: AdminClient,
  orgId: string,
  recordIds: string[],
): Promise<RequestTargetMaps | null> {
  const { data: records, error: recordsError } = await readInBatches(recordIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (recordsError) {
    logError('Failed to load request records:', recordsError);
    return null;
  }
  const recordById = new Map(records.map((row) => [row.id, row]));

  const targetUserIds = records.map((row) => row.user_id).filter((id): id is string => Boolean(id));
  const [membershipsResult, profilesResult] = await Promise.all([
    readInBatches(targetUserIds, (batch) =>
      admin
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', orgId)
        .in('user_id', [...batch]),
    ),
    readInBatches(targetUserIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...batch]),
    ),
  ]);
  if (membershipsResult.error || profilesResult.error) {
    logError('Failed to load request target context:', membershipsResult.error ?? profilesResult.error);
    return null;
  }

  return {
    recordById,
    roleByUserId: new Map((membershipsResult.data ?? []).map((row) => [row.user_id, row.role])),
    profileByUserId: new Map((profilesResult.data ?? []).map((row) => [row.id, row])),
  };
}

function formatTargetName(
  record: { first_name: string | null; last_name: string | null },
  profile: { first_name: string | null; last_name: string | null } | undefined,
): string {
  const firstName = profile?.first_name ?? record.first_name ?? '';
  const lastName = profile?.last_name ?? record.last_name ?? '';
  return `${firstName} ${lastName}`.trim() || 'Unbekannt';
}

type DecisionAuthorization = (
  recordId: string,
  targetUserId: string,
  targetRole: OrgRole,
) => Promise<boolean>;

// Authorization filter: whether the actor may decide a record's requests right
// now (self-approval denied by the shared helper), memoized per record so
// duplicate rows never re-query.
export function createDecisionAuthorization(orgId: string, userId: string): DecisionAuthorization {
  const authorizationByRecordId = new Map<string, boolean>();
  return async (recordId, targetUserId, targetRole) => {
    let authorized = authorizationByRecordId.get(recordId);
    if (authorized === undefined) {
      const authorization = await authorizeResponsibilityForTarget({
        organizationId: orgId,
        responsibility: 'leave_approval',
        actorUserId: userId,
        targetUserId,
        targetRole,
      });
      authorized = authorization.success;
      authorizationByRecordId.set(recordId, authorized);
    }
    return authorized;
  };
}

export type DecidableTarget = { recordId: string; targetUserId: string; personName: string };

// The request's target when it is a member the actor may decide for; null skips the request.
export async function resolveDecidableTarget(
  employeeRecordId: string,
  maps: RequestTargetMaps,
  isAuthorized: DecisionAuthorization,
): Promise<DecidableTarget | null> {
  const record = maps.recordById.get(employeeRecordId);
  if (!record?.user_id) return null;
  const targetRole = maps.roleByUserId.get(record.user_id);
  if (!targetRole) return null;
  if (!(await isAuthorized(record.id, record.user_id, targetRole))) return null;
  return {
    recordId: record.id,
    targetUserId: record.user_id,
    personName: formatTargetName(record, maps.profileByUserId.get(record.user_id)),
  };
}

export type ActiveAbsence = Pick<
  Database['public']['Tables']['sickness_reports']['Row'],
  'employee_record_id' | 'start_date' | 'end_date'
>;

export type PlannedAssignedJobs = NonNullable<Awaited<ReturnType<typeof loadPlannedAssignedJobs>>>;

export type RequestSpan = { from: string; to: string };

/** The days from the earliest start to the latest end of the requests; null without a request. */
export function spanOfRequests(rows: VacationRequestRow[]): RequestSpan | null {
  const [first, ...others] = rows;
  if (!first) return null;
  return others.reduce(
    (span, row) => ({
      from: row.start_date < span.from ? row.start_date : span.from,
      to: row.end_date > span.to ? row.end_date : span.to,
    }),
    { from: first.start_date, to: first.end_date },
  );
}

// A report stays 'reported' after it ends, so only the span keeps this read
// from growing with each person's sickness history. An open end reaches every
// later day. The span holds every request, so each request's own overlap check
// sees all the reports it needs.
export async function loadActiveAbsences(
  admin: AdminClient,
  orgId: string,
  recordIds: string[],
  span: RequestSpan,
): Promise<ActiveAbsence[] | null> {
  const { data: activeAbsenceRows, error: absenceError } = await readInBatches(recordIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('sickness_reports')
          .select('employee_record_id, start_date, end_date')
          .eq('organization_id', orgId)
          .eq('status', 'reported')
          .in('employee_record_id', [...batch])
          .lte('start_date', span.to)
          .or(`end_date.gte.${span.from},end_date.is.null`)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (absenceError) {
    logError('Error fetching active absences for vacation approvals:', absenceError);
    return null;
  }
  return activeAbsenceRows;
}

export async function loadPlannedJobsForRequests(
  orgId: string,
  span: RequestSpan,
  recordIds: string[],
  recordById: RequestTargetMaps['recordById'],
): Promise<PlannedAssignedJobs | null> {
  // One batched assignment lookup instead of one query per pending row.
  const pendingUserIds = [
    ...new Set(
      recordIds
        .map((recordId) => recordById.get(recordId)?.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  // One span over every pending request; each row filters its own range afterwards.
  return loadPlannedAssignedJobs(orgId, pendingUserIds, span);
}
