import { connection } from 'next/server';

import { writeBackProblemReport } from '@/lib/problem-reports/handout';
import { HANDOUT_HEADERS, handoutAccessRefusal, handoutError } from '@/lib/problem-reports/handout-responses';
import { problemReportWriteBackSchema } from '@/lib/problem-reports/schemas';
import { problemReportHandoutAccess } from '@/lib/security/shared-secret';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/validation/uuid';

// A report thread writes bucket, status and the answer to the reporter back
// to a report it received (docs/features/problem-reports.md, "Hand-out to
// report threads"). One database call writes the changes with history
// entries of the Agent and moves the reporter's and support's live views.
// Only a caller with PROBLEM_REPORT_HANDOUT_SECRET writes.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
): Promise<Response> {
  await connection();
  const access = problemReportHandoutAccess(request.headers);
  if (access !== 'allowed') return handoutAccessRefusal(access);
  const { reportId } = await params;
  if (!isUuid(reportId)) return handoutError('report_not_found');
  const body: unknown = await request.json().catch(() => null);
  const changes = problemReportWriteBackSchema.safeParse(body);
  if (!changes.success) return handoutError('invalid_input');
  const written = await writeBackProblemReport(createSupabaseAdminClient(), reportId, changes.data);
  if (!written.ok) return handoutError(written.error);
  return new Response(null, { status: 204, headers: HANDOUT_HEADERS });
}
