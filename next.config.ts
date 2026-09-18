import type { NextConfig } from "next";

const buildId = process.env.WERKFLOW_BUILD_ID;

// File bytes never travel through Server Actions: uploads go directly from the
// browser to object storage via signed URLs (docs/decisions/0001-infrastructure-stack.md),
// so the default Server Action body-size limit stays in place.
import { CSP_REPORT_ONLY_POLICY, CSP_REPORTING_ENDPOINTS_HEADER } from "./lib/security/csp-report";

// Browser hardening headers on every response (SI-020). HSTS comes from Vercel.
// The script policy is report-only (SEC-08 option 3, 2026-09-18): Next streams
// inline scripts and a nonce policy needs proxy work, so browsers report what
// the strict policy would block to /api/csp-report and block nothing; the
// enforced policy is the owner's decision after reading those reports.
export const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY_POLICY },
  { key: "Reporting-Endpoints", value: CSP_REPORTING_ENDPOINTS_HEADER },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
] as const;

const nextConfig: NextConfig = {
  cacheComponents: true,
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
