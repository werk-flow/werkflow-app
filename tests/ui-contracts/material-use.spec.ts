import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

// Recording used material names article, quantity, unit and effect before the
// booking, closes the dialog and shows the new facts in the first frame. A
// refusal restores the line's facts and reopens the dialog with the reason.
async function bookUse(page: import('@playwright/test').Page) {
  await openContractFixture(page, 'material-use');
  // By test id: an open dialog hides `main` from the accessibility tree.
  const line = page.getByTestId('job-material-line');
  await expect(line).toContainText('2 Stück entnommen');
  await line.getByRole('button', { name: 'Verbraucht', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Verbrauch buchen', exact: true });
  await expect(dialog).toContainText('Kupferrohr 15 mm');
  const quantity = dialog.getByRole('textbox', { name: 'Menge', exact: true });
  await expect(quantity).toHaveValue('2');
  await quantity.fill('1');
  await expect(dialog).toContainText(
    'Diese Zeile bucht 1 Stück als verbraucht. Der Lagerbestand bleibt gleich.',
  );
  await expect(dialog.getByRole('button', { name: /Lager/ })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Verbrauch buchen', exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(line).toContainText('2 Stück entnommen · 1 Stück verbraucht · 1 Stück noch offen');
  await expect(line.getByRole('status', { name: 'Wird gespeichert', exact: true })).toBeVisible();
  await expectHeldWrite(page, 'record-job-material-use');
  await expect(page.getByRole('alert')).toHaveCount(0);
  return { line, dialog, quantity };
}

test('a refused use restores the line and reopens the dialog with the reason', async ({ page }) => {
  const { line, dialog, quantity } = await bookUse(page);

  await answerHeldWrite(page, 'use_exceeds_taken');
  await expect(line).not.toContainText('Stück verbraucht');
  await expect(line).toContainText('2 Stück entnommen');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText(
    'So viel ist nicht mehr offen. Verbrauchen kannst du nur, was entnommen und noch nicht verbraucht oder zurückgelegt wurde.',
  );
  await expect(quantity).toHaveValue('1');
  expect(
    await page.evaluate(() => window.uiContractMaterial.lines.map((entry) => entry.usedQuantity)),
  ).toEqual([0]);
});

test('an accepted use keeps the new facts once the line is read again', async ({ page }) => {
  const { line } = await bookUse(page);

  await answerHeldWrite(page, null);
  await expect(line.getByRole('status', { name: 'Wird gespeichert', exact: true })).toHaveCount(0);
  await expect(line).toContainText('2 Stück entnommen · 1 Stück verbraucht · 1 Stück noch offen');
});
