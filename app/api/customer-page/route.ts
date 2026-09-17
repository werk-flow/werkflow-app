import { NextResponse } from 'next/server';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { withReadRequest } from '@/lib/data/read-request-cache';
import { customerPageInputSchema } from '@/lib/clients/list-page';
import { readCustomerPage } from '@/lib/clients/list-page-server';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const query = new URL(request.url).searchParams;
    const keys = ['organizationId', 'page', 'search'];
    const input = customerPageInputSchema.safeParse(Object.fromEntries(query));
    if (!input.success || keys.some(key => query.getAll(key).length !== 1)) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400, headers });
    }
    return await withReadRequest(request, async () => {
      const auth = await authenticateAndAuthorize();
      if (!auth.success) return NextResponse.json({ error: auth.error }, { status: auth.error === 'not_authenticated' ? 401 : 403, headers });
      if (!auth.context.isManagerOrAbove || auth.context.orgId !== input.data.organizationId) {
        return NextResponse.json({ error: 'not_authorized' }, { status: 403, headers });
      }
      return NextResponse.json(await readCustomerPage(input.data), { headers });
    });
  } catch {
    return NextResponse.json({ error: 'customer_page_read_failed' }, { status: 500, headers });
  }
}
