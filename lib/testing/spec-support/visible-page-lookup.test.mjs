// Rule test: a whole-page lookup in a browser test finds only what is shown, and the ratchet of unswept support modules only shrinks.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import typescriptParser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import { createProbeLinter } from '../../../eslint-rules/probe-linter.mjs';
import { visiblePageLookupRule } from '../../../eslint-rules/visible-page-lookup.mjs';

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const RULE = 'playwright-spec/visible-page-lookup';
const RATCHET_FILE = 'eslint-rules/visible-page-lookup-ratchet.json';

const linter = new Linter();

/** The rule's reports for one source: the looked-up method of each. */
function reportedLookups(source) {
  const messages = linter.verify(source, [
    {
      languageOptions: {
        parser: typescriptParser,
        parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      },
      plugins: { 'playwright-spec': { rules: { 'visible-page-lookup': visiblePageLookupRule } } },
      rules: { [RULE]: 'error' },
    },
  ]);
  // A source that does not parse would count as holding no lookup.
  expect(messages.filter((message) => message.fatal)).toEqual([]);
  // A real module also disables rules this probe does not load; only this rule's reports count.
  return messages
    .filter((message) => message.ruleId === RULE)
    .map((message) => /^page\.(\w+)/.exec(message.message)?.[1]);
}

/** One step helper around a lookup expression on `page`. */
function helper(lookup) {
  return `
    import type { Locator, Page } from '@playwright/test';
    export function located(page: Page, row: Locator): Locator {
      return ${lookup};
    }
  `;
}

/** How a ratchet differs from the counts the code holds; `undefined` is a file that is gone. */
function ratchetProblems(ratchet, countOf) {
  return Object.entries(ratchet).flatMap(([file, recorded]) => {
    const found = countOf(file);
    if (found === undefined) return [`${file}: listed but gone; remove the entry.`];
    if (found === recorded) return [];
    if (found === 0) return [`${file}: no whole-page lookup left; remove the entry.`];
    return found > recorded
      ? [
          `${file}: ${found} whole-page lookups, ${recorded} recorded; look up by role, inside a region, or add .filter({ visible: true }).`,
        ]
      : [`${file}: ${found} whole-page lookups, ${recorded} recorded; lower the entry.`];
  });
}

describe('playwright-spec/visible-page-lookup', () => {
  test('refuses every lookup on the page that also matches hidden content', () => {
    for (const method of [
      'locator',
      'getByText',
      'getByLabel',
      'getByTestId',
      'getByPlaceholder',
      'getByAltText',
      'getByTitle',
    ]) {
      expect(reportedLookups(helper(`page.${method}('Bundesland')`))).toEqual([method]);
    }
  });

  test('follows the page through a fixture, a popup and a new page', () => {
    const source = `
      test('roles', async ({ adminPage, context }) => {
        await adminPage.getByLabel('Bundesland').click();
        const second = await context.newPage();
        await second.locator('#holiday-region').click();
        const popup = await adminPage.waitForEvent('popup');
        await popup.getByText('Gespeichert').click();
      });
    `;
    expect(reportedLookups(source)).toEqual(['getByLabel', 'locator', 'getByText']);
  });

  test('accepts a lookup that cannot land on a hidden copy', () => {
    for (const lookup of [
      "page.getByRole('combobox', { name: 'Bundesland' })",
      "page.getByRole('dialog').getByLabel('Bundesland')",
      "row.getByText('Bundesland')",
      "page.locator('#holiday-region').filter({ visible: true })",
      "page.getByText('Bundesland').filter({ hasText: 'Bayern' }).filter({ visible: true }).first()",
      "page.locator('[data-card]').locator('#holiday-region').filter({ visible: true })",
      "page.locator('tbody tr:visible')",
      "page.locator('tbody tr:visible, tfoot tr:visible')",
      "page.getByRole('row').filter({ has: page.locator('[data-pending-row]') })",
      "page.getByRole('row').filter({ hasNot: page.getByText('Entwurf') })",
      "row.and(page.locator(':not([data-unconfirmed])'))",
      "page.locator('html')",
      'page.locator(`html[${STATE}="ready"]`)',
      "page.locator('html').getByRole('combobox', { name: 'Bundesland' })",
      "page.locator('html').getByRole('dialog').getByLabel('Bundesland')",
    ]) {
      expect(reportedLookups(helper(lookup)), lookup).toEqual([]);
    }
  });

  test('refuses a lookup that only looks narrowed', () => {
    for (const [lookup, method] of [
      ["page.locator('#holiday-region').filter({ hasText: 'Bayern' }).first()", 'locator'],
      ["page.locator('#holiday-region').filter({ visible: false })", 'locator'],
      ["page.locator('body')", 'locator'],
      ['page.locator(`html[${LAYER}], [${SIGNAL}]`)', 'locator'],
      ["page.locator('tbody tr:visible, tfoot tr')", 'locator'],
      ["page.locator('body:visible #holiday-region')", 'locator'],
      ["page.locator('#holiday-region:not(:visible)')", 'locator'],
      ["page.locator('body').filter({ visible: true }).locator('#holiday-region')", 'locator'],
      ["page.locator('body').filter({ visible: true }).getByLabel('Bundesland')", 'locator'],
      ["page.locator('html').locator('#holiday-region')", 'locator'],
      ["page.locator('html').filter({ visible: true }).getByText('Bundesland')", 'getByText'],
      ["page.getByRole('combobox', { name: 'Bundesland', includeHidden: true })", 'getByRole'],
      ["row.or(page.getByText('Bundesland'))", 'getByText'],
      ["page.getByLabel('Bundesland').and(row)", 'getByLabel'],
    ]) {
      expect(reportedLookups(helper(lookup)), lookup).toEqual([method]);
    }
  });

  test('accepts a whole-DOM lookup only inside the named absence helpers', () => {
    const absence = (name) => `
      import type { Locator, Page } from '@playwright/test';
      export function ${name}(page: Page, text: string): Locator {
        return page.getByText(text);
      }
    `;
    expect(reportedLookups(absence('textInDom'))).toEqual([]);
    expect(reportedLookups(absence('expectGone'))).toEqual([]);
    expect(reportedLookups(absence('savedMessage'))).toEqual(['getByText']);
  });
});

describe('the lint configuration', () => {
  const probe = createProbeLinter();
  const source = helper("page.locator('#holiday-region')");

  /** Whether the repository's configuration reports the planted lookup at a path. */
  async function refusedAt(filePath) {
    const [result] = await probe.lintText(source, { filePath });
    return result.messages.some((message) => message.ruleId === RULE);
  }

  test('refuses a whole-page lookup in a spec and a support module that load the app', async () => {
    expect(await refusedAt('tests/golden/planted.spec.ts')).toBe(true);
    expect(await refusedAt('tests/audit/wave-1/planted.spec.ts')).toBe(true);
    expect(await refusedAt('tests/golden/support/steps/planted.ts')).toBe(true);
    expect(await refusedAt('tests/audit/support/planted-steps.ts')).toBe(true);
    expect(await refusedAt('tests/canary/support/planted.ts')).toBe(true);
  });

  test('leaves the contract specs alone: their static fixture page holds no hidden copy', async () => {
    expect(await refusedAt('tests/ui-contracts/planted.spec.ts')).toBe(false);
  });
});

describe('the whole-page lookup ratchet', () => {
  test('every listed support module holds exactly its recorded number of whole-page lookups', () => {
    const ratchet = JSON.parse(readFileSync(resolve(REPO_ROOT, RATCHET_FILE), 'utf8'));
    const countOf = (file) => {
      const path = resolve(REPO_ROOT, file);
      return existsSync(path) ? reportedLookups(readFileSync(path, 'utf8')).length : undefined;
    };
    expect(
      ratchetProblems(ratchet, countOf),
      `Bring ${RATCHET_FILE} in line with the code; the list only shrinks.`,
    ).toEqual([]);
  });

  test('a grown, a shrunk, an emptied and a vanished entry each fail; a matching one passes', () => {
    const ratchet = { 'grown.ts': 2, 'shrunk.ts': 3, 'empty.ts': 1, 'gone.ts': 1, 'kept.ts': 2 };
    const counts = { 'grown.ts': 3, 'shrunk.ts': 1, 'empty.ts': 0, 'kept.ts': 2 };
    expect(ratchetProblems(ratchet, (file) => counts[file])).toEqual([
      'grown.ts: 3 whole-page lookups, 2 recorded; look up by role, inside a region, or add .filter({ visible: true }).',
      'shrunk.ts: 1 whole-page lookups, 3 recorded; lower the entry.',
      'empty.ts: no whole-page lookup left; remove the entry.',
      'gone.ts: listed but gone; remove the entry.',
    ]);
  });
});
