import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMeasuredScenario } from "./measured-scenarios";
import { performanceProviderDigest, samePerformanceContext, workloadDigest } from "./performance-context";
import { performanceContextFixture } from "./fixtures/performance";

test("local WSL transport changes preserve provider comparison identity while different stacks do not", () => {
  const provider = (providerOrigin: string, localProjectId = "werkflow-app"): string => performanceProviderDigest({ target: "local", providerOrigin, localProjectId });
  const oldContext = { ...performanceContextFixture, providerDigest: provider("http://172.25.78.1:54321") };
  for (const origin of ["http://172.25.76.238:54321", "http://127.0.0.1:54321", "http://localhost:54321"]) {
    expect(samePerformanceContext(oldContext, { ...oldContext, providerDigest: provider(origin) })).toBe(true);
  }
  expect(samePerformanceContext(oldContext, { ...oldContext, providerDigest: provider("http://172.25.76.238:54321", "another-stack") })).toBe(false);
});

test("different hosted Supabase projects and local versus cloud remain incompatible", () => {
  const first = { ...performanceContextFixture, providerDigest: performanceProviderDigest({ target: "cloud", providerOrigin: "https://first-project.supabase.co" }) };
  const second = { ...first, providerDigest: performanceProviderDigest({ target: "cloud", providerOrigin: "https://second-project.supabase.co" }) };
  const local = { ...first, providerDigest: performanceProviderDigest({ target: "local", providerOrigin: "http://172.25.76.238:54321", localProjectId: "werkflow-app" }) };
  expect(samePerformanceContext(first, second)).toBe(false);
  expect(samePerformanceContext(first, local)).toBe(false);
});

test("logical local identity never accepts a hosted, spoofed or differently routed provider origin", () => {
  for (const providerOrigin of ["https://first-project.supabase.co", "http://172.25.evil.example:54321", "http://8.8.8.8:54321", "http://172.25.76.238:8000", "https://127.0.0.1:54321", "http://user@127.0.0.1:54321", "http://127.0.0.1:54321/other"]) {
    expect(() => performanceProviderDigest({ target: "local", providerOrigin, localProjectId: "werkflow-app" })).toThrow();
  }
  expect(() => performanceProviderDigest({ target: "cloud", providerOrigin: "http://127.0.0.1:54321" })).toThrow();
  expect(() => performanceProviderDigest({ target: "local", providerOrigin: "http://127.0.0.1:54321", localProjectId: "" })).toThrow();
});

test("repeated fixed-date workloads have stable identity while changed dates or counts cannot compare", () => {
  const root = mkdtempSync(join(tmpdir(), "werkflow-workload-identity-"));
  const evidence = join(root, "evidence");
  try {
    mkdirSync(join(root, "tests/audit/support"), { recursive: true });
    mkdirSync(join(root, "lib/testing"), { recursive: true });
    writeFileSync(join(root, "tests/audit/support/seed-publication.ts"), "publication receiver v1");
    writeFileSync(join(root, "lib/testing/fixture-publication.ts"), "publication ordering v1");
    mkdirSync(evidence);
    writeFileSync(join(root, "tests/audit/support/performance-profile.ts"), 'export const anchor = "2026-06-15";');
    const workload = { businessDate: "2026-06-15", counts: { occurrences: 1760, timeEntries: 132 }, window: { from: "2026-05-31", to: "2026-07-13" } };
    const archive = (value: unknown): void => { writeFileSync(join(evidence, "performance-workload.json"), JSON.stringify(value)); };
    const scenario = getMeasuredScenario("calendar.board.cold-open");
    archive(workload);
    const first = workloadDigest(root, scenario, evidence);
    archive({ ...workload });
    expect(workloadDigest(root, scenario, evidence)).toBe(first);
    archive({ ...workload, businessDate: "2026-06-16" });
    expect(workloadDigest(root, scenario, evidence)).not.toBe(first);
    archive({ ...workload, counts: { ...workload.counts, timeEntries: 144 } });
    expect(workloadDigest(root, scenario, evidence)).not.toBe(first);
    archive({ ...workload, window: { ...workload.window, to: "2026-07-14" } });
    expect(workloadDigest(root, scenario, evidence)).not.toBe(first);
    expect(() => workloadDigest(root, scenario)).toThrow("actual counts and business date");
    archive(workload);
    expect(workloadDigest(root, scenario, evidence)).toBe(first);
    writeFileSync(join(root, "lib/testing/fixture-publication.ts"), "publication ordering v2");
    expect(workloadDigest(root, scenario, evidence)).not.toBe(first);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
