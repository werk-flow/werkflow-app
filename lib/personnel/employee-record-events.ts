import 'server-only';

import { logError } from '@/lib/logging';
import type { AdminClient } from '@/lib/supabase/admin';
import { toJson } from '@/lib/supabase/json';

/**
 * Appends one row to the employee record's audit trail on its own, for an
 * event that cannot share a transaction with its change, such as a sent mail.
 * A history row that belongs to a database write is inserted by that write's
 * database function instead. A failed insert is logged, not returned.
 */
export async function recordEmployeeRecordEvent(
  admin: AdminClient,
  input: {
    orgId: string;
    employeeRecordId: string;
    eventType: string;
    eventPayload?: Record<string, unknown>;
    actorId: string;
  },
): Promise<void> {
  const { error } = await admin.from('employee_record_events').insert({
    organization_id: input.orgId,
    employee_record_id: input.employeeRecordId,
    event_type: input.eventType,
    event_payload: toJson(input.eventPayload ?? {}),
    created_by: input.actorId,
  });
  if (error) logError('Failed to record employee record event:', error);
}
