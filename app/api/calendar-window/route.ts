import { NextResponse } from 'next/server';
import { getCalendarWindow, type CalendarWindowInput } from '@/lib/calendar/actions';
import { withReadRequest } from '@/lib/data/read-request-cache';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
const INPUT_KEYS = ['organizationId', 'from', 'to', 'fromDate', 'toDate'] as const;

/** Independent transport; the existing reader owns identity, organization and role checks. */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const query = new URL(request.url).searchParams;
    if (INPUT_KEYS.some((key) => query.getAll(key).length !== 1)) {
      return NextResponse.json({ success: false, error: 'invalid_input' }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const input: CalendarWindowInput = {
      organizationId: query.get('organizationId') ?? '',
      from: query.get('from') ?? '', to: query.get('to') ?? '',
      fromDate: query.get('fromDate') ?? '', toDate: query.get('toDate') ?? '',
    };
    const result = await withReadRequest(request, () => getCalendarWindow(input));
    const status = result.success ? 200 : result.error === 'not_authenticated' ? 401
      : result.error === 'invalid_input' ? 400
      : ['organization_changed', 'no_active_org', 'not_a_member'].includes(result.error) ? 403 : 500;
    return NextResponse.json(result, { status, headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ success: false, error: 'unexpected_error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
