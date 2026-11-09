'use server';

import type { ActionFailure } from '@/lib/action-result';
import { getLocalDayEnd, getLocalDayStart, parseBerlinDateTimeInput } from '@/lib/date-time/berlin';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { isManagerRole } from '@/lib/roles';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';
import type { PlannedCorrectionVisit } from './types';

// The planned visits a forgotten day's timeline starts from: the person's
// scheduled job visits on that Berlin day (werk-flow/werkflow-planning#153).

const plannedCorrectionVisitsInputSchema = z.object({
  organizationId: uuidSchema,
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Whose day; the caller's own record when absent. */
  employeeRecordId: uuidSchema.optional(),
});

type PlannedVisitsResult = { success: true; visits: PlannedCorrectionVisit[] } | ActionFailure;

/**
 * The scheduled job visits of a person on a Berlin day, in start order. The
 * caller reads their own day; only Admin and Büro read another person's,
 * because only they add time for others.
 */
export async function getPlannedCorrectionVisits(input: {
  organizationId: string;
  localDate: string;
  employeeRecordId?: string | undefined;
}): Promise<PlannedVisitsResult> {
  const parsed = plannedCorrectionVisitsInputSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const { organizationId, localDate, employeeRecordId } = parsed.data;
  const caller = await resolveActionContextFor(organizationId);
  if (!caller.success) return caller;
  const admin = createSupabaseAdminClient();
  const records = await admin
    .from('employee_records')
    .select('id, user_id')
    .eq('organization_id', organizationId)
    .eq(employeeRecordId ? 'id' : 'user_id', employeeRecordId ?? caller.context.userId)
    .limit(1);
  if (records.error) {
    logReadFailure('getPlannedCorrectionVisits: employee record failed', records.error);
    return { success: false, error: 'load_failed' };
  }
  const record = records.data[0];
  if (!record) return { success: false, error: 'not_found' };
  if (record.user_id !== caller.context.userId && !isManagerRole(caller.context.role))
    return { success: false, error: 'not_authorized' };
  return readPlannedVisits(admin, organizationId, record.id, localDate);
}

async function readPlannedVisits(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  organizationId: string,
  employeeRecordId: string,
  localDate: string,
): Promise<PlannedVisitsResult> {
  const noon = parseBerlinDateTimeInput(`${localDate}T12:00`);
  if (!noon) return { success: false, error: 'invalid_input' };
  const from = getLocalDayStart(noon).toISOString();
  const to = new Date(getLocalDayEnd(noon).getTime() + 1).toISOString();
  const assignments = await readCompleteRows(
    (start, end) =>
      admin
        .from('planning_occurrence_assignments')
        .select('occurrence_id')
        .eq('organization_id', organizationId)
        .eq('employee_record_id', employeeRecordId)
        .order('occurrence_id')
        .range(start, end),
    LIST_ROW_CAP,
  );
  if (assignments.error) {
    logReadFailure('getPlannedCorrectionVisits: assignments failed', assignments.error);
    return { success: false, error: 'load_failed' };
  }
  const occurrences = await readInBatches(
    [...new Set(assignments.data.map((assignment) => assignment.occurrence_id))],
    (batch) =>
      admin
        .from('planning_occurrences')
        .select('job_id, time_kind, start_at, end_at')
        .eq('organization_id', organizationId)
        .eq('entry_kind', 'job_visit')
        .eq('status', 'scheduled')
        .in('id', [...batch])
        .or(
          `and(time_kind.eq.timed,start_at.lt.${to},end_at.gt.${from}),` +
            `and(time_kind.eq.all_day,start_date.lte.${localDate},end_date_exclusive.gt.${localDate})`,
        ),
  );
  if (occurrences.error) {
    logReadFailure('getPlannedCorrectionVisits: occurrences failed', occurrences.error);
    return { success: false, error: 'load_failed' };
  }
  const visits = occurrences.data
    .flatMap(
      ({
        job_id: jobId,
        time_kind: timeKind,
        start_at: startAt,
        end_at: endAt,
      }): PlannedCorrectionVisit[] => {
        if (!jobId) return [];
        if (timeKind !== 'timed' || !startAt || !endAt) return [{ jobId, startAt: null, endAt: null }];
        const startedAt = Math.max(Date.parse(startAt), Date.parse(from));
        const endedAt = Math.min(Date.parse(endAt), Date.parse(to));
        return [
          { jobId, startAt: new Date(startedAt).toISOString(), endAt: new Date(endedAt).toISOString() },
        ];
      },
    )
    .sort((left, right) => (left.startAt ?? '').localeCompare(right.startAt ?? ''));
  return { success: true, visits };
}
