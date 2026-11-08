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
  await page.getByRole('button', { name: 'Aktionen öffnen' }).click();
  expect(await page.evaluate(() => window.uiContractLazyDialog.menuLoads)).toBe(1);
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  await expect(page.getByRole('dialog', { name: 'Geladener Dialog' })).toBeVisible();
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
