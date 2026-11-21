import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { groupResultSchema } from '../lib/testing/evidence/group-evidence';
import {
  GROUP_DURATIONS_FILE,
  readGroupDurations,
  refreshGroupDurations,
} from '../lib/testing/selection/group-durations';
import { getTestGroups } from '../lib/testing/selection/test-groups';

// Rewrites lib/testing/selection/group-durations.json from the verification reports of CI runs:
// each browser group and component area takes the median of its passed results in them.
// Usage: bun scripts/refresh-group-durations.ts --source "<which runs>" <report.json>...
const repository = resolve(import.meta.dir, '..');
const [flag, source, ...reports] = process.argv.slice(2);
if (flag !== '--source' || !source || !reports.length)
  throw new Error('Usage: bun scripts/refresh-group-durations.ts --source "<which runs>" <report.json>...');

const reportSchema = z.object({ results: z.array(groupResultSchema) });
const results = reports.flatMap(
  (path) => reportSchema.parse(JSON.parse(readFileSync(resolve(path), 'utf8'))).results,
);
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
  `[durations] ${Object.keys(refreshed.groups).length} groups from ${results.length} results in ${reports.length} reports; default ${refreshed.defaultSeconds} s.`,
);
