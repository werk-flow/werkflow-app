import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  formatCampaignSummary,
  summarizeCampaign,
  type CampaignReport,
} from '../lib/testing/evidence/campaign-summary';
import { readGroupDiagnoses } from '../lib/testing/evidence/group-diagnosis';
import { groupAttemptKey } from '../lib/testing/evidence/group-evidence';
import { listRunManifests } from '../tests/golden/support/run-state';

/**
 * `bun run test:campaign [--since <ISO time>]`: the verification cost since the
 * last commit (or the given time), from the reports under .agent-logs/verification.
 */
const repository = resolve(import.meta.dir, '..');
const archive = resolve(repository, '.agent-logs/verification');
const reportSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  status: z.enum(['running', 'passed', 'failed']),
  results: z.array(
    z.object({
      groupId: z.string(),
      status: z.enum(['passed', 'failed', 'blocked']),
      startedAt: z.string(),
      runKey: z.string().nullable(),
      reason: z.string().nullable().default(null),
    }),
  ),
});

export function readCampaignReports(): CampaignReport[] {
  if (!existsSync(archive)) return [];
  return readdirSync(archive)
    .sort()
    .flatMap((directory) => {
      const file = resolve(archive, directory, 'report.json');
      if (!existsSync(file)) return [];
      return [reportSchema.parse(JSON.parse(readFileSync(file, 'utf8')))];
    });
}

export function lastCommitTime(): string {
  return new Date(
    execFileSync('git', ['log', '-1', '--format=%cI'], { cwd: repository, encoding: 'utf8' }).trim(),
  ).toISOString();
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const sinceIndex = args.indexOf('--since');
  const suppliedSince = args[sinceIndex + 1];
  if (sinceIndex >= 0 && (!suppliedSince || !Number.isFinite(Date.parse(suppliedSince)))) {
    console.error('Usage: bun run test:campaign [--since <valid ISO timestamp>]');
    process.exit(1);
  }
  const since = sinceIndex >= 0 && suppliedSince ? new Date(suppliedSince).toISOString() : lastCommitTime();
  const summary = summarizeCampaign({
    reports: readCampaignReports(),
    runs: [
      ...listRunManifests().map((run) => ({ runKey: run.runKey, classification: run.classification })),
      // A diagnosed attempt of a group without a browser run counts under its class as well.
      ...readGroupDiagnoses(archive).map((diagnosis) => ({
        runKey: groupAttemptKey(diagnosis),
        classification: diagnosis.classification,
      })),
    ],
    since,
  });
  console.log(formatCampaignSummary(summary));
}
