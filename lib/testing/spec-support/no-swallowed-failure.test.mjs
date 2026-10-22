// Rule test: a browser-test support module never turns a failure into a constant, unless a `// best-effort:` comment names the reason.
import { describe, expect, test } from 'bun:test';
import typescriptParser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import { noSwallowedFailureRule } from '../../../eslint-rules/playwright-failure-rules.mjs';
import { MEASUREMENT_DIGEST_SUPPORT_FILES } from '../../../eslint-rules/playwright-spec-rules.mjs';
import { LAB_DIGEST_SUPPORT_FILES } from '../../../eslint-rules/playwright-wait-rules.mjs';
import { createProbeLinter } from '../../../eslint-rules/probe-linter.mjs';

const RULE = 'playwright-spec/no-swallowed-failure';

function messageIds(source) {
  return new Linter()
    .verify(source, [
      {
        languageOptions: { parser: typescriptParser, parserOptions: { sourceType: 'module' } },
        plugins: { 'playwright-spec': { rules: { 'no-swallowed-failure': noSwallowedFailureRule } } },
        rules: { [RULE]: 'error' },
      },
    ])
    .map((message) => message.messageId ?? message.message);
}

describe('playwright-spec/no-swallowed-failure', () => {
  test('refuses a .catch or a catch block that turns a failure into a constant', () => {
    expect(
      messageIds(`
        async function probe() {
          const shown = await dialog.isVisible().catch(() => false);
          const opened = await dialog.waitFor({ state: 'visible' }).then(() => true).catch(() => false);
          await save.click().catch(() => undefined);
          await row.waitFor().catch(() => {});
          const rows = await list.allTextContents().catch(() => { return []; });
          // The banner may leave on its own.
          await banner.click().catch(() => void 0);
          const reached = await page.waitForURL(url).then(() => true, () => false);
          try { await expect(row).toBeVisible(); return true; } catch { return false; }
          try { readFileSync(path); } catch { return; }
          try { observe(); } catch {
            // A browser without the API records nothing.
          }
        }
      `),
    ).toEqual([
      'swallowedCatch',
      'swallowedCatch',
      'swallowedCatch',
      'swallowedCatch',
      'swallowedCatch',
      'swallowedCatch',
      'swallowedCatch',
      'swallowedClause',
      'swallowedClause',
      'swallowedClause',
    ]);
  });

  test('accepts a handled failure and a best effort that names its reason', () => {
    expect(
      messageIds(`
        async function probe() {
          const shown = await dialog.isVisible();
          const settled = await wait.then(() => true, (error) => {
            if (error instanceof errors.TimeoutError) return false;
            throw error;
          });
          await request.json().catch((error) => { throw new Error(String(error)); });
          await check().catch((error) => { expect.soft(String(error)).toBe(''); });
          try { await page.goto(path); } catch (error) {
            if (!(error instanceof errors.TimeoutError)) throw error;
            return false;
          }
          // best-effort: the banner may leave on its own; the count below asserts none is left.
          await banner.click({ timeout: 2_000 }).catch(() => undefined);
          const interrupted = await dialog
            .isVisible()
            .catch(() => /* best-effort: the step already failed and is rethrown below */ false);
          try { observe(); } catch {
            // best-effort: a browser without the API records nothing.
          }
        }
      `),
    ).toEqual([]);
  });

  test('the effective configuration checks every support module, never a digest input or a spec', async () => {
    const eslint = createProbeLinter();
    for (const file of [
      'tests/golden/support/steps/work.ts',
      'tests/golden/support/steps/interaction.ts',
      'tests/audit/support/open-layer.ts',
    ]) {
      const config = await eslint.calculateConfigForFile(file);
      expect(config.rules[RULE]?.[0], file).toBe(2);
    }
    for (const file of [
      ...MEASUREMENT_DIGEST_SUPPORT_FILES,
      ...LAB_DIGEST_SUPPORT_FILES,
      'tests/audit/wave-2/p1-13.spec.ts',
    ]) {
      const config = await eslint.calculateConfigForFile(file);
      expect(config.rules[RULE], file).toBeUndefined();
    }
  });

  test('the effective configuration refuses an unreasoned swallow in a support module and accepts a reasoned one', async () => {
    const eslint = createProbeLinter();
    const filePath = 'tests/golden/support/steps/swallowed-failure-probe.ts';
    const [refused] = await eslint.lintText(
      `import type { Locator } from '@playwright/test';\n\nexport async function isOpen(dialog: Locator): Promise<boolean> {\n  return dialog.isVisible().catch(() => false);\n}\n`,
      { filePath },
    );
    expect(refused?.messages.map((message) => message.ruleId)).toEqual([RULE]);
    const [reasoned] = await eslint.lintText(
      `import type { Locator } from '@playwright/test';\n\nexport async function closeBanner(button: Locator): Promise<void> {\n  // best-effort: the banner may leave on its own; the caller asserts none is left.\n  await button.click({ timeout: 2_000 }).catch(() => undefined);\n}\n`,
      { filePath },
    );
    expect(reasoned?.messages).toEqual([]);
  });
});
