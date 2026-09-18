import { NextRequest, NextResponse } from 'next/server';

import { CSP_REPORT_BODY_LIMIT, summarizeCspReports } from '@/lib/security/csp-report';

// Receives the browser's reports for the report-only script policy declared in
// next.config.ts. Deliberately unauthenticated: browsers post reports without
// application context, the handler reads nothing, writes nothing, and logs a
// bounded, redacted summary (no script sample, no query strings) for the
// owner's nonce decision (SEC-08). The route inventory names this posture.
const ACCEPTED_CONTENT_TYPES = ['application/csp-report', 'application/reports+json', 'application/json'];

export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (!ACCEPTED_CONTENT_TYPES.includes(contentType) || declaredLength > CSP_REPORT_BODY_LIMIT) {
    return new NextResponse(null, { status: 204 });
  }
  const raw = await request.text().catch(() => '');
  if (raw.length === 0 || raw.length > CSP_REPORT_BODY_LIMIT) {
    return new NextResponse(null, { status: 204 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  const violations = summarizeCspReports(body);
  if (violations.length > 0) {
    console.warn('[csp-report]', JSON.stringify(violations));
  }
  return new NextResponse(null, { status: 204 });
}
