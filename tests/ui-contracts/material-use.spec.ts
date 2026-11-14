import { expect, test } from '@playwright/test';
import { isUuid } from '@/lib/validation/uuid';
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

/** The operation id of every use the page sent, in order. */
function sentOperationIds(page: import('@playwright/test').Page): Promise<unknown[]> {
  return page.evaluate(() =>
    window.uiContractWrites.calls.map((call) =>
      typeof call.input === 'object' && call.input !== null && 'operationId' in call.input
        ? call.input.operationId
        : null,
    ),
  );
}

// One dialog opening names its booking once: a press after a failed answer
// sends the same operation id, so a booking whose answer was lost books once.
// A new opening is a new booking with a new id.
test('a retried use sends the operation id of its dialog opening, a new opening a new one', async ({
  page,
}) => {
  const { line, dialog } = await bookUse(page);

  await answerHeldWrite(page, 'use_failed');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Verbrauch buchen', exact: true }).click();
  await expect.poll(() => sentOperationIds(page)).toHaveLength(2);
  await answerHeldWrite(page, null);
  await expect(line.getByRole('status', { name: 'Wird gespeichert', exact: true })).toHaveCount(0);

  await line.getByRole('button', { name: 'Verbraucht', exact: true }).click();
  await dialog.getByRole('button', { name: 'Verbrauch buchen', exact: true }).click();
  await expect.poll(() => sentOperationIds(page)).toHaveLength(3);
  await answerHeldWrite(page, 'material_idempotency_conflict');
  await expect(dialog.getByRole('alert')).toHaveText(
    'Diese Buchung wurde schon mit anderen Angaben gespeichert. Schließe den Dialog und prüfe die Materialposition.',
  );

  const [first, retry, next] = await sentOperationIds(page);
  expect(typeof first === 'string' && isUuid(first)).toBe(true);
  expect(retry).toBe(first);
  expect(next).not.toBe(first);
});

test('an accepted use keeps the new facts once the line is read again', async ({ page }) => {
  const { line } = await bookUse(page);

  await answerHeldWrite(page, null);
  await expect(line.getByRole('status', { name: 'Wird gespeichert', exact: true })).toHaveCount(0);
  await expect(line).toContainText('2 Stück entnommen · 1 Stück verbraucht · 1 Stück noch offen');
});

// The use dialog names its article from the line when the loaded catalog page
// lacks it. A take on the same line afterwards still reads the article's stock,
// so the dialog offers the Lager to take from.
test('a take after a use on an article off the loaded page still offers its Lager', async ({ page }) => {
  await openContractFixture(page, 'material-use-off-page');
  const line = page.getByTestId('job-material-line');
  await line.getByRole('button', { name: 'Verbraucht', exact: true }).click();
  const useDialog = page.getByRole('dialog', { name: 'Verbrauch buchen', exact: true });
  await expect(useDialog).toContainText('Kupferrohr 15 mm');
  await useDialog.getByRole('textbox', { name: 'Menge', exact: true }).fill('1');
  await useDialog.getByRole('button', { name: 'Verbrauch buchen', exact: true }).click();
  await expectHeldWrite(page, 'record-job-material-use');
  await answerHeldWrite(page, null);
  await expect(line.getByRole('status', { name: 'Wird gespeichert', exact: true })).toHaveCount(0);

  await line.getByRole('button', { name: 'Entnahme buchen', exact: true }).click();
  const takeDialog = page.getByRole('dialog', { name: 'Entnahme buchen', exact: true });
  await expect(takeDialog.locator('button[id$="-location"]')).toContainText('Hauptlager · 20 Stück');
});
