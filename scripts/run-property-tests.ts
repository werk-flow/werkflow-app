import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROPERTY_RUNS_VARIABLE, PROPERTY_SEED_VARIABLE } from '../lib/testing/property-runs';

// `bun run test:properties`: every property test on a fresh seed with many more inputs than the
// pinned run of the Fast tier, to find counterexamples before they reach a pull request
// (docs/technical/testing.md, "Property tests"). The preload prints the seed; a failure names it
// with its counterexample. It runs through the unit runner, inside the workspace lock.
const RANDOM_RUNS = '2000';
const repositoryRoot = resolve(import.meta.dir, '..');
const propertyTests = readdirSync(resolve(repositoryRoot, 'lib'), { recursive: true, encoding: 'utf8' })
  .map((name) => `./lib/${name.split('\\').join('/')}`)
  .filter((file) => file.endsWith('.property.test.ts'))
  .sort();
const run = spawnSync(
  process.execPath,
  ['scripts/run-unit-tests.ts', ...propertyTests, ...process.argv.slice(2)],
  {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      [PROPERTY_SEED_VARIABLE]: process.env[PROPERTY_SEED_VARIABLE] ?? 'random',
      [PROPERTY_RUNS_VARIABLE]: process.env[PROPERTY_RUNS_VARIABLE] ?? RANDOM_RUNS,
    },
  },
);
process.exitCode = run.status ?? 1;
