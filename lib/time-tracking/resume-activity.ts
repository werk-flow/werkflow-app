import type { SupabaseClient } from '@supabase/supabase-js';
import { toTimeActivitySelection, toTimeSegmentFact } from './segments';
import type { TimeActivitySelection } from './types';

export type ResumeActivityRead =
  | { success: true; activity: TimeActivitySelection | null }
  | { success: false };

/**
 * The activity a break interrupted: the latest non-break segment of the whole
 * session, so a break that crosses the Berlin midnight still resumes the right
 * job. A failed read is reported, never mistaken for "nothing to resume"
 * (pre-Wave-3 step 3, CodeRabbit finding of 2026-09-17).
 */
export async function readResumeActivity(
  admin: SupabaseClient,
  sessionId: string
): Promise<ResumeActivityRead> {
  const { data, error } = await admin
    .from('time_segments')
    .select(
      'id, session_id, organization_id, employee_record_id, kind, allocation_kind, job_id, internal_type, travel_route, travel_role, standby_context, started_at, ended_at'
    )
    .eq('session_id', sessionId)
    .neq('kind', 'break')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { success: false };
  return { success: true, activity: data ? toTimeActivitySelection(toTimeSegmentFact(data as never)) : null };
}
