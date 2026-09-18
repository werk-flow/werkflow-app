import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Tier 2 inventory for route handlers (SI-001, SI-007, SI-013). A route handler
// gets no framework authentication or CSRF check, so every one that exists
// must be listed here with the mechanism that authorizes it. Adding a handler
// without extending this list fails the unit group.

const repositoryRoot = resolve(import.meta.dir, '../..');

const reviewedHandlers: Record<string, { authorization: string; mustImport: readonly string[] }> = {
  'app/api/customer-page/route.ts': {
    authorization: 'verified cookie identity, current manager role and active organization equality before the bounded shared customer reader; validated query and private no-store responses',
    mustImport: ['authenticateAndAuthorize', 'withReadRequest', 'customerPageInputSchema', 'readCustomerPage'],
  },
  'app/api/time-tracking-state/route.ts': {
    authorization: 'verified cookie identity and matching active organization before delegating to existing self-clock and membership-checked active-job readers; validated kind/UUID, private no-store responses',
    mustImport: ['authenticateAndAuthorize', 'getCurrentClockState', 'getActiveJobIdsForOrg', 'withReadRequest'],
  },
  'app/api/calendar-window/route.ts': {
    authorization: 'delegates to getCalendarWindow: verified cookie identity, active organization equality, bounded paired ranges, and constituent role permissions; every response is private and no-store',
    mustImport: ['getCalendarWindow'],
  },
  'app/api/attention-counts/route.ts': {
    authorization: 'delegates to getAttentionCounts, which authenticates the cookie session, resolves the active organization, and checks membership',
    mustImport: ['getAttentionCounts'],
  },
  'app/api/redeem-invite/route.ts': {
    authorization: 'getUser() on the caller session; the RPC binds the invite to that user',
    mustImport: ['createSupabaseServerClient'],
  },
  'app/api/csp-report/route.ts': {
    authorization: 'unauthenticated by design: receives browser CSP reports for the report-only script policy, reads and writes nothing, bounds the body, and logs a redacted summary without script samples or query strings',
    mustImport: ['summarizeCspReport', 'CSP_REPORT_BODY_LIMIT'],
  },
  'app/api/background-read/route.ts': {
    authorization: 'closed reader registry with per-kind validated input; verified cookie identity and, for inputs that name an organization, active-organization equality before delegating to readers that keep their own membership and subject checks; private no-store responses at background priority',
    mustImport: ['authenticateAndAuthorize', 'withReadRequest', 'BACKGROUND_READS', 'isBackgroundReadKind'],
  },
  'app/auth/callback/route.ts': {
    authorization: 'GET: provider code/token exchange with same-origin return path; POST: same-origin JSON guard before setSession',
    mustImport: ['resolveSafeReturnPath', 'verifySameOriginJsonRequest', 'isUuid'],
  },
  'app/auth/flash/route.ts': {
    authorization: 'writes only an allowlisted flash key into a short-lived cookie',
    mustImport: ['isAuthFlashKey'],
  },
};

function listRouteHandlers(): string[] {
  const found: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.name === 'route.ts' || entry.name === 'route.tsx') found.push(path);
    }
  }
  visit('app');
  return found.sort();
}

test('every route handler is reviewed and still imports its authorization mechanism', () => {
  const handlers = listRouteHandlers();
  expect(handlers).toEqual(Object.keys(reviewedHandlers).sort());
  for (const [file, review] of Object.entries(reviewedHandlers)) {
    const source = readFileSync(resolve(repositoryRoot, file), 'utf8');
    for (const symbol of review.mustImport) {
      expect(source.includes(symbol), `${file} no longer references ${symbol}`).toBe(true);
    }
  }
});

test('no route handler returns raw database error messages', () => {
  for (const file of listRouteHandlers()) {
    const source = readFileSync(resolve(repositoryRoot, file), 'utf8');
    expect(source.includes('details:'), `${file} echoes an error message`).toBe(false);
  }
});
