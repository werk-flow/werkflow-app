// Rule test: a package script that builds, runs tests or changes the local stack takes the workspace lock, and the hosted build stays plain.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../../..');

/** A raw command that replaces `.next`, runs tests or changes the shared local stack. */
const RAW_SHARED_STATE_COMMAND =
  /(?:^|[;&|(]\s*|\b(?:bunx|npx)\s+)(?:next\s+build|bun\s+test|playwright\s+test|supabase\s+(?:db\s+reset|stop))\b/;

/** Package scripts whose runner file must hold the workspace lock for its whole lifetime. */
const LOCKED_SCRIPTS: readonly string[] = [
  'build',
  'test:server',
  'test:unit',
  'test:ui',
  'test:verify',
  'test:golden:focused',
  'test:audit:focused',
  'test:canary:focused',
  'test:diagnostic',
  'test:diagnostic:audit',
];

function lockFindings(
  scripts: Record<string, string>,
  readRepositoryFile: (path: string) => string,
): string[] {
  const findings = Object.entries(scripts).flatMap(([name, command]) =>
    RAW_SHARED_STATE_COMMAND.test(command)
      ? [
          `"${name}" runs "${command}" without the workspace lock. Call it from a script under scripts/ that wraps it in withWorkspaceTestLock.`,
        ]
      : [],
  );
  for (const name of LOCKED_SCRIPTS) {
    const file = /^bun\s+(\S+\.ts)\b/.exec(scripts[name] ?? '')?.[1];
    if (!file) findings.push(`"${name}" must run a Bun script that takes the workspace lock.`);
    else if (!readRepositoryFile(file).includes('withWorkspaceTestLock'))
      findings.push(`"${name}" runs ${file}, which does not call withWorkspaceTestLock.`);
  }
  return findings;
}

const readRepositoryFile = (path: string): string => readFileSync(resolve(repositoryRoot, path), 'utf8');
const packageScripts = (JSON.parse(readRepositoryFile('package.json')) as { scripts: Record<string, string> })
  .scripts;

test('every package script that builds, tests or resets goes through the workspace lock', () => {
  expect(lockFindings(packageScripts, readRepositoryFile)).toEqual([]);
});

test('a planted raw command or an unlocked runner is named with the way out', () => {
  const planted = lockFindings(
    {
      ...packageScripts,
      build: 'next build',
      'db:reset': 'supabase db reset',
      'test:unit': 'bun scripts/x.ts',
    },
    (path) => (path === 'scripts/x.ts' ? 'await run();' : readRepositoryFile(path)),
  );
  expect(planted).toEqual([
    '"build" runs "next build" without the workspace lock. Call it from a script under scripts/ that wraps it in withWorkspaceTestLock.',
    '"db:reset" runs "supabase db reset" without the workspace lock. Call it from a script under scripts/ that wraps it in withWorkspaceTestLock.',
    '"build" must run a Bun script that takes the workspace lock.',
    '"test:unit" runs scripts/x.ts, which does not call withWorkspaceTestLock.',
  ]);
});

test('the hosted build stays plain next build, outside the local build receipt and lock', () => {
  const vercel = JSON.parse(readRepositoryFile('vercel.json')) as { buildCommand?: unknown };
  expect(vercel.buildCommand).toBe('next build');
});

test('every bun test process loads the shared hang guard', () => {
  expect(readRepositoryFile('bunfig.toml')).toContain('preload = ["./scripts/unit-test-preload.ts"]');
  expect(readRepositoryFile('scripts/unit-test-preload.ts')).toMatch(
    /^setDefaultTimeout\(UNIT_TEST_TIMEOUT_MS\);$/m,
  );
  // The preload bounds only the first file of a run in Bun 1.3.14; the flag bounds every file.
  expect(readRepositoryFile('scripts/run-unit-tests.ts')).toContain(
    "'--timeout',\n      String(UNIT_TEST_TIMEOUT_MS)",
  );
});
