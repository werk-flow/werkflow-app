import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSecurityHeaders } from '../../next.config';

// Tier 2 pin for SI-020: the header set next.config.ts sends on every path.

const source = readFileSync(resolve(import.meta.dir, '../../next.config.ts'), 'utf8');
const environment = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  R2_ACCOUNT_ID: 'account',
};

function headerMap(env: Record<string, string | undefined>): Map<string, string> {
  return new Map(buildSecurityHeaders(env).map(({ key, value }) => [key, value]));
}

test('next.config.ts sends the browser hardening headers on every path', () => {
  expect(source).toContain("{ source: '/:path*', headers: buildSecurityHeaders(process.env) }");
  const headers = headerMap(environment);
  expect(headers.get('X-Frame-Options')).toBe('DENY');
  expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  expect(headers.get('Permissions-Policy')).toBe('camera=(self), microphone=(), geolocation=(), payment=()');
  expect(headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  expect(headers.get('Content-Security-Policy-Report-Only')).toContain('report-uri /api/csp-report');
});

test('HSTS with subdomains is sent by the production deployment only', () => {
  expect(headerMap({ ...environment, VERCEL_ENV: 'production' }).get('Strict-Transport-Security')).toBe(
    'max-age=63072000; includeSubDomains',
  );
  for (const VERCEL_ENV of ['preview', 'development', undefined]) {
    // A local production build sets NODE_ENV=production without being the production deployment.
    expect(
      headerMap({ ...environment, NODE_ENV: 'production', VERCEL_ENV }).has('Strict-Transport-Security'),
    ).toBe(false);
  }
});

test('the build-identity header still rides only the login route', () => {
  expect(source).toContain("source: '/login', headers: [{ key: 'x-werkflow-build'");
});
