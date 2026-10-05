import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

// An approval card leaves with the click. Until the server answers, nothing
// claims success: the confirmation appears only after the accepted write, and
// a refusal brings the card back with the reason.
test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  const fixtureUrl = 'http://localhost/ui-contracts';
  await page.route(fixtureUrl, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto(fixtureUrl);
  await page.evaluate(() => {
    window.uiContractFixture = 'approvals';
  });
  await page.addScriptTag({ path: bundle });
  await expect(page.getByRole('heading', { name: 'Komponentenverträge' })).toBeVisible();
});

const approveName = 'Urlaubsantrag von Bruno Beispiel genehmigen';
const confirmation = 'Der Urlaubsantrag von Bruno Beispiel wurde genehmigt.';

test('a refused approval brings the card back with the reason and never confirms', async ({ page }) => {
  const approve = page.getByRole('button', { name: approveName, exact: true });
  await approve.click();
  await expect(approve).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.uiContractApprovals.answer !== null)).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.evaluate(() => window.uiContractApprovals.answer?.('not_responsible'));
  await expect(approve).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveText(
    'Du bist für diese Urlaubsfreigabe nicht mehr verantwortlich. Die Ansicht wurde aktualisiert.',
  );
  expect(await page.evaluate(() => window.uiContractApprovals.decisions)).toBe(0);
});

test('the success banner appears only after the server accepted the approval', async ({ page }) => {
  const approve = page.getByRole('button', { name: approveName, exact: true });
  await approve.click();
  await expect(approve).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.uiContractApprovals.answer !== null)).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await page.evaluate(() => window.uiContractApprovals.answer?.(null));
  await expect(page.getByRole('alert')).toContainText(confirmation);
  await expect(approve).toHaveCount(0);
  expect(await page.evaluate(() => window.uiContractApprovals.decisions)).toBe(1);
});
