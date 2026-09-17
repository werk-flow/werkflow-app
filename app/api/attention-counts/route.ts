import { connection, NextResponse } from 'next/server';
import { getAttentionCounts } from '@/lib/attention/actions';
import { withReadRequest } from '@/lib/data/read-request-cache';

// The attention badge reads through a route handler instead of a Server
// Action: Next.js runs one client's Server Actions and router refreshes one
// after another, and this derivation (about 800 ms on the local stack) sat
// in that queue on every page mount and channel join, delaying the reads that
// carry user-visible content (Step 2, PF-29). A plain fetch runs beside the
// queue. Authorization stays inside getAttentionCounts: it authenticates the
// cookie session, resolves the active organization, and checks membership.
// connection() declares the handler dynamic under cacheComponents: nothing
// else reads a request API before the cookie session, so Next tried to
// prerender it at build time (pre-Wave-3 step 1 observation, 2026-09-14).
// It stays outside the try: during the build's prerender pass it rejects, and
// that rejection must reach Next, not the catch below.
export async function GET(request: Request): Promise<NextResponse> {
  await connection();
  try {
    const result = await withReadRequest(request, () => getAttentionCounts(), { priority: 'background' });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Error in /api/attention-counts:', error);
    return NextResponse.json(
      { success: false, error: 'unexpected_error' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
}
