// Rule test: browser tests run without the app's service worker, except the offline-shell audit.
//
// A live service worker made Chromium drop a browser context at teardown on CI runners: the
// role page's context.close() failed with "Target page, context or browser has been closed"
// although the test's own steps passed (werk-flow/werkflow-planning#356). Every Playwright config
// blocks service workers in its `use` block, and the runner applies that to every context a
// fixture creates with browser.newContext(). Only the spec that tests the worker opts back in.
import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const CONFIGS = ['playwright.config.ts', 'playwright.audit.config.ts', 'playwright.canary.config.ts'];
/** The one spec that tests the service worker itself. */
const OFFLINE_SHELL_SPEC = 'tests/audit/security/offline-shell.spec.ts';

function sourceFiles(directory: string): string[] {
  return readdirSync(join(ROOT, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => relative(ROOT, join(entry.parentPath, entry.name)));
}

describe('browser tests and the service worker', () => {
  test.each(CONFIGS)('%s blocks service workers for every context', (config) => {
    expect(readFileSync(join(ROOT, config), 'utf8')).toMatch(/\n {4}serviceWorkers: 'block',\n/);
  });

  test('only the offline-shell audit lets the service worker run', () => {
    const optIns = sourceFiles('tests').filter((file) =>
      /serviceWorkers:\s*'allow'/.test(readFileSync(join(ROOT, file), 'utf8')),
    );
    expect(optIns).toEqual([OFFLINE_SHELL_SPEC]);
  });
});
