import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { arch, cpus, platform, totalmem } from "node:os";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { z } from "zod";

import { MEASUREMENT_VERSION, type MeasuredScenario } from "./measured-scenarios";

/** Describes the experiment, independently of the application being compared. */
export const performanceContextSchema = z.object({
  workloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  measurementDigest: z.string().regex(/^[a-f0-9]{64}$/),
  protocol: z.string().min(1),
  role: z.enum(["admin", "buero", "employee"]),
  browser: z.string().min(1),
  browserVersion: z.string().min(1),
  viewport: z.object({ width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  deviceScaleFactor: z.number().positive(),
  platform: z.string().min(1),
  architecture: z.string().min(1),
  cpuModel: z.string().min(1),
  logicalProcessors: z.number().int().positive(),
  memoryGiB: z.number().int().positive(),
  providerDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type PerformanceContext = z.infer<typeof performanceContextSchema>;

/** Logical comparison identity only. Build/preflight qualification still uses the actual routed origin. */
export function performanceProviderDigest(input:
  | { target: "local"; providerOrigin: string; localProjectId: string }
  | { target: "cloud"; providerOrigin: string },
): string {
  const address = new URL(input.providerOrigin);
  if (address.username || address.password || address.pathname !== "/" || address.search || address.hash) throw new Error("Performance provider identity requires a plain origin.");
  if (input.target === "cloud") {
    if (address.protocol !== "https:" || !address.hostname.endsWith(".supabase.co")) throw new Error("Cloud performance identity requires a hosted Supabase project origin.");
    return createHash("sha256").update(`supabase:cloud:${address.origin}`).digest("hex");
  }
  const localHost = address.hostname === "localhost" || (isIP(address.hostname) === 4 && (
    address.hostname === "127.0.0.1" || /^10\./.test(address.hostname) || /^192\.168\./.test(address.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(address.hostname)
  ));
  if (!localHost || address.protocol !== "http:" || address.port !== "54321") throw new Error("Local performance identity requires the local Supabase API origin.");
  if (!/^[a-zA-Z0-9_-]+$/.test(input.localProjectId)) throw new Error("Local performance identity requires the configured Supabase project id.");
  // WSL's private address is transport, not a different database provider.
  return createHash("sha256").update(`supabase:local:${input.localProjectId}`).digest("hex");
}

export function performanceProtocol(scenario: MeasuredScenario): Pick<PerformanceContext, "protocol" | "role"> {
  if (scenario.id === "planning.occurrence.cross-session") return { protocol: "independent-fixed-month-three-distinct-overlap-confirmations-browser-raf-v3", role: "buero" };
  if (scenario.id === "calendar.month.employee-open-to-event") return { protocol: "independent-fixed-month-fresh-employee-after-three-saves-browser-raf-v3", role: "employee" };
  if (scenario.id === "calendar.month.admin-open-to-legacy-event") return { protocol: "independent-fixed-month-fresh-admin-after-legacy-save-browser-raf-v3", role: "admin" };
  return { protocol: scenario.file.endsWith("lists.spec.ts") ? "fixed-workload-fresh-context-customer-then-job-navigation-browser-raf-v3" : "fixed-date-fresh-context-day-week-day-week-month-next-week-browser-raf-v3", role: "admin" };
}

export function workloadDigest(repositoryRoot: string, scenario: MeasuredScenario, evidenceDirectory?: string): string {
  const files = scenario.profile === "typical"
    ? ["tests/audit/support/performance-profile.ts", "tests/audit/support/seed-publication.ts", "lib/testing/fixture-publication.ts"]
    : ["tests/golden/support/seed.ts", scenario.file];
  const digest = createHash("sha256");
  for (const file of files) digest.update(file).update("\0").update(readFileSync(resolve(repositoryRoot, file))).update("\0");
  if (scenario.profile === "typical") {
    if (!evidenceDirectory) throw new Error("Typical workload identity requires its archived actual counts and business date.");
    digest.update(readFileSync(resolve(evidenceDirectory, "performance-workload.json")));
  } else {
    if (!evidenceDirectory) throw new Error("Planning benchmark identity requires its owned fixed workload archive.");
    digest.update(readFileSync(resolve(evidenceDirectory, "planning-benchmark-workload.json")));
  }
  return digest.digest("hex");
}

export function measurementDigest(repositoryRoot: string, scenario: MeasuredScenario): string {
  const digest = createHash("sha256").update(JSON.stringify({ version: MEASUREMENT_VERSION, id: scenario.id, scenarioVersion: scenario.version, boundary: scenario.boundary, samples: scenario.samples, protocol: performanceProtocol(scenario) }));
  // The measured path only: the scenario module, the browser observer and the
  // engine. The ordinary freshness and readiness helpers in live.ts are not
  // part of the measurement and no longer move the reviewed references.
  for (const file of [scenario.file, "tests/golden/support/scenario-measurement.ts", "tests/golden/support/browser-observation.ts", "lib/testing/live-observation.ts", "tests/audit/support/performance-steps.ts"]) digest.update(file).update("\0").update(readFileSync(resolve(repositoryRoot, file))).update("\0");
  return digest.digest("hex");
}

export function capturePerformanceContext(input: {
  repositoryRoot: string;
  evidenceDirectory: string;
  scenario: MeasuredScenario;
  browser: string;
  browserVersion: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  target: "local" | "cloud";
  providerOrigin: string;
}): PerformanceContext {
  const processors = cpus();
  const provider: Parameters<typeof performanceProviderDigest>[0] = input.target === "cloud"
    ? { target: "cloud", providerOrigin: input.providerOrigin }
    : { target: "local", providerOrigin: input.providerOrigin, localProjectId: readFileSync(resolve(input.repositoryRoot, "supabase/config.toml"), "utf8").match(/^project_id\s*=\s*"([^"]+)"\s*$/m)?.[1] ?? "" };
  return performanceContextSchema.parse({
    workloadDigest: workloadDigest(input.repositoryRoot, input.scenario, input.evidenceDirectory),
    measurementDigest: measurementDigest(input.repositoryRoot, input.scenario),
    ...performanceProtocol(input.scenario),
    browser: input.browser,
    browserVersion: input.browserVersion,
    viewport: input.viewport,
    deviceScaleFactor: input.deviceScaleFactor,
    platform: platform(),
    architecture: arch(),
    cpuModel: processors[0]?.model ?? "unknown",
    logicalProcessors: processors.length,
    memoryGiB: Math.max(1, Math.round(totalmem() / 1024 ** 3)),
    providerDigest: performanceProviderDigest(provider),
  });
}

export function samePerformanceContext(left: PerformanceContext, right: PerformanceContext): boolean {
  return JSON.stringify(performanceContextSchema.parse(left)) === JSON.stringify(performanceContextSchema.parse(right));
}
