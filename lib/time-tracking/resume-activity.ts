import type { ActionResult } from '@/lib/action-result';
import { logReadErrors } from '@/lib/data/read-request-cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { toTimeActivitySelection, toTimeSegmentFact } from './segments';
import type { TimeActivitySelection } from './types';

export type ResumeActivityRead = ActionResult<{ activity: TimeActivitySelection | null }, 'load_failed'>;

/**
 * The activity a break interrupted: the latest non-break segment of the whole
 * session, so a break that crosses the Berlin midnight still resumes the right
 * job. A failed read is reported, never mistaken for "nothing to resume".
 */
export async function readResumeActivity(
  admin: SupabaseClient,
  organizationId: string,
  sessionId: string,
): Promise<ResumeActivityRead> {
  const { data, error } = await admin
    .from('time_segments')
    .select(
      'id, session_id, organization_id, employee_record_id, kind, allocation_kind, job_id, internal_type, travel_route, travel_role, standby_context, started_at, ended_at',
    )
    .eq('organization_id', organizationId)
    .eq('session_id', sessionId)
    .neq('kind', 'break')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logReadErrors('readResumeActivity: read failed', error);
    return { success: false, error: 'load_failed' };
  }
  return { success: true, activity: data ? toTimeActivitySelection(toTimeSegmentFact(data as never)) : null };
}
