import { resolve } from 'node:path';
import { migrationOrderProblems } from '../lib/testing/local-stack/migration-order';
import { CHANGED_CHECK_BASE } from '../lib/testing/runner/changed-check';

// `bun run migrations:order`: static gate static:migration-order, also a step of `check:changed`.
const problems = migrationOrderProblems({
  repositoryRoot: resolve(import.meta.dir, '..'),
  mainRef: CHANGED_CHECK_BASE,
  now: new Date(),
});
for (const problem of problems) console.error(problem);
if (!problems.length)
  console.info(`[migrations:order] Every added migration sorts after ${CHANGED_CHECK_BASE}.`);
process.exitCode = problems.length ? 1 : 0;
