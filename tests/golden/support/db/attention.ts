import { overdueJobSetSchema, toOverdueJobTasks } from '../../../../lib/attention/job-tasks';
import { getBusinessTodayIso } from '../../../../lib/date-time/berlin';
import { LIST_ROW_CAP } from '../../../../lib/supabase/query-batches';
import { createAdminClient } from './shared';

// P1-07: pattern-level attention state — read markers and append-only pattern
// events for one user. Proves that a marked-read fact is stored and audited
// (the "an item that disappears is explainable" contract).
export type AttentionPatternState = {
  readStates: Array<{
    sourceType: string;
    sourceId: string;
    stateVersion: string;
  }>;
  events: Array<{ sourceType: string; sourceId: string; eventType: string }>;
};

export async function getAttentionPatternStateForUser(
  orgId: string,
  userId: string,
): Promise<AttentionPatternState> {
  const admin = createAdminClient();
  const [readStatesResult, eventsResult] = await Promise.all([
    admin
      .from('attention_read_states')
      .select('source_type, source_id, state_version')
      .eq('organization_id', orgId)
      .eq('user_id', userId),
    admin
      .from('attention_events')
      .select('source_type, source_id, event_type, created_at')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
  ]);
  if (readStatesResult.error || eventsResult.error) {
    throw new Error(
      `Attention state query failed: ${readStatesResult.error?.message ?? eventsResult.error?.message}`,
    );
  }

  return {
    readStates: (readStatesResult.data ?? []).map((row) => ({
      sourceType: row.source_type,
      sourceId: row.source_id,
      stateVersion: row.state_version,
    })),
    events: (eventsResult.data ?? []).map((row) => ({
      sourceType: row.source_type,
      sourceId: row.source_id,
      eventType: row.event_type,
    })),
  };
}

/**
 * How many overdue job tasks the organization holds now: open jobs past their
 * last visit, from the database read and the rule the badge derives them
 * with. Other specs leave such jobs in a shared organization, so a badge
 * expectation adds them.
 */
export async function countOfficeOverdueJobTasks(orgId: string): Promise<number> {
  const { data, error } = await createAdminClient().rpc('read_manager_attention_sets', {
    p_organization_id: orgId,
    p_limit: LIST_ROW_CAP,
  });
  if (error) throw new Error(`Office overdue job read failed: ${error.message}`);
  return toOverdueJobTasks(overdueJobSetSchema.parse(data).overdue_jobs, getBusinessTodayIso()).length;
}
