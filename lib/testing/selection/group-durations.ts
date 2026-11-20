import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * The recorded seconds each browser group and component area takes, which the CI plan packs shards
 * by (ci-plan.ts). They decide only where a group runs, never whether it runs, so a stale value
 * costs wall clock and no coverage. `bun scripts/refresh-group-durations.ts` rewrites the file from
 * verification reports.
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
