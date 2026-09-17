import type { Database } from '@/lib/supabase/database.types';

type LegacyActivity = Pick<Database['public']['Tables']['time_entries']['Row'], 'user_id' | 'entry_type' | 'job_id'>;
type OpenSegment = Pick<Database['public']['Tables']['time_segments']['Row'], 'job_id'>;

/** Legacy rows arrive newest first; only each person's latest transition counts. */
export function collectActiveJobIds(legacyEntries: readonly LegacyActivity[], openSegments: readonly OpenSegment[]): string[] {
  const jobIds = new Set<string>();
  const seenUsers = new Set<string>();
  for (const entry of legacyEntries) {
    if (seenUsers.has(entry.user_id)) continue;
    seenUsers.add(entry.user_id);
    if ((entry.entry_type === 'clock_in' || entry.entry_type === 'break_end') && entry.job_id) jobIds.add(entry.job_id);
  }
  for (const segment of openSegments) if (segment.job_id) jobIds.add(segment.job_id);
  return [...jobIds];
}
