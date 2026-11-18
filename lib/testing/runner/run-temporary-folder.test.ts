// Rule test: a unit run fails when it leaves anything in its run-scoped TMPDIR.
import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { withRunTemporaryFolder } from './run-temporary-folder';
import { temporaryDirectory } from '../temporary-directory';

const repositoryRoot = resolve(import.meta.dir, '../../..');

test('withRunTemporaryFolder fails a run that leaves an entry, restores TMPDIR and removes its folder', async () => {
  const outer = tmpdir();
  let runFolder = '';
  const result = await withRunTemporaryFolder(async () => {
    runFolder = tmpdir();
    mkdirSync(join(runFolder, 'boat-checkout-leak'));
    return 0;
  });
  expect(runFolder).not.toBe(outer);
  expect(result).toEqual({ exitCode: 1, leftovers: ['boat-checkout-leak'] });
  expect(existsSync(runFolder)).toBe(false);
  expect(tmpdir()).toBe(outer);
});

test('withRunTemporaryFolder keeps the exit code of a run that removed its folders', async () => {
  const passed = await withRunTemporaryFolder(async () => {
    mkdirSync(join(tmpdir(), 'removed-in-finally'));
    rmSync(join(tmpdir(), 'removed-in-finally'), { recursive: true });
    return 0;
  });
  expect(passed).toEqual({ exitCode: 0, leftovers: [] });
  expect(await withRunTemporaryFolder(async () => 3)).toEqual({ exitCode: 3, leftovers: [] });
});

// The real runner on a probe file: folders from temporaryDirectory, in a test and at module scope,
// are removed; a raw mkdtempSync is named and fails the run.
test('the unit runner removes temporaryDirectory folders and fails on a raw mkdtempSync, naming it', async () => {
  const probe = join(temporaryDirectory('temporary-probe-'), 'leak.test.ts');
  const helper = resolve(repositoryRoot, 'lib/testing/temporary-directory.ts');
  writeFileSync(
    probe,
    [
      "import { test } from 'bun:test';",
      "import { mkdtempSync } from 'node:fs';",
      "import { tmpdir } from 'node:os';",
      "import { join } from 'node:path';",
      `import { temporaryDirectory } from ${JSON.stringify(helper)};`,
      "temporaryDirectory('kept-for-the-run-');",
      "test('makes folders', () => {",
      "  temporaryDirectory('kept-for-the-test-');",
      "  mkdtempSync(join(tmpdir(), 'raw-leak-'));",
      '});',
      '',
    ].join('\n'),
  );
  const child = Bun.spawn([process.execPath, 'scripts/run-unit-tests.ts', probe], {
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(code).toBe(1);
  expect(errors).toMatch(/\[unit-tmp\] The run left these in its TMPDIR: raw-leak-\w+\./);
  expect(errors).not.toContain('kept-for-the-');
});
