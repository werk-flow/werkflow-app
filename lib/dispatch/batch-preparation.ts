import 'server-only';

// The preparation behind a batch reschedule: loads the selected visits,
// computes their moves and assesses them, for the preview and the commit
// alike. This is an internal server helper, not a Server Action: it takes the
// admin client from its authorized caller in ./actions and must never be
// exported from a 'use server' module (SI-024).

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { fingerprintSnapshot } from '@/lib/planning/capacity';
import { formatBerlinLocalDateTime, getBusinessTodayIso } from '@/lib/date-time/berlin';
import { assessPlanningOccurrences } from '@/lib/planning/server';
import type { MaterializedOccurrence, PlanningAssignmentDraft, PlanningConflict } from '@/lib/planning/types';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database, Json } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { isCommitmentMismatch } from '@/lib/commitments/types';
import { computeBatchShiftItems, type BatchShiftItem } from './batch';
import { latestAcknowledgementByRecipient, type AcknowledgementFact } from './derivation';
import type { CommitmentWindowRow } from './server';
import type { BatchPreviewItem } from './types';
import { logError } from '@/lib/logging';

export const batchSelectionSchema = z.object({
  occurrenceIds: z.array(uuidSchema).min(1).max(100),
  dayShift: z.number().int().min(-366).max(366),
  newTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
});

type BatchSelection = z.infer<typeof batchSelectionSchema>;

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
  selection: BatchSelection;
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
  commitments: CommitmentWindowRow[],
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

async function loadSchedulableBatchRows(
  admin: AdminClient,
  orgId: string,
  uniqueIds: string[],
): Promise<{ success: true; rows: BatchOccurrenceRow[] } | ActionFailure> {
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
      return { success: false, error: 'batch_item_not_scheduled' };
    }
    const isFuture = row.start_at
      ? new Date(row.start_at).getTime() > now
      : Boolean(row.start_date && row.start_date > today);
    if (!isFuture) {
      return { success: false, error: 'batch_item_started' };
    }
  }
  return { success: true, rows };
}

function materializeBatchItems(
  items: BatchShiftItem[],
  rowById: Map<string, BatchOccurrenceRow>,
): Map<string, MaterializedOccurrence> {
  return new Map(
    items.flatMap((item): Array<[string, MaterializedOccurrence]> => {
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
}

// Impact preview: active commitments that would mismatch, and current
// acknowledgements that a schedule change will invalidate.
async function loadBatchImpact(
  admin: AdminClient,
  orgId: string,
  uniqueIds: string[],
  jobIds: string[],
): Promise<
  | {
      success: true;
      commitments: CommitmentWindowRow[];
      revisionIds: string[];
      jobTitles: Map<string, string>;
    }
  | ActionFailure
> {
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
  return {
    success: true,
    commitments: commitmentsResult.data ?? [],
    revisionIds: (dispatchesResult.data ?? []).flatMap((row) =>
      row.current_revision_id ? [row.current_revision_id] : [],
    ),
    jobTitles: new Map(
      jobTitleResult.data.map((job) => [job.id, job.title.trim() || job.description?.trim() || 'Auftrag']),
    ),
  };
}

export async function prepareBatchReschedule(
  admin: AdminClient,
  orgId: string,
  input: BatchSelection,
): Promise<ActionResult<{ preparation: BatchPreparation }>> {
  const uniqueIds = [...new Set(input.occurrenceIds)];
  const rowsResult = await loadSchedulableBatchRows(admin, orgId, uniqueIds);
  if (!rowsResult.success) return rowsResult;
  const { rows } = rowsResult;

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
  if (!shiftResult.success) return { success: false, error: shiftResult.error };

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
  const materializedById = materializeBatchItems(shiftResult.items, rowById);
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

  const impactResult = await loadBatchImpact(admin, orgId, uniqueIds, jobIds);
  if (!impactResult.success) return impactResult;
  const { jobTitles } = impactResult;
  const previewItems = buildBatchPreviewItems(shiftResult.items, rowById, jobTitles);
  const commitmentMismatchTitles = collectBatchCommitmentMismatchTitles(
    impactResult.commitments,
    rows,
    materializedById,
    jobTitles,
  );

  const acknowledgementResult = await countBatchInvalidatedAcknowledgements(
    admin,
    orgId,
    impactResult.revisionIds,
  );
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
