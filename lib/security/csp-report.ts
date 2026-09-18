/**
 * Report-only script policy (SEC-08 option 3, owner decision of 2026-09-14):
 * browsers block nothing and report what the strict policy would block, so the
 * nonce-versus-'unsafe-inline' decision rests on real reports from real pages.
 * Only script, object, base and form directives are declared; a default-src
 * would report every Supabase and R2 request and drown the script findings.
 */
const CSP_REPORT_PATH = '/api/csp-report';
export const CSP_REPORTING_ENDPOINTS_HEADER = `csp-reports="${CSP_REPORT_PATH}"`;
export const CSP_REPORT_ONLY_POLICY = [
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  `report-uri ${CSP_REPORT_PATH}`,
  'report-to csp-reports',
].join('; ');

/** Bodies above this are dropped unread; a report is a few hundred bytes. */
export const CSP_REPORT_BODY_LIMIT = 16 * 1024;
/** A report-to batch above this keeps its first entries only. */
export const CSP_REPORT_MAX_VIOLATIONS = 20;

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
 * Reduces one legacy (`application/csp-report`) or one Reporting API
 * (`application/reports+json`) body to the fields the policy decision needs.
 * `script-sample` and the original policy never enter the log: the sample can
 * carry streamed page content, and the policy is ours already.
 */
export function summarizeCspReports(body: unknown): CspViolation[] {
  const entries: Record<string, unknown>[] = [];
  const legacy = asRecord(asRecord(body)?.['csp-report']);
  if (legacy) entries.push(legacy);
  if (Array.isArray(body)) {
    for (const item of body.slice(0, CSP_REPORT_MAX_VIOLATIONS)) {
      const report = asRecord(item);
      const violation = asRecord(report?.body);
      if (report?.type === 'csp-violation' && violation) entries.push(violation);
    }
  }
  const violations: CspViolation[] = [];
  for (const entry of entries) {
    const directive = text(entry['effective-directive'] ?? entry.effectiveDirective ?? entry['violated-directive'] ?? entry.violatedDirective);
    const blocked = location(entry['blocked-uri'] ?? entry.blockedURL, false);
    const document = location(entry['document-uri'] ?? entry.documentURL, true);
    if (!directive || !blocked || !document) continue;
    violations.push({
      directive,
      blocked,
      document,
      source: location(entry['source-file'] ?? entry.sourceFile, true),
      line: integer(entry['line-number'] ?? entry.lineNumber),
      column: integer(entry['column-number'] ?? entry.columnNumber),
    });
  }
  return violations;
}
