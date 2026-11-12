import { connection } from 'next/server';

import { handOutProblemReportScreenshot } from '@/lib/problem-reports/handout';
import { HANDOUT_HEADERS, handoutAccessRefusal, handoutError } from '@/lib/problem-reports/handout-responses';
import { problemReportHandoutAccess } from '@/lib/security/shared-secret';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { isUuid } from '@/lib/validation/uuid';

// The redrawn screenshot of a report whose copy a thread received
// (docs/features/problem-reports.md, "Hand-out to report threads"). The
// server sends the bytes itself: a signed storage address would carry the
// organization's id in its path. Each hand-out enters the history first.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
): Promise<Response> {
  await connection();
  const access = problemReportHandoutAccess(request.headers);
  if (access !== 'allowed') return handoutAccessRefusal(access);
  const { reportId } = await params;
  if (!isUuid(reportId)) return handoutError('report_not_found');
  const screenshot = await handOutProblemReportScreenshot(createSupabaseAdminClient(), reportId);
  if (!screenshot.ok) return handoutError(screenshot.error);
  return new Response(screenshot.bytes, {
    headers: { ...HANDOUT_HEADERS, 'Content-Type': screenshot.mimeType, 'X-Content-Type-Options': 'nosniff' },
  });
}
