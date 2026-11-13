import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// The office deletes an employee's entry and the server answers with a change
// request: the confirmation stays open with its action busy until the answer,
// then both layers close, the banner confirms the submitted request and the
// calendar reads again once.
test('a deletion answered with a change request closes the dialog with the request banner', async ({
  page,
}) => {
  await openContractFixture(page, 'entry-details');
  await page.getByRole('button', { name: 'Eintrag öffnen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Eintrag Details', exact: true });
  await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Arbeitsblock löschen?', exact: true });
  const confirm = confirmation.getByRole('button', { name: 'Löschen', exact: true });
  await confirm.click();
  await expectHeldWrite(page, 'delete-entry');
  await expect(confirm).toHaveAttribute('aria-busy', 'true');
  await expect(confirmation.getByRole('button', { name: 'Abbrechen', exact: true })).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, null);
  await expect(confirmation).toHaveCount(0);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Löschantrag wurde zur Genehmigung eingereicht.');
  await expect(page.getByLabel('Kalender neu gelesen', { exact: true })).toHaveText('1');
});
