import 'server-only';

import { logReadFailure } from '@/lib/data/read-request-cache';
import { approvalTargetRole, canHolderApproveTarget } from '@/lib/responsibilities/resolution';
import {
  getEffectiveResponsibilityHolderForActor,
  loadResponsibilityRuntimeState,
} from '@/lib/responsibilities/server';
import type { OrgRole } from '@/lib/roles';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Tables } from '@/lib/supabase/database.types';
import { readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { PERIOD_SOURCE_ROW_CAP, requirePeriodRows } from './period-sources';
import type { TimeFindingDecision } from './presentation';

// Who decides a time-account matter: the approval scope over a personnel
// record, and the decision reads of the Perioden and settings pages.

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

/** The person a time-account decision concerns, as the approval scope sees them. */
type ApprovalTarget = { userId: string | null; role: OrgRole | null };

/**
 * The login and approval role of each given personnel record of the
 * organization (`approvalTargetRole`); null when a read fails. A record of
 * another organization is missing from the map.
 */
export async function readApprovalTargets(
  organizationId: string,
  employeeRecordIds: readonly string[],
): Promise<Map<string, ApprovalTarget> | null> {
  const admin = createSupabaseAdminClient();
  const records = await readInBatches(employeeRecordIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id')
      .eq('organization_id', organizationId)
      .in('id', [...batch]),
  );
  if (records.error) {
    logReadFailure('readApprovalTargets: employee records failed', records.error);
    return null;
  }
  const userIds = records.data.flatMap((record) => (record.user_id ? [record.user_id] : []));
  const members = await readInBatches(userIds, (batch) =>
    admin
      .from('organization_members')
      .select('user_id, role')
      .eq('organization_id', organizationId)
      .in('user_id', [...batch]),
  );
  if (members.error) {
    logReadFailure('readApprovalTargets: memberships failed', members.error);
    return null;
  }
  const roleByUserId = new Map(members.data.map((member) => [member.user_id, member.role]));
  return new Map(
    records.data.map((record) => [
      record.id,
      {
        userId: record.user_id,
        role: approvalTargetRole(
          record.user_id,
          record.user_id ? (roleByUserId.get(record.user_id) ?? null) : null,
        ),
      },
    ]),
  );
}

/**
 * The given personnel records whose time-account decisions the caller may
 * take, by the predicate `authorizeResponsibilityForTarget` asks. Throws on a
 * failed read, so a page shows a retry instead of hiding every decision.
 */
export async function readDecidableRecordIds(
  context: { orgId: string; userId: string },
  employeeRecordIds: readonly string[],
): Promise<Set<string>> {
  if (employeeRecordIds.length === 0) return new Set();
  if (!(await loadResponsibilityRuntimeState(context.orgId))) throw new Error('responsibility_load_failed');
  const [holder, targets] = await Promise.all([
    getEffectiveResponsibilityHolderForActor({
      organizationId: context.orgId,
      responsibility: 'time_approval',
      actorUserId: context.userId,
    }),
    readApprovalTargets(context.orgId, employeeRecordIds),
  ]);
  if (!targets) throw new Error('approval_targets_failed');
  return new Set(
    [...targets].flatMap(([recordId, target]) =>
      holder && canHolderApproveTarget(holder, target.userId, target.role) ? [recordId] : [],
    ),
  );
}

/** The newest decision of each finding. A finding sits in one batch, so its newest decision comes first. */
export async function readLatestFindingDecisions(
  admin: SupabaseAdmin,
  organizationId: string,
  findingIds: readonly string[],
): Promise<Map<string, TimeFindingDecision>> {
  const { data: decisions } = await readInBatches(findingIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('time_period_finding_decisions')
          .select('finding_id, decision, decided_at')
          .eq('organization_id', organizationId)
          .in('finding_id', [...batch])
          .order('decided_at', { ascending: false })
          .order('id')
          .range(from, to),
      PERIOD_SOURCE_ROW_CAP,
    ),
  ).then(requirePeriodRows);
  const decisionByFinding = new Map<string, TimeFindingDecision>();
  for (const decision of decisions)
    if (!decisionByFinding.has(decision.finding_id))
      decisionByFinding.set(decision.finding_id, decision.decision);
  return decisionByFinding;
}

/** An open adjustment request as the settings page lists it, before the person's name is resolved. */
export type PendingAdjustment = {
  id: string;
  employeeRecordId: string;
  kind: Tables<'time_account_adjustment_requests'>['adjustment_kind'];
  minutes: number;
  effectiveDate: string;
  reason: string;
  version: number;
  /** Neither proposed by the caller nor outside their approval scope. */
  canApprove: boolean;
  /** The caller proposed it, so they may withdraw it while it is open. */
  ownProposal: boolean;
};

/** The submitted adjustment requests, each with whether the caller may decide it or proposed it. */
export async function readPendingAdjustments(
  admin: SupabaseAdmin,
  context: { orgId: string; userId: string },
): Promise<PendingAdjustment[]> {
  const { data: requests } = await readCompleteRows(
    (from, to) =>
      admin
        .from('time_account_adjustment_requests')
        .select(
          'id, employee_record_id, adjustment_kind, minutes, effective_date, reason, version, requested_by',
        )
        .eq('organization_id', context.orgId)
        .eq('status', 'submitted')
        .order('created_at')
        .order('id')
        .range(from, to),
    PERIOD_SOURCE_ROW_CAP,
  ).then(requirePeriodRows);
  const decidableRecordIds = await readDecidableRecordIds(context, [
    ...new Set(requests.map((request) => request.employee_record_id)),
  ]);
  return requests.map((request) => ({
    id: request.id,
    employeeRecordId: request.employee_record_id,
    kind: request.adjustment_kind,
    minutes: request.minutes,
    effectiveDate: request.effective_date,
    reason: request.reason,
    version: Number(request.version),
    canApprove: request.requested_by !== context.userId && decidableRecordIds.has(request.employee_record_id),
    ownProposal: request.requested_by === context.userId,
  }));
}
