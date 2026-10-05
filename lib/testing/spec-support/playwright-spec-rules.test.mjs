// Rule test: the Playwright spec lint rules reject what they promise to reject.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import typescriptParser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import {
  MEASUREMENT_DIGEST_SUPPORT_FILES,
  noCopyInSpecLocatorRule,
  noLocatorFunctionInSpecRule,
  noRawKeyPressRule,
  noScopedHasLocatorRule,
  noStructuralLocatorRule,
  noTransportInternalsRule,
  noUnscopedPageSelectorsRule,
  noVisibleTextZeroCountRule,
} from '../../../eslint-rules/playwright-spec-rules.mjs';

function lint(source, ruleName, rule) {
  const linter = new Linter();
  return linter.verify(source, [
    {
      languageOptions: {
        parser: typescriptParser,
        parserOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module',
        },
      },
      plugins: {
        'playwright-spec': {
          rules: { [ruleName]: rule },
        },
      },
      rules: {
        [`playwright-spec/${ruleName}`]: 'error',
      },
    },
  ]);
}

describe('Playwright spec ESLint rules', () => {
  test('keeps fixture and popup page aliases covered', () => {
    const messages = lint(
      `
        test("fixture", async ({ adminPage: page }) => {
          const popupPromise = page.waitForEvent("popup");
          await page.getByRole("link").click();
          const popup = await popupPromise;
          const popupAlias = popup;
          return popupAlias.locator("main");
        });
      `,
      'no-unscoped-page-selectors',
      noUnscopedPageSelectorsRule,
    );

    expect(messages.map((message) => message.messageId)).toEqual(['locator']);
  });

  test('rejects raw selectors on Page-typed helper parameters and their aliases', () => {
    const messages = lint(
      `
        import type { Page } from "@playwright/test";
        function customerRow(page: Page) {
          const browserPage = page;
          return browserPage.locator("tr");
        }
      `,
      'no-unscoped-page-selectors',
      noUnscopedPageSelectorsRule,
    );

    expect(messages.map((message) => message.messageId)).toEqual(['locator']);
  });

  test('recognizes aliased and namespace-qualified Playwright Page types', () => {
    const messages = lint(
      `
        import type { Page as BrowserPage } from "@playwright/test";
        import type * as Playwright from "@playwright/test";
        const first = (page: BrowserPage) => page.getByText("Kunde");
        const second = (page: Playwright.Page) => page.locator("main");
      `,
      'no-unscoped-page-selectors',
      noUnscopedPageSelectorsRule,
    );

    expect(messages.map((message) => message.messageId)).toEqual(['getByText', 'locator']);
  });

  test('allows selectors scoped from a semantic locator', () => {
    const messages = lint(
      `
        import type { Page } from "@playwright/test";
        function customerRow(page: Page) {
          return page.getByRole("main").locator("tr");
        }
      `,
      'no-unscoped-page-selectors',
      noUnscopedPageSelectorsRule,
    );

    expect(messages).toHaveLength(0);
  });

  test('rejects hidden-filtered zero-count assertions, including imported aliases', () => {
    const messages = lint(
      `
        import { visibleText as visible } from "../golden/support/steps";
        expect(visibleText(page, "Secret")).toHaveCount(0);
        expect(visible(page, "Secret alias")).toHaveCount(0);
      `,
      'no-visible-text-zero-count',
      noVisibleTextZeroCountRule,
    );

    expect(messages.map((message) => message.messageId)).toEqual(['hiddenAbsence', 'hiddenAbsence']);
  });

  test('allows DOM-wide zero-count assertions', () => {
    const messages = lint(
      `expect(textInDom(page, "Secret")).toHaveCount(0);`,
      'no-visible-text-zero-count',
      noVisibleTextZeroCountRule,
    );

    expect(messages).toHaveLength(0);
  });
});

describe('locator ownership rules', () => {
  test('rejects copy in spec locators, assertions and text helpers, including spec-local constants', () => {
    const messages = lint(
      `
        const save = "Speichern";
        const LABELS = { cancel: "Abbrechen" };
        dialog.getByRole("button", { name: "Änderung speichern" });
        dialog.getByRole("button", { name: save });
        dialog.getByRole("button", { name: LABELS.cancel });
        dialog.getByText(/Gespeichert/);
        dialog.getByLabel(\`\${name} bearbeiten\`);
        rows.filter({ hasText: "Offen" });
        expect(banner).toHaveText("Entwurf gespeichert.");
        expect(list).toContainText(["Erledigt"]);
        visibleText(page, "Überstunden heute");
      `,
      'no-copy-in-spec-locator',
      noCopyInSpecLocatorRule,
    );

    expect(messages.map((message) => message.messageId)).toEqual([
      'locator',
      'locator',
      'locator',
      'locator',
      'locator',
      'locator',
      'assertion',
      'assertion',
      'helper',
    ]);
  });

  test('allows data, product label owners and short separators in spec locators', () => {
    const messages = lint(
      `
        import { workTransitionActionLabel } from "../../lib/work-lifecycle/types";
        page.getByRole("row", { name: customerName });
        page.getByRole("button", { name: workTransitionActionLabel("planned", "in_progress"), exact: true });
        page.getByText(\`\${jobNumber}-A\`);
        page.getByRole("cell", { name: "12" });
        expect(total).toHaveText(/^\d+ h$/);
        expect(row).toContainText(names.customer);
        const customer = \`A1 Kunde \${world.runId}\`;
        page.getByRole("row", { name: customer });
        expect(row).toHaveText(customer);
      `,
      'no-copy-in-spec-locator',
      noCopyInSpecLocatorRule,
    );

    expect(messages).toHaveLength(0);
  });

  test('rejects functions in a spec file that return a Locator', () => {
    const messages = lint(
      `
        import type { Locator, Page } from "@playwright/test";
        function card(page: Page): Locator { return page.getByTestId("card"); }
        const row = (page: Page, name: string) => page.getByRole("row", { name });
        async function field(page: Page) { return page.locator("#field"); }
        test("t", async ({ page }) => { await page.getByRole("main").click(); });
      `,
      'no-locator-function-in-spec',
      noLocatorFunctionInSpecRule,
    );

    expect(messages.map((message) => message.messageId)).toEqual(['helper', 'helper', 'helper']);
  });

  test('rejects structural and class locators; support modules keep ancestors but never classes', () => {
    const source = `
      heading.locator("..");
      heading.locator('xpath=ancestor::section[1]');
      heading.locator('xpath=ancestor::div[contains(@class, "sticky")][1]');
      card.locator('[class*="rounded"]');
      page.getByRole("main").locator('[data-row-id="7"]');
    `;
    expect(
      lint(source, 'no-structural-locator', noStructuralLocatorRule).map((message) => message.messageId),
    ).toEqual(['structural', 'structural', 'classes', 'classes']);

    const linter = new Linter();
    const supportMessages = linter.verify(source, [
      {
        languageOptions: {
          parser: typescriptParser,
          parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        },
        plugins: { 'playwright-spec': { rules: { 'no-structural-locator': noStructuralLocatorRule } } },
        rules: { 'playwright-spec/no-structural-locator': ['error', { classesOnly: true }] },
      },
    ]);
    expect(supportMessages.map((message) => message.messageId)).toEqual(['classes', 'classes']);
  });

  test('rejects raw key presses and transport internals', () => {
    expect(
      lint(
        `
          await page.keyboard.press("Escape");
          await field.press("Enter");
          await page.keyboard.down("Alt");
        `,
        'no-raw-key-press',
        noRawKeyPressRule,
      ).map((message) => message.messageId),
    ).toEqual(['press', 'press']);
    expect(
      lint(
        `
          page.waitForResponse((response) => response.request().postData()?.includes("x"));
          await response.finished();
          await response.json();
        `,
        'no-transport-internals',
        noTransportInternalsRule,
      ).map((message) => message.messageId),
    ).toEqual(['transport', 'transport']);
  });

  test('exempts every measurement-digest support file that lib/testing/performance-context.ts names', () => {
    const source = readFileSync(resolve(import.meta.dir, '../performance-context.ts'), 'utf8');
    const named = [...source.matchAll(/'(tests\/[^']+\.ts)'/g)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const file of named) expect(MEASUREMENT_DIGEST_SUPPORT_FILES).toContain(file);
  });
});

test('rejects a has/hasNot locator chained from a scope instead of the page', () => {
  expect(
    lint(
      `
        scope.getByRole("group", { name }).filter({ hasNot: scope.getByRole("group") });
        dialog.getByTestId("grid").filter({ has: dialog.locator("#date") });
        scope.getByRole("group").filter({ hasNot: scope.page().getByRole("group") });
        main.getByTestId("row").filter({ has: adminPage.getByText(name) });
        main.getByTestId("row").filter({ has: rowTitle(page, name) });
      `,
      'no-scoped-has-locator',
      noScopedHasLocatorRule,
    ).map((message) => message.messageId),
  ).toEqual(['scoped', 'scoped']);
});
