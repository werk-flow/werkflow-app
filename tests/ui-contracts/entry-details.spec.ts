import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The office deletes an employee's entry and the server answers with a change
// request: the dialog stays open with its button busy until the answer, then
// closes, confirms the submitted request and reads the calendar again once.
test('a deletion answered with a change request closes the dialog with the request banner', async ({
  page,
}) => {
  await openContractFixture(page, 'entry-details');
  await page.getByRole('button', { name: 'Eintrag öffnen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Eintrag Details', exact: true });
  await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: 'Arbeitsblock löschen?', exact: true })
    .getByRole('button', { name: 'Löschen', exact: true })
    .click();
  await expectHeldWrite(page, 'delete-entry');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Löschen', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Bearbeiten', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, null);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Löschantrag wurde zur Genehmigung eingereicht.');
  await expect(page.getByLabel('Kalender neu gelesen', { exact: true })).toHaveText('1');
});
