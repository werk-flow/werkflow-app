import 'server-only';

import type { HandoutRefusal } from './handout';

// The answers of the hand-out routes (app/api/problem-reports/v1/). Every
// answer is private and never stored; an error answers its code only.

export const HANDOUT_HEADERS = { 'Cache-Control': 'no-store' } as const;

const STATUS: Record<HandoutRefusal | 'invalid_input' | 'failed', number> = {
  invalid_input: 400,
  report_not_found: 404,
  no_screenshot: 404,
  copy_pending: 409,
  copy_unavailable: 409,
  report_closed: 409,
  already_handed_out: 409,
  report_not_handed_out: 409,
  failed: 500,
};

/** The answer to a request the hand-out secret did not admit: off (503) or refused (401). */
export function handoutAccessRefusal(access: 'refused' | 'unconfigured'): Response {
  return access === 'unconfigured'
    ? Response.json({ error: 'handout_off' }, { status: 503, headers: HANDOUT_HEADERS })
    : Response.json(
        { error: 'unauthorized' },
        { status: 401, headers: { ...HANDOUT_HEADERS, 'WWW-Authenticate': 'Bearer' } },
      );
}

export function handoutError(error: keyof typeof STATUS): Response {
  return Response.json({ error }, { status: STATUS[error], headers: HANDOUT_HEADERS });
}
