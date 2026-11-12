import 'server-only';

import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';

// Material history makes work undeletable: a stock movement and a recorded use
// are ledger rows that must not vanish (docs/features/inventory.md). The job
// and project delete actions refuse such work before they delete, and map the
// database's own refusal to the same code when a take lands in between.

/** The refusal code of a job or project delete whose material was taken or used. */
export const MATERIAL_HISTORY_EXISTS = 'material_history_exists';

/**
 * Whether a line of the job or project has taken material. Every movement of
 * a job or project books on such a line, and every use needs a take first.
 */
export async function hasMaterialHistory(
  admin: AdminClient,
  orgId: string,
  target: { jobId: string } | { projectId: string },
): Promise<{ error: true } | { error: false; exists: boolean }> {
  const lines = admin
    .from('job_material_lines')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gt('taken_quantity', 0);
  const { count, error } = await ('jobId' in target
    ? lines.eq('job_id', target.jobId)
    : lines.eq('project_id', target.projectId));
  if (error) {
    logError('hasMaterialHistory: job_material_lines read failed', error);
    return { error: true };
  }
  return { error: false, exists: (count ?? 0) > 0 };
}

/**
 * Whether a delete failed because it would remove material history: the
 * ledger guard refused clearing a movement's line, or a use event still
 * references the line.
 */
export function isMaterialHistoryRefusal(error: { code?: string; message?: string }): boolean {
  return (
    error.message === 'inventory_ledger_append_only' ||
    (error.code === '23503' && (error.message ?? '').includes('job_material_use_events'))
  );
}
