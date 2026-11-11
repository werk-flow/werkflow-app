import { connection } from 'next/server';

import { logError } from '@/lib/logging';
import { runProblemReportRetention } from '@/lib/problem-reports/retention';
import { scrubPendingProblemReports } from '@/lib/problem-reports/scrub/scrub-report';
import { cronRequestAccess } from '@/lib/security/shared-secret';

// Vercel Cron calls this daily on production (vercel.json). It first scrubs
// every report that still has no scrubbed copy
// (lib/problem-reports/scrub/scrub-report.ts), so a copy exists before its
// originals go. Then it deletes the problem-report originals and reports
// whose period has passed (lib/problem-reports/retention.ts); their files
// reach the storage purge through its queue. A failed deletion, a failed
// list, or a missing CRON_SECRET answers a server error, so the production
// watcher reports the route. A report that cannot be scrubbed is a state of
// that report, not a failed run. The body holds counts only. connection()
// declares the handler dynamic under cacheComponents.
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  await connection();
  const access = cronRequestAccess(request.headers);
  if (access === 'unconfigured') {
    logError('problem report retention: CRON_SECRET is not configured');
    return new Response(null, { status: 503, headers: NO_STORE });
  }
  if (access === 'refused') return new Response(null, { status: 404, headers: NO_STORE });
  const scrub = await scrubPendingProblemReports();
  const retention = await runProblemReportRetention();
  const ok = scrub.ok && retention.ok;
  return Response.json(
    { ...retention, ok, scrubbed: scrub.scrubbed, notScrubbed: scrub.notScrubbed },
    { status: ok ? 200 : 500, headers: NO_STORE },
  );
}
