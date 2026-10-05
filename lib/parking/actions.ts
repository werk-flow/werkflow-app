'use server';

// Parkplatz context: jobs.status = 'geparkt' stays the authoritative
// parked signal; this adds the manager-owned reason/responsible/next-review
// context. Legacy parked jobs without context remain a visible labeled
// exception — nothing is fabricated for them.

import type { ActionResult } from '@/lib/action-result';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { PARKING_REASON_LABELS, type JobParkingContext, type JobParkingReason } from './types';
import { logError } from '@/lib/logging';

// One source of truth for the reason vocabulary: the label map's keys.
const PARKING_REASONS = Object.keys(PARKING_REASON_LABELS) as [JobParkingReason, ...JobParkingReason[]];

const parkingContextSchema = z.object({
  jobId: uuidSchema,
  reason: z.enum(PARKING_REASONS),
  note: z.string().trim().max(1000).nullable(),
  responsibleEmployeeRecordId: uuidSchema,
  nextReviewDate: z.string().date(),
});

export async function setJobParkingContext(rawInput: unknown): Promise<ActionResult> {
  const parsed = parkingContextSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: existing, error: existingError } = await admin
    .from('work_blockers')
    .select('id, version')
    .eq('organization_id', auth.context.orgId)
    .eq('job_id', parsed.data.jobId)
    .eq('kind', 'parking')
    .eq('state', 'open')
    .maybeSingle();
  if (existingError) {
    logError('Failed to load open parking blocker:', existingError);
    return { success: false, error: 'load_failed' };
  }
  if (!existing) return { success: false, error: 'job_not_parked' };
  const { error } = await admin.rpc(
    'upsert_work_blocker',
    rpcArgs('upsert_work_blocker', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_blocker_id: existing.id,
      p_expected_version: existing.version,
      p_job_id: parsed.data.jobId,
      p_project_id: null,
      p_instruction_item_id: null,
      p_kind: 'parking',
      p_reason: parsed.data.reason,
      p_details: parsed.data.note,
      p_responsible_employee_record_id: parsed.data.responsibleEmployeeRecordId,
      p_next_review_date: parsed.data.nextReviewDate,
    }),
  );
  if (error) {
    logError('Failed to set job parking context:', error);
    return {
      success: false,
      error: error.message.includes('work_blocker_owner_invalid')
        ? 'responsible_not_manager'
        : error.message.includes('work_blocker_stale_version')
          ? 'stale_version'
          : 'update_failed',
    };
  }
  return { success: true };
}

export type ParkingResponsibleOption = {
  employeeRecordId: string;
  label: string;
};

// Employee records currently linked to an active admin/Büro membership — the
// only valid "verantwortlich" targets (the RPC re-validates on write).
export async function getParkingResponsibleOptions(): Promise<
  ActionResult<{ options: ParkingResponsibleOption[] }>
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: managers, error: membersError } = await admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', auth.context.orgId)
    .in('role', ['admin', 'buero']);
  if (membersError) {
    logError('Failed to load manager memberships:', membersError);
    return { success: false, error: 'load_failed' };
  }
  const managerUserIds = (managers ?? []).map((member) => member.user_id);
  if (!managerUserIds.length) return { success: true, options: [] };
  const [recordsResult, profilesResult] = await Promise.all([
    readInBatches(managerUserIds, (batch) =>
      admin
        .from('employee_records')
        .select('id, user_id')
        .eq('organization_id', auth.context.orgId)
        .in('user_id', [...batch]),
    ),
    readInBatches(managerUserIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...batch]),
    ),
  ]);
  if (recordsResult.error || profilesResult.error) {
    logError('Failed to load responsible options:', recordsResult.error ?? profilesResult.error);
    return { success: false, error: 'load_failed' };
  }
  const profileNames = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ]),
  );
  return {
    success: true,
    options: (recordsResult.data ?? [])
      .map((record) => ({
        employeeRecordId: record.id,
        label: (record.user_id ? profileNames.get(record.user_id) : null) || 'Unbenannt',
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  };
}

export async function getJobParkingContexts(): Promise<ActionResult<{ contexts: JobParkingContext[] }>> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await readCompleteRows(
    (from, to) =>
      admin
        .from('work_blockers')
        .select(
          'id, job_id, version, reason, details, responsible_employee_record_id, next_review_date, updated_at',
        )
        .eq('organization_id', auth.context.orgId)
        .eq('kind', 'parking')
        .eq('state', 'open')
        .not('job_id', 'is', null)
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (error) {
    logError('Failed to load job parking contexts:', error);
    return { success: false, error: 'load_failed' };
  }

  const responsibleIds = [
    ...new Set(
      (rows ?? []).flatMap((row) =>
        row.responsible_employee_record_id ? [row.responsible_employee_record_id] : [],
      ),
    ),
  ];
  const recordsResult = await readInBatches(responsibleIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id, first_name, last_name')
      .eq('organization_id', auth.context.orgId)
      .in('id', [...batch]),
  );
  if (recordsResult.error) {
    logError('Failed to resolve parking responsibles:', recordsResult.error);
    return { success: false, error: 'load_failed' };
  }
  const userIds = (recordsResult.data ?? []).flatMap((record) => (record.user_id ? [record.user_id] : []));
  const profilesResult = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logError('Failed to resolve parking responsible profiles:', profilesResult.error);
    return { success: false, error: 'load_failed' };
  }
  const profileNames = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ]),
  );
  const responsibleNames = new Map(
    (recordsResult.data ?? []).map((record) => [
      record.id,
      (record.user_id ? profileNames.get(record.user_id) : null) ||
        [record.first_name, record.last_name].filter(Boolean).join(' ') ||
        'Unbenannt',
    ]),
  );

  return {
    success: true,
    contexts: (rows ?? []).flatMap((row) =>
      row.job_id === null
        ? []
        : [
            {
              jobId: row.job_id,
              blockerId: row.id,
              version: row.version,
              reason: row.reason ?? 'other',
              note: row.details,
              responsibleEmployeeRecordId: row.responsible_employee_record_id,
              responsibleName: row.responsible_employee_record_id
                ? (responsibleNames.get(row.responsible_employee_record_id) ?? null)
                : null,
              nextReviewDate: row.next_review_date,
              updatedAt: row.updated_at,
            },
          ],
    ),
  };
}
