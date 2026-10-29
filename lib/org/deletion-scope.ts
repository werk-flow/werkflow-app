import 'server-only';

// The callers establish identity, the active organization and the owner or
// Admin role before they read; delete_organization repeats the retention check
// under its lock (supabase/migrations/20261029130000_refuse_organization_delete_with_time_records.sql).

import type { ActionFailure } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { z } from '@/lib/zod';
import type { OrganizationDeletionScope } from './types';

const count = z.number().int().nonnegative();
const scopeSchema = z.object({
  members: count,
  open_invites: count,
  clients: count,
  projects: count,
  jobs: count,
  employee_records: count,
  documents: count,
  time_tracked_people: count,
  closed_periods: count,
  payroll_exports: count,
});

export async function readOrganizationDeletionScope(
  organizationId: string,
): Promise<{ success: true; scope: OrganizationDeletionScope } | ActionFailure<'load_failed'>> {
  const { data, error } = await createSupabaseAdminClient().rpc('get_organization_deletion_scope', {
    p_organization_id: organizationId,
  });
  const parsed = scopeSchema.safeParse(data);
  if (error || !parsed.success) {
    logError('readOrganizationDeletionScope: scope read failed', error ?? parsed.error);
    return { success: false, error: 'load_failed' };
  }
  const scope = parsed.data;
  return {
    success: true,
    scope: {
      members: scope.members,
      openInvites: scope.open_invites,
      clients: scope.clients,
      projects: scope.projects,
      jobs: scope.jobs,
      employeeRecords: scope.employee_records,
      documents: scope.documents,
      timeTrackedPeople: scope.time_tracked_people,
      closedPeriods: scope.closed_periods,
      payrollExports: scope.payroll_exports,
      retainsTimeRecords: scope.time_tracked_people > 0 || scope.closed_periods > 0,
    },
  };
}
