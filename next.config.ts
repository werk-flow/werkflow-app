import type { NextConfig } from 'next';

const buildId = process.env.WERKFLOW_BUILD_ID;

// File bytes never travel through Server Actions: uploads go directly from the
// browser to object storage via signed URLs (docs/decisions/0001-infrastructure-stack.md),
// so the default Server Action body-size limit stays in place.
import { buildContentSecurityPolicy, buildReportOnlyContentSecurityPolicy } from './lib/security/csp-report';

type HeaderEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Browser hardening headers on every response (SI-020). The enforced and the
 * report-only Content-Security-Policy are built from the environment;
 * lib/security/csp-report.ts proves each directive and explains the nonce gap.
 *
 * HSTS with includeSubDomains is sent by the production deployment only, which
 * Vercel marks with VERCEL_ENV=production. NODE_ENV cannot tell it apart:
 * previews and the local production build used by the test server set
 * NODE_ENV=production too. Browsers ignore HSTS over plain http, but a preview
 * domain is not ours to pin with includeSubDomains, and Vercel already sends
 * its own HSTS on its domains.
 */
export function buildSecurityHeaders(env: HeaderEnvironment): Array<{ key: string; value: string }> {
  return [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Content-Security-Policy', value: buildContentSecurityPolicy(env) },
    { key: 'Content-Security-Policy-Report-Only', value: buildReportOnlyContentSecurityPolicy(env) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
    ...(env.VERCEL_ENV === 'production'
      ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }]
      : []),
  ];
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  // `next dev` would otherwise append its own block to the repository's
  // AGENTS.md on every start and dirty the tree (found 2026-09-18, P1-24a).
  agentRules: false,
  headers: async () => [
    { source: '/:path*', headers: buildSecurityHeaders(process.env) },
    // Persist only an opaque build ID in Next's route manifest. The private receipt
    // stays on disk; preflight uses this response header to identify the running build.
    ...(buildId ? [{ source: '/login', headers: [{ key: 'x-werkflow-build', value: buildId }] }] : []),
  ],
  ...(buildId ? { generateBuildId: () => buildId } : {}),
};

export default nextConfig;
