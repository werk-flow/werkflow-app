import { isRunId } from '../../lib/testing/staging/runs';
import { cleanUp, loadKit } from './kit';

// `bun run staging:cleanup` removes every staging journey run older than a day from DEV;
// `-- --run <run id>` removes that run now (.claude/skills/staging-journey/SKILL.md). Each run's
// organizations and account go through the app's own deletion paths.

const [flag, runId] = process.argv.slice(2);
if (flag !== undefined && (flag !== '--run' || runId === undefined || !isRunId(runId))) {
  console.error('[staging] Usage: bun run staging:cleanup [-- --run <run id>]');
  process.exit(2);
}
process.exitCode = (await cleanUp(loadKit(), runId ?? null)) ? 0 : 1;
