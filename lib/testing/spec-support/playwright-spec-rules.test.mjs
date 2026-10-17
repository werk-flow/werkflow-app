// Rule test: the Playwright spec lint rules reject what they promise to reject.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import typescriptParser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import {
  MEASUREMENT_DIGEST_SUPPORT_FILES,
  noCopyInSpecLocatorRule,
  noLocatorFunctionInSpecRule,
  noOneShotCountComparisonRule,
  noRawKeyPressRule,
  noScopedHasLocatorRule,
  noStructuralLocatorRule,
  noTransportInternalsRule,
  noUnscopedPageSelectorsRule,
  noVisibleTextZeroCountRule,
} from '../../../eslint-rules/playwright-spec-rules.mjs';
import {
  boundedTimeoutRule,
  LAB_DIGEST_SUPPORT_FILES,
  noRetriedActionRule,
} from '../../../eslint-rules/playwright-wait-rules.mjs';
import { createProbeLinter } from '../../../eslint-rules/probe-linter.mjs';

const REPO_ROOT = resolve(import.meta.dir, '../../..');

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

  test('rejects structural, class and hook locators in specs; support modules keep ancestors and hooks but never classes', () => {
    const source = `
      const notesSelector = "#instruction-notes";
      heading.locator("..");
      heading.locator('xpath=ancestor::section[1]');
      heading.locator('xpath=ancestor::div[contains(@class, "sticky")][1]');
      card.locator('[class*="rounded"]');
      page.getByRole("main").locator('[data-row-id="7"]');
      dialog.locator("#instruction-group");
      dialog.locator(notesSelector);
      page.locator(\`textarea[id$="-\${suffix}"]\`);
      viewer.frameLocator('iframe[title*="upload"]');
      page.locator("input#upload");
      page.getByTestId("pending-approvals-panel");
      dialog.locator("tr").first();
      page.getByRole("dialog").locator("input");
    `;
    expect(
      lint(source, 'no-structural-locator', noStructuralLocatorRule).map((message) => message.messageId),
    ).toEqual([
      'structural',
      'structural',
      'classes',
      'classes',
      'hook',
      'hook',
      'hook',
      'hook',
      'hook',
      'hook',
      'testId',
    ]);

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

test('rejects copy passed to a support helper parameter typed as plain string, not to a key', () => {
  const directory = mkdtempSync(join(tmpdir(), 'spec-copy-'));
  try {
    writeFileSync(
      join(directory, 'steps.ts'),
      `
        export async function closeRequest(page: Page, reasonLabel: string): Promise<void> {}
        export function handoverMessage(section: Locator, message: keyof typeof COPY): Locator {}
        export async function createRequest(page: Page, options: { title: string; categoryLabel?: string }) {}
        export async function addCondition(page: Page, options: { employmentType: EmploymentType }) {}
        export function expectLiveWithin(label: string) {}
      `,
    );
    const linter = new Linter({ cwd: directory });
    const messages = linter.verify(
      `
        import { addCondition, closeRequest, createRequest, expectLiveWithin, handoverMessage } from "./steps";
        const reason = "Kein Bedarf";
        await closeRequest(page, "Doppelt erfasst");
        await closeRequest(page, reason);
        await createRequest(page, { title: "Heizung prüfen", categoryLabel: "Wartung" });
        await closeRequest(page, testData\`Kein Bedarf\`);
        await closeRequest(page, REQUEST_COPY.reasons.duplicate);
        handoverMessage(section, "draftSaved");
        await addCondition(page, { employmentType: "vollzeit" });
        await expectLiveWithin("calendar refresh");
      `,
      [
        {
          files: ['**/*.ts'],
          languageOptions: {
            parser: typescriptParser,
            parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
          },
          plugins: { 'playwright-spec': { rules: { 'no-copy-in-spec-locator': noCopyInSpecLocatorRule } } },
          rules: { 'playwright-spec/no-copy-in-spec-locator': 'error' },
        },
      ],
      { filename: join(directory, 'probe.spec.ts') },
    );
    expect(messages.map((message) => message.message.match(/helper (\S+ \(\w+\))/)?.[1])).toEqual([
      'closeRequest (reasonLabel)',
      'closeRequest (reasonLabel)',
      'createRequest (categoryLabel)',
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects one-shot comparisons of two count() reads, and a live count() in toHaveCount', () => {
  expect(
    lint(
      `
        expect(await taskRows(page).count()).toBe(await unreadRows(page).count());
        expect.soft((await a.count()) - (await b.count())).toBe(0);
        const tasks = await taskRows(page).count();
        const unread = await unreadRows(page).count();
        expect(tasks + unread).toBe(3);
        async function readBadge(page) { return (await badge(page).count()) === 0 ? 0 : 1; }
        expect(await readBadge(page)).toBe(await unreadRows(page).count());
        await expect(taskRows(page)).toHaveCount(await unreadRows(page).count());
      `,
      'no-one-shot-count-comparison',
      noOneShotCountComparisonRule,
    ).map((message) => message.messageId),
  ).toEqual(['oneShot', 'oneShot', 'oneShot', 'oneShot', 'liveArgument']);
});

test('allows polled count comparisons, single reads and a baseline in toHaveCount', () => {
  expect(
    lint(
      `
        await expect.poll(async () => (await a.count()) - (await b.count())).toBe(0);
        await expect
          .poll(async () => {
            const unread = await unreadRows(page).count();
            const badge = await readBadge(page);
            return badge - unread;
          })
          .toBe(0);
        const before = await rows.count();
        await expect(rows).toHaveCount(before + 1);
        expect(await rows.count()).toBeGreaterThan(0);
        await expect(async () => expect(await a.count()).toBe(await b.count())).toPass();
      `,
      'no-one-shot-count-comparison',
      noOneShotCountComparisonRule,
    ),
  ).toHaveLength(0);
});

/** Lints a planted spec in tests/golden/, where `./support/timeouts` is the wait registry. */
function lintWaits(source) {
  const linter = new Linter({ cwd: REPO_ROOT });
  return linter
    .verify(
      source,
      [
        {
          files: ['**/*.ts'],
          languageOptions: {
            parser: typescriptParser,
            parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
          },
          plugins: { 'playwright-spec': { rules: { 'bounded-timeout': boundedTimeoutRule } } },
          rules: { 'playwright-spec/bounded-timeout': 'error' },
        },
      ],
      { filename: join(REPO_ROOT, 'tests/golden/probe.spec.ts') },
    )
    .map((message) => message.messageId);
}

describe('bounded-timeout', () => {
  test('rejects a wait above the configured expect timeout unless the registry names it', () => {
    expect(
      lintWaits(`
        import { SLOW_WAIT } from "./support/steps/shared";
        const LOCAL_WAIT = 15_000;
        await expect(dialog).toHaveCount(0, { timeout: 15_000 });
        await field.click({ timeout: 15_000 });
        await dialog.waitFor({ state: "visible", timeout: 15_000 });
        await expect(row).toBeVisible({ timeout: LOCAL_WAIT });
        await expect(row).toBeVisible({ timeout: SLOW_WAIT });
        await expect.poll(read, { timeout: base * 2 }).toBe(1);
        await expect(row).toBeVisible({ timeout: 0 });
        await observe({ hardTimeoutMs: 30_000 });
        async function waitForRow(page: Page, timeoutMs: number) {}
      `),
    ).toEqual([
      'literal',
      'literal',
      'literal',
      'literal',
      'unregistered',
      'unregistered',
      'unbounded',
      'literal',
      'positional',
    ]);
  });

  test('allows registry constants, measured deadlines, forwarded options and short literals', () => {
    expect(
      lintWaits(`
        import { DOCUMENT_UPLOAD_TIMEOUT_MS } from "./support/timeouts";
        import * as WAITS from "./support/timeouts";
        import { LIVE_HARD_BUDGET_MS } from "../../lib/testing/responsiveness-tolerance";
        const hardBudgetMs = LIVE_HARD_BUDGET_MS[backend];
        await expect(dialog).toHaveCount(0, { timeout: DOCUMENT_UPLOAD_TIMEOUT_MS });
        await expect(overview).toBeVisible({ timeout: WAITS.TASK_OVERVIEW_READ_TIMEOUT_MS });
        await expect(html).toHaveAttribute("data-state", "ready", { timeout: hardBudgetMs });
        await expect(row).toBeVisible({ timeout: 10_000 });
        await menu.click({ timeout: 5_000 });
        export async function settled(scope: Scope, options: { timeout?: number } = {}) {
          await expect.poll(read, { ...(options.timeout !== undefined ? { timeout: options.timeout } : {}) });
        }
        export async function observe(input: { hardTimeoutMs: number }) {
          await expect(row).toBeVisible({ timeout: input.hardTimeoutMs });
        }
        export async function press(page: Page, { timeout }: { timeout?: number }) {
          await field.press("Enter", { timeout });
        }
      `),
    ).toEqual([]);
  });

  test('the effective configuration checks every spec and support module, never a digest input or a config', async () => {
    const eslint = createProbeLinter();
    for (const file of ['tests/golden/support/steps/work.ts', 'tests/audit/wave-2/p1-13.spec.ts']) {
      const config = await eslint.calculateConfigForFile(file);
      expect(config.rules['playwright-spec/bounded-timeout']?.[0], file).toBe(2);
    }
    for (const file of [
      ...MEASUREMENT_DIGEST_SUPPORT_FILES,
      ...LAB_DIGEST_SUPPORT_FILES,
      'tests/ui-contracts/playwright.config.ts',
    ]) {
      const config = await eslint.calculateConfigForFile(file);
      expect(config.rules['playwright-spec/bounded-timeout'], file).toBeUndefined();
    }
  });

  test('rejects a step retried inside toPass and a failure swallowed into a constant', () => {
    expect(
      lint(
        `
          await expect(async () => {
            if (!(await dialog.isVisible())) await button.click();
            await expect(dialog).toBeVisible({ timeout: 2_000 });
          }).toPass({ timeout: 15_000 });
          await expect(async () => {
            await page.reload();
          }).toPass();
          const shown = await dialog.isVisible().catch(() => false);
          await row.waitFor().catch(() => {});
          await save.click().catch(() => undefined);
          await save.click().catch(() => void 0);
          const rows = await list.allTextContents().catch(() => []);
          const state = await read().catch(() => ({}));
          const open = await menu.isVisible().catch(() => {
            return false;
          });
        `,
        'no-retried-action',
        noRetriedActionRule,
      ).map((message) => message.messageId),
    ).toEqual([
      'retriedAction',
      'retriedAction',
      'swallowed',
      'swallowed',
      'swallowed',
      'swallowed',
      'swallowed',
      'swallowed',
      'swallowed',
    ]);
  });

  test('allows polled reads inside toPass and a catch that handles the failure', () => {
    expect(
      lint(
        `
          await expect(async () => expect(await a.count()).toBe(await b.count())).toPass();
          await expect.poll(async () => (await rows.count()) > 0).toBe(true);
          await request.json().catch((error) => { throw new Error(String(error)); });
        `,
        'no-retried-action',
        noRetriedActionRule,
      ),
    ).toEqual([]);
  });

  test('exempts every lab digest support file that lib/testing/lab-count-context.ts names', () => {
    const source = readFileSync(resolve(import.meta.dir, '../lab-count-context.ts'), 'utf8');
    const named = [...source.matchAll(/'(tests\/[^']+\.ts)'/g)].map((match) => match[1]);
    expect(named.length).toBeGreaterThan(0);
    expect([...LAB_DIGEST_SUPPORT_FILES].sort()).toEqual([...named].sort());
  });
});
