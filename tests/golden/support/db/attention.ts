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
      sourceType: row.source_type as string,
      sourceId: row.source_id as string,
      stateVersion: row.state_version as string,
    })),
    events: (eventsResult.data ?? []).map((row) => ({
      sourceType: row.source_type as string,
      sourceId: row.source_id as string,
      eventType: row.event_type as string,
    })),
  };
}
