import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { CiResult } from '../ci/results';

/**
 * The recorded seconds each browser group and component area takes, which the CI plan packs shards
 * by (ci-plan.ts). They decide only where a group runs, never whether it runs, so a stale value
 * costs wall clock and no coverage. `bun scripts/refresh-group-durations.ts` rewrites the file from a
 * CI runner's ledger or from verification reports.
 */
export const GROUP_DURATIONS_FILE = 'lib/testing/selection/group-durations.json';

const groupDurationsSchema = z.object({
  /** The runs the seconds come from. */
  source: z.string().min(1),
  /** The seconds of a group the file does not hold yet: the upper quartile of the recorded ones. */
  defaultSeconds: z.number().positive(),
  groups: z.record(z.string(), z.number().nonnegative()),
});
export type GroupDurations = z.infer<typeof groupDurationsSchema>;

/** The committed durations; a missing or malformed file fails the plan. */
export function readGroupDurations(repositoryRoot: string): GroupDurations {
  return groupDurationsSchema.parse(
    JSON.parse(readFileSync(resolve(repositoryRoot, GROUP_DURATIONS_FILE), 'utf8')),
  );
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
};

/**
 * The group results of the newest `last` ended full runs in a CI runner's ledger: what each browser
 * and component shard reported on that runner's machines. A run counts once its final Check ended,
 * and each shard once, by its newest completed receipt, so a rerun adds no second sample. Only a
 * CI runner's receipts count, and only a passed group's seconds reach the durations
 * (`refreshGroupDurations`).
 */
export function ledgerGroupResults(
  ledger: readonly CiResult[],
  last: number,
): { results: { groupId: string; status: string; durationMs: number }[]; runs: string[]; dates: string[] } {
  const full = ledger.filter(
    (receipt) =>
      receipt.event === 'full' &&
      receipt.producer !== null &&
      receipt.runUrl !== null &&
      receipt.completedAt !== null,
  );
  const ended = new Map<string, string>();
  for (const receipt of full)
    if (receipt.job === 'check' && receipt.runUrl) ended.set(receipt.runUrl, receipt.startedAt);
  const runs = [...ended]
    .toSorted(([, left], [, right]) => left.localeCompare(right))
    .slice(-last)
    .map(([runUrl]) => runUrl);
  const newest = new Map<string, CiResult>();
  for (const receipt of full) {
    if (receipt.job !== 'browser' && receipt.job !== 'components') continue;
    if (!receipt.runUrl || !runs.includes(receipt.runUrl)) continue;
    const key = `${receipt.runUrl} ${receipt.job} ${receipt.shard}`;
    const known = newest.get(key);
    if (!known || known.startedAt <= receipt.startedAt) newest.set(key, receipt);
  }
  return {
    results: [...newest.values()].flatMap((receipt) =>
      receipt.groups.map((group) => ({
        groupId: group.id,
        status: group.outcome,
        durationMs: group.durationMs,
      })),
    ),
    runs,
    dates: runs.flatMap((runUrl) => ended.get(runUrl)?.slice(0, 10) ?? []),
  };
}

/**
 * The durations after `results`: each registered group takes the median of its passed results, or
 * keeps its recorded seconds; a group no longer registered drops out. A failed or blocked result
 * can stop early, so it never counts.
 */
export function refreshGroupDurations(input: {
  current: GroupDurations;
  results: readonly { groupId: string; status: string; durationMs: number }[];
  registered: readonly string[];
  source: string;
}): GroupDurations {
  const groups: Record<string, number> = {};
  for (const id of [...input.registered].sort()) {
    const passed = input.results
      .filter((result) => result.groupId === id && result.status === 'passed')
      .map((result) => result.durationMs / 1000);
    const seconds = passed.length ? Math.round(median(passed)) : input.current.groups[id];
    if (seconds !== undefined) groups[id] = seconds;
  }
  const recorded = Object.values(groups).sort((left, right) => left - right);
  const upperQuartile = recorded[Math.floor((recorded.length - 1) * 0.75)];
  return {
    source: input.source,
    defaultSeconds: upperQuartile && upperQuartile > 0 ? upperQuartile : input.current.defaultSeconds,
    groups,
  };
}
