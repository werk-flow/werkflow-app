// Rule test: a whole-repository tsc, a broad type-aware eslint and `next build` run only inside a
// heavy slot (lib/testing/runner/heavy-slot.ts) or on Boat; a direct run is refused with the sanctioned command.
import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { BROAD_LINT_FILES, heavyCommandRefusal, lintedFileCount } from './heavy-command';

const repositoryRoot = resolve(import.meta.dir, '../../..');
const refusal = (command: string) => heavyCommandRefusal(command, repositoryRoot);

test('a whole-repository type check is refused through every launcher, prefix and chain', () => {
  const passed = [
    'tsc --noEmit',
    'tsc',
    'tsc --noEmit -p tsconfig.json',
    'tsc --noEmit -p .',
    `tsc -p ${repositoryRoot}/tsconfig.json`,
    `tsc --project=${repositoryRoot}`,
    'tsc --build',
    'tsc --explainFiles --noEmit',
    'tsgo --noEmit',
    'bunx tsc --noEmit',
    'bunx --bun tsc --noEmit',
    'bun x tsc --noEmit',
    'bun run tsc --noEmit',
    'npx tsc --noEmit',
    'npx -y tsc --noEmit',
    'pnpm exec tsc --noEmit',
    './node_modules/.bin/tsc --noEmit',
    `${repositoryRoot}/node_modules/.bin/tsc --noEmit`,
    'node node_modules/typescript/bin/tsc --noEmit',
    'node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit',
    'node node_modules/typescript7/bin/tsc --noEmit --incremental false',
    'NODE_OPTIONS=--max-old-space-size=8192 tsc --noEmit',
    'env NODE_OPTIONS=--max-old-space-size=8192 npx tsc -p .',
    'timeout 600 bunx tsc --noEmit',
    'timeout -k 10 600 tsc --noEmit',
    'nice -n 10 tsc --noEmit',
    'time tsc --noEmit',
    'git status && tsc --noEmit',
    'bun install; tsc --noEmit 2>&1 | tail -20',
    'git diff --stat || bunx tsc --noEmit > /dev/null',
    '(cd lib && cd .. && tsc --noEmit)',
    // TypeScript finds the root tsconfig.json from a subfolder.
    'cd lib/testing && tsc --noEmit',
    `cd ${repositoryRoot} && bunx tsc --noEmit`,
    // A subshell's cd does not reach the commands after it.
    '(cd /home && pwd); tsc --noEmit',
    'bash -lc "tsc --noEmit"',
    "sh -c 'bunx tsc --noEmit | head'",
    'echo "$(tsc --noEmit)"',
  ].filter((command) => !refusal(command)?.includes('bun run typecheck'));
  expect(passed).toEqual([]);
});

test('a type-aware lint of more files than the line is refused; the measured whole-repository forms among them', () => {
  const passed = [
    'eslint',
    'eslint .',
    'eslint ./',
    'bunx eslint .',
    'npx eslint --max-warnings 0 lib',
    './node_modules/.bin/eslint components',
    'node node_modules/eslint/bin/eslint.js .',
    'CI=1 eslint lib tests scripts',
    'eslint --max-warnings 0 lib tests scripts playwright*.config.ts',
    'eslint --no-warn-ignored --rule {} lib tests scripts playwright*.config.ts -f unix',
    'eslint lib tests scripts playwright*.config.ts -f json -o ~/scratch/hyg.json',
    'eslint components/auftraege lib',
    'git diff --name-only && eslint . --cache',
    'bash -c "eslint ."',
    // eslint expands braces and `**`, which a git pathspec does not.
    'eslint "lib/**/*.{ts,tsx}"',
    "bunx eslint './components/**/*.tsx'",
    'cd components && eslint .',
    'cd lib && eslint "../components/**/*.tsx"',
    `eslint "${repositoryRoot}/components/**/*.tsx"`,
  ].filter((command) => !refusal(command)?.includes('bun run test:verify --group static:lint'));
  expect(passed).toEqual([]);
  expect(lintedFileCount(['components'], repositoryRoot)).toBeGreaterThan(BROAD_LINT_FILES);
  expect(heavyCommandRefusal('tsc --noEmit', resolve(repositoryRoot, 'lib'))).toContain('bun run typecheck');
});

test('a direct Next build is refused, with the recorded build in its place', () => {
  const passed = [
    'next build',
    'bunx next build',
    'npx next build --debug',
    'bun run next build',
    'node node_modules/next/dist/bin/next build',
    'NODE_ENV=production next build',
    'rm -rf /home/x/.next && next build',
  ].filter((command) => !refusal(command)?.includes('bun run test:server'));
  expect(passed).toEqual([]);
});

test('the package scripts, check:changed, test:verify and the heavy wrapper take a slot and pass', () => {
  const refused = [
    'bun run typecheck',
    'bun run lint',
    'bun run lint components/ui/button.tsx',
    'bun run build',
    'bun run check:changed',
    'bun run test:verify --group static:typecheck,static:lint',
    'bun run test:server local',
    'npm run typecheck',
    'bun scripts/heavy.ts -- tsc --noEmit',
    'bun scripts/heavy.ts -- node node_modules/typescript/bin/tsc --explainFiles',
    'bun scripts/heavy.ts -- bash -c "eslint ."',
    'bun scripts/lint.ts lib',
  ].filter((command) => refusal(command) !== undefined);
  expect(refused).toEqual([]);
});

test('targeted runs, information flags and mentions as data pass', () => {
  const refused = [
    // The targeted lints agents ran most often (werk-flow/werkflow-planning#94).
    'eslint lib/testing/runner/heavy-slot.ts',
    'eslint --max-warnings 0 --no-warn-ignored components/ui/button.tsx lib/security/shell-words.ts',
    'bunx eslint lib/testing/runner',
    'eslint "lib/testing/runner/heavy-*.{ts,tsx}"',
    'cd lib/testing/runner && eslint .',
    'eslint $(git diff --name-only | grep -E "\\.(ts|tsx)$")',
    'eslint --version',
    'tsc --version',
    'bunx tsc --showConfig',
    'tsc --help',
    'tsc -p ~/scratch/drift-b47/tsconfig.json',
    'tsc --noEmit lib/time.ts',
    'next dev',
    'grep -rn "tsc --noEmit" docs',
    'rg "next build" scripts',
    'echo "eslint . would be refused"',
    'git commit -m "tsc --noEmit is refused"',
    "cat > note.md <<'EOF'\ntsc --noEmit\nnext build\nEOF",
  ].filter((command) => refusal(command) !== undefined);
  expect(refused).toEqual([]);
});

test('outside a WerkFlow checkout a plain tsc and eslint pass', () => {
  const folder = mkdtempSync(join(tmpdir(), 'werkflow-heavy-command-'));
  try {
    expect(heavyCommandRefusal('tsc --noEmit', folder)).toBeUndefined();
    expect(heavyCommandRefusal('eslint .', folder)).toBeUndefined();
    expect(refusal(`cd ${folder} && tsc --noEmit`)).toBeUndefined();
    expect(refusal(`bash -c "cd ${folder} && tsc --noEmit"`)).toBeUndefined();
    // Inside a nested shell, its cd stays there.
    expect(refusal(`bash -c "cd ${folder}" && tsc --noEmit`)).toContain('bun run typecheck');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('the hook refuses with exit 2 and the reason, and passes a sanctioned call', () => {
  const run = (command: string) =>
    spawnSync(process.execPath, [resolve(repositoryRoot, '.claude/hooks/refuse-heavy-commands.ts')], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: repositoryRoot }),
      encoding: 'utf8',
    });
  const refused = run('bunx tsc --noEmit');
  expect(refused.status).toBe(2);
  expect(refused.stderr).toContain('bun run typecheck');
  expect(run('bun run typecheck').status).toBe(0);
});

// The guard lets the package scripts through because they take a slot themselves.
test('bun run typecheck, lint and build take a heavy slot', () => {
  const scripts = z
    .object({ scripts: z.record(z.string(), z.string()) })
    .parse(JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'))).scripts;
  expect(scripts.typecheck).toStartWith('bun scripts/heavy.ts -- ');
  expect(scripts.lint).toBe('bun scripts/lint.ts');
  expect(scripts.build).toBe('bun scripts/build.ts');
  expect(readFileSync(resolve(repositoryRoot, 'scripts/build.ts'), 'utf8')).toContain(
    'await acquireHeavySlot(',
  );
  expect(readFileSync(resolve(repositoryRoot, 'scripts/lint.ts'), 'utf8')).toContain('runInHeavySlot(');
});
