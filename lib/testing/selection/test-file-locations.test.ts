// Rule test: a file named like a test sits where a runner executes it; a unit test outside lib/ never runs.
import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// bunfig.toml roots Bun's test discovery at lib/, and group unit:all
// (test-groups.ts) lists lib/**/*.test.{ts,tsx,mjs}. Playwright and
// tests/ui-contracts/run.ts read tests/**/*.spec.ts, and the group inventory of
// `bun run test:coverage` checks that each spec belongs to a group. A file named
// like a test anywhere else runs under no runner and passes by never failing.
// A new runner (for example Deno tests under supabase/functions) adds its row
// here together with the group that executes it.
const TEST_NAME = /[._](?:test|spec)\.[cm]?[jt]sx?$/;
const RUNNER_LOCATIONS: ReadonlyArray<{ pattern: RegExp; runner: string }> = [
  { pattern: /^lib\/.+\.test\.(?:ts|tsx|mjs)$/, runner: 'bun run test:unit, group unit:all' },
  {
    pattern: /^tests\/.+\.spec\.ts$/,
    runner: 'Playwright and tests/ui-contracts/run.ts, groups in test-groups.ts',
  },
];

/** The paths named like a test that no runner executes where they are. */
function misplacedTestFiles(paths: readonly string[]): string[] {
  return paths.filter(
    (path) => TEST_NAME.test(path) && !RUNNER_LOCATIONS.some((location) => location.pattern.test(path)),
  );
}

function listRepositoryFiles(): string[] {
  const listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: resolve(import.meta.dir, '../../..'),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return listed.split('\0').filter(Boolean);
}

describe('test files sit where a runner executes them', () => {
  test('no test-named file lies outside the runner locations', () => {
    expect(
      misplacedTestFiles(listRepositoryFiles()),
      `Move a unit test to lib/**/*.test.{ts,tsx,mjs} and a browser spec to tests/**/*.spec.ts. Runners: ${RUNNER_LOCATIONS.map((location) => location.runner).join('; ')}.`,
    ).toEqual([]);
  });

  test('probe: planted paths outside the runner locations are found, runner paths and support files are not', () => {
    expect(
      misplacedTestFiles([
        'app/jobs/actions.test.ts',
        'components/ui/button.test.tsx',
        'scripts/verify.test.ts',
        'tests/golden/support/world.test.ts',
        'supabase/functions/send-invite-email/index_test.ts',
        'lib/jobs/actions.test.js',
        'lib/jobs/actions.spec.ts',
        'app/page.spec.tsx',
        'lib/jobs/actions.test.ts',
        'lib/ui/contracts.test.mjs',
        'lib/ui/button.test.tsx',
        'tests/golden/p1-01.spec.ts',
        'tests/ui-contracts/request-list.spec.ts',
        'lib/testing/spec-support/expect-defined.ts',
        'tests/golden/support/steps/test-data.ts',
      ]),
    ).toEqual([
      'app/jobs/actions.test.ts',
      'components/ui/button.test.tsx',
      'scripts/verify.test.ts',
      'tests/golden/support/world.test.ts',
      'supabase/functions/send-invite-email/index_test.ts',
      'lib/jobs/actions.test.js',
      'lib/jobs/actions.spec.ts',
      'app/page.spec.tsx',
    ]);
  });
});
