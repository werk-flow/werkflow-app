import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { readLedger } from '../lib/testing/ci/results';
import { groupResultSchema } from '../lib/testing/evidence/group-evidence';
import {
  GROUP_DURATIONS_FILE,
  ledgerGroupResults,
  readGroupDurations,
  refreshGroupDurations,
} from '../lib/testing/selection/group-durations';
import { getTestGroups } from '../lib/testing/selection/test-groups';

// Rewrites lib/testing/selection/group-durations.json from CI runs: each browser group and component
// area takes the median of its passed results in them. Commit the file through a pull request.
// Usage: bun scripts/refresh-group-durations.ts --ledger <CI_LEDGER file> [--last <n>] [--source "<which runs>"]
//        bun scripts/refresh-group-durations.ts --source "<which runs>" <report.json>...
//   --ledger  A CI runner's ledger (scripts/ci/job.ts): the shards of its newest full runs, so the
//             durations are that runner's own. --last takes that many full runs, default 5, the
//             number the committed durations were first taken from.
//   <report.json>  Verification reports of CI runs, with --source naming them.
const repository = resolve(import.meta.dir, '..');
const usage =
  'Usage: bun scripts/refresh-group-durations.ts --ledger <file> [--last <n>] [--source "<which runs>"]\n' +
  '       bun scripts/refresh-group-durations.ts --source "<which runs>" <report.json>...';
const { values, positionals: reports } = parseArgs({
  allowPositionals: true,
  options: { source: { type: 'string' }, ledger: { type: 'string' }, last: { type: 'string', default: '5' } },
});
const last = Number(values.last);
if (!Number.isInteger(last) || last < 1 || Boolean(values.ledger) === reports.length > 0)
  throw new Error(usage);

type Result = { groupId: string; status: string; durationMs: number };

function fromLedger(path: string): { results: Result[]; source: string } {
  const ledger = readLedger(resolve(path));
  if ('unreadable' in ledger) throw new Error(ledger.unreadable);
  const { results, runs, dates } = ledgerGroupResults(ledger, last);
  if (!runs.length) throw new Error(`${path} holds no completed full run shard of a CI runner.`);
  return {
    results,
    source:
      values.source ??
      `The median of the browser and component shards of the ${runs.length} newest full runs in a CI runner's ledger (${dates[0]} to ${dates.at(-1)}): ${runs.join(', ')}.`,
  };
}

const reportSchema = z.object({ results: z.array(groupResultSchema) });
const { results, source }: { results: Result[]; source: string } = values.ledger
  ? fromLedger(values.ledger)
  : {
      results: reports.flatMap(
        (path) => reportSchema.parse(JSON.parse(readFileSync(resolve(path), 'utf8'))).results,
      ),
      source: values.source ?? '',
    };
if (!source) throw new Error(usage);
const registered = getTestGroups(repository)
  .filter((group) => ['golden', 'audit', 'ui'].includes(group.kind))
  .map((group) => group.id);
const refreshed = refreshGroupDurations({
  current: readGroupDurations(repository),
  results,
  registered,
  source,
});
writeFileSync(resolve(repository, GROUP_DURATIONS_FILE), `${JSON.stringify(refreshed, null, 2)}\n`);
console.info(
  `[durations] ${Object.keys(refreshed.groups).length} groups from ${results.length} results; default ${refreshed.defaultSeconds} s.`,
);
