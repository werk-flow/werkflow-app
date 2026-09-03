'use server';

// P1-12 Parkplatz context: jobs.status = 'geparkt' stays the authoritative
// parked signal; this adds the manager-owned reason/responsible/next-review
// context. Legacy parked jobs without context remain a visible labeled
// exception — nothing is fabricated for them.

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { CACHE_TAGS } from '@/lib/data/cached';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';
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
  jobId: uuidSchema,
  reason: z.enum(PARKING_REASONS),
  note: z.string().trim().max(1000).nullable(),
  responsibleEmployeeRecordId: uuidSchema,
  nextReviewDate: z.string().date(),
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
  const { data: existing, error: existingError } = await admin
    .from('work_blockers')
    .select('id, version')
    .eq('organization_id', auth.context.orgId)
    .eq('job_id', parsed.data.jobId)
    .eq('kind', 'parking')
    .eq('state', 'open')
    .maybeSingle();
  if (existingError) {
    console.error('Failed to load open parking blocker:', {
      code: existingError.code ?? 'unknown',
    });
    return { success: false, error: 'load_failed' };
  }
  if (!existing) return { success: false, error: 'job_not_parked' };
  const { error } = await admin.rpc('upsert_work_blocker', {
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
  } as unknown as Database['public']['Functions']['upsert_work_blocker']['Args']);
  if (error) {
    console.error('Failed to set job parking context:', {
      code: error.code ?? 'unknown',
    });
    return {
      success: false,
      error: error.message.includes('work_blocker_owner_invalid')
        ? 'responsible_not_manager'
        : error.message.includes('work_blocker_stale_version')
          ? 'stale_version'
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
    .from('work_blockers')
    .select(
      'id, job_id, version, reason, details, responsible_employee_record_id, next_review_date, updated_at'
    )
    .eq('organization_id', auth.context.orgId)
    .eq('kind', 'parking')
    .eq('state', 'open')
    .not('job_id', 'is', null)
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
      jobId: row.job_id!,
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
    })),
  };
}
