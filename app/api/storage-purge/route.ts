import { connection } from 'next/server';

import { logError } from '@/lib/logging';
import { cronRequestAccess } from '@/lib/security/shared-secret';
import { purgeDueStorageObjects } from '@/lib/storage/purge';

// Vercel Cron calls this daily on production (vercel.json). It deletes the
// stored files whose deletion delay has passed (lib/storage/purge.ts). A
// failed purge, or a missing CRON_SECRET, answers a server error, so the
// production watcher reports the route; the body holds counts only.
// connection() declares the handler dynamic under cacheComponents.
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function GET(request: Request): Promise<Response> {
  await connection();
  const access = cronRequestAccess(request.headers);
  if (access === 'unconfigured') {
    logError('storage purge: CRON_SECRET is not configured');
    return new Response(null, { status: 503, headers: NO_STORE });
  }
  if (access === 'refused') return new Response(null, { status: 404, headers: NO_STORE });
  const result = await purgeDueStorageObjects();
  return Response.json(result, { status: result.ok ? 200 : 500, headers: NO_STORE });
}
