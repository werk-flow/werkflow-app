/**
 * Enforced origin-only script policy (SEC-08, owner decision of 2026-09-18):
 * scripts and plugins may come from this origin only, which blocks injected
 * external scripts and objects. `'unsafe-inline'` stays because Next streams
 * inline scripts on every page; the report-only phase (2026-09-18) showed
 * nothing else. Injected inline scripts are therefore not blocked; the nonce
 * policy that would close that gap is the open backlog row. Only script,
 * object, base, form and frame directives are declared; a default-src would
 * block every Supabase and R2 request. Violations still report through the
 * legacy `report-uri` channel only: with `report-to` present Chromium batches
 * through the Reporting API and delivered nothing in the preview check.
 */
const CSP_REPORT_PATH = '/api/csp-report';
export const CSP_POLICY = [
  "script-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  `report-uri ${CSP_REPORT_PATH}`,
].join('; ');

/** Bodies above this are dropped unread; a report is a few hundred bytes. */
export const CSP_REPORT_BODY_LIMIT = 16 * 1024;

export type CspViolation = {
  directive: string;
  blocked: string;
  document: string;
  source: string | null;
  line: number | null;
  column: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 200) : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

/** Origins and paths only: a script or document URL never carries a query or fragment into the log. */
function location(value: unknown, keepPath: boolean): string | null {
  const raw = text(value);
  if (!raw) return null;
  if (raw === 'inline' || raw === 'eval' || raw === 'data' || raw === 'blob' || raw === 'self') return raw;
  try {
    const url = new URL(raw);
    return keepPath ? `${url.origin}${url.pathname}` : url.origin;
  } catch {
    return raw.split(/[?#]/)[0]?.slice(0, 200) ?? null;
  }
}

/**
 * Reduces one `application/csp-report` body to the fields the policy decision
 * needs. `script-sample` and the original policy never enter the log: the
 * sample can carry streamed page content, and the policy is ours already.
 */
export function summarizeCspReport(body: unknown): CspViolation | null {
  const entry = asRecord(asRecord(body)?.['csp-report']);
  if (!entry) return null;
  const directive = text(entry['effective-directive'] ?? entry['violated-directive']);
  const blocked = location(entry['blocked-uri'], false);
  const document = location(entry['document-uri'], true);
  if (!directive || !blocked || !document) return null;
  return {
    directive,
    blocked,
    document,
    source: location(entry['source-file'], true),
    line: integer(entry['line-number']),
    column: integer(entry['column-number']),
  };
}
