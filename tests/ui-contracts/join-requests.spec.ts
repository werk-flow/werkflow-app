import { expect, test } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

// A join-request decision shows its pending state at the row in the first
// frame, keeps the other row usable, confirms only after the server accepted
// it, and keeps the row with the reason when the server refuses.
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
    window.uiContractFixture = 'join-requests';
  });
  await page.addScriptTag({ path: bundle });
  await expect(page.getByRole('heading', { name: 'Komponentenverträge' })).toBeVisible();
});

test('an approval spins at its row until the server accepts, then the row leaves with a confirmation', async ({
  page,
}) => {
  const approve = page.getByRole('button', { name: 'Rita Requester freigeben', exact: true });
  const otherRow = page.getByRole('button', { name: 'Sven Second freigeben', exact: true });
  await approve.click();
  await expect(page.getByRole('status', { name: 'Anfrage wird bearbeitet' })).toBeVisible();
  await expect(approve).toBeDisabled();
  await expect(otherRow).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => window.uiContractJoinRequests.answer !== null)).toBe(true);
  await page.evaluate(() => window.uiContractJoinRequests.answer?.(null));
  await expect(page.getByRole('alert')).toContainText(
    'Rita Requester ist jetzt Mitglied deiner Organisation.',
  );
  await expect(approve).toHaveCount(0);
  await expect(otherRow).toBeVisible();
  expect(await page.evaluate(() => window.uiContractJoinRequests.decisions)).toEqual([
    'approve:contract-request-rita',
  ]);
});

test('a refused decline keeps the row with the reason and never confirms', async ({ page }) => {
  const decline = page.getByRole('button', { name: 'Anfrage von Rita Requester ablehnen', exact: true });
  await decline.click();
  await expect(decline).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.uiContractJoinRequests.answer !== null)).toBe(true);

  await page.evaluate(() => window.uiContractJoinRequests.answer?.('request_not_pending'));
  await expect(page.getByRole('alert')).toContainText(
    'Die Anfrage ist nicht mehr offen. Sie wurde schon entschieden oder zurückgezogen.',
  );
  await expect(decline).toBeEnabled();
  expect(await page.evaluate(() => window.uiContractJoinRequests.decisions)).toEqual([]);
});
