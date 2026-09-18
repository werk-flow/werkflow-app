import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Tier 2 pin for SI-020. The header set is read from next.config.ts as text so
// the check does not execute the Next configuration module.

const source = readFileSync(resolve(import.meta.dir, '../../next.config.ts'), 'utf8');

test('next.config.ts sends the browser hardening headers on every path', () => {
  expect(source).toContain('source: "/:path*"');
  for (const expected of [
    '{ key: "X-Frame-Options", value: "DENY" }',
    `{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }`,
    '{ key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY_POLICY }',
    '{ key: "Reporting-Endpoints", value: CSP_REPORTING_ENDPOINTS_HEADER }',
    '{ key: "X-Content-Type-Options", value: "nosniff" }',
    '{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }',
    '{ key: "Permissions-Policy", value:',
  ]) {
    expect(source).toContain(expected);
  }
});

test('the build-identity header still rides only the login route', () => {
  expect(source).toContain('source: "/login", headers: [{ key: "x-werkflow-build"');
});
