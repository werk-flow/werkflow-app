// Rule test (Tier 2, decision 0011): one switch picks the CI profile. ci/profile.json on main names
// it and only `activeProfile` (lib/testing/ci/profiles.ts) reads it. No other code reads the file,
// takes a profile from an environment variable or a flag, or reaches into the profiles by name; a
// profile's tests are the one exception, since they check both profiles.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '../..');
const OWNER = 'lib/testing/ci/profiles.ts';
const SELF = 'lib/conventions/ci-profile-switch.test.ts';
/** The tests of the profiles, which read both by name and write switches of their own. */
const PROFILE_TESTS = ['lib/testing/ci/profiles.test.ts', 'lib/testing/ci/profile-plans.test.ts'];

/** The ways around the switch: a read of the file, a variable or flag that names a profile, the profiles by name. */
const BYPASSES: readonly { rule: string; pattern: RegExp; allowed: readonly string[] }[] = [
  {
    rule: 'reads ci/profile.json',
    pattern: /\bci\/profile\.json\b|['"`]ci['"`]\s*,\s*['"`]profile\.json['"`]/,
    allowed: [OWNER, ...PROFILE_TESTS],
  },
  {
    rule: 'picks a profile by an environment variable or a flag',
    pattern: /\bCI_PROFILE\b|--ci-profile\b|\bWERKFLOW_CI_PROFILE\b/,
    allowed: [],
  },
  {
    rule: 'reaches into the profiles by name',
    pattern: /\bCI_PROFILES\b/,
    allowed: [OWNER, ...PROFILE_TESTS],
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

/** Every line of `files` that goes around the switch, as `<file>:<line>: <rule>`. */
function bypasses(files: readonly { path: string; text: string }[]): string[] {
  return files.flatMap(({ path, text }) =>
    text
      .split('\n')
      .flatMap((line, index) =>
        BYPASSES.filter(({ pattern, allowed }) => pattern.test(line) && !allowed.includes(path)).map(
          ({ rule }) => `${path}:${index + 1}: ${rule}`,
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

test('the rule sees each way around the switch', () => {
  const caught = bypasses(
    [
      "readFileSync(join(root, 'ci/profile.json'), 'utf8')",
      "readFileSync(join(root, 'ci', 'profile.json'), 'utf8')",
      'const profile = process.env.CI_PROFILE ?? "mac";',
      '  run: bun scripts/ci/run-commit.ts --ci-profile fleet',
      "import { CI_PROFILES } from '../../lib/testing/ci/profiles';",
    ].map((text, index) => ({ path: `scripts/ci/bypass-${index}.ts`, text })),
  );
  expect(caught).toHaveLength(5);
  expect(
    bypasses([
      { path: 'scripts/ci/queue.ts', text: "import { activeProfile } from '../../lib/testing/ci/profiles';" },
      {
        path: 'lib/export-profile/profile-report.ts',
        text: '// profile.md for people and profile.json for tools.',
      },
    ]),
  ).toEqual([]);
});
