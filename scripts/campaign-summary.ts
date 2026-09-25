import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { formatCampaignSummary, summarizeCampaign, type CampaignReport } from "../lib/testing/campaign-summary";
import { listRunManifests } from "../tests/golden/support/run-state";

/**
 * `bun run test:campaign [--since <ISO time>]`: the verification cost since the
 * last commit (or the given time), from the reports under .agent-logs/verification.
 */
const repository = resolve(import.meta.dir, "..");
const archive = resolve(repository, ".agent-logs/verification");
const reportSchema = z.object({
  id: z.string(), startedAt: z.string(), completedAt: z.string().nullable(), status: z.enum(["running", "passed", "failed"]),
  results: z.array(z.object({ groupId: z.string(), status: z.enum(["passed", "failed", "blocked"]), startedAt: z.string(), runKey: z.string().nullable(), reason: z.string().nullable().default(null) })),
  snapshot: z.object({ files: z.record(z.string(), z.string()) }).default({ files: {} }),
});

export function readCampaignReports(): CampaignReport[] {
  if (!existsSync(archive)) return [];
  return readdirSync(archive).sort().flatMap((directory) => {
    const file = resolve(archive, directory, "report.json");
    if (!existsSync(file)) return [];
    const { snapshot, ...report } = reportSchema.parse(JSON.parse(readFileSync(file, "utf8")));
    return [{ ...report, files: snapshot.files }];
  });
}

export function lastCommitTime(): string {
  return new Date(execFileSync("git", ["log", "-1", "--format=%cI"], { cwd: repository, encoding: "utf8" }).trim()).toISOString();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const sinceIndex = args.indexOf("--since");
  const since = sinceIndex >= 0 ? new Date(args[sinceIndex + 1] ?? "").toISOString() : lastCommitTime();
  const summary = summarizeCampaign({ reports: readCampaignReports(), runs: listRunManifests().map((run) => ({ runKey: run.runKey, classification: run.classification })), since });
  console.log(formatCampaignSummary(summary));
}
