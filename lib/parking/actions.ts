'use server';

// P1-12 Parkplatz context: jobs.status = 'geparkt' stays the authoritative
// parked signal; this adds the manager-owned reason/responsible/next-review
// context. Legacy parked jobs without context remain a visible labeled
// exception — nothing is fabricated for them.

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';

import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import {
  PARKING_REASON_LABELS,
  type JobParkingContext,
  type JobParkingReason,
} from './types';

// One source of truth for the reason vocabulary: the label map's keys.
const PARKING_REASONS = Object.keys(PARKING_REASON_LABELS) as [
  JobParkingReason,
  ...JobParkingReason[],
];

const parkingContextSchema = z.object({
  jobId: z.string().uuid(),
  reason: z.enum(PARKING_REASONS),
  note: z.string().trim().max(1000).nullable(),
  responsibleEmployeeRecordId: z.string().uuid().nullable(),
  nextReviewDate: z.string().date().nullable(),
});

export type SetParkingContextInput = z.infer<typeof parkingContextSchema>;

export async function setJobParkingContext(
  rawInput: unknown
): Promise<{ success: true } | { success: false; error: string }> {
  const parsed = parkingContextSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('set_job_parking_context', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_job_id: parsed.data.jobId,
    p_reason: parsed.data.reason,
    p_note: parsed.data.note ?? undefined,
    p_responsible_employee_record_id:
      parsed.data.responsibleEmployeeRecordId ?? undefined,
    p_next_review_date: parsed.data.nextReviewDate ?? undefined,
  });
  if (error) {
    console.error('Failed to set job parking context:', {
      code: error.code ?? 'unknown',
    });
    return {
      success: false,
      error: error.message.includes('job_not_parked')
        ? 'job_not_parked'
        : error.message.includes('responsible_not_manager')
          ? 'responsible_not_manager'
          : error.message.includes('job_not_found')
            ? 'job_not_found'
            : 'update_failed',
    };
  }
  revalidatePath('/kalender');
  updateTag(CACHE_TAGS.jobs(auth.context.orgId));
  return { success: true };
}

export type ParkingResponsibleOption = {
  employeeRecordId: string;
  label: string;
};

// Employee records currently linked to an active admin/Büro membership — the
// only valid "verantwortlich" targets (the RPC re-validates on write).
export async function getParkingResponsibleOptions(): Promise<
  | { success: true; options: ParkingResponsibleOption[] }
  | { success: false; error: string }
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
    console.error('Failed to load manager memberships:', { code: membersError.code ?? 'unknown' });
    return { success: false, error: 'load_failed' };
  }
  const managerUserIds = (managers ?? []).map((member) => member.user_id);
  if (!managerUserIds.length) return { success: true, options: [] };
  const [recordsResult, profilesResult] = await Promise.all([
    admin
      .from('employee_records')
      .select('id, user_id')
      .eq('organization_id', auth.context.orgId)
      .in('user_id', managerUserIds),
    admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', managerUserIds),
  ]);
  if (recordsResult.error || profilesResult.error) {
    console.error('Failed to load responsible options:', {
      code: (recordsResult.error ?? profilesResult.error)?.code ?? 'unknown',
    });
    return { success: false, error: 'load_failed' };
  }
  const profileNames = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ])
  );
  return {
    success: true,
    options: (recordsResult.data ?? [])
      .map((record) => ({
        employeeRecordId: record.id,
        label:
          (record.user_id ? profileNames.get(record.user_id) : null) ||
          'Unbenannt',
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  };
}

export async function getJobParkingContexts(): Promise<
  | { success: true; contexts: JobParkingContext[] }
  | { success: false; error: string }
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: rows, error } = await admin
    .from('job_parking_contexts')
    .select(
      'job_id, reason, note, responsible_employee_record_id, next_review_date, updated_at'
    )
    .eq('organization_id', auth.context.orgId)
    .limit(1001);
  if (error || (rows?.length ?? 0) > 1000) {
    console.error('Failed to load job parking contexts:', { code: error?.code ?? 'overflow' });
    return { success: false, error: 'load_failed' };
  }

  const responsibleIds = [
    ...new Set(
      (rows ?? []).flatMap((row) =>
        row.responsible_employee_record_id
          ? [row.responsible_employee_record_id]
          : []
      )
    ),
  ];
  const recordsResult = responsibleIds.length
    ? await admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', auth.context.orgId)
        .in('id', responsibleIds)
    : { data: [], error: null };
  if (recordsResult.error) {
    console.error('Failed to resolve parking responsibles:', {
      code: recordsResult.error.code ?? 'unknown',
    });
    return { success: false, error: 'load_failed' };
  }
  const userIds = (recordsResult.data ?? []).flatMap((record) =>
    record.user_id ? [record.user_id] : []
  );
  const profilesResult = userIds.length
    ? await admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', userIds)
    : { data: [], error: null };
  if (profilesResult.error) {
    console.error('Failed to resolve parking responsible profiles:', {
      code: profilesResult.error.code ?? 'unknown',
    });
    return { success: false, error: 'load_failed' };
  }
  const profileNames = new Map(
    (profilesResult.data ?? []).map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ])
  );
  const responsibleNames = new Map(
    (recordsResult.data ?? []).map((record) => [
      record.id,
      (record.user_id ? profileNames.get(record.user_id) : null) ||
        [record.first_name, record.last_name].filter(Boolean).join(' ') ||
        'Unbenannt',
    ])
  );

  return {
    success: true,
    contexts: (rows ?? []).map((row) => ({
      jobId: row.job_id,
      reason: row.reason,
      note: row.note,
      responsibleEmployeeRecordId: row.responsible_employee_record_id,
      responsibleName: row.responsible_employee_record_id
        ? (responsibleNames.get(row.responsible_employee_record_id) ?? null)
        : null,
      nextReviewDate: row.next_review_date,
      updatedAt: row.updated_at,
    })),
  };
}
