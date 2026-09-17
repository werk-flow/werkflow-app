import type { PerformanceContext } from "../performance-context";

/** Synthetic machine/workload metadata for pure comparison tests. */
export const performanceContextFixture: PerformanceContext = {
  workloadDigest: "a".repeat(64), measurementDigest: "c".repeat(64), protocol: "fresh-context-test-v1", role: "admin",
  browser: "chromium", browserVersion: "test-browser-v1", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
  platform: "win32", architecture: "x64", cpuModel: "test-cpu", logicalProcessors: 8, memoryGiB: 16,
  providerDigest: "b".repeat(64),
};
