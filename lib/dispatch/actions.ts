'use server';

// Dispatch server actions. Dispatch is distinct from scheduling, job
// assignment, attendance, recorded time, customer commitment, and message
// delivery: issuing/acknowledging here never creates any of those.

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { revalidatePath } from 'next/cache';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { fingerprintSnapshot } from '@/lib/planning/capacity';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { formatBerlinLocalDateTime } from '@/lib/planning/date-time';
import { assessPlanningOccurrences } from '@/lib/planning/server';
import type {
  MaterializedOccurrence,
  PlanningActionResult,
  PlanningAssignmentDraft,
  PlanningConflict,
} from '@/lib/planning/types';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { isCommitmentMismatch } from '@/lib/commitments/types';
import { computeBatchShiftItems, type BatchShiftItem } from './batch';
import { latestAcknowledgementByRecipient, type AcknowledgementFact } from './derivation';
import { loadDispatchOverview, loadEmployeeDispatchCards } from './server';
import { composeReadinessForTarget } from './readiness-target';
import type { DispatchOverview, EmployeeDispatchCard, ReadinessResult } from './types';
import { logError } from '@/lib/logging';

function revalidateDispatchMutation(): void {
  revalidatePath('/aufgaben');
}

function mapRpcError(operation: string, error: { code?: string; message: string }, known: string[]): string {
  logError(operation, error);
  return known.find((identifier) => error.message.includes(identifier)) ?? 'update_failed';
}

// ============================================
// Reads
// ============================================

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const revisionNumberSchema = z.number().int().min(1);

export async function getDispatchOverview(
  rawFrom: string,
  rawTo: string,
): Promise<ActionResult<{ overview: DispatchOverview }>> {
  const range = z.object({ from: isoDateSchema, to: isoDateSchema }).safeParse({ from: rawFrom, to: rawTo });
  if (!range.success) return { success: false as const, error: 'invalid_input' };
  const { from, to } = range.data;
  if (from > to || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > 62) {
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
  return overview ? { success: true as const, overview } : { success: false as const, error: 'load_failed' };
}

export async function getJobDispatchCards(
  jobId: string,
): Promise<ActionResult<{ cards: EmployeeDispatchCard[] }>> {
  if (!uuidSchema.safeParse(jobId).success) {
    return { success: false as const, error: 'invalid_input' };
  }
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const cards = await loadEmployeeDispatchCards({
    orgId: auth.context.orgId,
    userId: auth.context.userId,
    jobId,
  });
  return cards ? { success: true as const, cards } : { success: false as const, error: 'load_failed' };
}

// ============================================
// Readiness (compositional, honest, never stored as an aggregate)
// ============================================

export async function previewDispatchReadiness(rawInput: {
  occurrenceId?: string;
  jobId?: string;
}): Promise<ActionResult<{ readiness: ReadinessResult; fingerprint: string }>> {
  const parsed = z
    .object({ occurrenceId: uuidSchema.optional(), jobId: uuidSchema.optional() })
    .safeParse(rawInput);
  if (!parsed.success) return { success: false as const, error: 'invalid_input' };
  const occurrenceId = parsed.data.occurrenceId ?? null;
  const jobId = parsed.data.jobId ?? null;
  if ((occurrenceId === null) === (jobId === null)) {
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
    occurrenceId: uuidSchema.nullable(),
    jobId: uuidSchema.nullable(),
    recipientEmployeeRecordIds: z.array(uuidSchema).max(100).nullable(),
    note: z.string().trim().max(2000).nullable(),
    requestId: uuidSchema,
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

export async function issueDispatch(rawInput: unknown): Promise<ActionResult<{ dispatchId: string }>> {
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
    ...(parsed.data.occurrenceId !== null ? { p_occurrence_id: parsed.data.occurrenceId } : {}),
    ...(parsed.data.jobId !== null ? { p_job_id: parsed.data.jobId } : {}),
    ...(parsed.data.recipientEmployeeRecordIds !== null
      ? { p_recipient_employee_record_ids: parsed.data.recipientEmployeeRecordIds }
      : {}),
    ...(parsed.data.note !== null ? { p_note: parsed.data.note } : {}),
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
  revalidateDispatchMutation();
  return { success: true as const, dispatchId: data as string };
}

export async function acknowledgeDispatch(
  dispatchId: string,
  rawExpectedRevisionNumber: number,
): Promise<ActionResult> {
  const revision = revisionNumberSchema.safeParse(rawExpectedRevisionNumber);
  if (!uuidSchema.safeParse(dispatchId).success || !revision.success) {
    return { success: false as const, error: 'invalid_input' };
  }
  const expectedRevisionNumber = revision.data;
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
  revalidateDispatchMutation();
  return { success: true as const };
}

export async function challengeDispatch(
  dispatchId: string,
  rawExpectedRevisionNumber: number,
  reason: string,
): Promise<ActionResult> {
  const revision = revisionNumberSchema.safeParse(rawExpectedRevisionNumber);
  if (!uuidSchema.safeParse(dispatchId).success || !revision.success) {
    return { success: false as const, error: 'invalid_input' };
  }
  const expectedRevisionNumber = revision.data;
  const parsedReason = z.string().trim().min(8).max(500).safeParse(reason);
  if (!parsedReason.success) {
    return { success: false as const, error: 'challenge_reason_invalid' };
  }
  const trimmed = parsedReason.data;
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
  revalidateDispatchMutation();
  return { success: true as const };
}

export async function resolveDispatchChallenge(
  acknowledgementId: string,
  resolutionReason: string,
): Promise<ActionResult> {
  if (!uuidSchema.safeParse(acknowledgementId).success) {
    return { success: false as const, error: 'invalid_input' };
  }
  const parsedReason = z.string().trim().min(3).max(1000).safeParse(resolutionReason);
  if (!parsedReason.success) {
    return { success: false as const, error: 'resolution_reason_invalid' };
  }
  const trimmed = parsedReason.data;
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
  revalidateDispatchMutation();
  return { success: true as const };
}

export async function cancelDispatch(dispatchId: string, reason: string): Promise<ActionResult> {
  if (!uuidSchema.safeParse(dispatchId).success) {
    return { success: false as const, error: 'invalid_input' };
  }
  const parsedReason = z.string().trim().min(3).max(1000).safeParse(reason);
  if (!parsedReason.success) {
    return { success: false as const, error: 'cancel_reason_invalid' };
  }
  const trimmed = parsedReason.data;
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
      error: mapRpcError('Failed to cancel dispatch', error, ['dispatch_not_found', 'cancel_reason_invalid']),
    };
  }
  revalidateDispatchMutation();
  return { success: true as const };
}

// ============================================
// Batch rescheduling (explicit selection → preview → atomic commit)
// ============================================

const batchSelectionSchema = z.object({
  occurrenceIds: z.array(uuidSchema).min(1).max(100),
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
  capacitySnapshot: Json;
  capacityFingerprint: string;
  qualificationSnapshot: Json;
  qualificationFingerprint: string;
  commitmentMismatchTitles: string[];
  invalidatedAcknowledgementCount: number;
};

type BatchOccurrenceRow = Pick<
  Database['public']['Tables']['planning_occurrences']['Row'],
  | 'id'
  | 'version'
  | 'status'
  | 'entry_kind'
  | 'job_id'
  | 'time_kind'
  | 'start_at'
  | 'end_at'
  | 'start_date'
  | 'end_date_exclusive'
  | 'original_start_local'
>;

type BatchCommitmentRow = Pick<
  Database['public']['Tables']['planning_customer_commitments']['Row'],
  'occurrence_id' | 'committed_date' | 'window_start_time' | 'window_end_time'
>;

function batchRescheduleLoadFailed(
  read: string,
  readError: { message: string; code?: string },
): ActionFailure {
  logError(`Failed to load batch reschedule ${read}`, readError);
  return { success: false, error: 'load_failed' };
}

async function loadBatchAssignmentsByOccurrence(
  admin: AdminClient,
  orgId: string,
  uniqueIds: string[],
): Promise<
  { success: true; assignmentsByOccurrence: Map<string, PlanningAssignmentDraft[]> } | ActionFailure
> {
  const { data: assignmentRows, error: assignmentError } = await readInBatches(uniqueIds, (batch) =>
    readCompleteRows(
      (from, to) =>
        admin
          .from('planning_occurrence_assignments')
          .select('occurrence_id, employee_record_id, team_source_id')
          .eq('organization_id', orgId)
          .in('occurrence_id', [...batch])
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
  );
  if (assignmentError) return batchRescheduleLoadFailed('assignments', assignmentError);
  const assignmentsByOccurrence = new Map<string, PlanningAssignmentDraft[]>();
  for (const row of assignmentRows) {
    const list = assignmentsByOccurrence.get(row.occurrence_id) ?? [];
    list.push({
      employeeRecordId: row.employee_record_id,
      teamSourceId: row.team_source_id,
    });
    assignmentsByOccurrence.set(row.occurrence_id, list);
  }
  return { success: true, assignmentsByOccurrence };
}

type BatchSelectionAssessment = Pick<
  BatchPreparation,
  | 'conflicts'
  | 'assessmentFingerprint'
  | 'capacitySnapshot'
  | 'capacityFingerprint'
  | 'qualificationSnapshot'
  | 'qualificationFingerprint'
>;

async function assessBatchSelectionGroups(input: {
  orgId: string;
  selection: z.infer<typeof batchSelectionSchema>;
  uniqueIds: string[];
  rows: BatchOccurrenceRow[];
  jobGroups: Array<string | null>;
  assignmentsByOccurrence: Map<string, PlanningAssignmentDraft[]>;
  materializedById: Map<string, MaterializedOccurrence>;
}): Promise<{ success: true; assessment: BatchSelectionAssessment } | ActionFailure> {
  const { orgId, uniqueIds, rows, assignmentsByOccurrence, materializedById } = input;
  const conflicts: PlanningConflict[] = [];
  const partFingerprints: Record<string, string> = {};
  const capacityParts: Json[] = [];
  const qualificationParts: Json[] = [];
  // Deterministic group order keeps the combined fingerprint stable between
  // preview and commit; the independent assessments run concurrently.
  const sortedGroups = [...input.jobGroups].sort((left, right) => (left ?? '').localeCompare(right ?? ''));
  const groupAssessments = await Promise.all(
    sortedGroups.map(async (jobId) => {
      const jobRows = rows.filter((row) => (jobId === null ? row.job_id === null : row.job_id === jobId));
      if (!jobRows.length) return { jobId, assessment: null, empty: true };
      const assignmentsByKey = new Map(
        jobRows.map((row) => [row.id, assignmentsByOccurrence.get(row.id) ?? []]),
      );
      const assessment = await assessPlanningOccurrences({
        orgId,
        jobId,
        occurrences: jobRows.flatMap((row) => {
          const materialized = materializedById.get(row.id);
          return materialized ? [materialized] : [];
        }),
        assignments: [],
        assignmentsByOriginalStartLocal: assignmentsByKey,
        excludeOccurrenceIds: uniqueIds,
      });
      return { jobId, assessment, empty: false };
    }),
  );
  for (const group of groupAssessments) {
    if (group.empty) continue;
    if (!group.assessment) return { success: false, error: 'load_failed' };
    conflicts.push(...group.assessment.conflicts);
    partFingerprints[group.jobId ?? 'none'] = group.assessment.assessmentFingerprint;
    capacityParts.push(group.assessment.capacitySnapshot);
    qualificationParts.push(group.assessment.qualificationSnapshot);
  }
  const capacitySnapshot = { parts: capacityParts };
  const qualificationSnapshot = { parts: qualificationParts };
  const capacityFingerprint = await fingerprintSnapshot(capacitySnapshot);
  const qualificationFingerprint = await fingerprintSnapshot(qualificationSnapshot);
  const assessmentFingerprint = await fingerprintSnapshot({
    partFingerprints,
    dayShift: input.selection.dayShift,
    newTime: input.selection.newTime,
    occurrenceIds: uniqueIds.slice().sort(),
  });
  return {
    success: true,
    assessment: {
      conflicts,
      assessmentFingerprint,
      capacitySnapshot,
      capacityFingerprint,
      qualificationSnapshot,
      qualificationFingerprint,
    },
  };
}

function buildBatchPreviewItems(
  items: BatchShiftItem[],
  rowById: Map<string, BatchOccurrenceRow>,
  jobTitles: Map<string, string>,
): BatchPreviewItem[] {
  const previewSortKey = (startAt: string | null, startDate: string | null): number =>
    startAt ? new Date(startAt).getTime() : startDate ? Date.parse(`${startDate}T00:00:00Z`) : 0;
  return items
    .flatMap((item) => {
      const source = rowById.get(item.occurrenceId);
      if (!source) return [];
      return [
        {
          occurrenceId: item.occurrenceId,
          title: jobTitles.get(source.job_id ?? '') ?? 'Auftragsbesuch',
          oldStartAt: source.start_at,
          oldStartDate: source.start_date,
          newStartAt: item.startAt,
          newStartDate: item.startDate,
        },
      ];
    })
    .sort(
      (left, right) =>
        previewSortKey(left.oldStartAt, left.oldStartDate) -
          previewSortKey(right.oldStartAt, right.oldStartDate) ||
        left.occurrenceId.localeCompare(right.occurrenceId),
    );
}

function collectBatchCommitmentMismatchTitles(
  commitments: BatchCommitmentRow[],
  rows: BatchOccurrenceRow[],
  materializedById: Map<string, MaterializedOccurrence>,
  jobTitles: Map<string, string>,
): string[] {
  return [
    ...new Set(
      commitments.flatMap((commitment) => {
        const item = materializedById.get(commitment.occurrence_id);
        const source = rows.find((row) => row.id === commitment.occurrence_id);
        if (!item || !source) return [];
        const startLocal = item.startAt ? formatBerlinLocalDateTime(item.startAt) : null;
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
          },
        );
        return mismatch ? [jobTitles.get(source.job_id ?? '') ?? 'Auftrag'] : [];
      }),
    ),
  ];
}

async function countBatchInvalidatedAcknowledgements(
  admin: AdminClient,
  orgId: string,
  revisionIds: string[],
): Promise<{ success: true; count: number } | ActionFailure> {
  let invalidatedAcknowledgementCount = 0;
  if (revisionIds.length) {
    const { data: ackRows, error: ackError } = await readInBatches(revisionIds, (batch) =>
      readCompleteRows(
        (from, to) =>
          admin
            .from('planning_dispatch_acknowledgements')
            .select('revision_id, employee_record_id, state, created_at, id, reason, challenge_resolved_at')
            .eq('organization_id', orgId)
            .in('revision_id', [...batch])
            .order('id')
            .range(from, to),
        LIST_ROW_CAP,
      ),
    );
    if (ackError) return batchRescheduleLoadFailed('acknowledgements', ackError);
    // Single pass: group by revision, then apply the shared latest-row rule.
    const factsByRevision = new Map<string, AcknowledgementFact[]>();
    for (const row of ackRows) {
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
  return { success: true, count: invalidatedAcknowledgementCount };
}

async function prepareBatchReschedule(
  admin: AdminClient,
  orgId: string,
  input: z.infer<typeof batchSelectionSchema>,
): Promise<ActionResult<{ preparation: BatchPreparation }>> {
  const uniqueIds = [...new Set(input.occurrenceIds)];
  const { data: rows, error } = await readInBatches(uniqueIds, (batch) =>
    admin
      .from('planning_occurrences')
      .select(
        'id, version, status, entry_kind, job_id, time_kind, start_at, end_at, start_date, end_date_exclusive, original_start_local',
      )
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (error) logError('Failed to load batch occurrences', error);
  if (error || rows.length !== uniqueIds.length) {
    return { success: false, error: 'batch_item_not_found' };
  }
  const now = Date.now();
  const today = getBusinessTodayIso();
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
    { dayShift: input.dayShift, newTime: input.newTime },
  );
  if (!shiftResult.success) {
    return {
      success: false,
      error: shiftResult.occurrenceId
        ? `${shiftResult.error}:${shiftResult.occurrenceId}`
        : shiftResult.error,
    };
  }

  const assignmentsResult = await loadBatchAssignmentsByOccurrence(admin, orgId, uniqueIds);
  if (!assignmentsResult.success) return assignmentsResult;

  // The selection may span several jobs; the qualification part of the shared
  // assessment is job-scoped, so it runs per group. A null group carries any
  // selected occurrences without a job so they are never silently unassessed.
  const jobIds = [...new Set((rows ?? []).flatMap((row) => (row.job_id ? [row.job_id] : [])))];
  const hasJoblessRows = (rows ?? []).some((row) => row.job_id === null);
  const jobGroups: Array<string | null> = [
    ...jobIds,
    ...(hasJoblessRows || jobIds.length === 0 ? [null] : []),
  ];
  const rowById = new Map((rows ?? []).map((row) => [row.id, row]));
  const materializedById = new Map(
    shiftResult.items.flatMap((item): Array<[string, MaterializedOccurrence]> => {
      const source = rowById.get(item.occurrenceId);
      if (!source) return [];
      return [
        [
          item.occurrenceId,
          {
            originalStartLocal: item.occurrenceId,
            timeKind: source.time_kind,
            startAt: item.startAt,
            endAt: item.endAt,
            startDate: item.startDate,
            endDateExclusive: item.endDateExclusive,
            dstResolution: item.dstResolution,
          },
        ],
      ];
    }),
  );
  const assessmentResult = await assessBatchSelectionGroups({
    orgId,
    selection: input,
    uniqueIds,
    rows,
    jobGroups,
    assignmentsByOccurrence: assignmentsResult.assignmentsByOccurrence,
    materializedById,
  });
  if (!assessmentResult.success) return assessmentResult;

  // Impact preview: active commitments that would mismatch, and current
  // acknowledgements that a schedule change will invalidate.
  const [commitmentsResult, dispatchesResult] = await Promise.all([
    readInBatches(uniqueIds, (batch) =>
      admin
        .from('planning_customer_commitments')
        .select('occurrence_id, committed_date, window_start_time, window_end_time')
        .eq('organization_id', orgId)
        .eq('status', 'active')
        .in('occurrence_id', [...batch]),
    ),
    readInBatches(uniqueIds, (batch) =>
      admin
        .from('planning_dispatches')
        .select('id, occurrence_id, current_revision_id')
        .eq('organization_id', orgId)
        .eq('status', 'active')
        .in('occurrence_id', [...batch]),
    ),
  ]);
  const impactError = commitmentsResult.error ?? dispatchesResult.error;
  if (impactError) return batchRescheduleLoadFailed('commitments or dispatches', impactError);
  const jobTitleResult = await readInBatches(jobIds, (batch) =>
    admin
      .from('jobs')
      .select('id, title, description')
      .eq('organization_id', orgId)
      .in('id', [...batch]),
  );
  if (jobTitleResult.error) return batchRescheduleLoadFailed('job titles', jobTitleResult.error);
  const jobTitles = new Map(
    jobTitleResult.data.map((job) => [job.id, job.title.trim() || job.description?.trim() || 'Auftrag']),
  );
  const previewItems = buildBatchPreviewItems(shiftResult.items, rowById, jobTitles);
  const commitmentMismatchTitles = collectBatchCommitmentMismatchTitles(
    commitmentsResult.data ?? [],
    rows,
    materializedById,
    jobTitles,
  );

  const revisionIds = (dispatchesResult.data ?? []).flatMap((row) =>
    row.current_revision_id ? [row.current_revision_id] : [],
  );
  const acknowledgementResult = await countBatchInvalidatedAcknowledgements(admin, orgId, revisionIds);
  if (!acknowledgementResult.success) return acknowledgementResult;

  const { assessment } = assessmentResult;
  return {
    success: true,
    preparation: {
      items: shiftResult.items,
      previewItems,
      conflicts: assessment.conflicts,
      assessmentFingerprint: assessment.assessmentFingerprint,
      capacitySnapshot: assessment.capacitySnapshot,
      capacityFingerprint: assessment.capacityFingerprint,
      qualificationSnapshot: assessment.qualificationSnapshot,
      qualificationFingerprint: assessment.qualificationFingerprint,
      commitmentMismatchTitles,
      invalidatedAcknowledgementCount: acknowledgementResult.count,
    },
  };
}

export async function previewBatchReschedule(rawInput: unknown): Promise<
  | {
      success: true;
      itemCount: number;
      items: BatchPreviewItem[];
      conflicts: PlanningConflict[];
      assessmentFingerprint: string;
      commitmentMismatchTitles: string[];
      invalidatedAcknowledgementCount: number;
    }
  | ActionFailure
> {
  const parsed = batchSelectionSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false as const, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const prepared = await prepareBatchReschedule(admin, auth.context.orgId, parsed.data);
  if (!prepared.success) return prepared;
  return {
    success: true as const,
    itemCount: prepared.preparation.items.length,
    items: prepared.preparation.previewItems,
    conflicts: prepared.preparation.conflicts,
    assessmentFingerprint: prepared.preparation.assessmentFingerprint,
    commitmentMismatchTitles: prepared.preparation.commitmentMismatchTitles,
    invalidatedAcknowledgementCount: prepared.preparation.invalidatedAcknowledgementCount,
  };
}

const batchCommitSchema = batchSelectionSchema.extend({
  reason: z.string().trim().min(8).max(1000),
  requestId: uuidSchema,
  overrideReason: z.string().trim().min(8).max(1000).nullable(),
  assessmentFingerprint: z.string().length(64).nullable(),
});

export async function batchReschedule(rawInput: unknown): Promise<PlanningActionResult> {
  const parsed = batchCommitSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false as const, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) {
    return { success: false as const, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const prepared = await prepareBatchReschedule(admin, auth.context.orgId, parsed.data);
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

  const { data, error } = await admin.rpc('batch_reschedule_planning_occurrences', {
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
    ...(parsed.data.overrideReason !== null ? { p_override_reason: parsed.data.overrideReason } : {}),
  });
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
  revalidateDispatchMutation();
  return { success: true as const, occurrenceIds: (data ?? []) as string[] };
}
