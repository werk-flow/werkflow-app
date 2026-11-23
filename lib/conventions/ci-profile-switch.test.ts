// Rule test (Tier 2, decision 0011): one switch picks the CI profile. ci/profile.json on main names
// it and only `activeProfile` (lib/testing/ci/profiles.ts) reads it, from its own clone's fetched
// main: production code calls it without an argument. No other code reads the file, takes a
// profile from an environment variable, a flag or a path, reaches into the profiles by name, or
// calls `profileOnMainIn`, the seam that reads another clone's switch; test files may, since they
// build such clones. The rule reads each file whole, so a call or path split across lines counts.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const OWNER = 'lib/testing/ci/profiles.ts';
const SELF = 'lib/conventions/ci-profile-switch.test.ts';
/** The tests of the profiles, which read both by name. */
const PROFILE_TESTS = ['lib/testing/ci/profiles.test.ts', 'lib/testing/ci/profile-plans.test.ts'];
const isTest = (path: string): boolean => /\.test\.tsx?$/.test(path);

/** The ways around the switch, each matched across lines, and the files it is allowed in. */
const BYPASSES: readonly { rule: string; pattern: RegExp; allowed(path: string): boolean }[] = [
  {
    rule: 'reads ci/profile.json',
    pattern: /\bci\/profile\.json\b|['"`]ci['"`]\s*,\s*['"`]profile\.json['"`]/g,
    allowed: (path) => path === OWNER || isTest(path),
  },
  {
    rule: 'picks a profile by an environment variable or a flag',
    pattern: /\bCI_PROFILE\b|--ci-profile\b|\bWERKFLOW_CI_PROFILE\b/g,
    allowed: () => false,
  },
  {
    rule: 'passes activeProfile an argument',
    pattern: /\bactiveProfile\s*\(\s*[^)\s]/g,
    allowed: () => false,
  },
  {
    rule: "reads another clone's switch through the test seam",
    pattern: /\bprofileOnMainIn\b/g,
    allowed: (path) => path === OWNER || isTest(path),
  },
  {
    rule: 'reaches into the profiles by name',
    pattern: /\bCI_PROFILES\b/g,
    allowed: (path) => path === OWNER || PROFILE_TESTS.includes(path),
  },
];

const ROOTS = [
  'app',
  'components',
  'lib',
  'scripts',
  'tests',
  'eslint-rules',
  'ci',
  '.github',
  '.claude/hooks',
];
const CODE = /\.(?:ts|tsx|mjs|js|sh|ya?ml)$/;

function codeFiles(folder: string): string[] {
  const entries = readdirSync(join(repositoryRoot, folder), { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && CODE.test(entry.name))
    .map((entry) => relative(repositoryRoot, join(entry.parentPath, entry.name)).split(sep).join('/'));
}

/** Every place in `files` that goes around the switch, as `<file>:<line>: <rule>`. */
function bypasses(files: readonly { path: string; text: string }[]): string[] {
  return files.flatMap(({ path, text }) =>
    BYPASSES.filter(({ allowed }) => !allowed(path)).flatMap(({ rule, pattern }) =>
      [...text.matchAll(pattern)].map(
        (match) => `${path}:${text.slice(0, match.index).split('\n').length}: ${rule}`,
      ),
    ),
  );
}

test('only activeProfile reads the CI profile switch, and nothing picks a profile another way', () => {
  const files = ROOTS.flatMap(codeFiles)
    .filter((path) => path !== SELF)
    .map((path) => ({ path, text: readFileSync(join(repositoryRoot, path), 'utf8') }));
  expect(files.some((file) => file.path === OWNER)).toBe(true);
  expect(bypasses(files)).toEqual([]);
});

test('the rule sees each way around the switch, on one line or across several', () => {
  const caught = bypasses(
    [
      "readFileSync(join(root, 'ci/profile.json'), 'utf8')",
      "readFileSync(join(root, 'ci', 'profile.json'), 'utf8')",
      "readFileSync(\n  join(\n    root,\n    'ci',\n    'profile.json',\n  ),\n  'utf8',\n)",
      'const profile = process.env.CI_PROFILE ?? "local";',
      '  run: bun scripts/ci/run-commit.ts --ci-profile fleet',
      'const profile = activeProfile(process.env.RUNNER_REPO ?? undefined);',
      'const profile = activeProfile(\n  process.env.RUNNER_REPO,\n);',
      "const profile = profileOnMainIn(process.env.RUNNER_REPO ?? '.');",
      "import { CI_PROFILES } from '../../lib/testing/ci/profiles';",
    ].map((text, index) => ({ path: `scripts/ci/bypass-${index}.ts`, text })),
  );
  expect(caught).toEqual([
    'scripts/ci/bypass-0.ts:1: reads ci/profile.json',
    'scripts/ci/bypass-1.ts:1: reads ci/profile.json',
    'scripts/ci/bypass-2.ts:4: reads ci/profile.json',
    'scripts/ci/bypass-3.ts:1: picks a profile by an environment variable or a flag',
    'scripts/ci/bypass-4.ts:1: picks a profile by an environment variable or a flag',
    'scripts/ci/bypass-5.ts:1: passes activeProfile an argument',
    'scripts/ci/bypass-6.ts:1: passes activeProfile an argument',
    "scripts/ci/bypass-7.ts:1: reads another clone's switch through the test seam",
    'scripts/ci/bypass-8.ts:1: reaches into the profiles by name',
  ]);
  expect(
    bypasses([
      {
        path: 'scripts/ci/queue.ts',
        text: "import { activeProfile } from '../../lib/testing/ci/profiles';\nconst { maxBatch } = activeProfile();",
      },
      { path: 'scripts/ci/run-commit.ts', text: 'runCommitCommand({ profile: activeProfile });' },
      {
        path: 'lib/testing/ci/run-commit-cli.test.ts',
        text: "writeFileSync(join(origin, 'ci', 'profile.json'), '{}');\nprofile: () => profileOnMainIn(repository),",
      },
      {
        path: 'lib/export-profile/profile-report.ts',
        text: '// profile.md for people and profile.json for tools.',
      },
    ]),
  ).toEqual([]);
});
