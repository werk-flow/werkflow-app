import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// Planning material closes the dialog and shows the planned line in the first
// frame. A refusal removes the line and reopens the dialog with the entered
// row and the reason; nothing claims success before the server answered.
test('a refused material plan removes its line and reopens the dialog with the reason', async ({ page }) => {
  await openContractFixture(page, 'material-plan');
  const main = page.getByRole('main');
  await main.getByRole('button', { name: 'Material planen', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Material planen', exact: true });
  await dialog.getByRole('button', { name: /^Kupferrohr 15 mm/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'Menge', exact: true })).toHaveValue('1');
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();

  const plannedLine = main.getByTestId('job-material-line');
  await expect(dialog).toHaveCount(0);
  await expect(plannedLine).toContainText('Kupferrohr 15 mm');
  await expect(plannedLine.getByRole('status', { name: 'Wird gespeichert', exact: true })).toBeVisible();
  await expectHeldWrite(page, 'create-job-material-line');
  await expect(page.getByRole('alert')).toHaveCount(0);

  await answerHeldWrite(page, 'create_failed');
  await expect(plannedLine).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText('Die Materialposition konnte nicht gespeichert werden.');
  await expect(dialog.getByRole('textbox', { name: 'Menge', exact: true })).toHaveValue('1');
  expect(await page.evaluate(() => window.uiContractMaterial.lines)).toEqual([]);
});
