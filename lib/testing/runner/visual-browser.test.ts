import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { selectsVisualBrowser, visualBrowserImage } from './visual-browser';

const repositoryRoot = resolve(import.meta.dir, '../../..');

test('visual captures render in the official image of the installed Playwright version', () => {
  const installed = readFileSync(
    resolve(repositoryRoot, 'node_modules/playwright-core/package.json'),
    'utf8',
  );
  expect(installed).toContain(
    `"version": "${visualBrowserImage(repositoryRoot).split(':v')[1]?.replace('-noble', '')}"`,
  );
  expect(visualBrowserImage(repositoryRoot)).toMatch(
    /^mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble$/,
  );
});

test('only a run of visual specs uses the image, and a mixed run is refused', () => {
  expect(selectsVisualBrowser(['tests/audit/visual/references.spec.ts'])).toBe(true);
  expect(
    selectsVisualBrowser(['tests/audit/visual/references.spec.ts', 'tests/audit/visual/acceptance.spec.ts']),
  ).toBe(true);
  expect(selectsVisualBrowser(['tests/audit/wave-1/a1-zeiten.spec.ts'])).toBe(false);
  expect(() =>
    selectsVisualBrowser(['tests/audit/visual/references.spec.ts', 'tests/audit/wave-1/a1-zeiten.spec.ts']),
  ).toThrow('Select them in separate runs');
});
