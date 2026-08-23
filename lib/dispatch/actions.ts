'use server';

// P1-12 dispatch server actions. Dispatch is distinct from scheduling, job
// assignment, attendance, recorded time, customer commitment, and message
// delivery: issuing/acknowledging here never creates any of those.

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';

import { CACHE_TAGS } from '@/lib/data/cached';
import { getJobMaterialLines } from '@/lib/inventory/actions';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { fingerprintSnapshot } from '@/lib/planning/capacity';
import {
  addLocalDays,
  formatBerlinLocalDateTime,
  resolveBerlinWallTime,
} from '@/lib/planning/date-time';
import { assessPlanningOccurrences } from '@/lib/planning/server';
import type {
  MaterializedOccurrence,
  PlanningAssignmentDraft,
  PlanningConflict,
} from '@/lib/planning/types';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isCommitmentMismatch } from '@/lib/commitments/types';
import { computeBatchShiftItems, type BatchShiftItem } from './batch';
import {
  deriveTravelNotes,
  latestAcknowledgementByRecipient,
  type AcknowledgementFact,
  type TravelVisitFact,
} from './derivation';
import {
  composeReadiness,
  type MaterialReadinessFacts,
  type ReadinessFacts,
  type SiteReadinessFacts,
} from './readiness';
import {
  loadDispatchOverview,
  loadEmployeeDispatchCards,
  loadEmployeeNameFacts,
} from './server';
import type { ReadinessResult, TravelNote } from './types';

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

function revalidateDispatchMutation(organizationId: string): void {
  revalidatePath('/kalender');
  revalidatePath('/aufgaben');
  updateTag(CACHE_TAGS.jobs(organizationId));
}

function mapRpcError(
  operation: string,
  error: { code?: string; message: string },
  known: string[]
): string {
  console.error(operation, { code: error.code ?? 'unknown' });
  return known.find((identifier) => error.message.includes(identifier)) ?? 'update_failed';
}

// ============================================
// Reads
// ============================================

export async function getDispatchOverview(from: string, to: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to ||
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000 >
      62
  ) {
    return { success: false as const, error: 'invalid_input' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const overview = await loadDispatchOverview({
    orgId: auth.context.orgId,
    from,
    to,
  });
  return overview
    ? { success: true as const, overview }
    : { success: false as const, error: 'load_failed' };
}

export async function getJobDispatchCards(jobId: string) {
  if (!z.string().uuid().safeParse(jobId).success) {
    return { success: false as const, error: 'invalid_input' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const cards = await loadEmployeeDispatchCards({
    orgId: auth.context.orgId,
    userId: auth.context.userId,
    jobId,
  });
  return cards
    ? { success: true as const, cards }
    : { success: false as const, error: 'load_failed' };
}

// ============================================
// Readiness (compositional, honest, never stored as an aggregate)
// ============================================

async function loadSiteFacts(
  admin: AdminClient,
  orgId: string,
  siteId: string | null
): Promise<SiteReadinessFacts> {
  if (!siteId) return { known: false, reason: 'missing' };
  const { data: site, error } = await admin
    .from('client_sites')
    .select('name, access_notes')
    .eq('organization_id', orgId)
    .eq('id', siteId)
    .maybeSingle();
  if (error) return { known: false, reason: 'load_failed' };
  if (!site) return { known: false, reason: 'missing' };
  return { known: true, name: site.name, accessNotes: site.access_notes };
}

async function loadMaterialFacts(jobId: string): Promise<MaterialReadinessFacts> {
  const result = await getJobMaterialLines(jobId);
  if (!result.success) return { state: 'unknown' };
  if (result.lines.length === 0) return { state: 'no_demand' };
  return {
    state: 'demand',
    lines: result.lines.map((line) => ({
      itemName: line.itemName,
      plannedQuantity: line.plannedQuantity,
      takenQuantity: line.takenQuantity,
      availableQuantity: line.availableQuantity,
    })),
  };
}

// Travel facts for the target occurrence's assignees on its Berlin day.
async function loadTravelNotesForOccurrence(
  admin: AdminClient,
  orgId: string,
  occurrence: {
    id: string;
    start_at: string | null;
    end_at: string | null;
  },
  employeeRecordIds: string[]
): Promise<TravelNote[]> {
  if (!occurrence.start_at || !occurrence.end_at || !employeeRecordIds.length) {
    return [];
  }
  const localDate = formatBerlinLocalDateTime(occurrence.start_at).slice(0, 10);
  const dayStart = resolveBerlinWallTime(`${localDate}T00:00`);
  const dayEnd = resolveBerlinWallTime(`${addLocalDays(localDate, 1)}T00:00`);
  if (!dayStart || !dayEnd) return [];
  const { data: dayRows, error } = await admin
    .from('planning_occurrences')
    .select('id, job_id, start_at, end_at')
    .eq('organization_id', orgId)
    .eq('status', 'scheduled')
    .eq('entry_kind', 'job_visit')
    .gte('start_at', dayStart.instant.toISOString())
    .lt('start_at', dayEnd.instant.toISOString())
    .limit(501);
  if (error || (dayRows?.length ?? 0) > 500) return [];
  const sameDayRows = (dayRows ?? []).filter(
    (row) =>
      row.start_at &&
      formatBerlinLocalDateTime(row.start_at).slice(0, 10) === localDate
  );
  const rowIds = sameDayRows.map((row) => row.id);
  if (!rowIds.length) return [];
  const [assignmentsResult, jobsResult] = await Promise.all([
    admin
      .from('planning_occurrence_assignments')
      .select('occurrence_id, employee_record_id')
      .eq('organization_id', orgId)
      .in('occurrence_id', rowIds)
      .in('employee_record_id', employeeRecordIds),
    admin
      .from('jobs')
      .select('id, title, description, site_id')
      .eq('organization_id', orgId)
      .in('id', [
        ...new Set(
          sameDayRows.flatMap((row) => (row.job_id ? [row.job_id] : []))
        ),
      ]),
  ]);
  if (assignmentsResult.error || jobsResult.error) return [];
  const nameFacts = await loadEmployeeNameFacts(
    admin,
    orgId,
    (assignmentsResult.data ?? []).map(
      (assignment) => assignment.employee_record_id
    )
  );
  if (!nameFacts) return [];
  const jobs = new Map((jobsResult.data ?? []).map((job) => [job.id, job]));
  const sameDayRowById = new Map(sameDayRows.map((row) => [row.id, row]));
  const facts: TravelVisitFact[] = (assignmentsResult.data ?? []).flatMap(
    (assignment) => {
      const row = sameDayRowById.get(assignment.occurrence_id);
      if (!row?.start_at || !row.end_at) return [];
      const job = row.job_id ? jobs.get(row.job_id) : null;
      const startLocal = formatBerlinLocalDateTime(row.start_at);
      const endLocal = formatBerlinLocalDateTime(row.end_at);
      const sameDay = endLocal.slice(0, 10) === startLocal.slice(0, 10);
      return [
        {
          occurrenceId: row.id,
          title:
            job?.title.trim() || job?.description?.trim() || 'Auftragsbesuch',
          employeeRecordId: assignment.employee_record_id,
          employeeName:
            nameFacts.get(assignment.employee_record_id)?.displayName ??
            'Unbenannt',
          localDate,
          startMinutes:
            Number(startLocal.slice(11, 13)) * 60 +
            Number(startLocal.slice(14, 16)),
          endMinutes: sameDay
            ? Number(endLocal.slice(11, 13)) * 60 +
              Number(endLocal.slice(14, 16))
            : 24 * 60,
          siteId: job?.site_id ?? null,
        },
      ];
    }
  );
  return deriveTravelNotes(facts);
}

function toMaterializedOccurrence(occurrence: {
  id: string;
  time_kind: 'timed' | 'all_day';
  start_at: string | null;
  end_at: string | null;
  start_date: string | null;
  end_date_exclusive: string | null;
  original_start_local: string | null;
}): MaterializedOccurrence {
  return {
    // Used only as an in-memory assignment key during assessment.
    originalStartLocal: occurrence.original_start_local ?? occurrence.id,
    timeKind: occurrence.time_kind,
    startAt: occurrence.start_at,
    endAt: occurrence.end_at,
    startDate: occurrence.start_date,
    endDateExclusive: occurrence.end_date_exclusive,
    dstResolution: 'exact',
  };
}

export async function composeReadinessForTarget(input: {
  admin: AdminClient;
  orgId: string;
  occurrenceId: string | null;
  jobId: string | null;
}): Promise<
  | { success: true; readiness: ReadinessResult; fingerprint: string }
  | { success: false; error: string }
> {
  let planningConflicts: PlanningConflict[] = [];
  let site: SiteReadinessFacts = { known: false, reason: 'missing' };
  let travelNotes: TravelNote[] = [];
  let jobId = input.jobId;

  if (input.occurrenceId) {
    const { data: occurrence, error } = await input.admin
      .from('planning_occurrences')
      .select(
        'id, job_id, time_kind, status, start_at, end_at, start_date, end_date_exclusive, original_start_local'
      )
      .eq('organization_id', input.orgId)
      .eq('id', input.occurrenceId)
      .maybeSingle();
    if (error || !occurrence || !occurrence.job_id) {
      return { success: false, error: 'dispatch_occurrence_not_found' };
    }
    jobId = occurrence.job_id;
    const { data: assignments, error: assignmentError } = await input.admin
      .from('planning_occurrence_assignments')
      .select('employee_record_id, team_source_id')
      .eq('organization_id', input.orgId)
      .eq('occurrence_id', occurrence.id);
    if (assignmentError) return { success: false, error: 'load_failed' };
    const drafts: PlanningAssignmentDraft[] = (assignments ?? []).map(
      (assignment) => ({
        employeeRecordId: assignment.employee_record_id,
        teamSourceId: assignment.team_source_id,
      })
    );
    const assessment = await assessPlanningOccurrences({
      orgId: input.orgId,
      jobId: occurrence.job_id,
      occurrences: [toMaterializedOccurrence(occurrence)],
      assignments: drafts,
      excludeOccurrenceId: occurrence.id,
    });
    if (!assessment) return { success: false, error: 'load_failed' };
    planningConflicts = assessment.conflicts;
    travelNotes = await loadTravelNotesForOccurrence(
      input.admin,
      input.orgId,
      occurrence,
      drafts.map((draft) => draft.employeeRecordId)
    );
  }

  if (!jobId) return { success: false, error: 'invalid_input' };
  const { data: job, error: jobError } = await input.admin
    .from('jobs')
    .select('id, site_id')
    .eq('organization_id', input.orgId)
    .eq('id', jobId)
    .maybeSingle();
  if (jobError || !job) return { success: false, error: 'dispatch_job_not_found' };
  const [siteFacts, material] = await Promise.all([
    loadSiteFacts(input.admin, input.orgId, job.site_id),
    loadMaterialFacts(jobId),
  ]);
  site = siteFacts;

  const facts: ReadinessFacts = {
    planningConflicts,
    site,
    travelNotes,
    material,
  };
  const readiness = composeReadiness(facts);
  const fingerprint = await fingerprintSnapshot(readiness.snapshot);
  return { success: true, readiness, fingerprint };
}

export async function previewDispatchReadiness(input: {
  occurrenceId?: string;
  jobId?: string;
}) {
  const occurrenceId = input.occurrenceId ?? null;
  const jobId = input.jobId ?? null;
  if (
    (occurrenceId === null) === (jobId === null) ||
    (occurrenceId !== null &&
      !z.string().uuid().safeParse(occurrenceId).success) ||
    (jobId !== null && !z.string().uuid().safeParse(jobId).success)
  ) {
    return { success: false as const, error: 'invalid_input' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const result = await composeReadinessForTarget({
    admin,
    orgId: auth.context.orgId,
    occurrenceId,
    jobId,
  });
  if (!result.success) return result;
  return {
    success: true as const,
    readiness: result.readiness,
    fingerprint: result.fingerprint,
  };
}

// ============================================
// Dispatch mutations
// ============================================

const issueDispatchSchema = z
  .object({
    occurrenceId: z.string().uuid().nullable(),
    jobId: z.string().uuid().nullable(),
    recipientEmployeeRecordIds: z.array(z.string().uuid()).max(100).nullable(),
    note: z.string().trim().max(2000).nullable(),
    requestId: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if ((value.occurrenceId === null) === (value.jobId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['occurrenceId'],
        message: 'Genau ein Ziel (Besuch oder Auftrag) angeben.',
      });
    }
  });

export async function issueDispatch(rawInput: unknown) {
  const parsed = issueDispatchSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false as const, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  // Snapshot what the dispatcher saw at issue time for audit; surfaces keep
  // showing live readiness.
  const readiness = await composeReadinessForTarget({
    admin,
    orgId: auth.context.orgId,
    occurrenceId: parsed.data.occurrenceId,
    jobId: parsed.data.jobId,
  });
  if (!readiness.success) return readiness;

  const { data, error } = await admin.rpc('issue_planning_dispatch', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_occurrence_id: parsed.data.occurrenceId ?? undefined,
    p_job_id: parsed.data.jobId ?? undefined,
    p_recipient_employee_record_ids:
      parsed.data.recipientEmployeeRecordIds ?? undefined,
    p_note: parsed.data.note ?? undefined,
    p_readiness_snapshot: readiness.readiness.snapshot,
    p_readiness_fingerprint: readiness.fingerprint,
    p_request_id: parsed.data.requestId,
  });
  if (error) {
    return {
      success: false as const,
      error: mapRpcError('Failed to issue dispatch', error, [
        'dispatch_occurrence_not_found',
        'dispatch_occurrence_not_scheduled',
        'dispatch_job_not_found',
        'dispatch_job_not_dispatchable',
        'dispatch_job_has_scheduled_visits',
        'dispatch_requires_recipients',
        'dispatch_recipient_not_found',
      ]),
    };
  }
  revalidateDispatchMutation(auth.context.orgId);
  return { success: true as const, dispatchId: data as string };
}

export async function updateDispatchInstruction(input: {
  dispatchId: string;
  expectedRevisionNumber: number;
  note: string | null;
  recipientEmployeeRecordIds: string[] | null;
}) {
  const schema = z.object({
    dispatchId: z.string().uuid(),
    expectedRevisionNumber: z.number().int().positive(),
    note: z.string().trim().max(2000).nullable(),
    recipientEmployeeRecordIds: z.array(z.string().uuid()).max(100).nullable(),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('update_planning_dispatch_instruction', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_dispatch_id: parsed.data.dispatchId,
    p_expected_revision_number: parsed.data.expectedRevisionNumber,
    p_note: parsed.data.note ?? undefined,
    p_recipient_employee_record_ids:
      parsed.data.recipientEmployeeRecordIds ?? undefined,
  });
  if (error) {
    return {
      success: false as const,
      error: mapRpcError('Failed to update dispatch instruction', error, [
        'dispatch_not_found',
        'dispatch_not_active',
        'stale_dispatch_revision',
        'dispatch_recipients_follow_assignments',
        'dispatch_requires_recipients',
        'dispatch_recipient_not_found',
      ]),
    };
  }
  revalidateDispatchMutation(auth.context.orgId);
  return { success: true as const, revisionNumber: data as number };
}

export async function acknowledgeDispatch(
  dispatchId: string,
  expectedRevisionNumber: number
) {
  if (
    !z.string().uuid().safeParse(dispatchId).success ||
    !Number.isInteger(expectedRevisionNumber) ||
    expectedRevisionNumber < 1
  ) {
    return { success: false as const, error: 'invalid_input' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('acknowledge_planning_dispatch', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_dispatch_id: dispatchId,
    p_expected_revision_number: expectedRevisionNumber,
  });
  if (error) {
    return {
      success: false as const,
      error: mapRpcError('Failed to acknowledge dispatch', error, [
        'dispatch_not_found',
        'dispatch_not_active',
        'stale_dispatch_revision',
        'not_a_recipient',
        'open_challenge_exists',
      ]),
    };
  }
  revalidateDispatchMutation(auth.context.orgId);
  return { success: true as const };
}

export async function challengeDispatch(
  dispatchId: string,
  expectedRevisionNumber: number,
  reason: string
) {
  const trimmed = reason.trim();
  if (
    !z.string().uuid().safeParse(dispatchId).success ||
    !Number.isInteger(expectedRevisionNumber) ||
    expectedRevisionNumber < 1
  ) {
    return { success: false as const, error: 'invalid_input' };
  }
  if (trimmed.length < 8 || trimmed.length > 500) {
    return { success: false as const, error: 'challenge_reason_invalid' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('challenge_planning_dispatch', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_dispatch_id: dispatchId,
    p_expected_revision_number: expectedRevisionNumber,
    p_reason: trimmed,
  });
  if (error) {
    return {
      success: false as const,
      error: mapRpcError('Failed to challenge dispatch', error, [
        'dispatch_not_found',
        'dispatch_not_active',
        'stale_dispatch_revision',
        'not_a_recipient',
        'open_challenge_exists',
        'challenge_reason_invalid',
      ]),
    };
  }
  revalidateDispatchMutation(auth.context.orgId);
  return { success: true as const };
}

export async function resolveDispatchChallenge(
  acknowledgementId: string,
  resolutionReason: string
) {
  const trimmed = resolutionReason.trim();
  if (!z.string().uuid().safeParse(acknowledgementId).success) {
    return { success: false as const, error: 'invalid_input' };
  }
  if (trimmed.length < 3 || trimmed.length > 1000) {
    return { success: false as const, error: 'resolution_reason_invalid' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('resolve_planning_dispatch_challenge', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_acknowledgement_id: acknowledgementId,
    p_resolution_reason: trimmed,
  });
  if (error) {
    return {
      success: false as const,
      error: mapRpcError('Failed to resolve dispatch challenge', error, [
        'challenge_not_found',
        'resolution_reason_invalid',
      ]),
    };
  }
  revalidateDispatchMutation(auth.context.orgId);
  return { success: true as const };
}

export async function cancelDispatch(dispatchId: string, reason: string) {
  const trimmed = reason.trim();
  if (!z.string().uuid().safeParse(dispatchId).success) {
    return { success: false as const, error: 'invalid_input' };
  }
  if (trimmed.length < 3 || trimmed.length > 1000) {
    return { success: false as const, error: 'cancel_reason_invalid' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { error } = await admin.rpc('cancel_planning_dispatch', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_dispatch_id: dispatchId,
    p_reason: trimmed,
  });
  if (error) {
    return {
      success: false as const,
      error: mapRpcError('Failed to cancel dispatch', error, [
        'dispatch_not_found',
        'cancel_reason_invalid',
      ]),
    };
  }
  revalidateDispatchMutation(auth.context.orgId);
  return { success: true as const };
}

// ============================================
// Batch rescheduling (explicit selection → preview → atomic commit)
// ============================================

const batchSelectionSchema = z.object({
  occurrenceIds: z.array(z.string().uuid()).min(1).max(100),
  dayShift: z.number().int().min(-366).max(366),
  newTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
});

// One preview row per selected occurrence: the catalog promises the manager
// sees each visit's old and new schedule BEFORE committing the batch.
export type BatchPreviewItem = {
  occurrenceId: string;
  title: string;
  oldStartAt: string | null;
  oldStartDate: string | null;
  newStartAt: string | null;
  newStartDate: string | null;
};

type BatchPreparation = {
  items: BatchShiftItem[];
  previewItems: BatchPreviewItem[];
  conflicts: PlanningConflict[];
  assessmentFingerprint: string;
  capacitySnapshot: Record<string, unknown>;
  capacityFingerprint: string;
  qualificationSnapshot: Record<string, unknown>;
  qualificationFingerprint: string;
  commitmentMismatchTitles: string[];
  invalidatedAcknowledgementCount: number;
};

async function prepareBatchReschedule(
  admin: AdminClient,
  orgId: string,
  input: z.infer<typeof batchSelectionSchema>
): Promise<
  | { success: true; preparation: BatchPreparation }
  | { success: false; error: string }
> {
  const uniqueIds = [...new Set(input.occurrenceIds)];
  const { data: rows, error } = await admin
    .from('planning_occurrences')
    .select(
      'id, version, status, entry_kind, job_id, time_kind, start_at, end_at, start_date, end_date_exclusive, original_start_local'
    )
    .eq('organization_id', orgId)
    .in('id', uniqueIds);
  if (error || (rows?.length ?? 0) !== uniqueIds.length) {
    return { success: false, error: 'batch_item_not_found' };
  }
  const now = Date.now();
  const today = formatBerlinLocalDateTime(new Date()).slice(0, 10);
  for (const row of rows ?? []) {
    if (row.status !== 'scheduled') {
      return { success: false, error: `batch_item_not_scheduled:${row.id}` };
    }
    const isFuture = row.start_at
      ? new Date(row.start_at).getTime() > now
      : Boolean(row.start_date && row.start_date > today);
    if (!isFuture) {
      return { success: false, error: `batch_item_started:${row.id}` };
    }
  }

  const shiftResult = computeBatchShiftItems(
    (rows ?? []).map((row) => ({
      occurrenceId: row.id,
      version: row.version,
      timeKind: row.time_kind,
      startAt: row.start_at,
      endAt: row.end_at,
      startDate: row.start_date,
      endDateExclusive: row.end_date_exclusive,
    })),
    { dayShift: input.dayShift, newTime: input.newTime }
  );
  if (!shiftResult.success) {
    return {
      success: false,
      error: shiftResult.occurrenceId
        ? `${shiftResult.error}:${shiftResult.occurrenceId}`
        : shiftResult.error,
    };
  }

  const { data: assignmentRows, error: assignmentError } = await admin
    .from('planning_occurrence_assignments')
    .select('occurrence_id, employee_record_id, team_source_id')
    .eq('organization_id', orgId)
    .in('occurrence_id', uniqueIds)
    .limit(5001);
  if (assignmentError || (assignmentRows?.length ?? 0) > 5000) {
    return { success: false, error: 'load_failed' };
  }
  const assignmentsByOccurrence = new Map<string, PlanningAssignmentDraft[]>();
  for (const row of assignmentRows ?? []) {
    const list = assignmentsByOccurrence.get(row.occurrence_id) ?? [];
    list.push({
      employeeRecordId: row.employee_record_id,
      teamSourceId: row.team_source_id,
    });
    assignmentsByOccurrence.set(row.occurrence_id, list);
  }

  // The selection may span several jobs; the qualification part of the shared
  // assessment is job-scoped, so it runs per group. A null group carries any
  // selected occurrences without a job so they are never silently unassessed.
  const jobIds = [
    ...new Set((rows ?? []).flatMap((row) => (row.job_id ? [row.job_id] : []))),
  ];
  const hasJoblessRows = (rows ?? []).some((row) => row.job_id === null);
  const jobGroups: Array<string | null> = [
    ...jobIds,
    ...(hasJoblessRows || jobIds.length === 0 ? [null] : []),
  ];
  const materializedById = new Map(
    shiftResult.items.map((item) => {
      const source = (rows ?? []).find((row) => row.id === item.occurrenceId)!;
      return [
        item.occurrenceId,
        {
          originalStartLocal: item.occurrenceId,
          timeKind: source.time_kind,
          startAt: item.startAt,
          endAt: item.endAt,
          startDate: item.startDate,
          endDateExclusive: item.endDateExclusive,
          dstResolution: item.dstResolution,
        } satisfies MaterializedOccurrence,
      ];
    })
  );
  const conflicts: PlanningConflict[] = [];
  const partFingerprints: Record<string, string> = {};
  const capacityParts: unknown[] = [];
  const qualificationParts: unknown[] = [];
  // Deterministic group order keeps the combined fingerprint stable between
  // preview and commit; the independent assessments run concurrently.
  const sortedGroups = [...jobGroups].sort((left, right) =>
    (left ?? '').localeCompare(right ?? '')
  );
  const groupAssessments = await Promise.all(
    sortedGroups.map(async (jobId) => {
      const jobRows = (rows ?? []).filter((row) =>
        jobId === null ? row.job_id === null : row.job_id === jobId
      );
      if (!jobRows.length) return { jobId, assessment: null, empty: true };
      const assignmentsByKey = new Map(
        jobRows.map((row) => [row.id, assignmentsByOccurrence.get(row.id) ?? []])
      );
      const assessment = await assessPlanningOccurrences({
        orgId,
        jobId,
        occurrences: jobRows.map((row) => materializedById.get(row.id)!),
        assignments: [],
        assignmentsByOriginalStartLocal: assignmentsByKey,
        excludeOccurrenceIds: uniqueIds,
      });
      return { jobId, assessment, empty: false };
    })
  );
  for (const group of groupAssessments) {
    if (group.empty) continue;
    if (!group.assessment) return { success: false, error: 'load_failed' };
    conflicts.push(...group.assessment.conflicts);
    partFingerprints[group.jobId ?? 'none'] =
      group.assessment.assessmentFingerprint;
    capacityParts.push(group.assessment.capacitySnapshot);
    qualificationParts.push(group.assessment.qualificationSnapshot);
  }
  const capacitySnapshot = { parts: capacityParts };
  const qualificationSnapshot = { parts: qualificationParts };
  const capacityFingerprint = await fingerprintSnapshot(capacitySnapshot);
  const qualificationFingerprint = await fingerprintSnapshot(
    qualificationSnapshot
  );
  const assessmentFingerprint = await fingerprintSnapshot({
    partFingerprints,
    dayShift: input.dayShift,
    newTime: input.newTime,
    occurrenceIds: uniqueIds.slice().sort(),
  });

  // Impact preview: active commitments that would mismatch, and current
  // acknowledgements that a schedule change will invalidate.
  const [commitmentsResult, dispatchesResult] = await Promise.all([
    admin
      .from('planning_customer_commitments')
      .select(
        'occurrence_id, committed_date, window_start_time, window_end_time'
      )
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .in('occurrence_id', uniqueIds),
    admin
      .from('planning_dispatches')
      .select('id, occurrence_id, current_revision_id')
      .eq('organization_id', orgId)
      .eq('status', 'active')
      .in('occurrence_id', uniqueIds),
  ]);
  if (commitmentsResult.error || dispatchesResult.error) {
    return { success: false, error: 'load_failed' };
  }
  const jobTitleResult = jobIds.length
    ? await admin
        .from('jobs')
        .select('id, title, description')
        .eq('organization_id', orgId)
        .in('id', jobIds)
    : { data: [], error: null };
  if (jobTitleResult.error) return { success: false, error: 'load_failed' };
  const jobTitles = new Map(
    (jobTitleResult.data ?? []).map((job) => [
      job.id,
      job.title.trim() || job.description?.trim() || 'Auftrag',
    ])
  );
  const previewSortKey = (
    startAt: string | null,
    startDate: string | null
  ): number =>
    startAt
      ? new Date(startAt).getTime()
      : startDate
        ? Date.parse(`${startDate}T00:00:00Z`)
        : 0;
  const previewItems: BatchPreviewItem[] = shiftResult.items
    .map((item) => {
      const source = (rows ?? []).find((row) => row.id === item.occurrenceId)!;
      return {
        occurrenceId: item.occurrenceId,
        title: jobTitles.get(source.job_id ?? '') ?? 'Auftragsbesuch',
        oldStartAt: source.start_at,
        oldStartDate: source.start_date,
        newStartAt: item.startAt,
        newStartDate: item.startDate,
      };
    })
    .sort(
      (left, right) =>
        previewSortKey(left.oldStartAt, left.oldStartDate) -
          previewSortKey(right.oldStartAt, right.oldStartDate) ||
        left.occurrenceId.localeCompare(right.occurrenceId)
    );
  const commitmentMismatchTitles = [
    ...new Set(
      (commitmentsResult.data ?? []).flatMap((commitment) => {
      const item = materializedById.get(commitment.occurrence_id);
      const source = (rows ?? []).find(
        (row) => row.id === commitment.occurrence_id
      );
      if (!item || !source) return [];
      const startLocal = item.startAt
        ? formatBerlinLocalDateTime(item.startAt)
        : null;
      const mismatch = isCommitmentMismatch(
        {
          committedDate: commitment.committed_date,
          windowStartTime: commitment.window_start_time,
          windowEndTime: commitment.window_end_time,
        },
        {
          timeKind: source.time_kind,
          localStartDate: startLocal?.slice(0, 10) ?? item.startDate ?? '',
          localStartTime: startLocal?.slice(11, 16) ?? null,
        }
      );
        return mismatch
          ? [jobTitles.get(source.job_id ?? '') ?? 'Auftrag']
          : [];
      })
    ),
  ];

  const revisionIds = (dispatchesResult.data ?? []).flatMap((row) =>
    row.current_revision_id ? [row.current_revision_id] : []
  );
  let invalidatedAcknowledgementCount = 0;
  if (revisionIds.length) {
    const { data: ackRows, error: ackError } = await admin
      .from('planning_dispatch_acknowledgements')
      .select('revision_id, employee_record_id, state, created_at, id, reason, challenge_resolved_at')
      .eq('organization_id', orgId)
      .in('revision_id', revisionIds)
      .limit(5001);
    if (ackError || (ackRows?.length ?? 0) > 5000) {
      return { success: false, error: 'load_failed' };
    }
    // Single pass: group by revision, then apply the shared latest-row rule.
    const factsByRevision = new Map<string, AcknowledgementFact[]>();
    for (const row of ackRows ?? []) {
      const list = factsByRevision.get(row.revision_id) ?? [];
      list.push({
        id: row.id,
        employeeRecordId: row.employee_record_id,
        state: row.state,
        reason: row.reason,
        challengeResolvedAt: row.challenge_resolved_at,
        createdAt: row.created_at,
      });
      factsByRevision.set(row.revision_id, list);
    }
    for (const facts of factsByRevision.values()) {
      for (const latest of latestAcknowledgementByRecipient(facts).values()) {
        if (latest.state === 'acknowledged' || latest.state === 'carried_forward') {
          invalidatedAcknowledgementCount += 1;
        }
      }
    }
  }

  return {
    success: true,
    preparation: {
      items: shiftResult.items,
      previewItems,
      conflicts,
      assessmentFingerprint,
      capacitySnapshot,
      capacityFingerprint,
      qualificationSnapshot,
      qualificationFingerprint,
      commitmentMismatchTitles,
      invalidatedAcknowledgementCount,
    },
  };
}

export async function previewBatchReschedule(rawInput: unknown) {
  const parsed = batchSelectionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false as const, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const prepared = await prepareBatchReschedule(
    admin,
    auth.context.orgId,
    parsed.data
  );
  if (!prepared.success) return prepared;
  return {
    success: true as const,
    itemCount: prepared.preparation.items.length,
    items: prepared.preparation.previewItems,
    conflicts: prepared.preparation.conflicts,
    assessmentFingerprint: prepared.preparation.assessmentFingerprint,
    commitmentMismatchTitles: prepared.preparation.commitmentMismatchTitles,
    invalidatedAcknowledgementCount:
      prepared.preparation.invalidatedAcknowledgementCount,
  };
}

const batchCommitSchema = batchSelectionSchema.extend({
  reason: z.string().trim().min(8).max(1000),
  requestId: z.string().uuid(),
  overrideReason: z.string().trim().min(8).max(1000).nullable(),
  assessmentFingerprint: z.string().length(64).nullable(),
});

export async function batchReschedule(rawInput: unknown) {
  const parsed = batchCommitSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false as const, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const prepared = await prepareBatchReschedule(
    admin,
    auth.context.orgId,
    parsed.data
  );
  if (!prepared.success) return prepared;
  const { preparation } = prepared;
  if (preparation.conflicts.length > 0) {
    if (!parsed.data.overrideReason) {
      return {
        success: false as const,
        error: 'planning_warning',
        conflicts: preparation.conflicts,
        fingerprint: preparation.assessmentFingerprint,
      };
    }
    if (parsed.data.assessmentFingerprint !== preparation.assessmentFingerprint) {
      return {
        success: false as const,
        error: 'stale_assessment',
        conflicts: preparation.conflicts,
        fingerprint: preparation.assessmentFingerprint,
      };
    }
  }

  const { data, error } = await admin.rpc(
    'batch_reschedule_planning_occurrences',
    {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_request_id: parsed.data.requestId,
      p_reason: parsed.data.reason,
      p_items: preparation.items.map((item) => ({
        occurrenceId: item.occurrenceId,
        expectedVersion: item.expectedVersion,
        startAt: item.startAt,
        endAt: item.endAt,
        startDate: item.startDate,
        endDateExclusive: item.endDateExclusive,
        dstResolution: item.dstResolution,
      })),
      p_capacity_snapshot: preparation.capacitySnapshot,
      p_capacity_fingerprint: preparation.capacityFingerprint,
      p_qualification_snapshot: preparation.qualificationSnapshot,
      p_qualification_fingerprint: preparation.qualificationFingerprint,
      p_override_reason: parsed.data.overrideReason ?? undefined,
    }
  );
  if (error) {
    return {
      success: false as const,
      error: mapRpcError('Failed to batch reschedule', error, [
        'batch_item_not_found',
        'batch_item_not_scheduled',
        'batch_item_stale',
        'batch_item_started',
        'batch_item_invalid',
        'batch_reason_invalid',
        'batch_selection_invalid',
      ]),
    };
  }
  revalidateDispatchMutation(auth.context.orgId);
  updateTag(CACHE_TAGS.projects(auth.context.orgId));
  return { success: true as const, occurrenceIds: (data ?? []) as string[] };
}
