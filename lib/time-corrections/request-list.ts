import 'server-only';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import {
  canHolderApproveTarget,
  type EffectiveResponsibilityHolder,
} from '@/lib/responsibilities/resolution';
import {
  getEffectiveResponsibilityHolderForActor,
  loadResponsibilityRuntimeState,
} from '@/lib/responsibilities/server';
import type { OrgRole } from '@/lib/roles';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { PENDING_CORRECTION_STATUSES } from './pending-projection';
import { isTimeCorrectionSnapshot, type TimeCorrectionListResult, type TimeCorrectionRequest } from './types';

// The correction request list behind the approval queue, the history page
// and the provisional summary: one read, hydrated with names, the current
// revision and the caller's rights.

/** Which requests a list read selects in the database, before the page boundary. */
type CorrectionListFilter = {
  status: 'submitted' | 'open';
  subjectUserId?: string;
};

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;
type RequestRow = Tables<'time_correction_requests'>;
type RevisionRow = Tables<'time_correction_request_revisions'>;

type CallerView = {
  callerUserId: string;
  callerRole: OrgRole;
  holder: EffectiveResponsibilityHolder | null;
};

/** What the hydration reads beside the requests: roles, names and revisions. */
type RequestDetails = {
  roleByUser: Map<string, OrgRole>;
  nameByUser: Map<string, string | null>;
  revisionByKey: Map<string, RevisionRow>;
};

export async function readCorrectionRequestList(input: {
  organizationId: string;
  callerUserId: string;
  callerRole: OrgRole;
  filter: CorrectionListFilter;
}): Promise<TimeCorrectionListResult> {
  const { organizationId, callerUserId, callerRole, filter } = input;
  const admin = createSupabaseAdminClient();
  // The holder lookup answers null for "not responsible" and for a failed
  // read alike; a failed read must not hide the requests the caller reviews.
  if (!(await loadResponsibilityRuntimeState(organizationId))) {
    return { success: false, error: 'responsibility_load_failed' };
  }
  const holder = await getEffectiveResponsibilityHolderForActor({
    organizationId,
    responsibility: 'time_approval',
    actorUserId: callerUserId,
  });
  // Complete on purpose: a newest-300 window hid older open requests from the
  // reviewer and from the provisional summary that counts them. An overflow
  // fails like a query error instead of showing a partial list.
  // An employee who reviews nobody sees only their own requests, so the
  // database selects them and the organization's history never reaches the bound.
  const ownRequestsOnly = callerRole === 'employee' && !holder;
  const { data: roots, error } = await readCompleteRows((from, to) => {
    let query = admin.from('time_correction_requests').select('*').eq('organization_id', organizationId);
    if (filter.status === 'submitted') query = query.eq('status', 'submitted');
    if (filter.status === 'open') query = query.in('status', [...PENDING_CORRECTION_STATUSES]);
    if (filter.subjectUserId) query = query.eq('subject_user_id', filter.subjectUserId);
    if (ownRequestsOnly) {
      query = query.or(`requested_by.eq.${callerUserId},subject_user_id.eq.${callerUserId}`);
    }
    return query.order('created_at', { ascending: false }).order('id').range(from, to);
  }, LIST_ROW_CAP);
  if (error) {
    logReadFailure('getTimeCorrectionRequests: requests failed', error);
    return { success: false, error: 'fetch_failed' };
  }
  return hydrateCorrectionRequests({ admin, organizationId, callerUserId, callerRole, holder, roots });
}

/** The roles, names and revisions of the requests; null when a read fails. */
async function readRequestDetails(
  admin: AdminClient,
  organizationId: string,
  roots: RequestRow[],
): Promise<RequestDetails | null> {
  const requestIds = roots.map((request) => request.id);
  const userIds = [...new Set(roots.flatMap((request) => [request.requested_by, request.subject_user_id]))];
  const [memberships, profiles, revisions] = await Promise.all([
    readInBatches(userIds, (batch) =>
      admin
        .from('organization_members')
        .select('user_id, role')
        .eq('organization_id', organizationId)
        .in('user_id', [...batch]),
    ),
    readInBatches(userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', [...batch]),
    ),
    readInBatches(requestIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('time_correction_request_revisions')
            .select('*')
            .eq('organization_id', organizationId)
            .in('request_id', [...batch])
            .order('request_id')
            .order('revision')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ),
  ]);
  const detailError = memberships.error ?? profiles.error ?? revisions.error;
  if (detailError) {
    // Without roles or revisions the filter below would drop requests silently.
    logReadFailure('getTimeCorrectionRequests: request details failed', detailError);
    return null;
  }
  return {
    roleByUser: new Map(memberships.data.map((membership) => [membership.user_id, membership.role])),
    nameByUser: new Map(
      profiles.data.map((profile) => [
        profile.id,
        [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email,
      ]),
    ),
    revisionByKey: new Map(
      revisions.data.map((revision) => [`${revision.request_id}:${revision.revision}`, revision]),
    ),
  };
}

/** Whether the caller's time-approval responsibility covers the request's subject. */
function holderCovers(caller: CallerView, request: RequestRow, details: RequestDetails): boolean {
  const targetRole = details.roleByUser.get(request.subject_user_id);
  return Boolean(
    caller.holder && targetRole && canHolderApproveTarget(caller.holder, request.subject_user_id, targetRole),
  );
}

/** The request as the list shows it; null when its current revision is missing or unreadable. */
function toCorrectionRequest(
  caller: CallerView,
  request: RequestRow,
  details: RequestDetails,
): TimeCorrectionRequest | null {
  const revision = details.revisionByKey.get(`${request.id}:${request.current_revision}`);
  if (
    !revision ||
    !isTimeCorrectionSnapshot(revision.before_snapshot) ||
    !isTimeCorrectionSnapshot(revision.proposed_snapshot)
  ) {
    return null;
  }
  return {
    id: request.id,
    organizationId: request.organization_id,
    subjectEmployeeRecordId: request.subject_employee_record_id,
    subjectUserId: request.subject_user_id,
    requestedBy: request.requested_by,
    kind: request.kind,
    status: request.status,
    currentRevision: request.current_revision,
    reviewedBy: request.reviewed_by,
    reviewedAt: request.reviewed_at,
    decisionComment: request.decision_comment,
    createdAt: request.created_at,
    updatedAt: request.updated_at,
    requesterName: details.nameByUser.get(request.requested_by) ?? 'Unbekannt',
    subjectName: details.nameByUser.get(request.subject_user_id) ?? 'Unbekannt',
    canReview: request.status === 'submitted' && holderCovers(caller, request, details),
    canWithdraw:
      request.requested_by === caller.callerUserId &&
      (request.status === 'submitted' || request.status === 'clarification_required'),
    revision: {
      revision: revision.revision,
      reason: revision.reason,
      beforeSnapshot: revision.before_snapshot,
      proposedSnapshot: revision.proposed_snapshot,
      createdBy: revision.created_by,
      createdAt: revision.created_at,
    },
  };
}

/**
 * The selected requests with names, the current revision and the caller's
 * review and withdraw rights, in the selection order, limited to the ones
 * the caller may see. A missing or unreadable revision fails the read.
 */
export async function hydrateCorrectionRequests(
  input: CallerView & { admin: AdminClient; organizationId: string; roots: RequestRow[] },
): Promise<TimeCorrectionListResult> {
  const { admin, organizationId, roots } = input;
  if (!roots.length) return { success: true, requests: [] };
  const details = await readRequestDetails(admin, organizationId, roots);
  if (!details) return { success: false, error: 'fetch_failed' };
  const visible = roots.filter(
    (request) =>
      input.callerRole !== 'employee' ||
      request.requested_by === input.callerUserId ||
      request.subject_user_id === input.callerUserId ||
      holderCovers(input, request, details),
  );
  const requests: TimeCorrectionRequest[] = [];
  for (const request of visible) {
    const hydrated = toCorrectionRequest(input, request, details);
    // The submit RPC writes a request and its current revision together. A
    // missing or unreadable revision is a broken read, never a shorter list.
    if (!hydrated) {
      logError('getTimeCorrectionRequests: current revision missing or unreadable');
      return { success: false, error: 'fetch_failed' };
    }
    requests.push(hydrated);
  }
  return { success: true, requests };
}
