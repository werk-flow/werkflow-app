import { expect, test, type Page } from '@playwright/test';
import { visibleText } from '../golden/support/steps/shared';
import { answerHeldWrite, expectHeldWrite, openContractFixture } from './open-fixture';

const openDialog = async (page: Page, fixture: 'customer-conditions' | 'customer-conditions-section') => {
  await openContractFixture(page, fixture);
  await page.getByRole('button', { name: 'Konditionen ändern', exact: true }).click();
};

test('a discount above 100 % and a price row without a Leistung mark their fields and send nothing', async ({
  page,
}) => {
  await openDialog(page, 'customer-conditions');
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
  await openDialog(page, 'customer-conditions');
  const dialog = page.getByRole('dialog', { name: 'Konditionen ändern' });
  const material = dialog.getByRole('textbox', { name: 'Material' });
  await material.fill('12,5');
  const save = dialog.getByRole('button', { name: 'Konditionen speichern', exact: true });
  await save.click();
  await expectHeldWrite(page, 'record-customer-condition');
  await expect(save).toBeDisabled();
  // No field takes an edit the running save would not carry, the date's segments included.
  await expect(material).toBeDisabled();
  await expect(dialog.getByRole('group', { name: 'Gültig ab' })).toHaveAttribute('aria-disabled', 'true');
  expect(await page.evaluate(() => window.uiContractWrites.calls[0]?.input)).toEqual([
    {
      validFrom: '2026-11-27',
      discountTenths: { material: 125, arbeit: 50, anfahrt: 0 },
      leistungPrices: [{ leistungId: 'contract-leistung', salePriceCents: 6800 }],
    },
    2,
    expect.any(String),
  ]);

  // A failure that may have lost the answer of a stored version.
  await answerHeldWrite(page, 'save_failed');
  await expect(
    dialog.getByText('Die Konditionen konnten nicht gespeichert werden. Versuche es erneut.'),
  ).toBeVisible();
  await expect(material).toHaveValue('12,5');
  await expect(material).toBeEnabled();
  await expect(save).toBeEnabled();

  // The retry of the same values carries the same key, so a version stored before the lost answer
  // answers again instead of being recorded twice.
  await save.click();
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer !== null)).toBe(true);
  const [first, second] = await page.evaluate(() => window.uiContractWrites.calls.map((call) => call.input));
  expect(Array.isArray(second) && Array.isArray(first) && second[2] === first[2]).toBe(true);
  await answerHeldWrite(page, null);
  await expect(dialog).toHaveCount(0);
});

// Changed values are a new version and take a new key, so a retry never answers with a version of
// other values.
test('changed values after a failed save take a new retry key', async ({ page }) => {
  await openDialog(page, 'customer-conditions');
  const dialog = page.getByRole('dialog', { name: 'Konditionen ändern' });
  const save = dialog.getByRole('button', { name: 'Konditionen speichern', exact: true });
  await save.click();
  await expectHeldWrite(page, 'record-customer-condition');
  await answerHeldWrite(page, 'save_failed');
  await expect(save).toBeEnabled();

  await dialog.getByRole('textbox', { name: 'Material' }).fill('15');
  await save.click();
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer !== null)).toBe(true);
  const keys = await page.evaluate(() =>
    window.uiContractWrites.calls.map((call) => (Array.isArray(call.input) ? call.input[2] : null)),
  );
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
});

const settling = (page: Page) =>
  // The open dialog hides the page from the accessibility tree; the spinner is there all the same.
  page.getByRole('status', { name: 'Konditionen werden aktualisiert', includeHidden: true });
const savedBanner = (page: Page) =>
  page.getByRole('alert', { includeHidden: true }).filter({ hasText: /^Konditionen gespeichert\./ });

// Conditions are versioned: a save never overwrites. A newer version of another session refuses
// the form once; the dialog keeps every value and the next press records them after that version.
// The page's refresh stays held, so the dialog recovers from the refusal's answer alone.
test('a newer version of another session keeps the dialog open, and the next save records the values after it', async ({
  page,
}) => {
  await openDialog(page, 'customer-conditions-section');
  const dialog = page.getByRole('dialog', { name: 'Konditionen ändern' });
  const material = dialog.getByRole('textbox', { name: 'Material' });
  await material.fill('12,5');
  const save = dialog.getByRole('button', { name: 'Konditionen speichern', exact: true });
  await save.click();
  await expectHeldWrite(page, 'recordCustomerCondition');
  await answerHeldWrite(page, 'condition_changed');

  await expect(
    dialog.getByText(
      'Inzwischen wurde ein neuerer Stand gespeichert, zum Beispiel in einem anderen Fenster. Deine Eingaben sind noch da: Speicherst du erneut, werden sie als nächster Stand gespeichert.',
    ),
  ).toBeVisible();
  await expect(material).toHaveValue('12,5');
  await expect(dialog.getByRole('textbox', { name: 'Preis netto je Einheit' })).toHaveValue('68,00');
  await expect(save).toBeEnabled();
  // A refusal waits for no refresh and reports no save.
  await expect(settling(page)).toHaveCount(0);
  await expect(savedBanner(page)).toHaveCount(0);

  await save.click();
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer !== null)).toBe(true);
  const [first, second] = await page.evaluate(() => window.uiContractWrites.calls.map((call) => call.input));
  const values = {
    clientId: 'contract-client',
    validFrom: expect.any(String),
    discountTenths: { material: 125, arbeit: 50, anfahrt: 0 },
    leistungPrices: [{ leistungId: 'contract-leistung', salePriceCents: 6800 }],
    attemptKey: expect.any(String),
  };
  // The same values against the version the refusal named, never the one the form was filled from.
  expect(first).toEqual({ ...values, expectedVersion: 2 });
  expect(second).toEqual({ ...values, expectedVersion: 3 });
  // The same values keep their retry key: the refused call stored nothing under it.
  const keyOf = (input: unknown) =>
    typeof input === 'object' && input !== null && 'attemptKey' in input ? input.attemptKey : null;
  expect(keyOf(second)).toBe(keyOf(first));
  await answerHeldWrite(page, null);
  await expect(dialog).toHaveCount(0);
  await expect(savedBanner(page)).toBeVisible();
});

// Only a stored version changes the page: a refusal waits for no refresh and reports no save; an
// accepted save shows the section settling until the page's render carries the new version.
test('a refused save waits for nothing, and an accepted one settles once the page shows the new version', async ({
  page,
}) => {
  await openDialog(page, 'customer-conditions-section');
  const dialog = page.getByRole('dialog', { name: 'Konditionen ändern' });
  const save = dialog.getByRole('button', { name: 'Konditionen speichern', exact: true });
  await save.click();
  await expectHeldWrite(page, 'recordCustomerCondition');
  await answerHeldWrite(page, 'save_failed');
  await expect(
    dialog.getByText('Die Konditionen konnten nicht gespeichert werden. Versuche es erneut.'),
  ).toBeVisible();
  await expect(settling(page)).toHaveCount(0);
  await expect(savedBanner(page)).toHaveCount(0);

  await save.click();
  await expect.poll(() => page.evaluate(() => window.uiContractWrites.answer !== null)).toBe(true);
  await answerHeldWrite(page, null);
  await expect(dialog).toHaveCount(0);
  await expect(savedBanner(page)).toBeVisible();
  await expect(settling(page)).toBeVisible();
  await page.getByRole('button', { name: 'Seite aktualisieren', exact: true }).click();
  await expect(visibleText(page, 'Stand 4 · ab 27.11.2026')).toBeVisible();
  await expect(settling(page)).toHaveCount(0);
});
