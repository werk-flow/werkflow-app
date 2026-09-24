import { NextResponse } from 'next/server';
import { getCalendarBoardContext, type CalendarBoardInput } from '@/lib/calendar/board-actions';
import { withReadRequest } from '@/lib/data/read-request-cache';

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store' };
const INPUT_KEYS = ['organizationId', 'fromDate', 'toDate'] as const;

/**
 * The board context beside the calendar window (P1-24a): rows, daily targets,
 * dispatch states and material demand for the same dates. Same transport
 * posture as /api/calendar-window: the reader owns identity, organization and
 * role; every response is private and never cached.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    const query = new URL(request.url).searchParams;
    if (INPUT_KEYS.some((key) => query.getAll(key).length !== 1)) {
      return NextResponse.json({ success: false, error: 'invalid_input' }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const input: CalendarBoardInput = {
      organizationId: query.get('organizationId') ?? '',
      fromDate: query.get('fromDate') ?? '',
      toDate: query.get('toDate') ?? '',
    };
    const result = await withReadRequest(request, () => getCalendarBoardContext(input));
    const status = result.success ? 200 : result.error === 'not_authenticated' ? 401
      : result.error === 'invalid_input' ? 400
      : ['organization_changed', 'no_active_org', 'not_a_member'].includes(result.error) ? 403 : 500;
    return NextResponse.json(result, { status, headers: PRIVATE_HEADERS });
  } catch {
    return NextResponse.json({ success: false, error: 'unexpected_error' }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
