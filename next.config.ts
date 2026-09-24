import type { NextConfig } from "next";

const buildId = process.env.WERKFLOW_BUILD_ID;

// File bytes never travel through Server Actions: uploads go directly from the
// browser to object storage via signed URLs (docs/decisions/0001-infrastructure-stack.md),
// so the default Server Action body-size limit stays in place.
import { CSP_POLICY } from "./lib/security/csp-report";

// Browser hardening headers on every response (SI-020). HSTS comes from Vercel.
// The script policy is enforced and origin-only (SEC-08, owner decision of
// 2026-09-18 after a report-only phase); lib/security/csp-report.ts explains
// the directives and the nonce gap it leaves open.
export const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: CSP_POLICY },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
] as const;

const nextConfig: NextConfig = {
  cacheComponents: true,
  // `next dev` would otherwise append its own block to the repository's
  // AGENTS.md on every start and dirty the tree (found 2026-09-18, P1-24a).
  agentRules: false,
  headers: async () => [
    { source: "/:path*", headers: [...SECURITY_HEADERS] },
    // Persist only an opaque build ID in Next's route manifest. The private receipt
    // stays on disk; preflight uses this response header to identify the running build.
    ...(buildId
      ? [{ source: "/login", headers: [{ key: "x-werkflow-build", value: buildId }] }]
      : []),
  ],
  ...(buildId ? { generateBuildId: () => buildId } : {}),
};

export default nextConfig;
