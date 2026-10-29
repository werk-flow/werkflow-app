'use server';

import type { ActionFailure } from '@/lib/action-result';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { resolveActionContextFor } from '@/lib/org/action-context';
import {
  getEffectiveResponsibilityHolderForActor,
  loadResponsibilityRuntimeState,
} from '@/lib/responsibilities/server';
import type { OrgRole } from '@/lib/roles';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { LIST_PAGE_SIZE } from '@/lib/ui/list-pagination';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import { correctionHistoryVisibility } from './history-visibility';
import {
  createPendingProjectionPort,
  loadPendingCorrectionProjection,
  type PendingCorrectionRequest,
} from './pending-projection';
import { hydrateCorrectionRequests, readCorrectionRequestList } from './request-list';
import {
  correctionSourceId,
  type TimeCorrectionHistoryResult,
  type TimeCorrectionListResult,
  type TimeCorrectionRequest,
  type TimeCorrectionSnapshot,
  type TimeCorrectionSource,
} from './types';

// The Server Actions that read time corrections: the approval queue, the
// history, the form options and the provisional projection and summary.

const correctionDateSchema = z.string().max(40);
const correctionProjectionSchema = z.object({
  organizationId: uuidSchema,
  from: correctionDateSchema,
  to: correctionDateSchema,
  userId: uuidSchema.optional(),
});
const correctionSummarySchema = z.object({ organizationId: uuidSchema, userId: uuidSchema });
const correctionListSchema = z.object({
  organizationId: uuidSchema,
  scope: z.literal('approvals'),
});
const correctionHistorySchema = z.object({
  organizationId: uuidSchema,
  page: z.number().int().min(1).max(1_000_000),
});
const historySelectionSchema = z.object({
  total: z.number().int().nonnegative(),
  ids: z.array(uuidSchema).max(LIST_PAGE_SIZE),
});

async function getMembershipRole(
  organizationId: string,
): Promise<{ success: true; role: OrgRole } | ActionFailure<'not_authenticated' | 'not_a_member'>> {
  const caller = await resolveActionContextFor(organizationId);
  return caller.success ? { success: true, role: caller.context.role } : caller;
}

/**
 * The approval queue of the active organization: the submitted requests,
 * selected in the database, so the queue never depends on the size of the
 * organization's history. The history pages through
 * `getTimeCorrectionHistoryPage`.
 */
export async function getTimeCorrectionRequests(
  organizationIdInput: string,
  scopeInput: 'approvals' = 'approvals',
): Promise<TimeCorrectionListResult> {
  const parsedInput = correctionListSchema.safeParse({
    organizationId: organizationIdInput,
    scope: scopeInput,
  });
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const { organizationId } = parsedInput.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const caller = await getMembershipRole(organizationId);
  if (!caller.success) return caller;
  const callerRole = caller.role;
  return readCorrectionRequestList({
    organizationId,
    callerUserId: user.id,
    callerRole,
    filter: { status: 'submitted' },
  });
}

/**
 * One page of the correction history, newest first. The database applies
 * the caller's visibility (`correctionHistoryVisibility`), the count and
 * the page boundary; this reader hydrates the page rows only.
 */
export async function getTimeCorrectionHistoryPage(
  organizationIdInput: string,
  pageInput: number,
): Promise<TimeCorrectionHistoryResult> {
  const parsedInput = correctionHistorySchema.safeParse({
    organizationId: organizationIdInput,
    page: pageInput,
  });
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const { organizationId, page } = parsedInput.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const caller = await getMembershipRole(organizationId);
  if (!caller.success) return caller;
  const callerRole = caller.role;
  // The holder lookup answers null for "not responsible" and for a failed
  // read alike; a failed read must not narrow the history silently.
  if (!(await loadResponsibilityRuntimeState(organizationId))) {
    return { success: false, error: 'responsibility_load_failed' };
  }
  const holder = await getEffectiveResponsibilityHolderForActor({
    organizationId,
    responsibility: 'time_approval',
    actorUserId: user.id,
  });
  const admin = createSupabaseAdminClient();
  const selected = await admin.rpc('list_time_correction_history_page', {
    p_organization_id: organizationId,
    p_caller_user_id: user.id,
    p_visibility: correctionHistoryVisibility(callerRole, holder),
    p_page: page,
    p_page_size: LIST_PAGE_SIZE,
  });
  const selection = historySelectionSchema.safeParse(selected.data);
  if (selected.error || !selection.success) {
    logReadFailure('getTimeCorrectionHistoryPage: page selection failed', {
      code: selected.error?.code ?? 'malformed_page',
    });
    return { success: false, error: 'fetch_failed' };
  }
  const { data: rows, error } = await readInBatches(selection.data.ids, (batch) =>
    admin
      .from('time_correction_requests')
      .select('*')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (error) {
    logReadFailure('getTimeCorrectionHistoryPage: page rows failed', error);
    return { success: false, error: 'fetch_failed' };
  }
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const hydrated = await hydrateCorrectionRequests({
    admin,
    organizationId,
    callerUserId: user.id,
    callerRole,
    holder,
    roots: selection.data.ids.flatMap((id) => {
      const row = rowById.get(id);
      return row ? [row] : [];
    }),
  });
  if (!hydrated.success) return hydrated;
  return { success: true, page: { requests: hydrated.requests, total: selection.data.total } };
}

export type TimeCorrectionFormOptions = {
  people: Array<{
    employeeRecordId: string;
    userId: string;
    name: string;
    role: OrgRole;
  }>;
  currentEmployeeRecordId: string;
};

export async function getTimeCorrectionFormOptions(
  organizationIdInput: string,
): Promise<{ success: true; options: TimeCorrectionFormOptions } | ActionFailure> {
  const parsedOrganizationId = uuidSchema.safeParse(organizationIdInput);
  if (!parsedOrganizationId.success) return { success: false, error: 'invalid_input' };
  const organizationId = parsedOrganizationId.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const caller = await getMembershipRole(organizationId);
  if (!caller.success) return caller;
  const admin = createSupabaseAdminClient();
  // The job picker searches open jobs on the server (`'entity-options'`, purpose `time-correction`).
  const [{ data: employees, error: employeeError }, { data: memberships, error: membershipError }] =
    await Promise.all([
      readCompleteRows(
        (from, to) =>
          admin
            .from('employee_records')
            .select('id, user_id')
            .eq('organization_id', organizationId)
            .not('user_id', 'is', null)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
      readCompleteRows(
        (from, to) =>
          admin
            .from('organization_members')
            .select('user_id, role')
            .eq('organization_id', organizationId)
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    ]);
  // The query selects only linked records, so every row carries a user id.
  const linked = employees.flatMap(({ id, user_id: userId }) => (userId !== null ? [{ id, userId }] : []));
  const userIds = linked.map((employee) => employee.userId);
  const { data: profiles, error: profileError } = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name, email')
      .in('id', [...batch]),
  );
  const optionsError = employeeError ?? membershipError ?? profileError;
  if (optionsError) {
    logReadFailure('getTimeCorrectionFormOptions: options failed', optionsError);
    return { success: false, error: 'fetch_failed' };
  }
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  const roleById = new Map(memberships.map((membership) => [membership.user_id, membership.role]));
  const people = linked.flatMap(({ id: employeeRecordId, userId }) => {
    const role = roleById.get(userId);
    if (!role) return [];
    const profile = profileById.get(userId);
    return [
      {
        employeeRecordId,
        userId,
        name:
          [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') ||
          profile?.email ||
          'Unbekannt',
        role,
      },
    ];
  });
  const current = people.find((person) => person.userId === user.id);
  if (!current) return { success: false, error: 'subject_not_found' };
  return {
    success: true,
    options: {
      people,
      currentEmployeeRecordId: current.employeeRecordId,
    },
  };
}

export type ProvisionalTimeCorrectionProjection = {
  entries: TimeEntry[];
  sources: Array<{
    requestId: string;
    kind: TimeCorrectionRequest['kind'];
    sourceKind: TimeCorrectionSource['kind'];
    sourceId: string;
  }>;
};

/** The proposed facts of the pending requests as provisional entries inside the window. */
function provisionalEntries(
  pending: PendingCorrectionRequest[],
  window: { organizationId: string; from: string; to: string; userId?: string | undefined },
): TimeEntry[] {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  return pending.flatMap((request) =>
    request.proposedSnapshot.facts.flatMap((fact) => {
      const timestamp = Date.parse(fact.timestamp);
      if (timestamp < from || timestamp > to || (window.userId && fact.userId !== window.userId)) {
        return [];
      }
      return [
        {
          id: `proposal:${request.id}:${request.currentRevision}:${fact.factId}`,
          userId: fact.userId,
          organizationId: window.organizationId,
          entryType: fact.entryType,
          timestamp: fact.timestamp,
          isManual: true,
          jobId: fact.jobId,
          status: 'pending' as const,
          reviewedBy: null,
          reviewedAt: null,
          createdAt: request.updatedAt,
          updatedAt: request.updatedAt,
          activityKind: fact.activityKind ?? undefined,
          pendingCorrectionRequestId: request.id,
          pendingCorrectionKind: request.kind,
          isProvisionalCorrection: true,
        },
      ];
    }),
  );
}

export async function getProvisionalTimeCorrectionProjection(rawInput: {
  organizationId: string;
  from: string;
  to: string;
  userId?: string | undefined;
}): Promise<ProvisionalTimeCorrectionProjection> {
  const parsedInput = correctionProjectionSchema.safeParse(rawInput);
  if (!parsedInput.success) return { entries: [], sources: [] };
  const input = parsedInput.data;
  // Pending-only, subject-filtered read; the same identity and
  // visibility rules as the list reader, without its names and memberships.
  const user = await getAuthenticatedUser();
  if (!user) return { entries: [], sources: [] };
  const caller = await getMembershipRole(input.organizationId);
  if (!caller.success) return { entries: [], sources: [] };
  const callerRole = caller.role;
  // Managers can view every pending request; an employee's own-subject
  // projection needs no delegated approval scope. Resolve it only for the
  // unfiltered employee view that may include another person's requests.
  const holder =
    callerRole === 'employee' && input.userId === undefined
      ? await getEffectiveResponsibilityHolderForActor({
          organizationId: input.organizationId,
          responsibility: 'time_approval',
          actorUserId: user.id,
        })
      : null;
  const projection = await loadPendingCorrectionProjection(
    createPendingProjectionPort(createSupabaseAdminClient()),
    {
      organizationId: input.organizationId,
      subjectUserId: input.userId,
      caller: { userId: user.id, role: callerRole, holder },
    },
  );
  if (!projection) throw new Error('Pending time corrections could not be read completely.');
  if (projection.requests.length === 0) return { entries: [], sources: [] };
  const pending = projection.requests;
  const requestById = new Map(pending.map((request) => [request.id, request]));
  const sources = projection.sources.flatMap((source) => {
    const sourceId = correctionSourceId(source);
    const request = requestById.get(source.request_id);
    return sourceId && request && source.revision === request.currentRevision
      ? [
          {
            requestId: request.id,
            kind: request.kind,
            sourceKind: source.source_kind,
            sourceId,
          },
        ]
      : [];
  });
  return { entries: provisionalEntries(pending, input), sources };
}

function snapshotMinutes(snapshot: TimeCorrectionSnapshot): number {
  let activeStart: number | null = null;
  let minutes = 0;
  for (const fact of [...snapshot.facts].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  )) {
    const timestamp = Date.parse(fact.timestamp);
    if (fact.entryType === 'clock_in' || fact.entryType === 'break_end') {
      activeStart = timestamp;
    } else if (activeStart !== null) {
      minutes += Math.max(0, Math.round((timestamp - activeStart) / 60_000));
      activeStart = null;
    }
  }
  return minutes;
}

export async function getProvisionalTimeSummary(rawInput: {
  organizationId: string;
  userId: string;
}): Promise<
  { success: true; count: number; beforeMinutes: number; proposedMinutes: number } | ActionFailure
> {
  const parsedInput = correctionSummarySchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const user = await getAuthenticatedUser();
  if (!user) return { success: false, error: 'not_authenticated' };
  const caller = await getMembershipRole(input.organizationId);
  if (!caller.success) return caller;
  const role = caller.role;
  if (role === 'employee' && input.userId !== user.id) {
    return { success: false, error: 'not_authorized' };
  }
  const result = await readCorrectionRequestList({
    organizationId: input.organizationId,
    callerUserId: user.id,
    callerRole: role,
    filter: { status: 'open', subjectUserId: input.userId },
  });
  if (!result.success) return result;
  const pending = result.requests;
  return {
    success: true,
    count: pending.length,
    beforeMinutes: pending.reduce(
      (total, request) => total + snapshotMinutes(request.revision.beforeSnapshot),
      0,
    ),
    proposedMinutes: pending.reduce(
      (total, request) => total + snapshotMinutes(request.revision.proposedSnapshot),
      0,
    ),
  };
}
