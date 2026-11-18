// Rule test: a unit run fails when it leaves anything in its run-scoped TMPDIR.
import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describeLeftovers, withRunTemporaryFolder } from './run-temporary-folder';
import { temporaryDirectory } from '../temporary-directory';

const repositoryRoot = resolve(import.meta.dir, '../../..');

test('a run that leaves a folder in its TMPDIR fails and names it; the folder is removed either way', async () => {
  const outer = tmpdir();
  let runFolder = '';
  const result = await withRunTemporaryFolder(async () => {
    runFolder = tmpdir();
    mkdirSync(join(runFolder, 'boat-checkout-leak'));
    return 0;
  });
  expect(runFolder).not.toBe(outer);
  expect(result).toEqual({ exitCode: 1, leftovers: ['boat-checkout-leak'] });
  expect(describeLeftovers(result.leftovers)).toContain('boat-checkout-leak');
  expect(existsSync(runFolder)).toBe(false);
  expect(tmpdir()).toBe(outer);
});

test('a run whose folders were removed keeps its own exit code', async () => {
  const passed = await withRunTemporaryFolder(async () => {
    mkdirSync(join(tmpdir(), 'removed-in-finally'));
    rmSync(join(tmpdir(), 'removed-in-finally'), { recursive: true });
    return 0;
  });
  expect(passed).toEqual({ exitCode: 0, leftovers: [] });
  expect(await withRunTemporaryFolder(async () => 3)).toEqual({ exitCode: 3, leftovers: [] });
});

let madeInEarlierTest = '';
test('temporaryDirectory makes a fresh folder under TMPDIR', () => {
  madeInEarlierTest = temporaryDirectory('temporary-directory-');
  expect(madeInEarlierTest.startsWith(join(tmpdir(), 'temporary-directory-'))).toBe(true);
  expect(existsSync(madeInEarlierTest)).toBe(true);
});

test('the preload removed the folder after the test that made it', () => {
  expect(madeInEarlierTest).not.toBe('');
  expect(existsSync(madeInEarlierTest)).toBe(false);
});

test('the unit runner and the preload apply the temporary-folder rule', () => {
  const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');
  expect(read('scripts/run-unit-tests.ts')).toContain('withRunTemporaryFolder(');
  expect(read('scripts/unit-test-preload.ts')).toMatch(/^registerTemporaryDirectoryCleanup\(\);$/m);
});
