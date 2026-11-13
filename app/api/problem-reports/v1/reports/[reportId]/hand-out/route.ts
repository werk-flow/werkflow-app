import { connection } from 'next/server';

import { handOutProblemReport } from '@/lib/problem-reports/handout';
import { HANDOUT_HEADERS, handoutAccessRefusal, handoutError } from '@/lib/problem-reports/handout-responses';
import { problemReportHandoutAccess } from '@/lib/security/shared-secret';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/validation/uuid';

// Hands one report's scrubbed copy to a report thread, once
// (docs/features/problem-reports.md, "Hand-out to report threads"). The
// first hand-out claims the report, and the database writes it into the
// history before the copy leaves. Only a caller with
// PROBLEM_REPORT_HANDOUT_SECRET gets it; an id that is no report answers
// like an unknown one.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
): Promise<Response> {
  await connection();
  const access = problemReportHandoutAccess(request.headers);
  if (access !== 'allowed') return handoutAccessRefusal(access);
  const { reportId } = await params;
  if (!isUuid(reportId)) return handoutError('report_not_found');
  const handOut = await handOutProblemReport(createSupabaseAdminClient(), reportId);
  if (!handOut.ok) return handoutError(handOut.error);
  return Response.json(handOut.copy, { headers: HANDOUT_HEADERS });
}
