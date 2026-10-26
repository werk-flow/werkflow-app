import { connection } from 'next/server';

import { runAppHealthChecks } from '@/lib/health/app-checks';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { hasHealthCheckToken } from '@/lib/security/health-token';

// The weekly health workflow reads this endpoint (.github/workflows/health.yml).
// proxy.ts answers a request without the token like an unknown route; this
// check repeats it, so the handler never runs a dependency for such a request.
// The report names each check and its state, never a value or a provider
// message. connection() declares the handler dynamic under cacheComponents.
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  await connection();
  if (!hasHealthCheckToken(request.headers)) {
    return new Response(null, { status: 404, headers: NO_STORE });
  }
  // A limiter that cannot decide does not refuse here, unlike the guarded
  // operations: the database outage it reports is what this endpoint exists
  // to name, and the probe behind the token only reads.
  const verdict = await consumeRateLimit({ action: 'health_check_per_backend', subject: 'all' });
  if (verdict === 'limited') {
    return Response.json({ error: 'too_many_attempts' }, { status: 429, headers: NO_STORE });
  }
  const report = await runAppHealthChecks();
  return Response.json(report, { status: report.ok ? 200 : 503, headers: NO_STORE });
}
