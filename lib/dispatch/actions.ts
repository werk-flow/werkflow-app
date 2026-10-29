'use server';

// Dispatch server actions. Dispatch is distinct from scheduling, job
// assignment, attendance, recorded time, customer commitment, and message
// delivery: issuing/acknowledging here never creates any of those.

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { revalidatePath } from 'next/cache';
import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';

import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import type { PlanningActionResult, PlanningConflict } from '@/lib/planning/types';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { batchSelectionSchema, prepareBatchReschedule } from './batch-preparation';
import { loadDispatchOverview } from './overview';
import { loadEmployeeDispatchCards } from './server';
import { composeReadinessForTarget } from './readiness-target';
import type { BatchPreviewItem, DispatchOverview, EmployeeDispatchCard, ReadinessResult } from './types';
import { logError } from '@/lib/logging';

function revalidateDispatchMutation(): void {
  revalidatePath('/aufgaben');
}

function dispatchFailureCode(
  operation: string,
  error: { code?: string; message: string },
  known: string[],
): string {
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
      error: dispatchFailureCode('Failed to issue dispatch', error, [
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
  return { success: true as const, dispatchId: data };
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
      error: dispatchFailureCode('Failed to acknowledge dispatch', error, [
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
      error: dispatchFailureCode('Failed to challenge dispatch', error, [
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
      error: dispatchFailureCode('Failed to resolve dispatch challenge', error, [
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
      error: dispatchFailureCode('Failed to cancel dispatch', error, [
        'dispatch_not_found',
        'cancel_reason_invalid',
      ]),
    };
  }
  revalidateDispatchMutation();
  return { success: true as const };
}

// ============================================
// Batch rescheduling (explicit selection → preview → atomic commit)
// ============================================

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
      error: dispatchFailureCode('Failed to batch reschedule', error, [
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
  return { success: true as const, occurrenceIds: data ?? [] };
}
