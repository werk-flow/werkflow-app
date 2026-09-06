import type { NextConfig } from "next";

const buildId = process.env.WERKFLOW_BUILD_ID;

// File bytes never travel through Server Actions: uploads go directly from the
// browser to object storage via signed URLs (docs/decisions/0001-infrastructure-stack.md),
// so the default Server Action body-size limit stays in place.
const nextConfig: NextConfig = {
  cacheComponents: true,
  // Persist only an opaque build ID in Next's route manifest. The private receipt
  // stays on disk; preflight uses this response header to identify the running build.
  ...(buildId ? {
    generateBuildId: () => buildId,
    headers: () => [{ source: "/login", headers: [{ key: "x-werkflow-build", value: buildId }] }],
  } : {}),
};

export default nextConfig;
