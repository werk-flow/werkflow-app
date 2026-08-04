import type { NextConfig } from "next";

// File bytes never travel through Server Actions: uploads go directly from the
// browser to object storage via signed URLs (docs/decisions/0001-infrastructure-stack.md),
// so the default Server Action body-size limit stays in place.
const nextConfig: NextConfig = {
  cacheComponents: true,
};

export default nextConfig;
