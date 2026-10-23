import 'server-only';

import type { PostgrestError } from '@supabase/supabase-js';
import { loggedRead, memoizeRequestRead } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

type AccessRead<Row> = { data: Row | null; error: PostgrestError | null };

// The two facts every job-scoped reader checks before it reads: the job
// belongs to the caller's organization, and a field worker is assigned to it.
// A field worker's work pack runs about ten such readers in one render, and
// each repeated both reads. memoizeRequestRead shares a read within one React
// render or one GET read scope only, never across requests: a removed
// assignment refuses the next request, and a Server Action outside a render
// reads fresh. A failed read is logged here; the caller maps it to its own
// load failure, never to a refusal.

export const readOrganizationJob = memoizeRequestRead(
  (organizationId: string, jobId: string): Promise<AccessRead<{ id: string; project_id: string | null }>> =>
    loggedRead(
      'readOrganizationJob: jobs read failed',
      createSupabaseAdminClient()
        .from('jobs')
        .select('id, project_id')
        .eq('id', jobId)
        .eq('organization_id', organizationId)
        .maybeSingle(),
    ),
);

export const readJobAssignmentOfUser = memoizeRequestRead(
  (organizationId: string, jobId: string, userId: string): Promise<AccessRead<{ id: string }>> =>
    loggedRead(
      'readJobAssignmentOfUser: job_assignments read failed',
      createSupabaseAdminClient()
        .from('job_assignments')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('job_id', jobId)
        .eq('user_id', userId)
        .maybeSingle(),
    ),
);
