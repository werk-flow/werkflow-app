import { connection } from 'next/server';

import { listWaitingProblemReports } from '@/lib/problem-reports/handout';
import { HANDOUT_HEADERS, handoutAccessRefusal, handoutError } from '@/lib/problem-reports/handout-responses';
import { problemReportHandoutAccess } from '@/lib/security/shared-secret';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// The reports waiting for a report thread, oldest first: an id and its bucket
// each, so a dispatcher starts a waiting blocker first; no text
// (docs/features/problem-reports.md, "Hand-out to report threads"). Only a
// caller with PROBLEM_REPORT_HANDOUT_SECRET gets them; without the secret
// configured the hand-out is off and nothing is read. connection() declares
// the handler dynamic under cacheComponents.
export async function GET(request: Request): Promise<Response> {
  await connection();
  const access = problemReportHandoutAccess(request.headers);
  if (access !== 'allowed') return handoutAccessRefusal(access);
  const waiting = await listWaitingProblemReports(createSupabaseAdminClient());
  if (!waiting.ok) return handoutError(waiting.error);
  return Response.json({ reports: waiting.reports }, { headers: HANDOUT_HEADERS });
}
