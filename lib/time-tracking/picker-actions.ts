import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { getJobDisplayTitle } from '@/lib/jobs/types';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';
import { getLocalDayEnd, getLocalDayStart } from './day-utils';
import { jobPickerRequestSchema, type PickerJob } from './picker-types';

const pickerRowSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  jobNumber: z.string().nullable(),
  status: z.string(),
  projectName: z.string().nullable(),
  clientName: z.string().nullable(),
  plannedToday: z.boolean(),
});
const pickerPageSchema = z.object({
  options: z.array(pickerRowSchema).max(1_000),
  hasMore: z.boolean(),
  selected: pickerRowSchema.nullable(),
});

function toPickerJob(row: z.output<typeof pickerRowSchema>): PickerJob {
  return {
    id: row.id,
    title: getJobDisplayTitle({ title: row.title, description: row.description }),
    jobNumber: row.jobNumber,
    status: row.status,
    projectName: row.projectName,
    clientName: row.clientName,
    plannedToday: row.plannedToday,
  };
}

/**
 * The jobs of the clock-in and job-switch picker. The database searches the
 * caller's scope (managers: every open job, others: their assigned open jobs)
 * and ranks the caller's own visits of today's Berlin date first, then title.
 * The live picker re-reads the rows it shows, so the request names a limit,
 * not an offset; `selected` is the running job of a switch.
 */
export async function getJobsForPicker(
  input: z.input<typeof jobPickerRequestSchema>,
): Promise<
  { success: true; jobs: PickerJob[]; hasMore: boolean; selected: PickerJob | null } | ActionFailure
> {
  try {
    const parsed = jobPickerRequestSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'invalid_input' };
    const request = parsed.data;
    const auth = await resolveActionContextFor(request.organizationId);
    if (!auth.success) return auth;
    const { userId, isManagerOrAbove } = auth.context;

    const now = new Date();
    const { data, error } = await createSupabaseAdminClient().rpc('search_clock_job_options', {
      p_organization_id: request.organizationId,
      p_user_id: userId,
      p_is_manager: isManagerOrAbove,
      p_today: getBusinessTodayIso(),
      p_day_start: getLocalDayStart(now).toISOString(),
      p_day_end: getLocalDayEnd(now).toISOString(),
      p_search: request.query,
      p_limit: request.limit,
      ...(request.selectedJobId ? { p_selected_id: request.selectedJobId } : {}),
    });
    const page = pickerPageSchema.safeParse(data);
    if (error || !page.success) {
      logReadFailure('getJobsForPicker: search failed', error ?? { code: 'malformed_page' });
      return { success: false, error: 'fetch_failed' };
    }
    return {
      success: true,
      jobs: page.data.options.map(toPickerJob),
      hasMore: page.data.hasMore,
      selected: page.data.selected ? toPickerJob(page.data.selected) : null,
    };
  } catch (error) {
    logError('Unexpected error in getJobsForPicker:', error);
    return { success: false, error: 'unexpected_error' };
  }
}
