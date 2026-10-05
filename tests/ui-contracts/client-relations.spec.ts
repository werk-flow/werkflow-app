import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// Archiving a contact or a work site moves the row in the first frame and
// marks only that row. A refusal restores it with the reason; an acceptance
// keeps it archived once the refreshed route props arrive.
test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'client-relations');
});

test('a refused contact archive returns the contact with the reason', async ({ page }) => {
  const main = page.getByRole('main');
  const archive = main.getByRole('button', { name: 'Ansprechpartner archivieren', exact: true });
  const restore = main.getByRole('button', { name: 'Ansprechpartner wiederherstellen', exact: true });
  await archive.click();
  await expect(archive).toHaveCount(0);
  await expect(restore).toBeDisabled();
  await expectHeldWrite(page, 'update-client-contact');
  await expect(main.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, 'not_authorized');
  await expect(archive).toBeEnabled();
  await expect(restore).toHaveCount(0);
  await expect(main.getByRole('alert')).toHaveText('Du hast keine Berechtigung für diese Aktion.');
  expect(await page.evaluate(() => window.uiContractClientRelations.contacts[0]?.isActive)).toBe(true);
});

test('an accepted site archive stays archived after the route refresh', async ({ page }) => {
  const main = page.getByRole('main');
  const archive = main.getByRole('button', { name: 'Einsatzort archivieren', exact: true });
  const restore = main.getByRole('button', { name: 'Einsatzort wiederherstellen', exact: true });
  await archive.click();
  await expect(archive).toHaveCount(0);
  await expect(restore).toBeDisabled();
  await expectHeldWrite(page, 'update-client-site');

  await answerHeldWrite(page, null);
  await expect(restore).toBeEnabled();
  await expect(archive).toHaveCount(0);
  await expect(main.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => window.uiContractServices.navigation)).toContain('refresh');
});
