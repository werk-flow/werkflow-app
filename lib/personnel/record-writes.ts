import 'server-only';

import type { ActionFailure, ActionResult } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { writeRefusalFor } from '@/lib/supabase/write-refusal';

// The shared steps of the personnel record writes (actions.ts,
// employment-condition-actions.ts, work-schedule-actions.ts): the manager
// guard, the date check and the refusals of the write functions.

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isParsableIsoDate(value: string): boolean {
  return ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

// The refusals of the personnel write functions (migration
// 20261004190100_write_personnel_history_with_its_change.sql), each an action
// failure code. Each function writes the change and its history row together
// or refuses and changes nothing.
const PERSONNEL_WRITE_REFUSALS: ReadonlySet<string> = new Set([
  'invalid_input',
  'not_authorized',
  'record_not_found',
  'condition_not_found',
  'schedule_not_found',
  'number_taken',
  'exit_before_entry',
  'name_managed_by_profile',
  'duplicate_valid_from',
]);

// The refusal raised under the lock, or the action's own failure code for
// anything else.
export const personnelWriteFailure = writeRefusalFor(PERSONNEL_WRITE_REFUSALS);

export type UpdatePersonnelResult = ActionResult;

/** Identity, active organization and the manager role, for the personnel writes. */
export async function requirePersonnelManager(): Promise<
  { success: true; context: { orgId: string; userId: string } } | ActionFailure
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId, userId, isManagerOrAbove } = auth.context;
  if (!isManagerOrAbove) return { success: false, error: 'not_authorized' };
  return { success: true, context: { orgId, userId } };
}
