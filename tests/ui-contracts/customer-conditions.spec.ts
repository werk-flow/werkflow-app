import { expect, test } from '@playwright/test';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

test.beforeEach(async ({ page }) => {
  await openContractFixture(page, 'customer-conditions');
  await page.getByRole('button', { name: 'Konditionen ändern', exact: true }).click();
});

test('a discount above 100 % and a price row without a Leistung mark their fields and send nothing', async ({
  page,
}) => {
  const dialog = page.getByRole('dialog', { name: 'Konditionen ändern' });
  // Filled from the newest version, from today on.
  await expect(dialog.getByRole('textbox', { name: 'Material' })).toHaveValue('10');
  await expect(dialog.getByRole('textbox', { name: 'Arbeit' })).toHaveValue('5');
  await expect(dialog.getByRole('textbox', { name: 'Preis netto je Einheit' })).toHaveValue('68,00');

  await dialog.getByRole('textbox', { name: 'Arbeit' }).fill('150');
  await dialog.getByRole('button', { name: 'Eigenen Preis hinzufügen', exact: true }).click();
  const newRow = dialog.getByRole('listitem').filter({
    has: page.getByRole('combobox', { name: 'Leistung' }).filter({ hasText: 'Leistung wählen…' }),
  });
  await newRow.getByRole('textbox', { name: 'Preis netto je Einheit' }).fill('45,00');
  const save = dialog.getByRole('button', { name: 'Konditionen speichern', exact: true });
  await save.click();
  await expect(
    dialog.getByText(
      'Gib den Rabatt in Prozent von 0 bis 100 an, zum Beispiel 10 oder 12,5, oder lass das Feld leer.',
    ),
  ).toBeVisible();
  await expect(dialog.getByText('Wähle eine Leistung.')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Arbeit' })).toBeFocused();
  await expect(save).toBeEnabled();
  expect(await page.evaluate(() => window.uiContractWrites.calls)).toEqual([]);
});

test('a save holds the dialog, keeps its values after a refusal and closes after an acceptance', async ({
  page,
}) => {
  const dialog = page.getByRole('dialog', { name: 'Konditionen ändern' });
  const material = dialog.getByRole('textbox', { name: 'Material' });
  await material.fill('12,5');
  const save = dialog.getByRole('button', { name: 'Konditionen speichern', exact: true });
  await save.click();
  await expectHeldWrite(page, 'record-customer-condition');
  await expect(save).toBeDisabled();
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toEqual([
    {
      validFrom: '2026-11-27',
      discountTenths: { material: 125, arbeit: 50, anfahrt: 0 },
      leistungPrices: [{ leistungId: 'contract-leistung', salePriceCents: 6800 }],
    },
    2,
    expect.any(String),
  ]);

  await answerHeldWrite(page, 'condition_changed');
  await expect(
    dialog.getByText('Jemand hat die Konditionen gerade geändert.', { exact: false }),
  ).toBeVisible();
  await expect(material).toHaveValue('12,5');
  await expect(save).toBeEnabled();

  // The retry carries the same key, so a save that landed before a lost answer is not recorded twice.
  await save.click();
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer !== null)).toBe(true);
  const [first, second] = await page.evaluate(() => window.uiContractWrites.calls.map((call) => call.input));
  expect(Array.isArray(second) && Array.isArray(first) && second[2] === first[2]).toBe(true);
  await answerHeldWrite(page, null);
  await expect(dialog).toHaveCount(0);
});
