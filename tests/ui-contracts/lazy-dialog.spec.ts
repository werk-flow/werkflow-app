import { expect, test, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

async function openFixture(page: Page): Promise<void> {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(() => {
    window.uiContractFixture = 'lazy-dialog';
  });
  await page.addScriptTag({ path: bundle });
  await expect(page.getByRole('button', { name: 'Neu' })).toBeEnabled();
}

const loads = (page: Page) => page.evaluate(() => window.uiContractLazyDialog.loads);
const answer = (page: Page, loaded: boolean) =>
  page.evaluate((value) => window.uiContractLazyDialog.answer?.(value), loaded);

test('a lazy dialog downloads on intent only, and an early open shows pending until it lands', async ({
  page,
}) => {
  await openFixture(page);
  const create = page.getByRole('button', { name: 'Neu' });
  expect(await loads(page)).toBe(0);
  expect(await page.evaluate(() => window.uiContractLazyDialog.menuLoads)).toBe(0);

  await create.hover();
  expect(await loads(page)).toBe(1);
  await create.click();
  await expect(create).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await answer(page, true);
  await expect(page.getByRole('dialog', { name: 'Geladener Dialog' })).toBeVisible();
  expect(await loads(page)).toBe(1);

  // The open modal hides the page from the accessibility tree; read the button after it closes.
  await page.keyboard.press('Escape');
  await expect(create).not.toHaveAttribute('aria-busy');
  expect(await page.evaluate(() => window.uiContractLazyDialog.menuLoads)).toBe(0);
});

test('an edit chosen while its form downloads shows a busy row, and only the latest choice opens', async ({
  page,
}) => {
  await openFixture(page);
  const first = page.getByRole('region', { name: 'Erste Zeile' });
  const second = page.getByRole('region', { name: 'Zweite Zeile' });
  await first.getByRole('button', { name: 'Aktionen öffnen' }).click();
  expect(await page.evaluate(() => window.uiContractLazyDialog.menuLoads)).toBe(1);
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  await expect(first.getByRole('button', { name: 'Aktionen öffnen' })).toBeDisabled();

  await second.getByRole('button', { name: 'Aktionen öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  await expect(first.getByRole('button', { name: 'Aktionen öffnen' })).toBeEnabled();
  await expect(second.getByRole('button', { name: 'Aktionen öffnen' })).toBeDisabled();
  expect(await page.evaluate(() => window.uiContractLazyDialog.menuLoads)).toBe(1);

  await page.evaluate(() => window.uiContractLazyDialog.answerMenu?.());
  await expect(page.getByRole('dialog', { name: 'Zweite Zeile bearbeiten' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('an edit chosen on a row of another dialog closes the earlier waiting open', async ({ page }) => {
  await openFixture(page);
  const first = page.getByRole('region', { name: 'Erste Zeile' });
  const project = page.getByRole('region', { name: 'Projektzeile' });
  await first.getByRole('button', { name: 'Aktionen öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  await expect(first.getByRole('button', { name: 'Aktionen öffnen' })).toBeDisabled();

  await project.getByRole('button', { name: 'Aktionen öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  await expect(first.getByRole('button', { name: 'Aktionen öffnen' })).toBeEnabled();
  await expect(project.getByRole('button', { name: 'Aktionen öffnen' })).toBeDisabled();

  await page.evaluate(() => window.uiContractLazyDialog.answerMenu?.());
  await page.evaluate(() => window.uiContractLazyDialog.answerOtherMenu?.());
  await expect(page.getByRole('dialog', { name: 'Projektzeile bearbeiten' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('opening a loaded dialog closes an edit still waiting for its download', async ({ page }) => {
  await openFixture(page);
  const create = page.getByRole('button', { name: 'Neu' });
  const first = page.getByRole('region', { name: 'Erste Zeile' });
  await create.hover();
  await answer(page, true);

  await first.getByRole('button', { name: 'Aktionen öffnen' }).click();
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  await expect(first.getByRole('button', { name: 'Aktionen öffnen' })).toBeDisabled();
  await create.click();
  await expect(page.getByRole('dialog', { name: 'Geladener Dialog' })).toBeVisible();

  await page.evaluate(() => window.uiContractLazyDialog.answerMenu?.());
  await page.keyboard.press('Escape');
  await expect(first.getByRole('button', { name: 'Aktionen öffnen' })).toBeEnabled();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a failed download closes the open with an error, and the next open retries', async ({ page }) => {
  await openFixture(page);
  const create = page.getByRole('button', { name: 'Neu' });
  await create.click();
  expect(await loads(page)).toBe(1);
  await answer(page, false);
  await expect(page.getByRole('alert')).toContainText('Das Formular konnte nicht geladen werden.');
  await expect(create).not.toHaveAttribute('aria-busy');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await create.click();
  expect(await loads(page)).toBe(2);
  await answer(page, true);
  await expect(page.getByRole('dialog', { name: 'Geladener Dialog' })).toBeVisible();
});
