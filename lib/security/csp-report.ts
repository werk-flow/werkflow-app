// Content-Security-Policy of every response, built in next.config.ts from the
// environment at build time (headers are baked into the route manifest, like
// the NEXT_PUBLIC_ values in the client bundle). A missing or malformed origin
// omits its source instead of writing `undefined`: the policy fails closed.
//
// Enforced directives and their proof in the code:
// - script-src 'self' 'unsafe-inline': Next streams inline scripts on every
//   page; foreign scripts are blocked. Injected inline scripts are not: the
//   nonce policy that would close that gap is the open backlog row.
//   'unsafe-eval' is absent: lib/zod.ts sets Zod's `jitless` before any
//   schema exists, so its `Function("")` probe never runs and no `eval`
//   violation is expected (lib/conventions/zod-entry.test.ts).
// - default-src 'self': every fetch directive the app uses is declared below.
//   The remaining fallbacks have no cross-origin user: no <video>/<audio>, no
//   web manifest under app/, no Worker or service worker, and the Realtime
//   client in lib/supabase/client.ts runs without its worker option.
// - style-src 'self' 'unsafe-inline': the Tailwind CSS is a same-origin
//   stylesheet; next/font and Radix write inline style tags and attributes.
// - img-src 'self' data: blob: Supabase storage: public avatar URLs
//   (lib/profile-avatar.ts), the signed document image preview from object
//   storage (components/dokumente/document-viewer-dialog.tsx), and the logos
//   and favicon from public/. data: and blob: are local-only schemes that
//   cannot carry data to another origin; the report-only policy checks
//   whether anything still needs them.
// - font-src 'self': next/font/google (app/layout.tsx) self-hosts the fonts
//   under /_next/static/media; no stylesheet or font loads from a font CDN.
// - connect-src 'self' Supabase (http(s) and ws(s)) storage: Server Actions
//   and route handlers are same-origin; the browser Supabase client
//   (lib/supabase/client.ts) calls REST, Auth and Storage and opens the
//   Realtime socket; lib/documents/upload-client.ts PUTs file bytes to the
//   presigned object-storage URL.
// - frame-src storage: the PDF preview frames the signed object-storage URL
//   (components/dokumente/document-viewer-dialog.tsx). No other frame exists.
// - object-src 'none', base-uri 'self', form-action 'self', frame-ancestors
//   'none': no plugin, no <base>, forms post to this origin only, and the app
//   is never framed (X-Frame-Options: DENY says the same).
// Violations report through the legacy `report-uri` channel only: with
// `report-to` present Chromium batches through the Reporting API and delivered
// nothing in the preview check.
const CSP_REPORT_PATH = '/api/csp-report';

/** The environment variables the policy reads; next.config.ts passes process.env. */
type CspEnvironment = Readonly<Record<string, string | undefined>>;

function webOrigin(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** The Realtime socket origin of an http(s) origin. 'self' and https sources do not match ws(s). */
function socketOrigin(origin: string): string {
  return origin.replace(/^http/, 'ws');
}

/**
 * The origin of the URLs that `getR2Endpoint()` in lib/storage/r2.ts signs
 * (path-style, so every signed URL shares the endpoint origin), derived from
 * the same variables. That module is server-only and cannot load in
 * next.config.ts; lib/security/csp-report.test.ts pins the two.
 */
export function storageOrigin(env: CspEnvironment): string | null {
  const endpointOverride = env.R2_ENDPOINT?.trim();
  if (endpointOverride) return webOrigin(endpointOverride);
  const accountId = env.R2_ACCOUNT_ID;
  if (!accountId) return null;
  const jurisdiction = env.R2_JURISDICTION ?? 'eu';
  const jurisdictionSegment = jurisdiction ? `${jurisdiction}.` : '';
  return webOrigin(`https://${accountId}.${jurisdictionSegment}r2.cloudflarestorage.com`);
}

function sourceList(...sources: Array<string | null>): string {
  const present = sources.filter((source): source is string => source !== null);
  return [...new Set(present)].join(' ');
}

function policyOrigins(env: CspEnvironment): { supabase: string | null; storage: string | null } {
  // The variable lib/env/public.ts reads for the browser Supabase client.
  return { supabase: webOrigin(env.NEXT_PUBLIC_SUPABASE_URL), storage: storageOrigin(env) };
}

/** The enforced policy. Every directive is proven in the comment above. */
export function buildContentSecurityPolicy(env: CspEnvironment): string {
  const { supabase, storage } = policyOrigins(env);
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${sourceList("'self'", 'data:', 'blob:', supabase, storage)}`,
    "font-src 'self'",
    `connect-src ${sourceList("'self'", supabase, supabase ? socketOrigin(supabase) : null, storage)}`,
    `frame-src ${storage ?? "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join('; ');
}

/**
 * The report-only policy: the tightening the code suggests but cannot prove
 * for every browser and library. It blocks nothing; its violations reach the
 * same endpoint with `disposition: report` and decide whether a directive can
 * move into the enforced policy. Directives it omits are unrestricted here.
 */
export function buildReportOnlyContentSecurityPolicy(env: CspEnvironment): string {
  const { supabase, storage } = policyOrigins(env);
  return [
    `img-src ${sourceList("'self'", supabase, storage)}`,
    "worker-src 'none'",
    "manifest-src 'none'",
    "media-src 'none'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join('; ');
}

/** Bodies above this are dropped unread; a report is a few hundred bytes. */
export const CSP_REPORT_BODY_LIMIT = 16 * 1024;

export type CspViolation = {
  /** `enforce` was blocked, `report` came from the report-only policy; null when the browser omits it. */
  disposition: 'enforce' | 'report' | null;
  directive: string;
  blocked: string;
  document: string;
  source: string | null;
  line: number | null;
  column: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
  const disposition = entry['disposition'];
  return {
    disposition: disposition === 'enforce' || disposition === 'report' ? disposition : null,
    directive,
    blocked,
    document,
    source: location(entry['source-file'], true),
    line: integer(entry['line-number']),
    column: integer(entry['column-number']),
  };
}
