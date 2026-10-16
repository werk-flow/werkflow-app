import 'server-only';

import type { AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows } from '@/lib/supabase/query-batches';

// The two attention reads that only a database function can narrow to pending
// work (migration 20261016100000). They are paged like every complete read,
// because PostgREST caps a function's result set as well.

/** The viewer's recipient rows of current revisions of active dispatches that they have not acknowledged. */
export function readPendingDispatchRecipients(
  admin: AdminClient,
  organizationId: string,
  employeeRecordId: string,
): Promise<{ data: { revision_id: string; dispatch_id: string }[]; error: { message: string } | null }> {
  return readCompleteRows(
    (from, to) =>
      admin
        .rpc('list_pending_dispatch_recipients', {
          p_organization_id: organizationId,
          p_employee_record_id: employeeRecordId,
        })
        .range(from, to),
    LIST_ROW_CAP,
  );
}

/** The projects without an explicit execution state that have a terminal child job. */
export function readHandoverCandidateProjects(
  admin: AdminClient,
  organizationId: string,
): Promise<{ data: { project_id: string }[]; error: { message: string } | null }> {
  return readCompleteRows(
    (from, to) =>
      admin.rpc('list_handover_candidate_projects', { p_organization_id: organizationId }).range(from, to),
    LIST_ROW_CAP,
  );
}
